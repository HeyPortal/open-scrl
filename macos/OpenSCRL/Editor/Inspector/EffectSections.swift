import SwiftUI

// MARK: - Shared controls

/// A section for an optional effect: a switch in the header, its controls only while on.
struct EffectSection<Content: View>: View {
    var title: String
    var hint: String
    @Binding var isOn: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        Section {
            if isOn {
                content()
            } else {
                Text(hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        } header: {
            HStack {
                Text(title)
                Spacer()
                Toggle(title, isOn: $isOn)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .labelsHidden()
                    .help(isOn ? "Remove \(title.lowercased())" : "Add \(title.lowercased())")
            }
        }
    }
}

/// A photo mask outline as a SwiftUI shape, using the renderer's geometry.
struct MaskShape: Shape {
    var mask: ImageMask
    var cornerRadius: Double = 0

    func path(in rect: CGRect) -> Path {
        Path(MaskGeometry.path(mask, size: rect.size, cornerRadius: cornerRadius)).offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

struct MaskPicker: View {
    var selection: ImageMask
    var select: (ImageMask) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(ImageMask.allCases, id: \.self) { mask in
                let active = mask == selection
                Button { select(mask) } label: {
                    MaskShape(mask: mask, cornerRadius: mask == .rect ? 3 : 1)
                        .fill(active ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        .frame(width: 18, height: 18)
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(active ? AnyShapeStyle(.tint.opacity(0.16)) : AnyShapeStyle(.quaternary.opacity(0.5))))
                        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(active ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear)))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(MaskGeometry.displayName(mask))
                .accessibilityLabel(MaskGeometry.displayName(mask))
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
    }
}

/// Edits a gradient: drag stops along the bar, click the bar to add one, pick a stop to change its
/// color. Linear gradients also get an angle. `begin`/`end` bracket drags into one undo step.
struct GradientEditor: View {
    var gradient: Gradient
    var update: (Gradient) -> Void
    var begin: () -> Void
    var end: (String) -> Void
    @State private var selected = 0
    @State private var dragging: Int?

