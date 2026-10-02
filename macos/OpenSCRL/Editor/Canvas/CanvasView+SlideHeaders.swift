import AppKit

/// The number above each slide, with New, Duplicate and Delete buttons on the selected slide and
/// on the slide under the pointer.
extension CanvasView {
    enum SlideAction: CaseIterable {
        case add, duplicate, delete

        var symbol: String {
            switch self {
            case .add: "plus"
            case .duplicate: "plus.square.on.square"
            case .delete: "trash"
            }
        }

        var title: String {
            switch self {
            case .add: "New Slide After"
            case .duplicate: "Duplicate Slide"
            case .delete: "Delete Slide"
            }
        }
    }

    struct SlideButton: Equatable {
        var slide: Int
        var action: SlideAction
    }

    static let slideNumberFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
    private static let slideButtonSize: CGFloat = 22
    private static let slideButtonSpacing: CGFloat = 2
    /// How far above a slide the pointer still counts as over it, so its buttons stay reachable.
    private static let slideHeaderHeight: CGFloat = 30

    /// The selected slide, plus the hovered one when it differs.
    var slidesWithButtons: [Int] {
        guard let controller, !isInteracting, !controller.project.slides.isEmpty else { return [] }
        let selected = controller.selectedSlideIndex
        guard let hover = hoverSlideIndex, hover != selected else { return [selected] }
        return [selected, hover]
    }

    /// Where slide `index`'s number goes, and its buttons when they're shown. While the slide is
    /// partly scrolled out to the left, the header sticks to the visible edge.
    func slideHeaderLayout(_ index: Int) -> (label: NSString, labelOrigin: CGPoint, buttons: [(SlideButton, CGRect)]) {
        let label = "\(index + 1)" as NSString
        let labelSize = label.size(withAttributes: [.font: Self.slideNumberFont])
        let size = Self.slideButtonSize, spacing = Self.slideButtonSpacing
        let W = (controller?.project.format.width ?? 0) * zoom
        let slideX = origin.x + CGFloat(index) * W
        let width = 2 + labelSize.width + 6 + CGFloat(SlideAction.allCases.count) * (size + spacing) - spacing
        // Slides too narrow on screen for the buttons keep just their number.
        let fits = width <= W
        let x = fits ? min(max(slideX, availableRect.minX), slideX + W - width) : slideX
        let labelOrigin = CGPoint(x: x + 2, y: origin.y - labelSize.height - 6)
        guard fits, slidesWithButtons.contains(index) else { return (label, labelOrigin, []) }
        let midY = labelOrigin.y + labelSize.height / 2
        var buttonX = labelOrigin.x + labelSize.width + 6
        let buttons = SlideAction.allCases.map { action in
            defer { buttonX += size + spacing }
            return (SlideButton(slide: index, action: action), CGRect(x: buttonX, y: midY - size / 2, width: size, height: size))
        }
        return (label, labelOrigin, buttons)
    }

    func isEnabled(_ button: SlideButton) -> Bool {
        button.action != .delete || (controller?.project.slides.count ?? 0) > 1
    }

    // MARK: Hit testing & hover

    func slideButton(atView p: CGPoint) -> SlideButton? {
        // A selected layer's handles are drawn on top, so they win.
        guard hitHandle(atView: p) == nil else { return nil }
        for index in slidesWithButtons {
            if let (button, _) = slideHeaderLayout(index).buttons.first(where: { $0.1.contains(p) }) { return button }
        }
        return nil
    }

    /// The slide whose column, including the header strip above it, contains `p`.
    func slideColumnIndex(atView p: CGPoint) -> Int? {
        guard let project = controller?.project else { return nil }
        guard p.y >= origin.y - Self.slideHeaderHeight, p.y <= origin.y + project.format.height * zoom, p.x >= origin.x else { return nil }
        let index = Int((p.x - origin.x) / (project.format.width * zoom))
        return project.slides.indices.contains(index) ? index : nil
    }

    func updateSlideHover(_ p: CGPoint?) {
        let index = p.flatMap(slideColumnIndex(atView:))
        var changed = index != hoverSlideIndex
        hoverSlideIndex = index
        let button = p.flatMap(slideButton(atView:))
        if button != hoverSlideButton {
            hoverSlideButton = button
            toolTip = button?.action.title
            changed = true
        }
        if changed { needsDisplay = true }
    }

    func performSlideAction(_ button: SlideButton) {
        guard let controller, isEnabled(button), controller.project.slides.indices.contains(button.slide) else { return }
        let id = controller.project.slides[button.slide].id
        switch button.action {
        case .add: controller.addSlide(after: id)
        case .duplicate: controller.duplicateSlide(id)
        case .delete: controller.deleteSlide(id)
        }
    }

    // MARK: Drawing

    func drawSlideHeader(_ cg: CGContext, index: Int, selected: Bool) {
        let layout = slideHeaderLayout(index)
        layout.label.draw(at: layout.labelOrigin, withAttributes: [
            .font: Self.slideNumberFont,
            .foregroundColor: selected ? NSColor.controlAccentColor : NSColor.secondaryLabelColor,
        ])
        for (button, rect) in layout.buttons {
            let enabled = isEnabled(button)
            let hovered = enabled && button == hoverSlideButton
            if hovered {
                var pressed = false
                if case .slideButton(let held) = drag { pressed = held == button }
                cg.addPath(CGPath(roundedRect: rect, cornerWidth: 5, cornerHeight: 5, transform: nil))
                cg.setFillColor(NSColor.labelColor.withAlphaComponent(pressed ? 0.16 : 0.08).cgColor)
                cg.fillPath()
            }
            let color: NSColor = !enabled ? .tertiaryLabelColor
                : hovered ? (button.action == .delete ? .systemRed : .labelColor)
                : .secondaryLabelColor
            guard let symbol = Renderer.symbolImage(button.action.symbol, pointSize: 12) else { continue }
            // Symbol images are rendered at 2x.
            let w = CGFloat(symbol.width) / 2, h = CGFloat(symbol.height) / 2
            let iconRect = CGRect(x: (rect.midX - w / 2).rounded(), y: (rect.midY - h / 2).rounded(), width: w, height: h)
            Self.fillSymbol(symbol, in: iconRect, color: color.cgColor, cg: cg)
        }
    }

    /// Fills `rect` with `color` through an SF Symbol mask, upright in this flipped view.
    static func fillSymbol(_ symbol: CGImage, in rect: CGRect, color: CGColor, cg: CGContext) {
        cg.saveGState()
        cg.translateBy(x: 0, y: rect.minY + rect.maxY)
        cg.scaleBy(x: 1, y: -1)
        cg.clip(to: rect, mask: symbol)
        cg.setFillColor(color)
        cg.fill(rect)
        cg.restoreGState()
    }
}
