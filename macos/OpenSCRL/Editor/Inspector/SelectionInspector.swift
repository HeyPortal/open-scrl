import SwiftUI

/// Design tab for several selected layers, or one whole group.
struct SelectionInspector: View {
    var controller: EditorController
    @State private var alignToSlide = false
    @State private var keepRatio = true

    var body: some View {
        let layers = controller.selectedLayers
        let units = controller.selectionUnitCount
        let bounds = Geometry.unionBounds(of: layers) ?? .zero
        let isOneGroup = units == 1 && Set(layers.compactMap(\.groupID)).count == 1
        let allLocked = layers.allSatisfy(\.locked)
        Form {
            Section { header(layers: layers, bounds: bounds, isOneGroup: isOneGroup) }

            Section {
                HStack(spacing: 8) {
                    Button { controller.groupSelection() } label: { Label("Group", systemImage: "square.on.square.dashed").frame(maxWidth: .infinity) }
                        .disabled(!controller.canGroupNow)
                        .help("Group (⌘G)")
                    Button { controller.ungroupSelection() } label: { Label("Ungroup", systemImage: "square.on.square.squareshape.controlhandles").frame(maxWidth: .infinity) }
                        .disabled(!controller.canUngroupSelection)
                        .help("Ungroup (⇧⌘G)")
                }
                .controlSize(.large)
                Text(isOneGroup
                     ? "Moves, scales and stacks as one. Double-click a layer on the canvas to edit it on its own."
                     : "Group these to move, scale and stack them as one.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Group")
            }

            Section {
                if units >= 2 {
                    Picker("Align To", selection: $alignToSlide) {
                        Text("Each Other").tag(false)
                        Text("Slide").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                let toSlide = units < 2 || alignToSlide
                ControlGroup {
                    alignButton("Align Left", "align.horizontal.left", .left, toSlide)
                    alignButton("Align Centers", "align.horizontal.center", .centerX, toSlide)
                    alignButton("Align Right", "align.horizontal.right", .right, toSlide)
                    alignButton("Align Top", "align.vertical.top", .top, toSlide)
                    alignButton("Align Middles", "align.vertical.center", .centerY, toSlide)
                    alignButton("Align Bottom", "align.vertical.bottom", .bottom, toSlide)
                }
                .labelStyle(.iconOnly)
                .disabled(allLocked)
                ControlGroup {
                    Button { controller.distributeSelection(.horizontal) } label: { Label("Space Across", systemImage: "distribute.horizontal.center") }
                        .help("Even horizontal spacing")
                    Button { controller.distributeSelection(.vertical) } label: { Label("Space Down", systemImage: "distribute.vertical.center") }
                        .help("Even vertical spacing")
                }
                .disabled(units < 3 || allLocked)
                if units < 3 {
                    Text("Select three or more to space them evenly.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                HStack {
                    Text("Align")
                    if units < 2 {
                        Spacer()
                        Text("To Slide").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            Section("Position & Size") {
                Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                    GridRow {
                        scrub("X", value: Binding(get: { bounds.minX }, set: { move(dx: $0 - current.minX, dy: 0) }), name: "Move Layers")
                        scrub("Y", value: Binding(get: { bounds.minY }, set: { move(dx: 0, dy: $0 - current.minY) }), name: "Move Layers")
                        Color.clear.frame(width: 18, height: 1)
                    }
                    GridRow {
                        scrub("W", value: Binding(get: { bounds.width }, set: { resize(width: $0) }), name: "Resize Layers", range: 1...100_000)
                        scrub("H", value: Binding(get: { bounds.height }, set: { resize(height: $0) }), name: "Resize Layers", range: 1...100_000)
                        Button { keepRatio.toggle() } label: {
                            Image(systemName: "link").foregroundStyle(keepRatio ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                        }
                        .buttonStyle(.borderless)
                        .help(keepRatio ? "Proportions locked" : "Lock proportions")
                    }
                }
                .disabled(allLocked)
                let opacity = layers.first?.opacity ?? 1
                let mixed = layers.contains { abs($0.opacity - opacity) > 0.001 }
                GestureSlider(title: "Opacity",
                              value: Binding(get: { opacity }, set: { v in controller.updateSelection("Change Opacity", coalesce: "selection-opacity") { $0.opacity = v } }),
                              range: 0...1, display: mixed ? "Mixed" : "\(Int((opacity * 100).rounded()))%", controller: controller, undoName: "Change Opacity")
            }

            Section("Arrange") {
                ControlGroup {
                    arrangeButton("Send to Back", "square.3.layers.3d.bottom.filled", .back, "⌥⌘[")
                    arrangeButton("Send Backward", "square.2.layers.3d.bottom.filled", .backward, "⌘[")
                    arrangeButton("Bring Forward", "square.2.layers.3d.top.filled", .forward, "⌘]")
                    arrangeButton("Bring to Front", "square.3.layers.3d.top.filled", .front, "⌥⌘]")
                }
                .labelStyle(.iconOnly)
            }
        }
        .formStyle(.grouped)
    }

    private var current: CGRect { Geometry.unionBounds(of: controller.selectedLayers) ?? .zero }

    private func header(layers: [Layer], bounds: CGRect, isOneGroup: Bool) -> some View {
        let allLocked = layers.allSatisfy(\.locked)
        let allVisible = layers.allSatisfy(\.visible)
        let kinds = Set(layers.map(\.kindName))
        let noun = kinds.count == 1 ? (layers.first?.kindName ?? "Layers") : "Layers"
        return HStack(spacing: 10) {
            Image(systemName: isOneGroup ? "square.on.square.dashed" : "square.stack.3d.up")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.tint.opacity(0.15)))
            VStack(alignment: .leading, spacing: 1) {
                Text(isOneGroup ? "Group of \(layers.count)" : "\(layers.count) \(noun)").font(.headline)
                Text("\(Int(bounds.width.rounded())) × \(Int(bounds.height.rounded()))\(allLocked ? " · Locked" : "")")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button { controller.toggleSelection(\.locked, name: allLocked ? "Unlock" : "Lock") } label: {
                Image(systemName: allLocked ? "lock.fill" : "lock.open")
                    .foregroundStyle(allLocked ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            }
            .buttonStyle(.borderless)
            .help(allLocked ? "Unlock all (⇧⌘L)" : "Lock all (⇧⌘L)")
            Button { controller.toggleSelection(\.visible, name: allVisible ? "Hide" : "Show") } label: {
                Image(systemName: allVisible ? "eye" : "eye.slash")
                    .foregroundStyle(allVisible ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
            }
            .buttonStyle(.borderless)
            .help(allVisible ? "Hide all (⇧⌘H)" : "Show all (⇧⌘H)")
            Menu {
                Button("Duplicate", systemImage: "plus.square.on.square") { controller.duplicateSelection() }
                Button("Copy", systemImage: "document.on.document") { controller.copySelection() }
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { controller.deleteSelection() }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("More")
        }
    }

    private func alignButton(_ title: String, _ symbol: String, _ edge: AlignEdge, _ toSlide: Bool) -> some View {
        Button { controller.alignSelection(edge, relativeToSlide: toSlide) } label: { Label(title, systemImage: symbol) }
            .help(toSlide ? "\(title) on the slide" : title)
    }

    private func arrangeButton(_ title: String, _ symbol: String, _ direction: ArrangeDirection, _ shortcut: String) -> some View {
        Button { controller.arrangeSelection(direction) } label: { Label(title, systemImage: symbol) }
            .disabled(!controller.canArrangeSelection(direction))
            .help("\(title) (\(shortcut))")
    }

    private func scrub(_ label: String, value: Binding<Double>, name: String, range: ClosedRange<Double> = -100_000...100_000) -> some View {
        ScrubField(label: label, value: value, range: range, onScrubBegan: controller.beginGesture, onScrubEnded: { controller.endGesture(name) })
    }

    private func move(dx: Double, dy: Double) {
        controller.moveLayers(controller.selectedLayerIDs, dx: dx, dy: dy, coalesce: "selection-move")
    }

    /// Resizes the selection's box from its top-left corner.
    private func resize(width: Double? = nil, height: Double? = nil) {
        let from = current
        guard from.width > 0, from.height > 0 else { return }
        var to = from
        if let width { to.size.width = max(1, width); if keepRatio { to.size.height = to.width * from.height / from.width } }
        if let height { to.size.height = max(1, height); if keepRatio { to.size.width = to.height * from.width / from.height } }
        controller.scaleSelection(from: from, to: to)
    }
}

extension Layer {
    /// Plural noun for a selection made only of this kind.
    var kindName: String {
        switch content {
        case .image: "Photos"
        case .text: "Text Boxes"
        case .shape: "Shapes"
        }
    }
}
