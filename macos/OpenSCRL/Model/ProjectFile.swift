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

// MARK: - Fill and effect coding

/// Decoding is lenient so projects from either app, or from older versions, always open.
private extension KeyedDecodingContainer {
    func number(_ key: Key, _ fallback: Double) -> Double {
        (try? decodeIfPresent(Double.self, forKey: key)) ?? fallback
    }

    func string(_ key: Key, _ fallback: String) -> String {
        (try? decodeIfPresent(String.self, forKey: key)) ?? fallback
    }
}

extension GradientStop: Codable {
    private enum CodingKeys: String, CodingKey { case offset, color }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(offset: min(1, max(0, c.number(.offset, 0))), color: c.string(.color, "#000000"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(offset, forKey: .offset)
        try c.encode(color, forKey: .color)
    }
}

extension Gradient: Codable {
    private enum CodingKeys: String, CodingKey { case type, angle, stops }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let stops = ((try? c.decodeIfPresent([GradientStop].self, forKey: .stops)) ?? []).sorted { $0.offset < $1.offset }
        self.init(type: Kind(rawValue: c.string(.type, "linear")) ?? .linear,
                  angle: c.number(.angle, 135),
                  stops: stops.count >= 2 ? stops : [GradientStop(offset: 0, color: "#ffffff"), GradientStop(offset: 1, color: "#000000")])
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type.rawValue, forKey: .type)
        try c.encode(angle, forKey: .angle)
        try c.encode(sortedStops, forKey: .stops)
    }
}

extension Shadow: Codable {
    private enum CodingKeys: String, CodingKey { case color, opacity, blur, offsetX, offsetY }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(color: c.string(.color, "#000000"), opacity: min(1, max(0, c.number(.opacity, 0.35))),
                  blur: max(0, c.number(.blur, 24)), offsetX: c.number(.offsetX, 0), offsetY: c.number(.offsetY, 12))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(color, forKey: .color)
        try c.encode(opacity, forKey: .opacity)
        try c.encode(blur, forKey: .blur)
        try c.encode(offsetX, forKey: .offsetX)
        try c.encode(offsetY, forKey: .offsetY)
    }
}

extension TextHighlight: Codable {
    private enum CodingKeys: String, CodingKey { case style, color, padding, radius }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(style: Style(rawValue: c.string(.style, "lines")) ?? .lines, color: c.string(.color, "#ffffff"),
                  padding: max(0, c.number(.padding, 16)), radius: max(0, c.number(.radius, 12)))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(style.rawValue, forKey: .style)
        try c.encode(color, forKey: .color)
        try c.encode(padding, forKey: .padding)
        try c.encode(radius, forKey: .radius)
    }
}

extension Background: Codable {
    private enum CodingKeys: String, CodingKey { case kind, color, from, to, angle, type, stops, assetId, blur, dim }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch c.string(.kind, "solid") {
        case "gradient":
            let from = c.string(.from, "#ffffff"), to = c.string(.to, "#000000")
            let stops = ((try? c.decodeIfPresent([GradientStop].self, forKey: .stops)) ?? []).sorted { $0.offset < $1.offset }
            self = .gradient(Gradient(type: Gradient.Kind(rawValue: c.string(.type, "linear")) ?? .linear,
                                      angle: c.number(.angle, 135),
                                      stops: stops.count >= 2 ? stops : [GradientStop(offset: 0, color: from), GradientStop(offset: 1, color: to)]))
        case "image":
            self = .image(BackgroundImage(assetID: try? c.decodeIfPresent(String.self, forKey: .assetId),
                                          blur: max(0, c.number(.blur, 0)), dim: min(1, max(0, c.number(.dim, 0))),
                                          color: c.string(.color, "#111111")))
        case "transparent":
            self = .transparent
        default:
            self = .solid(c.string(.color, "#ffffff"))
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .solid(let color):
            try c.encode("solid", forKey: .kind)
            try c.encode(color, forKey: .color)
        case .gradient(let gradient):
            // `from` and `to` keep two-color gradients readable by older versions.
            try c.encode("gradient", forKey: .kind)
            try c.encode(gradient.firstColor, forKey: .from)
            try c.encode(gradient.lastColor, forKey: .to)
            try c.encode(gradient.angle, forKey: .angle)
            try c.encode(gradient.type.rawValue, forKey: .type)
            try c.encode(gradient.sortedStops, forKey: .stops)
        case .image(let image):
            try c.encode("image", forKey: .kind)
            try c.encode(image.assetID, forKey: .assetId)
            try c.encode(image.blur, forKey: .blur)
            try c.encode(image.dim, forKey: .dim)
            try c.encode(image.color, forKey: .color)
        case .transparent:
            try c.encode("transparent", forKey: .kind)
        }
    }
}

