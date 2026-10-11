import type { KeyboardEvent } from 'react';

/** Arrow-key navigation for a roving-tabindex radio group: returns the index to select, or null. */
export function radioKeyTarget(event: KeyboardEvent, index: number, count: number): number | null {
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
