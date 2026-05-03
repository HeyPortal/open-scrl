import { useState, type FormEvent } from 'react';
import {
  FileImage,
  FilePlus2,
  FolderOpen,
  HardDrive,
  Images,
  LayoutGrid,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { useEditor } from '@/store/editor';
import type { ProjectSummary } from '@/store/editor';

const formatDate = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);

function formatPreviewSize(format: Format, maxW: number, maxH: number) {
  const r = format.width / format.height;
  const boxR = maxW / maxH;
  if (r >= boxR) {
    const w = maxW;
    return { width: w, height: w / r };
  }
  const h = maxH;
  return { width: h * r, height: h };
}

function FormatPreview({ format, label }: { format: Format; label?: string }) {
  const { width, height } = formatPreviewSize(format, 112, 72);
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-xl border border-line bg-bg-inset/80 p-4"
      aria-hidden
    >
      <div className="flex h-[88px] w-[128px] items-center justify-center rounded-lg bg-bg-rail ring-1 ring-line/60">
        <div
          className="rounded-md bg-gradient-to-br from-accent/25 via-accent/10 to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-accent/30"
          style={{ width, height }}
        />
      </div>
      {label ? (
        <p className="text-center text-[11px] leading-snug text-ink-dim">{label}</p>
      ) : (
        <p className="text-center font-mono text-[10px] text-ink-faint">
          {format.width}×{format.height}
        </p>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  busy,
  isOpening,
  onOpen,
}: {
  project: ProjectSummary;
  busy: boolean;
  isOpening: boolean;
  onOpen: () => void;
}) {
  const { width, height } = formatPreviewSize(project.format, 100, 56);
  return (
    <button
      type="button"
      className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-bg-panel text-left shadow-sm transition-all duration-200 hover:border-accent/45 hover:bg-bg-hover hover:shadow-md hover:shadow-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40"
      onClick={onOpen}
      disabled={busy}
      aria-busy={isOpening}
    >
      <div className="relative border-b border-line bg-gradient-to-b from-bg-inset/50 to-bg-rail px-4 py-5">
        <div className="mx-auto flex h-[72px] w-[120px] items-center justify-center rounded-lg bg-bg/90 ring-1 ring-line/50">
          <div
            className="rounded-md bg-gradient-to-br from-white/[0.08] via-accent/20 to-transparent shadow-inner ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.02]"
            style={{ width, height }}
          />
        </div>
        {isOpening && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60 backdrop-blur-[2px]">
            <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden />
            <span className="sr-only">Opening project</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink group-hover:text-white">
              {project.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-ink-dim">{project.format.name}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-bg-inset p-2 text-ink-dim ring-1 ring-line transition-colors group-hover:text-accent group-hover:ring-accent/25">
            <FolderOpen size={16} strokeWidth={1.75} />
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/80 pt-3 text-[11px] text-ink-faint">
          <span className="tabular-nums">
            {project.slideCount} slide{project.slideCount === 1 ? '' : 's'}
          </span>
          <span className="truncate text-ink-dim">{formatDate(project.updatedAt)}</span>
        </div>
      </div>
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

  const selectedFormat = FORMATS.find((f) => f.name === formatName) ?? FORMATS[0];
  const openingBusy = busyProjectId !== null;

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

  return (
    <div className="relative min-h-full w-full overflow-auto bg-bg text-ink">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-24 -top-32 h-[420px] w-[420px] rounded-full bg-accent/[0.12] blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[360px] w-[360px] rounded-full bg-accent/[0.06] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: `linear-gradient(rgba(232,232,238,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(232,232,238,0.5) 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-10 flex flex-col gap-6 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-hover shadow-lg shadow-accent/25 ring-1 ring-white/10">
              <FileImage size={24} className="text-white" strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.65rem]">Open-SCRL</h1>
                <span className="rounded-full border border-line bg-bg-panel px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-dim">
                  Projects
                </span>
              </div>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-dim">
                Open an existing carousel or start fresh. Everything stays on this device in your browser.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start rounded-xl border border-line bg-bg-panel/80 px-3 py-2 text-xs text-ink-dim backdrop-blur-sm sm:self-auto">
            <HardDrive size={14} className="shrink-0 text-ink-faint" aria-hidden />
            <span>Saved in IndexedDB — not uploaded</span>
          </div>
        </header>

        <div className="grid flex-1 gap-8 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-10">
          <section className="lg:sticky lg:top-8 lg:self-start">
            <div className="overflow-hidden rounded-2xl border border-line bg-bg-panel/90 shadow-xl shadow-black/20 ring-1 ring-white/[0.04] backdrop-blur-md">
              <div className="border-b border-line bg-gradient-to-r from-accent/15 via-transparent to-transparent px-5 py-4">
                <div className="flex items-center gap-2 text-accent">
                  <Sparkles size={18} strokeWidth={1.75} aria-hidden />
                  <h2 className="text-sm font-semibold tracking-tight text-ink">New project</h2>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-dim">
                  Name it, pick a canvas size, then jump into the editor.
                </p>
              </div>

              <form className="space-y-5 p-5" onSubmit={createProject}>
                <FormatPreview format={selectedFormat} label={selectedFormat.name} />

                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    Project name
                  </span>
                  <input
                    className="input py-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My carousel"
                    autoComplete="off"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    Canvas format
                  </span>
                  <select
                    className="input py-2"
                    value={formatName}
                    onChange={(e) => setFormatName(e.target.value)}
                  >
                    {FORMATS.map((format) => (
                      <option key={format.name} value={format.name}>
                        {format.name} · {format.width}×{format.height}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  className="ctrl-btn ctrl-btn-primary flex h-11 w-full items-center justify-center gap-2 text-sm font-medium shadow-md shadow-accent/20 transition hover:shadow-lg hover:shadow-accent/25 disabled:opacity-60"
                  disabled={creating}
                  aria-busy={creating}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <FilePlus2 size={16} strokeWidth={1.75} aria-hidden />
                  )}
                  {creating ? 'Creating…' : 'Create & open editor'}
                </button>
              </form>
            </div>
          </section>

          <section className="min-w-0 pb-8">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-inset text-accent ring-1 ring-line">
                  <LayoutGrid size={18} strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Your projects</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">
                    Recent work appears first. Photos you import live in a shared library for all projects.
                  </p>
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-bg-panel px-3 py-1.5 text-xs font-medium tabular-nums text-ink-dim">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/90 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                {projects.length} saved
              </span>
            </div>

            {projects.length === 0 ? (
              <div className="relative overflow-hidden rounded-2xl border border-dashed border-line/80 bg-bg-panel/40 px-6 py-16 text-center sm:py-20">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl" />
                <div className="relative mx-auto flex max-w-sm flex-col items-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-inset ring-1 ring-line">
                    <Images size={32} className="text-ink-faint" strokeWidth={1.25} aria-hidden />
                  </div>
                  <h3 className="text-base font-semibold tracking-tight">No projects yet</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                    Use the panel on the left to create your first project. You can always come back here to
                    switch carousels.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    busy={openingBusy}
                    isOpening={busyProjectId === project.id}
                    onOpen={() => {
                      void open(project.id);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
