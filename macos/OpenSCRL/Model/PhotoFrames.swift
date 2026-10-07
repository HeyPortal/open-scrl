import Foundation

enum PhotoFrames {
    static func canRearrange(_ layer: Layer) -> Bool {
        layer.visible && layer.image != nil && layer.groupKind != .blend
    }

    /// Contents change; geometry, locking and frame effects stay in place.
    static func setPhoto(_ assetID: String?, in layer: inout Layer) {
        guard layer.image != nil else { return }
        layer.image?.assetID = assetID
        layer.image?.cropOffsetX = 0
        layer.image?.cropOffsetY = 0
        layer.image?.cropScale = 1
        if layer.groupKind == .blend, assetID != nil {
            // Replacing a member keeps its joins, but the old match no longer applies.
            layer.image?.seamBlend?.analysis = nil
        } else {
            layer.image?.seamBlend = nil
        }
    }

    static func shuffledIDs(_ ids: [String], randomIndex: (Int) -> Int = { Int.random(in: 0..<$0) }) -> [String]? {
        guard Set(ids).count > 1 else { return nil }
        for _ in 0..<8 {
            var result = ids
            for i in stride(from: result.count - 1, through: 1, by: -1) {
                result.swapAt(i, randomIndex(i + 1))
            }
            if result != ids { return result }
        }
        var result = ids
        let different = result.firstIndex { $0 != result[0] }!
        result.swapAt(0, different)
        return result
    }

    /// Clear joins into changed ordinary frames, and invalidate matches within blend groups.
    static func updateBlends(in project: inout Project, changedIDs: Set<String>) {
        for slide in project.slides.indices {
            for index in project.slides[slide].layers.indices {
                let layer = project.slides[slide].layers[index]
                guard let blend = layer.image?.seamBlend,
                      changedIDs.contains(layer.id) || changedIDs.contains(blend.targetLayerID) else { continue }
                if layer.groupKind == .blend {
                    project.slides[slide].layers[index].image?.seamBlend?.analysis = nil
                } else {
                    project.slides[slide].layers[index].image?.seamBlend = nil
                }
            }
        }
    }
}