    var body: some View {
        let stops = gradient.stops
        let index = min(selected, max(0, stops.count - 1))
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geo in
                let width = geo.size.width
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Gradient(type: .linear, angle: 90, stops: stops).shapeStyle)
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(.primary.opacity(0.12)))
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            let offset = (clamp(location.x / max(1, width), 0, 1) * 100).rounded() / 100
                            update(Gradient(type: gradient.type, angle: gradient.angle, stops: stops + [GradientStop(offset: offset, color: color(at: offset))]))
                            selected = stops.count
                        }
                        .help("Click to add a color stop")
                    ForEach(Array(stops.enumerated()), id: \.offset) { i, stop in
                        Circle()
                            .fill(HexColor.color(stop.color))
                            .frame(width: 16, height: 16)
                            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                            .overlay(Circle().strokeBorder(.tint, lineWidth: 2).padding(-3).opacity(i == index ? 1 : 0))
                            .shadow(color: .black.opacity(0.35), radius: 1.5, y: 0.5)
                            .position(x: stop.offset * width, y: geo.size.height / 2)
                            .gesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { drag in
                                        if dragging == nil { dragging = i; selected = i; begin() }
                                        let offset = (clamp(drag.location.x / max(1, width), 0, 1) * 100).rounded() / 100
                                        var next = stops
                                        next[i].offset = offset
                                        update(Gradient(type: gradient.type, angle: gradient.angle, stops: next))
                                    }
                                    .onEnded { _ in dragging = nil; end("Move Gradient Stop") }
                            )
                            .accessibilityLabel("Color stop at \(Int(stop.offset * 100))%")
                    }
                }
            }
            .frame(height: 24)
            .padding(.horizontal, 8)

            if stops.indices.contains(index) {
                HStack(spacing: 8) {
                    ColorPicker("Stop Color", selection: Binding(get: { HexColor.color(stops[index].color) }, set: { color in
                        var next = stops
                        next[index].color = HexColor.string(from: color)
                        update(Gradient(type: gradient.type, angle: gradient.angle, stops: next))
                    }), supportsOpacity: true)
                    .labelsHidden()
                    ScrubField(label: "Position", systemImage: "arrow.left.and.right", value: Binding(get: { stops[index].offset * 100 }, set: { v in
                        var next = stops
                        next[index].offset = clamp(v, 0, 100) / 100
                        update(Gradient(type: gradient.type, angle: gradient.angle, stops: next))
                    }), range: 0...100, suffix: "%", onScrubBegan: begin, onScrubEnded: { end("Move Gradient Stop") })
                    Button {
                        update(Gradient(type: gradient.type, angle: gradient.angle, stops: stops.enumerated().filter { $0.offset != index }.map(\.element)))
                        selected = max(0, index - 1)
                    } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                        .disabled(stops.count <= 2)
                        .help("Remove Color Stop")
                }
            }

            HStack(spacing: 8) {
                Picker("Type", selection: Binding(get: { gradient.type }, set: { update(Gradient(type: $0, angle: gradient.angle, stops: stops)) })) {
                    Text("Linear").tag(Gradient.Kind.linear)
                    Text("Radial").tag(Gradient.Kind.radial)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                if gradient.type == .linear {
                    ScrubField(label: "Angle", systemImage: "angle", value: Binding(get: { gradient.angle }, set: { update(Gradient(type: .linear, angle: Geometry.normalizedDegrees($0), stops: stops)) }),
                               range: -360...720, suffix: "°", onScrubBegan: begin, onScrubEnded: { end("Change Gradient Angle") })
                    AngleDial(degrees: Binding(get: { gradient.angle }, set: { update(Gradient(type: .linear, angle: $0, stops: stops)) }),
                              size: 24, onBegan: begin, onEnded: { end("Change Gradient Angle") })
                }
            }
        }
    }

    private func color(at offset: Double) -> String {
        let sorted = gradient.sortedStops
        guard let first = sorted.first, let last = sorted.last else { return "#ffffff" }
        if offset <= first.offset { return first.color }
        for (a, b) in zip(sorted, sorted.dropFirst()) where offset <= b.offset {
            let t = (offset - a.offset) / max(0.0001, b.offset - a.offset)
            guard let x = HexColor.components(a.color), let y = HexColor.components(b.color) else { return a.color }
            func h(_ u: Double, _ v: Double) -> Int { Int(((u + (v - u) * t) * 255).rounded()) }
            return String(format: "#%02x%02x%02x", h(x.r, y.r), h(x.g, y.g), h(x.b, y.b))
        }
        return last.color
    }
}

/// Text that reads well on `hex`.
func contrastingColor(_ hex: String) -> String {
    HexColor.luminance(hex) > 0.6 ? "#111111" : "#ffffff"
}

// MARK: - Shadow

private let shadowPresets: [(name: String, shadow: Shadow)] = [
    ("Soft", Shadow(color: "#000000", opacity: 0.28, blur: 32, offsetX: 0, offsetY: 14)),
    ("Lifted", Shadow(color: "#000000", opacity: 0.38, blur: 70, offsetX: 0, offsetY: 34)),
    ("Hard", Shadow(color: "#000000", opacity: 0.9, blur: 0, offsetX: 10, offsetY: 10)),
    ("Glow", Shadow(color: "#ffffff", opacity: 0.85, blur: 36, offsetX: 0, offsetY: 0)),
]

