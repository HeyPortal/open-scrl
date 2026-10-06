# Editable Photo-Grid Gap and Outer Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a photo grid is inserted, let the user change the gap between photos and a new outer margin around the grid, in both the web and Mac apps.

**Architecture:** Each slide gets an optional `grid` record (`templateId`, `gap`, `margin`, `slotIds`). One pure `layoutGrid` function per app computes cells inside the margin-inset rectangle and clamps the gap. An "adjust grid" command recomputes old and new cells and moves only the slots still sitting at their old computed cell. Slots stay ordinary layers, so rendering and export are unchanged.

**Tech Stack:** Web: React 19, TypeScript, Zustand + Immer patches, Vitest, Playwright. Mac: SwiftUI/AppKit, Swift (no test target).

**Spec:** `docs/superpowers/specs/2026-10-06-grid-gap-and-margin-design.md`

## Global Constraints

- `schemaVersion` stays `2` on both sides. The new `grid` field is optional and additive. Do not touch migrations.
- Gap and margin range is 0–120 px in slide coordinates.
- Minimum cell side is 16 px. The effective gap is clamped to honour it. The effective margin is capped at `min(W, H) / 4`. Stored values are never rewritten by clamping.
- A slot "follows" a re-layout only if its `x, y, width, height` match its old computed cell within 0.5 px.
- Never modify layers that are not in `grid.slotIds`, and never modify a slot's asset, crop, `locked`, rotation or corner radius.
- Slider drags are one undo step. Undo label: "Adjust grid" (web) / "Adjust Grid" (Mac).
- `slotIds[i]` always corresponds to template cell `i`. Never compact or reorder it, even when slots are deleted.
- JSON key names are identical on both sides: `templateId`, `gap`, `margin`, `slotIds`.
- Web code style: `src/editor/documentStore.ts` and `src/lib/export.ts` are dense one-line-per-statement files. Match the surrounding style when editing them. New files use normal formatting.
- Xcode is not installed on the plan author's machine (only Command Line Tools). Mac tasks must be build-verified by whoever has Xcode 27; if you cannot build, say so rather than claiming success.

## Review Focus

1. Single-cell template (`single`) with a margin: the lone slot must be inset on all sides, not left full-bleed. (Task 1 test)
2. Smallest format (IG Landscape 1080×566) with gap 120 and margin 120 on every template: no cell below 16 px, no negative or NaN sizes. (Task 1 test)
3. A deleted slot in the middle of the grid: remaining slots must still map to their own cells, not shift by one. (Task 3 test)
4. Duplicated slide: adjusting the copy must not move the original's slots, and the copy's `slotIds` must be re-id'd and stay index-aligned. (Task 3 test; Mac in Task 6)
5. A `grid` with an unknown `templateId`, or whose slots were all deleted: no crash, no inspector section, `setSlideGrid` is a no-op. (Task 2/3 tests)
6. A drag of several slider ticks then undo: slots and stored gap/margin return together in one step. (Task 3 test)

---

### Task 1: Web grid layout function and types

**Files:**
- Modify: `src/types.ts` (add `SlideGrid`, extend `SlideRecord`)
- Modify: `src/lib/grids.ts` (append constants and functions at end of file)
- Create: `src/lib/grids.test.ts`

**Interfaces:**
- Produces:
  - `interface SlideGrid { templateId: string; gap: number; margin: number; slotIds: string[] }` (from `@/types`)
  - `SlideRecord.grid?: SlideGrid`
  - `MIN_CELL = 16`, `MAX_GRID_INSET = 120`
  - `maxMargin(width: number, height: number): number`
  - `layoutGrid(template: GridTemplate, format: { width: number; height: number }, gap: number, margin: number): GridCell[]`
  - `maxGapFor(template: GridTemplate, format: { width: number; height: number }, margin: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/grids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, MIN_CELL, layoutGrid, maxGapFor, maxMargin } from './grids';

const portrait = { width: 1080, height: 1350 };
const landscape = { width: 1080, height: 566 };
const tpl = (id: string) => GRID_TEMPLATES.find((t) => t.id === id)!;

describe('layoutGrid', () => {
  it('with margin 0 reproduces the template cells exactly', () => {
    for (const t of GRID_TEMPLATES) for (const gap of [0, 24]) {
      expect(layoutGrid(t, portrait, gap, 0)).toEqual(t.cells(portrait.width, portrait.height, gap));
    }
  });

  it('insets a single-cell template on every side', () => {
    expect(layoutGrid(tpl('single'), portrait, 0, 40)).toEqual([{ x: 40, y: 40, w: 1000, h: 1270 }]);
  });

  it('keeps every cell inside the margin rectangle', () => {
    for (const t of GRID_TEMPLATES) for (const c of layoutGrid(t, portrait, 20, 50)) {
      expect(c.x).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(c.y).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(c.x + c.w).toBeLessThanOrEqual(portrait.width - 50 + 1e-6);
      expect(c.y + c.h).toBeLessThanOrEqual(portrait.height - 50 + 1e-6);
    }
  });

  it('never produces a cell under the minimum size, even at maximum gap and margin on the shortest format', () => {
    for (const t of GRID_TEMPLATES) for (const c of layoutGrid(t, landscape, 120, 120)) {
      expect(Number.isFinite(c.w) && Number.isFinite(c.h)).toBe(true);
      expect(c.w).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
      expect(c.h).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
    }
  });
});

describe('limits', () => {
  it('caps the margin at a quarter of the shorter side or 120', () => {
    expect(maxMargin(1080, 566)).toBe(120);
    expect(maxMargin(200, 200)).toBe(50);
  });

  it('maxGapFor never exceeds 120 and its layout needs no further clamping', () => {
    for (const t of GRID_TEMPLATES) {
      const max = maxGapFor(t, landscape, 120);
      expect(max).toBeLessThanOrEqual(120);
      expect(max).toBeGreaterThanOrEqual(0);
      const side = Math.min(...layoutGrid(t, landscape, max, 120).flatMap((c) => [c.w, c.h]));
      expect(side).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/grids.test.ts`
Expected: FAIL — `layoutGrid`, `MIN_CELL`, `maxGapFor`, `maxMargin` are not exported.

- [ ] **Step 3: Add the types**

