import AppKit

extension CanvasView {
    // MARK: Hit testing

    func point(_ event: NSEvent) -> CGPoint { convert(event.locationInWindow, from: nil) }

    func hitLayer(atView p: CGPoint) -> SceneItem? {
        guard let project = controller?.project else { return nil }
        let m = modelPoint(p)
        let tolerance = 3 / zoom
        return project.scene().reversed().first { Geometry.hitTest($0.layer, origin: $0.origin, point: m, tolerance: tolerance) }
    }

    func hitHandle(atView p: CGPoint) -> (Handle, SceneItem)? {
        guard let controller, let id = controller.selectedLayerID, let item = sceneItem(id, in: controller.project),
              !item.layer.locked, controller.editingTextLayerID == nil, controller.cropLayerID == nil else { return nil }
        for (handle, position) in handlePositions(for: item) where hypot(position.x - p.x, position.y - p.y) <= 7 {
            return (handle, item)
        }
        return nil
    }

    func slideIndex(atView p: CGPoint) -> Int? {
        guard let project = controller?.project else { return nil }
        let m = modelPoint(p)
        guard m.y >= 0, m.y <= project.format.height, m.x >= 0 else { return nil }
        let index = Int(m.x / project.format.width)
        return project.slides.indices.contains(index) ? index : nil
    }

    // MARK: Mouse

