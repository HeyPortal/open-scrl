import { useState } from 'react';
import { PostTemplates } from './PostTemplates';
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
      <rect width={W} height={H} rx={2} fill="#141417" />
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          rx={previewGap > 0 ? 1.5 : 0}
          className="fill-[#3a3a44] transition-colors group-hover:fill-[#7c5cff]"
          stroke={previewGap === 0 ? '#141417' : undefined}
          strokeWidth={previewGap === 0 ? 0.8 : 0}
        />
      ))}
    </svg>
  );
}

export function TemplatesPanel() {
  const applyGrid = useEditor((s) => s.applyGrid);
  const linkGridSpacing = useEditor((s) => s.linkGridSpacing);
  const format = useEditor((s) => s.doc.format);
  const [tab, setTab] = useState<'grids' | 'posts'>('grids');
  const [gap, setGap] = useState(0);
  const [margin, setMargin] = useState(0);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="segmented mx-3 mt-3 grid-cols-2" aria-label="Template types">
        <button className={`segmented-btn ${tab === 'grids' ? 'segmented-btn-active' : ''}`} onClick={() => setTab('grids')}>Photo grids</button>
        <button className={`segmented-btn ${tab === 'posts' ? 'segmented-btn-active' : ''}`} onClick={() => setTab('posts')}>Post templates</button>
      </div>
      {tab === 'posts' ? <div className="min-h-0 flex-1 overflow-auto pt-3"><PostTemplates/></div> : <>
      <PanelHeader title="Photo grids" hint={`Replaces the current slide's layers with empty photo slots. Undo with ${isMac ? '⌘' : 'Ctrl'} Z.`} />
      <div className="space-y-2.5 px-3 pb-3">
        <LinkedSliders
          linked={linked}
          onToggle={toggleLinked}
          top={<Slider label="Gap between photos" display={`${gap} px`} min={0} max={linked ? sharedMax : 120} value={Math.min(gap, linked ? sharedMax : 120)} onChange={linked ? setBoth : setGap} valueText={`${gap} pixels`} />}
          bottom={<Slider label="Outer margin" display={`${margin} px`} min={0} max={marginMax} value={Math.min(margin, marginMax)} onChange={linked ? setBoth : setMargin} valueText={`${margin} pixels`} />}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-auto border-t border-line px-3 py-3 scrollbar-thin">
        {GRID_TEMPLATES.map((t) => {
          // Linked spacing has to fit this template, or the inspector would show a smaller value than the one stored.
          const v = Math.min(gap, linkedMax(t, format));
          const tGap = linked ? v : gap;
          const tMargin = linked ? v : margin;
          return (
            <button
              key={t.id}
              className="tile group flex flex-col items-stretch gap-1.5 p-1.5 text-center"
              onClick={() => applyGrid(t, tGap, tMargin)}
              title={`Apply “${t.name}” grid`}
            >
              <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-bg-inset p-1.5">
                <GridThumb tpl={t} gap={tGap} margin={tMargin} ratio={ratio} />
              </div>
              <span className="block truncate text-[11px] font-medium text-ink-dim group-hover:text-ink">{t.name}</span>
            </button>
          );
        })}
      </div>
      </>}
    </div>
  );
}
