import CoreTransferable
import Foundation
import UniformTypeIdentifiers

/// A snapshot taken when a slide leaves the filmstrip. Reordering stays native; other
/// apps receive a full-resolution PNG, including a poster frame for animated media.
struct SlideDragItem: Identifiable, Transferable {
    var id: String
    var project: Project
    var media: MediaStore
    var name: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .png) { item in
            SentTransferredFile(try await item.renderPNG())
        }
    }

    func renderPNG() async throws -> URL {
        guard let index = project.slideIndex(of: id) else { throw ExportError.renderFailed }
        let folder = media.workDirectory.appending(path: "DragExports/\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let number = String(format: "%02d", index + 1)
        let url = folder.appending(path: "\(CarouselExporter.safeFileName(name))-\(number).png")
        let options = ExportOptions(stillFormat: .png, jpegQuality: 1, scale: 1, frameRate: 30)
        do {
            try await CarouselExporter.exportSlide(project, slide: index, media: media, options: options,
                                                   to: url, allowVideo: false) { _ in }
            try Task.checkCancellation()
            return url
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }
}
