import SwiftUI

/// The slide background: a color, a gradient, a photo (sharp or blurred into a backdrop), or
/// nothing, for transparent PNGs. Matches the web app's Background panel.
struct BackgroundPanel: View {
    var controller: EditorController
    @State private var mode: Mode = .color
    /// The last value of each kind, so switching back and forth doesn't lose edits.
    @State private var memory: [Mode: Background] = [:]

    enum Mode: String, CaseIterable, Identifiable {
        case color = "Color", gradient = "Gradient", photo = "Photo", none = "None"
        var id: Self { self }

        init(_ background: Background) {
            switch background {
            case .solid: self = .color
            case .gradient: self = .gradient
            case .image: self = .photo
            case .transparent: self = .none
            }
        }
    }

    static let gradientPresets: [Gradient] = Swatches.gradients.compactMap { if case .gradient(let g) = $0 { g } else { nil } } + [
        Gradient(type: .radial, angle: 0, stops: [GradientStop(offset: 0, color: "#fde68a"), GradientStop(offset: 0.5, color: "#fb7185"), GradientStop(offset: 1, color: "#7c5cff")]),
        Gradient(type: .linear, angle: 160, stops: [GradientStop(offset: 0, color: "#0f172a"), GradientStop(offset: 0.55, color: "#1e3a8a"), GradientStop(offset: 1, color: "#7c3aed")]),
        Gradient(type: .linear, angle: 120, stops: [GradientStop(offset: 0, color: "#fef3c7"), GradientStop(offset: 0.5, color: "#fecaca"), GradientStop(offset: 1, color: "#e9d5ff")]),
        Gradient(type: .radial, angle: 0, stops: [GradientStop(offset: 0, color: "#ffffff"), GradientStop(offset: 1, color: "#c7d2fe")]),
        Gradient(type: .linear, angle: 180, stops: [GradientStop(offset: 0, color: "#f97316"), GradientStop(offset: 0.5, color: "#db2777"), GradientStop(offset: 1, color: "#4c1d95")]),
        Gradient(type: .radial, angle: 0, stops: [GradientStop(offset: 0, color: "#34d399"), GradientStop(offset: 0.6, color: "#0e7490"), GradientStop(offset: 1, color: "#0f172a")]),
    ]

