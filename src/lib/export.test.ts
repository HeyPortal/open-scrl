import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newDocument } from '@/editor/documentStore';
const mocks = vi.hoisted(() => ({ createZip: vi.fn(), download: vi.fn(), render: vi.fn(), inspect: vi.fn(), video: vi.fn() }));
vi.mock('@/export/ExportController', () => ({ createNamedBlobZip: mocks.createZip, downloadBlob: mocks.download, renderProjectSlides: mocks.render, zipBlobs: vi.fn() }));
vi.mock('@/export/video', () => ({ inspectSlideVideo: mocks.inspect, renderSlideAsVideoResource: mocks.video }));
import { exportInstagramCarousel, exportSlide } from './export';

beforeEach(() => vi.resetAllMocks());
describe('cancelled export resource ownership', () => {
  it('releases a completed ZIP without downloading if cancellation arrives during packaging', async () => {
    const controller = new AbortController();
    const release = vi.fn();
    const archive = { add: vi.fn(), discard: vi.fn(), close: vi.fn(async () => {
      controller.abort();
      return { blob: new Blob(['zip']), release };
    }) };
    mocks.createZip.mockResolvedValue(archive);
    mocks.render.mockResolvedValue([new Blob(['image'])]);
    await expect(exportInstagramCarousel(newDocument(), undefined, { animation: 'still', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('releases a completed video without downloading if it was cancelled before delivery', async () => {
    const controller = new AbortController();
    const release = vi.fn();
    mocks.inspect.mockResolvedValue({ animated: true });
    mocks.video.mockImplementation(async () => {
      controller.abort();
      return { blob: new Blob(['video']), release };
    });
    await expect(exportSlide(newDocument(), 0, { animation: 'auto', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
