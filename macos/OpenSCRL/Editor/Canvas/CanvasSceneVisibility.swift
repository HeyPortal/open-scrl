import CoreGraphics
import Foundation

/// Culls content by everything it can paint, while keeping seam inputs in their original
/// order. It avoids requesting decoded photos from distant slides during every canvas frame.
enum CanvasSceneVisibility {
    private struct TextKey: Hashable { var props: TextProperties; var size: CGSize }
    private final class Key: NSObject {
        let value: TextKey
        init(_ value: TextKey) { self.value = value }
        override var hash: Int { value.hashValue }
        override func isEqual(_ object: Any?) -> Bool { (object as? Key)?.value == value }
    }
    private final class Bounds { let rect: CGRect; init(_ rect: CGRect) { self.rect = rect } }
    private static let textBounds: NSCache<Key, Bounds> = {
        let cache = NSCache<Key, Bounds>()
        cache.countLimit = 400
        return cache
    }()

    private static func localBounds(_ layer: Layer) -> CGRect {
        var result = CGRect(origin: .zero, size: layer.frame.size)
        switch layer.content {
        case .image: break // Photo borders are clipped inside the mask.
        case .shape(let props):
            if props.strokeWidth > 0, !HexColor.isTransparent(props.stroke) {
                result = result.insetBy(dx: -props.strokeWidth / 2 - 1, dy: -props.strokeWidth / 2 - 1)
            }
        case .text(let props):
            let key = Key(TextKey(props: props, size: layer.frame.size))
            if let cached = textBounds.object(forKey: key) { return cached.rect }
            let layout = TextLayout.make(props, width: layer.width, height: layer.height)
            var glyphs = layout.glyphOutlines().boundingBoxOfPath
            // Color glyphs can have no vector outline. Typographic bounds keep their
            // ascent/descent visible even when the line box is unusually short.
            for line in layout.lines where !line.isBlank {
                glyphs = glyphs.union(CGRect(x: line.x,
                                             y: line.top + (layout.lineStep - line.ascent - line.descent) / 2,
                                             width: max(1, line.width), height: line.ascent + line.descent))
            }
            if !glyphs.isNull {
                let stroke = props.strokeWidth > 0 && !HexColor.isTransparent(props.stroke) ? props.strokeWidth : 0
                result = result.union(glyphs.insetBy(dx: -stroke - 1, dy: -stroke - 1))
            }
            if let highlight = props.highlight, !HexColor.isTransparent(highlight.color) {
                result = result.union(layout.highlightPath(highlight).boundingBoxOfPath)
            }
            textBounds.setObject(Bounds(result), forKey: key)
        }
        return result
    }

    static func visualBounds(_ item: SceneItem) -> CGRect {
        let local = localBounds(item.layer)
        let points = [CGPoint(x: local.minX, y: local.minY), CGPoint(x: local.maxX, y: local.minY),
                      CGPoint(x: local.maxX, y: local.maxY), CGPoint(x: local.minX, y: local.maxY)]
            .map { Geometry.parentPoint($0, in: item.globalFrame, degrees: item.layer.rotation) }
        let xs = points.map(\.x), ys = points.map(\.y)
        var result = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        if let shadow = item.layer.shadow, shadow.opacity > 0, !HexColor.isTransparent(shadow.color) {
            // Shadows stay on project axes after layer rotation. Three blur radii are
            // deliberately generous for both Core Graphics and Core Image kernels.
            let margin = max(0, shadow.blur) * 3 + 1
            result = result.union(result.offsetBy(dx: shadow.offsetX, dy: shadow.offsetY)
                .insetBy(dx: -margin, dy: -margin))
        }
        return result
    }

    static func items(in project: Project, intersecting viewport: CGRect,
                      options: RenderOptions, scale: CGFloat = 1) -> [SceneItem] {
        let all = project.scene().filter { $0.layer.opacity > 0 && !options.hiddenLayerIDs.contains($0.layer.id) }
        let indices = Dictionary(uniqueKeysWithValues: all.enumerated().map { ($0.element.layer.id, $0.offset) })
        let visible = viewport.insetBy(dx: -1 / max(0.01, scale), dy: -1 / max(0.01, scale))
        var included = Set(all.indices.filter { visualBounds(all[$0]).intersects(visible) })
        var pending = Array(included)
        while let index = pending.popLast() {
            guard let id = all[index].layer.image?.seamBlend?.targetLayerID,
                  let partner = indices[id], partner < index,
                  all[partner].layer.image != nil else { continue }
            if included.insert(partner).inserted { pending.append(partner) }
        }
        return all.enumerated().compactMap { included.contains($0.offset) ? $0.element : nil }
    }
}
