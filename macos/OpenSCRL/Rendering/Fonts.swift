import AppKit
import CoreText

enum FontCatalog {
    /// CSS keyword the web app uses for the platform UI font; maps to SF Pro on the Mac.
    static let systemFamily = "system-ui"

    static let weights: [(value: Int, name: String)] = [
        (100, "Ultralight"), (200, "Thin"), (300, "Light"), (400, "Regular"), (500, "Medium"),
        (600, "Semibold"), (700, "Bold"), (800, "Heavy"), (900, "Black"),
    ]

    static func weightName(_ value: Int) -> String {
        weights.min { abs($0.value - value) < abs($1.value - value) }?.name ?? "Regular"
    }

    /// A short, curated list shown before "All Fonts".
    static let suggested: [String] = [
        systemFamily, "New York", "SF Pro Rounded", "Helvetica Neue", "Avenir Next", "Futura", "Gill Sans",
        "Georgia", "Didot", "Baskerville", "Optima", "American Typewriter", "Menlo", "Snell Roundhand",
    ].filter { $0 == systemFamily || installedFamilies.contains($0) || $0 == "SF Pro Rounded" || $0 == "New York" }

    static let installedFamilies: [String] = NSFontManager.shared.availableFontFamilies.sorted()

    static func displayName(_ family: String) -> String {
        switch family {
        case systemFamily: "System (SF Pro)"
        case "Inter" where !installedFamilies.contains("Inter"): "Inter (System)"
        default: family
        }
    }
}

/// Resolves (family, weight, italic) into Core Text fonts. Thread-safe so export can run off the main actor.
enum FontResolver {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var descriptors: [String: CTFontDescriptor] = [:]

    private static func weightTrait(_ css: Int) -> CGFloat {
        switch css {
        case ..<150: NSFont.Weight.ultraLight.rawValue
        case ..<250: NSFont.Weight.thin.rawValue
        case ..<350: NSFont.Weight.light.rawValue
        case ..<450: NSFont.Weight.regular.rawValue
        case ..<550: NSFont.Weight.medium.rawValue
        case ..<650: NSFont.Weight.semibold.rawValue
        case ..<750: NSFont.Weight.bold.rawValue
        case ..<850: NSFont.Weight.heavy.rawValue
        default: NSFont.Weight.black.rawValue
        }
    }

    static func font(family: String, weight: Int, italic: Bool, size: CGFloat) -> CTFont {
        let key = "\(family)|\(weight)|\(italic)"
        lock.lock()
        let cached = descriptors[key]
        lock.unlock()
        let descriptor = cached ?? resolveDescriptor(family: family, weight: weight, italic: italic)
        if cached == nil {
            lock.lock()
            descriptors[key] = descriptor
            lock.unlock()
        }
        return CTFontCreateWithFontDescriptor(descriptor, max(1, size), nil)
    }

    private static func systemDescriptor(weight: Int, italic: Bool) -> CTFontDescriptor {
        var descriptor = NSFont.systemFont(ofSize: 12, weight: NSFont.Weight(weightTrait(weight))).fontDescriptor as CTFontDescriptor
        if italic, let slanted = CTFontDescriptorCreateCopyWithSymbolicTraits(descriptor, .traitItalic, .traitItalic) {
            descriptor = slanted
        }
        return descriptor
    }

    private static func resolveDescriptor(family: String, weight: Int, italic: Bool) -> CTFontDescriptor {
        switch family {
        case FontCatalog.systemFamily, "-apple-system", "system", "SF Pro", "SF Pro Text", "SF Pro Display":
            return systemDescriptor(weight: weight, italic: italic)
        case "SF Pro Rounded":
            if let f = NSFont.systemFont(ofSize: 12, weight: NSFont.Weight(weightTrait(weight))).fontDescriptor.withDesign(.rounded) {
                var d = f as CTFontDescriptor
                if italic, let s = CTFontDescriptorCreateCopyWithSymbolicTraits(d, .traitItalic, .traitItalic) { d = s }
                return d
            }
            return systemDescriptor(weight: weight, italic: italic)
        case "New York":
            if let f = NSFont.systemFont(ofSize: 12, weight: NSFont.Weight(weightTrait(weight))).fontDescriptor.withDesign(.serif) {
                var d = f as CTFontDescriptor
                if italic, let s = CTFontDescriptorCreateCopyWithSymbolicTraits(d, .traitItalic, .traitItalic) { d = s }
                return d
            }
            return systemDescriptor(weight: weight, italic: italic)
        default:
            break
        }

        let request = CTFontDescriptorCreateWithAttributes([kCTFontFamilyNameAttribute: family] as CFDictionary)
        let mandatory: Set<String> = [kCTFontFamilyNameAttribute as String]
        guard let matches = CTFontDescriptorCreateMatchingFontDescriptors(request, mandatory as CFSet) as? [CTFontDescriptor], !matches.isEmpty else {
            // Unknown family (for example "Inter" when it isn't installed): use the system font.
            return systemDescriptor(weight: weight, italic: italic)
        }
        let target = weightTrait(weight)
        func traits(_ d: CTFontDescriptor) -> (weight: CGFloat, italic: Bool) {
            let t = CTFontDescriptorCopyAttribute(d, kCTFontTraitsAttribute) as? [CFString: Any] ?? [:]
            let w = (t[kCTFontWeightTrait] as? NSNumber)?.doubleValue ?? 0
            let sym = (t[kCTFontSymbolicTrait] as? NSNumber)?.uint32Value ?? 0
            return (CGFloat(w), sym & CTFontSymbolicTraits.traitItalic.rawValue != 0)
        }
        let best = matches.min { a, b in
            let ta = traits(a), tb = traits(b)
            let sa = abs(ta.weight - target) + (ta.italic == italic ? 0 : 1)
            let sb = abs(tb.weight - target) + (tb.italic == italic ? 0 : 1)
            return sa < sb
        }!
        if italic && !traits(best).italic, let slanted = CTFontDescriptorCreateCopyWithSymbolicTraits(best, .traitItalic, .traitItalic) {
            return slanted
        }
        return best
    }

    static func nsFont(family: String, weight: Int, italic: Bool, size: CGFloat) -> NSFont {
        font(family: family, weight: weight, italic: italic, size: size) as NSFont
    }
}
