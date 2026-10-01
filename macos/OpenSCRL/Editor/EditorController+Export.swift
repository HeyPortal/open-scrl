import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension EditorController {
    var exportBaseName: String { CarouselExporter.safeFileName(document.displayName) }

    private var hostWindow: NSWindow? { shareAnchor?.window ?? NSApp.keyWindow ?? NSApp.mainWindow }

    /// Runs an export with a progress sheet. `work` reports (detail, fraction) and may throw.
    func runExport(_ title: String,
                   work: @escaping (_ report: @escaping @Sendable (String, Double?) -> Void) async throws -> Void,
                   completion: @escaping () -> Void = {}) {
        guard exportState == nil else { return }
        exportState = ExportState(title: title, detail: "Preparing…", fraction: nil)
        weak let controller = self
        let report: @Sendable (String, Double?) -> Void = { detail, fraction in
            Task { @MainActor in
                guard controller?.exportState != nil else { return }
                controller?.exportState?.detail = detail
                controller?.exportState?.fraction = fraction
            }
        }
        exportTask = Task { [weak self] in
            do {
                try await work(report)
                self?.exportState = nil
                completion()
            } catch is CancellationError {
                self?.exportState = nil
            } catch {
                self?.exportState = nil
                self?.show(error.localizedDescription, style: .error)
            }
            self?.exportTask = nil
        }
    }

    func cancelExport() {
        exportTask?.cancel()
    }

    private func revealAction(_ url: URL) -> () -> Void {
        { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    // MARK: Single slide

    func exportCurrentSlide() {
        let index = selectedSlideIndex
        let project = self.project
        let media = document.media
        let animated = VideoSlideRenderer.isAnimated(project, slide: index)
        let panel = NSSavePanel()
        panel.title = "Export Slide"
        panel.prompt = "Export"
        panel.message = animated ? "This slide has animated media. Export it as an MP4, or as a still image of the first frame." : ""
        panel.nameFieldStringValue = "\(exportBaseName) – Slide \(index + 1)"
        panel.allowedContentTypes = (animated ? [UTType.mpeg4Movie] : []) + [.png, .jpeg, .heic]
        panel.showsContentTypes = true
        panel.currentContentType = animated ? .mpeg4Movie : UTType(Preferences.stillFormat.typeIdentifier)
        panel.canCreateDirectories = true
        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK, let url = panel.url, let self else { return }
            var options = ExportOptions.current
            let type = panel.currentContentType ?? .png
            if type.conforms(to: .jpeg) { options.stillFormat = .jpeg } else if type.conforms(to: .heic) { options.stillFormat = .heic } else { options.stillFormat = .png }
            let video = type.conforms(to: .mpeg4Movie)
            self.runExport("Exporting Slide \(index + 1)") { report in
                try await CarouselExporter.exportSlide(project, slide: index, media: media, options: options, to: url, allowVideo: video) { fraction in
                    report(video ? "Rendering video · \(Int(fraction * 100))%" : "Rendering", fraction)
                }
            } completion: { [weak self] in
                guard let self else { return }
                self.show("Exported slide \(index + 1).", style: .success, actionTitle: "Show in Finder", action: self.revealAction(url))
            }
        }
        if let window = hostWindow { panel.beginSheetModal(for: window, completionHandler: handler) } else { handler(panel.runModal()) }
    }

    // MARK: Carousel

    func exportCarousel() {
        let project = self.project
        let media = document.media
        let base = exportBaseName
        let panel = NSSavePanel()
        panel.title = "Export Carousel"
        panel.prompt = "Export"
        panel.message = "Each slide becomes a numbered file in posting order. Slides with GIFs or videos export as MP4."
        panel.canCreateDirectories = true
        let model = ExportPanelModel(panel: panel, baseName: "\(base) Carousel")
        let accessory = NSHostingView(rootView: ExportAccessoryView(model: model))
        accessory.frame.size = accessory.fittingSize
        panel.accessoryView = accessory
        panel.isExtensionHidden = false
        model.apply()

        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK, let url = panel.url, let self else { return }
            let options = ExportOptions.current
            let zip = Preferences.packaging == .zip
            let count = project.slides.count
            self.runExport("Exporting Carousel") { report in
                let folder: URL
                if zip {
                    folder = FileManager.default.temporaryDirectory.appending(path: "OpenSCRL-Export-\(UUID().uuidString)").appending(path: "\(base) Carousel")
                } else {
                    try? FileManager.default.removeItem(at: url)
                    folder = url
                }
                let files = try await CarouselExporter.exportAll(project, media: media, options: options, into: folder) { slide, fraction, video in
                    let detail = video ? "Slide \(slide + 1) of \(count) · video \(Int(fraction * 100))%" : "Slide \(slide + 1) of \(count)"
                    report(detail, (Double(slide) + fraction) / Double(count))
                }
                if zip {
                    report("Packaging…", nil)
                    try CarouselExporter.zip(folder: folder, to: url)
                    try? FileManager.default.removeItem(at: folder.deletingLastPathComponent())
                }
                _ = files
            } completion: { [weak self] in
                guard let self else { return }
                self.show("Exported \(count) slide\(count == 1 ? "" : "s").", style: .success, actionTitle: "Show in Finder", action: self.revealAction(url))
            }
        }
        if let window = hostWindow { panel.beginSheetModal(for: window, completionHandler: handler) } else { handler(panel.runModal()) }
    }

    /// Renders the carousel and opens the share sheet (AirDrop to your phone, Messages, Mail…).
    func shareCarousel() {
        let project = self.project
        let media = document.media
        let base = exportBaseName
        let count = project.slides.count
        let options = ExportOptions.current
        var files: [URL] = []
        runExport("Preparing to Share") { report in
            let folder = FileManager.default.temporaryDirectory.appending(path: "OpenSCRL-Share-\(UUID().uuidString)").appending(path: "\(base) Carousel")
            files = try await CarouselExporter.exportAll(project, media: media, options: options, into: folder) { slide, fraction, video in
                report(video ? "Slide \(slide + 1) of \(count) · video \(Int(fraction * 100))%" : "Slide \(slide + 1) of \(count)", (Double(slide) + fraction) / Double(count))
            }
        } completion: { [weak self] in
            guard let self, !files.isEmpty else { return }
            let picker = NSSharingServicePicker(items: files)
            if let anchor = self.shareAnchor, anchor.window != nil {
                picker.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .minY)
            } else if let view = self.hostWindow?.contentView {
                picker.show(relativeTo: CGRect(x: view.bounds.maxX - 120, y: view.bounds.maxY - 60, width: 1, height: 1), of: view, preferredEdge: .minY)
            }
        }
    }
}