    override func mouseDown(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        // Clicks that land on the in-place text editor belong to it (AppKit can deliver a
        // delayed mouse-down here after the editor appeared).
        if let editor = textEditor, editor.bounds.contains(editor.convert(event.locationInWindow, from: nil)) {
            window?.makeFirstResponder(editor)
            editor.mouseDown(with: event)
            return
        }
        window?.makeFirstResponder(self)
        lastMouseLocation = p

        if spaceDown {
            drag = .pan(start: p, origin: origin)
            NSCursor.closedHand.set()
            return
        }
        if controller.editingTextLayerID != nil { finishTextEditing() }

        if let cropID = controller.cropLayerID {
            if let item = hitLayer(atView: p), item.layer.id == cropID {
                controller.beginGesture()
                drag = .crop(id: cropID, base: item.layer, start: modelPoint(p))
                NSCursor.closedHand.set()
                return
            }
            controller.cropLayerID = nil
        }

        if event.clickCount == 2, let item = hitLayer(atView: p) {
            drag = .none
            switch item.layer.content {
            case .text: controller.beginTextEditing(item.layer.id)
            case .image(let props):
                if props.assetID != nil { controller.beginCropEditing(item.layer.id) } else { controller.selectLayer(item.layer.id); controller.replacePhoto(item.layer.id) }
            case .shape: break
            }
            return
        }

        if let (handle, item) = hitHandle(atView: p) {
            let others = controller.project.slides[item.slideIndex].layers.filter { $0.id != item.layer.id }
            controller.beginGesture()
            switch handle {
            case .rotate:
                let c = item.globalFrame.center
                let m = modelPoint(p)
                drag = .rotate(id: item.layer.id, base: item.layer, center: c, startAngle: atan2(m.y - c.y, m.x - c.x) * 180 / .pi)
            case .resize:
                drag = .resize(id: item.layer.id, slide: item.slideIndex, base: item.layer, handle: handle, others: others)
            }
            return
        }

        if let item = hitLayer(atView: p) {
            controller.selectLayer(item.layer.id)
            drag = item.layer.locked ? .none : .pending(id: item.layer.id, start: p)
            needsDisplay = true
            return
        }

        controller.selectLayer(nil)
        if let index = slideIndex(atView: p) { controller.selectSlide(controller.project.slides[index].id) }
        drag = .marqueeSlide
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        lastMouseLocation = p
        let snapping = Preferences.snapping && !event.modifierFlags.contains(.command)

        switch drag {
        case .none, .marqueeSlide:
            return

        case .pan(let start, let startOrigin):
            origin = CGPoint(x: startOrigin.x + p.x - start.x, y: startOrigin.y + p.y - start.y)
            clampOrigin()
            layoutTextEditor()
            needsDisplay = true

        case .pending(let id, let start):
            guard hypot(p.x - start.x, p.y - start.y) > 3, let loc = controller.project.locate(layer: id) else { return }
            controller.beginGesture()
            var layerID = id
            var duplicated = false
            if event.modifierFlags.contains(.option) {
                var copy = controller.project.slides[loc.slide].layers[loc.index]
                copy.id = UID.make()
                copy.name = copy.name.hasSuffix(" copy") ? copy.name : "\(copy.name) copy"
                controller.perform("Duplicate Layer") { $0.slides[loc.slide].layers.insert(copy, at: loc.index + 1) }
                controller.selectLayer(copy.id)
                layerID = copy.id
                duplicated = true
            }
            guard let base = controller.project.layer(layerID) else { return }
            let others = controller.project.slides[loc.slide].layers.filter { $0.id != layerID }
            drag = .move(id: layerID, slide: loc.slide, base: base, start: modelPoint(start), others: others, duplicated: duplicated)
            mouseDragged(with: event)

        case .move(let id, let slide, let base, let start, let others, _):
            let m = modelPoint(p)
            var dx = m.x - start.x, dy = m.y - start.y
            if event.modifierFlags.contains(.shift) {
                if abs(dx) > abs(dy) { dy = 0 } else { dx = 0 }
            }
            var frame = base.frame.offsetBy(dx: dx, dy: dy)
            guides = []
            if snapping {
                let bounds = Geometry.rotatedBounds(of: frame, degrees: base.rotation)
                let result = Snapping.snap(moving: bounds, slide: controller.project.format.size, others: others, threshold: 6 / zoom)
                frame = frame.offsetBy(dx: result.origin.x - bounds.minX, dy: result.origin.y - bounds.minY)
                guides = result.guides
            }
            guideSlideOffset = Double(slide) * controller.project.format.width
            updateSeams(for: frame, rotation: base.rotation, slide: slide)
            controller.perform("Move Layer") { $0.updateLayer(id) { $0.x = frame.minX; $0.y = frame.minY } }
            needsDisplay = true

        case .resize(let id, let slide, let base, let handle, let others):
            let frame = resizedFrame(base: base, slide: slide, handle: handle, to: modelPoint(p), event: event, others: others, snapping: snapping)
            updateSeams(for: frame, rotation: base.rotation, slide: slide)
            controller.perform("Resize Layer") { p in
                p.updateLayer(id) { l in
                    l.frame = frame
                    EditorController.fitTextHeight(&l)
                }
            }
            needsDisplay = true

        case .rotate(let id, let base, let center, let startAngle):
            let m = modelPoint(p)
            let angle = atan2(m.y - center.y, m.x - center.x) * 180 / .pi
            var rotation = base.rotation + angle - startAngle
            if event.modifierFlags.contains(.shift) {
                rotation = (rotation / 15).rounded() * 15
            } else {
                let nearest = (rotation / 90).rounded() * 90
                if abs(rotation - nearest) < 2 { rotation = nearest }
            }
            rotation = Geometry.normalizedDegrees(rotation)
            if rotation > 180 { rotation -= 360 }
            controller.perform("Rotate Layer") { $0.updateLayer(id) { $0.rotation = rotation } }
            needsDisplay = true

        case .crop(let id, let base, let start):
            guard let props = base.image, let asset = controller.project.asset(props.assetID) else { return }
            let m = modelPoint(p)
            let delta = Geometry.rotate(CGPoint(x: m.x - start.x, y: m.y - start.y), around: .zero, degrees: -base.rotation)
            let box = CGSize(width: base.width, height: base.height)
            let media = Geometry.mediaRect(mediaSize: asset.pixelSize, box: box, image: props)
            let offsets = Geometry.cropOffsets(forMediaOrigin: CGPoint(x: media.minX + delta.x, y: media.minY + delta.y), mediaRect: media, box: box)
            controller.perform("Adjust Crop") { $0.updateLayer(id) { $0.image?.cropOffsetX = offsets.x; $0.image?.cropOffsetY = offsets.y } }
            needsDisplay = true
        }
    }

