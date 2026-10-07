import Foundation
import CoreGraphics

enum Swatches {
    static let solids = [
        "#ffffff", "#f5f4f0", "#fde68a", "#fca5a5", "#fb7185", "#a78bfa",
        "#7c5cff", "#60a5fa", "#34d399", "#111827", "#000000",
    ]

    static let gradients: [Background] = [
        .gradient(from: "#fde68a", to: "#fb7185", angle: 135),
        .gradient(from: "#a78bfa", to: "#7c5cff", angle: 135),
        .gradient(from: "#60a5fa", to: "#34d399", angle: 135),
        .gradient(from: "#fca5a5", to: "#a78bfa", angle: 90),
        .gradient(from: "#111827", to: "#7c5cff", angle: 45),
        .gradient(from: "#f5f4f0", to: "#cbd5e1", angle: 180),
    ]

    /// Swatches shown in the slide inspector: five solids and three gradients.
    static var quick: [Background] {
        solids.prefix(5).map { Background.solid($0) } + gradients.prefix(3)
    }

    static func same(_ a: Background?, _ b: Background) -> Bool {
        switch (a, b) {
        case (.solid(let x)?, .solid(let y)): x.lowercased() == y.lowercased()
        case (.gradient(let x)?, .gradient(let y)):
            x.type == y.type && x.angle == y.angle && x.stops.count == y.stops.count
                && zip(x.sortedStops, y.sortedStops).allSatisfy { $0.offset == $1.offset && $0.color.lowercased() == $1.color.lowercased() }
        case (.image(let x)?, .image(let y)): x == y
        case (.transparent?, .transparent): true
        default: false
        }
    }
}

struct TextPreset: Identifiable, Sendable {
    var name: String
    var text: String
    var size: Double
    var weight: Int
    var id: String { name }

    static let all: [TextPreset] = [
        .init(name: "Big headline", text: "BIG IDEA", size: 200, weight: 800),
        .init(name: "Headline", text: "Your headline", size: 120, weight: 700),
        .init(name: "Subheading", text: "A subheading", size: 64, weight: 500),
        .init(name: "Body", text: "Body text\non multiple lines", size: 36, weight: 400),
        .init(name: "Caption", text: "caption · 2026", size: 24, weight: 400),
    ]
}

struct ShapePreset: Identifiable, Sendable {
    var name: String
    var shape: ShapeKind
    var symbol: String
    /// Preview size in points and corner radius.
    var preview: CGSize
    var previewRadius: Double
    var tinted: Bool
    var make: @Sendable (CanvasFormat) -> (frame: CGRect, props: ShapeProperties)

    var id: String { name }

    static let all: [ShapePreset] = [
        ShapePreset(name: "Rectangle", shape: .rect, symbol: "rectangle.fill", preview: CGSize(width: 44, height: 32), previewRadius: 4, tinted: true) { f in
            let w = f.width * 0.4, h = f.height * 0.3
            return (CGRect(x: (f.width - w) / 2, y: (f.height - h) / 2, width: w, height: h), ShapeProperties(shape: .rect, cornerRadius: 24))
        },
        ShapePreset(name: "Ellipse", shape: .ellipse, symbol: "oval.fill", preview: CGSize(width: 44, height: 32), previewRadius: 999, tinted: true) { f in
            let w = f.width * 0.4, h = f.height * 0.3
            return (CGRect(x: (f.width - w) / 2, y: (f.height - h) / 2, width: w, height: h), ShapeProperties(shape: .ellipse))
        },
        ShapePreset(name: "Rounded", shape: .rect, symbol: "app.fill", preview: CGSize(width: 40, height: 40), previewRadius: 12, tinted: true) { f in
            let s = f.width * 0.5
            return (CGRect(x: (f.width - s) / 2, y: (f.height - s) / 2, width: s, height: s), ShapeProperties(shape: .rect, cornerRadius: s / 5))
        },
        ShapePreset(name: "Circle", shape: .ellipse, symbol: "circle.fill", preview: CGSize(width: 40, height: 40), previewRadius: 999, tinted: true) { f in
            let s = f.width * 0.5
            return (CGRect(x: (f.width - s) / 2, y: (f.height - s) / 2, width: s, height: s), ShapeProperties(shape: .ellipse))
        },
        ShapePreset(name: "Banner", shape: .rect, symbol: "rectangle.bottomhalf.filled", preview: CGSize(width: 52, height: 14), previewRadius: 2, tinted: false) { f in
            (CGRect(x: 0, y: f.height * 0.78, width: f.width, height: f.height * 0.16), ShapeProperties(shape: .rect, fill: "#111827"))
        },
        ShapePreset(name: "Divider", shape: .rect, symbol: "minus", preview: CGSize(width: 52, height: 4), previewRadius: 2, tinted: false) { f in
            (CGRect(x: f.width * 0.2, y: f.height / 2 - 6, width: f.width * 0.6, height: 12), ShapeProperties(shape: .rect, fill: "#111827", cornerRadius: 6))
        },
    ]
}

/// Focal points for photo crops, as offsets within the crop slack.
struct FocalPoint: Identifiable, Hashable, Sendable {
    var label: String
    var x: Double
    var y: Double
    var id: String { label }

    static let all: [FocalPoint] = [
        .init(label: "Top Left", x: -0.5, y: -0.5), .init(label: "Top", x: 0, y: -0.5), .init(label: "Top Right", x: 0.5, y: -0.5),
        .init(label: "Left", x: -0.5, y: 0), .init(label: "Center", x: 0, y: 0), .init(label: "Right", x: 0.5, y: 0),
        .init(label: "Bottom Left", x: -0.5, y: 0.5), .init(label: "Bottom", x: 0, y: 0.5), .init(label: "Bottom Right", x: 0.5, y: 0.5),
    ]
}
