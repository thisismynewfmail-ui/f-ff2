#!/usr/bin/env node
/**
 * Retro texture generator for F-FPS.
 *
 * Produces every texture the game uses as power-of-two PNG files in
 * assets/textures/. All surface textures are tileable (drawing helpers wrap
 * coordinates), use small fixed palettes and ordered Bayer dithering to get
 * the 2003 Half-Life / early-PS1 look.
 *
 * No dependencies: includes a minimal PNG (RGBA) encoder on top of node:zlib.
 *
 * Usage: node scripts/generate_textures.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'textures');
mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(img) {
  const { w, h, d } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(d.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Img {
  constructor(w, h, fill = null) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
    if (fill) this.rect(0, 0, w, h, fill);
  }
  set(x, y, c) {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2];
    this.d[i + 3] = c.length > 3 ? c[3] : 255;
  }
  get(x, y) {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  // Rect clipped to bounds (no wrapping) — for sprites.
  rectC(x, y, w, h, c) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.set(i, j, c);
  }
  disc(cx, cy, r, c) {
    for (let j = Math.floor(cy - r); j <= cy + r; j++)
      for (let i = Math.floor(cx - r); i <= cx + r; i++)
        if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) this.set(i, j, c);
  }
  // 1px outline around all opaque pixels (sprite readability).
  outline(c) {
    const mark = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)[3] > 0) continue;
      const near = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < this.w && ny < this.h && this.get(nx, ny)[3] > 60;
      });
      if (near) mark.push([x, y]);
    }
    for (const [x, y] of mark) this.set(x, y, c);
  }
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
function dither(v, x, y, amp = 0.12) {
  return v + (BAYER4[y & 3][x & 3] / 16 - 0.5) * amp;
}
function pick(pal, v) {
  const i = Math.max(0, Math.min(pal.length - 1, Math.floor(v * pal.length)));
  return pal[i];
}

// Tileable value noise (lattice wraps at size/cell).
function makeNoise(size, cell, seed) {
  const n = Math.max(1, Math.floor(size / cell));
  const rng = mulberry32(seed);
  const lattice = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) lattice[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = ((x / cell) % n + n) % n;
    const fy = ((y / cell) % n + n) % n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = lattice[y0 * n + x0], b = lattice[y0 * n + x1];
    const c = lattice[y1 * n + x0], e = lattice[y1 * n + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  };
}
function fbm(size, seed, octaves = 3, baseCell = 32) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise(size, Math.max(2, baseCell >> o), seed + o * 77));
  return (x, y) => {
    let v = 0, amp = 1, total = 0;
    for (const l of layers) { v += l(x, y) * amp; total += amp; amp *= 0.5; }
    return v / total;
  };
}

function noiseFill(img, pal, seed, { octaves = 3, baseCell = 32, ditherAmp = 0.14, curve = (v) => v } = {}) {
  const n = fbm(img.w, seed, octaves, baseCell);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    img.set(x, y, pick(pal, dither(curve(n(x, y)), x, y, ditherAmp)));
  }
}

// Random-walk crack line (dark), wraps for tileability.
function crack(img, rng, color, steps = 40) {
  let x = Math.floor(rng() * img.w), y = Math.floor(rng() * img.h);
  let dir = rng() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    img.set(Math.round(x), Math.round(y), color);
    if (rng() < 0.4) img.set(Math.round(x) + 1, Math.round(y), color);
    dir += (rng() - 0.5) * 1.1;
    x += Math.cos(dir); y += Math.sin(dir);
  }
}

const files = [];
function save(name, img) {
  writeFileSync(join(OUT_DIR, name), encodePNG(img));
  files.push(`${name} (${img.w}x${img.h})`);
}

/* ------------------------------------------------------------------ */
/* Ground textures                                                     */
/* ------------------------------------------------------------------ */

{ // grass
  const img = new Img(128, 128);
  const pal = [[38, 66, 30], [46, 82, 36], [58, 96, 42], [70, 110, 50], [88, 124, 60]];
  noiseFill(img, pal, 101, { baseCell: 24, ditherAmp: 0.2 });
  const rng = mulberry32(9);
  for (let i = 0; i < 260; i++) { // blade flecks
    const x = Math.floor(rng() * 128), y = Math.floor(rng() * 128);
    img.set(x, y, [96, 134, 64]);
    if (rng() < 0.5) img.set(x, y - 1, [104, 142, 70]);
  }
  save('grass.png', img);
}

{ // dirt
  const img = new Img(128, 128);
  const pal = [[62, 46, 30], [76, 57, 37], [90, 68, 44], [104, 80, 52], [118, 92, 62]];
  noiseFill(img, pal, 202, { baseCell: 20, ditherAmp: 0.2 });
  const rng = mulberry32(31);
  for (let i = 0; i < 60; i++) img.disc(rng() * 128, rng() * 128, 1 + rng() * 1.5, [125, 100, 72]); // pebbles
  save('dirt.png', img);
}

{ // gravel
  const img = new Img(128, 128);
  const pal = [[70, 68, 64], [84, 82, 76], [98, 96, 90], [112, 110, 102]];
  noiseFill(img, pal, 203, { baseCell: 6, octaves: 2, ditherAmp: 0.3 });
  save('gravel.png', img);
}

