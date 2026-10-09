import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ convert: vi.fn(), import: vi.fn() }));
vi.mock('heic2any', () => ({ default: mocks.convert }));
vi.mock('@/assets/AssetImportController', () => ({
  AssetImportController: class { import = mocks.import; },
  DuplicateAssetError: class extends Error {},
}));
import { importAsset } from './assets';

beforeEach(() => {
  vi.stubGlobal('Worker', class {});
  mocks.convert.mockReset();
  mocks.import.mockReset().mockResolvedValue({ id: 'photo' });
});
afterEach(() => vi.unstubAllGlobals());

describe('HEIC adapter loading', () => {
  it('converts HEIC before sending a JPEG file to the existing import worker', async () => {
    const source = new File(['heic'], 'photo.HEIC', { type: 'image/heic', lastModified: 123 });
    mocks.convert.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await importAsset(source, 'project');
    expect(mocks.convert).toHaveBeenCalledWith({ blob: source, toType: 'image/jpeg', quality: 0.92 });
    const [file, project] = mocks.import.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('photo.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(file.lastModified).toBe(123);
    expect(project).toBe('project');
  });

  it('preserves the first-image behavior for multi-image HEIF conversion', async () => {
    const first = new Blob(['first'], { type: 'image/jpeg' });
    mocks.convert.mockResolvedValue([first, new Blob(['second'])]);
    await importAsset(new File(['heif'], 'photo.heif'), 'project');
    expect(mocks.import.mock.calls[0][0]).toMatchObject({ name: 'photo.jpg', size: first.size });
  });

  it('keeps ordinary images on the existing worker path', async () => {
    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    await importAsset(file, 'project');
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.import).toHaveBeenCalledWith(file, 'project');
  });

  it('reports decoder failures without posting an unusable file to the worker', async () => {
    mocks.convert.mockRejectedValue(new Error('Unsupported HEIC'));
    await expect(importAsset(new File(['bad'], 'bad.heic'), 'project')).rejects.toThrow('Unsupported HEIC');
    expect(mocks.import).not.toHaveBeenCalled();
  });
});