In `src/types.ts`, replace the `SlideRecord` interface with:

```ts
export interface SlideGrid {
  templateId: string;
  gap: number;
  margin: number;
  slotIds: string[];
}

export interface SlideRecord {
  id: string;
  background: Background;
  layerOrder: string[];
  grid?: SlideGrid;
}
```

- [ ] **Step 4: Implement the layout functions**

Append to the end of `src/lib/grids.ts`:

```ts
export const MIN_CELL = 16;
export const MAX_GRID_INSET = 120;

type Size = { width: number; height: number };

export function maxMargin(width: number, height: number): number {
  return Math.min(MAX_GRID_INSET, Math.floor(Math.min(width, height) / 4));
}

const smallestSide = (cells: GridCell[]) => Math.min(...cells.flatMap((c) => [c.w, c.h]));

/** Largest gap <= `gap` (>= 0) for which every cell is at least MIN_CELL on both sides. */
function effectiveGap(template: GridTemplate, W: number, H: number, gap: number): number {
  const want = Math.max(0, gap);
  if (smallestSide(template.cells(W, H, want)) >= MIN_CELL) return want;
  let lo = 0;
  let hi = want;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (smallestSide(template.cells(W, H, mid)) >= MIN_CELL) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Cells for `template` inside a `margin`-inset slide, with the gap clamped so no cell is tiny. */
export function layoutGrid(template: GridTemplate, format: Size, gap: number, margin: number): GridCell[] {
  const m = Math.min(Math.max(0, margin), maxMargin(format.width, format.height));
  const W = format.width - 2 * m;
  const H = format.height - 2 * m;
  const g = effectiveGap(template, W, H, gap);
  return template.cells(W, H, g).map((c) => ({ x: c.x + m, y: c.y + m, w: c.w, h: c.h }));
}

/** Slider maximum for the gap: 120, or less when the template would drop below MIN_CELL. */
export function maxGapFor(template: GridTemplate, format: Size, margin: number): number {
  const m = Math.min(Math.max(0, margin), maxMargin(format.width, format.height));
  return Math.floor(effectiveGap(template, format.width - 2 * m, format.height - 2 * m, MAX_GRID_INSET));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/grids.test.ts && npm run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/grids.ts src/lib/grids.test.ts
git commit -m "feat(grid): add SlideGrid type and margin-aware layoutGrid"
```

---

### Task 2: Web live-grid helper

**Files:**
- Create: `src/core/document/grid.ts`
- Create: `src/core/document/grid.test.ts`

**Interfaces:**
- Consumes: `layoutGrid`, `GRID_TEMPLATES`, `GridCell`, `GridTemplate` from `@/lib/grids`; `SlideGrid`, `ProjectDocumentV2`, `Layer` from `@/types`.
- Produces:
  - `SLOT_EPSILON = 0.5`
  - `slotMatchesCell(layer: Pick<Layer, 'x' | 'y' | 'width' | 'height'>, cell: GridCell): boolean`
  - `interface LiveGrid { grid: SlideGrid; template: GridTemplate; liveSlots: number; movedSlots: number }`
  - `getLiveGrid(doc: ProjectDocumentV2, slideId: string): LiveGrid | null` — `null` when the slide has no grid, the template id is unknown, or no slot layer is still on the slide.

- [ ] **Step 1: Write the failing tests**

Create `src/core/document/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, layoutGrid } from '@/lib/grids';
import type { ImageLayer, ProjectDocumentV2 } from '@/types';
import { newDocument } from '@/editor/documentStore';
import { getLiveGrid, slotMatchesCell } from './grid';

const template = GRID_TEMPLATES.find((t) => t.id === 'four-grid')!;

function docWithGrid(gap = 10, margin = 0): ProjectDocumentV2 {
  const doc = newDocument();
  const slideId = doc.slideOrder[0];
  const cells = layoutGrid(template, doc.format, gap, margin);
  const slotIds = cells.map((_, i) => `slot${i}`);
  cells.forEach((c, i) => {
    doc.layers[slotIds[i]] = { id: slotIds[i], kind: 'image', name: `Photo ${i + 1}`, x: c.x, y: c.y, width: c.w, height: c.h, rotation: 0, opacity: 1, visible: true, locked: true, assetId: null, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 } as ImageLayer;
  });
  doc.slides[slideId].layerOrder = [...slotIds];
  doc.slides[slideId].grid = { templateId: template.id, gap, margin, slotIds };
  return doc;
}

describe('slotMatchesCell', () => {
  it('tolerates half a pixel and nothing more', () => {
    const cell = { x: 10, y: 20, w: 100, h: 200 };
    expect(slotMatchesCell({ x: 10.4, y: 20, width: 100, height: 200 }, cell)).toBe(true);
    expect(slotMatchesCell({ x: 10.6, y: 20, width: 100, height: 200 }, cell)).toBe(false);
  });
});

describe('getLiveGrid', () => {
  it('is null for a slide without a grid', () => {
    const doc = newDocument();
    expect(getLiveGrid(doc, doc.slideOrder[0])).toBeNull();
  });

  it('counts live and hand-moved slots', () => {
    const doc = docWithGrid();
    doc.layers.slot2.x += 30;
    const live = getLiveGrid(doc, doc.slideOrder[0])!;
    expect(live.template.id).toBe('four-grid');
    expect(live.liveSlots).toBe(4);
    expect(live.movedSlots).toBe(1);
  });

  it('ignores slots that were deleted and goes null when none remain', () => {
    const doc = docWithGrid();
    const slide = doc.slides[doc.slideOrder[0]];
    slide.layerOrder = slide.layerOrder.filter((id) => id !== 'slot1');
    expect(getLiveGrid(doc, doc.slideOrder[0])!.liveSlots).toBe(3);
    slide.layerOrder = [];
    expect(getLiveGrid(doc, doc.slideOrder[0])).toBeNull();
  });

  it('is null for a template id this build does not know', () => {
    const doc = docWithGrid();
    doc.slides[doc.slideOrder[0]].grid!.templateId = 'from-the-future';
    expect(getLiveGrid(doc, doc.slideOrder[0])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/document/grid.test.ts`
Expected: FAIL — module `./grid` not found.

- [ ] **Step 3: Implement**

