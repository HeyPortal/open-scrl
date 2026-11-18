import AppKit

/// Pure checks for equal-spacing snapping. They mirror the web cases in `src/lib/snap.test.ts`.
@MainActor
func runSnappingChecks() -> Int {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: snapping: \(name)") }
        checks += 1
    }
    let slide = CGSize(width: 1000, height: 1000)
    func at(_ id: String, _ x: Double, _ w: Double = 100, _ y: Double = 100, _ h: Double = 100) -> Layer {
        Layer(id: id, name: id, x: x, y: y, width: w, height: h,
              content: .shape(ShapeProperties(shape: .rect, fill: "#000000", cornerRadius: 0)))
    }
    func snap(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ others: [Layer]) -> SnapResult {
        Snapping.snap(moving: CGRect(x: x, y: y, width: w, height: h), slide: slide, others: others, threshold: 6)
    }
    func sizes(_ gaps: [GapMarker]) -> [Double] { gaps.map(\.size).sorted() }

    var r = snap(296, 120, 100, 100, [at("a", 0), at("b", 150)])
    check(r.origin.x == 300, "snaps a gap to match another gap")
    check(r.gaps.count == 2 && r.gaps.allSatisfy { $0.axis == .horizontal }, "marks both gaps")
    check(r.gaps.map { [$0.start, $0.end] }.sorted { $0[0] < $1[0] } == [[100, 150], [250, 300]], "marks the right spans")

    r = snap(504, 100, 100, 100, [at("a", 0), at("b", 150), at("c", 650)])
    check(r.origin.x == 500 && sizes(r.gaps) == [50, 50], "matches a gap before a right-hand neighbour")

    r = snap(203, 100, 100, 100, [at("a", 0), at("b", 400)])
    check(r.origin.x == 200 && sizes(r.gaps) == [100, 100], "centres between two neighbours")

    r = snap(362, 100, 80, 100, [at("a", 0, 80), at("b", 120, 80), at("c", 240, 80)])
    check(r.origin.x == 360 && sizes(r.gaps) == [40, 40, 40], "marks every equal gap")

    r = snap(100, 303, 100, 100, [at("a", 100, 100, 0), at("b", 100, 100, 150)])
    check(r.origin.y == 300 && r.gaps.count == 2 && r.gaps.allSatisfy { $0.axis == .vertical }, "snaps vertical gaps")

    check(snap(290, 100, 100, 100, [at("a", 0), at("b", 150)]).gaps.isEmpty, "ignores gaps outside the threshold")
    r = snap(296, 600, 100, 100, [at("a", 0, 100, 600), at("b", 150, 100, 100)])
    check(r.origin.x == 296 && r.gaps.isEmpty, "ignores layers that don't face each other")

    r = snap(296, 400, 100, 100, [at("a", 0), at("b", 150), at("c", 298, 100, 600)])
    check(r.origin.x == 298 && r.gaps.isEmpty, "prefers a closer alignment snap")
    check(r.guides.contains { $0.orientation == .vertical && $0.position == 298 }, "keeps the alignment guide")

    r = snap(157, 100, 100, 100, [at("a", 0, 100, 100), at("b", 0, 100, 500), at("c", 160, 100, 500)])
    let across = r.gaps.filter { $0.axis == .horizontal }
    check(r.origin.x == 160 && sizes(across) == [60, 60], "matches a gap from another row")
    check(across.map(\.position).sorted() == [150, 550], "draws each gap in its own row")
    check(sizes(r.gaps.filter { $0.axis == .vertical }) == [300, 300], "marks equal vertical stacking")

    check(snap(196, 100, 100, 100, [at("a", 0), at("b", 1050), at("c", 1250)]).origin.x == 196, "ignores gaps off the slide")
    r = snap(803, 100, 100, 100, [at("a", 0), at("b", 150), at("d", 950, 200)])
    check(r.origin.x == 800 && sizes(r.gaps) == [50, 50], "measures a seam-spanning layer by its on-slide part")

    var e = Snapping.snapEdge(447, fixed: 300, orientation: .vertical, span: 100...200, slide: slide,
                              others: [at("a", 0), at("b", 150), at("c", 500)], threshold: 6)
    check(e.value == 450 && e.gaps.count >= 2, "resizes an edge to match a gap")
    e = Snapping.snapEdge(402, fixed: 300, orientation: .vertical, span: 100...200, slide: slide,
                          others: [at("a", 150), at("c", 450)], threshold: 6)
    check(e.value == 400 && sizes(e.gaps) == [50, 50], "resizes an edge to centre between neighbours")
    e = Snapping.snapEdge(380, fixed: 300, orientation: .vertical, span: 100...200, slide: slide,
                          others: [at("a", 150), at("c", 450)], threshold: 6)
    check(e.value == nil && e.gaps.isEmpty, "leaves an edge alone away from any snap")
    return checks
}

/// Drives a real offscreen CanvasView: a drag near an equal gap snaps, shows markers while
/// it holds, and clears them on release.
@MainActor
func runGapMarkerCanvasChecks() -> Int {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: gap markers: \(name)") }
        checks += 1
    }
    func box(_ id: String, _ x: Double, _ fill: String) -> Layer {
        Layer(id: id, name: id, x: x, y: 500, width: 200, height: 200,
              content: .shape(ShapeProperties(shape: .rect, fill: fill, cornerRadius: 0)))
    }
    // The app registers this default at launch; the harness doesn't, so snapping starts off.
    UserDefaults.standard.register(defaults: [Preferences.Key.snapping: true])
    let document = ProjectDocument(format: .default)
    document.perform("Fixture", undoManager: nil) { p in
        p.slides = [Slide(id: "s1", background: .solid("#f5f0e8"), layers: [
            box("a", 60, "#4f46e5"), box("b", 360, "#0ea5e9"), box("m", 640, "#f97316"),
        ])]
    }
    let c = EditorController(document: document)
    let undo = UndoManager(); undo.groupsByEvent = false; c.undoManager = undo
    let canvas = CanvasView(frame: NSRect(x: 0, y: 0, width: 1100, height: 1000))
    canvas.controller = c
    c.selectSlide("s1")
    canvas.layout()
    c.pickLayer("m", additive: false)
    func event(_ type: NSEvent.EventType, _ m: CGPoint) -> NSEvent {
        NSEvent.mouseEvent(with: type, location: canvas.convert(canvas.viewPoint(m), to: nil), modifierFlags: [], timestamp: 0,
                           windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
    }
    // a–b is 100px apart and m starts 80px after b; moving m 17px right lands 3px short of 100.
    let from = CGPoint(x: 740, y: 600), to = CGPoint(x: 757, y: 600)
    undo.beginUndoGrouping()
    canvas.mouseDown(with: event(.leftMouseDown, from))
    for t in stride(from: 0.1, through: 1.0, by: 0.1) {
        canvas.mouseDragged(with: event(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y)))
    }
    check(canvas.gapMarkers.map(\.size).sorted() == [100, 100], "markers show both equal gaps mid-drag")
    let rep = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds)!
    canvas.cacheDisplay(in: canvas.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "out/gap-markers.png"))
    canvas.mouseUp(with: event(.leftMouseUp, to))
    undo.endUndoGrouping()
    check(abs(c.project.layer("m")!.x - 660) < 0.01, "the drag lands on the equal gap")
    check(canvas.gapMarkers.isEmpty, "markers clear on release")
    UserDefaults.standard.register(defaults: [Preferences.Key.snapping: false])
    print("PASS gap markers on the canvas")
    return checks
}
