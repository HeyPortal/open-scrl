import CoreGraphics
import CoreImage
import Foundation
import Metal

/// A reusable Metal-backed context. Geometry and decoded pixels stay cached while the
/// slider changes only shader parameters; exports and playback use the same kernel.
final class SeamGPU {
    static let shared = SeamGPU()
    let deviceName: String
    private let context: CIContext
    private let kernel: CIKernel
    private let prepareKernel: CIKernel
    private let differenceKernel: CIColorKernel
    private let compositeKernel: CIKernel
    private let glowKernel: CIKernel

    private struct SourceKey: Hashable {
        var source: SeamSource
        var imageID: ObjectIdentifier
        var width: Int
        var height: Int
    }
    private struct CoverageKey: Hashable {
        var foreground: SeamSource
        var target: SeamSource
        var opacity: Double
        var dx: Double
        var dy: Double
        var imageID: ObjectIdentifier?
        var width: Int
        var height: Int
    }
    private struct PartnerKey: Hashable {
        var foreground: SeamSource
        var target: Layer
        var dx: Double
        var dy: Double
        var imageID: ObjectIdentifier
        var width: Int
        var height: Int
    }
    private final class Key<Value: Hashable>: NSObject {
        let value: Value
        // Keeping the input alive prevents recycled CGImage identities from hitting the cache.
        let image: CGImage?
        init(_ value: Value, image: CGImage? = nil) { self.value = value; self.image = image }
        override var hash: Int { value.hashValue }
        override func isEqual(_ object: Any?) -> Bool { (object as? Key<Value>)?.value == value }
    }
    private final class Raster {
        let image: CIImage
        let bounds: CGRect
        init(_ image: CGImage, bounds: CGRect) {
            self.image = CIImage(cgImage: image, options: [.colorSpace: NSNull()])
            self.bounds = bounds
        }
    }
    /// Supplies the partner's current frame when rasterizing it like the scene renderer does.
    private final class SingleImage: ImageProviding {
        let image: CGImage
        init(_ image: CGImage) { self.image = image }
        func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? { image }
    }
    private let sources = NSCache<Key<SourceKey>, Raster>()
    private let coverages = NSCache<Key<CoverageKey>, Raster>()
    private let partners = NSCache<Key<PartnerKey>, Raster>()

