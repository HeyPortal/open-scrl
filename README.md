# Open-SCRL

An open-source, MIT-licensed photo grid + Instagram carousel maker. PWA, runs
entirely in your browser, no accounts, no subscriptions, no telemetry.

A free alternative to [SCRL](https://scrl.com) (Appostrophe AB).

## Status

Early-stage personal project. Phase 1 MVP is functional:

- Multi-slide projects, every Instagram / TikTok / Pinterest format preset.
- Drop or import any number of photos. Stored locally in IndexedDB.
- **Photo grid templates** (1×1, 2×2, 3×3, 1+2, 2+1, L-shape, 1+4, 3+2, 3+3, …)
  with adjustable gap. Auto-fills with your imported photos.
- **Smart snapping** — alignment guides between layers + canvas edges/center.
- **Layer control** — reorder (drag or arrow buttons), lock, hide, rename,
  duplicate, delete.
- Image, text, shape (rect / ellipse) layers with full inspector panel.
- Solid + linear gradient backgrounds.
- Undo / redo (80 step history), keyboard shortcuts.
- Per-slide PNG export and full-project ZIP export.
- Autosave to IndexedDB every 5 s; reopens to your last project.
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

Vite + React 19 + TypeScript · Konva (`react-konva`) for canvas · Zustand +
Immer for state with undo/redo · Tailwind v3 · `@dnd-kit/sortable` for layer
reorder · `idb-keyval` for IndexedDB persistence · `jszip` for export ·
`vite-plugin-pwa` for service worker + manifest.

## Layout

```
src/
  App.tsx                        shell + autosave + global hotkeys
  main.tsx                       entry
  index.css                      tailwind + component classes
  types.ts                       Document / Slide / Layer model
  store/
    editor.ts                    Zustand store, undo/redo, mutations
  lib/
    format.ts                    canvas size presets
    grids.ts                     photo grid template definitions
    snap.ts                      snapping math (returns guides)
    assets.ts                    IndexedDB asset store
    export.ts                    Konva off-screen render → PNG / ZIP
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
