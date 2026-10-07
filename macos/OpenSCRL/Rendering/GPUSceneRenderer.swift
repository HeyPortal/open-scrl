import AppKit
import CoreGraphics
import CoreImage
import Foundation
import Metal

/// Builds one lazy Core Image graph for a complete scene. Decoded video pixel buffers are
/// sampled directly: crop, masks, seam alignment, shadows and placement do not make CGImages.
/// Only static vector/text outlines are rasterized, and those are cached independently of
/// layer position, rotation, opacity and the changing video frames.
final class GPUSceneRenderer {
    static let shared = GPUSceneRenderer()
    let device: MTLDevice
    let queue: MTLCommandQueue
    let context: CIContext
    private let opacityKernel: CIColorKernel
    private let tintKernel: CIColorKernel
    private let maskKernel: CIKernel
    private let outlineKernel: CIColorKernel
    private let checkerKernel: CIKernel
    private let gradientKernel: CIKernel

    private final class Key<Value: Hashable>: NSObject {
        let value: Value
        let retainedImage: CGImage?
        init(_ value: Value, image: CGImage? = nil) { self.value = value; retainedImage = image }
        override var hash: Int { value.hashValue }
        override func isEqual(_ other: Any?) -> Bool { (other as? Key<Value>)?.value == value }
    }
    private final class Raster {
        let image: CIImage
        init(_ image: CIImage) { self.image = image }
    }
    private struct MaskKey: Hashable { var mask: ImageMask; var radius: Double; var size: CGSize; var scale: Double; var preview: Bool }
    private struct BorderKey: Hashable { var mask: MaskKey; var width: Double; var color: String }
    private struct ContentKey: Hashable { var content: Layer.Content; var size: CGSize; var scale: Double; var editor: Bool; var highlighted: Bool; var accent: [CGFloat] }
    private struct BoundsKey: Hashable {
        var foreground: SeamSource; var target: SeamSource; var dx: Double; var dy: Double
        var opacity: Double; var width: Int; var height: Int; var imageID: ObjectIdentifier?
    }
    private final class Bounds { let rect: CGRect; init(_ rect: CGRect) { self.rect = rect } }
    private let masks = NSCache<Key<MaskKey>, Raster>()
    private let borders = NSCache<Key<BorderKey>, Raster>()
    private let content = NSCache<Key<ContentKey>, Raster>()
    private let seamBounds = NSCache<Key<BoundsKey>, Bounds>()

    private init?() {
        guard let device = MTLCreateSystemDefaultDevice(), device.supportsDynamicLibraries,
              let queue = device.makeCommandQueue(), SeamGPU.shared != nil else { return nil }
        let override = ProcessInfo.processInfo.environment["OPENSCRL_METALLIB"].map { URL(fileURLWithPath: $0) }
        guard let url = override ?? Bundle.main.url(forResource: "default", withExtension: "metallib"),
              let data = try? Data(contentsOf: url),
              let opacity = try? CIColorKernel(functionName: "sceneOpacity", fromMetalLibraryData: data),
              let tint = try? CIColorKernel(functionName: "sceneTint", fromMetalLibraryData: data),
              let mask = try? CIKernel(functionName: "sceneMask", fromMetalLibraryData: data),
              let outline = try? CIColorKernel(functionName: "sceneOutline", fromMetalLibraryData: data),
              let checker = try? CIKernel(functionName: "sceneChecker", fromMetalLibraryData: data),
              let gradient = try? CIKernel(functionName: "sceneGradient", fromMetalLibraryData: data) else { return nil }
        self.device = device; self.queue = queue
        // The seam explicitly converts sRGB to linear light and back. Keeping the shared
        // working space sRGB preserves its numerical meaning for tagged stills and video alike.
        context = CIContext(mtlCommandQueue: queue, options: [.workingColorSpace: HexColor.srgb,
                           .outputColorSpace: HexColor.srgb, .workingFormat: CIFormat.RGBAf,
                           .cacheIntermediates: false])
        opacityKernel = opacity; tintKernel = tint; maskKernel = mask; outlineKernel = outline
        checkerKernel = checker; gradientKernel = gradient
        masks.totalCostLimit = 128 * 1024 * 1024
        borders.totalCostLimit = 64 * 1024 * 1024
        content.totalCostLimit = 192 * 1024 * 1024
        seamBounds.totalCostLimit = 32 * 1024 * 1024
        seamBounds.countLimit = 128
    }

