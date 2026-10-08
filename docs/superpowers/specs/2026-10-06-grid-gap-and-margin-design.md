# Editable photo-grid gap and outer margin

Date: 2026-10-06 · Scope: web app (`src/`) and Mac app (`macos/`)

## Problem

Applying a photo grid is a one-shot bake. `applyGrid(template, gap)` (web: `src/editor/documentStore.ts`, Mac: `EditorController.applyGrid`) deletes every layer on the slide and creates independent, locked image layers sized from `template.cells(W, H, gap)`. The gap value is not saved, so after insertion there is nothing to re-adjust. Every template also fills the slide edge to edge, so there is no outer margin at all.

## Goals

1. Adjust the **gap between photos** after a grid is inserted.
2. Add an **outer margin** (space between the grid and the slide edge), independent of the gap, usable at insert time and afterwards.
3. Both apps, with the same stored data and the same behaviour.

## Non-goals

- Per-side margins (a single number is stored, so per-side can be added later without a schema break).
- Per-slot or per-row gaps.
- Detecting grids that were applied before this feature ships. Those slides have no grid record and keep today's behaviour (adjust slots by hand, or re-apply the grid).
- Grids that span several slides.

## Design

### Data model

Add an optional record to the slide. It is additive, so **`schemaVersion` stays 2** (the Mac app rejects unknown versions, and old documents need no migration).

```ts
// src/types.ts
interface SlideGrid {
  templateId: string;   // key into GRID_TEMPLATES
  gap: number;          // px in slide coordinates, 0..120
  margin: number;       // px, 0..120
  slotIds: string[];    // layer ids in template cell order
}
interface SlideRecord { /* existing */ grid?: SlideGrid }
```

Mirror it in Swift: `ProjectFile.SlideRecord.grid` and the matching `Slide` model field, encoded under the same JSON keys. Optional, so projects without it decode as before.

### Layout function (single source of truth per app)

`layoutGrid(template, format, gap, margin) -> GridCell[]` in `src/lib/grids.ts` (Swift: `Grids.swift`):

1. Inset rect: `x = y = margin`, `W' = W - 2·margin`, `H' = H - 2·margin`.
2. `cells = template.cells(W', H', gap)`, each cell offset by `(margin, margin)`.
3. Templates themselves are unchanged. They already take `(W, H, gap)`.
4. **Clamp.** The effective gap is reduced as needed so the smallest cell is at least 16 px in both dimensions. The effective margin is capped at `min(W, H) / 4`. The stored values are not rewritten; only the layout is clamped. The UI slider maximum is 120 or the clamped maximum, whichever is smaller.

Insert and re-layout both call this function, so the two paths cannot diverge.

### Behaviour

**Apply grid** (existing action): same as today (replaces all layers on the slide), plus writes `slide.grid = { templateId, gap, margin, slotIds }` using the panel's current gap and margin.

**Adjust grid** (new action `setSlideGrid(slideId, { gap?, margin? })`), one undoable command:

1. Compute `oldCells = layoutGrid(template, format, grid.gap, grid.margin)` and `newCells` from the new values.
2. For each `slotIds[i]` that still exists on the slide: if the layer's `x, y, width, height` match `oldCells[i]` within 0.5 px, set them to `newCells[i]`. Otherwise leave the layer alone (it was moved or resized by hand).
3. Never touch layers that are not in `slotIds` (text, shapes, extra photos), and never touch a slot's asset, crop, locked state, rotation or corner radius.
4. Save the new `gap` and `margin`.

Slider drags coalesce into one history entry (web: `mergeKey = grid:<slideId>`; Mac: coalesce key), labelled "Adjust Grid".

**Stale record rule:** the grid controls show only while the slide's `grid` exists and at least one `slotIds` entry is still in the slide's `layerOrder`. Deleting slots or clearing the slide therefore needs no extra cleanup hook, and the stale record is overwritten by the next apply.

### UI

Per the decision, values appear in two places:

- **Photo grids panel** (web `TemplatesPanel.tsx`, Mac `SidebarView.swift`): keep "Gap between photos" and add **"Outer margin"**, both 0–120 px. These set the values for the *next* grid inserted. The thumbnails preview both. Mac adds `gridMargin` next to `gridGap` on `EditorController`.
- **Slide inspector** (web `SlideInspector` in `Inspector.tsx`, Mac `SlideInspector.swift`), shown when no layer is selected: a **Grid** section when the stale-record rule says a live grid exists. It shows the template name, **Gap** and **Outer margin** sliders that edit the grid live, and a one-line hint ("N slots were moved by hand and won't follow") when any slot no longer matches its computed cell.

### Edge cases

- Moved or resized slots do not follow, and the hint says so. Setting gap and margin back to the values the slot was laid out with does not re-attach it.
- Duplicating a slide copies `grid`, and the duplicated slot layers need new ids. The `slotIds` remap must happen where slide duplication already re-ids layers (verify during planning).
- Changing the canvas format re-sizes nothing today; this feature does not change that. Slots then no longer match computed cells and are treated as "moved by hand".
- Export and rendering are unaffected, because slots are ordinary layers.

## Testing

- Unit tests (Vitest) for `layoutGrid`: margin 0 reproduces today's cells exactly for every template, margin offsets and shrinks, and clamping keeps cells ≥ 16 px for the smallest format (IG Landscape, 4-stack, margin 120).
- Store tests: adjusting gap or margin moves untouched slots and leaves a hand-moved slot, a text layer and filled assets unchanged; undo restores in one step; slider-drag coalescing; stale-record rule after deleting all slots.
- Persistence: a document with no `grid` loads and saves unchanged; a document with `grid` round-trips.
- Playwright smoke: apply a grid, change the inspector gap, assert slot geometry.
- Mac has no test target, so verify the same scenarios manually and check that a web-authored `project.json` with `grid` opens without error.

## Open items for planning

- Confirm how web slide duplication re-ids layers, and how Mac `Slide` duplication does it, to remap `slotIds`.
- Decide the epsilon source if a format uses non-integer cells (0.5 px assumed).