function asphaltBase(img, seed) {
  const pal = [[34, 34, 38], [42, 42, 46], [50, 50, 54], [58, 58, 62]];
  noiseFill(img, pal, seed, { baseCell: 16, ditherAmp: 0.22 });
  const rng = mulberry32(seed + 5);
  for (let i = 0; i < 5; i++) crack(img, rng, [24, 24, 27], 50);
  for (let i = 0; i < 120; i++) img.set(Math.floor(rng() * img.w), Math.floor(rng() * img.h), [66, 66, 70]);
}

{ // plain asphalt
  const img = new Img(128, 128);
  asphaltBase(img, 301);
  save('road_asphalt.png', img);
}

{ // asphalt with dashed center line (tiles along Y)
  const img = new Img(128, 128);
  asphaltBase(img, 302);
  for (let y = 0; y < 128; y++) {
    if (y % 64 < 36) for (let x = 60; x < 68; x++) {
      const v = dither(0.5, x, y, 0.3);
      img.set(x, y, v > 0.45 ? [168, 148, 42] : [140, 122, 36]);
    }
  }
  save('road_line.png', img);
}

{ // crosswalk stripes (tiles along X)
  const img = new Img(128, 128);
  asphaltBase(img, 303);
  for (let x = 0; x < 128; x++) {
    if (x % 32 < 18) for (let y = 8; y < 120; y++) {
      const v = dither(0.5, x, y, 0.35);
      img.set(x, y, v > 0.42 ? [176, 176, 172] : [142, 142, 140]);
    }
  }
  save('crosswalk.png', img);
}

{ // sidewalk: concrete slabs with grooves
  const img = new Img(128, 128);
  const pal = [[120, 118, 112], [132, 130, 122], [144, 142, 134], [156, 154, 146]];
  noiseFill(img, pal, 401, { baseCell: 28, ditherAmp: 0.16 });
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (x % 64 === 0 || y % 64 === 0) img.set(x, y, [92, 90, 86]);
    if (x % 64 === 1 || y % 64 === 1) img.set(x, y, [104, 102, 96]);
  }
  const rng = mulberry32(77);
  for (let i = 0; i < 3; i++) crack(img, rng, [96, 94, 90], 30);
  save('sidewalk.png', img);
}

{ // bare concrete
  const img = new Img(128, 128);
  const pal = [[108, 106, 102], [120, 118, 112], [132, 130, 124], [144, 142, 136]];
  noiseFill(img, pal, 402, { baseCell: 24, ditherAmp: 0.16 });
  save('concrete.png', img);
}

{ // water
  const img = new Img(128, 128);
  const pal = [[18, 34, 48], [22, 44, 62], [28, 56, 76], [36, 68, 90]];
  noiseFill(img, pal, 501, { baseCell: 32, ditherAmp: 0.15 });
  const n = makeNoise(128, 24, 502);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const w = Math.sin((x + n(x, y) * 40) * 0.2 + y * 0.05);
    if (w > 0.93) img.set(x, y, [70, 110, 130]);
  }
  save('water.png', img);
}

/* ------------------------------------------------------------------ */
/* Wall textures                                                       */
/* ------------------------------------------------------------------ */

function brickWall(name, base, mortar, seed) {
  const img = new Img(128, 128);
  const bw = 32, bh = 16;
  const rng = mulberry32(seed);
  for (let row = 0; row < 128 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 128 / bw + 1; col++) {
      const jitter = (rng() - 0.5) * 0.35;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const px = col * bw + off + x, py = row * bh + y;
        const isMortar = y >= bh - 2 || x >= bw - 2;
        if (isMortar) { img.set(px, py, mortar); continue; }
        let v = 0.5 + jitter + (rng() - 0.5) * 0.12;
        v = dither(v, px, py, 0.2);
        img.set(px, py, pick(base, v));
      }
    }
  }
  save(name, img);
  return img;
}

const brickRed = brickWall('wall_brick_red.png',
  [[96, 40, 32], [116, 50, 38], [134, 60, 44], [150, 72, 52]], [130, 122, 112], 601);
brickWall('wall_brick_gray.png',
  [[76, 74, 70], [90, 88, 82], [104, 102, 96], [118, 116, 108]], [140, 136, 128], 602);

{ // cracked variant of red brick (secret false wall)
  const img = new Img(128, 128);
  img.d.set(brickRed.d);
  const rng = mulberry32(603);
  for (let i = 0; i < 10; i++) crack(img, rng, [30, 18, 14], 70);
  img.disc(64, 64, 10, [40, 22, 16]);
  save('wall_brick_cracked.png', img);
}

{ // wood plank wall
  const img = new Img(128, 128);
  const pal = [[74, 52, 32], [88, 62, 38], [102, 72, 44], [116, 84, 52]];
  const n = makeNoise(128, 8, 701);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const plank = Math.floor(x / 16);
    let v = 0.35 + n(plank * 16, y) * 0.5 + (plank % 3) * 0.06;
    if (x % 16 === 0) v = 0.05; else if (x % 16 === 1) v = 0.2;
    img.set(x, y, pick(pal, dither(v, x, y, 0.14)));
  }
  const rng = mulberry32(702);
  for (let i = 0; i < 24; i++) { // nail heads
    const px = Math.floor(rng() * 8) * 16 + 8, py = Math.floor(rng() * 128);
    img.set(px, py, [50, 36, 24]);
  }
  save('wall_wood.png', img);
}

