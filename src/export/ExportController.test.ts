import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { createNamedBlobZip } from './ExportController';

describe('incremental ZIP export', () => {
  it('adds ordered entries without retaining a caller-owned entry array', async () => {
    const archive = await createNamedBlobZip(false);
    await archive.add('01.png', new Blob(['first'], { type: 'image/png' }));
    await archive.add('02.mp4', new Blob(['second'], { type: 'video/mp4' }));
    const result = await archive.close();

    const reader = new ZipReader(new BlobReader(result.blob));
    const entries = await reader.getEntries();
    await reader.close();
    await result.release();

    expect(entries.map((entry) => entry.filename)).toEqual(['01.png', '02.mp4']);
  });
});