struct ShadowSection: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let id = layer.id
        let shadow = layer.shadow
        EffectSection(title: "Shadow", hint: "A drop shadow that follows the layer’s outline.", isOn: Binding(
            get: { shadow != nil },
            set: { on in controller.updateLayer(id, on ? "Add Shadow" : "Remove Shadow") { $0.shadow = on ? shadowPresets[0].shadow : nil } }
        )) {
            if let shadow {
                Picker("Style", selection: Binding(get: { shadowPresets.firstIndex { $0.shadow == shadow } ?? -1 },
                                                   set: { i in if shadowPresets.indices.contains(i) { controller.updateLayer(id, "Change Shadow") { $0.shadow = shadowPresets[i].shadow } } })) {
                    ForEach(shadowPresets.indices, id: \.self) { i in Text(shadowPresets[i].name).tag(i) }
                    if !shadowPresets.contains(where: { $0.shadow == shadow }) { Text("Custom").tag(-1) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                ColorPicker("Color", selection: binding(\.color, "Change Shadow Color", "#000000", coalesce: true).hexColor(), supportsOpacity: false)
                GestureSlider(title: "Opacity", value: binding(\.opacity, "Change Shadow", 0.3), range: 0...1, display: "\(Int((shadow.opacity * 100).rounded()))%", controller: controller, undoName: "Change Shadow")
                GestureSlider(title: "Blur", value: binding(\.blur, "Change Shadow", 24), range: 0...160, display: "\(Int(shadow.blur.rounded())) px", controller: controller, undoName: "Change Shadow")
                HStack(spacing: 8) {
                    ScrubField(label: "X", value: binding(\.offsetX, "Move Shadow", 0), suffix: "px", onScrubBegan: controller.beginGesture, onScrubEnded: { controller.endGesture("Move Shadow") })
                    ScrubField(label: "Y", value: binding(\.offsetY, "Move Shadow", 0), suffix: "px", onScrubBegan: controller.beginGesture, onScrubEnded: { controller.endGesture("Move Shadow") })
                }
            }
        }
    }

    private func binding<T>(_ keyPath: WritableKeyPath<Shadow, T>, _ name: String, _ fallback: T, coalesce: Bool = false) -> Binding<T> {
        controller.layerBinding(layer.id, name: name, coalesce: coalesce, fallback: fallback, get: { $0.shadow?[keyPath: keyPath] }, set: { $0.shadow?[keyPath: keyPath] = $1 })
    }
}

// MARK: - Text effects

struct TextFillSection: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let id = layer.id
        let props = layer.text ?? TextProperties(text: "")
        let gradient = props.fillGradient.flatMap { $0.stops.count >= 2 ? $0 : nil }
        Section {
            if let gradient {
                GradientEditor(gradient: gradient, update: { g in controller.updateLayer(id, "Change Text Gradient", coalesce: "text-gradient:\(id)") { $0.text?.fillGradient = g } },
                               begin: controller.beginGesture, end: controller.endGesture)
            } else {
                ColorPicker("Color", selection: controller.layerBinding(id, name: "Change Text Color", coalesce: true, fallback: "#111111", get: { $0.text?.fill }, set: { $0.text?.fill = $1 }).hexColor())
            }
        } header: {
            HStack {
                Text("Fill")
                Spacer()
                Picker("Fill", selection: Binding(get: { gradient != nil }, set: { useGradient in
                    controller.updateLayer(id, useGradient ? "Use Gradient Text" : "Use Solid Text") { l in
                        l.text?.fillGradient = useGradient ? .twoColor(String(props.fill.prefix(7)), "#7c5cff", angle: 90) : nil
                    }
                })) {
                    Text("Solid").tag(false)
                    Text("Gradient").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
            }
        }
    }
}

struct TextOutlineSection: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let id = layer.id
        let props = layer.text ?? TextProperties(text: "")
        EffectSection(title: "Outline", hint: "A stroke around every letter. Great on busy photos.", isOn: Binding(
            get: { props.strokeWidth > 0 },
            set: { on in
                controller.updateLayer(id, on ? "Add Outline" : "Remove Outline") { l in
                    guard var t = l.text else { return }
                    if on {
                        t.strokeWidth = max(2, (t.fontSize * 0.05).rounded())
                        if t.stroke.lowercased() == t.fill.lowercased() || HexColor.isTransparent(t.stroke) { t.stroke = contrastingColor(t.fill) }
                    } else { t.strokeWidth = 0 }
                    l.text = t
                }
            }
        )) {
            ColorPicker("Color", selection: controller.layerBinding(id, name: "Change Outline Color", coalesce: true, fallback: "#000000", get: { $0.text?.stroke }, set: { $0.text?.stroke = $1 }).hexColor(), supportsOpacity: false)
            GestureSlider(title: "Width", value: controller.layerBinding(id, name: "Change Outline", fallback: 2, get: { $0.text?.strokeWidth }, set: { $0.text?.strokeWidth = max(1, $1.rounded()) }),
                          range: 1...max(24, (props.fontSize * 0.25).rounded()), display: "\(Int(props.strokeWidth.rounded())) px", controller: controller, undoName: "Change Outline")
        }
    }
}

