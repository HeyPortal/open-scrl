import AppKit
import UniformTypeIdentifiers

extension NSPasteboard.PasteboardType {
    static let openSCRLMedia = NSPasteboard.PasteboardType(UTType.openSCRLMediaReference.identifier)
    static let openSCRLLayer = NSPasteboard.PasteboardType(UTType.openSCRLLayer.identifier)
}

extension CanvasView {
    static let dropTypes: [NSPasteboard.PasteboardType] = [.openSCRLMedia, .fileURL, .png, .tiff, NSPasteboard.PasteboardType(UTType.jpeg.identifier), NSPasteboard.PasteboardType(UTType.heic.identifier)]

    private func dropTarget(at p: CGPoint) -> SceneItem? {
        guard let project = controller?.project else { return nil }
        let point = modelPoint(p)
        return project.scene().reversed().first {
            $0.layer.image != nil && Geometry.hitTest($0.layer, origin: $0.origin, point: point, tolerance: 3 / zoom)
        }
    }

    private func updateDrop(_ sender: NSDraggingInfo) -> NSDragOperation {
        let p = convert(sender.draggingLocation, from: nil)
        let target = dropTarget(at: p)?.layer.id
        if target != dropTargetLayerID {
            dropTargetLayerID = target
            needsDisplay = true
        }
        return .copy
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        isDropTargeted = true
        return updateDrop(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { updateDrop(sender) }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        isDropTargeted = false
        dropTargetLayerID = nil
        needsDisplay = true
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        isDropTargeted = false
        dropTargetLayerID = nil
        needsDisplay = true
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let controller else { return false }
        let p = convert(sender.draggingLocation, from: nil)
        let pasteboard = sender.draggingPasteboard
        let target = dropTarget(at: p)
        let m = modelPoint(p)
        let slide = slideIndex(atView: p) ?? clamp(Int(m.x / controller.project.format.width), 0, controller.project.slides.count - 1)
        let placement: MediaPlacement = target.map { .fill(layerID: $0.layer.id) } ?? .add(slide: slide, center: m)

        // Media dragged from the library.
        if let ids = pasteboard.pasteboardItems?.compactMap({ $0.data(forType: .openSCRLMedia).map { String(decoding: $0, as: UTF8.self) } }), !ids.isEmpty {
            let assets = ids.compactMap { controller.project.asset($0) }
            guard !assets.isEmpty else { return false }
            if let target {
                let placed = controller.assignPhotos(assets, to: target.layer.id)
                if assets.count > 1 { controller.show("Placed \(placed) of \(assets.count) photos.", style: .success) }
                controller.selectLayer(target.layer.id)
            } else {
                for (n, asset) in assets.enumerated() {
                    let local = CGPoint(x: m.x - Double(slide) * controller.project.format.width + Double(n) * 24, y: m.y + Double(n) * 24)
                    controller.addImage(asset, slide: slide, center: local)
                }
            }
            window?.makeFirstResponder(self)
            return true
        }

        // Files from Finder, Photos, or other apps.
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            controller.importMedia(urls, placement: placement)
            return true
        }

        // Raw image data (for example dragged out of a browser).
        for type in [NSPasteboard.PasteboardType.png, .tiff, NSPasteboard.PasteboardType(UTType.jpeg.identifier), NSPasteboard.PasteboardType(UTType.heic.identifier)] {
            if let data = pasteboard.data(forType: type), let utType = UTType(type.rawValue) {
                Task { await controller.importImageData(data, type: utType == .tiff ? .tiff : utType, name: "Dropped Image", placement: placement) }
                return true
            }
        }
        return false
    }

    // MARK: Context menus

    override func menu(for event: NSEvent) -> NSMenu? {
        guard let controller else { return nil }
        let p = point(event)
        if controller.editingTextLayerID != nil { finishTextEditing() }
        if let item = hitLayer(atView: p) {
            if !controller.selectedLayerIDs.contains(item.layer.id) { controller.pickLayer(item.layer.id, additive: false) }
            needsDisplay = true
            if controller.isMultiSelection { return EditorMenus.selectionMenu(controller: controller) }
            return EditorMenus.layerMenu(controller: controller, layer: item.layer, canvas: self)
        }
        if let index = slideIndex(atView: p) {
            controller.selectLayer(nil)
            controller.selectSlide(controller.project.slides[index].id)
        }
        needsDisplay = true
        return EditorMenus.slideMenu(controller: controller, pasteLocation: modelPoint(p))
    }

    // MARK: Pasteboard (Edit menu)

    @objc func copy(_ sender: Any?) { controller?.copySelection() }

    @objc func cut(_ sender: Any?) { controller?.cutSelection() }

    @objc override func selectAll(_ sender: Any?) {
        controller?.selectAllLayers()
        needsDisplay = true
    }

    @objc func paste(_ sender: Any?) {
        let center = lastMouseLocation.flatMap { p in bounds.contains(p) ? modelPoint(p) : nil }
        controller?.paste(at: center)
    }

    @objc func delete(_ sender: Any?) { controller?.deleteSelection() }

    @objc func duplicate(_ sender: Any?) { controller?.duplicateSelection() }
}

extension CanvasView: NSMenuItemValidation {
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard let controller else { return false }
        switch menuItem.action {
        case #selector(copy(_:)), #selector(cut(_:)), #selector(delete(_:)), #selector(duplicate(_:)):
            return controller.selectedLayerID != nil
        case #selector(paste(_:)):
            return controller.canPaste
        case #selector(selectAll(_:)):
            return !(controller.selectedSlide?.layers.isEmpty ?? true)
        default:
            return true
        }
    }
}
