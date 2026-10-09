import { useState } from 'react';
import { AlertTriangle, HardDrive, LayoutGrid } from 'lucide-react';
import type { Format } from '@/types';
import type { GridTemplate } from '@/lib/grids';
import { FORMATS } from '@/lib/format';
import { useEditor } from '@/store/editor';
import type { ProjectSummary } from '@/store/editor';
import { GridStarters, STARTER_GAP, STARTER_MARGIN } from './home/GridStarters';
import { NewCarouselCard } from './home/NewCarouselCard';
import { ProjectList } from './home/ProjectList';
import './home/home.css';

/** Scroll distance (px) after which the large title hands over to the compact bar. */
const COLLAPSE_AT = 44;

const BLANK = 'blank';

/** Mobile home screen: start a carousel and open saved projects. */
export default function MobileHome() {
  const projects = useEditor((s) => s.projects);
  const openProject = useEditor((s) => s.openProject);
  const newProject = useEditor((s) => s.newProject);

  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [name, setName] = useState('');
  // 'blank' or a grid template id while a project is being created.
  const [creating, setCreating] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const busy = creating !== null || openingId !== null;

  const create = async (template?: GridTemplate) => {
    if (busy) return;
    setOpenError(null);
    setCreating(template?.id ?? BLANK);
    try {
      await newProject(format, name);
      // The new project is active and its first slide is selected, as on desktop's Grids panel.
      if (template && useEditor.getState().activeProjectId) {
        useEditor.getState().applyGrid(template, STARTER_GAP, STARTER_MARGIN);
      }
    } catch {
      // saveToDisk reports failures through the store's saveError banner.
    } finally {
      setCreating(null);
    }
  };

  const open = async (project: ProjectSummary) => {
    if (busy) return;
    setOpenError(null);
    setOpeningId(project.id);
    try {
      await openProject(project.id);
      const { activeProjectId, readOnlyError } = useEditor.getState();
      if (!activeProjectId && readOnlyError) setOpenError(readOnlyError);
    } catch {
      setOpenError('This project could not be opened. Your saved data has not been changed.');
    } finally {
      setOpeningId(null);
    }
  };

  const hasProjects = projects.length > 0;
  const gridStarters = (
    <GridStarters
      format={format}
      pendingId={creating !== BLANK ? creating : null}
      busy={busy}
      onPick={(template) => void create(template)}
    />
  );
  const projectList = <ProjectList projects={projects} openingId={openingId} busy={busy} onOpen={(project) => void open(project)} />;

  return (
    <div className="mobile-home relative h-[100dvh] w-full overflow-hidden bg-bg text-ink">
      {/* Compact bar: fades in over the content once the large title scrolls away. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-end justify-center border-b bg-bg/85 backdrop-blur-xl transition-[opacity,border-color] duration-200 ease-out ${
          collapsed ? 'border-line opacity-100' : 'border-transparent opacity-0'
        }`}
        style={{ height: 'calc(env(safe-area-inset-top) + 48px)' }}
      >
        <div className="flex h-12 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white">
            <LayoutGrid size={13} strokeWidth={2.25} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Open-SCRL</span>
        </div>
      </div>

      <main
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={(event) => setCollapsed(event.currentTarget.scrollTop > COLLAPSE_AT)}
      >
        <div
          className="mx-auto w-full max-w-[560px]"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 20px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 28px)',
            paddingLeft: 'max(16px, env(safe-area-inset-left))',
            paddingRight: 'max(16px, env(safe-area-inset-right))',
          }}
        >
          <header className="mb-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-accent text-white shadow-[0_8px_20px_-8px_rgba(124,92,255,0.9)]">
                <LayoutGrid size={22} strokeWidth={2.25} aria-hidden />
              </span>
              <h1 className="text-[28px] font-semibold leading-none tracking-[-0.02em]">Open-SCRL</h1>
            </div>
            <p className="mt-2.5 text-[15px] leading-snug text-ink-dim">Carousels &amp; photo grids, saved on this device</p>
          </header>

          {openError && (
            <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-[13px] leading-snug text-red-100">
              <AlertTriangle size={16} className="mt-px shrink-0 text-red-400" aria-hidden />
              <span>{openError}</span>
            </div>
          )}

          <NewCarouselCard
            format={format}
            onFormatChange={setFormat}
            name={name}
            onNameChange={setName}
            creating={creating === BLANK}
            busy={busy}
            onSubmit={() => void create()}
          />

          {hasProjects && projectList}
          {gridStarters}
          {!hasProjects && projectList}

          <footer className="mt-8 flex items-center justify-center gap-1.5 text-[12px] text-ink-faint">
            <HardDrive size={12} aria-hidden />
            Projects are stored locally in this browser.
          </footer>
        </div>
      </main>
    </div>
  );
}
