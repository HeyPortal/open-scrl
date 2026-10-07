import SwiftUI

@main
struct OpenSCRLApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        Preferences.register()
    }

    var body: some Scene {
        Window("Welcome to Open-SCRL", id: AppActions.welcomeWindowID) {
            WelcomeView()
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultLaunchBehavior(.presented)
        .restorationBehavior(.disabled)
        .keyboardShortcut("1", modifiers: [.command, .shift])

        DocumentGroup { document in
            ProjectWindow(document: document)
        } makeDocument: { configuration, _ in
            ProjectDocument(configuration: configuration)
        }
        .defaultSize(width: 1440, height: 920)
        .commands { EditorCommands() }

        Window("Keyboard Shortcuts", id: AppActions.shortcutsWindowID) {
            ShortcutsView()
        }
        .windowResizability(.contentSize)
        .restorationBehavior(.disabled)

        Settings {
            SettingsView()
        }
    }
}

/// Bridges AppKit callbacks to SwiftUI window actions.
@MainActor
final class AppActions {
    static let shared = AppActions()
    static let welcomeWindowID = "welcome"
    static let shortcutsWindowID = "shortcuts"

    var openWindow: OpenWindowAction? {
        didSet { flushPendingMedia() }
    }
    var newDocument: NewDocumentAction? {
        didSet { flushPendingMedia() }
    }
    var isTerminating = false
    private var pendingMedia: [URL] = []

    func showWelcome() {
        openWindow?(id: Self.welcomeWindowID)
    }

    /// Photos and videos opened with the app (Dock, Finder “Open With”) start a new carousel.
    func createProject(withMedia urls: [URL]) {
        pendingMedia += urls
        flushPendingMedia()
    }

    private func flushPendingMedia() {
        guard !pendingMedia.isEmpty, let newDocument else { return }
        let urls = pendingMedia
        pendingMedia = []
        let document = ProjectDocument(format: Preferences.defaultFormat, media: urls)
        newDocument(document)
        DispatchQueue.main.async { [openWindow] in
            _ = openWindow
            NSApp.windows.first { $0.identifier?.rawValue.contains(Self.welcomeWindowID) == true }?.close()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }

    func application(_ application: NSApplication, open urls: [URL]) {
        let projects = urls.filter { $0.pathExtension.lowercased() == "openscrl" }
        for url in projects {
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        }
        let media = urls.filter { $0.pathExtension.lowercased() != "openscrl" && MediaImporter.isSupported($0) }
        if !media.isEmpty {
            MainActor.assumeIsolated { AppActions.shared.createProject(withMedia: media) }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { MainActor.assumeIsolated { AppActions.shared.showWelcome() } }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        MainActor.assumeIsolated { AppActions.shared.isTerminating = true }
        return .terminateNow
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated { ExportActivity.shared.configureNotifications() }
        // Like Xcode and Keynote: closing the last project brings back the welcome window.
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { note in
            guard let closing = note.object as? NSWindow, closing.isDocumentWindow else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                MainActor.assumeIsolated {
                    guard !AppActions.shared.isTerminating else { return }
                    let others = NSApp.windows.filter { $0 !== closing && $0.isVisible && ($0.isDocumentWindow || $0.identifier?.rawValue.contains(AppActions.welcomeWindowID) == true) }
                    if others.isEmpty { AppActions.shared.showWelcome() }
                }
            }
        }
    }
}

private extension NSWindow {
    var isDocumentWindow: Bool { windowController?.document != nil }
}

extension FocusedValues {
    @Entry var editor: EditorController?
}
