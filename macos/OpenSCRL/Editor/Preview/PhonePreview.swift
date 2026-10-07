import AppKit
import SwiftUI

/// What the preview window shows and which slide is up. Shared by the window (keys, full
/// screen) and its SwiftUI content.
@MainActor @Observable
final class PhonePreviewState {
    enum Mode: Hashable { case feed, grid }
    var mode: Mode = .feed
    var index = 0
    var isFullScreen = false
}

/// A window per editor that shows the carousel on a phone: swiping through the post in the feed
/// (or as a story, for tall formats) and the 3:4 crop on the profile grid. Full screen is the
/// window's native full screen.
@MainActor
final class PhonePreviewWindow: NSWindow, NSWindowDelegate {
    private static var open: [ObjectIdentifier: PhonePreviewWindow] = [:]
    private let state = PhonePreviewState()
    private weak var controller: EditorController?

    static func show(for controller: EditorController, fullScreen: Bool = false) {
        let key = ObjectIdentifier(controller)
        let window = open[key] ?? PhonePreviewWindow(controller: controller)
        open[key] = window
        window.state.index = min(controller.selectedSlideIndex, max(0, controller.project.slides.count - 1))
        window.makeKeyAndOrderFront(nil)
        if fullScreen && !window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
    }

    static func close(for controller: EditorController) {
        open[ObjectIdentifier(controller)]?.close()
    }

    private init(controller: EditorController) {
        self.controller = controller
        super.init(contentRect: NSRect(x: 0, y: 0, width: 820, height: 940),
                   styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
                   backing: .buffered, defer: false)
        title = "Preview — \(controller.document.displayName)"
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isReleasedWhenClosed = false
        appearance = NSAppearance(named: .darkAqua)
        backgroundColor = NSColor(srgbRed: 0.035, green: 0.035, blue: 0.043, alpha: 1)
        collectionBehavior.insert(.fullScreenPrimary)
        contentMinSize = NSSize(width: 420, height: 620)
        delegate = self
        contentView = NSHostingView(rootView: PhonePreviewView(controller: controller, state: state, window: self))
        center()
        setFrameAutosaveName("PhonePreview")
    }

    func windowDidEnterFullScreen(_ notification: Notification) { state.isFullScreen = true }
    func windowDidExitFullScreen(_ notification: Notification) { state.isFullScreen = false }

    override func close() {
        if let controller { Self.open[ObjectIdentifier(controller)] = nil }
        super.close()
    }

    /// Escape leaves full screen first, then closes the preview.
    override func cancelOperation(_ sender: Any?) {
        if styleMask.contains(.fullScreen) { toggleFullScreen(nil) } else { close() }
    }

    override func keyDown(with event: NSEvent) {
        if !handlePreviewKey(event) { super.keyDown(with: event) }
    }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown && handlePreviewKey(event) { return }
        super.sendEvent(event)
    }

    private func handlePreviewKey(_ event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty else { return false }
        let count = max(1, controller?.project.slides.count ?? 1)
        switch event.keyCode {
        case 123 where state.mode == .feed: state.index = max(0, state.index - 1)
        case 124 where state.mode == .feed, 49 where state.mode == .feed: state.index = min(count - 1, state.index + 1)
        case 3: toggleFullScreen(nil) // F
        case 53: cancelOperation(nil)
        default: return false
        }
        return true
    }
}

// MARK: - Content

private let screenRatio: CGFloat = 2.165
private let referenceWidth: CGFloat = 390
private let bezel: CGFloat = 11
private let gridRatio: CGFloat = 3 / 4
private let instagramBlue = Color(red: 0, green: 0.584, blue: 0.965)

private func handle(for name: String) -> String {
    let lowered = name.trimmingCharacters(in: .whitespaces).lowercased()
    var out = ""
    var lastDot = false
    for ch in lowered {
        if ch.isASCII && (ch.isLetter || ch.isNumber || ch == "_") { out.append(ch); lastDot = false }
        else if !lastDot { out.append("."); lastDot = true }
    }
    let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    return trimmed.isEmpty ? "your.account" : trimmed
}

