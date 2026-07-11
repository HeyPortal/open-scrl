export interface ScrollIntentInput {
  deltaX: number;
  deltaY: number;
  canScrollX: boolean;
  canScrollY: boolean;
  shiftKey: boolean;
}

export function getCanvasScrollIntent(input: ScrollIntentInput): { left: number; top: number } {
  if (input.shiftKey) return { left: input.deltaX + input.deltaY, top: 0 };
  if (input.canScrollX && !input.canScrollY) {
    return { left: input.deltaX + input.deltaY, top: 0 };
  }
  return { left: input.deltaX, top: input.deltaY };
}
