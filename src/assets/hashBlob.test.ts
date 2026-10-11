// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashBlob } from './hashBlob';

afterEach(() => vi.unstubAllGlobals());

for (const native of [true, false]) {
  describe(native ? 'native media hashing' : 'HTTP fallback media hashing', () => {
    it.each([
      ['empty input', new Uint8Array()],
      ['ASCII text', new TextEncoder().encode('abc')],
      ['UTF-8 text', new TextEncoder().encode('Photos from São Paulo 📷')],
      ['multiple binary blocks', Uint8Array.from({ length: 4097 }, (_, index) => index % 256)],
    ] as const)('keeps the standard SHA-256 content identity for %s', async (_, bytes) => {
      vi.stubGlobal('crypto', native ? webcrypto : undefined);
      const expected = createHash('sha256').update(bytes).digest('hex');
      expect(await hashBlob(new Blob([bytes]))).toBe(expected);
    });
  });
}
