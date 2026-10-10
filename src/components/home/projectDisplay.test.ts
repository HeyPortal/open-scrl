import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '@/store/editor';
import { coverFor, filterProjects, projectMeta, relativeTime, sortProjects } from './projectDisplay';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Mulberry32: a small seeded PRNG so the sample ids (and the test) are the same on every run. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ids shaped like `id()` in src/lib/nano.ts: 10 characters from [0-9a-z]. */
function sampleIds(count: number, seed = 42) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () =>
    Array.from({ length: 10 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join(''),
  );
}

describe('coverFor', () => {
  it('returns the same gradient for the same id', () => {
    expect(coverFor('k3j9x0a7qz')).toBe(coverFor('k3j9x0a7qz'));
    expect(coverFor('k3j9x0a7qz')).toMatch(/^linear-gradient\(\d+deg, /);
  });

  it('takes every colour from theme tokens', () => {
    for (const id of sampleIds(12)) expect(coverFor(id)).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('uses all six covers across 60 nano-style ids', () => {
    const covers = new Set(sampleIds(60).map(coverFor));
    expect(covers.size).toBe(6);
  });

  it('spreads 600 ids roughly evenly over the six covers', () => {
    const counts = new Map<string, number>();
    for (const id of sampleIds(600)) counts.set(coverFor(id), (counts.get(coverFor(id)) ?? 0) + 1);
    expect(counts.size).toBe(6);
    // Expected 100 per cover; binomial spread is about 9, so 60-140 is a wide margin.
    for (const count of counts.values()) expect(count).toBeGreaterThanOrEqual(60);
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(140);
  });
});

describe('relativeTime', () => {
  // Local time, so the calendar-day branches don't depend on the machine's zone.
  const now = new Date(2026, 9, 9, 8, 30).getTime();

  it('says "just now" under 45 seconds, and for timestamps in the future', () => {
    expect(relativeTime(now - 44_000, now)).toBe('just now');
    expect(relativeTime(now + 5_000, now)).toBe('just now');
  });

  it('switches to minutes at 45 seconds', () => {
    expect(relativeTime(now - 45_000, now)).toBe('1 minute ago');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
  });

  it('counts hours within the day', () => {
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 hours ago');
    expect(relativeTime(now - 59 * 60_000 - 40_000, now)).toBe('1 hour ago');
  });

  it('says "yesterday" for the previous calendar day, and counts days after that', () => {
    expect(relativeTime(new Date(2026, 9, 8, 7, 0).getTime(), now)).toBe('yesterday');
    expect(relativeTime(new Date(2026, 9, 6, 8, 30).getTime(), now)).toBe('3 days ago');
  });

  it('uses weeks, months and years beyond a week', () => {
    expect(relativeTime(now - 8 * 86_400_000, now)).toBe('last week');
    expect(relativeTime(now - 21 * 86_400_000, now)).toBe('3 weeks ago');
    expect(relativeTime(now - 75 * 86_400_000, now)).toBe('2 months ago');
    expect(relativeTime(now - 800 * 86_400_000, now)).toBe('2 years ago');
  });
});

const project = (name: string, formatName: string, updatedAt: number, createdAt: number, slideCount = 1): ProjectSummary => ({
  id: name,
  name,
  format: { name: formatName, width: 1080, height: 1350 },
  slideCount,
  createdAt,
  updatedAt,
});

describe('filterProjects and sortProjects', () => {
  const projects = [project('Beach', 'IG Portrait', 30, 10), project('alpine', 'IG Story / Reels', 20, 30), project('City', 'IG Portrait', 10, 20)];

  it('matches names and format names case-insensitively, and keeps everything for a blank query', () => {
    expect(filterProjects(projects, '  ALP ').map((p) => p.name)).toEqual(['alpine']);
    expect(filterProjects(projects, 'portrait').map((p) => p.name)).toEqual(['Beach', 'City']);
    expect(filterProjects(projects, '   ')).toBe(projects);
    expect(filterProjects(projects, 'zzz')).toEqual([]);
  });

  it('sorts without mutating the input', () => {
    expect(sortProjects(projects, 'updated').map((p) => p.name)).toEqual(['Beach', 'alpine', 'City']);
    expect(sortProjects(projects, 'created').map((p) => p.name)).toEqual(['alpine', 'City', 'Beach']);
    expect(sortProjects(projects, 'name').map((p) => p.name)).toEqual(['alpine', 'Beach', 'City']);
    expect(projects.map((p) => p.name)).toEqual(['Beach', 'alpine', 'City']);
  });
});

describe('projectMeta', () => {
  it('pluralises slides', () => {
    expect(projectMeta(project('a', 'IG Square', 1, 1, 1))).toBe('IG Square · 1 slide');
    expect(projectMeta(project('a', 'IG Square', 1, 1, 6))).toBe('IG Square · 6 slides');
  });
});