{ // dirty plaster
  const img = new Img(128, 128);
  const pal = [[150, 142, 122], [166, 158, 136], [180, 172, 150], [192, 184, 162]];
  noiseFill(img, pal, 801, { baseCell: 36, ditherAmp: 0.16 });
  const rng = mulberry32(802);
  for (let i = 0; i < 6; i++) crack(img, rng, [110, 102, 88], 36);
  // grime streaks from top
  const n = makeNoise(128, 16, 803);
  for (let x = 0; x < 128; x++) {
    const len = 10 + n(x, 0) * 30;
    for (let y = 0; y < len; y++) {
      if ((x + y) % 2 === 0) {
        const c = img.get(x, y);
        img.set(x, y, [c[0] * 0.8 | 0, c[1] * 0.8 | 0, c[2] * 0.8 | 0]);
      }
    }
  }
  save('wall_plaster.png', img);
}

{ // industrial concrete panels
  const img = new Img(128, 128);
  const pal = [[96, 96, 94], [108, 108, 104], [120, 120, 116], [132, 132, 126]];
  noiseFill(img, pal, 901, { baseCell: 40, ditherAmp: 0.14 });
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (y % 64 < 2 || x % 64 < 2) img.set(x, y, [70, 70, 68]);
  }
  for (const [bx, by] of [[8, 8], [56, 8], [72, 8], [120, 8], [8, 56], [56, 56], [72, 56], [120, 56], [8, 72], [56, 72], [72, 72], [120, 72], [8, 120], [56, 120], [72, 120], [120, 120]]) {
    img.disc(bx, by, 1.5, [60, 60, 58]);
  }
  save('wall_concrete.png', img);
}

{ // corrugated metal
  const img = new Img(128, 128);
  const pal = [[70, 74, 80], [84, 88, 94], [98, 102, 108], [114, 118, 124]];
  const rust = makeNoise(128, 32, 1001);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let v = 0.5 + Math.sin(x * Math.PI / 8) * 0.32;
    v = dither(v, x, y, 0.1);
    let c = pick(pal, v);
    if (rust(x, y) > 0.72) c = [110, 74, 48];
    img.set(x, y, c);
  }
  save('wall_metal.png', img);
}

{ // heavily rusted corrugated metal (end-of-the-line industrial decay)
  const img = new Img(128, 128);
  const pal = [[60, 62, 66], [72, 74, 78], [86, 88, 92]];
  const rust = makeNoise(128, 20, 1005);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let v = 0.5 + Math.sin(x * Math.PI / 8) * 0.3;
    let c = pick(pal, dither(v, x, y, 0.1));
    const r = rust(x, y);
    if (r > 0.74) c = [92, 52, 32];
    else if (r > 0.58) c = [110, 72, 46];
    img.set(x, y, c);
  }
  const rng = mulberry32(1006);
  for (let i = 0; i < 28; i++) { // rust drips bleeding down from seams
    const x = Math.floor(rng() * 128), y0 = Math.floor(rng() * 128), len = 8 + rng() * 28;
    for (let t = 0; t < len; t++) img.set(x + ((t & 2) ? 1 : 0), y0 + t, [102, 62, 38]);
  }
  save('wall_metal_rust_heavy.png', img);
}

function sidingWall(name, pal, seed) {
  // Horizontal clapboard siding: 8 px boards, shadowed lower edges, lit tops.
  const img = new Img(128, 128);
  const n = makeNoise(128, 10, seed);
  const tone = mulberry32(seed + 3);
  const tones = [];
  for (let r = 0; r < 16; r++) tones.push((tone() - 0.5) * 0.18);
  for (let y = 0; y < 128; y++) {
    const row = Math.floor(y / 8);
    for (let x = 0; x < 128; x++) {
      let v = 0.45 + tones[row] + n(x, row * 8) * 0.25;
      if (y % 8 === 7) v = 0.06;
      else if (y % 8 === 0) v = Math.min(0.95, v + 0.16);
      img.set(x, y, pick(pal, dither(v, x, y, 0.12)));
    }
  }
  const rng = mulberry32(seed + 9);
  for (let row = 0; row < 16; row++) { // board-end seams
    const sx = Math.floor(rng() * 128);
    for (let y = row * 8; y < row * 8 + 7; y++) img.set(sx, y, pal[0]);
  }
  save(name, img);
}
sidingWall('wall_siding_blue.png', [[44, 58, 72], [58, 74, 88], [72, 90, 104], [86, 106, 120]], 3001);
sidingWall('wall_siding_green.png', [[46, 64, 44], [60, 80, 54], [74, 96, 66], [90, 112, 78]], 3002);

{ // tan stucco (sun-faded render)
  const img = new Img(128, 128);
  const pal = [[166, 146, 110], [180, 160, 122], [194, 174, 134], [206, 186, 146]];
  noiseFill(img, pal, 3003, { baseCell: 30, ditherAmp: 0.18 });
  const rng = mulberry32(3004);
  for (let i = 0; i < 4; i++) crack(img, rng, [126, 108, 80], 30);
  save('wall_stucco_tan.png', img);
}

brickWall('wall_brick_tan.png',
  [[148, 122, 86], [164, 138, 98], [178, 152, 110], [192, 166, 122]], [166, 156, 140], 3005);

