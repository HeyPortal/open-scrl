import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomSheet, type SheetDetent } from './BottomSheet';

const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;

beforeAll(() => {
  // jsdom has no pointer capture; the sheet calls it on every drag start.
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterAll(() => {
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
});

afterEach(cleanup);

function renderSheet(detent: SheetDetent) {
  const onDetentChange = vi.fn<(detent: SheetDetent) => void>();
  const onClose = vi.fn<() => void>();
  render(
    <BottomSheet title="Photos" detent={detent} onDetentChange={onDetentChange} onClose={onClose}>
      <p>Sheet body</p>
    </BottomSheet>,
  );
  return { onDetentChange, onClose };
}

/** The handle button, whose accessible name depends on the current detent. */
function handleButton() {
  return screen.getByRole('button', { name: /^(Expand|Collapse) Photos$/ });
}

/** The grip strip that owns the pointer handlers: the handle button's parent. */
function gripArea() {
  const area = handleButton().parentElement;
  if (!area) throw new Error('handle button has no grip area');
  return area;
}

/** Press at `startY`, move to `endY`, then release (or cancel) at `endY`. */
function drag(startY: number, endY: number, { cancel = false } = {}) {
  const grip = gripArea();
  fireEvent.pointerDown(grip, { pointerId: 1, clientY: startY });
  fireEvent.pointerMove(grip, { pointerId: 1, clientY: endY });
  if (cancel) fireEvent.pointerCancel(grip, { pointerId: 1, clientY: endY });
  else fireEvent.pointerUp(grip, { pointerId: 1, clientY: endY });
}

describe('BottomSheet', () => {
  it.each<SheetDetent>(['half', 'full'])('is a region labelled by its title and reports the %s detent', (detent) => {
    renderSheet(detent);
    const sheet = screen.getByRole('region', { name: 'Photos' });
    expect(sheet).toHaveAttribute('data-detent', detent);
  });

  it('renders the title heading and children', () => {
    renderSheet('half');
    expect(screen.getByRole('heading', { name: 'Photos' })).toBeInTheDocument();
    expect(screen.getByText('Sheet body')).toBeInTheDocument();
  });

  it('calls onClose from the close button', () => {
    const { onClose, onDetentChange } = renderSheet('half');
    fireEvent.click(screen.getByRole('button', { name: 'Close Photos' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDetentChange).not.toHaveBeenCalled();
  });

  it('expands from half when the handle is activated from the keyboard', () => {
    const { onDetentChange, onClose } = renderSheet('half');
    fireEvent.click(handleButton(), { detail: 0 });
    expect(onDetentChange).toHaveBeenCalledExactlyOnceWith('full');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('collapses from full when the handle is activated from the keyboard', () => {
    const { onDetentChange } = renderSheet('full');
    fireEvent.click(handleButton(), { detail: 0 });
    expect(onDetentChange).toHaveBeenCalledExactlyOnceWith('half');
  });

  it('leaves a mouse click on the handle to the pointer handlers', () => {
    const { onDetentChange } = renderSheet('half');
    fireEvent.click(handleButton(), { detail: 1 });
    expect(onDetentChange).not.toHaveBeenCalled();
  });

  describe('dragging the grip', () => {
    it('drags up from half to full', () => {
      const { onDetentChange, onClose } = renderSheet('half');
      drag(500, 400);
      expect(onDetentChange).toHaveBeenCalledExactlyOnceWith('full');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('drags down from half to close', () => {
      const { onDetentChange, onClose } = renderSheet('half');
      drag(500, 600);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onDetentChange).not.toHaveBeenCalled();
    });

    it('drags down from full to half', () => {
      const { onDetentChange, onClose } = renderSheet('full');
      drag(500, 600);
      expect(onDetentChange).toHaveBeenCalledExactlyOnceWith('half');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('drags far down from full to close', () => {
      const { onDetentChange, onClose } = renderSheet('full');
      drag(500, 800);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onDetentChange).not.toHaveBeenCalled();
    });

    it.each<[SheetDetent, number, SheetDetent]>([
      ['half', 503, 'full'],
      ['full', 497, 'half'],
    ])('treats a movement under 6 px from %s (to y=%i) as a tap that toggles to %s', (detent, endY, expected) => {
      const { onDetentChange, onClose } = renderSheet(detent);
      drag(500, endY);
      expect(onDetentChange).toHaveBeenCalledExactlyOnceWith(expected);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores a release from a different pointer', () => {
      const { onDetentChange, onClose } = renderSheet('half');
      const grip = gripArea();
      fireEvent.pointerDown(grip, { pointerId: 1, clientY: 500 });
      fireEvent.pointerUp(grip, { pointerId: 2, clientY: 400 });
      expect(onDetentChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('calls neither callback when the pointer is cancelled', () => {
      const { onDetentChange, onClose } = renderSheet('half');
      const grip = gripArea();
      fireEvent.pointerDown(grip, { pointerId: 1, clientY: 500 });
      fireEvent.pointerMove(grip, { pointerId: 1, clientY: 400 });
      fireEvent.pointerCancel(grip, { pointerId: 1, clientY: 400 });
      // The cancelled gesture is over: a later release must not act on it.
      fireEvent.pointerUp(grip, { pointerId: 1, clientY: 400 });
      expect(onDetentChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
