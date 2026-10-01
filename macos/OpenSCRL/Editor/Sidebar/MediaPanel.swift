import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Drag payload for media dragged from the library onto the canvas.
struct MediaDragItem: Transferable {
    let assetID: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(contentType: .openSCRLMediaReference) { item in
            Data(item.assetID.utf8)
        } importing: { data in
            MediaDragItem(assetID: String(decoding: data, as: UTF8.self))
        }
    }
}

/// A file received from the Photos picker, copied somewhere we can read it.
struct PickedMediaFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in try copy(received.file) }
        FileRepresentation(importedContentType: .image) { received in try copy(received.file) }
    }

    private static func copy(_ source: URL) throws -> PickedMediaFile {
        let folder = FileManager.default.temporaryDirectory.appending(path: "OpenSCRL-Photos-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appending(path: source.lastPathComponent)
        try FileManager.default.copyItem(at: source, to: destination)
        return PickedMediaFile(url: destination)
    }
}

struct MediaPanel: View {
    @Bindable var controller: EditorController
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isTargeted = false
    private let columns = [GridItem(.adaptive(minimum: 72, maximum: 120), spacing: 6)]

    var body: some View {
        let assets = controller.project.assets
        let used = controller.project.usedAssetIDs
        let target = controller.selectedLayer?.image != nil ? controller.selectedLayer : nil

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                PanelHeader(title: "Media") {
                    if !assets.isEmpty { Text("\(assets.count)").monospacedDigit().foregroundStyle(.secondary) }
                }

                HStack(spacing: 8) {
                    Button { controller.requestImport(.libraryOnly) } label: {
                        Label(controller.isImporting ? "Importing…" : "Import…", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(controller.isImporting)

                    PhotosPicker(selection: $photoSelection, matching: .any(of: [.images, .videos]), photoLibrary: .shared()) {
                        Label("Photos", systemImage: "photo.on.rectangle.angled").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .help("Import from your Photos library")
                }
                .controlSize(.large)

                Text("Or drop photos, GIFs, and videos here or onto the canvas. Media is copied into the project file.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let message = controller.importMessage {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle")
                        Text(message).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button { controller.importMessage = nil } label: { Image(systemName: "xmark") }
                            .buttonStyle(.plain)
                            .help("Dismiss")
                    }
                    .font(.caption)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.quaternary.opacity(0.6)))
                }

                if !assets.isEmpty {
                    Text(controller.dropTargetDescription())
                        .font(.caption)
                        .foregroundStyle(target != nil ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        .padding(target != nil ? 8 : 0)
                        .background {
                            if target != nil { RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.tint.opacity(0.12)) }
                        }
                        .fixedSize(horizontal: false, vertical: true)

                    LazyVGrid(columns: columns, spacing: 6) {
                        ForEach(assets) { asset in
                            MediaTile(controller: controller, asset: asset, used: used.contains(asset.id),
                                      current: target?.image?.assetID == asset.id)
                        }
                    }
                } else {
                    ContentUnavailableView {
                        Label("No Media Yet", systemImage: "photo.on.rectangle.angled")
                    } description: {
                        Text("Import photos, GIFs, or videos to start filling your slides.")
                    }
                    .padding(.top, 20)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 16)
        }
        .overlay {
            if isTargeted {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(.tint, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.tint.opacity(0.08)))
                    .padding(6)
                    .allowsHitTesting(false)
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            controller.importMedia(urls, placement: .libraryOnly)
            return true
        } isTargeted: { isTargeted = $0 }
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            photoSelection = []
            Task {
                var urls: [URL] = []
                for item in items {
                    if let file = try? await item.loadTransferable(type: PickedMediaFile.self) { urls.append(file.url) }
                }
                await controller.importMediaNow(urls, placement: .libraryOnly)
                for url in urls { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            }
        }
    }
}

struct MediaTile: View {
    var controller: EditorController
    var asset: MediaAsset
    var used: Bool
    var current: Bool
    @State private var hovering = false

    private var image: CGImage? { controller.document.images.image(for: asset, pixelEdge: 240) }

    @ViewBuilder private var picture: some View {
        if let image {
            Image(decorative: image, scale: 1).resizable().scaledToFill()
        } else {
            ProgressView().controlSize(.small)
        }
    }

    private var border: some View {
        let style: AnyShapeStyle = current ? AnyShapeStyle(.tint) : AnyShapeStyle(hovering ? Color.accentColor.opacity(0.6) : Color.primary.opacity(0.08))
        return RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(style, lineWidth: current || hovering ? 2 : 1)
    }

    @ViewBuilder private var kindBadge: some View {
        if asset.mediaKind.isAnimated {
            let video = asset.mediaKind == .video
            Label(video ? Self.duration(asset.duration) : "GIF", systemImage: video ? "video.fill" : "play.square.stack")
                .font(.system(size: 9, weight: .semibold))
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(.black.opacity(0.6), in: Capsule())
                .foregroundStyle(.white)
                .padding(4)
        }
    }

    @ViewBuilder private var usedBadge: some View {
        if used {
            Image(systemName: "checkmark.circle.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, Color.accentColor)
                .padding(4)
                .help("Used in this project")
        }
    }

    @ViewBuilder private var removeButton: some View {
        if hovering {
            Button { controller.removeAsset(asset.id) } label: {
                Image(systemName: "trash").font(.system(size: 10, weight: .semibold)).padding(5)
                    .background(.black.opacity(0.6), in: Circle()).foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .padding(3)
            .help("Remove from Project")
        }
    }

    private var tile: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { picture }
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay { border }
            .overlay(alignment: .bottomLeading) { kindBadge }
            .overlay(alignment: .topLeading) { usedBadge }
            .overlay(alignment: .topTrailing) { removeButton }
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    @ViewBuilder private var dragPreview: some View {
        if let image {
            Image(decorative: image, scale: 1).resizable().scaledToFill().frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    var body: some View {
        Button { controller.useAsset(asset) } label: { tile }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .draggable(MediaDragItem(assetID: asset.id)) { dragPreview }
            .contextMenu { menu }
            .help("\(asset.name) · \(Int(asset.width)) × \(Int(asset.height))")
            .accessibilityLabel(asset.name)
    }

    @ViewBuilder private var menu: some View {
        Button("Add to Slide", systemImage: "plus.rectangle") { controller.addImage(asset) }
        Button("Spread Across \(max(2, controller.slideSpan(for: asset))) Slides", systemImage: "rectangle.split.3x1") { controller.spreadAcrossSlides(asset) }
        if let layer = controller.selectedLayer, layer.image != nil {
            Button(layer.isEmptyImageSlot ? "Fill “\(layer.name)”" : "Replace Photo in “\(layer.name)”", systemImage: "photo.badge.arrow.down") {
                controller.assign(asset, to: layer.id)
            }
        }
        Divider()
        Button("Remove from Project", systemImage: "trash", role: .destructive) { controller.removeAsset(asset.id) }
    }

    static func duration(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
