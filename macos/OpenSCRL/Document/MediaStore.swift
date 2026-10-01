import Foundation
import UniformTypeIdentifiers

/// Holds the bytes of a project's media. Media read from a package stays in its file wrapper;
/// newly imported files are cloned into a private working folder until the project is saved.
/// Assets are never removed during a session so undo can restore them.
final class MediaStore: @unchecked Sendable {
    private let lock = NSLock()
    private var wrappers: [String: FileWrapper] = [:]
    private var files: [String: URL] = [:]
    let workDirectory: URL

    init() {
        workDirectory = FileManager.default.temporaryDirectory
            .appending(path: "OpenSCRL-Media", directoryHint: .isDirectory)
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: workDirectory, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: workDirectory)
    }

    func register(_ assetID: String, wrapper: FileWrapper) {
        lock.withLock { wrappers[assetID] = wrapper }
    }

    func register(_ assetID: String, fileURL: URL) {
        lock.withLock { files[assetID] = fileURL }
    }

    func contains(_ assetID: String) -> Bool {
        lock.withLock { wrappers[assetID] != nil || files[assetID] != nil }
    }

    /// The media bytes (memory-mapped when possible).
    func data(for asset: MediaAsset) -> Data? {
        lock.lock()
        let url = files[asset.id]
        let wrapper = wrappers[asset.id]
        lock.unlock()
        if let url { return try? Data(contentsOf: url, options: .alwaysMapped) }
        guard let wrapper else { return nil }
        lock.lock(); defer { lock.unlock() }
        return wrapper.regularFileContents
    }

    /// A file URL for APIs that need one (AVFoundation, ImageIO by URL). Wrapped media is
    /// written to the working folder the first time it's requested.
    func fileURL(for asset: MediaAsset) -> URL? {
        lock.lock()
        if let url = files[asset.id] { lock.unlock(); return url }
        let wrapper = wrappers[asset.id]
        lock.unlock()
        guard let wrapper else { return nil }
        let url = workDirectory.appending(path: asset.fileName)
        lock.lock(); defer { lock.unlock() }
        if let existing = files[asset.id] { return existing }
        do {
            if !FileManager.default.fileExists(atPath: url.path) {
                guard let data = wrapper.regularFileContents else { return nil }
                try data.write(to: url, options: .atomic)
            }
            files[asset.id] = url
            return url
        } catch {
            return nil
        }
    }

    /// A file wrapper to save into the package's `Media` folder.
    func wrapper(for asset: MediaAsset) -> FileWrapper? {
        lock.lock(); defer { lock.unlock() }
        if let wrapper = wrappers[asset.id] { return wrapper }
        guard let url = files[asset.id], let wrapper = try? FileWrapper(url: url, options: []) else { return nil }
        wrapper.preferredFilename = asset.fileName
        wrappers[asset.id] = wrapper
        return wrapper
    }
}
