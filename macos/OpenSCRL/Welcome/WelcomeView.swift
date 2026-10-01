import SwiftUI
import UniformTypeIdentifiers

struct RecentProject: Identifiable {
    var url: URL
    var name: String
    var formatName: String
    var aspectRatio: Double
    var slideCount: Int
    var modified: Date?
    var thumbnail: NSImage?
    var id: URL { url }

    static func load(_ url: URL) -> RecentProject? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        var project = RecentProject(url: url, name: url.deletingPathExtension().lastPathComponent, formatName: "", aspectRatio: 0.8, slideCount: 0)
        if let data = try? Data(contentsOf: url.appending(path: "project.json")), let file = try? ProjectFile.decode(data) {
            project.formatName = file.format.name
            project.aspectRatio = file.format.aspectRatio
            project.slideCount = file.slideOrder.count
        }
        project.thumbnail = NSImage(contentsOf: url.appending(path: "QuickLook/Thumbnail.png"))
        project.modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        return project
    }
}

struct WelcomeView: View {
    /// Read from the bundle: `applicationIconImage` can return a stale cached icon during development.
    static let appIcon: NSImage = Bundle.main.url(forResource: "AppIcon", withExtension: "icns").flatMap(NSImage.init(contentsOf:)) ?? NSApp.applicationIconImage
    @Environment(\.newDocument) private var newDocument
    @Environment(\.openDocument) private var openDocument
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    @State private var format = Preferences.defaultFormat
    @State private var recents: [RecentProject] = []
    @State private var query = ""
    private let formatColumns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        HStack(spacing: 0) {
            newProjectColumn
                .frame(width: 360)
            recentsColumn
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.background.opacity(0.55))
        }
        .frame(width: 920, height: 580)
        .containerBackground(.thickMaterial, for: .window)
        .task { loadRecents() }
        .onAppear {
            AppActions.shared.openWindow = openWindow
            AppActions.shared.newDocument = newDocument
        }
    }

    private var newProjectColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(nsImage: Self.appIcon)
                    .resizable()
                    .frame(width: 64, height: 64)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Open-SCRL").font(.title.weight(.bold))
                    Text("Photo grids & seamless carousels").foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 28)

            Text("New Project").font(.headline).padding(.bottom, 10)
            LazyVGrid(columns: formatColumns, spacing: 8) {
                ForEach(CanvasFormat.presets) { preset in
                    FormatCard(format: preset, selected: preset == format) { format = preset }
                        .simultaneousGesture(TapGesture(count: 2).onEnded { create(preset) })
                }
            }
            Button { create(format) } label: {
                Text("Create \(format.name) Project").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .padding(.top, 14)

            Spacer()

            Button { NSDocumentController.shared.openDocument(nil) } label: {
                Label("Open Existing Project…", systemImage: "folder").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .keyboardShortcut("o", modifiers: .command)

            Label("Projects are files on this Mac. Nothing is uploaded.", systemImage: "lock.laptopcomputer")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 12)
        }
        .padding(28)
    }

    private var filtered: [RecentProject] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? recents : recents.filter { $0.name.lowercased().contains(q) || $0.formatName.lowercased().contains(q) }
    }

    private var recentsColumn: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Recent Projects").font(.headline)
                Spacer()
                if !recents.isEmpty {
                    TextField("Search", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 180)
                }
            }
            if recents.isEmpty {
                ContentUnavailableView {
                    Label("No Recent Projects", systemImage: "rectangle.stack")
                } description: {
                    Text("Projects you create or open appear here. Pick a format on the left to start.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if filtered.isEmpty {
                ContentUnavailableView.search(text: query).frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 14)], spacing: 16) {
                        ForEach(filtered) { project in
                            RecentProjectCard(project: project) { open(project.url) }
                                .contextMenu {
                                    Button("Open") { open(project.url) }
                                    Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([project.url]) }
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(24)
    }

    private func loadRecents() {
        let urls = NSDocumentController.shared.recentDocumentURLs.filter { $0.pathExtension == "openscrl" }
        Task.detached {
            let loaded = urls.compactMap(RecentProject.load)
            await MainActor.run { recents = loaded }
        }
    }

    private func create(_ format: CanvasFormat) {
        let document = ProjectDocument(format: format)
        newDocument(document)
        dismissWindow(id: AppActions.welcomeWindowID)
    }

    private func open(_ url: URL) {
        Task {
            do {
                try await openDocument(at: url)
                dismissWindow(id: AppActions.welcomeWindowID)
            } catch {
                NSAlert(error: error).runModal()
            }
        }
    }
}

struct RecentProjectCard: View {
    var project: RecentProject
    var open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.quaternary.opacity(0.5))
                    Group {
                        if let thumbnail = project.thumbnail {
                            Image(nsImage: thumbnail).resizable().aspectRatio(contentMode: .fit)
                        } else {
                            RoundedRectangle(cornerRadius: 3).fill(.secondary.opacity(0.3)).aspectRatio(project.aspectRatio, contentMode: .fit)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    .shadow(color: .black.opacity(0.15), radius: 3, y: 1)
                    .padding(14)
                }
                .frame(height: 150)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(hovering ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 2)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name).font(.callout.weight(.medium)).lineLimit(1)
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(project.url.path)
    }

    private var detail: String {
        var parts: [String] = []
        if !project.formatName.isEmpty { parts.append(project.formatName) }
        if project.slideCount > 0 { parts.append("\(project.slideCount) slide\(project.slideCount == 1 ? "" : "s")") }
        if let date = project.modified { parts.append(date.formatted(.relative(presentation: .named))) }
        return parts.joined(separator: " · ")
    }
}
