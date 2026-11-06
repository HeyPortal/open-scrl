import { describe, expect, it } from 'vitest';
import { frameTime, frameTimestamp, loopedSourceTime } from './timeline';

describe('video export timeline', () => {
  it('spaces frame timestamps evenly from zero', () => {
    expect(frameTimestamp(0, 60)).toBe(0);
    expect(frameTimestamp(1, 60)).toBe(16_667);
    expect(frameTimestamp(60, 60)).toBe(1_000_000);
    expect(frameTimestamp(179, 30)).toBe(5_966_667);
  });

  it('samples source frames that start exactly on an output frame', () => {
    expect(Math.floor(frameTime(2, 60) * 30)).toBe(1);
    expect(Math.floor(frameTime(120, 60) * 30)).toBe(60);
    expect(frameTime(1, 60) - 1 / 60).toBeLessThan(1 / 240);
  });

  it('loops shorter sources over the slide duration', () => {
    expect(loopedSourceTime(0.5, 2)).toBe(0.5);
    expect(loopedSourceTime(2, 2)).toBe(0);
    expect(loopedSourceTime(4.25, 2)).toBe(0.25);
    expect(loopedSourceTime(1, 0)).toBe(0);
    expect(loopedSourceTime(1, Number.NaN)).toBe(0);
  });
});
