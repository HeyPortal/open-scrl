import SwiftUI

extension EditorController {
    func seamCandidates(for layerID: String) -> [Layer] {
        guard let location = project.locate(layer: layerID), let layer = project.layer(layerID), layer.image?.assetID != nil else { return [] }
        return project.slides[location.slide].layers.filter {
            $0.id != layerID && $0.visible && $0.opacity > 0 && $0.image?.assetID != nil && $0.image?.seamBlend == nil
        }.sorted {
            ($0.frame.center - layer.frame.center).length < ($1.frame.center - layer.frame.center).length
        }
    }

    var canBlendSelectedSeam: Bool {
        selectedSeamPartner != nil
    }

    private var selectedSeamPartner: Layer? {
        guard let layer = selectedLayer, !layer.locked, layer.visible, layer.opacity > 0, selectedLayerIDs.count <= 2 else { return nil }
        let candidates = seamCandidates(for: layer.id)
        if selectedLayerIDs.count == 2 {
            return candidates.first { selectedLayerIDs.contains($0.id) }
        }
        return candidates.first
    }

    func blendSelectedSeam() {
        guard let layer = selectedLayer, let target = selectedSeamPartner else { return }
        startSeamBlend(layer.id, with: target.id)
        showsInspector = true
        inspectorTab = .design
    }

    func startSeamBlend(_ layerID: String, with targetID: String) {
        guard let layer = project.layer(layerID), !layer.locked,
              let target = seamCandidates(for: layerID).first(where: { $0.id == targetID }),
              let location = project.locate(layer: layerID) else { return }
        let dx = (layer.frame.midX - target.frame.midX) / max(1, min(layer.width, target.width))
        let dy = (layer.frame.midY - target.frame.midY) / max(1, min(layer.height, target.height))
        let edge: SeamEdge = abs(dx) >= abs(dy) ? (dx >= 0 ? .left : .right) : (dy >= 0 ? .top : .bottom)
        var placed = layer
        let size = edge.isHorizontal ? min(layer.width, target.width) : min(layer.height, target.height)
        let overlap = clamp(size * 0.18, min(16, size * 0.5), min(192, size * 0.5))
        let intersection = layer.frame.intersection(target.frame)
        if intersection.isNull || intersection.width < 3 || intersection.height < 3 {
            switch edge {
            case .left: placed.x = target.frame.maxX - overlap
            case .right: placed.x = target.frame.minX - placed.width + overlap
            case .top: placed.y = target.frame.maxY - overlap
            case .bottom: placed.y = target.frame.minY - placed.height + overlap
            }
            if edge.isHorizontal && (placed.frame.maxY <= target.frame.minY || placed.frame.minY >= target.frame.maxY) {
                placed.y = target.frame.midY - placed.height / 2
            } else if !edge.isHorizontal && (placed.frame.maxX <= target.frame.minX || placed.frame.minX >= target.frame.maxX) {
                placed.x = target.frame.midX - placed.width / 2
            }
        }
        let shared = placed.frame.intersection(target.frame)
        let crossSize = edge.isHorizontal ? shared.width : shared.height
        placed.image?.seamBlend = SeamBlend(targetLayerID: targetID, edge: edge, width: max(1, min(80, crossSize * 0.65)))
        perform("Blend Seam") { p in
            p.updateLayer(layerID) { $0 = placed }
            // Keep the selected media above its partner so the alpha mask reveals that partner.
            let layers = p.slides[location.slide].layers
            if let source = layers.firstIndex(where: { $0.id == layerID }), let destination = layers.firstIndex(where: { $0.id == targetID }), source < destination {
                let moved = p.slides[location.slide].layers.remove(at: source)
                let targetIndex = p.slides[location.slide].layers.firstIndex { $0.id == targetID }!
                p.slides[location.slide].layers.insert(moved, at: targetIndex + 1)
            }
        }
        selectLayer(layerID)
        updateSeamMatch(layerID, completingCreation: true)
    }

    func removeSeamBlend(_ layerID: String) {
        if analyzingSeamLayerID == layerID { seamAnalysisTask?.cancel(); analyzingSeamLayerID = nil }
        updateLayer(layerID, "Remove Seam Blend") { $0.image?.seamBlend = nil }
    }

    func updateSeamMatch(_ layerID: String, completingCreation: Bool = false) {
        guard let layer = project.layer(layerID), let blend = layer.image?.seamBlend,
              let target = project.layer(blend.targetLayerID), let location = project.locate(layer: layerID),
              let targetLocation = project.locate(layer: target.id), layer.image?.assetID != nil, target.image?.assetID != nil else { return }
        seamAnalysisTask?.cancel()
        analyzingSeamLayerID = layerID
        let edge = blend.edge, media = document.media, assets = project.assetsByID
        let startedProject = project
        let foreground = SceneItem(layer: layer, slideIndex: location.slide, origin: project.globalFrame(of: layer, slide: location.slide).origin)
        let background = SceneItem(layer: target, slideIndex: targetLocation.slide, origin: project.globalFrame(of: target, slide: targetLocation.slide).origin)
        seamAnalysisTask = Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                let source = ExportImageSource(media: media)
                await source.preparePosters(for: [layer.image?.assetID, target.image?.assetID].compactMap { $0.flatMap { assets[$0] } })
                return SeamRenderer.analyze(foreground: foreground, target: background, edge: edge, images: source, assets: assets)
            }.value
            guard let self, !Task.isCancelled else { return }
            defer { self.analyzingSeamLayerID = nil }
            guard let current = self.project.layer(layerID), let currentBlend = current.image?.seamBlend,
                  currentBlend.targetLayerID == target.id, currentBlend.edge == edge,
                  SeamSource(current) == SeamSource(layer), let currentTarget = self.project.layer(target.id),
                  SeamSource(currentTarget) == SeamSource(target) else { return }
            guard let result else {
                self.show("There isn't enough shared detail to match. Adjust the overlap or use the alignment controls.", style: .info)
                return
            }
            if completingCreation, self.project.hasSameContent(as: startedProject), !self.document.isInGesture {
                // Automatic matching belongs to the creation's undo step if no edit intervened.
                self.document.perform("Blend Seam", undoManager: nil) { p in
                    p.updateLayer(layerID) { $0.image?.seamBlend?.analysis = result }
                }
            } else {
                self.updateLayer(layerID, "Match Seam") { $0.image?.seamBlend?.analysis = result }
            }
        }
    }
}