Create `src/core/document/grid.ts`:

```ts
import { GRID_TEMPLATES, layoutGrid, type GridCell, type GridTemplate } from '@/lib/grids';
import type { Layer, ProjectDocumentV2, SlideGrid } from '@/types';

export const SLOT_EPSILON = 0.5;

export function slotMatchesCell(layer: Pick<Layer, 'x' | 'y' | 'width' | 'height'>, cell: GridCell): boolean {
  return (
    Math.abs(layer.x - cell.x) <= SLOT_EPSILON &&
    Math.abs(layer.y - cell.y) <= SLOT_EPSILON &&
    Math.abs(layer.width - cell.w) <= SLOT_EPSILON &&
    Math.abs(layer.height - cell.h) <= SLOT_EPSILON
  );
}

export interface LiveGrid {
  grid: SlideGrid;
  template: GridTemplate;
  liveSlots: number;
  movedSlots: number;
}

/** The slide's grid if it is still meaningful: known template and at least one slot still on the slide. */
export function getLiveGrid(doc: ProjectDocumentV2, slideId: string): LiveGrid | null {
  const slide = doc.slides[slideId];
  const grid = slide?.grid;
  if (!slide || !grid) return null;
  const template = GRID_TEMPLATES.find((t) => t.id === grid.templateId);
  if (!template) return null;
  const onSlide = new Set(slide.layerOrder);
  const cells = layoutGrid(template, doc.format, grid.gap, grid.margin);
  let liveSlots = 0;
  let movedSlots = 0;
  grid.slotIds.forEach((id, i) => {
    const layer = doc.layers[id];
    if (!layer || !onSlide.has(id) || !cells[i]) return;
    liveSlots++;
    if (!slotMatchesCell(layer, cells[i])) movedSlots++;
  });
  return liveSlots > 0 ? { grid, template, liveSlots, movedSlots } : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/document/grid.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/document/grid.ts src/core/document/grid.test.ts
git commit -m "feat(grid): add getLiveGrid and slot matching"
```

---

### Task 3: Web store — apply with margin, adjust grid, duplicate remap

**Files:**
- Modify: `src/editor/documentStore.ts` (imports at lines 6 and ~11; interface lines 72 and 77; `applyGrid` at ~337-338; `duplicateSlide` at ~305-312; add `setSlideGrid` after `applyGrid`)
- Create: `src/editor/documentStore.grid.test.ts`

**Interfaces:**
- Consumes: `layoutGrid` (Task 1), `getLiveGrid`, `slotMatchesCell` (Task 2).
- Produces:
  - `applyGrid(template: GridTemplate, gap: number, margin?: number): void` (margin defaults to 0, so `actions.ts:191` keeps working)
  - `setSlideGrid(slideId: string, patch: { gap?: number; margin?: number }): void`

- [ ] **Step 1: Write the failing tests**

Create `src/editor/documentStore.grid.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, layoutGrid } from '@/lib/grids';
import { getLiveGrid } from '@/core/document/grid';
import { newDocument, useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';

const four = GRID_TEMPLATES.find((t) => t.id === 'four-grid')!;
const store = () => useDocumentStore.getState();
const sid = () => store().doc.slideOrder[0];
const slotIds = (slideId = sid()) => store().doc.slides[slideId].grid!.slotIds;
const frame = (id: string) => { const l = store().doc.layers[id]; return { x: l.x, y: l.y, w: l.width, h: l.height }; };

beforeEach(() => {
  useDocumentStore.setState({ doc: newDocument(), past: [], future: [], transaction: null, selectedSlideId: '' });
  useEditorSession.setState({ selectedSlideId: '' });
});

describe('applyGrid', () => {
  it('records the grid and lays the slots out inside the margin', () => {
    store().applyGrid(four, 24, 40);
    expect(store().doc.slides[sid()].grid).toMatchObject({ templateId: 'four-grid', gap: 24, margin: 40 });
    const cells = layoutGrid(four, store().doc.format, 24, 40);
    slotIds().forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
  });

  it('defaults the margin to 0', () => {
    store().applyGrid(four, 24);
    expect(store().doc.slides[sid()].grid!.margin).toBe(0);
  });
});

describe('setSlideGrid', () => {
  it('moves untouched slots and leaves hand-moved slots, other layers and filled assets alone', () => {
    store().applyGrid(four, 0, 0);
    store().addTextLayer();
    const [a, b, c] = slotIds();
    const textId = store().doc.slides[sid()].layerOrder.find((id) => !slotIds().includes(id))!;
    const textBefore = { ...store().doc.layers[textId] };
    store().updateLayer(b, { x: 500 });
    store().updateLayer(a, { assetId: 'asset-1', cropScale: 2 } as never);
    const bBefore = frame(b);

    store().setSlideGrid(sid(), { gap: 30 });

    const cells = layoutGrid(four, store().doc.format, 30, 0);
    expect(frame(a)).toEqual(cells[0]);
    expect(frame(c)).toEqual(cells[2]);
    expect(frame(b)).toEqual(bBefore);
    expect(store().doc.layers[a]).toMatchObject({ assetId: 'asset-1', cropScale: 2, locked: true });
    expect(store().doc.layers[textId]).toEqual(textBefore);
    expect(store().doc.slides[sid()].grid!.gap).toBe(30);
  });

  it('changes the margin independently of the gap', () => {
    store().applyGrid(four, 20, 0);
    store().setSlideGrid(sid(), { margin: 60 });
    const cells = layoutGrid(four, store().doc.format, 20, 60);
    slotIds().forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
    expect(store().doc.slides[sid()].grid).toMatchObject({ gap: 20, margin: 60 });
  });

  it('keeps the remaining slots on their own cells when a middle slot was deleted', () => {
    store().applyGrid(four, 0, 0);
    store().deleteLayer(slotIds()[1]);
    store().setSlideGrid(sid(), { gap: 20 });
    const cells = layoutGrid(four, store().doc.format, 20, 0);
    expect(frame(slotIds()[0])).toEqual(cells[0]);
    expect(frame(slotIds()[2])).toEqual(cells[2]);
    expect(frame(slotIds()[3])).toEqual(cells[3]);
  });

  it('undoes a multi-tick drag as one step and restores slots and values together', () => {
    store().applyGrid(four, 0, 0);
    const before = store().past.length;
    const tx = store().beginTransaction('Adjust grid', 'gesture:grid');
    for (const gap of [5, 15, 40]) store().setSlideGrid(sid(), { gap });
    store().commitTransaction(tx);
    expect(store().past.length).toBe(before + 1);

    store().undo();

    const cells = layoutGrid(four, store().doc.format, 0, 0);
    slotIds().forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
    expect(store().doc.slides[sid()].grid!.gap).toBe(0);
  });

  it('is a no-op for an unknown template and for a value that has not changed', () => {
    store().applyGrid(four, 10, 0);
    const doc = store().doc;
    store().setSlideGrid(sid(), { gap: 10 });
    expect(store().doc).toBe(doc);
    useDocumentStore.setState((s) => ({ doc: { ...s.doc, slides: { ...s.doc.slides, [sid()]: { ...s.doc.slides[sid()], grid: { ...s.doc.slides[sid()].grid!, templateId: 'nope' } } } } }));
    const unknown = store().doc;
    store().setSlideGrid(sid(), { gap: 50 });
    expect(store().doc).toBe(unknown);
  });

  it('stops being live once every slot is deleted', () => {
    store().applyGrid(four, 10, 0);
    for (const id of [...slotIds()]) store().deleteLayer(id);
    expect(getLiveGrid(store().doc, sid())).toBeNull();
  });
});

describe('duplicateSlide with a grid', () => {
  it('re-ids the copied slots so adjusting the copy does not move the original', () => {
    store().applyGrid(four, 0, 0);
    const original = [...slotIds()];
    store().duplicateSlide(sid());
    const copyId = store().doc.slideOrder[1];
    const copy = slotIds(copyId);

    expect(copy).toHaveLength(original.length);
    expect(copy.some((id) => original.includes(id))).toBe(false);
    expect(copy.every((id) => store().doc.slides[copyId].layerOrder.includes(id))).toBe(true);

    store().setSlideGrid(copyId, { gap: 40 });

    const wide = layoutGrid(four, store().doc.format, 40, 0);
    const flush = layoutGrid(four, store().doc.format, 0, 0);
    copy.forEach((id, i) => expect(frame(id)).toEqual(wide[i]));
    original.forEach((id, i) => expect(frame(id)).toEqual(flush[i]));
  });

  it('keeps copied slotIds aligned with cells when a slot was deleted before duplicating', () => {
    store().applyGrid(four, 0, 0);
    store().deleteLayer(slotIds()[1]);
    store().duplicateSlide(sid());
    const copyId = store().doc.slideOrder[1];
    store().setSlideGrid(copyId, { gap: 20 });
    const cells = layoutGrid(four, store().doc.format, 20, 0);
    expect(frame(slotIds(copyId)[2])).toEqual(cells[2]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/editor/documentStore.grid.test.ts`
