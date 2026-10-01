import SwiftUI

/// Menu bar commands for the focused project window.
struct EditorCommands: Commands {
    @FocusedValue(\.editor) private var editor
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(after: .importExport) {
            Button("Import Media…") { editor?.requestImport(.add(slide: editor?.selectedSlideIndex ?? 0, center: nil)) }
                .keyboardShortcut("i", modifiers: [.command, .shift])
                .disabled(editor == nil)
            Divider()
            Button("Export Carousel…") { editor?.exportCarousel() }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(editor == nil || editor?.exportState != nil)
            Button("Export Slide…") { editor?.exportCurrentSlide() }
                .keyboardShortcut("e", modifiers: [.command, .shift, .option])
                .disabled(editor == nil || editor?.exportState != nil)
            Button("Share Carousel…") { editor?.shareCarousel() }
                .disabled(editor == nil || editor?.exportState != nil)
        }

        CommandGroup(after: .pasteboard) {
            Button("Duplicate") { if let id = editor?.selectedLayerID { editor?.duplicateLayer(id) } }
                .keyboardShortcut("d", modifiers: .command)
                .disabled(editor?.selectedLayerID == nil)
        }

        CommandMenu("Insert") {
            Group {
            Button("Text Box") { editor?.addText() }
            Menu("Shape") {
                ForEach(ShapePreset.all) { preset in
                    Button(preset.name) { editor?.addShape(preset) }
                }
            }
            Menu("Photo Grid") {
                ForEach(GridTemplate.all) { template in
                    Button(template.name) { editor?.applyGrid(template) }
                }
            }
            Divider()
            Button("Media…") { editor?.requestImport(.add(slide: editor?.selectedSlideIndex ?? 0, center: nil)) }
            }
            .disabled(editor == nil)
        }

        CommandMenu("Arrange") {
            let id = editor?.selectedLayerID
            let layer = editor?.selectedLayer
            Button("Bring to Front") { if let id { editor?.arrange(id, .front) } }
                .keyboardShortcut("]", modifiers: [.command, .option])
                .disabled(editor?.canArrange(.front) != true)
            Button("Bring Forward") { if let id { editor?.arrange(id, .forward) } }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(editor?.canArrange(.forward) != true)
            Button("Send Backward") { if let id { editor?.arrange(id, .backward) } }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(editor?.canArrange(.backward) != true)
            Button("Send to Back") { if let id { editor?.arrange(id, .back) } }
                .keyboardShortcut("[", modifiers: [.command, .option])
                .disabled(editor?.canArrange(.back) != true)
            Divider()
            Menu("Align to Slide") {
                Button("Left") { if let id { editor?.align(id, .left) } }
                Button("Center") { if let id { editor?.align(id, .centerX) } }
                Button("Right") { if let id { editor?.align(id, .right) } }
                Divider()
                Button("Top") { if let id { editor?.align(id, .top) } }
                Button("Middle") { if let id { editor?.align(id, .centerY) } }
                Button("Bottom") { if let id { editor?.align(id, .bottom) } }
            }
            .disabled(layer == nil || layer?.locked == true)
            Divider()
            Button(layer?.locked == true ? "Unlock" : "Lock") { if let id { editor?.toggleLocked(id) } }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(id == nil)
            Button(layer?.visible == false ? "Show" : "Hide") { if let id { editor?.toggleVisible(id) } }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(id == nil)
            Divider()
            Button("Edit Text") { if let id { editor?.beginTextEditing(id) } }
                .disabled(layer?.text == nil)
            Button("Adjust Crop") { if let id { editor?.beginCropEditing(id) } }
                .disabled(layer?.image?.assetID == nil)
            Button("Rename Layer") { if let id { editor?.requestRename(id) } }
                .disabled(id == nil)
        }

        CommandMenu("Slide") {
            let index = editor?.selectedSlideIndex ?? 0
            let count = editor?.project.slides.count ?? 0
            Group {
            Button("New Slide") { editor?.addSlide(after: editor?.selectedSlideID) }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Duplicate Slide") { if let id = editor?.selectedSlideID { editor?.duplicateSlide(id) } }
                .keyboardShortcut("d", modifiers: [.command, .shift])
            Button("Delete Slide") { if let id = editor?.selectedSlideID { editor?.deleteSlide(id) } }
                .disabled(count <= 1)
            Divider()
            Button("Previous Slide") { editor?.focusSlide(at: index - 1) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
                .disabled(index <= 0)
            Button("Next Slide") { editor?.focusSlide(at: index + 1) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                .disabled(index >= count - 1)
            Button("Move Slide Left") { editor?.moveSelectedSlide(by: -1) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option, .control])
                .disabled(index <= 0)
            Button("Move Slide Right") { editor?.moveSelectedSlide(by: 1) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option, .control])
                .disabled(index >= count - 1)
            Divider()
            Button("Apply Background to All Slides") { editor?.applyBackgroundToAllSlides() }
                .disabled(count <= 1)
            }
            .disabled(editor == nil)
        }

        CommandGroup(before: .toolbar) {
            Button("Command Palette…") { editor?.showsCommandPalette.toggle() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(editor == nil)
            Divider()
            Button("Zoom In") { editor?.zoomIn() }
                .keyboardShortcut("=", modifiers: .command)
                .disabled(editor == nil)
            Button("Zoom Out") { editor?.zoomOut() }
                .keyboardShortcut("-", modifiers: .command)
                .disabled(editor == nil)
            Button("Actual Size") { editor?.zoomToActualSize() }
                .keyboardShortcut("0", modifiers: .command)
                .disabled(editor == nil)
            Button("Zoom to Fit") { editor?.zoomToFit() }
                .keyboardShortcut("9", modifiers: .command)
                .disabled(editor == nil)
            Divider()
            ForEach(Array(SidebarPanel.allCases.enumerated()), id: \.element) { n, panel in
                Button("Show \(panel.title)") { editor?.sidebarPanel = panel }
                    .keyboardShortcut(KeyEquivalent(Character("\(n + 1)")), modifiers: .command)
                    .disabled(editor == nil)
            }
            Divider()
            Button(editor?.showsInspector == false ? "Show Inspector" : "Hide Inspector") { editor?.showsInspector.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(editor == nil)
            Button("Show Layers") { editor?.showsInspector = true; editor?.inspectorTab = .layers }
                .keyboardShortcut("l", modifiers: [.command, .option])
                .disabled(editor == nil)
            Divider()
        }

        CommandGroup(replacing: .help) {
            Button("Keyboard Shortcuts") { openWindow(id: AppActions.shortcutsWindowID) }
                .keyboardShortcut("/", modifiers: .command)
            Button("Welcome to Open-SCRL") { openWindow(id: AppActions.welcomeWindowID) }
        }
    }
}
