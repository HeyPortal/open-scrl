#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
ROOT=${SCRIPT_DIR:h}
BUILD=$ROOT/build
PRODUCTS=$BUILD/Build/Products/Debug
APP_BINARY=$PRODUCTS/Open-SCRL.app/Contents/MacOS

xcodebuild -project "$ROOT/OpenSCRL.xcodeproj" -scheme OpenSCRL -configuration Debug \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath "$BUILD" build -quiet
mkdir -p "$BUILD/seam-check-artifacts"
swiftc -parse-as-library -I "$PRODUCTS" "$ROOT/Tests/SeamBlendChecks.swift" \
  "$APP_BINARY/Open-SCRL.debug.dylib" -Xlinker -rpath -Xlinker "$APP_BINARY" \
  -o "$BUILD/seam-check-artifacts/check"
OPENSCRL_METALLIB="$PRODUCTS/Open-SCRL.app/Contents/Resources/default.metallib" \
  "$BUILD/seam-check-artifacts/check" "$BUILD/seam-check-artifacts"
