/** HEIC conversion creates an editing rendition; callers must retain the input bytes. */
export async function editingPhoto(file: File): Promise<Blob> {
  if (!/\.(heic|heif)$/i.test(file.name) && !/heic|heif/i.test(file.type)) return file;
  try { const bitmap = await createImageBitmap(file); bitmap.close(); return file; } catch { /* native browser decoder unavailable */ }
  try {
    const response = await fetch('/api/native/preview', { method: 'POST', body: file });
    if (response.ok && response.headers.get('content-type')?.startsWith('image/jpeg')) return await response.blob();
  } catch { /* try the browser-side converter on static hosting */ }
  if (typeof document === 'undefined') throw new Error('HEIC requires the main-thread decoder or local macOS helper.');
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: .95 });
  return Array.isArray(converted) ? converted[0] : converted;
}
