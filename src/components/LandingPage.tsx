import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Format } from '@/types';
import { FORMATS } from '@/lib/format';
import { useEditor } from '@/store/editor';
import { filterProjects, sortProjects, type SortKey } from './home/projectDisplay';
import { useHomeActions } from './home/useHomeActions';
import { useNow } from './home/useNow';
import { CreatePanel } from './landing/CreatePanel';
import { HomeHeader } from './landing/HomeHeader';
import { ProjectsSection, type View } from './landing/ProjectsSection';
import { Footer } from './landing/Footer';

const VIEW_KEY = 'open-scrl:project-view';

// The starters pull in the grid template catalogue; they sit below the create panel, so load them separately.
const GridStarters = lazy(() => import('./home/GridStarters').then((m) => ({ default: m.GridStarters })));

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Desktop home: create a project (name, format, grid starter) and pick up where you left off. */
export function LandingPage() {
  const projects = useEditor((s) => s.projects);
  const actions = useHomeActions();
  const now = useNow();

  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const scroller = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => sortProjects(filterProjects(projects, query), sort), [projects, query, sort]);

  const chooseView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  const focusCreate = () => {
    scroller.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    nameInput.current?.focus({ preventScroll: true });
  };

  return (
    <div className="home home-desktop">
      <HomeHeader onNew={focusCreate} />
      <div className="home-scroll scrollbar-thin" ref={scroller} data-home-scroll>
        <main className="home-main">
          {actions.openError && (
            <div role="alert" className="home-alert">
              <AlertTriangle size={16} aria-hidden />
              <span>{actions.openError}</span>
            </div>
          )}

          <aside className="home-new-column" aria-label="Create a carousel">
            <CreatePanel
              ref={nameInput}
              name={name}
              onNameChange={setName}
              format={format}
              onFormatChange={setFormat}
              creating={actions.creating === 'blank'}
              busy={actions.busy}
              onSubmit={() => void actions.create(format, name)}
            />
            <details className="home-grid-options">
              <summary>Start from a grid</summary>
              <Suspense fallback={<div className="home-starters-skeleton" aria-hidden />}>
                <GridStarters
                  variant="desktop"
                  format={format}
                  pendingId={actions.creating !== 'blank' ? actions.creating : null}
                  busy={actions.busy}
                  onPick={(template) => void actions.create(format, name, template)}
                />
              </Suspense>
            </details>
          </aside>

          <ProjectsSection
            total={projects.length}
            visible={visible}
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={chooseView}
            now={now}
            busy={actions.busy}
            openingId={actions.openingId}
            onOpen={(project) => void actions.open(project)}
            onCreate={focusCreate}
          />

        </main>
        <Footer />
      </div>
    </div>
  );
}
