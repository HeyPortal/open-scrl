import AVFoundation
import ImageIO
import CoreGraphics

enum ImageDecoding {
    /// Decodes an orientation-corrected image whose longest edge is at most `maxPixel` (nil = full size).
    static func decode(_ source: CGImageSource, index: Int = 0, maxPixel: Int?) -> CGImage? {
        var options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        if let maxPixel {
            options[kCGImageSourceThumbnailMaxPixelSize] = maxPixel
        } else if let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any] {
            let w = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0
            let h = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0
            options[kCGImageSourceThumbnailMaxPixelSize] = max(w, h, 1)
        }
        return CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary)
    }

    static func decode(data: Data, maxPixel: Int?) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return decode(source, maxPixel: maxPixel)
    }

    static func videoFrame(url: URL, at seconds: Double = 0, maxPixel: Int?) async -> CGImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        if let maxPixel { generator.maximumSize = CGSize(width: maxPixel, height: maxPixel) }
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
        return try? await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600)).image
    }

    static func pngData(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    static func encode(_ image: CGImage, type: String, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, type as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    /// An sRGB, premultiplied, y-down bitmap context sized in pixels.
    static func makeContext(width: Int, height: Int) -> CGContext? {
        guard let cg = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                 space: HexColor.srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        cg.translateBy(x: 0, y: CGFloat(height))
        cg.scaleBy(x: 1, y: -1)
        return cg
    }
}

/// Frame timing for GIF, animated PNG/WebP, and HEIC sequences.
enum AnimatedImage {
    static func frameDelay(_ source: CGImageSource, index: Int) -> Double {
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any] else { return 0.1 }
        let dictionaries: [(CFString, CFString, CFString)] = [
            (kCGImagePropertyGIFDictionary, kCGImagePropertyGIFUnclampedDelayTime, kCGImagePropertyGIFDelayTime),
            (kCGImagePropertyPNGDictionary, kCGImagePropertyAPNGUnclampedDelayTime, kCGImagePropertyAPNGDelayTime),
            (kCGImagePropertyWebPDictionary, kCGImagePropertyWebPUnclampedDelayTime, kCGImagePropertyWebPDelayTime),
            (kCGImagePropertyHEICSDictionary, kCGImagePropertyHEICSUnclampedDelayTime, kCGImagePropertyHEICSDelayTime),
        ]
        for (dictKey, unclamped, clamped) in dictionaries {
            guard let dict = props[dictKey] as? [CFString: Any] else { continue }
            let value = (dict[unclamped] as? NSNumber)?.doubleValue ?? (dict[clamped] as? NSNumber)?.doubleValue ?? 0
            // Match browsers and the web app: missing delays play at 100 ms, minimum 20 ms.
            return value > 0 ? max(0.02, value) : 0.1
        }
        return 0.1
    }
}

/// Decoded frames of an animated image with their cumulative end times.
final class AnimatedFrames: @unchecked Sendable {
    let frames: [CGImage]
    let ends: [Double]
    var duration: Double { ends.last ?? 0 }

    init?(source: CGImageSource, maxPixel: Int?) {
        let count = CGImageSourceGetCount(source)
        guard count > 0 else { return nil }
        var frames: [CGImage] = []
        var ends: [Double] = []
        var total = 0.0
        for i in 0..<count {
            guard let image = ImageDecoding.decode(source, index: i, maxPixel: maxPixel) else { continue }
            total += AnimatedImage.frameDelay(source, index: i)
            frames.append(image)
            ends.append(total)
        }
        guard !frames.isEmpty else { return nil }
        self.frames = frames
        self.ends = ends
    }

    func frame(at time: Double) -> CGImage {
        guard duration > 0 else { return frames[0] }
        let t = time.truncatingRemainder(dividingBy: duration)
        var lo = 0, hi = ends.count - 1
        while lo < hi {
            let mid = (lo + hi) / 2
            if ends[mid] > t { hi = mid } else { lo = mid + 1 }
        }
        return frames[lo]
    }
}
