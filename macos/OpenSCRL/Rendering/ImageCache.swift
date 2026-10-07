import Foundation
import CoreGraphics
import CoreImage
import ImageIO
import Observation

/// Tiered, memory-budgeted cache of decoded media for the editor (canvas, thumbnails, library).
/// Main-thread only. Requests for a missing tier return the closest loaded image and decode the
/// right one in the background; `revision` changes when new images arrive so views redraw.
@Observable
final class ImageCache: GPUImageProviding {
    private(set) var revision = 0

    @ObservationIgnored private let media: MediaStore
    @ObservationIgnored private var entries: [String: [Int: Entry]] = [:]
    @ObservationIgnored private var pending: Set<String> = []
    @ObservationIgnored private var clock: UInt64 = 0
    @ObservationIgnored private var totalBytes = 0
    @ObservationIgnored private var revisionScheduled = false

    /// Animated frames currently playing in the editor, keyed by asset ID.
    @ObservationIgnored var playbackFrames: [String: CGImage] = [:]
    @ObservationIgnored var gpuPlaybackFrames: [String: CIImage] = [:] {
        didSet {
            playbackBridges = playbackBridges.filter { gpuPlaybackFrames[$0.key] === $0.value.source }
        }
    }
    @ObservationIgnored private var playbackBridges: [String: (source: CIImage, image: CGImage)] = [:]

    private struct Entry {
        var image: CGImage
        var gpuImage: CIImage
        var bytes: Int
        var lastUse: UInt64
    }

    static let tiers = [256, 512, 1024, 2048, 4096]
    private let budget = 640 * 1024 * 1024

    init(media: MediaStore) {
        self.media = media
    }

    private func tier(for asset: MediaAsset, pixelEdge: CGFloat) -> Int {
        let full = Int(max(asset.width, asset.height).rounded(.up))
        let wanted = Self.tiers.first { CGFloat($0) >= pixelEdge } ?? Self.tiers.last!
        return min(wanted, max(1, full))
    }

    func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? {
        _ = revision
        if let frame = gpuPlaybackFrames[asset.id] {
            if let bridge = playbackBridges[asset.id], bridge.source === frame { return bridge.image }
            if let image = VideoImageBridge.cgImage(frame) {
                playbackBridges[asset.id] = (frame, image)
                return image
            }
        }
        if let frame = playbackFrames[asset.id] { return frame }
        let tier = tier(for: asset, pixelEdge: pixelEdge)
        clock &+= 1
        if var entry = entries[asset.id]?[tier] {
            entry.lastUse = clock
            entries[asset.id]?[tier] = entry
            return entry.image
        }
        load(asset, tier: tier)
        return bestLoaded(asset.id, near: tier)
    }

    func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage? {
        _ = revision
        if let frame = gpuPlaybackFrames[asset.id] { return frame }
        guard let image = image(for: asset, pixelEdge: pixelEdge) else { return nil }
        if let entry = entries[asset.id]?.values.first(where: { $0.image === image }) { return entry.gpuImage }
        return CIImage(cgImage: image)
    }

    /// Synchronous decode for one-off needs such as the Finder thumbnail written on save.
    func imageNow(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? {
        let tier = tier(for: asset, pixelEdge: pixelEdge)
        if let entry = entries[asset.id]?[tier] { return entry.image }
        if asset.mediaKind == .video { return bestLoaded(asset.id, near: tier) }
        guard let data = media.data(for: asset), let image = ImageDecoding.decode(data: data, maxPixel: tier) else { return nil }
        store(image, assetID: asset.id, tier: tier)
        return image
    }

    private func bestLoaded(_ assetID: String, near tier: Int) -> CGImage? {
        guard let loaded = entries[assetID], !loaded.isEmpty else { return nil }
        let below = loaded.keys.filter { $0 <= tier }.max()
        let key = below ?? loaded.keys.min()!
        return loaded[key]?.image
    }

    private func load(_ asset: MediaAsset, tier: Int) {
        let key = "\(asset.id)#\(tier)"
        guard !pending.contains(key) else { return }
        pending.insert(key)
        let media = self.media
        Task.detached(priority: .userInitiated) { [self] in
            let image: CGImage?
            if asset.mediaKind == .video {
                if let url = media.fileURL(for: asset) {
                    image = await ImageDecoding.videoFrame(url: url, maxPixel: tier)
                } else { image = nil }
            } else if let data = media.data(for: asset) {
                image = ImageDecoding.decode(data: data, maxPixel: tier)
            } else {
                image = nil
            }
            await MainActor.run {
                self.pending.remove(key)
                if let image { self.store(image, assetID: asset.id, tier: tier) }
            }
        }
    }

    private func store(_ image: CGImage, assetID: String, tier: Int) {
        let bytes = image.bytesPerRow * image.height
        if let old = entries[assetID]?[tier] { totalBytes -= old.bytes }
        clock &+= 1
        entries[assetID, default: [:]][tier] = Entry(image: image, gpuImage: CIImage(cgImage: image),
                                                   bytes: bytes, lastUse: clock)
        totalBytes += bytes
        evictIfNeeded()
        scheduleRevision()
    }

    /// Coalesces many image arrivals into one redraw.
    private func scheduleRevision() {
        guard !revisionScheduled else { return }
        revisionScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.revisionScheduled = false
            self.revision &+= 1
        }
    }

    private func evictIfNeeded() {
        guard totalBytes > budget else { return }
        var all: [(String, Int, UInt64, Int)] = []
        for (id, tiers) in entries {
            for (tier, entry) in tiers { all.append((id, tier, entry.lastUse, entry.bytes)) }
        }
        all.sort { $0.2 < $1.2 }
        for (id, tier, _, bytes) in all where totalBytes > budget * 3 / 4 {
            // Keep each asset's smallest tier so something can always be drawn.
            if entries[id]?.count == 1 && tier <= 256 { continue }
            entries[id]?[tier] = nil
            totalBytes -= bytes
        }
    }

    func forget(_ assetID: String) {
        for (_, entry) in entries[assetID] ?? [:] { totalBytes -= entry.bytes }
        entries[assetID] = nil
        playbackFrames[assetID] = nil
        gpuPlaybackFrames[assetID] = nil
        playbackBridges[assetID] = nil
    }

    /// Forces a redraw, e.g. when a playback frame changed.
    func bump() { revision &+= 1 }
}
