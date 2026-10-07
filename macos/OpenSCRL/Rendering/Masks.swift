import CoreGraphics
import Foundation

/// Outlines photos can be clipped to. The geometry matches the web app's `traceMask` point for
/// point, so masks look identical in both apps and in exports.
enum MaskGeometry {
    // Cubic Bézier circle constant.
    private static let k = 0.5522847498

    // A hand-tuned organic outline: a closed Catmull–Rom spline through points in a unit box.
    private static let blobPoints: [CGPoint] = [
        CGPoint(x: 0.52, y: 0.03), CGPoint(x: 0.83, y: 0.1), CGPoint(x: 0.98, y: 0.42), CGPoint(x: 0.9, y: 0.78),
        CGPoint(x: 0.6, y: 0.97), CGPoint(x: 0.24, y: 0.9), CGPoint(x: 0.03, y: 0.62), CGPoint(x: 0.12, y: 0.2),
    ]

    static func usesCornerRadius(_ mask: ImageMask) -> Bool {
        mask == .rect || mask == .hexagon || mask == .star
    }

    static func displayName(_ mask: ImageMask) -> String {
        switch mask {
        case .rect: "Rectangle"
        case .ellipse: "Circle"
        case .arch: "Arch"
        case .blob: "Blob"
        case .hexagon: "Hexagon"
        case .star: "Star"
        case .heart: "Heart"
        }
    }

    /// The outline of `mask` filling a box of `size` whose top-left is the origin (y-down).
    static func path(_ mask: ImageMask, size: CGSize, cornerRadius: Double = 0) -> CGPath {
        let w = size.width, h = size.height
        let path = CGMutablePath()
        switch mask {
        case .ellipse:
            ellipse(path, center: CGPoint(x: w / 2, y: h / 2), rx: w / 2, ry: h / 2)
        case .arch:
            let rx = w / 2, ry = min(w / 2, h)
            path.move(to: CGPoint(x: 0, y: h))
            path.addLine(to: CGPoint(x: 0, y: ry))
            path.addCurve(to: CGPoint(x: rx, y: 0), control1: CGPoint(x: 0, y: ry - ry * k), control2: CGPoint(x: rx - rx * k, y: 0))
            path.addCurve(to: CGPoint(x: w, y: ry), control1: CGPoint(x: rx + rx * k, y: 0), control2: CGPoint(x: w, y: ry - ry * k))
            path.addLine(to: CGPoint(x: w, y: h))
            path.closeSubpath()
        case .blob:
            blob(path, w: w, h: h)
        case .hexagon:
            roundedPolygon(path, [CGPoint(x: w * 0.25, y: 0), CGPoint(x: w * 0.75, y: 0), CGPoint(x: w, y: h / 2),
                                  CGPoint(x: w * 0.75, y: h), CGPoint(x: w * 0.25, y: h), CGPoint(x: 0, y: h / 2)], radius: cornerRadius)
        case .star:
            star(path, w: w, h: h, radius: cornerRadius)
        case .heart:
            heart(path, w: w, h: h)
        case .rect:
            roundedPolygon(path, [CGPoint(x: 0, y: 0), CGPoint(x: w, y: 0), CGPoint(x: w, y: h), CGPoint(x: 0, y: h)],
                           radius: max(0, min(cornerRadius, w / 2, h / 2)))
        }
        return path
    }

    /// A closed polygon with every corner rounded by `radius` (clamped to half the shortest edge).
    /// `addArc(tangent1End:tangent2End:radius:)` has the same semantics as canvas `arcTo`.
    private static func roundedPolygon(_ path: CGMutablePath, _ points: [CGPoint], radius: Double) {
        guard let first = points.first, let last = points.last else { return }
        if radius <= 0 {
            path.addLines(between: points)
            path.closeSubpath()
            return
        }
        var shortest = Double.infinity
        for i in points.indices {
            let a = points[i], b = points[(i + 1) % points.count]
            shortest = min(shortest, hypot(b.x - a.x, b.y - a.y))
        }
        let r = min(radius, shortest / 2)
        path.move(to: CGPoint(x: (last.x + first.x) / 2, y: (last.y + first.y) / 2))
        for i in points.indices {
            path.addArc(tangent1End: points[i], tangent2End: points[(i + 1) % points.count], radius: r)
        }
        path.closeSubpath()
    }

    private static func ellipse(_ path: CGMutablePath, center c: CGPoint, rx: Double, ry: Double) {
        path.move(to: CGPoint(x: c.x + rx, y: c.y))
        path.addCurve(to: CGPoint(x: c.x, y: c.y + ry), control1: CGPoint(x: c.x + rx, y: c.y + ry * k), control2: CGPoint(x: c.x + rx * k, y: c.y + ry))
        path.addCurve(to: CGPoint(x: c.x - rx, y: c.y), control1: CGPoint(x: c.x - rx * k, y: c.y + ry), control2: CGPoint(x: c.x - rx, y: c.y + ry * k))
        path.addCurve(to: CGPoint(x: c.x, y: c.y - ry), control1: CGPoint(x: c.x - rx, y: c.y - ry * k), control2: CGPoint(x: c.x - rx * k, y: c.y - ry))
        path.addCurve(to: CGPoint(x: c.x + rx, y: c.y), control1: CGPoint(x: c.x + rx * k, y: c.y - ry), control2: CGPoint(x: c.x + rx, y: c.y - ry * k))
        path.closeSubpath()
    }

    private static func blob(_ path: CGMutablePath, w: Double, h: Double) {
        let n = blobPoints.count
        func p(_ i: Int) -> CGPoint {
            let q = blobPoints[((i % n) + n) % n]
            return CGPoint(x: q.x * w, y: q.y * h)
        }
        path.move(to: p(0))
        for i in 0..<n {
            let p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2)
            path.addCurve(to: p2,
                          control1: CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6),
                          control2: CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6))
        }
        path.closeSubpath()
    }

    private static func star(_ path: CGMutablePath, w: Double, h: Double, radius: Double) {
        // A five-pointed star stretched so its points touch every edge of the box.
        let top = 1.0, bottom = cos(Double.pi / 5), side = sin(2 * Double.pi / 5)
        let inner = 0.5
        let points = (0..<10).map { i -> CGPoint in
            let angle = -Double.pi / 2 + Double(i) * Double.pi / 5
            let r = i % 2 == 0 ? 1 : inner
            let x = r * cos(angle), y = r * sin(angle)
            return CGPoint(x: (x + side) / (2 * side) * w, y: (y + top) / (top + bottom) * h)
        }
        roundedPolygon(path, points, radius: radius)
    }

    private static func heart(_ path: CGMutablePath, w: Double, h: Double) {
        func P(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * w, y: y * h) }
        path.move(to: P(0.5, 0.24))
        path.addCurve(to: P(0.14, 0.04), control1: P(0.5, 0.05), control2: P(0.3, -0.02))
        path.addCurve(to: P(0.1, 0.55), control1: P(-0.02, 0.1), control2: P(-0.03, 0.38))
        path.addCurve(to: P(0.5, 1), control1: P(0.22, 0.72), control2: P(0.4, 0.84))
        path.addCurve(to: P(0.9, 0.55), control1: P(0.6, 0.84), control2: P(0.78, 0.72))
        path.addCurve(to: P(0.86, 0.04), control1: P(1.03, 0.38), control2: P(1.02, 0.1))
        path.addCurve(to: P(0.5, 0.24), control1: P(0.7, -0.02), control2: P(0.5, 0.05))
        path.closeSubpath()
    }
}
