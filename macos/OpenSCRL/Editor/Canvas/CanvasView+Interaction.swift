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
        guard let controller, !controller.isMultiSelection, let id = controller.selectedLayerID, let item = sceneItem(id, in: controller.project),
              !item.layer.locked, controller.editingTextLayerID == nil, controller.cropLayerID == nil else { return nil }
        for (handle, position) in handlePositions(for: item) where hypot(position.x - p.x, position.y - p.y) <= 7 {
            return (handle, item)
        }
        return nil
    }

    /// A handle of a multi-layer selection's box under the pointer.
    func hitSelectionHandle(atView p: CGPoint) -> Handle? {
        guard let controller, let box = selectionBox(controller), !box.locked,
              controller.editingTextLayerID == nil, controller.cropLayerID == nil else { return nil }
        return selectionHandlePositions(box.rect).first { hypot($0.1.x - p.x, $0.1.y - p.y) <= 7 }?.0
    }

    /// Plays the trackpad's alignment tap when a drag snaps to a guide it wasn't on, like Keynote.
    func noteSnap(_ guides: [SnapGuide]) {
        let signature = Set(guides.map { "\($0.orientation == .vertical ? "v" : "h")\(Int(($0.position * 2).rounded()))" })
        if !signature.isEmpty && !signature.isSubset(of: lastSnapSignature) {
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        }
        lastSnapSignature = signature
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
                controller.beginCanvasGesture()
                drag = .crop(id: cropID, base: item.layer, start: modelPoint(p))
                NSCursor.closedHand.set()
                return
            }
            controller.cropLayerID = nil
        }

        if let button = slideButton(atView: p) {
            // A disabled button still swallows the click instead of deselecting.
            if isEnabled(button) {
                drag = .slideButton(button)
                needsDisplay = true
            }
            return
        }

        let additive = event.modifierFlags.contains(.shift) || event.modifierFlags.contains(.command)

        if event.clickCount == 2, let item = hitLayer(atView: p) {
            drag = .none
            let id = item.layer.id
            // A double-click on a grouped layer steps into the group; once in, it edits as usual.
            let inside = item.layer.groupID == nil || controller.selectedLayerIDs == [id]
            switch item.layer.content {
            case .text: controller.beginTextEditing(id)
            case .image(let props):
                if !inside { controller.enterGroup(id) }
                else if props.assetID != nil { controller.beginCropEditing(id) }
                else { controller.selectLayer(id); controller.replacePhoto(id) }
            case .shape:
                if !inside { controller.enterGroup(id) }
            }
            needsDisplay = true
            return
        }

        if let handle = hitSelectionHandle(atView: p), let box = selectionBox(controller) {
            let offset = Double(box.slide) * controller.project.format.width
            let selected = Set(controller.selectedLayerIDs)
            let bases = controller.selectedLayers.filter { !$0.locked }
            controller.beginCanvasGesture()
            switch handle {
            case .rotate:
                let c = box.rect.center
                let m = modelPoint(p)
                drag = .groupRotate(slide: box.slide, bases: bases, center: c, startAngle: atan2(m.y - c.y, m.x - c.x) * 180 / .pi)
            case .resize:
                let others = controller.project.slides[box.slide].layers.filter { !selected.contains($0.id) }
                drag = .groupResize(slide: box.slide, bases: bases, from: box.rect.offsetBy(dx: -offset, dy: 0), handle: handle, others: others)
            }
            return
        }

        if let (handle, item) = hitHandle(atView: p) {
            let others = controller.project.slides[item.slideIndex].layers.filter { $0.id != item.layer.id }
            controller.beginCanvasGesture()
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
            let id = item.layer.id
            let narrow = !additive && controller.clickWouldNarrow(id)
            controller.pickLayer(id, additive: additive)
            drag = controller.selectedLayerIDs.contains(id) ? .pending(id: id, start: p, narrow: narrow) : .none
            needsDisplay = true
            return
        }

        // Empty canvas: select the slide under the pointer and start a rubber band there.
        let m = modelPoint(p)
        let index = slideIndex(atView: p) ?? clamp(Int(floor(m.x / controller.project.format.width)), 0, controller.project.slides.count - 1)
        let keep = additive && controller.selectedLayerLocation?.slide == index
        if !keep {
            controller.selectLayer(nil)
            if slideIndex(atView: p) != nil { controller.selectSlide(controller.project.slides[index].id) }
        }
        drag = .marquee(start: m, slide: index, base: keep ? controller.selectedLayerIDs : [])
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        lastMouseLocation = p
        let snapping = Preferences.snapping && !event.modifierFlags.contains(.command)

        switch drag {
        case .none:
            return

        case .marquee(let start, let slide, let base):
            guard controller.project.slides.indices.contains(slide) else { return }
            let m = modelPoint(p)
            let rect = CGRect(x: min(start.x, m.x), y: min(start.y, m.y), width: abs(m.x - start.x), height: abs(m.y - start.y))
            marqueeRect = rect
            let local = rect.offsetBy(dx: -Double(slide) * controller.project.format.width, dy: 0)
            let layers = controller.project.slides[slide].layers
            let hits = layers.filter { $0.visible && !$0.locked && Geometry.rotatedBounds(of: $0.frame, degrees: $0.rotation).intersects(local) }.map(\.id)
            let next = controller.project.slides[slide].expandedToGroups(base + hits)
            if next != controller.selectedLayerIDs {
                if next.isEmpty { controller.selectLayer(nil) } else { controller.selectLayers(next) }
            }
            needsDisplay = true

        case .slideButton:
            // Pressed while over the button; released elsewhere cancels.
            updateSlideHover(p)

        case .pan(let start, let startOrigin):
            origin = CGPoint(x: startOrigin.x + p.x - start.x, y: startOrigin.y + p.y - start.y)
            clampOrigin()
            layoutTextEditor()
            needsDisplay = true

        case .pending(let id, let start, _):
            guard hypot(p.x - start.x, p.y - start.y) > 3, let loc = controller.project.locate(layer: id),
                  controller.project.layer(id)?.locked == false else { return }
            controller.beginCanvasGesture()
            var duplicated = false
            if event.modifierFlags.contains(.option) {
                // ⌥-drag leaves the originals behind and moves fresh copies.
                let sources = controller.selectedLayerIDs
                var mapping: [String: String] = [:]
                controller.perform("Duplicate Layers") { p in
                    mapping = p.slides[loc.slide].duplicateLayers(sources)
                    for (source, copy) in mapping {
                        guard let original = p.slides[loc.slide].layers.first(where: { $0.id == source }),
                              let i = p.slides[loc.slide].layers.firstIndex(where: { $0.id == copy }) else { continue }
                        p.slides[loc.slide].layers[i].x = original.x
                        p.slides[loc.slide].layers[i].y = original.y
                    }
                }
                let copies = Set(mapping.values)
                controller.selectLayers(controller.project.slides[loc.slide].layers.map(\.id).filter(copies.contains), primary: mapping[id])
                duplicated = true
            }
            let selected = Set(controller.selectedLayerIDs)
            let bases = controller.selectedLayers.filter { !$0.locked }
            guard let union = Geometry.unionBounds(of: bases) else { return }
            let others = controller.project.slides[loc.slide].layers.filter { !selected.contains($0.id) }
            drag = .move(ids: bases.map(\.id), slide: loc.slide, bases: bases, union: union, start: modelPoint(start), others: others, duplicated: duplicated)
            mouseDragged(with: event)

        case .move(let ids, let slide, let bases, let union, let start, let others, _):
            let m = modelPoint(p)
            var dx = m.x - start.x, dy = m.y - start.y
            if event.modifierFlags.contains(.shift) {
                if abs(dx) > abs(dy) { dy = 0 } else { dx = 0 }
            }
            guides = []
            if snapping {
                let moved = union.offsetBy(dx: dx, dy: dy)
                let result = Snapping.snap(moving: moved, slide: controller.project.format.size, others: others, threshold: 6 / zoom)
                dx += result.origin.x - moved.minX
                dy += result.origin.y - moved.minY
                guides = result.guides
            }
            noteSnap(guides)
            guideSlideOffset = Double(slide) * controller.project.format.width
            updateSeams(for: union.offsetBy(dx: dx, dy: dy), rotation: 0, slide: slide)
            let byID = Dictionary(uniqueKeysWithValues: bases.map { ($0.id, $0) })
            controller.perform(ids.count == 1 ? "Move Layer" : "Move Layers") { p in
                for i in p.slides[slide].layers.indices {
                    guard let base = byID[p.slides[slide].layers[i].id] else { continue }
                    p.slides[slide].layers[i].x = base.x + dx
                    p.slides[slide].layers[i].y = base.y + dy
                }
            }
            needsDisplay = true

        case .groupResize(let slide, let bases, let from, let handle, let others):
            let to = resizedSelection(from: from, slide: slide, handle: handle, to: modelPoint(p), event: event, others: others, snapping: snapping)
            noteSnap(guides)
            updateSeams(for: to, rotation: 0, slide: slide)
            let byID = Dictionary(uniqueKeysWithValues: bases.map { ($0.id, $0) })
            controller.perform("Resize Layers") { p in
                for i in p.slides[slide].layers.indices {
                    guard let base = byID[p.slides[slide].layers[i].id] else { continue }
                    var scaled = Layer.scaled(base, from: from, to: to)
                    EditorController.fitTextHeight(&scaled)
                    p.slides[slide].layers[i] = scaled
                }
            }
            needsDisplay = true

        case .groupRotate(let slide, let bases, let center, let startAngle):
            let m = modelPoint(p)
            var delta = atan2(m.y - center.y, m.x - center.x) * 180 / .pi - startAngle
            if event.modifierFlags.contains(.shift) {
                delta = (delta / 15).rounded() * 15
            } else {
                let nearest = (delta / 90).rounded() * 90
                if abs(delta - nearest) < 2 { delta = nearest }
            }
            let pivot = CGPoint(x: center.x - Double(slide) * controller.project.format.width, y: center.y)
            let byID = Dictionary(uniqueKeysWithValues: bases.map { ($0.id, $0) })
            controller.perform("Rotate Layers") { p in
                for i in p.slides[slide].layers.indices {
                    guard let base = byID[p.slides[slide].layers[i].id] else { continue }
                    let c = Geometry.rotate(base.frame.center, around: pivot, degrees: delta)
                    var rotation = Geometry.normalizedDegrees(base.rotation + delta)
                    if rotation > 180 { rotation -= 360 }
                    p.slides[slide].layers[i].x = c.x - base.width / 2
                    p.slides[slide].layers[i].y = c.y - base.height / 2
                    p.slides[slide].layers[i].rotation = rotation
                }
            }
            needsDisplay = true

        case .resize(let id, let slide, let base, let handle, let others):
            let frame = resizedFrame(base: base, slide: slide, handle: handle, to: modelPoint(p), event: event, others: others, snapping: snapping)
            noteSnap(guides)
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
        case .pending(let id, _, let narrow): if narrow { controller.narrowSelection(to: id) }
        case .move(let ids, _, _, _, _, _, let duplicated):
            controller.endGesture(duplicated ? "Duplicate" : ids.count == 1 ? "Move Layer" : "Move Layers")
        case .resize: controller.endGesture("Resize Layer")
        case .rotate: controller.endGesture("Rotate Layer")
        case .groupResize: controller.endGesture("Resize Layers")
        case .groupRotate: controller.endGesture("Rotate Layers")
        case .marquee: marqueeRect = nil
        case .crop: controller.endGesture("Adjust Crop"); NSCursor.openHand.set()
        case .pan: (spaceDown ? NSCursor.openHand : NSCursor.arrow).set()
        case .slideButton(let button): if slideButton(atView: point(event)) == button { performSlideAction(button) }
        default: break
        }
        drag = .none
        guides = []
        seams = []
        lastSnapSignature = []
        needsDisplay = true
    }

    /// Scales a multi-layer selection's slide-local box from a handle. Corners keep the
    /// proportions (⇧ frees them), ⌥ scales from the center, and the moving edges snap.
    private func resizedSelection(from: CGRect, slide: Int, handle: Handle, to m: CGPoint, event: NSEvent, others: [Layer], snapping: Bool) -> CGRect {
        guard case .resize(let hx, let hy) = handle, let project = controller?.project else { return from }
        let slideOffset = Double(slide) * project.format.width
        let local = CGPoint(x: m.x - slideOffset, y: m.y)
        let fromCenter = event.modifierFlags.contains(.option)
        let keepRatio = hx != 0 && hy != 0 && !event.modifierFlags.contains(.shift)
        var left = from.minX, right = from.maxX, top = from.minY, bottom = from.maxY
        if hx == 1 { right = local.x } else if hx == -1 { left = local.x }
        if hy == 1 { bottom = local.y } else if hy == -1 { top = local.y }
        if fromCenter {
            if hx != 0 { let half = abs(local.x - from.midX); left = from.midX - half; right = from.midX + half }
            if hy != 0 { let half = abs(local.y - from.midY); top = from.midY - half; bottom = from.midY + half }
        }
        func applyRatio(widthLeads: Bool) {
            let ratio = from.width / max(1, from.height)
            var nw = abs(right - left), nh = abs(bottom - top)
            if widthLeads { nh = nw / ratio } else if nw / ratio > nh { nh = nw / ratio } else { nw = nh * ratio }
            if fromCenter {
                left = from.midX - nw / 2; right = from.midX + nw / 2; top = from.midY - nh / 2; bottom = from.midY + nh / 2
            } else {
                if hx == 1 { right = left + nw } else { left = right - nw }
                if hy == 1 { bottom = top + nh } else { top = bottom - nh }
            }
        }
        if keepRatio { applyRatio(widthLeads: false) }

        var newGuides: [SnapGuide] = []
        if snapping && !fromCenter {
            let threshold = 6 / zoom
            if hx != 0 {
                let (snapped, guide) = Snapping.snapEdge(hx == 1 ? right : left, orientation: .vertical, span: top...max(top, bottom), slide: project.format.size, others: others, threshold: threshold)
                if let guide {
                    if hx == 1 { right = snapped } else { left = snapped }
                    newGuides.append(guide)
                    if keepRatio { applyRatio(widthLeads: true) }
                }
            }
            if hy != 0 && !keepRatio {
                let (snapped, guide) = Snapping.snapEdge(hy == 1 ? bottom : top, orientation: .horizontal, span: left...max(left, right), slide: project.format.size, others: others, threshold: threshold)
                if let guide {
                    if hy == 1 { bottom = snapped } else { top = snapped }
                    newGuides.append(guide)
                }
            }
        }
        guides = newGuides
        guideSlideOffset = slideOffset
        let minSide = 8.0
        if right - left < minSide { if hx == -1 { left = right - minSide } else { right = left + minSide } }
        if bottom - top < minSide { if hy == -1 { top = bottom - minSide } else { bottom = top + minSide } }
        return CGRect(x: left, y: top, width: right - left, height: bottom - top)
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
        updateSlideHover(nil)
        lastMouseLocation = nil
    }

    func updateHover(_ p: CGPoint) {
        guard let controller else { return }
        if spaceDown { NSCursor.openHand.set(); return }
        if let handle = hitSelectionHandle(atView: p) {
            cursor(for: handle, rotation: 0).set()
        } else if let (handle, item) = hitHandle(atView: p) {
            cursor(for: handle, rotation: item.layer.rotation).set()
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
        updateSlideHover(p)
    }

    private func cursor(for handle: Handle, rotation: Double) -> NSCursor {
        guard case .resize(let dx, let dy) = handle else { return Self.rotateCursor }
        // Pick the system resize cursor closest to the handle's on-screen direction.
        let angle = atan2(Double(dy), Double(dx)) * 180 / .pi + rotation
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
            else if controller.selectedLayerID != nil { controller.selectParent() }
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
            case "p", "P": PhonePreviewWindow.show(for: controller); return
            case "]": controller.arrangeSelection(.forward); return
            case "[": controller.arrangeSelection(.backward); return
            case "}": controller.arrangeSelection(.front); return
            case "{": controller.arrangeSelection(.back); return
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
