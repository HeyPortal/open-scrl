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

/// A gap between two neighbouring boxes that equals another gap on the slide. A `.horizontal`
/// gap runs from `start` to `end` along x and is drawn at y = `position`; a `.vertical` one
/// runs along y and is drawn at x = `position`. Slide-local coordinates.
struct GapMarker: Hashable {
    enum Axis { case horizontal, vertical }
    var axis: Axis
    var start: Double
    var end: Double
    var position: Double
    var size: Double { end - start }
}

struct SnapResult {
    var origin: CGPoint
    var guides: [SnapGuide]
    var gaps: [GapMarker] = []
}

/// The outcome of snapping one edge while resizing. `value` is nil when the edge didn't snap;
/// `gaps` still lists equal gaps at the edge's final position.
struct EdgeSnap {
    var value: Double?
    var guide: SnapGuide?
    var gaps: [GapMarker]
}

/// Port of the web app's `snapBox`: aligns the moving box's edges and center to the slide
/// and to other unrotated, visible layers on the same slide, and matches equal gaps between
/// neighbouring layers (`src/lib/snap.ts`; keep the two in step).
enum Snapping {
    private struct Target { var value: Double; var from: CGRect }

    private static func lines(_ r: CGRect) -> (v: [Double], h: [Double]) {
        ([r.minX, r.midX, r.maxX], [r.minY, r.midY, r.maxY])
    }

    private static func isTarget(_ layer: Layer) -> Bool {
        layer.visible && layer.rotation.truncatingRemainder(dividingBy: 360) == 0
    }

