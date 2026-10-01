import AVFoundation
import ImageIO
import QuartzCore
import VideoToolbox

/// Plays the selected GIF or video in the editor. The canvas pulls `currentFrame()` on each
/// display refresh and draws it through the normal renderer, so crops and rotation still apply.
@MainActor
final class MediaPlayback {
    let assetID: String
    private var frames: AnimatedFrames?
    private var player: AVPlayer?
    private var output: AVPlayerItemVideoOutput?
    private var lastFrame: CGImage?
    private var endObserver: NSObjectProtocol?
    private let startTime = CACurrentMediaTime()
    private var stopped = false

    init(asset: MediaAsset, media: MediaStore, maxPixel: Int) {
        assetID = asset.id
        switch asset.mediaKind {
        case .gif:
            Task { [weak self] in
                let frames = await Task.detached(priority: .userInitiated) { () -> AnimatedFrames? in
                    guard let data = media.data(for: asset), let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
                    return AnimatedFrames(source: source, maxPixel: maxPixel)
                }.value
                self?.frames = frames
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
        let item = AVPlayerItem(asset: movie)
        // Apply the track's orientation so phone videos aren't sideways.
        if let composition = try? await AVVideoComposition.videoComposition(withPropertiesOf: movie) {
            item.videoComposition = composition
        }
        guard !stopped else { return }
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: CVPixelBufferAttributes(pixelFormatTypes: [CVPixelFormatType(rawValue: kCVPixelFormatType_32BGRA)]))
        item.add(output)
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.actionAtItemEnd = .none
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak player] _ in
            player?.seek(to: .zero)
            player?.play()
        }
        self.output = output
        self.player = player
        player.play()
    }

    func currentFrame() -> CGImage? {
        if let frames { return frames.frame(at: CACurrentMediaTime() - startTime) }
        if let output {
            let time = output.itemTime(forHostTime: CACurrentMediaTime())
            if output.hasNewPixelBuffer(forItemTime: time), let buffer = output.pixelBufferAndDisplayTime(forItemTime: time).pixelBuffer {
                let image: CGImage? = buffer.withUnsafeBuffer { pixels in
                    var image: CGImage?
                    VTCreateCGImageFromCVPixelBuffer(pixels, options: nil, imageOut: &image)
                    return image
                }
                if let image { lastFrame = image }
            }
        }
        return lastFrame
    }

    func stop() {
        stopped = true
        player?.pause()
        player = nil
        output = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }
}