/// Keeps the save panel's file type in sync with the packaging choice.
@MainActor
final class ExportPanelModel: ObservableObject {
    weak var panel: NSSavePanel?
    let baseName: String
    @Published var packaging = Preferences.packaging { didSet { UserDefaults.standard.set(packaging.rawValue, forKey: Preferences.Key.packaging); apply() } }

    init(panel: NSSavePanel, baseName: String) {
        self.panel = panel
        self.baseName = baseName
    }

    func apply() {
        guard let panel else { return }
        if packaging == .zip {
            panel.allowedContentTypes = [.zip]
            panel.nameFieldStringValue = "\(baseName).zip"
        } else {
            panel.allowedContentTypes = []
            panel.nameFieldStringValue = baseName
        }
    }
}

struct ExportAccessoryView: View {
    @ObservedObject var model: ExportPanelModel
    @AppStorage(Preferences.Key.stillFormat) private var stillFormat = Preferences.StillFormat.png.rawValue
    @AppStorage(Preferences.Key.jpegQuality) private var quality = 0.92
    @AppStorage(Preferences.Key.exportScale) private var scale = 1.0
    @AppStorage(Preferences.Key.videoFrameRate) private var frameRate = 30

    var body: some View {
        Form {
            Picker("Save as:", selection: $model.packaging) {
                ForEach(Preferences.Packaging.allCases) { Text($0.title).tag($0) }
            }
            Picker("Still slides:", selection: $stillFormat) {
                ForEach(Preferences.StillFormat.allCases) { Text($0.title).tag($0.rawValue) }
            }
            if stillFormat != Preferences.StillFormat.png.rawValue {
                LabeledContent("Quality:") {
                    Slider(value: $quality, in: 0.5...1) { Text("Quality") } minimumValueLabel: { Text("Smaller") } maximumValueLabel: { Text("Best") }
                        .labelsHidden()
                        .frame(width: 220)
                }
            }
            Picker("Resolution:", selection: $scale) {
                Text("1× (Instagram size)").tag(1.0)
                Text("2× (High detail)").tag(2.0)
            }
            Picker("Video frame rate:", selection: $frameRate) {
                Text("24 fps").tag(24)
                Text("30 fps").tag(30)
                Text("60 fps").tag(60)
            }
        }
        .formStyle(.columns)
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .fixedSize()
    }
}
