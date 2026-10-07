import AppKit
import CoreGraphics
import CoreImage

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

    /// Draws a slide background. Photo backgrounds need `images` and `assets`; transparent
    /// backgrounds draw nothing, or a checkerboard when `checkerboard` is set (editor only).
    static func drawBackground(_ background: Background, in rect: CGRect, cg: CGContext, images: ImageProviding? = nil,
                               assets: [String: MediaAsset] = [:], checkerboard: Bool = false) {
        switch background {
        case .solid(let hex):
            cg.setFillColor(HexColor.cgColor(hex, fallback: .white))
            cg.fill(rect)
        case .gradient(let gradient):
            cg.saveGState()
            cg.clip(to: rect)
            drawGradient(gradient, in: rect, cg: cg)
            cg.restoreGState()
        case .image(let image):
            cg.setFillColor(HexColor.cgColor(image.color, fallback: .black))
            cg.fill(rect)
            if let id = image.assetID, let asset = assets[id] {
                cg.saveGState()
                cg.clip(to: rect)
                if image.blur > 0 {
                    if let source = images?.image(for: asset, pixelEdge: 1024),
                       let blurred = Backdrop.blurred(source, key: "\(id)@\(source.width)", size: rect.size, blur: image.blur) {
                        cg.interpolationQuality = .high
                        drawImageFlipped(blurred, in: rect, cg: cg)
                    }
                } else {
                    let cover = Backdrop.coverRect(asset.pixelSize, in: rect)
                    if let source = images?.image(for: asset, pixelEdge: max(cover.width, cover.height) * deviceScale(cg)) {
                        cg.interpolationQuality = .high
                        drawImageFlipped(source, in: cover, cg: cg)
                    }
                }
                cg.restoreGState()
            }
            if image.dim > 0 {
                cg.setFillColor(CGColor(gray: 0, alpha: min(1, image.dim)))
                cg.fill(rect)
            }
        case .transparent:
            if checkerboard { drawCheckerboard(in: rect, cell: rect.width / 24, cg: cg) }
        }
    }

    /// The editor's stand-in for transparency.
    static func drawCheckerboard(in rect: CGRect, cell: CGFloat, cg: CGContext) {
        cg.saveGState()
        cg.clip(to: rect)
        cg.setFillColor(CGColor(gray: 1, alpha: 1))
        cg.fill(rect)
        cg.setFillColor(CGColor(srgbRed: 0.894, green: 0.894, blue: 0.906, alpha: 1))
        let size = max(4, cell)
        var row = 0
        var y = rect.minY
        while y < rect.maxY {
            var x = rect.minX + CGFloat(row % 2) * size
            while x < rect.maxX {
                cg.fill(CGRect(x: x, y: y, width: size, height: size))
                x += size * 2
            }
            y += size
            row += 1
        }
        cg.restoreGState()
    }

    static func cgGradient(_ gradient: Gradient) -> CGGradient? {
        let stops = gradient.sortedStops
        return CGGradient(colorsSpace: HexColor.srgb, colors: stops.map { HexColor.cgColor($0.color) } as CFArray,
                          locations: stops.map { CGFloat(min(1, max(0, $0.offset))) })
    }

    /// Fills the current clip with `gradient` laid out across `rect`. CSS `linear-gradient` angles
    /// (0° points up, 90° right); radial gradients are centered circles reaching the farthest corner.
    static func drawGradient(_ gradient: Gradient, in rect: CGRect, cg: CGContext) {
        guard let cgGradient = cgGradient(gradient) else { return }
        let c = rect.center
        if gradient.type == .radial {
            cg.drawRadialGradient(cgGradient, startCenter: c, startRadius: 0, endCenter: c,
                                  endRadius: hypot(rect.width, rect.height) / 2, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            return
        }
        let r = Geometry.radians(gradient.angle)
        let d = CGPoint(x: sin(r), y: -cos(r))
        let length = abs(rect.width * sin(r)) + abs(rect.height * cos(r))
        let start = CGPoint(x: c.x - d.x * length / 2, y: c.y - d.y * length / 2)
        let end = CGPoint(x: c.x + d.x * length / 2, y: c.y + d.y * length / 2)
        cg.drawLinearGradient(cgGradient, start: start, end: end, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
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
        drawBackground(project.slides[index].background, in: local, cg: cg, images: images, assets: assets, checkerboard: options.editor)
        let items = project.scene(intersecting: viewport).map { item in
            var local = item
            local.origin.x -= viewport.minX
            return local
        }
        drawScene(items, cg: cg, assets: assets, images: images, options: options)
        cg.restoreGState()
    }

    /// Draws an ordered scene consistently in slides, filmstrip thumbnails, and overflow.
    static func drawScene(_ items: [SceneItem], cg: CGContext, assets: [String: MediaAsset],
                          images: ImageProviding?, options: RenderOptions) {
        // Compose refined joins together, using the same graph as the live canvas and
        // exports. Materializing joins one at a time changes nested blur sampling at 2×.
        if items.contains(where: { $0.layer.image?.seamBlend?.isRefined == true }),
           let renderer = GPUSceneRenderer.shared {
            let viewport = cg.boundingBoxOfClipPath, scale = deviceScale(cg)
            if !viewport.isNull, !viewport.isInfinite, viewport.width > 0, viewport.height > 0,
               viewport.width * scale <= 8192, viewport.height * scale <= 8192,
               viewport.width * viewport.height * scale * scale <= 32 * 1024 * 1024,
               let graph = renderer.scene(items, viewport: viewport, assets: assets, images: images, options: options, scale: scale),
               let image = renderer.context.createCGImage(graph, from: graph.extent, format: .RGBA8, colorSpace: HexColor.srgb) {
                drawImageFlipped(image, in: viewport, cg: cg)
                return
            }
        }
        var lowerLayers: [String: SceneItem] = [:]
        var prepared: [String: CGImage] = [:]
        let partners = Set(items.compactMap { $0.layer.image?.seamBlend?.targetLayerID })
        var lastDrawnLayerID: String?
        for item in items {
            var layer = item.layer
            let target = layer.image?.seamBlend.flatMap { lowerLayers[$0.targetLayerID] }
            // Mixing the partner's pixels would cover intervening layers. Preserve their
            // composition with the original alpha feather until the photos are adjacent.
            if let blend = layer.image?.seamBlend, blend.isRefined, lastDrawnLayerID != blend.targetLayerID {
                layer.image?.seamBlend?.version = 1
            }
            let preparedTarget = target.flatMap { prepared[$0.layer.id] }
            drawLayer(layer, origin: item.origin, cg: cg, assets: assets, images: images, options: options, seamTarget: target,
                      preparedSeamTarget: preparedTarget)
            if item.layer.visible, item.layer.opacity > 0, !options.hiddenLayerIDs.contains(item.layer.id) {
                if partners.contains(layer.id), layer.image?.seamBlend != nil {
                    // Retain a blended partner's local pixels for subsequent joins, matching
                    // the GPU graph. Undo the layer rotation so this raster remains local.
                    var flat = layer; flat.opacity = 1; flat.shadow = nil
                    var localTarget = target
                    localTarget?.origin.x -= item.origin.x; localTarget?.origin.y -= item.origin.y
                    let wanted = deviceScale(cg)
                    let scale = wanted * min(1, 8192 / max(layer.width * wanted, layer.height * wanted))
                    let w = max(1, Int(ceil(layer.width * scale))), h = max(1, Int(ceil(layer.height * scale)))
                    prepared[layer.id] = SeamRenderer.Pixels(width: w, height: h) { context in
                        context.scaleBy(x: Double(w) / layer.width, y: Double(h) / layer.height)
                        context.translateBy(x: layer.width / 2, y: layer.height / 2)
                        context.rotate(by: -Geometry.radians(layer.rotation))
                        context.translateBy(x: -layer.width / 2, y: -layer.height / 2)
                        drawLayer(flat, origin: .zero, cg: context, assets: assets, images: images, options: RenderOptions(),
                                  seamTarget: localTarget, preparedSeamTarget: preparedTarget)
                    }?.image()
                }
                lowerLayers[item.layer.id] = item
                lastDrawnLayerID = item.layer.id
            }
        }
    }

    // MARK: Layers

    static func drawLayer(_ layer: Layer, origin: CGPoint, cg: CGContext, assets: [String: MediaAsset],
                          images: ImageProviding?, options: RenderOptions, seamTarget: SceneItem? = nil,
                          preparedSeamTarget: CGImage? = nil) {
        guard layer.visible, !options.hiddenLayerIDs.contains(layer.id), layer.width > 0, layer.height > 0 else { return }
        cg.saveGState()
        cg.translateBy(x: origin.x + layer.width / 2, y: origin.y + layer.height / 2)
        if layer.rotation != 0 { cg.rotate(by: Geometry.radians(layer.rotation)) }
        cg.translateBy(x: -layer.width / 2, y: -layer.height / 2)
        // A shadow is cast by the composite of everything the layer draws, like the web painter.
        let shadow = layer.shadow.flatMap { $0.opacity > 0 && !HexColor.isTransparent($0.color) ? $0 : nil }
        let grouped = layer.opacity < 0.999 || shadow != nil
        if grouped {
            cg.setAlpha(max(0, layer.opacity))
            if let shadow { setShadow(shadow, cg: cg) }
            cg.beginTransparencyLayer(auxiliaryInfo: nil)
        }
        let box = CGSize(width: layer.width, height: layer.height)
        switch layer.content {
        case .image(let props):
            drawImage(props, layer: layer, origin: origin, box: box, cg: cg, assets: assets, images: images, options: options, seamTarget: seamTarget,
                      preparedSeamTarget: preparedSeamTarget)
        case .shape(let props):
            drawShape(props, box: box, cg: cg)
        case .text(let props):
            TextLayout.make(props, width: box.width, height: box.height).draw(props, box: box, in: cg)
        }
        if grouped { cg.endTransparencyLayer() }
        cg.restoreGState()
    }

    /// Shadow distances are project pixels that don't rotate with the layer. Core Graphics takes
    /// them in device space, where y points up.
    static func setShadow(_ shadow: Shadow, cg: CGContext) {
        let k = deviceScale(cg)
        let c = HexColor.components(shadow.color) ?? (0, 0, 0, 1)
        let color = CGColor(colorSpace: HexColor.srgb, components: [c.r, c.g, c.b, c.a * min(1, max(0, shadow.opacity))])
        cg.setShadow(offset: CGSize(width: shadow.offsetX * k, height: -shadow.offsetY * k), blur: max(0, shadow.blur) * k, color: color)
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

    private static func drawImage(_ props: ImageProperties, layer: Layer, origin: CGPoint, box: CGSize, cg: CGContext,
                                  assets: [String: MediaAsset], images: ImageProviding?, options: RenderOptions, seamTarget: SceneItem?,
                                  preparedSeamTarget: CGImage?) {
        let layerID = layer.id
        let clip = MaskGeometry.path(props.mask, size: box, cornerRadius: props.cornerRadius)
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
            if let blend = props.seamBlend?.sanitized, let target = seamTarget,
               let targetAsset = assets[target.layer.image?.assetID ?? ""], target.layer.opacity > 0,
               let targetImage = images?.image(for: targetAsset, pixelEdge: edge),
               let blended = SeamRenderer.image(image, asset: asset,
                    foreground: SceneItem(layer: layer, slideIndex: target.slideIndex, origin: origin), target: target,
                    blend: blend, pixelScale: deviceScale(cg), assets: assets, targetImage: targetImage, preparedTargetImage: preparedSeamTarget) {
                drawImageFlipped(blended, in: CGRect(origin: .zero, size: box), cg: cg)
            } else {
                drawImageFlipped(image, in: mediaRect, cg: cg)
            }
        } else if options.editor {
            cg.setFillColor(CGColor(gray: 0.5, alpha: 0.16))
            cg.fill(CGRect(origin: .zero, size: box))
        }
        if props.strokeWidth > 0, !HexColor.isTransparent(props.stroke) {
            // A centered stroke clipped to the mask: the border sits inside the photo's outline.
            cg.addPath(clip)
            cg.setStrokeColor(HexColor.cgColor(props.stroke))
            cg.setLineWidth(props.strokeWidth * 2)
            cg.setLineJoin(.round)
            cg.strokePath()
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

/// Cover-fitted and blurred background photos, cached because blurring is relatively expensive.
enum Backdrop {
    private static let cache: NSCache<NSString, CGImage> = {
        let cache = NSCache<NSString, CGImage>()
        cache.countLimit = 16
        return cache
    }()
    private static let context = CIContext(options: [.workingColorSpace: HexColor.srgb, .outputColorSpace: HexColor.srgb])

    /// The media cover-fitted and centered in `rect`.
    static func coverRect(_ media: CGSize, in rect: CGRect) -> CGRect {
        guard media.width > 0, media.height > 0 else { return rect }
        let scale = max(rect.width / media.width, rect.height / media.height)
        let size = CGSize(width: media.width * scale, height: media.height * scale)
        return CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height)
    }

    /// A blurred, cover-fitted copy for an area of `size` project pixels. `blur` is the Gaussian
    /// standard deviation in project pixels, like CSS `blur()`. Rendered at reduced resolution
    /// (the blur hides it), with edges extended so the photo doesn't darken toward the slide edges.
    static func blurred(_ image: CGImage, key: String, size: CGSize, blur: Double) -> CGImage? {
        let cacheKey = "\(key)|\(size.width)x\(size.height)|\(blur)" as NSString
        if let hit = cache.object(forKey: cacheKey) { return hit }
        let q = min(1, 1024 / max(size.width, size.height), max(0.04, 6 / max(blur, 0.001)))
        let w = max(1, Int((size.width * q).rounded(.up))), h = max(1, Int((size.height * q).rounded(.up)))
        guard let cg = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: HexColor.srgb,
                                 bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        cg.interpolationQuality = .high
        cg.draw(image, in: coverRect(CGSize(width: image.width, height: image.height), in: CGRect(x: 0, y: 0, width: w, height: h)))
        guard let scaled = cg.makeImage() else { return nil }
        let input = CIImage(cgImage: scaled)
        let output = input.clampedToExtent().applyingGaussianBlur(sigma: blur * q).cropped(to: input.extent)
        guard let result = context.createCGImage(output, from: input.extent) else { return nil }
        cache.setObject(result, forKey: cacheKey)
        return result
    }
}