struct TextHighlightSection: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let id = layer.id
        let props = layer.text ?? TextProperties(text: "")
        let highlight = props.highlight
        EffectSection(title: "Highlight", hint: "A colored box behind the text, around each line or the whole block.", isOn: Binding(
            get: { highlight != nil },
            set: { on in
                controller.updateLayer(id, on ? "Add Highlight" : "Remove Highlight") { l in
                    l.text?.highlight = on ? TextHighlight(style: .lines, color: contrastingColor(props.fill), padding: (props.fontSize * 0.25).rounded(), radius: (props.fontSize * 0.16).rounded()) : nil
                }
            }
        )) {
            if let highlight {
                Picker("Style", selection: binding(\.style, "Change Highlight", .lines)) {
                    Text("Each Line").tag(TextHighlight.Style.lines)
                    Text("One Box").tag(TextHighlight.Style.box)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                ColorPicker("Color", selection: binding(\.color, "Change Highlight Color", "#ffffff", coalesce: true).hexColor(), supportsOpacity: true)
                HStack(spacing: 12) {
                    GestureSlider(title: "Padding", value: binding(\.padding, "Change Highlight", 16), range: 0...max(60, (props.fontSize * 0.8).rounded()),
                                  display: "\(Int(highlight.padding.rounded())) px", controller: controller, undoName: "Change Highlight")
                    GestureSlider(title: "Corners", value: binding(\.radius, "Change Highlight", 12), range: 0...max(60, (props.fontSize * 0.6).rounded()),
                                  display: "\(Int(highlight.radius.rounded())) px", controller: controller, undoName: "Change Highlight")
                }
            }
        }
    }

    private func binding<T>(_ keyPath: WritableKeyPath<TextHighlight, T>, _ name: String, _ fallback: T, coalesce: Bool = false) -> Binding<T> {
        controller.layerBinding(layer.id, name: name, coalesce: coalesce, fallback: fallback, get: { $0.text?.highlight?[keyPath: keyPath] }, set: { $0.text?.highlight?[keyPath: keyPath] = $1 })
    }
}

// MARK: - Photo frame

struct PhotoFrameSections: View {
    var controller: EditorController
    var layer: Layer

    var body: some View {
        let id = layer.id
        let props = layer.image ?? ImageProperties()
        let radiusMax = max(1, min(layer.width, layer.height) / (props.mask == .rect ? 2 : 4))
        Section {
            MaskPicker(selection: props.mask) { mask in controller.updateLayer(id, "Change Photo Shape") { $0.image?.mask = mask } }
            if MaskGeometry.usesCornerRadius(props.mask) {
                GestureSlider(title: "Corner Radius", value: controller.layerBinding(id, name: "Change Corner Radius", fallback: 0, get: { $0.image.map { min($0.cornerRadius, radiusMax) } }, set: { $0.image?.cornerRadius = $1 }),
                              range: 0...radiusMax, display: "\(Int(min(props.cornerRadius, radiusMax).rounded())) px", controller: controller, undoName: "Change Corner Radius")
            }
        } header: {
            HStack {
                Text("Shape")
                Spacer()
                Button("Reset Photo", systemImage: "arrow.counterclockwise") {
                    controller.updateLayer(id, "Reset Photo") { l in
                        l.image?.mask = .rect
                        l.image?.cornerRadius = 0
                        l.image?.cropOffsetX = 0
                        l.image?.cropOffsetY = 0
                        l.image?.cropScale = 1
                    }
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .labelStyle(.titleAndIcon)
            }
        }
        EffectSection(title: "Border", hint: "A frame inside the photo’s outline.", isOn: Binding(
            get: { props.strokeWidth > 0 },
            set: { on in
                let width = max(4, (min(layer.width, layer.height) * 0.02).rounded())
                controller.updateLayer(id, on ? "Add Border" : "Remove Border") { $0.image?.strokeWidth = on ? width : 0 }
            }
        )) {
            ColorPicker("Color", selection: controller.layerBinding(id, name: "Change Border Color", coalesce: true, fallback: "#ffffff", get: { $0.image?.stroke }, set: { $0.image?.stroke = $1 }).hexColor(), supportsOpacity: false)
            GestureSlider(title: "Width", value: controller.layerBinding(id, name: "Change Border", fallback: 4, get: { $0.image?.strokeWidth }, set: { $0.image?.strokeWidth = max(1, $1.rounded()) }),
                          range: 1...max(40, (min(layer.width, layer.height) * 0.1).rounded()), display: "\(Int(props.strokeWidth.rounded())) px", controller: controller, undoName: "Change Border")
        }
    }
}
