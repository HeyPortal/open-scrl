import AVFoundation
import CoreImage
import ImageIO

enum ExportError: LocalizedError {
    case cancelled
    case renderFailed
    case encoderFailed(String)

    var errorDescription: String? {
        switch self {
        case .cancelled: "Export was cancelled."
        case .renderFailed: "A slide couldn’t be rendered."
        case .encoderFailed(let message): "The video couldn’t be encoded. \(message)"
        }
    }
}

/// Decodes a video's frames in order (looping), oriented by the track's transform.
private final class VideoFrameReader {
    private struct Frame {
        let time: Double
        // Retain the decoder's buffer while its lazy Core Image graph is in use.
        let pixels: CVReadOnlyPixelBuffer
        let image: CIImage
    }
    private let asset: AVURLAsset
    private let composition: AVVideoComposition?
    private var reader: AVAssetReader?
    private var provider: AVAssetReaderOutput.Provider<CMReadySampleBuffer<CMSampleBuffer.DynamicContent>>?
    private var current: Frame?
    private var upcoming: Frame?
    let duration: Double

    init(url: URL) async throws {
        asset = AVURLAsset(url: url)
        duration = try await asset.load(.duration).seconds
        composition = try? await AVVideoComposition.videoComposition(withPropertiesOf: asset)
        try await restart()
    }

    private func restart() async throws {
        reader?.cancelReading()
        let reader = try AVAssetReader(asset: asset)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let settings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        let output: AVAssetReaderOutput
        if let composition {
            let composed = AVAssetReaderVideoCompositionOutput(videoTracks: tracks, videoSettings: settings)
            composed.videoComposition = composition
            output = composed
        } else if let track = tracks.first {
            output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        } else {
            throw ExportError.renderFailed
        }
        let provider = reader.outputProvider(for: output)
        try reader.start()
        self.reader = reader
        self.provider = provider
        current = nil
        upcoming = nil
    }

    private func readNext() async throws -> Frame? {
        guard let provider, let sample = try await provider.next() else { return nil }
        let frame: Frame? = sample.withUnsafeSampleBuffer { buffer in
            guard let pixels = CMSampleBufferGetImageBuffer(buffer) else { return nil }
            return Frame(time: sample.presentationTimeStamp.seconds,
                         pixels: CVReadOnlyPixelBuffer(unsafeBuffer: pixels),
                         image: CIImage(cvPixelBuffer: pixels))
        }
        return frame
    }

    func frame(at time: Double) async throws -> CIImage? {
        let t = duration > 0 ? time.truncatingRemainder(dividingBy: duration) : 0
        if let current, t + 0.0005 < current.time { try await restart() }
        while true {
            if upcoming == nil { upcoming = try await readNext() }
            guard let next = upcoming else { break }
            if next.time <= t + 0.0005 || current == nil {
                current = next
                upcoming = nil
                if next.time >= t { break }
            } else {
                break
            }
        }
        return current?.image
    }

    deinit { reader?.cancelReading() }
}

/// Renders a slide containing GIFs or videos to an H.264 MP4. Rendering is offline (faster than
/// real time and frame-exact), unlike the web app's real-time capture.
enum VideoSlideRenderer {
    static let maxDuration = 60.0
    static let defaultDuration = 3.0

    static func duration(of project: Project, slide index: Int) -> Double {
        var duration = defaultDuration
        let assets = project.assetsByID
        for item in project.scene(intersecting: project.viewport(ofSlide: index)) {
            guard let asset = assets[item.layer.image?.assetID ?? ""], asset.mediaKind.isAnimated else { continue }
            duration = max(duration, asset.duration)
        }
        return min(maxDuration, duration)
    }

    static func animatedAssets(in project: Project, slide index: Int) -> [MediaAsset] {
        let assets = project.assetsByID
        var seen = Set<String>()
        return project.scene(intersecting: project.viewport(ofSlide: index)).compactMap { item in
            guard let asset = assets[item.layer.image?.assetID ?? ""], asset.mediaKind.isAnimated, seen.insert(asset.id).inserted else { return nil }
            return asset
        }
    }

    static func isAnimated(_ project: Project, slide index: Int) -> Bool {
        !animatedAssets(in: project, slide: index).isEmpty
    }

