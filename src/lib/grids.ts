export interface GridCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridTemplate {
  id: string;
  name: string;
  count: number;
  cells: (W: number, H: number, gap: number) => GridCell[];
}

const cell = (x: number, y: number, w: number, h: number): GridCell => ({ x, y, w, h });

const grid = (cols: number, rows: number) => (W: number, H: number, g: number) => {
  const w = (W - (cols - 1) * g) / cols;
  const h = (H - (rows - 1) * g) / rows;
  const out: GridCell[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push(cell(c * (w + g), r * (h + g), w, h));
  return out;
};

export const GRID_TEMPLATES: GridTemplate[] = [
  {
    id: 'single',
    name: 'Single',
    count: 1,
    cells: (W, H) => [cell(0, 0, W, H)],
  },
  {
    id: 'two-h',
    name: '2 stacked',
    count: 2,
    cells: (W, H, g) => {
      const h = (H - g) / 2;
      return [cell(0, 0, W, h), cell(0, h + g, W, h)];
    },
  },
  {
    id: 'two-v',
    name: '2 side',
    count: 2,
    cells: (W, H, g) => {
      const w = (W - g) / 2;
      return [cell(0, 0, w, H), cell(w + g, 0, w, H)];
    },
  },
  {
    id: 'three-h',
    name: '3 row',
    count: 3,
    cells: (W, H, g) => {
      const w = (W - 2 * g) / 3;
      return [
        cell(0, 0, w, H),
        cell(w + g, 0, w, H),
        cell(2 * (w + g), 0, w, H),
      ];
    },
  },
  {
    id: 'three-v',
    name: '3 stack',
    count: 3,
    cells: (W, H, g) => {
      const h = (H - 2 * g) / 3;
      return [
        cell(0, 0, W, h),
        cell(0, h + g, W, h),
        cell(0, 2 * (h + g), W, h),
      ];
    },
  },
  {
    id: 'one-plus-two',
    name: '1 + 2',
    count: 3,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.62;
      const botH = H - g - topH;
      const halfW = (W - g) / 2;
      return [
        cell(0, 0, W, topH),
        cell(0, topH + g, halfW, botH),
        cell(halfW + g, topH + g, halfW, botH),
      ];
    },
  },
  {
    id: 'two-plus-one',
    name: '2 + 1',
    count: 3,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.38;
      const botH = H - g - topH;
      const halfW = (W - g) / 2;
      return [
        cell(0, 0, halfW, topH),
        cell(halfW + g, 0, halfW, topH),
        cell(0, topH + g, W, botH),
      ];
    },
  },
  {
    id: 'l-shape',
    name: 'L shape',
    count: 3,
    cells: (W, H, g) => {
      const bigW = (W - g) * 0.62;
      const sideW = W - g - bigW;
      const halfH = (H - g) / 2;
      return [
        cell(0, 0, bigW, H),
        cell(bigW + g, 0, sideW, halfH),
        cell(bigW + g, halfH + g, sideW, halfH),
      ];
    },
  },
  {
    id: 'four-grid',
    name: '2 × 2',
    count: 4,
    cells: (W, H, g) => {
      const w = (W - g) / 2;
      const h = (H - g) / 2;
      return [
        cell(0, 0, w, h),
        cell(w + g, 0, w, h),
        cell(0, h + g, w, h),
        cell(w + g, h + g, w, h),
      ];
    },
  },
  {
    id: 'one-plus-three',
    name: '1 + 3',
    count: 4,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.62;
      const botH = H - g - topH;
      const w = (W - 2 * g) / 3;
      return [
        cell(0, 0, W, topH),
        cell(0, topH + g, w, botH),
        cell(w + g, topH + g, w, botH),
        cell(2 * (w + g), topH + g, w, botH),
      ];
    },
  },
  {
    id: 'four-row',
    name: '4 row',
    count: 4,
    cells: grid(4, 1),
  },
  {
    id: 'four-stack',
    name: '4 stack',
    count: 4,
    cells: grid(1, 4),
  },
  {
    id: 'three-plus-one',
    name: '3 + 1',
    count: 4,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.38;
      const botH = H - g - topH;
      const w = (W - 2 * g) / 3;
      return [
        cell(0, 0, w, topH),
        cell(w + g, 0, w, topH),
        cell(2 * (w + g), 0, w, topH),
        cell(0, topH + g, W, botH),
      ];
    },
  },
  {
    id: 'two-plus-two',
    name: '2 + 2',
    count: 4,
    cells: (W, H, g) => {
      const halfH = (H - g) / 2;
      const halfW = (W - g) / 2;
      return [
        cell(0, 0, halfW, halfH),
        cell(halfW + g, 0, halfW, halfH),
        cell(0, halfH + g, halfW, halfH),
        cell(halfW + g, halfH + g, halfW, halfH),
      ];
    },
  },
  {
    id: 'two-plus-three',
    name: '2 + 3',
    count: 5,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.45;
      const botH = H - g - topH;
      const topW = (W - g) / 2;
      const botW = (W - 2 * g) / 3;
      return [
        cell(0, 0, topW, topH),
        cell(topW + g, 0, topW, topH),
        cell(0, topH + g, botW, botH),
        cell(botW + g, topH + g, botW, botH),
        cell(2 * (botW + g), topH + g, botW, botH),
      ];
    },
  },
  {
    id: 'three-plus-two',
    name: '3 + 2',
    count: 5,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.45;
      const botH = H - g - topH;
      const topW = (W - 2 * g) / 3;
      const botW = (W - g) / 2;
      return [
        cell(0, 0, topW, topH),
        cell(topW + g, 0, topW, topH),
        cell(2 * (topW + g), 0, topW, topH),
        cell(0, topH + g, botW, botH),
        cell(botW + g, topH + g, botW, botH),
      ];
    },
  },
  {
    id: 'side-feature-four',
    name: '1 + 4 side',
    count: 5,
    cells: (W, H, g) => {
      const bigW = (W - g) * 0.58;
      const sideW = W - g - bigW;
      const sideH = (H - 3 * g) / 4;
      return [
        cell(0, 0, bigW, H),
        cell(bigW + g, 0, sideW, sideH),
        cell(bigW + g, sideH + g, sideW, sideH),
        cell(bigW + g, 2 * (sideH + g), sideW, sideH),
        cell(bigW + g, 3 * (sideH + g), sideW, sideH),
      ];
    },
  },
  {
    id: 'five-feature',
    name: '1 + 4',
    count: 5,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.6;
      const botH = H - g - topH;
      const w = (W - 3 * g) / 4;
      return [
        cell(0, 0, W, topH),
        cell(0, topH + g, w, botH),
        cell(w + g, topH + g, w, botH),
        cell(2 * (w + g), topH + g, w, botH),
        cell(3 * (w + g), topH + g, w, botH),
      ];
    },
  },
  {
    id: 'six-tall',
    name: '2 × 3',
    count: 6,
    cells: grid(2, 3),
  },
  {
    id: 'six-grid',
    name: '3 × 2',
    count: 6,
    cells: grid(3, 2),
  },
  {
    id: 'six-feature',
    name: '1 + 5',
    count: 6,
    cells: (W, H, g) => {
      const topH = (H - g) * 0.55;
      const botH = H - g - topH;
      const w = (W - 4 * g) / 5;
      return [
        cell(0, 0, W, topH),
        cell(0, topH + g, w, botH),
        cell(w + g, topH + g, w, botH),
        cell(2 * (w + g), topH + g, w, botH),
        cell(3 * (w + g), topH + g, w, botH),
        cell(4 * (w + g), topH + g, w, botH),
      ];
    },
  },
  {
    id: 'eight-grid',
    name: '4 × 2',
    count: 8,
    cells: grid(4, 2),
  },
  {
    id: 'nine-grid',
    name: '3 × 3',
    count: 9,
    cells: grid(3, 3),
  },
  {
    id: 'twelve-grid',
    name: '4 × 3',
    count: 12,
    cells: grid(4, 3),
  },
  {
    id: 'sixteen-grid',
    name: '4 × 4',
    count: 16,
    cells: grid(4, 4),
  },
];

export const MIN_CELL = 16;
export const MAX_GRID_INSET = 120;

type Size = { width: number; height: number };

export function maxMargin(width: number, height: number): number {
  return Math.min(MAX_GRID_INSET, Math.floor(Math.min(width, height) / 4));
}

const smallestSide = (cells: GridCell[]) => Math.min(...cells.flatMap((c) => [c.w, c.h]));

/** Largest gap <= `gap` (>= 0) for which every cell is at least MIN_CELL on both sides. */
function effectiveGap(template: GridTemplate, W: number, H: number, gap: number): number {
  const want = Math.min(Math.max(0, gap), MAX_GRID_INSET);
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