Expected: FAIL — `setSlideGrid` is not a function; `grid` is undefined.

- [ ] **Step 3: Update imports and the store interface**

In `src/editor/documentStore.ts`:

Replace `import type { GridTemplate } from '@/lib/grids';` with:

```ts
import { layoutGrid, type GridTemplate } from '@/lib/grids';
```

Add below the `migrations` import:

```ts
import { getLiveGrid, slotMatchesCell } from '@/core/document/grid';
```

In the state interface, replace `applyGrid(template: GridTemplate, gap: number): void;` with:

```ts
  applyGrid(template: GridTemplate, gap: number, margin?: number): void;
  setSlideGrid(slideId: string, patch: { gap?: number; margin?: number }): void;
```

- [ ] **Step 4: Replace `applyGrid` and add `setSlideGrid`**

Replace the whole `applyGrid:` entry (the two lines starting `applyGrid: (template,gap) => {` through its closing `},`) with:

```ts
  applyGrid: (template,gap,margin=0) => { const s=get();const sid=useEditorSession.getState().selectedSlideId||s.doc.slideOrder[0];const cells=layoutGrid(template,s.doc.format,gap,margin);
    get().execute(command('Apply grid',(d)=>{for(const lid of d.slides[sid].layerOrder)delete d.layers[lid];d.slides[sid].layerOrder=[];const slotIds:string[]=[];cells.forEach((c,i)=>{const lid=id();slotIds.push(lid);d.layers[lid]={id:lid,kind:'image',name:`Photo ${i+1}`,x:c.x,y:c.y,width:c.w,height:c.h,rotation:0,opacity:1,visible:true,locked:true,assetId:null,cornerRadius:0,cropOffsetX:0,cropOffsetY:0,cropScale:1};d.slides[sid].layerOrder.push(lid);});d.slides[sid].grid={templateId:template.id,gap,margin,slotIds};}));get().selectLayer(null);
  },
  setSlideGrid: (slideId,patch) => { const s=get();const live=getLiveGrid(s.doc,slideId);if(!live)return;
    const gap=patch.gap??live.grid.gap;const margin=patch.margin??live.grid.margin;if(gap===live.grid.gap&&margin===live.grid.margin)return;
    const oldCells=layoutGrid(live.template,s.doc.format,live.grid.gap,live.grid.margin);const newCells=layoutGrid(live.template,s.doc.format,gap,margin);
    get().execute(command('Adjust grid',(d)=>{const slide=d.slides[slideId];const g=slide.grid;if(!g)return;
      g.slotIds.forEach((lid,i)=>{const layer=d.layers[lid];if(!layer||!slide.layerOrder.includes(lid)||!oldCells[i]||!newCells[i])return;if(!slotMatchesCell(layer,oldCells[i]))return;const c=newCells[i];layer.x=c.x;layer.y=c.y;layer.width=c.w;layer.height=c.h;});
      g.gap=gap;g.margin=margin;},`grid:${slideId}`));
  },
```

- [ ] **Step 5: Re-id `grid.slotIds` in `duplicateSlide`**

In `duplicateSlide`, replace the layer-copy loop and the `d.slides[nextId] = ...` line with:

