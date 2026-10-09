import { describe, expect, it } from 'vitest';
import {
  contentPointAt, layerTwoFinger, normalizeDegrees, originXFor, originYFor, pickSettleSlide, pinchView, pointInLayer, sampleVelocity,
  scaleLimits, scrollForAnchor, shortestTurn, slideIndexAtCentre, slideScrollLeft, snapRotation, snapZoom, zoomLimits,
  type LayerFrame, type Point, type ViewGeometry,
} from './touchMath';

// A 393x650 viewport over a deck of three 1080x1350 slides, with 16px padding.
const g: ViewGeometry = { width: 393, height: 650, deckWidth: 3240, slideHeight: 1350, padding: 16 };
const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);
const near = (a: Point, b: Point, digits = 6) => { close(a.x, b.x, digits); close(a.y, b.y, digits); };

describe('view geometry', () => {
  it('pads the deck when it is wider than the viewport and centres it when narrower', () => {
    expect(originXFor(g, 0.334)).toBe(16);
    expect(originXFor({ ...g, deckWidth: 1080 }, 0.2)).toBe(Math.round((393 - 216) / 2));
    // Centring a single slide lets the first slide of a long deck sit in the middle too.
    expect(originXFor({ ...g, centreWidth: 1080 }, 0.2)).toBe(Math.round((393 - 216) / 2));
    expect(originYFor(g, 0.334)).toBe(Math.max(16, Math.round((650 - 1350 * 0.334) / 2)));
  });

  it('round-trips between content points and scroll positions', () => {
    const screen = { x: 120, y: 300 };
    const content = contentPointAt(g, 0.8, { left: 500, top: 40 }, screen);
    const scroll = scrollForAnchor(g, 0.8, content, screen);
    close(scroll.left, 500);
    close(scroll.top, 40);
  });
});

describe('pinchView', () => {
  const zoom = 0.334;
  const startScroll = { left: 361, top: 0 };
  const startMid = { x: 250, y: 200 };
  const start = { zoom, distance: 100, content: contentPointAt(g, zoom, startScroll, startMid) };
  const limits = { min: 0.1, max: 2 };

  it('keeps the content under the start midpoint under the moving midpoint', () => {
    for (const [fingerDistance, mid] of [[200, startMid], [300, { x: 180, y: 260 }], [60, { x: 300, y: 150 }]] as const) {
      const next = pinchView(g, start, mid, fingerDistance, limits);
      near(contentPointAt(g, next.zoom, next.scroll, mid), start.content, 5);
    }
  });

  it('scales the zoom with the finger spread and clamps it', () => {
    close(pinchView(g, start, startMid, 150, limits).zoom, zoom * 1.5);
    expect(pinchView(g, start, startMid, 100000, limits).zoom).toBe(2);
    expect(pinchView(g, start, startMid, 0.001, limits).zoom).toBe(0.1);
  });

  it('does not divide by a degenerate start distance', () => {
    const next = pinchView(g, { ...start, distance: 0 }, startMid, 80, limits);
    close(next.zoom, zoom);
  });
});

describe('zoom helpers', () => {
  it('snaps a near-fit zoom to the fit zoom and leaves others alone', () => {
    expect(snapZoom(0.35, 0.334)).toBe(0.334);
    expect(snapZoom(0.5, 0.334)).toBe(0.5);
    expect(snapZoom(0.2, 0)).toBe(0.2);
  });

  it('allows zooming out past fit and in to several times fit', () => {
    const limits = zoomLimits(0.334, 0.12, 0.05, 4);
    close(limits.min, 0.12 * 0.7);
    close(limits.max, 0.334 * 8);
    expect(zoomLimits(0.9, 0.9, 0.05, 4).max).toBe(4);
    expect(zoomLimits(0.01, 0.01, 0.05, 4)).toEqual({ min: 0.05, max: 1 });
  });
});

describe('angles', () => {
  it('takes the shortest turn across the +-PI seam', () => {
    close(shortestTurn(Math.PI - 0.1, -Math.PI + 0.1), 0.2);
    close(shortestTurn(-Math.PI + 0.1, Math.PI - 0.1), -0.2);
    close(shortestTurn(0, 1), 1);
  });

  it('normalises degrees to [-180, 180)', () => {
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(180)).toBe(-180);
    expect(normalizeDegrees(0)).toBe(0);
  });

  it('snaps to multiples of 45 only when close', () => {
    expect(snapRotation(2)).toBe(0);
    expect(snapRotation(-3.5)).toBe(0);
    expect(snapRotation(43)).toBe(45);
    expect(snapRotation(91.5)).toBe(90);
    expect(snapRotation(10)).toBe(10);
  });
});

