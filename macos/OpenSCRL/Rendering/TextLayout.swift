import Foundation
import CoreText
import CoreGraphics

/// Lays out text like the web app's painter: fixed width, word wrapping, explicit paragraph
/// breaks, and a line box of `fontSize × lineHeight` with glyphs vertically centered in each line.
/// Shrink-to-fit text picks the largest size that fits the box and is centered vertically.
final class TextLayout: @unchecked Sendable {
    struct Line {
        var line: CTLine
        /// Visible width, excluding trailing whitespace and the final glyph's kerning.
        var width: CGFloat
        var ascent: CGFloat
        var descent: CGFloat
        /// Left edge after alignment.
        var x: CGFloat = 0
        /// Top of the line box.
        var top: CGFloat = 0
        var isBlank: Bool
    }

    let lines: [Line]
    let lineStep: CGFloat
    let width: CGFloat
    /// The size actually used; smaller than `fontSize` when shrink-to-fit is on.
    let fontSize: CGFloat

    /// Height of the laid-out lines (at least one line).
    var height: CGFloat { max(lineStep, CGFloat(lines.count) * lineStep) }

    private init(lines: [Line], lineStep: CGFloat, width: CGFloat, fontSize: CGFloat) {
        self.lines = lines
        self.lineStep = lineStep
        self.width = width
        self.fontSize = fontSize
    }

    private static let cache: NSCache<NSString, TextLayout> = {
        let cache = NSCache<NSString, TextLayout>()
        cache.countLimit = 400
        return cache
    }()

    private static let minimumFitSize: CGFloat = 4

    /// `height` is the text box's height; it only matters for shrink-to-fit text.
    static func make(_ props: TextProperties, width: CGFloat, height: CGFloat? = nil) -> TextLayout {
        let fitHeight = props.autoFit ? height : nil
        let key = "\(props.text)|\(props.fontFamily)|\(props.fontSize)|\(props.fontWeight)|\(props.italic)|\(props.align)|\(props.letterSpacing)|\(props.lineHeight)|\(width)|\(fitHeight.map { "\($0)" } ?? "-")" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        let layout: TextLayout
        if let fitHeight {
            let size = fittingSize(props, width: width, height: fitHeight)
            let built = build(props, width: width, size: size).layout
            let offset = max(0, (fitHeight - CGFloat(built.lines.count) * built.lineStep) / 2)
            layout = built.offset(by: offset)
        } else {
            layout = build(props, width: width, size: props.fontSize).layout
        }
        cache.setObject(layout, forKey: key)
        return layout
    }

    static func measuredHeight(_ props: TextProperties, width: CGFloat) -> CGFloat {
        var unfitted = props
        unfitted.autoFit = false
        return make(unfitted, width: width).height
    }

    /// The largest size ≤ `fontSize` whose lines all fit `width` without breaking a word and
    /// whose total height fits `height`.
    private static func fittingSize(_ props: TextProperties, width: CGFloat, height: CGFloat) -> CGFloat {
        func fits(_ size: CGFloat) -> Bool {
            let result = build(props, width: width, size: size)
            return !result.brokeWord && CGFloat(result.layout.lines.count) * result.layout.lineStep <= height + 0.5
        }
        if fits(props.fontSize) { return props.fontSize }
        var lo = minimumFitSize, hi = CGFloat(props.fontSize)
        for _ in 0..<12 where hi - lo > 0.25 {
            let mid = (lo + hi) / 2
            if fits(mid) { lo = mid } else { hi = mid }
        }
        return (lo * 4).rounded(.down) / 4
    }

