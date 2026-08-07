import { describe, expect, it } from 'vitest';
import { captureSlotForElapsed } from './timeline';

describe('video export capture timeline', () => {
  it('drops overdue capture slots instead of compressing wall-clock playback', () => {
    expect(captureSlotForElapsed(0, 60, 180, 0)).toBe(0);
    expect(captureSlotForElapsed(510, 60, 180, 0)).toBe(0);
    expect(captureSlotForElapsed(510, 60, 180, 1)).toBe(30);
    expect(captureSlotForElapsed(10_000, 60, 180, 31)).toBe(179);
  });
});
