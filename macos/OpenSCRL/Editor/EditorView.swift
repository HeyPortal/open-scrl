import SwiftUI
import UniformTypeIdentifiers

/// The content of a project window.
struct ProjectWindow: View {
    let document: ProjectDocument
    @State private var controller: EditorController
    @Environment(\.undoManager) private var undoManager
    @Environment(\.openWindow) private var openWindow
    @Environment(\.newDocument) private var newDocument

    init(document: ProjectDocument) {
        self.document = document
        _controller = State(initialValue: EditorController(document: document))
    }

    var body: some View {
        EditorView(controller: controller)
            .onAppear { controller.undoManager = undoManager }
            .onChange(of: undoManager) { _, manager in controller.undoManager = manager }
            .onDisappear { PhonePreviewWindow.close(for: controller) }
            .onReceive(NotificationCenter.default.publisher(for: .NSUndoManagerDidUndoChange)) { _ in controller.validateSelection() }
            .onReceive(NotificationCenter.default.publisher(for: .NSUndoManagerDidRedoChange)) { _ in controller.validateSelection() }
            .onAppear {
                AppActions.shared.openWindow = openWindow
                AppActions.shared.newDocument = newDocument
                if !document.pendingMedia.isEmpty {
                    let urls = document.pendingMedia
                    document.pendingMedia = []
                    Task { await controller.importAsSlides(urls) }
                }
            }
    }
}

struct EditorView: View {
    @Bindable var controller: EditorController
    @State private var columns = NavigationSplitViewVisibility.all
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SidebarView(controller: controller)
                .navigationSplitViewColumnWidth(min: 250, ideal: 276, max: 380)
        } detail: {
            CanvasArea(controller: controller)
                .inspector(isPresented: $controller.showsInspector) {
                    InspectorView(controller: controller)
                        .inspectorColumnWidth(min: 270, ideal: 296, max: 400)
                }
        }
        .toolbar { EditorToolbar(controller: controller) }
        .navigationSubtitle(subtitle)
        .focusedSceneValue(\.editor, controller)
        .fileImporter(isPresented: $controller.showsFileImporter, allowedContentTypes: [.image, .movie, .gif], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result {
                controller.importMedia(urls, placement: controller.fileImporterPlacement)
            }
        }
        .fileDialogMessage("Choose photos, GIFs or videos. They’re copied into this project.")
        .fileDialogConfirmationLabel("Import")
        .sheet(isPresented: Binding(get: { controller.document.needsFormatChoice }, set: { controller.document.needsFormatChoice = $0 })) {
            FormatChooserSheet(controller: controller)
        }
        .sheet(isPresented: Binding(get: { controller.exportState != nil }, set: { if !$0 { controller.cancelExport() } })) {
            ExportProgressSheet(controller: controller)
        }
        .overlay {
            if controller.showsCommandPalette {
                CommandPaletteOverlay(controller: controller)
            }
        }
        .frame(minWidth: 960, minHeight: 620)
    }

    private var subtitle: String {
        let p = controller.project
        let n = p.slides.count
        return "\(p.format.name) · \(n) slide\(n == 1 ? "" : "s")"
    }
}

/// The workspace: canvas with a floating filmstrip and status banners.
struct CanvasArea: View {
    var controller: EditorController
    @State private var filmstripHeight: CGFloat = 112
    @State private var topInset: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            CanvasRepresentable(controller: controller, insets: EdgeInsets(
                top: geo.safeAreaInsets.top,
                leading: geo.safeAreaInsets.leading,
                bottom: geo.safeAreaInsets.bottom + filmstripHeight + 16,
                trailing: geo.safeAreaInsets.trailing))
                .ignoresSafeArea()
                .onAppear { topInset = geo.safeAreaInsets.top }
                .onChange(of: geo.safeAreaInsets.top) { _, value in topInset = value }
        }
        .overlay(alignment: .bottom) {
            FilmstripView(controller: controller)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { filmstripHeight = $0 }
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                if let banner = controller.banner {
                    BannerView(banner: banner) { controller.banner = nil }
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                if controller.cropLayerID != nil {
                    HintCapsule(symbol: "crop", text: "Drag to reposition · Scroll to zoom · Return to finish") { controller.cropLayerID = nil }
                        .transition(.opacity)
                } else if controller.editingTextLayerID != nil {
                    HintCapsule(symbol: "character.cursor.ibeam", text: "Editing text · Esc or ⌘↩ to finish", action: nil)
                        .transition(.opacity)
                }
            }
            .padding(.top, 10 + topInset)
            .animation(.snappy, value: controller.cropLayerID)
            .animation(.snappy, value: controller.editingTextLayerID)
        }
    }
}

struct BannerView: View {
    var banner: Banner
    var dismiss: () -> Void

    private var tint: Color {
        switch banner.style {
        case .info: .accentColor
        case .success: .green
        case .warning: .orange
        case .error: .red
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: banner.symbol).foregroundStyle(tint).imageScale(.large)
            Text(banner.message).font(.callout).fixedSize(horizontal: false, vertical: true)
            if let title = banner.actionTitle, let action = banner.action {
                Button(title) { action(); dismiss() }
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
            Button(action: dismiss) { Image(systemName: "xmark").font(.caption.weight(.semibold)) }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Dismiss")
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: 520)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .combine)
    }
}

struct HintCapsule: View {
    var symbol: String
    var text: String
    var action: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
            Text(text)
            if let action {
                Button("Done", action: action)
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
            }
        }
        .font(.callout)
        .padding(.leading, 14)
        .padding(.trailing, action == nil ? 14 : 6)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .capsule)
    }
}

