import Foundation
import CoreGraphics

enum ArrangeDirection { case forward, backward, front, back }
enum AlignEdge: CaseIterable { case left, centerX, right, top, centerY, bottom }
enum DistributeAxis { case horizontal, vertical }

struct SelectionUnit {
    var ids: [String]
    var bounds: CGRect
    var locked: Bool
}

extension Geometry {
    /// Axis-aligned union of the layers' rotated bounds; nil for an empty collection.
    static func unionBounds(of layers: [Layer]) -> CGRect? {
        layers.reduce(nil as CGRect?) { bounds, layer in
            let next = rotatedBounds(of: layer.frame, degrees: layer.rotation)
            return bounds.map { $0.union(next) } ?? next
        }
    }
}

extension Layer {
    static func scaled(_ layer: Layer, from: CGRect, to: CGRect) -> Layer {
        guard from.width != 0, from.height != 0 else { return layer }
        let sx = to.width / from.width, sy = to.height / from.height
        let k = sqrt(abs(sx * sy))
        var result = layer
        result.x = to.minX + (layer.x - from.minX) * sx
        result.y = to.minY + (layer.y - from.minY) * sy
        result.width *= sx
        result.height *= sy
        switch result.content {
        case .text(var p):
            p.fontSize *= k; p.letterSpacing *= k; p.strokeWidth *= k
            p.highlight?.padding *= k; p.highlight?.radius *= k
            result.content = .text(p)
        case .image(var p):
            p.cornerRadius *= k; p.strokeWidth *= k
            p.seamBlend?.width *= k
            p.seamBlend?.offsetX *= sx; p.seamBlend?.offsetY *= sy
            p.seamBlend?.analysis = nil
            result.content = .image(p)
        case .shape(var p):
            p.cornerRadius *= k; p.strokeWidth *= k
            result.content = .shape(p)
        }
        result.shadow?.blur *= k
        result.shadow?.offsetX *= k
        result.shadow?.offsetY *= k
        return result
    }
}

extension Slide {
    func expandedToGroups(_ ids: [String]) -> [String] {
        let selected = Set(ids)
        let groups = Set(layers.filter { selected.contains($0.id) }.compactMap(\.groupID))
        return layers.filter { selected.contains($0.id) || $0.groupID.map(groups.contains) == true }.map(\.id)
    }

    func groupMemberIDs(of id: String) -> [String] {
        guard let layer = layers.first(where: { $0.id == id }) else { return [] }
        guard let group = layer.groupID else { return [id] }
        return layers.filter { $0.groupID == group }.map(\.id)
    }

    func selectionUnits(_ ids: [String]) -> [SelectionUnit] {
        let selected = Set(expandedToGroups(ids))
        var seen = Set<String>()
        var units: [SelectionUnit] = []
        for layer in layers where selected.contains(layer.id) && !seen.contains(layer.id) {
            let members = groupMemberIDs(of: layer.id)
            seen.formUnion(members)
            let memberSet = Set(members)
            let picked = layers.filter { memberSet.contains($0.id) }
            if let bounds = Geometry.unionBounds(of: picked) {
                units.append(SelectionUnit(ids: members, bounds: bounds, locked: picked.contains { $0.locked }))
            }
        }
        return units
    }

    mutating func normalizeSingletonGroups() {
        let counts = Dictionary(layers.compactMap(\.groupID).map { ($0, 1) }, uniquingKeysWith: +)
        let invalidBlendGroups = Set(layers.filter { $0.groupID != nil && ($0.image == nil || $0.groupKind != .blend) }.compactMap(\.groupID))
        for i in layers.indices {
            if let group = layers[i].groupID, counts[group] == 1 { layers[i].groupID = nil }
            if layers[i].groupID == nil { layers[i].groupKind = nil }
            else if let group = layers[i].groupID, invalidBlendGroups.contains(group) { layers[i].groupKind = nil }
        }
    }

    mutating func deleteLayers(_ ids: [String]) {
        let removed = Set(ids)
        layers.removeAll { removed.contains($0.id) }
        for i in layers.indices where layers[i].image?.seamBlend.map({ removed.contains($0.targetLayerID) }) == true {
            layers[i].image?.seamBlend = nil
        }
        normalizeSingletonGroups()
    }

