import type { Background } from '@/types';
import { backgroundGradient, gradientCss } from '@/render/paint/gradient';

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

const CHECKERBOARD = 'repeating-conic-gradient(#d4d4d8 0% 25%, #ffffff 0% 50%) 50% / 16px 16px';

/** A CSS `background` value approximating a slide background (photos show their base color). */
export const backgroundCss = (bg: Background) => {
  switch (bg.kind) {
    case 'solid': return bg.color;
    case 'gradient': return gradientCss(backgroundGradient(bg));
    case 'image': return bg.color;
    case 'transparent': return CHECKERBOARD;
  }
};

export const backgroundLabel = (bg: Background) => {
  switch (bg.kind) {
    case 'solid': return bg.color;
    case 'gradient': return `${bg.from} to ${bg.to}`;
    case 'image': return 'photo';
    case 'transparent': return 'transparent';
  }
};

export const sameBackground = (a: Background | undefined, b: Background) => {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'solid' && b.kind === 'solid') return a.color.toLowerCase() === b.color.toLowerCase();
  if (a.kind === 'gradient' && b.kind === 'gradient') {
    const x = backgroundGradient(a), y = backgroundGradient(b);
    return x.type === y.type && x.angle === y.angle && x.stops.length === y.stops.length
      && x.stops.every((s, i) => s.offset === y.stops[i].offset && s.color.toLowerCase() === y.stops[i].color.toLowerCase());
  }
  if (a.kind === 'image' && b.kind === 'image') return a.assetId === b.assetId && a.blur === b.blur && a.dim === b.dim;
  return a.kind === 'transparent';
};