    override func mouseUp(with event: NSEvent) {
        guard let controller else { return }
        switch drag {
        case .move(_, _, _, _, _, let duplicated): controller.endGesture(duplicated ? "Duplicate Layer" : "Move Layer")
        case .resize: controller.endGesture("Resize Layer")
        case .rotate: controller.endGesture("Rotate Layer")
        case .crop: controller.endGesture("Adjust Crop"); NSCursor.openHand.set()
        case .pan: (spaceDown ? NSCursor.openHand : NSCursor.arrow).set()
        default: break
        }
        drag = .none
        guides = []
        seams = []
        needsDisplay = true
    }

    private func updateSeams(for frame: CGRect, rotation: Double, slide: Int) {
        guard let project = controller?.project, Preferences.showSeams else { seams = []; return }
        let global = Geometry.rotatedBounds(of: frame.offsetBy(dx: Double(slide) * project.format.width, dy: 0), degrees: rotation)
        seams = Snapping.crossedSeams(global, slideWidth: project.format.width, slideCount: project.slides.count).map {
            CGRect(x: $0, y: max(0, global.minY), width: 0, height: min(project.format.height, global.maxY) - max(0, global.minY))
        }
    }

    /// Resizes from a handle in the layer's own (rotated) space, keeping the opposite side fixed.
    private func resizedFrame(base: Layer, slide: Int, handle: Handle, to m: CGPoint, event: NSEvent, others: [Layer], snapping: Bool) -> CGRect {
        guard case .resize(let hx, let hy) = handle, let project = controller?.project else { return base.frame }
        let slideOffset = Double(slide) * project.format.width
        let baseRect = base.frame.offsetBy(dx: slideOffset, dy: 0)
        let local = Geometry.localPoint(m, in: baseRect, degrees: base.rotation)
        let w = base.width, h = base.height
        let isText = base.text != nil
        let fromCenter = event.modifierFlags.contains(.option)
        let shift = event.modifierFlags.contains(.shift)
        let keepRatio = hx != 0 && hy != 0 && !isText && (base.image != nil ? !shift : shift)
        var left = 0.0, right = w, top = 0.0, bottom = h

        if hx == 1 { right = local.x } else if hx == -1 { left = local.x }
        if hy == 1 && !isText { bottom = local.y } else if hy == -1 && !isText { top = local.y }
        if fromCenter {
            if hx != 0 { let half = abs(local.x - w / 2); left = w / 2 - half; right = w / 2 + half }
            if hy != 0 && !isText { let half = abs(local.y - h / 2); top = h / 2 - half; bottom = h / 2 + half }
        }

        func applyRatio(widthLeads: Bool) {
            let ratio = w / max(1, h)
            var nw = abs(right - left), nh = abs(bottom - top)
            if widthLeads { nh = nw / ratio } else if nw / ratio > nh { nh = nw / ratio } else { nw = nh * ratio }
            if fromCenter {
                left = w / 2 - nw / 2; right = w / 2 + nw / 2; top = h / 2 - nh / 2; bottom = h / 2 + nh / 2
            } else {
                if hx == 1 { right = left + nw } else { left = right - nw }
                if hy == 1 { bottom = top + nh } else { top = bottom - nh }
            }
        }
        if keepRatio { applyRatio(widthLeads: false) }

        var newGuides: [SnapGuide] = []
        if snapping && base.rotation.truncatingRemainder(dividingBy: 360) == 0 && !fromCenter {
            let threshold = 6 / zoom
            let size = project.format.size
            if hx != 0 {
                let edge = base.x + (hx == 1 ? right : left)
                let (snapped, guide) = Snapping.snapEdge(edge, orientation: .vertical, span: (base.y + top)...(base.y + bottom), slide: size, others: others, threshold: threshold)
                if let guide {
                    if hx == 1 { right = snapped - base.x } else { left = snapped - base.x }
                    newGuides.append(guide)
                    if keepRatio { applyRatio(widthLeads: true) }
                }
            }
            if hy != 0 && !keepRatio && !isText {
                let edge = base.y + (hy == 1 ? bottom : top)
                let (snapped, guide) = Snapping.snapEdge(edge, orientation: .horizontal, span: (base.x + left)...(base.x + right), slide: size, others: others, threshold: threshold)
                if let guide {
                    if hy == 1 { bottom = snapped - base.y } else { top = snapped - base.y }
                    newGuides.append(guide)
                }
            }
        }
        guides = newGuides
        guideSlideOffset = slideOffset

        // Minimum size, keeping the anchored side in place.
        let minSide = 8.0
        if right - left < minSide { if hx == -1 { left = right - minSide } else { right = left + minSide } }
        if bottom - top < minSide { if hy == -1 { top = bottom - minSide } else { bottom = top + minSide } }

        let newLocal = CGRect(x: left, y: top, width: right - left, height: bottom - top)
        let center = Geometry.parentPoint(newLocal.center, in: baseRect, degrees: base.rotation)
        return CGRect(x: center.x - slideOffset - newLocal.width / 2, y: center.y - newLocal.height / 2, width: newLocal.width, height: newLocal.height)
    }

