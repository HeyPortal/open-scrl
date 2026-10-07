import AppKit
import UniformTypeIdentifiers

private struct LayerClipboard: Codable {
    var projectID: String
    var layer: Layer
    var asset: MediaAsset?
}

/// Multi-layer payload. Media bytes travel with the internal type so groups can
/// be pasted into another project without losing their photos. Legacy payloads remain readable.
private struct SelectionClipboard: Codable {
    var projectID: String
    var layers: [Layer]
    var primaryID: String?
    var assets: [MediaAsset]
    var media: [String: Data]
}

extension EditorController {
    private static let imageTypes: [NSPasteboard.PasteboardType] = [
        .png, .tiff, NSPasteboard.PasteboardType(UTType.jpeg.identifier), NSPasteboard.PasteboardType(UTType.heic.identifier),
        NSPasteboard.PasteboardType(UTType.gif.identifier),
    ]

    var canPaste: Bool {
        NSPasteboard.general.availableType(from: [.openSCRLLayer, .fileURL] + Self.imageTypes + [.string]) != nil
    }

    /// Copies the group-expanded selection in slide paint order. A single layer also exposes
    /// the original image, rendered PNG, or text to other applications.
    func copySelection() {
        let layers = project.expandedToGroups(selectedLayerIDs).compactMap { project.layer($0) }
        guard !layers.isEmpty else { return }
        let assetIDs = Set(layers.compactMap { $0.image?.assetID })
        let assets = project.assets.filter { assetIDs.contains($0.id) }
        var media: [String: Data] = [:]
        for asset in assets { media[asset.id] = document.media.data(for: asset) }
        let clip = SelectionClipboard(projectID: project.id, layers: layers, primaryID: selectedLayerID, assets: assets, media: media)
        guard let data = try? JSONEncoder().encode(clip) else { return }
        let item = NSPasteboardItem()
        item.setData(data, forType: .openSCRLLayer)
        if layers.count == 1, let layer = layers.first {
            if let asset = assets.first, let bytes = media[asset.id] {
                item.setData(bytes, forType: NSPasteboard.PasteboardType(asset.contentType))
            }
            if layer.image != nil || layer.shape != nil, let png = renderLayerPNG(layer) {
                item.setData(png, forType: .png)
            }
            if let text = layer.text?.text { item.setString(text, forType: .string) }
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([item])
    }

    func cutSelection() {
        copySelection()
        deleteSelection()
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

        if let data = pasteboard.data(forType: .openSCRLLayer) {
            if let clip = try? JSONDecoder().decode(SelectionClipboard.self, from: data) {
                pasteLayers(clip, slide: slide, local: local)
                return
            }
            if let legacy = try? JSONDecoder().decode(LayerClipboard.self, from: data) {
                let assets = legacy.asset.map { [$0] } ?? []
                var media: [String: Data] = [:]
                if let asset = legacy.asset {
                    media[asset.id] = pasteboard.data(forType: NSPasteboard.PasteboardType(asset.contentType))
                }
                pasteLayers(SelectionClipboard(projectID: legacy.projectID, layers: [legacy.layer],
                                               primaryID: legacy.layer.id, assets: assets, media: media), slide: slide, local: local)
                return
            }
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

    private func pasteLayers(_ clip: SelectionClipboard, slide: Int, local: CGPoint?) {
        guard project.slides.indices.contains(slide), !clip.layers.isEmpty else { return }
        let targetSlideID = project.slides[slide].id
        var layers = Layer.freshCopies(clip.layers)
        let primaryIndex = clip.layers.firstIndex { $0.id == clip.primaryID }
        if let local, let bounds = Geometry.unionBounds(of: layers) {
            let dx = local.x - bounds.midX, dy = local.y - bounds.midY
            for i in layers.indices { layers[i].x += dx; layers[i].y += dy }
        } else if layers.contains(where: { copy in project.slides[slide].layers.contains { $0.x == copy.x && $0.y == copy.y } }) {
            for i in layers.indices { layers[i].x += 24; layers[i].y += 24 }
        }
        let missing = Set(layers.compactMap { $0.image?.assetID }.filter { project.asset($0) == nil })
        if missing.isEmpty {
            finishPaste(layers, assets: [], slideID: targetSlideID, primaryIndex: primaryIndex)
            return
        }
        Task {
            var added: [MediaAsset] = []
            var remapped: [String: String] = [:]
            for asset in clip.assets where missing.contains(asset.id) {
                guard let bytes = clip.media[asset.id], let type = UTType(asset.contentType) else { continue }
                do {
                    var imported = try await MediaImporter.importData(bytes, type: type, name: asset.name, into: document.media)
                    imported.name = asset.name
                    if let existing = (project.assets + added).first(where: { $0.hash == imported.hash }) {
                        remapped[asset.id] = existing.id
                    } else {
                        added.append(imported)
                        remapped[asset.id] = imported.id
                    }
                } catch {
                    show(error.localizedDescription, style: .error)
                }
            }
            for i in layers.indices {
                if let assetID = layers[i].image?.assetID, missing.contains(assetID) {
                    layers[i].image?.assetID = project.asset(assetID) != nil ? assetID : remapped[assetID]
                }
            }
            finishPaste(layers, assets: added, slideID: targetSlideID, primaryIndex: primaryIndex)
        }
    }

    private func finishPaste(_ layers: [Layer], assets: [MediaAsset], slideID: String, primaryIndex: Int?) {
        guard let slide = project.slideIndex(of: slideID) else { return }
        perform("Paste") { p in
            p.assets.append(contentsOf: assets)
            p.slides[slide].layers.append(contentsOf: layers)
        }
        selectLayers(layers.map(\.id), primary: primaryIndex.map { layers[$0].id })
    }

}