    private let solidColumns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 6)
    private let gradientColumns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)
    private let photoColumns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)

    var body: some View {
        let current = controller.selectedSlide?.background ?? .solid("#ffffff")
        let count = controller.project.slides.count

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PanelHeader(title: "Background", subtitle: "Changes apply to slide \(controller.selectedSlideIndex + 1).")

                Picker("Background Type", selection: Binding(get: { mode }, set: { choose($0, current: current) })) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .frame(maxWidth: .infinity)

                switch mode {
                case .color: colorSection(current)
                case .gradient: gradientSection(current)
                case .photo: photoSection(current)
                case .none: noneSection
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
        .onAppear { sync(current) }
        .onChange(of: controller.selectedSlideID) { _, _ in sync(controller.selectedSlide?.background ?? current) }
        .onChange(of: current) { _, next in sync(next) }
    }

    private func sync(_ background: Background) {
        mode = Mode(background)
        memory[mode] = background
    }

    private func choose(_ next: Mode, current: Background) {
        mode = next
        guard next != Mode(current) else { return }
        if let remembered = memory[next] { controller.setBackground(remembered); return }
        let base: String = switch current {
        case .solid(let hex): hex
        case .gradient(let g): g.firstColor
        case .image(let image): image.color
        case .transparent: "#ffffff"
        }
        switch next {
        case .color: controller.setBackground(.solid(base))
        case .gradient: controller.setBackground(.gradient(Self.gradientPresets[0]))
        case .none: controller.setBackground(.transparent)
        case .photo:
            // Default to a soft, blurred copy of this slide's photo: the classic carousel backdrop.
            let slidePhotos = slidePhotoIDs
            let assetID = slidePhotos.first ?? stillAssets.first?.id
            controller.setBackground(.image(BackgroundImage(assetID: assetID, blur: assetID.map(slidePhotos.contains) == true ? 48 : 0, dim: 0, color: "#111111")))
        }
    }

    private var slidePhotoIDs: [String] {
        (controller.selectedSlide?.layers ?? []).compactMap { $0.image?.assetID }
    }

    private var stillAssets: [MediaAsset] { controller.project.assets.filter { $0.mediaKind != .video } }

    // MARK: Color

    @ViewBuilder private func colorSection(_ current: Background) -> some View {
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

    // MARK: Gradient

    @ViewBuilder private func gradientSection(_ current: Background) -> some View {
        let gradient: Gradient = if case .gradient(let g) = current { g } else { Self.gradientPresets[0] }
        LazyVGrid(columns: gradientColumns, spacing: 8) {
            ForEach(Array(Self.gradientPresets.enumerated()), id: \.offset) { _, preset in
                let bg = Background.gradient(preset)
                SwatchButton(background: bg, selected: Swatches.same(current, bg)) { controller.setBackground(bg) }
                    .aspectRatio(1, contentMode: .fit)
            }
        }
        VStack(alignment: .leading, spacing: 10) {
            BackgroundPreview(controller: controller, background: .gradient(gradient))
                .frame(maxWidth: .infinity)
                .frame(height: 120)
            GradientEditor(gradient: gradient,
                           update: { controller.setBackground(.gradient($0), coalesce: true) },
                           begin: controller.beginGesture,
                           end: { controller.endGesture($0) })
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.quaternary.opacity(0.45)))
    }

    // MARK: Photo

    @ViewBuilder private func photoSection(_ current: Background) -> some View {
        let image: BackgroundImage = if case .image(let i) = current { i } else { BackgroundImage() }
        let set = { (next: BackgroundImage) in controller.setBackground(.image(next)) }
        BackgroundPreview(controller: controller, background: .image(image))
            .frame(maxWidth: .infinity)
            .frame(height: 150)
        GestureSlider(title: "Blur", value: Binding(get: { image.blur }, set: { var n = image; n.blur = $0.rounded(); set(n) }),
                      range: 0...120, display: image.blur > 0 ? "\(Int(image.blur)) px" : "Sharp", controller: controller, undoName: "Change Background Blur")
        GestureSlider(title: "Darken", value: Binding(get: { image.dim }, set: { var n = image; n.dim = $0; set(n) }),
                      range: 0...0.8, display: "\(Int((image.dim * 100).rounded()))%", controller: controller, undoName: "Darken Background")
        if let first = slidePhotoIDs.first, !slidePhotoIDs.contains(image.assetID ?? "") {
            Button {
                var n = image
                n.assetID = first
                n.blur = max(n.blur, 48)
                set(n)
            } label: {
                Label("Blur This Slide’s Photo", systemImage: "sparkles").frame(maxWidth: .infinity)
            }
            .controlSize(.large)
        }
        VStack(alignment: .leading, spacing: 8) {
            Text("Photo").font(.subheadline.weight(.semibold))
            if stillAssets.isEmpty {
                Text("Import photos in Media to use one as the background.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: photoColumns, spacing: 6) {
                    ForEach(stillAssets) { asset in
                        PhotoTile(controller: controller, asset: asset, selected: image.assetID == asset.id) {
                            var n = image
                            n.assetID = asset.id
                            set(n)
                        }
                    }
                }
            }
        }
    }

    // MARK: None

    private var noneSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            BackgroundPreview(controller: controller, background: .transparent)
                .frame(maxWidth: .infinity)
                .frame(height: 110)
            Text("Slides export as PNG with a transparent background. Video slides use white, since MP4 has no transparency.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The background drawn by the export renderer at the slide's proportions, so blur and darken
/// look exactly as they will on the canvas and in exports.
private struct BackgroundPreview: View {
    var controller: EditorController
    var background: Background

    var body: some View {
        let format = controller.project.format
        let assets = controller.project.assetsByID
        let images = controller.document.images
        Canvas { context, size in
            let scale = min(size.width / format.width, size.height / format.height)
            let rect = CGRect(x: (size.width - format.width * scale) / 2, y: (size.height - format.height * scale) / 2,
                              width: format.width * scale, height: format.height * scale)
            context.withCGContext { cg in
                cg.saveGState()
                cg.addPath(CGPath(roundedRect: rect, cornerWidth: 8, cornerHeight: 8, transform: nil))
                cg.clip()
                cg.translateBy(x: rect.minX, y: rect.minY)
                cg.scaleBy(x: scale, y: scale)
                Renderer.drawBackground(background, in: CGRect(origin: .zero, size: format.size), cg: cg, images: images, assets: assets, checkerboard: true)
                cg.restoreGState()
            }
            context.stroke(Path(roundedRect: rect, cornerRadius: 8), with: .color(.primary.opacity(0.12)))
        }
    }
}

private struct PhotoTile: View {
    var controller: EditorController
    var asset: MediaAsset
    var selected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let image = controller.document.images.image(for: asset, pixelEdge: 160) {
                        Image(decorative: image, scale: 1).resizable().scaledToFill()
                    } else {
                        Rectangle().fill(.quaternary)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(.primary.opacity(0.12)) }
                .overlay(alignment: .topTrailing) {
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(3)
                            .background(Circle().fill(.tint))
                            .padding(4)
                    }
                }
                .padding(2)
                .overlay { if selected { RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(.tint, lineWidth: 2) } }
                .scaleEffect(hovering ? 1.04 : 1)
                .animation(.snappy(duration: 0.15), value: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(asset.name)
        .accessibilityLabel(asset.name)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
