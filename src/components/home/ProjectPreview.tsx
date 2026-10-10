import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ProjectSummary } from '@/store/editor';
import { coverFor } from './projectDisplay';
import './home.css';
import { observeVisible, peekPreview, requestPreview } from './previewQueue';

/** Longest rendered edge in device pixels. Cards are about 200px wide, the feature card larger, thumbnails small. */
const LONG_EDGE = { thumb: 168, card: 480, feature: 640 } as const;
export type PreviewSize = keyof typeof LONG_EDGE;

interface ProjectPreviewProps {
  project: Pick<ProjectSummary, 'id' | 'format' | 'updatedAt'>;
  size: PreviewSize;
  /** Zero-based slide to show; the first by default. */
  slide?: number;
}

/**
 * A slide of the project (the first by default) at its real aspect ratio. It must sit inside a `.home-well` (a size
 * container), which gives the frame its box before anything loads, so there is no layout shift.
 * Until the preview is ready the frame shows a quiet placeholder; if it cannot be rendered the
 * generated cover stays.
 */
export function ProjectPreview({ project, size, slide = 0 }: ProjectPreviewProps) {
  const { id, updatedAt, format } = project;
  const ratio = format.width / format.height;
  const pixelWidth = Math.max(1, Math.round(LONG_EDGE[size] * Math.min(1, ratio)));
  const key = `${id}:${updatedAt}:${slide}:${pixelWidth}`;
  const frame = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<{ key: string; url: string | undefined }>(() => ({ key, url: peekPreview(key) }));
  const fresh = state.key === key ? state.url : peekPreview(key);
  // After an edit, keep the previous image up until the new one is ready.
  const lastGood = useRef<string | undefined>(undefined);
  if (fresh) lastGood.current = fresh;
  const url = fresh || (fresh === undefined ? lastGood.current : undefined);

  useEffect(() => {
    const element = frame.current;
    if (!element || peekPreview(key) !== undefined) return;
    let cancel: (() => void) | undefined;
    const stop = observeVisible(element, () => {
      cancel = requestPreview(key, id, pixelWidth, slide, (next) => setState({ key, url: next }));
    });
    return () => {
      stop();
      cancel?.();
    };
  }, [key, id, pixelWidth, slide]);

  const status = url ? 'ready' : fresh === '' ? 'failed' : 'loading';
  return (
    <span ref={frame} className="home-frame" data-status={status} style={{ '--r': ratio } as CSSProperties} aria-hidden>
      {status === 'failed' && <span className="home-frame-cover" style={{ background: coverFor(id) }} />}
      {url && <img className="home-frame-img" src={url} alt="" draggable={false} decoding="async" />}
    </span>
  );
}
