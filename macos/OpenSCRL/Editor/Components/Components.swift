import SwiftUI

// MARK: - Slide thumbnails

/// The minimum needed to draw one slide, so thumbnails only redraw when their slide changes.
struct SlideScene: Equatable {
    var format: CanvasFormat
    var background: Background
    var items: [SceneItem]
    var assets: [String: MediaAsset]

    init(project: Project, index: Int) {
        format = project.format
        background = project.slides.indices.contains(index) ? project.slides[index].background : .white
        let viewport = project.viewport(ofSlide: index)
        items = project.scene(intersecting: viewport).map { item in
            var local = item
            local.origin.x -= viewport.minX
            return local
        }
        let ids = Set(items.compactMap { $0.layer.image?.assetID })
        assets = project.assetsByID.filter { ids.contains($0.key) }
    }
}

struct SlideThumbnail: View, Equatable {
    let scene: SlideScene
    let images: ImageCache
    let revision: Int
    var editorPlaceholders = true

    static func == (a: SlideThumbnail, b: SlideThumbnail) -> Bool {
        a.revision == b.revision && a.scene == b.scene && a.editorPlaceholders == b.editorPlaceholders
    }

    var body: some View {
        Canvas(rendersAsynchronously: false) { context, size in
            context.withCGContext { cg in
                let scale = size.width / scene.format.width
                cg.scaleBy(x: scale, y: scale)
                let rect = CGRect(origin: .zero, size: scene.format.size)
                cg.clip(to: rect)
                Renderer.drawBackground(scene.background, in: rect, cg: cg)
                var options = RenderOptions(editor: editorPlaceholders)
                options.interpolation = .medium
                for item in scene.items {
                    Renderer.drawLayer(item.layer, origin: item.origin, cg: cg, assets: scene.assets, images: images, options: options)
                }
            }
        }
        .aspectRatio(scene.format.aspectRatio, contentMode: .fit)
    }
}

// MARK: - Format glyph

/// A small rectangle showing a canvas format's proportions.
struct FormatGlyph: View {
    var format: CanvasFormat
    var maxSize = CGSize(width: 28, height: 34)
    var selected = false

    var body: some View {
        let ratio = format.aspectRatio
        let size = ratio >= maxSize.width / maxSize.height
            ? CGSize(width: maxSize.width, height: maxSize.width / ratio)
            : CGSize(width: maxSize.height * ratio, height: maxSize.height)
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary.opacity(0.45)))
            .frame(width: size.width, height: size.height)
            .frame(width: maxSize.width, height: maxSize.height)
    }
}

// MARK: - Backgrounds

extension Background {
    /// A SwiftUI fill matching the renderer's CSS-style gradient angle.
    var shapeStyle: AnyShapeStyle {
        switch self {
        case .solid(let hex):
            return AnyShapeStyle(HexColor.color(hex))
        case .gradient(let from, let to, let angle):
            let r = Geometry.radians(angle)
            let d = CGPoint(x: sin(r), y: -cos(r))
            return AnyShapeStyle(LinearGradient(colors: [HexColor.color(from), HexColor.color(to)],
                                                startPoint: UnitPoint(x: 0.5 - d.x / 2, y: 0.5 - d.y / 2),
                                                endPoint: UnitPoint(x: 0.5 + d.x / 2, y: 0.5 + d.y / 2)))
        }
    }

    var accessibilityName: String {
        switch self {
        case .solid(let hex): "Solid \(hex)"
        case .gradient(let from, let to, _): "Gradient from \(from) to \(to)"
        }
    }
}

struct SwatchButton: View {
    var background: Background
    var selected: Bool
    var shape: AnyShape = AnyShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    var action: () -> Void
    @State private var hovering = false

