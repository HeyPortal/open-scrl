import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ProjectSummary } from '@/store/editor';
import { coverFor } from './projectDisplay';
import './home.css';
import { observeVisible, peekPreview, requestPreview } from './previewQueue';

/** Longest rendered edge of each slide in device pixels: strips repeat it per slide, thumbnails stay small. */
const LONG_EDGE = { thumb: 168, strip: 300, card: 480, feature: 640 } as const;
export type PreviewSize = keyof typeof LONG_EDGE;

interface ProjectPreviewProps {
  project: Pick<ProjectSummary, 'id' | 'format' | 'updatedAt'>;
  size: PreviewSize;
  /** Zero-based slide to show; the first by default. */
  slide?: number;
  /** Consecutive slides drawn edge to edge as one strip; one by default. */
  count?: number;
}

/**
 * A slide of the project (the first by default) at its real aspect ratio. It must sit inside a `.home-well` (a size
 * container), which gives the frame its box before anything loads, so there is no layout shift.
 * Until the preview is ready the frame shows a quiet placeholder; if it cannot be rendered the
 * generated cover stays.
 */
export function ProjectPreview({ project, size, slide = 0, count = 1 }: ProjectPreviewProps) {
  const { id, updatedAt, format } = project;
  const slideRatio = format.width / format.height;
  const ratio = slideRatio * count;
  const pixelWidth = Math.max(1, Math.round(LONG_EDGE[size] * Math.min(1, slideRatio)));
  const key = `${id}:${updatedAt}:${slide}:${count}:${pixelWidth}`;
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
      cancel = requestPreview(key, id, pixelWidth, slide, (next) => setState({ key, url: next }), count);
    });
    return () => {
      stop();
      cancel?.();
    };
  }, [key, id, pixelWidth, slide, count]);

  const status = url ? 'ready' : fresh === '' ? 'failed' : 'loading';
  return (
    <span ref={frame} className="home-frame" data-status={status} data-slides={count > 1 ? count : undefined} style={{ '--r': ratio, '--n': count } as CSSProperties} aria-hidden>
      {status === 'failed' && <span className="home-frame-cover" style={{ background: coverFor(id) }} />}
      {url && <img className="home-frame-img" src={url} alt="" draggable={false} decoding="async" />}
    </span>
  );
}
