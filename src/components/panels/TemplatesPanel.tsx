import { type CSSProperties, useState } from 'react';
import { GRID_TEMPLATES, type GridTemplate } from '@/lib/grids';
import { useEditor } from '@/store/editor';

function GridThumb({ tpl }: { tpl: GridTemplate }) {
  const W = 80;
  const H = 100;
  const cells = tpl.cells(W, H, 4);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full rounded"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={W} height={H} fill="#1d1d27" />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill="#3a3a48" rx="2" />
      ))}
    </svg>
  );
}

export function TemplatesPanel() {
  const applyGrid = useEditor((s) => s.applyGrid);
  const [gap, setGap] = useState(16);
  const gapFill = `${(gap / 120) * 100}%`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-section">Photo grids</div>
      <div className="border-b border-line px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-dim">Gap</span>
          <span className="text-xs text-ink-dim">{gap}</span>
        </div>
        <div className="rounded-xl border border-line bg-bg/90 px-2 py-1.5 shadow-inner">
          <input
            type="range"
            min={0}
            max={120}
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
            className="inspector-range"
            style={{ '--range-fill': gapFill } as CSSProperties}
            aria-valuetext={`${gap} pixels`}
          />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-auto px-3 pb-3 scrollbar-thin">
        {GRID_TEMPLATES.map((t) => (
          <button
            key={t.id}
            className="card flex min-h-[140px] flex-col text-center transition-colors hover:border-accent"
            onClick={() => applyGrid(t, gap)}
          >
            <div className="flex h-28 shrink-0 items-center justify-center bg-bg-inset p-2">
              <GridThumb tpl={t} />
            </div>
            <div className="min-h-0 px-2 py-1.5 text-center text-xs">
              <span className="block min-w-0 truncate">{t.name}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
