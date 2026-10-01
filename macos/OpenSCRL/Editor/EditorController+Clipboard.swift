import AppKit
import UniformTypeIdentifiers

private struct LayerClipboard: Codable {
    var projectID: String
    var layer: Layer
    var asset: MediaAsset?
}

extension EditorController {
    private static let imageTypes: [NSPasteboard.PasteboardType] = [
        .png, .tiff, NSPasteboard.PasteboardType(UTType.jpeg.identifier), NSPasteboard.PasteboardType(UTType.heic.identifier),
        NSPasteboard.PasteboardType(UTType.gif.identifier),
    ]

    var canPaste: Bool {
        NSPasteboard.general.availableType(from: [.openSCRLLayer, .fileURL] + Self.imageTypes + [.string]) != nil
    }

    /// Copies the selected layer for pasting here or in another project. Photos also carry their
    /// original media and a rendered PNG so they paste into other apps; text carries its string.
    func copySelection() {
        guard let layer = selectedLayer else { return }
        let asset = project.asset(layer.image?.assetID)
        let item = NSPasteboardItem()
        if let data = try? JSONEncoder().encode(LayerClipboard(projectID: project.id, layer: layer, asset: asset)) {
            item.setData(data, forType: .openSCRLLayer)
        }
        if let asset, let bytes = document.media.data(for: asset) {
            item.setData(bytes, forType: NSPasteboard.PasteboardType(asset.contentType))
        }
        if layer.image != nil || layer.shape != nil, let png = renderLayerPNG(layer) {
            item.setData(png, forType: .png)
        }
        if let text = layer.text?.text { item.setString(text, forType: .string) }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([item])
    }

    private func renderLayerPNG(_ layer: Layer) -> Data? {
        let scale = min(1, 4096 / max(layer.width, layer.height))
        let w = max(1, Int(layer.width * scale)), h = max(1, Int(layer.height * scale))
        guard let cg = ImageDecoding.makeContext(width: w, height: h) else { return nil }
        cg.scaleBy(x: scale, y: scale)
        var flat = layer
        flat.rotation = 0
        flat.opacity = 1
        flat.visible = true
        let images = ExportImageSource(media: document.media)
        Renderer.drawLayer(flat, origin: .zero, cg: cg, assets: project.assetsByID, images: images, options: RenderOptions())
        return cg.makeImage().flatMap(ImageDecoding.pngData)
    }

    /// Pastes layers, media files, images or text. `center` is a global deck point (or nil to
    /// paste into the selected slide).
    func paste(at center: CGPoint?) {
        let pasteboard = NSPasteboard.general
        let slide = center.map { clamp(Int($0.x / project.format.width), 0, project.slides.count - 1) } ?? selectedSlideIndex
        let local = center.map { CGPoint(x: $0.x - Double(slide) * project.format.width, y: $0.y) }

        if let data = pasteboard.data(forType: .openSCRLLayer), let clip = try? JSONDecoder().decode(LayerClipboard.self, from: data) {
            var layer = clip.layer
            layer.id = UID.make()
            if let local {
                layer.x = local.x - layer.width / 2
                layer.y = local.y - layer.height / 2
            } else if project.slides[slide].layers.contains(where: { $0.x == layer.x && $0.y == layer.y }) {
                layer.x += 24
                layer.y += 24
            }
            if let assetID = layer.image?.assetID, project.asset(assetID) == nil {
                // Pasting a photo from another project: bring its media along.
                if let asset = clip.asset, let bytes = pasteboard.data(forType: NSPasteboard.PasteboardType(asset.contentType)),
                   let type = UTType(asset.contentType) {
                    Task {
                        do {
                            var imported = try await MediaImporter.importData(bytes, type: type, name: asset.name, into: document.media)
                            imported.name = asset.name
                            let existing = project.assets.first { $0.hash == imported.hash }
                            layer.image?.assetID = (existing ?? imported).id
                            perform("Paste") { p in
                                if existing == nil { p.assets.append(imported) }
                                if p.slides.indices.contains(slide) { p.slides[slide].layers.append(layer) }
                            }
                            selectLayer(layer.id)
                        } catch {
                            show(error.localizedDescription, style: .error)
                        }
                    }
                    return
                }
                layer.image?.assetID = nil
            }
            insert(layer, name: "Paste", slide: slide)
            return
        }

        let placement = MediaPlacement.add(slide: slide, center: center)
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            importMedia(urls, placement: placement)
            return
        }
        for type in Self.imageTypes {
            if let data = pasteboard.data(forType: type), let utType = UTType(type.rawValue) {
                Task { await importImageData(data, type: utType, name: "Pasted Image", placement: placement) }
                return
            }
        }
        if let string = pasteboard.string(forType: .string), !string.isEmpty {
            beginGesture()
            addText(TextPreset(name: "Text", text: string, size: 72, weight: 600))
            if let local, let id = selectedLayerID, let layer = selectedLayer {
                updateLayer(id, "Paste") { $0.x = local.x - layer.width / 2; $0.y = local.y - layer.height / 2 }
            }
            endGesture("Paste")
        }
    }
}
