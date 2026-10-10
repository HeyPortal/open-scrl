# Web stack modernization

The upgrade starts from GitHub `main` at `e9f4f31`. The old design-transition
references were explicitly withdrawn; the current editor layout is retained.
The migration is split into React/React Konva with Konva 9, then Konva 10,
then Vite/React plugin/PWA. Package and lockfile edits were isolated in separate
worktrees. The document schema, patch history, storage repositories, custom
artwork painters, and PNG/MP4 export contracts remain the same.

## Versions and compatibility

npm's stable `latest` tags were checked on 2026-10-09 before installation:

- React and React DOM: 19.2.5 → 19.3.0.
- React Konva: 19.2.3 → 19.3.0. Its peers support both Konva 9 and 10.
- Konva: 9.3.22 → 10.7.1, in a separate stage.
- Vite: 6.4.3 → 8.3.4.
- `@vitejs/plugin-react`: 4.7.0 → 6.1.2.
- `vite-plugin-pwa`: 1.2.0 → 2.0.0.
- React/DOM types: 19.2.14/19.2.3 → 19.3.0/19.3.0.
- Workbox build/window: 7.4.0 → 7.4.1.

The package and lockfile declare Node **22.12+**, matching Vite and the React
plugin's engine floor within the repository's Node 22 policy. CI selects the
latest Node 22. Final integration checks and measurements used Node 24.21.0;
the isolated tooling checkpoint also passed on Node 22.22.0.

Konva 10 changes ESM and Node backend loading. The browser app uses default
imports and no Node renderer. Its native text positioning changes do not replace
our custom text painter. Canvas-child errors have a separate renderer root;
a DOM error boundary around Stage cannot substitute for a canvas boundary.

Vite 8 uses Rolldown/Oxc. The ZIP split uses the supported code-splitting API.
The Vite 6 syntax targets are explicitly retained: ES2020, Chrome 87, Edge 88,
Firefox 78, Safari 14. These are compilation targets, not a claim that every
editor API (especially WebCodecs and OPFS) works in those browsers. Experimental
bundled development and the native React Compiler remain disabled.

