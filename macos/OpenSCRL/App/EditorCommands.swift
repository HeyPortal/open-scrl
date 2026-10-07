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
            Button("Duplicate") { editor?.duplicateSelection() }
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
            let layers = editor?.selectedLayers ?? []
            let allLocked = !layers.isEmpty && layers.allSatisfy(\.locked)
            let units = editor?.selectionUnitCount ?? 0
            Button("Group") { editor?.groupSelection() }
                .keyboardShortcut("g", modifiers: .command)
                .disabled(editor?.canGroupNow != true)
            Button("Ungroup") { editor?.ungroupSelection() }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(editor?.canUngroupSelection != true)
            Divider()
            Button("Bring to Front") { editor?.arrangeSelection(.front) }
                .keyboardShortcut("]", modifiers: [.command, .option])
                .disabled(editor?.canArrangeSelection(.front) != true)
            Button("Bring Forward") { editor?.arrangeSelection(.forward) }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(editor?.canArrangeSelection(.forward) != true)
            Button("Send Backward") { editor?.arrangeSelection(.backward) }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(editor?.canArrangeSelection(.backward) != true)
            Button("Send to Back") { editor?.arrangeSelection(.back) }
                .keyboardShortcut("[", modifiers: [.command, .option])
                .disabled(editor?.canArrangeSelection(.back) != true)
            Divider()
            Menu("Align") {
                Button("Left Edges") { editor?.alignSelection(.left) }
                Button("Centers") { editor?.alignSelection(.centerX) }
                Button("Right Edges") { editor?.alignSelection(.right) }
                Divider()
                Button("Top Edges") { editor?.alignSelection(.top) }
                Button("Middles") { editor?.alignSelection(.centerY) }
                Button("Bottom Edges") { editor?.alignSelection(.bottom) }
            }
            .disabled(units < 2 || allLocked)
            Menu("Align to Slide") {
                Button("Left") { editor?.alignSelection(.left, relativeToSlide: true) }
                Button("Center") { editor?.alignSelection(.centerX, relativeToSlide: true) }
                Button("Right") { editor?.alignSelection(.right, relativeToSlide: true) }
                Divider()
                Button("Top") { editor?.alignSelection(.top, relativeToSlide: true) }
                Button("Middle") { editor?.alignSelection(.centerY, relativeToSlide: true) }
                Button("Bottom") { editor?.alignSelection(.bottom, relativeToSlide: true) }
            }
            .disabled(layers.isEmpty || allLocked)
            Menu("Distribute") {
                Button("Horizontally") { editor?.distributeSelection(.horizontal) }
                Button("Vertically") { editor?.distributeSelection(.vertical) }
            }
            .disabled(editor?.canDistributeSelection != true || allLocked)
            Divider()
            Button(allLocked ? "Unlock" : "Lock") { editor?.toggleSelection(\.locked, name: allLocked ? "Unlock" : "Lock") }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(layers.isEmpty)
            Button(!layers.isEmpty && layers.allSatisfy(\.visible) ? "Hide" : "Show") {
                let visible = layers.allSatisfy(\.visible)
                editor?.toggleSelection(\.visible, name: visible ? "Hide" : "Show")
            }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(layers.isEmpty)
            Divider()
            Button("Edit Text") { if let id { editor?.beginTextEditing(id) } }
                .disabled(layer?.text == nil || layers.count > 1)
            Button("Adjust Crop") { if let id { editor?.beginCropEditing(id) } }
                .disabled(layer?.image?.assetID == nil || layers.count > 1)
            Button("Blend Seam") { editor?.blendSelectedSeam() }
                .disabled(editor?.canBlendSelectedSeam != true)
            Button("Rename Layer") { if let id { editor?.requestRename(id) } }
                .disabled(id == nil || layers.count > 1)
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
            Button("Phone Preview") { if let editor { PhonePreviewWindow.show(for: editor) } }
                .keyboardShortcut("p", modifiers: [.command, .option])
                .disabled(editor == nil)
            Button("Full-Screen Preview") { if let editor { PhonePreviewWindow.show(for: editor, fullScreen: true) } }
                .keyboardShortcut("p", modifiers: [.command, .option, .shift])
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