    func slide(_ project: Project, index: Int, images: ImageProviding?, options: RenderOptions = RenderOptions(),
               scale: Double = 1) -> CIImage? {
        guard project.slides.indices.contains(index), valid(project.viewport(ofSlide: index), scale: scale) else { return nil }
        let viewport = project.viewport(ofSlide: index)
        let extent = CGRect(x: 0, y: 0, width: viewport.width * scale, height: viewport.height * scale)
        let assets = project.assetsByID
        guard let base = background(project.slides[index].background, in: extent, assets: assets,
                                    images: images, options: options, scale: scale),
              let layers = scene(project.scene(intersecting: viewport), viewport: viewport, assets: assets,
                                 images: images, options: options, scale: scale) else { return nil }
        return layers.composited(over: base).cropped(to: extent)
    }

    func scene(_ items: [SceneItem], viewport: CGRect, assets: [String: MediaAsset], images: ImageProviding?,
               options: RenderOptions = RenderOptions(), scale: Double = 1) -> CIImage? {
        guard valid(viewport, scale: scale) else { return nil }
        let extent = CGRect(x: 0, y: 0, width: viewport.width * scale, height: viewport.height * scale)
        var output = transparent(extent)
        var lower: [String: SceneItem] = [:]
        // Live prepared images stay local to this frame's graph; no video frame history is cached.
        var prepared: [String: CIImage] = [:]
        var lastDrawnLayerID: String?
        for item in items {
            let layer = item.layer
            guard layer.visible, !options.hiddenLayerIDs.contains(layer.id), layer.width > 0, layer.height > 0 else { continue }
            var local: CIImage?
            if let props = layer.image {
                local = photo(item, assets: assets, images: images, options: options, scale: scale)
                if var blend = props.seamBlend?.sanitized, let target = lower[blend.targetLayerID],
                   let targetProps = target.layer.image, let targetAsset = assets[targetProps.assetID ?? ""],
                   target.layer.opacity > 0, let source = local,
                   let partner = prepared[target.layer.id],
                   let bounds = overlap(foreground: item, target: target, targetAsset: targetAsset,
                                        assets: assets, images: images, scale: scale, preview: options.editor) {
                    if blend.isRefined, lastDrawnLayerID != blend.targetLayerID { blend.version = 1 }
                    let placement = transform(target, viewport: viewport, scale: scale)
                        .concatenating(transform(item, viewport: viewport, scale: scale).inverted())
                    let localExtent = CGRect(x: 0, y: 0, width: layer.width * scale, height: layer.height * scale)
                    // Samplers clamp at their native image edge. Materialize transparent
                    // coverage around the transformed partner so a rectangular opaque photo
                    // cannot incorrectly extend its alpha across the whole foreground.
                    let coverage = applyOpacity(partner.transformed(by: placement), target.layer.opacity)
                        .composited(over: transparent(localExtent)).cropped(to: localExtent)
                    local = SeamGPU.shared?.graph(source, coverage: coverage, bounds: bounds, foreground: item,
                                                  target: target, blend: blend, extent: localExtent) ?? source
                }
                let knownAsset = props.assetID.flatMap { assets[$0] } != nil
                if knownAsset, props.strokeWidth > 0, !HexColor.isTransparent(props.stroke), let border = border(layer, scale: scale, preview: options.editor) {
                    local = border.composited(over: local ?? transparent(border.extent))
                }
                // A seam partner is mixed as drawn, border included, without editor tints.
                if let drawn = local { prepared[layer.id] = drawn }
                if knownAsset, options.highlightedSlotIDs.contains(layer.id),
                   let mask = mask(layer, scale: scale, preview: options.editor) {
                    let tint = tint(mask, color: options.accent.copy(alpha: 0.28) ?? options.accent)
                    local = tint.composited(over: local ?? transparent(tint.extent))
                }
            } else {
                local = staticContent(layer, options: options, scale: scale)
            }
            guard var image = local else { return nil }
            image = image.transformed(by: transform(item, viewport: viewport, scale: scale))
            if let shadow = layer.shadow, shadow.opacity > 0, !HexColor.isTransparent(shadow.color) {
                let c = HexColor.components(shadow.color) ?? (0, 0, 0, 1)
                let color = CGColor(colorSpace: HexColor.srgb, components: [c.r, c.g, c.b, c.a * clamp(shadow.opacity, 0, 1)])!
                var silhouette = tint(image, color: color)
                if shadow.blur > 0 { silhouette = silhouette.applyingGaussianBlur(sigma: shadow.blur * scale / 2) }
                silhouette = silhouette.transformed(by: CGAffineTransform(translationX: shadow.offsetX * scale,
                                                                           y: -shadow.offsetY * scale))
                // CGContext casts the transparency group's shadow behind the foreground
                // after applying its global alpha. The shadow therefore shows through a
                // translucent image; applying opacity after composition would hide it.
                image = applyOpacity(image, layer.opacity).composited(over: applyOpacity(silhouette, layer.opacity))
            } else {
                image = applyOpacity(image, layer.opacity)
            }
            output = image.composited(over: output).cropped(to: extent)
            lower[layer.id] = item
            if layer.opacity > 0 { lastDrawnLayerID = layer.id }
        }
        return output.cropped(to: extent)
    }

