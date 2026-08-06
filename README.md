# Open-SCRL

An open-source, MIT-licensed photo grid + Instagram carousel maker. PWA, runs
entirely in your browser, no accounts, no subscriptions, no telemetry.

A free alternative to [SCRL](https://scrl.com) (Appostrophe AB).

## Status

Early-stage personal project. Phase 1 MVP is functional:

- Multi-slide projects, every Instagram / TikTok / Pinterest format preset.
- Drop or import photos, animated GIFs, and videos. Stored locally in IndexedDB/OPFS.
- **Photo grid templates** (1×1, 2×2, 3×3, 1+2, 2+1, L-shape, 1+4, 3+2, 3+3, …)
  with adjustable gap. Auto-fills with your imported photos.
- **Smart snapping** — alignment guides between layers + canvas edges/center.
- **Layer control** — reorder (drag or arrow buttons), lock, hide, rename,
  duplicate, delete.
- Image, text, shape (rect / ellipse) layers with full inspector panel.
- Solid + linear gradient backgrounds.
- Transactional undo / redo (80 steps with a 32 MB patch budget), keyboard shortcuts.
- Per-slide PNG export and full-project H.264 MP4 export for Instagram.
- Transactional autosave to IndexedDB; reopens existing projects through a versioned migration.
- Viewport-sized canvas rendering, worker imports, OPFS-backed originals, and bounded decoded-image memory.
- Resolution-aware 1024/2048/4096px preview tiers with delayed detail upgrades and a 192 MB LRU-style bitmap budget.
- Installable PWA.

See `PLAN.md` for the long-term roadmap.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173.

```bash
npm run build      # production build (PWA enabled)
npm run preview    # preview the build
```

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Undo | ⌘Z / Ctrl+Z |
| Redo | ⌘⇧Z / Ctrl+Y |
| Duplicate selected layer | ⌘D / Ctrl+D |
| Delete selected layer | Delete / Backspace |
| Pan / zoom canvas | scroll / pinch (⌘+scroll = faster zoom) |
| Edit text in place | double-click a text layer |

## Tech

Vite + React 19 + TypeScript · Konva (`react-konva`) for the viewport renderer ·
Zustand + Immer patches for state/history · Tailwind v3 · `@dnd-kit/sortable`
for layer reorder · `idb` + OPFS for local persistence · worker-backed Canvas2D
export + Zip.js · WebCodecs + MP4 muxing for video export · `vite-plugin-pwa` for service worker + manifest.

## Layout

```
src/
  App.tsx                        lazy shell + autosave + global hotkeys
  app/EditorShell.tsx            editor-only lazy boundary
  main.tsx                       entry
  index.css                      tailwind + component classes
  types.ts                       Document / Slide / Layer model
  core/                          framework-independent document + scene model
  editor/                        document/session stores, history, persistence
  assets/                        metadata repository, OPFS/IDB storage, imports
  export/                        shared Canvas2D renderer + export worker
  render/                        Konva viewport + bounded image resources
  storage/                       transactional IndexedDB database
  store/                         compatibility exports + asset UI state
  lib/
    format.ts                    canvas size presets
    grids.ts                     photo grid template definitions
    snap.ts                      snapping math (returns guides)
    assets.ts                    asset repository compatibility facade
    export.ts                    image/video export compatibility facade
    nano.ts                      ids + helpers
  components/
    TopBar.tsx                   project name, format, undo/redo, export
    LeftRail.tsx                 tool tabs
    RightPanel.tsx               inspector + layers
    Inspector.tsx                per-layer property inspector
    LayersPanel.tsx              draggable layer list
    Filmstrip.tsx                slide thumbnails / reorder
    canvas/
      Canvas.tsx                 main Konva stage with snapping
      ImageNode.tsx              image layer renderer
      TextNode.tsx               text layer renderer
      ShapeNode.tsx              shape layer renderer
      TextEditor.tsx             in-place text editing overlay
    panels/
      TemplatesPanel.tsx         photo grid picker
      PhotosPanel.tsx            asset library
      TextPanel.tsx              text presets
      ShapesPanel.tsx            shape picker
      BackgroundPanel.tsx        solids + gradients
```

## License

MIT — see [LICENSE](./LICENSE).
