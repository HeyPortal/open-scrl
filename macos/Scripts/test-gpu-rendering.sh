#!/bin/zsh
set -euo pipefail
MAC_ROOT=${0:A:h:h}
BUILD=$MAC_ROOT/build
PRODUCTS=$BUILD/Build/Products/Debug
APP_BINARY=$PRODUCTS/Open-SCRL.app/Contents/MacOS
OUTPUT=$BUILD/gpu-render-check-artifacts
xcodebuild -project "$MAC_ROOT/OpenSCRL.xcodeproj" -scheme OpenSCRL -configuration Debug \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath "$BUILD" build -quiet
mkdir -p "$OUTPUT"
swiftc -parse-as-library -I "$PRODUCTS" "$MAC_ROOT/Tests/GPUSceneChecks.swift" \
  "$APP_BINARY/Open-SCRL.debug.dylib" -Xlinker -rpath -Xlinker "$APP_BINARY" -o "$OUTPUT/check"
OPENSCRL_METALLIB="$PRODUCTS/Open-SCRL.app/Contents/Resources/default.metallib" "$OUTPUT/check" "$OUTPUT"
zsh "$MAC_ROOT/Scripts/test-canvas-rendering.sh" "$PRODUCTS"