// MARK: - Toolbar

struct EditorToolbar: ToolbarContent {
    var controller: EditorController

    var body: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            ZoomMenu(controller: controller)
        }

        ToolbarItemGroup(placement: .principal) {
            Button { controller.addText() } label: { Label("Text", systemImage: "textformat") }
                .help("Add a text box (T)")

            Menu {
                ForEach(ShapePreset.all) { preset in
                    Button { controller.addShape(preset) } label: { Label(preset.name, systemImage: preset.symbol) }
                }
            } label: {
                Label("Shape", systemImage: "square.on.circle")
            } primaryAction: {
                controller.addShape(.rect)
            }
            .help("Add a shape (R for rectangle, O for ellipse)")

            Button {
                controller.sidebarPanel = .media
                if let layer = controller.selectedLayer, layer.image != nil {
                    controller.requestImport(.fill(layerID: layer.id))
                } else {
                    controller.requestImport(.add(slide: controller.selectedSlideIndex, center: nil))
                }
            } label: { Label("Media", systemImage: "photo.badge.plus") }
                .help("Import photos, GIFs or videos into this slide")

            Menu {
                ForEach([1, 2, 3, 4, 5, 6], id: \.self) { count in
                    let templates = GridTemplate.all.filter { $0.count == count }
                    if !templates.isEmpty {
                        Section("\(count) photo\(count == 1 ? "" : "s")") {
                            ForEach(templates) { template in
                                Button { controller.applyGrid(template) } label: {
                                    Label { Text(template.name) } icon: { Image(nsImage: GridIcon.image(template, ratio: controller.project.format.aspectRatio)) }
                                }
                            }
                        }
                    }
                }
                Section("More photos") {
                    ForEach(GridTemplate.all.filter { $0.count > 6 }) { template in
                        Button { controller.applyGrid(template) } label: {
                            Label { Text(template.name) } icon: { Image(nsImage: GridIcon.image(template, ratio: controller.project.format.aspectRatio)) }
                        }
                    }
                }
                Divider()
                Button("Show All Grids") { controller.sidebarPanel = .grids }
            } label: {
                Label("Grid", systemImage: "square.grid.2x2")
            } primaryAction: {
                controller.sidebarPanel = .grids
            }
            .help("Replace this slide’s layers with a photo grid")
        }

        ToolbarItemGroup(placement: .primaryAction) {
            Button { PhonePreviewWindow.show(for: controller) } label: {
                Label("Preview", systemImage: "iphone")
            }
            .help("Preview the carousel on a phone (P)")

            Button { controller.shareCarousel() } label: {
                Label("Share", systemImage: "square.and.arrow.up")
                    .background { ShareAnchor { controller.shareAnchor = $0 } }
            }
            .help("Share every slide with AirDrop, Messages, Mail and more")
            .disabled(controller.exportState != nil)

            Button { controller.exportCarousel() } label: {
                Label("Export", systemImage: "square.and.arrow.down.on.square")
            }
            .buttonStyle(.glassProminent)
            .help("Export every slide as numbered PNG or MP4 files (⇧⌘E)")
            .disabled(controller.exportState != nil)
        }

        ToolbarSpacer(.fixed, placement: .primaryAction)

        ToolbarItem(placement: .primaryAction) {
            Button { withAnimation { controller.showsInspector.toggle() } } label: {
                Label(controller.showsInspector ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.trailing")
            }
            .help("Show or hide the inspector (⌥⌘I)")
        }
    }
}

struct ZoomMenu: View {
    var controller: EditorController

    var body: some View {
        Menu {
            Button("Zoom In") { controller.zoomIn() }
            Button("Zoom Out") { controller.zoomOut() }
            Button("Zoom to Fit") { controller.zoomToFit() }
            Divider()
            ForEach([0.25, 0.5, 1.0, 2.0], id: \.self) { value in
                Button("\(Int(value * 100))%") { controller.setZoom(value) }
            }
        } label: {
            Text("\(Int((controller.zoom * 100).rounded()))%")
                .monospacedDigit()
                .frame(minWidth: 44)
        }
        .menuIndicator(.visible)
        .help("Zoom")
        .accessibilityLabel("Zoom \(Int((controller.zoom * 100).rounded())) percent")
    }
}

/// Captures an NSView inside a toolbar button so the share picker can point at it.
struct ShareAnchor: NSViewRepresentable {
    var onView: (NSView) -> Void
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { onView(view) }
        return view
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// Small template images of grid layouts for menus.
enum GridIcon {
    @MainActor private static var cache: [String: NSImage] = [:]

    @MainActor static func image(_ template: GridTemplate, ratio: Double) -> NSImage {
        let key = "\(template.id)@\(ratio)"
        if let cached = cache[key] { return cached }
        let h: CGFloat = 16, w = max(10, min(22, h * ratio))
        let image = NSImage(size: NSSize(width: 22, height: h), flipped: true) { _ in
            let origin = CGPoint(x: (22 - w) / 2, y: 0)
            for cell in template.cells(Double(w), Double(h), 1.2) {
                let r = CGRect(x: origin.x + cell.minX, y: origin.y + cell.minY, width: cell.width, height: cell.height)
                NSColor.black.setFill()
                NSBezierPath(roundedRect: r, xRadius: 0.8, yRadius: 0.8).fill()
            }
            return true
        }
        image.isTemplate = true
        cache[key] = image
        return image
    }
}
