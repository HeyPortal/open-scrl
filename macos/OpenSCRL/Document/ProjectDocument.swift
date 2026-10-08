import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let openSCRLProject = UTType(exportedAs: "com.heyportal.openscrl.project", conformingTo: .package)
    static let openSCRLMediaReference = UTType(exportedAs: "com.heyportal.openscrl.media-reference", conformingTo: .data)
    static let openSCRLLayer = UTType(exportedAs: "com.heyportal.openscrl.layer", conformingTo: .data)
}

/// An immutable copy of the document handed to the background reader/writer.
struct ProjectSnapshot: @unchecked Sendable {
    var project: Project
    /// Media file wrappers keyed by their file name in the package's `Media` folder.
    var media: [String: FileWrapper]
    var thumbnailPNG: Data?
}

/// A project package:
///
///     Name.openscrl/
///       project.json            schema v2, compatible with the web app
///       Media/<asset>.<ext>     original photos, animated images and videos
///       QuickLook/Thumbnail.png first slide, for Finder and the welcome window
@Observable
@MainActor
final class ProjectDocument: Document {
    nonisolated static let readableContentTypes: [UTType] = [.openSCRLProject]

    private var committedProject: Project
    /// Readers, exports and snapshots see the latest canvas edit. During a canvas gesture,
    /// only the canvas revision changes; publishing the document on every mouse event would
    /// also rebuild the inspector, filmstrip and the rest of the SwiftUI editor.
    private(set) var project: Project {
        get { let committed = committedProject; return gesturePreview ?? committed }
        set { committedProject = newValue }
    }
    private(set) var canvasRevision = 0
    /// True for a brand-new untitled project until the user picks a canvas format.
    var needsFormatChoice: Bool

    @ObservationIgnored let media: MediaStore
    @ObservationIgnored let images: ImageCache
    @ObservationIgnored let urlConfiguration: URLDocumentConfiguration?
    /// Media to turn into slides when the window opens (photos opened with the app).
    @ObservationIgnored var pendingMedia: [URL] = []

    @ObservationIgnored private var gestureBase: Project?
    @ObservationIgnored private var gesturePreview: Project?
    @ObservationIgnored private var coalesceKey: String?
    @ObservationIgnored private var coalesceTime: TimeInterval = 0
    /// Called after undo or redo replaces the project, so UI-only state can follow it.
    @ObservationIgnored var onHistoryStep: (() -> Void)?

    convenience init(format: CanvasFormat, media: [URL]) {
        self.init(format: format)
        pendingMedia = media
    }

    init(format: CanvasFormat? = nil, configuration: URLDocumentConfiguration? = nil) {
        let media = MediaStore()
        self.media = media
        images = ImageCache(media: media)
        committedProject = Project(format: format ?? Preferences.defaultFormat)
        needsFormatChoice = format == nil && configuration?.fileURL == nil
        urlConfiguration = configuration
    }

    var fileURL: URL? { urlConfiguration?.fileURL }

    var displayName: String {
        fileURL?.deletingPathExtension().lastPathComponent ?? "Untitled"
    }

    // MARK: Reading

    nonisolated func reader(configuration: sending ReadConfiguration) -> sending FileWrapperDocumentReader<ProjectSnapshot> {
        FileWrapperDocumentReader(configuration) { wrapper in
            try ProjectDocument.makeSnapshot(from: wrapper)
        }
    }

    nonisolated static func makeSnapshot(from wrapper: FileWrapper) throws -> ProjectSnapshot {
        guard let children = wrapper.fileWrappers, let json = children["project.json"]?.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let project = try ProjectFile.decode(json).makeProject()
        let media = children["Media"]?.fileWrappers ?? [:]
        return ProjectSnapshot(project: project, media: media, thumbnailPNG: nil)
    }

    func apply(snapshot: sending ProjectSnapshot, previous: sending ProjectSnapshot?) async throws {
        gesturePreview = nil
        gestureBase = nil
        for asset in snapshot.project.assets {
            if let wrapper = snapshot.media[asset.fileName] { media.register(asset.id, wrapper: wrapper) }
        }
        project = snapshot.project
        needsFormatChoice = false
    }

    // MARK: Writing

    nonisolated func writer(configuration: sending WriteConfiguration) -> sending FileWrapperDocumentWriter<ProjectSnapshot> {
        FileWrapperDocumentWriter(configuration) { snapshot, previous in
            try ProjectDocument.makeFileWrapper(snapshot, previous: previous)
        }
    }