{ // coursed stone blocks (church / civic buildings)
  const img = new Img(128, 128);
  const pal = [[88, 86, 80], [102, 100, 92], [116, 114, 104], [130, 128, 116]];
  const mortar = [64, 62, 58];
  const rng = mulberry32(3006);
  const rowH = 32;
  for (let row = 0; row < 4; row++) {
    let bx = Math.floor(rng() * 24);
    const end = bx + 128;
    while (bx < end) {
      const wdt = 24 + Math.floor(rng() * 20);
      const toneShift = (rng() - 0.5) * 0.3;
      for (let y = 0; y < rowH; y++) for (let i = 0; i < wdt; i++) {
        const px = bx + i, py = row * rowH + y;
        if (y >= rowH - 3 || i >= wdt - 3) { img.set(px, py, mortar); continue; }
        img.set(px, py, pick(pal, dither(0.5 + toneShift + (rng() - 0.5) * 0.08, px, py, 0.18)));
      }
      bx += wdt;
    }
  }
  save('wall_stone.png', img);
}

{ // white marble (mosque-style border walls): ivory tiles, faint veining
  const img = new Img(128, 128);
  const pal = [[212, 208, 196], [224, 220, 208], [234, 230, 219], [243, 240, 230]];
  noiseFill(img, pal, 3101, { baseCell: 34, ditherAmp: 0.1, curve: (v) => 0.35 + v * 0.6 });
  const rng = mulberry32(3102);
  for (let i = 0; i < 5; i++) crack(img, rng, [196, 192, 180], 26); // soft veins
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (x % 32 === 0 || y % 32 === 0) img.set(x, y, [186, 182, 170]); // tile joints
  }
  save('wall_marble.png', img);
}

{ // polished gold (domes, trims, finials): banded metallic shine
  const img = new Img(64, 64);
  const pal = [[122, 84, 26], [164, 116, 34], [204, 152, 44], [236, 190, 64], [250, 220, 116]];
  const n = makeNoise(64, 16, 3103);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let v = 0.55 + Math.sin(y * Math.PI / 16 + n(x, y) * 2.2) * 0.34;
    img.set(x, y, pick(pal, dither(v, x, y, 0.14)));
  }
  const rng = mulberry32(3104);
  for (let i = 0; i < 14; i++) img.set(Math.floor(rng() * 64), Math.floor(rng() * 64), [255, 242, 178]); // glints
  save('gold.png', img);
}

{ // pointed-arch niche panel (one arch per quad, marble field + gold outline)
  const img = new Img(64, 128);
  const pal = [[212, 208, 196], [224, 220, 208], [234, 230, 219], [243, 240, 230]];
  noiseFill(img, pal, 3105, { baseCell: 24, ditherAmp: 0.1, curve: (v) => 0.35 + v * 0.6 });
  img.rectC(0, 0, 64, 3, [176, 172, 160]); img.rectC(0, 125, 64, 3, [176, 172, 160]);
  img.rectC(0, 0, 3, 128, [176, 172, 160]); img.rectC(61, 0, 3, 128, [176, 172, 160]);
  const apexY = 18, springY = 58, halfW = 19, cx = 32;
  const widthAt = (y) => {
    if (y >= springY) return halfW;
    const t = (y - apexY) / (springY - apexY);
    return t <= 0 ? 0 : halfW * Math.sin(t * Math.PI / 2); // pointed ogee-ish curve
  };
  for (let y = apexY; y < 122; y++) {
    const w = widthAt(y);
    for (let x = Math.ceil(cx - w); x <= Math.floor(cx + w); x++) {
      const depth = 0.5 + (y / 128) * 0.3; // recess darkens upward
      const shade = dither(depth, x, y, 0.2);
      img.set(x, y, pick([[26, 30, 40], [34, 40, 52], [44, 52, 66]], 1 - shade));
    }
    // gold arch outline
    for (const s of [-1, 1]) {
      const gx = Math.round(cx + s * w);
      img.set(gx, y, [204, 152, 44]);
      img.set(gx + s, y, [164, 116, 34]);
    }
  }
  img.rectC(cx - halfW - 2, 120, halfW * 2 + 5, 3, [204, 152, 44]); // gold sill
  save('arch_niche.png', img);
}

{ // golden gate screen: vertical bars + rails over darkness
  const img = new Img(64, 64);
  const goldPal = [[164, 116, 34], [204, 152, 44], [236, 190, 64]];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const bar = x % 8 < 3;
    const rail = y % 32 < 3;
    if (bar || rail) {
      let v = 0.5 + Math.sin((bar ? x % 8 : y % 32) * 1.2) * 0.3;
      img.set(x, y, pick(goldPal, dither(v, x, y, 0.16)));
    } else {
      img.set(x, y, dither(0.5, x, y, 0.3) > 0.5 ? [22, 20, 18] : [30, 27, 24]);
    }
  }
  save('gold_screen.png', img);
}

/* ------------------------------------------------------------------ */
/* Doors / windows / roofs / floors                                    */
/* ------------------------------------------------------------------ */

{ // wooden door
  const img = new Img(64, 128);
  const pal = [[58, 40, 26], [70, 48, 30], [84, 58, 36], [96, 68, 42]];
  const n = makeNoise(64, 6, 1101);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    let v = 0.35 + n(Math.floor(x / 12) * 12, y) * 0.5;
    if (x % 12 === 0) v = 0.08;
    img.set(x, y, pick(pal, dither(v, x, y, 0.12)));
  }
  img.rectC(0, 0, 64, 3, [40, 28, 18]); img.rectC(0, 125, 64, 3, [40, 28, 18]);
  img.rectC(0, 0, 3, 128, [40, 28, 18]); img.rectC(61, 0, 3, 128, [40, 28, 18]);
  img.disc(52, 66, 3, [150, 130, 60]); // handle
  save('door_wood.png', img);
}

