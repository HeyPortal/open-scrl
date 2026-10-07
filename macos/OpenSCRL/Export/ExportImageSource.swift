import AVFoundation
import CoreGraphics
import CoreImage

/// Full-quality images for export, decoded at the resolution each layer actually needs.
/// Confined to the export task that owns it.
final class ExportImageSource: GPUImageProviding, @unchecked Sendable {
    private let media: MediaStore
    private var cache: [String: (edge: Int, image: CGImage, gpuImage: CIImage)] = [:]
    /// Frames for animated media at the current export time, keyed by asset ID.
    var frameOverrides: [String: CGImage] = [:]
    var gpuFrameOverrides: [String: CIImage] = [:] {
        didSet {
            frameBridges = frameBridges.filter { gpuFrameOverrides[$0.key] === $0.value.source }
        }
    }
    private var frameBridges: [String: (source: CIImage, image: CGImage)] = [:]

    init(media: MediaStore) {
        self.media = media
    }

    func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? {
        if let frame = gpuFrameOverrides[asset.id] {
            if let bridge = frameBridges[asset.id], bridge.source === frame { return bridge.image }
            if let image = VideoImageBridge.cgImage(frame) {
                frameBridges[asset.id] = (frame, image)
                return image
            }
        }
        if let frame = frameOverrides[asset.id] { return frame }
        let full = Int(max(asset.width, asset.height).rounded(.up))
        // Round up to a power of two so layers sharing a photo share one decode.
        var edge = 256
        while CGFloat(edge) < pixelEdge && edge < full { edge *= 2 }
        edge = min(edge, max(1, full))
        if let cached = cache[asset.id], cached.edge >= edge { return cached.image }
        guard asset.mediaKind != .video else { return cache[asset.id]?.image }
        guard let data = media.data(for: asset), let image = ImageDecoding.decode(data: data, maxPixel: edge) else { return nil }
        cache[asset.id] = (edge, image, CIImage(cgImage: image))
        return image
    }

    func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage? {
        if let frame = gpuFrameOverrides[asset.id] { return frame }
        guard let image = image(for: asset, pixelEdge: pixelEdge) else { return nil }
        if let cached = cache[asset.id], cached.image === image { return cached.gpuImage }
        return CIImage(cgImage: image)
    }

    /// Loads first frames for videos (used when a still of an animated slide is needed).
    func preparePosters(for assets: [MediaAsset]) async {
        for asset in assets where asset.mediaKind == .video && cache[asset.id] == nil {
            if let url = media.fileURL(for: asset), let poster = await ImageDecoding.videoFrame(url: url, maxPixel: nil) {
                cache[asset.id] = (Int(max(asset.width, asset.height)), poster,
                                   CIImage(cgImage: poster))
            }
        }
    }
}