    func snapshot(contentType: UTType) async throws -> sending ProjectSnapshot {
        var wrappers: [String: FileWrapper] = [:]
        for asset in project.assets {
            if let wrapper = media.wrapper(for: asset) { wrappers[asset.fileName] = wrapper }
        }
        return ProjectSnapshot(project: project, media: wrappers, thumbnailPNG: renderThumbnailPNG())
    }

    nonisolated static func makeFileWrapper(_ snapshot: ProjectSnapshot, previous: FileWrapper?) throws -> FileWrapper {
        var children: [String: FileWrapper] = [:]
        children["project.json"] = FileWrapper(regularFileWithContents: try ProjectFile(project: snapshot.project).encoded())

        // Reuse unchanged media from the file on disk so saves don't rewrite large videos.
        let existing = previous?.fileWrappers?["Media"]?.fileWrappers ?? [:]
        var media: [String: FileWrapper] = [:]
        for asset in snapshot.project.assets {
            if let wrapper = existing[asset.fileName] ?? snapshot.media[asset.fileName] {
                media[asset.fileName] = wrapper
            }
        }
        let mediaFolder = FileWrapper(directoryWithFileWrappers: media)
        children["Media"] = mediaFolder

        if let thumbnail = snapshot.thumbnailPNG {
            children["QuickLook"] = FileWrapper(directoryWithFileWrappers: ["Thumbnail.png": FileWrapper(regularFileWithContents: thumbnail)])
        }
        return FileWrapper(directoryWithFileWrappers: children)
    }

    private func renderThumbnailPNG() -> Data? {
        guard !project.slides.isEmpty else { return nil }
        let edge = 512.0
        let scale = edge / max(project.format.width, project.format.height)
        let w = Int((project.format.width * scale).rounded()), h = Int((project.format.height * scale).rounded())
        guard let cg = ImageDecoding.makeContext(width: w, height: h) else { return nil }
        cg.scaleBy(x: scale, y: scale)
        Renderer.drawSlide(project, index: 0, cg: cg, images: SynchronousImages(cache: images))
        return cg.makeImage().flatMap(ImageDecoding.pngData)
    }

    // MARK: Editing and undo

    /// Applies an edit and registers undo. Edits with the same `coalesce` key within 0.75 s
    /// (slider drags, color wells, nudges) merge into one undo step, like the web app.
    func perform(_ actionName: String, undoManager: UndoManager?, coalesce key: String? = nil, _ body: (inout Project) -> Void) {
        var next = project
        body(&next)
        guard !next.hasSameContent(as: project) else { return }
        let previous = project
        next.updatedAt = Date()
        if gesturePreview != nil {
            gesturePreview = next
            canvasRevision &+= 1
            return
        }
        project = next
        guard gestureBase == nil else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if let key, key == coalesceKey, now - coalesceTime < 0.75, undoManager?.canUndo == true {
            coalesceTime = now
            return
        }
        coalesceKey = key
        coalesceTime = now
        registerUndo(restoring: previous, actionName: actionName, undoManager: undoManager)
    }

    /// Starts a continuous gesture (drag, slider); edits apply live and become one undo step.
    func beginGesture(canvasPreview: Bool = false) {
        guard gestureBase == nil else { return }
        gestureBase = project
        if canvasPreview { gesturePreview = project }
    }

    var isInGesture: Bool { gestureBase != nil }

    func endGesture(_ actionName: String, undoManager: UndoManager?) {
        guard let base = gestureBase else { return }
        let final = project
        gesturePreview = nil
        gestureBase = nil
        coalesceKey = nil
        if !base.hasSameContent(as: final) {
            project = final
            registerUndo(restoring: base, actionName: actionName, undoManager: undoManager)
        }
        canvasRevision &+= 1
    }

    func cancelGesture() {
        guard let base = gestureBase else { return }
        gesturePreview = nil
        gestureBase = nil
        project = base
        canvasRevision &+= 1
    }

    /// Replaces the project without undo (initial format choice for new documents).
    func setInitialFormat(_ format: CanvasFormat) {
        project.format = format
        needsFormatChoice = false
    }

    private func registerUndo(restoring old: Project, actionName: String, undoManager: UndoManager?) {
        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { document in
            MainActor.assumeIsolated {
                let current = document.project
                document.gesturePreview = nil
                document.gestureBase = nil
                document.project = old
                document.coalesceKey = nil
                document.registerUndo(restoring: current, actionName: actionName, undoManager: undoManager)
                document.onHistoryStep?()
            }
        }
        undoManager.setActionName(actionName)
    }
}

/// Decodes images synchronously (used when writing the Finder thumbnail).
private final class SynchronousImages: ImageProviding {
    let cache: ImageCache
    init(cache: ImageCache) { self.cache = cache }
    func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? { cache.imageNow(for: asset, pixelEdge: pixelEdge) }
}
