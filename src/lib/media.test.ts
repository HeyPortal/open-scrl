import { describe, expect, it, vi } from 'vitest';
import type { AssetMeta, ProjectDocumentV2 } from '@/types';
import { getAnimatedAssetIdsForSlide, setVideoElementPlaying, slideHasAnimatedMedia } from './media';

const doc: ProjectDocumentV2 = {
  schemaVersion: 2,
  revision: 0,
  id: 'project',
  name: 'Per-slide video',
  format: { name: 'Test', width: 100, height: 100 },
  slideOrder: ['slide-one', 'slide-two'],
  slides: {
    'slide-one': { id: 'slide-one', background: { kind: 'solid', color: '#000' }, layerOrder: ['gif-layer'] },
    'slide-two': { id: 'slide-two', background: { kind: 'solid', color: '#000' }, layerOrder: ['video-layer', 'photo-layer'] },
  },
  layers: {
    'gif-layer': { id: 'gif-layer', kind: 'image', name: 'GIF', x: 10, y: 10, width: 50, height: 50, rotation: 0, opacity: 1, visible: true, locked: false, assetId: 'gif', cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 },
    'video-layer': { id: 'video-layer', kind: 'image', name: 'Video', x: 10, y: 10, width: 50, height: 50, rotation: 0, opacity: 1, visible: true, locked: false, assetId: 'video', cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 },
    'photo-layer': { id: 'photo-layer', kind: 'image', name: 'Photo', x: 20, y: 20, width: 50, height: 50, rotation: 0, opacity: 1, visible: true, locked: false, assetId: 'photo', cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 },
  },
  createdAt: 0,
  updatedAt: 0,
};

const asset = (id: string, mime: string, mediaKind: AssetMeta['mediaKind']): AssetMeta => ({
  id,
  blobKey: id,
  thumbnailKey: id,
  hash: id,
  name: id,
  mime,
  width: 100,
  height: 100,
  size: 1,
  mediaKind,
});

const assets = [
  asset('gif', 'image/gif', 'gif'),
  asset('video', 'video/mp4', 'video'),
  asset('photo', 'image/jpeg', 'image'),
];

describe('per-slide animated media selection', () => {
  it('only returns animated media visible on the requested slide', () => {
    expect(getAnimatedAssetIdsForSlide(doc, 'slide-one', assets)).toEqual(['gif']);
    expect(getAnimatedAssetIdsForSlide(doc, 'slide-two', assets)).toEqual(['video']);
  });

  it('does not enable MP4 export for a missing or static slide', () => {
    expect(slideHasAnimatedMedia(doc, 'missing', assets)).toBe(false);
    expect(slideHasAnimatedMedia({ ...doc, slides: { ...doc.slides, 'slide-two': { ...doc.slides['slide-two'], layerOrder: ['photo-layer'] } } }, 'slide-two', assets)).toBe(false);
  });

  it('plays selected video elements and pauses unselected ones', async () => {
    const video = document.createElement('video');
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);

    await setVideoElementPlaying(video, true);
    expect(play).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();

    await setVideoElementPlaying(video, false);
    expect(pause).toHaveBeenCalledOnce();
  });
});