{ // metal door
  const img = new Img(64, 128);
  const pal = [[64, 68, 74], [76, 80, 86], [88, 92, 98]];
  noiseFill(img, pal, 1102, { baseCell: 24, ditherAmp: 0.12 });
  img.rectC(4, 4, 56, 120, [82, 86, 92]);
  img.rectC(8, 8, 48, 50, [70, 74, 80]);
  img.rectC(8, 66, 48, 54, [70, 74, 80]);
  img.disc(54, 62, 3, [130, 130, 126]);
  for (const y of [6, 122]) for (let x = 8; x < 64; x += 12) img.disc(x, y, 1.2, [52, 56, 62]);
  save('door_metal.png', img);
}

function windowTex(name, broken, seed) {
  const img = new Img(64, 64);
  // frame
  img.rect(0, 0, 64, 64, [52, 42, 32]);
  img.rectC(4, 4, 56, 56, [24, 30, 40]);
  const rng = mulberry32(seed);
  // glass with sky glint
  for (let y = 5; y < 59; y++) for (let x = 5; x < 59; x++) {
    let v = 0.25 + (x + y) / 260;
    img.set(x, y, pick([[28, 36, 50], [36, 46, 62], [46, 58, 76], [58, 72, 90]], dither(v, x, y, 0.15)));
  }
  // mullions
  img.rectC(30, 4, 4, 56, [52, 42, 32]);
  img.rectC(4, 30, 56, 4, [52, 42, 32]);
  if (broken) {
    for (let i = 0; i < 3; i++) crack(img, rng, [12, 14, 18], 26);
    img.disc(18 + rng() * 20, 18 + rng() * 20, 6, [10, 12, 15]);
  }
  save(name, img);
}
windowTex('window.png', false, 1201);
windowTex('window_broken.png', true, 1202);

{ // boarded-up window (derelict outskirts)
  const img = new Img(64, 64);
  img.rect(0, 0, 64, 64, [52, 42, 32]);
  img.rectC(4, 4, 56, 56, [14, 16, 20]);
  const wood = [[90, 66, 40], [104, 78, 48], [118, 90, 56]];
  for (const [y0, slope] of [[10, 0.22], [30, -0.18], [48, 0.2]]) {
    for (let x = 2; x < 62; x++) {
      const yy = Math.round(y0 + (x - 32) * slope);
      for (let t = 0; t < 9; t++) {
        const py = yy + t;
        if (py < 2 || py > 61) continue;
        const shade = t === 0 ? 0.85 : t >= 7 ? 0.15 : 0.5;
        img.set(x, py, pick(wood, dither(shade, x, py, 0.15)));
      }
    }
  }
  for (const [nx, ny] of [[6, 14], [56, 10], [8, 32], [54, 28], [6, 50], [56, 46]]) img.set(nx, ny, [40, 30, 20]);
  save('window_boarded.png', img);
}

{ // wide storefront window with display silhouettes
  const img = new Img(128, 64);
  img.rect(0, 0, 128, 64, [46, 44, 46]);
  for (let y = 3; y < 53; y++) for (let x = 3; x < 125; x++) {
    let v = 0.22 + (x + y * 2) / 420;
    if (((x - y) % 34 + 34) % 34 < 5) v += 0.22; // diagonal glints
    img.set(x, y, pick([[24, 32, 46], [32, 42, 58], [42, 54, 72], [56, 70, 88]], dither(v, x, y, 0.12)));
  }
  for (const [bx, bw, bh] of [[18, 14, 20], [52, 18, 26], [92, 12, 16]]) {
    img.rectC(bx, 53 - bh, bw, bh - 3, [12, 16, 22]); // goods left on display
  }
  img.rectC(0, 53, 128, 11, [58, 54, 50]);            // bulkhead / sill
  img.rectC(62, 3, 4, 50, [46, 44, 46]);              // center mullion
  save('window_shop.png', img);
}

{ // glass commercial door
  const img = new Img(64, 128);
  img.rect(0, 0, 64, 128, [50, 52, 56]);
  for (let y = 6; y < 122; y++) for (let x = 6; x < 58; x++) {
    let v = 0.24 + (x + y) / 300;
    if (((x - y) % 40 + 40) % 40 < 5) v += 0.2;
    img.set(x, y, pick([[24, 32, 46], [32, 42, 58], [44, 56, 74], [58, 72, 90]], dither(v, x, y, 0.12)));
  }
  img.rectC(6, 60, 52, 5, [64, 66, 70]);   // push bar
  img.rectC(6, 102, 52, 20, [40, 42, 46]); // kick plate
  save('door_shop.png', img);
}

{ // shingle roof
  const img = new Img(128, 128);
  const pal = [[52, 40, 40], [64, 50, 48], [76, 60, 56], [88, 70, 64]];
  const rng = mulberry32(1301);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 5; col++) {
      const jitter = (rng() - 0.5) * 0.3;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
        const px = col * 32 + off + x, py = row * 16 + y;
        let v = 0.55 + jitter - (y / 16) * 0.35;
        if (y >= 14 || x >= 30) v = 0.05;
        img.set(px, py, pick(pal, dither(v, px, py, 0.16)));
      }
    }
  }
  save('roof_shingle.png', img);
}

