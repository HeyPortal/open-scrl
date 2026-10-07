#!/bin/zsh
set -euo pipefail
MAC_ROOT=${0:A:h:h}
PRODUCTS=${1:-$MAC_ROOT/build/Build/Products/Debug}
CONTENTS=$PRODUCTS/Open-SCRL.app/Contents
OUTPUT=$MAC_ROOT/build/canvas-interaction-performance
mkdir -p "$OUTPUT"
xcrun swiftc -O -parse-as-library -I "$PRODUCTS" "$MAC_ROOT/Tests/CanvasInteractionPerformance.swift" \
  "$CONTENTS/MacOS/Open-SCRL.debug.dylib" -Xlinker -rpath -Xlinker "$CONTENTS/MacOS" -o "$OUTPUT/benchmark"
OPENSCRL_METALLIB="$CONTENTS/Resources/default.metallib" "$OUTPUT/benchmark" "${@:2}"
