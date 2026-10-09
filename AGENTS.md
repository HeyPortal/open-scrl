# AGENTS.md

Guidance for coding agents (and humans) working in this repository. `CLAUDE.md` just imports this file.

Open-SCRL is a local-first photo grid / social carousel maker. The repo holds two independent codebases: a React PWA (repo root, `src/`) and a native SwiftUI Mac app (`macos/`). They share only the on-disk project JSON schema (`ProjectDocumentV2`); there is no shared code.

## Web app commands

Node 22.12+. Path alias `@/*` → `src/*`.

```bash
npm run dev                # Vite dev server on :5173
npm run verify             # typecheck + lint + vitest + build + bundle:check (what CI runs first)
npm test                   # vitest run (jsdom; setup in src/test/setup.ts)
npx vitest run src/core/scene/compileScene.test.ts   # single test file
npx vitest run -t "name"   # single test by name
npm run test:e2e           # Playwright (Chromium only); auto-starts or reuses dev server on :5173
npm run test:pwa           # production Chromium offline/update lifecycle checks
npx playwright test e2e/smoke.spec.ts
```

- `verify` does **not** run the Playwright tests; CI runs `verify`, `test:e2e`, then `test:pwa`. Run `npx playwright install --with-deps chromium` once first.
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
- **Fonts:** self-hosted from Fontsource (no CDN) in `src/fonts.css`, latin and latin-ext subsets only. UI text is Inter (`'Inter Variable'`, Tailwind `font-sans`); titles and headings use Instrument Serif (`@fontsource/instrument-serif`, Tailwind `font-display`) via the `heading-hero/lg/md/sm` classes in `src/index.css`. It is a single-weight (400) condensed face with a small x-height, so those classes are set large (19px and up) and pin `font-weight: 400` with `font-synthesis: none`; never add `font-semibold`/`font-bold` to them. A heading that cannot be at least `heading-sm` size without breaking its layout should stay in the sans (semibold) instead. Keep small text, controls and numbers in the sans. Never register a face named plain `'Inter'`: text layers use that name, and the canvas and export worker must keep rendering them as before. Changes to `tailwind.config.js` need a dev-server restart.

Note: some files (e.g. `src/lib/export.ts`, `scripts/check-bundle.mjs`) are written in a dense, minified style; match the surrounding file rather than reformatting it.

## Mac architecture

Under `macos/OpenSCRL/`: SwiftUI shell with AppKit for the canvas, menus, and text editing.

- `Model/` — `Project` model; `ProjectFile.swift` encodes/decodes the web-compatible flat JSON and rejects unknown `schemaVersion`s. **Changing the schema requires updating both `src/core/document` (+ migrations) and `ProjectFile.swift`.** `SlideRecord.grid` (template id, gap, margin, ordered slot layer ids) is an optional field on both sides; grid layout math lives in `src/lib/grids.ts` (`layoutGrid`) and `Model/Grids.swift` (`layout`), and the two must stay in step.
- `Document/` — each project is an `.openscrl` file-wrapper package (`project.json` + media) via the macOS 27 SwiftUI `Document` API; `MediaStore`/`MediaImporter` handle media.
- `Rendering/` — a single Core Graphics/Core Text renderer shared by the canvas, thumbnails, and export (`Renderer.swift`, `TextLayout.swift`).
- `Editor/` — `EditorController` (split across `+Carousel/+Clipboard/+Export` extensions) is the central state/command object; `Canvas/CanvasView` is split into `+Interaction/+TextEditing/+DragAndDrop/+SlideHeaders` extensions.
- `Export/` — `CarouselExporter` (PNG/JPEG/HEIC, ZIP) and `VideoSlideRenderer` (AVFoundation MP4).

Web and Mac projects are stored separately and don't transfer between apps yet.

## Docs

