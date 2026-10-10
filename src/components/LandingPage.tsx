import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, HardDrive, Images, LayoutGrid, List, Loader2, Search } from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { useEditor } from '@/store/editor';
import type { ProjectSummary } from '@/store/editor';

type SortKey = 'updated' | 'created' | 'name';
type View = 'grid' | 'list';
const VIEW_KEY = 'open-scrl:project-view';

const formatDate = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);

const COVERS = [
  ['#f59e0b', '#e11d48'],
  ['#8b5cf6', '#4f46e5'],
  ['#0ea5e9', '#10b981'],
  ['#f472b6', '#8b5cf6'],
  ['#f97316', '#db2777'],
  ['#14b8a6', '#6366f1'],
];

/** Stable decorative cover colours per project (projects have no stored thumbnail). */
function coverFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [from, to] = COVERS[hash % COVERS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function fitBox(format: Format, maxW: number, maxH: number) {
  const r = format.width / format.height;
  return r >= maxW / maxH ? { width: maxW, height: maxW / r } : { width: maxH * r, height: maxH };
}

function FormatOption({ format, selected, onSelect }: { format: Format; selected: boolean; onSelect: () => void }) {
  const box = fitBox(format, 28, 34);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col items-center gap-2 rounded-lg px-1 pb-2 pt-3 text-center ring-1 ring-inset transition-colors ${
        selected ? 'bg-accent-soft ring-accent' : 'bg-bg-inset ring-transparent hover:bg-bg-hover hover:ring-line-strong'
      }`}
    >
      <span className="flex h-9 items-center justify-center">
        <span className={`block rounded-[3px] ${selected ? 'bg-accent' : 'bg-line-strong'}`} style={box} aria-hidden />
      </span>
      <span className="w-full">
        <span className={`block truncate text-[11px] font-medium ${selected ? 'text-ink' : 'text-ink-dim'}`}>{format.name}</span>
        <span className="block text-[10px] tabular-nums text-ink-faint">{format.width}×{format.height}</span>
      </span>
    </button>
  );
}

function Cover({ project, size }: { project: ProjectSummary; size: { w: number; h: number } }) {
  const box = fitBox(project.format, size.w, size.h);
  return <div className="rounded-[3px] ring-1 ring-inset ring-white/10" style={{ ...box, background: coverFor(project.id) }} aria-hidden />;
}

interface CardProps {
  project: ProjectSummary;
  busy: boolean;
  isOpening: boolean;
  onOpen: () => void;
}

function ProjectCard({ project, busy, isOpening, onOpen }: CardProps) {
  return (
    <button
      type="button"
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-bg-panel text-left transition-colors hover:border-line-strong hover:bg-bg-inset disabled:pointer-events-none disabled:opacity-50"
      onClick={onOpen}
      disabled={busy}
      aria-busy={isOpening}
    >
      <div className="relative flex h-32 items-center justify-center border-b border-line bg-bg">
        <div className="transition-transform duration-200 group-hover:scale-[1.04]">
          <Cover project={project} size={{ w: 120, h: 92 }} />
        </div>
        {isOpening && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden />
            <span className="sr-only">Opening project</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <h3 className="heading-sm truncate text-ink">{project.name}</h3>
        <p className="truncate text-[11px] text-ink-faint">
          {project.format.name} · {project.slideCount} slide{project.slideCount === 1 ? '' : 's'} · {formatDate(project.updatedAt)}
        </p>
      </div>
    </button>
  );
}

function ProjectRow({ project, busy, isOpening, onOpen }: CardProps) {
  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[40px_minmax(0,1fr)_140px_70px_170px_20px] items-center gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
      onClick={onOpen}
      disabled={busy}
      aria-busy={isOpening}
    >
      <span className="flex h-8 w-10 items-center justify-center rounded bg-bg">
        <Cover project={project} size={{ w: 30, h: 26 }} />
      </span>
      <span className="heading-sm truncate text-ink">{project.name}</span>
      <span className="truncate text-ink-dim">{project.format.name}</span>
      <span className="tabular-nums text-ink-dim">{project.slideCount}</span>
      <span className="truncate tabular-nums text-ink-faint">{formatDate(project.updatedAt)}</span>
      {isOpening ? <Loader2 size={14} className="animate-spin text-accent" aria-hidden /> : <ArrowRight size={14} className="text-ink-faint opacity-0 group-hover:opacity-100" aria-hidden />}
    </button>
  );
}

export function LandingPage() {
  const projects = useEditor((s) => s.projects);
  const openProject = useEditor((s) => s.openProject);
  const newProject = useEditor((s) => s.newProject);

  const [name, setName] = useState('Untitled');
  const [formatName, setFormatName] = useState(FORMATS[0].name);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'));

  const selectedFormat = FORMATS.find((f) => f.name === formatName) ?? FORMATS[0];
  const openingBusy = busyProjectId !== null;
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.format.name.toLowerCase().includes(q)) : [...projects];
    if (sort === 'name') found.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'created') found.sort((a, b) => b.createdAt - a.createdAt);
    else found.sort((a, b) => b.updatedAt - a.updatedAt);
    return found;
  }, [projects, query, sort]);

  const chooseView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    try {
      await newProject(selectedFormat, name);
    } finally {
      setCreating(false);
    }
  };

  const open = async (projectId: string) => {
    setBusyProjectId(projectId);
    try {
      await openProject(projectId);
    } finally {
      setBusyProjectId(null);
    }
  };

  const itemProps = (project: ProjectSummary) => ({
    project,
    busy: openingBusy,
    isOpening: busyProjectId === project.id,
    onOpen: () => { void open(project.id); },
  });

  return (
    <div className="flex h-full w-full flex-col bg-bg text-ink">
      <nav className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-bg-rail px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white">
            <LayoutGrid size={13} strokeWidth={2.25} aria-hidden />
          </span>
          <span className="heading-md">Open-SCRL</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
          <HardDrive size={12} aria-hidden />
          Saved on this device — never uploaded
        </span>
      </nav>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <form className="rounded-xl border border-line bg-bg-panel p-4" onSubmit={createProject}>
            <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="flex flex-col">
                <h1 className="heading-lg">New project</h1>
                <p className="mt-0.5 text-[11px] text-ink-faint">Pick a canvas size. You can change it later.</p>
                <label className="mt-4 block">
                  <span className="field-label mb-1 block">Project name</span>
                  <input
                    className="input h-8"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My carousel"
                    autoComplete="off"
                  />
                </label>
                <button type="submit" className="btn btn-primary mt-3 w-full" disabled={creating} aria-busy={creating}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {creating ? 'Creating…' : 'Create & open editor'}
                  {!creating && <ArrowRight size={14} aria-hidden />}
                </button>
              </div>
              <div>
                <span className="field-label mb-1 block" id="format-label">Canvas format</span>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-labelledby="format-label">
                  {FORMATS.map((format) => (
                    <FormatOption key={format.name} format={format} selected={format.name === formatName} onSelect={() => setFormatName(format.name)} />
                  ))}
                </div>
              </div>
            </div>
          </form>

          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="heading-lg mr-auto flex items-baseline gap-2">
                Your projects <span className="font-sans text-xs font-normal tabular-nums tracking-normal text-ink-faint">{projects.length}</span>
              </h2>
              {projects.length > 0 && (
                <>
                  <label className="relative block w-56">
                    <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
                    <input className="input pl-7" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" aria-label="Search projects" type="search" />
                  </label>
                  <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort projects">
                    <option value="updated">Last edited</option>
                    <option value="created">Date created</option>
                    <option value="name">Name</option>
                  </select>
                  <div className="segmented grid-cols-2" role="group" aria-label="Project view">
                    <button type="button" className={`segmented-btn w-7 ${view === 'grid' ? 'segmented-btn-active' : ''}`} aria-pressed={view === 'grid'} aria-label="Grid view" title="Grid view" onClick={() => chooseView('grid')}>
                      <LayoutGrid size={13} aria-hidden />
                    </button>
                    <button type="button" className={`segmented-btn w-7 ${view === 'list' ? 'segmented-btn-active' : ''}`} aria-pressed={view === 'list'} aria-label="List view" title="List view" onClick={() => chooseView('list')}>
                      <List size={13} aria-hidden />
                    </button>
                  </div>
                </>
              )}
            </div>

            {projects.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-bg-inset text-ink-dim ring-1 ring-line-strong">
                  <Images size={18} aria-hidden />
                </div>
                <h3 className="heading-md">No projects yet</h3>
                <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-ink-faint">
                  Create your first project above. Projects you make will appear here.
                </p>
              </div>
            ) : visibleProjects.length === 0 ? (
              <p className="rounded-lg border border-line px-6 py-10 text-center text-xs text-ink-faint">No projects match “{query}”.</p>
            ) : view === 'grid' ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleProjects.map((project) => <ProjectCard key={project.id} {...itemProps(project)} />)}
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-bg-panel p-1">
                <div className="grid grid-cols-[40px_minmax(0,1fr)_140px_70px_170px_20px] gap-3 border-b border-line px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint" aria-hidden>
                  <span />
                  <span>Name</span>
                  <span>Format</span>
                  <span>Slides</span>
                  <span>Last edited</span>
                  <span />
                </div>
                {visibleProjects.map((project) => <ProjectRow key={project.id} {...itemProps(project)} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