```ts
      const idMap = new Map<string, string>();
      for (const lid of source.layerOrder) { const nid = id(); newLayerIds.push(nid); idMap.set(lid, nid); d.layers[nid] = { ...d.layers[lid], id: nid }; }
      // slotIds must stay index-aligned with the template cells, so a slot that no longer exists gets a fresh unused id rather than being dropped.
      const grid = source.grid && { ...source.grid, slotIds: source.grid.slotIds.map((old) => idMap.get(old) ?? id()) };
      d.slides[nextId] = { ...source, id: nextId, layerOrder: newLayerIds, ...(grid ? { grid } : {}) };
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/editor/documentStore.grid.test.ts src/editor/documentStore.test.ts && npm run typecheck`
Expected: PASS (existing store tests still pass).

- [ ] **Step 7: Commit**

```bash
git add src/editor/documentStore.ts src/editor/documentStore.grid.test.ts
git commit -m "feat(grid): persist slide grid, add setSlideGrid, remap slots on duplicate"
```

---

### Task 4: Web UI — panel margin slider, inspector Grid section, e2e

**Files:**
- Modify: `src/components/panels/TemplatesPanel.tsx`
- Modify: `src/components/Inspector.tsx` (imports line ~36-38; `useLayerGesture` at ~41-51; `SlideInspector` ~465+)
- Create: `e2e/grid.spec.ts`

**Interfaces:**
- Consumes: `maxMargin`, `maxGapFor` (Task 1); `getLiveGrid` (Task 2); `applyGrid(template, gap, margin)` and `setSlideGrid` (Task 3).
- Produces: UI only.

- [ ] **Step 1: Write the failing e2e test**

Create `e2e/grid.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('adjusts the gap and outer margin of an inserted grid from the slide inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /create|start/i }).first().click();
  await page.getByRole('button', { name: /^Templates|Photo grids/i }).first().click();
  await page.getByTitle('Apply “2 × 2” grid').click();

  const slots = () => page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const { doc } = useDocumentStore.getState();
    const slide = doc.slides[doc.slideOrder[0]];
    return slide.grid!.slotIds.map((id) => ({ x: doc.layers[id].x, y: doc.layers[id].y, w: doc.layers[id].width }));
  });

  const flush = await slots();
  expect(flush[0].x).toBe(0);

  await page.getByRole('slider', { name: 'Gap' }).fill('40');
  const gapped = await slots();
  expect(gapped[1].x).toBeGreaterThan(gapped[0].x + gapped[0].w);
  expect(gapped[0].w).toBeLessThan(flush[0].w);

  await page.getByRole('slider', { name: 'Outer margin' }).fill('60');
  const inset = await slots();
  expect(inset[0].x).toBe(60);
  expect(inset[0].y).toBe(60);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test e2e/grid.spec.ts`
Expected: FAIL — no slider named "Gap" in the slide inspector. (If the "2 × 2" title or the panel button name does not match, fix the locators against the real DOM before continuing; the template name is `2 × 2` in `src/lib/grids.ts` `four-grid`.)

- [ ] **Step 3: Panel — add the Outer margin slider and preview**

In `src/components/panels/TemplatesPanel.tsx`:

Replace `GridThumb` signature and its two preview lines with a margin-aware version (no clamping in the 80-unit thumbnail, deliberately):

```tsx
function GridThumb({ tpl, gap, margin, ratio }: { tpl: GridTemplate; gap: number; margin: number; ratio: number }) {
  const W = 80;
  const H = W / ratio;
  const previewGap = (gap / 120) * 8;
  const previewMargin = (margin / 120) * 8;
  const cells = tpl.cells(W - 2 * previewMargin, H - 2 * previewMargin, previewGap).map((c) => ({ ...c, x: c.x + previewMargin, y: c.y + previewMargin }));
```

(The rest of `GridThumb` is unchanged.)

In `TemplatesPanel`: add the import `import { GRID_TEMPLATES, maxMargin, type GridTemplate } from '@/lib/grids';`, add state and slider, and pass the margin through:

```tsx
  const [margin, setMargin] = useState(0);
  const marginMax = maxMargin(format.width, format.height);
```

Below the existing "Gap between photos" `<Slider … />` (inside the same `px-3 pb-3` div, which becomes `space-y-2.5`):

```tsx
        <Slider label="Outer margin" display={`${margin} px`} min={0} max={marginMax} value={Math.min(margin, marginMax)} onChange={setMargin} valueText={`${margin} pixels`} />
```

Change the button handler to `onClick={() => applyGrid(t, gap, margin)}` and the thumbnail to `<GridThumb tpl={t} gap={gap} margin={margin} ratio={ratio} />`. Change the wrapper to `<div className="space-y-2.5 px-3 pb-3">`.

- [ ] **Step 4: Inspector — generalize the gesture hook**

In `src/components/Inspector.tsx`, replace `useLayerGesture` with:

```tsx
function useTransactionGesture(mergeKey: string, label: string): Gesture {
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const commitTransaction = useEditor((s) => s.commitTransaction);
  const cancelTransaction = useEditor((s) => s.cancelTransaction);
  const transaction = useRef<string | null>(null);
  return {
    begin: () => { if (!transaction.current) transaction.current = beginTransaction(label, mergeKey); },
    end: () => { if (transaction.current) commitTransaction(transaction.current); transaction.current = null; },
    cancel: () => { if (transaction.current) cancelTransaction(transaction.current); transaction.current = null; },
  };
}

function useLayerGesture(layerId: string, label: string): Gesture {
  return useTransactionGesture(`gesture:${layerId}:${label}`, label);
}
```

Add `useMemo` to the existing `react` import, and add imports:

```tsx
import { getLiveGrid } from '@/core/document/grid';
import { maxGapFor, maxMargin } from '@/lib/grids';
```

- [ ] **Step 5: Inspector — add `GridSection` and render it**

Add above `function SlideInspector`:

