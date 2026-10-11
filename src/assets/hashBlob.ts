/** Stable content hashes for imports and legacy media, including HTTP LAN previews. */
export async function hashBlob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const subtle = globalThis.crypto?.subtle;
  // Web Crypto is unavailable on plain HTTP network addresses. Keep the
  // fallback lazy so secure contexts use the native implementation.
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-256', bytes))
    : (await import('@noble/hashes/sha2.js')).sha256(new Uint8Array(bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