    static func targets(slide: CGSize, others: [Layer]) -> (v: [(Double, CGRect)], h: [(Double, CGRect)]) {
        var v: [(Double, CGRect)] = [], h: [(Double, CGRect)] = []
        let canvas = CGRect(origin: .zero, size: slide)
        let cl = lines(canvas)
        cl.v.forEach { v.append(($0, canvas)) }
        cl.h.forEach { h.append(($0, canvas)) }
        for layer in others where isTarget(layer) {
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

        // Equal spacing competes with alignment on each axis; the nearer snap wins, and alignment wins ties.
        let boxes = gapBoxes(slide: slide, others: others)
        let cross = clip(moving, to: slide)
        let spansX = boxes.map { span($0, .horizontal) }, spansY = boxes.map { span($0, .vertical) }
        let gapsX = slideGaps(spansX), gapsY = slideGaps(spansY)
        let gapX = cross.flatMap { bestGapSnap(span(moving, .horizontal, cross: $0), spansX, gapsX, edge: nil, threshold: threshold) }
        let gapY = cross.flatMap { bestGapSnap(span(moving, .vertical, cross: $0), spansY, gapsY, edge: nil, threshold: threshold) }
        let alignX = bx.distance <= threshold && bx.from != nil, alignY = by.distance <= threshold && by.from != nil
        var dx = alignX ? bx.delta : 0, dy = alignY ? by.delta : 0
        if let gapX, !alignX || abs(gapX) < bx.distance - 1e-9 { dx = gapX }
        if let gapY, !alignY || abs(gapY) < by.distance - 1e-9 { dy = gapY }

        var origin = moving.origin
        origin.x += dx
        origin.y += dy
        var guides: [SnapGuide] = []
        // An alignment line still shows when the equal-gap position satisfies it too.
        if alignX, abs(bx.delta - dx) < 1e-6, let from = bx.from {
            let top = moving.minY + dy
            guides.append(SnapGuide(orientation: .vertical, position: bx.axis + bx.delta,
                                    start: min(top, from.minY), end: max(top + moving.height, from.maxY)))
        }
        if alignY, abs(by.delta - dy) < 1e-6, let from = by.from {
            guides.append(SnapGuide(orientation: .horizontal, position: by.axis + by.delta,
                                    start: min(origin.x, from.minX), end: max(origin.x + moving.width, from.maxX)))
        }

        // Markers describe the final box, whichever snap produced it.
        var gaps: [GapMarker] = []
        let settled = CGRect(origin: origin, size: moving.size)
        if let settledCross = clip(settled, to: slide) {
            gaps += equalGaps(span(settled, .horizontal, cross: settledCross), spansX, gapsX).map { $0.marker(.horizontal) }
            gaps += equalGaps(span(settled, .vertical, cross: settledCross), spansY, gapsY).map { $0.marker(.vertical) }
        }
        return SnapResult(origin: origin, guides: guides, gaps: gaps)
    }

    /// Snaps a single edge coordinate while resizing, keeping the opposite edge at `fixed`.
    /// `span` is the box's extent across the edge. The edge aligns to guides or makes one of
    /// the box's gaps equal another gap on the slide, whichever is nearer.
    static func snapEdge(_ value: Double, fixed: Double, orientation: SnapGuide.Orientation, span cross: ClosedRange<Double>,
                         slide: CGSize, others: [Layer], threshold: Double) -> EdgeSnap {
        let t = targets(slide: slide, others: others)
        let candidates = orientation == .vertical ? t.v : t.h
        var bestDistance = Double.infinity
        var best: (Double, CGRect)?
        for c in candidates where abs(c.0 - value) < bestDistance {
            bestDistance = abs(c.0 - value)
            best = c
        }
        let align = bestDistance <= threshold ? best : nil

        // A vertical edge moves along x, so its gaps are horizontal.
        let axis: GapMarker.Axis = orientation == .vertical ? .horizontal : .vertical
        let edge: Edge = value >= fixed ? .end : .start
        let limit = orientation == .vertical ? slide.height : slide.width
        let c0 = max(0, cross.lowerBound), c1 = min(limit, cross.upperBound)
        let boxes = gapBoxes(slide: slide, others: others)
        let spans = boxes.map { span($0, axis) }
        let gaps = slideGaps(spans)
        func moving(_ edgeValue: Double) -> Span? {
            let a0 = min(edgeValue, fixed), a1 = max(edgeValue, fixed)
            let along = orientation == .vertical ? slide.width : slide.height
            guard c1 > c0, a1 > a0, a1 > 0, a0 < along else { return nil }
            return Span(a0: a0, a1: a1, c0: c0, c1: c1)
        }
        let gap = moving(value).flatMap { bestGapSnap($0, spans, gaps, edge: edge, threshold: threshold) }

        var snapped: Double?
        var guide: SnapGuide?
        if let gap, align.map({ abs(gap) < abs($0.0 - value) - 1e-9 }) ?? true {
            snapped = value + gap
        } else if let align {
            snapped = align.0
        }
        if let align, let snapped, abs(align.0 - snapped) < 1e-6 {
            let from = align.1
            guide = orientation == .vertical
                ? SnapGuide(orientation: .vertical, position: align.0, start: min(cross.lowerBound, from.minY), end: max(cross.upperBound, from.maxY))
                : SnapGuide(orientation: .horizontal, position: align.0, start: min(cross.lowerBound, from.minX), end: max(cross.upperBound, from.maxX))
        }
        let markers = moving(snapped ?? value).map { equalGaps($0, spans, gaps).map { $0.marker(axis) } } ?? []
        return EdgeSnap(value: snapped, guide: guide, gaps: markers)
    }

    // MARK: Equal spacing

    /// Gaps within half a point count as equal; anything under a point is touching, not a gap.
    private static let equalEpsilon = 0.5
    private static let minGap = 1.0

    private enum Edge { case start, end }

    /// A box seen along one axis: `a0...a1` along it, `c0...c1` across it.
    private struct Span { var a0, a1, c0, c1: Double }

    private struct Gap: Hashable {
        var start, end, position, c0, c1: Double
        var size: Double { end - start }
        func marker(_ axis: GapMarker.Axis) -> GapMarker { GapMarker(axis: axis, start: start, end: end, position: position) }
    }

    /// Only the part of a box on the slide counts, so a layer over a seam is measured by its on-slide portion.
    private static func clip(_ r: CGRect, to slide: CGSize) -> CGRect? {
        let c = r.intersection(CGRect(origin: .zero, size: slide))
        return c.isNull || c.width <= 0 || c.height <= 0 ? nil : c
    }

    private static func gapBoxes(slide: CGSize, others: [Layer]) -> [CGRect] {
        others.filter(isTarget).compactMap { clip($0.frame, to: slide) }
    }

    /// `cross` supplies the across-axis extent, which for the moving box is its on-slide part.
    private static func span(_ r: CGRect, _ axis: GapMarker.Axis, cross: CGRect? = nil) -> Span {
        let c = cross ?? r
        return axis == .horizontal
            ? Span(a0: r.minX, a1: r.maxX, c0: c.minY, c1: c.maxY)
            : Span(a0: r.minY, a1: r.maxY, c0: c.minX, c1: c.maxX)
    }

    private static func crossOverlap(_ a: Span, _ b: Span) -> Double { min(a.c1, b.c1) - max(a.c0, b.c0) }

    /// Gaps between neighbouring boxes: they overlap across the axis and nothing sits between them.
    private static func slideGaps(_ spans: [Span]) -> [Gap] {
        var gaps: [Gap] = []
        for (i, a) in spans.enumerated() {
            for (j, b) in spans.enumerated() where i != j && b.a0 - a.a1 >= minGap {
                let c0 = max(a.c0, b.c0), c1 = min(a.c1, b.c1)
                guard c1 > c0 else { continue }
                let blocked = spans.indices.contains { k in
                    k != i && k != j && spans[k].a1 > a.a1 && spans[k].a0 < b.a0 && spans[k].c1 > c0 && spans[k].c0 < c1
                }
                if !blocked { gaps.append(Gap(start: a.a1, end: b.a0, position: (c0 + c1) / 2, c0: c0, c1: c1)) }
            }
        }
        return gaps
    }

    /// The moving box's own gaps to its nearest neighbours before and after it on this axis.
    private static func ownGaps(_ m: Span, _ spans: [Span]) -> [Gap] {
        var before: Span?, after: Span?
        for s in spans where crossOverlap(s, m) > 0 {
            if s.a1 <= m.a0 + equalEpsilon, before.map({ s.a1 > $0.a1 }) ?? true { before = s }
            if s.a0 >= m.a1 - equalEpsilon, after.map({ s.a0 < $0.a0 }) ?? true { after = s }
        }
        func gap(_ lo: Double, _ hi: Double, _ s: Span) -> Gap {
            let c0 = max(s.c0, m.c0), c1 = min(s.c1, m.c1)
            return Gap(start: lo, end: hi, position: (c0 + c1) / 2, c0: c0, c1: c1)
        }
        var own: [Gap] = []
        if let before, m.a0 - before.a1 >= minGap { own.append(gap(before.a1, m.a0, before)) }
        if let after, after.a0 - m.a1 >= minGap { own.append(gap(m.a1, after.a0, after)) }
        return own
    }

    /// The moving box's gaps that equal another gap, plus every gap they equal. Empty when nothing matches.
    private static func equalGaps(_ m: Span, _ spans: [Span], _ slide: [Gap]) -> [Gap] {
        let own = ownGaps(m, spans)
        guard !own.isEmpty else { return [] }
        // A gap the moving box now sits inside no longer exists on the slide.
        let existing = slide.filter { !(m.a1 > $0.start && m.a0 < $0.end && m.c1 > $0.c0 && m.c0 < $0.c1) }
        var out: [Gap] = []
        func add(_ g: Gap) { if !out.contains(g) { out.append(g) } }
        for (i, o) in own.enumerated() {
            let twins = own.enumerated().filter { $0.offset != i && abs($0.element.size - o.size) <= equalEpsilon }.map(\.element)
            let same = twins + existing.filter { abs($0.size - o.size) <= equalEpsilon }
            guard !same.isEmpty else { continue }
            add(o)
            same.forEach(add)
        }
        return out
    }

    /// The smallest move (within threshold) that makes one of the moving box's gaps equal another
    /// gap on the slide, including centring it between two neighbours. `edge` limits the move to
    /// one side while resizing.
    private static func bestGapSnap(_ m: Span, _ spans: [Span], _ slide: [Gap], edge: Edge?, threshold: Double) -> Double? {
        let neighbours = spans.filter { crossOverlap($0, m) > 0 }
        guard !neighbours.isEmpty else { return nil }
        var sizes = slide.map(\.size)
        // While resizing, the side that stays put offers its own gap to match on the other side.
        if let edge {
            sizes += ownGaps(m, spans).filter { edge == .end ? $0.end <= m.a0 + equalEpsilon : $0.start >= m.a1 - equalEpsilon }.map(\.size)
        }
        let values = Array(Set(sizes))
        let width = m.a1 - m.a0
        var deltas: [Double] = []
        for n in neighbours {
            for g in values {
                if edge != .end { deltas.append(n.a1 + g - m.a0) } // the gap after `n` equals g
                if edge != .start { deltas.append(n.a0 - g - m.a1) } // the gap before `n` equals g
            }
            guard edge == nil else { continue }
            // Centred between n and a neighbour after it: both gaps become equal.
            for r in neighbours where r.a0 - n.a1 - width >= 2 * minGap { deltas.append((n.a1 + r.a0 - width) / 2 - m.a0) }
        }
        // Nearest first; a candidate counts only if the moved box really has an equal gap there.
        for d in deltas.filter({ abs($0) <= threshold }).sorted(by: { abs($0) < abs($1) }) {
            var moved = m
            switch edge {
            case .end: moved.a1 += d
            case .start: moved.a0 += d
            case nil: moved.a0 += d; moved.a1 += d
            }
            if moved.a1 > moved.a0 && !equalGaps(moved, spans, slide).isEmpty { return d }
        }
        return nil
    }

    /// Seams (global x positions between slides) crossed by `bounds`.
    static func crossedSeams(_ bounds: CGRect, slideWidth: Double, slideCount: Int) -> [Double] {
        guard slideWidth > 0, slideCount > 1 else { return [] }
        return (1..<slideCount).map { Double($0) * slideWidth }.filter { bounds.minX < $0 && bounds.maxX > $0 }
    }
}
