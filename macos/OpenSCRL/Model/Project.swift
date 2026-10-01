import Foundation
import CoreGraphics

// MARK: - Identifiers

enum UID {
    private static let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")

    /// Ten-character lowercase identifiers, matching the web app's nanoid alphabet.
    static func make() -> String {
        String((0..<10).map { _ in alphabet.randomElement()! })
    }
}

// MARK: - Canvas format

struct CanvasFormat: Codable, Hashable, Identifiable, Sendable {
    var name: String
    var width: Double
    var height: Double

    var id: String { "\(name)-\(Int(width))x\(Int(height))" }
    var size: CGSize { CGSize(width: width, height: height) }
    var aspectRatio: Double { width / max(1, height) }
    var dimensions: String { "\(Int(width)) × \(Int(height))" }

    static let presets: [CanvasFormat] = [
        .init(name: "IG Portrait", width: 1080, height: 1350),
        .init(name: "IG Square", width: 1080, height: 1080),
        .init(name: "IG Story / Reels", width: 1080, height: 1920),
        .init(name: "IG Landscape", width: 1080, height: 566),
        .init(name: "TikTok", width: 1080, height: 1920),
        .init(name: "Pinterest", width: 1000, height: 1500),
    ]

    static let `default` = presets[0]

    static func preset(named name: String) -> CanvasFormat? {
        presets.first { $0.name == name }
    }
}

// MARK: - Background

enum Background: Hashable, Sendable {
    case solid(String)
    case gradient(from: String, to: String, angle: Double)

    static let white = Background.solid("#ffffff")
}

extension Background: Codable {
    private enum CodingKeys: String, CodingKey { case kind, color, from, to, angle }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "solid"
        if kind == "gradient" {
            self = .gradient(
                from: try c.decodeIfPresent(String.self, forKey: .from) ?? "#ffffff",
                to: try c.decodeIfPresent(String.self, forKey: .to) ?? "#000000",
                angle: try c.decodeIfPresent(Double.self, forKey: .angle) ?? 135
            )
        } else {
            self = .solid(try c.decodeIfPresent(String.self, forKey: .color) ?? "#ffffff")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .solid(let color):
            try c.encode("solid", forKey: .kind)
            try c.encode(color, forKey: .color)
        case .gradient(let from, let to, let angle):
            try c.encode("gradient", forKey: .kind)
            try c.encode(from, forKey: .from)
            try c.encode(to, forKey: .to)
            try c.encode(angle, forKey: .angle)
        }
    }
}

// MARK: - Layers

enum TextAlignment: String, Codable, CaseIterable, Sendable {
    case left, center, right
}

enum ShapeKind: String, Codable, CaseIterable, Sendable {
    case rect, ellipse
}

struct ImageProperties: Hashable, Sendable {
    var assetID: String?
    var cornerRadius: Double = 0
    var cropOffsetX: Double = 0
    var cropOffsetY: Double = 0
    var cropScale: Double = 1
}

struct TextProperties: Hashable, Sendable {
    var text: String
    var fontFamily: String = FontCatalog.systemFamily
    var fontSize: Double = 96
    var fontWeight: Int = 700
    var italic: Bool = false
    var fill: String = "#111111"
    var align: TextAlignment = .center
    var letterSpacing: Double = 0
    var lineHeight: Double = 1.15
}

struct ShapeProperties: Hashable, Sendable {
    var shape: ShapeKind
    var fill: String = "#7c5cff"
    var stroke: String = "transparent"
    var strokeWidth: Double = 0
    var cornerRadius: Double = 0
}

struct Layer: Identifiable, Hashable, Sendable {
    enum Content: Hashable, Sendable {
        case image(ImageProperties)
        case text(TextProperties)
        case shape(ShapeProperties)
    }

    enum Kind: String, Sendable { case image, text, shape }

    var id: String
    var name: String
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var rotation: Double = 0
    var opacity: Double = 1
    var visible: Bool = true
    var locked: Bool = false
    var content: Content

    var kind: Kind {
        switch content {
        case .image: .image
        case .text: .text
        case .shape: .shape
        }
    }

    var frame: CGRect {
        get { CGRect(x: x, y: y, width: width, height: height) }
        set { x = newValue.minX; y = newValue.minY; width = newValue.width; height = newValue.height }
    }

    var image: ImageProperties? {
        get { if case .image(let p) = content { p } else { nil } }
        set { if let newValue, case .image = content { content = .image(newValue) } }
    }

    var text: TextProperties? {
        get { if case .text(let p) = content { p } else { nil } }
        set { if let newValue, case .text = content { content = .text(newValue) } }
    }

    var shape: ShapeProperties? {
        get { if case .shape(let p) = content { p } else { nil } }
        set { if let newValue, case .shape = content { content = .shape(newValue) } }
    }

    var isEmptyImageSlot: Bool {
        if case .image(let p) = content { return p.assetID == nil }
        return false
    }
}

// MARK: - Slides, media, project

struct Slide: Identifiable, Hashable, Sendable {
    var id: String
    var background: Background
    var layers: [Layer]

    static func blank() -> Slide { Slide(id: UID.make(), background: .white, layers: []) }
}

