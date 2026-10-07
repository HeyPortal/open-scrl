import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useAssets } from '@/store/assets';
import { paintSlidePreview, sameScene, type SlideScene } from '@/render/preview';
import { backgroundCss } from '@/lib/palette';

interface Props {
  scene: SlideScene;
  format: { width: number; height: number };
  /** CSS pixels. */
  width: number;
  height: number;
  checkerboard?: boolean;
  /** Coalesces rapid edits (dragging) before repainting. */
  delay?: number;
  className?: string;
}

/** A slide drawn with the export painter, repainted only when its own content changes. */
export const SlidePreviewCanvas = memo(function SlidePreviewCanvas({ scene, format, width, height, checkerboard = true, delay = 0, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const assets = useAssets((s) => s.assets);
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(width * dpr)), ph = Math.max(1, Math.round(height * dpr));
    let current = true;
    const paint = () => {
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      void paintSlidePreview(ctx, scene, format, pw, assetsById, { checkerboard, isCurrent: () => current });
    };
    const timer = delay > 0 ? window.setTimeout(paint, delay) : (paint(), undefined);
    return () => { current = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [assetsById, checkerboard, delay, format, height, scene, width]);

  return <canvas ref={ref} className={className} style={{ width, height, display: 'block' }} aria-hidden />;
}, (a, b) => sameScene(a.scene, b.scene) && a.width === b.width && a.height === b.height && a.format.width === b.format.width
  && a.format.height === b.format.height && a.checkerboard === b.checkerboard && a.className === b.className);

/**
 * The same preview kept as a small PNG instead of a live canvas, so a long filmstrip doesn't
 * hold a canvas per slide. The previous image stays up until the repaint is ready.
 */
export const SlidePreviewImage = memo(function SlidePreviewImage({ scene, format, width, height, checkerboard = true, delay = 0, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  const assets = useAssets((s) => s.assets);
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  useEffect(() => () => { if (latest.current) URL.revokeObjectURL(latest.current); }, []);

  useEffect(() => {
    let current = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const paint = async () => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !(await paintSlidePreview(ctx, scene, format, canvas.width, assetsById, { checkerboard, isCurrent: () => current }))) return;
      canvas.toBlob((blob) => {
        if (!current || !blob) return;
        const next = URL.createObjectURL(blob);
        if (latest.current) URL.revokeObjectURL(latest.current);
        latest.current = next;
        setUrl(next);
      }, 'image/png');
    };
    const timer = window.setTimeout(() => void paint(), delay);
    return () => { current = false; window.clearTimeout(timer); };
  }, [assetsById, checkerboard, delay, format, height, scene, width]);

  return url
    ? <img src={url} alt="" draggable={false} className={className} style={{ width, height, display: 'block' }} />
    : <div className={className} style={{ width, height, background: backgroundCss(scene.background) }} aria-hidden />;
}, (a, b) => sameScene(a.scene, b.scene) && a.width === b.width && a.height === b.height && a.format.width === b.format.width
  && a.format.height === b.format.height && a.checkerboard === b.checkerboard && a.className === b.className);