Primary references: [React Konva releases](https://github.com/konvajs/react-konva/releases),
[Konva changelog](https://github.com/konvajs/konva/blob/master/CHANGELOG.md),
[Vite 8 migration](https://vite.dev/guide/migration),
[React plugin releases](https://github.com/vitejs/vite-plugin-react/releases),
[PWA releases](https://github.com/vite-pwa/vite-plugin-pwa/releases), and
[PWA update prompts](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html).

## Regression checks

The baseline passed `npm run verify`: 243 tests in 39 files, type checking,
lint, production build, and the bundle budget. Its Chromium browser suite
passed 20 tests. Both React and Konva checkpoints passed the same 243 unit tests
and the expanded 23-test Chromium suite. The initial integrated stack checkpoint
on 2026-10-09 passed:

- `npm run verify`: exit 0; 260 tests in 42 files, type checking, lint,
  production build, and bundle budget.
- `SCRL_E2E_PORT=5189 npm run test:e2e -- --workers 2`: exit 0;
  23 Chromium tests in 41.6 s.
- `PWA_PORT=5190 npm run test:pwa`: exit 0; five production Chromium tests
  in 21.0 s. Build and PWA checks ran sequentially.
- `npm ls --depth=0`: exit 0; installed targets and required peers resolve.
  Package and lockfile root dependency/engine metadata match.
- `git diff --check`: passed. GitHub main was fetched again at acceptance
  and remained `e9f4f31`.

CI now runs all three verification commands. The PWA suite exercises actual
service-worker installation, waiting, activation, and reload; offline lazy
editor recovery; imports/exports blocking the prompt; failed-save retry;
another tab activating; and optional ZIP/export-worker cache matching with
query strings. Its test server changes the worker's comment revision while
keeping application chunks identical. This does not cover a deployment that
deletes old hashed application chunks.

The runtime fixture adds actual canvas drag, resize, rotation, selection and
grouping, undo/redo, locked layers, custom hit testing, crop, custom-painted
artwork comparison, text editing, phone preview, editor remount, and Chromium
native touch gestures. The existing suites retain grid-spacing, photo-frame,
media deduplication, recovery, per-slide PNG, and animated MP4 checks.

T3's native production browser confirmed the live Konva version as 10.7.1,
opened the current editor and phone preview, closed preview with Escape,
imported a real HEIC fixture as a 1440×960 JPEG, and exported the artwork PNG.
The HEIC adapter and asset worker returned HTTP 200 without browser errors.
The baseline's HEIC worker failure (`window is not defined`) was reproduced
before the lazy browser adapter fix. The decoder still uses its own worker;
JPEG encoding runs through the browser adapter. Document/import storage and
the existing hashing/thumbnail pipeline remain intact.

Native H.264 capability probing returned `supported: false`; the UI displayed
its existing unsupported-encoder message. The MP4 browser test permits either
the MP4/PNG ZIP contract or that capability error. Actual H.264 encoding remains
unverified on this host.

### Additional edge acceptance — 2026-10-10

Independent review and new browser tests found and fixed pending gestures/text
being invisible to the update guard, a deletion during resize leaving activity
busy, and an import completing after a project switch placing slides into the
destination. Panorama toast actions also check their original project before
placing slides. Activity spans now cover commits and cancellation; controller
lifecycle generations prevent an old save/activation from changing a restarted
controller. Later stays dismissed even when a pending save rejects.

Fresh checks after the final source fix all returned exit 0:

- `npm run verify`: 268 tests in 42 files, type checking, lint, build, and
  96.4 KiB gzip entry budget check.
- `SCRL_E2E_PORT=5195 npm run test:e2e -- --workers 2`: 32 Chromium tests in
  49.3 s. Six added tests exercise held resize with Escape/Delete/Select All,
  text cancellation, and project switching during a transform/text draft.
  Three added import tests cover switched-project association, partial failure
  followed by another import, and a surviving panorama toast action.
- `PWA_PORT=5196 npm run test:pwa`: nine production Chromium tests in 33.3 s,
  including real activation held until a drag, resize, or text draft begins.
  They verify no early reload, then persisted geometry/text after completion.
  Later/failed-import recovery is covered too. Each activation race also passed
  in an earlier focused run; no flakiness was observed in those two runs.
- T3 native production browser: live Konva 10.7.1; Escape discarded an in-place
  text draft and retained the original text. The temporary added text was undone.

The import test failed before its fix and passed afterwards. The cancellation
test reproduced the deletion activity leak before the final attachment fix.
Early activation-test failures were incorrect title locators; accessible button
roles fixed those tests. Final logs supersede those preliminary runs. The
cross-browser, codec, installation, and hashed-deployment limits below remain.

Run the normal browser suite with `npm run test:e2e`. A dedicated port avoids
reusing a different worktree's dev server:

```bash
SCRL_E2E_PORT=5186 npm run test:e2e
SCRL_E2E_PORT=5186 SCRL_E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e
```

The touch test uses Chromium CDP and is explicitly skipped on other engines.
Firefox and WebKit were installed on this host but failed before test execution:
Firefox lacks GTK3 and a sufficiently new NSS; WebKit lacks GTK4, GStreamer, and
other runtime libraries. Cross-browser application behavior remains unverified
here. On a supported host, install them with
`npx playwright install --with-deps chromium firefox webkit`.

## Mobile integration — 2026-10-10

The phone redesign in [PR #33](https://github.com/HeyPortal/open-scrl/pull/33)
was rebased onto the completed stack upgrade and merged with all existing
commits preserved. Canvas, app-shell, and text-editor conflicts retained both
main's cancellation/import/update guards and the mobile layout and font mapping.
The document schema, history, storage, and export interfaces did not change.

Mobile pan/pinch and two-finger transforms, and the mobile inline text editor,
now participate in the shared activity tracker. Production checks exercise an
accepted update activating while a gesture or draft is still open, then verify
that the completed geometry or text saves before reload. Escape and project
switches discard stale drafts. The phone update card has a separate message row
and 44px actions; a 320px check covers containment and the desktop check retains
its compact row.

Touch selection uses live geometry rather than the bitmap hit canvas. Regression
checks cover text over photos, empty and incorrect bitmap hits, interrupted
photo movement/resizing, reopening projects, and editing text moved across
slides without recentering to the owning slide. Inter is now bundled and mapped
consistently in canvas painting, editing, and export workers. Its metrics can
change wrapping from the prior fallback face; the earlier pixel comparisons
describe the stack checkpoint before this font change.

Acceptance passed `npm run verify` (348 tests in 50 files, typecheck, lint,
build, and a 97.6 KiB gzip entry), 64 Chromium browser tests, and 13 production
PWA tests. Both GitHub CI runs passed before merge. Physical Android Chrome
checks confirmed the selection and cross-slide fixes before the rebase;
the upgraded runtime's mobile coverage uses Chromium touch emulation.
Physical Android/iOS retesting and the environment limits below remain
unverified. See [the mobile guide](mobile.md) for the shipped behavior.

## Measurement protocol

These comparison trials describe the 2026-10-09 stack checkpoint. The
2026-10-10 interaction-safety fixes increase its entry from 98,687 to 98,755
gzip bytes and EditorShell from 182,573 to 183,198 gzip bytes. Build/editing
timing comparisons were not repeated for those follow-up fixes.

Build and bundle observations use the same baseline checkout and upgraded
checkout on this Linux host. Three sequential, alternating baseline/final
`npm run build` trials include incremental `tsc -b`, `vite build`, and
service-worker generation, excluding installation. Native manual checks
overlapped portions of the build trials; these are bounded host observations,
not an isolated CPU benchmark. Gzip counts use Node `gzipSync` consistently
across both builds. The initial-entry budget remains 120 KiB.

| Measurement | Baseline | Final |
| --- | ---: | ---: |
| Build trials, seconds | 11.378 / 10.343 / 10.457 | 7.248 / 7.148 / 7.454 |
| Median full build | 10.457 s | 7.248 s (30.7% less) |
| Bundler-reported build, median | 4.47 s | 1.12 s |
| Initial entry gzip | 91,596 B (89.4 KiB) | 98,687 B (96.4 KiB) |
| Entry plus HTML module preloads gzip | 91,596 B | 99,115 B |
| Lazy EditorShell gzip | 186,869 B (182.5 KiB) | 182,573 B (178.3 KiB) |
| Lazy ZIP gzip | 65,900 B | 74,067 B |
| Lazy HEIC gzip | 341,212 B | 340,466 B |
| Export worker gzip | 9,414 B | 9,298 B |
| Asset worker gzip | 819 B | 1,019 B |

The observed benefit is faster builds. The entry grew 7,091 gzip bytes,
or 7.7%; including its new Rolldown runtime preload, initial JavaScript grew
8.2%. The editor chunk shrank 2.3%, while ZIP grew 12.4%. Registration and
Workbox window add lazy chunks of 617 and 2,199 gzip bytes. Heavy HEIC, ZIP,
and export-worker code remain outside the entry. No overall bundle-size or
editing-speed improvement is claimed.

The T3 native browser comparison uses a fixed 1280×800 viewport, DPR 2, 20
slides and 201 layers, with gradients, rotated shapes, and outlined/highlighted
custom text. After five warm-up edits, 60 alternating position edits record
store-command time, an explicit Konva draw, and completion at an animation
frame. Frame completion includes scheduling and host load. This measures a
synthetic editing workload, not typical photo decoding or a low-end phone.
This development comparison is retained in the raw evidence but is too noisy
for a speed claim. A separate production comparison at 50% zoom uses actual
keyboard arrows on a selected shape: ten warm-up edits, 60 measured edits,
three alternating trials for each version. It checks that x alternates by one
pixel and returns to its initial value, so it measures actual edits. Completion
at an animation frame includes browser scheduling; explicit draw follows that
frame. Upstream speed claims are not treated as measured improvements.

| Production editing, range across three trial medians | Baseline | Final |
| --- | ---: | ---: |
| Synchronous keyboard handler | 0.2–0.3 ms | 0.2–0.3 ms |
| Explicit draw | 0.7–0.8 ms | 0.8–1.0 ms |
| Frame completion | 16.7–17.0 ms | 16.4–19.8 ms |
| Frame completion, trial p95 range | 17.2–20.1 ms | 20.3–24.6 ms |

There is no consistent editing improvement; the final tail was slower in
these bounded runs. Production scene pixels are identical before and after
all edits (`9290b812`, 1440×1312 backing canvas). At the development fixture's
40% zoom, every stage also retained pixel hash `e127b4a8`. The native exported
PNG was byte-identical across baseline, React, Konva, and final tooling stages:

SHA-256:
`52e305049b5f0cba6dbb32ac52ae193fbbb2a9155de05a088c4d61e86e193c70`.

The separate automated runtime artwork export was byte-identical between
Konva 9 and 10 (SHA-256
`6e069c36d86207101e40509d99b583f73fac133db9a1ead2e3727e56dc981c9d`).
Its comparison with the independent Canvas 2D export painter found mean
channel error 0.0483 and changed-pixel fraction 0.00149 in both checkpoints.
These fixtures cover custom text, images/crop, shapes, gradients, rotation,
opacity, and shadows; they do not prove fidelity for every possible document.

Raw build trials, production editing trials, bundle bytes, and native browser
observations are checked in at [web-stack-measurements.json](web-stack-measurements.json).
Session logs, fixture scripts, PNGs, and provider audit reports remain outside
Git under `/tmp/open-scrl-modernize/`.

## Review and integration

GPT-6.1 Sol engineers implemented the runtime and tooling in isolated
checkouts; the coordinator integrated the lockfile, performed compatibility
review, and owns acceptance. Initial cross-review rounds stopped at a provider
usage limit. On 2026-10-10 both engineers completed independent reviews of
each other's runtime/tooling changes and the follow-up interaction fixes.
They identified missing activity tracking for pending gestures/text, unsafe
import placement after switching projects, and cancellation paths that could
leave activity busy. The coordinator integrated the fixes and lifecycle
generation guard; real browser regressions exercise their event ordering.

Claude Haiku 5.5 supplied registry/release evidence, reproduced HEIC failure,
checked cross-browser prerequisites, and audited the final logs and metadata.
The coordinator corrected preliminary auditor claims about Konva peers and
missing logs against the installed package and explicit final log paths.
Unreproduced double-start/activation-stall concerns do not establish a defect:
the application balances effect cleanup, and real lifecycle tests pass.
The follow-up audit confirmed installed package versions. Its interim log
inventory preceded full browser acceptance; parameterized test counts and
historical baseline figures were checked against actual runner output by the
coordinator. A deployment deleting old chunks still needs its own test.
The current architecture is retained.

## Remaining environment limits

This change is web-only. The Mac app was not changed or built. Headless/offline
browser checks do not emulate operating-system installation UI, physical touch
hardware, crash-induced disk exhaustion, or a long-running production rollout.
The MP4 check reports a supported download or the application's explicit codec
capability message; an unsupported codec is not an encoding success.
