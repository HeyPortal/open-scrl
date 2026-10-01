import SwiftUI

/// The selected slide's layers, front-most first, with drag to reorder.
struct LayersList: View {
    var controller: EditorController
    @State private var renamingID: String?

    var body: some View {
        let slideIndex = controller.selectedSlideIndex
        let layers = Array((controller.selectedSlide?.layers ?? []).reversed())

        Group {
            if layers.isEmpty {
                ContentUnavailableView {
                    Label("Empty Slide", systemImage: "square.3.layers.3d")
                } description: {
                    Text("Add photos, text, or shapes from the sidebar or toolbar.")
                }
            } else {
                List(selection: Binding(get: { controller.selectedLayerID }, set: { controller.selectLayer($0) })) {
                    Section {
                        ForEach(layers) { layer in
                            LayerRow(controller: controller, layer: layer, renamingID: $renamingID)
                                .tag(layer.id)
                        }
                        .onMove { source, destination in
                            var order = layers.map(\.id)
                            order.move(fromOffsets: source, toOffset: destination)
                            controller.setLayerOrder(slide: slideIndex, ids: order.reversed())
                        }
                    } header: {
                        Text("Front to back · drag to reorder")
                    }
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .contextMenu(forSelectionType: String.self) { ids in
                    if let id = ids.first, let layer = controller.project.layer(id) {
                        Button("Rename") { renamingID = id }
                        Button("Duplicate") { controller.duplicateLayer(id) }
                        Button(layer.locked ? "Unlock" : "Lock") { controller.toggleLocked(id) }
                        Button(layer.visible ? "Hide" : "Show") { controller.toggleVisible(id) }
                        Divider()
                        Button("Bring to Front") { controller.arrange(id, .front) }
                        Button("Send to Back") { controller.arrange(id, .back) }
                        Divider()
                        Button("Delete", role: .destructive) { controller.deleteLayer(id) }
                    }
                } primaryAction: { ids in
                    if let id = ids.first { renamingID = id }
                }
                .onDeleteCommand { controller.deleteSelection() }
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
