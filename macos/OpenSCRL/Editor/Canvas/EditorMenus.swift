import AppKit

/// An `NSMenuItem` that runs a closure.
final class ActionMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, symbol: String? = nil, key: String = "", modifiers: NSEvent.ModifierFlags = [.command], enabled: Bool = true, state: NSControl.StateValue = .off, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: key)
        target = self
        keyEquivalentModifierMask = modifiers
        isEnabled = enabled
        self.state = state
        if let symbol { image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
    }

    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func run() { handler() }
}

@MainActor
enum EditorMenus {
    private static func submenu(_ title: String, symbol: String? = nil, _ items: [NSMenuItem]) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        if let symbol { item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
        let menu = NSMenu(title: title)
        menu.autoenablesItems = false
        items.forEach(menu.addItem)
        item.submenu = menu
        return item
    }

    static func layerMenu(controller c: EditorController, layer: Layer, canvas: CanvasView?) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let id = layer.id

        switch layer.content {
        case .text:
            menu.addItem(ActionMenuItem("Edit Text", symbol: "character.cursor.ibeam", enabled: !layer.locked) { c.beginTextEditing(id) })
        case .image(let props):
            if props.assetID != nil {
                menu.addItem(ActionMenuItem("Adjust Crop", symbol: "crop") { c.beginCropEditing(id) })
                menu.addItem(ActionMenuItem("Blend Photos", symbol: "square.on.square", enabled: c.canBlendSelectedSeam) { c.blendSelectedSeam() })
                menu.addItem(ActionMenuItem("Replace Photo…", symbol: "photo.badge.arrow.down") { c.replacePhoto(id) })
                menu.addItem(ActionMenuItem("Reset Photo", symbol: "arrow.counterclockwise") { c.resetPhoto(id) })
            } else {
                menu.addItem(ActionMenuItem("Choose Photo…", symbol: "photo.badge.plus") { c.replacePhoto(id) })
            }
        case .shape:
            break
        }
        if menu.numberOfItems > 0 { menu.addItem(.separator()) }

        menu.addItem(ActionMenuItem("Cut", symbol: "scissors") { c.cutSelection() })
        menu.addItem(ActionMenuItem("Copy", symbol: "document.on.document") { c.copySelection() })
        menu.addItem(ActionMenuItem("Paste", symbol: "document.on.clipboard", enabled: c.canPaste) { c.paste(at: nil) })
        menu.addItem(ActionMenuItem("Duplicate", symbol: "plus.square.on.square") { c.duplicateSelection() })
        menu.addItem(ActionMenuItem("Delete", symbol: "trash") { c.deleteSelection() })
        menu.addItem(.separator())
        if layer.groupID != nil {
            menu.addItem(ActionMenuItem("Select Group", symbol: "square.on.square.dashed") { c.selectParent() })
            menu.addItem(ActionMenuItem("Ungroup", symbol: "square.on.square.squareshape.controlhandles", key: "g", modifiers: [.command, .shift]) { c.ungroupSelection() })
            menu.addItem(.separator())
        }

