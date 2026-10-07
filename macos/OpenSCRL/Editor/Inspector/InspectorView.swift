import SwiftUI

struct InspectorView: View {
    @Bindable var controller: EditorController

    var body: some View {
        let layerCount = controller.selectedSlide?.layers.count ?? 0
        VStack(spacing: 0) {
            Picker("Inspector", selection: $controller.inspectorTab) {
                Text("Design").tag(InspectorTab.design)
                Text(layerCount > 0 ? "Layers (\(layerCount))" : "Layers").tag(InspectorTab.layers)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 4)

            switch controller.inspectorTab {
            case .design:
                if controller.isMultiSelection {
                    SelectionInspector(controller: controller)
                } else if let layer = controller.selectedLayer {
                    LayerInspector(controller: controller, layer: layer)
                        .id(layer.id)
                } else {
                    SlideInspector(controller: controller)
                }
            case .layers:
                LayersList(controller: controller)
            }
        }
    }
}

// MARK: - Layer

struct LayerInspector: View {
    var controller: EditorController
    var layer: Layer
    @FocusState private var nameFocused: Bool

    var body: some View {
        Form {
            Section { header }
            switch layer.content {
            case .image:
                ImageSections(controller: controller, layer: layer)
                PhotoFrameSections(controller: controller, layer: layer)
            case .text:
                TextSections(controller: controller, layer: layer)
            case .shape:
                ShapeSection(controller: controller, layer: layer)
            }
            ShadowSection(controller: controller, layer: layer)
            PositionSection(controller: controller, layer: layer)
            ArrangeSection(controller: controller, layer: layer)
        }
        .formStyle(.grouped)
        .onAppear { focusIfRequested() }
        .onChange(of: controller.renameRequest) { _, _ in focusIfRequested() }
    }

    private func focusIfRequested() {
        if controller.renameRequest == layer.id {
            controller.renameRequest = nil
            DispatchQueue.main.async { nameFocused = true }
        }
    }