    /// Returns source-to-copy IDs. Each unit's copies are inserted above its topmost member.
    @discardableResult
    mutating func duplicateLayers(_ ids: [String]) -> [String: String] {
        let units = selectionUnits(ids)
        var blocks: [String: [Layer]] = [:]
        var copies: [String: String] = [:]
        for unit in units {
            let members = Set(unit.ids)
            let sources = layers.filter { members.contains($0.id) }
            let group = sources.first?.groupID == nil ? nil : UID.make()
            let block = sources.map { source -> Layer in
                var copy = source
                copy.id = UID.make(); copy.name += " copy"
                copy.x += 24; copy.y += 24; copy.groupID = group
                copies[source.id] = copy.id
                return copy
            }
            if let top = sources.last { blocks[top.id] = block }
        }
        layers = layers.flatMap { [$0] + (blocks[$0.id] ?? []) }
        let copiedIDs = Set(copies.values)
        for i in layers.indices where copiedIDs.contains(layers[i].id) {
            if let target = layers[i].image?.seamBlend?.targetLayerID {
                if let newTarget = copies[target] { layers[i].image?.seamBlend?.targetLayerID = newTarget }
                else { layers[i].image?.seamBlend = nil }
                layers[i].image?.seamBlend?.analysis = nil
            }
        }
        return copies
    }

    @discardableResult
    mutating func groupLayers(_ ids: [String]) -> [String] {
        let members = expandedToGroups(ids)
        guard members.count >= 2 else { return [] }
        let selected = Set(members)
        guard let top = layers.lastIndex(where: { selected.contains($0.id) }) else { return [] }
        let insertion = layers[..<top].filter { !selected.contains($0.id) }.count
        let group = UID.make()
        let block = layers.filter { selected.contains($0.id) }.map { layer -> Layer in
            var copy = layer; copy.groupID = group; copy.groupKind = nil; return copy
        }
        layers.removeAll { selected.contains($0.id) }
        layers.insert(contentsOf: block, at: insertion)
        return members
    }

    mutating func ungroupLayers(_ ids: [String]) {
        let selected = Set(expandedToGroups(ids))
        for i in layers.indices where selected.contains(layers[i].id) {
            layers[i].groupID = nil; layers[i].groupKind = nil
        }
    }

    mutating func moveLayers(_ ids: [String], dx: Double, dy: Double) {
        let selected = Set(ids)
        for i in layers.indices where selected.contains(layers[i].id) && !layers[i].locked {
            layers[i].x += dx; layers[i].y += dy
        }
    }

    mutating func resizeLayers(_ ids: [String], from: CGRect, to: CGRect) {
        let selected = Set(ids)
        for i in layers.indices where selected.contains(layers[i].id) && !layers[i].locked {
            layers[i] = Layer.scaled(layers[i], from: from, to: to)
        }
    }

    mutating func alignLayers(_ ids: [String], edge: AlignEdge, slideRect: CGRect, relativeToSlide: Bool? = nil) {
        let units = selectionUnits(ids)
        guard let union = units.map(\.bounds).reduce(nil as CGRect?, { $0?.union($1) ?? $1 }) else { return }
        let target = (relativeToSlide ?? (units.count < 2)) ? slideRect : union
        for unit in units where !unit.locked {
            var dx = 0.0, dy = 0.0
            switch edge {
            case .left: dx = target.minX - unit.bounds.minX
            case .centerX: dx = target.midX - unit.bounds.midX
            case .right: dx = target.maxX - unit.bounds.maxX
            case .top: dy = target.minY - unit.bounds.minY
            case .centerY: dy = target.midY - unit.bounds.midY
            case .bottom: dy = target.maxY - unit.bounds.maxY
            }
            moveLayers(unit.ids, dx: dx, dy: dy)
        }
    }

    mutating func distributeLayers(_ ids: [String], axis: DistributeAxis) {
        let horizontal = axis == .horizontal
        func minimum(_ unit: SelectionUnit) -> Double { horizontal ? unit.bounds.minX : unit.bounds.minY }
        func size(_ unit: SelectionUnit) -> Double { horizontal ? unit.bounds.width : unit.bounds.height }
        func center(_ unit: SelectionUnit) -> Double { horizontal ? unit.bounds.midX : unit.bounds.midY }
        let units = selectionUnits(ids).sorted {
            minimum($0) == minimum($1) ? center($0) < center($1) : minimum($0) < minimum($1)
        }
        guard units.count >= 3, let first = units.first, let last = units.last else { return }
        let span = minimum(last) + size(last) - minimum(first)
        let gap = (span - units.reduce(0) { $0 + size($1) }) / Double(units.count - 1)
        var cursor = minimum(first) + size(first) + gap
        for unit in units.dropFirst().dropLast() {
            if !unit.locked {
                let delta = cursor - minimum(unit)
                moveLayers(unit.ids, dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta)
            }
            cursor += size(unit) + gap
        }
    }

