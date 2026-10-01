import Foundation

/// User defaults shared by the Settings window and the editor.
enum Preferences {
    enum Key {
        static let defaultFormat = "defaultFormatName"
        static let snapping = "snapToGuides"
        static let showSeams = "showSlideSeams"
        static let playAnimatedMedia = "playAnimatedMedia"
        static let stillFormat = "exportStillFormat"
        static let jpegQuality = "exportJPEGQuality"
        static let exportScale = "exportScale"
        static let packaging = "exportPackaging"
        static let videoFrameRate = "exportVideoFrameRate"
    }

    enum StillFormat: String, CaseIterable, Identifiable {
        case png, jpeg, heic
        var id: String { rawValue }
        var title: String { switch self { case .png: "PNG"; case .jpeg: "JPEG"; case .heic: "HEIC" } }
        var fileExtension: String { switch self { case .png: "png"; case .jpeg: "jpg"; case .heic: "heic" } }
        var typeIdentifier: String { switch self { case .png: "public.png"; case .jpeg: "public.jpeg"; case .heic: "public.heic" } }
    }

    enum Packaging: String, CaseIterable, Identifiable {
        case folder, zip
        var id: String { rawValue }
        var title: String { self == .folder ? "Folder" : "ZIP Archive" }
    }

    static func register() {
        UserDefaults.standard.register(defaults: [
            Key.defaultFormat: CanvasFormat.default.name,
            Key.snapping: true,
            Key.showSeams: true,
            Key.playAnimatedMedia: true,
            Key.stillFormat: StillFormat.png.rawValue,
            Key.jpegQuality: 0.92,
            Key.exportScale: 1.0,
            Key.packaging: Packaging.folder.rawValue,
            Key.videoFrameRate: 30,
        ])
    }

    static var defaultFormat: CanvasFormat {
        CanvasFormat.preset(named: UserDefaults.standard.string(forKey: Key.defaultFormat) ?? "") ?? .default
    }

    static var snapping: Bool { UserDefaults.standard.bool(forKey: Key.snapping) }
    static var showSeams: Bool { UserDefaults.standard.bool(forKey: Key.showSeams) }
    static var playAnimatedMedia: Bool { UserDefaults.standard.bool(forKey: Key.playAnimatedMedia) }
    static var stillFormat: StillFormat { StillFormat(rawValue: UserDefaults.standard.string(forKey: Key.stillFormat) ?? "") ?? .png }
    static var jpegQuality: Double { UserDefaults.standard.double(forKey: Key.jpegQuality) }
    static var exportScale: Double { max(1, UserDefaults.standard.double(forKey: Key.exportScale)) }
    static var packaging: Packaging { Packaging(rawValue: UserDefaults.standard.string(forKey: Key.packaging) ?? "") ?? .folder }
    static var videoFrameRate: Int { [24, 30, 60].contains(UserDefaults.standard.integer(forKey: Key.videoFrameRate)) ? UserDefaults.standard.integer(forKey: Key.videoFrameRate) : 30 }
}
