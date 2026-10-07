import SwiftUI

/// The selected slide's layers, front-most first. Groups get a header row that folds their
/// members away; ⌘- and ⇧-click select several; dragging a layer between a group's members
/// adds it to the group, and dragging it out takes it out.
struct LayersList: View {
    var controller: EditorController
    @State private var renamingID: String?
    @State private var collapsed: Set<String> = []

    enum Row: Identifiable {
        case group(tag: String, groupID: String, members: [Layer])
        case layer(Layer, groupID: String?)

        var id: String {
            switch self {
            case .group(let tag, _, _): tag
            case .layer(let layer, _): layer.id
            }
        }
    }

    static func rows(_ topFirst: [Layer], collapsed: Set<String>) -> [Row] {
        var rows: [Row] = []
        var i = 0
        while i < topFirst.count {
            let group = topFirst[i].groupID
            var j = i + 1
            while let group, j < topFirst.count, topFirst[j].groupID == group { j += 1 }
            guard let group, j - i >= 2 else {
                rows.append(.layer(topFirst[i], groupID: nil))
                i += 1
                continue
            }
            let members = Array(topFirst[i..<j])
            rows.append(.group(tag: "group:\(group):\(i)", groupID: group, members: members))
            if !collapsed.contains(group) { rows += members.map { .layer($0, groupID: group) } }
            i = j
        }
        return rows
    }

