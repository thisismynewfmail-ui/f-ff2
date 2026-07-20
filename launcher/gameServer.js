'use strict';
/**
 * Internal game server for the desktop launcher.
 *
 * This is the packaged-app sibling of scripts/serve.mjs: a tiny, zero-dependency
 * static server that hands the game's own files to the isolated Electron game
 * window over http://127.0.0.1. Running the game over a real (loopback) HTTP
 * origin — rather than file:// — keeps the game code byte-for-byte identical to
 * the browser build: ES modules load, and the /api/session save endpoints work
 * exactly as they do in development.
 *
 * Two things differ from the dev server, both mandated by shipping to a fresh
 * Windows box:
 *
 *   1. It binds to 127.0.0.1 on an OS-assigned ephemeral port (port 0). Nothing
 *      is ever exposed off the machine, and there is no fixed port to collide
 *      with whatever else the user is running.
 *
 *   2. The save directory is injectable. In a packaged app the game files live
 *      under a read-only resources folder (possibly inside Program Files), so
 *      saves are redirected to Electron's per-user, always-writable userData
 *      path. The game is none the wiser — it still POSTs to /api/session.
 */
const { createServer } = require('node:http');
const { readFile, stat, writeFile, mkdir } = require('node:fs/promises');
const { extname, join, normalize, sep } = require('node:path');

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
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};

/**
 * Start the game server.
 *
 * @param {object} opts
 * @param {string} opts.root     Absolute path to the game files (contains index.html).
 * @param {string} opts.saveDir  Absolute path to a writable directory for saves.
 * @param {string} [opts.host]   Bind address (default 127.0.0.1).
 * @param {number} [opts.port]   Port (default 0 = OS-assigned ephemeral).
 * @returns {Promise<{port:number, host:string, url:string, close:()=>Promise<void>}>}
 */
function startServer({ root, saveDir, host = '127.0.0.1', port = 0 } = {}) {
  if (!root) throw new Error('gameServer: root is required');
  if (!saveDir) throw new Error('gameServer: saveDir is required');
  const ROOT = normalize(root);
  const SAVE_FILE = join(saveDir, 'last_session.json');

  async function handleSessionApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      try {
        const buf = await readFile(SAVE_FILE);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(buf);
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"exists":false}');
      }
      return;
    }
    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 65536) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          JSON.parse(body); // validate — never write junk to disk
          await mkdir(saveDir, { recursive: true });
          await writeFile(SAVE_FILE, body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"ok":false,"error":"invalid JSON"}');
        }
      });
      return;
    }
    res.writeHead(405); res.end('Method not allowed');
  }

  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(req.url.split('?')[0]);
      if (path === '/api/session') { await handleSessionApi(req, res); return; }
      if (path === '/' || path === '') path = '/index.html';
      // Resolve within ROOT and refuse to escape it (no ../ traversal).
      const filePath = normalize(join(ROOT, path));
      if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      let target = filePath;
      const info = await stat(target).catch(() => null);
      if (info && info.isDirectory()) target = join(target, 'index.html');
      const buf = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        // The desktop shell owns the files; never let the embedded Chromium
        // serve a stale copy after an in-place update.
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(buf);
    } catch (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: boundPort,
        host,
        url: `http://${host}:${boundPort}/`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

module.exports = { startServer };
