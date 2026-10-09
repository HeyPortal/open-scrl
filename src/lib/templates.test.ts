import { describe, expect, it } from 'vitest';
import { deleteTemplate, listTemplates, presetDocument, saveTemplate, withoutPhotos } from './templates';
const format = { name: 'Portrait', width: 1080, height: 1350 };
describe('post layouts', () => {
  it('saves reusable geometry without photos or crop choices and can remove it', async () => {
    const doc = presetDocument('overlap', format);
    const first = doc.layers[doc.slides[doc.slideOrder[0]].layerOrder[0]];
    if (first.kind !== 'image') throw new Error('Expected photo');
    first.assetId = 'private-original'; first.cropScale = 1.4; first.cropOffsetX = .2;
    doc.slides[doc.slideOrder[0]].background = { kind: 'image', assetId: 'private-background', blur: 0, dim: 0, color: '#ffffff' };
    const clean = withoutPhotos(doc);
    expect(clean.layers[first.id]).toMatchObject({ assetId: null, cropScale: 1, cropOffsetX: 0, rotation: -5 });
    expect(clean.slides[doc.slideOrder[0]].background).toEqual({ kind: 'solid', color: '#ffffff' });
    expect(first.assetId).toBe('private-original');
    const saved = await saveTemplate(doc, ' My layout ');
    expect(await listTemplates()).toContainEqual({ ...saved, name: 'My layout', document: clean });
    await deleteTemplate(saved.id);
    expect((await listTemplates()).some((layout) => layout.id === saved.id)).toBe(false);
  });
  it('generates the expected slide and photo counts and rejects blank names', async () => {
    const gallery = presetDocument('gallery', format);
    expect(gallery.slideOrder).toHaveLength(3);
    expect(Object.values(gallery.layers)).toHaveLength(3);
    const storyboard = presetDocument('storyboard', format);
    expect(storyboard.slideOrder).toHaveLength(2);
    expect(Object.values(storyboard.layers)).toHaveLength(4);
    await expect(saveTemplate(gallery, ' ')).rejects.toThrow('name');
  });
});
