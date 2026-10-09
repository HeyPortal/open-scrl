import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const directory = path.resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let revision = 0;
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/__pwa/version' && request.method === 'POST') {
    revision++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ revision }));
    return;
  }
  const file = path.resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${directory}${path.sep}`)) { response.writeHead(403); response.end(); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    // A changed SW script exercises the real install/wait/activate lifecycle,
    // while the application chunks stay identical throughout this test run.
    response.end(pathname === '/sw.js' ? `${bytes.toString()}\n// Test deployment ${revision}\n` : bytes);
  } catch { response.writeHead(404); response.end(); }
}).listen(Number(process.env.PWA_PORT ?? 5187), '127.0.0.1');
