#!/bin/zsh
# Packages a built Open-SCRL.app into a styled, compressed installer disk image.
#
#   macos/Scripts/make-dmg.sh [path/to/Open-SCRL.app]
#
# Defaults to the Release build from the README's build-from-source command.
# Writes macos/build/dmg/Open-SCRL-<version>.dmg.
set -euo pipefail

SCRIPT_DIR=${0:A:h}
ROOT=${SCRIPT_DIR:h}
APP=${1:-$ROOT/build/Build/Products/Release/Open-SCRL.app}
NAME="Open-SCRL"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")
WORK=$ROOT/build/dmg
OUT=$WORK/$NAME-$VERSION.dmg
MOUNT=/Volumes/$NAME

if [[ -e $MOUNT ]]; then
  echo "error: $MOUNT is already mounted; eject it first." >&2
  exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage/.background"
ditto "$APP" "$WORK/stage/$NAME.app"
ln -s /Applications "$WORK/stage/Applications"
cp "$APP/Contents/Resources/AppIcon.icns" "$WORK/stage/.VolumeIcon.icns"

# Background artwork (1x + 2x in one TIFF so it stays sharp on Retina displays).
swiftc -O -o "$WORK/dmglayout" "$SCRIPT_DIR/DMGLayout.swift"
"$WORK/dmglayout" background "$WORK"
tiffutil -cathidpicheck "$WORK/background.png" "$WORK/background@2x.png" -out "$WORK/stage/.background/background.tiff" >/dev/null

# Lay out the window on a writable image, then compress it.
hdiutil create -quiet -volname "$NAME" -srcfolder "$WORK/stage" -fs HFS+ -format UDRW -size 64m -ov "$WORK/rw.dmg"
hdiutil attach -quiet -nobrowse -noverify -noautoopen "$WORK/rw.dmg"
SetFile -a C "$MOUNT"
"$WORK/dmglayout" dsstore "$MOUNT" "$NAME"
sync
hdiutil detach -quiet "$MOUNT"

hdiutil convert -quiet "$WORK/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$OUT"
rm "$WORK/rw.dmg"
hdiutil verify -quiet "$OUT"
echo "$OUT"
shasum -a 256 "$OUT"
