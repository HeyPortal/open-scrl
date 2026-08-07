export function captureSlotForElapsed(
  elapsedMs: number,
  fps: number,
  totalFrames: number,
  scheduledSlot: number,
) {
  // MP4 tracks must begin at timestamp zero even if the browser delays the
  // first capture task by more than one frame interval.
  if (scheduledSlot === 0) return 0;
  return Math.min(
    totalFrames - 1,
    Math.max(scheduledSlot, Math.floor(Math.max(0, elapsedMs) * fps / 1000)),
  );
}
