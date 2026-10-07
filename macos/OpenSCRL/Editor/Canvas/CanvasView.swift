import AppKit
import Observation

/// The editor's workspace. Like the web app's Konva stage it is viewport-sized and draws the
/// visible part of the slide deck itself, so memory stays flat at any zoom level. It renders
/// with the same `Renderer` used for export, then draws selection chrome on top.
final class CanvasView: NSView {
    // MARK: State

    weak var controller: EditorController?
    var contentInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0) {
        didSet { if !NSEdgeInsetsEqual(oldValue, contentInsets) { needsLayout = true } }
    }

    /// View position of deck coordinate (0, 0).
    var origin = CGPoint(x: 40, y: 40)
    let padding: CGFloat = 40
    var renderedZoom: CGFloat = 0
    var handledFocusRequest = -1
    var didInitialFit = false

    enum Handle: Equatable {
        case resize(dx: Int, dy: Int)
        case rotate
    }

    enum Drag {
        case none
        /// Mouse is down on a selected layer. `narrow` narrows the selection to it on a plain click.
        case pending(id: String, start: CGPoint, narrow: Bool)
        /// Moves every unlocked selected layer; `union` is their slide-local bounds at the start.
        case move(ids: [String], slide: Int, bases: [Layer], union: CGRect, start: CGPoint, others: [Layer], duplicated: Bool)
        case resize(id: String, slide: Int, base: Layer, handle: Handle, others: [Layer])
        case rotate(id: String, base: Layer, center: CGPoint, startAngle: Double)
        /// Scales a multi-layer selection from its slide-local bounds `from`.
        case groupResize(slide: Int, bases: [Layer], from: CGRect, handle: Handle, others: [Layer])
        /// Rotates a multi-layer selection around `center` (deck coordinates).
        case groupRotate(slide: Int, bases: [Layer], center: CGPoint, startAngle: Double)
        case crop(id: String, base: Layer, start: CGPoint)
        case pan(start: CGPoint, origin: CGPoint)
        /// Rubber-band selection on one slide, starting at `start` (deck coordinates).
        case marquee(start: CGPoint, slide: Int, base: [String])
        case slideButton(SlideButton)
    }

    var drag: Drag = .none
    var guides: [SnapGuide] = []
    var guideSlideOffset: Double = 0
    var seams: [CGRect] = []
    var hoverLayerID: String?
    var hoverSlideIndex: Int?
    var hoverSlideButton: SlideButton?
    var dropTargetLayerID: String?
    var isDropTargeted = false
    var spaceDown = false
    var textEditor: CanvasTextView?
    let textUndoManager = UndoManager()
    var playback: MediaPlayback?
    var displayLink: CADisplayLink?
    var trackingArea: NSTrackingArea?
    var lastMouseLocation: CGPoint?
    var styledZoom: CGFloat = 0
    /// The rubber band in deck coordinates while dragging on empty canvas.
    var marqueeRect: CGRect?
    /// Guides the current drag last snapped to, so the trackpad taps once per new snap.
    var lastSnapSignature: Set<String> = []

    static let guideColor = NSColor(srgbRed: 1, green: 0.231, blue: 0.541, alpha: 1)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        registerForDraggedTypes(Self.dropTypes)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override var isOpaque: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    // MARK: Coordinates

    var zoom: CGFloat { controller?.zoom ?? 1 }

    func viewPoint(_ m: CGPoint) -> CGPoint { CGPoint(x: origin.x + m.x * zoom, y: origin.y + m.y * zoom) }
    func modelPoint(_ v: CGPoint) -> CGPoint { CGPoint(x: (v.x - origin.x) / zoom, y: (v.y - origin.y) / zoom) }
    func viewRect(_ m: CGRect) -> CGRect {
        CGRect(x: origin.x + m.minX * zoom, y: origin.y + m.minY * zoom, width: m.width * zoom, height: m.height * zoom)
    }

    /// The part of the view not covered by the toolbar, sidebar, inspector or filmstrip.
    var availableRect: CGRect {
        let r = bounds
        return CGRect(x: r.minX + contentInsets.left, y: r.minY + contentInsets.top,
                      width: max(1, r.width - contentInsets.left - contentInsets.right),
                      height: max(1, r.height - contentInsets.top - contentInsets.bottom))
    }

    func deckSize(_ project: Project) -> CGSize {
        CGSize(width: project.deckSize.width * zoom, height: project.deckSize.height * zoom)
    }

    func fitZoom(for project: Project) -> CGFloat {
        let avail = availableRect
        let w = (avail.width - padding * 2) / project.format.width
        let h = (avail.height - padding * 2) / project.format.height
        return clamp(min(w, h), EditorController.minZoom, EditorController.maxZoom)
    }

    func clampOrigin() {
        guard let project = controller?.project else { return }
        let avail = availableRect
        let deck = deckSize(project)
        if deck.width + padding * 2 <= avail.width {
            origin.x = (avail.minX + (avail.width - deck.width) / 2).rounded()
        } else {
            origin.x = clamp(origin.x, avail.maxX - padding - deck.width, avail.minX + padding)
        }
        if deck.height + padding * 2 <= avail.height {
            origin.y = (avail.minY + (avail.height - deck.height) / 2).rounded()
        } else {
            origin.y = clamp(origin.y, avail.maxY - padding - deck.height, avail.minY + padding)
        }
    }

    func centerOnSlide(_ index: Int) {
        guard let project = controller?.project else { return }
        let avail = availableRect
        origin.x = avail.midX - (CGFloat(index) + 0.5) * project.format.width * zoom
        origin.y = avail.midY - project.format.height * zoom / 2
        clampOrigin()
    }

    /// Zooms while keeping the deck point under `anchor` (view coordinates) fixed.
    func zoom(to value: CGFloat, anchor: CGPoint) {
        guard let controller else { return }
        let new = clamp(value, EditorController.minZoom, EditorController.maxZoom)
        let m = modelPoint(anchor)
        controller.setZoom(new)
        renderedZoom = new
        origin = CGPoint(x: anchor.x - m.x * new, y: anchor.y - m.y * new)
        clampOrigin()
        layoutTextEditor()
        needsDisplay = true
    }

    // MARK: Layout & state sync

    override func layout() {
        super.layout()
        guard let controller else { return }
        let project = controller.project
        let fit = fitZoom(for: project)
        if abs(controller.fitZoom - fit) > 0.0001 { controller.fitZoom = fit }
        if controller.zoomFollowsFit || !didInitialFit {
            didInitialFit = bounds.width > 10
            if abs(controller.zoom - fit) > 0.0001 { controller.zoom = fit }
            renderedZoom = fit
            centerOnSlide(controller.selectedSlideIndex)
        } else {
            clampOrigin()
        }
        layoutTextEditor()
        needsDisplay = true
    }

    /// Reacts to editor state changes that need imperative work (called from SwiftUI updates).
    func syncWithController() {
        guard let controller else { return }
        if renderedZoom != controller.zoom {
            let avail = availableRect
            let m = modelPoint(CGPoint(x: avail.midX, y: avail.midY))
            let old = renderedZoom
            renderedZoom = controller.zoom
            if old > 0 {
                origin = CGPoint(x: avail.midX - m.x * controller.zoom, y: avail.midY - m.y * controller.zoom)
            }
            clampOrigin()
            needsDisplay = true
        }
        if handledFocusRequest != controller.slideFocusRequest {
            handledFocusRequest = controller.slideFocusRequest
            if bounds.width > 10 { revealSlide(controller.selectedSlideIndex) }
        }
        syncTextEditor()
        syncPlayback()
        layoutTextEditor()
        // Zooming or revealing a slide moves the deck under a still pointer.
        updateSlideHover(lastMouseLocation)
    }

    /// Scrolls just enough to show the slide; centers it when it doesn't fit.
    func revealSlide(_ index: Int) {
        guard let project = controller?.project else { return }
        let rect = viewRect(project.viewport(ofSlide: index))
        let avail = availableRect.insetBy(dx: padding / 2, dy: padding / 2)
        if rect.width > avail.width || rect.minX < avail.minX || rect.maxX > avail.maxX {
            centerOnSlide(index)
        }
        clampOrigin()
        needsDisplay = true
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        needsLayout = true
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.acceptsMouseMovedEvents = true
        if window != nil { needsLayout = true }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        trackingArea = area
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        guard let cg = NSGraphicsContext.current?.cgContext else { return }
        guard let controller else {
            NSColor.underPageBackgroundColor.setFill()
            bounds.fill()
            return
        }
        withObservationTracking {
            render(cg, controller: controller)
        } onChange: { [weak self] in
            DispatchQueue.main.async { self?.needsDisplay = true }
        }
    }

    private var workspaceColor: CGColor {
        effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? CGColor(srgbRed: 0.105, green: 0.105, blue: 0.118, alpha: 1)
            : CGColor(srgbRed: 0.905, green: 0.905, blue: 0.918, alpha: 1)
    }

    private var isDark: Bool { effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

    private func render(_ cg: CGContext, controller: EditorController) {
        let project = controller.project
        let document = controller.document
        let z = zoom
        let accent = NSColor.controlAccentColor.cgColor
        cg.setFillColor(workspaceColor)
        cg.fill(bounds)
        guard !project.slides.isEmpty else { return }

        let W = project.format.width
        let deckRect = CGRect(origin: origin, size: deckSize(project))
        let visibleModel = CGRect(x: (bounds.minX - origin.x) / z, y: (bounds.minY - origin.y) / z, width: bounds.width / z, height: bounds.height / z)

        // Deck shadow
        cg.saveGState()
        cg.setShadow(offset: CGSize(width: 0, height: 10), blur: 30, color: CGColor(gray: 0, alpha: isDark ? 0.6 : 0.22))
        cg.setFillColor(.white)
        cg.fill(deckRect)
        cg.restoreGState()

        var options = RenderOptions(editor: true)
        options.accent = accent
        options.interpolation = isInteracting ? .medium : .high
        if let id = controller.editingTextLayerID { options.hiddenLayerIDs.insert(id) }
        if let id = dropTargetLayerID { options.highlightedSlotIDs.insert(id) }
        if let layer = controller.selectedLayer, layer.isEmptyImageSlot { options.highlightedSlotIDs.insert(layer.id) }
        let assets = project.assetsByID
        let images = document.images

        // Content that hangs off the deck is shown faintly so it can still be found and grabbed.
        drawOverflow(cg, project: project, deckRect: deckRect, assets: assets, images: images, options: options)

        let first = max(0, Int(floor(visibleModel.minX / W)))
        let last = min(project.slides.count - 1, Int(floor(visibleModel.maxX / W)))
        if first <= last {
            for index in first...last {
                cg.saveGState()
                cg.translateBy(x: origin.x + CGFloat(index) * W * z, y: origin.y)
                cg.scaleBy(x: z, y: z)
                Renderer.drawSlide(project, index: index, cg: cg, images: images, options: options, assets: assets)
                cg.restoreGState()
            }
        }

        drawSlideChrome(cg, project: project, controller: controller, first: first, last: last, accent: accent)
        if let cropID = controller.cropLayerID, let item = sceneItem(cropID, in: project) {
            drawCropOverlay(cg, item: item, project: project, assets: assets, images: images, accent: accent)
        }
        drawSelection(cg, project: project, controller: controller, accent: accent)
        drawGuides(cg)
        drawMarquee(cg, accent: accent)
    }

    var isInteracting: Bool {
        switch drag {
        case .none, .pending, .marquee, .slideButton: false
        default: true
        }
    }

    func sceneItem(_ id: String, in project: Project) -> SceneItem? {
        guard let loc = project.locate(layer: id) else { return nil }
        let layer = project.slides[loc.slide].layers[loc.index]
        return SceneItem(layer: layer, slideIndex: loc.slide, origin: CGPoint(x: layer.x + Double(loc.slide) * project.format.width, y: layer.y))
    }

    private func drawOverflow(_ cg: CGContext, project: Project, deckRect: CGRect, assets: [String: MediaAsset], images: ImageProviding, options: RenderOptions) {
        let deckModel = CGRect(origin: .zero, size: project.deckSize)
        let overflowing = project.scene().filter {
            !deckModel.contains(Geometry.rotatedBounds(of: $0.globalFrame, degrees: $0.layer.rotation).insetBy(dx: 0.5, dy: 0.5))
        }
        guard !overflowing.isEmpty else { return }
        cg.saveGState()
        cg.addRect(bounds)
        cg.addRect(deckRect)
        cg.clip(using: .evenOdd)
        cg.setAlpha(0.28)
        cg.beginTransparencyLayer(auxiliaryInfo: nil)
        cg.translateBy(x: origin.x, y: origin.y)
        cg.scaleBy(x: zoom, y: zoom)
        for item in overflowing {
            Renderer.drawLayer(item.layer, origin: item.origin, cg: cg, assets: assets, images: images, options: options)
        }
        cg.endTransparencyLayer()
        cg.restoreGState()
    }

    private func drawSlideChrome(_ cg: CGContext, project: Project, controller: EditorController, first: Int, last: Int, accent: CGColor) {
        let W = project.format.width * zoom
        let H = project.format.height * zoom
        let scale = window?.backingScaleFactor ?? 2
        // Seams between slides.
        if project.slides.count > 1 {
            cg.saveGState()
            cg.setStrokeColor(CGColor(gray: 0.5, alpha: 0.45))
            cg.setLineWidth(1 / scale)
            for index in 1..<project.slides.count {
                let x = (origin.x + CGFloat(index) * W).rounded() + 0.5 / scale
                cg.move(to: CGPoint(x: x, y: origin.y))
                cg.addLine(to: CGPoint(x: x, y: origin.y + H))
            }
            cg.strokePath()
            cg.restoreGState()
        }
        // Selected slide outline.
        let selected = controller.selectedSlideIndex
        if project.slides.count > 1 || controller.selectedLayerID == nil {
            let rect = CGRect(x: origin.x + CGFloat(selected) * W, y: origin.y, width: W, height: H).insetBy(dx: -1, dy: -1)
            cg.setStrokeColor(accent)
            cg.setLineWidth(2)
            cg.stroke(rect)
        }
        // Slide numbers above each slide, with buttons on the selected and hovered ones.
        guard first <= last else { return }
        for index in first...last {
            drawSlideHeader(cg, index: index, selected: index == selected)
        }
    }

    private func drawCropOverlay(_ cg: CGContext, item: SceneItem, project: Project, assets: [String: MediaAsset], images: ImageProviding, accent: CGColor) {
        guard let props = item.layer.image, let asset = assets[props.assetID ?? ""] else { return }
        let layer = item.layer
        let box = CGSize(width: layer.width, height: layer.height)
        let media = Geometry.mediaRect(mediaSize: asset.pixelSize, box: box, image: props)
        cg.saveGState()
        cg.translateBy(x: origin.x, y: origin.y)
        cg.scaleBy(x: zoom, y: zoom)
        cg.translateBy(x: item.origin.x + layer.width / 2, y: item.origin.y + layer.height / 2)
        cg.rotate(by: Geometry.radians(layer.rotation))
        cg.translateBy(x: -layer.width / 2, y: -layer.height / 2)
        // Dim the rest of the canvas, then show the hidden part of the photo faintly.
        cg.saveGState()
        cg.addRect(media.insetBy(dx: -100_000, dy: -100_000))
        cg.addPath(Renderer.roundedRect(CGRect(origin: .zero, size: box), radius: props.cornerRadius))
        cg.clip(using: .evenOdd)
        cg.setFillColor(CGColor(gray: 0, alpha: 0.35))
        cg.fill(media.insetBy(dx: -100_000, dy: -100_000))
        if let image = images.image(for: asset, pixelEdge: max(media.width, media.height) * zoom * 2) {
            cg.setAlpha(0.45)
            Renderer.drawImageFlipped(image, in: media, cg: cg)
        }
        cg.restoreGState()
        cg.setStrokeColor(accent)
        cg.setLineWidth(1.5 / zoom)
        cg.setLineDash(phase: 0, lengths: [6 / zoom, 4 / zoom])
        cg.stroke(media)
        cg.restoreGState()
    }

    // MARK: Selection chrome

    func handlePositions(for item: SceneItem) -> [(Handle, CGPoint)] {
        let layer = item.layer
        let rect = item.globalFrame
        var handles: [(Handle, CGPoint)] = []
        let viewSize = CGSize(width: layer.width * zoom, height: layer.height * zoom)
        let isText = layer.text != nil
        for dy in [-1, 0, 1] {
            for dx in [-1, 0, 1] where !(dx == 0 && dy == 0) {
                let isEdge = dx == 0 || dy == 0
                if isEdge {
                    if dx == 0 && (isText || viewSize.width < 36) { continue }
                    if dy == 0 && viewSize.height < 36 { continue }
                }
                let local = CGPoint(x: CGFloat(dx + 1) / 2 * layer.width, y: CGFloat(dy + 1) / 2 * layer.height)
                handles.append((.resize(dx: dx, dy: dy), viewPoint(Geometry.parentPoint(local, in: rect, degrees: layer.rotation))))
            }
        }
        handles.append((.rotate, rotationHandlePoint(for: item)))
        return handles
    }

    func rotationHandlePoint(for item: SceneItem) -> CGPoint {
        let rect = item.globalFrame
        let top = viewPoint(Geometry.parentPoint(CGPoint(x: item.layer.width / 2, y: 0), in: rect, degrees: item.layer.rotation))
        let center = viewPoint(rect.center)
        let d = top - center
        let len = max(0.001, d.length)
        return top + d * (24 / len)
    }

    private func outlinePath(_ item: SceneItem) -> CGPath {
        let pts = Geometry.corners(of: item.globalFrame, degrees: item.layer.rotation).map(viewPoint)
        let path = CGMutablePath()
        path.addLines(between: pts)
        path.closeSubpath()
        return path
    }

    /// Deck-space bounds of a multi-layer selection (several layers or one group).
    func selectionBox(_ controller: EditorController) -> (slide: Int, rect: CGRect, locked: Bool)? {
        guard controller.isMultiSelection, let slide = controller.selectedLayerLocation?.slide else { return nil }
        let layers = controller.selectedLayers
        guard let bounds = Geometry.unionBounds(of: layers) else { return nil }
        return (slide, bounds.offsetBy(dx: Double(slide) * controller.project.format.width, dy: 0), layers.allSatisfy(\.locked))
    }

    /// Handles around a multi-layer selection's box: axis-aligned, with rotation above the top edge.
    func selectionHandlePositions(_ rect: CGRect) -> [(Handle, CGPoint)] {
        let v = viewRect(rect)
        var handles: [(Handle, CGPoint)] = []
        for dy in [-1, 0, 1] {
            for dx in [-1, 0, 1] where !(dx == 0 && dy == 0) {
                if (dx == 0 && v.width < 36) || (dy == 0 && v.height < 36) { continue }
                handles.append((.resize(dx: dx, dy: dy), CGPoint(x: v.midX + CGFloat(dx) * v.width / 2, y: v.midY + CGFloat(dy) * v.height / 2)))
            }
        }
        handles.append((.rotate, CGPoint(x: v.midX, y: v.minY - 24)))
        return handles
    }

    private func drawHandles(_ cg: CGContext, _ handles: [(Handle, CGPoint)], rotateFrom top: CGPoint, accent: CGColor) {
        if let rotate = handles.first(where: { $0.0 == .rotate })?.1 {
            cg.setStrokeColor(accent)
            cg.setLineWidth(1)
            cg.move(to: top)
            cg.addLine(to: rotate)
            cg.strokePath()
            let r = CGRect(x: rotate.x - 5, y: rotate.y - 5, width: 10, height: 10)
            cg.setFillColor(accent)
            cg.fillEllipse(in: r)
            cg.setStrokeColor(.white)
            cg.setLineWidth(1.5)
            cg.strokeEllipse(in: r.insetBy(dx: 0.75, dy: 0.75))
        }
        for (handle, point) in handles where handle != .rotate {
            let r = CGRect(x: point.x - 4.5, y: point.y - 4.5, width: 9, height: 9)
            let path = CGPath(roundedRect: r, cornerWidth: 2.5, cornerHeight: 2.5, transform: nil)
            cg.saveGState()
            cg.setShadow(offset: CGSize(width: 0, height: 1), blur: 2, color: CGColor(gray: 0, alpha: 0.25))
            cg.addPath(path)
            cg.setFillColor(.white)
            cg.fillPath()
            cg.restoreGState()
            cg.addPath(path)
            cg.setStrokeColor(accent)
            cg.setLineWidth(1.25)
            cg.strokePath()
        }
    }

    private func drawLockBadge(_ cg: CGContext, at corner: CGPoint, accent: CGColor) {
        guard let lock = Renderer.symbolImage("lock.fill", pointSize: 11) else { return }
        let badge = CGRect(x: corner.x - 9, y: corner.y - 9, width: 18, height: 18)
        cg.setFillColor(accent)
        cg.fillEllipse(in: badge)
        let iconH: CGFloat = 9, iconW = iconH * CGFloat(lock.width) / CGFloat(lock.height)
        let iconRect = CGRect(x: badge.midX - iconW / 2, y: badge.midY - iconH / 2, width: iconW, height: iconH)
        Self.fillSymbol(lock, in: iconRect, color: .white, cg: cg)
    }

    /// Every selected layer gets a thin outline; the selection as a whole gets a dashed box
    /// with handles that scale and rotate everything together.
    private func drawMultiSelection(_ cg: CGContext, project: Project, controller: EditorController, accent: CGColor) {
        guard let box = selectionBox(controller) else { return }
        cg.saveGState()
        for id in controller.selectedLayerIDs {
            guard let item = sceneItem(id, in: project) else { continue }
            cg.addPath(outlinePath(item))
        }
        cg.setStrokeColor(accent)
        cg.setLineWidth(1)
        cg.strokePath()
        let rect = viewRect(box.rect).integral.insetBy(dx: 0.5, dy: 0.5)
        cg.setLineWidth(1.25)
        cg.setLineDash(phase: 0, lengths: [5, 3])
        cg.stroke(rect)
        cg.restoreGState()
        if box.locked {
            drawLockBadge(cg, at: CGPoint(x: rect.maxX, y: rect.minY), accent: accent)
            return
        }
        guard controller.editingTextLayerID == nil, !isInteracting || isResizingOrRotating else { return }
        drawHandles(cg, selectionHandlePositions(box.rect), rotateFrom: CGPoint(x: rect.midX, y: rect.minY), accent: accent)
    }

    private func drawMarquee(_ cg: CGContext, accent: CGColor) {
        guard let marqueeRect else { return }
        let r = viewRect(marqueeRect).integral.insetBy(dx: 0.5, dy: 0.5)
        cg.saveGState()
        cg.setFillColor(accent.copy(alpha: 0.12) ?? accent)
        cg.fill(r)
        cg.setStrokeColor(accent.copy(alpha: 0.85) ?? accent)
        cg.setLineWidth(1)
        cg.stroke(r)
        cg.restoreGState()
    }

    private func drawSelection(_ cg: CGContext, project: Project, controller: EditorController, accent: CGColor) {
        if let hover = hoverLayerID, !controller.selectedLayerIDs.contains(hover), !isInteracting, let item = sceneItem(hover, in: project), item.layer.visible {
            cg.saveGState()
            cg.addPath(outlinePath(item))
            cg.setStrokeColor(accent.copy(alpha: 0.7) ?? accent)
            cg.setLineWidth(1)
            cg.strokePath()
            cg.restoreGState()
        }
        if controller.isMultiSelection {
            drawMultiSelection(cg, project: project, controller: controller, accent: accent)
            return
        }
        guard let id = controller.selectedLayerID, let item = sceneItem(id, in: project) else { return }
        let layer = item.layer
        let editing = controller.editingTextLayerID == id || controller.cropLayerID == id
        cg.saveGState()
        cg.addPath(outlinePath(item))
        cg.setStrokeColor(accent)
        cg.setLineWidth(1.5)
        if layer.locked || editing || !layer.visible { cg.setLineDash(phase: 0, lengths: [5, 3]) }
        cg.strokePath()
        cg.restoreGState()

        if layer.locked {
            drawLockBadge(cg, at: viewPoint(Geometry.parentPoint(CGPoint(x: layer.width, y: 0), in: item.globalFrame, degrees: layer.rotation)), accent: accent)
            return
        }
        guard !editing, !isInteracting || isResizingOrRotating else { return }
        let top = viewPoint(Geometry.parentPoint(CGPoint(x: layer.width / 2, y: 0), in: item.globalFrame, degrees: layer.rotation))
        drawHandles(cg, handlePositions(for: item), rotateFrom: top, accent: accent)
    }

    private var isResizingOrRotating: Bool {
        switch drag {
        case .resize, .rotate, .groupResize, .groupRotate: true
        default: false
        }
    }

    private func drawGuides(_ cg: CGContext) {
        let color = Self.guideColor.cgColor
        if !seams.isEmpty {
            cg.saveGState()
            for seam in seams {
                let r = viewRect(seam)
                cg.setFillColor(color.copy(alpha: 0.16) ?? color)
                cg.fill(CGRect(x: r.midX - 6, y: r.minY, width: 12, height: r.height))
                cg.setStrokeColor(color)
                cg.setLineWidth(1.5)
                cg.setLineDash(phase: 0, lengths: [8, 5])
                cg.move(to: CGPoint(x: r.midX, y: r.minY))
                cg.addLine(to: CGPoint(x: r.midX, y: r.maxY))
                cg.strokePath()
            }
            cg.restoreGState()
        }
        guard !guides.isEmpty else { return }
        cg.saveGState()
        cg.setStrokeColor(color)
        cg.setLineWidth(1)
        for guide in guides {
            switch guide.orientation {
            case .vertical:
                let a = viewPoint(CGPoint(x: guideSlideOffset + guide.position, y: guide.start))
                let b = viewPoint(CGPoint(x: guideSlideOffset + guide.position, y: guide.end))
                cg.move(to: CGPoint(x: a.x.rounded() + 0.5, y: a.y))
                cg.addLine(to: CGPoint(x: b.x.rounded() + 0.5, y: b.y))
            case .horizontal:
                let a = viewPoint(CGPoint(x: guideSlideOffset + guide.start, y: guide.position))
                let b = viewPoint(CGPoint(x: guideSlideOffset + guide.end, y: guide.position))
                cg.move(to: CGPoint(x: a.x, y: a.y.rounded() + 0.5))
                cg.addLine(to: CGPoint(x: b.x, y: b.y.rounded() + 0.5))
            }
        }
        cg.strokePath()
        cg.restoreGState()
    }

    // MARK: Playback of animated media

    func syncPlayback() {
        guard let controller else { return }
        let asset = controller.selectedLayer?.image?.assetID.flatMap { controller.project.asset($0) }
        let wanted = (asset?.mediaKind.isAnimated == true && Preferences.playAnimatedMedia) ? asset : nil
        if playback?.assetID == wanted?.id { return }
        playback?.stop()
        if let old = playback?.assetID { controller.document.images.playbackFrames[old] = nil }
        playback = nil
        displayLink?.invalidate()
        displayLink = nil
        guard let wanted else { needsDisplay = true; return }
        playback = MediaPlayback(asset: wanted, media: controller.document.media, maxPixel: 1280)
        let link = displayLink(target: self, selector: #selector(stepPlayback))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 24, maximum: 60, preferred: 30)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func stepPlayback() {
        guard let playback, let controller, let frame = playback.currentFrame() else { return }
        if controller.document.images.playbackFrames[playback.assetID] !== frame {
            controller.document.images.playbackFrames[playback.assetID] = frame
            needsDisplay = true
        }
    }

    func teardown() {
        playback?.stop()
        displayLink?.invalidate()
        displayLink = nil
        if let id = playback?.assetID { controller?.document.images.playbackFrames[id] = nil }
        playback = nil
    }
}
