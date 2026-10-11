/**
 * Lazy slide previews (a slide or a strip of slides) for the home screen. Cards ask for a preview once they scroll near the
 * viewport; renders run two at a time after the browser is idle, and the resulting object URLs are
 * kept in a small in-memory cache keyed by project id, edit time and size. The renderer (storage,
 * painter, asset reads) is a dynamic import so none of it is in the initial chunk.
 */

/** Cached object URL, or '' when rendering failed (so a broken project is not retried on every scroll). */
const cache = new Map<string, string>();
const MAX_CACHED = 96;
const CONCURRENCY = 2;

export function peekPreview(key: string): string | undefined {
  const url = cache.get(key);
  if (url !== undefined) {
    cache.delete(key);
    cache.set(key, url);
  }
  return url;
}

function remember(key: string, url: string) {
  cache.set(key, url);
  while (cache.size > MAX_CACHED) {
    const [oldest, oldUrl] = cache.entries().next().value as [string, string];
    cache.delete(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
}

type Listener = (url: string) => void;
interface Job { key: string; projectId: string; pixelWidth: number; slide: number; count: number; listeners: Set<Listener>; started: boolean }

const jobs = new Map<string, Job>();
const waiting: Job[] = [];
let active = 0;

const whenIdle = (work: () => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 400 });
  else setTimeout(work, 40);
};

async function run(job: Job) {
  job.started = true;
  active++;
  let url = '';
  try {
    const { renderProjectPreview } = await import('./renderProjectPreview');
    const blob = await renderProjectPreview(job.projectId, job.pixelWidth, job.slide, job.count);
    if (blob) url = URL.createObjectURL(blob);
  } catch {
    // Leave the generated cover in place.
  }
  remember(job.key, url);
  jobs.delete(job.key);
  for (const listener of job.listeners) listener(url);
  active--;
  pump();
}

function pump() {
  while (active < CONCURRENCY && waiting.length) void run(waiting.shift()!);
}

/** Queues a preview render. Returns a cancel function; a job nobody waits for is dropped before it starts. */
export function requestPreview(key: string, projectId: string, pixelWidth: number, slide: number, listener: Listener, count = 1): () => void {
  let job = jobs.get(key);
  if (!job) {
    job = { key, projectId, pixelWidth, slide, count, listeners: new Set(), started: false };
    jobs.set(key, job);
    waiting.push(job);
    whenIdle(pump);
  }
  job.listeners.add(listener);
  const owned = job;
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size === 0 && !owned.started) {
      jobs.delete(owned.key);
      const index = waiting.indexOf(owned);
      if (index >= 0) waiting.splice(index, 1);
    }
  };
}

let observer: IntersectionObserver | undefined;
const watchers = new WeakMap<Element, () => void>();

/** Calls `onVisible` once when the element comes within a screen of the viewport. */
export function observeVisible(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => undefined;
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer!.unobserve(entry.target);
      const callback = watchers.get(entry.target);
      watchers.delete(entry.target);
      callback?.();
    }
  }, { rootMargin: '320px 0px' });
  watchers.set(element, onVisible);
  observer.observe(element);
  return () => {
    watchers.delete(element);
    observer?.unobserve(element);
  };
}