    private var kindSymbol: String {
        switch layer.content {
        case .image(let p): p.assetID == nil ? "photo.badge.plus" : "photo"
        case .text: "textformat"
        case .shape(let p): p.shape == .ellipse ? "circle" : "square"
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: kindSymbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.tint.opacity(0.15)))
            VStack(alignment: .leading, spacing: 1) {
                TextField("Layer Name", text: controller.layerBinding(layer.id, name: "Rename Layer", coalesce: true, fallback: layer.name,
                                                                        get: { $0.name }, set: { $0.name = $1 }))
                    .textFieldStyle(.plain)
                    .labelsHidden()
                    .font(.headline)
                    .focused($nameFocused)
                    .onSubmit { nameFocused = false }
                HStack(spacing: 4) {
                    Text("\(Int(layer.width.rounded())) × \(Int(layer.height.rounded()))\(layer.locked ? " · Locked" : "")\(layer.visible ? "" : " · Hidden")")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    if layer.groupID != nil {
                        Text("·").foregroundStyle(.secondary)
                        Button("In a Group") { controller.selectParent() }
                            .buttonStyle(.link)
                            .help("Select the whole group (Esc)")
                    }
                }
                .font(.caption)
            }
            Spacer(minLength: 4)
            Button { controller.toggleLocked(layer.id) } label: {
                Image(systemName: layer.locked ? "lock.fill" : "lock.open")
                    .foregroundStyle(layer.locked ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            }
            .buttonStyle(.borderless)
            .help(layer.locked ? "Unlock layer (⇧⌘L)" : "Lock layer (⇧⌘L)")
            Button { controller.toggleVisible(layer.id) } label: {
                Image(systemName: layer.visible ? "eye" : "eye.slash")
                    .foregroundStyle(layer.visible ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
            }
            .buttonStyle(.borderless)
            .help(layer.visible ? "Hide layer (⇧⌘H)" : "Show layer (⇧⌘H)")
            Menu {
                Button("Duplicate", systemImage: "plus.square.on.square") { controller.duplicateLayer(layer.id) }
                Button("Copy", systemImage: "document.on.document") { controller.copySelection() }
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { controller.deleteLayer(layer.id) }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("More")
        }
    }
}

// MARK: Photo

struct ImageSections: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let props = layer.image ?? ImageProperties()
        let id = layer.id
        let asset = controller.project.asset(props.assetID)
        Section("Photo") {
            if let asset {
                HStack(spacing: 10) {
                    if let image = controller.document.images.image(for: asset, pixelEdge: 120) {
                        Image(decorative: image, scale: 1).resizable().scaledToFill()
                            .frame(width: 40, height: 40)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(asset.name).lineLimit(1).truncationMode(.middle)
                        Text(assetDetail(asset)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    Spacer(minLength: 0)
                }
                HStack {
                    Button("Replace…") { controller.replacePhoto(id) }
                    Button("Adjust Crop") { controller.beginCropEditing(id) }
                }
                .controlSize(.small)
            } else {
                Label("This slot is empty. Click a photo in Media or drop a file on the slot to fill it.", systemImage: "photo.badge.plus")
                    .font(.callout)
                    .foregroundStyle(.tint)
                Button("Choose Photo…") { controller.replacePhoto(id) }
            }

            GestureSlider(title: "Crop Zoom", value: controller.layerBinding(id, name: "Change Crop", fallback: 1, get: { $0.image?.cropScale }, set: { $0.image?.cropScale = $1 }),
                          range: 1...4, display: String(format: "%.2f×", props.cropScale), controller: controller, undoName: "Change Crop")
            HStack(spacing: 12) {
                GestureSlider(title: "Horizontal", value: controller.layerBinding(id, name: "Change Crop", fallback: 0, get: { $0.image?.cropOffsetX }, set: { $0.image?.cropOffsetX = $1 }),
                              range: -0.5...0.5, display: "\(Int((props.cropOffsetX * 100).rounded()))%", controller: controller, undoName: "Change Crop")
                GestureSlider(title: "Vertical", value: controller.layerBinding(id, name: "Change Crop", fallback: 0, get: { $0.image?.cropOffsetY }, set: { $0.image?.cropOffsetY = $1 }),
                              range: -0.5...0.5, display: "\(Int((props.cropOffsetY * 100).rounded()))%", controller: controller, undoName: "Change Crop")
            }
            HStack(alignment: .top, spacing: 12) {
                FocalPointGrid(x: props.cropOffsetX, y: props.cropOffsetY) { point in
                    controller.updateLayer(id, "Change Focal Point") { $0.image?.cropOffsetX = point.x; $0.image?.cropOffsetY = point.y }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Focal Point").font(.callout).foregroundStyle(.secondary)
                    Text(FocalPoint.all.first { abs($0.x - props.cropOffsetX) < 0.01 && abs($0.y - props.cropOffsetY) < 0.01 }?.label ?? "Custom")
                    Text("Keeps this part of the photo in view when cropping.").font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func assetDetail(_ asset: MediaAsset) -> String {
        let kind = asset.mediaKind == .video ? "Video · \(MediaTile.duration(asset.duration))" : asset.mediaKind == .gif ? "Animated" : "Photo"
        return "\(kind) · \(Int(asset.width)) × \(Int(asset.height))"
    }
}

struct FocalPointGrid: View {
    var x: Double
    var y: Double
    var select: (FocalPoint) -> Void

    var body: some View {
        Grid(horizontalSpacing: 3, verticalSpacing: 3) {
            ForEach(0..<3, id: \.self) { row in
                GridRow {
                    ForEach(0..<3, id: \.self) { col in
                        let point = FocalPoint.all[row * 3 + col]
                        let active = abs(point.x - x) < 0.01 && abs(point.y - y) < 0.01
                        Button { select(point) } label: {
                            Circle().frame(width: 6, height: 6)
                                .foregroundStyle(active ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
                                .frame(width: 22, height: 22)
                                .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(active ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary.opacity(0.5))))
                        }
                        .buttonStyle(.plain)
                        .help(point.label)
                        .accessibilityLabel(point.label)
                        .accessibilityAddTraits(active ? .isSelected : [])
                    }
                }
            }
        }
    }
}

// MARK: Text

struct TextSections: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let props = layer.text ?? TextProperties(text: "")
        let id = layer.id
        Section("Text") {
            TextField("Text", text: controller.layerBinding(id, name: "Edit Text", coalesce: true, fallback: "", get: { $0.text?.text }, set: { $0.text?.text = $1 }), axis: .vertical)
                .lineLimit(2...8)
                .labelsHidden()
            Button("Edit on Canvas") { controller.beginTextEditing(id) }
                .controlSize(.small)
                .disabled(layer.locked)
        }
        Section("Typography") {
            LabeledContent("Font") {
                Menu {
                    Section("Suggested") {
                        ForEach(FontCatalog.suggested, id: \.self) { family in
                            Button { setFamily(family) } label: {
                                if family == props.fontFamily { Label(FontCatalog.displayName(family), systemImage: "checkmark") } else { Text(FontCatalog.displayName(family)) }
                            }
                        }
                    }
                    Menu("All Fonts") {
                        ForEach(FontCatalog.installedFamilies, id: \.self) { family in
                            Button(family) { setFamily(family) }
                        }
                    }
                } label: {
                    Text(FontCatalog.displayName(props.fontFamily)).lineLimit(1)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            Picker("Weight", selection: controller.layerBinding(id, name: "Change Font Weight", fallback: 400, get: { $0.text?.fontWeight }, set: { $0.text?.fontWeight = $1 })) {
                ForEach(FontCatalog.weights, id: \.value) { weight in Text(weight.name).tag(weight.value) }
            }
            LabeledContent(props.autoFit ? "Largest Size" : "Size") {
                HStack(spacing: 6) {
                    ScrubField(label: "Size", systemImage: "textformat.size", value: controller.layerBinding(id, name: "Change Font Size", fallback: 96, get: { $0.text?.fontSize }, set: { $0.text?.fontSize = $1 }),
                               range: 8...400, suffix: "px", onScrubBegan: controller.beginGesture, onScrubEnded: { controller.endGesture("Change Font Size") })
                        .frame(width: 96)
                    Stepper("Size", value: controller.layerBinding(id, name: "Change Font Size", coalesce: true, fallback: 96, get: { $0.text?.fontSize }, set: { $0.text?.fontSize = clamp($1, 8, 400) }), step: 2)
                        .labelsHidden()
                }
            }
            HStack {
                Picker("Alignment", selection: controller.layerBinding(id, name: "Change Alignment", fallback: TextAlignment.center, get: { $0.text?.align }, set: { $0.text?.align = $1 })) {
                    Image(systemName: "text.alignleft").help("Align Left").tag(TextAlignment.left)
                    Image(systemName: "text.aligncenter").help("Center").tag(TextAlignment.center)
                    Image(systemName: "text.alignright").help("Align Right").tag(TextAlignment.right)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Toggle(isOn: controller.layerBinding(id, name: "Toggle Italic", fallback: false, get: { $0.text?.italic }, set: { $0.text?.italic = $1 })) {
                    Image(systemName: "italic")
                }
                .toggleStyle(.button)
                .help("Italic")
            }
            Toggle(isOn: controller.layerBinding(id, name: "Shrink to Fit", fallback: false, get: { $0.text?.autoFit }, set: { l, on in
                l.text?.autoFit = on
                if !on { EditorController.fitTextHeight(&l) }
            })) {
                Text("Shrink to Fit")
                Text("Text gets smaller to stay inside its box.")
            }
        }
        TextFillSection(controller: controller, layer: layer)
        Section("Spacing") {
            GestureSlider(title: "Line Height", value: controller.layerBinding(id, name: "Change Line Height", fallback: 1.15, get: { $0.text?.lineHeight }, set: { $0.text?.lineHeight = ($1 * 100).rounded() / 100 }),
                          range: 0.8...2.5, display: String(format: "%.2f", props.lineHeight), controller: controller, undoName: "Change Line Height")
            GestureSlider(title: "Letter Spacing", value: controller.layerBinding(id, name: "Change Letter Spacing", fallback: 0, get: { $0.text?.letterSpacing }, set: { $0.text?.letterSpacing = $1.rounded() }),
                          range: -10...50, display: "\(Int(props.letterSpacing))", controller: controller, undoName: "Change Letter Spacing")
        }
        TextOutlineSection(controller: controller, layer: layer)
        TextHighlightSection(controller: controller, layer: layer)
    }

    private func setFamily(_ family: String) {
        controller.updateLayer(layer.id, "Change Font") { $0.text?.fontFamily = family }
    }
}

// MARK: Shape

struct ShapeSection: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let props = layer.shape ?? ShapeProperties(shape: .rect)
        let id = layer.id
        Section(props.shape == .ellipse ? "Ellipse" : "Rectangle") {
            ColorPicker("Fill", selection: controller.layerBinding(id, name: "Change Fill", coalesce: true, fallback: "#7c5cff", get: { $0.shape?.fill }, set: { $0.shape?.fill = $1 }).hexColor())
            LabeledContent("Stroke") {
                HStack(spacing: 8) {
                    ScrubField(label: "W", value: controller.layerBinding(id, name: "Change Stroke Width", fallback: 0, get: { $0.shape?.strokeWidth }, set: { l, v in
                        l.shape?.strokeWidth = max(0, v)
                        if v > 0, HexColor.isTransparent(l.shape?.stroke ?? "") { l.shape?.stroke = "#111111" }
                    }), range: 0...200, suffix: "px", onScrubBegan: controller.beginGesture, onScrubEnded: { controller.endGesture("Change Stroke Width") })
                    .frame(width: 84)
                    ColorPicker("Stroke Color", selection: controller.layerBinding(id, name: "Change Stroke", coalesce: true, fallback: "#000000",
                                                                                    get: { HexColor.isTransparent($0.shape?.stroke ?? "") ? "#000000" : $0.shape?.stroke },
                                                                                    set: { l, v in l.shape?.stroke = v; if (l.shape?.strokeWidth ?? 0) == 0 { l.shape?.strokeWidth = 4 } }).hexColor())
                        .labelsHidden()
                }
            }
            if props.shape == .rect {
                GestureSlider(title: "Corner Radius", value: controller.layerBinding(id, name: "Change Corner Radius", fallback: 0, get: { $0.shape?.cornerRadius }, set: { $0.shape?.cornerRadius = $1 }),
                              range: 0...max(1, min(layer.width, layer.height) / 2), display: "\(Int(props.cornerRadius.rounded())) px", controller: controller, undoName: "Change Corner Radius")
            }
        }
    }
}

// MARK: Position

struct PositionSection: View {
    var controller: EditorController
    var layer: Layer
    @State private var keepRatio = false

    var body: some View {
        let id = layer.id
        let locked = layer.locked
        // Text boxes fit their height to the text, unless the text shrinks to fit the box.
        let isText = layer.text.map { !$0.autoFit } ?? false
        Section {
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                GridRow {
                    scrub("X", value: binding(\.x, "Move Layer"), name: "Move Layer")
                    scrub("Y", value: binding(\.y, "Move Layer"), name: "Move Layer")
                    Color.clear.frame(width: 18, height: 1)
                }
                GridRow {
                    scrub("W", value: sizeBinding(width: true), name: "Resize Layer", range: 1...100_000)
                    scrub("H", value: sizeBinding(width: false), name: "Resize Layer", range: 1...100_000)
                        .disabled(isText)
                        .help(isText ? "Text boxes size their height to fit the text" : "")
                    Button { keepRatio.toggle() } label: {
                        Image(systemName: keepRatio ? "link" : "link")
                            .foregroundStyle(keepRatio ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                    }
                    .buttonStyle(.borderless)
                    .help(keepRatio ? "Proportions locked" : "Lock proportions")
                    .disabled(isText)
                }
            }
            .disabled(locked)
            HStack(spacing: 10) {
                scrub("Rotation", systemImage: "rotate.right", value: binding(\.rotation, "Rotate Layer"), name: "Rotate Layer", range: -360...360, suffix: "°")
                AngleDial(degrees: Binding(get: { layer.rotation }, set: { v in controller.updateLayer(id, "Rotate Layer") { $0.rotation = v > 180 ? v - 360 : v } }),
                          onBegan: controller.beginGesture, onEnded: { controller.endGesture("Rotate Layer") })
                    .disabled(locked)
            }
            .disabled(locked)
            GestureSlider(title: "Opacity", value: controller.layerBinding(id, name: "Change Opacity", fallback: 1, get: { $0.opacity }, set: { $0.opacity = $1 }),
                          range: 0...1, display: "\(Int((layer.opacity * 100).rounded()))%", controller: controller, undoName: "Change Opacity")
        } header: {
            HStack {
                Text("Position & Size")
                if locked {
                    Spacer()
                    Label("Locked", systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func binding(_ keyPath: WritableKeyPath<Layer, Double>, _ name: String) -> Binding<Double> {
        controller.layerBinding(layer.id, name: name, fallback: 0, get: { $0[keyPath: keyPath] }, set: { $0[keyPath: keyPath] = $1 })
    }

    private func sizeBinding(width: Bool) -> Binding<Double> {
        let ratio = layer.width / max(1, layer.height)
        let lock = keepRatio
        return controller.layerBinding(layer.id, name: "Resize Layer", fallback: 1, get: { width ? $0.width : $0.height }) { l, v in
            let value = max(1, v)
            if width {
                l.width = value
                if lock { l.height = value / ratio }
            } else {
                l.height = value
                if lock { l.width = value * ratio }
            }
        }
    }

    private func scrub(_ label: String, systemImage: String? = nil, value: Binding<Double>, name: String, range: ClosedRange<Double> = -100_000...100_000, suffix: String? = nil) -> some View {
        ScrubField(label: label, systemImage: systemImage, value: value, range: range, suffix: suffix,
                   onScrubBegan: controller.beginGesture, onScrubEnded: { controller.endGesture(name) })
    }
}

// MARK: Arrange

struct ArrangeSection: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let loc = controller.project.locate(layer: layer.id)
        let count = loc.map { controller.project.slides[$0.slide].layers.count } ?? 1
        let position = (loc?.index ?? 0) + 1
        let id = layer.id
        Section {
            ControlGroup {
                Button { controller.arrange(id, .back) } label: { Label("Send to Back", systemImage: "square.3.layers.3d.bottom.filled") }
                    .disabled(!controller.canArrange(.back)).help("Send to Back (⌥⌘[)")
                Button { controller.arrange(id, .backward) } label: { Label("Send Backward", systemImage: "square.2.layers.3d.bottom.filled") }
                    .disabled(!controller.canArrange(.backward)).help("Send Backward (⌘[)")
                Button { controller.arrange(id, .forward) } label: { Label("Bring Forward", systemImage: "square.2.layers.3d.top.filled") }
                    .disabled(!controller.canArrange(.forward)).help("Bring Forward (⌘])")
                Button { controller.arrange(id, .front) } label: { Label("Bring to Front", systemImage: "square.3.layers.3d.top.filled") }
                    .disabled(!controller.canArrange(.front)).help("Bring to Front (⌥⌘])")
            }
            .labelStyle(.iconOnly)
            ControlGroup {
                Button { controller.align(id, .left) } label: { Label("Align Left", systemImage: "align.horizontal.left") }.help("Align to slide left")
                Button { controller.align(id, .centerX) } label: { Label("Center Horizontally", systemImage: "align.horizontal.center") }.help("Center horizontally on slide")
                Button { controller.align(id, .right) } label: { Label("Align Right", systemImage: "align.horizontal.right") }.help("Align to slide right")
                Button { controller.align(id, .top) } label: { Label("Align Top", systemImage: "align.vertical.top") }.help("Align to slide top")
                Button { controller.align(id, .centerY) } label: { Label("Center Vertically", systemImage: "align.vertical.center") }.help("Center vertically on slide")
                Button { controller.align(id, .bottom) } label: { Label("Align Bottom", systemImage: "align.vertical.bottom") }.help("Align to slide bottom")
            }
            .labelStyle(.iconOnly)
            .disabled(layer.locked)
        } header: {
            HStack {
                Text("Arrange")
                Spacer()
                Text("\(position) of \(count)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
        }
    }
}
