import Foundation

extension EditorController {
    var canShufflePhotos: Bool {
        let ids = selectedSlide?.layers.filter { PhotoFrames.canRearrange($0) }.compactMap { $0.image?.assetID } ?? []
        return Set(ids).count > 1
    }

    @discardableResult
    func shufflePhotos() -> Bool {
        guard let slide = selectedSlide else { return false }
        let frames = slide.layers.filter { PhotoFrames.canRearrange($0) && $0.image?.assetID != nil }
        guard let shuffled = PhotoFrames.shuffledIDs(frames.compactMap { $0.image?.assetID }) else { return false }
        perform("Shuffle Photos") { p in
            for (index, frame) in frames.enumerated() {
                p.updateLayer(frame.id) { PhotoFrames.setPhoto(shuffled[index], in: &$0) }
            }
            PhotoFrames.updateBlends(in: &p, changedIDs: Set(frames.map(\.id)))
        }
        return true
    }

    func canSwapPhotos(_ sourceID: String, _ targetID: String) -> Bool {
        guard sourceID != targetID, let source = project.layer(sourceID), let target = project.layer(targetID),
              PhotoFrames.canRearrange(source), PhotoFrames.canRearrange(target) else { return false }
        return source.image?.assetID != target.image?.assetID
    }

    @discardableResult
    func swapPhotos(_ sourceID: String, _ targetID: String) -> Bool {
        guard canSwapPhotos(sourceID, targetID), let source = project.layer(sourceID), let target = project.layer(targetID) else { return false }
        let sourceAsset = source.image?.assetID, targetAsset = target.image?.assetID
        perform(sourceAsset != nil && targetAsset != nil ? "Swap Photos" : "Move Photo") { p in
            p.updateLayer(sourceID) { PhotoFrames.setPhoto(targetAsset, in: &$0) }
            p.updateLayer(targetID) { PhotoFrames.setPhoto(sourceAsset, in: &$0) }
            PhotoFrames.updateBlends(in: &p, changedIDs: [sourceID, targetID])
        }
        return true
    }

    /// The first photo replaces the target, then the remaining photos fill empty frames.
    @discardableResult
    func assignPhotos(_ assets: [MediaAsset], to layerID: String) -> Int {
        guard !assets.isEmpty, let location = project.locate(layer: layerID), project.layer(layerID)?.image != nil else { return 0 }
        let targets = [layerID] + project.slides[location.slide].layers.filter {
            $0.id != layerID && $0.visible && $0.isEmptyImageSlot && $0.groupKind != .blend
        }.map(\.id)
        let assignments = Array(zip(targets, assets))
        perform(assignments.count == 1 ? "Replace Photo" : "Place Photos") { p in
            for (id, asset) in assignments {
                p.updateLayer(id) { PhotoFrames.setPhoto(asset.id, in: &$0) }
            }
            PhotoFrames.updateBlends(in: &p, changedIDs: Set(assignments.map { $0.0 }))
        }
        return assignments.count
    }
}