```tsx
function GridSection({ slideId }: { slideId: string }) {
  const doc = useEditor((s) => s.doc);
  const setSlideGrid = useEditor((s) => s.setSlideGrid);
  const gesture = useTransactionGesture(`gesture:grid:${slideId}`, 'Adjust grid');
  const live = useMemo(() => getLiveGrid(doc, slideId), [doc, slideId]);
  if (!live) return null;
  const { grid, template, movedSlots } = live;
  const marginMax = maxMargin(doc.format.width, doc.format.height);
  const margin = Math.min(grid.margin, marginMax);
  const gapMax = maxGapFor(template, doc.format, margin);
  const gap = Math.min(grid.gap, gapMax);
  return (
    <Section title="Photo grid" action={<span className="text-[11px] text-ink-faint">{template.name}</span>}>
      <Slider label="Gap" display={`${Math.round(gap)} px`} min={0} max={gapMax} value={gap} onChange={(v) => setSlideGrid(slideId, { gap: v })} gesture={gesture} valueText={`${Math.round(gap)} pixels`} />
      <Slider label="Outer margin" display={`${Math.round(margin)} px`} min={0} max={marginMax} value={margin} onChange={(v) => setSlideGrid(slideId, { margin: v })} gesture={gesture} valueText={`${Math.round(margin)} pixels`} />
      {movedSlots > 0 && <p className="text-[11px] leading-relaxed text-ink-faint">{movedSlots} slot{movedSlots === 1 ? ' was' : 's were'} moved by hand and won’t follow these sliders.</p>}
    </Section>
  );
}
```

In `SlideInspector`, render it directly above `<Section title="Background" …>`:

```tsx
      <GridSection slideId={slideId} />
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run verify && npx playwright test e2e/grid.spec.ts`
Expected: PASS. If the `Slider` does not expose `role="slider"` with the label as its accessible name, check `src/components/ui.tsx` `Slider` (it takes `ariaLabel` / `label`) and adjust the locator in the spec, not the component.

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/TemplatesPanel.tsx src/components/Inspector.tsx e2e/grid.spec.ts
git commit -m "feat(grid): outer margin in the grids panel and a Photo grid inspector section"
```

---

### Task 5: Mac model, layout and file format

**Files:**
- Modify: `macos/OpenSCRL/Model/Project.swift` (`Slide` at ~179-185)
- Modify: `macos/OpenSCRL/Model/Grids.swift` (append extension and `LiveGrid`)
- Modify: `macos/OpenSCRL/Model/ProjectFile.swift` (`SlideRecord` ~7-11, encode ~47, decode ~64)

**Interfaces:**
- Produces:
  - `struct SlideGrid: Codable, Hashable, Sendable { var templateId: String; var gap: Double; var margin: Double; var slotIds: [String] }`
  - `Slide.grid: SlideGrid?` (memberwise init gains a trailing `grid:` parameter defaulting to `nil`)
  - `GridTemplate.layout(format: CanvasFormat, gap: Double, margin: Double) -> [CGRect]`
  - `GridTemplate.maxMargin(width:height:) -> Double` (static), `GridTemplate.maxGap(format:margin:) -> Double`
  - `struct LiveGrid { var grid: SlideGrid; var template: GridTemplate; var movedSlots: Int }` and `Project.liveGrid(slide:) -> LiveGrid?`
  - `Layer.matches(_ cell: CGRect) -> Bool`

There is no Swift test target. Verification is a build plus the manual checks in Task 6.

- [ ] **Step 1: Add `SlideGrid` and `Slide.grid`**

In `Project.swift`, replace the `Slide` struct with:

```swift
/// Records which photo-grid template laid out a slide so gap and margin can be re-adjusted.
/// `slotIds[i]` is the layer for template cell `i`; entries for deleted slots stay in place.
struct SlideGrid: Codable, Hashable, Sendable {
    var templateId: String
    var gap: Double
    var margin: Double
    var slotIds: [String]
}

struct Slide: Identifiable, Hashable, Sendable {
    var id: String
    var background: Background
    var layers: [Layer]
    var grid: SlideGrid? = nil

    static func blank() -> Slide { Slide(id: UID.make(), background: .white, layers: []) }
}
```

- [ ] **Step 2: Add layout functions, `LiveGrid` and slot matching**

Append to `Grids.swift`:

```swift
// MARK: - Margin-aware layout

extension GridTemplate {
    static let minCell = 16.0
    static let maxInset = 120.0

    static func maxMargin(width: Double, height: Double) -> Double {
        min(maxInset, (min(width, height) / 4).rounded(.down))
    }

    private static func smallestSide(_ cells: [CGRect]) -> Double {
        cells.map { min($0.width, $0.height) }.min() ?? 0
    }

    /// Largest gap <= `gap` (>= 0) for which every cell is at least `minCell` on both sides.
    private func effectiveGap(width: Double, height: Double, gap: Double) -> Double {
        let want = max(0, gap)
        if Self.smallestSide(cells(width, height, want)) >= Self.minCell { return want }
        var lo = 0.0, hi = want
        for _ in 0..<24 {
            let mid = (lo + hi) / 2
            if Self.smallestSide(cells(width, height, mid)) >= Self.minCell { lo = mid } else { hi = mid }
        }
        return lo
    }

    /// Cells inside a `margin`-inset slide, with the gap clamped so no cell is tiny.
    func layout(format: CanvasFormat, gap: Double, margin: Double) -> [CGRect] {
        let m = min(max(0, margin), Self.maxMargin(width: format.width, height: format.height))
        let w = format.width - 2 * m, h = format.height - 2 * m
        let g = effectiveGap(width: w, height: h, gap: gap)
        return cells(w, h, g).map { $0.offsetBy(dx: m, dy: m) }
    }

    /// Slider maximum for the gap: 120, or less when the template would drop below `minCell`.
    func maxGap(format: CanvasFormat, margin: Double) -> Double {
        let m = min(max(0, margin), Self.maxMargin(width: format.width, height: format.height))
        return effectiveGap(width: format.width - 2 * m, height: format.height - 2 * m, gap: Self.maxInset).rounded(.down)
    }

    static func template(id: String) -> GridTemplate? { all.first { $0.id == id } }
}

extension Layer {
    /// True while the layer still sits on `cell` (within half a point), i.e. nobody moved it by hand.
    func matches(_ cell: CGRect) -> Bool {
        abs(x - cell.minX) <= 0.5 && abs(y - cell.minY) <= 0.5 && abs(width - cell.width) <= 0.5 && abs(height - cell.height) <= 0.5
    }
}

struct LiveGrid {
    var grid: SlideGrid
    var template: GridTemplate
    var movedSlots: Int
}

