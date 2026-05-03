import { customAlphabet } from 'nanoid';

export const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

export const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

export const round = (v: number, digits = 2) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
