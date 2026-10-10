import { Loader2 } from 'lucide-react';
import type { Format } from '@/types';
import { GRID_TEMPLATES, type GridTemplate } from '@/lib/grids';
import { fitBox } from './projectDisplay';
import './home.css';

/** A curated handful of layouts; the full set lives in the editor's Grids panel. */
const STARTER_IDS = ['two-v', 'three-h', 'one-plus-two', 'four-grid', 'l-shape', 'one-plus-three', 'six-grid', 'nine-grid'];

export const STARTER_TEMPLATES: GridTemplate[] = STARTER_IDS.flatMap((id) => GRID_TEMPLATES.find((template) => template.id === id) ?? []);

const THUMB_BOX = { width: 52, height: 68 };

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
          <stop offset="0" style={{ stopColor: 'rgb(var(--c-accent-start))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--c-accent-end))' }} />
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
  /** 'phone' scrolls sideways; 'desktop' lays the tiles out as a grid. */
  variant?: 'phone' | 'desktop';
}

/** Photo-layout starters shared by both home screens; picking one creates a project with that grid applied. */
export function GridStarters({ format, pendingId, busy, onPick, variant = 'phone' }: GridStartersProps) {
  return (
    <section aria-labelledby="home-grids-title" className="home-section home-starters" data-variant={variant}>
      <div className="home-section-head">
        <div className="min-w-0">
          <h2 id="home-grids-title" className="home-section-title">Start from a grid</h2>
          <p className="home-section-sub">Photo layouts, ready to fill.</p>
        </div>
        <span className="home-section-aside">{format.name}</span>
      </div>

      <ul className="home-starters-list home-hscroll">
        {STARTER_TEMPLATES.map((template, index) => {
          const pending = pendingId === template.id;
          return (
            <li key={template.id}>
              <button
                type="button"
                disabled={busy}
                aria-busy={pending}
                aria-label={`Start with ${template.name} grid`}
                onClick={() => onPick(template)}
                className="home-starter"
              >
                <span className="home-starter-well">
                  <GridThumb template={template} format={format} index={index} />
                  {pending && (
                    <span className="home-starter-busy">
                      <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
                    </span>
                  )}
                </span>
                <span className="home-starter-label">{template.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