// MARK: - Layer coding (flat, like the web schema)

extension Layer: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, kind, name, x, y, width, height, rotation, opacity, visible, locked, groupId, shadow
        case assetId, cornerRadius, cropOffsetX, cropOffsetY, cropScale, mask, seamBlend
        case text, fontFamily, fontSize, fontWeight, italic, fill, align, letterSpacing, lineHeight
        case fillGradient, highlight, autoFit
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
        groupID = (try? c.decodeIfPresent(String.self, forKey: .groupId)) ?? nil
        shadow = (try? c.decodeIfPresent(Shadow.self, forKey: .shadow)) ?? nil
        switch kind {
        case "image":
            content = .image(ImageProperties(
                assetID: try c.decodeIfPresent(String.self, forKey: .assetId),
                cornerRadius: try num(.cornerRadius, 0),
                cropOffsetX: try num(.cropOffsetX, 0),
                cropOffsetY: try num(.cropOffsetY, 0),
                cropScale: max(1, try num(.cropScale, 1)),
                mask: ImageMask(rawValue: (try? c.decodeIfPresent(String.self, forKey: .mask)) ?? "rect") ?? .rect,
                stroke: (try? c.decodeIfPresent(String.self, forKey: .stroke)) ?? "#ffffff",
                strokeWidth: max(0, try num(.strokeWidth, 0)),
                seamBlend: try c.decodeIfPresent(SeamBlend.self, forKey: .seamBlend)?.sanitized
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
                lineHeight: try num(.lineHeight, 1.15),
                stroke: (try? c.decodeIfPresent(String.self, forKey: .stroke)) ?? "#000000",
                strokeWidth: max(0, try num(.strokeWidth, 0)),
                fillGradient: (try? c.decodeIfPresent(Gradient.self, forKey: .fillGradient)) ?? nil,
                highlight: (try? c.decodeIfPresent(TextHighlight.self, forKey: .highlight)) ?? nil,
                autoFit: (try? c.decodeIfPresent(Bool.self, forKey: .autoFit)) ?? false
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
        try c.encodeIfPresent(groupID, forKey: .groupId)
        try c.encodeIfPresent(shadow, forKey: .shadow)
        switch content {
        case .image(let p):
            try c.encode(p.assetID, forKey: .assetId)
            try c.encode(p.cornerRadius, forKey: .cornerRadius)
            try c.encode(p.cropOffsetX, forKey: .cropOffsetX)
            try c.encode(p.cropOffsetY, forKey: .cropOffsetY)
            try c.encode(p.cropScale, forKey: .cropScale)
            try c.encode(p.mask.rawValue, forKey: .mask)
            try c.encodeIfPresent(p.seamBlend, forKey: .seamBlend)
            try c.encode(p.stroke, forKey: .stroke)
            try c.encode(p.strokeWidth, forKey: .strokeWidth)
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
            try c.encode(p.stroke, forKey: .stroke)
            try c.encode(p.strokeWidth, forKey: .strokeWidth)
            try c.encodeIfPresent(p.fillGradient, forKey: .fillGradient)
            try c.encodeIfPresent(p.highlight, forKey: .highlight)
            if p.autoFit { try c.encode(true, forKey: .autoFit) }
        case .shape(let p):
            try c.encode(p.shape.rawValue, forKey: .shape)
            try c.encode(p.fill, forKey: .fill)
            try c.encode(p.stroke, forKey: .stroke)
            try c.encode(p.strokeWidth, forKey: .strokeWidth)
            try c.encode(p.cornerRadius, forKey: .cornerRadius)
        }
    }
}
