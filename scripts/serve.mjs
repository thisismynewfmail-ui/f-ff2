#!/usr/bin/env node
/**
 * Zero-dependency static dev server that NEVER lets the browser cache.
 *
 * Why this exists: `python3 -m http.server` (and most static servers) hand
 * files out with a `Last-Modified` header but no cache directives, so browsers
 * cache them heuristically. In practice that means editing a texture in
 * `assets/` — or any source file — and reloading keeps painting the STALE
 * cached copy, even after you restart the server. That is exactly the "changed
 * textures don't show up in game" bug.
 *
 * This server sends `Cache-Control: no-store` on every response, so every
 * reload re-fetches the current file from disk: textures, sprites, portraits
 * AND the JavaScript modules. Drop a new PNG in `assets/textures/` (any
 * power-of-two size, e.g. a 512x512 grass.png), reload, and it shows up.
 *
 * Usage:
 *   node scripts/serve.mjs [port]      # default port 8000
 *   PORT=9000 node scripts/serve.mjs
 * then open http://localhost:8000/
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    // Strip the query string (our cache-busting ?v=… and anything else).
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/' || path === '') path = '/index.html';
    // Resolve within ROOT and refuse to escape it (no ../ traversal).
    const filePath = normalize(join(ROOT, path));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let target = filePath;
    const info = await stat(target).catch(() => null);
    if (info && info.isDirectory()) target = join(target, 'index.html');
    const fileInfo = await stat(target);
    const buf = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      // The whole point: force a fresh fetch on every reload.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(buf);
    // Diagnostic log for image requests: the EXACT absolute file served, its
    // size and last-modified time. If a texture isn't updating, this tells you
    // precisely which file on disk the server is reading — compare it to where
    // your image editor is actually saving. A stale size/mtime here means your
    // edit never reached this file (wrong copy, wrong folder, or saved
    // elsewhere), which no browser refresh can fix.
    if (/\.(png|jpe?g|gif|svg)$/i.test(target)) {
      console.log(`GET ${req.url}  ->  ${target}  (${fileInfo.size} bytes, modified ${fileInfo.mtime.toISOString()})`);
    }
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
    console.log(`${err.code === 'ENOENT' ? '404' : '500'} ${req.url}`);
  }
});

server.listen(PORT, () => {
  console.log(`F-FPS dev server (no-cache) → http://localhost:${PORT}/`);
  console.log(`Serving from: ${ROOT}`);
  console.log('Every reload re-fetches from disk. Image requests are logged with the exact');
  console.log('file served + its size/mtime, so you can confirm your edits are reaching it.');
});