    // MARK: Hover & cursors

    override func mouseMoved(with event: NSEvent) {
        let p = point(event)
        lastMouseLocation = p
        updateHover(p)
    }

    override func mouseExited(with event: NSEvent) {
        if hoverLayerID != nil { hoverLayerID = nil; needsDisplay = true }
        lastMouseLocation = nil
    }

    func updateHover(_ p: CGPoint) {
        guard let controller else { return }
        if spaceDown { NSCursor.openHand.set(); return }
        if let (handle, item) = hitHandle(atView: p) {
            cursor(for: handle, item: item).set()
        } else if let cropID = controller.cropLayerID, hitLayer(atView: p)?.layer.id == cropID {
            NSCursor.openHand.set()
        } else {
            NSCursor.arrow.set()
        }
        let hovered = hitLayer(atView: p)?.layer.id
        if hovered != hoverLayerID {
            hoverLayerID = hovered
            needsDisplay = true
        }
    }

    private func cursor(for handle: Handle, item: SceneItem) -> NSCursor {
        guard case .resize(let dx, let dy) = handle else { return Self.rotateCursor }
        // Pick the system resize cursor closest to the handle's on-screen direction.
        let angle = atan2(Double(dy), Double(dx)) * 180 / .pi + item.layer.rotation
        let positions: [NSCursor.FrameResizePosition] = [.right, .bottomRight, .bottom, .bottomLeft, .left, .topLeft, .top, .topRight]
        let slot = Int((Geometry.normalizedDegrees(angle) / 45).rounded()) % 8
        return NSCursor.frameResize(position: positions[slot], directions: .all)
    }