extension Project {
    /// The slide's grid if it is still meaningful: known template and at least one slot still on the slide.
    func liveGrid(slide index: Int) -> LiveGrid? {
        guard slides.indices.contains(index), let grid = slides[index].grid, let template = GridTemplate.template(id: grid.templateId) else { return nil }
        let cells = template.layout(format: format, gap: grid.gap, margin: grid.margin)
        var live = 0, moved = 0
        for (i, id) in grid.slotIds.enumerated() where i < cells.count {
            guard let layer = slides[index].layers.first(where: { $0.id == id }) else { continue }
            live += 1
            if !layer.matches(cells[i]) { moved += 1 }
        }
        return live > 0 ? LiveGrid(grid: grid, template: template, movedSlots: moved) : nil
    }
}
```

- [ ] **Step 3: Carry `grid` through the project file**

In `ProjectFile.swift`:

```swift
    struct SlideRecord: Codable {
        var id: String
        var background: Background
        var layerOrder: [String]
        var grid: SlideGrid?
    }
```

Change the encode line to `SlideRecord(id: slide.id, background: slide.background, layerOrder: slide.layers.map(\.id), grid: slide.grid)` and the decode line to `return Slide(id: record.id, background: record.background, layers: record.layerOrder.compactMap { layers[$0] }, grid: record.grid)`.

- [ ] **Step 4: Build**

Run: `cd macos && xcodebuild -project OpenSCRL.xcodeproj -scheme OpenSCRL -configuration Debug -derivedDataPath build build 2>&1 | tail -20`
Expected: `** BUILD SUCCEEDED **`. If Xcode is unavailable, state that the build was not run.

- [ ] **Step 5: Commit**

```bash
git add macos/OpenSCRL/Model/Project.swift macos/OpenSCRL/Model/Grids.swift macos/OpenSCRL/Model/ProjectFile.swift
git commit -m "feat(mac): add SlideGrid model, margin-aware grid layout, and file round-trip"
```

---

### Task 6: Mac controller and UI

**Files:**
- Modify: `macos/OpenSCRL/Editor/EditorController.swift` (`gridGap` ~93, `duplicateSlide` ~235-242, `applyGrid` ~373-387; add `setSlideGrid`)
- Modify: `macos/OpenSCRL/Editor/Sidebar/SidebarView.swift` (`GridsPanel` ~70-105, `GridPreview` ~109-126)
- Modify: `macos/OpenSCRL/Editor/Inspector/SlideInspector.swift` (add a section before the Background section)

**Interfaces:**
- Consumes: everything produced in Task 5; existing `GestureSlider(title:value:range:step:display:controller:undoName:)`.
- Produces: `EditorController.gridMargin`, `applyGrid(_:gap:margin:)`, `setSlideGrid(gap:margin:)`.

- [ ] **Step 1: Controller — margin state and `applyGrid`**

Next to `var gridGap: Double = 0` add:

```swift
    var gridMargin: Double = 0
```

Replace `applyGrid` with:

```swift
    func applyGrid(_ template: GridTemplate, gap: Double? = nil, margin: Double? = nil) {
        let index = selectedSlideIndex
        let gap = gap ?? gridGap, margin = margin ?? gridMargin
        let cells = template.layout(format: project.format, gap: gap, margin: margin)
        let layers = cells.enumerated().map { i, cell in
            Layer(id: UID.make(), name: "Photo \(i + 1)", x: cell.minX, y: cell.minY, width: cell.width, height: cell.height,
                  locked: true, content: .image(ImageProperties()))
        }
        let grid = SlideGrid(templateId: template.id, gap: gap, margin: margin, slotIds: layers.map(\.id))
        perform("Apply \(template.name) Grid") { p in
            guard p.slides.indices.contains(index) else { return }
            p.slides[index].layers = layers
            p.slides[index].grid = grid
        }
        selectLayer(nil)
        selectedSlideID = project.slides[index].id
        show("Applied the \(template.name) grid. Click a slot, then a photo in Media to fill it.")
    }

    /// Re-lays out the selected slide's grid. Only slots still on their old cell follow; hand-moved slots and other layers are untouched.
    func setSlideGrid(gap: Double? = nil, margin: Double? = nil) {
        let index = selectedSlideIndex
        guard let live = project.liveGrid(slide: index) else { return }
        let newGap = gap ?? live.grid.gap, newMargin = margin ?? live.grid.margin
        guard newGap != live.grid.gap || newMargin != live.grid.margin else { return }
        let format = project.format
        let oldCells = live.template.layout(format: format, gap: live.grid.gap, margin: live.grid.margin)
        let newCells = live.template.layout(format: format, gap: newGap, margin: newMargin)
        perform("Adjust Grid", coalesce: "grid:\(selectedSlideID)") { p in
            guard p.slides.indices.contains(index), var grid = p.slides[index].grid else { return }
            for (i, id) in grid.slotIds.enumerated() where i < oldCells.count && i < newCells.count {
                guard let li = p.slides[index].layers.firstIndex(where: { $0.id == id }), p.slides[index].layers[li].matches(oldCells[i]) else { continue }
                p.slides[index].layers[li].x = newCells[i].minX
                p.slides[index].layers[li].y = newCells[i].minY
                p.slides[index].layers[li].width = newCells[i].width
                p.slides[index].layers[li].height = newCells[i].height
            }
            grid.gap = newGap
            grid.margin = newMargin
            p.slides[index].grid = grid
        }
    }
```

- [ ] **Step 2: Controller — remap `slotIds` in `duplicateSlide`**

Replace the `copy.layers = …` line with:

```swift
        var idMap: [String: String] = [:]
        copy.layers = copy.layers.map { var l = $0; let new = UID.make(); idMap[l.id] = new; l.id = new; return l }
        // slotIds stay index-aligned with the template cells; a deleted slot gets a fresh unused id rather than being dropped.
        if var grid = copy.grid {
            grid.slotIds = grid.slotIds.map { idMap[$0] ?? UID.make() }
            copy.grid = grid
        }
