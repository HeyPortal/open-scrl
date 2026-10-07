import AppKit
import AVFoundation
import CoreImage
import Darwin
@testable import OpenSCRL

final class GPUFixtures: GPUImageProviding {
    var photos: [String: CGImage] = [:]
    var frames: [String: CIImage] = [:]
    var frameCGRequests = 0
    func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? {
        if frames[asset.id] != nil { frameCGRequests += 1 }
        return photos[asset.id]
    }
    func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage? {
        frames[asset.id] ?? photos[asset.id].map { CIImage(cgImage: $0) }
    }
}

@main
@MainActor
struct GPUSceneChecks {
    static var checks = 0
    static func expect(_ value: Bool, _ message: String) {
        precondition(value, message); checks += 1
    }
    static func asset(_ id: String, video: Bool = false) -> MediaAsset {
        MediaAsset(id: id, name: id, fileName: "\(id).\(video ? "mp4" : "png")", mime: video ? "video/mp4" : "image/png",
                   contentType: video ? "public.mpeg-4" : "public.png", width: 96, height: 64, size: 0,
                   hash: id, mediaKind: video ? .video : .image, duration: video ? 1 : 0)
    }
    static func picture(_ color: (Int, Int) -> SIMD4<Double>) -> CGImage {
        var pixels = SeamRenderer.Pixels(width: 96, height: 64, draw: { _ in })!
        for y in 0..<64 { for x in 0..<96 {
            let v = color(x, y), i = (y * 96 + x) * 4
            for c in 0..<4 { pixels.bytes[i + c] = UInt8(clamp(Int(v[c] * 255), 0, 255)) }
        } }
        return pixels.image()!
    }
    static func layer(_ id: String, x: Double = 12, y: Double = 10, width: Double = 96, height: Double = 64) -> Layer {
        Layer(id: id, name: id, x: x, y: y, width: width, height: height, content: .image(ImageProperties(assetID: id)))
    }
    static func pixels(_ image: CGImage) -> SeamRenderer.Pixels {
        SeamRenderer.Pixels(width: image.width, height: image.height) {
            Renderer.drawImageFlipped(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height), cg: $0)
        }!
    }
    static func gpu(_ project: Project, _ images: GPUFixtures, index: Int = 0, scale: Double = 1,
                    options: RenderOptions = RenderOptions()) -> SeamRenderer.Pixels {
        let renderer = GPUSceneRenderer.shared!
        let graph = renderer.slide(project, index: index, images: images, options: options, scale: scale)!
        return pixels(renderer.context.createCGImage(graph, from: graph.extent, format: .RGBA8, colorSpace: HexColor.srgb)!)
    }
    static func cpu(_ project: Project, _ images: GPUFixtures, index: Int = 0, scale: Double = 1,
                    options: RenderOptions = RenderOptions()) -> SeamRenderer.Pixels {
        SeamRenderer.Pixels(width: Int(project.format.width * scale), height: Int(project.format.height * scale)) {
            $0.scaleBy(x: scale, y: scale)
            Renderer.drawSlide(project, index: index, cg: $0, images: images, options: options)
        }!
    }
    static func compare(_ name: String, project: Project, images: GPUFixtures, scale: Double = 1,
                        limit: Double = 1, output: URL) throws {
        let reference = cpu(project, images, scale: scale), actual = gpu(project, images, scale: scale)
        let difference = zip(reference.bytes, actual.bytes).map { abs(Int($0) - Int($1)) }
        let mean = Double(difference.reduce(0, +)) / Double(difference.count)
        print("\(name) \(scale)x: mean RGBA error \(String(format: "%.3f", mean)); max \(difference.max()!)")
        try ImageDecoding.pngData(actual.image()!)!.write(to: output.appending(path: "\(name)-gpu.png"))
        try ImageDecoding.pngData(reference.image()!)!.write(to: output.appending(path: "\(name)-cpu.png"))
        expect(mean <= limit, "\(name) GPU composition matches the established renderer")
    }
    static func main() async throws {
        setbuf(stdout, nil)
        guard let renderer = GPUSceneRenderer.shared else { fatalError("Shared Metal scene kernels failed to load") }
        print("GPU scene checks on \(renderer.device.name)")
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let images = GPUFixtures()
        let bounded = CGRect(x: 24, y: 0, width: 48, height: 64)
        let backing = CIImage(color: .white).cropped(to: CGRect(x: 0, y: 0, width: 96, height: 64))
        for background in [Background.gradient(from: "#ff0000", to: "#0000ff", angle: 90), .transparent] {
            let graph = renderer.background(background, in: bounded, assets: [:], images: images,
                                            options: RenderOptions(editor: true))!.composited(over: backing)
            let result = pixels(renderer.context.createCGImage(graph, from: backing.extent)!)
            for x in [8.0, 88.0] {
                expect(result.sample(x, 32) == SIMD4(repeating: 255), "Procedural backgrounds stay inside their slide bounds")
            }
        }
        images.photos["pattern"] = picture { x, y in SIMD4(0.2 + Double(x) / 160, 0.2 + Double(y) / 100, 0.5, 1) }
        images.photos["red"] = picture { _, _ in SIMD4(1, 0, 0, 1) }
        images.photos["blue"] = picture { _, _ in SIMD4(0, 0, 1, 1) }
        var project = Project(format: CanvasFormat(name: "GPU", width: 144, height: 104))
        project.assets = [asset("pattern"), asset("red"), asset("blue")]
        project.slides[0].background = .solid("#eeeadf")
        let p3 = CGContext(data: nil, width: 96, height: 64, bitsPerComponent: 8, bytesPerRow: 0,
                           space: CGColorSpace(name: CGColorSpace.displayP3)!,
                           bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        p3.setFillColor(CGColor(colorSpace: p3.colorSpace!, components: [0.9, 0.3, 0.12, 1])!)
        p3.fill(CGRect(x: 0, y: 0, width: 96, height: 64))
        images.photos["p3"] = p3.makeImage()!; project.assets.append(asset("p3"))
        project.slides[0].layers = [layer("p3")]
        try compare("display-p3", project: project, images: images, output: output)
        for mask in ImageMask.allCases {
            var photo = layer("pattern")
            photo.image?.mask = mask; photo.image?.cornerRadius = 9
            photo.image?.stroke = "#ffcc11"; photo.image?.strokeWidth = 3
            photo.image?.cropScale = 1.4; photo.image?.cropOffsetX = 8; photo.image?.cropOffsetY = -5
            photo.rotation = 13; photo.opacity = 0.72
            project.slides[0].layers = [photo]
            for scale in [1.0, 2.0] {
                try compare("mask-\(mask.rawValue)", project: project, images: images, scale: scale, limit: 1, output: output)
            }
        }
        project.slides[0].layers = [layer("pattern")]
        for (name, mask, size, radius, border) in [
            ("gpu-rounded-border", ImageMask.rect, CGSize(width: 96, height: 64), 30.0, 12.0),
            ("gpu-clamped-radius", .rect, CGSize(width: 92.5, height: 47.25), 100.0, 50.0),
            ("gpu-flat-ellipse", .ellipse, CGSize(width: 122.25, height: 14.5), 0.0, 0.0),
            ("ellipse-thick-border", .ellipse, CGSize(width: 96, height: 64), 0.0, 25.0),
            ("gpu-small-rounded", .rect, CGSize(width: 8, height: 8), 4.0, 2.0)
        ] {
            var photo = layer("pattern")
            photo.frame.size = size
            photo.image?.mask = mask
            photo.image?.cornerRadius = radius
            photo.image?.stroke = "#ffcc1180"
            photo.image?.strokeWidth = border
            project.slides[0].layers = [photo]
            for scale in [1.0, 2.0] {
                try compare(name, project: project, images: images, scale: scale, limit: 1, output: output)
            }
        }
        project.slides[0].layers = [layer("pattern")]
        for (name, background) in [("linear", Background.gradient(from: "#ffcc33", to: "#2255cc", angle: 37)),
                                    ("alpha-gradient", .gradient(from: "#ff000000", to: "#0000ffff", angle: 90)),
                                    ("radial", .gradient(.twoColor("#ffcc33", "#2255cc", type: .radial))),
                                    ("blur", .image(BackgroundImage(assetID: "pattern", blur: 9, dim: 0.3))),
                                    ("transparent", .transparent)] {
            project.slides[0].background = background
            try compare(name, project: project, images: images, limit: name == "blur" ? 3 : 1, output: output)
        }
        project.slides[0].background = .white
        var shadow = layer("pattern", x: 22, y: 15, width: 80, height: 60)
        shadow.image?.mask = .heart; shadow.rotation = 17
        shadow.shadow = Shadow(color: "#880044", opacity: 0.6, blur: 12, offsetX: 7, offsetY: 8)
        shadow.opacity = 0.65
        project.slides[0].layers = [shadow]
        try compare("shadow", project: project, images: images, limit: 2, output: output)
        var text = Layer(id: "text", name: "text", x: 5, y: 5, width: 125, height: 48,
                         content: .text(TextProperties(text: "GPU", fontSize: 30, fill: "#00aa44", stroke: "#110044", strokeWidth: 1,
                                                        highlight: TextHighlight(style: .box, color: "#ffcc11", padding: 5, radius: 3))))
        text.rotation = -7; text.shadow = Shadow(blur: 4, offsetY: 3)
        let shape = Layer(id: "shape", name: "shape", x: 60, y: 64, width: 70, height: 25,
                          content: .shape(ShapeProperties(shape: .ellipse, fill: "#ff8844", stroke: "#001133", strokeWidth: 4)))
        project.slides[0].layers = [text, shape]
        try compare("text-shapes", project: project, images: images, limit: 2, output: output)

        var base = layer("red", x: 0, y: 0), front = layer("blue", x: 48, y: 0)
        front.image?.seamBlend = SeamBlend(targetLayerID: base.id, width: 24)
        project.slides[0].layers = [base, front]
        let seam = gpu(project, images)
        expect(seam.sample(8, 32).x > 250 && seam.sample(8, 32).z < 3, "Foreground never leaks beyond its layer bounds")
        expect(seam.sample(72, 32).x > 80 && seam.sample(72, 32).z > 80, "GPU seam mixes both photos")
        try compare("seam", project: project, images: images, output: output)
        images.photos["strip"] = picture { x, _ in x >= 80 ? SIMD4(1, 0, 0, 1) : .zero }
        project.assets.append(asset("strip")); base.image?.assetID = "strip"
        project.slides[0].layers[0] = base
        try compare("alpha-seam", project: project, images: images, output: output)
        expect(gpu(project, images).sample(52, 32).z > 250, "PNG alpha preserves uncovered foreground")
        project.slides[0].layers[1].image?.seamBlend?.width = 8
        try compare("changed-seam", project: project, images: images, output: output)
        project.slides[0].layers[0].visible = false
        expect(gpu(project, images).sample(52, 32).z > 250, "Hidden partner restores intact foreground")
        var large = Project(format: CanvasFormat(name: "Zoom", width: 1500, height: 800))
        large.assets = project.assets
        large.slides[0].layers = [layer("red", x: 0, y: 0, width: 1000, height: 800),
                                   layer("blue", x: 500, y: 0, width: 1000, height: 800)]
        large.slides[0].layers[1].image?.seamBlend = SeamBlend(targetLayerID: "red", width: 100)
        let center = gpu(large, images, options: RenderOptions(editor: true)).sample(750, 400)
        for scale in [2.5, 3.0, 2.5] {
            let value = autoreleasepool { gpu(large, images, scale: scale, options: RenderOptions(editor: true)).sample(750 * scale, 400 * scale) }
            expect(abs(value.x - center.x) < 12 && abs(value.z - center.z) < 12,
                   "Seam bounds stay in model coordinates across capped geometry-cache zooms")
        }

        var cross = Project(format: CanvasFormat(name: "Deck", width: 96, height: 64))
        cross.assets = project.assets
        cross.slides.append(Slide(id: "second", background: .white, layers: []))
        cross.slides[0].layers = [layer("red", x: 70, y: 0)]
        let right = gpu(cross, images, index: 1)
        expect(right.sample(10, 20).x > 250 && right.sample(10, 20).z < 3, "Neighboring slide overflow stays in deck coordinates")
        var options = RenderOptions(); options.hiddenLayerIDs = ["red"]
        expect(gpu(cross, images, index: 1, options: options).sample(10, 20).z > 250, "Editing hidden-layer options survive GPU rendering")

        var live = Project(format: CanvasFormat(name: "Live", width: 144, height: 64))
        live.assets = [asset("a", video: true), asset("b", video: true)]
        let a = layer("a", x: 0, y: 0), b = layer("b", x: 48, y: 0)
        live.slides[0].layers = [a, b]
        live.slides[0].layers[1].image?.seamBlend = SeamBlend(targetLayerID: "a", width: 20)
        images.frames["a"] = CIImage(cgImage: images.photos["red"]!)
        images.frames["b"] = CIImage(cgImage: images.photos["blue"]!)
        _ = gpu(live, images)
        expect(images.frameCGRequests == 0, "Live video composition needs no CGImage or GPU readback")
        images.frames["b"] = CIImage(color: CIColor(red: 0, green: 1, blue: 0)).cropped(to: CGRect(x: 0, y: 0, width: 96, height: 64))
        expect(gpu(live, images).sample(120, 32).y > 250, "Replacement video frames render without a stale poster cache")
        expect(images.frameCGRequests == 0, "Advancing frames remain GPU-native")
        let bridged = VideoImageBridge.cgImage(images.frames["b"]!, preferredContext: nil)!
        expect(pixels(bridged).sample(48, 32).y > 250, "Software fallback can bridge video pixels when the GPU is unavailable")

        try checkCanvas(images: images, output: output)
        try await checkVideo(output)
        print("PASS: \(checks) GPU scene assertions; parity artifacts: \(output.path)")
    }

    static func checkCanvas(images: GPUFixtures, output: URL) throws {
        // Exercise actual layer-backed screen drawing, independently of the bitmap fallback.
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        let document = ProjectDocument(format: CanvasFormat(name: "Native GPU", width: 144, height: 104))
        let photo = asset("pattern")
        document.media.register(photo.id, wrapper: FileWrapper(regularFileWithContents: ImageDecoding.pngData(images.photos[photo.id]!)!))
        document.perform("Canvas fixture", undoManager: nil) { p in
            p.assets = [photo]; p.slides[0].layers = [layer(photo.id)]
        }
        let controller = EditorController(document: document)
        let canvas = CanvasView(frame: CGRect(x: 0, y: 0, width: 500, height: 350))
        canvas.controller = controller
        let window = NSWindow(contentRect: CGRect(x: 80, y: 80, width: 500, height: 350),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "GPU Canvas Checks"; window.contentView = canvas
        window.isReleasedWhenClosed = false
        window.orderFrontRegardless()
        defer { canvas.teardown(); window.close() }
        let until = Date().addingTimeInterval(4)
        repeat {
            canvas.needsDisplay = true
            window.displayIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        } while !canvas.isPresentingMetal && Date() < until
        expect(canvas.isPresentingMetal, "Native layer-backed canvas completes a Metal presentation")

        var scene = document.project
        var offscreen = layer(photo.id, x: -50, y: 30, width: 40, height: 40)
        offscreen.shadow = Shadow(color: "#ff0000", opacity: 1, blur: 0, offsetX: 30, offsetY: 0)
        scene.slides[0].layers = [offscreen]
        let viewport = CGRect(x: 0, y: 0, width: 100, height: 104)
        let graph = canvas.metalComposition(scene, viewport: viewport, images: images,
                                           options: RenderOptions(editor: true), scale: 1)!
        let result = pixels(GPUSceneRenderer.shared!.context.createCGImage(graph, from: graph.extent)!)
        expect(result.sample(10, 50).y < 20 && result.sample(10, 50).z < 20,
               "Offscreen layers retain shadows entering the visible GPU viewport")
        try ImageDecoding.pngData(result.image()!)!.write(to: output.appending(path: "viewport-shadow.png"))
    }

    static func checkVideo(_ output: URL) async throws {
        let inputURL = output.appending(path: "upright-source.mp4")
        try? FileManager.default.removeItem(at: inputURL)
        let writer = try AVAssetWriter(outputURL: inputURL, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264,
                                                                         AVVideoWidthKey: 96, AVVideoHeightKey: 64])
        let receiver = writer.inputPixelBufferReceiver(for: input, pixelBufferAttributes: CVPixelBufferCreationAttributes(
            pixelFormatType: CVPixelFormatType(rawValue: kCVPixelFormatType_32BGRA), size: CVImageSize(width: 96, height: 64),
            compatibility: [.cgBitmapContext]))
        try writer.start(); writer.startSession(atSourceTime: .zero)
        for frame in 0..<10 {
            let buffer = try receiver.pixelBufferPool!.makeMutablePixelBuffer()
            buffer.withUnsafeBuffer { pixels in
                CVPixelBufferLockBaseAddress(pixels, []); defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
                let data = CVPixelBufferGetBaseAddress(pixels)!.assumingMemoryBound(to: UInt8.self)
                for y in 0..<64 { for x in 0..<96 {
                    let i = y * CVPixelBufferGetBytesPerRow(pixels) + x * 4
                    data[i] = y >= 32 ? 220 : 10; data[i + 1] = UInt8(20 + frame * 8)
                    data[i + 2] = y < 32 ? 220 : 10; data[i + 3] = 255
                } }
            }
            try await receiver.append(CVReadOnlyPixelBuffer(buffer), with: CMTime(value: CMTimeValue(frame), timescale: 10))
        }
        receiver.finish(); await writer.finishWriting()
        expect(writer.status == .completed, "Asymmetric video fixture encodes")
        let document = ProjectDocument(format: CanvasFormat(name: "Upright", width: 99, height: 71))
        await EditorController(document: document).importMediaNow([inputURL], placement: .libraryOnly)
        let imported = document.project.assets[0]
        document.perform("Video test", undoManager: nil) { p in
            p.slides[0].background = .transparent
            var photo = layer(imported.id, x: 10, y: 5, width: 80, height: 60)
            photo.image?.mask = .arch; photo.image?.strokeWidth = 2; photo.image?.stroke = "#11ee33"
            photo.shadow = Shadow(blur: 4, offsetY: 3)
            p.slides[0].layers = [photo]
        }
        let gpuURL = output.appending(path: "upright-gpu.mp4"), cpuURL = output.appending(path: "upright-cpu.mp4")
        try await VideoSlideRenderer.render(project: document.project, slide: 0, media: document.media, scale: 1, fps: 10, to: gpuURL) { _ in }
        try await VideoSlideRenderer.render(project: document.project, slide: 0, media: document.media, scale: 1, fps: 10, to: cpuURL, useGPU: false) { _ in }
        for time in [0.2, 0.6] {
            let actual = pixels(await ImageDecoding.videoFrame(url: gpuURL, at: time, maxPixel: nil)!)
            let reference = pixels(await ImageDecoding.videoFrame(url: cpuURL, at: time, maxPixel: nil)!)
            expect(actual.width == 100 && actual.height == 72, "H.264 dimensions retain even rounding")
            let top = actual.sample(50, 20), bottom = actual.sample(50, 53)
            print("Video \(time): GPU top \(top) bottom \(bottom); CPU top \(reference.sample(50, 20)) bottom \(reference.sample(50, 53))")
            try ImageDecoding.pngData(actual.image()!)!.write(to: output.appending(path: "upright-gpu-\(time).png"))
            try ImageDecoding.pngData(reference.image()!)!.write(to: output.appending(path: "upright-cpu-\(time).png"))
            expect(top.x > 150 && top.z < top.x * 0.2 && bottom.z > 150 && bottom.x < bottom.z * 0.2, "Direct GPU writer buffers preserve top/bottom orientation")
            expect(actual.sample(2, 2).x > 245 && actual.sample(2, 2).z > 245, "Transparent MP4 regions flatten over white")
            for (x, y) in [(50.0, 20.0), (50, 53), (15, 35), (88, 35)] {
                let a = actual.sample(x, y), b = reference.sample(x, y)
                expect((0..<3).allSatisfy { abs(a[$0] - b[$0]) < 15 }, "GPU and CPU MP4 crop/mask/colors align")
            }
        }
        let encoded = AVURLAsset(url: gpuURL)
        let duration = try await encoded.load(.duration).seconds
        let tracks = try await encoded.loadTracks(withMediaType: .video)
        let fps = try await tracks[0].load(.nominalFrameRate)
        expect(abs(duration - 3) < 0.11 && abs(fps - 10) < 0.01, "GPU export preserves duration and exact frame rate")
        let snapshot = try await document.snapshot(contentType: .openSCRLProject)
        let wrapper = try ProjectDocument.makeFileWrapper(snapshot, previous: nil)
        try wrapper.write(to: output.appending(path: "GPU Upright.openscrl"), options: .atomic, originalContentsURL: nil)
    }
}
