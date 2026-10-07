import Foundation
import CoreGraphics

extension EditorController {
    var selectedLayers: [Layer] { selectedLayerIDs.compactMap { project.layer($0) } }
    var hasMultipleSelection: Bool { selectedLayerIDs.count > 1 }

    func selectLayers(_ ids: [String], primary: String? = nil) {
        var seen = Set<String>()
        let valid = ids.filter { project.locate(layer: $0) != nil && seen.insert($0).inserted }
        let primaryID = primary.flatMap { valid.contains($0) ? $0 : nil } ?? valid.last
        guard let primaryID, let loc = project.locate(layer: primaryID) else { selectLayer(nil); return }
        selectedLayerIDs = valid.filter { project.locate(layer: $0)?.slide == loc.slide }
        selectedLayerID = primaryID
        selectedSlideID = project.slides[loc.slide].id
        if selectedLayerIDs.count != 1 || primaryID != editingTextLayerID { editingTextLayerID = nil }
        if selectedLayerIDs.count != 1 || primaryID != cropLayerID { cropLayerID = nil }
    }

    func selectAllLayers() {
        selectLayers(selectedSlide?.layers.filter { !$0.locked && $0.visible }.map(\.id) ?? [])
    }

    /// First existing ID chooses the slide; unrelated-slide IDs are ignored by Slide helpers.
    private func actionSlide(_ ids: [String]) -> Int? {
        ids.compactMap { project.locate(layer: $0)?.slide }.first
    }

    func deleteLayers(_ ids: [String]) {
        if let slide = actionSlide(ids) {
            perform("Delete Layers") { $0.slides[slide].deleteLayers(ids) }
        }
        selectLayer(nil)
        endModes()
    }

    @discardableResult
    func duplicateLayers(_ ids: [String]) -> [String] {
        guard let slide = actionSlide(ids) else { return [] }
        let sources = project.slides[slide].expandedToGroups(ids)
        let primary = selectedLayerID
        var mapping: [String: String] = [:]
        perform("Duplicate Layers") { mapping = $0.slides[slide].duplicateLayers(sources) }
        let copies = sources.compactMap { mapping[$0] }
        selectLayers(copies, primary: primary.flatMap { mapping[$0] })
        return copies
    }

    @discardableResult
    func duplicateSelection() -> [String] { duplicateLayers(selectedLayerIDs) }

    var canGroupSelection: Bool { project.expandedToGroups(selectedLayerIDs).count >= 2 }

    func groupSelection() {
        guard canGroupSelection, let slide = actionSlide(selectedLayerIDs) else { return }
        let ids = selectedLayerIDs, primary = selectedLayerID
        var members: [String] = []
        perform("Group Layers") { members = $0.slides[slide].groupLayers(ids) }
        selectLayers(members, primary: primary)
    }

    var canUngroupSelection: Bool { selectedLayers.contains { $0.groupID != nil } }

    func ungroupSelection() {
        guard canUngroupSelection, let slide = actionSlide(selectedLayerIDs) else { return }
        let ids = selectedLayerIDs
        perform("Ungroup Layers") { $0.slides[slide].ungroupLayers(ids) }
    }

    func alignSelection(_ edge: AlignEdge, relativeToSlide: Bool? = nil) {
        alignLayers(selectedLayerIDs, edge, relativeToSlide: relativeToSlide)
    }

    func alignLayers(_ ids: [String], _ edge: AlignEdge, relativeToSlide: Bool?) {
        guard let slide = actionSlide(ids) else { return }
        let rect = CGRect(origin: .zero, size: project.format.size)
        perform("Align Layers") { $0.slides[slide].alignLayers(ids, edge: edge, slideRect: rect, relativeToSlide: relativeToSlide) }
    }

    var canDistributeSelection: Bool { project.selectionUnits(selectedLayerIDs).count >= 3 }

    func distributeSelection(_ axis: DistributeAxis) {
        guard canDistributeSelection, let slide = actionSlide(selectedLayerIDs) else { return }
        let ids = selectedLayerIDs
        perform("Distribute Layers") { $0.slides[slide].distributeLayers(ids, axis: axis) }
    }

    func moveLayers(_ ids: [String], dx: Double, dy: Double, coalesce key: String? = nil) {
        guard let slide = actionSlide(ids) else { return }
        perform("Move Layers", coalesce: key) { $0.slides[slide].moveLayers(ids, dx: dx, dy: dy) }
    }

    func resizeLayers(_ ids: [String], from: CGRect, to: CGRect) {
        guard let slide = actionSlide(ids) else { return }
        perform("Resize Layers") { $0.slides[slide].resizeLayers(ids, from: from, to: to) }
    }

    func arrangeSelection(_ direction: ArrangeDirection) { arrangeLayers(selectedLayerIDs, direction) }

    func canArrangeSelection(_ direction: ArrangeDirection) -> Bool { canArrangeLayers(selectedLayerIDs, direction) }

    // Internal routing also keeps the original single-layer methods group-aware.
    func arrangeLayers(_ ids: [String], _ direction: ArrangeDirection) {
        guard let slide = actionSlide(ids), canArrangeLayers(ids, direction) else { return }
        let name: String = switch direction {
        case .forward: "Bring Forward"
        case .backward: "Send Backward"
        case .front: "Bring to Front"
        case .back: "Send to Back"
        }
        perform(name) { $0.slides[slide].arrangeLayers(ids, direction: direction) }
    }

    func canArrangeLayers(_ ids: [String], _ direction: ArrangeDirection) -> Bool {
        guard let slide = actionSlide(ids) else { return false }
        return project.slides[slide].canArrangeLayers(ids, direction: direction)
    }
}
