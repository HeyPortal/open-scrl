/**
 * Gaussian blur approximated by three box blurs, with edge pixels extended so blurred photos
 * don't darken toward the slide edges. Works on main-thread and worker canvases alike, so
 * editor, preview and export blur identically (CSS `blur()` semantics: `sigma` is the standard
 * deviation in canvas pixels).
 */

type Canvas = OffscreenCanvas | HTMLCanvasElement;

export function createCanvas(width: number, height: number): Canvas {
  const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function boxSizes(sigma: number, passes: number) {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4));
  return Array.from({ length: passes }, (_, i) => (i < m ? lower : upper));
}

function boxPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, radius: number, horizontal: boolean) {
  const outer = horizontal ? h : w, inner = horizontal ? w : h;
  const step = horizontal ? 4 : w * 4;
  const scale = 1 / (radius * 2 + 1);
  const last = inner - 1;
  for (let o = 0; o < outer; o++) {
    const base = horizontal ? o * w * 4 : o * 4;
    for (let c = 0; c < 4; c++) {
      const b0 = base + c;
      const firstValue = src[b0], lastValue = src[b0 + last * step];
      let sum = (radius + 1) * firstValue;
      for (let i = 1; i <= radius; i++) sum += src[b0 + Math.min(i, last) * step];
      for (let i = 0; i < inner; i++) {
        dst[b0 + i * step] = sum * scale;
        const add = i + radius + 1, sub = i - radius;
        sum += (add <= last ? src[b0 + add * step] : lastValue) - (sub >= 0 ? src[b0 + sub * step] : firstValue);
      }
    }
  }
}

export function blurImageData(data: ImageData, sigma: number) {
  if (sigma < 0.3) return data;
  const { width: w, height: h } = data;
  const a = data.data, b = new Uint8ClampedArray(a.length);
  for (const size of boxSizes(sigma, 3)) {
    const radius = (size - 1) / 2;
    boxPass(a, b, w, h, radius, true);
    boxPass(b, a, w, h, radius, false);
  }
  return new ImageData(a, w, h);
}

export interface CoverSource {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** The source cover-fitted (and centered) on a `width`×`height` box. */
export function coverRect(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale, h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

const cache = new Map<string, Canvas>();
const CACHE_LIMIT = 16;

/**
 * A blurred, cover-fitted copy of `image` for a `width`×`height` area, rendered at reduced
 * resolution (blur hides the difference) and cached by `key`.
 */
export function blurredCover(key: string, image: CoverSource, width: number, height: number, blur: number): Canvas {
  const cacheKey = `${key}|${width}x${height}|${blur}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit;
  }
  const q = Math.min(1, 1024 / Math.max(width, height), Math.max(0.04, 6 / Math.max(blur, 0.001)));
  const canvas = createCanvas(width * q, height * q);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const r = coverRect(image.width, image.height, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image.source, r.x, r.y, r.width, r.height);
  ctx.putImageData(blurImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), blur * q), 0, 0);
  cache.set(cacheKey, canvas);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return canvas;
}