    private var check: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white)
            .padding(3)
            .background(Circle().fill(.tint))
    }

    private var swatch: some View {
        let fill = shape.fill(background.shapeStyle)
        let bordered = fill.overlay { shape.stroke(.primary.opacity(0.12), lineWidth: 1) }
        let checked = bordered.overlay { if selected { check } }
        return checked
            .padding(2)
            .overlay { if selected { shape.stroke(.tint, lineWidth: 2) } }
            .scaleEffect(hovering ? 1.06 : 1)
            .animation(.snappy(duration: 0.15), value: hovering)
    }

    var body: some View {
        Button(action: action) { swatch }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(background.accessibilityName)
        .accessibilityLabel(background.accessibilityName)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Numeric input

/// A compact number field with a label you can drag to scrub the value (like pro design apps).
struct ScrubField: View {
    var label: String
    var systemImage: String?
    @Binding var value: Double
    var range: ClosedRange<Double> = -100_000...100_000
    var step: Double = 1
    var suffix: String?
    var fractionDigits = 0
    var onScrubBegan: () -> Void = {}
    var onScrubEnded: () -> Void = {}

    @State private var scrubStart: Double?
    @State private var hoveringLabel = false

    var body: some View {
        HStack(spacing: 4) {
            Group {
                if let systemImage { Image(systemName: systemImage).imageScale(.small) } else { Text(label) }
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(hoveringLabel ? .primary : .secondary)
            .frame(minWidth: 12)
            .contentShape(Rectangle())
            .onHover { inside in
                hoveringLabel = inside
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { drag in
                        if scrubStart == nil { scrubStart = value; onScrubBegan() }
                        let delta = (drag.translation.width / 2).rounded() * step
                        value = clamp((scrubStart ?? value) + delta, range.lowerBound, range.upperBound)
                    }
                    .onEnded { _ in
                        scrubStart = nil
                        onScrubEnded()
                    }
            )
            .help("Drag to adjust \(label)")
            TextField(label, value: Binding(get: { value }, set: { value = clamp($0, range.lowerBound, range.upperBound) }),
                      format: .number.precision(.fractionLength(0...fractionDigits)))
                .textFieldStyle(.plain)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .labelsHidden()
            if let suffix { Text(suffix).font(.caption).foregroundStyle(.tertiary) }
        }
        .padding(.horizontal, 7)
        .frame(height: 24)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(.quaternary.opacity(0.6)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }
}

// MARK: - Angle dial

struct AngleDial: View {
    @Binding var degrees: Double
    var size: CGFloat = 28
    var onBegan: () -> Void = {}
    var onEnded: () -> Void = {}
    @State private var dragging = false

    var body: some View {
        let shown = Geometry.normalizedDegrees(degrees)
        ZStack {
            Circle().strokeBorder(.secondary.opacity(0.5), lineWidth: 1)
            Capsule()
                .fill(.tint)
                .frame(width: 2, height: size / 2 - 3)
                .offset(y: -(size / 4 - 1.5))
                .rotationEffect(.degrees(shown))
            Circle().fill(.tint).frame(width: 5, height: 5)
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { drag in
                    if !dragging { dragging = true; onBegan() }
                    let c = CGPoint(x: size / 2, y: size / 2)
                    var angle = atan2(drag.location.y - c.y, drag.location.x - c.x) * 180 / .pi + 90
                    if NSEvent.modifierFlags.contains(.shift) { angle = (angle / 15).rounded() * 15 }
                    degrees = Geometry.normalizedDegrees(angle.rounded())
                }
                .onEnded { _ in dragging = false; onEnded() }
        )
        .help("Drag to rotate · Shift snaps to 15°")
        .accessibilityElement()
        .accessibilityLabel("Angle")
        .accessibilityValue("\(Int(shown)) degrees")
        .accessibilityAdjustableAction { direction in
            degrees += direction == .increment ? 1 : -1
        }
    }
}

// MARK: - Section header

struct PanelHeader<Trailing: View>: View {
    var title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                trailing
            }
            if let subtitle {
                Text(subtitle).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

extension PanelHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

// MARK: - Layer bindings

extension EditorController {
    /// A binding to a layer property. Discrete edits each get an undo step; edits made between
    /// `beginGesture` and `endGesture` (sliders, scrubbing) become one step; `coalesce` merges
    /// rapid edits such as color well changes.
    func layerBinding<T>(_ id: String, name: String, coalesce: Bool = false, fallback: T,
                         get: @escaping (Layer) -> T?, set: @escaping (inout Layer, T) -> Void) -> Binding<T> {
        Binding(
            get: { [weak self] in self?.project.layer(id).flatMap(get) ?? fallback },
            set: { [weak self] value in
                self?.updateLayer(id, name, coalesce: coalesce ? "\(name):\(id)" : nil) { set(&$0, value) }
            }
        )
    }
}

/// Slider that groups a drag into a single undo step.
struct GestureSlider: View {
    var title: String
    @Binding var value: Double
    var range: ClosedRange<Double>
    var step: Double? = nil
    var display: String
    var controller: EditorController
    var undoName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title).foregroundStyle(.secondary)
                Spacer()
                Text(display).monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.callout)
            Group {
                if let step {
                    Slider(value: $value, in: range, step: step) { editing in edit(editing) }
                } else {
                    Slider(value: $value, in: range) { editing in edit(editing) }
                }
            }
            .controlSize(.small)
            .labelsHidden()
            .accessibilityLabel(title)
        }
    }

    private func edit(_ editing: Bool) {
        if editing { controller.beginGesture() } else { controller.endGesture(undoName) }
    }
}
