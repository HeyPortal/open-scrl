import SwiftUI
import UniformTypeIdentifiers

enum SidebarPanel: String, CaseIterable, Identifiable {
    case grids, media, text, shapes, background
    var id: String { rawValue }

    var title: String {
        switch self {
        case .grids: "Grids"
        case .media: "Media"
        case .text: "Text"
        case .shapes: "Shapes"
        case .background: "Background"
        }
    }

    var symbol: String {
        switch self {
        case .grids: "square.grid.2x2"
        case .media: "photo.on.rectangle"
        case .text: "textformat"
        case .shapes: "square.on.circle"
        case .background: "paintpalette"
        }
    }
}

enum InspectorTab: String, CaseIterable, Identifiable {
    case design, layers
    var id: String { rawValue }
    var title: String { self == .design ? "Design" : "Layers" }
}

struct Banner: Identifiable, Equatable {
    enum Style { case info, success, warning, error }
    let id = UUID()
    var message: String
    var style: Style = .info
    var actionTitle: String?
    var action: (() -> Void)?

    static func == (a: Banner, b: Banner) -> Bool { a.id == b.id }

    var symbol: String {
        switch style {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .error: "xmark.octagon.fill"
        }
    }
}

/// Where imported media should go.
enum MediaPlacement: Equatable {
    case libraryOnly
    /// Add new photo layers to a slide, centered at a global point (or the slide center).
    case add(slide: Int, center: CGPoint?)
    /// Put the media into an existing photo layer (filling an empty slot or replacing).
    case fill(layerID: String)
}

enum ArrangeDirection { case forward, backward, front, back }
enum AlignEdge: CaseIterable { case left, centerX, right, top, centerY, bottom }

/// Per-window editor state and every editing action. Edits go through the document so they
/// are undoable and mark the project as changed (which drives autosave).
@MainActor
@Observable
final class EditorController {
    let document: ProjectDocument
    @ObservationIgnored weak var undoManager: UndoManager?

    var selectedSlideID: String
    var selectedLayerID: String?
    var zoom: CGFloat = 0.5
    var fitZoom: CGFloat = 0.5
    var zoomFollowsFit = true
    var sidebarPanel: SidebarPanel = .media
    var inspectorTab: InspectorTab = .design
    var showsInspector = true
    var showsCommandPalette = false
    /// Incremented to ask the canvas to scroll the selected slide into view.
    var slideFocusRequest = 0
    var editingTextLayerID: String?
    var cropLayerID: String?
    var banner: Banner?
    var isImporting = false
    var importMessage: String?
    var showsFileImporter = false
    @ObservationIgnored var fileImporterPlacement: MediaPlacement = .libraryOnly
    var gridGap: Double = 0
    var exportState: ExportState?
    /// Layer whose name field the inspector should focus.
    var renameRequest: String?

    @ObservationIgnored private var bannerTask: Task<Void, Never>?
    @ObservationIgnored var exportTask: Task<Void, Never>?
    @ObservationIgnored weak var shareAnchor: NSView?

    init(document: ProjectDocument) {
        self.document = document
        selectedSlideID = document.project.slides.first?.id ?? ""
    }

    var project: Project { document.project }

    // MARK: - Undo plumbing

    func perform(_ name: String, coalesce key: String? = nil, _ body: (inout Project) -> Void) {
        document.perform(name, undoManager: undoManager, coalesce: key, body)
    }

    func beginGesture() { document.beginGesture() }
    func endGesture(_ name: String) { document.endGesture(name, undoManager: undoManager) }
    func cancelGesture() { document.cancelGesture() }

    // MARK: - Selection

    var selectedSlideIndex: Int {
        project.slideIndex(of: selectedSlideID) ?? 0
    }

    var selectedSlide: Slide? {
        let p = project
        return p.slides.indices.contains(selectedSlideIndex) ? p.slides[selectedSlideIndex] : nil
    }