{ // corrugated roof metal
  const img = new Img(128, 128);
  const pal = [[80, 84, 88], [94, 98, 102], [108, 112, 116]];
  const rust = makeNoise(128, 20, 1401);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let v = 0.5 + Math.sin(y * Math.PI / 8) * 0.3;
    let c = pick(pal, dither(v, x, y, 0.1));
    if (rust(x, y) > 0.75) c = [116, 78, 50];
    img.set(x, y, c);
  }
  save('roof_metal.png', img);
}

{ // slate shingle roof (colder palette than the asphalt shingles)
  const img = new Img(128, 128);
  const pal = [[38, 44, 52], [48, 56, 64], [58, 68, 76], [70, 80, 88]];
  const rng = mulberry32(1405);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 5; col++) {
      const jitter = (rng() - 0.5) * 0.3;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
        const px = col * 32 + off + x, py = row * 16 + y;
        let v = 0.55 + jitter - (y / 16) * 0.35;
        if (y >= 14 || x >= 30) v = 0.05;
        img.set(px, py, pick(pal, dither(v, px, py, 0.16)));
      }
    }
  }
  save('roof_slate.png', img);
}

{ // flat tar-and-gravel roof (downtown commercial blocks)
  const img = new Img(128, 128);
  const pal = [[36, 36, 38], [44, 44, 46], [52, 52, 54], [60, 60, 62]];
  noiseFill(img, pal, 1407, { baseCell: 18, ditherAmp: 0.2 });
  const rng = mulberry32(1408);
  for (let i = 0; i < 240; i++) { // gravel flecks
    img.set(Math.floor(rng() * 128), Math.floor(rng() * 128), rng() > 0.5 ? [86, 84, 80] : [72, 70, 66]);
  }
  for (const yy of [22, 86]) { // tar seam lines
    for (let x = 0; x < 128; x++) img.set(x, yy + Math.round(Math.sin(x * 0.196) * 2), [26, 26, 28]);
  }
  save('roof_tar.png', img);
}

{ // wooden floor
  const img = new Img(128, 128);
  const pal = [[92, 66, 40], [106, 78, 48], [120, 90, 56], [134, 102, 64]];
  const n = makeNoise(128, 10, 1501);
  const rng = mulberry32(1502);
  const seams = [];
  for (let row = 0; row < 8; row++) seams.push(Math.floor(rng() * 128));
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const row = Math.floor(y / 16);
    let v = 0.3 + n(x, row * 16) * 0.55;
    if (y % 16 === 0) v = 0.06;
    if ((x + seams[row]) % 128 < 2) v = 0.1;
    img.set(x, y, pick(pal, dither(v, x, y, 0.12)));
  }
  save('floor_wood.png', img);
}

{ // checkered tile
  const img = new Img(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const check = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
    const pal = check
      ? [[170, 166, 156], [182, 178, 168], [194, 190, 180]]
      : [[52, 56, 60], [62, 66, 70], [72, 76, 80]];
    let v = dither(0.5, x, y, 0.3);
    if (x % 32 < 2 || y % 32 < 2) { img.set(x, y, [40, 42, 44]); continue; }
    img.set(x, y, pick(pal, v));
  }
  save('floor_tile.png', img);
}

/* ------------------------------------------------------------------ */
/* Nature                                                              */
/* ------------------------------------------------------------------ */

{ // bark
  const img = new Img(64, 64);
  const pal = [[48, 36, 26], [60, 46, 32], [72, 56, 38], [84, 66, 44]];
  const n = makeNoise(64, 6, 1601);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let v = n(x * 3, y) * 0.9; // vertical streaks
    img.set(x, y, pick(pal, dither(v, x, y, 0.15)));
  }
  save('bark.png', img);
}

function foliage(name, size, greens, density, silhouette, seed) {
  const img = new Img(size, size, [0, 0, 0, 0]);
  const rng = mulberry32(seed);
  const cx = size / 2, cy = size / 2;
  for (let i = 0; i < density; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * silhouette(a) * size * 0.5;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const c = greens[Math.floor(rng() * greens.length)];
    const rad = 1.5 + rng() * (size / 32);
    for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
      if (j * j + k * k <= rad * rad && rng() > 0.25) {
        const px = Math.round(x + k), py = Math.round(y + j);
        if (px >= 0 && py >= 0 && px < size && py < size) img.set(px, py, c);
      }
    }
  }
  img.outline([14, 26, 14, 255]);
  save(name, img);
}

const TREE_GREENS = [[36, 62, 30], [46, 78, 36], [58, 92, 42], [72, 106, 50]];
foliage('leaves.png', 128, TREE_GREENS, 420, (a) => 0.72 + Math.sin(a * 3) * 0.14, 1701);
foliage('bush.png', 64, [[40, 68, 32], [52, 84, 38], [64, 98, 44]], 160, (a) => 0.66 + Math.sin(a * 2 + 1) * 0.1 - Math.max(0, Math.sin(a)) * 0.25, 1702);

