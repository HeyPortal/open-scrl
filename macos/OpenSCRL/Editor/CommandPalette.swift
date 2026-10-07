import SwiftUI

struct PaletteCommand: Identifiable {
    enum Group: String, CaseIterable {
        case insert = "Insert", edit = "Edit", arrange = "Arrange", slide = "Slide", view = "View", panels = "Panels", export = "Export", grids = "Grids"
    }

    var id: String
    var title: String
    var group: Group
    var symbol: String
    var shortcut: String? = nil
    var keywords: String = ""
    var isEnabled = true
    var run: () -> Void
}

extension EditorController {
    func paletteCommands() -> [PaletteCommand] {
        let layer = selectedLayer
        let id = layer?.id
        let layers = selectedLayers
        let unlocked = layers.contains { !$0.locked }
        let single = layers.count == 1
        let allLocked = !layers.isEmpty && layers.allSatisfy(\.locked)
        let allVisible = !layers.isEmpty && layers.allSatisfy(\.visible)
        let target = layers.count > 1 ? "Selection" : "Layer"
        let slideCount = project.slides.count
        let index = selectedSlideIndex
        var commands: [PaletteCommand] = [
            .init(id: "add-text", title: "Add Text", group: .insert, symbol: "textformat", shortcut: "T", run: { self.addText() }),
            .init(id: "add-rect", title: "Add Rectangle", group: .insert, symbol: "rectangle", shortcut: "R", keywords: "shape box", run: { self.addShape(.rect) }),
            .init(id: "add-ellipse", title: "Add Ellipse", group: .insert, symbol: "oval", shortcut: "O", keywords: "shape circle oval", run: { self.addShape(.ellipse) }),
            .init(id: "import", title: "Import Media…", group: .insert, symbol: "photo.badge.plus", shortcut: "⇧⌘I", keywords: "photo image video gif upload", run: { self.requestImport(.add(slide: index, center: nil)) }),

            .init(id: "duplicate", title: "Duplicate \(target)", group: .edit, symbol: "plus.square.on.square", shortcut: "⌘D", isEnabled: id != nil, run: { self.duplicateSelection() }),
            .init(id: "delete", title: "Delete \(target)", group: .edit, symbol: "trash", shortcut: "⌫", isEnabled: id != nil, run: { self.deleteSelection() }),
            .init(id: "lock", title: allLocked ? "Unlock \(target)" : "Lock \(target)", group: .edit, symbol: "lock", shortcut: "⇧⌘L", isEnabled: id != nil, run: { self.toggleSelection(\.locked, name: allLocked ? "Unlock" : "Lock") }),
            .init(id: "hide", title: allVisible ? "Hide \(target)" : "Show \(target)", group: .edit, symbol: "eye.slash", shortcut: "⇧⌘H", isEnabled: id != nil, run: { self.toggleSelection(\.visible, name: allVisible ? "Hide" : "Show") }),
            .init(id: "edit-text", title: "Edit Text", group: .edit, symbol: "character.cursor.ibeam", shortcut: "↩", isEnabled: single && layer?.text != nil, run: { if let id { self.beginTextEditing(id) } }),
            .init(id: "crop", title: "Adjust Crop", group: .edit, symbol: "crop", shortcut: "↩", isEnabled: single && layer?.image?.assetID != nil, run: { if let id { self.beginCropEditing(id) } }),
            .init(id: "blend-seam", title: "Blend Seam", group: .edit, symbol: "square.on.square", keywords: "blend feather join stitch match colors photos video", isEnabled: canBlendSelectedSeam, run: { self.blendSelectedSeam() }),
            .init(id: "rename", title: "Rename Layer", group: .edit, symbol: "pencil", isEnabled: single, run: { if let id { self.requestRename(id) } }),

            .init(id: "front", title: "Bring to Front", group: .arrange, symbol: "square.3.layers.3d.top.filled", shortcut: "⌥⌘]", isEnabled: canArrangeSelection(.front), run: { self.arrangeSelection(.front) }),
            .init(id: "forward", title: "Bring Forward", group: .arrange, symbol: "square.2.layers.3d.top.filled", shortcut: "⌘]", isEnabled: canArrangeSelection(.forward), run: { self.arrangeSelection(.forward) }),
            .init(id: "backward", title: "Send Backward", group: .arrange, symbol: "square.2.layers.3d.bottom.filled", shortcut: "⌘[", isEnabled: canArrangeSelection(.backward), run: { self.arrangeSelection(.backward) }),
            .init(id: "back", title: "Send to Back", group: .arrange, symbol: "square.3.layers.3d.bottom.filled", shortcut: "⌥⌘[", isEnabled: canArrangeSelection(.back), run: { self.arrangeSelection(.back) }),
        ]
        let aligns: [(AlignEdge, String, String)] = [
            (.left, "Align to Slide Left", "align.horizontal.left"), (.centerX, "Center Horizontally on Slide", "align.horizontal.center"),
            (.right, "Align to Slide Right", "align.horizontal.right"), (.top, "Align to Slide Top", "align.vertical.top"),
            (.centerY, "Center Vertically on Slide", "align.vertical.center"), (.bottom, "Align to Slide Bottom", "align.vertical.bottom"),
        ]
        commands += aligns.map { edge, title, symbol in
            PaletteCommand(id: "align-\(title)", title: title, group: .arrange, symbol: symbol, isEnabled: unlocked, run: { self.alignSelection(edge, relativeToSlide: true) })
        }
        commands += aligns.map { edge, title, symbol in
            PaletteCommand(id: "selection-align-\(edge)", title: title.replacingOccurrences(of: " to Slide", with: "").replacingOccurrences(of: " on Slide", with: ""), group: .arrange, symbol: symbol, isEnabled: selectionUnitCount >= 2 && unlocked, run: { self.alignSelection(edge, relativeToSlide: false) })
        }
        commands += [
            .init(id: "group", title: "Group Layers", group: .arrange, symbol: "square.3.layers.3d", shortcut: "⌘G", isEnabled: canGroupNow, run: { self.groupSelection() }),
            .init(id: "ungroup", title: "Ungroup Layers", group: .arrange, symbol: "square.3.layers.3d.slash", shortcut: "⇧⌘G", isEnabled: canUngroupSelection, run: { self.ungroupSelection() }),
            .init(id: "distribute-horizontal", title: "Distribute Horizontally", group: .arrange, symbol: "distribute.horizontal", isEnabled: canDistributeSelection && unlocked, run: { self.distributeSelection(.horizontal) }),
            .init(id: "distribute-vertical", title: "Distribute Vertically", group: .arrange, symbol: "distribute.vertical", isEnabled: canDistributeSelection && unlocked, run: { self.distributeSelection(.vertical) }),
            .init(id: "new-slide", title: "New Slide", group: .slide, symbol: "plus.rectangle", shortcut: "⇧⌘N", run: { self.addSlide(after: self.selectedSlideID) }),
            .init(id: "dup-slide", title: "Duplicate Slide", group: .slide, symbol: "plus.rectangle.on.rectangle", shortcut: "⇧⌘D", run: { self.duplicateSlide(self.selectedSlideID) }),
            .init(id: "del-slide", title: "Delete Slide", group: .slide, symbol: "trash", isEnabled: slideCount > 1, run: { self.deleteSlide(self.selectedSlideID) }),
            .init(id: "prev-slide", title: "Previous Slide", group: .slide, symbol: "chevron.left", shortcut: "⌥⌘←", isEnabled: index > 0, run: { self.focusSlide(at: index - 1) }),
            .init(id: "next-slide", title: "Next Slide", group: .slide, symbol: "chevron.right", shortcut: "⌥⌘→", isEnabled: index < slideCount - 1, run: { self.focusSlide(at: index + 1) }),
            .init(id: "move-left", title: "Move Slide Left", group: .slide, symbol: "arrow.left", isEnabled: index > 0, run: { self.moveSelectedSlide(by: -1) }),
            .init(id: "move-right", title: "Move Slide Right", group: .slide, symbol: "arrow.right", isEnabled: index < slideCount - 1, run: { self.moveSelectedSlide(by: 1) }),
            .init(id: "bg-all", title: "Apply Background to All Slides", group: .slide, symbol: "square.grid.3x1.below.line.grid.1x2", keywords: "color colour", isEnabled: slideCount > 1, run: { self.applyBackgroundToAllSlides() }),

            .init(id: "zoom-in", title: "Zoom In", group: .view, symbol: "plus.magnifyingglass", shortcut: "⌘+", run: { self.zoomIn() }),
            .init(id: "zoom-out", title: "Zoom Out", group: .view, symbol: "minus.magnifyingglass", shortcut: "⌘−", run: { self.zoomOut() }),
            .init(id: "zoom-fit", title: "Zoom to Fit", group: .view, symbol: "arrow.up.left.and.down.right.magnifyingglass", shortcut: "⌘9", run: { self.zoomToFit() }),
            .init(id: "zoom-100", title: "Actual Size", group: .view, symbol: "1.magnifyingglass", shortcut: "⌘0", run: { self.zoomToActualSize() }),
            .init(id: "phone-preview", title: "Phone Preview", group: .view, symbol: "iphone", shortcut: "P", keywords: "feed story profile grid crop", run: { PhonePreviewWindow.show(for: self) }),
            .init(id: "fullscreen-preview", title: "Full-Screen Preview", group: .view, symbol: "arrow.up.left.and.arrow.down.right", shortcut: "⇧⌥⌘P", run: { PhonePreviewWindow.show(for: self, fullScreen: true) }),
            .init(id: "inspector", title: showsInspector ? "Hide Inspector" : "Show Inspector", group: .view, symbol: "sidebar.trailing", shortcut: "⌥⌘I", run: { self.showsInspector.toggle() }),
            .init(id: "layers", title: "Show Layers", group: .view, symbol: "square.3.layers.3d", run: { self.showsInspector = true; self.inspectorTab = .layers }),

            .init(id: "export-carousel", title: "Export Carousel…", group: .export, symbol: "square.and.arrow.down.on.square", shortcut: "⇧⌘E", keywords: "zip instagram download png mp4", isEnabled: exportState == nil, run: { self.exportCarousel() }),
            .init(id: "export-slide", title: "Export Slide…", group: .export, symbol: "square.and.arrow.down", shortcut: "⌥⇧⌘E", keywords: "image png save", isEnabled: exportState == nil, run: { self.exportCurrentSlide() }),
            .init(id: "share", title: "Share Carousel…", group: .export, symbol: "square.and.arrow.up", keywords: "airdrop messages", isEnabled: exportState == nil, run: { self.shareCarousel() }),
        ]
        commands += SidebarPanel.allCases.enumerated().map { n, panel in
            PaletteCommand(id: "panel-\(panel.rawValue)", title: "Show \(panel.title)", group: .panels, symbol: panel.symbol, shortcut: "⌘\(n + 1)", run: { self.sidebarPanel = panel })
        }
        commands += GridTemplate.all.map { template in
            PaletteCommand(id: "grid-\(template.id)", title: "Apply Grid · \(template.name)", group: .grids, symbol: "square.grid.2x2", keywords: "layout template collage", run: { self.applyGrid(template) })
        }
        return commands
    }
}

