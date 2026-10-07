import Foundation
import CoreGraphics

enum SeamEdge: String, Codable, CaseIterable, Sendable {
    case left, right, top, bottom
    var title: String { rawValue.capitalized }
    var isHorizontal: Bool { self == .left || self == .right }
    var isReversed: Bool { self == .right || self == .bottom }
}

/// How the two photos meet. Automatic follows the match: shared detail stitches seamlessly,
/// different scenes blend softly.
enum SeamStyle: String, Codable, CaseIterable, Sendable {
    case automatic, seamless, soft
    var title: String { rawValue.capitalized }
}

/// The look of the transition itself.
enum SeamEdgeStyle: String, Codable, CaseIterable, Sendable {
    case clean, organic, glow
    var title: String { rawValue.capitalized }
}

/// How far the seamless color match extends into the foreground photo.
enum SeamColorReach: String, Codable, CaseIterable, Sendable {
    case nearSeam, wholePhoto
    var title: String { self == .nearSeam ? "Near Seam" : "Whole Photo" }
}

/// A spatial transition to another layer, kept separate from the original media and crop.
struct SeamBlend: Hashable, Sendable {
    /// Version 1 is the original feathered look. Projects saved before the refined renderer
    /// keep it until their blend is edited; new blends use the refined renderer.
    static let refinedVersion = 2

    var targetLayerID: String
    var edge: SeamEdge = .left
    var width: Double = 80
    var position: Double = 0.5
    var colorMatch: Double = 1
    var alignment: Double = 1
    var offsetX: Double = 0
    var offsetY: Double = 0
    var followsDetail: Bool = true
    var analysis: SeamAnalysis?
    var style: SeamStyle = .automatic
    var edgeStyle: SeamEdgeStyle = .clean
    var colorReach: SeamColorReach = .nearSeam
    var version: Int = SeamBlend.refinedVersion

    var isRefined: Bool { version >= Self.refinedVersion }

    /// Automatic uses the most recent match, even when later geometry changes made its
    /// pixel data stale, so moving a photo doesn't flip the look until it is matched again.
    var resolvedStyle: SeamStyle {
        guard style == .automatic else { return style }
        return analysis.map { $0.sameScene ?? $0.alignmentFound } == true ? .seamless : .soft
    }

    var sanitized: SeamBlend {
        var result = self
        func finite(_ value: Double, _ fallback: Double) -> Double { value.isFinite ? value : fallback }
        result.width = clamp(finite(width, 80), 1, 4096)
        result.position = clamp(finite(position, 0.5), 0, 1)
        result.colorMatch = clamp(finite(colorMatch, 1), 0, 1)
        result.alignment = clamp(finite(alignment, 1), 0, 1)
        result.offsetX = clamp(finite(offsetX, 0), -1024, 1024)
        result.offsetY = clamp(finite(offsetY, 0), -1024, 1024)
        result.version = clamp(version, 1, Self.refinedVersion)
        if let analysis, !analysis.isValid { result.analysis = nil }
        return result
    }
}

extension SeamBlend: Codable {
    enum CodingKeys: String, CodingKey {
        case targetLayerID, edge, width, position, colorMatch, alignment, offsetX, offsetY, followsDetail, analysis
        case style, edgeStyle, colorReach, version
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func value<T: Decodable>(_ key: CodingKeys, _ fallback: T) -> T { (try? c.decodeIfPresent(T.self, forKey: key)) ?? fallback }
        targetLayerID = try c.decode(String.self, forKey: .targetLayerID)
        edge = value(.edge, .left)
        width = value(.width, 80)
        position = value(.position, 0.5)
        colorMatch = value(.colorMatch, 1)
        alignment = value(.alignment, 1)
        offsetX = value(.offsetX, 0)
        offsetY = value(.offsetY, 0)
        followsDetail = value(.followsDetail, true)
        analysis = (try? c.decodeIfPresent(SeamAnalysis.self, forKey: .analysis)) ?? nil
        style = value(.style, .automatic)
        // Removed or unknown edge styles use Clean so existing projects still open.
        edgeStyle = value(.edgeStyle, .clean)
        colorReach = value(.colorReach, .nearSeam)
        // Blends saved without a version predate the refined renderer.
        version = value(.version, 1)
    }
}

/// The geometry used for matching. Moving, cropping, or replacing either photo invalidates
/// its analysis; the soft transition continues to work until the user updates the match.
struct SeamSource: Codable, Hashable, Sendable {
    var assetID: String
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var rotation: Double
    var cornerRadius: Double
    var cropOffsetX: Double
    var cropOffsetY: Double
    var cropScale: Double
    var mask: ImageMask

    init(_ layer: Layer) {
        let image = layer.image ?? ImageProperties()
        assetID = image.assetID ?? ""
        x = layer.x; y = layer.y; width = layer.width; height = layer.height
        rotation = layer.rotation; cornerRadius = image.cornerRadius
        cropOffsetX = image.cropOffsetX; cropOffsetY = image.cropOffsetY; cropScale = image.cropScale
        mask = image.mask
    }
}

