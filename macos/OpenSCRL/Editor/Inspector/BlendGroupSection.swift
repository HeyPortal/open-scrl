import SwiftUI

/// A blend stays selected as one object while the user tunes any join, or steps into a photo.
struct BlendGroupSection: View {
    var controller: EditorController
    var members: [Layer]
    @State private var joinID = ""

    private var joins: [Layer] { Array(members.dropFirst()) }
    private var activeJoin: Layer? { joins.first { $0.id == joinID } ?? joins.first }
    private var matching: Bool { !controller.analyzingSeamLayerIDs.isEmpty }

    var body: some View {
        Section("Blended Photos") {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Array(members.enumerated()), id: \.element.id) { index, layer in
                        Button { controller.enterGroup(layer.id) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                thumbnail(layer)
                                Text("\(index + 1). \(layer.name)").font(.caption).lineLimit(1)
                            }.frame(width: 82)
                        }
                        .buttonStyle(.plain)
                        .help("Edit \(layer.name)")
                        .accessibilityLabel("Edit photo \(index + 1): \(layer.name)")
                    }
                }.padding(.vertical, 3)
            }
            Text("Move or resize the whole blend. Select a photo above to crop or replace it; Escape returns to the group.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Menu("Add Photo", systemImage: "photo.badge.plus") {
                    Section("From Media") {
                        ForEach(controller.project.assets) { asset in
                            Button(asset.name) { controller.addAssetToBlendGroup(asset.id) }
                        }
                    }
                    let memberIDs = Set(members.map(\.id))
                    let others = (controller.selectedSlide?.layers ?? []).filter { !memberIDs.contains($0.id) && $0.image?.assetID != nil && !$0.locked && $0.visible }
                    if !others.isEmpty {
                        Section("On This Slide") {
                            ForEach(others) { photo in Button(photo.name) { controller.addPhotoToBlendGroup(photo.id) } }
                        }
                    }
                    Divider()
                    Button("Import Photos…") { controller.requestImport(.libraryOnly) }
                }
                Button("Separate Photos") { controller.separateBlendGroup() }
                    .help("Remove blending and ungroup the photos")
            }.controlSize(.small).disabled(matching || members.contains(where: \.locked))
        }
        Section("Group Look") {
            Picker("All Join Styles", selection: Binding(get: {
                let values = Set(members.compactMap { $0.image?.seamBlend?.style.rawValue })
                return values.count == 1 ? values.first! : ""
            }, set: { if let value = SeamStyle(rawValue: $0) { controller.updateBlendGroup(\.style, value: value) } })) {
                Text("Mixed").tag("")
                ForEach(SeamStyle.allCases, id: \.self) { Text($0.title).tag($0.rawValue) }
            }
            Picker("All Edge Styles", selection: Binding(get: {
                let values = Set(members.compactMap { $0.image?.seamBlend?.edgeStyle.rawValue })
                return values.count == 1 ? values.first! : ""
            }, set: { if let value = SeamEdgeStyle(rawValue: $0) { controller.updateBlendGroup(\.edgeStyle, value: value) } })) {
                Text("Mixed").tag("")
                ForEach(SeamEdgeStyle.allCases, id: \.self) { Text($0.title).tag($0.rawValue) }
            }
            Button(matching ? "Matching All Joins…" : "Update All Matches", systemImage: "wand.and.stars") { controller.updateBlendGroupMatches() }
                .controlSize(.small)
        }.disabled(matching || members.contains(where: \.locked))
        Section("Choose a Join") {
            Picker("Photo Pair", selection: Binding(get: { activeJoin?.id ?? "" }, set: { joinID = $0 })) {
                ForEach(Array(joins.enumerated()), id: \.element.id) { index, photo in
                    let target = photo.image?.seamBlend.flatMap { controller.project.layer($0.targetLayerID) } ?? members[index]
                    Text("\(target.name) ↔ \(photo.name)").tag(photo.id)
                }
            }
            if let photo = activeJoin, photo.image?.seamBlend == nil,
               let index = members.firstIndex(where: { $0.id == photo.id }), index > 0 {
                Button("Blend This Join", systemImage: "square.on.square") { controller.startSeamBlend(photo.id, with: members[index - 1].id) }
                    .disabled(matching || photo.locked)
            }
        }
        if let photo = activeJoin, photo.image?.seamBlend != nil {
            SeamBlendSection(controller: controller, layer: photo, isGroupJoin: true).id(photo.id)
        }
    }

    private func thumbnail(_ layer: Layer) -> some View {
        Group {
            if let asset = controller.project.asset(layer.image?.assetID),
               let image = controller.document.images.image(for: asset, pixelEdge: 160) {
                Image(decorative: image, scale: 1).resizable().scaledToFill()
            } else { Image(systemName: "photo").foregroundStyle(.secondary) }
        }.frame(width: 82, height: 64)
            .background(.quaternary)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
