# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Open-SCRL is a local-first photo grid / social carousel maker. The repo holds two independent codebases: a React PWA (repo root, `src/`) and a native SwiftUI Mac app (`macos/`). They share only the on-disk project JSON schema (`ProjectDocumentV2`); there is no shared code.

## Web app commands

Node 22+. Path alias `@/*` → `src/*`.

```bash
npm run dev                # Vite dev server on :5173
npm run verify             # typecheck + lint + vitest + build + bundle:check (what CI runs first)
npm test                   # vitest run (jsdom; setup in src/test/setup.ts)
npx vitest run src/core/scene/compileScene.test.ts   # single test file
npx vitest run -t "name"   # single test by name
npm run test:e2e           # Playwright (Chromium only); auto-starts or reuses dev server on :5173
npx playwright test e2e/smoke.spec.ts
```

- `verify` does **not** run the Playwright tests; CI runs `verify` then `test:e2e`. Run `npx playwright install --with-deps chromium` once first.
- `bundle:check` fails if the initial entry chunk exceeds 120 KiB gzip, so heavy deps must stay in lazy chunks/workers (see `src/app/` lazy boundaries).

## Mac app commands

Requires Xcode 27 / macOS 27. No test target exists.

```bash
cd macos
xcodebuild -project OpenSCRL.xcodeproj -scheme OpenSCRL -configuration Release -derivedDataPath build build
macos/Scripts/make-dmg.sh   # package the Release build into macos/build/dmg/Open-SCRL-<version>.dmg
```

Version lives in `MARKETING_VERSION` in `project.pbxproj` (release PRs are named `release/macos-vX.Y.Z`).

## Web architecture

Layering, from framework-independent to UI:

- `src/types.ts` + `src/core/` — pure document and scene model, no React. `core/document` holds the schema, `migrations.ts` (always upgrade old persisted docs through `migrateDocument`), selectors, coordinates, and the `EditorCommand` type. `core/scene/compileScene.ts` turns a document into a flat list of positioned `SceneItem`s in a single pass.
- **Coordinate model:** all slides sit side by side on one continuous horizontal canvas; a layer's world x is `slideIndex * format.width + layer.x`. Panoramas/seam-spanning layers (`slideSeams`) and viewport culling both rely on this.
- `src/editor/documentStore.ts` — Zustand store owning the document. **Every mutation is an `EditorCommand`** (`command(label, draft => …, mergeKey?)`) applied through Immer `produceWithPatches`; history stores patches/inverse patches (80 entries / 32 MiB cap, 750 ms merge window for entries sharing a `mergeKey`) and supports transactions for drags. `sessionStore.ts` holds non-document UI state; `persistenceController.ts` handles autosave with retry. `src/store/*` are mostly compatibility re-exports of `editor/`.
- `src/storage/` — IndexedDB (via `idb`) for project documents with a transaction helper; `src/assets/` — media metadata in IndexedDB, blobs in OPFS with IndexedDB fallback, content-hash dedup, per-project association with shared media.
- `src/workers/asset.worker.ts` — import/thumbnail/HEIC work off the main thread. `src/render/resources/` — shared decoded-image cache with memory-budget eviction.
- `src/export/` — one Canvas 2D renderer (`canvas2d/render.ts`) used by `export.worker.ts` (falls back to main-thread canvas); `video.ts`/`timeline.ts` render animated slides to H.264 MP4 via WebCodecs + `mp4-muxer`; `ExportController.ts` orchestrates and zips (Zip.js). Static slides → PNG, animated → MP4. `src/lib/export.ts` is the facade the UI calls.
- `src/components/` — UI; the Konva/`react-konva` canvas is in `components/canvas/`. `src/app/EditorShell.tsx`, `actions.ts`, `menus.ts` wire UI actions to store commands.
- `src/lib/` — formats, grids, snapping, GIF parsing, ids; some files are compatibility facades over `core/`/`export/`.

Note: some files (e.g. `src/lib/export.ts`, `scripts/check-bundle.mjs`) are written in a dense, minified style; match the surrounding file rather than reformatting it.

## Mac architecture

Under `macos/OpenSCRL/`: SwiftUI shell with AppKit for the canvas, menus, and text editing.

- `Model/` — `Project` model; `ProjectFile.swift` encodes/decodes the web-compatible flat JSON and rejects unknown `schemaVersion`s. **Changing the schema requires updating both `src/core/document` (+ migrations) and `ProjectFile.swift`.**
- `Document/` — each project is an `.openscrl` file-wrapper package (`project.json` + media) via the macOS 27 SwiftUI `Document` API; `MediaStore`/`MediaImporter` handle media.
- `Rendering/` — a single Core Graphics/Core Text renderer shared by the canvas, thumbnails, and export (`Renderer.swift`, `TextLayout.swift`).
- `Editor/` — `EditorController` (split across `+Carousel/+Clipboard/+Export` extensions) is the central state/command object; `Canvas/CanvasView` is split into `+Interaction/+TextEditing/+DragAndDrop/+SlideHeaders` extensions.
- `Export/` — `CarouselExporter` (PNG/JPEG/HEIC, ZIP) and `VideoSlideRenderer` (AVFoundation MP4).

Web and Mac projects are stored separately and don't transfer between apps yet.

## Docs

`PLAN.md` is the original plan with proposed features (not a list of what's implemented); `PERFORMANCE_REVIEW.md` records performance/reliability fixes and known limitations.