    var body: some View {
        let slideIndex = controller.selectedSlideIndex
        let layers = Array((controller.selectedSlide?.layers ?? []).reversed())
        let rows = Self.rows(layers, collapsed: collapsed)

        Group {
            if layers.isEmpty {
                ContentUnavailableView {
                    Label("Empty Slide", systemImage: "square.3.layers.3d")
                } description: {
                    Text("Add photos, text, or shapes from the sidebar or toolbar.")
                }
            } else {
                List(selection: selection(rows)) {
                    Section {
                        ForEach(rows) { row in
                            switch row {
                            case .group(let tag, let group, let members):
                                GroupRow(controller: controller, members: members, collapsed: collapsed.contains(group)) { toggle(group) }
                                    .tag(tag)
                                    .moveDisabled(true)
                            case .layer(let layer, let group):
                                LayerRow(controller: controller, layer: layer, renamingID: $renamingID)
                                    .padding(.leading, group == nil ? 0 : 18)
                                    .tag(layer.id)
                            }
                        }
                        .onMove { source, destination in move(rows, from: source, to: destination, slide: slideIndex) }
                    } header: {
                        Text("Front to back · drag to reorder")
                    }
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .contextMenu(forSelectionType: String.self) { ids in
                    menu(for: ids, rows: rows)
                } primaryAction: { ids in
                    guard ids.count == 1, let id = ids.first else { return }
                    if case .group(_, let group, _)? = rows.first(where: { $0.id == id }) { toggle(group) } else { renamingID = id }
                }
                .onDeleteCommand { controller.deleteSelection() }
            }
        }
    }

    private func toggle(_ group: String) {
        if collapsed.contains(group) { collapsed.remove(group) } else { collapsed.insert(group) }
    }

    /// The list selects rows; a group's header counts as selected when all its members are.
    private func selection(_ rows: [Row]) -> Binding<Set<String>> {
        var groups: [String: [String]] = [:]
        for case .group(let tag, _, let members) in rows { groups[tag] = members.map(\.id) }
        var current = Set(controller.selectedLayerIDs)
        for (tag, ids) in groups where ids.allSatisfy(current.contains) { current.insert(tag) }
        let shown = current
        return Binding(get: { shown }, set: { new in
            var ids = Set(new.filter { groups[$0] == nil })
            for (tag, members) in groups {
                let had = shown.contains(tag), has = new.contains(tag)
                // Clicking a header selects its members; ⌘-clicking a selected header drops them.
                if has && (!had || !members.contains(where: new.contains)) { ids.formUnion(members) }
                if had && !has && members.allSatisfy(new.contains) { ids.subtract(members) }
            }
            let order = (controller.selectedSlide?.layers ?? []).map(\.id).filter(ids.contains)
            guard !order.isEmpty else { controller.selectLayer(nil); return }
            let clicked = new.subtracting(shown).first.map { groups[$0]?.first ?? $0 }
            controller.selectLayers(order, primary: clicked)
        })
    }

    private func move(_ rows: [Row], from source: IndexSet, to destination: Int, slide: Int) {
        guard source.count == 1, let from = source.first, case .layer(let layer, let oldGroup) = rows[from] else { return }
        var moved = rows
        moved.move(fromOffsets: source, toOffset: destination)
        guard let at = moved.firstIndex(where: { $0.id == layer.id }) else { return }
        let above = at > 0 ? moved[at - 1] : nil
        let below = at + 1 < moved.count ? moved[at + 1] : nil
        var groupAbove: String?
        var aboveIsHeader = false
        switch above {
        case .group(_, let group, _)?: groupAbove = collapsed.contains(group) ? nil : group; aboveIsHeader = groupAbove != nil
        case .layer(_, let group)?: groupAbove = group
        case nil: break
        }
        var groupBelow: String?
        if case .layer(_, let group)? = below { groupBelow = group }
        var next: String?
        if let groupAbove, groupAbove == groupBelow || aboveIsHeader { next = groupAbove }
        else if let oldGroup, groupAbove == oldGroup || groupBelow == oldGroup { next = oldGroup }
        let topFirst = moved.flatMap { row -> [String] in
            switch row {
            case .group(_, let group, let members): collapsed.contains(group) ? members.map(\.id) : []
            case .layer(let l, _): [l.id]
            }
        }
        controller.reorderLayers(slide: slide, order: topFirst.reversed(), regroup: next != oldGroup ? (layer.id, next) : nil)
    }

    @ViewBuilder private func menu(for ids: Set<String>, rows: [Row]) -> some View {
        let selected = Set(controller.selectedLayerIDs)
        let isGroupRow = ids.count == 1 && ids.first?.hasPrefix("group:") == true
        if ids.count > 1 || isGroupRow || (ids.count == 1 && selected.count > 1 && ids.isSubset(of: selected)) {
            if isGroupRow, case .group(_, _, let members)? = rows.first(where: { $0.id == ids.first }),
               !members.allSatisfy({ selected.contains($0.id) }) {
                Button("Select Group") { controller.selectLayers(members.reversed().map(\.id)) }
            }
            Button("Group") { controller.groupSelection() }.disabled(!controller.canGroupNow)
            Button("Ungroup") { controller.ungroupSelection() }.disabled(!controller.canUngroupSelection)
            Divider()
            Button("Duplicate") { controller.duplicateSelection() }
            Button(controller.selectedLayers.allSatisfy(\.locked) ? "Unlock All" : "Lock All") { controller.toggleSelection(\.locked, name: "Lock") }
            Button(controller.selectedLayers.allSatisfy(\.visible) ? "Hide All" : "Show All") { controller.toggleSelection(\.visible, name: "Hide") }
            Divider()
            Button("Bring to Front") { controller.arrangeSelection(.front) }
            Button("Send to Back") { controller.arrangeSelection(.back) }
            Divider()
            Button("Delete", role: .destructive) { controller.deleteSelection() }
        } else if let id = ids.first, let layer = controller.project.layer(id) {
            Button("Rename") { renamingID = id }
            Button("Duplicate") { controller.duplicateLayer(id) }
            Button(layer.locked ? "Unlock" : "Lock") { controller.toggleLocked(id) }
            Button(layer.visible ? "Hide" : "Show") { controller.toggleVisible(id) }
            if layer.groupID != nil {
                Button("Take Out of Group") { controller.selectLayer(id); controller.ungroupMember(id) }
            }
            Divider()
            Button("Bring to Front") { controller.arrange(id, .front) }
            Button("Send to Back") { controller.arrange(id, .back) }
            Divider()
            Button("Delete", role: .destructive) { controller.deleteLayer(id) }
        }
    }
}

private struct GroupRow: View {
    var controller: EditorController
    var members: [Layer]
    var collapsed: Bool
    var toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        let locked = members.allSatisfy(\.locked)
        let visible = members.contains(where: \.visible)
        let ids = Set(members.map(\.id))
        HStack(spacing: 6) {
            Button(action: toggle) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                    .frame(width: 12)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            .help(collapsed ? "Show layers" : "Hide layers")
            Image(systemName: "square.on.square.dashed")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 24, height: 24)
                .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.quaternary.opacity(0.7)))
            Text("Group").lineLimit(1).strikethrough(!visible).foregroundStyle(visible ? .primary : .secondary)
            Text("\(members.count)").monospacedDigit().foregroundStyle(.tertiary)
            Spacer(minLength: 4)
            if locked || hovering {
                Button { set(ids, \.locked, !locked, name: locked ? "Unlock Group" : "Lock Group") } label: { Image(systemName: locked ? "lock.fill" : "lock.open") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(locked ? .primary : .secondary)
                    .help(locked ? "Unlock group" : "Lock group")
            }
            Button { set(ids, \.visible, !visible, name: visible ? "Hide Group" : "Show Group") } label: { Image(systemName: visible ? "eye" : "eye.slash") }
                .buttonStyle(.borderless)
                .foregroundStyle(visible ? .secondary : .primary)
                .opacity(visible && !hovering ? 0.5 : 1)
                .help(visible ? "Hide group" : "Show group")
        }
        .padding(.vertical, 2)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Group of \(members.count)\(collapsed ? ", collapsed" : "")")
    }

    private func set(_ ids: Set<String>, _ key: WritableKeyPath<Layer, Bool>, _ value: Bool, name: String) {
        let slide = controller.selectedSlideIndex
        controller.perform(name) { p in
            for i in p.slides[slide].layers.indices where ids.contains(p.slides[slide].layers[i].id) {
                p.slides[slide].layers[i][keyPath: key] = value
            }
        }
    }
}

