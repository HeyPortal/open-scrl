import AppKit
import QuartzCore

/// Measures the actual native renderer, compiled with the same optimization as Release.
@main
struct SeamBlendPerformance {
    static func main() {
        guard let gpu = SeamGPU.shared else { fatalError("GPU seam renderer unavailable") }
        print("GPU: \(gpu.deviceName)")
        let asset = MediaAsset(id: "photo", name: "Photo", fileName: "photo.png", mime: "image/png",
                               contentType: "public.png", width: 1080, height: 1350, size: 0,
                               hash: "photo", mediaKind: .image, duration: 0)
        let cg = CGContext(data: nil, width: 256, height: 256, bitsPerComponent: 8, bytesPerRow: 0,
                           space: HexColor.srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        cg.setFillColor(CGColor(srgbRed: 0.5, green: 0.6, blue: 0.7, alpha: 1))
        cg.fill(CGRect(x: 0, y: 0, width: 256, height: 256))
        let image = cg.makeImage()!
        let base = Layer(id: "base", name: "Base", x: 0, y: 0, width: 1080, height: 1350,
                         content: .image(ImageProperties(assetID: asset.id)))
        let front = Layer(id: "front", name: "Front", x: 870, y: 0, width: 1080, height: 1350,
                          content: .image(ImageProperties(assetID: asset.id)))
        let foreground = SceneItem(layer: front, slideIndex: 0, origin: front.frame.origin)
        let target = SceneItem(layer: base, slideIndex: 0, origin: .zero)
        let analysis = SeamAnalysis(foreground: SeamSource(front), background: SeamSource(base), edge: .left,
                                    gain: [0.9, 1.1, 0.95], bias: [0.01, -0.02, 0.02], shiftX: 8, shiftY: 3,
                                    alignmentFound: true, path: (0..<128).map { 0.5 + sin(Double($0) / 20) * 0.1 })
        let assets = [asset.id: asset]
        var checksum = 0
        for backend in ["CPU Classic", "GPU Classic", "Seamless", "Soft", "Organic", "Glow"] { for scale in [1.0, 2.0] {
            var times: [Double] = []
            for step in -2..<10 {
                var blend = SeamBlend(targetLayerID: base.id, width: Double(80 + step * 3), analysis: analysis)
                blend.version = backend.hasSuffix("Classic") ? 1 : SeamBlend.refinedVersion
                blend.style = ["Soft", "Organic", "Glow"].contains(backend) ? .soft : .seamless
                if backend == "Organic" { blend.edgeStyle = .organic }
                if backend == "Glow" { blend.edgeStyle = .glow }
                let start = CACurrentMediaTime()
                autoreleasepool {
                    let result = backend.hasPrefix("CPU")
                        ? SeamRenderer.imageCPU(image, asset: asset, foreground: foreground, target: target,
                                                blend: blend, pixelScale: scale, assets: assets, targetImage: image)!
                        : gpu.image(image, asset: asset, foreground: foreground, target: target,
                                    blend: blend, pixelScale: scale, assets: assets, targetImage: image)!
                    checksum += result.width
                }
                if step >= 0 { times.append((CACurrentMediaTime() - start) * 1000) }
            }
            let median = times.sorted()[times.count / 2]
            print(String(format: "%@ width drag at %.0fx: median %.1f ms, max %.1f ms", backend, scale, median, times.max()!))
        } }
        print("Rendered checksum: \(checksum)")
    }
}
