import type { Format } from '@/types';

const COVERS = [
  ['#f59e0b', '#e11d48'],
  ['#8b5cf6', '#4f46e5'],
  ['#0ea5e9', '#10b981'],
  ['#f472b6', '#8b5cf6'],
  ['#f97316', '#db2777'],
  ['#14b8a6', '#6366f1'],
];

/** Stable decorative cover colours per project (projects have no stored thumbnail). */
export function coverFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [from, to] = COVERS[hash % COVERS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** Largest box with the format's aspect ratio that fits inside maxW x maxH. */
export function fitBox(format: Pick<Format, 'width' | 'height'>, maxW: number, maxH: number) {
  const ratio = format.width / format.height;
  return ratio >= maxW / maxH ? { width: maxW, height: maxW / ratio } : { width: maxH * ratio, height: maxH };
}

export const slideLabel = (count: number) => `${count} slide${count === 1 ? '' : 's'}`;

const DAY = 86_400_000;

/** "just now", "5 min ago", "yesterday", "Oct 3" - used as "Edited <value>". */
export function relativeTime(value: number, now = Date.now()) {
  const diff = Math.max(0, now - value);
  if (diff < 45_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} hr ago`;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday - value) / DAY);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = new Date(value).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' }).format(value);
}

export const fullDate = (value: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
