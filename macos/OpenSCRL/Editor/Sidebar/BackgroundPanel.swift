import SwiftUI

struct BackgroundPanel: View {
    var controller: EditorController
    private let solidColumns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 6)
    private let gradientColumns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        let current = controller.selectedSlide?.background
        let gradient: (from: String, to: String, angle: Double) = {
            if case .gradient(let f, let t, let a) = current { return (f, t, a) }
            if case .gradient(let f, let t, let a) = Swatches.gradients[0] { return (f, t, a) }
            return ("#ffffff", "#000000", 135)
        }()
        let count = controller.project.slides.count

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PanelHeader(title: "Background", subtitle: "Changes apply to slide \(controller.selectedSlideIndex + 1).")

                VStack(alignment: .leading, spacing: 10) {
                    Text("Solid Color").font(.subheadline.weight(.semibold))
                    LazyVGrid(columns: solidColumns, spacing: 8) {
                        ForEach(Swatches.solids, id: \.self) { hex in
                            let bg = Background.solid(hex)
                            SwatchButton(background: bg, selected: Swatches.same(current, bg)) { controller.setBackground(bg) }
                                .aspectRatio(1, contentMode: .fit)
                        }
                    }
                    ColorPicker("Custom Color", selection: Binding<Color>(
                        get: { if case .solid(let hex) = current { HexColor.color(hex) } else { .white } },
                        set: { controller.setBackground(.solid(HexColor.string(from: $0)), coalesce: true) }
                    ), supportsOpacity: false)
                }

                Divider()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Gradient").font(.subheadline.weight(.semibold))
                    LazyVGrid(columns: gradientColumns, spacing: 8) {
                        ForEach(Array(Swatches.gradients.enumerated()), id: \.offset) { _, bg in
                            SwatchButton(background: bg, selected: Swatches.same(current, bg)) { controller.setBackground(bg) }
                                .aspectRatio(4 / 3, contentMode: .fit)
                        }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Background.gradient(from: gradient.from, to: gradient.to, angle: gradient.angle).shapeStyle)
                            .frame(height: 30)
                            .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(.primary.opacity(0.1)) }
                        HStack {
                            ColorPicker("From", selection: Binding<Color>(
                                get: { HexColor.color(gradient.from) },
                                set: { controller.setBackground(.gradient(from: HexColor.string(from: $0), to: gradient.to, angle: gradient.angle), coalesce: true) }
                            ), supportsOpacity: false)
                            Spacer()
                            ColorPicker("To", selection: Binding<Color>(
                                get: { HexColor.color(gradient.to) },
                                set: { controller.setBackground(.gradient(from: gradient.from, to: HexColor.string(from: $0), angle: gradient.angle), coalesce: true) }
                            ), supportsOpacity: false)
                        }
                        HStack(spacing: 10) {
                            AngleDial(degrees: Binding(
                                get: { gradient.angle },
                                set: { controller.setBackground(.gradient(from: gradient.from, to: gradient.to, angle: $0.rounded())) }
                            ), size: 30, onBegan: { controller.beginGesture() }, onEnded: { controller.endGesture("Change Gradient Angle") })
                            GestureSlider(title: "Angle", value: Binding(
                                get: { gradient.angle },
                                set: { controller.setBackground(.gradient(from: gradient.from, to: gradient.to, angle: $0.rounded())) }
                            ), range: 0...360, display: "\(Int(gradient.angle))°", controller: controller, undoName: "Change Gradient Angle")
                        }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.quaternary.opacity(0.45)))
                }

                if count > 1 {
                    Button { controller.applyBackgroundToAllSlides() } label: {
                        Label("Apply to All \(count) Slides", systemImage: "square.grid.3x1.below.line.grid.1x2").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 16)
        }
    }
}