private struct LayerRow: View {
    var controller: EditorController
    var layer: Layer
    @Binding var renamingID: String?
    @State private var draft = ""
    @FocusState private var focused: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            thumbnail
            if renamingID == layer.id {
                TextField("Name", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onAppear { draft = layer.name; focused = true }
                    .onSubmit { commit() }
                    .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
            } else {
                Text(layer.name)
                    .lineLimit(1)
                    .strikethrough(!layer.visible)
                    .foregroundStyle(layer.visible ? .primary : .secondary)
            }
            Spacer(minLength: 4)
            if layer.locked || hovering {
                Button { controller.toggleLocked(layer.id) } label: { Image(systemName: layer.locked ? "lock.fill" : "lock.open") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(layer.locked ? .primary : .secondary)
                    .help(layer.locked ? "Unlock" : "Lock")
            }
            Button { controller.toggleVisible(layer.id) } label: { Image(systemName: layer.visible ? "eye" : "eye.slash") }
                .buttonStyle(.borderless)
                .foregroundStyle(layer.visible ? .secondary : .primary)
                .opacity(layer.visible && !hovering ? 0.5 : 1)
                .help(layer.visible ? "Hide" : "Show")
        }
        .padding(.vertical, 2)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(layer.name)\(layer.locked ? ", locked" : "")\(layer.visible ? "" : ", hidden")")
    }

    @ViewBuilder private var thumbnail: some View {
        let asset = controller.project.asset(layer.image?.assetID)
        Group {
            if let asset, let image = controller.document.images.image(for: asset, pixelEdge: 64) {
                Image(decorative: image, scale: 1).resizable().scaledToFill()
            } else {
                Image(systemName: symbol).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            }
        }
        .frame(width: 24, height: 24)
        .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.quaternary.opacity(0.7)))
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    private var symbol: String {
        switch layer.content {
        case .image: "photo"
        case .text: "textformat"
        case .shape(let p): p.shape == .ellipse ? "circle.fill" : "square.fill"
        }
    }

    private func commit() {
        guard renamingID == layer.id else { return }
        renamingID = nil
        if draft != layer.name { controller.rename(layer.id, to: draft) }
    }
}
