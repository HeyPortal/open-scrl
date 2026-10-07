import SwiftUI

extension EditorController {
    func blendGroupMembers(containing id: String) -> [Layer] {
        guard let layer = project.layer(id), let group = layer.groupID, layer.groupKind == .blend,
              let location = project.locate(layer: id) else { return [] }
        let members = project.slides[location.slide].layers.filter { $0.groupID == group }
        return members.count >= 2 && members.allSatisfy({ $0.image != nil && $0.groupKind == .blend }) ? members : []
    }

    var selectedBlendGroup: [Layer]? {
        guard let first = selectedLayerIDs.first else { return nil }
        let members = blendGroupMembers(containing: first)
        return !members.isEmpty && Set(members.map(\.id)) == Set(selectedLayerIDs) ? members : nil
    }

    func selectBlendGroup(containing id: String) {
        groupExistingBlend(containing: id)
        let members = blendGroupMembers(containing: id)
        guard !members.isEmpty else { return }
        selectLayers(members.map(\.id), primary: id)
        showsInspector = true; inspectorTab = .design
    }

    /// Old pair effects become a blend group when explicitly picked, without changing pixels.
    func groupExistingBlend(containing id: String) {
        guard project.layer(id)?.groupID == nil, let location = project.locate(layer: id) else { return }
        let members = existingBlendComponent(containing: id)
        guard members.count >= 2, members.allSatisfy({ project.layer($0)?.groupID == nil }) else { return }
        let memberSet = Set(members)
        let positions = project.slides[location.slide].layers.indices.filter { memberSet.contains(project.slides[location.slide].layers[$0].id) }
        // Selecting an old effect must preserve its stacking and appearance. An explicit
        // Blend Photos action can regroup photos separated by other artwork.
        guard positions.last! - positions.first! + 1 == positions.count else { return }
        perform("Group Blended Photos") { p in
            let grouped = p.slides[location.slide].groupLayers(members)
            for member in grouped { p.updateLayer(member) { $0.groupKind = .blend } }
        }
    }

    private func existingBlendComponent(containing id: String) -> [String] {
        guard let location = project.locate(layer: id) else { return [] }
        let layers = project.slides[location.slide].layers
        let photos = Set(layers.filter { $0.image?.assetID != nil }.map(\.id))
        guard photos.contains(id) else { return [] }
        var connected: Set<String> = [id]
        var changed = true
        while changed {
            changed = false
            for layer in layers {
                guard photos.contains(layer.id), let target = layer.image?.seamBlend?.targetLayerID,
                      photos.contains(target), connected.contains(layer.id) || connected.contains(target) else { continue }
                if connected.insert(layer.id).inserted { changed = true }
                if connected.insert(target).inserted { changed = true }
            }
        }
        return layers.map(\.id).filter(connected.contains)
    }

    func seamCandidates(for layerID: String) -> [Layer] {
        guard let location = project.locate(layer: layerID), let layer = project.layer(layerID), layer.image?.assetID != nil else { return [] }
        return project.slides[location.slide].layers.filter { candidate in
            guard candidate.id != layerID, candidate.visible, candidate.opacity > 0, candidate.image?.assetID != nil else { return false }
            if layer.groupKind == .blend, layer.groupID == candidate.groupID,
               let candidateLocation = project.locate(layer: candidate.id), candidateLocation.index >= location.index { return false }
            var current: String? = candidate.id, seen = Set<String>()
            while let id = current, seen.insert(id).inserted {
                if id == layerID { return false }
                current = project.layer(id)?.image?.seamBlend?.targetLayerID
            }
            return true
        }.sorted { ($0.frame.center - layer.frame.center).length < ($1.frame.center - layer.frame.center).length }
    }

    private var blendInputIDs: [String] {
        guard !selectedLayerIDs.isEmpty else { return [] }
        var ids = selectedLayerIDs
        if ids.count == 1 {
            guard let target = seamCandidates(for: ids[0]).first else { return [] }
            ids.append(target.id)
        }
        for id in ids { ids += existingBlendComponent(containing: id).filter { !ids.contains($0) } }
        return project.expandedToGroups(ids)
    }

    var canBlendSelectedSeam: Bool {
        let members = blendInputIDs.compactMap { project.layer($0) }
        return members.count >= 2 && members.allSatisfy { !$0.locked && $0.visible && $0.opacity > 0 && $0.image?.assetID != nil }
    }

    func blendSelectedSeam() {
        guard canBlendSelectedSeam else { return }
        createBlendGroup(blendInputIDs, foregroundID: selectedLayerID)
    }

