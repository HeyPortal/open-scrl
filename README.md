<p align="center">
  <img src="./public/pwa-192.png" alt="Open-SCRL logo" width="96" height="96" />
</p>

<h1 align="center">Open-SCRL</h1>

<p align="center">
  A local-first photo grid and social carousel maker.<br />
  Create polished, multi-slide posts in your browser—without accounts, subscriptions, or telemetry.
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
</p>

Open-SCRL is a free, open-source alternative to [SCRL](https://scrl.com). It combines
photo grids, a layer-based editor, and carousel-ready exports in an installable Progressive
Web App. Your projects and original media stay on your device.

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

## Quick start

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
