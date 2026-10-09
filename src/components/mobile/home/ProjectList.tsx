import { useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, Search, X } from 'lucide-react';
import type { ProjectSummary } from '@/store/editor';
import { coverFor, fitBox, relativeTime, slideLabel } from './projectDisplay';

/** Search only earns its space once the list is long enough to need it. */
const SEARCH_THRESHOLD = 3;

function ProjectCover({ project, size, frame }: { project: ProjectSummary; size: number; frame: number }) {
  const box = fitBox(project.format, size, size);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-bg ring-1 ring-inset ring-line" style={{ width: frame, height: frame }}>
      <span className="block rounded-[4px] ring-1 ring-inset ring-white/10" style={{ ...box, background: coverFor(project.id) }} aria-hidden />
    </span>
  );
}

function EmptyState() {
  return (
    <div className="home-rise-in flex flex-col items-center rounded-[22px] border border-dashed border-line-strong px-6 pb-8 pt-9 text-center">
      <div className="relative mb-6 h-[84px] w-[136px]" aria-hidden>
        <span className="absolute left-3 top-3 h-[66px] w-[52px] -rotate-[9deg] rounded-lg bg-gradient-to-br from-[#0ea5e9] to-[#10b981] opacity-80 ring-1 ring-white/10" />
        <span className="absolute right-3 top-3 h-[66px] w-[52px] rotate-[9deg] rounded-lg bg-gradient-to-br from-[#f59e0b] to-[#e11d48] opacity-80 ring-1 ring-white/10" />
        <span className="absolute left-1/2 top-0 grid h-[78px] w-[60px] -translate-x-1/2 grid-cols-2 grid-rows-2 gap-1 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#4f46e5] p-1.5 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.7)] ring-1 ring-white/15">
          <span className="rounded-[3px] bg-white/30" />
          <span className="rounded-[3px] bg-white/20" />
          <span className="col-span-2 rounded-[3px] bg-white/25" />
        </span>
        <span className="absolute -bottom-1 right-5 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_14px_-4px_rgba(124,92,255,0.9)] ring-4 ring-bg">
          <Plus size={16} strokeWidth={2.5} />
        </span>
      </div>
      <h3 className="heading-md">No carousels yet</h3>
      <p className="mt-1 max-w-[260px] text-[13px] leading-snug text-ink-faint">Create your first one above and it will show up here.</p>
    </div>
  );
}

interface ProjectRowProps {
  project: ProjectSummary;
  last: boolean;
  isOpening: boolean;
  busy: boolean;
  now: number;
  onOpen: () => void;
}

function ProjectRow({ project, last, isOpening, busy, now, onOpen }: ProjectRowProps) {
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-busy={isOpening}
        aria-label={`Open ${project.name}`}
        className="flex min-h-[76px] w-full items-center gap-3 py-3 pl-3.5 pr-3 text-left transition-colors duration-100 active:bg-bg-hover disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="relative">
          <ProjectCover project={project} size={38} frame={52} />
          {isOpening && (
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
              <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="heading-sm block truncate text-ink">{project.name}</span>
          <span className="mt-1 block truncate text-[13px] leading-tight text-ink-dim">
            {project.format.name} · {slideLabel(project.slideCount)}
          </span>
          <span className="mt-0.5 block truncate text-[12px] leading-tight text-ink-faint">Edited {relativeTime(project.updatedAt, now)}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden />
      </button>
      {!last && <span className="pointer-events-none absolute bottom-0 left-[82px] right-0 h-px bg-line" aria-hidden />}
    </li>
  );
}

interface ProjectListProps {
  projects: ProjectSummary[];
  openingId: string | null;
  busy: boolean;
  onOpen: (project: ProjectSummary) => void;
}

export function ProjectList({ projects, openingId, busy, onOpen }: ProjectListProps) {
  const [query, setQuery] = useState('');
  const showSearch = projects.length > SEARCH_THRESHOLD;
  const term = showSearch ? query.trim().toLowerCase() : '';
  const visible = useMemo(
    () => (term ? projects.filter((p) => p.name.toLowerCase().includes(term) || p.format.name.toLowerCase().includes(term)) : projects),
    [projects, term],
  );
  const now = Date.now();

  return (
    <section aria-labelledby="home-projects-title" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-projects-title" className="heading-lg">
          Your projects
        </h2>
        {projects.length > 0 && <span className="text-[13px] tabular-nums text-ink-faint">{projects.length}</span>}
      </div>

      {showSearch && (
        <div className="relative mt-3">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            className="h-11 w-full rounded-xl border border-transparent bg-bg-inset pl-10 pr-11 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-ink-faint active:text-ink"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-line-strong text-ink-dim">
                <X size={12} strokeWidth={2.5} aria-hidden />
              </span>
            </button>
          )}
        </div>
      )}

      <div className="mt-3">
        {projects.length === 0 ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <p role="status" className="rounded-2xl border border-line px-6 py-10 text-center text-[14px] text-ink-faint">
            No projects match “{query.trim()}”.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-[20px] border border-line bg-bg-panel">
            {visible.map((project, index) => (
              <ProjectRow
                key={project.id}
                project={project}
                last={index === visible.length - 1}
                isOpening={openingId === project.id}
                busy={busy}
                now={now}
                onOpen={() => onOpen(project)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
