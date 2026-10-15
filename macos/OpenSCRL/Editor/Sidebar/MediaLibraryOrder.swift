import Foundation

/// How the media library is ordered on screen. Display-only: `Project.assets` keeps import order.
enum MediaSortOrder: String, CaseIterable, Identifiable, Sendable {
    case imported
    case nameAscending
    case nameDescending
    case fileType

    var id: String { rawValue }

    var title: String {
        switch self {
        case .imported: "None"
        case .nameAscending: "Filename A→Z"
        case .nameDescending: "Filename Z→A"
        case .fileType: "File type"
        }
    }
}

/// Aspect class of a stored pixel size.
enum MediaOrientation: String, CaseIterable, Identifiable, Sendable {
    case square
    case vertical
    case horizontal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .square: "Square"
        case .vertical: "Vertical"
        case .horizontal: "Horizontal"
        }
    }

    var symbol: String {
        switch self {
        case .square: "square"
        case .vertical: "rectangle.portrait"
        case .horizontal: "rectangle"
        }
    }
}

/// Pure sort and filter helpers behind the Media panel. Nothing here mutates the project.
enum MediaLibraryOrder {
    /// A width/height ratio within this distance of 1 (inclusive) counts as square.
    static let squareTolerance = 0.05

    /// Orientation from stored pixel dimensions; nil when the dimensions are unusable.
    static func orientation(of asset: MediaAsset) -> MediaOrientation? {
        let w = asset.width, h = asset.height
        guard w.isFinite, h.isFinite, w > 0, h > 0 else { return nil }
        let ratio = w / h
        if ratio >= 1 - squareTolerance && ratio <= 1 + squareTolerance { return .square }
        return ratio < 1 ? .vertical : .horizontal
    }

    /// Natural (IMG_2 before IMG_10), case-insensitive comparison that does not depend on locale.
    static func compareNames(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.numeric, .caseInsensitive, .diacriticInsensitive], range: nil, locale: nil)
    }

    /// Sort key for the file type: the stored MIME type (there is no separate source MIME).
    private static func typeKey(_ asset: MediaAsset) -> String {
        let mime = asset.mime.trimmingCharacters(in: .whitespaces).lowercased()
        return mime.isEmpty ? asset.contentType.lowercased() : mime
    }

    /// `assets` ordered and filtered for display. An empty `orientations` set shows everything,
    /// including assets with unusable dimensions. Ties keep import order, so the result is
    /// deterministic.
    static func displayed(_ assets: [MediaAsset], sort: MediaSortOrder, orientations: Set<MediaOrientation> = []) -> [MediaAsset] {
        var entries = Array(assets.enumerated())
        if !orientations.isEmpty {
            entries = entries.filter { entry in orientation(of: entry.element).map(orientations.contains) ?? false }
        }
        func byIndex(_ a: (offset: Int, element: MediaAsset), _ b: (offset: Int, element: MediaAsset)) -> Bool { a.offset < b.offset }
        switch sort {
        case .imported:
            break
        case .nameAscending:
            entries.sort { a, b in
                let order = compareNames(a.element.name, b.element.name)
                return order == .orderedSame ? byIndex(a, b) : order == .orderedAscending
            }
        case .nameDescending:
            entries.sort { a, b in
                let order = compareNames(a.element.name, b.element.name)
                return order == .orderedSame ? byIndex(a, b) : order == .orderedDescending
            }
        case .fileType:
            entries.sort { a, b in
                let types = typeKey(a.element).compare(typeKey(b.element))
                if types != .orderedSame { return types == .orderedAscending }
                let order = compareNames(a.element.name, b.element.name)
                return order == .orderedSame ? byIndex(a, b) : order == .orderedAscending
            }
        }
        return entries.map(\.element)
    }
}
