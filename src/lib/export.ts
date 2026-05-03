import Konva from 'konva';
import JSZip from 'jszip';
import type { Document, Layer, Slide } from '@/types';
import { getAsset } from './assets';

interface ExportOptions {
  format: 'png' | 'jpeg';
  quality: number;
  pixelRatio: number;
}

const DEFAULTS: ExportOptions = { format: 'png', quality: 0.95, pixelRatio: 1 };

async function loadImg(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export async function renderSlideToBlob(
  doc: Document,
  slide: Slide,
  opts: Partial<ExportOptions> = {},
): Promise<Blob> {
  const o = { ...DEFAULTS, ...opts };
  const fmt = doc.format;
  const targetSlideIndex = Math.max(0, doc.slides.findIndex((s) => s.id === slide.id));
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '-99999px';
  document.body.appendChild(container);

  const stage = new Konva.Stage({
    container,
    width: fmt.width,
    height: fmt.height,
  });

  try {
    const layer = new Konva.Layer();
    stage.add(layer);

    if (slide.background.kind === 'solid') {
      layer.add(new Konva.Rect({ x: 0, y: 0, width: fmt.width, height: fmt.height, fill: slide.background.color }));
    } else {
      layer.add(
        new Konva.Rect({
          x: 0,
          y: 0,
          width: fmt.width,
          height: fmt.height,
          fillLinearGradientStartPoint: { x: 0, y: 0 },
          fillLinearGradientEndPoint: {
            x: fmt.width * Math.cos((slide.background.angle * Math.PI) / 180),
            y: fmt.height * Math.sin((slide.background.angle * Math.PI) / 180),
          },
          fillLinearGradientColorStops: [0, slide.background.from, 1, slide.background.to],
        }),
      );
    }

    for (let sourceSlideIndex = 0; sourceSlideIndex < doc.slides.length; sourceSlideIndex++) {
      const sourceSlide = doc.slides[sourceSlideIndex];
      const offsetX = (sourceSlideIndex - targetSlideIndex) * fmt.width;
      for (const l of sourceSlide.layers) {
        if (!l.visible) continue;
        await addLayer(layer, l, offsetX);
      }
    }

    layer.draw();

    const mime = o.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => {
      stage.toBlob({
        pixelRatio: o.pixelRatio,
        mimeType: mime,
        quality: o.quality,
        callback: (result) => {
          if (result) resolve(result);
          else reject(new Error('Failed to render slide export.'));
        },
      }).catch(reject);
    });

    return blob;
  } finally {
    stage.destroy();
    container.remove();
  }
}

async function addLayer(layer: Konva.Layer, l: Layer, offsetX = 0) {
  if (l.kind === 'image') {
    if (!l.assetId) return;
    const asset = await getAsset(l.assetId);
    if (!asset) return;
    const img = await loadImg(asset.blob);
    const cropScale = Math.max(1, l.cropScale ?? 1);
    const ratioBox = l.width / l.height;
    const ratioImg = img.width / img.height;
    let cropW = img.width;
    let cropH = img.height;
    if (ratioImg > ratioBox) cropW = img.height * ratioBox;
    else cropH = img.width / ratioBox;
    cropW /= cropScale;
    cropH /= cropScale;
    const maxCropX = Math.max(0, img.width - cropW);
    const maxCropY = Math.max(0, img.height - cropH);
    const cropX = maxCropX / 2 + l.cropOffsetX * maxCropX;
    const cropY = maxCropY / 2 + l.cropOffsetY * maxCropY;
    layer.add(
      new Konva.Image({
        x: offsetX + l.x + l.width / 2,
        y: l.y + l.height / 2,
        offsetX: l.width / 2,
        offsetY: l.height / 2,
        width: l.width,
        height: l.height,
        rotation: l.rotation,
        opacity: l.opacity,
        cornerRadius: l.cornerRadius,
        image: img,
        crop: { x: cropX, y: cropY, width: cropW, height: cropH },
      }),
    );
  } else if (l.kind === 'shape') {
    if (l.shape === 'rect') {
      layer.add(
        new Konva.Rect({
          x: offsetX + l.x + l.width / 2,
          y: l.y + l.height / 2,
          offsetX: l.width / 2,
          offsetY: l.height / 2,
          width: l.width,
          height: l.height,
          rotation: l.rotation,
          opacity: l.opacity,
          fill: l.fill,
          stroke: l.strokeWidth > 0 ? l.stroke : undefined,
          strokeWidth: l.strokeWidth,
          cornerRadius: l.cornerRadius,
        }),
      );
    } else {
      layer.add(
        new Konva.Ellipse({
          x: offsetX + l.x + l.width / 2,
          y: l.y + l.height / 2,
          radiusX: l.width / 2,
          radiusY: l.height / 2,
          rotation: l.rotation,
          opacity: l.opacity,
          fill: l.fill,
          stroke: l.strokeWidth > 0 ? l.stroke : undefined,
          strokeWidth: l.strokeWidth,
        }),
      );
    }
  } else {
    layer.add(
      new Konva.Text({
        x: offsetX + l.x + l.width / 2,
        y: l.y + l.height / 2,
        offsetX: l.width / 2,
        offsetY: l.height / 2,
        width: l.width,
        height: l.height,
        rotation: l.rotation,
        opacity: l.opacity,
        text: l.text,
        fontFamily: l.fontFamily,
        fontSize: l.fontSize,
        fontStyle: `${l.italic ? 'italic ' : ''}${l.fontWeight}`,
        fill: l.fill,
        align: l.align,
        lineHeight: l.lineHeight,
        letterSpacing: l.letterSpacing,
      }),
    );
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportSlide(
  doc: Document,
  slideIndex: number,
  opts: Partial<ExportOptions> = {},
): Promise<void> {
  const slide = doc.slides[slideIndex];
  if (!slide) return;
  const blob = await renderSlideToBlob(doc, slide, opts);
  const ext = (opts.format ?? 'png') === 'jpeg' ? 'jpg' : 'png';
  const safe = doc.name.replace(/[^a-z0-9-_]+/gi, '_') || 'slide';
  downloadBlob(blob, `${safe}_${String(slideIndex + 1).padStart(2, '0')}.${ext}`);
}

export async function exportAllAsZip(
  doc: Document,
  opts: Partial<ExportOptions> = {},
  onProgress?: (i: number, total: number) => void,
): Promise<void> {
  const zip = new JSZip();
  const ext = (opts.format ?? 'png') === 'jpeg' ? 'jpg' : 'png';
  for (let i = 0; i < doc.slides.length; i++) {
    const blob = await renderSlideToBlob(doc, doc.slides[i], opts);
    zip.file(`${String(i + 1).padStart(2, '0')}.${ext}`, blob);
    onProgress?.(i + 1, doc.slides.length);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  const safe = doc.name.replace(/[^a-z0-9-_]+/gi, '_') || 'project';
  downloadBlob(out, `${safe}.zip`);
}
