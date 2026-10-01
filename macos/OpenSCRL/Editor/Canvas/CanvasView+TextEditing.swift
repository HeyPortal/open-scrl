import AppKit

/// In-place text editor laid over a text layer while it's being edited.
final class CanvasTextView: NSTextView {
    var onCancel: (() -> Void)?
    var onCommit: (() -> Void)?

    override func cancelOperation(_ sender: Any?) { onCancel?() }

    override func keyDown(with event: NSEvent) {
        // ⌘↩ finishes editing; plain Return inserts a line break like the web editor.
        if event.keyCode == 36 || event.keyCode == 76, event.modifierFlags.contains(.command) {
            onCommit?()
            return
        }
        super.keyDown(with: event)
    }
}

extension CanvasView: NSTextViewDelegate {
    func syncTextEditor() {
        guard let controller else { return }
        let wanted = controller.editingTextLayerID
        if let editor = textEditor, editor.identifier?.rawValue != wanted {
            removeTextEditor(commit: true)
        }
        guard textEditor == nil, let id = wanted, let layer = controller.project.layer(id), let props = layer.text else { return }

        controller.beginGesture()
        let editor = CanvasTextView(frame: .zero)
        editor.identifier = NSUserInterfaceItemIdentifier(id)
        editor.drawsBackground = false
        editor.isRichText = false
        editor.importsGraphics = false
        editor.allowsUndo = true
        editor.usesFindBar = false
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.isAutomaticTextReplacementEnabled = false
        editor.textContainerInset = .zero
        editor.textContainer?.lineFragmentPadding = 0
        editor.textContainer?.widthTracksTextView = true
        editor.isHorizontallyResizable = false
        editor.isVerticallyResizable = false
        editor.focusRingType = .none
        editor.wantsLayer = true
        editor.string = props.text
        editor.delegate = self
        editor.onCancel = { [weak self] in self?.finishTextEditing() }
        editor.onCommit = { [weak self] in self?.finishTextEditing() }
        addSubview(editor)
        textEditor = editor
        styledZoom = zoom
        styleTextEditor()
        layoutTextEditor()
        window?.makeFirstResponder(editor)
        editor.selectAll(nil)
        needsDisplay = true
    }

    /// Matches the editor's typography to the layer at the current zoom.
    func styleTextEditor() {
        guard let editor = textEditor, let controller, let layer = controller.project.layer(editor.identifier?.rawValue), let props = layer.text else { return }
        let z = zoom
        let font = FontResolver.nsFont(family: props.fontFamily, weight: props.fontWeight, italic: props.italic, size: props.fontSize * z)
        let lineHeight = props.fontSize * props.lineHeight * z
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = switch props.align {
        case .left: .left
        case .center: .center
        case .right: .right
        }
        paragraph.minimumLineHeight = lineHeight
        paragraph.maximumLineHeight = lineHeight
        let natural = font.ascender - font.descender
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor(cgColor: HexColor.cgColor(props.fill)) ?? .labelColor,
            .paragraphStyle: paragraph,
            .kern: props.letterSpacing * z,
            .baselineOffset: (lineHeight - natural) / 2,
        ]
        editor.typingAttributes = attributes
        editor.insertionPointColor = NSColor(cgColor: HexColor.cgColor(props.fill)) ?? .labelColor
        if let storage = editor.textStorage {
            storage.setAttributes(attributes, range: NSRange(location: 0, length: storage.length))
        }
    }

    func layoutTextEditor() {
        guard let editor = textEditor, let controller, let item = sceneItem(editor.identifier?.rawValue ?? "", in: controller.project) else { return }
        if styledZoom != zoom {
            styledZoom = zoom
            styleTextEditor()
        }
        var frame = viewRect(item.globalFrame)
        // Text Kit measures a hair wider than Core Text; give it slack so lines wrap the same way.
        let slack = max(16, frame.width * 0.04)
        switch item.layer.text?.align ?? .left {
        case .left: frame.size.width += slack
        case .center: frame = frame.insetBy(dx: -slack / 2, dy: 0)
        case .right: frame.origin.x -= slack; frame.size.width += slack
        }
        editor.frameCenterRotation = 0
        editor.frame = CGRect(x: frame.minX, y: frame.minY, width: max(4, frame.width), height: max(frame.height, (item.layer.text?.fontSize ?? 12) * zoom))
        editor.frameCenterRotation = -item.layer.rotation
    }

    func textDidChange(_ notification: Notification) {
        guard let editor = textEditor, let controller, let id = editor.identifier?.rawValue else { return }
        let text = editor.string
        controller.perform("Edit Text") { p in
            p.updateLayer(id) { l in
                l.text?.text = text
                EditorController.fitTextHeight(&l)
            }
        }
        layoutTextEditor()
    }

    func textDidEndEditing(_ notification: Notification) {
        finishTextEditing()
    }

    func undoManager(for view: NSTextView) -> UndoManager? { textUndoManager }

    func finishTextEditing() {
        guard textEditor != nil else { return }
        removeTextEditor(commit: true)
        controller?.editingTextLayerID = nil
        window?.makeFirstResponder(self)
    }

    private func removeTextEditor(commit: Bool) {
        guard let editor = textEditor else { return }
        textEditor = nil
        editor.delegate = nil
        editor.removeFromSuperview()
        textUndoManager.removeAllActions()
        if commit { controller?.endGesture("Edit Text") } else { controller?.cancelGesture() }
        needsDisplay = true
    }
}
