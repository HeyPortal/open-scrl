import { useId } from 'react';
import { ArrowRight, Clock, Loader2 } from 'lucide-react';
import type { ProjectSummary } from '@/store/editor';
import { ProjectPreview } from './ProjectPreview';
import { fullDate, projectMeta, relativeTime } from './projectDisplay';

interface ContinueCardProps {
  project: ProjectSummary;
  now: number;
  isOpening: boolean;
  busy: boolean;
  onOpen: () => void;
  variant: 'desktop' | 'phone';
}

/**
 * Feature card for the most recently edited project. Its accessible name is just "Continue editing"
 * (the project is in the description), so the same project can also appear in the list below
 * without two buttons both being named after it.
 */
export function ContinueCard({ project, now, isOpening, busy, onOpen, variant }: ContinueCardProps) {
  const nameId = useId();
  const metaId = useId();
  return (
    <section aria-label="Continue editing" className="home-section">
      <button
        type="button"
        className="home-continue"
        data-variant={variant}
        onClick={onOpen}
        disabled={busy}
        aria-busy={isOpening}
        aria-label="Continue editing"
        aria-describedby={`${nameId} ${metaId}`}
      >
        <span className="home-well home-continue-well">
          <ProjectPreview project={project} size="feature" />
          {isOpening && (
            <span className="home-opening">
              <Loader2 size={20} className="animate-spin text-accent" aria-hidden />
            </span>
          )}
        </span>
        <span className="home-continue-body">
          <span className="home-eyebrow">Continue editing</span>
          <span id={nameId} className="home-continue-name">{project.name}</span>
          <span id={metaId} className="home-continue-meta">
            <span>{projectMeta(project)}</span>
            <span className="home-time" title={fullDate(project.updatedAt)}>
              <Clock size={13} aria-hidden />
              Edited {relativeTime(project.updatedAt, now)}
            </span>
          </span>
          <span className="home-continue-open" aria-hidden>
            Open <ArrowRight size={15} strokeWidth={2.25} />
          </span>
        </span>
        {variant === 'desktop' && project.slideCount > 1 && (
          <span className="home-continue-strip" aria-hidden>
            {Array.from({ length: Math.min(3, project.slideCount - 1) }, (_, i) => (
              <span key={i} className="home-well home-continue-slide">
                <ProjectPreview project={project} size="card" slide={i + 1} />
              </span>
            ))}
          </span>
        )}
      </button>
    </section>
  );
}
