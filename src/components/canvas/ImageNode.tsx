import { useEffect, useState } from 'react';
import { Circle, Group, Image as KImage, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { ImageLayer } from '@/types';
import { getAsset, getAssetUrl, getAssetUrlSync } from '@/lib/assets';

const MAX_EDITOR_IMAGE_EDGE = 1600;

type DrawableImage = HTMLImageElement | ImageBitmap;
const editorBitmapCache = new Map<string, Promise<ImageBitmap | null>>();

function bitmapResizeOptions(width: number, height: number): ImageBitmapOptions {
  const scale = Math.min(1, MAX_EDITOR_IMAGE_EDGE / Math.max(width, height));
  if (scale >= 1) return {};
  return {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)),
    resizeQuality: 'high',
  };
}

interface Props {
  layer: ImageLayer;
  selected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  groupRef: (n: Konva.Group | null) => void;
}

export function ImageNode({
  layer,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransform,
  onTransformEnd,
  groupRef,
}: Props) {
  const [img, setImg] = useState<DrawableImage | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImg(null);
    setMissing(false);
    if (!layer.assetId) {
      setMissing(true);
      return;
    }

    const loadFallbackImage = (url: string) => {
      const im = new Image();
      im.onload = () => {
        if (!cancelled) setImg(im);
      };
      im.onerror = () => {
        if (!cancelled) setMissing(true);
      };
      im.src = url;
    };

    const loadBitmap = async () => {
      if (!layer.assetId || !('createImageBitmap' in window)) return false;
      let bitmapPromise = editorBitmapCache.get(layer.assetId);
      if (!bitmapPromise) {
        bitmapPromise = getAsset(layer.assetId).then((asset) => {
          if (!asset) return null;
          return createImageBitmap(asset.blob, bitmapResizeOptions(asset.width, asset.height));
        });
        editorBitmapCache.set(layer.assetId, bitmapPromise);
      }
      const bitmap = await bitmapPromise;
      if (cancelled || !bitmap) return !!bitmap;
      setImg(bitmap);
      return true;
    };

    const load = (url: string) => {
      loadBitmap().catch(() => false).then((loaded) => {
        if (!cancelled && !loaded) loadFallbackImage(url);
      });
    };

    const cached = getAssetUrlSync(layer.assetId);
    if (cached) load(cached);
    else
      getAssetUrl(layer.assetId).then((url) => {
        if (cancelled) return;
        if (!url) setMissing(true);
        else load(url);
      });
    return () => {
      cancelled = true;
    };
  }, [layer.assetId]);

  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const crop =
    img &&
    (() => {
      const cropScale = Math.max(1, layer.cropScale ?? 1);
      const ratioBox = layer.width / layer.height;
      const ratioImg = img.width / img.height;
      let width = img.width;
      let height = img.height;
      if (ratioImg > ratioBox) {
        width = img.height * ratioBox;
      } else {
        height = img.width / ratioBox;
      }
      width /= cropScale;
      height /= cropScale;
      const maxX = Math.max(0, img.width - width);
      const maxY = Math.max(0, img.height - height);
      return {
        x: maxX / 2 + layer.cropOffsetX * maxX,
        y: maxY / 2 + layer.cropOffsetY * maxY,
        width,
        height,
      };
    })();

  return (
    <Group
      ref={groupRef}
      id={layer.id}
      name="layer"
      x={cx}
      y={cy}
      offsetX={layer.width / 2}
      offsetY={layer.height / 2}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
      draggable={!layer.locked}
      onMouseDown={onSelect}
      onTouchStart={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    >
      <Rect
        width={layer.width}
        height={layer.height}
        fill={img ? undefined : '#1d1d27'}
        stroke={img ? undefined : selected ? '#7c5cff' : '#3a3a48'}
        strokeWidth={img ? 0 : selected ? 4 : 2}
        dash={img ? undefined : [12, 8]}
        cornerRadius={layer.cornerRadius}
        listening
      />
      {img && crop && (
        <KImage
          image={img}
          width={layer.width}
          height={layer.height}
          cornerRadius={layer.cornerRadius}
          listening={false}
          perfectDrawEnabled={false}
          cropX={crop.x}
          cropY={crop.y}
          cropWidth={crop.width}
          cropHeight={crop.height}
        />
      )}
      {missing && !img && (
        <Group listening={false}>
          {(() => {
            const iconSize = Math.max(28, Math.min(72, Math.min(layer.width, layer.height) * 0.22));
            const cx = layer.width / 2;
            const cy = layer.height / 2 - iconSize * 0.25;
            return (
              <>
                <Circle
                  x={cx}
                  y={cy}
                  radius={iconSize / 2}
                  fill="#272735"
                  stroke={selected ? '#7c5cff' : '#4b4b5c'}
                  strokeWidth={2}
                />
                <Line
                  points={[cx - iconSize * 0.22, cy, cx + iconSize * 0.22, cy]}
                  stroke="#b8b8c7"
                  strokeWidth={Math.max(3, iconSize * 0.08)}
                  lineCap="round"
                />
                <Line
                  points={[cx, cy - iconSize * 0.22, cx, cy + iconSize * 0.22]}
                  stroke="#b8b8c7"
                  strokeWidth={Math.max(3, iconSize * 0.08)}
                  lineCap="round"
                />
              </>
            );
          })()}
          <Text
            x={0}
            y={layer.height / 2 + Math.max(16, Math.min(36, layer.height * 0.08))}
            width={layer.width}
            text="Choose photo"
            fontFamily="Inter"
            fontSize={Math.min(28, Math.max(13, layer.width / 12))}
            fill="#8e8e9d"
            align="center"
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}
