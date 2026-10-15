import type { AssetMeta } from '@/types';

/** Display-only ordering of the media library. `none` keeps import order. */
export type MediaSort = 'none' | 'name-asc' | 'name-desc' | 'type';
export type MediaShape = 'square' | 'vertical' | 'horizontal';

export const MEDIA_SORTS: readonly { id: MediaSort; label: string }[] = [
  { id: 'none', label: 'None (import order)' },
  { id: 'name-asc', label: 'Filename A→Z' },
  { id: 'name-desc', label: 'Filename Z→A' },
  { id: 'type', label: 'File type' },
];

export const MEDIA_SHAPES: readonly { id: MediaShape; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'horizontal', label: 'Horizontal' },
];

/** Width/height ratios within 1 ± this are square. The Mac app mirrors the same value. */
export const SQUARE_RATIO_TOLERANCE = 0.05;

export interface MediaView {
  sort: MediaSort;
  shapes: readonly MediaShape[];
}

type Sortable = Pick<AssetMeta, 'name' | 'mime' | 'width' | 'height'> & { sourceMime?: string };

/** `null` when the stored dimensions are unusable; such media only shows while no shape filter is active. */
export function mediaShape(asset: Pick<AssetMeta, 'width' | 'height'>): MediaShape | null {
  const { width, height } = asset;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const ratio = width / height;
  if (ratio >= 1 - SQUARE_RATIO_TOLERANCE && ratio <= 1 + SQUARE_RATIO_TOLERANCE) return 'square';
  return ratio < 1 ? 'vertical' : 'horizontal';
}

// Fixed locale so the order does not change with the user's language. Numeric collation puts IMG_2 before IMG_10.
const baseCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural filename order; names differing only in case or accents keep import order. */
export function compareNames(a: string, b: string): number {
  return baseCollator.compare(a, b);
}

const typeKey = (asset: Sortable) => (asset.sourceMime || asset.mime || '').toLowerCase();

export function hasMediaFilters(view: MediaView): boolean {
  return view.shapes.length > 0;
}

export function isDefaultMediaView(view: MediaView): boolean {
  return view.sort === 'none' && view.shapes.length === 0;
}

/**
 * Applies the session's shape filter, then its sort. Never mutates `assets`. With no filter and `none` it returns
 * `assets` itself; otherwise a new array. Equal keys keep import order, in both directions.
 */
export function selectMedia<T extends Sortable>(assets: readonly T[], view: MediaView): readonly T[] {
  if (isDefaultMediaView(view)) return assets;
  const wanted = new Set(view.shapes);
  const visible = wanted.size === 0 ? assets : assets.filter((asset) => {
    const shape = mediaShape(asset);
    return shape !== null && wanted.has(shape);
  });
  if (view.sort === 'none') return visible;
  const indexed = visible.map((asset, index) => ({ asset, index }));
  const compare = (a: Sortable, b: Sortable): number => {
    switch (view.sort) {
      case 'name-asc': return compareNames(a.name, b.name);
      case 'name-desc': return compareNames(b.name, a.name);
      case 'type': return typeKey(a) < typeKey(b) ? -1 : typeKey(a) > typeKey(b) ? 1 : compareNames(a.name, b.name);
      default: return 0;
    }
  };
  return indexed.sort((a, b) => compare(a.asset, b.asset) || a.index - b.index).map(({ asset }) => asset);
}
