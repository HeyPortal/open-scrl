import CoreGraphics
import CoreImage

/// The legacy CPU renderer and crop editor can still request a video CGImage. A reusable
/// context performs that bridge only on demand; the normal playback/export path keeps CIImage.
enum VideoImageBridge {
    private static let software = CIContext(options: [.useSoftwareRenderer: true,
                                                     .workingColorSpace: HexColor.srgb,
                                                     .outputColorSpace: HexColor.srgb,
                                                     .cacheIntermediates: false])

    static func cgImage(_ image: CIImage, preferredContext: CIContext? = GPUSceneRenderer.shared?.context) -> CGImage? {
        guard !image.extent.isEmpty, !image.extent.isInfinite else { return nil }
        if let preferredContext,
           let output = preferredContext.createCGImage(image, from: image.extent, format: .RGBA8,
                                                        colorSpace: HexColor.srgb, deferred: false) { return output }
        // The CPU composition fallback must still obtain current pixels if the GPU device
        // failed. Native video/GIF sources do not depend on a custom Metal kernel.
        return software.createCGImage(image, from: image.extent, format: .RGBA8,
                                      colorSpace: HexColor.srgb, deferred: false)
    }
}
