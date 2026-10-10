import { useId, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, Search, X } from 'lucide-react';
import type { ProjectSummary } from '@/store/editor';
import { HomeEmpty } from '../../home/HomeEmpty';
import { ProjectPreview } from '../../home/ProjectPreview';
import { filterProjects, fullDate, projectMeta, relativeTime } from '../../home/projectDisplay';

/** Search only earns its space once the list is long enough to need it. */
const SEARCH_THRESHOLD = 3;

interface ProjectRowProps {
  project: ProjectSummary;
  isOpening: boolean;
  busy: boolean;
  now: number;
  onOpen: () => void;
}

function ProjectRow({ project, isOpening, busy, now, onOpen }: ProjectRowProps) {
  const metaId = useId();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-busy={isOpening}
        aria-label={`Open ${project.name}`}
        aria-describedby={metaId}
        className="home-prow"
      >
        <span className="home-well home-prow-well">
          <ProjectPreview project={project} size="thumb" />
          {isOpening && (
            <span className="home-opening">
              <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
            </span>
          )}
        </span>
        <span className="home-prow-body" id={metaId}>
          <span className="home-prow-name">{project.name}</span>
          <span className="home-prow-meta">{projectMeta(project)}</span>
          <span className="home-prow-time" title={fullDate(project.updatedAt)}>Edited {relativeTime(project.updatedAt, now)}</span>
        </span>
        <ChevronRight size={18} className="home-prow-chevron" aria-hidden />
      </button>
    </li>
  );
}

interface ProjectListProps {
  projects: ProjectSummary[];
  openingId: string | null;
  busy: boolean;
  now: number;
  onOpen: (project: ProjectSummary) => void;
  /** Empty state action: scroll back to the create card. */
  onCreate: () => void;
}

export function ProjectList({ projects, openingId, busy, now, onOpen, onCreate }: ProjectListProps) {
  const [query, setQuery] = useState('');
  const showSearch = projects.length > SEARCH_THRESHOLD;
  const term = showSearch ? query : '';
  const visible = useMemo(() => filterProjects(projects, term), [projects, term]);

  return (
    <section aria-labelledby="home-projects-title" className="home-section">
      <div className="home-section-head">
        <h2 id="home-projects-title" className="home-section-title">Your projects</h2>
        {projects.length > 0 && <span className="home-count">{projects.length}</span>}
      </div>

      {showSearch && (
        <div className="home-psearch">
          <Search size={17} aria-hidden />
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
          />
          {query && visible.length > 0 && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              <span aria-hidden><X size={12} strokeWidth={2.5} /></span>
            </button>
          )}
        </div>
      )}

      <div className="home-plist">
        {projects.length === 0 ? (
          <HomeEmpty
            eyebrow="No carousels yet"
            title="Your first carousel starts here"
            action={
              <button type="button" className="home-button home-button-ghost" onClick={onCreate}>
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                Start your first carousel
              </button>
            }
          >
            Pick a size above, or begin from a photo grid.
          </HomeEmpty>
        ) : visible.length === 0 ? (
          <div role="status" className="home-nomatch">
            <span>No projects match “{query.trim()}”.</span>
            <button type="button" className="home-link" onClick={() => setQuery('')}>
              <X size={14} aria-hidden />
              Clear search
            </button>
          </div>
        ) : (
          <ul className="home-plist-rows">
            {visible.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
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