enum MediaKind: String, Codable, Sendable {
    /// A still photo.
    case image
    /// An animated image (GIF, animated PNG or WebP). Named "gif" for web compatibility.
    case gif
    case video

    var isAnimated: Bool { self != .image }
}

struct MediaAsset: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var name: String
    /// File name inside the project package's `Media` folder.
    var fileName: String
    var mime: String
    var contentType: String
    /// Pixel size after applying EXIF / track orientation.
    var width: Double
    var height: Double
    var size: Int
    var hash: String
    var mediaKind: MediaKind
    /// Seconds, for animated images and videos.
    var duration: Double

    var pixelSize: CGSize { CGSize(width: width, height: height) }
}

struct Project: Equatable, Sendable {
    var id: String
    var name: String
    var format: CanvasFormat
    var slides: [Slide]
    var assets: [MediaAsset]
    var createdAt: Date
    var updatedAt: Date

    init(format: CanvasFormat = .default, name: String = "Untitled") {
        let now = Date()
        id = UID.make()
        self.name = name
        self.format = format
        slides = [.blank()]
        assets = []
        createdAt = now
        updatedAt = now
    }

    /// Equality that ignores bookkeeping timestamps.
    func hasSameContent(as other: Project) -> Bool {
        format == other.format && slides == other.slides && assets == other.assets && name == other.name
    }
}

// MARK: - Lookup helpers

struct LayerLocation: Hashable {
    var slide: Int
    var index: Int
}

extension Project {
    var slideWidth: Double { format.width }
    var slideHeight: Double { format.height }
    var deckSize: CGSize { CGSize(width: format.width * Double(slides.count), height: format.height) }

    func slideIndex(of id: String?) -> Int? {
        guard let id else { return nil }
        return slides.firstIndex { $0.id == id }
    }

    func locate(layer id: String?) -> LayerLocation? {
        guard let id else { return nil }
        for (s, slide) in slides.enumerated() {
            if let i = slide.layers.firstIndex(where: { $0.id == id }) { return LayerLocation(slide: s, index: i) }
        }
        return nil
    }

    func layer(_ id: String?) -> Layer? {
        guard let loc = locate(layer: id) else { return nil }
        return slides[loc.slide].layers[loc.index]
    }

    mutating func updateLayer(_ id: String, _ body: (inout Layer) -> Void) {
        guard let loc = locate(layer: id) else { return }
        body(&slides[loc.slide].layers[loc.index])
    }

    func asset(_ id: String?) -> MediaAsset? {
        guard let id else { return nil }
        return assets.first { $0.id == id }
    }

    var assetsByID: [String: MediaAsset] {
        Dictionary(assets.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// The slide's rectangle in global deck coordinates.
    func viewport(ofSlide index: Int) -> CGRect {
        CGRect(x: Double(index) * format.width, y: 0, width: format.width, height: format.height)
    }

    /// Global (deck) frame of a layer, unrotated.
    func globalFrame(of layer: Layer, slide index: Int) -> CGRect {
        layer.frame.offsetBy(dx: Double(index) * format.width, dy: 0)
    }

    var usedAssetIDs: Set<String> {
        var ids = Set<String>()
        for slide in slides { for layer in slide.layers { if let id = layer.image?.assetID { ids.insert(id) } } }
        return ids
    }

    func references(toAsset id: String) -> Int {
        slides.reduce(0) { n, slide in n + slide.layers.filter { $0.image?.assetID == id }.count }
    }
}

// MARK: - Scene compilation

/// A visible layer placed in global deck coordinates. Layers may extend past their own slide,
/// which is how seamless carousels span several slides.
struct SceneItem: Hashable {
    var layer: Layer
    var slideIndex: Int
    var origin: CGPoint

    var globalFrame: CGRect { CGRect(origin: origin, size: CGSize(width: layer.width, height: layer.height)) }
}

extension Project {
    /// Every visible layer, in paint order, whose rotated bounds intersect `rect` (or all, when nil).
    func scene(intersecting rect: CGRect? = nil, includeHidden: Bool = false) -> [SceneItem] {
        var items: [SceneItem] = []
        for (s, slide) in slides.enumerated() {
            let dx = Double(s) * format.width
            for layer in slide.layers where includeHidden || layer.visible {
                let origin = CGPoint(x: layer.x + dx, y: layer.y)
                if let rect {
                    let bounds = Geometry.rotatedBounds(of: CGRect(origin: origin, size: CGSize(width: layer.width, height: layer.height)), degrees: layer.rotation)
                    if !bounds.intersects(rect) { continue }
                }
                items.append(SceneItem(layer: layer, slideIndex: s, origin: origin))
            }
        }
        return items
    }

    /// Indices of slides whose content is affected by a layer at `frame` (global coords).
    func slidesTouched(byGlobalBounds bounds: CGRect) -> [Int] {
        guard format.width > 0 else { return [] }
        let first = max(0, Int(floor(bounds.minX / format.width)))
        let last = min(slides.count - 1, Int(floor((bounds.maxX - 0.0001) / format.width)))
        return first <= last ? Array(first...last) : []
    }
}