    private static func build(_ props: TextProperties, width: CGFloat, size: CGFloat) -> (layout: TextLayout, brokeWord: Bool) {
        let font = FontResolver.font(family: props.fontFamily, weight: props.fontWeight, italic: props.italic, size: size)
        let kern = props.letterSpacing * size / max(1, props.fontSize)
        let attributes: [CFString: Any] = [
            kCTFontAttributeName: font,
            kCTForegroundColorFromContextAttributeName: true,
            kCTKernAttributeName: kern,
        ]
        var lines: [Line] = []
        var brokeWord = false
        let wrapWidth = max(1, width)
        for paragraph in props.text.components(separatedBy: "\n") {
            let attributed = CFAttributedStringCreate(nil, paragraph as CFString, attributes as CFDictionary)!
            let length = CFAttributedStringGetLength(attributed)
            if length == 0 {
                let empty = CTLineCreateWithAttributedString(attributed)
                lines.append(Line(line: empty, width: 0, ascent: CTFontGetAscent(font), descent: CTFontGetDescent(font), isBlank: true))
                continue
            }
            let utf16 = Array(paragraph.utf16)
            let isSpace = { (unit: UInt16) in unit == 32 || unit == 9 || unit == 0xA0 }
            let typesetter = CTTypesetterCreateWithAttributedString(attributed)
            var start = 0
            while start < length {
                var count = CTTypesetterSuggestLineBreak(typesetter, start, wrapWidth)
                if count <= 0 { count = 1 }
                let end = start + count
                if end < length, end > 0, !isSpace(utf16[end - 1]), !isSpace(utf16[end]) { brokeWord = true }
                let line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: count))
                var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
                let total = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
                let trailing = CGFloat(CTLineGetTrailingWhitespaceWidth(line))
                // Kerning adds space after the final glyph; exclude it so alignment matches the web.
                let visible = max(0, total - trailing - (kern > 0 ? kern : 0))
                let blank = utf16[start..<min(end, utf16.count)].allSatisfy(isSpace)
                lines.append(Line(line: line, width: visible, ascent: ascent, descent: descent, isBlank: blank))
                start = end
            }
        }
        if lines.isEmpty {
            let empty = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, "" as CFString, attributes as CFDictionary)!)
            lines.append(Line(line: empty, width: 0, ascent: CTFontGetAscent(font), descent: CTFontGetDescent(font), isBlank: true))
        }
        let lineStep = size * props.lineHeight
        for i in lines.indices {
            lines[i].top = CGFloat(i) * lineStep
            lines[i].x = switch props.align {
            case .left: 0
            case .center: (width - lines[i].width) / 2
            case .right: width - lines[i].width
            }
        }
        return (TextLayout(lines: lines, lineStep: lineStep, width: width, fontSize: size), brokeWord)
    }

    private func offset(by dy: CGFloat) -> TextLayout {
        guard dy != 0 else { return self }
        return TextLayout(lines: lines.map { var l = $0; l.top += dy; return l }, lineStep: lineStep, width: width, fontSize: fontSize)
    }

    private func baseline(_ line: Line) -> CGFloat {
        line.top + (lineStep - (line.ascent + line.descent)) / 2 + line.ascent
    }

    /// The highlight behind the text, as one path filled once so translucent colors don't darken
    /// where boxes overlap. Per-line boxes overlap their neighbors by the corner radius so rounded
    /// corners don't leave notches where lines meet.
    func highlightPath(_ highlight: TextHighlight) -> CGPath {
        let path = CGMutablePath()
        let pad = highlight.padding, outer = highlight.padding / 2
        let visible = lines.filter { !$0.isBlank }
        guard let first = visible.first, let last = visible.last else { return path }
        func addBox(_ rect: CGRect) {
            let r = max(0, min(highlight.radius, rect.width / 2, rect.height / 2))
            path.addPath(r > 0 ? CGPath(roundedRect: rect, cornerWidth: r, cornerHeight: r, transform: nil) : CGPath(rect: rect, transform: nil))
        }
        if highlight.style == .box {
            let left = visible.map(\.x).min()! - pad
            let right = visible.map { $0.x + $0.width }.max()! + pad
            let top = first.top - outer, bottom = last.top + lineStep + outer
            addBox(CGRect(x: left, y: top, width: right - left, height: bottom - top))
            return path
        }
        for (i, line) in lines.enumerated() where !line.isBlank {
            let above = i > 0 && !lines[i - 1].isBlank
            let below = i + 1 < lines.count && !lines[i + 1].isBlank
            let top = line.top - (above ? highlight.radius : outer)
            let bottom = line.top + lineStep + (below ? highlight.radius : outer)
            addBox(CGRect(x: line.x - pad, y: top, width: line.width + pad * 2, height: bottom - top))
        }
        return path
    }

    private func drawLines(in cg: CGContext) {
        for line in lines where !line.isBlank {
            cg.textPosition = CGPoint(x: line.x, y: baseline(line))
            CTLineDraw(line.line, cg)
        }
    }

    /// Every glyph's outline in layer coordinates (y-down).
    func glyphOutlines() -> CGPath {
        let path = CGMutablePath()
        for line in lines where !line.isBlank {
            let base = baseline(line)
            for run in CTLineGetGlyphRuns(line.line) as? [CTRun] ?? [] {
                let count = CTRunGetGlyphCount(run)
                guard count > 0 else { continue }
                let attributes = CTRunGetAttributes(run) as NSDictionary
                guard let value = attributes[kCTFontAttributeName], CFGetTypeID(value as CFTypeRef) == CTFontGetTypeID() else { continue }
                let font = value as! CTFont
                var glyphs = [CGGlyph](repeating: 0, count: count)
                var positions = [CGPoint](repeating: .zero, count: count)
                CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
                CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
                for i in 0..<count {
                    var transform = CGAffineTransform(translationX: line.x + positions[i].x, y: base - positions[i].y).scaledBy(x: 1, y: -1)
                    if let glyph = CTFontCreatePathForGlyph(font, glyphs[i], &transform) { path.addPath(glyph) }
                }
            }
        }
        return path
    }

    /// Draws into a y-down context with the text box's top-left at the origin: highlight, then
    /// outline, then the solid or gradient fill.
    func draw(_ props: TextProperties, box: CGSize, in cg: CGContext) {
        cg.saveGState()
        if let highlight = props.highlight, !HexColor.isTransparent(highlight.color) {
            cg.addPath(highlightPath(highlight))
            cg.setFillColor(HexColor.cgColor(highlight.color))
            cg.fillPath()
        }
        cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        if props.strokeWidth > 0, !HexColor.isTransparent(props.stroke) {
            cg.setTextDrawingMode(.stroke)
            cg.setStrokeColor(HexColor.cgColor(props.stroke))
            cg.setLineWidth(props.strokeWidth * 2)
            cg.setLineJoin(.round)
            cg.setMiterLimit(2)
            drawLines(in: cg)
        }
        if let gradient = props.fillGradient, gradient.stops.count >= 2 {
            // Core Text ignores the clip text mode, so clip to the glyph outlines directly.
            cg.saveGState()
            cg.addPath(glyphOutlines())
            cg.clip()
            Renderer.drawGradient(gradient, in: CGRect(origin: .zero, size: box), cg: cg)
            cg.restoreGState()
        } else {
            cg.setTextDrawingMode(.fill)
            cg.setFillColor(HexColor.cgColor(props.fill))
            drawLines(in: cg)
        }
        cg.restoreGState()
    }
}
