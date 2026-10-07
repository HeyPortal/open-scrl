import CoreGraphics

/// Shared opaque output compositing. PNG rendering uses its original alpha context.
enum ExportCompositing {
    static func fillWhite(_ context: CGContext, in rect: CGRect) {
        context.saveGState()
        context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.restoreGState()
    }

    static func overWhite(_ image: CGImage) -> CGImage? {
        guard let context = CGContext(data: nil, width: image.width, height: image.height,
                                      bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        fillWhite(context, in: rect)
        context.draw(image, in: rect)
        return context.makeImage()
    }
}
