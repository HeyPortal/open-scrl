import { useId } from 'react';
import { ArrowRight, LayoutGrid, List, Loader2, Plus, Search, X } from 'lucide-react';
import type { ProjectSummary } from '@/store/editor';
import { HomeEmpty } from '../home/HomeEmpty';
import { ProjectPreview } from '../home/ProjectPreview';
import { fullDate, projectMeta, relativeTime, type SortKey } from '../home/projectDisplay';

export type View = 'grid' | 'list';

interface ItemProps {
  project: ProjectSummary;
  now: number;
  busy: boolean;
  isOpening: boolean;
  onOpen: () => void;
}

function ProjectCard({ project, now, busy, isOpening, onOpen }: ItemProps) {
  const metaId = useId();
  return (
    <li>
      <button type="button" className="home-card" onClick={onOpen} disabled={busy} aria-busy={isOpening} aria-label={`Open ${project.name}`} aria-describedby={metaId}>
        <span className="home-well home-card-well">
          <ProjectPreview project={project} size="card" />
          {isOpening && (
            <span className="home-opening">
              <Loader2 size={20} className="animate-spin text-accent" aria-hidden />
            </span>
          )}
        </span>
        <span className="home-card-body" id={metaId}>
          <span className="home-card-name">{project.name}</span>
          <span className="home-card-meta">{projectMeta(project)}</span>
          <span className="home-card-time" title={fullDate(project.updatedAt)}>Edited {relativeTime(project.updatedAt, now)}</span>
        </span>
      </button>
    </li>
  );
}

function ProjectRow({ project, now, busy, isOpening, onOpen }: ItemProps) {
  return (
    <li>
      <button type="button" className="home-row" onClick={onOpen} disabled={busy} aria-busy={isOpening} aria-label={`Open ${project.name}`}>
        <span className="home-well home-row-well">
          <ProjectPreview project={project} size="thumb" />
        </span>
        <span className="home-row-name">{project.name}</span>
        <span className="home-row-cell">{project.format.name}</span>
        <span className="home-row-cell home-row-num">{project.slideCount}</span>
        <span className="home-row-cell home-row-time" title={fullDate(project.updatedAt)}>{relativeTime(project.updatedAt, now)}</span>
        <span className="home-row-end" aria-hidden>
          {isOpening ? <Loader2 size={15} className="animate-spin text-accent" /> : <ArrowRight size={15} />}
        </span>
      </button>
    </li>
  );
}

interface ProjectsSectionProps {
  total: number;
  visible: ProjectSummary[];
  query: string;
  onQueryChange: (query: string) => void;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  view: View;
  onViewChange: (view: View) => void;
  now: number;
  busy: boolean;
  openingId: string | null;
  onOpen: (project: ProjectSummary) => void;
  onCreate: () => void;
}

/** "All projects": sticky toolbar (search, sort, view) over a card grid or a list, plus empty and no-match states. */
export function ProjectsSection({ total, visible, query, onQueryChange, sort, onSortChange, view, onViewChange, now, busy, openingId, onOpen, onCreate }: ProjectsSectionProps) {
  const itemProps = (project: ProjectSummary): ItemProps => ({
    project,
    now,
    busy,
    isOpening: openingId === project.id,
    onOpen: () => onOpen(project),
  });

  return (
    <section aria-labelledby="home-projects-title" className="home-section home-projects">
      <div className="home-toolbar" data-empty={total === 0}>
        <h2 id="home-projects-title" className="home-section-title">
          Your projects {total > 0 && <span className="home-count">{total}</span>}
        </h2>
        {total > 0 && (
          <div className="home-toolbar-controls">
            <label className="home-search">
              <Search size={15} aria-hidden />
              <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search projects" aria-label="Search projects" type="search" autoComplete="off" />
            </label>
            <select className="home-select" value={sort} onChange={(event) => onSortChange(event.target.value as SortKey)} aria-label="Sort projects">
              <option value="updated">Last edited</option>
              <option value="created">Date created</option>
              <option value="name">Name</option>
            </select>
            <div className="home-segmented" role="group" aria-label="Project view">
              <button type="button" aria-pressed={view === 'grid'} aria-label="Grid view" title="Grid view" onClick={() => onViewChange('grid')}>
                <LayoutGrid size={15} aria-hidden />
              </button>
              <button type="button" aria-pressed={view === 'list'} aria-label="List view" title="List view" onClick={() => onViewChange('list')}>
                <List size={15} aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>

      {total === 0 ? (
        <HomeEmpty
          eyebrow="No carousels yet"
          title="Your first carousel starts here"
          action={
            <button type="button" className="home-button home-button-ghost" onClick={onCreate}>
              <Plus size={15} strokeWidth={2.5} aria-hidden />
              Start your first carousel
            </button>
          }
        >
          Pick a size above, or begin from a photo grid. Projects you make appear here.
        </HomeEmpty>
      ) : visible.length === 0 ? (
        <div className="home-nomatch" role="status">
          <span>No projects match “{query.trim()}”.</span>
          <button type="button" className="home-link" onClick={() => onQueryChange('')}>
            <X size={14} aria-hidden />
            Clear search
          </button>
        </div>
      ) : view === 'grid' ? (
        <ul className="home-grid">{visible.map((project) => <ProjectCard key={project.id} {...itemProps(project)} />)}</ul>
      ) : (
        <div className="home-list">
          <div className="home-list-head" aria-hidden>
            <span />
            <span>Name</span>
            <span>Format</span>
            <span>Slides</span>
            <span>Last edited</span>
            <span />
          </div>
          <ul>{visible.map((project) => <ProjectRow key={project.id} {...itemProps(project)} />)}</ul>
        </div>
      )}
    </section>
  );
}
