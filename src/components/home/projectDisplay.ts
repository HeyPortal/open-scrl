import type { Format } from '@/types';
import type { ProjectSummary } from '@/store/editor';

/** Cover gradient angles. Colours come from the theme tokens, so a cover never hard-codes a hue. */
const COVER_ANGLES = [135, 200, 60, 250, 20, 310];

/** FNV-1a, 32-bit: deterministic and well mixed, so ids that differ by one character land on unrelated covers. */
function hash32(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable decorative cover per project, used until (or instead of) a real preview of its first slide. */
export function coverFor(id: string) {
  const angle = COVER_ANGLES[hash32(id) % COVER_ANGLES.length];
  return `linear-gradient(${angle}deg, rgb(var(--c-accent-start) / .5), rgb(var(--c-accent-end) / .28) 55%, rgb(var(--c-bg-hover)))`;
}

/** Largest box with the format's aspect ratio that fits inside maxW x maxH. */
export function fitBox(format: Pick<Format, 'width' | 'height'>, maxW: number, maxH: number) {
  const ratio = format.width / format.height;
  return ratio >= maxW / maxH ? { width: maxW, height: maxW / ratio } : { width: maxH * ratio, height: maxH };
}

export const slideLabel = (count: number) => `${count} slide${count === 1 ? '' : 's'}`;

/** "IG Portrait · 6 slides". */
export const projectMeta = (project: Pick<ProjectSummary, 'format' | 'slideCount'>) => `${project.format.name} · ${slideLabel(project.slideCount)}`;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const startOfDay = (value: number) => new Date(value).setHours(0, 0, 0, 0);

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago" - used as "Edited <value>". */
export function relativeTime(value: number, now = Date.now()) {
  const diff = Math.max(0, now - value);
  if (diff < 45_000) return 'just now';
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diff / MINUTE);
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.round(diff / HOUR);
  if (hours < 24) return format.format(-hours, 'hour');
  const days = Math.max(1, Math.round((startOfDay(now) - startOfDay(value)) / DAY));
  if (days < 7) return format.format(-days, 'day');
  if (days < 30) return format.format(-Math.floor(days / 7), 'week');
  if (days < 365) return format.format(-Math.floor(days / 30), 'month');
  return format.format(-Math.floor(days / 365), 'year');
}

export const fullDate = (value: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);

export type SortKey = 'updated' | 'created' | 'name';

/** Case-insensitive match on the project's name or format name. */
export function filterProjects(projects: ProjectSummary[], query: string) {
  const term = query.trim().toLowerCase();
  return term ? projects.filter((p) => p.name.toLowerCase().includes(term) || p.format.name.toLowerCase().includes(term)) : projects;
}

export function sortProjects(projects: ProjectSummary[], sort: SortKey) {
  const copy = [...projects];
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'created') return copy.sort((a, b) => b.createdAt - a.createdAt);
  return copy.sort((a, b) => b.updatedAt - a.updatedAt);
}
