import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { GRID_TEMPLATES, MAX_GRID_INSET, linkedMax, maxMargin, type GridTemplate } from '@/lib/grids';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { LinkedSliders, PanelHeader, Slider } from '../ui';
import { isMac } from '@/app/actions';

function GridThumb({ tpl, gap, margin, ratio }: { tpl: GridTemplate; gap: number; margin: number; ratio: number }) {
  const W = 80;
  const H = W / ratio;
  const previewGap = (gap / 120) * 8;
  const previewMargin = (margin / 120) * 8;
  const cells = tpl.cells(W - 2 * previewMargin, H - 2 * previewMargin, previewGap).map((c) => ({ ...c, x: c.x + previewMargin, y: c.y + previewMargin }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect width={W} height={H} rx={2} fill="rgb(var(--c-bg-rail))" />
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          rx={previewGap > 0 ? 1.5 : 0}
          className="fill-template transition-colors group-hover:fill-accent"
          stroke={previewGap === 0 ? 'rgb(var(--c-bg-rail))' : undefined}
          strokeWidth={previewGap === 0 ? 0.8 : 0}
        />
      ))}
    </svg>
  );
}

/** `sheet` is the touch layout used inside the mobile bottom sheet; `sidebar` is the desktop panel. */
export function TemplatesPanel({ layout = 'sidebar' }: { layout?: 'sidebar' | 'sheet' }) {
  const sheet = layout === 'sheet';
  const applyGrid = useEditor((s) => s.applyGrid);
  const linkGridSpacing = useEditor((s) => s.linkGridSpacing);
  const format = useEditor((s) => s.doc.format);
  const [gap, setGap] = useState(0);
  const [margin, setMargin] = useState(0);
  const [spacingOpen, setSpacingOpen] = useState(false);
  const linked = useEditorSession((s) => s.gridLinked);
  const setGridLinked = useEditorSession((s) => s.setGridLinked);
  // No template is chosen yet, so the shared limit is just the slider range; each template clamps its own layout.
  const marginMax = maxMargin(format.width, format.height);
  const sharedMax = Math.min(MAX_GRID_INSET, marginMax);
  const setBoth = (v: number) => { setGap(v); setMargin(v); };
  const toggleLinked = () => {
    if (!linked) { setBoth(Math.min(gap, sharedMax)); linkGridSpacing(); }
    setGridLinked(!linked);
  };
  const ratio = format.width / format.height;

  const sliders = (
    <LinkedSliders
      linked={linked}
      onToggle={toggleLinked}
      top={<Slider label="Gap between photos" display={`${gap} px`} min={0} max={linked ? sharedMax : 120} value={Math.min(gap, linked ? sharedMax : 120)} onChange={linked ? setBoth : setGap} valueText={`${gap} pixels`} />}
      bottom={<Slider label="Outer margin" display={`${margin} px`} min={0} max={marginMax} value={Math.min(margin, marginMax)} onChange={linked ? setBoth : setMargin} valueText={`${margin} pixels`} />}
    />
  );

  return (
    <div className={sheet ? 'lib-panel flex flex-col' : 'lib-panel flex h-full min-h-0 flex-col'}>
      {sheet
        ? <p className="lib-hint px-4 pb-3">Replaces this slide's layers with empty photo slots.</p>
        : <PanelHeader title="Photo grids" hint={`Replaces the current slide's layers with empty photo slots. Undo with ${isMac ? '⌘' : 'Ctrl'} Z.`} />}
      {sheet ? (
        <div className="px-4 pb-4">
          <button
            type="button"
            aria-expanded={spacingOpen}
            onClick={() => setSpacingOpen((open) => !open)}
            className="flex h-12 w-full items-center gap-3 rounded-xl bg-bg-inset px-3.5 text-left transition-colors hover:bg-bg-hover active:bg-bg-hover"
          >
            <SlidersHorizontal size={18} className="shrink-0 text-ink-dim" aria-hidden />
            <span className="flex-1 text-[14px] font-medium text-ink">Spacing</span>
            <span className="text-[12px] tabular-nums text-ink-dim">Gap {gap} · Margin {margin}</span>
            <ChevronDown size={16} className={`shrink-0 text-ink-dim transition-transform duration-150 ${spacingOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {spacingOpen && <div className="pt-3">{sliders}</div>}
        </div>
      ) : (
        <div className="space-y-2.5 px-3 pb-3">{sliders}</div>
      )}
      <div className={sheet ? 'lib-grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] content-start gap-1 border-t border-line px-2.5 py-3' : 'lib-card-grid min-h-0 flex-1 content-start gap-1 overflow-auto border-t border-line px-1.5 py-3 scrollbar-thin'}>
        {GRID_TEMPLATES.map((t) => {
          // Linked spacing has to fit this template, or the inspector would show a smaller value than the one stored.
          const v = Math.min(gap, linkedMax(t, format));
          const tGap = linked ? v : gap;
          const tMargin = linked ? v : margin;
          return (
            <button
              key={t.id}
              className={`lib-card group flex flex-col items-stretch gap-1.5 p-1.5 text-center ${sheet ? 'lib-card-sheet' : ''}`}
              onClick={() => applyGrid(t, tGap, tMargin)}
              title={`Apply “${t.name}” grid`}
            >
              <div className="lib-card-well flex aspect-[4/5] items-center justify-center p-1.5">
                <GridThumb tpl={t} gap={tGap} margin={tMargin} ratio={ratio} />
              </div>
              <span className="lib-card-label block truncate">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
