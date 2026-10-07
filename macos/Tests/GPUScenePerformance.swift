import AppKit
import CoreImage
import CoreVideo
import QuartzCore

/// A release-optimized end-to-end composition benchmark. It includes building each GPU
/// graph, issuing the render and waiting for completed pixel-buffer output, but excludes
/// media decode, disk writes, video encoding and AppKit selection chrome.
@main
struct GPUScenePerformance {
    final class Fixtures: GPUImageProviding {
        var photos: [String: CGImage] = [:]
        var gpuPhotos: [String: CIImage] = [:]
        func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? { photos[asset.id] }
        func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage? { gpuPhotos[asset.id] }
    }

    struct Timing {
        var median: Double
        var maximum: Double
    }

    static func makeBuffer(width: Int, height: Int) -> CVPixelBuffer {
        let attributes: [String: Any] = [kCVPixelBufferIOSurfacePropertiesKey as String: [:],
                                       kCVPixelBufferMetalCompatibilityKey as String: true,
                                       kCVPixelBufferCGImageCompatibilityKey as String: true,
                                       kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
        var buffer: CVPixelBuffer?
        precondition(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
                                        attributes as CFDictionary, &buffer) == kCVReturnSuccess)
        precondition(CVPixelBufferGetIOSurface(buffer!) != nil, "Output must have an IOSurface backing")
        return buffer!
    }

    static func fixture() -> (Project, Fixtures) {
        var project = Project(format: CanvasFormat(name: "Benchmark", width: 1080, height: 1350))
        let provider = Fixtures()
        let masks: [ImageMask] = [.rect, .ellipse, .hexagon, .arch, .blob, .star]
        let angles: [Double] = [-12, 8, -7, 13, -9, 6]
        for index in 0..<6 {
            let id = "photo-\(index)"
            let asset = MediaAsset(id: id, name: id, fileName: "\(id).png", mime: "image/png",
                                   contentType: "public.png", width: 1600, height: 1200, size: 0,
                                   hash: id, mediaKind: .image, duration: 0)
            let cg = CGContext(data: nil, width: 1600, height: 1200, bitsPerComponent: 8,
                               bytesPerRow: 0, space: HexColor.srgb,
                               bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            let colors: [[String]] = [["#2a8790", "#d3c2a0"], ["#da7a58", "#22314d"],
                                      ["#658643", "#a4d4e4"], ["#905189", "#e3b060"],
                                      ["#26456e", "#90d8bc"], ["#b66b3a", "#d8d1b5"]]
            let gradient = Renderer.cgGradient(.twoColor(colors[index][0], colors[index][1]))!
            cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 1600, y: 1200),
                                  options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            for stripe in 0..<32 {
                cg.setFillColor(CGColor(srgbRed: Double((stripe + index) % 5) / 5,
                                        green: Double((stripe * 2 + index) % 7) / 7,
                                        blue: Double((stripe * 3 + index) % 9) / 9, alpha: 0.24))
                cg.fillEllipse(in: CGRect(x: Double(stripe * 67 % 1600), y: Double(stripe * 107 % 1200),
                                          width: 180, height: 140))
            }
            let image = cg.makeImage()!
            provider.photos[id] = image
            provider.gpuPhotos[id] = CIImage(cgImage: image, options: [.colorSpace: HexColor.srgb])
            project.assets.append(asset)
            let props = ImageProperties(assetID: id, cornerRadius: 38, cropOffsetX: Double(index % 3 - 1) * 36,
                                        cropOffsetY: Double(index % 2) * 20, cropScale: 1.12 + Double(index) * 0.03,
                                        mask: masks[index], stroke: "#ffffff", strokeWidth: 6)
            project.slides[0].layers.append(Layer(id: "layer-\(index)", name: "Photo \(index + 1)",
                                                  x: index % 2 == 0 ? 32 : 430,
                                                  y: Double(index / 2) * 365 + 55,
                                                  width: 600, height: 460, rotation: angles[index],
                                                  opacity: 0.88 + Double(index % 3) * 0.06,
                                                  shadow: Shadow(color: "#10172a", opacity: 0.48,
                                                                 blur: 32, offsetX: 7, offsetY: 14),
                                                  content: .image(props)))
        }
        project.slides[0].background = .gradient(.twoColor("#f3e8d9", "#9baebb", angle: 145))
        return (project, provider)
    }

