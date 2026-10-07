import SwiftUI

struct SeamBlendSection: View {
    var controller: EditorController
    var layer: Layer
    var isGroupJoin = false

    var body: some View {
        let id = layer.id
        let candidates = controller.seamCandidates(for: id)
        let blend = layer.image?.seamBlend
        let target = blend.flatMap { controller.project.layer($0.targetLayerID) }
        let matching = controller.analyzingSeamLayerID == id || controller.analyzingSeamLayerIDs.contains(id)
        Section("Seam Blend") {
            if layer.image?.assetID != nil {
                if isGroupJoin {
                    LabeledContent("Blends with", value: target?.name ?? "No join")
                } else {
                  Picker("Blend with", selection: Binding(get: { blend?.targetLayerID ?? "" }, set: { targetID in
                    if targetID.isEmpty { controller.removeSeamBlend(id) }
                    else { controller.startSeamBlend(id, with: targetID) }
                })) {
                    Text("None").tag("")
                    ForEach(candidates) { candidate in Text(candidate.name).tag(candidate.id) }
                    if let target, !candidates.contains(where: { $0.id == target.id }) { Text(target.name).tag(target.id) }
                  }
                }
                if let blend {
                    Picker("Blend Style", selection: setting(\.style, fallback: .automatic)) {
                        ForEach(SeamStyle.allCases, id: \.self) { style in Text(style.title).tag(style) }
                    }
                    Picker("Edge Style", selection: setting(\.edgeStyle, fallback: .clean)) {
                        ForEach(SeamEdgeStyle.allCases, id: \.self) { style in Text(style.title).tag(style) }
                    }
                    if !blend.isRefined {
                        Text("This blend keeps its original look until you edit it.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(blend.style == .automatic ? "Automatic: \(blend.resolvedStyle.title). Choose a style to override the match." :
                             blend.style == .seamless ? "Aligns shared detail and matches colors for a continuous scene." :
                             "Mixes different scenes with a soft, layered transition.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    Picker("Blended side", selection: controller.layerBinding(id, name: "Change Seam Side", fallback: SeamEdge.left,
                        get: { $0.image?.seamBlend?.edge }, set: { $0.image?.seamBlend?.edge = $1; $0.image?.seamBlend?.analysis = nil })) {
                        ForEach(SeamEdge.allCases, id: \.self) { edge in Text(edge.title).tag(edge) }
                    }
                    slider("Blend Width", value: binding(\.width, fallback: 80), range: 1...max(2, min(1024, blend.edge.isHorizontal ? layer.width : layer.height)), display: "\(Int(blend.width.rounded())) px")
                    slider("Seam Position", value: binding(\.position, fallback: 0.5), range: 0...1, display: "\(Int((blend.position * 100).rounded()))%")
                    if !blend.isRefined || blend.resolvedStyle == .seamless {
                        slider("Color Match", value: binding(\.colorMatch, fallback: 1), range: 0...1, display: "\(Int((blend.colorMatch * 100).rounded()))%")
                        Picker("Match Colors", selection: setting(\.colorReach, fallback: .nearSeam)) {
                            ForEach(SeamColorReach.allCases, id: \.self) { reach in Text(reach.title).tag(reach) }
                        }
                    }
                    Toggle("Follow Image Detail", isOn: controller.layerBinding(id, name: "Change Seam Path", fallback: true,
                        get: { $0.image?.seamBlend?.followsDetail }, set: { $0.image?.seamBlend?.followsDetail = $1 }))
                    Toggle("Align Shared Detail", isOn: Binding(get: { blend.alignment > 0 }, set: { enabled in
                        controller.updateLayer(id, "Change Seam Alignment") { $0.image?.seamBlend?.alignment = enabled ? 1 : 0 }
                    }))
                    HStack(spacing: 12) {
                        slider("Align X", value: binding(\.offsetX, fallback: 0), range: -256...256, display: "\(Int(blend.offsetX.rounded())) px")
                        slider("Align Y", value: binding(\.offsetY, fallback: 0), range: -256...256, display: "\(Int(blend.offsetY.rounded())) px")
                    }
                    HStack {
                        Button { controller.updateSeamMatch(id) } label: {
                            if matching { Label("Matching…", systemImage: "hourglass") }
                            else { Label("Update Match", systemImage: "wand.and.stars") }
                        }
                        Button("Remove") { controller.removeSeamBlend(id) }
                    }
                    .controlSize(.small)
                    if let target {
                        let current = blend.analysis?.matches(layer, target, edge: blend.edge) == true
                        Text(current ? (blend.resolvedStyle == .soft && blend.isRefined ? "Match is current. Soft blending preserves each photo's colors." : "Match is current. Shared detail and colors follow the seam.")
                             : "Update Match after moving, resizing, or cropping either layer.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        if let location = controller.project.locate(layer: id) {
                            let drawn = controller.project.slides[location.slide].layers.filter { $0.visible && $0.opacity > 0 }
                            if let foreground = drawn.firstIndex(where: { $0.id == id }), foreground == 0 || drawn[foreground - 1].id != target.id {
                                Text("Place this photo directly above its partner in Layers to use the new edge effects.")
                                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        if controller.project.asset(layer.image?.assetID)?.mediaKind.isAnimated == true || controller.project.asset(target.image?.assetID)?.mediaKind.isAnimated == true {
                            Text("Video matching uses the opening frames and keeps the seam stable during playback and export.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        Text("The blend partner was removed. Choose another layer.").font(.caption).foregroundStyle(.secondary)
                    }
                } else if candidates.isEmpty {
                    Text("Add a second photo or video to this slide to blend their seam.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else {
                    Button("Blend with Nearest Layer", systemImage: "square.on.square") { controller.blendSelectedSeam() }
                        .controlSize(.small)
                    Text("Blend only the join between two layers. Touching layers get a small overlap automatically.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .disabled(layer.locked || matching)
    }

    private func setting<T>(_ keyPath: WritableKeyPath<SeamBlend, T>, fallback: T) -> Binding<T> {
        controller.layerBinding(layer.id, name: "Change Seam Style", fallback: fallback,
                                get: { $0.image?.seamBlend?[keyPath: keyPath] }, set: { $0.image?.seamBlend?[keyPath: keyPath] = $1 })
    }

    private func binding(_ keyPath: WritableKeyPath<SeamBlend, Double>, fallback: Double) -> Binding<Double> {
        controller.layerBinding(layer.id, name: "Adjust Seam Blend", fallback: fallback,
                                get: { $0.image?.seamBlend?[keyPath: keyPath] }, set: { $0.image?.seamBlend?[keyPath: keyPath] = $1 })
    }

    private func slider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, display: String) -> some View {
        GestureSlider(title: title, value: value, range: range, display: display, controller: controller, undoName: "Adjust Seam Blend")
    }
}
