import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { TextLayer } from '@/types';
import { useEditor } from '@/store/editor';
import { resolveFontFamily } from '@/render/fonts/families';

/** iOS Safari zooms the whole page when a field with a smaller font gets focus. */
const MIN_FONT_PX = 16;
/** Editing a sliver of a text box is hopeless with a thumb, so narrow boxes get a roomier editor. */
const MIN_WIDTH_PX = 160;
const EDGE = 8;
const DONE_WIDTH = 76;
const DONE_HEIGHT = 40;
const DONE_GAP = 6;

interface Props {
  layer: TextLayer;
  stage: Konva.Stage;
  offsetX?: number;
  scale?: number;
  viewportOffset?: { x: number; y: number };
  onClose: () => void;
}

interface Box { left: number; top: number; width: number; height: number }

function readViewport(): Box {
  const vv = window.visualViewport;
  return vv ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/** The part of the screen not covered by the on-screen keyboard. It changes as the keyboard opens and closes. */
function useVisibleViewport() {
  const [box, setBox] = useState(readViewport);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setBox(readViewport());
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return box;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * In-place text editor for touch screens. It sits over the layer like the desktop editor, but
 * never drops below 16px type (no iOS focus zoom), grows with its text, stays inside the part of
 * the screen the keyboard leaves free, and has a Done button because there is no Escape key.
 */
export function MobileTextEditor({ layer, stage, offsetX = 0, scale: scaleProp, viewportOffset, onClose }: Props) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const viewport = useVisibleViewport();
  const [contentHeight, setContentHeight] = useState(0);

  const scale = scaleProp ?? stage.scaleX();
  const stageBox = stage.container().getBoundingClientRect();
  const wantLeft = stageBox.left + (offsetX + layer.x) * scale + (viewportOffset?.x ?? stage.x());
  const wantTop = stageBox.top + layer.y * scale + (viewportOffset?.y ?? stage.y());
  const fontPx = Math.max(MIN_FONT_PX, layer.fontSize * scale);
  const width = Math.min(Math.max(layer.width * scale, MIN_WIDTH_PX), viewport.width - EDGE * 2);

  // Keep the whole editor, and the Done button above it, inside the visible viewport.
  const maxHeight = Math.max(MIN_FONT_PX * 2, viewport.height - EDGE * 2 - DONE_HEIGHT - DONE_GAP);
  const height = Math.min(contentHeight || fontPx * layer.lineHeight * Math.max(1, layer.text.split('\n').length), maxHeight);
  const left = clamp(wantLeft, viewport.left + EDGE, viewport.left + viewport.width - width - EDGE);
  const top = clamp(wantTop, viewport.top + EDGE + DONE_HEIGHT + DONE_GAP, viewport.top + viewport.height - height - EDGE);
  const displaced = Math.abs(left - wantLeft) > 1 || Math.abs(top - wantTop) > 1 || width > layer.width * scale + 1;

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // The height is managed here rather than through the style prop: it follows the text.
    el.style.height = 'auto';
    const next = el.scrollHeight;
    el.style.height = `${next}px`;
    setContentHeight(next);
  }, []);

  // Focus synchronously: iOS only opens the keyboard from inside the tap that asked for it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
    fit();
    // Wrapping changes once the web font arrives, which changes the height.
    document.fonts?.addEventListener('loadingdone', fit);
    void document.fonts?.ready.then(fit);
    return () => document.fonts?.removeEventListener('loadingdone', fit);
  }, [fit]);
  // A stylesheet rule for form fields may force its own size; inline !important wins over it.
  useLayoutEffect(() => { ref.current?.style.setProperty('font-size', `${fontPx}px`, 'important'); fit(); }, [fit, fontPx, width]);

  return (
    <>
      <textarea
        ref={ref}
        data-text-editor
        aria-label="Edit text"
        defaultValue={layer.text}
        autoCapitalize="sentences"
        onInput={fit}
        onBlur={(e) => {
          updateLayer(layer.id, { text: e.target.value });
          onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        style={{
          position: 'fixed',
          left,
          top,
          width,
          maxHeight,
          fontFamily: resolveFontFamily(layer.fontFamily),
          fontWeight: layer.fontWeight,
          fontStyle: layer.italic ? 'italic' : 'normal',
          color: displaced ? '#ffffff' : layer.fill,
          caretColor: '#7c5cff',
          textAlign: layer.align,
          lineHeight: layer.lineHeight,
          letterSpacing: layer.letterSpacing * (fontPx / layer.fontSize),
          background: displaced ? 'rgba(18, 18, 22, 0.94)' : 'transparent',
          border: displaced ? '1.5px solid #7c5cff' : '1px dashed #7c5cff',
          borderRadius: displaced ? 10 : 0,
          // Replaces the app-wide focus ring, which would draw over the layer's own outline.
          boxShadow: displaced ? '0 8px 24px rgba(0, 0, 0, 0.45)' : 'none',
          outline: 'none',
          resize: 'none',
          padding: displaced ? 8 : 0,
          margin: 0,
          zIndex: 100,
          overflowX: 'hidden',
          overflowY: 'auto',
          touchAction: 'manipulation',
          // Sizing is measured right after style changes; a transition would make it read the old values.
          transition: 'none',
        }}
      />
      <button
        type="button"
        aria-label="Done editing text"
        // Keep focus in the field until the click, so the keyboard doesn't flicker.
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => ref.current?.blur()}
        className="flex items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-white shadow-lift active:bg-accent-hover"
        style={{ position: 'fixed', left: left + width - DONE_WIDTH, top: top - DONE_HEIGHT - DONE_GAP, width: DONE_WIDTH, height: DONE_HEIGHT, zIndex: 101, touchAction: 'manipulation' }}
      >
        Done
      </button>
    </>
  );
}
