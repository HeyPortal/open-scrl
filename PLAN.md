# Open-SCRL — Build Plan

An open-source, feature-rich clone of [SCRL](https://scrl.com) (Appostrophe AB) — the
seamless Instagram carousel + photo collage maker. The goal is feature parity (and beyond)
with **no subscription, no paywalls, no telemetry**, while fixing the well-known pain
points of the original (image-quality degradation on import/export, memory blow-ups on
large projects, aggressive trial-to-charge flow).

> Working name: **Open-SCRL** (placeholder). Other ideas: `Carouseil`, `Slidewave`,
> `Panoramic`, `Splitr`, `Continua`. Pick before public release.

---

## 1. What SCRL actually does (feature audit)

Synthesised from SCRL's website, App Store / Play Store listings, third-party reviews,
and tutorials.

### 1.1 Project types
- **Seamless Carousel** — one wide canvas (e.g. `1080·N × 1350`) split across N slides
  so a swipe feels like one continuous panorama.
- **Photo Collage** — single-slide grid/freeform collage.
- **Multi-slide Post** — independent slides (story-style).
- **Format presets** — IG square `1080×1080`, IG portrait `1080×1350`, IG story / Reels
  cover `1080×1920`, TikTok cover, custom.

### 1.2 Editor capabilities
- Freeform canvas with **zoom + pan**, full project overview.
- Up to **20 slides** per project (free tier capped at 10).
- **Layer system** — reorder, lock, hide, rename, group.
- **Smart snapping** between layers + snap-to-grid + alignment guides.
- **Image / video layers** — crop, rotate, scale, opacity, filters, adjustments
  (brightness/contrast/saturation/temp/tint/sharpen), masking.
- **Text layers** — 70+ variable fonts, weight/italic/letter-spacing/line-height,
  alignment, color, gradient fill, stroke, shadow, curve text (nice-to-have).
- **Shape layers** — rect/rounded-rect/ellipse/polygon/star/line/arrow with fill,
  stroke, gradient, shadow.
- **Sticker / overlay library** — tagged catalog, search, favourites.
- **Frames** — decorative borders around photos.
- **Grid templates** — premade photo grids that span multiple slides.
- **Freehand drawing** — pen tool with size, color, opacity, eraser.
- **Background** — solid, gradient, image, transparent (PNG export).
- **Background removal** — AI cutout for subjects (one-click).
- **Templates** — hundreds, browsable by occasion/style; one-click apply, then edit.
- **History** — undo/redo (ideally non-linear).

### 1.3 Carousel-specific features
- Drop a single wide image and **auto-split into N slides** with bleed/overlap controls.
- **Cross-slide layer continuity** — a shape/photo can span slides; moving it on slide 2
  updates slides 1 + 3.
- **Slide preview strip** with reorder by drag.
- **Alignment helpers** at slide seams (so faces/objects don't get cut by the seam).

### 1.4 Export & sharing
- HD export per slide (PNG/JPG, configurable quality).
- Batch export → ZIP, named in correct posting order (SCRL famously reverses; we'll do
  it correctly + offer both).
- Direct share to Instagram / TikTok / Photos / Files.
- Export project file (`.osc` JSON) for re-edit / sharing.

### 1.5 Premium-gated in original (we make all of these free)
- Templates beyond the free pack.
- Slides 11–20.
- Video in grids.
- Gradient backgrounds.
- Background removal.
- Some fonts / stickers.

---

## 2. Why build our own — pain points of SCRL we fix

| SCRL pain point (from reviews) | Our answer |
| --- | --- |
| Image quality downgraded on import & export | Preserve original bytes; render via canvas at native resolution; expose quality/format. |
| App slows / crashes on 50+ photo projects | Tile-based renderer, virtualised layer panel, web workers for heavy ops, off-screen canvases per slide. |
| Aggressive subscription / surprise charges | MIT/AGPL, no accounts required, no payments. |
| Mobile-only (desktop awkward) | Web-first PWA, then React Native shell — same engine, every device. |
| Closed format, lock-in | Open `.osc` JSON spec, importable templates as plain JSON + assets folder. |
| Telemetry / tracking | Local-first, zero analytics by default. |

---

## 3. Recommended tech stack

Two sane stacks; pick one based on your priority.

### Stack A — Web-first PWA (recommended to start)
Reaches every device on day 1, easiest contributor onboarding, best dev velocity.

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 15** (App Router) or **Vite + React 19** | SSR not critical → Vite is lighter; Next gives easier deploy + share-link rendering later. |
| Language | **TypeScript** | Required for a complex editor. |
| Canvas engine | **Konva.js** (`react-konva`) or **Fabric.js** | Layers, transforms, hit-testing, snapping, serialisation out of the box. Konva has better perf + React bindings. |
| State | **Zustand** + **Immer** + custom undo/redo middleware | Lightweight, fits an editor much better than Redux. |
| Drag & drop | **@dnd-kit** | Slide reorder, layer reorder, asset drop. |
| Styling | **Tailwind CSS v4** + **Radix UI** | Fast, accessible primitives. |
| Image processing | **Sharp** (server) + **Pica** / **Squoosh codecs (wasm)** (client) | Quality-preserving resize, encode JPEG/PNG/WebP/AVIF. |
| Background removal | **`@imgly/background-removal`** (ONNX in-browser) | Free, runs locally, no API key. |
| Drawing | Konva `Line` with bezier smoothing | Pressure via Pointer Events. |
| Storage | **IndexedDB** via `idb-keyval` for projects + **OPFS** for asset blobs | Local-first, no server needed. Optional cloud sync later. |
| Export ZIP | **JSZip** | Per-slide PNG/JPG bundle. |
| Fonts | **Fontsource** (self-hosted Google Fonts) | 70+ variable fonts, no CDN tracking. |
| Tests | Vitest + Playwright | Unit + visual regression for canvas. |

### Stack B — Native cross-platform (if mobile parity is the priority)
| Layer | Choice |
| --- | --- |
| Shell | **Expo + React Native** (iOS/Android/web via RN-Web) |
| Canvas | **`@shopify/react-native-skia`** (GPU-accelerated, same Skia as Flutter/Chrome) |
| Sharing | `expo-sharing`, `expo-media-library` |
| BG removal | CoreML on iOS / MLKit on Android, fallback ONNX |

**My pick:** Stack A first → ship a great PWA that's installable on iPhone/Android.
Wrap in Capacitor if/when native APIs (direct IG share, share-sheet) are needed.
Reserve Stack B for a real native rewrite once the engine is stable.

---

## 4. Architecture overview

```
                    ┌─────────────────────────────┐
                    │  UI (React + Tailwind)      │
                    │  toolbar | canvas | panels  │
                    └──────────────┬──────────────┘
                                   │ commands
                    ┌──────────────▼──────────────┐
                    │  Editor Store (Zustand)     │
                    │  document + selection +     │
                    │  history (command pattern)  │
                    └──────────────┬──────────────┘
                                   │ render model
                    ┌──────────────▼──────────────┐
                    │  Render Engine (Konva)      │
                    │  one Stage per slide,       │
                    │  shared off-screen cache    │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌────────────────┐         ┌────────────────┐        ┌──────────────────┐
│  Asset Store   │         │  Workers       │        │  Export Pipeline │
│  IndexedDB +   │         │  resize / bg-  │        │  Pica → encoder  │
│  OPFS blobs    │         │  removal / OCR │        │  → JSZip → save  │
└────────────────┘         └────────────────┘        └──────────────────┘
```

### 4.1 Document model (`.osc` JSON)
```ts
type Document = {
  id: string;
  version: 1;
  name: string;
  format: { width: number; height: number };   // per slide
  slideCount: number;
  bleed: number;                                // px overlap for seam-safe design
  background: Fill;
  slides: Slide[];                              // length = slideCount
  spanningLayers: Layer[];                      // layers that cross slides (carousel)
  meta: { createdAt: string; updatedAt: string; appVersion: string };
};

type Slide   = { id: string; layers: Layer[]; background?: Fill };
type Layer   = ImageLayer | VideoLayer | TextLayer | ShapeLayer | StickerLayer | DrawLayer | GroupLayer;
type Fill    = { kind: 'solid'; color: string }
             | { kind: 'gradient'; stops: GradientStop[]; angle: number }
             | { kind: 'image'; assetId: string; fit: 'cover'|'contain'|'tile' };

interface BaseLayer {
  id: string; name: string;
  x: number; y: number; w: number; h: number; rotation: number;
  opacity: number; locked: boolean; visible: boolean;
  blendMode?: GlobalCompositeOperation;
  shadow?: Shadow; mask?: Mask;
}
```
Assets (binary) live in OPFS keyed by SHA-256 hash → automatic dedupe + cheap import.

### 4.2 Command pattern for undo/redo
Every mutation is a `Command` with `do()` / `undo()`. Enables non-linear history,
multi-user collab later, and reliable serialisation of edits.

### 4.3 Render strategy (the bit that fixes SCRL's slowness)
- One `<Stage>` per visible slide (max 3 mounted at a time, others virtualised).
- Off-screen `OffscreenCanvas` per slide for thumbnails + export.
- Heavy ops (resize, BG removal, filters) run in **Web Workers** with transferable
  `ImageBitmap`s — never block the UI thread.
- Source assets stored at native resolution; the canvas displays a downscaled cache,
  but **export always renders from the original**, in a worker, at full quality.

---

## 5. Phased roadmap

### Phase 0 — Foundations (week 1)
- [ ] Repo init: Vite + React + TS + Tailwind + Konva + Zustand
- [ ] CI (GitHub Actions: typecheck, lint, test, build)
- [ ] License (MIT or AGPL — see §11)
- [ ] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, basic README
- [ ] Document model TS types + JSON schema + round-trip tests

### Phase 1 — MVP editor (weeks 2–4)
Goal: open the app, make a real 10-slide carousel, export a clean ZIP.
- [ ] App shell: top bar, left panel (slides), center (canvas), right panel (inspector)
- [ ] Format presets + custom dimensions
- [ ] Image layer: drag/drop import, move/scale/rotate, crop
- [ ] Text layer: 10 hand-picked fonts, color, alignment, basic styling
- [ ] Shape layer: rect, ellipse, line
- [ ] Layer panel: reorder, lock, hide, rename, delete, duplicate
- [ ] Undo / redo (50 step minimum)
- [ ] Project save/load (IndexedDB) + autosave every 10s
- [ ] Per-slide PNG export + ZIP

### Phase 2 — Carousel superpowers (weeks 5–6)
The headline feature; what makes us SCRL-equivalent.
- [ ] **Wide-mode toggle** — view all slides as one long canvas
- [ ] **Auto-split**: drop a wide image, choose slide count, auto-bleed
- [ ] **Spanning layers** that cross slide seams; seam guides
- [ ] **Snap-to-grid** + smart guides between layers (within and across slides)
- [ ] Slide reorder (drag) + duplicate + insert / delete
- [ ] "Face-safe seam" detector — warn if a face lands on a slide boundary

### Phase 3 — Asset libraries (weeks 7–8)
- [ ] Fontsource integration: 70+ variable fonts, lazy-loaded
- [ ] Sticker pack format (zip of SVGs + `manifest.json`); ship 5 starter packs (CC0)
- [ ] Frame catalog (SVG)
- [ ] Template catalog (`.osc` files + thumbnails); ship ~30 starter templates
- [ ] Search + tag filter for everything
- [ ] User-imported fonts / stickers / templates

### Phase 4 — Pro editing (weeks 9–10)
- [ ] Filters + adjustments (LUT-based; ship 20 looks)
- [ ] Gradients (linear + radial) for fill / text / background
- [ ] Background removal (`@imgly/background-removal` in worker)
- [ ] Freehand pen + eraser
- [ ] Layer masks (clip to shape, alpha mask)
- [ ] Blend modes
- [ ] Group / ungroup, align / distribute

### Phase 5 — Polish & native (weeks 11–13)
- [ ] PWA manifest + offline + installable
- [ ] Capacitor wrapper (iOS + Android) for native share-sheet
- [ ] Touch gestures: pinch-zoom canvas, two-finger rotate, three-finger undo
- [ ] Keyboard shortcuts (Figma-like)
- [ ] Accessibility pass (focus, ARIA, high-contrast)
- [ ] i18n scaffold (English first)

### Phase 6 — Beyond SCRL (post-v1 ideas)
- [ ] Video layer + per-slide video clips for Reels covers
- [ ] Animation timeline → MP4 export for Reels
- [ ] Brand kits (saved palettes, fonts, logos)
- [ ] AI text-suggest captions / hashtags (BYO key, optional)
- [ ] Local LLM template designer (à la `open-carrusel`)
- [ ] Cloud sync (optional, self-hostable; CRDT-based with Yjs)
- [ ] Real-time collab
- [ ] Direct posting via Instagram Graph API (requires app review)

---

## 6. UI / UX layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  ☰  Open-SCRL   [Project name]   ⤺ ⤻   Format ▾   Export ▾   Share  │  ← top bar
├──────────────┬─────────────────────────────────────┬──────────────────┤
│  Templates   │                                     │  Inspector       │
│  Photos      │            ┌──────────┐             │  ─ Position      │
│  Text        │            │          │             │  ─ Size          │
│  Shapes      │            │  CANVAS  │             │  ─ Fill          │
│  Stickers    │            │          │             │  ─ Stroke        │
│  Frames      │            └──────────┘             │  ─ Effects       │
│  Drawing     │                                     │                  │
│  Bg removal  │  zoom: [ - 75% + ]  fit  100%       │  Layers          │
│              │                                     │  ─ ▾ Slide 2     │
│              │                                     │     • Photo      │
│              │                                     │     • Text       │
├──────────────┴─────────────────────────────────────┴──────────────────┤
│  [▦ wide]  ◀  ▢ ▢ ▣ ▢ ▢ ▢ ▢ ▢ ▢ ▢  ▶   + slide                       │  ← filmstrip
└───────────────────────────────────────────────────────────────────────┘
```

- **Left rail:** tool/asset categories (icon + label).
- **Center:** active slide(s); toggle "Wide mode" pulls all slides into one strip.
- **Right rail:** context-sensitive inspector (top) + layers panel (bottom).
- **Bottom:** filmstrip of slides — drag to reorder, click to focus.
- **Mobile:** rails collapse into bottom sheet tabs; filmstrip moves to top.

---

## 7. Open content sources (so we ship with great defaults)

- **Fonts:** Fontsource (Google Fonts, OFL).
- **Icons / UI:** lucide-react (ISC).
- **Stickers / overlays:** SVGRepo CC0, openmoji (CC-BY-SA — keep separate pack),
  custom commissioned set.
- **Photo filters / LUTs:** ship hand-tuned LUTs (3D `.cube` parsed at build).
- **Templates:** community contributions via PR; `.osc` JSON in `/content/templates`.
- **Sample stock photos:** Unsplash / Pexels API for the in-app picker (optional,
  user-key required for full-res).

---

## 8. Performance budget (the SCRL killer)

| Metric | Target |
| --- | --- |
| Cold load on 4G mid-tier mobile | < 3 s to interactive |
| Time to add a 12 MP photo to a slide | < 200 ms perceived |
| Frame rate while dragging a layer | 60 fps with up to 50 layers |
| RAM with 20 slides × 10 layers | < 600 MB (vs SCRL crashing at ~50 layers) |
| Export 10 slides at 1080×1350 PNG | < 8 s on M-class laptop |
| Quality loss vs source on JPEG export at q=95 | SSIM > 0.99 |

Enforced via Playwright perf tests in CI on a budget machine.

---

## 9. Repository layout (proposed)

```
open-scrl/
├── apps/
│   ├── web/                  # Vite PWA (Stack A)
│   └── mobile/               # Expo shell (later, Stack B)
├── packages/
│   ├── engine/               # framework-free editor core (document, commands, render)
│   ├── ui/                   # shared React components
│   ├── workers/              # web-worker entrypoints (resize, bg-removal, export)
│   └── schemas/              # zod schemas for .osc + templates
├── content/
│   ├── templates/            # .osc + thumbnails
│   ├── stickers/             # zipped packs
│   └── fonts/                # licence files only (fonts via Fontsource)
├── docs/                     # spec, architecture, contributing
├── .github/workflows/
└── PLAN.md                   # this file
```

A monorepo (pnpm workspaces + Turborepo) keeps `engine` reusable for the eventual
native shell and CLI export tool.

---

## 10. Quality, tests, and CI

- **Unit:** Vitest for engine + commands + serialisation round-trip.
- **Snapshot:** render each starter template to PNG, hash, compare.
- **Visual regression:** Playwright + `@argos-ci/playwright` (or local pixelmatch).
- **Perf:** Playwright trace + size-limit on bundle.
- **Lint:** ESLint + Prettier + `tsc --noEmit`.
- **Pre-commit:** lint-staged + Husky.

---

## 11. Legal & ethical guardrails

- **Don't reuse SCRL's brand, art, fonts, or templates.** Reimplement features; ship
  fresh assets and templates.
- **Choose a license:**
  - **MIT** — maximum adoption; fine if you don't mind a fork going closed.
  - **AGPL-3.0** — strongest copyleft; any hosted fork must publish source. Fits the
    "no closed-source clone of our open clone" intent.
  - Recommend **AGPL-3.0** for the app and **MIT** for the `engine` package so the
    core is freely embeddable.
- **Bundled assets:** every font/sticker/template ships with a `LICENSE` and is listed
  in `THIRD_PARTY_NOTICES.md`.
- **Trademark:** ship under a clearly different name and logo. Do not call it "SCRL".

---

## 12. Distribution & sustainability (optional)

- **Hosting:** Vercel / Cloudflare Pages free tier handles a static PWA forever.
- **Native:** Capacitor → TestFlight / Play Internal Track. Apple dev account needed
  ($99/yr) only when you're ready to publish.
- **Sustainability without paywall:** GitHub Sponsors, Open Collective, optional
  hosted "team workspace" SaaS later (cloud sync only — editor stays free).

---

## 13. Immediate next steps (what we'd do first)

1. **Confirm scope with you** (5 min):
   - Web first vs mobile first?
   - Just a personal tool or aiming for public OSS release?
   - License preference (MIT vs AGPL)?
   - Project name?
2. **Scaffold Phase 0** — Vite + React + TS + Tailwind + Konva + Zustand monorepo,
   CI green, doc model + tests passing.
3. **Build a vertical slice** — one slide, drop a photo, move it, export PNG. Proves
   the engine + worker + export pipeline end-to-end before any UI polish.
4. **Iterate to MVP** through Phase 1 deliverables.

---

## 14. Open questions for you

- **Platforms** — Mac/Web is enough, or do you want iPhone day 1 (changes Stack)?
- **Account / cloud sync** — local-only forever, or optional cloud later?
- **Template authoring** — happy with JSON-by-hand at first, or want a built-in
  "save as template" flow in MVP?
- **AI features** — ok to ship local-only ML (background removal, ~30 MB model), or
  keep download size minimal?
- **Premium SCRL features you use most** — tells us what to prioritise first
  (templates? grids? video? bg removal? gradients?).

Tell me which of those you care about and I'll spin up Phase 0 (repo scaffolding,
document model, vertical-slice export) on the next pass.
