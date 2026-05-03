import type { Format } from '@/types';

export const FORMATS: Format[] = [
  { name: 'IG Portrait', width: 1080, height: 1350 },
  { name: 'IG Square', width: 1080, height: 1080 },
  { name: 'IG Story / Reels', width: 1080, height: 1920 },
  { name: 'IG Landscape', width: 1080, height: 566 },
  { name: 'TikTok', width: 1080, height: 1920 },
  { name: 'Pinterest', width: 1000, height: 1500 },
];

export const DEFAULT_FORMAT = FORMATS[0];