    static func moved(_ base: Project, frame: Int) -> Project {
        var project = base
        // Geometry changes force a new composition while retaining decoded/static inputs.
        for index in project.slides[0].layers.indices {
            project.slides[0].layers[index].x += sin(Double(frame + index) / 3) * 7
            project.slides[0].layers[index].rotation += sin(Double(frame + index) / 5) * 2
        }
        return project
    }

    static func measure(_ draw: (Int) throws -> Void) rethrows -> Timing {
        var samples: [Double] = []
        for frame in -5..<10 {
            let start = CACurrentMediaTime()
            try autoreleasepool { try draw(frame) }
            if frame >= 0 { samples.append((CACurrentMediaTime() - start) * 1000) }
        }
        let ordered = samples.sorted()
        return Timing(median: (ordered[4] + ordered[5]) / 2, maximum: ordered.last!)
    }

    static func checksum(_ buffer: CVPixelBuffer) -> UInt64 {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let pixels = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
        let row = CVPixelBufferGetBytesPerRow(buffer)
        var sum: UInt64 = 0
        for y in stride(from: 0, to: CVPixelBufferGetHeight(buffer), by: 97) {
            for x in stride(from: 0, to: CVPixelBufferGetWidth(buffer), by: 83) {
                for channel in 0..<4 { sum += UInt64(pixels[y * row + x * 4 + channel]) }
            }
        }
        return sum
    }

    static func main() throws {
        guard let renderer = GPUSceneRenderer.shared else { fatalError("GPU scene renderer unavailable") }
        let (project, provider) = fixture()
        print("GPU: \(renderer.device.name)")
        print("Scene: six decoded 1600×1200 photos, crop/fit, six masks, borders, rotation, opacity, blurred shadows, gradient background")
        print("Method: Release -O/WMO, five warmups + ten moving frames, reusable IOSurface-backed BGRA outputs; GPU graph build + completed render included")
        for scale in [1.0, 2.0] {
            let width = Int(project.format.width * scale), height = Int(project.format.height * scale)
            let cpuBuffer = makeBuffer(width: width, height: height)
            let gpuBuffer = makeBuffer(width: width, height: height)
            CVPixelBufferLockBaseAddress(cpuBuffer, [])
            let cg = CGContext(data: CVPixelBufferGetBaseAddress(cpuBuffer), width: width, height: height,
                               bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(cpuBuffer),
                               space: HexColor.srgb,
                               bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
            cg.translateBy(x: 0, y: Double(height))
            cg.scaleBy(x: scale, y: -scale)
            let cpu = measure { frame in
                let state = moved(project, frame: frame)
                cg.clear(CGRect(origin: .zero, size: project.format.size))
                Renderer.drawSlide(state, index: 0, cg: cg, images: provider)
            }
            CVPixelBufferUnlockBaseAddress(cpuBuffer, [])

            let destination = CIRenderDestination(pixelBuffer: gpuBuffer)
            destination.isFlipped = true
            destination.alphaMode = .premultiplied
            destination.colorSpace = HexColor.srgb
            let gpu = try measure { frame in
                let state = moved(project, frame: frame)
                guard let image = renderer.slide(state, index: 0, images: provider, scale: scale) else {
                    fatalError("GPU graph unavailable")
                }
                let task = try renderer.context.startTask(toRender: image, to: destination)
                _ = try task.waitUntilCompleted()
            }
            let cpuChecksum = checksum(cpuBuffer), gpuChecksum = checksum(gpuBuffer)
            precondition(cpuChecksum > 0 && gpuChecksum > 0, "Every backend must produce actual output")
            print(String(format: "%.0fx %d×%d CPU: median %.2f ms, max %.2f ms", scale, width, height, cpu.median, cpu.maximum))
            print(String(format: "%.0fx %d×%d GPU: median %.2f ms, max %.2f ms (%.2f× faster)",
                         scale, width, height, gpu.median, gpu.maximum, cpu.median / gpu.median))
            print("Output checksums: CPU \(cpuChecksum), GPU \(gpuChecksum)")
        }
    }
}
