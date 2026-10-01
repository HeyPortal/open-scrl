import Foundation

/// On-disk JSON, compatible with the web app's `ProjectDocumentV2` schema
/// (normalized slides and layers). The `assets` list is a native extension that
/// describes the media stored in the package's `Media` folder.
struct ProjectFile: Codable {
    struct SlideRecord: Codable {
        var id: String
        var background: Background
        var layerOrder: [String]
    }

    var schemaVersion: Int
    var revision: Int
    var id: String
    var name: String
    var format: CanvasFormat
    var slideOrder: [String]
    var slides: [String: SlideRecord]
    var layers: [String: Layer]
    var createdAt: Double
    var updatedAt: Double
    var assets: [MediaAsset]?
    var generator: String?

    static let currentSchemaVersion = 2

    enum DecodeError: LocalizedError {
        case unsupportedVersion(Int)
        var errorDescription: String? {
            switch self {
            case .unsupportedVersion(let v): "This project uses unsupported schema version \(v)."
            }
        }
    }

    init(project: Project, revision: Int = 0) {
        schemaVersion = Self.currentSchemaVersion
        self.revision = revision
        id = project.id
        name = project.name
        format = project.format
        slideOrder = project.slides.map(\.id)
        var slideRecords: [String: SlideRecord] = [:]
        var layerRecords: [String: Layer] = [:]
        for slide in project.slides {
            slideRecords[slide.id] = SlideRecord(id: slide.id, background: slide.background, layerOrder: slide.layers.map(\.id))
            for layer in slide.layers { layerRecords[layer.id] = layer }
        }
        slides = slideRecords
        layers = layerRecords
        createdAt = project.createdAt.timeIntervalSince1970 * 1000
        updatedAt = project.updatedAt.timeIntervalSince1970 * 1000
        assets = project.assets
        generator = "Open-SCRL for Mac"
    }

    func makeProject() throws -> Project {
        guard schemaVersion == Self.currentSchemaVersion else { throw DecodeError.unsupportedVersion(schemaVersion) }
        var project = Project(format: format, name: name)
        project.id = id
        project.slides = slideOrder.compactMap { slideID in
            guard let record = slides[slideID] else { return nil }
            return Slide(id: record.id, background: record.background, layers: record.layerOrder.compactMap { layers[$0] })
        }
        if project.slides.isEmpty { project.slides = [.blank()] }
        project.assets = assets ?? []
        project.createdAt = Date(timeIntervalSince1970: createdAt / 1000)
        project.updatedAt = Date(timeIntervalSince1970: updatedAt / 1000)
        return project
    }

    static func decode(_ data: Data) throws -> ProjectFile {
        try JSONDecoder().decode(ProjectFile.self, from: data)
    }

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
}

// MARK: - Layer coding (flat, like the web schema)

extension Layer: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, kind, name, x, y, width, height, rotation, opacity, visible, locked
        case assetId, cornerRadius, cropOffsetX, cropOffsetY, cropScale
        case text, fontFamily, fontSize, fontWeight, italic, fill, align, letterSpacing, lineHeight
        case shape, stroke, strokeWidth
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func num(_ key: CodingKeys, _ fallback: Double) throws -> Double {
            (try? c.decodeIfPresent(Double.self, forKey: key)) ?? fallback
        }
        id = try c.decode(String.self, forKey: .id)
        let kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "shape"
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? kind.capitalized
        x = try num(.x, 0)
        y = try num(.y, 0)
        width = max(1, try num(.width, 100))
        height = max(1, try num(.height, 100))
        rotation = try num(.rotation, 0)
        opacity = min(1, max(0, try num(.opacity, 1)))
        visible = try c.decodeIfPresent(Bool.self, forKey: .visible) ?? true
        locked = try c.decodeIfPresent(Bool.self, forKey: .locked) ?? false
        switch kind {
        case "image":
            content = .image(ImageProperties(
                assetID: try c.decodeIfPresent(String.self, forKey: .assetId),
                cornerRadius: try num(.cornerRadius, 0),
                cropOffsetX: try num(.cropOffsetX, 0),
                cropOffsetY: try num(.cropOffsetY, 0),
                cropScale: max(1, try num(.cropScale, 1))
            ))
        case "text":
            let numericWeight = try num(.fontWeight, 400)
            let weight = (try? c.decodeIfPresent(Int.self, forKey: .fontWeight)) ?? Int(numericWeight)
            content = .text(TextProperties(
                text: try c.decodeIfPresent(String.self, forKey: .text) ?? "",
                fontFamily: try c.decodeIfPresent(String.self, forKey: .fontFamily) ?? FontCatalog.systemFamily,
                fontSize: try num(.fontSize, 48),
                fontWeight: weight,
                italic: try c.decodeIfPresent(Bool.self, forKey: .italic) ?? false,
                fill: try c.decodeIfPresent(String.self, forKey: .fill) ?? "#111111",
                align: TextAlignment(rawValue: try c.decodeIfPresent(String.self, forKey: .align) ?? "left") ?? .left,
                letterSpacing: try num(.letterSpacing, 0),
                lineHeight: try num(.lineHeight, 1.15)
            ))
        default:
            content = .shape(ShapeProperties(
                shape: ShapeKind(rawValue: try c.decodeIfPresent(String.self, forKey: .shape) ?? "rect") ?? .rect,
                fill: try c.decodeIfPresent(String.self, forKey: .fill) ?? "#7c5cff",
                stroke: try c.decodeIfPresent(String.self, forKey: .stroke) ?? "transparent",
                strokeWidth: try num(.strokeWidth, 0),
                cornerRadius: try num(.cornerRadius, 0)
            ))
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(kind.rawValue, forKey: .kind)
        try c.encode(name, forKey: .name)
        try c.encode(x, forKey: .x)
        try c.encode(y, forKey: .y)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
        try c.encode(rotation, forKey: .rotation)
        try c.encode(opacity, forKey: .opacity)
        try c.encode(visible, forKey: .visible)
        try c.encode(locked, forKey: .locked)
        switch content {
        case .image(let p):
            try c.encode(p.assetID, forKey: .assetId)
            try c.encode(p.cornerRadius, forKey: .cornerRadius)
            try c.encode(p.cropOffsetX, forKey: .cropOffsetX)
            try c.encode(p.cropOffsetY, forKey: .cropOffsetY)
            try c.encode(p.cropScale, forKey: .cropScale)
        case .text(let p):
            try c.encode(p.text, forKey: .text)
            try c.encode(p.fontFamily, forKey: .fontFamily)
            try c.encode(p.fontSize, forKey: .fontSize)
            try c.encode(p.fontWeight, forKey: .fontWeight)
            try c.encode(p.italic, forKey: .italic)
            try c.encode(p.fill, forKey: .fill)
            try c.encode(p.align.rawValue, forKey: .align)
            try c.encode(p.letterSpacing, forKey: .letterSpacing)
            try c.encode(p.lineHeight, forKey: .lineHeight)
        case .shape(let p):
            try c.encode(p.shape.rawValue, forKey: .shape)
            try c.encode(p.fill, forKey: .fill)
            try c.encode(p.stroke, forKey: .stroke)
            try c.encode(p.strokeWidth, forKey: .strokeWidth)
            try c.encode(p.cornerRadius, forKey: .cornerRadius)
        }
    }
}
