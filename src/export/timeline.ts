/** Presentation timestamp, in microseconds, of an MP4 frame. */
export function frameTimestamp(frameIndex: number, fps: number) {
  return Math.round(frameIndex * 1_000_000 / fps);
}

/**
 * Slide time, in seconds, sampled for an MP4 frame. The small bias keeps a
 * frame that lands exactly on a source frame boundary from resolving to the
 * previous source frame through floating-point error.
 */
export function frameTime(frameIndex: number, fps: number) {
  return frameIndex / fps + 1e-6;
}

/** Maps slide time onto a looping source of `periodSeconds`, matching a looping media element. */
export function loopedSourceTime(timeSeconds: number, periodSeconds: number) {
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return 0;
  const time = timeSeconds % periodSeconds;
  return time < 0 ? time + periodSeconds : time;
}
