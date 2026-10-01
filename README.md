<p align="center">
  <img src="./public/pwa-192.png" alt="Open-SCRL logo" width="96" height="96" />
</p>

<h1 align="center">Open-SCRL</h1>

<p align="center">
  A local-first photo grid and social carousel maker.<br />
  Create polished, multi-slide posts in your browser or on your Mac—without accounts, subscriptions, or telemetry.
</p>

<p align="center">
  <a href="https://github.com/HeyPortal/open-scrl/actions/workflows/ci.yml">
    <img src="https://github.com/HeyPortal/open-scrl/actions/workflows/ci.yml/badge.svg" alt="CI status" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-8b5cf6.svg" alt="MIT license" />
  </a>
  <img src="https://img.shields.io/badge/privacy-local--first-14b8a6.svg" alt="Local-first" />
  <img src="https://img.shields.io/badge/platform-PWA-f97316.svg" alt="Progressive Web App" />
  <a href="#mac-app">
    <img src="https://img.shields.io/badge/platform-macOS%2027-0a84ff.svg" alt="Native macOS app" />
  </a>
  <a href="https://github.com/HeyPortal/open-scrl/releases">
    <img src="https://img.shields.io/github/v/release/HeyPortal/open-scrl?include_prereleases&label=release" alt="Latest release" />
  </a>
</p>

