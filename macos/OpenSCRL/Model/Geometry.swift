import Foundation
import CoreGraphics

enum Geometry {
    static func radians(_ degrees: Double) -> Double { degrees * .pi / 180 }

    static func normalizedDegrees(_ value: Double) -> Double {
        var x = value.truncatingRemainder(dividingBy: 360)
        if x < 0 { x += 360 }
        return x
    }

    /// Rotates `point` around `center` clockwise (in y-down coordinates) by `degrees`.
    static func rotate(_ point: CGPoint, around center: CGPoint, degrees: Double) -> CGPoint {
        guard degrees != 0 else { return point }
        let r = radians(degrees)
        let dx = point.x - center.x, dy = point.y - center.y
        return CGPoint(x: center.x + dx * cos(r) - dy * sin(r), y: center.y + dx * sin(r) + dy * cos(r))
    }

    static func corners(of rect: CGRect, degrees: Double) -> [CGPoint] {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        return [
            CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
            CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY),
        ].map { rotate($0, around: c, degrees: degrees) }
    }

    static func rotatedBounds(of rect: CGRect, degrees: Double) -> CGRect {
        guard degrees.truncatingRemainder(dividingBy: 360) != 0 else { return rect }
        let pts = corners(of: rect, degrees: degrees)
        let xs = pts.map(\.x), ys = pts.map(\.y)
        return CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
    }

    /// Converts a point into a rotated rectangle's local, unrotated coordinates (origin top-left).
    static func localPoint(_ point: CGPoint, in rect: CGRect, degrees: Double) -> CGPoint {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let p = rotate(point, around: c, degrees: -degrees)
        return CGPoint(x: p.x - rect.minX, y: p.y - rect.minY)
    }

    /// Converts a local point (origin top-left of the unrotated rect) back to the parent space.
    static func parentPoint(_ local: CGPoint, in rect: CGRect, degrees: Double) -> CGPoint {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        return rotate(CGPoint(x: rect.minX + local.x, y: rect.minY + local.y), around: c, degrees: degrees)
    }

    static func hitTest(_ layer: Layer, origin: CGPoint, point: CGPoint, tolerance: Double) -> Bool {
        let rect = CGRect(origin: origin, size: CGSize(width: layer.width, height: layer.height))
        let p = localPoint(point, in: rect, degrees: layer.rotation)
        if case .shape(let shape) = layer.content, shape.shape == .ellipse {
            let rx = layer.width / 2 + tolerance, ry = layer.height / 2 + tolerance
            let dx = p.x - layer.width / 2, dy = p.y - layer.height / 2
            return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1
        }
        return p.x >= -tolerance && p.y >= -tolerance && p.x <= layer.width + tolerance && p.y <= layer.height + tolerance
    }

    /// Where the whole media item is drawn, in layer-local coordinates, so that its visible part
    /// matches the web app's crop (cover-fit, then zoom, then focal offset within the slack).
    static func mediaRect(mediaSize: CGSize, box: CGSize, image: ImageProperties) -> CGRect {
        guard mediaSize.width > 0, mediaSize.height > 0, box.width > 0, box.height > 0 else {
            return CGRect(origin: .zero, size: box)
        }
        let scale = max(1, image.cropScale)
        let boxRatio = box.width / box.height
        let ratio = mediaSize.width / mediaSize.height
        var sw = mediaSize.width, sh = mediaSize.height
        if ratio > boxRatio { sw = mediaSize.height * boxRatio } else { sh = mediaSize.width / boxRatio }
        sw /= scale; sh /= scale
        let maxX = max(0, mediaSize.width - sw), maxY = max(0, mediaSize.height - sh)
        let sx = maxX / 2 + image.cropOffsetX * maxX
        let sy = maxY / 2 + image.cropOffsetY * maxY
        let k = box.width / sw
        return CGRect(x: -sx * k, y: -sy * (box.height / sh), width: mediaSize.width * k, height: mediaSize.height * (box.height / sh))
    }

    /// Inverse of `mediaRect` for panning: crop offsets that place the media at `origin`.
    static func cropOffsets(forMediaOrigin origin: CGPoint, mediaRect: CGRect, box: CGSize) -> (x: Double, y: Double) {
        let slackX = mediaRect.width - box.width
        let slackY = mediaRect.height - box.height
        let ox = slackX > 0.5 ? (-origin.x - slackX / 2) / slackX : 0
        let oy = slackY > 0.5 ? (-origin.y - slackY / 2) / slackY : 0
        return (min(0.5, max(-0.5, ox)), min(0.5, max(-0.5, oy)))
    }
}

extension CGRect {
    var center: CGPoint { CGPoint(x: midX, y: midY) }
}

extension CGPoint {
    static func + (a: CGPoint, b: CGPoint) -> CGPoint { CGPoint(x: a.x + b.x, y: a.y + b.y) }
    static func - (a: CGPoint, b: CGPoint) -> CGPoint { CGPoint(x: a.x - b.x, y: a.y - b.y) }
    static func * (a: CGPoint, k: CGFloat) -> CGPoint { CGPoint(x: a.x * k, y: a.y * k) }
    var length: CGFloat { hypot(x, y) }
}

func clamp<T: Comparable>(_ value: T, _ lower: T, _ upper: T) -> T { min(max(value, lower), upper) }