    private init?() {
        guard let device = MTLCreateSystemDefaultDevice(), device.supportsDynamicLibraries else { return nil }
        // The override is used by command-line checks linked against the app's real renderer.
        let override = ProcessInfo.processInfo.environment["OPENSCRL_METALLIB"].map { URL(fileURLWithPath: $0) }
        guard let url = override ?? Bundle.main.url(forResource: "default", withExtension: "metallib"),
              let data = try? Data(contentsOf: url),
              let kernel = try? CIKernel(functionName: "seamBlend", fromMetalLibraryData: data),
              let prepare = try? CIKernel(functionName: "seamPrepare", fromMetalLibraryData: data),
              let difference = try? CIColorKernel(functionName: "seamDifference", fromMetalLibraryData: data),
              let composite = try? CIKernel(functionName: "seamComposite", fromMetalLibraryData: data),
              let glow = try? CIKernel(functionName: "seamGlow", fromMetalLibraryData: data) else { return nil }
        self.kernel = kernel
        prepareKernel = prepare; differenceKernel = difference; compositeKernel = composite; glowKernel = glow
        deviceName = device.name
        // The shader explicitly matches the CPU renderer's sRGB/linear-light conversion.
        context = CIContext(mtlDevice: device, options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(),
                                                       .workingFormat: CIFormat.RGBAf, .cacheIntermediates: false])
        sources.totalCostLimit = 64 * 1024 * 1024
        coverages.totalCostLimit = 64 * 1024 * 1024
        partners.totalCostLimit = 64 * 1024 * 1024
    }

    private func source(_ image: CGImage, asset: MediaAsset, foreground: SceneItem, width: Int, height: Int) -> Raster? {
        let layer = foreground.layer, props = layer.image ?? ImageProperties()
        let key = Key(SourceKey(source: SeamSource(layer), imageID: ObjectIdentifier(image), width: width, height: height), image: image)
        if let cached = sources.object(forKey: key) { return cached }
        guard let pixels = SeamRenderer.Pixels(width: width, height: height, draw: { cg in
            cg.scaleBy(x: Double(width) / layer.width, y: Double(height) / layer.height)
            cg.addPath(MaskGeometry.path(props.mask, size: layer.frame.size, cornerRadius: props.cornerRadius)); cg.clip()
            Renderer.drawImageFlipped(image, in: Geometry.mediaRect(mediaSize: asset.pixelSize, box: layer.frame.size, image: props), cg: cg)
        }), let cgImage = pixels.image() else { return nil }
        let result = Raster(cgImage, bounds: CGRect(x: 0, y: 0, width: width, height: height))
        sources.setObject(result, forKey: key, cost: width * height * 4 + image.bytesPerRow * image.height)
        return result
    }

    private func coverage(_ target: SceneItem, foreground: SceneItem, width: Int, height: Int,
                          assets: [String: MediaAsset], targetImage: CGImage) -> Raster? {
        let opaque = [.none, .noneSkipFirst, .noneSkipLast].contains(targetImage.alphaInfo)
        let coverageImage = opaque ? nil : targetImage
        let key = Key(CoverageKey(foreground: SeamSource(foreground.layer), target: SeamSource(target.layer),
                                  opacity: target.layer.opacity, dx: target.origin.x - foreground.origin.x,
                                  dy: target.origin.y - foreground.origin.y,
                                  imageID: coverageImage.map(ObjectIdentifier.init), width: width, height: height), image: coverageImage)
        if let cached = coverages.object(forKey: key) { return cached }
        guard let pixels = SeamRenderer.raster(target, relativeTo: foreground, width: width, height: height, assets: assets,
                                               images: nil, coverageOnly: true, coverageImage: coverageImage),
              let bounds = pixels.overlapBounds(), let cgImage = pixels.image() else { return nil }
        let result = Raster(cgImage, bounds: bounds)
        coverages.setObject(result, forKey: key, cost: width * height * 4 + (coverageImage.map { $0.bytesPerRow * $0.height } ?? 0))
        return result
    }

    /// The partner as drawn beneath the foreground, with crop, mask, border and opacity,
    /// in the foreground's local pixels. The refined blend mixes these colors directly.
    private func partner(_ target: SceneItem, foreground: SceneItem, width: Int, height: Int,
                         assets: [String: MediaAsset], targetImage: CGImage, preparedImage: CGImage? = nil) -> Raster? {
        let input = preparedImage ?? targetImage
        let key = Key(PartnerKey(foreground: SeamSource(foreground.layer), target: target.layer,
                                 dx: target.origin.x - foreground.origin.x, dy: target.origin.y - foreground.origin.y,
                                 imageID: ObjectIdentifier(input), width: width, height: height), image: input)
        if let cached = partners.object(forKey: key) { return cached }
        let raster: SeamRenderer.Pixels?
        if let preparedImage {
            raster = SeamRenderer.Pixels(width: width, height: height) { cg in
                let layer = foreground.layer, partner = target.layer
                cg.scaleBy(x: Double(width) / layer.width, y: Double(height) / layer.height)
                cg.translateBy(x: layer.width / 2, y: layer.height / 2)
                cg.rotate(by: -Geometry.radians(layer.rotation))
                cg.translateBy(x: -foreground.origin.x - layer.width / 2, y: -foreground.origin.y - layer.height / 2)
                cg.translateBy(x: target.origin.x + partner.width / 2, y: target.origin.y + partner.height / 2)
                cg.rotate(by: Geometry.radians(partner.rotation))
                cg.translateBy(x: -partner.width / 2, y: -partner.height / 2)
                Renderer.drawImageFlipped(preparedImage, in: CGRect(origin: .zero, size: partner.frame.size), cg: cg)
            }
        } else {
            raster = SeamRenderer.raster(target, relativeTo: foreground, width: width, height: height, assets: assets,
                                         images: SingleImage(targetImage))
        }
        guard var pixels = raster else { return nil }
        let opacity = clamp(target.layer.opacity, 0, 1)
        if opacity < 0.999 {
            for i in pixels.bytes.indices { pixels.bytes[i] = UInt8((Double(pixels.bytes[i]) * opacity).rounded()) }
        }
        guard let bounds = pixels.overlapBounds(), let cgImage = pixels.image() else { return nil }
        let result = Raster(cgImage, bounds: bounds)
        partners.setObject(result, forKey: key, cost: width * height * 4 + input.bytesPerRow * input.height)
        return result
    }

    func image(_ image: CGImage, asset: MediaAsset, foreground: SceneItem, target: SceneItem,
               blend: SeamBlend, pixelScale: Double, assets: [String: MediaAsset], targetImage: CGImage,
               preparedTargetImage: CGImage? = nil) -> CGImage? {
        let layer = foreground.layer
        let wantedScale = max(0.02, pixelScale)
        let scale = wantedScale * min(1, 8192 / max(layer.width * wantedScale, layer.height * wantedScale))
        let w = max(1, Int(ceil(layer.width * scale))), h = max(1, Int(ceil(layer.height * scale)))
        guard let source = source(image, asset: asset, foreground: foreground, width: w, height: h),
              let partner = blend.isRefined
                ? partner(target, foreground: foreground, width: w, height: h, assets: assets, targetImage: targetImage, preparedImage: preparedTargetImage)
                : coverage(target, foreground: foreground, width: w, height: h, assets: assets, targetImage: targetImage) else { return nil }
        guard let output = graph(source.image, coverage: partner.image, bounds: partner.bounds,
                                 foreground: foreground, target: target, blend: blend,
                                 extent: CGRect(x: 0, y: 0, width: w, height: h)) else { return nil }
        return context.createCGImage(output, from: output.extent, format: .RGBA8, colorSpace: HexColor.srgb, deferred: false)
    }

    /// Produces the same seam as `image`, retaining the entire graph on the GPU. Both inputs
    /// are already cropped/masked in the foreground's local y-up pixel coordinates. Bounds
    /// keep the analysis model's y-down convention. `coverage` is the partner as drawn
    /// (premultiplied, with opacity): the original look uses only its alpha.
    func graph(_ source: CIImage, coverage: CIImage, bounds: CGRect, foreground: SceneItem,
               target: SceneItem, blend: SeamBlend, extent: CGRect) -> CIImage? {
        if blend.isRefined {
            return refinedGraph(source, partner: coverage, bounds: bounds, foreground: foreground,
                                target: target, blend: blend, extent: extent)
        }
        let layer = foreground.layer
        let w = extent.width, h = extent.height
        let analysis = blend.analysis.flatMap { $0.matches(layer, target.layer, edge: blend.edge) ? $0 : nil }
        let savedPath = blend.followsDetail ? analysis?.path ?? [] : []
        let path = (savedPath.isEmpty ? [0.5] : savedPath).map { Float($0) }
        let pathImage = CIImage(bitmapData: path.withUnsafeBytes { Data($0) }, bytesPerRow: path.count * 4,
                                size: CGSize(width: path.count, height: 1), format: .Rf, colorSpace: nil)
        let horizontal = blend.edge.isHorizontal
        let crossSize = horizontal ? bounds.width : bounds.height
        let feather = max(1, min(blend.width * (horizontal ? Double(w) / layer.width : Double(h) / layer.height), crossSize * 0.9))
        let shiftX = ((analysis?.shiftX ?? 0) * blend.alignment + blend.offsetX) * Double(w) / layer.width
        let shiftY = ((analysis?.shiftY ?? 0) * blend.alignment + blend.offsetY) * Double(h) / layer.height
        let gain = analysis?.gain ?? [1, 1, 1], bias = analysis?.bias ?? [0, 0, 0]
        let arguments: [Any] = [source, coverage, pathImage,
                                CIVector(x: Double(w), y: Double(h), z: horizontal ? 1 : 0, w: blend.edge.isReversed ? -1 : 1),
                                CIVector(cgRect: bounds),
                                CIVector(x: feather, y: blend.position, z: Double(path.count), w: analysis == nil ? 0 : blend.colorMatch),
                                CIVector(x: shiftX, y: shiftY), CIVector(x: gain[0], y: gain[1], z: gain[2]),
                                CIVector(x: bias[0], y: bias[1], z: bias[2])]
        guard let output = kernel.apply(extent: extent, roiCallback: { index, rect in
            if index == 2 { return pathImage.extent }
            if index == 0 { return rect.insetBy(dx: -abs(shiftX) - 1, dy: -abs(shiftY) - 1).intersection(extent) }
            return rect
        }, arguments: arguments) else { return nil }
        return output
    }

    /// The refined look: regional alignment and color matching, a detail cut along the
    /// saved path, an optional multi-band soft blend, and the edge style.
    private func refinedGraph(_ source: CIImage, partner: CIImage, bounds: CGRect, foreground: SceneItem,
                              target: SceneItem, blend: SeamBlend, extent: CGRect) -> CIImage? {
        let layer = foreground.layer
        let w = extent.width, h = extent.height
        let unitX = w / layer.width, unitY = h / layer.height
        let horizontal = blend.edge.isHorizontal
        let crossUnit = horizontal ? unitX : unitY
        let crossSize = horizontal ? bounds.width : bounds.height
        let analysis = blend.analysis.flatMap { $0.matches(layer, target.layer, edge: blend.edge) ? $0 : nil }
        let style = blend.resolvedStyle
        let soft = style == .soft

        let saved = blend.followsDetail ? (soft && analysis?.softPath.isEmpty == false ? analysis?.softPath : analysis?.path) ?? [] : []
        let path = (saved.isEmpty ? [0.5] : saved).map { Float($0) }
        let pathImage = CIImage(bitmapData: path.withUnsafeBytes { Data($0) }, bytesPerRow: path.count * 4,
                                size: CGSize(width: path.count, height: 1), format: .Rf, colorSpace: nil)

        // Gain, bias and shift (in output pixels) per region along the seam. Matches from the
        // original renderer have one global model, used as a single region. Core Image puts the
        // first bitmap row at the top, so the kernel's y = 0.5 gain row is stored last.
        let gainRow = 2, biasRow = 1, shiftRow = 0
        let regions = max(1, analysis?.regionCount ?? 1)
        var profile = [Float](repeating: 0, count: regions * 3 * 4)
        var maxShift = CGPoint.zero
        for region in 0..<regions {
            let regional = (analysis?.regionCount ?? 0) > 0
            for c in 0..<3 {
                profile[(gainRow * regions + region) * 4 + c] = Float(regional ? analysis!.regionGain[region * 3 + c] : analysis?.gain[c] ?? 1)
                profile[(biasRow * regions + region) * 4 + c] = Float(regional ? analysis!.regionBias[region * 3 + c] : analysis?.bias[c] ?? 0)
            }
            let sx = regional ? analysis!.regionShift[region * 2] : analysis?.shiftX ?? 0
            let sy = regional ? analysis!.regionShift[region * 2 + 1] : analysis?.shiftY ?? 0
            let shift = CGPoint(x: (sx * blend.alignment + blend.offsetX) * unitX, y: (sy * blend.alignment + blend.offsetY) * unitY)
            profile[(shiftRow * regions + region) * 4] = Float(shift.x)
            profile[(shiftRow * regions + region) * 4 + 1] = Float(shift.y)
            maxShift = CGPoint(x: max(maxShift.x, abs(shift.x)), y: max(maxShift.y, abs(shift.y)))
        }
        let profileImage = CIImage(bitmapData: profile.withUnsafeBytes { Data($0) }, bytesPerRow: regions * 16,
                                   size: CGSize(width: regions, height: 3), format: .RGBAf, colorSpace: nil)

        let size = CIVector(x: w, y: h, z: horizontal ? 1 : 0, w: blend.edge.isReversed ? -1 : 1)
        let overlap = CIVector(cgRect: bounds)
        // Corrections fade over half the photo; Whole Photo keeps the color match everywhere.
        let reach = 0.5 * (horizontal ? w : h)
        let colorMatch = soft || analysis == nil ? 0 : blend.colorMatch
        guard let prepared = prepareKernel.apply(extent: extent, roiCallback: { index, rect in
            if index == 1 { return pathImage.extent }
            if index == 2 { return profileImage.extent }
            return rect.insetBy(dx: -maxShift.x - 1, dy: -maxShift.y - 1).intersection(extent)
        }, arguments: [source, pathImage, profileImage, size, overlap,
                       CIVector(x: blend.position, y: Double(path.count), z: Double(regions), w: reach),
                       CIVector(x: colorMatch, y: blend.colorReach == .wholePhoto ? 0 : reach, z: 0, w: 0)]) else { return nil }

        let width = max(1, min(blend.width * crossUnit, crossSize * 0.9))
        let edge = blend.edgeStyle
        let detail: Double
        switch (soft, edge) {
        case (true, .organic): detail = width * 0.5
        case (true, .glow): detail = width * 0.75
        case (true, _): detail = width * 1.1
        default: detail = max(1.5, width * 0.3)
        }
        let kind: Double, amplitude: Double, noiseScale: Double
        switch edge {
        case .clean, .glow: kind = edge == .glow ? 2 : 0; amplitude = 0; noiseScale = 1
        case .organic: kind = 1; amplitude = width * 0.8; noiseScale = 45
        }

        // Soft blends give every frequency band its own transition width, coarsest over the
        // whole overlap. Blurring the weighted difference keeps the work inside the overlap.
        var levels: [CIImage] = []
        let coarsest = max(1, crossSize / 8)
        let firstSigma = coarsest / 32
        if soft {
            let region = CGRect(x: bounds.minX, y: h - bounds.maxY, width: bounds.width, height: bounds.height)
                .insetBy(dx: -1, dy: -1).intersection(extent)
            guard let difference = differenceKernel.apply(extent: region, arguments: [prepared, partner]) else { return nil }
            levels = (0..<6).map { level in
                let sigma = firstSigma * pow(2, Double(level))
                return sigma < 0.3 ? difference : difference.applyingGaussianBlur(sigma: sigma)
            }
        }
        let levelCount = levels.count
        while levels.count < 6 { levels.append(partner) }
        let images: [Any] = [prepared, partner, pathImage] + levels
        let settings: [Any] = [size, overlap,
                               CIVector(x: blend.position, y: Double(path.count), z: detail, w: soft ? 1 : 0),
                               CIVector(x: firstSigma, y: Double(levelCount), z: 2, w: 0),
                               CIVector(x: kind, y: amplitude, z: noiseScale, w: 0),
                               CIVector(x: unitX, y: unitY)]
        guard var output = compositeKernel.apply(extent: extent, roiCallback: { index, rect in
            index == 2 ? pathImage.extent : rect
        }, arguments: images + settings) else { return nil }

        if edge == .glow {
            let bloom = output.clampedToExtent().applyingGaussianBlur(sigma: max(2, width * 0.5)).cropped(to: extent)
            guard let glowing = glowKernel.apply(extent: extent, roiCallback: { index, rect in
                index == 2 ? pathImage.extent : rect
            }, arguments: [output, bloom, pathImage, size, overlap,
                           CIVector(x: blend.position, y: Double(path.count), z: 0, w: 0),
                           CIVector(x: 0.55, y: max(24 * crossUnit, width * 0.9), z: 1.25, w: 0)]) else { return nil }
            output = glowing
        }
        return output
    }
}
