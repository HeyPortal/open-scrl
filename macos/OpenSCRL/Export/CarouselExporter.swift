import Foundation
import CoreGraphics

struct ExportOptions: Sendable {
    var stillFormat: Preferences.StillFormat
    var jpegQuality: Double
    var scale: Double
    var frameRate: Int

    static var current: ExportOptions {
        ExportOptions(stillFormat: Preferences.stillFormat, jpegQuality: Preferences.jpegQuality,
                      scale: Preferences.exportScale, frameRate: Preferences.videoFrameRate)
    }
}

/// Renders slides to files. Static slides become images; slides with GIFs or videos become MP4s.
enum CarouselExporter {
    static func renderStill(_ project: Project, slide index: Int, images: ExportImageSource, scale: Double) -> CGImage? {
        let width = Int((project.format.width * scale).rounded()), height = Int((project.format.height * scale).rounded())
        if let gpu = GPUSceneRenderer.shared,
           let graph = gpu.slide(project, index: index, images: images, scale: scale) {
            let aligned = graph.transformed(by: CGAffineTransform(translationX: 0,
                                    y: Double(height) - project.format.height * scale))
            if let image = gpu.context.createCGImage(aligned, from: CGRect(x: 0, y: 0, width: width, height: height),
                                                     format: .RGBA8, colorSpace: HexColor.srgb) {
                return image
            }
        }
        guard let cg = ImageDecoding.makeContext(width: width, height: height) else { return nil }
        cg.interpolationQuality = .high
        cg.scaleBy(x: scale, y: scale)
        Renderer.drawSlide(project, index: index, cg: cg, images: images)
        return cg.makeImage()
    }

    static func encode(_ image: CGImage, options: ExportOptions) -> Data? {
        if options.stillFormat == .png { return ImageDecoding.pngData(image) }
        // JPEG and HEIC stills are opaque: composite alpha over white before encoding.
        guard let opaque = ExportCompositing.overWhite(image) else { return nil }
        switch options.stillFormat {
        case .png: return ImageDecoding.pngData(image)
        case .jpeg: return ImageDecoding.encode(opaque, type: "public.jpeg", quality: options.jpegQuality)
        case .heic: return ImageDecoding.encode(opaque, type: "public.heic", quality: options.jpegQuality)
        }
    }

    /// File extension a slide exports to.
    static func fileExtension(_ project: Project, slide index: Int, options: ExportOptions) -> String {
        VideoSlideRenderer.isAnimated(project, slide: index) ? "mp4" : options.stillFormat.fileExtension
    }

    /// Writes one slide to `url` (an image, or an MP4 for animated slides when `allowVideo`).
    static func exportSlide(_ project: Project, slide index: Int, media: MediaStore, options: ExportOptions, to url: URL,
                            allowVideo: Bool = true, progress: @escaping @Sendable (Double) -> Void) async throws {
        if allowVideo && VideoSlideRenderer.isAnimated(project, slide: index) {
            try await VideoSlideRenderer.render(project: project, slide: index, media: media, scale: options.scale, fps: options.frameRate, to: url, progress: progress)
            return
        }
        let images = ExportImageSource(media: media)
        await images.preparePosters(for: project.assets)
        guard let image = renderStill(project, slide: index, images: images, scale: options.scale),
              let data = encode(image, options: options) else { throw ExportError.renderFailed }
        try data.write(to: url, options: .atomic)
        progress(1)
    }

    /// Exports every slide, in posting order, into `folder` as 01.png, 02.mp4, …
    static func exportAll(_ project: Project, media: MediaStore, options: ExportOptions, into folder: URL,
                          progress: @escaping @Sendable (_ slide: Int, _ fraction: Double, _ video: Bool) -> Void) async throws -> [URL] {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let images = ExportImageSource(media: media)
        var files: [URL] = []
        for index in project.slides.indices {
            try Task.checkCancellation()
            let number = String(format: "%02d", index + 1)
            if VideoSlideRenderer.isAnimated(project, slide: index) {
                let url = folder.appending(path: "\(number).mp4")
                progress(index, 0, true)
                try await VideoSlideRenderer.render(project: project, slide: index, media: media, scale: options.scale, fps: options.frameRate, to: url) { fraction in
                    progress(index, fraction, true)
                }
                files.append(url)
            } else {
                progress(index, 0, false)
                guard let image = renderStill(project, slide: index, images: images, scale: options.scale),
                      let data = encode(image, options: options) else { throw ExportError.renderFailed }
                let url = folder.appending(path: "\(number).\(options.stillFormat.fileExtension)")
                try data.write(to: url, options: .atomic)
                files.append(url)
                progress(index, 1, false)
            }
        }
        return files
    }

    /// Zips a folder using the system's archiver (the same one Finder's Compress uses).
    static func zip(folder: URL, to destination: URL) throws {
        var coordinatorError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: [.forUploading], error: &coordinatorError) { zipURL in
            do {
                try? FileManager.default.removeItem(at: destination)
                try FileManager.default.copyItem(at: zipURL, to: destination)
            } catch {
                copyError = error
            }
        }
        if let error = coordinatorError ?? copyError { throw error }
    }

    static func safeFileName(_ name: String) -> String {
        let cleaned = name.components(separatedBy: CharacterSet(charactersIn: "/:\\?%*|\"<>")).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Untitled" : cleaned
    }
}