    var selectedLayer: Layer? { project.layer(selectedLayerID) }

    var selectedLayerLocation: LayerLocation? { project.locate(layer: selectedLayerID) }

    func selectSlide(_ id: String) {
        guard selectedSlideID != id || selectedLayerID != nil else { return }
        selectedSlideID = id
        selectedLayerID = nil
        endModes()
    }

    func focusSlide(_ id: String) {
        selectSlide(id)
        slideFocusRequest &+= 1
    }

    func focusSlide(at index: Int) {
        let slides = project.slides
        guard !slides.isEmpty else { return }
        focusSlide(slides[clamp(index, 0, slides.count - 1)].id)
    }

    func selectLayer(_ id: String?) {
        if id != editingTextLayerID { editingTextLayerID = nil }
        if id != cropLayerID { cropLayerID = nil }
        selectedLayerID = id
        if let id, let loc = project.locate(layer: id) {
            selectedSlideID = project.slides[loc.slide].id
        }
    }

    func selectAdjacentLayer(_ offset: Int) {
        guard let slide = selectedSlide, !slide.layers.isEmpty else { return }
        // Tab order follows the layer list: front-most first.
        let order = Array(slide.layers.reversed())
        let current = order.firstIndex { $0.id == selectedLayerID }
        let next = current.map { ($0 + offset + order.count) % order.count } ?? (offset > 0 ? 0 : order.count - 1)
        selectLayer(order[next].id)
    }

    func endModes() {
        editingTextLayerID = nil
        cropLayerID = nil
    }

    /// Repairs selection after undo/redo removed the selected layer or slide.
    func validateSelection() {
        if project.slideIndex(of: selectedSlideID) == nil { selectedSlideID = project.slides.first?.id ?? "" }
        if let id = selectedLayerID, project.locate(layer: id) == nil { selectedLayerID = nil }
        if let id = editingTextLayerID, project.locate(layer: id) == nil { editingTextLayerID = nil }
        if let id = cropLayerID, project.locate(layer: id) == nil { cropLayerID = nil }
    }

    // MARK: - Messages