```

- [ ] **Step 3: Sidebar — margin slider and preview**

In `GridsPanel`, directly after the "Gap between photos" `VStack`, add:

```swift
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("Outer margin").foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(controller.gridMargin)) px").monospacedDigit().foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    Slider(value: Binding(get: { controller.gridMargin }, set: { controller.gridMargin = $0.rounded() }),
                           in: 0...GridTemplate.maxMargin(width: controller.project.format.width, height: controller.project.format.height))
                        .controlSize(.small).labelsHidden()
                        .accessibilityLabel("Outer margin")
                }
```

Pass the margin to the preview: `GridPreview(template: template, ratio: controller.project.format.aspectRatio, gap: controller.gridGap, margin: controller.gridMargin)`.

Replace `GridPreview` with (no clamping in the small preview, deliberately):

```swift
struct GridPreview: View {
    var template: GridTemplate
    var ratio: Double
    var gap: Double
    var margin: Double

    var body: some View {
        Canvas { context, size in
            let h = size.height, w = min(size.width, h * ratio)
            let originX = (size.width - w) / 2
            let previewGap = max(2, gap / 120 * 6)
            let previewMargin = margin / 120 * 6
            context.fill(Path(roundedRect: CGRect(x: originX, y: 0, width: w, height: h), cornerRadius: 3), with: .color(.secondary.opacity(0.15)))
            for cell in template.cells(w - 2 * previewMargin, h - 2 * previewMargin, previewGap) {
                let r = CGRect(x: originX + previewMargin + cell.minX, y: previewMargin + cell.minY, width: cell.width, height: cell.height)
                context.fill(Path(roundedRect: r, cornerRadius: 2), with: .style(.tint.opacity(0.75)))
            }
        }
    }
}
```

- [ ] **Step 4: Slide inspector — Photo Grid section**

In `SlideInspector.swift`, insert before the `Section { HStack(spacing: 6) { ForEach(Array(Swatches.quick…` background section:

```swift
            if let live = project.liveGrid(slide: index) {
                let marginMax = GridTemplate.maxMargin(width: project.format.width, height: project.format.height)
                let margin = min(live.grid.margin, marginMax)
                let gapMax = max(1, live.template.maxGap(format: project.format, margin: margin))
                let gap = min(live.grid.gap, gapMax)
                Section {
                    GestureSlider(title: "Gap", value: Binding(get: { gap }, set: { controller.setSlideGrid(gap: $0.rounded()) }),
                                  range: 0...gapMax, display: "\(Int(gap)) px", controller: controller, undoName: "Adjust Grid")
                    GestureSlider(title: "Outer Margin", value: Binding(get: { margin }, set: { controller.setSlideGrid(margin: $0.rounded()) }),
                                  range: 0...max(1, marginMax), display: "\(Int(margin)) px", controller: controller, undoName: "Adjust Grid")
                    if live.movedSlots > 0 {
                        Text("\(live.movedSlots) slot\(live.movedSlots == 1 ? " was" : "s were") moved by hand and won’t follow these sliders.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    HStack { Text("Photo Grid"); Spacer(); Text(live.template.name).foregroundStyle(.secondary) }
                }
            }
```

- [ ] **Step 5: Build**

Run: `cd macos && xcodebuild -project OpenSCRL.xcodeproj -scheme OpenSCRL -configuration Debug -derivedDataPath build build 2>&1 | tail -20`
Expected: `** BUILD SUCCEEDED **`. If Xcode is unavailable, say so explicitly and hand the manual checks below to someone who has it.

- [ ] **Step 6: Manual verification (Mac has no test target)**

Run the app and check each, noting the result:
1. Photo Grids panel: set Gap 20 and Outer margin 40, apply "2 × 2". Slots are inset 40 px and 20 px apart.
2. Click empty canvas so the slide inspector shows. A "Photo Grid" section appears. Drag Gap; slots follow live; ⌘Z undoes the whole drag in one step.
3. Unlock and nudge one slot, then drag Gap: that slot stays put and the hint says "1 slot was moved by hand…". Text and shape layers never move.
4. Duplicate the slide, adjust the copy's gap: the original's slots do not move.
5. Delete a middle slot, then change the margin: remaining slots stay on their own cells.
6. IG Landscape format, Gap and Margin at maximum: no slot smaller than about 16 px.
7. Save, close, reopen: the section is still there with the same values.
8. Open a project saved before this change: no "Photo Grid" section, no errors.

- [ ] **Step 7: Commit**

```bash
git add macos/OpenSCRL/Editor/EditorController.swift macos/OpenSCRL/Editor/Sidebar/SidebarView.swift macos/OpenSCRL/Editor/Inspector/SlideInspector.swift
git commit -m "feat(mac): outer margin and post-insert gap/margin controls"
```

---

### Task 7: Cross-app parity check and docs

**Files:**
- Modify: `README.md` (Highlights bullet "Fast photo grids"; Mac app "Direct editing"/grids mention if any)
- Modify: `CLAUDE.md` (one line under the Mac architecture note about the schema)

- [ ] **Step 1: Update the README**

In `README.md`, replace the "Fast photo grids" bullet with:

```md
- **Fast photo grids** — choose from layouts such as 1×1, 2×2, 3×3, L-shape, 1+4, and more;
  set the gap between photos and the outer margin around the grid, then keep adjusting both
  from the slide inspector after the grid is placed. Select a photo slot and choose imported
  media to fill it.
```

- [ ] **Step 2: Note the shared field in `CLAUDE.md`**

In the Mac architecture bullet for `Model/`, after "Changing the schema requires updating both `src/core/document` (+ migrations) and `ProjectFile.swift`." add: "`SlideRecord.grid` (template id, gap, margin, ordered slot layer ids) is an optional field on both sides; grid layout math lives in `src/lib/grids.ts` (`layoutGrid`) and `Model/Grids.swift` (`layout`), and the two must stay in step."

- [ ] **Step 3: Cross-app parity check**

Apply "1 + 4 side" with gap 24 and margin 40 on IG Portrait in both apps and compare slot x, y, width, height shown in each app's layer inspector. They must match to the pixel. Then open the web project's `project.json` and confirm `slides.<id>.grid` has the keys `templateId`, `gap`, `margin`, `slotIds`; save the same from the Mac app and confirm identical key names.

- [ ] **Step 4: Full verification**

Run: `npm run verify && npx playwright test`
Expected: all pass, bundle budget still under 120 KiB gzip.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: describe editable grid gap and outer margin"
```
