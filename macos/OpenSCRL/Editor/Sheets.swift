import SwiftUI

/// A selectable canvas-format tile used by the welcome window and the new-project sheet.
struct FormatCard: View {
    var format: CanvasFormat
    var selected: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                FormatGlyph(format: format, maxSize: CGSize(width: 30, height: 38), selected: selected)
                VStack(spacing: 1) {
                    Text(format.name).font(.callout.weight(.medium)).lineLimit(1).minimumScaleFactor(0.85)
                    Text("\(Int(format.width))×\(Int(format.height))").font(.caption2).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(TileButtonStyle(selected: selected))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct FormatChooserSheet: View {
    var controller: EditorController
    @State private var selected = Preferences.defaultFormat
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Choose a Canvas Format").font(.title2.weight(.semibold))
                Text("Every slide in the project uses this size. You can change it later in the inspector.")
                    .foregroundStyle(.secondary)
            }
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(CanvasFormat.presets) { format in
                    FormatCard(format: format, selected: format == selected) { selected = format }
                        .onTapGesture(count: 2) { choose(format) }
                }
            }
            HStack {
                Spacer()
                Button("Create Project") { choose(selected) }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 520)
        .interactiveDismissDisabled()
    }

    private func choose(_ format: CanvasFormat) {
        controller.document.setInitialFormat(format)
        controller.zoomFollowsFit = true
        controller.slideFocusRequest &+= 1
    }
}

struct ExportProgressSheet: View {
    var controller: EditorController

    var body: some View {
        let state = controller.exportState ?? ExportState(title: "Exporting", detail: "", fraction: nil)
        VStack(spacing: 14) {
            Image(systemName: "square.and.arrow.up.on.square")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(.tint)
            Text(state.title).font(.headline)
            Group {
                if let fraction = state.fraction {
                    ProgressView(value: fraction)
                } else {
                    ProgressView().progressViewStyle(.linear)
                }
            }
            .frame(width: 280)
            Text(state.detail).font(.callout).monospacedDigit().foregroundStyle(.secondary)
            Button("Cancel", role: .cancel) { controller.cancelExport() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(28)
        .frame(width: 360)
    }
}