    /// Rect is a y-up pixel rectangle. It can extend outside the visible viewport: cropping
    /// the result afterward preserves the full-slide crop and gradient during canvas zoom.
    func background(_ background: Background, in rect: CGRect, assets: [String: MediaAsset],
                    images: ImageProviding?, options: RenderOptions, scale: Double = 1) -> CIImage? {
        guard valid(rect, scale: 1) else { return nil }
        switch background {
        case .solid(let hex): return solid(HexColor.cgColor(hex, fallback: .white), in: rect)
        case .transparent:
            if !options.editor { return transparent(rect) }
            return checkerKernel.apply(extent: rect, roiCallback: { _, region in region }, arguments: [
                CIVector(cgRect: rect), max(4 * scale, rect.width / 24)])
        case .gradient(let gradient):
            let stops = gradient.sortedStops
            guard !stops.isEmpty else { return transparent(rect) }
            let positions = stops.map { Float(clamp($0.offset, 0, 1)) }
            let colors = stops.flatMap { stop -> [Float] in
                let c = HexColor.components(stop.color) ?? (0, 0, 0, 1)
                // CGGradient interpolates straight RGBA, preserving the hue of transparent
                // stops. This is shader data; premultiplication happens after interpolation.
                return [Float(c.r), Float(c.g), Float(c.b), Float(c.a)]
            }
            let positionImage = CIImage(bitmapData: positions.withUnsafeBytes { Data($0) }, bytesPerRow: stops.count * 4,
                                        size: CGSize(width: stops.count, height: 1), format: .Rf, colorSpace: nil)
            let colorImage = CIImage(bitmapData: colors.withUnsafeBytes { Data($0) }, bytesPerRow: stops.count * 16,
                                     size: CGSize(width: stops.count, height: 1), format: .RGBAf, colorSpace: nil)
            return gradientKernel.apply(extent: rect, roiCallback: { index, _ in index == 0 ? colorImage.extent : positionImage.extent }, arguments: [
                colorImage, positionImage, CIVector(cgRect: rect),
                CIVector(x: gradient.type == .radial ? 1 : 0, y: Geometry.radians(gradient.angle), z: Double(stops.count), w: 0)])
        case .image(let props):
            var output = solid(HexColor.cgColor(props.color, fallback: .black), in: rect)
            if let id = props.assetID, let asset = assets[id],
               let source = GPUImageSource.image(for: asset, pixelEdge: max(rect.width, rect.height), images: images) {
                let fitted = fit(source, in: Backdrop.coverRect(asset.pixelSize, in: rect))
                let image = props.blur > 0 ? fitted.clampedToExtent().applyingGaussianBlur(sigma: props.blur * scale)
                    .cropped(to: rect) : fitted.cropped(to: rect)
                output = image.composited(over: output)
            }
            if props.dim > 0 { output = solid(CGColor(gray: 0, alpha: clamp(props.dim, 0, 1)), in: rect).composited(over: output) }
            return output.cropped(to: rect)
        }
    }