    func startSeamBlend(_ layerID: String, with targetID: String) {
        guard let layer = project.layer(layerID), !layer.locked,
              let target = seamCandidates(for: layerID).first(where: { $0.id == targetID }) else { return }
        if layer.groupKind == .blend, let group = layer.groupID, group == target.groupID {
            // Editing one join retains the group's selection and all its other joins.
            perform("Blend Join") { $0.updateLayer(layerID) { $0 = Self.placedForBlend($0, over: target) } }
            updateSeamMatch(layerID, completingCreation: true)
            return
        }
        let ids = project.expandedToGroups(existingBlendComponent(containing: layerID) + existingBlendComponent(containing: targetID))
        createBlendGroup(ids, foregroundID: layerID)
    }

    func addPhotoToBlendGroup(_ layerID: String) {
        guard let members = selectedBlendGroup else { return }
        createBlendGroup(project.expandedToGroups(members.map(\.id) + [layerID]), foregroundID: layerID)
    }

    func addAssetToBlendGroup(_ assetID: String) {
        guard let members = selectedBlendGroup, let last = members.last, let asset = project.asset(assetID) else { return }
        let horizontal = members.count < 2 || abs(last.frame.midX - members[0].frame.midX) >= abs(last.frame.midY - members[0].frame.midY)
        let photo = Layer(id: UID.make(), name: asset.name, x: horizontal ? last.frame.maxX : last.x,
                          y: horizontal ? last.y : last.frame.maxY, width: last.height * asset.width / max(1, asset.height),
                          height: last.height, content: .image(ImageProperties(assetID: assetID)))
        createBlendGroup(members.map(\.id) + [photo.id], foregroundID: photo.id, additionalLayer: photo)
    }

    private func createBlendGroup(_ ids: [String], foregroundID: String?, additionalLayer: Layer? = nil) {
        guard let first = ids.first, let location = project.locate(layer: first) else { return }
        let members = ids.compactMap { $0 == additionalLayer?.id ? additionalLayer : project.layer($0) }
        guard members.count >= 2, members.count == ids.count,
              members.allSatisfy({ !$0.locked && $0.visible && $0.opacity > 0 && $0.image?.assetID != nil && ($0.id == additionalLayer?.id || project.locate(layer: $0.id)?.slide == location.slide) }) else { return }
        var ordered: [Layer]
        if members.count == 2, let foreground = members.first(where: { $0.id == foregroundID }) {
            ordered = members.filter { $0.id != foreground.id } + [foreground]
        } else {
            let xs = members.map { $0.frame.midX }, ys = members.map { $0.frame.midY }
            let horizontal = xs.max()! - xs.min()! >= ys.max()! - ys.min()!
            ordered = members.enumerated().sorted { a, b in
                let av = horizontal ? a.element.frame.midX : a.element.frame.midY
                let bv = horizontal ? b.element.frame.midX : b.element.frame.midY
                return av == bv ? a.offset < b.offset : av < bv
            }.map(\.element)
        }
        let groupIDs = Set(members.compactMap(\.groupID))
        let group = groupIDs.count == 1 && members.allSatisfy({ $0.groupKind == .blend && $0.groupID != nil }) ? groupIDs.first! : UID.make()
        ordered[0].image?.seamBlend = nil
        for i in ordered.indices {
            if i > 0 { ordered[i] = Self.placedForBlend(ordered[i], over: ordered[i - 1]) }
            ordered[i].groupID = group; ordered[i].groupKind = .blend
        }
        let selected = Set(ids)
        perform("Blend Photos") { p in
            let layers = p.slides[location.slide].layers
            let top = layers.lastIndex { selected.contains($0.id) }!
            let insertion = layers[..<top].filter { !selected.contains($0.id) }.count
            p.slides[location.slide].layers.removeAll { selected.contains($0.id) }
            p.slides[location.slide].layers.insert(contentsOf: ordered, at: insertion)
            p.slides[location.slide].normalizeSingletonGroups()
        }
        selectLayers(ordered.map(\.id), primary: foregroundID)
        showsInspector = true; inspectorTab = .design
        updateSeamMatches(ordered.dropFirst().map(\.id), completingCreation: true)
    }

    private static func placedForBlend(_ layer: Layer, over target: Layer) -> Layer {
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
        if let old = placed.image?.seamBlend, old.targetLayerID == target.id, old.edge == edge {
            placed.image?.seamBlend?.version = SeamBlend.refinedVersion
        } else {
            let shared = placed.frame.intersection(target.frame)
            let crossSize = edge.isHorizontal ? shared.width : shared.height
            placed.image?.seamBlend = SeamBlend(targetLayerID: target.id, edge: edge, width: max(1, min(80, crossSize * 0.65)))
        }
        return placed
    }

