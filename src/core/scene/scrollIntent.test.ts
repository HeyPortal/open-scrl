import { describe, expect, it } from 'vitest';
import { getCanvasScrollIntent } from './scrollIntent';

describe('canvas scroll intent', () => {
  it('maps a normal mouse wheel to the horizontal carousel at fit zoom', () => {
    expect(getCanvasScrollIntent({ deltaX: 0, deltaY: 120, canScrollX: true, canScrollY: false, shiftKey: false })).toEqual({ left: 120, top: 0 });
  });

  it('preserves vertical scrolling when zoom creates vertical overflow', () => {
    expect(getCanvasScrollIntent({ deltaX: 0, deltaY: 120, canScrollX: true, canScrollY: true, shiftKey: false })).toEqual({ left: 0, top: 120 });
  });

  it('uses shift-wheel as an explicit horizontal gesture', () => {
    expect(getCanvasScrollIntent({ deltaX: 0, deltaY: -80, canScrollX: true, canScrollY: true, shiftKey: true })).toEqual({ left: -80, top: 0 });
  });
});
