import AppKit
import CoreGraphics

/// Supplies decoded, orientation-corrected images for media assets.
protocol ImageProviding: AnyObject {
    /// The best available image whose longest edge is at least `pixelEdge`, if possible.
    func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage?
}

struct RenderOptions {
    /// Draw editor affordances: placeholders for empty photo slots and loading media.
    var editor = false
    var hiddenLayerIDs: Set<String> = []
    /// Empty slots drawn with the accent tint (selected or drop target).
    var highlightedSlotIDs: Set<String> = []
    var interpolation: CGInterpolationQuality = .high
    var accent: CGColor = CGColor(srgbRed: 0.486, green: 0.361, blue: 1, alpha: 1)
}

/// One renderer for the editor canvas, thumbnails and export, so what you see is what you export.
/// All drawing assumes a y-down coordinate space in project units (pixels at 1×).
enum Renderer {
    // MARK: Background

    static func drawBackground(_ background: Background, in rect: CGRect, cg: CGContext) {
        switch background {
        case .solid(let hex):
            cg.setFillColor(HexColor.cgColor(hex, fallback: .white))
            cg.fill(rect)
        case .gradient(let from, let to, let angle):
            // CSS `linear-gradient(<angle>deg, from, to)` semantics: 0° points up, 90° right.
            let r = Geometry.radians(angle)
            let d = CGPoint(x: sin(r), y: -cos(r))
            let length = abs(rect.width * sin(r)) + abs(rect.height * cos(r))
            let c = rect.center
            let start = CGPoint(x: c.x - d.x * length / 2, y: c.y - d.y * length / 2)
            let end = CGPoint(x: c.x + d.x * length / 2, y: c.y + d.y * length / 2)
            let colors = [HexColor.cgColor(from, fallback: .white), HexColor.cgColor(to, fallback: .black)] as CFArray
            guard let gradient = CGGradient(colorsSpace: HexColor.srgb, colors: colors, locations: [0, 1]) else { return }
            cg.saveGState()
            cg.clip(to: rect)
            cg.drawLinearGradient(gradient, start: start, end: end, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            cg.restoreGState()
        }
    }

    // MARK: Slides

    /// Draws slide `index` with its top-left at the current origin, clipped to the slide.
    /// Layers from neighboring slides that overlap this one are included (seamless carousels).
    static func drawSlide(_ project: Project, index: Int, cg: CGContext, images: ImageProviding?,
                          options: RenderOptions = RenderOptions(), assets: [String: MediaAsset]? = nil) {
        guard project.slides.indices.contains(index) else { return }
        let viewport = project.viewport(ofSlide: index)
        let local = CGRect(origin: .zero, size: viewport.size)
        let assets = assets ?? project.assetsByID
        cg.saveGState()
        cg.clip(to: local)
        drawBackground(project.slides[index].background, in: local, cg: cg)
        for item in project.scene(intersecting: viewport) {
            let origin = CGPoint(x: item.origin.x - viewport.minX, y: item.origin.y)
            drawLayer(item.layer, origin: origin, cg: cg, assets: assets, images: images, options: options)
        }
        cg.restoreGState()
    }

    // MARK: Layers

    static func drawLayer(_ layer: Layer, origin: CGPoint, cg: CGContext, assets: [String: MediaAsset],
                          images: ImageProviding?, options: RenderOptions) {
        guard layer.visible, !options.hiddenLayerIDs.contains(layer.id), layer.width > 0, layer.height > 0 else { return }
        cg.saveGState()
        cg.translateBy(x: origin.x + layer.width / 2, y: origin.y + layer.height / 2)
        if layer.rotation != 0 { cg.rotate(by: Geometry.radians(layer.rotation)) }
        cg.translateBy(x: -layer.width / 2, y: -layer.height / 2)
        let grouped = layer.opacity < 0.999
        if grouped {
            cg.setAlpha(max(0, layer.opacity))
            cg.beginTransparencyLayer(auxiliaryInfo: nil)
        }
        let box = CGSize(width: layer.width, height: layer.height)
        switch layer.content {
        case .image(let props):
            drawImage(props, layerID: layer.id, box: box, cg: cg, assets: assets, images: images, options: options)
        case .shape(let props):
            drawShape(props, box: box, cg: cg)
        case .text(let props):
            TextLayout.make(props, width: box.width).draw(in: cg)
        }
        if grouped { cg.endTransparencyLayer() }
        cg.restoreGState()
    }

    static func shapePath(_ props: ShapeProperties, box: CGSize) -> CGPath {
        let rect = CGRect(origin: .zero, size: box)
        if props.shape == .ellipse { return CGPath(ellipseIn: rect, transform: nil) }
        return roundedRect(rect, radius: props.cornerRadius)
    }

    static func roundedRect(_ rect: CGRect, radius: Double) -> CGPath {
        let r = max(0, min(radius, rect.width / 2, rect.height / 2))
        return r > 0 ? CGPath(roundedRect: rect, cornerWidth: r, cornerHeight: r, transform: nil) : CGPath(rect: rect, transform: nil)
    }

    private static func drawShape(_ props: ShapeProperties, box: CGSize, cg: CGContext) {
        let path = shapePath(props, box: box)
        if !HexColor.isTransparent(props.fill) {
            cg.addPath(path)
            cg.setFillColor(HexColor.cgColor(props.fill))
            cg.fillPath()
        }
        if props.strokeWidth > 0, !HexColor.isTransparent(props.stroke) {
            cg.addPath(path)
            cg.setStrokeColor(HexColor.cgColor(props.stroke))
            cg.setLineWidth(props.strokeWidth)
            cg.strokePath()
        }
    }

    /// Pixels per project unit for the current transform, used to pick an image resolution.
    static func deviceScale(_ cg: CGContext) -> CGFloat {
        let m = cg.ctm
        return max(0.01, sqrt(m.a * m.a + m.b * m.b))
    }

    private static func drawImage(_ props: ImageProperties, layerID: String, box: CGSize, cg: CGContext,
                                  assets: [String: MediaAsset], images: ImageProviding?, options: RenderOptions) {
        let clip = roundedRect(CGRect(origin: .zero, size: box), radius: props.cornerRadius)
        guard let assetID = props.assetID else {
            if options.editor { drawSlotPlaceholder(box: box, clip: clip, cg: cg, highlighted: options.highlightedSlotIDs.contains(layerID), accent: options.accent, missing: false) }
            return
        }
        guard let asset = assets[assetID] else {
            if options.editor { drawSlotPlaceholder(box: box, clip: clip, cg: cg, highlighted: options.highlightedSlotIDs.contains(layerID), accent: options.accent, missing: true) }
            return
        }
        let mediaRect = Geometry.mediaRect(mediaSize: asset.pixelSize, box: box, image: props)
        let edge = max(mediaRect.width, mediaRect.height) * deviceScale(cg)
        cg.saveGState()
        cg.addPath(clip)
        cg.clip()
        if let image = images?.image(for: asset, pixelEdge: edge) {
            cg.interpolationQuality = options.interpolation
            drawImageFlipped(image, in: mediaRect, cg: cg)
        } else if options.editor {
            cg.setFillColor(CGColor(gray: 0.5, alpha: 0.16))
            cg.fill(CGRect(origin: .zero, size: box))
        }
        cg.restoreGState()
        if options.highlightedSlotIDs.contains(layerID) {
            cg.saveGState()
            cg.addPath(clip)
            cg.setFillColor(options.accent.copy(alpha: 0.28) ?? options.accent)
            cg.fillPath()
            cg.restoreGState()
        }
    }

    /// Draws a CGImage into `rect` in a y-down context without flipping it upside down.
    static func drawImageFlipped(_ image: CGImage, in rect: CGRect, cg: CGContext) {
        cg.saveGState()
        cg.translateBy(x: 0, y: rect.minY + rect.maxY)
        cg.scaleBy(x: 1, y: -1)
        cg.draw(image, in: rect)
        cg.restoreGState()
    }

    // MARK: Editor placeholders

    nonisolated(unsafe) private static var symbolCache: [String: CGImage] = [:]
    private static let symbolLock = NSLock()

    static func symbolImage(_ name: String, pointSize: CGFloat = 64) -> CGImage? {
        let key = "\(name)@\(pointSize)"
        symbolLock.lock(); defer { symbolLock.unlock() }
        if let cached = symbolCache[key] { return cached }
        let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .regular)
        guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) else { return nil }
        var rect = CGRect(origin: .zero, size: symbol.size)
        guard let image = symbol.cgImage(forProposedRect: &rect, context: nil, hints: [.ctm: NSAffineTransform(transform: AffineTransform(scale: 2))]) else { return nil }
        symbolCache[key] = image
        return image
    }

    private static func drawSlotPlaceholder(box: CGSize, clip: CGPath, cg: CGContext, highlighted: Bool, accent: CGColor, missing: Bool) {
        let rect = CGRect(origin: .zero, size: box)
        cg.saveGState()
        cg.addPath(clip)
        cg.clip()
        let fill = highlighted ? (accent.copy(alpha: 0.22) ?? accent) : CGColor(srgbRed: 0.46, green: 0.46, blue: 0.5, alpha: 0.2)
        cg.setFillColor(fill)
        cg.fill(rect)
        // Inner hairline so adjacent empty slots read as separate cells.
        cg.setStrokeColor(highlighted ? accent : CGColor(gray: 0.45, alpha: 0.35))
        cg.setLineWidth(max(1, 1.5 / deviceScale(cg)))
        cg.stroke(rect.insetBy(dx: 0.75 / deviceScale(cg), dy: 0.75 / deviceScale(cg)))
        let iconSide = min(box.width, box.height) * 0.22
        if iconSide * deviceScale(cg) >= 10, let symbol = symbolImage(missing ? "photo.badge.exclamationmark" : "photo.badge.plus") {
            let aspect = CGFloat(symbol.width) / CGFloat(symbol.height)
            let h = min(iconSide, 160), w = h * aspect
            let iconRect = CGRect(x: (box.width - w) / 2, y: (box.height - h) / 2, width: w, height: h)
            cg.saveGState()
            cg.translateBy(x: 0, y: iconRect.minY + iconRect.maxY)
            cg.scaleBy(x: 1, y: -1)
            cg.clip(to: iconRect, mask: symbol)
            cg.setFillColor(highlighted ? accent : CGColor(gray: 0.42, alpha: 0.9))
            cg.fill(iconRect)
            cg.restoreGState()
        }
        cg.restoreGState()
    }
}
