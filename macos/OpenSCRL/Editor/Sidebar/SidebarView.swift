import SwiftUI

struct SidebarView: View {
    @Bindable var controller: EditorController

    var body: some View {
        VStack(spacing: 0) {
            Picker("Panel", selection: $controller.sidebarPanel) {
                ForEach(SidebarPanel.allCases) { panel in
                    Label(panel.title, systemImage: panel.symbol)
                        .help(panel.title)
                        .tag(panel)
                }
            }
            .pickerStyle(.segmented)
            .labelStyle(.iconOnly)
            .labelsHidden()
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 10)

            Group {
                switch controller.sidebarPanel {
                case .grids: GridsPanel(controller: controller)
                case .media: MediaPanel(controller: controller)
                case .text: TextPanel(controller: controller)
                case .shapes: ShapesPanel(controller: controller)
                case .background: BackgroundPanel(controller: controller)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .navigationTitle(controller.sidebarPanel.title)
    }
}

/// Shared tile chrome for sidebar grids.
struct TileButtonStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        TileBody(configuration: configuration, selected: selected)
    }

    private struct TileBody: View {
        let configuration: Configuration
        let selected: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .padding(6)
                .frame(maxWidth: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(selected ? AnyShapeStyle(.tint.opacity(0.18)) : AnyShapeStyle(.quaternary.opacity(hovering ? 0.9 : 0.45)))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 1.5)
                }
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(.snappy(duration: 0.15), value: configuration.isPressed)
                .onHover { hovering = $0 }
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}

// MARK: - Grids

struct GridsPanel: View {
    @Bindable var controller: EditorController
    private let columns = [GridItem(.adaptive(minimum: 68, maximum: 110), spacing: 8)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "Photo Grids", subtitle: "Replaces the current slide’s layers with empty photo slots. Undo with ⌘Z.")
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("Gap between photos").foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(controller.gridGap)) px").monospacedDigit().foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    Slider(value: Binding(get: { controller.gridGap }, set: { controller.gridGap = $0.rounded() }), in: 0...120).controlSize(.small).labelsHidden()
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("Outer margin").foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(controller.gridMargin)) px").monospacedDigit().foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    Slider(value: Binding(get: { controller.gridMargin }, set: { controller.gridMargin = $0.rounded() }),
                           in: 0...GridTemplate.maxMargin(width: controller.project.format.width, height: controller.project.format.height))
                        .controlSize(.small).labelsHidden()
                        .accessibilityLabel("Outer margin")
                }
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(GridTemplate.all) { template in
                        Button { controller.applyGrid(template) } label: {
                            VStack(spacing: 6) {
                                GridPreview(template: template, ratio: controller.project.format.aspectRatio, gap: controller.gridGap, margin: controller.gridMargin)
                                    .frame(height: 64)
                                Text(template.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .buttonStyle(TileButtonStyle())
                        .help("Apply the \(template.name) grid")
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 16)
        }
    }
}

struct GridPreview: View {
    var template: GridTemplate
    var ratio: Double
    var gap: Double
    var margin: Double

    var body: some View {
        Canvas { context, size in
            let h = size.height, w = min(size.width, h * ratio)
            let originX = (size.width - w) / 2
            let previewGap = max(2, gap / 120 * 6)
            let previewMargin = margin / 120 * 6
            context.fill(Path(roundedRect: CGRect(x: originX, y: 0, width: w, height: h), cornerRadius: 3), with: .color(.secondary.opacity(0.15)))
            for cell in template.cells(w - 2 * previewMargin, h - 2 * previewMargin, previewGap) {
                let r = CGRect(x: originX + previewMargin + cell.minX, y: previewMargin + cell.minY, width: cell.width, height: cell.height)
                context.fill(Path(roundedRect: r, cornerRadius: 2), with: .style(.tint.opacity(0.75)))
            }
        }
    }
}

// MARK: - Text

struct TextPanel: View {
    var controller: EditorController

    var body: some View {
        let editing = controller.selectedLayer?.text != nil
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "Text")
                Button { controller.addText() } label: {
                    Label("Add Text Box", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)

                HStack {
                    Text("Styles").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(editing ? "Applies to selected text" : "Click to add")
                        .font(.caption)
                        .foregroundStyle(editing ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                }
                VStack(spacing: 8) {
                    ForEach(TextPreset.all) { preset in
                        Button { controller.applyTextPreset(preset) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(preset.text.components(separatedBy: "\n")[0])
                                    .font(.system(size: max(13, min(preset.size / 5, 30)), weight: Font.Weight(cssWeight: preset.weight)))
                                    .lineLimit(1)
                                Text("\(preset.name) · \(Int(preset.size)) px").font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(TileButtonStyle())
                    }
                }
                Label("Double-click text on the canvas, or press Return, to edit it in place.", systemImage: "lightbulb")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 16)
        }
    }
}

extension Font.Weight {
    init(cssWeight: Int) {
        switch cssWeight {
        case ..<150: self = .ultraLight
        case ..<250: self = .thin
        case ..<350: self = .light
        case ..<450: self = .regular
        case ..<550: self = .medium
        case ..<650: self = .semibold
        case ..<750: self = .bold
        case ..<850: self = .heavy
        default: self = .black
        }
    }
}

// MARK: - Shapes

struct ShapesPanel: View {
    var controller: EditorController
    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "Shapes", subtitle: "Use shapes as color blocks, frames, and text backgrounds.")
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(ShapePreset.all) { preset in
                        Button { controller.addShape(preset) } label: {
                            VStack(spacing: 8) {
                                RoundedRectangle(cornerRadius: min(preset.previewRadius, min(preset.preview.width, preset.preview.height) / 2), style: .continuous)
                                    .fill(preset.tinted ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                                    .frame(width: preset.preview.width, height: preset.preview.height)
                                    .frame(height: 48)
                                Text(preset.name).font(.callout).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(TileButtonStyle())
                    }
                }
                Label("Press R for a rectangle or O for an ellipse while the canvas is focused.", systemImage: "keyboard")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 16)
        }
    }
}
