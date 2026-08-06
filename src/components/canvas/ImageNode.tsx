import { useEffect, useRef, useState } from 'react';
import { Group, Image as KImage, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import type { ImageLayer } from '@/types';
import { getAsset, getAssetUrl, listAssets } from '@/lib/assets';
import { imageResourceManager } from '@/render/resources/ImageResourceManager';
import { createAnimatedGifCanvas, stopAnimatedGifCanvas } from '@/lib/gif';

const BASE_EDITOR_IMAGE_EDGE = 1024;
const EDITOR_IMAGE_TIERS = [BASE_EDITOR_IMAGE_EDGE, 2048, 4096] as const;
const DETAIL_UPGRADE_DELAY_MS = 180;

type DrawableImage = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

function chooseEditorImageTier(layer: ImageLayer, renderScale: number) {
  const edge = Math.max(layer.width, layer.height) * renderScale * Math.max(1, layer.cropScale ?? 1);
  return EDITOR_IMAGE_TIERS.find((tier) => tier >= edge) ?? EDITOR_IMAGE_TIERS.at(-1)!;
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
  renderScale: number;
}

export function ImageNode({ layer, selected, onSelect, onDragStart, onDragMove, onDragEnd, onTransform, onTransformEnd, groupRef, renderScale }: Props) {
  const [baseImg, setBaseImg] = useState<DrawableImage | null>(null);
  const [detailImg, setDetailImg] = useState<ImageBitmap | null>(null);
  const [detailEdge, setDetailEdge] = useState(BASE_EDITOR_IMAGE_EDGE);
  const [animated, setAnimated] = useState(false);
  const [missing, setMissing] = useState(false);
  const imageRef = useRef<Konva.Image | null>(null);
  const requestedEdge = chooseEditorImageTier(layer, renderScale);

  useEffect(() => {
    let cancelled = false;
    let video: HTMLVideoElement | null = null;
    let gifCanvas: HTMLCanvasElement | null = null;
    let acquiredBase = false;
    setBaseImg(null); setDetailImg(null); setDetailEdge(BASE_EDITOR_IMAGE_EDGE); setAnimated(false); setMissing(false);
    if (!layer.assetId) { setMissing(true); return; }
    const assetId = layer.assetId;

    listAssets().then((assets) => assets.find((asset) => asset.id === assetId)).then(async (meta) => {
      if (cancelled || !meta) { if (!cancelled) setMissing(true); return; }
      const kind = meta.mediaKind ?? (meta.mime.startsWith('video/') ? 'video' : meta.mime === 'image/gif' ? 'gif' : 'image');
      if (kind === 'video') {
        const url = await getAssetUrl(assetId); if (cancelled || !url) return;
        video = document.createElement('video'); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
        video.onloadeddata = () => { if (cancelled || !video) return; video.width = video.videoWidth; video.height = video.videoHeight; setAnimated(true); setBaseImg(video); void video.play().catch(() => undefined); };
        video.onerror = () => { if (!cancelled) setMissing(true); };
        return;
      }
      if (kind === 'gif') {
        const asset = await getAsset(assetId); if (cancelled || !asset) return;
        gifCanvas = await createAnimatedGifCanvas(asset.blob, asset.width, asset.height);
        if (cancelled) { stopAnimatedGifCanvas(gifCanvas); return; }
        setAnimated(true); setBaseImg(gifCanvas); return;
      }
      acquiredBase = true;
      const bitmap = await imageResourceManager.acquire(assetId, BASE_EDITOR_IMAGE_EDGE);
      if (cancelled) imageResourceManager.release(assetId, BASE_EDITOR_IMAGE_EDGE); else setBaseImg(bitmap);
    }).catch(() => { if (!cancelled) setMissing(true); });

    return () => {
      cancelled = true; video?.pause(); if (gifCanvas) stopAnimatedGifCanvas(gifCanvas);
      if (acquiredBase) imageResourceManager.release(assetId, BASE_EDITOR_IMAGE_EDGE);
    };
  }, [layer.assetId]);

  useEffect(() => {
    if (!animated || !imageRef.current) return;
    const animation = new Konva.Animation(() => undefined, imageRef.current.getLayer()); animation.start();
    return () => { animation.stop(); };
  }, [animated, baseImg]);

  useEffect(() => {
    if (requestedEdge <= detailEdge) { setDetailEdge(requestedEdge); return; }
    const timer = window.setTimeout(() => setDetailEdge(requestedEdge), DETAIL_UPGRADE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [detailEdge, requestedEdge]);

  useEffect(() => {
    let cancelled = false; setDetailImg(null);
    if (animated || !layer.assetId || detailEdge <= BASE_EDITOR_IMAGE_EDGE) return;
    const assetId = layer.assetId;
    imageResourceManager.acquire(assetId, detailEdge).then((bitmap) => { if (cancelled) imageResourceManager.release(assetId, detailEdge); else setDetailImg(bitmap); }).catch(() => undefined);
    return () => { cancelled = true; imageResourceManager.release(assetId, detailEdge); };
  }, [animated, detailEdge, layer.assetId]);

  const img = detailImg ?? baseImg;
  const crop = img && (() => {
    const scale = Math.max(1, layer.cropScale ?? 1); const box = layer.width / layer.height; const ratio = img.width / img.height;
    let width = img.width; let height = img.height; if (ratio > box) width = img.height * box; else height = img.width / box; width /= scale; height /= scale;
    const maxX = Math.max(0, img.width - width); const maxY = Math.max(0, img.height - height);
    return { x: maxX / 2 + layer.cropOffsetX * maxX, y: maxY / 2 + layer.cropOffsetY * maxY, width, height };
  })();

  return <Group ref={groupRef} id={layer.id} name="layer" x={layer.x + layer.width / 2} y={layer.y + layer.height / 2} offsetX={layer.width / 2} offsetY={layer.height / 2} rotation={layer.rotation} opacity={layer.opacity} visible={layer.visible} draggable={!layer.locked} onMouseDown={onSelect} onTouchStart={onSelect} onTap={onSelect} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onTransform={onTransform} onTransformEnd={onTransformEnd}>
    <Rect width={layer.width} height={layer.height} fill={img ? undefined : selected ? '#252333' : '#20202a'} stroke={img ? undefined : selected ? '#8b72ff' : '#383846'} strokeWidth={img ? 0 : selected ? 4 : 1.5} cornerRadius={layer.cornerRadius} listening />
    {img && crop && <KImage ref={imageRef} image={img} width={layer.width} height={layer.height} cornerRadius={layer.cornerRadius} listening={false} perfectDrawEnabled={false} cropX={crop.x} cropY={crop.y} cropWidth={crop.width} cropHeight={crop.height} />}
    {missing && !img && <Group listening={false}><Line points={[layer.width*.35,layer.height*.58,layer.width*.47,layer.height*.44,layer.width*.55,layer.height*.51,layer.width*.65,layer.height*.42]} stroke={selected?'#a99aff':'#777789'} strokeWidth={4} lineCap="round" lineJoin="round"/><Text x={0} y={layer.height*.64} width={layer.width} text={selected?'Choose from Media':'Add media'} fontFamily="Inter" fontStyle={selected?'bold':'normal'} fontSize={Math.min(24,Math.max(12,layer.width/13))} fill={selected?'#c8c0ff':'#8e8e9d'} align="center" listening={false}/></Group>}
  </Group>;
}
