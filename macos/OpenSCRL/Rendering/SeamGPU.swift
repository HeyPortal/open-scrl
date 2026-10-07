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
    private let sources = NSCache<Key<SourceKey>, Raster>()
    private let coverages = NSCache<Key<CoverageKey>, Raster>()

    private init?() {
        guard let device = MTLCreateSystemDefaultDevice(), device.supportsDynamicLibraries else { return nil }
        // The override is used by command-line checks linked against the app's real renderer.
        let override = ProcessInfo.processInfo.environment["OPENSCRL_METALLIB"].map { URL(fileURLWithPath: $0) }
        guard let url = override ?? Bundle.main.url(forResource: "default", withExtension: "metallib"),
              let data = try? Data(contentsOf: url),
              let kernel = try? CIKernel(functionName: "seamBlend", fromMetalLibraryData: data) else { return nil }
        self.kernel = kernel
        deviceName = device.name
        // The shader explicitly matches the CPU renderer's sRGB/linear-light conversion.
        context = CIContext(mtlDevice: device, options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(),
                                                       .workingFormat: CIFormat.RGBAf, .cacheIntermediates: false])
        sources.totalCostLimit = 64 * 1024 * 1024
        coverages.totalCostLimit = 64 * 1024 * 1024
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

    func image(_ image: CGImage, asset: MediaAsset, foreground: SceneItem, target: SceneItem,
               blend: SeamBlend, pixelScale: Double, assets: [String: MediaAsset], targetImage: CGImage) -> CGImage? {
        let layer = foreground.layer
        let wantedScale = max(0.02, pixelScale)
        let scale = wantedScale * min(1, 8192 / max(layer.width * wantedScale, layer.height * wantedScale))
        let w = max(1, Int(ceil(layer.width * scale))), h = max(1, Int(ceil(layer.height * scale)))
        guard let source = source(image, asset: asset, foreground: foreground, width: w, height: h),
              let coverage = coverage(target, foreground: foreground, width: w, height: h, assets: assets, targetImage: targetImage) else { return nil }
        guard let output = graph(source.image, coverage: coverage.image, bounds: coverage.bounds,
                                 foreground: foreground, target: target, blend: blend,
                                 extent: CGRect(x: 0, y: 0, width: w, height: h)) else { return nil }
        return context.createCGImage(output, from: output.extent, format: .RGBA8, colorSpace: HexColor.srgb, deferred: false)
    }

    /// Produces the same seam as `image`, retaining the entire graph on the GPU. Both inputs
    /// are already cropped/masked in the foreground's local y-up pixel coordinates. Bounds
    /// keep the analysis model's y-down convention.
    func graph(_ source: CIImage, coverage: CIImage, bounds: CGRect, foreground: SceneItem,
               target: SceneItem, blend: SeamBlend, extent: CGRect) -> CIImage? {
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
}
