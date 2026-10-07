import AVFoundation
import CoreImage
import ImageIO
import QuartzCore

/// Plays GIFs and videos against the canvas's shared clock. Video buffers remain on the GPU;
/// a CGImage is made lazily only when a CPU renderer or editing overlay requests one.
@MainActor
final class MediaPlayback {
    let assetID: String
    private var frames: AnimatedFrames?
    private var player: AVPlayer?
    private var output: AVPlayerItemVideoOutput?
    private var lastFrame: CGImage?
    private var lastGPUFrame: CIImage?
    private var lastPixelBuffer: CVReadOnlyPixelBuffer?
    private var lastGIFFrame: CGImage?
    private var endObserver: NSObjectProtocol?
    private var readyObserver: NSKeyValueObservation?
    private let startTime: Double
    private var stopped = false
    private var duration = 0.0
    private var synchronizing = false

    init(asset: MediaAsset, media: MediaStore, maxPixel: Int, startTime: Double = CACurrentMediaTime()) {
        assetID = asset.id
        self.startTime = startTime
        switch asset.mediaKind {
        case .gif:
            Task { [weak self] in
                let frames = await Task.detached(priority: .userInitiated) { () -> AnimatedFrames? in
                    guard let data = media.data(for: asset), let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
                    return AnimatedFrames(source: source, maxPixel: maxPixel)
                }.value
                guard let self, !self.stopped else { return }
                self.frames = frames
            }
        case .video:
            guard let url = media.fileURL(for: asset) else { return }
            Task { await startVideo(url: url, maxPixel: maxPixel) }
        case .image:
            break
        }
    }

    private func startVideo(url: URL, maxPixel: Int) async {
        let movie = AVURLAsset(url: url)
        duration = (try? await movie.load(.duration).seconds) ?? 0
        let item = AVPlayerItem(asset: movie)
        // Apply the track's orientation so phone videos aren't sideways.
        if let composition = try? await AVVideoComposition.videoComposition(withPropertiesOf: movie) {
            item.videoComposition = composition
        }
        guard !stopped else { return }
        var attributes = CVPixelBufferAttributes(pixelFormatTypes: [CVPixelFormatType(rawValue: kCVPixelFormatType_32BGRA)],
                                                compatibility: [.metalTexture, .cgImage, .cgBitmapContext])
        attributes.backing = .ioSurface
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: attributes)
        item.add(output)
        let player = AVPlayer(playerItem: item)
        player.automaticallyWaitsToMinimizeStalling = false
        player.isMuted = true
        player.actionAtItemEnd = .none
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.synchronizeVideo() }
        }
        self.output = output
        self.player = player
        readyObserver = player.observe(\.status, options: [.initial, .new]) { [weak self] player, _ in
            if player.status == .readyToPlay {
                Task { @MainActor in await self?.synchronizeVideo() }
            }
        }
    }

    private func synchronizeVideo() async {
        guard !stopped, !synchronizing, let player, player.status == .readyToPlay,
              duration.isFinite, duration > 0 else { return }
        synchronizing = true
        defer { synchronizing = false }
        let elapsed = max(0, CACurrentMediaTime() - startTime).truncatingRemainder(dividingBy: duration)
        _ = await player.seek(to: CMTime(seconds: elapsed, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        guard !stopped, player.status == .readyToPlay else { return }
        let host = CMClockGetTime(CMClockGetHostTimeClock())
        let time = max(0, CACurrentMediaTime() - startTime).truncatingRemainder(dividingBy: duration)
        player.setRate(1, time: CMTime(seconds: time, preferredTimescale: 600), atHostTime: host)
    }

    func currentGPUFrame() -> CIImage? {
        guard !stopped else { return nil }
        if let frames {
            let frame = frames.frame(at: CACurrentMediaTime() - startTime)
            if lastGIFFrame !== frame {
                lastGIFFrame = frame
                lastFrame = frame
                lastGPUFrame = CIImage(cgImage: frame)
            }
            return lastGPUFrame
        }
        if let output {
            if !synchronizing, duration.isFinite, duration > 0, let player {
                let desired = max(0, CACurrentMediaTime() - startTime).truncatingRemainder(dividingBy: duration)
                let actual = player.currentTime().seconds
                if actual.isFinite && abs(actual - desired) > 0.15 {
                    Task { [weak self] in await self?.synchronizeVideo() }
                }
            }
            let time = output.itemTime(forHostTime: CACurrentMediaTime())
            if output.hasNewPixelBuffer(forItemTime: time), let buffer = output.pixelBufferAndDisplayTime(forItemTime: time).pixelBuffer {
                lastPixelBuffer = buffer
                lastGPUFrame = buffer.withUnsafeBuffer { CIImage(cvPixelBuffer: $0) }
                lastFrame = nil
            }
        }
        return lastGPUFrame
    }

    func currentFrame() -> CGImage? {
        guard let image = currentGPUFrame() else { return nil }
        if let lastFrame { return lastFrame }
        let frame = VideoImageBridge.cgImage(image)
        lastFrame = frame
        return frame
    }

    func stop() {
        stopped = true
        readyObserver?.invalidate()
        readyObserver = nil
        player?.pause()
        player = nil
        output = nil
        frames = nil
        lastFrame = nil
        lastGPUFrame = nil
        lastPixelBuffer = nil
        lastGIFFrame = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }
}
