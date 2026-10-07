import SwiftUI

/// Shown when no layer is selected: the current slide and project settings.
struct SlideInspector: View {
    var controller: EditorController

    var body: some View {
        let project = controller.project
        let index = controller.selectedSlideIndex
        let slide = controller.selectedSlide
        let count = project.slides.count
        let layers = slide?.layers.count ?? 0
        let hasPhotoFrames = slide?.layers.contains { $0.visible && $0.kind == .image && $0.groupKind != .blend } ?? false

        Form {
            Section {
                HStack(spacing: 12) {
                    SlideThumbnail(scene: SlideScene(project: project, index: index), images: controller.document.images,
                                   revision: controller.document.images.revision)
                        .equatable()
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(.primary.opacity(0.12)) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Slide \(index + 1)").font(.headline)
                        Text("\(count) slide\(count == 1 ? "" : "s") · \(layers) layer\(layers == 1 ? "" : "s")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if layers == 0 {
                Section("Start This Slide") {
                    Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                        GridRow {
                            quick("Photo Grid", "square.grid.2x2") { controller.sidebarPanel = .grids }
                            quick("Import Media", "photo.badge.plus") { controller.requestImport(.add(slide: index, center: nil)) }
                        }
                        GridRow {
                            quick("Text", "textformat") { controller.addText() }
                            quick("Shape", "square.on.circle") { controller.sidebarPanel = .shapes }
                        }
                    }
                }
            }

            if let live = project.liveGrid(slide: index) {
                let linked = controller.gridLinked
                let shared = live.template.linkedMax(format: project.format)
                let marginMax = linked ? shared : GridTemplate.maxMargin(width: project.format.width, height: project.format.height)
                let margin = min(live.grid.margin, marginMax)
                let gapMax = max(1, linked ? shared : live.template.maxGap(format: project.format, margin: margin))
                let gap = min(live.grid.gap, gapMax)
                Section {
                    // Linked: either slider sets both, so the spacing stays equal.
                    LinkedSliders(linked: Binding(get: { linked }, set: { on in
                        if on { let v = min(live.grid.gap, shared); controller.setSlideGrid(gap: v, margin: v) }
                        controller.gridLinked = on
                    })) {
                        GestureSlider(title: "Gap", value: Binding(get: { gap }, set: { let v = $0.rounded(); controller.setSlideGrid(gap: v, margin: linked ? v : nil) }),
                                      range: 0...gapMax, display: "\(Int(gap)) px", controller: controller, undoName: "Adjust Grid")
                    } bottom: {
                        GestureSlider(title: "Outer Margin", value: Binding(get: { margin }, set: { let v = $0.rounded(); controller.setSlideGrid(gap: linked ? v : nil, margin: v) }),
                                      range: 0...max(1, marginMax), display: "\(Int(margin)) px", controller: controller, undoName: "Adjust Grid")
                    }
                    if live.movedSlots > 0 {
                        Text("\(live.movedSlots) slot\(live.movedSlots == 1 ? " was" : "s were") moved by hand and won’t follow these sliders.")
                            .font(.caption).foregroundStyle(.secondary)
                        Button("Re-attach Moved Slots") { controller.reattachGridSlots() }
                    }
                    let gridSlides = project.gridSlideCount
                    if gridSlides > 1 {
                        Button("Apply to All \(gridSlides) Slides") { controller.applyGridSpacingToAllSlides() }
                            .accessibilityLabel("Apply grid spacing to all \(gridSlides) slides")
                    }
                } header: {
                    HStack { Text("Photo Grid"); Spacer(); Text(live.template.name).foregroundStyle(.secondary) }
                }
            }

            Section {
                HStack(spacing: 6) {
                    ForEach(Array(Swatches.quick.enumerated()), id: \.offset) { _, bg in
                        SwatchButton(background: bg, selected: Swatches.same(slide?.background, bg),
                                     shape: AnyShape(RoundedRectangle(cornerRadius: 5, style: .continuous))) { controller.setBackground(bg) }
                            .aspectRatio(1, contentMode: .fit)
                    }
                }
                if count > 1 {
                    Button("Apply to All \(count) Slides") { controller.applyBackgroundToAllSlides() }
                }
            } header: {
                HStack {
                    Text("Background")
                    Spacer()
                    Button("More") { controller.sidebarPanel = .background }
                        .buttonStyle(.borderless)
                        .controlSize(.small)
                }
            }

            Section("Canvas") {
                Picker("Format", selection: Binding(get: { project.format }, set: { controller.setFormat($0) })) {
                    ForEach(CanvasFormat.presets) { format in
                        Text("\(format.name)").tag(format)
                    }
                    if !CanvasFormat.presets.contains(project.format) {
                        Text(project.format.name).tag(project.format)
                    }
                }
                LabeledContent("Size", value: "\(project.format.dimensions) px")
            }

            if hasPhotoFrames {
                Section("Photos") {
                    Button { _ = controller.shufflePhotos() } label: { Label("Shuffle Photos", systemImage: "shuffle") }
                        .disabled(!controller.canShufflePhotos)
                    Text(controller.canShufflePhotos
                         ? "Photos trade places while every frame stays where it is."
                         : "Add at least two different photos to this slide to shuffle them.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Slide") {
                HStack {
                    Button { controller.addSlide(after: controller.selectedSlideID) } label: { Label("Add", systemImage: "plus") }
                    Button { controller.duplicateSlide(controller.selectedSlideID) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
                    Button(role: .destructive) { controller.deleteSlide(controller.selectedSlideID) } label: { Label("Delete", systemImage: "trash") }
                        .disabled(count <= 1)
                }
                .controlSize(.small)
            }

            Section {
                Label {
                    Text("Click something on the canvas to edit it, Control-click for actions, or press ⌘K to search every command.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "cursorarrow.click.2").foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private func quick(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(TileButtonStyle())
    }
}
