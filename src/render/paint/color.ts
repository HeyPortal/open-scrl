/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `transparent` into 0–255 channels and 0–1 alpha. */
export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  let s = hex.trim().toLowerCase();
  if (s === 'transparent' || s === '') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if ((s.length !== 6 && s.length !== 8) || !/^[0-9a-f]+$/.test(s)) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 };
}

/** A CSS color for `hex` with its alpha multiplied by `opacity`. Unparseable input passes through. */
export function withOpacity(hex: string, opacity: number) {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.max(0, Math.min(1, c.a * opacity))})`;
}

export const isTransparentColor = (hex: string | undefined) => !hex || (parseHex(hex)?.a ?? 1) === 0;
