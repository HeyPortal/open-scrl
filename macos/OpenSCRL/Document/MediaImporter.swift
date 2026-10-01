import AVFoundation
import CryptoKit
import ImageIO
import UniformTypeIdentifiers

enum MediaImportError: LocalizedError {
    case unsupported(String)
    case unreadable(String)

    var errorDescription: String? {
        switch self {
        case .unsupported(let name): "\(name) isn’t a supported photo, animated image, or video."
        case .unreadable(let name): "\(name) couldn’t be decoded."
        }
    }
}

/// Analyzes and copies a media file into a project's media store.
enum MediaImporter {
    static let supportedTypes: [UTType] = [.image, .movie, .gif]

    static func isSupported(_ url: URL) -> Bool {
        guard let type = contentType(of: url) else { return false }
        return type.conforms(to: .image) || type.conforms(to: .movie) || type.conforms(to: .audiovisualContent)
    }

    static func contentType(of url: URL) -> UTType? {
        (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType) ?? UTType(filenameExtension: url.pathExtension)
    }

    /// SHA-256 of the file contents, streamed so large videos don't load into memory.
    static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 4 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Copies `url` into the store's working folder and describes it. The caller decides whether
    /// the asset is a duplicate (by hash) before adding it to the project.
    static func importFile(at source: URL, into store: MediaStore) async throws -> MediaAsset {
        let accessing = source.startAccessingSecurityScopedResource()
        defer { if accessing { source.stopAccessingSecurityScopedResource() } }
        let name = source.lastPathComponent
        guard let type = contentType(of: source), isSupported(source) else { throw MediaImportError.unsupported(name) }

        let id = UID.make()
        let ext = source.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "bin") : source.pathExtension.lowercased()
        let fileName = "\(id).\(ext)"
        let destination = store.workDirectory.appending(path: fileName)
        try FileManager.default.copyItem(at: source, to: destination)

        do {
            let hash = try sha256(of: destination)
            let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            var asset = MediaAsset(id: id, name: name, fileName: fileName, mime: type.preferredMIMEType ?? "application/octet-stream",
                                   contentType: type.identifier, width: 0, height: 0, size: size, hash: hash, mediaKind: .image, duration: 0)
            if type.conforms(to: .movie) || type.conforms(to: .audiovisualContent) {
                try await describeVideo(destination, into: &asset)
            } else {
                try describeImage(destination, into: &asset)
            }
            store.register(id, fileURL: destination)
            return asset
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    /// Imports raw image data (for example from the pasteboard).
    static func importData(_ data: Data, type: UTType, name: String, into store: MediaStore) async throws -> MediaAsset {
        let temp = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).\(type.preferredFilenameExtension ?? "png")")
        try data.write(to: temp)
        defer { try? FileManager.default.removeItem(at: temp) }
        var asset = try await importFile(at: temp, into: store)
        asset.name = name
        return asset
    }

    private static func describeImage(_ url: URL, into asset: inout MediaAsset) throws {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              var width = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              var height = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue else {
            throw MediaImportError.unreadable(asset.name)
        }
        if let orientation = (props[kCGImagePropertyOrientation] as? NSNumber)?.intValue, (5...8).contains(orientation) {
            swap(&width, &height)
        }
        asset.width = width
        asset.height = height
        let frames = CGImageSourceGetCount(source)
        if frames > 1 {
            let duration = (0..<frames).reduce(0.0) { $0 + AnimatedImage.frameDelay(source, index: $1) }
            asset.mediaKind = .gif
            asset.duration = duration
        }
        // HEIC and friends keep their original bytes; ImageIO decodes them natively.
    }

    private static func describeVideo(_ url: URL, into asset: inout MediaAsset) async throws {
        let movie = AVURLAsset(url: url)
        guard let track = try await movie.loadTracks(withMediaType: .video).first else { throw MediaImportError.unreadable(asset.name) }
        let (naturalSize, transform) = try await track.load(.naturalSize, .preferredTransform)
        let oriented = naturalSize.applying(transform)
        asset.width = abs(oriented.width)
        asset.height = abs(oriented.height)
        asset.duration = try await movie.load(.duration).seconds
        asset.mediaKind = .video
        if asset.width <= 0 || asset.height <= 0 { throw MediaImportError.unreadable(asset.name) }
    }
}
