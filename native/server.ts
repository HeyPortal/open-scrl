import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

const run = promisify(execFile);
const MAX_BODY = 256 * 1024 * 1024;
let binary: Promise<string> | undefined;
let busy = false;
async function renderer() {
  if (process.platform !== 'darwin') throw new Error('HDR export requires the local macOS helper.');
  binary ??= (async () => {
    const root = path.resolve('.native-runtime');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(root, { recursive: true });
    const source = path.resolve('native/HDRRenderer.swift');
    const target = path.join(root, 'HDRRenderer');
    const built = await stat(target).catch(() => undefined);
    if (!built || built.mtimeMs < (await stat(source)).mtimeMs) {
      await run('swiftc', ['-module-cache-path', path.join(tmpdir(), 'open-scrl-swift-cache'), source, '-o', target], { timeout: 120_000 });
    }
    return target;
  })().catch((error: unknown) => { binary = undefined; throw error; });
  return binary;
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('This export is too large. Try fewer photos or 1× resolution.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function errorMessage(error: unknown): string {
  const e = error as { stderr?: string; message?: string };
  return e?.stderr?.trim().slice(0, 1000) || e?.message || 'Local image processing failed.';
}
export function nativeImages(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0];
    if (!url?.startsWith('/api/native/')) return next();
    // Same-origin requests only; the helper neither reads user paths nor fetches remote URLs.
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Use the editor from the same origin as its image helper.' }); }
      catch { return json(res, 403, { error: 'Invalid request origin.' }); }
    }
    if (url === '/api/native/capabilities' && req.method === 'GET') {
      try { await renderer(); json(res, 200, { hdr: true, format: 'Adaptive HDR JPEG', heic: true }); }
      catch (error) { json(res, 200, { hdr: false, error: errorMessage(error) }); }
      return;
    }
    if (req.method !== 'POST' || !['/api/native/preview', '/api/native/export'].includes(url)) return json(res, 404, { error: 'Unknown image operation.' });
    if (busy) return json(res, 429, { error: 'Another photo is being processed. Please try again.' });
    busy = true;
    let folder: string | undefined;
    try {
      const executable = await renderer();
      const data = await body(req);
      folder = await mkdtemp(path.join(tmpdir(), 'open-scrl-image-'));
      const output = path.join(folder, 'output.jpg');
      let report: string | undefined;
      if (url === '/api/native/preview') {
        const input = path.join(folder, 'source');
        await writeFile(input, data);
        await run(executable, ['preview', input, output], { timeout: 90_000 });
      } else {
        const payload = JSON.parse(data.toString()) as { scene: { entries: unknown[] }; files: { name: string; data: string }[] };
        if (!payload.scene || !Array.isArray(payload.scene.entries) || payload.scene.entries.length > 500 || !Array.isArray(payload.files) || payload.files.length > 1000) throw new Error('Invalid scene.');
        const names = new Set<string>();
        for (const file of payload.files) {
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(file.name) || names.has(file.name) || typeof file.data !== 'string') throw new Error('Invalid image identifier.');
          names.add(file.name);
          await writeFile(path.join(folder, file.name), Buffer.from(file.data, 'base64'));
        }
        const input = path.join(folder, 'scene.json');
        await writeFile(input, JSON.stringify(payload.scene));
        const result = await run(executable, ['render', input, output], { timeout: 120_000 });
        report = result.stdout.trim();
      }
      const encoded = await readFile(output);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', ...(report ? { 'X-HDR-Report': report } : {}) });
      res.end(encoded);
    } catch (error) { json(res, 422, { error: errorMessage(error) }); }
    finally { busy = false; if (folder) await rm(folder, { recursive: true, force: true }); }
  };
  return {
    name: 'local-hdr-images',
    configureServer(server) {
      const source = path.resolve('native/HDRRenderer.swift');
      server.watcher.add(source);
      server.watcher.on('change', (file) => { if (path.resolve(file) === source) binary = undefined; });
      server.middlewares.use((req, res, next) => { void middleware(req, res, next); });
    },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
  };
}
