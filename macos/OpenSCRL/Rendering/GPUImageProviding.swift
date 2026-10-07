import CoreGraphics
import CoreImage

/// Supplies Core Image sources without forcing decoded video frames through a CGImage.
/// Existing photo providers remain valid through the default CGImage bridge.
protocol GPUImageProviding: ImageProviding {
    func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage?
}

extension GPUImageProviding {
    func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage? {
        image(for: asset, pixelEdge: pixelEdge).map { CIImage(cgImage: $0) }
    }
}

enum GPUImageSource {
    static func image(for asset: MediaAsset, pixelEdge: CGFloat, images: ImageProviding?) -> CIImage? {
        if let provider = images as? GPUImageProviding { return provider.gpuImage(for: asset, pixelEdge: pixelEdge) }
        return images?.image(for: asset, pixelEdge: pixelEdge).map { CIImage(cgImage: $0) }
    }
}
