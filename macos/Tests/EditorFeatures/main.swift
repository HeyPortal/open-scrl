import AppKit
import SwiftUI
import CoreTransferable
import UniformTypeIdentifiers
import Darwin

// UI harness: drives EditorController and a real CanvasView without showing any window.
@MainActor func run() throws {
    NSApplication.shared.setActivationPolicy(.prohibited)
    try FileManager.default.createDirectory(atPath: "out", withIntermediateDirectories: true)
    var checks = 0
    checks += runPhotoChecks()
    func check(_ c: @autoclosure () -> Bool, _ name: String) { guard c() else { fatalError("FAIL: \(name)") }; checks += 1 }
    func shape(_ id: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, group: String? = nil, fill: String, ellipse: Bool = false) -> Layer {
        Layer(id: id, name: id.capitalized, x: x, y: y, width: w, height: h, groupID: group, content: .shape(ShapeProperties(shape: ellipse ? .ellipse : .rect, fill: fill, cornerRadius: ellipse ? 0 : 36)))
    }
    let document = ProjectDocument(format: .default)
    document.perform("Fixture", undoManager: nil) { p in
        p.slides = [Slide(id: "s1", background: .solid("#f5f0e8"), layers: [
            shape("a", 140, 220, 300, 300, group: "g", fill: "#4f46e5"),
            shape("b", 520, 300, 260, 260, group: "g", fill: "#0ea5e9", ellipse: true),
            shape("c", 160, 820, 260, 200, fill: "#f97316"),
            shape("d", 620, 860, 200, 200, fill: "#22c55e", ellipse: true),
        ]), Slide(id: "s2", background: .solid("#ffffff"), layers: [shape("e", 100, 100, 200, 200, fill: "#111111")])]
    }
    let c = EditorController(document: document)
    let undo = UndoManager(); undo.groupsByEvent = false; c.undoManager = undo

    // Click rules
    c.pickLayer("b", additive: false)
    check(c.selectedLayerIDs == ["a", "b"] && c.selectedLayerID == "b", "click picks the whole group")
    c.pickLayer("c", additive: true)
    check(c.selectedLayerIDs == ["a", "b", "c"], "shift-click adds")
    check(c.clickWouldNarrow("c"), "click inside a larger selection narrows")
    c.pickLayer("a", additive: true)
    check(c.selectedLayerIDs == ["c"], "shift-click removes the whole group")
    c.pickLayer("a", additive: false); c.enterGroup("a")
    check(c.selectedLayerIDs == ["a"] && c.enteredGroupID == "g", "double-click enters group")
    c.pickLayer("b", additive: false)
    check(c.selectedLayerIDs == ["b"], "inside a group clicks pick members")
    c.selectParent()
    check(c.selectedLayerIDs == ["a", "b"], "escape selects the whole group")
    c.selectParent()
    check(c.selectedLayerIDs.isEmpty, "escape again clears")
    c.pickLayer("c", additive: false); c.pickLayer("e", additive: true)
    check(c.selectedLayerIDs == ["e"] && c.selectedSlideID == "s2", "additive across slides replaces")
    print("PASS click rules")

    // Canvas: a real CanvasView, offscreen.
    let canvas = CanvasView(frame: NSRect(x: 0, y: 0, width: 1100, height: 1000))
    canvas.controller = c
    c.selectSlide("s1")
    canvas.layout()
    func event(_ type: NSEvent.EventType, _ m: CGPoint, flags: NSEvent.ModifierFlags = [], clicks: Int = 1) -> NSEvent {
        let v = canvas.viewPoint(m)
        let w = canvas.convert(v, to: nil)
        return NSEvent.mouseEvent(with: type, location: w, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, clickCount: clicks, pressure: 1)!
    }
    func drag(_ from: CGPoint, _ to: CGPoint, flags: NSEvent.ModifierFlags = [], downFlags: NSEvent.ModifierFlags = []) {
        undo.beginUndoGrouping(); defer { undo.endUndoGrouping() }
        canvas.mouseDown(with: event(.leftMouseDown, from, flags: downFlags))
        for t in stride(from: 0.1, through: 1.0, by: 0.1) {
            canvas.mouseDragged(with: event(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), flags: flags))
        }
        canvas.mouseUp(with: event(.leftMouseUp, to, flags: flags))
    }
    func snapshot(_ name: String) {
        let rep = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds)!
        canvas.cacheDisplay(in: canvas.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "out/\(name).png"))
    }
    func layer(_ id: String) -> Layer { c.project.layer(id)! }

    // Marquee around a, b and c; ⌘ keeps snapping (and the trackpad tap) off in this harness.
    drag(CGPoint(x: 100, y: 180), CGPoint(x: 600, y: 850), flags: [.command])
    check(Set(c.selectedLayerIDs) == ["a", "b", "c"], "marquee selects touched layers with their groups")
    undo.beginUndoGrouping()
    canvas.mouseDown(with: event(.leftMouseDown, CGPoint(x: 100, y: 180)))
    canvas.mouseDragged(with: event(.leftMouseDragged, CGPoint(x: 900, y: 1100), flags: [.command]))
    snapshot("1-marquee")
    canvas.mouseUp(with: event(.leftMouseUp, CGPoint(x: 900, y: 1100)))
    undo.endUndoGrouping()
    check(Set(c.selectedLayerIDs) == ["a", "b", "c", "d"], "marquee to the corner takes all four")
    snapshot("2-selected")

    // Move the selection by dragging one member.
    let before = (layer("a").x, layer("d").y)
    drag(CGPoint(x: 290, y: 370), CGPoint(x: 330, y: 330), flags: [.command])
    check(abs(layer("a").x - before.0 - 40) < 0.01 && abs(layer("d").y - before.1 + 40) < 0.01, "drag moves every selected layer")
    undo.undo()
    check(abs(layer("a").x - before.0) < 0.01, "one undo step for the move")

    // Group scale from the bottom-right handle (corners keep proportions).
    let box = canvas.selectionBox(c)!.rect
    let from = Geometry.unionBounds(of: c.selectedLayers)!
    drag(CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.maxX - 140, y: box.maxY - 140), flags: [.command])
    let to = Geometry.unionBounds(of: c.selectedLayers)!
    check(to.width < from.width && abs(to.width / to.height - from.width / from.height) < 0.01, "group scale keeps proportions")
    check(abs(to.minX - from.minX) < 0.5 && abs(to.minY - from.minY) < 0.5, "group scale anchors the opposite corner")
    snapshot("3-scaled")
    undo.undo()

    // Group rotate around the box center.
    let box2 = canvas.selectionBox(c)!.rect
    let handle = canvas.modelPoint(CGPoint(x: canvas.viewRect(box2).midX, y: canvas.viewRect(box2).minY - 24))
    drag(handle, CGPoint(x: box2.maxX + 200, y: box2.midY - 300), flags: [.command])
    check(abs(layer("a").rotation) > 5 && abs(layer("a").rotation - layer("c").rotation) < 0.01, "group rotation turns every layer equally")
    snapshot("4-rotated")
    undo.undo()

    // Click (no drag) on one member of a larger selection narrows to its group.
    undo.beginUndoGrouping()
    canvas.mouseDown(with: event(.leftMouseDown, CGPoint(x: 700, y: 950)))
    canvas.mouseUp(with: event(.leftMouseUp, CGPoint(x: 700, y: 950)))
    undo.endUndoGrouping()
    check(c.selectedLayerIDs == ["d"], "plain click narrows")

    // Option-drag duplicates the selection in place and moves the copies.
    c.selectLayers(["a", "b"])
    let count = c.project.slides[0].layers.count
    drag(CGPoint(x: 290, y: 370), CGPoint(x: 290, y: 470), flags: [.command, .option])
    check(c.project.slides[0].layers.count == count + 2 && layer("a").y == 220, "option-drag leaves originals")
    check(c.selectedLayers.allSatisfy { $0.groupID != nil && $0.groupID != "g" }, "copies form their own group")
    undo.undo()
    check(c.project.slides[0].layers.count == count, "duplicate-drag is one undo step")
    print("PASS canvas gestures")

    // Inspector and layer list, rendered offscreen.
    c.selectLayers(["a", "b", "c"])
    for (name, tab) in [("5-inspector", InspectorTab.design), ("6-layers", InspectorTab.layers)] {
        c.inspectorTab = tab
        let host = NSHostingView(rootView: InspectorView(controller: c).frame(width: 300, height: 760).background(Color(nsColor: .windowBackgroundColor)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 760), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.4))
        let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
        host.cacheDisplay(in: host.bounds, to: rep)
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "out/\(name).png"))
        window.contentView = nil
    }
    // Background panel, one render per mode.
    func render<V: View>(_ view: V, _ name: String, size: CGSize) {
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height).background(Color(nsColor: .windowBackgroundColor)))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.6))
        let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "out/\(name).png"))
        window.contentView = nil
    }
    // A generated landscape photo, imported like a real one.
    let w = 1600, h = 1000
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let colors = [CGColor(srgbRed: 0.2, green: 0.6, blue: 0.95, alpha: 1), CGColor(srgbRed: 0.98, green: 0.6, blue: 0.4, alpha: 1)] as CFArray
    ctx.drawLinearGradient(CGGradient(colorsSpace: nil, colors: colors, locations: [0, 1])!, start: .zero, end: CGPoint(x: 0, y: h), options: [])
    ctx.setFillColor(CGColor(srgbRed: 1, green: 0.95, blue: 0.5, alpha: 1)); ctx.fillEllipse(in: CGRect(x: 1050, y: 560, width: 260, height: 260))
    ctx.setFillColor(CGColor(srgbRed: 0.2, green: 0.25, blue: 0.3, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: 300))
    let png = NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
    var imported: MediaAsset?
    Task { imported = try? await MediaImporter.importData(png, type: .png, name: "Beach.png", into: document.media) }
    while imported == nil { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
    document.perform("Add asset", undoManager: nil) { $0.assets.append(imported!) }
    c.selectSlide("s1")
    c.undoManager = nil
    c.setBackground(.solid("#fde68a")); render(BackgroundPanel(controller: c), "7-bg-color", size: CGSize(width: 276, height: 560))
    c.setBackground(.gradient(BackgroundPanel.gradientPresets[6])); render(BackgroundPanel(controller: c), "8-bg-gradient", size: CGSize(width: 276, height: 620))
    c.setBackground(.image(BackgroundImage(assetID: imported!.id, blur: 40, dim: 0.2))); render(BackgroundPanel(controller: c), "9-bg-photo", size: CGSize(width: 276, height: 620))
    c.setBackground(.transparent); render(BackgroundPanel(controller: c), "10-bg-none", size: CGSize(width: 276, height: 380))
    render(MediaPanel(controller: c), "12-media", size: CGSize(width: 300, height: 400))

    // Command palette must act on exactly the same selection as keyboard and menus.
    c.selectLayers(["a", "b", "c"])
    let palette = c.paletteCommands()
    check(palette.first { $0.id == "group" }?.isEnabled == true, "palette offers grouping")
    check(palette.first { $0.id == "rename" }?.isEnabled == false, "palette blocks renaming a multi-selection")
    let originalCount = c.project.slides[0].layers.count
    palette.first { $0.id == "duplicate" }!.run()
    check(c.project.slides[0].layers.count == originalCount + 3, "palette duplicates the entire selection")
    check(c.selectedLayerIDs.count == 3, "palette selects every duplicate")
    c.paletteCommands().first { $0.id == "lock" }!.run()
    check(c.selectedLayers.allSatisfy(\.locked), "palette locks every selected layer")
    c.paletteCommands().first { $0.id == "lock" }!.run()
    check(c.selectedLayers.allSatisfy { !$0.locked }, "palette unlocks every selected layer")
    c.paletteCommands().first { $0.id == "delete" }!.run()
    check(c.project.slides[0].layers.count == originalCount, "palette deletes every selected copy")

    // Every preview mode, including the minimum window size, renders without showing a window.
    c.setBackground(.image(BackgroundImage(assetID: imported!.id, blur: 16, dim: 0.1)))
    let preview = PhonePreviewState()
    render(PhonePreviewView(controller: c, state: preview), "13-preview-feed", size: CGSize(width: 820, height: 940))
    render(PhonePreviewView(controller: c, state: preview), "14-preview-compact", size: CGSize(width: 420, height: 620))
    preview.index = 1
    render(PhonePreviewView(controller: c, state: preview), "15-preview-second-slide", size: CGSize(width: 820, height: 940))
    preview.mode = .grid
    render(PhonePreviewView(controller: c, state: preview), "16-preview-grid", size: CGSize(width: 1000, height: 940))
    preview.mode = .feed
    preview.isFullScreen = true
    render(PhonePreviewView(controller: c, state: preview), "17-preview-fullscreen", size: CGSize(width: 1440, height: 900))
    document.perform("Story format", undoManager: nil) { $0.format = .presets[2] }
    preview.index = 0
    preview.isFullScreen = false
    render(PhonePreviewView(controller: c, state: preview), "18-preview-story", size: CGSize(width: 820, height: 940))

    func awaitResult<T>(_ operation: @escaping @MainActor () async throws -> T) throws -> T {
        var result: Result<T, Error>?
        Task { @MainActor in
            do { result = .success(try await operation()) }
            catch { result = .failure(error) }
        }
        let deadline = Date().addingTimeInterval(30)
        while result == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        guard let result else { fatalError("Async check timed out") }
        return try result.get()
    }

    // Drag-out is a frozen slide snapshot with full resolution, alpha, and cross-slide layers.
    let dragDocument = ProjectDocument(format: CanvasFormat(name: "Fixture", width: 80, height: 100))
    dragDocument.perform("Fixture", undoManager: nil) { p in
        p.slides = [Slide(id: "left", background: .transparent, layers: [
            shape("spanning", 60, 10, 40, 30, fill: "#0000ff")
        ]), Slide(id: "right", background: .transparent, layers: [])]
    }
    let dragItem = SlideDragItem(id: "right", project: dragDocument.project, media: dragDocument.media, name: "Snapshot")
    dragDocument.perform("Later edit", undoManager: nil) { $0.slides[1].background = .solid("#ff0000") }
    let pngURL = try awaitResult { try await dragItem.renderPNG() }
    let bitmap = NSBitmapImageRep(data: try Data(contentsOf: pngURL))!
    check(bitmap.pixelsWide == 80 && bitmap.pixelsHigh == 100, "drag export uses project resolution")
    check(pngURL.lastPathComponent == "Snapshot-02.png", "drag filename preserves posting order")
    check(bitmap.colorAt(x: 40, y: 80)!.alphaComponent < 0.01, "drag preserves alpha and ignores later edits")
    let blue = bitmap.colorAt(x: 10, y: 20)!.usingColorSpace(.deviceRGB)!
    check(blue.blueComponent > 0.9 && blue.redComponent < 0.1 && blue.alphaComponent > 0.9, "drag includes layers crossing the slide seam")

    // Exercise Core Transferable's real file provider, rather than only its render helper.
    let provider = NSItemProvider()
    provider.register(dragItem)
    check(provider.hasItemConformingToTypeIdentifier(UTType.png.identifier), "native drag provider offers PNG")
    let deliveryLock = NSLock()
    var delivered: Result<URL, Error>?
    provider.loadFileRepresentation(forTypeIdentifier: UTType.png.identifier) { url, error in
        let result: Result<URL, Error>
        do {
            guard let url else { throw error ?? ExportError.renderFailed }
            let copy = URL(fileURLWithPath: "out/19-provider-delivery.png")
            try Data(contentsOf: url).write(to: copy, options: .atomic)
            result = .success(copy)
        } catch { result = .failure(error) }
        deliveryLock.withLock { delivered = result }
    }
    let deliveryDeadline = Date().addingTimeInterval(30)
    while deliveryLock.withLock({ delivered == nil }) && Date() < deliveryDeadline {
        RunLoop.main.run(until: Date().addingTimeInterval(0.01))
    }
    guard let delivery = deliveryLock.withLock({ delivered }) else { fatalError("PNG provider timed out") }
    let received = NSBitmapImageRep(data: try Data(contentsOf: delivery.get()))!
    check(received.pixelsWide == 80 && received.colorAt(x: 40, y: 80)!.alphaComponent < 0.01, "native provider delivers the complete transparent PNG")

    // Photo grids: free slots stay free, linked spacing is clamped per template.
    let gridDoc = ProjectDocument(format: CanvasFormat(name: "Landscape", width: 1080, height: 566))
    gridDoc.perform("Fixture", undoManager: nil) { p in p.slides = [Slide(id: "g1", background: .solid("#ffffff"), layers: [])] }
    let gc = EditorController(document: gridDoc)
    gc.selectedSlideID = "g1"
    let fourGrid = GridTemplate.template(id: "four-grid")!, fourStack = GridTemplate.template(id: "four-stack")!
    gc.applyGrid(fourGrid, gap: 0, margin: 0)
    let slots = gc.project.slides[0].grid!.slotIds
    let target = fourGrid.layout(format: gc.project.format, gap: 40, margin: 0)[1]
    gc.updateLayer(slots[1]) { $0.x = 123; $0.width = 200 }
    gc.setSlideGrid(gap: 20)
    gc.updateLayer(slots[1]) { $0.x = target.minX; $0.y = target.minY; $0.width = target.width; $0.height = target.height }
    gc.setSlideGrid(gap: 40)
    gc.setSlideGrid(gap: 60)
    let kept = gc.project.slides[0].layers.first { $0.id == slots[1] }!
    check(kept.matches(target), "a hand-resized slot stays put when a later spacing matches its frame")
    check(gc.project.liveGrid(slide: 0)?.movedSlots == 1, "the free slot still counts as moved by hand")
    gc.duplicateSlide("g1")
    let copyGrid = gc.project.slides[1].grid!
    check(copyGrid.detachedSlotIds?.count == 1 && copyGrid.detachedSlotIds?.first.map { !slots.contains($0) } == true, "duplicating a slide re-ids the free slots")
    gc.selectedSlideID = "g1"
    gc.gridLinked = true; gc.gridGap = 120; gc.gridMargin = 120
    gc.applyGrid(fourStack)
    let linkedLimit = fourStack.linkedMax(format: gc.project.format)
    check(linkedLimit == 100 && gc.project.slides[0].grid!.gap == 100 && gc.project.slides[0].grid!.margin == 100, "linked spacing is clamped to what the template fits")

    // Re-attach: a freed slot reset by hand stays free until re-attached, then follows again.
    let rDoc = ProjectDocument(format: CanvasFormat(name: "P", width: 1080, height: 1350))
    rDoc.perform("Fixture", undoManager: nil) { p in p.slides = [Slide(id: "r1", background: .solid("#ffffff"), layers: [])] }
    let rc = EditorController(document: rDoc); rc.selectedSlideID = "r1"
    rc.applyGrid(fourGrid, gap: 0, margin: 0)
    let rs = rc.project.slides[0].grid!.slotIds
    let flush = fourGrid.layout(format: rc.project.format, gap: 0, margin: 0)[1]
    rc.updateLayer(rs[1]) { $0.width = 300 }
    rc.setSlideGrid(gap: 20)
    rc.setSlideGrid(gap: 0)
    rc.updateLayer(rs[1]) { $0.x = flush.minX; $0.y = flush.minY; $0.width = flush.width; $0.height = flush.height }
    rc.setSlideGrid(gap: 30)
    check(rc.project.slides[0].layers.first { $0.id == rs[1] }!.matches(flush), "a reset slot stays free until re-attached")
    rc.reattachGridSlots()
    check(rc.project.liveGrid(slide: 0)?.movedSlots == 0 && rc.project.slides[0].grid!.detachedSlotIds == nil, "re-attach clears free slots")
    rc.setSlideGrid(gap: 40)
    check(rc.project.slides[0].layers.first { $0.id == rs[1] }!.matches(fourGrid.layout(format: rc.project.format, gap: 40, margin: 0)[1]), "a re-attached slot follows the grid again")

    // Linking switched on after grids exist snaps every grid slide to equal, fitting values.
    let lDoc = ProjectDocument(format: CanvasFormat(name: "Landscape", width: 1080, height: 566))
    lDoc.perform("Fixture", undoManager: nil) { p in p.slides = [Slide(id: "l1", background: .solid("#ffffff"), layers: []), Slide(id: "l2", background: .solid("#ffffff"), layers: [])] }
    let lc = EditorController(document: lDoc)
    lc.selectedSlideID = "l1"; lc.applyGrid(fourStack, gap: 120, margin: 0)
    lc.selectedSlideID = "l2"; lc.applyGrid(fourGrid, gap: 30, margin: 10)
    lc.linkGridSpacing()
    let g1 = lc.project.slides[0].grid!, g2 = lc.project.slides[1].grid!
    check(g1.gap == 100 && g1.margin == 100, "linking caps an existing grid to what its template fits")
    check(g2.gap == 30 && g2.margin == 30, "linking snaps another slide's margin to its gap")
    let stackCells = fourStack.layout(format: lc.project.format, gap: 100, margin: 100)
    check(lc.project.slides[0].layers.first { $0.id == g1.slotIds[0] }!.matches(stackCells[0]), "linking relays out the slots")
    let linkedState = lc.project
    lc.linkGridSpacing()
    check(lc.project == linkedState, "linking again changes nothing")

    print("ALL \(checks) UI CHECKS PASSED")
}
setbuf(stdout, nil)
try MainActor.assumeIsolated { try run() }