{ // grass tuft sprite
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const rng = mulberry32(1801);
  for (let i = 0; i < 26; i++) {
    const bx = 8 + rng() * 48;
    const h = 14 + rng() * 30;
    const lean = (rng() - 0.5) * 12;
    const c = [[58, 96, 42], [72, 110, 50], [88, 124, 60]][Math.floor(rng() * 3)];
    for (let t = 0; t < h; t++) {
      const x = Math.round(bx + lean * (t / h) ** 2);
      img.set(x, 63 - t, c);
      if (t < h * 0.4) img.set(x + 1, 63 - t, c);
    }
  }
  save('grass_tuft.png', img);
}

{ // vine strip (tiles vertically)
  const img = new Img(64, 128, [0, 0, 0, 0]);
  const rng = mulberry32(1901);
  for (let s = 0; s < 3; s++) {
    let x = 12 + s * 20;
    const phase = rng() * 10;
    for (let y = 0; y < 128; y++) {
      const wob = Math.sin((y + phase) * 0.15) * 5;
      const px = Math.round(x + wob);
      img.set(px, y, [42, 66, 34]);
      img.set(px + 1, y, [50, 78, 40]);
      if (y % 9 === Math.floor(phase) % 9) {
        img.disc(px + (rng() > 0.5 ? 3 : -3), y, 2, [58, 92, 42]);
      }
    }
  }
  save('vine.png', img);
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

{ // crate
  const img = new Img(64, 64);
  const pal = [[86, 62, 38], [100, 74, 44], [114, 86, 52]];
  noiseFill(img, pal, 2001, { baseCell: 10, ditherAmp: 0.14 });
  img.rectC(0, 0, 64, 6, [66, 48, 30]); img.rectC(0, 58, 64, 6, [66, 48, 30]);
  img.rectC(0, 0, 6, 64, [66, 48, 30]); img.rectC(58, 0, 6, 64, [66, 48, 30]);
  for (let i = 0; i < 58; i++) { img.set(6 + i, 6 + Math.round(i * 0.9), [70, 50, 32]); img.set(6 + i, 58 - Math.round(i * 0.9), [70, 50, 32]); }
  save('crate.png', img);
}

{ // rusty metal
  const img = new Img(64, 64);
  const pal = [[74, 70, 66], [88, 84, 78], [102, 98, 92]];
  noiseFill(img, pal, 2101, { baseCell: 16, ditherAmp: 0.14 });
  const rust = makeNoise(64, 12, 2102);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (rust(x, y) > 0.66) img.set(x, y, [104, 66, 40]);
  }
  for (const [rx, ry] of [[6, 6], [58, 6], [6, 58], [58, 58]]) img.disc(rx, ry, 2, [56, 54, 50]);
  save('metal_rust.png', img);
}

{ // rubble
  const img = new Img(128, 128);
  const pal = [[70, 66, 60], [84, 80, 72], [98, 94, 86], [112, 108, 98]];
  noiseFill(img, pal, 2201, { baseCell: 8, octaves: 2, ditherAmp: 0.26 });
  const rng = mulberry32(2202);
  for (let i = 0; i < 40; i++) {
    const c = rng() > 0.5 ? [116, 60, 44] : [60, 56, 52]; // brick chunks / shadow
    img.rect(Math.floor(rng() * 128), Math.floor(rng() * 128), 3 + Math.floor(rng() * 5), 2 + Math.floor(rng() * 4), c);
  }
  save('rubble.png', img);
}

{ // rock
  const img = new Img(64, 64);
  const pal = [[78, 76, 74], [92, 90, 86], [106, 104, 98], [120, 118, 110]];
  noiseFill(img, pal, 2301, { baseCell: 14, ditherAmp: 0.2 });
  save('rock.png', img);
}

{ // barricade: hazard stripes over planks
  const img = new Img(128, 128);
  const pal = [[74, 52, 32], [88, 62, 38], [102, 72, 44]];
  noiseFill(img, pal, 2401, { baseCell: 12, ditherAmp: 0.14 });
  for (let y = 24; y < 56; y++) for (let x = 0; x < 128; x++) {
    const s = Math.floor((x + y) / 16) % 2;
    img.set(x, y, s ? pick([[150, 128, 30], [168, 146, 38]], dither(0.5, x, y, 0.3)) : [34, 32, 30]);
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (y % 128 < 3 || y % 128 > 124) img.set(x, y, [52, 38, 24]);
  }
  save('barricade.png', img);
}

{ // manhole cover
  const img = new Img(64, 64, [0, 0, 0, 0]);
  img.disc(32, 32, 28, [46, 46, 48]);
  img.disc(32, 32, 25, [58, 58, 60]);
  for (let r = 5; r < 25; r += 6) {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      img.set(Math.round(32 + Math.cos(a) * r), Math.round(32 + Math.sin(a) * r), [48, 48, 50]);
    }
  }
  save('manhole.png', img);
}

{ // striped canvas awning (shopfronts)
  const img = new Img(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const s = Math.floor(x / 16) % 2;
    const pal = s
      ? [[122, 42, 38], [142, 52, 44], [158, 62, 52]]
      : [[172, 164, 146], [186, 178, 158], [200, 192, 172]];
    img.set(x, y, pick(pal, dither(0.72 - y / 200, x, y, 0.14)));
  }
  for (let x = 15; x < 64; x += 16) for (let y = 0; y < 64; y++) img.set(x, y, [66, 38, 32]);
  save('awning.png', img);
}

