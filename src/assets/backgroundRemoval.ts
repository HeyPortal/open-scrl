import type { AssetMeta } from '@/types';
import { getMediaKind } from '@/lib/media';

export const U2NET_SIZE = 320;
export const MAX_CUTOUT_EDGE = 4096;

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export type BackgroundRemovalProgress = (message: string) => void;

export function canRemoveBackground(asset: Pick<AssetMeta, 'mediaKind' | 'mime'> | undefined) {
  return !!asset && getMediaKind(asset) === 'image';
}

export function cutoutFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, '').trim() || 'photo';
  return `${base}-cutout.png`;
}

export function imageDataToNchwTensor(image: ImageData, size = U2NET_SIZE) {
  const { data, width, height } = image;
  if (width !== size || height !== size) {
    throw new Error(`Expected a ${size}×${size} image for the background-removal model.`);
  }
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    tensor[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    tensor[plane + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    tensor[plane * 2 + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return tensor;
}

export function normalizeMask(mask: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of mask) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min || 1;
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const unit = (mask[i] - min) / span;
    out[i] = unit < 0.02 ? 0 : unit > 0.98 ? 1 : unit;
  }
  return out;
}

export function applyAlphaMask(
  image: ImageData,
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number,
) {
  const out = new ImageData(image.width, image.height);
  out.data.set(image.data);
  const maxX = Math.max(1, maskWidth - 1);
  const maxY = Math.max(1, maskHeight - 1);
  for (let y = 0; y < image.height; y++) {
    const my = (y / Math.max(1, image.height - 1)) * maxY;
    const y0 = Math.floor(my);
    const y1 = Math.min(maskHeight - 1, y0 + 1);
    const fy = my - y0;
    for (let x = 0; x < image.width; x++) {
      const mx = (x / Math.max(1, image.width - 1)) * maxX;
      const x0 = Math.floor(mx);
      const x1 = Math.min(maskWidth - 1, x0 + 1);
      const fx = mx - x0;
      const v00 = mask[y0 * maskWidth + x0] ?? 0;
      const v10 = mask[y0 * maskWidth + x1] ?? 0;
      const v01 = mask[y1 * maskWidth + x0] ?? 0;
      const v11 = mask[y1 * maskWidth + x1] ?? 0;
      const value =
        v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy;
      const alpha = Math.round(Math.min(1, Math.max(0, value)) * 255);
      const i = (y * image.width + x) * 4 + 3;
      out.data[i] = Math.round((out.data[i] * alpha) / 255);
    }
  }
  return out;
}

function canvasContext(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not prepare the photo for background removal.');
  return { canvas, ctx };
}

export function scaleImageData(image: ImageData, width: number, height: number) {
  const source = canvasContext(image.width, image.height);
  source.ctx.putImageData(image, 0, 0);
  const dest = canvasContext(width, height);
  dest.ctx.drawImage(source.canvas, 0, 0, width, height);
  return dest.ctx.getImageData(0, 0, width, height);
}

export function fitWithinMaxEdge(width: number, height: number, maxEdge = MAX_CUTOUT_EDGE) {
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return { width, height };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function blobToImageData(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const fitted = fitWithinMaxEdge(bitmap.width, bitmap.height);
    const { ctx } = canvasContext(fitted.width, fitted.height);
    ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
    return ctx.getImageData(0, 0, fitted.width, fitted.height);
  } finally {
    bitmap.close();
  }
}

function imageDataToPng(image: ImageData) {
  const { canvas, ctx } = canvasContext(image.width, image.height);
  ctx.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the cutout.'))), 'image/png');
  });
}

let sessionPromise: Promise<import('onnxruntime-web').InferenceSession> | null = null;

async function loadModel(onProgress?: BackgroundRemovalProgress) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      onProgress?.('Loading the on-device model…');
      const [{ default: wasmFile }, { default: wasmJs }, ort] = await Promise.all([
        import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
        import('onnxruntime-web/ort-wasm-simd-threaded.mjs?url'),
        import('onnxruntime-web/wasm'),
      ]);
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { wasm: wasmFile, mjs: wasmJs };
      const url = `${import.meta.env.BASE_URL}models/u2netp.onnx`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load the local background-removal model.');
      const buffer = await response.arrayBuffer();
      return ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export async function removeImageBackground(blob: Blob, onProgress?: BackgroundRemovalProgress) {
  const session = await loadModel(onProgress);
  onProgress?.('Reading the photo…');
  const original = await blobToImageData(blob);
  const square = scaleImageData(original, U2NET_SIZE, U2NET_SIZE);
  const tensor = imageDataToNchwTensor(square);
  const ort = await import('onnxruntime-web/wasm');
  const inputName = session.inputNames[0] ?? 'input.1';
  const outputName = session.outputNames[0] ?? '1959';
  onProgress?.('Removing the background on this device…');
  const results = await session.run({
    [inputName]: new ort.Tensor('float32', tensor, [1, 3, U2NET_SIZE, U2NET_SIZE]),
  });
  const output = results[outputName];
  if (!output) throw new Error('The background-removal model did not return a mask.');
  const mask = normalizeMask(Float32Array.from(output.data as Float32Array | number[]));
  const cutout = applyAlphaMask(original, mask, U2NET_SIZE, U2NET_SIZE);
  onProgress?.('Saving the cutout…');
  return imageDataToPng(cutout);
}
