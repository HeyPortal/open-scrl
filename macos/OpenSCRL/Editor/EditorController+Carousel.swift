import Foundation

/// Seamless-carousel helpers: photos that span several slides, and building slides from media.
extension EditorController {
    /// How many slides a photo should span to keep its proportions (1 for ordinary photos).
    func slideSpan(for asset: MediaAsset) -> Int {
        // Only true panoramas (at least ~2.4 slides wide) span; ordinary landscape photos are cropped.
        let slides = (asset.width / max(1, asset.height)) / project.format.aspectRatio
        return slides >= 2.4 ? min(Int(slides.rounded()), 20) : 1
    }

    /// A photo layer covering `span` slides starting at the slide's left edge.
    private func spanningLayer(_ asset: MediaAsset, span: Int) -> Layer {
        let f = project.format
        let name = span > 1 ? "Panorama" : asset.mediaKind == .video ? "Video" : asset.mediaKind == .gif ? "Animation" : "Photo"
        return Layer(id: UID.make(), name: name, x: 0, y: 0, width: f.width * Double(span), height: f.height,
                     content: .image(ImageProperties(assetID: asset.id)))
    }

    /// Spreads a photo edge to edge across consecutive slides, adding slides when needed, so a
    /// swipe through the carousel reveals it as one continuous image.
    func spreadAcrossSlides(_ asset: MediaAsset, span requested: Int? = nil) {
        let span = max(2, requested ?? slideSpan(for: asset))
        let start = selectedSlideIndex
        let layer = spanningLayer(asset, span: span)
        perform("Spread Photo Across Slides") { p in
            while p.slides.count < start + span { p.slides.append(.blank()) }
            p.slides[start].layers.append(layer)
        }
        selectLayer(layer.id)
        show("Spread across slides \(start + 1)–\(start + span). Move it to choose what lands on each slide.", style: .success)
    }

    /// Imports media and gives each item its own full-bleed slide. Wide panoramas span as many
    /// slides as their proportions need.
    func importAsSlides(_ urls: [URL]) async {
        isImporting = true
        defer { isImporting = false }
        var assets: [MediaAsset] = []
        var added: [MediaAsset] = []
        var failed = 0
        for url in urls where MediaImporter.isSupported(url) {
            do {
                let asset = try await MediaImporter.importFile(at: url, into: document.media)
                if let existing = (project.assets + added).first(where: { $0.hash == asset.hash }) {
                    assets.append(existing)
                } else {
                    added.append(asset)
                    assets.append(asset)
                }
            } catch {
                failed += 1
            }
        }
        guard !assets.isEmpty else {
            if failed > 0 { show("Couldn’t import those files.", style: .error) }
            return
        }
        var slides: [Slide] = []
        for asset in assets {
            let span = slideSpan(for: asset)
            var group = (0..<span).map { _ in Slide.blank() }
            group[0].layers = [spanningLayer(asset, span: span)]
            slides += group
        }
        let insertAt = selectedSlideIndex + 1
        perform(added.count == 1 ? "Import Media" : "Import \(max(1, added.count)) Media Files") { p in
            p.assets += added
            if p.slides.count == 1 && p.slides[0].layers.isEmpty {
                slides[0].background = p.slides[0].background
                p.slides = slides
            } else {
                p.slides.insert(contentsOf: slides, at: min(insertAt, p.slides.count))
            }
        }
        if let first = slides.first { focusSlide(first.id) }
        let count = slides.count
        show("Created \(count) slide\(count == 1 ? "" : "s") from \(assets.count) item\(assets.count == 1 ? "" : "s")\(failed > 0 ? " · \(failed) couldn’t be read" : "").", style: failed > 0 ? .warning : .success)
    }
}
