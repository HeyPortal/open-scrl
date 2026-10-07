import AppKit

let application = NSApplication.shared
MainActor.assumeIsolated {
    let activity = ExportActivity.shared
    // Must safely do nothing in a CLI process, which has no application bundle.
    activity.configureNotifications()
    let tile = application.dockTile
    let original = NSView(frame: NSRect(x: 0, y: 0, width: 128, height: 128))
    tile.contentView = original
    let badge = tile.badgeLabel
    let first = activity.begin(window: nil, notification: nil)
    let second = activity.begin(window: nil, notification: nil)
    precondition(activity.contains(first) && activity.contains(second))
    precondition(tile.contentView !== original, "Running exports install progress")
    activity.update(first, fraction: 0.5)
    activity.finish(first, succeeded: false)
    precondition(!activity.contains(first) && activity.contains(second))
    precondition(tile.contentView !== original, "One terminal job must not clear another window's progress")
    activity.update(first, fraction: 1)
    activity.finish(first, succeeded: true)
    precondition(activity.contains(second), "Late reports and repeated finish preserve other jobs")
    activity.finish(second, succeeded: true)
    precondition(tile.contentView === original, "Last export restores the original Dock view")
    precondition(tile.badgeLabel == badge, "Export progress preserves the existing Dock badge")
    let third = activity.begin(window: nil, notification: nil)
    activity.finish(third, succeeded: false)
    precondition(tile.contentView === original, "An immediately failed or canceled job also restores the Dock")
    let fourth = activity.begin(window: nil, notification: ExportCompletionNotification(title: "Test", body: "Test"))
    activity.finish(fourth, succeeded: false)
    precondition(tile.contentView === original, "Video setup safely skips notification access without an app bundle")
}
print("Export activity AppKit lifecycle assertions passed")
