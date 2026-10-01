import AppKit
import SwiftUI

/// Colors are stored as CSS-style hex strings (`#rrggbb`, `#rrggbbaa`, or `transparent`)
/// so project files stay compatible with the web app.
enum HexColor {
    static let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

    static func components(_ hex: String) -> (r: Double, g: Double, b: Double, a: Double)? {
        var s = hex.trimmingCharacters(in: .whitespaces).lowercased()
        if s == "transparent" || s.isEmpty { return (0, 0, 0, 0) }
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 || s.count == 4 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6 || s.count == 8, let value = UInt64(s, radix: 16) else { return nil }
        if s.count == 6 {
            return (Double((value >> 16) & 0xff) / 255, Double((value >> 8) & 0xff) / 255, Double(value & 0xff) / 255, 1)
        }
        return (Double((value >> 24) & 0xff) / 255, Double((value >> 16) & 0xff) / 255, Double((value >> 8) & 0xff) / 255, Double(value & 0xff) / 255)
    }

    static func cgColor(_ hex: String, fallback: CGColor = CGColor(gray: 0, alpha: 1)) -> CGColor {
        guard let c = components(hex) else { return fallback }
        return CGColor(colorSpace: srgb, components: [c.r, c.g, c.b, c.a]) ?? fallback
    }

    static func isTransparent(_ hex: String) -> Bool { (components(hex)?.a ?? 1) == 0 }

    static func string(from nsColor: NSColor) -> String {
        guard let c = nsColor.usingColorSpace(.sRGB) else { return "#000000" }
        func byte(_ v: CGFloat) -> Int { Int((min(1, max(0, v)) * 255).rounded()) }
        let rgb = String(format: "#%02x%02x%02x", byte(c.redComponent), byte(c.greenComponent), byte(c.blueComponent))
        return c.alphaComponent < 0.999 ? rgb + String(format: "%02x", byte(c.alphaComponent)) : rgb
    }

    static func string(from color: Color) -> String { string(from: NSColor(color)) }

    static func color(_ hex: String) -> Color { Color(cgColor: cgColor(hex)) }

    /// Relative luminance, used to pick legible overlay text.
    static func luminance(_ hex: String) -> Double {
        guard let c = components(hex) else { return 1 }
        return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    }
}

extension Binding where Value == String {
    /// Bridges a hex string binding to SwiftUI's `ColorPicker`.
    func hexColor() -> Binding<Color> {
        Binding<Color>(get: { HexColor.color(wrappedValue) }, set: { wrappedValue = HexColor.string(from: $0) })
    }
}
