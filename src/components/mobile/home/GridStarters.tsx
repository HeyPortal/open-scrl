import { Loader2 } from 'lucide-react';
import type { Format } from '@/types';
import { GRID_TEMPLATES, type GridTemplate } from '@/lib/grids';
import { fitBox } from './projectDisplay';

/** A curated handful of layouts; the full set lives in the editor's Grids panel. */
const STARTER_IDS = ['two-v', 'three-h', 'one-plus-two', 'four-grid', 'l-shape', 'one-plus-three', 'six-grid', 'nine-grid'];

export const STARTER_TEMPLATES: GridTemplate[] = STARTER_IDS.flatMap((id) => GRID_TEMPLATES.find((template) => template.id === id) ?? []);

/** Spacing (in canvas px) applied to the first slide when a project starts from a grid. */
export const STARTER_GAP = 16;
export const STARTER_MARGIN = 16;

const THUMB_BOX = { width: 56, height: 72 };

/** Cell diagram drawn in a 100-unit tall space so the gap reads at thumbnail size. */
function GridThumb({ template, format, index }: { template: GridTemplate; format: Format; index: number }) {
  const size = fitBox(format, THUMB_BOX.width, THUMB_BOX.height);
  const viewH = 100;
  const viewW = (format.width / format.height) * viewH;
  const cells = template.cells(viewW, viewH, 4);
  return (
    <svg width={size.width} height={size.height} viewBox={`0 0 ${viewW} ${viewH}`} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={`home-grid-fill-${index}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a82ff" />
          <stop offset="1" stopColor="#6a49f2" />
        </linearGradient>
      </defs>
      {cells.map((cell, i) => (
        <rect
          key={i}
          x={cell.x}
          y={cell.y}
          width={cell.w}
          height={cell.h}
          rx={4}
          fill={`url(#home-grid-fill-${index})`}
          opacity={0.55 + ((i * 7) % 4) * 0.15}
        />
      ))}
    </svg>
  );
}

interface GridStartersProps {
  format: Format;
  /** Template id currently being created, if any. */
  pendingId: string | null;
  busy: boolean;
  onPick: (template: GridTemplate) => void;
}

export function GridStarters({ format, pendingId, busy, onPick }: GridStartersProps) {
  return (
    <section aria-labelledby="home-grids-title" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-grids-title" className="text-[17px] font-semibold tracking-tight">
          Start from a grid
        </h2>
        <span className="truncate text-[12px] text-ink-faint">{format.name}</span>
      </div>
      <p className="mt-0.5 text-[13px] text-ink-faint">Photo layouts, ready to fill.</p>

      <ul className="home-hscroll -mx-4 mt-3 flex snap-x snap-proximity gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1">
        {STARTER_TEMPLATES.map((template, index) => {
          const pending = pendingId === template.id;
          return (
            <li key={template.id} className="shrink-0 snap-start">
              <button
                type="button"
                disabled={busy}
                aria-busy={pending}
                aria-label={`Start with ${template.name} grid`}
                onClick={() => onPick(template)}
                className="group flex w-[82px] flex-col items-center gap-1.5 transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-60 motion-reduce:active:scale-100"
              >
                <span className="relative flex h-[96px] w-full items-center justify-center rounded-2xl border border-line bg-bg-panel transition-colors group-active:bg-bg-hover">
                  <GridThumb template={template} format={format} index={index} />
                  {pending && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/55">
                      <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
                    </span>
                  )}
                </span>
                <span className="text-[12px] font-medium leading-tight text-ink-dim">{template.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
