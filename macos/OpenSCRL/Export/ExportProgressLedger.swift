import Foundation

/// One entry per running export, rather than one global fraction that windows overwrite.
struct ExportProgressLedger {
    private struct Entry {
        var fraction: Double?
    }

    private var entries: [UUID: Entry] = [:]

    var isEmpty: Bool { entries.isEmpty }
    var count: Int { entries.count }

    /// Unknown jobs count as zero until they report progress. An entirely unknown batch
    /// remains indeterminate. Packaging retains the last fraction reported by the renderer.
    var fraction: Double? {
        guard !entries.isEmpty else { return nil }
        let known = entries.values.compactMap(\.fraction)
        guard !known.isEmpty else { return nil }
        return known.reduce(0, +) / Double(entries.count)
    }

    mutating func begin() -> UUID {
        let id = UUID()
        entries[id] = Entry()
        return id
    }

    func contains(_ id: UUID) -> Bool { entries[id] != nil }

    mutating func update(_ id: UUID, fraction: Double?) {
        guard var entry = entries[id], let fraction, fraction.isFinite else { return }
        // Reports arrive asynchronously; an older frame must not move the Dock backwards.
        entry.fraction = max(entry.fraction ?? 0, min(1, max(0, fraction)))
        entries[id] = entry
    }

    mutating func finish(_ id: UUID) {
        entries.removeValue(forKey: id)
    }
}

struct ExportCompletionNotification: Sendable {
    var title: String
    var body: String
}

enum ExportNotificationPolicy {
    static func shouldNotify(succeeded: Bool, includesVideo: Bool, elapsed: TimeInterval, sourceIsInactive: Bool) -> Bool {
        succeeded && includesVideo && elapsed >= 10 && sourceIsInactive
    }
}
