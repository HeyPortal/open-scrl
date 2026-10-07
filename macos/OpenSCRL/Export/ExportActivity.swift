import AppKit
import UserNotifications

/// App-wide export feedback. Window controllers own rendering tasks; this service owns
/// only their progress and weak window references, so closing an editor cannot retain it.
@MainActor
final class ExportActivity: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ExportActivity()
    private static let windowKey = "OpenSCRLExportWindow"
    private static let sessionKey = "OpenSCRLExportSession"

    private final class Job {
        weak var window: NSWindow?
        let notification: ExportCompletionNotification?
        let startedAt = ProcessInfo.processInfo.systemUptime

        init(window: NSWindow?, notification: ExportCompletionNotification?) {
            self.window = window
            self.notification = notification
        }
    }

    private var progress = ExportProgressLedger()
    private var jobs: [UUID: Job] = [:]
    private var dockView: ExportDockView?
    private var originalDockView: NSView?
    private var animationTimer: Timer?
    private var authorizationTask: Task<Void, Never>?
    private let session = UUID().uuidString

    /// Installing the delegate at launch does not ask for permission. Command-line
    /// validation harnesses have no app bundle and cannot create a notification center.
    func configureNotifications() {
        notificationCenter?.delegate = self
    }

    func begin(window: NSWindow?, notification: ExportCompletionNotification?) -> UUID {
        let id = progress.begin()
        jobs[id] = Job(window: window, notification: notification)
        updateDock()
        if notification != nil { requestNotificationPermissionForVideoExport() }
        return id
    }

    func contains(_ id: UUID) -> Bool { progress.contains(id) }

    func update(_ id: UUID, fraction: Double?) {
        guard progress.contains(id) else { return }
        progress.update(id, fraction: fraction)
        updateDock()
    }

    func finish(_ id: UUID, succeeded: Bool) {
        guard let job = jobs.removeValue(forKey: id) else { return }
        progress.finish(id)
        updateDock()

        let elapsed = ProcessInfo.processInfo.systemUptime - job.startedAt
        guard ExportNotificationPolicy.shouldNotify(succeeded: succeeded, includesVideo: job.notification != nil,
                                                     elapsed: elapsed, sourceIsInactive: sourceIsInactive(job.window)),
              let notification = job.notification, let center = notificationCenter else { return }
        Task { [weak self] in
            // A completion can race the first permission prompt. Rendering has finished,
            // but delivery can wait for the user's answer without retaining the editor.
            await self?.authorizationTask?.value
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,
                  self?.sourceIsInactive(job.window) == true else { return }
            let content = UNMutableNotificationContent()
            content.title = notification.title
            content.body = notification.body
            content.userInfo = [Self.windowKey: job.window?.windowNumber ?? -1, Self.sessionKey: self?.session ?? ""]
            // Respect system alert settings and Focus; no sound or icon badge is needed.
            let request = UNNotificationRequest(identifier: "OpenSCRL.Export.\(id.uuidString)", content: content, trigger: nil)
            try? await center.add(request)
        }
    }

    private var notificationCenter: UNUserNotificationCenter? {
        guard Bundle.main.bundleIdentifier != nil else { return nil }
        return UNUserNotificationCenter.current()
    }

    private func requestNotificationPermissionForVideoExport() {
        guard authorizationTask == nil, let center = notificationCenter else { return }
        center.delegate = self
        // The user has confirmed a video export/share. Ask in that context, without
        // delaying rendering or asking again after a previous denial.
        authorizationTask = Task { [weak self] in
            defer { self?.authorizationTask = nil }
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .notDetermined else { return }
            _ = try? await center.requestAuthorization(options: [.alert])
        }
    }

    private func sourceIsInactive(_ window: NSWindow?) -> Bool {
        guard NSApp.isActive, let window, window.isVisible, !window.isMiniaturized else { return true }
        // A progress sheet can be key while its document window is not.
        return NSApp.keyWindow !== window && NSApp.keyWindow?.sheetParent !== window
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in
            guard notification.request.content.userInfo[Self.sessionKey] as? String == session,
                  let number = notification.request.content.userInfo[Self.windowKey] as? Int else {
                completionHandler([])
                return
            }
            let window = NSApp.windows.first { $0.windowNumber == number }
            completionHandler(sourceIsInactive(window) ? [.banner, .list] : [])
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            defer { completionHandler() }
            guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
                  response.notification.request.content.userInfo[Self.sessionKey] as? String == session,
                  let number = response.notification.request.content.userInfo[Self.windowKey] as? Int,
                  let window = NSApp.windows.first(where: { $0.windowNumber == number }) else { return }
            NSApp.activate()
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
    }

    private func updateDock() {
        let tile = NSApp.dockTile
        guard !progress.isEmpty else {
            animationTimer?.invalidate()
            animationTimer = nil
            if let dockView, tile.contentView === dockView {
                tile.contentView = originalDockView
                tile.display()
            }
            dockView = nil
            originalDockView = nil
            return
        }

        if dockView == nil {
            originalDockView = tile.contentView
            let view = ExportDockView(frame: NSRect(origin: .zero, size: tile.size))
            view.icon = NSApp.applicationIconImage
            dockView = view
            tile.contentView = view
        }
        dockView?.fraction = progress.fraction
        dockView?.needsDisplay = true
        tile.display()

        if progress.fraction == nil, animationTimer == nil {
            let timer = Timer(timeInterval: 1.0 / 12, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, let dockView = self.dockView else { return }
                    dockView.phase = (dockView.phase + 0.04).truncatingRemainder(dividingBy: 1)
                    dockView.needsDisplay = true
                    NSApp.dockTile.display()
                }
            }
            animationTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        } else if progress.fraction != nil {
            animationTimer?.invalidate()
            animationTimer = nil
        }
    }
}

/// A small progress track preserves the app icon while exports run in any document.
@MainActor
private final class ExportDockView: NSView {
    var icon: NSImage?
    var fraction: Double?
    var phase: CGFloat = 0

    override func draw(_ dirtyRect: NSRect) {
        icon?.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
        let track = NSRect(x: bounds.width * 0.14, y: bounds.height * 0.08,
                           width: bounds.width * 0.72, height: bounds.height * 0.085)
        let radius = track.height / 2
        let path = NSBezierPath(roundedRect: track, xRadius: radius, yRadius: radius)
        NSColor.black.withAlphaComponent(0.7).setFill()
        path.fill()

        NSGraphicsContext.saveGraphicsState()
        path.addClip()
        let fill: NSRect
        if let fraction {
            fill = NSRect(x: track.minX, y: track.minY, width: track.width * fraction, height: track.height)
        } else {
            let segment = track.width * 0.3
            fill = NSRect(x: track.minX - segment + (track.width + segment) * phase, y: track.minY,
                          width: segment, height: track.height)
        }
        NSColor.controlAccentColor.setFill()
        NSBezierPath(rect: fill).fill()
        NSGraphicsContext.restoreGraphicsState()

        NSColor.white.withAlphaComponent(0.4).setStroke()
        path.lineWidth = max(0.5, bounds.width / 128)
        path.stroke()
    }
}
