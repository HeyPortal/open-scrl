#!/bin/zsh
set -euo pipefail
MAC_ROOT=${0:A:h:h}
PRODUCTS=${1:-$MAC_ROOT/build/Build/Products/Debug}
CONTENTS=$PRODUCTS/Open-SCRL.app/Contents
OUTPUT=$MAC_ROOT/build/canvas-rendering-checks
mkdir -p "$OUTPUT"
xcrun swiftc -parse-as-library -I "$PRODUCTS" "$MAC_ROOT/Tests/CanvasRenderingChecks.swift" \
  "$CONTENTS/MacOS/Open-SCRL.debug.dylib" -Xlinker -rpath -Xlinker "$CONTENTS/MacOS" -o "$OUTPUT/check"
OPENSCRL_METALLIB="$CONTENTS/Resources/default.metallib" "$OUTPUT/check"