describe('layerTwoFinger', () => {
  const base: LayerFrame = { cx: 500, cy: 400, width: 200, height: 100, rotation: 10 };
  const limits = { minScale: 0.1, maxScale: 10 };
  const start: [Point, Point] = [{ x: 450, y: 400 }, { x: 550, y: 400 }];

  it('leaves the layer alone when the fingers have not moved', () => {
    const result = layerTwoFinger(base, start, start, 0, limits);
    close(result.scale, 1);
    close(result.rotation, 10);
    near({ x: result.cx, y: result.cy }, { x: base.cx, y: base.cy });
  });

  it('translates with the midpoint', () => {
    const moved: [Point, Point] = [{ x: 480, y: 440 }, { x: 580, y: 440 }];
    const result = layerTwoFinger(base, start, moved, 0, limits);
    close(result.scale, 1);
    near({ x: result.cx, y: result.cy }, { x: 530, y: 440 });
  });

  it('scales around the midpoint', () => {
    // Spread to twice the distance with the same midpoint: the layer centre is at the midpoint.
    const spread: [Point, Point] = [{ x: 400, y: 400 }, { x: 600, y: 400 }];
    const result = layerTwoFinger(base, start, spread, 0, limits);
    close(result.scale, 2);
    near({ x: result.cx, y: result.cy }, { x: 500, y: 400 });

    // A centre off the midpoint moves away from it in proportion.
    const off = layerTwoFinger({ ...base, cx: 560 }, start, spread, 0, limits);
    near({ x: off.cx, y: off.cy }, { x: 620, y: 400 });
  });

  it('rotates the layer centre around the midpoint and adds to its rotation', () => {
    // A quarter turn clockwise (y points down): finger vector (100,0) -> (0,100).
    const turned: [Point, Point] = [{ x: 500, y: 350 }, { x: 500, y: 450 }];
    const result = layerTwoFinger({ ...base, cx: 560, rotation: 0 }, start, turned, Math.PI / 2, limits);
    close(result.rotation, 90);
    near({ x: result.cx, y: result.cy }, { x: 500, y: 460 });
  });

  it('keeps the point under each finger under it', () => {
    // Pin a point on the layer to finger 0 and check it follows (similarity transform).
    const turn = 0.6;
    const current: [Point, Point] = [{ x: 420, y: 380 }, { x: 420 + 160 * Math.cos(turn), y: 380 + 160 * Math.sin(turn) }];
    const result = layerTwoFinger({ ...base, rotation: 0 }, start, current, turn, limits);
    // Vector from finger 0 to the layer centre scales by 1.6 and rotates by `turn`.
    const before = { x: base.cx - start[0].x, y: base.cy - start[0].y };
    const expected = {
      x: current[0].x + 1.6 * (before.x * Math.cos(turn) - before.y * Math.sin(turn)),
      y: current[0].y + 1.6 * (before.x * Math.sin(turn) + before.y * Math.cos(turn)),
    };
    near({ x: result.cx, y: result.cy }, expected, 4);
  });

  it('clamps the scale', () => {
    const huge: [Point, Point] = [{ x: 0, y: 0 }, { x: 10000, y: 0 }];
    expect(layerTwoFinger(base, start, huge, 0, limits).scale).toBe(10);
    const tiny: [Point, Point] = [{ x: 500, y: 400 }, { x: 500.5, y: 400 }];
    expect(layerTwoFinger(base, start, tiny, 0, limits).scale).toBe(0.1);
  });

  it('snaps near multiples of 45 degrees and wraps the result', () => {
    const result = layerTwoFinger({ ...base, rotation: 0 }, start, start, (46 * Math.PI) / 180, limits);
    expect(result.rotation).toBe(45);
    expect(layerTwoFinger({ ...base, rotation: 170 }, start, start, (30 * Math.PI) / 180, limits).rotation).toBe(-160);
  });
});

describe('scaleLimits', () => {
  it('keeps the smaller side above the minimum and the larger side below the maximum', () => {
    const { minScale, maxScale } = scaleLimits({ width: 200, height: 40 }, 8, 4000);
    close(minScale, 0.2);
    close(maxScale, 20);
  });

  it('never forbids staying at scale 1', () => {
    const tiny = scaleLimits({ width: 4, height: 4 }, 8, 100);
    expect(tiny.minScale).toBe(1);
    const huge = scaleLimits({ width: 5000, height: 5000 }, 8, 100);
    expect(huge.maxScale).toBe(1);
  });
});

describe('pointInLayer', () => {
  const frame: LayerFrame = { cx: 100, cy: 100, width: 100, height: 20, rotation: 0 };

  it('tests an axis-aligned layer with a margin', () => {
    expect(pointInLayer({ x: 140, y: 105 }, frame)).toBe(true);
    expect(pointInLayer({ x: 140, y: 125 }, frame)).toBe(false);
    expect(pointInLayer({ x: 140, y: 125 }, frame, 20)).toBe(true);
  });

  it('follows the layer rotation', () => {
    const turned = { ...frame, rotation: 90 };
    expect(pointInLayer({ x: 100, y: 140 }, turned)).toBe(true);
    expect(pointInLayer({ x: 140, y: 100 }, turned)).toBe(false);
  });
});

describe('slide settling', () => {
  const zoom = 0.334;

  it('centres slides and finds the slide under the centre', () => {
    const left = slideScrollLeft(g, zoom, 1, 1080);
    expect(slideIndexAtCentre(g, zoom, left, 1080, 3)).toBe(1);
    expect(slideIndexAtCentre(g, zoom, 0, 1080, 3)).toBe(0);
    expect(slideIndexAtCentre(g, zoom, 100000, 1080, 3)).toBe(2);
    expect(slideScrollLeft(g, zoom, 0, 1080)).toBe(0);
  });

  it('settles on the nearest slide for a slow drag and moves one slide for a flick', () => {
    expect(pickSettleSlide(0, 0, -0.1, 3)).toBe(0);
    expect(pickSettleSlide(0, 1, -0.1, 3)).toBe(1);
    expect(pickSettleSlide(1, 1, -0.6, 3)).toBe(2);
    expect(pickSettleSlide(1, 1, 0.6, 3)).toBe(0);
    expect(pickSettleSlide(2, 2, -0.9, 3)).toBe(2);
    expect(pickSettleSlide(0, 0, 0.9, 3)).toBe(0);
  });

  it('measures finger velocity over a recent window', () => {
    const samples = [{ t: 0, x: 0 }, { t: 400, x: 100 }, { t: 450, x: 90 }, { t: 500, x: 70 }];
    expect(sampleVelocity(samples, 500, 100)).toBeCloseTo(-0.3, 6);
    expect(sampleVelocity(samples, 5000, 100)).toBe(0);
    expect(sampleVelocity([], 0)).toBe(0);
  });
});