    private func valid(_ rect: CGRect, scale: Double) -> Bool {
        rect.width > 0 && rect.height > 0 && rect.width.isFinite && rect.height.isFinite
            && rect.minX.isFinite && rect.minY.isFinite && scale.isFinite && scale > 0
    }
    private func transparent(_ rect: CGRect) -> CIImage { CIImage(color: .clear).cropped(to: rect) }
    private func solid(_ color: CGColor, in rect: CGRect) -> CIImage { CIImage(color: CIColor(cgColor: color)).cropped(to: rect) }
    private func applyOpacity(_ image: CIImage, _ opacity: Double) -> CIImage {
        let value = clamp(opacity, 0, 1)
        if value >= 0.999 { return image }
        return opacityKernel.apply(extent: image.extent, arguments: [image, value, CIVector(cgRect: image.extent)]) ?? image
    }
    private func tint(_ image: CIImage, color: CGColor) -> CIImage {
        let c = CIColor(cgColor: color)
        return tintKernel.apply(extent: image.extent, arguments: [image, CIVector(x: c.red, y: c.green, z: c.blue, w: c.alpha), CIVector(cgRect: image.extent)]) ?? image
    }
    private func applyMask(_ image: CIImage, mask: CIImage, extent: CGRect) -> CIImage? {
        maskKernel.apply(extent: extent, roiCallback: { _, rect in rect }, arguments: [image, mask, CIVector(cgRect: extent)])
    }
    private func fit(_ image: CIImage, in rect: CGRect) -> CIImage {
        let source = image.extent
        return image.transformed(by: CGAffineTransform(a: rect.width / source.width, b: 0, c: 0, d: rect.height / source.height,
                        tx: rect.minX - source.minX * rect.width / source.width,
                        ty: rect.minY - source.minY * rect.height / source.height))
    }
    private func transform(_ item: SceneItem, viewport: CGRect, scale: Double) -> CGAffineTransform {
        let layer = item.layer, angle = -Geometry.radians(layer.rotation)
        let a = cos(angle), b = sin(angle), c = -b, d = a
        let halfW = layer.width * scale / 2, halfH = layer.height * scale / 2
        return CGAffineTransform(a: a, b: b, c: c, d: d,
            tx: (item.origin.x - viewport.minX) * scale + halfW - a * halfW - c * halfH,
            ty: (viewport.maxY - item.origin.y) * scale - halfH - b * halfW - d * halfH)
    }

    private func photo(_ item: SceneItem, assets: [String: MediaAsset], images: ImageProviding?,
                       options: RenderOptions, scale: Double) -> CIImage? {
        let layer = item.layer, props = layer.image!
        let extent = CGRect(x: 0, y: 0, width: layer.width * scale, height: layer.height * scale)
        guard let id = props.assetID else { return options.editor ? staticContent(layer, options: options, scale: scale) : transparent(extent) }
        guard let asset = assets[id] else { return options.editor ? staticContent(layer, options: options, scale: scale) : transparent(extent) }
        let media = Geometry.mediaRect(mediaSize: asset.pixelSize, box: layer.frame.size, image: props)
        guard let source = GPUImageSource.image(for: asset, pixelEdge: max(media.width, media.height) * scale, images: images) else {
            guard options.editor else { return transparent(extent) }
            guard let outline = mask(layer, scale: scale, preview: options.editor) else { return nil }
            return tint(outline, color: CGColor(gray: 0.5, alpha: 0.16))
        }
        let rect = CGRect(x: media.minX * scale, y: (layer.height - media.maxY) * scale,
                          width: media.width * scale, height: media.height * scale)
        guard let outline = mask(layer, scale: scale, preview: options.editor) else { return nil }
        return applyMask(fit(source, in: rect), mask: outline, extent: extent)
    }