    func show(_ message: String, style: Banner.Style = .info, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        let banner = Banner(message: message, style: style, actionTitle: actionTitle, action: action)
        withAnimation(.snappy) { self.banner = banner }
        bannerTask?.cancel()
        bannerTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(style == .error || action != nil ? 6 : 3.2))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy) { if self?.banner?.id == banner.id { self?.banner = nil } }
        }
    }

    // MARK: - Zoom

    static let minZoom: CGFloat = 0.05
    static let maxZoom: CGFloat = 4

    func setZoom(_ value: CGFloat) {
        zoom = clamp(value, Self.minZoom, Self.maxZoom)
        zoomFollowsFit = false
    }

    func zoomIn() { setZoom(zoom * 1.25) }
    func zoomOut() { setZoom(zoom / 1.25) }
    func zoomToFit() { zoom = fitZoom; zoomFollowsFit = true; slideFocusRequest &+= 1 }
    func zoomToActualSize() { setZoom(1) }

    // MARK: - Project & slides

    func setFormat(_ format: CanvasFormat) {
        perform("Change Canvas Format") { $0.format = format }
        zoomFollowsFit = true
    }

    func addSlide(after id: String? = nil) {
        let slide = Slide.blank()
        perform("Add Slide") { p in
            let index = id.flatMap { p.slideIndex(of: $0) }.map { $0 + 1 } ?? p.slides.count
            p.slides.insert(slide, at: min(index, p.slides.count))
        }
        focusSlide(slide.id)
    }

    func deleteSlide(_ id: String) {
        guard project.slides.count > 1, let index = project.slideIndex(of: id) else { return }
        let wasSelected = id == selectedSlideID
        perform("Delete Slide") { $0.slides.remove(at: index) }
        // Deleting another slide (from the canvas header) keeps the current selection.
        if wasSelected { focusSlide(at: min(index, project.slides.count - 1)) }
    }

    func duplicateSlide(_ id: String) {
        guard let index = project.slideIndex(of: id) else { return }
        var copy = project.slides[index]
        copy.id = UID.make()
        copy.layers = copy.layers.map { var l = $0; l.id = UID.make(); return l }
        perform("Duplicate Slide") { $0.slides.insert(copy, at: index + 1) }
        focusSlide(copy.id)
    }

    func moveSlide(from: Int, to: Int) {
        guard from != to, project.slides.indices.contains(from), project.slides.indices.contains(to) else { return }
        perform("Move Slide") { p in
            let slide = p.slides.remove(at: from)
            p.slides.insert(slide, at: to)
        }
        slideFocusRequest &+= 1
    }

    /// Reorders slides to match `ids` (used by drag-and-drop in the filmstrip).
    func reorderSlides(_ ids: [String]) {
        guard Set(ids) == Set(project.slides.map(\.id)), ids != project.slides.map(\.id) else { return }
        perform("Move Slide") { p in
            let byID = Dictionary(uniqueKeysWithValues: p.slides.map { ($0.id, $0) })
            p.slides = ids.compactMap { byID[$0] }
        }
    }

    func moveSelectedSlide(by offset: Int) {
        let index = selectedSlideIndex
        moveSlide(from: index, to: index + offset)
    }

    func setBackground(_ background: Background, coalesce: Bool = false) {
        let index = selectedSlideIndex
        perform("Change Background", coalesce: coalesce ? "background:\(selectedSlideID)" : nil) { p in
            guard p.slides.indices.contains(index) else { return }
            p.slides[index].background = background
        }
    }

    func applyBackgroundToAllSlides() {
        guard let background = selectedSlide?.background else { return }
        perform("Apply Background to All Slides") { p in
            for i in p.slides.indices { p.slides[i].background = background }
        }
        show("Background applied to all \(project.slides.count) slides.", style: .success)
    }

    // MARK: - Adding layers

    private func targetSlideIndex(_ index: Int? = nil) -> Int {
        clamp(index ?? selectedSlideIndex, 0, max(0, project.slides.count - 1))
    }

    @discardableResult
    func insert(_ layer: Layer, name: String, slide: Int? = nil, select: Bool = true) -> String {
        let index = targetSlideIndex(slide)
        perform(name) { p in
            guard p.slides.indices.contains(index) else { return }
            p.slides[index].layers.append(layer)
        }
        if select { selectLayer(layer.id) }
        return layer.id
    }

    func addText(_ preset: TextPreset? = nil) {
        let f = project.format
        var props = TextProperties(text: preset?.text ?? "Double-click to edit")
        if let preset {
            props.fontSize = preset.size
            props.fontWeight = preset.weight
        }
        let width = f.width * 0.8
        let height = TextLayout.measuredHeight(props, width: width)
        let layer = Layer(id: UID.make(), name: preset?.name ?? "Text", x: f.width * 0.1, y: (f.height - height) / 2,
                          width: width, height: height, content: .text(props))
        insert(layer, name: "Add Text")
    }

    /// Applies a text preset to the selected text layer, or adds a new text layer.
    func applyTextPreset(_ preset: TextPreset) {
        guard let layer = selectedLayer, layer.text != nil else { addText(preset); return }
        updateLayer(layer.id, "Apply Text Style") { l in
            l.text?.text = preset.text
            l.text?.fontSize = preset.size
            l.text?.fontWeight = preset.weight
        }
    }

    func addShape(_ preset: ShapePreset) {
        let made = preset.make(project.format)
        let layer = Layer(id: UID.make(), name: preset.name, x: made.frame.minX, y: made.frame.minY,
                          width: made.frame.width, height: made.frame.height, content: .shape(made.props))
        insert(layer, name: "Add \(preset.name)")
    }

    func addShape(_ kind: ShapeKind) {
        addShape(ShapePreset.all.first { $0.shape == kind }!)
    }

    func makeImageLayer(_ asset: MediaAsset, center: CGPoint? = nil) -> Layer {
        let f = project.format
        let ratio = asset.width / max(1, asset.height)
        var width = f.width * 0.7, height = width / ratio
        if height > f.height * 0.7 { height = f.height * 0.7; width = height * ratio }
        let c = center ?? CGPoint(x: f.width / 2, y: f.height / 2)
        let name = asset.mediaKind == .video ? "Video" : asset.mediaKind == .gif ? "Animation" : "Photo"
        return Layer(id: UID.make(), name: name, x: c.x - width / 2, y: c.y - height / 2, width: width, height: height,
                     content: .image(ImageProperties(assetID: asset.id)))
    }

    func addImage(_ asset: MediaAsset, slide: Int? = nil, center: CGPoint? = nil) {
        insert(makeImageLayer(asset, center: center), name: "Add Photo", slide: slide)
    }

    /// Clicking an item in the media library, mirroring the web app: fill or replace the
    /// selected photo layer; clicking the photo it already shows duplicates that layer;
    /// otherwise add a new photo to the slide.
    func useAsset(_ asset: MediaAsset) {
        if let layer = selectedLayer, let props = layer.image {
            if props.assetID == asset.id { duplicateLayer(layer.id); return }
            assign(asset, to: layer.id)
        } else {
            addImage(asset)
        }
    }

    func assign(_ asset: MediaAsset, to layerID: String, name: String? = nil) {
        let wasEmpty = project.layer(layerID)?.isEmptyImageSlot ?? false
        updateLayer(layerID, name ?? (wasEmpty ? "Fill Photo Slot" : "Replace Photo")) { l in
            l.image?.assetID = asset.id
            l.image?.cropOffsetX = 0
            l.image?.cropOffsetY = 0
            l.image?.cropScale = 1
            l.locked = false
        }
    }

    func applyGrid(_ template: GridTemplate, gap: Double? = nil) {
        let index = selectedSlideIndex
        let cells = template.cells(project.format.width, project.format.height, gap ?? gridGap)
        let layers = cells.enumerated().map { i, cell in
            Layer(id: UID.make(), name: "Photo \(i + 1)", x: cell.minX, y: cell.minY, width: cell.width, height: cell.height,
                  locked: true, content: .image(ImageProperties()))
        }
        perform("Apply \(template.name) Grid") { p in
            guard p.slides.indices.contains(index) else { return }
            p.slides[index].layers = layers
        }
        selectLayer(nil)
        selectedSlideID = project.slides[index].id
        show("Applied the \(template.name) grid. Click a slot, then a photo in Media to fill it.")
    }

    // MARK: - Editing layers

    /// Updates one layer. Text layers keep their height fitted to their content.
    func updateLayer(_ id: String, _ name: String = "Edit Layer", coalesce key: String? = nil, _ body: (inout Layer) -> Void) {
        perform(name, coalesce: key) { p in
            p.updateLayer(id) { layer in
                body(&layer)
                Self.fitTextHeight(&layer)
            }
        }
    }

    static func fitTextHeight(_ layer: inout Layer) {
        guard let text = layer.text else { return }
        layer.height = max(1, TextLayout.measuredHeight(text, width: layer.width))
    }

    func deleteLayer(_ id: String) {
        guard let loc = project.locate(layer: id) else { return }
        perform("Delete Layer") { $0.slides[loc.slide].layers.remove(at: loc.index) }
        if selectedLayerID == id { selectedLayerID = nil }
        endModes()
    }

    func deleteSelection() {
        if let id = selectedLayerID { deleteLayer(id) }
    }

    func duplicateLayer(_ id: String, offset: Double = 24) {
        guard let loc = project.locate(layer: id) else { return }
        var copy = project.slides[loc.slide].layers[loc.index]
        copy.id = UID.make()
        copy.x += offset
        copy.y += offset
        copy.name = copy.name.hasSuffix(" copy") ? copy.name : "\(copy.name) copy"
        perform("Duplicate Layer") { $0.slides[loc.slide].layers.insert(copy, at: loc.index + 1) }
        selectLayer(copy.id)
    }

    func arrange(_ id: String, _ direction: ArrangeDirection) {
        guard let loc = project.locate(layer: id) else { return }
        let count = project.slides[loc.slide].layers.count
        let target: Int = switch direction {
        case .forward: min(loc.index + 1, count - 1)
        case .backward: max(loc.index - 1, 0)
        case .front: count - 1
        case .back: 0
        }
        guard target != loc.index else { return }
        let names: [ArrangeDirection: String] = [.forward: "Bring Forward", .backward: "Send Backward", .front: "Bring to Front", .back: "Send to Back"]
        perform(names[direction]!) { p in
            let layer = p.slides[loc.slide].layers.remove(at: loc.index)
            p.slides[loc.slide].layers.insert(layer, at: target)
        }
    }

    func canArrange(_ direction: ArrangeDirection) -> Bool {
        guard let loc = selectedLayerLocation else { return false }
        let count = project.slides[loc.slide].layers.count
        switch direction {
        case .forward, .front: return loc.index < count - 1
        case .backward, .back: return loc.index > 0
        }
    }

    /// Moves a layer within its slide's stack; `toIndex` counts from the back (paint order).
    func moveLayer(_ id: String, toIndex: Int) {
        guard let loc = project.locate(layer: id) else { return }
        perform("Reorder Layers") { p in
            var layers = p.slides[loc.slide].layers
            let layer = layers.remove(at: loc.index)
            layers.insert(layer, at: clamp(toIndex, 0, layers.count))
            p.slides[loc.slide].layers = layers
        }
    }

    func setLayerOrder(slide index: Int, ids: [String]) {
        guard project.slides.indices.contains(index) else { return }
        perform("Reorder Layers") { p in
            let byID = Dictionary(uniqueKeysWithValues: p.slides[index].layers.map { ($0.id, $0) })
            let reordered = ids.compactMap { byID[$0] }
            if reordered.count == p.slides[index].layers.count { p.slides[index].layers = reordered }
        }
    }

    func toggleVisible(_ id: String) {
        guard let visible = project.layer(id)?.visible else { return }
        updateLayer(id, visible ? "Hide Layer" : "Show Layer") { $0.visible.toggle() }
    }

    func toggleLocked(_ id: String) {
        guard let locked = project.layer(id)?.locked else { return }
        updateLayer(id, locked ? "Unlock Layer" : "Lock Layer") { $0.locked.toggle() }
        if !locked { endModes() }
    }

    func rename(_ id: String, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        updateLayer(id, "Rename Layer") { $0.name = trimmed }
    }

    func align(_ id: String, _ edge: AlignEdge) {
        guard let layer = project.layer(id), !layer.locked else { return }
        let f = project.format
        let bounds = Geometry.rotatedBounds(of: layer.frame, degrees: layer.rotation)
        let dx = layer.x - bounds.minX, dy = layer.y - bounds.minY
        updateLayer(id, "Align Layer") { l in
            switch edge {
            case .left: l.x = dx
            case .centerX: l.x = (f.width - l.width) / 2
            case .right: l.x = f.width - bounds.width + dx
            case .top: l.y = dy
            case .centerY: l.y = (f.height - l.height) / 2
            case .bottom: l.y = f.height - bounds.height + dy
            }
        }
    }

    func nudge(dx: Double, dy: Double) {
        guard let layer = selectedLayer, !layer.locked else { return }
        updateLayer(layer.id, "Move Layer", coalesce: "nudge:\(layer.id)") { l in
            l.x += dx
            l.y += dy
        }
    }

    func resetPhoto(_ id: String) {
        updateLayer(id, "Reset Photo") { l in
            l.image?.cropOffsetX = 0
            l.image?.cropOffsetY = 0
            l.image?.cropScale = 1
            l.image?.cornerRadius = 0
        }
    }

    func beginTextEditing(_ id: String) {
        guard let layer = project.layer(id), layer.text != nil else { return }
        selectLayer(id)
        if layer.locked { show("Unlock the layer to edit its text.", style: .warning); return }
        cropLayerID = nil
        editingTextLayerID = id
    }

    func requestRename(_ id: String) {
        selectLayer(id)
        showsInspector = true
        inspectorTab = .design
        renameRequest = id
    }

    func beginCropEditing(_ id: String) {
        guard let layer = project.layer(id), layer.image?.assetID != nil else { return }
        selectLayer(id)
        if layer.locked { updateLayer(id, "Unlock Layer") { $0.locked = false } }
        editingTextLayerID = nil
        cropLayerID = id
    }

    // MARK: - Media

    func requestImport(_ placement: MediaPlacement = .libraryOnly) {
        fileImporterPlacement = placement
        showsFileImporter = true
    }

    func replacePhoto(_ layerID: String) {
        sidebarPanel = .media
        requestImport(.fill(layerID: layerID))
    }

    func importMedia(_ urls: [URL], placement: MediaPlacement = .libraryOnly) {
        Task { await importMediaNow(urls, placement: placement) }
    }

    /// Imports files, then places them in one undoable step.
    func importMediaNow(_ urls: [URL], placement: MediaPlacement) async {
        guard !urls.isEmpty else { return }
        isImporting = true
        defer { isImporting = false }
        var added: [MediaAsset] = []
        var usable: [MediaAsset] = []
        var duplicates = 0, failed: [String] = [], skipped = 0
        for url in urls {
            guard MediaImporter.isSupported(url) else { skipped += 1; continue }
            do {
                let asset = try await MediaImporter.importFile(at: url, into: document.media)
                if let existing = (project.assets + added).first(where: { $0.hash == asset.hash }) {
                    duplicates += 1
                    usable.append(existing)
                    try? FileManager.default.removeItem(at: document.media.workDirectory.appending(path: asset.fileName))
                    continue
                }
                added.append(asset)
                usable.append(asset)
            } catch {
                failed.append(url.lastPathComponent)
            }
        }
        place(added: added, usable: usable, placement: placement)
        reportImport(added: added.count, duplicates: duplicates, failed: failed, skipped: skipped, placement: placement)
    }

    func importImageData(_ data: Data, type: UTType, name: String, placement: MediaPlacement) async {
        do {
            let asset = try await MediaImporter.importData(data, type: type, name: name, into: document.media)
            if let existing = project.assets.first(where: { $0.hash == asset.hash }) {
                place(added: [], usable: [existing], placement: placement)
            } else {
                place(added: [asset], usable: [asset], placement: placement)
            }
        } catch {
            show(error.localizedDescription, style: .error)
        }
    }

    private func place(added: [MediaAsset], usable: [MediaAsset], placement: MediaPlacement) {
        guard !usable.isEmpty else { return }
        var newSelection: String?
        let project = self.project
        let actionName = added.isEmpty ? "Add Photo" : added.count == 1 ? "Import Media" : "Import \(added.count) Media Files"
        perform(actionName) { p in
            p.assets.append(contentsOf: added)
            switch placement {
            case .libraryOnly:
                break
            case .fill(let layerID):
                var queue = usable
                p.updateLayer(layerID) { l in
                    l.image?.assetID = queue.removeFirst().id
                    l.image?.cropOffsetX = 0; l.image?.cropOffsetY = 0; l.image?.cropScale = 1
                    l.locked = false
                }
                newSelection = layerID
                // Extra files fill the slide's other empty slots, then become new photos.
                if let loc = p.locate(layer: layerID) {
                    for i in p.slides[loc.slide].layers.indices where !queue.isEmpty && p.slides[loc.slide].layers[i].isEmptyImageSlot {
                        p.slides[loc.slide].layers[i].image?.assetID = queue.removeFirst().id
                        p.slides[loc.slide].layers[i].locked = false
                    }
                    for (n, asset) in queue.enumerated() {
                        var layer = self.makeImageLayer(asset)
                        layer.x += Double(n) * 24; layer.y += Double(n) * 24
                        p.slides[loc.slide].layers.append(layer)
                    }
                }
            case .add(let slideIndex, let center):
                guard p.slides.indices.contains(slideIndex) else { return }
                var queue = usable
                // Dropping several files on a grid fills its empty slots first.
                if usable.count > 1 {
                    for i in p.slides[slideIndex].layers.indices where !queue.isEmpty && p.slides[slideIndex].layers[i].isEmptyImageSlot {
                        p.slides[slideIndex].layers[i].image?.assetID = queue.removeFirst().id
                        p.slides[slideIndex].layers[i].locked = false
                    }
                }
                let local = center.map { CGPoint(x: $0.x - Double(slideIndex) * project.format.width, y: $0.y) }
                for (n, asset) in queue.enumerated() {
                    var layer = self.makeImageLayer(asset, center: local)
                    layer.x += Double(n) * 24; layer.y += Double(n) * 24
                    p.slides[slideIndex].layers.append(layer)
                    newSelection = layer.id
                }
            }
        }
        if let newSelection { selectLayer(newSelection) }
    }

    private func reportImport(added: Int, duplicates: Int, failed: [String], skipped: Int, placement: MediaPlacement) {
        var parts: [String] = []
        if added > 0 { parts.append("Imported \(added) media file\(added == 1 ? "" : "s").") }
        if duplicates > 0, placement == .libraryOnly {
            parts.append("\(duplicates) duplicate file\(duplicates == 1 ? " was" : "s were") already in this project.")
        }
        if skipped > 0 { parts.append("Skipped \(skipped) unsupported file\(skipped == 1 ? "" : "s").") }
        if !failed.isEmpty { parts.append(failed.count == 1 ? "Couldn’t decode \(failed[0])." : "Couldn’t decode \(failed.count) files.") }
        guard !parts.isEmpty else { return }
        importMessage = parts.joined(separator: " ")
        if placement != .libraryOnly || !failed.isEmpty {
            show(parts.joined(separator: " "), style: failed.isEmpty ? .success : .warning)
        }
    }

    func removeAsset(_ id: String) {
        guard let asset = project.asset(id) else { return }
        let references = project.references(toAsset: id)
        if references > 0 {
            let alert = NSAlert()
            alert.messageText = "Remove “\(asset.name)” from this project?"
            alert.informativeText = "It’s used by \(references) layer\(references == 1 ? "" : "s"). Those layers will become empty photo slots."
            alert.addButton(withTitle: "Remove")
            alert.addButton(withTitle: "Cancel")
            alert.buttons.first?.hasDestructiveAction = true
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        perform("Remove Media") { p in
            p.assets.removeAll { $0.id == id }
            for s in p.slides.indices {
                for l in p.slides[s].layers.indices where p.slides[s].layers[l].image?.assetID == id {
                    p.slides[s].layers[l].image?.assetID = nil
                }
            }
        }
    }

    /// Fills the selected empty slot when the selection is a photo layer, else adds the photo.
    func dropTargetDescription() -> String {
        guard let layer = selectedLayer, let props = layer.image else { return "Click a photo to add it to the slide." }
        return props.assetID == nil
            ? "Click a photo to fill “\(layer.name)”."
            : "Click to replace the photo in “\(layer.name)”, or click its current photo to duplicate it."
    }
}

// MARK: - Export state

struct ExportState: Equatable {
    var title: String
    var detail: String
    var fraction: Double?
}
