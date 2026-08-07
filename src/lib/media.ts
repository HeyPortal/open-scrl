import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import type { AssetMeta, ProjectDocumentV2 } from '@/types';

type MediaDescriptor = Pick<AssetMeta, 'id' | 'mediaKind' | 'mime'>;

export function getMediaKind(asset: Pick<MediaDescriptor, 'mediaKind' | 'mime'>) {
  return asset.mediaKind
    ?? (asset.mime.startsWith('video/') ? 'video' : asset.mime === 'image/gif' ? 'gif' : 'image');
}

export function isAnimatedMedia(asset: Pick<MediaDescriptor, 'mediaKind' | 'mime'>) {
  return getMediaKind(asset) !== 'image';
}

export async function setVideoElementPlaying(video: HTMLVideoElement, playing: boolean) {
  if (playing) {
    await video.play().catch(() => undefined);
    return;
  }
  video.pause();
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) video.currentTime = 0;
}

export function getAnimatedAssetIdsForSlide(
  doc: ProjectDocumentV2,
  slideId: string,
  assets: MediaDescriptor[],
) {
  const viewport = getSlideViewport(doc, slideId);
  if (!viewport) return [];
  const metadata = new Map(assets.map((asset) => [asset.id, asset]));
  const ids = compileScene(doc, viewport).flatMap(({ layer }) => {
    if (layer.kind !== 'image' || !layer.assetId) return [];
    const asset = metadata.get(layer.assetId);
    return asset && isAnimatedMedia(asset) ? [asset.id] : [];
  });
  return [...new Set(ids)];
}

export function slideHasAnimatedMedia(
  doc: ProjectDocumentV2,
  slideId: string,
  assets: MediaDescriptor[],
) {
  return getAnimatedAssetIdsForSlide(doc, slideId, assets).length > 0;
}