    private func arrangedLayers(_ ids: [String], direction: ArrangeDirection) -> [Layer] {
        let selected = Set(expandedToGroups(ids))
        guard let top = layers.lastIndex(where: { selected.contains($0.id) }) else { return layers }
        let block = layers.filter { selected.contains($0.id) }
        var remaining = layers.filter { !selected.contains($0.id) }
        let anchor = layers[..<top].filter { !selected.contains($0.id) }.count
        let insertion: Int
        switch direction {
        case .front: insertion = remaining.count
        case .back: insertion = 0
        case .forward:
            guard anchor < remaining.count else { return layers }
            let neighbor = Set(groupMemberIDs(of: remaining[anchor].id))
            insertion = (remaining.lastIndex { neighbor.contains($0.id) } ?? anchor) + 1
        case .backward:
            // For a noncontiguous selection, step past the unit below its bottommost member.
            let bottom = layers.firstIndex { selected.contains($0.id) } ?? top
            let lowerAnchor = layers[..<bottom].filter { !selected.contains($0.id) }.count
            guard lowerAnchor > 0 else { return layers }
            let neighbor = Set(groupMemberIDs(of: remaining[lowerAnchor - 1].id))
            insertion = remaining.firstIndex { neighbor.contains($0.id) } ?? lowerAnchor - 1
        }
        remaining.insert(contentsOf: block, at: insertion)
        return remaining
    }

    func canArrangeLayers(_ ids: [String], direction: ArrangeDirection) -> Bool {
        arrangedLayers(ids, direction: direction) != layers
    }

    mutating func arrangeLayers(_ ids: [String], direction: ArrangeDirection) {
        layers = arrangedLayers(ids, direction: direction)
    }

    /// Copies a slide with fresh layer and group IDs; no group spans the source and copy.
    func duplicated() -> Slide {
        var result = self
        result.id = UID.make()
        result.layers = Layer.freshCopies(layers)
        return result
    }
}

extension Layer {
    /// Copies in input order, remapping each distinct group once (also used by paste).
    static func freshCopies(_ layers: [Layer]) -> [Layer] {
        var groups: [String: String] = [:]
        let ids = Dictionary(uniqueKeysWithValues: layers.map { ($0.id, UID.make()) })
        return layers.map { source in
            var copy = source
            copy.id = ids[source.id]!
            if let target = copy.image?.seamBlend?.targetLayerID {
                if let newTarget = ids[target] { copy.image?.seamBlend?.targetLayerID = newTarget }
                else { copy.image?.seamBlend = nil }
            }
            if let group = source.groupID {
                if groups[group] == nil { groups[group] = UID.make() }
                copy.groupID = groups[group]
            }
            return copy
        }
    }
}

extension Project {
    /// First existing ID chooses the slide; IDs on other slides are ignored.
    func expandedToGroups(_ ids: [String]) -> [String] {
        guard let slide = ids.compactMap({ locate(layer: $0)?.slide }).first else { return [] }
        return slides[slide].expandedToGroups(ids)
    }

    func groupMemberIDs(of id: String) -> [String] {
        guard let loc = locate(layer: id) else { return [] }
        return slides[loc.slide].groupMemberIDs(of: id)
    }

    func selectionUnits(_ ids: [String]) -> [SelectionUnit] {
        guard let slide = ids.compactMap({ locate(layer: $0)?.slide }).first else { return [] }
        return slides[slide].selectionUnits(ids)
    }

    /// Clears layer and background references while preserving background effects and color.
    mutating func removeAsset(_ id: String) {
        assets.removeAll { $0.id == id }
        for s in slides.indices {
            if case .image(var background) = slides[s].background, background.assetID == id {
                background.assetID = nil
                slides[s].background = .image(background)
            }
            for l in slides[s].layers.indices where slides[s].layers[l].image?.assetID == id {
                slides[s].layers[l].image?.assetID = nil
            }
        }
    }
}