    static func render(project: Project, slide index: Int, media: MediaStore, scale: Double, fps: Int,
                       to url: URL, useGPU: Bool = true, progress: @escaping @Sendable (Double) -> Void) async throws {
        let duration = duration(of: project, slide: index)
        let total = max(1, Int((duration * Double(fps)).rounded()))
        // H.264 needs even dimensions.
        let width = Int((project.format.width * scale / 2).rounded()) * 2
        let height = Int((project.format.height * scale / 2).rounded()) * 2
        let pixelScale = Double(width) / project.format.width

        let images = ExportImageSource(media: media)
        var gifs: [String: AnimatedFrames] = [:]
        var videos: [String: VideoFrameReader] = [:]
        for asset in animatedAssets(in: project, slide: index) {
            switch asset.mediaKind {
            case .gif:
                if let data = media.data(for: asset), let source = CGImageSourceCreateWithData(data as CFData, nil),
                   let frames = AnimatedFrames(source: source, maxPixel: Int(max(width, height)) * 2) {
                    gifs[asset.id] = frames
                }
            case .video:
                if let file = media.fileURL(for: asset) { videos[asset.id] = try await VideoFrameReader(url: file) }
            case .image:
                break
            }
        }

        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let bitrate = min(50_000_000, max(fps >= 60 ? 20_000_000 : 12_000_000, Int(Double(width * height * fps) * 0.28)))
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps * 2,
            ],
        ])
        var pixelAttributes = CVPixelBufferCreationAttributes(
            pixelFormatType: CVPixelFormatType(rawValue: kCVPixelFormatType_32BGRA),
            size: CVImageSize(width: width, height: height),
            compatibility: [.metalTexture, .cgImage, .cgBitmapContext])
        pixelAttributes.backing = .ioSurface
        let receiver = writer.inputPixelBufferReceiver(for: input, pixelBufferAttributes: pixelAttributes)
        try writer.start()
        writer.startSession(atSourceTime: .zero)

        let assets = project.assetsByID
        let gpu = useGPU ? GPUSceneRenderer.shared : nil
        do {
            for frame in 0..<total {
                try Task.checkCancellation()
                let time = Double(frame) / Double(fps)
                for (id, frames) in gifs { images.frameOverrides[id] = frames.frame(at: time) }
                for (id, reader) in videos { images.gpuFrameOverrides[id] = try await reader.frame(at: time) }

                guard let pool = receiver.pixelBufferPool else { throw ExportError.encoderFailed(writer.error?.localizedDescription ?? "") }
                let buffer = try pool.makeMutablePixelBuffer()
                let drawn = buffer.withUnsafeBuffer { pixels -> Bool in
                    if let gpu, let graph = gpu.slide(project, index: index, images: images, scale: pixelScale) {
                        let extent = CGRect(x: 0, y: 0, width: width, height: height)
                        // Preserve the CPU path's top edge when H.264's even rounding makes
                        // the output height slightly different from the uniformly scaled slide.
                        let aligned = graph.transformed(by: CGAffineTransform(translationX: 0,
                                                y: CGFloat(height) - CGFloat(project.format.height * pixelScale)))
                        let opaque = aligned.composited(over: CIImage(color: .white)).cropped(to: extent)
                        let destination = CIRenderDestination(pixelBuffer: pixels)
                        destination.isFlipped = true
                        destination.colorSpace = HexColor.srgb
                        destination.alphaMode = .none
                        do {
                            let task = try gpu.context.startTask(toRender: opaque, from: extent,
                                                                to: destination, at: .zero)
                            // AVAssetWriter must not receive a buffer whose GPU writes are in flight.
                            _ = try task.waitUntilCompleted()
                            return true
                        } catch {
                            // Unsupported resources or a GPU render failure use the established
                            // CPU composition, including lazily bridged current video frames.
                        }
                    }
                    CVPixelBufferLockBaseAddress(pixels, [])
                    defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
                    guard let context = CGContext(data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
                                                  bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: HexColor.srgb,
                                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return false }
                    ExportCompositing.fillWhite(context, in: CGRect(x: 0, y: 0, width: width, height: height))
                    context.translateBy(x: 0, y: CGFloat(height))
                    context.scaleBy(x: 1, y: -1)
                    context.scaleBy(x: pixelScale, y: pixelScale)
                    Renderer.drawSlide(project, index: index, cg: context, images: images, assets: assets)
                    return true
                }
                guard drawn else { throw ExportError.renderFailed }
                // Suspends until the encoder can take more frames.
                try await receiver.append(CVReadOnlyPixelBuffer(buffer), with: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(fps)))
                progress(Double(frame + 1) / Double(total))
            }
            receiver.finish()
            await writer.finishWriting()
            if writer.status == .failed { throw ExportError.encoderFailed(writer.error?.localizedDescription ?? "") }
        } catch {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }
}
