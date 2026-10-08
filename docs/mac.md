# Open-SCRL for Mac: the details

The longer version of the [README](../README.md)'s Mac section: installing and building,
how seam blending and rendering work, and the scripts that check both.

## Installing

Download `Open-SCRL-<version>.dmg` from [Releases](https://github.com/HeyPortal/open-scrl/releases)
and drag the app to Applications. It needs macOS 27 on Apple silicon. Preview builds are
ad-hoc signed and not notarized, so macOS blocks the first launch: click **Open Anyway** in
**System Settings ▸ Privacy & Security**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Open-SCRL.app
```

## Building

Requires Xcode 27 and its Metal toolchain (`xcodebuild -downloadComponent MetalToolchain`).

```bash
cd macos
xcodebuild -project OpenSCRL.xcodeproj -scheme OpenSCRL -configuration Release -derivedDataPath build build
open build/Build/Products/Release/Open-SCRL.app
```

## Working in the app

- Each project is an `.openscrl` package you can rename, move, back up, or share. Autosave,
  **File ▸ Revert To**, **Open Recent**, and Finder previews come from macOS. The
  `project.json` inside uses the same schema as the web app.
- Move, resize, and rotate with smart guides. Option-drag duplicates. Double-click text to
  type in place, or a photo to reposition its crop. Pinch or `⌘`-scroll to zoom, Space-drag
  to pan. Copy and paste layers and images, and drag photos in from Finder.
- Drop photos or videos on the Dock icon to start a carousel with one slide per item.
  Import straight from your Photos library, HEIC included.
- Export to a folder or ZIP as PNG, JPEG, or HEIC at 1× or 2×. Slides with GIFs or videos
  render to H.264 MP4 faster than real time. **Share Carousel** sends every slide with
  AirDrop, Messages, or Mail.
- Dragging a filmstrip slide into Finder, Messages, or Mail creates a full-resolution PNG;
  animated slides use their first frame. Snapping gives a trackpad haptic tap. Exports show
  progress on the Dock icon, and long video exports can notify you when they finish in the
  background. Notification permission is requested the first time you confirm a video
  export or share.
- Shortcuts are in the menu bar and in **Help ▸ Keyboard Shortcuts** (`⌘ /`). `⌥ ⌘ P` opens
  the phone preview and `⇧ ⌥ ⌘ P` opens it full screen.

## Seam blending

Select two or more photo or video layers and choose **Arrange ▸ Blend Photos**, or choose a partner
in a photo's **Seam Blend** inspector. The photos become a **Blend Group** with a join
between each neighboring pair. Touching layers get a small overlap without changing
their aspect ratios. **Automatic** chooses **Seamless** for shared scenes or **Soft** for
different scenes; either style can be selected manually. Seamless aligns and color-matches
regions along the join, while Soft blends several levels of detail and preserves each
photo's colors. Both preserve the original media.

Click a blend to select and move or resize the whole group. Its inspector includes a photo
strip, **Add Photo**, group style controls, and a **Photo Pair** chooser for tuning one join
while keeping the group selected. Select a photo in the strip to crop or replace it; press
Escape to return to the group. **Separate Photos** removes the effects and ungroups the
photos in one undoable step. Existing adjacent linked photos become a blend group when selected.

Choose **Clean**, **Organic**, or **Glow** edges in the inspector. Adjust the
width, position, color strength, or alignment; Seamless can match colors **Near Seam** or
across the **Whole Photo**. Existing saved blends keep their original appearance until the
blend settings or either photo's geometry are edited, or **Update Match** is used. The
upgrade and edit undo together. Keep the foreground directly above its partner in Layers
for the new effects; an intervening visible layer uses the original feather to preserve it.

Moving the whole group preserves its matches; uniform group resizing also scales them.
Choose **Update Match** after changing an individual photo's placement, crop, or mask.
**Update All Matches** analyzes every join together. Automatic alignment needs
shared scene detail; **Align X/Y** provides manual adjustment. Video matching uses the
opening frames and holds the correction steady during synchronized preview and MP4 export.
It does not track moving objects. The settings are saved with the project and are undoable.

Replacing a member of a Blend Group keeps its joins. Blend Group members are excluded from
**Shuffle Photos** and **Swap Photos**.

Seam feathering, regional alignment, color correction, and edge effects run through
Metal-backed Core Image kernels. Cached source pixels and partner coverage are reused
during slider changes. The original CPU renderer remains a fallback.

## GPU rendering

The canvas presents through Metal. A shared Core Image graph handles photo fitting,
cropping, masks, rotation, opacity, seam correction, shadows, and blurred photo backgrounds.
Video preview and MP4 export keep decoded frames in pixel buffers; export renders directly
into the encoder's IOSurface-backed buffers. Still exports use the same composition.
Embedded image color profiles, video orientation, and white compositing for MP4 are preserved.

Rectangle and ellipse masks and rectangle borders are generated per pixel on the GPU;
static text, shape, and other outline geometry is cached. Canvas drag, resize, rotation,
and crop gestures keep a live preview for rendering and project snapshots, while the
inspector and filmstrip refresh on release. Each gesture remains one undo step.
The canvas renders on changes, limits queued work, and caps viewport textures; exports
retain full-resolution geometry. Each canvas frame also paints the workspace around the
slides and is presented in the same Core Animation transaction as the selection chrome, so
the two can't drift apart while you scroll or zoom. The canvas uses half-float
intermediates; exports keep full precision. Core Graphics remains available when Metal is
unavailable or rendering fails.

On an M5 Pro, a six-photo scene with masks, crop, rotation, borders, and shadows rendered
in 5.9 ms versus 56.2 ms at 1080 × 1350, and 16.8 ms versus 325.6 ms at 2160 × 2700.
This measures completed composition, including graph construction; media decoding, video
encoding, disk writes, and editor controls are excluded. Results depend on the scene and
hardware.

## Checks and benchmarks

There's no Xcode test target. These scripts cover the native code instead:

| Script | What it does |
| --- | --- |
| `zsh macos/Scripts/test-seam-blend.sh` | Seam blending regression checks |
| `zsh macos/Scripts/benchmark-seam-blend.sh` | Compares the original blend paths and benchmarks the newer styles |
| `zsh macos/Scripts/test-gpu-rendering.sh` | Rendering and MP4 parity checks between the Metal and Core Graphics paths |
| `zsh macos/Scripts/benchmark-gpu-rendering.sh` | Optimized composition benchmark |
| `zsh macos/Scripts/test-canvas-rendering.sh` | Canvas rendering checks against a Debug build (`macos/Tests/CanvasRenderingChecks.swift`) |
| `zsh macos/Scripts/benchmark-canvas-interaction.sh` | Run after a Debug build. Measures native drag and resize work in the full SwiftUI editor and checks that geometry changes and GPU frames keep completing during each gesture. Loop timings include a fixed 8 ms event-processing wait, so they aren't display FPS. |
| `bash macos/Scripts/check-features.sh` | Native selection, PNG drag delivery, Dock lifecycle, and offscreen preview renders |
| `macos/Scripts/make-dmg.sh` | Packages a Release build as `macos/build/dmg/Open-SCRL-<version>.dmg` with a branded install window |

## Under the hood

| Area | Implementation |
| --- | --- |
| App | SwiftUI with AppKit for the canvas, menus, and text editing |
| Documents | macOS 27 SwiftUI `Document` API with file-wrapper packages and Quick Look thumbnails |
| Rendering | Metal-backed Core Image composition, with Core Graphics and Core Text as the fallback and for text layout |
| Media | ImageIO (including HEIC and animated GIF, PNG, and WebP) and AVFoundation |
| Export | AVFoundation H.264 MP4, ImageIO PNG, JPEG, and HEIC, and system ZIP archives |

The project signs to run locally and doesn't use the App Sandbox. The app icon's source is
[`macos/Design/AppIcon.icon`](../macos/Design/AppIcon.icon), an Icon Composer document; the
bundled icon set is rendered from it with Icon Composer's `ictool`.