    private func raster(size: CGSize, scale: Double, padding: Double = 0, preview: Bool = false,
                        draw: (CGContext) -> Void) -> CIImage? {
        // The visible framebuffer is bounded; a zoomed layer can be far larger than it.
        // Cache a bounded outline texture and let the GPU sample only the visible portion.
        let logicalW = size.width + padding * 2, logicalH = size.height + padding * 2
        let rasterScale = preview ? min(scale, 4096 / max(logicalW, logicalH), sqrt(8_000_000 / (logicalW * logicalH))) : scale
        let width = max(1, Int(ceil(logicalW * rasterScale)))
        let height = max(1, Int(ceil(logicalH * rasterScale)))
        guard width <= 16384, height <= 16384, width * height <= 64_000_000,
              let cg = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                         space: HexColor.srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        cg.translateBy(x: 0, y: CGFloat(height)); cg.scaleBy(x: rasterScale, y: -rasterScale)
        cg.translateBy(x: padding, y: padding)
        draw(cg)
        guard let image = cg.makeImage() else { return nil }
        // Remove the rounding slack so project coordinates remain exact at fractional zoom.
        let desired = CGRect(x: -padding * scale, y: -padding * scale,
                             width: (size.width + padding * 2) * scale, height: (size.height + padding * 2) * scale)
        let raw = CIImage(cgImage: image, options: [.colorSpace: HexColor.srgb])
        let ratio = scale / rasterScale
        return raw.transformed(by: CGAffineTransform(a: ratio, b: 0, c: 0, d: ratio,
                        tx: desired.minX, ty: desired.maxY - CGFloat(height) * ratio)).cropped(to: desired)
    }
    private func rasterCost(_ image: CIImage, preview: Bool) -> Int {
        let size = image.extent.size
        let q = preview ? min(1, 4096 / max(size.width, size.height), sqrt(8_000_000 / (size.width * size.height))) : 1
        return Int(ceil(size.width * q) * ceil(size.height * q) * 4)
    }
    private func maskKey(_ layer: Layer, scale: Double, preview: Bool) -> MaskKey {
        MaskKey(mask: layer.image?.mask ?? .rect, radius: layer.image?.cornerRadius ?? 0, size: layer.frame.size, scale: scale, preview: preview)
    }
    private func mask(_ layer: Layer, scale: Double, preview: Bool) -> CIImage? {
        if let image = analyticOutline(layer, scale: scale) { return image }
        let value = maskKey(layer, scale: scale, preview: preview), key = Key(value)
        if let cached = masks.object(forKey: key) { return cached.image }
        guard let image = raster(size: value.size, scale: scale, preview: preview, draw: { cg in
            cg.setFillColor(CGColor(gray: 1, alpha: 1))
            cg.addPath(MaskGeometry.path(value.mask, size: value.size, cornerRadius: value.radius)); cg.fillPath()
        }) else { return nil }
        masks.setObject(Raster(image), forKey: key, cost: rasterCost(image, preview: preview))
        return image
    }
    private func border(_ layer: Layer, scale: Double, preview: Bool) -> CIImage? {
        if let image = analyticOutline(layer, scale: scale, border: true) { return image }
        let props = layer.image!, value = BorderKey(mask: maskKey(layer, scale: scale, preview: preview), width: props.strokeWidth, color: props.stroke)
        let key = Key(value)
        if let cached = borders.object(forKey: key) { return cached.image }
        guard let image = raster(size: layer.frame.size, scale: scale, preview: preview, draw: { cg in
            let path = MaskGeometry.path(props.mask, size: layer.frame.size, cornerRadius: props.cornerRadius)
            cg.addPath(path); cg.clip(); cg.addPath(path)
            cg.setStrokeColor(HexColor.cgColor(props.stroke)); cg.setLineWidth(props.strokeWidth * 2); cg.setLineJoin(.round); cg.strokePath()
        }) else { return nil }
        borders.setObject(Raster(image), forKey: key, cost: rasterCost(image, preview: preview))
        return image
    }
    /// Rectangle and ellipse coverage is evaluated per pixel on the GPU. Changing a frame's
    /// dimensions or corner radius no longer allocates and rasterizes a new CPU mask/border.
    private func analyticOutline(_ layer: Layer, scale: Double, border: Bool = false) -> CIImage? {
        guard let props = layer.image, props.mask == .rect || props.mask == .ellipse else { return nil }
        // Thick ellipse strokes need the exact path's interior offset, rather than the
        // local boundary-distance approximation used for antialiasing the ellipse mask.
        if border && props.mask == .ellipse { return nil }
        let size = CGSize(width: layer.width * scale, height: layer.height * scale)
        let extent = CGRect(origin: .zero, size: size)
        let color = border ? HexColor.components(props.stroke) : (r: 1.0, g: 1.0, b: 1.0, a: 1.0)
        guard let color else { return nil }
        return outlineKernel.apply(extent: extent, arguments: [
            CIVector(x: size.width, y: size.height, z: max(0, props.cornerRadius * scale), w: props.mask == .ellipse ? 1 : 0),
            CIVector(x: border ? props.strokeWidth * scale : 0, y: border ? 1 : 0, z: 0, w: 0),
            CIVector(x: color.r, y: color.g, z: color.b, w: color.a)
        ])
    }
    private func staticContent(_ layer: Layer, options: RenderOptions, scale: Double) -> CIImage? {
        var neutral = layer
        neutral.x = 0; neutral.y = 0; neutral.rotation = 0; neutral.opacity = 1; neutral.shadow = nil
        neutral.id = "cached"; neutral.name = ""; neutral.groupID = nil; neutral.groupKind = nil
        var content = neutral.content
        if case .image(var props) = content { props.seamBlend = nil; content = .image(props); neutral.content = content }
        let highlighted = options.highlightedSlotIDs.contains(layer.id)
        let key = Key(ContentKey(content: content, size: layer.frame.size, scale: scale, editor: options.editor,
                                 highlighted: highlighted, accent: options.accent.components ?? []))
        if let cached = self.content.object(forKey: key) { return cached.image }
        var padding: Double = 0
        switch content {
        case .shape(let p): padding = max(0, p.strokeWidth / 2 + 1)
        case .text(let p):
            let layout = TextLayout.make(p, width: layer.width, height: layer.height)
            var bounds = layout.glyphOutlines().boundingBoxOfPath.insetBy(dx: -p.strokeWidth - 1, dy: -p.strokeWidth - 1)
            if let highlight = p.highlight { bounds = bounds.union(layout.highlightPath(highlight).boundingBoxOfPath) }
            if !bounds.isNull { padding = max(0, -bounds.minX, -bounds.minY, bounds.maxX - layer.width, bounds.maxY - layer.height) + 1 }
        case .image: break
        }
        var localOptions = options
        localOptions.hiddenLayerIDs = []; localOptions.highlightedSlotIDs = highlighted ? [neutral.id] : []
        guard let image = raster(size: layer.frame.size, scale: scale, padding: padding, preview: options.editor, draw: { cg in
            Renderer.drawLayer(neutral, origin: .zero, cg: cg, assets: [:], images: nil, options: localOptions)
        }) else { return nil }
        self.content.setObject(Raster(image), forKey: key, cost: rasterCost(image, preview: options.editor))
        return image
    }
    private func overlap(foreground: SceneItem, target: SceneItem, targetAsset: MediaAsset,
                         assets: [String: MediaAsset], images: ImageProviding?, scale: Double, preview: Bool) -> CGRect? {
        let geometryScale = preview ? min(scale, 2048 / max(foreground.layer.width, foreground.layer.height)) : scale
        let w = max(1, Int(ceil(foreground.layer.width * geometryScale))), h = max(1, Int(ceil(foreground.layer.height * geometryScale)))
        // Still-image alpha affects the geometric seam center. Scan that coverage once and
        // cache it across slider changes; video coverage remains a live GPU graph with bounds
        // derived from its outline, avoiding a GPU readback for each decoded frame.
        let cgImage = targetAsset.mediaKind == .image ? images?.image(for: targetAsset, pixelEdge: CGFloat(max(w, h))) : nil
        let alpha = cgImage.flatMap { [.none, .noneSkipFirst, .noneSkipLast].contains($0.alphaInfo) ? nil : $0 }
        let key = Key(BoundsKey(foreground: SeamSource(foreground.layer), target: SeamSource(target.layer),
                                dx: target.origin.x - foreground.origin.x, dy: target.origin.y - foreground.origin.y,
                                opacity: target.layer.opacity, width: w, height: h, imageID: alpha.map(ObjectIdentifier.init)), image: alpha)
        if let cached = seamBounds.object(forKey: key) {
            return cached.rect.applying(CGAffineTransform(scaleX: scale, y: scale))
        }
        guard let pixels = SeamRenderer.raster(target, relativeTo: foreground, width: w, height: h, assets: assets,
                                              images: nil, coverageOnly: true, coverageImage: alpha),
              let bounds = pixels.overlapBounds() else { return nil }
        // Cache model coordinates, since the geometry raster resolution is capped and can
        // be reused by several distinct high zoom/export scales.
        let rect = CGRect(x: bounds.minX * foreground.layer.width / Double(w),
                          y: bounds.minY * foreground.layer.height / Double(h),
                          width: bounds.width * foreground.layer.width / Double(w),
                          height: bounds.height * foreground.layer.height / Double(h))
        seamBounds.setObject(Bounds(rect), forKey: key, cost: alpha.map { $0.bytesPerRow * $0.height } ?? 1)
        return rect.applying(CGAffineTransform(scaleX: scale, y: scale))
    }
}
