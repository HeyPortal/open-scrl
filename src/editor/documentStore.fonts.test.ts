import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore, collectProjectAssetScopes } from './documentStore';
import { ensureLayerFonts } from '@/render/fonts/families';
import { useToasts } from '@/store/toasts';

vi.mock('@/render/fonts/families', async (original) => ({
  ...await original<typeof import('@/render/fonts/families')>(), ensureLayerFonts: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(ensureLayerFonts).mockReset().mockResolvedValue(undefined);
  useDocumentStore.setState({ activeProjectId: null, readOnlyError: null });
});
afterEach(() => { vi.restoreAllMocks(); });

async function savedProject() {
  await useDocumentStore.getState().newProject();
  useDocumentStore.getState().addTextLayer('Custom type');
  const layerId = Object.keys(useDocumentStore.getState().doc.layers)[0];
  useDocumentStore.getState().updateLayer(layerId, { fontFamily: `OpenSCRL_Font_${'a'.repeat(64)}` });
  const doc = useDocumentStore.getState().doc;
  await useDocumentStore.getState().closeProject();
  return doc;
}
describe('project fonts', () => {
  it('waits for saved fonts before exposing the reopened document to the editor', async () => {
    const doc = await savedProject();
    let release!: () => void;
    vi.mocked(ensureLayerFonts).mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const opening = useDocumentStore.getState().openProject(doc.id);
    await vi.waitFor(() => expect(ensureLayerFonts).toHaveBeenCalledWith(Object.values(doc.layers)));
    expect(useDocumentStore.getState().activeProjectId).toBeNull();
    release(); await opening;
    expect(useDocumentStore.getState().activeProjectId).toBe(doc.id);
  });
  it('keeps a missing font recoverable and offers a font-library action', async () => {
    const doc = await savedProject();
    const toast = vi.spyOn(useToasts.getState(), 'addToast').mockImplementation(() => undefined);
    vi.mocked(ensureLayerFonts).mockRejectedValue(new Error('Original font is missing'));
    await useDocumentStore.getState().openProject(doc.id);
    expect(useDocumentStore.getState().activeProjectId).toBe(doc.id);
    expect(useDocumentStore.getState().readOnlyError).toBeNull();
    expect(toast).toHaveBeenCalledWith('Original font is missing', 'warning', expect.objectContaining({ label: 'Manage fonts' }));
  });
  it('does not load fonts while scanning media ownership for migration', async () => {
    const doc = await savedProject();
    await collectProjectAssetScopes([{ id: doc.id, name: doc.name, format: doc.format, slideCount: doc.slideOrder.length, createdAt: doc.createdAt, updatedAt: doc.updatedAt }], async () => doc);
    expect(ensureLayerFonts).not.toHaveBeenCalled();
  });
});
