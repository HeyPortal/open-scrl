import Foundation
import CoreText
import CoreGraphics

/// Lays out text like the web app's Konva text: fixed width, word wrapping, explicit paragraph
/// breaks, and a line box of `fontSize × lineHeight` with glyphs vertically centered in each line.
final class TextLayout: @unchecked Sendable {
    struct Line {
        var line: CTLine
        var width: CGFloat
        var ascent: CGFloat
        var descent: CGFloat
    }

    let lines: [Line]
    let lineStep: CGFloat
    let width: CGFloat
    let align: TextAlignment

    var height: CGFloat { max(lineStep, CGFloat(lines.count) * lineStep) }

    private init(lines: [Line], lineStep: CGFloat, width: CGFloat, align: TextAlignment) {
        self.lines = lines
        self.lineStep = lineStep
        self.width = width
        self.align = align
    }

    private static let cache: NSCache<NSString, TextLayout> = {
        let cache = NSCache<NSString, TextLayout>()
        cache.countLimit = 400
        return cache
    }()

    static func make(_ props: TextProperties, width: CGFloat) -> TextLayout {
        let key = "\(props.text)|\(props.fontFamily)|\(props.fontSize)|\(props.fontWeight)|\(props.italic)|\(props.fill)|\(props.align)|\(props.letterSpacing)|\(props.lineHeight)|\(width)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        let layout = build(props, width: width)
        cache.setObject(layout, forKey: key)
        return layout
    }

    private static func build(_ props: TextProperties, width: CGFloat) -> TextLayout {
        let font = FontResolver.font(family: props.fontFamily, weight: props.fontWeight, italic: props.italic, size: props.fontSize)
        let attributes: [CFString: Any] = [
            kCTFontAttributeName: font,
            kCTForegroundColorAttributeName: HexColor.cgColor(props.fill),
            kCTKernAttributeName: props.letterSpacing,
        ]
        var lines: [Line] = []
        let wrapWidth = max(1, width)
        for paragraph in props.text.components(separatedBy: "\n") {
            let attributed = CFAttributedStringCreate(nil, paragraph as CFString, attributes as CFDictionary)!
            let length = CFAttributedStringGetLength(attributed)
            if length == 0 {
                let empty = CTLineCreateWithAttributedString(attributed)
                lines.append(Line(line: empty, width: 0, ascent: CTFontGetAscent(font), descent: CTFontGetDescent(font)))
                continue
            }
            let typesetter = CTTypesetterCreateWithAttributedString(attributed)
            var start = 0
            while start < length {
                var count = CTTypesetterSuggestLineBreak(typesetter, start, wrapWidth)
                if count <= 0 { count = 1 }
                let line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: count))
                var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
                let total = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
                let trailing = CGFloat(CTLineGetTrailingWhitespaceWidth(line))
                // Kerning adds space after the final glyph; exclude it so alignment matches the web.
                let visible = max(0, total - trailing - (props.letterSpacing > 0 ? props.letterSpacing : 0))
                lines.append(Line(line: line, width: visible, ascent: ascent, descent: descent))
                start += count
            }
        }
        if lines.isEmpty {
            let empty = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, "" as CFString, attributes as CFDictionary)!)
            lines.append(Line(line: empty, width: 0, ascent: CTFontGetAscent(font), descent: CTFontGetDescent(font)))
        }
        return TextLayout(lines: lines, lineStep: props.fontSize * props.lineHeight, width: width, align: props.align)
    }

    /// Draws into a y-down context with the text box's top-left at the origin.
    func draw(in cg: CGContext) {
        cg.saveGState()
        cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        for (i, item) in lines.enumerated() {
            let x: CGFloat = switch align {
            case .left: 0
            case .center: (width - item.width) / 2
            case .right: width - item.width
            }
            let top = CGFloat(i) * lineStep
            let baseline = top + (lineStep - (item.ascent + item.descent)) / 2 + item.ascent
            cg.textPosition = CGPoint(x: x, y: baseline)
            CTLineDraw(item.line, cg)
        }
        cg.restoreGState()
    }

    static func measuredHeight(_ props: TextProperties, width: CGFloat) -> CGFloat {
        make(props, width: width).height
    }
}
