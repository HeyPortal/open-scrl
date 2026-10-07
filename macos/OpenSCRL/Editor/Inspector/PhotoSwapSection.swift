import SwiftUI

/// Trades photos between two selected frames, or moves one photo into another frame.
struct PhotoSwapSection: View {
    var controller: EditorController
    /// One filled frame to move or swap from, or exactly two frames to trade.
    var ids: [String]
    @State private var targetID = ""
    @State private var failed = false

    private struct Target: Identifiable {
        var id: String
        var label: String
        var isEmpty: Bool
    }

    var body: some View {
        if ids.count == 2 {
            pair(ids[0], ids[1])
        } else if ids.count == 1 {
            single(ids[0])
        }
    }

    @ViewBuilder
    private func pair(_ first: String, _ second: String) -> some View {
        let project = controller.project
        if project.layer(first)?.kind == .image, project.layer(second)?.kind == .image {
            let ready = controller.canSwapPhotos(first, second)
            let moving = project.layer(first)?.image?.assetID == nil || project.layer(second)?.image?.assetID == nil
            Section(moving ? "Move Photo" : "Swap Photos") {
                Button(moving ? "Move Photo" : "Swap Photos", systemImage: moving ? "arrow.right" : "arrow.left.arrow.right") { run(first, second) }
                    .frame(maxWidth: .infinity)
                    .disabled(!ready)
                Text(ready ? moving ? "The photo moves to the empty frame. Frame sizes and styling stay put." : "Each photo takes the other’s place. Frame sizes and styling stay put." : "Choose two photo frames with at least one photo and different contents.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                failure("These frames can’t swap right now.")
            }
        }
    }

    @ViewBuilder
    private func single(_ sourceID: String) -> some View {
        let targets = targets(for: sourceID)
        if controller.project.layer(sourceID)?.image?.assetID != nil, !targets.isEmpty {
            // A removed or no-longer-eligible choice falls back to "no choice".
            let target = targets.first { $0.id == targetID }
            Section("Move or Swap") {
                Picker("Other Frame", selection: Binding(get: { target?.id ?? "" }, set: { targetID = $0; failed = false })) {
                    Text("Choose a Frame…").tag("")
                    ForEach(targets) { Text($0.label).tag($0.id) }
                }
                Button(target?.isEmpty == true ? "Move Photo" : "Swap Photos",
                       systemImage: target?.isEmpty == true ? "arrow.right" : "arrow.left.arrow.right") {
                    if let target { run(sourceID, target.id) }
                }
                .frame(maxWidth: .infinity)
                .disabled(target == nil)
                Text(target?.isEmpty == true ? "The photo moves to the empty frame; this one becomes empty." : "Pick another frame to trade photos with, even on a different slide.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                failure("That frame isn’t available any more.")
            }
        }
    }

    @ViewBuilder
    private func failure(_ message: String) -> some View {
        if failed { Text(message).font(.caption).foregroundStyle(.red) }
    }

    private func targets(for sourceID: String) -> [Target] {
        var found: [Target] = []
        for (index, slide) in controller.project.slides.enumerated() {
            for layer in slide.layers where layer.kind == .image && controller.canSwapPhotos(sourceID, layer.id) {
                let isEmpty = layer.image?.assetID == nil
                found.append(Target(id: layer.id, label: "Slide \(index + 1) · \(layer.name)\(isEmpty ? " (empty)" : "")", isEmpty: isEmpty))
            }
        }
        return found
    }

    private func run(_ source: String, _ target: String) {
        let ok = controller.swapPhotos(source, target)
        failed = !ok
        if ok { targetID = "" }
    }
}
