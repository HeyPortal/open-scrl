import type { Background } from '@/types';

export const SOLID_SWATCHES = [
  '#ffffff',
  '#f5f4f0',
  '#fde68a',
  '#fca5a5',
  '#fb7185',
  '#a78bfa',
  '#7c5cff',
  '#60a5fa',
  '#34d399',
  '#111827',
  '#000000',
];

export const GRADIENT_SWATCHES: { from: string; to: string; angle: number }[] = [
  { from: '#fde68a', to: '#fb7185', angle: 135 },
  { from: '#a78bfa', to: '#7c5cff', angle: 135 },
  { from: '#60a5fa', to: '#34d399', angle: 135 },
  { from: '#fca5a5', to: '#a78bfa', angle: 90 },
  { from: '#111827', to: '#7c5cff', angle: 45 },
  { from: '#f5f4f0', to: '#cbd5e1', angle: 180 },
];

export const backgroundCss = (bg: Background) =>
  bg.kind === 'solid' ? bg.color : `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;

export const sameBackground = (a: Background | undefined, b: Background) => {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'solid' && b.kind === 'solid') return a.color.toLowerCase() === b.color.toLowerCase();
  if (a.kind === 'gradient' && b.kind === 'gradient') {
    return a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase() && a.angle === b.angle;
  }
  return false;
};