struct CommandPaletteOverlay: View {
    var controller: EditorController
    @State private var query = ""
    @State private var active = 0
    @FocusState private var focused: Bool

    private var results: [PaletteCommand] {
        let all = controller.paletteCommands().filter(\.isEnabled)
        let tokens = query.lowercased().split(separator: " ").map(String.init)
        let filtered = tokens.isEmpty
            ? all.filter { $0.group != .grids }
            : all.filter { command in
                let haystack = "\(command.title) \(command.group.rawValue) \(command.keywords)".lowercased()
                return tokens.allSatisfy { haystack.contains($0) }
            }
        let order = PaletteCommand.Group.allCases
        return filtered.sorted { order.firstIndex(of: $0.group)! < order.firstIndex(of: $1.group)! }
    }

    var body: some View {
        let results = self.results
        ZStack(alignment: .top) {
            Color.black.opacity(0.08)
                .ignoresSafeArea()
                .onTapGesture { close() }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search commands", text: $query)
                        .textFieldStyle(.plain)
                        .font(.title3)
                        .focused($focused)
                        .onSubmit { run(results[safe: active]) }
                    Text("esc").font(.caption).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16)
                .frame(height: 50)
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 1) {
                            if results.isEmpty {
                                Text("No matching commands").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 28)
                            }
                            ForEach(Array(results.enumerated()), id: \.element.id) { index, command in
                                if index == 0 || results[index - 1].group != command.group {
                                    Text(command.group.rawValue.uppercased())
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 10)
                                        .padding(.top, index == 0 ? 4 : 10)
                                        .padding(.bottom, 2)
                                }
                                row(command, highlighted: index == active)
                                    .id(command.id)
                                    .onHover { if $0 { active = index } }
                                    .onTapGesture { run(command) }
                            }
                        }
                        .padding(6)
                    }
                    .frame(maxHeight: 380)
                    .onChange(of: active) { _, value in
                        if let id = results[safe: value]?.id { proxy.scrollTo(id) }
                    }
                }
            }
            .frame(width: 560)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
            .padding(.top, 70)
        }
        .onAppear { focused = true }
        .onChange(of: query) { _, value in
            active = 0
            // A pasted or injected line break acts like Return.
            if value.contains("\n") {
                query = value.replacingOccurrences(of: "\n", with: "")
                run(self.results[safe: 0])
            }
        }
        .onKeyPress(.downArrow) { active = min(results.count - 1, active + 1); return .handled }
        .onKeyPress(.upArrow) { active = max(0, active - 1); return .handled }
        .onKeyPress(.escape) { close(); return .handled }
        .accessibilityAddTraits(.isModal)
    }

    private func row(_ command: PaletteCommand, highlighted: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: command.symbol)
                .frame(width: 20)
                .foregroundStyle(highlighted ? .white : .secondary)
            Text(command.title)
            Spacer()
            if let shortcut = command.shortcut {
                Text(shortcut).font(.callout).monospacedDigit().foregroundStyle(highlighted ? .white.opacity(0.85) : .secondary)
            }
        }
        .foregroundStyle(highlighted ? .white : .primary)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(highlighted ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear)))
        .contentShape(Rectangle())
    }

    private func close() {
        controller.showsCommandPalette = false
    }

    private func run(_ command: PaletteCommand?) {
        guard let command else { return }
        close()
        DispatchQueue.main.async { command.run() }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