        menu.addItem(submenu("Arrange", symbol: "square.3.layers.3d", [
            ActionMenuItem("Bring to Front", enabled: c.canArrange(.front)) { c.arrange(id, .front) },
            ActionMenuItem("Bring Forward", enabled: c.canArrange(.forward)) { c.arrange(id, .forward) },
            ActionMenuItem("Send Backward", enabled: c.canArrange(.backward)) { c.arrange(id, .backward) },
            ActionMenuItem("Send to Back", enabled: c.canArrange(.back)) { c.arrange(id, .back) },
        ]))
        menu.addItem(submenu("Align to Slide", symbol: "align.horizontal.center", [
            ActionMenuItem("Left", symbol: "align.horizontal.left", enabled: !layer.locked) { c.align(id, .left) },
            ActionMenuItem("Center", symbol: "align.horizontal.center", enabled: !layer.locked) { c.align(id, .centerX) },
            ActionMenuItem("Right", symbol: "align.horizontal.right", enabled: !layer.locked) { c.align(id, .right) },
            .separator(),
            ActionMenuItem("Top", symbol: "align.vertical.top", enabled: !layer.locked) { c.align(id, .top) },
            ActionMenuItem("Middle", symbol: "align.vertical.center", enabled: !layer.locked) { c.align(id, .centerY) },
            ActionMenuItem("Bottom", symbol: "align.vertical.bottom", enabled: !layer.locked) { c.align(id, .bottom) },
        ]))
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem(layer.locked ? "Unlock" : "Lock", symbol: layer.locked ? "lock.open" : "lock") { c.toggleLocked(id) })
        menu.addItem(ActionMenuItem(layer.visible ? "Hide" : "Show", symbol: layer.visible ? "eye.slash" : "eye") { c.toggleVisible(id) })
        menu.addItem(ActionMenuItem("Rename…", symbol: "pencil") { c.requestRename(id) })
        return menu
    }

    /// Align, distribute and stacking items for the current selection, shared by menus.
    static func alignItems(_ c: EditorController) -> [NSMenuItem] {
        let locked = c.selectedLayers.allSatisfy(\.locked)
        let toSlide = c.selectionUnitCount < 2
        func item(_ title: String, _ symbol: String, _ edge: AlignEdge) -> NSMenuItem {
            ActionMenuItem(title, symbol: symbol, enabled: !locked) { c.alignSelection(edge) }
        }
        func slideItem(_ title: String, _ symbol: String, _ edge: AlignEdge) -> NSMenuItem {
            ActionMenuItem(title, symbol: symbol, enabled: !locked) { c.alignSelection(edge, relativeToSlide: true) }
        }
        var items: [NSMenuItem] = []
        if !toSlide {
            items.append(submenu("Align", symbol: "align.horizontal.left", [
                item("Left Edges", "align.horizontal.left", .left), item("Centers", "align.horizontal.center", .centerX), item("Right Edges", "align.horizontal.right", .right),
                .separator(),
                item("Top Edges", "align.vertical.top", .top), item("Middles", "align.vertical.center", .centerY), item("Bottom Edges", "align.vertical.bottom", .bottom),
            ]))
        }
        items.append(submenu("Align to Slide", symbol: "align.horizontal.center", [
            slideItem("Left", "align.horizontal.left", .left), slideItem("Center", "align.horizontal.center", .centerX), slideItem("Right", "align.horizontal.right", .right),
            .separator(),
            slideItem("Top", "align.vertical.top", .top), slideItem("Middle", "align.vertical.center", .centerY), slideItem("Bottom", "align.vertical.bottom", .bottom),
        ]))
        if !toSlide {
            let can = c.canDistributeSelection && !locked
            items.append(submenu("Distribute", symbol: "distribute.horizontal.center", [
                ActionMenuItem("Horizontally", symbol: "distribute.horizontal.center", enabled: can) { c.distributeSelection(.horizontal) },
                ActionMenuItem("Vertically", symbol: "distribute.vertical.center", enabled: can) { c.distributeSelection(.vertical) },
            ]))
        }
        return items
    }

    /// Menu for several selected layers, or a whole group.
    static func selectionMenu(controller c: EditorController) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let layers = c.selectedLayers
        let allLocked = layers.allSatisfy(\.locked)
        let allVisible = layers.allSatisfy(\.visible)
        menu.addItem(ActionMenuItem("Cut", symbol: "scissors") { c.cutSelection() })
        menu.addItem(ActionMenuItem("Copy", symbol: "document.on.document") { c.copySelection() })
        menu.addItem(ActionMenuItem("Paste", symbol: "document.on.clipboard", enabled: c.canPaste) { c.paste(at: nil) })
        menu.addItem(ActionMenuItem("Duplicate", symbol: "plus.square.on.square") { c.duplicateSelection() })
        menu.addItem(ActionMenuItem("Delete", symbol: "trash") { c.deleteSelection() })
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Blend Photos", symbol: "square.on.square", enabled: c.canBlendSelectedSeam) { c.blendSelectedSeam() })
        if c.canGroupNow {
            menu.addItem(ActionMenuItem("Group", symbol: "square.on.square.dashed", key: "g") { c.groupSelection() })
        }
        if c.canUngroupSelection {
            menu.addItem(ActionMenuItem("Ungroup", symbol: "square.on.square.squareshape.controlhandles", key: "g", modifiers: [.command, .shift]) { c.ungroupSelection() })
        }
        menu.addItem(.separator())
        menu.addItem(submenu("Arrange", symbol: "square.3.layers.3d", [
            ActionMenuItem("Bring to Front", enabled: c.canArrangeSelection(.front)) { c.arrangeSelection(.front) },
            ActionMenuItem("Bring Forward", enabled: c.canArrangeSelection(.forward)) { c.arrangeSelection(.forward) },
            ActionMenuItem("Send Backward", enabled: c.canArrangeSelection(.backward)) { c.arrangeSelection(.backward) },
            ActionMenuItem("Send to Back", enabled: c.canArrangeSelection(.back)) { c.arrangeSelection(.back) },
        ]))
        alignItems(c).forEach(menu.addItem)
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem(allLocked ? "Unlock All" : "Lock All", symbol: allLocked ? "lock.open" : "lock") { c.toggleSelection(\.locked, name: allLocked ? "Unlock" : "Lock") })
        menu.addItem(ActionMenuItem(allVisible ? "Hide All" : "Show All", symbol: allVisible ? "eye.slash" : "eye") { c.toggleSelection(\.visible, name: allVisible ? "Hide" : "Show") })
        return menu
    }

    static func slideMenu(controller c: EditorController, pasteLocation: CGPoint?) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let slideID = c.selectedSlideID
        let index = c.selectedSlideIndex
        let count = c.project.slides.count
        menu.addItem(ActionMenuItem("New Slide After", symbol: "plus.rectangle") { c.addSlide(after: slideID) })
        menu.addItem(ActionMenuItem("Duplicate Slide", symbol: "plus.rectangle.on.rectangle") { c.duplicateSlide(slideID) })
        menu.addItem(ActionMenuItem("Delete Slide", symbol: "trash", enabled: count > 1) { c.deleteSlide(slideID) })
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Move Slide Left", symbol: "arrow.left", enabled: index > 0) { c.moveSelectedSlide(by: -1) })
        menu.addItem(ActionMenuItem("Move Slide Right", symbol: "arrow.right", enabled: index < count - 1) { c.moveSelectedSlide(by: 1) })
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Add Text", symbol: "textformat") { c.addText() })
        menu.addItem(ActionMenuItem("Add Rectangle", symbol: "rectangle") { c.addShape(.rect) })
        menu.addItem(ActionMenuItem("Add Ellipse", symbol: "oval") { c.addShape(.ellipse) })
        menu.addItem(ActionMenuItem("Import Media…", symbol: "photo.badge.plus") { c.requestImport(.add(slide: index, center: nil)) })
        menu.addItem(ActionMenuItem("Paste", symbol: "document.on.clipboard", enabled: c.canPaste) { c.paste(at: pasteLocation) })
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Apply Background to All Slides", symbol: "square.grid.3x1.below.line.grid.1x2", enabled: count > 1) { c.applyBackgroundToAllSlides() })
        menu.addItem(ActionMenuItem("Export Slide…", symbol: "square.and.arrow.up") { c.exportCurrentSlide() })
        return menu
    }
}
