import Foundation

/// How clicks build a selection. A click picks a layer's whole group; double-clicking steps into
/// the group so later clicks pick single members; Escape climbs back out. Matches the web app.
extension EditorController {
    /// The group the user has stepped into: the selection is part of one group but not all of it.
    var enteredGroupID: String? {
        let layers = selectedLayers
        guard let first = layers.first, let group = first.groupID, layers.allSatisfy({ $0.groupID == group }) else { return nil }
        return project.groupMemberIDs(of: first.id).count > layers.count ? group : nil
    }

    /// The selection is several layers, or one whole group.
    var isMultiSelection: Bool { selectedLayerIDs.count > 1 }

    /// What a click on `id` selects: its whole group, or just the layer inside an entered group.
    func clickUnit(_ id: String) -> [String] {
        guard let layer = project.layer(id) else { return [] }
        if let group = layer.groupID, group == enteredGroupID { return [id] }
        return project.groupMemberIDs(of: id)
    }

    /// Selects on mouse-down. A plain click on a layer that's already selected keeps the whole
    /// selection so it can be dragged; `additive` (⇧ or ⌘) toggles the layer's group.
    func pickLayer(_ id: String, additive: Bool) {
        guard let loc = project.locate(layer: id) else { return }
        if !additive, project.layer(id)?.groupID == nil {
            groupExistingBlend(containing: id)
            if !blendGroupMembers(containing: id).isEmpty {
                selectLayers(project.groupMemberIDs(of: id), primary: id)
                return
            }
        }
        let unit = clickUnit(id)
        let sameSlide = selectedLayerLocation?.slide == loc.slide
        if additive && sameSlide && !selectedLayerIDs.isEmpty {
            if unit.contains(where: selectedLayerIDs.contains) {
                selectLayers(selectedLayerIDs.filter { !unit.contains($0) })
            } else {
                selectLayers(selectedLayerIDs + unit, primary: id)
            }
            return
        }
        if !additive && selectedLayerIDs.contains(id) {
            selectLayers(selectedLayerIDs, primary: id)
            return
        }
        selectLayers(unit, primary: id)
    }

    /// A plain click (without dragging) on a layer inside a larger selection narrows to it.
    func clickWouldNarrow(_ id: String) -> Bool {
        selectedLayerIDs.contains(id) && project.selectionUnits(selectedLayerIDs).count > 1
    }

    func narrowSelection(to id: String) { selectLayers(clickUnit(id), primary: id) }

    /// Grouping is offered for two or more layers that aren't already exactly one group.
    var canGroupNow: Bool {
        guard project.expandedToGroups(selectedLayerIDs).count >= 2 else { return false }
        let isOneGroup = project.selectionUnits(selectedLayerIDs).count == 1 && selectedLayers.first?.groupID != nil
        return !isOneGroup || enteredGroupID != nil
    }

    /// Number of things alignment and distribution move: groups count once.
    var selectionUnitCount: Int { project.selectionUnits(selectedLayerIDs).count }

    func enterGroup(_ id: String) { selectLayers([id], primary: id) }

    /// Escape: from inside a group select the whole group, otherwise clear the selection.
    func selectParent() {
        if enteredGroupID != nil, let first = selectedLayerIDs.first {
            selectLayers(project.groupMemberIDs(of: first), primary: selectedLayerID)
        } else {
            selectLayer(nil)
        }
    }

    /// Lock or hide everything selected in one step; mixed selections switch everything on.
    func toggleSelection(_ key: WritableKeyPath<Layer, Bool>, name: String) {
        let layers = selectedLayers
        guard !layers.isEmpty, let slide = selectedLayerLocation?.slide else { return }
        let value = !layers.allSatisfy { $0[keyPath: key] }
        let ids = Set(layers.map(\.id))
        perform(name) { p in
            for i in p.slides[slide].layers.indices where ids.contains(p.slides[slide].layers[i].id) {
                p.slides[slide].layers[i][keyPath: key] = value
            }
        }
    }

    /// Sets one property on every selected layer as a single undo step (or gesture step).
    func updateSelection(_ name: String, coalesce key: String? = nil, _ body: @escaping (inout Layer) -> Void) {
        guard let slide = selectedLayerLocation?.slide else { return }
        let ids = Set(selectedLayerIDs)
        perform(name, coalesce: key) { p in
            for i in p.slides[slide].layers.indices where ids.contains(p.slides[slide].layers[i].id) {
                body(&p.slides[slide].layers[i])
            }
        }
    }

    /// Scales the unlocked selected layers from box `from` to `to` (slide-local), refitting text.
    func scaleSelection(from: CGRect, to: CGRect, coalesce key: String? = "selection-size") {
        guard let slide = selectedLayerLocation?.slide else { return }
        let ids = Set(selectedLayerIDs)
        perform("Resize Layers", coalesce: key) { p in
            for i in p.slides[slide].layers.indices where ids.contains(p.slides[slide].layers[i].id) && !p.slides[slide].layers[i].locked {
                var scaled = Layer.scaled(p.slides[slide].layers[i], from: from, to: to)
                EditorController.fitTextHeight(&scaled)
                p.slides[slide].layers[i] = scaled
            }
        }
    }

    /// Takes one layer out of its group; the rest stay grouped.
    func ungroupMember(_ id: String) {
        guard let loc = project.locate(layer: id) else { return }
        perform("Ungroup Layer") { p in
            p.slides[loc.slide].layers[loc.index].groupID = nil
            p.slides[loc.slide].layers[loc.index].groupKind = nil
            p.slides[loc.slide].normalizeSingletonGroups()
        }
    }

    /// Reorders a slide's layers (back to front) and optionally moves one layer in or out of a
    /// group, as one undo step. Groups left with a single member dissolve.
    func reorderLayers(slide: Int, order: [String], regroup: (id: String, groupID: String?)? = nil) {
        guard project.slides.indices.contains(slide) else { return }
        perform("Reorder Layers") { p in
            let byID = Dictionary(uniqueKeysWithValues: p.slides[slide].layers.map { ($0.id, $0) })
            guard order.count == byID.count, Set(order) == Set(byID.keys) else { return }
            p.slides[slide].layers = order.compactMap { byID[$0] }
            if let regroup, let i = p.slides[slide].layers.firstIndex(where: { $0.id == regroup.id }) {
                p.slides[slide].layers[i].groupID = regroup.groupID
                p.slides[slide].layers[i].groupKind = regroup.groupID.flatMap { group in
                    p.slides[slide].layers.first { $0.groupID == group && $0.id != regroup.id }?.groupKind
                }
            }
            p.slides[slide].normalizeSingletonGroups()
        }
    }
}
