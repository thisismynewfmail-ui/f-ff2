#!/usr/bin/env node
/**
 * Generate the launcher/app icon with zero image dependencies.
 *
 * The mark is a golden-angle PHYLLOTAXIS disc — r = c·√i, θ = i·137.5° — the
 * same sunflower-seed spiral the game's loaders bloom into, rendered in the
 * phosphor-green → ember gradient used across the UI. Pure Node: we rasterise
 * into an RGBA buffer and hand-roll the PNG/ICO containers (zlib is built in),
 * so the build has no native/canvas requirement on any CI runner.
 *
 * Outputs (both committed so packaging never has to regenerate them, but
 * re-runnable via `npm run icon`):
 *   - build/icon.png  512×512   (electron-builder source icon)
 *   - build/icon.ico  16…256    (multi-resolution; used by NSIS and by the
 *                                pure-JS resource editor in build/afterPack.js
 *                                that stamps the exe icon without Wine)
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DIR = dirname(fileURLToPath(import.meta.url));

/** Rasterise the icon at an arbitrary size into an RGBA buffer. */
function render(SIZE) {
  const buf = new Uint8Array(SIZE * SIZE * 4);
  const cx = SIZE / 2, cy = SIZE / 2;

  const setPx = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
    const i = (y * SIZE + x) * 4;
    const ia = 1 - a;
    buf[i]     = Math.round(r * a + buf[i] * ia);
    buf[i + 1] = Math.round(g * a + buf[i + 1] * ia);
    buf[i + 2] = Math.round(b * a + buf[i + 2] * ia);
    buf[i + 3] = Math.min(255, Math.round(a * 255 + buf[i + 3] * ia));
  };
  const disc = (dx, dy, rad, r, g, b, alpha) => {
    const r0 = Math.floor(dx - rad - 1), r1 = Math.ceil(dx + rad + 1);
    const c0 = Math.floor(dy - rad - 1), c1 = Math.ceil(dy + rad + 1);
    for (let y = c0; y <= c1; y++) {
      for (let x = r0; x <= r1; x++) {
        const d = Math.hypot(x + 0.5 - dx, y + 0.5 - dy);
        const cov = Math.max(0, Math.min(1, rad - d + 0.5));
        if (cov > 0) setPx(x, y, r, g, b, alpha * cov);
      }
    }
  };

  // background: dark panel with a soft green vignette
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - cx, y - cy) / (SIZE / 2);
      const glow = Math.max(0, 1 - d * 1.25);
      const i = (y * SIZE + x) * 4;
      buf[i] = 8 + glow * 10; buf[i + 1] = 12 + glow * 40; buf[i + 2] = 9 + glow * 16; buf[i + 3] = 255;
    }
  }

  const grad = (t) => {
    const g0 = [124, 255, 155], g1 = [224, 184, 64];
    return g0.map((c, k) => Math.round(c + (g1[k] - c) * t));
  };

  // phyllotaxis disc, scaled to the canvas
  const N = 560;
  const scale = (SIZE / 512) * 8.4;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const rr = scale * Math.sqrt(i);
    const a = i * GOLDEN;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const [r, g, b] = grad(t);
    const dotR = (SIZE / 512) * (3.0 + t * 5.0);
    disc(x, y, dotR + (SIZE / 512) * 1.6, r, g, b, 0.16);
    disc(x, y, dotR, r, g, b, 0.96);
  }
  disc(cx, cy, (SIZE / 512) * 6, 255, 246, 216, 0.95);

  // thin frame
  const fw = Math.max(2, Math.round(SIZE / 85));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      if (edge < fw) setPx(x, y, 124, 255, 155, 0.10 * (1 - edge / fw));
    }
  }
  return buf;
}

/* ---- PNG encode (RGBA, 8-bit) ------------------------------------------- */
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, SIZE) {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- ICO encode (PNG-compressed entries, Vista+) ------------------------ */
function encodeIco(entries) {
  // entries: [{ size, png }]
  const count = entries.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const bodies = [];
  entries.forEach((e, i) => {
    const dir = 6 + i * 16;
    header.writeUInt8(e.size >= 256 ? 0 : e.size, dir);      // width (0 = 256)
    header.writeUInt8(e.size >= 256 ? 0 : e.size, dir + 1);  // height
    header.writeUInt8(0, dir + 2); // palette
    header.writeUInt8(0, dir + 3); // reserved
    header.writeUInt16LE(1, dir + 4);  // color planes
    header.writeUInt16LE(32, dir + 6); // bits per pixel
    header.writeUInt32LE(e.png.length, dir + 8);
    header.writeUInt32LE(offset, dir + 12);
    offset += e.png.length;
    bodies.push(e.png);
  });
  return Buffer.concat([header, ...bodies]);
}

const png512 = encodePng(render(512), 512);
writeFileSync(join(DIR, 'icon.png'), png512);

const icoSizes = [256, 128, 64, 48, 32, 16];
const icoEntries = icoSizes.map((s) => ({ size: s, png: encodePng(render(s), s) }));
const ico = encodeIco(icoEntries);
writeFileSync(join(DIR, 'icon.ico'), ico);

console.log(`wrote icon.png (${png512.length} bytes) and icon.ico (${ico.length} bytes, sizes ${icoSizes.join('/')})`);