`PLAN.md` is the original plan with proposed features (not a list of what's implemented); `PERFORMANCE_REVIEW.md` records performance/reliability fixes and known limitations.

## Commits and pull requests

Code changes land through a PR that is merged with a merge commit (not squashed), so each commit on the branch ends up in history and should stand on its own.

The exception is docs and repo presentation: the README, `docs/`, `AGENTS.md`, `CHANGELOG.md` wording, and README images or logos can be committed and pushed straight to `main` when a maintainer asks. Anything that touches `src/`, `macos/`, `e2e/`, `public/`, build config, or CI still goes through a PR.

**Remotes.** `origin` is `HeyPortal/open-scrl`, the canonical repo. Maintainers push branches there. Contributors push to their fork (e.g. the `nelson-ens` remote) and open the PR against `HeyPortal/open-scrl:main`. CI on a fork PR waits until a maintainer approves the run.

**Branches.** Branch from an up-to-date `main`:

- `feature/<short-topic>` for features and fixes (e.g. `feature/photo-frame-workflows`)
- `release/macos-vX.Y.Z` for a Mac release (see below)

Rebase on `main` before asking for review if it has moved, and say in the PR what conflicted and how you resolved it.

**Commits.**

- Subject in the imperative and sentence case, no trailing period, about 70 characters max: `Preserve photo frames and add shuffle and explicit swap`. Conventional prefixes (`fix(grid): …`, `feat(mac): …`) have also been used and are fine, but use one style throughout a branch.
- Add a body when the why isn't obvious from the subject. Wrap it at 72 columns.
- Keep each commit buildable. Split unrelated changes, and when a feature touches both apps it's fine to commit web and Mac separately (`… (web)` / `feat(mac): …`).
- Agents end the message with a `Co-Authored-By:` trailer for the model that wrote it.
- Don't commit build output (`dist/`, `macos/build/`, `test-results/`) or local media.

**Before opening a PR,** run what CI runs. If you skip a step, say so in the PR.

```bash
npm run verify
npm run test:e2e
npm run test:pwa
```

If you touched `macos/`, also build it in Xcode 27 and run the scripts in `macos/Scripts/` that cover your change (`test-gpu-rendering.sh`, `test-canvas-rendering.sh`, `test-seam-blend.sh`, `check-features.sh`; see `docs/mac.md`). If you changed the project schema, update both `src/core/document` (plus a migration) and `ProjectFile.swift` in the same PR.

**Opening the PR.** Use `gh pr create --repo HeyPortal/open-scrl --base main`. The title has the same style as a commit subject. In the body:

- `## Summary`: what changed for the user and why, in a few bullets or a short paragraph
- Changes worth calling out for review (file or component names help), and anything left out on purpose
- `## Verification`: the commands you ran with their results (test counts), plus manual checks. Be explicit about what you couldn't run, such as "Mac app not built: no Metal toolchain here."
- `Closes #N` for each issue it resolves
- Screenshots or a short recording for UI changes
- PRs written by an agent end with the `🤖 Generated with …` line

Update the README or `docs/` when user-visible behavior changes. Keep the README short and put detail in `docs/`.

## Mac releases

1. Branch `release/macos-vX.Y.Z` from `main`.
2. In `macos/OpenSCRL.xcodeproj/project.pbxproj`, bump `MARKETING_VERSION` to `X.Y.Z` and `CURRENT_PROJECT_VERSION` by one. Each appears twice (Debug and Release).
3. Add an entry at the top of `CHANGELOG.md`: `## X.Y.Z — YYYY-MM-DD (build N)`, a one-line summary, user-facing bullets (no internals), and a `[Changes since <prev>](https://github.com/HeyPortal/open-scrl/compare/macos-v<prev>...macos-vX.Y.Z)` link.
4. Commit as `Prepare Mac X.Y.Z release and changelog` and open the PR. Releases may be bundled with the feature PR they ship.
5. After merging, from the merge commit on `main`: build Release, run `macos/Scripts/make-dmg.sh`, then `shasum -a 256 Open-SCRL-X.Y.Z.dmg > SHA256SUMS.txt`.
6. Publish:

   ```bash
   gh release create macos-vX.Y.Z --repo HeyPortal/open-scrl --target main \
     --title "Open-SCRL for Mac X.Y.Z" --notes-file <notes.md> \
     macos/build/dmg/Open-SCRL-X.Y.Z.dmg SHA256SUMS.txt CHANGELOG.md
   ```

   The notes start with `## What's new` and follow the changelog entry. Builds are ad-hoc signed and not notarized.

Tags, releases, and pushes to `origin` are public. Agents should confirm with the user before creating or publishing any of them.
