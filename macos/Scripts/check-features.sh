#!/usr/bin/env bash
set -euo pipefail

# Xcode's current macOS SDK is required. All windows stay offscreen, and notification
# tests run outside an app bundle so they cannot show a permission prompt.
macos_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
check_dir=${1:-$(mktemp -d "${TMPDIR:-/tmp}/openscrl-checks.XXXXXX")}
mkdir -p "$check_dir"
check_dir=$(cd "$check_dir" && pwd)
cd "$check_dir"

xcrun swiftc "$macos_root/OpenSCRL/Export/ExportProgressLedger.swift" \
    "$macos_root/Tests/ExportProgress/main.swift" -o progress-checks
./progress-checks

xcrun swiftc "$macos_root/OpenSCRL/Export/ExportProgressLedger.swift" \
    "$macos_root/OpenSCRL/Export/ExportActivity.swift" \
    "$macos_root/Tests/ExportActivity/main.swift" -o activity-checks
./activity-checks

sed 's/^@main//' "$macos_root/OpenSCRL/App/OpenSCRLApp.swift" > OpenSCRLApp.swift
sources=()
while IFS= read -r source; do sources+=("$source"); done < <(
    if command -v rg >/dev/null; then
        rg --files "$macos_root/OpenSCRL" -g '*.swift' -g '!OpenSCRLApp.swift'
    else
        find "$macos_root/OpenSCRL" -name '*.swift' ! -name 'OpenSCRLApp.swift'
    fi
)
xcrun swiftc -Onone "${sources[@]}" OpenSCRLApp.swift \
    "$macos_root/Tests/EditorFeatures/main.swift" -o editor-checks
./editor-checks
printf 'Offscreen renders: %s/out\n' "$check_dir"
