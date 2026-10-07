import { useEffect, useState } from 'react';
import { Shape } from 'react-konva';
import type { AssetMeta, Background } from '@/types';
import { imageResourceManager } from '@/render/resources/ImageResourceManager';
import { paintBackground, paintCheckerboard, type BackgroundMedia } from '@/render/paint/layers';

const BACKGROUND_IMAGE_EDGE = 2048;

/** Decodes a background photo for the editor, releasing it when the background changes. */
export function useBackgroundMedia(background: Background, asset: AssetMeta | undefined): BackgroundMedia | null {
  const assetId = background.kind === 'image' ? background.assetId : null;
  const [media, setMedia] = useState<BackgroundMedia | null>(null);
  useEffect(() => {
    setMedia(null);
    if (!assetId) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    imageResourceManager.acquire(assetId, BACKGROUND_IMAGE_EDGE, asset).then((lease) => {
      if (cancelled) { lease.release(); return; }
      release = lease.release;
      setMedia({ source: lease.bitmap, width: lease.bitmap.width, height: lease.bitmap.height, key: `${assetId}@${lease.bitmap.width}` });
    }).catch(() => undefined);
    return () => { cancelled = true; release?.(); };
  }, [asset, assetId]);
  return media;
}

interface Props {
  background: Background;
  asset?: AssetMeta;
  width: number;
  height: number;
  zoom: number;
}

/** A slide's background on the editor canvas. Transparent slides show a checkerboard. */
export function SlideBackground({ background, asset, width, height, zoom }: Props) {
  const media = useBackgroundMedia(background, asset);
  return (
    <Shape
      width={width}
      height={height}
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(context) => {
        const ctx = context._context;
        if (background.kind === 'transparent') paintCheckerboard(ctx, width, height, Math.max(8, 12 / zoom));
        else paintBackground(ctx, background, width, height, media);
      }}
    />
  );
}