Open-SCRL is a free, open-source alternative to [SCRL](https://scrl.com). It combines
photo grids, a layer-based editor, and carousel-ready exports in an installable Progressive
Web App and a [native Mac app](#mac-app). Your projects and original media stay on your device.

> [!NOTE]
> Open-SCRL is in active development. The editor supports local projects, media imports,
> and carousel exports; features and project formats may continue to evolve.

## Highlights

- **Built for social formats** — start with presets for Instagram, TikTok, and Pinterest,
  then create and reorder multi-slide projects.
- **Flexible canvas tools** — combine images, animated GIFs, videos, text, rectangles, and
  ellipses with crop, zoom, positioning, and stacking controls.
- **Fast photo grids** — choose from layouts such as 1×1, 2×2, 3×3, L-shape, 1+4, and more;
  adjust the gap, select a photo slot, and choose imported media to fill it.
- **Precise editing** — use smart alignment guides, layer locking, visibility controls,
  duplication, renaming, drag-to-reorder, and transactional undo/redo.
- **Reusable media** — imports are deduplicated by content and organized by project.
  Click the media item used by the selected image layer again to duplicate that layer.
- **Local-first persistence** — projects autosave in your browser, with IndexedDB fallback
  for media when OPFS writes are unavailable or fail. Save and load errors include retry
  controls, and failed import workers recover for subsequent imports.
- **Carousel-ready export** — export static slides as lossless PNG and animated slides as
  H.264 MP4, packaged as separate, numbered files in a ZIP archive.
- **Designed for larger projects** — tiered previews, worker-backed imports and exports,
  reusable image resources, and a single-pass scene compiler reduce repeated work.
  Unused decoded images are released as the cache exceeds its memory budget.
- **Installable PWA** — add Open-SCRL to your desktop or home screen for an app-like
  experience.

## Mac app

A native version for macOS 27 lives in [`macos/`](./macos). It keeps the same editor, photo
grids, and carousel export, and works the way a Mac app should:

- **Projects are files.** Each project is an `.openscrl` package you can rename, move, back
  up, or share. Autosave, **File ▸ Revert To**, **Open Recent**, and Finder previews come
  from macOS. The `project.json` inside uses the same schema as the web app.
- **A Mac-native workspace.** A Liquid Glass toolbar and floating filmstrip, a tool sidebar,
  an inspector with **Design** and **Layers** tabs, full menu-bar commands, a `⌘ K` command
  palette, and a welcome window with your recent projects.
- **Direct editing.** Move, resize, and rotate with smart guides; Option-drag to duplicate;
  double-click text to type in place or a photo to reposition its crop; pinch or `⌘`-scroll
  to zoom; Space-drag to pan; copy and paste layers and images; drag photos in from Finder.
- **Instant carousels.** Drop photos or videos on the Dock icon to start a carousel with one
  slide per item. Panoramas spread across slides automatically so the swipe stays seamless.
  Import directly from your Photos library, including HEIC photos.
- **Fast export.** Export to a folder or ZIP as PNG, JPEG, or HEIC at 1× or 2×. Slides with
  GIFs or videos render to H.264 MP4 faster than real time. **Share Carousel** sends every
  slide with AirDrop, Messages, or Mail.

The web app and the Mac app store projects separately; projects don't move between them yet.

### Download

Download `Open-SCRL-<version>.dmg` from
[Releases](https://github.com/HeyPortal/open-scrl/releases), open it, and drag **Open-SCRL**
onto the **Applications** folder. It requires macOS 27 on a Mac with Apple silicon.

Preview builds are ad-hoc signed and not notarized, so macOS blocks the first launch. Open
**System Settings ▸ Privacy & Security** and click **Open Anyway**, or remove the download
quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Open-SCRL.app
```

### Build from source

Requires Xcode 27. Open `macos/OpenSCRL.xcodeproj` and choose **Product ▸ Run**, or build
from the command line:

```bash
cd macos
xcodebuild -project OpenSCRL.xcodeproj -scheme OpenSCRL -configuration Release -derivedDataPath build build
open build/Build/Products/Release/Open-SCRL.app
```

To package that build as a release disk image, run `macos/Scripts/make-dmg.sh`. It writes a
compressed `Open-SCRL-<version>.dmg` with a branded install window to `macos/build/dmg/`.

The project signs to run locally and doesn't use the App Sandbox. The app icon's source is
[`macos/Design/AppIcon.icon`](./macos/Design/AppIcon.icon), an Icon Composer document; the
bundled icon set is rendered from it with Icon Composer's `ictool`.

## Quick start

The steps below run the web app. For the Mac app, see [Mac app](#mac-app).

### Prerequisites

- [Node.js 22+](https://nodejs.org/)
- npm

```bash
git clone https://github.com/HeyPortal/open-scrl.git
cd open-scrl
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Type-check and create a production build |
| `npm run preview` | Preview the production build locally |
| `npm run verify` | Run type-checking, linting, unit tests, build, and bundle checks |
| `npm test` | Run the Vitest unit and regression tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run the Playwright browser tests in Chromium |

### Running the checks

Install Playwright's Chromium browser before the first browser-test run:

```bash
npx playwright install --with-deps chromium
npm run verify
npm run test:e2e
```

The GitHub Actions `verify` job runs both verification commands on Node.js 22.
`npm run verify` alone does **not** run the browser tests. Playwright starts the
local development server automatically, or reuses one already running on port 5173.

Vite pre-bundles the worker's HEIC conversion dependency at startup to prevent a
late dependency-discovery reload during the first media import on a fresh cache.

## Storage and recovery

This section describes the web app. The Mac app saves each project, including its media,
as a single `.openscrl` file wherever you choose.

Projects and media stay in the browser profile and site address where you created
them. There is no application server, account system, or device-to-device sync.
Clearing the site's browser data removes its locally saved projects and media.

- Projects autosave to IndexedDB. Media originals and thumbnails use the browser's
  Origin Private File System (OPFS), with IndexedDB fallback. Older originals already
  stored in IndexedDB remain readable there.
- If saving fails, keep the page open and use **Retry saving**. Project-list and
  media-library load failures also have retry controls.
- Shared media keeps its other project associations when removed from one project's
  library. Concurrent imports and deletions use transactional metadata changes and
  separate staged files to avoid overwriting one another.
- Opening the same project in multiple tabs does not provide collaborative editing
  or resolve conflicting edits.

## Browser and export support

The browser test suite runs in Chromium. Media decoding depends on the browser's
supported image and video codecs. Animated MP4 export requires WebCodecs and an
available H.264 encoder; the app reports unsupported encoding configurations.
Static exports can use HTML canvas when workers or OffscreenCanvas are unavailable.

**Slide PNG** downloads the selected slide as an image. **Export Carousel** produces
one ZIP with a separate file for each slide, in posting order: static slides become
PNG files and slides containing animated media become MP4 files. Animated exports
are capped at 60 seconds per slide.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Undo | `⌘ Z` | `Ctrl Z` |
| Redo | `⌘ ⇧ Z` | `Ctrl Y` |
| Duplicate selected layer | `⌘ D` | `Ctrl D` |
| Delete selected layer | `Delete` / `Backspace` | `Delete` / `Backspace` |
| Pan or zoom the canvas | Scroll / pinch | Scroll / pinch |
| Faster zoom | `⌘` + scroll | `Ctrl` + scroll |
| Edit text in place | Double-click a text layer | Double-click a text layer |

The Mac app shows its shortcuts in the menu bar and in **Help ▸ Keyboard Shortcuts** (`⌘ /`).

## Under the hood

| Area | Implementation |
| --- | --- |
| App | React 19, TypeScript, Vite, Tailwind CSS |
| Canvas | Konva and `react-konva` |
| State and history | Zustand with Immer patches |
| Local storage | Transactional IndexedDB via `idb`; OPFS media files with IndexedDB fallback |
| Import and export | Web Workers, Canvas 2D, WebCodecs, MP4 muxing, and Zip.js |
| PWA | `vite-plugin-pwa` with an auto-updating service worker |
| Testing | Vitest regression tests and Playwright Chromium tests, including recovery and cross-tab media flows |

The Mac app is a separate Swift codebase:

| Area | Implementation |
| --- | --- |
| App | SwiftUI with AppKit for the canvas, menus, and text editing |
| Documents | macOS 27 SwiftUI `Document` API with file-wrapper packages and Quick Look thumbnails |
| Rendering | One Core Graphics and Core Text renderer shared by the canvas, thumbnails, and export |
| Media | ImageIO (including HEIC and animated GIF, PNG, and WebP) and AVFoundation |
| Export | AVFoundation H.264 MP4, ImageIO PNG, JPEG, and HEIC, and system ZIP archives |

<details>
<summary><strong>Repository layout</strong></summary>

```text
src/
├── app/          Editor shell and lazy boundaries
├── assets/       Media metadata, OPFS/IndexedDB storage, and imports
├── components/   Editor UI, panels, canvas nodes, and filmstrip
├── core/         Framework-independent document and scene model
├── editor/       Session state, history, and persistence
├── export/       Shared Canvas 2D renderer and export worker
├── lib/          Formats, grids, snapping, IDs, and compatibility facades
├── render/       Shared image resources and memory-budget eviction
├── storage/      IndexedDB transactions and temporary export files
├── store/        Compatibility exports and asset UI state
└── workers/      Media preparation and thumbnail generation

macos/
├── OpenSCRL.xcodeproj
├── Design/       Icon Composer source for the app icon
├── Scripts/      Release packaging: styled installer disk image
└── OpenSCRL/
    ├── App/        App scenes, menu commands, settings, and preferences
    ├── Document/   Project packages, media storage, and imports
    ├── Editor/     Canvas, sidebar panels, inspector, filmstrip, and command palette
    ├── Export/     Still and MP4 rendering and carousel packaging
    ├── Model/      Project model, web-compatible JSON, grids, snapping, and presets
    ├── Rendering/  Shared renderer, text layout, fonts, and image caching
    └── Welcome/    Welcome window and recent projects
```

</details>

## Roadmap

See [PLAN.md](./PLAN.md) for the original build plan, feature ideas, and architecture
notes. It includes proposed features and reference-product research, so it is not a
list of capabilities already implemented.

[PERFORMANCE_REVIEW.md](./PERFORMANCE_REVIEW.md) records the performance and reliability
review, implemented fixes, validation results, and remaining limitations.

## License

Open-SCRL is available under the [MIT License](./LICENSE).

Open-SCRL is an independent project and is not affiliated with SCRL or any social platform
mentioned in this README.