struct PhonePreviewView: View {
    var controller: EditorController
    @Bindable var state: PhonePreviewState
    weak var window: NSWindow?

    var body: some View {
        let format = controller.project.format
        let story = format.width / format.height < 0.7
        GeometryReader { geo in
            let chrome: CGFloat = state.isFullScreen ? 40 : 128
            let screenHeight = max(240, min(844, geo.size.height - chrome - bezel * 2,
                                            (geo.size.width - 40 - bezel * 2) * screenRatio))
            let screenWidth = screenHeight / screenRatio
            let displayScale = screenWidth / referenceWidth
            VStack(spacing: 0) {
                if !state.isFullScreen {
                    topBar(story: story, compact: geo.size.width < 600)
                }
                HStack(spacing: 40) {
                    PhoneFrame(width: referenceWidth, height: referenceWidth * screenRatio) {
                        switch state.mode {
                        case .grid: GridScreen(controller: controller, width: referenceWidth)
                        case .feed:
                            if story { StoryScreen(controller: controller, state: state, width: referenceWidth, height: referenceWidth * screenRatio) }
                            else { FeedScreen(controller: controller, state: state, width: referenceWidth) }
                        }
                    }
                    .scaleEffect(displayScale)
                    .frame(width: (referenceWidth + bezel * 2) * displayScale,
                           height: (referenceWidth * screenRatio + bezel * 2) * displayScale)
                    if state.mode == .grid && !state.isFullScreen && geo.size.width > 760 {
                        CropGuide(controller: controller)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if !state.isFullScreen && state.mode == .feed && controller.project.slides.count > 1 {
                    Text("Swipe with two fingers, or use ← → to flip through slides.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 14)
                }
            }
        }
        .background(Color(red: 0.035, green: 0.035, blue: 0.043))
        .preferredColorScheme(.dark)
        .overlay(alignment: .topTrailing) {
            if state.isFullScreen {
                Button { window?.toggleFullScreen(nil) } label: {
                    Label("Exit Full Screen", systemImage: "arrow.down.right.and.arrow.up.left")
                }
                .padding(16)
                .help("Exit full screen (Esc)")
            }
        }
        .onChange(of: controller.project.slides.map(\.id)) { _, ids in
            state.index = min(state.index, max(0, ids.count - 1))
        }
    }

    private func topBar(story: Bool, compact: Bool) -> some View {
        HStack(spacing: 12) {
            if !compact { Text("Preview").font(.headline) }
            Picker("Preview", selection: $state.mode) {
                Text(story ? "Story" : "Feed").tag(PhonePreviewState.Mode.feed)
                Text("Profile Grid").tag(PhonePreviewState.Mode.grid)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Spacer()
            Button { window?.toggleFullScreen(nil) } label: {
                if compact { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                else { Label("Full Screen", systemImage: "arrow.up.left.and.arrow.down.right") }
            }
            .accessibilityLabel("Full Screen")
            .help("Full screen (F or ⌃⌘F)")
        }
        .padding(.leading, 84)
        .padding(.trailing, 16)
        .frame(height: 52)
    }
}

/// An iPhone-sized screen inside a bezel.
private struct PhoneFrame<Content: View>: View {
    var width: CGFloat
    var height: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(width: width, height: height)
            .background(.white)
            .overlay(alignment: .bottom) {
                Capsule().fill(.black.opacity(0.8)).frame(width: 120, height: 5).padding(.bottom, 8).allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: 44, style: .continuous))
            .padding(bezel)
            .background(RoundedRectangle(cornerRadius: 54, style: .continuous).fill(Color(red: 0.106, green: 0.106, blue: 0.122)))
            .overlay(RoundedRectangle(cornerRadius: 54, style: .continuous).strokeBorder(.white.opacity(0.08)))
            .shadow(color: .black.opacity(0.7), radius: 50, y: 30)
    }
}

/// One slide cover-fitted into its frame, drawn with the export renderer.
private struct SlideView: View {
    var controller: EditorController
    var index: Int

    var body: some View {
        let project = controller.project
        let images = controller.document.images
        let _ = images.revision
        Canvas { context, size in
            guard project.slides.indices.contains(index) else { return }
            let format = project.format
            let scale = max(size.width / format.width, size.height / format.height)
            context.withCGContext { cg in
                cg.translateBy(x: (size.width - format.width * scale) / 2, y: (size.height - format.height * scale) / 2)
                cg.scaleBy(x: scale, y: scale)
                if case .transparent = project.slides[index].background {
                    Renderer.drawCheckerboard(in: CGRect(origin: .zero, size: format.size), cell: format.width / 24, cg: cg)
                }
                Renderer.drawSlide(project, index: index, cg: cg, images: images)
            }
        }
        .clipped()
    }
}

/// Pages through the slides with native trackpad swipes, plus hover arrows like the web.
private struct Carousel: View {
    var controller: EditorController
    @Bindable var state: PhonePreviewState
    var width: CGFloat
    var height: CGFloat
    var showsCount = true
    @State private var position: Int?
    @State private var hovering = false

    var body: some View {
        let count = controller.project.slides.count
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 0) {
                ForEach(0..<count, id: \.self) { i in
                    SlideView(controller: controller, index: i)
                        .frame(width: width, height: height)
                        .id(i)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $position)
        .frame(width: width, height: height)
        .overlay(alignment: .topTrailing) {
            if showsCount && count > 1 {
                Text("\(state.index + 1)/\(count)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(.black.opacity(0.6)))
                    .padding(10)
            }
        }
        .overlay {
            if hovering && count > 1 {
                HStack {
                    arrow("chevron.left", label: "Previous slide", disabled: state.index == 0) { state.index -= 1 }
                    Spacer()
                    arrow("chevron.right", label: "Next slide", disabled: state.index >= count - 1) { state.index += 1 }
                }
                .padding(.horizontal, 8)
            }
        }
        .onHover { hovering = $0 }
        .onAppear { position = state.index }
        .onChange(of: position) { _, next in if let next, next != state.index { state.index = next } }
        .onChange(of: state.index) { _, next in
            if position != next { withAnimation(.snappy(duration: 0.3)) { position = next } }
        }
    }

    private func arrow(_ symbol: String, label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(white: 0.15))
                .frame(width: 26, height: 26)
                .background(Circle().fill(.white.opacity(0.88)))
                .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .opacity(disabled ? 0 : 1)
        .disabled(disabled)
    }
}

private struct Avatar: View {
    var size: CGFloat
    var body: some View {
        Circle()
            .fill(LinearGradient(colors: [Color(red: 0.65, green: 0.55, blue: 0.98), Color(red: 0.85, green: 0.28, blue: 0.94)], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .padding(2)
            .background(Circle().fill(AngularGradient(colors: [.yellow, .pink, .purple, .yellow], center: .center)))
            .frame(width: size, height: size)
    }
}

private struct StatusBar: View {
    var dark = false
    var body: some View {
        let color: Color = dark ? .white : .black
        ZStack {
            HStack {
                Text("9:41").font(.system(size: 14, weight: .semibold))
                Spacer()
                HStack(spacing: 5) {
                    Image(systemName: "cellularbars")
                    Image(systemName: "wifi")
                    Image(systemName: "battery.75percent")
                }
                .font(.system(size: 12, weight: .semibold))
            }
            .padding(.horizontal, 26)
            Capsule().fill(.black).frame(width: 92, height: 26).offset(y: -2)
        }
        .foregroundStyle(color)
        .frame(height: 44)
    }
}

private struct FeedScreen: View {
    var controller: EditorController
    @Bindable var state: PhonePreviewState
    var width: CGFloat

    var body: some View {
        let format = controller.project.format
        let count = controller.project.slides.count
        let name = controller.document.displayName
        let account = handle(for: name)
        // Feed posts show between 1.91:1 and 4:5; taller formats are cropped to 4:5.
        let ratio = max(0.8, min(1.91, format.width / format.height))
        VStack(spacing: 0) {
            StatusBar()
            HStack {
                Image(systemName: "chevron.left").font(.system(size: 18, weight: .semibold))
                Spacer()
                Text("Posts").font(.system(size: 15, weight: .semibold))
                Spacer()
                Color.clear.frame(width: 18)
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .overlay(alignment: .bottom) { Rectangle().fill(.black.opacity(0.06)).frame(height: 1) }
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 10) {
                        Avatar(size: 32)
                        Text(account).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        Spacer()
                        Image(systemName: "ellipsis")
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 48)
                    Carousel(controller: controller, state: state, width: width, height: width / ratio)
                    ZStack {
                        HStack(spacing: 15) {
                            Image(systemName: "heart")
                            Image(systemName: "bubble.right").scaleEffect(x: -1)
                            Image(systemName: "paperplane")
                            Spacer()
                            Image(systemName: "bookmark")
                        }
                        .font(.system(size: 21))
                        if count > 1 {
                            HStack(spacing: 4) {
                                ForEach(0..<count, id: \.self) { i in
                                    Circle().fill(i == state.index ? instagramBlue : .black.opacity(0.2)).frame(width: i == state.index ? 6 : 5)
                                }
                            }
                            .animation(.snappy(duration: 0.2), value: state.index)
                            .accessibilityLabel("Slide \(state.index + 1) of \(count)")
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("1,284 likes").fontWeight(.semibold)
                        Text("\(Text(account).fontWeight(.semibold)) \(name) · Swipe through →")
                        Text("View all 24 comments").foregroundStyle(.black.opacity(0.45))
                        Text("JUST NOW").font(.system(size: 10)).kerning(0.4).foregroundStyle(.black.opacity(0.4))
                    }
                    .font(.system(size: 13))
                    .padding(.horizontal, 12)
                    .padding(.bottom, 24)
                }
            }
        }
        .foregroundStyle(.black)
        .background(.white)
    }
}

private struct StoryScreen: View {
    var controller: EditorController
    @Bindable var state: PhonePreviewState
    var width: CGFloat
    var height: CGFloat

    var body: some View {
        let count = controller.project.slides.count
        let account = handle(for: controller.document.displayName)
        Carousel(controller: controller, state: state, width: width, height: height, showsCount: false)
            .overlay(alignment: .top) {
                VStack(alignment: .leading, spacing: 10) {
                    StatusBar(dark: true)
                    HStack(spacing: 4) {
                        ForEach(0..<count, id: \.self) { i in
                            Capsule().fill(i <= state.index ? .white : .white.opacity(0.35)).frame(height: 2.5)
                        }
                    }
                    .padding(.horizontal, 10)
                    HStack(spacing: 8) {
                        Avatar(size: 30)
                        Text(account).fontWeight(.semibold)
                        Text("1m").foregroundStyle(.white.opacity(0.7))
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                }
                .padding(.bottom, 30)
                .background(LinearGradient(colors: [.black.opacity(0.5), .clear], startPoint: .top, endPoint: .bottom))
                .allowsHitTesting(false)
            }
            .background(.black)
    }
}

private let placeholderTones: [Color] = ["#e8e3dc", "#d9dde3", "#e5dde6", "#dde5df", "#ece6d8", "#dad9e4", "#e4dcd6", "#d7e1e6"].map { HexColor.color($0) }

private struct GridScreen: View {
    var controller: EditorController
    var width: CGFloat

    var body: some View {
        let name = controller.document.displayName
        let account = handle(for: name)
        let tileW = (width - 2) / 3
        let tileH = tileW / gridRatio
        let columns = Array(repeating: GridItem(.fixed(tileW), spacing: 1), count: 3)
        VStack(spacing: 0) {
            StatusBar()
            Text(account).font(.system(size: 15, weight: .semibold)).frame(height: 40)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 20) {
                        Avatar(size: 76)
                        ForEach([("48", "posts"), ("2,031", "followers"), ("312", "following")], id: \.1) { n, label in
                            VStack(spacing: 1) {
                                Text(n).font(.system(size: 15, weight: .bold))
                                Text(label).font(.system(size: 12))
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name).fontWeight(.bold)
                        Text("Made with Open-SCRL").foregroundStyle(.black.opacity(0.55))
                    }
                    .font(.system(size: 12))
                    .padding(.horizontal, 16).padding(.bottom, 10)
                    HStack(spacing: 6) {
                        ForEach(["Edit profile", "Share profile"], id: \.self) { label in
                            Text(label).font(.system(size: 12, weight: .semibold))
                                .frame(maxWidth: .infinity).padding(.vertical, 6)
                                .background(RoundedRectangle(cornerRadius: 8).fill(.black.opacity(0.06)))
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 12)
                    HStack(spacing: 0) {
                        Image(systemName: "squareshape.split.3x3").frame(maxWidth: .infinity).padding(.vertical, 8)
                            .overlay(alignment: .bottom) { Rectangle().fill(.black).frame(height: 1) }
                        Image(systemName: "square.on.square").frame(maxWidth: .infinity).padding(.vertical, 8).foregroundStyle(.black.opacity(0.35))
                    }
                    .font(.system(size: 18))
                    .overlay(alignment: .top) { Rectangle().fill(.black.opacity(0.1)).frame(height: 1) }
                    LazyVGrid(columns: columns, spacing: 1) {
                        SlideView(controller: controller, index: 0)
                            .frame(width: tileW, height: tileH)
                            .overlay(alignment: .topTrailing) {
                                if controller.project.slides.count > 1 {
                                    Image(systemName: "square.on.square.fill")
                                        .font(.system(size: 13))
                                        .foregroundStyle(.white)
                                        .shadow(color: .black.opacity(0.4), radius: 2)
                                        .padding(6)
                                }
                            }
                        ForEach(0..<placeholderTones.count, id: \.self) { i in
                            LinearGradient(colors: [placeholderTones[i], placeholderTones[(i + 3) % placeholderTones.count]], startPoint: .topLeading, endPoint: .bottomTrailing)
                                .frame(width: tileW, height: tileH)
                        }
                    }
                }
            }
        }
        .foregroundStyle(.black)
        .background(.white)
    }
}

/// The first slide with Instagram's 3:4 profile-grid crop outlined.
private struct CropGuide: View {
    var controller: EditorController

    var body: some View {
        let format = controller.project.format
        let ratio = format.width / format.height
        let width: CGFloat = 248, height = width / ratio
        let crop = ratio > gridRatio ? CGSize(width: height * gridRatio, height: height) : CGSize(width: width, height: width / gridRatio)
        let matches = abs(ratio - gridRatio) < 0.01
        VStack(alignment: .leading, spacing: 6) {
            Text("Profile Grid Crop").font(.headline)
            Text(matches ? "Your format already matches the 3:4 grid, so nothing is cropped."
                         : "Your profile shows the first slide cropped to 3:4. Keep faces and titles inside the frame.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            SlideView(controller: controller, index: 0)
                .frame(width: width, height: height)
                .overlay {
                    if !matches {
                        ZStack {
                            Rectangle().fill(.black.opacity(0.55))
                                .mask {
                                    Rectangle().overlay { Rectangle().frame(width: crop.width, height: crop.height).blendMode(.destinationOut) }.compositingGroup()
                                }
                            RoundedRectangle(cornerRadius: 2).strokeBorder(.white, lineWidth: 2).frame(width: crop.width, height: crop.height)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .padding(.top, 6)
        }
        .frame(width: 248)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(white: 0.11)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.08)))
    }
}
