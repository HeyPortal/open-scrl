import Foundation
import CoreGraphics

enum SeamEdge: String, Codable, CaseIterable, Sendable {
    case left, right, top, bottom
    var title: String { rawValue.capitalized }
    var isHorizontal: Bool { self == .left || self == .right }
    var isReversed: Bool { self == .right || self == .bottom }
}

/// A spatial transition to another layer, kept separate from the original media and crop.
struct SeamBlend: Codable, Hashable, Sendable {
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

    var sanitized: SeamBlend {
        var result = self
        func finite(_ value: Double, _ fallback: Double) -> Double { value.isFinite ? value : fallback }
        result.width = clamp(finite(width, 80), 1, 4096)
        result.position = clamp(finite(position, 0.5), 0, 1)
        result.colorMatch = clamp(finite(colorMatch, 1), 0, 1)
        result.alignment = clamp(finite(alignment, 1), 0, 1)
        result.offsetX = clamp(finite(offsetX, 0), -1024, 1024)
        result.offsetY = clamp(finite(offsetY, 0), -1024, 1024)
        if let analysis, !analysis.isValid { result.analysis = nil }
        return result
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

struct SeamAnalysis: Codable, Hashable, Sendable {
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

    var isValid: Bool {
        gain.count == 3 && bias.count == 3 && gain.allSatisfy { $0.isFinite && (0.5...2).contains($0) }
            && bias.allSatisfy { $0.isFinite && (-0.5...0.5).contains($0) }
            && shiftX.isFinite && shiftY.isFinite && abs(shiftX) <= 1024 && abs(shiftY) <= 1024
            && path.count <= 2048 && path.allSatisfy { $0.isFinite && (0...1).contains($0) }
    }

    func matches(_ layer: Layer, _ target: Layer, edge: SeamEdge) -> Bool {
        isValid && self.edge == edge && foreground == SeamSource(layer) && background == SeamSource(target)
    }
}
