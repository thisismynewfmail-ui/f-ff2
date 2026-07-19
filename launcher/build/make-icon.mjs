#!/usr/bin/env node
/**
 * Generate the launcher/app icon with zero image dependencies.
 *
 * The mark is a golden-angle PHYLLOTAXIS disc — r = c·√i, θ = i·137.5° — the
 * same sunflower-seed spiral the game's loaders bloom into, rendered in the
 * phosphor-green → ember gradient used across the UI. Pure Node: we rasterise
 * into an RGBA buffer and hand-roll a PNG (zlib is built in), so the build has
 * no native/canvas requirement on any CI runner.
 *
 * Output: launcher/build/icon.png (512×512). Committed to the repo so packaging
 * never has to regenerate it, but re-runnable via `npm run icon`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 512;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'icon.png');
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const buf = new Uint8Array(SIZE * SIZE * 4); // RGBA

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const ia = 1 - a;
  buf[i]     = Math.round(r * a + buf[i] * ia);
  buf[i + 1] = Math.round(g * a + buf[i + 1] * ia);
  buf[i + 2] = Math.round(b * a + buf[i + 2] * ia);
  buf[i + 3] = Math.min(255, Math.round(a * 255 + buf[i + 3] * ia));
}

function disc(cx, cy, rad, r, g, b, alpha) {
  const r0 = Math.floor(cx - rad - 1), r1 = Math.ceil(cx + rad + 1);
  const c0 = Math.floor(cy - rad - 1), c1 = Math.ceil(cy + rad + 1);
  for (let y = c0; y <= c1; y++) {
    for (let x = r0; x <= r1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, rad - d + 0.5)); // 1px soft edge
      if (cov > 0) setPx(x, y, r, g, b, alpha * cov);
    }
  }
}

// ---- background: dark panel with a soft green vignette + subtle rounded frame
const cx = SIZE / 2, cy = SIZE / 2;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x - cx, y - cy) / (SIZE / 2);
    const glow = Math.max(0, 1 - d * 1.25);
    const r = 8 + glow * 10;
    const g = 12 + glow * 40;
    const b = 9 + glow * 16;
    const i = (y * SIZE + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
}

// ---- gradient helper: phosphor green (t=0) → ember amber (t=1)
function grad(t) {
  const g0 = [124, 255, 155], g1 = [224, 184, 64];
  return g0.map((c, k) => Math.round(c + (g1[k] - c) * t));
}

// ---- phyllotaxis disc
const N = 560;
const scale = 8.4; // r = scale·√i  → outermost seed near the frame
for (let i = 0; i < N; i++) {
  const t = i / (N - 1);
  const rr = scale * Math.sqrt(i);
  const a = i * GOLDEN;
  const x = cx + Math.cos(a) * rr;
  const y = cy + Math.sin(a) * rr;
  const [r, g, b] = grad(t);
  const dotR = 3.0 + t * 5.0;
  disc(x, y, dotR + 1.6, r, g, b, 0.16); // halo
  disc(x, y, dotR, r, g, b, 0.96);        // core
}

// bright nucleus
disc(cx, cy, 6, 255, 246, 216, 0.95);

// ---- thin frame
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
    if (edge < 6) setPx(x, y, 124, 255, 155, 0.10 * (1 - edge / 6));
  }
}

// ---- encode PNG (RGBA, 8-bit, filter 0 per scanline) --------------------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter type 0
  Buffer.from(buf.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes, ${SIZE}x${SIZE})`);