    static let rotateCursor: NSCursor = {
        let config = NSImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
        guard let symbol = NSImage(systemSymbolName: "arrow.trianglehead.clockwise.rotate.90", accessibilityDescription: nil)?.withSymbolConfiguration(config)
                ?? NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: nil)?.withSymbolConfiguration(config) else { return .crosshair }
        let size = NSSize(width: 22, height: 22)
        let image = NSImage(size: size, flipped: false) { rect in
            let inset = rect.insetBy(dx: 3, dy: 3)
            NSColor.white.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
            symbol.draw(in: inset)
            return true
        }
        return NSCursor(image: image, hotSpot: NSPoint(x: 11, y: 11))
    }()

    override func cursorUpdate(with event: NSEvent) {
        updateHover(point(event))
    }

    // MARK: Scrolling, zooming and gestures

    override func scrollWheel(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        // Scrolling over the photo being cropped zooms the crop.
        if let cropID = controller.cropLayerID, !event.modifierFlags.contains(.command),
           let item = hitLayer(atView: p), item.layer.id == cropID, let scale = item.layer.image?.cropScale {
            let dy = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 8
            let next = clamp(scale * exp(dy * 0.006), 1, 4)
            controller.updateLayer(cropID, "Adjust Crop", coalesce: "crop-zoom:\(cropID)") { $0.image?.cropScale = next }
            return
        }
        if event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control) {
            let dy = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY * 0.01 : event.scrollingDeltaY * 0.08
            zoom(to: zoom * exp(dy), anchor: p)
            return
        }
        guard let project = controller.project as Project? else { return }
        let lineScale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 16
        var dx = event.scrollingDeltaX * lineScale
        var dy = event.scrollingDeltaY * lineScale
        let deck = deckSize(project)
        let avail = availableRect
        let canScrollX = deck.width + padding * 2 > avail.width + 1
        let canScrollY = deck.height + padding * 2 > avail.height + 1
        // A plain mouse wheel moves through the slides when the deck only scrolls sideways.
        if canScrollX && !canScrollY && !event.hasPreciseScrollingDeltas && dx == 0 {
            dx = dy
            dy = 0
        }
        origin.x += dx
        origin.y += dy
        clampOrigin()
        layoutTextEditor()
        needsDisplay = true
        updateHover(p)
    }

    override func magnify(with event: NSEvent) {
        zoom(to: zoom * (1 + event.magnification), anchor: point(event))
    }

    override func smartMagnify(with event: NSEvent) {
        guard let controller else { return }
        let target: CGFloat = abs(zoom - controller.fitZoom) < 0.01 ? 1 : controller.fitZoom
        zoom(to: target, anchor: point(event))
        if target == controller.fitZoom { controller.zoomToFit() }
    }

    // MARK: Keyboard

    override func keyDown(with event: NSEvent) {
        guard let controller else { return super.keyDown(with: event) }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let shift = flags.contains(.shift)
        let commandLike = flags.contains(.command) || flags.contains(.control) || flags.contains(.option)
        let chars = event.charactersIgnoringModifiers ?? ""

        switch event.keyCode {
        case 49: // space
            if !event.isARepeat { spaceDown = true; NSCursor.openHand.set() }
            return
        case 53: // escape
            if controller.cropLayerID != nil { controller.cropLayerID = nil }
            else if controller.selectedLayerID != nil { controller.selectLayer(nil) }
            needsDisplay = true
            return
        case 36, 76: // return
            if controller.cropLayerID != nil { controller.cropLayerID = nil; return }
            if let layer = controller.selectedLayer {
                if layer.text != nil { controller.beginTextEditing(layer.id) }
                else if layer.image?.assetID != nil { controller.beginCropEditing(layer.id) }
                else if layer.image != nil { controller.replacePhoto(layer.id) }
            }
            return
        case 48: // tab
            controller.selectAdjacentLayer(shift ? -1 : 1)
            return
        case 51, 117: // delete, forward delete
            if !commandLike { controller.deleteSelection(); return }
        case 123, 124, 125, 126: // arrows
            guard !flags.contains(.command) else { break }
            let step: Double = shift ? 10 : 1
            if controller.selectedLayerID != nil {
                switch event.keyCode {
                case 123: controller.nudge(dx: -step, dy: 0)
                case 124: controller.nudge(dx: step, dy: 0)
                case 125: controller.nudge(dx: 0, dy: step)
                default: controller.nudge(dx: 0, dy: -step)
                }
            } else if event.keyCode == 123 || event.keyCode == 124 {
                controller.focusSlide(at: controller.selectedSlideIndex + (event.keyCode == 123 ? -1 : 1))
            }
            return
        default:
            break
        }

        if !flags.contains(.command) && !flags.contains(.control) {
            switch chars {
            case "t", "T": controller.addText(); return
            case "r", "R": controller.addShape(.rect); return
            case "o", "O": controller.addShape(.ellipse); return
            case "]": if let id = controller.selectedLayerID { controller.arrange(id, .forward) }; return
            case "[": if let id = controller.selectedLayerID { controller.arrange(id, .backward) }; return
            case "}": if let id = controller.selectedLayerID { controller.arrange(id, .front) }; return
            case "{": if let id = controller.selectedLayerID { controller.arrange(id, .back) }; return
            case "=", "+": controller.zoomIn(); return
            case "-", "_": controller.zoomOut(); return
            case "!": controller.zoomToFit(); return
            case ")": controller.zoomToActualSize(); return
            default: break
            }
        }
        super.keyDown(with: event)
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49 {
            spaceDown = false
            if case .pan = drag {} else { NSCursor.arrow.set() }
            return
        }
        super.keyUp(with: event)
    }

    override func resignFirstResponder() -> Bool {
        spaceDown = false
        return super.resignFirstResponder()
    }
}
