import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
}
func near(_ value: Double?, _ expected: Double) -> Bool {
    guard let value else { return false }
    return abs(value - expected) < 0.000001
}

var ledger = ExportProgressLedger()
expect(ledger.isEmpty && ledger.fraction == nil, "Idle ledger has no progress")
let first = ledger.begin()
let second = ledger.begin()
expect(ledger.count == 2 && ledger.fraction == nil, "Preparation is indeterminate")
ledger.update(first, fraction: 0.6)
expect(near(ledger.fraction, 0.3), "Unreported concurrent jobs must count toward the total")
ledger.update(second, fraction: 0.2)
expect(near(ledger.fraction, 0.4), "Concurrent exports contribute equally")
ledger.update(first, fraction: 0.1)
expect(near(ledger.fraction, 0.4), "Late reports must not regress a job")
ledger.update(first, fraction: nil)
expect(near(ledger.fraction, 0.4), "Packaging retains rendered progress")
ledger.update(second, fraction: .nan)
ledger.update(second, fraction: .infinity)
expect(near(ledger.fraction, 0.4), "Invalid progress cannot poison aggregation")
ledger.finish(first)
expect(!ledger.contains(first) && ledger.contains(second), "Finishing one window preserves another")
expect(near(ledger.fraction, 0.2), "Remaining job controls progress")
ledger.update(first, fraction: 1)
expect(near(ledger.fraction, 0.2), "Reports from finished jobs are ignored")
ledger.finish(first)
expect(ledger.count == 1, "Repeated finish is harmless")
ledger.update(second, fraction: 2)
expect(near(ledger.fraction, 1), "Upper progress clamp")
ledger.finish(second)
expect(ledger.isEmpty && ledger.fraction == nil, "Last finish resets the ledger")
let third = ledger.begin()
ledger.update(third, fraction: -0.5)
expect(near(ledger.fraction, 0), "Lower progress clamp")
ledger.finish(third)

expect(ExportNotificationPolicy.shouldNotify(succeeded: true, includesVideo: true, elapsed: 10, sourceIsInactive: true), "Long background video exports notify")
expect(!ExportNotificationPolicy.shouldNotify(succeeded: true, includesVideo: true, elapsed: 9.999, sourceIsInactive: true), "Quick exports stay quiet")
expect(!ExportNotificationPolicy.shouldNotify(succeeded: true, includesVideo: false, elapsed: 60, sourceIsInactive: true), "Still exports stay quiet")
expect(!ExportNotificationPolicy.shouldNotify(succeeded: true, includesVideo: true, elapsed: 60, sourceIsInactive: false), "Visible exports stay quiet")
expect(!ExportNotificationPolicy.shouldNotify(succeeded: false, includesVideo: true, elapsed: 60, sourceIsInactive: true), "Errors and cancellations stay quiet")
print("Export ledger and notification policy assertions passed")
