import Foundation
import CoreGraphics

struct SnapGuide: Hashable {
    enum Orientation { case vertical, horizontal }
    var orientation: Orientation
    /// Slide-local coordinate of the guide line.
    var position: Double
    var start: Double
    var end: Double
}

struct SnapResult {
    var origin: CGPoint
    var guides: [SnapGuide]
}

/// Port of the web app's `snapBox`: aligns the moving box's edges and center to the slide
/// and to other unrotated, visible layers on the same slide.
enum Snapping {
    private struct Target { var value: Double; var from: CGRect }

    private static func lines(_ r: CGRect) -> (v: [Double], h: [Double]) {
        ([r.minX, r.midX, r.maxX], [r.minY, r.midY, r.maxY])
    }

    static func targets(slide: CGSize, others: [Layer]) -> (v: [(Double, CGRect)], h: [(Double, CGRect)]) {
        var v: [(Double, CGRect)] = [], h: [(Double, CGRect)] = []
        let canvas = CGRect(origin: .zero, size: slide)
        let cl = lines(canvas)
        cl.v.forEach { v.append(($0, canvas)) }
        cl.h.forEach { h.append(($0, canvas)) }
        for layer in others where layer.visible && layer.rotation.truncatingRemainder(dividingBy: 360) == 0 {
            let l = lines(layer.frame)
            l.v.forEach { v.append(($0, layer.frame)) }
            l.h.forEach { h.append(($0, layer.frame)) }
        }
        return (v, h)
    }

    static func snap(moving: CGRect, slide: CGSize, others: [Layer], threshold: Double) -> SnapResult {
        let t = targets(slide: slide, others: others)
        let m = lines(moving)

        func best(_ targets: [(Double, CGRect)], _ moving: [Double]) -> (delta: Double, distance: Double, from: CGRect?, axis: Double) {
            var result: (Double, Double, CGRect?, Double) = (0, .infinity, nil, 0)
            for (value, from) in targets {
                for line in moving {
                    let d = value - line
                    if abs(d) < result.1 { result = (d, abs(d), from, line) }
                }
            }
            return result
        }

        let bx = best(t.v, m.v)
        let by = best(t.h, m.h)
        var origin = moving.origin
        var guides: [SnapGuide] = []
        let snapX = bx.distance <= threshold, snapY = by.distance <= threshold
        if snapX { origin.x += bx.delta }
        if snapY { origin.y += by.delta }
        if snapX, let from = bx.from {
            let top = moving.minY + (snapY ? by.delta : 0)
            guides.append(SnapGuide(orientation: .vertical, position: bx.axis + bx.delta,
                                    start: min(top, from.minY), end: max(top + moving.height, from.maxY)))
        }
        if snapY, let from = by.from {
            guides.append(SnapGuide(orientation: .horizontal, position: by.axis + by.delta,
                                    start: min(origin.x, from.minX), end: max(origin.x + moving.width, from.maxX)))
        }
        return SnapResult(origin: origin, guides: guides)
    }

    /// Snaps a single edge coordinate (used while resizing). Returns the adjusted value and a guide.
    static func snapEdge(_ value: Double, orientation: SnapGuide.Orientation, span: ClosedRange<Double>,
                         slide: CGSize, others: [Layer], threshold: Double) -> (Double, SnapGuide?) {
        let t = targets(slide: slide, others: others)
        let candidates = orientation == .vertical ? t.v : t.h
        var bestDistance = Double.infinity
        var best: (Double, CGRect)?
        for c in candidates where abs(c.0 - value) < bestDistance {
            bestDistance = abs(c.0 - value)
            best = c
        }
        guard let best, bestDistance <= threshold else { return (value, nil) }
        let from = best.1
        let guide: SnapGuide = orientation == .vertical
            ? SnapGuide(orientation: .vertical, position: best.0, start: min(span.lowerBound, from.minY), end: max(span.upperBound, from.maxY))
            : SnapGuide(orientation: .horizontal, position: best.0, start: min(span.lowerBound, from.minX), end: max(span.upperBound, from.maxX))
        return (best.0, guide)
    }

    /// Seams (global x positions between slides) crossed by `bounds`.
    static func crossedSeams(_ bounds: CGRect, slideWidth: Double, slideCount: Int) -> [Double] {
        guard slideWidth > 0, slideCount > 1 else { return [] }
        return (1..<slideCount).map { Double($0) * slideWidth }.filter { bounds.minX < $0 && bounds.maxX > $0 }
    }
}