    func removeSeamBlend(_ layerID: String) {
        if analyzingSeamLayerIDs.contains(layerID) || analyzingSeamLayerID == layerID { cancelSeamMatching() }
        updateLayer(layerID, "Remove Seam Blend") { $0.image?.seamBlend = nil }
    }

    func updateBlendGroupMatches() {
        guard let members = selectedBlendGroup else { return }
        updateSeamMatches(members.filter { $0.image?.seamBlend != nil }.map(\.id))
    }

    func updateBlendGroup<T>(_ key: WritableKeyPath<SeamBlend, T>, value: T) {
        guard selectedBlendGroup != nil else { return }
        updateSelection("Change Blend Group") { $0.image?.seamBlend?[keyPath: key] = value }
    }

    func removeBlendGroupEffects() {
        guard selectedBlendGroup != nil else { return }
        cancelSeamMatching()
        updateSelection("Remove Blending") { $0.image?.seamBlend = nil; $0.groupKind = nil }
    }

    func separateBlendGroup() {
        guard selectedBlendGroup != nil else { return }
        cancelSeamMatching()
        updateSelection("Separate Blended Photos") { $0.image?.seamBlend = nil; $0.groupID = nil; $0.groupKind = nil }
    }

    private func cancelSeamMatching() {
        seamAnalysisTask?.cancel(); analyzingSeamLayerID = nil; analyzingSeamLayerIDs = []
    }

    func updateSeamMatch(_ layerID: String, completingCreation: Bool = false) {
        updateSeamMatches([layerID], completingCreation: completingCreation)
    }

    private func updateSeamMatches(_ ids: [String], completingCreation: Bool = false) {
        let startedProject = project
        let requests = ids.filter { id in
            guard let layer = startedProject.layer(id), let blend = layer.image?.seamBlend,
                  let target = startedProject.layer(blend.targetLayerID) else { return false }
            return layer.image?.assetID != nil && target.image?.assetID != nil
        }
        guard !requests.isEmpty else { return }
        let assetIDs = Set(requests.flatMap { id -> [String] in
            guard let layer = startedProject.layer(id), let target = layer.image?.seamBlend?.targetLayerID else { return [] }
            return [layer.image?.assetID, startedProject.layer(target)?.image?.assetID].compactMap { $0 }
        })
        let matchAssets = startedProject.assets.filter { assetIDs.contains($0.id) }
        cancelSeamMatching()
        analyzingSeamLayerID = requests.first; analyzingSeamLayerIDs = Set(requests)
        let media = document.media
        seamAnalysisTask = Task { [weak self] in
            let job = Task.detached(priority: .userInitiated) {
                let source = ExportImageSource(media: media)
                await source.preparePosters(for: matchAssets)
                var results: [String: SeamAnalysis] = [:]
                for id in requests {
                    guard !Task.isCancelled else { break }
                    guard let layer = startedProject.layer(id), let blend = layer.image?.seamBlend,
                          let target = startedProject.layer(blend.targetLayerID), let location = startedProject.locate(layer: id),
                          let targetLocation = startedProject.locate(layer: target.id) else { continue }
                    let foreground = SceneItem(layer: layer, slideIndex: location.slide, origin: startedProject.globalFrame(of: layer, slide: location.slide).origin)
                    let background = SceneItem(layer: target, slideIndex: targetLocation.slide, origin: startedProject.globalFrame(of: target, slide: targetLocation.slide).origin)
                    results[id] = SeamRenderer.analyze(foreground: foreground, target: background, edge: blend.edge, images: source, assets: startedProject.assetsByID)
                }
                return results
            }
            let results = await withTaskCancellationHandler(operation: { await job.value }, onCancel: { job.cancel() })
            guard let self, !Task.isCancelled else { return }
            defer { self.analyzingSeamLayerID = nil; self.analyzingSeamLayerIDs = [] }
            let valid = results.filter { id, result in
                guard let current = self.project.layer(id), let blend = current.image?.seamBlend,
                      let target = self.project.layer(blend.targetLayerID), let original = startedProject.layer(id)?.image?.seamBlend else { return false }
                return blend.targetLayerID == original.targetLayerID && result.matches(current, target, edge: blend.edge)
            }
            guard !valid.isEmpty else {
                self.show("There isn't enough overlap to match. Adjust the photos or use the alignment controls.", style: .info)
                return
            }
            let apply: (inout Project) -> Void = { p in
                for (id, result) in valid {
                    p.updateLayer(id) { $0.image?.seamBlend?.analysis = result; $0.image?.seamBlend?.version = SeamBlend.refinedVersion }
                }
            }
            if completingCreation, self.project.hasSameContent(as: startedProject), !self.document.isInGesture {
                self.document.perform("Blend Photos", undoManager: nil, apply)
            } else { self.perform("Match Blended Photos", apply) }
        }
    }
}