struct SeamAnalysis: Hashable, Sendable {
    var foreground: SeamSource
    var background: SeamSource
    var edge: SeamEdge
    /// Per-channel linear-light contrast and exposure correction.
    var gain: [Double] = [1, 1, 1]
    var bias: [Double] = [0, 0, 0]
    /// Translation in foreground layer coordinates, applied locally around the seam.
    var shiftX: Double = 0
    var shiftY: Double = 0
    var alignmentFound = false
    /// Normalized low-cost seam positions, from top to bottom or left to right.
    var path: [Double] = []
    /// Regions along the seam, in the same order as `path`. Each has its own linear-light
    /// color mapping (gain and bias, three channels each) and translation in foreground layer
    /// units, so sky and ground or near and distant detail are matched separately.
    var regionGain: [Double] = []
    var regionBias: [Double] = []
    var regionShift: [Double] = []
    /// A cut through calm, low-detail areas, used when the photos are blended softly.
    var softPath: [Double] = []
    /// Whether the photos show the same scene, which selects the automatic style.
    var sameScene: Bool?

    var regionCount: Int { regionGain.count / 3 }

    var isValid: Bool {
        func normalized(_ values: [Double]) -> Bool { values.count <= 2048 && values.allSatisfy { $0.isFinite && (0...1).contains($0) } }
        let regions = regionCount
        return gain.count == 3 && bias.count == 3 && gain.allSatisfy { $0.isFinite && (0.5...2).contains($0) }
            && bias.allSatisfy { $0.isFinite && (-0.5...0.5).contains($0) }
            && shiftX.isFinite && shiftY.isFinite && abs(shiftX) <= 1024 && abs(shiftY) <= 1024
            && normalized(path) && normalized(softPath)
            && regionGain.count % 3 == 0 && regions <= 256 && regionBias.count == regionGain.count
            && regionShift.count == regions * 2
            && regionGain.allSatisfy { $0.isFinite && (0.5...2).contains($0) }
            && regionBias.allSatisfy { $0.isFinite && (-0.5...0.5).contains($0) }
            && regionShift.allSatisfy { $0.isFinite && abs($0) <= 1024 }
    }

    func matches(_ layer: Layer, _ target: Layer, edge: SeamEdge) -> Bool {
        isValid && self.edge == edge && foreground == SeamSource(layer) && background == SeamSource(target)
    }

    /// A shared translation or scale changes the group's placement, not the matched join.
    func rebased(from old: Layer, to new: Layer, partnerFrom oldTarget: Layer, partnerTo newTarget: Layer) -> SeamAnalysis? {
        let sx = new.width / old.width, sy = new.height / old.height
        let dx = new.x - old.x * sx, dy = new.y - old.y * sy
        func close(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.000001 }
        if !close(sx, sy), old.rotation != 0 || oldTarget.rotation != 0 { return nil }
        func transformed(_ a: Layer, _ b: Layer) -> Bool {
            let source = SeamSource(a), target = SeamSource(b)
            return source.assetID == target.assetID && source.mask == target.mask
                && close(source.cropOffsetX, target.cropOffsetX) && close(source.cropOffsetY, target.cropOffsetY)
                && close(source.cropScale, target.cropScale) && close(source.rotation, target.rotation)
                && close(source.cornerRadius * sqrt(abs(sx * sy)), target.cornerRadius)
                && close(a.x * sx + dx, b.x) && close(a.y * sy + dy, b.y)
                && close(a.width * sx, b.width) && close(a.height * sy, b.height)
        }
        guard transformed(old, new), transformed(oldTarget, newTarget) else { return nil }
        var result = self
        result.foreground = SeamSource(new); result.background = SeamSource(newTarget)
        result.shiftX *= sx; result.shiftY *= sy
        for i in result.regionShift.indices { result.regionShift[i] *= i.isMultiple(of: 2) ? sx : sy }
        return result.isValid ? result : nil
    }
}

extension SeamAnalysis: Codable {
    enum CodingKeys: String, CodingKey {
        case foreground, background, edge, gain, bias, shiftX, shiftY, alignmentFound, path
        case regionGain, regionBias, regionShift, softPath, sameScene
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        foreground = try c.decode(SeamSource.self, forKey: .foreground)
        background = try c.decode(SeamSource.self, forKey: .background)
        edge = try c.decode(SeamEdge.self, forKey: .edge)
        gain = try c.decode([Double].self, forKey: .gain)
        bias = try c.decode([Double].self, forKey: .bias)
        shiftX = try c.decode(Double.self, forKey: .shiftX)
        shiftY = try c.decode(Double.self, forKey: .shiftY)
        alignmentFound = try c.decode(Bool.self, forKey: .alignmentFound)
        path = try c.decode([Double].self, forKey: .path)
        // Matches saved by the original renderer have no regional data.
        regionGain = try c.decodeIfPresent([Double].self, forKey: .regionGain) ?? []
        regionBias = try c.decodeIfPresent([Double].self, forKey: .regionBias) ?? []
        regionShift = try c.decodeIfPresent([Double].self, forKey: .regionShift) ?? []
        softPath = try c.decodeIfPresent([Double].self, forKey: .softPath) ?? []
        sameScene = try c.decodeIfPresent(Bool.self, forKey: .sameScene)
    }
}