{ // graffiti tags decal (transparent)
  const img = new Img(128, 64, [0, 0, 0, 0]);
  const rng = mulberry32(3012);
  const colors = [[186, 60, 48], [70, 140, 170], [190, 170, 60], [96, 170, 84]];
  for (let tag = 0; tag < 4; tag++) {
    const c = colors[tag];
    let x = 12 + rng() * 90, y = 16 + rng() * 26;
    let dir = (rng() - 0.5) * 1.2;
    for (let s = 0; s < 46; s++) {
      for (let t = -1; t <= 1; t++) {
        const px = Math.round(x), py = Math.round(y) + t;
        if (px >= 2 && px <= 125 && py >= 2 && py <= 61) img.set(px, py, [c[0], c[1], c[2], 235]);
      }
      dir += (rng() - 0.5) * 1.4;
      x += Math.cos(dir) * 1.6; y += Math.sin(dir) * 1.1;
      if (y < 8 || y > 56) dir = -dir;
      if (x < 4 || x > 124) break;
    }
  }
  save('graffiti.png', img);
}

{ // oil stain decal (transparent, irregular edge)
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const n = makeNoise(64, 16, 3013);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x - 32, y - 32) / 26 + (n(x, y) - 0.5) * 0.7;
    if (d < 1) {
      const a = dither(1 - d, x, y, 0.3);
      if (a > 0.2) img.set(x, y, [16, 14, 12, Math.min(220, a * 255) | 0]);
    }
  }
  save('oil_stain.png', img);
}

{ // soft dark blob decal (wrong shadows, scorch marks)
  const img = new Img(64, 64, [0, 0, 0, 0]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x - 32, y - 32) / 30;
    if (d < 1) {
      const a = dither(1 - d, x, y, 0.3);
      if (a > 0.25) img.set(x, y, [8, 8, 12, Math.min(255, a * 235) | 0]);
    }
  }
  save('shadow_decal.png', img);
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

{ // muzzle flash: 4-point star
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const star = (x, y) => {
    const dx = x - 32, dy = y - 32;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const spike = Math.abs(Math.cos(a * 2)) ** 6;
    return r < 6 + spike * 24;
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!star(x, y)) continue;
    const r = Math.hypot(x - 32, y - 32);
    img.set(x, y, r < 7 ? [255, 244, 190, 255] : r < 15 ? [252, 208, 90, 235] : [230, 140, 40, 200]);
  }
  save('muzzle_flash.png', img);
}

{ // blood particle
  const img = new Img(16, 16, [0, 0, 0, 0]);
  const rng = mulberry32(2601);
  img.disc(8, 8, 5, [126, 16, 16]);
  img.disc(7, 7, 3, [160, 26, 22]);
  for (let i = 0; i < 8; i++) img.set(2 + Math.floor(rng() * 12), 2 + Math.floor(rng() * 12), [96, 10, 12]);
  save('blood.png', img);
}

{ // smoke/dust puff
  const img = new Img(32, 32, [0, 0, 0, 0]);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x - 16, y - 16) / 14;
    if (d < 1) {
      const a = dither(1 - d, x, y, 0.35);
      if (a > 0.3) img.set(x, y, [150, 144, 134, (a * 200) | 0]);
    }
  }
  save('smoke.png', img);
}

/* ------------------------------------------------------------------ */
/* Pickups                                                             */
/* ------------------------------------------------------------------ */

{ // ammo box (white; tinted per weapon at runtime)
  const img = new Img(32, 32, [0, 0, 0, 0]);
  img.rectC(4, 12, 24, 14, [190, 190, 190]);
  img.rectC(4, 12, 24, 3, [220, 220, 220]);
  img.rectC(4, 23, 24, 3, [140, 140, 140]);
  img.rectC(13, 10, 6, 4, [160, 160, 160]); // handle
  // bullet icons
  for (const bx of [9, 15, 21]) {
    img.rectC(bx, 16, 3, 6, [255, 232, 120]);
    img.rectC(bx, 15, 3, 2, [255, 200, 80]);
  }
  img.outline([30, 30, 30, 255]);
  save('ammo_box.png', img);
}

{ // health pack
  const img = new Img(32, 32, [0, 0, 0, 0]);
  img.rectC(4, 10, 24, 16, [214, 210, 200]);
  img.rectC(4, 10, 24, 3, [235, 232, 224]);
  img.rectC(13, 12, 6, 12, [190, 30, 30]);
  img.rectC(10, 15, 12, 6, [190, 30, 30]);
  img.outline([30, 30, 30, 255]);
  save('health_pack.png', img);
}

{ // key
  const img = new Img(32, 32, [0, 0, 0, 0]);
  img.disc(10, 10, 6, [210, 174, 60]);
  img.disc(10, 10, 3, [0, 0, 0, 0]);
  img.rectC(13, 9, 14, 3, [210, 174, 60]);
  img.rectC(23, 12, 3, 4, [210, 174, 60]);
  img.rectC(19, 12, 2, 3, [210, 174, 60]);
  img.outline([40, 34, 12, 255]);
  save('key.png', img);
}

/* ------------------------------------------------------------------ */
/* (First-person weapon sprites removed.)                              */
/* ------------------------------------------------------------------ */
// Weapons are now real 3D models generated at runtime from primitives and
// procedural PBR materials — see src/weapons/WeaponModels.js and
// src/rendering/WeaponMaterials.js. There is nothing to bake here.

console.log(`Wrote ${files.length} textures to ${OUT_DIR}:`);
for (const f of files) console.log('  ' + f);
