import { describe, expect, it } from 'vitest';
import { mediaShape, selectMedia, SQUARE_RATIO_TOLERANCE, type MediaView } from './mediaLibrary';

const asset = (name: string, width = 100, height = 100, mime = 'image/jpeg', sourceMime?: string) => ({ name, width, height, mime, sourceMime });
const names = (assets: readonly { name: string }[]) => assets.map((a) => a.name);
const view = (patch: Partial<MediaView> = {}): MediaView => ({ sort: 'none', shapes: [], ...patch });

describe('mediaShape', () => {
  it('treats ratios within the tolerance as square, inclusive at both ends', () => {
    expect(SQUARE_RATIO_TOLERANCE).toBe(0.05);
    expect(mediaShape({ width: 95, height: 100 })).toBe('square');
    expect(mediaShape({ width: 105, height: 100 })).toBe('square');
    expect(mediaShape({ width: 1000, height: 1000 })).toBe('square');
    expect(mediaShape({ width: 94, height: 100 })).toBe('vertical');
    expect(mediaShape({ width: 106, height: 100 })).toBe('horizontal');
    expect(mediaShape({ width: 1080, height: 1350 })).toBe('vertical');
    expect(mediaShape({ width: 1920, height: 1080 })).toBe('horizontal');
  });

  it('returns null for unusable dimensions', () => {
    for (const [width, height] of [[0, 100], [100, 0], [-1, 5], [Number.NaN, 5], [5, Infinity]]) {
      expect(mediaShape({ width, height })).toBeNull();
    }
  });
});

describe('selectMedia', () => {
  it('keeps import order and the same array for the default view', () => {
    const list = [asset('b'), asset('a'), asset('c')];
    expect(selectMedia(list, view())).toBe(list);
  });

  it('sorts names in natural order, case-insensitively', () => {
    const list = [asset('IMG_10.jpg'), asset('img_2.jpg'), asset('IMG_1.jpg'), asset('IMG_20.jpg')];
    expect(names(selectMedia(list, view({ sort: 'name-asc' })))).toEqual(['IMG_1.jpg', 'img_2.jpg', 'IMG_10.jpg', 'IMG_20.jpg']);
    expect(names(selectMedia(list, view({ sort: 'name-desc' })))).toEqual(['IMG_20.jpg', 'IMG_10.jpg', 'img_2.jpg', 'IMG_1.jpg']);
  });

  it('keeps import order for equal names in both directions', () => {
    const first = { ...asset('same.jpg'), id: 'first' };
    const second = { ...asset('same.jpg'), id: 'second' };
    const other = { ...asset('a.jpg'), id: 'other' };
    const list = [first, second, other];
    expect(selectMedia(list, view({ sort: 'name-asc' })).map((a) => a.id)).toEqual(['other', 'first', 'second']);
    expect(selectMedia(list, view({ sort: 'name-desc' })).map((a) => a.id)).toEqual(['first', 'second', 'other']);
  });

  it('keeps case and accent variants in import order, matching the Mac library', () => {
    const list = [asset('IMG_2.jpg'), asset('img_2.jpg'), asset('café.jpg'), asset('cafe.jpg')];
    expect(names(selectMedia(list, view({ sort: 'name-asc' })))).toEqual(['café.jpg', 'cafe.jpg', 'IMG_2.jpg', 'img_2.jpg']);
    expect(names(selectMedia(list, view({ sort: 'name-desc' })))).toEqual(['IMG_2.jpg', 'img_2.jpg', 'café.jpg', 'cafe.jpg']);
  });

  it('sorts by original type when present, then by natural name', () => {
    const list = [
      asset('b.mp4', 10, 10, 'video/mp4'),
      asset('IMG_10.jpg', 10, 10, 'image/jpeg', 'image/heic'),
      asset('c.png', 10, 10, 'image/png'),
      asset('IMG_2.jpg', 10, 10, 'image/jpeg', 'image/heic'),
      asset('a.gif', 10, 10, 'image/gif'),
      asset('d.jpg', 10, 10, 'image/jpeg'),
    ];
    expect(names(selectMedia(list, view({ sort: 'type' })))).toEqual(['a.gif', 'IMG_2.jpg', 'IMG_10.jpg', 'd.jpg', 'c.png', 'b.mp4']);
  });

  it('does not mutate its input and combines filter with sort', () => {
    const list = [asset('IMG_10', 200, 100), asset('IMG_3', 100, 200), asset('IMG_2', 300, 100), asset('IMG_1', 100, 100)];
    const snapshot = [...list];
    const result = selectMedia(list, view({ sort: 'name-asc', shapes: ['horizontal', 'square'] }));
    expect(names(result)).toEqual(['IMG_1', 'IMG_2', 'IMG_10']);
    expect(list).toEqual(snapshot);
    expect(result).not.toBe(list);
  });

  it('filters without sorting and keeps import order', () => {
    const list = [asset('z', 100, 200), asset('y', 200, 100), asset('x', 100, 205)];
    expect(names(selectMedia(list, view({ shapes: ['vertical'] })))).toEqual(['z', 'x']);
  });

  it('shows everything when no shape is selected, including invalid dimensions', () => {
    const list = [asset('ok'), asset('broken', 0, 0)];
    expect(names(selectMedia(list, view({ sort: 'name-asc' })))).toEqual(['broken', 'ok']);
    expect(names(selectMedia(list, view({ shapes: ['square'] })))).toEqual(['ok']);
  });

  it('applies shapes to every media kind by dimensions', () => {
    const list = [
      { ...asset('clip.mp4', 1920, 1080, 'video/mp4'), mediaKind: 'video' as const },
      { ...asset('loop.gif', 500, 500, 'image/gif'), mediaKind: 'gif' as const },
      asset('photo.jpg', 1080, 1350),
    ];
    expect(names(selectMedia(list, view({ shapes: ['horizontal'] })))).toEqual(['clip.mp4']);
    expect(names(selectMedia(list, view({ shapes: ['square', 'vertical'] })))).toEqual(['loop.gif', 'photo.jpg']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(selectMedia([asset('a', 100, 100)], view({ shapes: ['vertical'] }))).toEqual([]);
  });
});
