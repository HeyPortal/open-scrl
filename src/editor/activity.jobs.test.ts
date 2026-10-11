import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ import: vi.fn(), thumbnail: vi.fn(), exportSlide: vi.fn(), exportCarousel: vi.fn() }));
vi.mock('@/lib/assets', () => ({
  DuplicateAssetError: class extends Error {},
  deleteAsset: vi.fn(),
  getAssetThumbUrl: mocks.thumbnail,
  importAsset: mocks.import,
  isLikelyMediaFile: () => true,
  listAssets: vi.fn(),
}));
vi.mock('@/lib/export', () => ({ exportSlide: mocks.exportSlide, exportInstagramCarousel: mocks.exportCarousel }));
import { editorActivity } from './activity';
import { useDocumentStore } from './documentStore';
import { useExport } from './exportStore';
import { useAssets } from '@/store/assets';

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ activeProjectId: 'project' });
  useAssets.setState({ projectId: 'project', assets: [], thumbs: {} });
  useExport.setState({ exporting: false });
  mocks.thumbnail.mockResolvedValue('blob:thumbnail');
});

describe('update activity across user jobs', () => {
  it('stays busy through thumbnail completion and an overlapping export', async () => {
    const thumbnail = deferred();
    const exportWork = deferred();
    mocks.import.mockResolvedValue({ id: 'photo', name: 'photo.png' });
    mocks.thumbnail.mockReturnValue(thumbnail.promise);
    mocks.exportSlide.mockReturnValue(exportWork.promise);
    const importing = useAssets.getState().importFiles([new File(['photo'], 'photo.png')]);
    const exporting = useExport.getState().exportCurrentSlide();
    expect(editorActivity.getSnapshot()).toBe(2);
    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledOnce());
    thumbnail.resolve('blob:thumbnail');
    await importing;
    expect(editorActivity.getSnapshot()).toBe(1);
    exportWork.resolve();
    await exporting;
    expect(editorActivity.getSnapshot()).toBe(0);
  });

  it('releases failed imports and failed carousel exports so updates can be retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.import.mockRejectedValue(new Error('Bad photo'));
    mocks.exportCarousel.mockRejectedValue(new Error('Export failed'));
    await Promise.all([
      useAssets.getState().importFiles([new File(['bad'], 'bad.png')]),
      useExport.getState().exportCarousel(),
    ]);
    expect(editorActivity.getSnapshot()).toBe(0);
    expect(useExport.getState().exporting).toBe(false);
    expect(useAssets.getState().importMessage).toContain("Couldn't decode");
    vi.restoreAllMocks();
  });
});

it('holds update activity until cancellation settles, suppresses success, and permits retry', async () => {
  const work = deferred();
  mocks.exportCarousel.mockReturnValueOnce(work.promise);
  const exporting = useExport.getState().exportCarousel({ format: 'jpeg', pixelRatio: 2 });
  const [, report, request] = mocks.exportCarousel.mock.calls[0];
  expect(request).toMatchObject({ format: 'jpeg', pixelRatio: 2 });
  report('Rendering…', .3);
  expect(useExport.getState().fraction).toBe(.3);
  useExport.getState().cancel();
  expect(request.signal.aborted).toBe(true);
  expect(useExport.getState().cancelling).toBe(true);
  expect(editorActivity.getSnapshot()).toBe(1);
  await useExport.getState().exportCurrentSlide();
  expect(mocks.exportSlide).not.toHaveBeenCalled();
  report('Too late', 1);
  expect(useExport.getState().progress).toBe('Cancelling…');
  work.resolve();
  await exporting;
  expect(useExport.getState()).toMatchObject({ outcome: 'cancelled', exporting: false, error: null });
  expect(editorActivity.getSnapshot()).toBe(0);
  mocks.exportCarousel.mockResolvedValueOnce(undefined);
  await useExport.getState().exportCarousel();
  expect(useExport.getState().outcome).toBe('complete');
  expect(editorActivity.getSnapshot()).toBe(0);
});
