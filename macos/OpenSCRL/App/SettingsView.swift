import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            Tab("General", systemImage: "gearshape") { GeneralSettings() }
            Tab("Export", systemImage: "square.and.arrow.up") { ExportSettings() }
        }
        .frame(width: 480)
        .scenePadding()
    }
}

private struct GeneralSettings: View {
    @AppStorage(Preferences.Key.defaultFormat) private var defaultFormat = CanvasFormat.default.name
    @AppStorage(Preferences.Key.snapping) private var snapping = true
    @AppStorage(Preferences.Key.showSeams) private var showSeams = true
    @AppStorage(Preferences.Key.playAnimatedMedia) private var playAnimated = true

    var body: some View {
        Form {
            Picker("Default canvas format:", selection: $defaultFormat) {
                ForEach(CanvasFormat.presets) { Text("\($0.name) (\($0.dimensions))").tag($0.name) }
            }
            Toggle("Snap layers to the slide and to each other", isOn: $snapping)
            Text("Hold ⌘ while dragging to move freely.").font(.caption).foregroundStyle(.secondary)
            Toggle("Highlight slide seams while moving layers", isOn: $showSeams)
            Toggle("Play selected GIFs and videos on the canvas", isOn: $playAnimated)
        }
        .formStyle(.grouped)
    }
}

private struct ExportSettings: View {
    @AppStorage(Preferences.Key.stillFormat) private var stillFormat = Preferences.StillFormat.png.rawValue
    @AppStorage(Preferences.Key.jpegQuality) private var quality = 0.92
    @AppStorage(Preferences.Key.exportScale) private var scale = 1.0
    @AppStorage(Preferences.Key.packaging) private var packaging = Preferences.Packaging.folder.rawValue
    @AppStorage(Preferences.Key.videoFrameRate) private var frameRate = 30

    var body: some View {
        Form {
            Picker("Still slides:", selection: $stillFormat) {
                ForEach(Preferences.StillFormat.allCases) { Text($0.title).tag($0.rawValue) }
            }
            if stillFormat != Preferences.StillFormat.png.rawValue {
                Slider(value: $quality, in: 0.5...1) { Text("Quality:") } minimumValueLabel: { Text("Smaller") } maximumValueLabel: { Text("Best") }
            }
            Picker("Resolution:", selection: $scale) {
                Text("1× — matches the canvas format").tag(1.0)
                Text("2× — extra detail").tag(2.0)
            }
            Picker("Video frame rate:", selection: $frameRate) {
                Text("24 fps").tag(24)
                Text("30 fps").tag(30)
                Text("60 fps").tag(60)
            }
            Picker("Save carousels as:", selection: $packaging) {
                ForEach(Preferences.Packaging.allCases) { Text($0.title).tag($0.rawValue) }
            }
            Text("Slides are numbered in posting order. Slides that contain GIFs or videos export as H.264 MP4, up to 60 seconds.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
    }
}

struct ShortcutsView: View {
    private let groups: [(String, [(String, String)])] = [
        ("Canvas", [
            ("Add text", "T"), ("Add rectangle", "R"), ("Add ellipse", "O"),
            ("Nudge layer (⇧ for 10 px)", "← ↑ → ↓"), ("Previous / next slide (nothing selected)", "← →"),
            ("Select next / previous layer", "⇥  ⇧⇥"), ("Edit text or adjust crop", "↩ or double-click"),
            ("Deselect / finish", "esc"), ("Delete layer", "⌫"),
            ("Pan", "Scroll or Space-drag"), ("Zoom", "Pinch or ⌘-scroll"), ("Toggle fit / 100%", "Two-finger double-tap"),
            ("Duplicate while dragging", "⌥-drag"), ("Constrain movement", "⇧-drag"), ("Move without snapping", "⌘-drag"),
            ("Resize proportionally / from center", "⇧ / ⌥ while resizing"), ("Rotate in 15° steps", "⇧ while rotating"),
        ]),
        ("Edit", [
            ("Undo / Redo", "⌘Z  ⇧⌘Z"), ("Cut / Copy / Paste", "⌘X  ⌘C  ⌘V"), ("Duplicate", "⌘D"),
            ("Lock / Hide", "⇧⌘L  ⇧⌘H"), ("Command palette", "⌘K"),
        ]),
        ("Arrange", [
            ("Select all layers", "⌘A"), ("Group / Ungroup", "⌘G  ⇧⌘G"),
            ("Add to selection", "⇧-click or ⌘-click"), ("Enter a group", "Double-click"),
            ("Bring forward / Send backward", "⌘]  ⌘["), ("Bring to front / Send to back", "⌥⌘]  ⌥⌘["),
        ]),
        ("Slides", [
            ("New slide", "⇧⌘N"), ("Duplicate slide", "⇧⌘D"), ("Previous / next slide", "⌥⌘←  ⌥⌘→"), ("Move slide", "⌃⌥⌘←  ⌃⌥⌘→"),
        ]),
        ("View & File", [
            ("Phone preview", "P or ⌥⌘P"), ("Full-screen preview", "⇧⌥⌘P"),
            ("Preview slides / Full screen / Close", "← →  F  esc"),
            ("Zoom in / out", "⌘+  ⌘−"), ("Actual size / Zoom to fit", "⌘0  ⌘9"), ("Show panel 1–5", "⌘1 … ⌘5"),
            ("Inspector / Layers", "⌥⌘I  ⌥⌘L"), ("Import media", "⇧⌘I"), ("Export carousel / slide", "⇧⌘E  ⌥⇧⌘E"),
        ]),
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 28), GridItem(.flexible(), spacing: 28)], alignment: .leading, spacing: 22) {
                ForEach(groups, id: \.0) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.0).font(.headline)
                        ForEach(group.1, id: \.0) { row in
                            HStack(alignment: .firstTextBaseline) {
                                Text(row.0).foregroundStyle(.secondary)
                                Spacer(minLength: 12)
                                Text(row.1).font(.callout.monospaced()).multilineTextAlignment(.trailing)
                            }
                            .font(.callout)
                        }
                    }
                }
            }
            .padding(24)
        }
        .frame(width: 760, height: 520)
    }
}
