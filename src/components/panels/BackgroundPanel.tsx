import { useRef } from 'react';
import { Check } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import type { Background } from '@/types';
import { GRADIENT_SWATCHES, SOLID_SWATCHES, backgroundCss, sameBackground } from '@/lib/palette';
import { ColorField, PanelHeader, Slider, type Gesture } from '../ui';

function Swatch({ bg, active, label, onClick, className = '' }: { bg: Background; active: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      className={`relative flex items-center justify-center rounded-md ring-1 ring-inset ring-white/10 transition-transform hover:scale-105 ${active ? 'outline outline-2 outline-offset-2 outline-accent' : ''} ${className}`}
      style={{ background: backgroundCss(bg) }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {active && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow">
          <Check size={10} strokeWidth={3} aria-hidden />
        </span>
      )}
    </button>
  );
}

export function BackgroundPanel() {
  const setBackground = useEditor((s) => s.setBackground);
  const setBackgroundForAllSlides = useEditor((s) => s.setBackgroundForAllSlides);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slideCount = useEditor((s) => s.doc.slideOrder.length);
  const slide = useEditor((s) => s.doc.slides[selectedSlideId || s.doc.slideOrder[0]]);
  const current = slide?.background;
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const commitTransaction = useEditor((s) => s.commitTransaction);
  const cancelTransaction = useEditor((s) => s.cancelTransaction);
  const angleTx = useRef<string | null>(null);
  // Dragging the angle slider records one undo step.
  const angleGesture: Gesture = {
    begin: () => { angleTx.current ??= beginTransaction('Change gradient angle'); },
    end: () => { if (angleTx.current) commitTransaction(angleTx.current); angleTx.current = null; },
    cancel: () => { if (angleTx.current) cancelTransaction(angleTx.current); angleTx.current = null; },
  };
  const gradient = current?.kind === 'gradient' ? current : { kind: 'gradient' as const, ...GRADIENT_SWATCHES[0] };

  return (
    <div className="flex h-full flex-col overflow-auto scrollbar-thin">
      <PanelHeader title="Background" hint="Changes apply to the selected slide." />

      <div className="border-t border-line px-3 py-3.5">
        <h3 className="section-title mb-2.5">Solid colour</h3>
        <div className="grid grid-cols-6 gap-2">
          {SOLID_SWATCHES.map((c) => {
            const bg = { kind: 'solid' as const, color: c };
            return <Swatch key={c} bg={bg} className="aspect-square" active={sameBackground(current, bg)} label={`Solid ${c}`} onClick={() => setBackground(bg)} />;
          })}
        </div>
        <div className="mt-3">
          <ColorField
            value={current?.kind === 'solid' ? current.color : '#ffffff'}
            onChange={(color) => setBackground({ kind: 'solid', color })}
            label="Custom background colour"
          />
        </div>
      </div>

      <div className="border-t border-line px-3 py-3.5">
        <h3 className="section-title mb-2.5">Gradient</h3>
        <div className="grid grid-cols-3 gap-2">
          {GRADIENT_SWATCHES.map((g) => {
            const bg = { kind: 'gradient' as const, ...g };
            return <Swatch key={backgroundCss(bg)} bg={bg} className="aspect-[4/3]" active={sameBackground(current, bg)} label={`Gradient ${g.from} to ${g.to}`} onClick={() => setBackground(bg)} />;
          })}
        </div>
        <div className="mt-2.5 space-y-2.5 rounded-lg border border-line p-2.5">
          <div className="h-7 rounded-md ring-1 ring-inset ring-white/10" style={{ background: backgroundCss(gradient) }} aria-hidden />
          <div className="grid grid-cols-2 gap-2">
            <ColorField value={gradient.from} onChange={(from) => setBackground({ ...gradient, from })} label="Gradient start colour" />
            <ColorField value={gradient.to} onChange={(to) => setBackground({ ...gradient, to })} label="Gradient end colour" />
          </div>
          <Slider label="Angle" display={`${gradient.angle}°`} min={0} max={360} value={gradient.angle} onChange={(angle) => setBackground({ ...gradient, angle })} gesture={angleGesture} valueText={`${gradient.angle} degrees`} />
        </div>
      </div>

      {slide && slideCount > 1 && (
        <div className="mt-auto border-t border-line p-4">
          <button className="btn btn-secondary w-full" onClick={() => setBackgroundForAllSlides(slide.background)}>
            Apply to all {slideCount} slides
          </button>
        </div>
      )}
    </div>
  );
}
