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

/**
 * One tileable grass tile, built the way grass actually reads from above.
 *
 * Value noise over a green palette gives mottled soup — it has no blades in
 * it, so at any distance the eye reads the repeat rather than the ground.
 * These tiles are drawn instead: a soil layer with the field thinning over
 * it, then several hundred short strokes at unbiased angles, tapered, with a
 * lighter tip on some of them. From above a lawn is a dense mat of strokes
 * pointing everywhere, which is also what stops the tile having a grain
 * direction to give the tiling away.
 *
 * Img.set wraps, so a stroke that runs off an edge comes back on the other
 * side and every tile stays seamless.
 *
 * o: { seed, soil[], greens[], tip, cell, blades, len:[min,max], curl,
 *      lay (radians, 0 = no preferred direction), spread, bare, clover,
 *      seeds, straw }
 */
function grassTile(name, size, o) {
  const img = new Img(size, size);
  const rng = mulberry32(o.seed);
  // The base: soil at the dark end of the ramp so wherever the field thins
  // you are looking at ground, not at a darker green.
  noiseFill(img, [...o.soil, ...o.greens], o.seed + 7, {
    baseCell: o.cell ?? 30, octaves: 3, ditherAmp: 0.2, curve: o.curve,
  });
  for (let i = 0; i < (o.bare ?? 0); i++) {           // scrapes worn to the dirt
    img.disc(rng() * size, rng() * size, 1.5 + rng() * 4.5, o.soil[Math.floor(rng() * o.soil.length)]);
  }
  const [lo, hi] = o.len;
  for (let i = 0; i < o.blades; i++) {
    const bx = rng() * size, by = rng() * size;
    const len = lo + rng() * (hi - lo);
    // Unbiased by default; a meadow gets a lay direction and a spread around
    // it, which is what makes long grass read as combed by a wind.
    const a = o.lay === undefined ? rng() * Math.PI * 2
      : o.lay + (rng() - 0.5) * (o.spread ?? 1.2);
    const curl = (rng() - 0.5) * (o.curl ?? 0.9);
    const shade = o.greens[Math.floor(rng() * o.greens.length)];
    const lit = rng() < 0.22;
    for (let t = 0; t <= len; t++) {
      const f = t / len;
      const th = a + curl * f * f;
      const x = Math.round(bx + Math.cos(th) * t);
      const y = Math.round(by + Math.sin(th) * t);
      const c = lit && f > 0.6 ? o.tip : shade;
      img.set(x, y, c);
      if (f < 0.4) img.set(x, y + 1, c);              // thicker at the root
    }
    if (o.seeds && rng() < o.seeds) {                 // seed head on the tip
      const th = a + curl;
      img.disc(bx + Math.cos(th) * len, by + Math.sin(th) * len, 1.2, o.straw ?? o.tip);
    }
  }
  for (let i = 0; i < (o.clover ?? 0); i++) {         // clover: three lobes + a stem
    const cx = rng() * size, cy = rng() * size;
    const c = o.cloverCol ?? [104, 148, 68];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng();
      img.disc(cx + Math.cos(a) * 1.6, cy + Math.sin(a) * 1.6, 1.3, c);
    }
    img.set(Math.round(cx), Math.round(cy), o.soil[0]);
  }
  save(name, img);
}

const GRASS_PX = 256;

{ // grass — the kept lawn. Town verges, gardens, the square. Short, even,
  // still being cut by nobody, with clover coming through it.
  grassTile('grass.png', GRASS_PX, {
    seed: 101, cell: 40, blades: 3400, len: [4, 11], curl: 0.8, bare: 5,
    clover: 90, cloverCol: [110, 156, 72],
    soil: [[44, 48, 26], [52, 60, 30]],
    greens: [[36, 62, 30], [46, 78, 36], [56, 92, 42], [68, 106, 50]],
    tip: [96, 136, 64],
  });
}

{ // grassDry — parched. The farm flats, the industrial fringe, anywhere the
  // ground bakes: olive and straw over pale soil, thinner, with dead stalks.
  grassTile('grass_dry.png', GRASS_PX, {
    seed: 117, cell: 34, blades: 3000, len: [4, 13], curl: 1.1, bare: 20,
    seeds: 0.22, straw: [166, 152, 92],
    soil: [[54, 50, 30], [66, 60, 36]],
    greens: [[70, 76, 36], [84, 88, 42], [100, 100, 50], [118, 112, 60]],
    tip: [146, 136, 78],
  });
}

{ // grassLush — deep, wet, uncut for a year but never dried out. Hollow Park
  // and the pond bank: darker and far more saturated than the town lawn.
  grassTile('grass_lush.png', GRASS_PX, {
    seed: 131, cell: 40, blades: 3400, len: [5, 14], curl: 0.7, bare: 4,
    clover: 150, cloverCol: [96, 150, 62],
    soil: [[24, 30, 16], [32, 40, 22]],
    greens: [[22, 54, 24], [30, 70, 30], [40, 88, 36], [52, 104, 44]],
    tip: [84, 132, 56],
  });
}

{ // grassWild — meadow. Long, unmown, laid over by a wind, going to seed:
  // the rim of the map, the ridge, everything past the last kerb.
  grassTile('grass_wild.png', GRASS_PX, {
    seed: 149, cell: 30, blades: 2200, len: [9, 24], curl: 1.4,
    lay: -0.55, spread: 1.5, bare: 10, seeds: 0.34, straw: [162, 152, 96],
    soil: [[48, 42, 26], [62, 54, 34]],
    greens: [[44, 66, 30], [58, 84, 38], [74, 100, 46], [96, 116, 54], [124, 132, 68]],
    tip: [148, 148, 84],
  });
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

/**
 * A clump of standing grass on a transparent field (the 3D ground cover).
 *
 * Blades are tapered and curved rather than one-pixel lines, and the clump is
 * densest in the middle so it reads as a tuft rather than a comb. Three kinds,
 * matched to the three ground textures they stand on — a tuft of parched straw
 * in a lawn gives the region blend away instantly.
 */
function tuftSprite(name, o) {
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const rng = mulberry32(o.seed);
  for (let i = 0; i < o.blades; i++) {
    const bx = 32 + (rng() - 0.5) * o.spread;
    const h = o.len[0] + rng() * (o.len[1] - o.len[0]);
    const lean = (rng() - 0.5) * o.lean;
    const c = o.greens[Math.floor(rng() * o.greens.length)];
    const lit = rng() < 0.3 ? o.tip : c;
    for (let t = 0; t < h; t++) {
      const f = t / h;
      const x = Math.round(bx + lean * f * f);
      const y = 63 - t;
      const col = f > 0.68 ? lit : c;
      img.rectC(x, y, 1, 1, col);
      if (f < 0.62) img.rectC(x + 1, y, 1, 1, col);   // wider at the root
      if (f < 0.22) img.rectC(x - 1, y, 1, 1, col);
    }
    if (o.seedHead && rng() < o.seedHead) {           // a head gone over
      const x = Math.round(bx + lean), y = 63 - Math.round(h);
      for (let k = 0; k < 4; k++) img.rectC(x + (k & 1), y - k, 1, 1, o.straw);
    }
  }
  save(name, img);
}

// NOTE the palettes run much brighter than the ground tiles they stand on,
// and deliberately: these blades are VERTICAL quads under a Lambert sun that
// is mostly overhead, so they take a fraction of the light the ground does.
// Matched to the ground on paper, a tuft comes out as a black spike punched
// through the lawn. Matched by eye in the engine, it has to start about half
// again as bright.
tuftSprite('grass_tuft.png', {       // kept lawn
  seed: 1801, blades: 42, spread: 40, len: [14, 40], lean: 11,
  greens: [[74, 118, 54], [92, 140, 64], [110, 158, 74]], tip: [140, 188, 96],
});
tuftSprite('grass_tuft_dry.png', {   // parched: shorter, strawy, gone to seed
  seed: 1803, blades: 34, spread: 42, len: [10, 30], lean: 15,
  greens: [[136, 134, 70], [158, 152, 82], [178, 168, 96]], tip: [206, 192, 118],
  seedHead: 0.45, straw: [216, 200, 132],
});
tuftSprite('grass_tuft_wild.png', {  // meadow: tall, laid over, seed heads
  seed: 1805, blades: 48, spread: 46, len: [24, 58], lean: 20,
  greens: [[82, 116, 52], [102, 136, 62], [126, 154, 74], [156, 172, 90]], tip: [196, 196, 116],
  seedHead: 0.5, straw: [214, 200, 130],
});


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

/**
 * Ammunition, drawn as the ammunition it actually is.
 *
 * There used to be ONE ammo box here, tinted four ways at runtime. That is a
 * colour code, not a picture: a shotgun shell and a sniper round are not the
 * same object in two paints, and a player who has to read a tint off a sprite
 * forty metres away is reading a legend rather than looking at the ground. So
 * each type is now drawn from its own real ammunition — a pistol's stripper
 * clip of stubby brass, a shell box with red plastic hulls standing in it, a
 * rifle's curved steel magazine with the top round proud of the lips, and a
 * padded case of long belted sniper cartridges. Silhouette, proportion and
 * palette all differ, so they are told apart by shape first and colour second.
 *
 * All four are 48px so the individual rounds survive nearest-neighbour
 * downscaling on the billboard, and all four carry the same 1px dark outline
 * the rest of the pickups do, which is what keeps them legible against grass.
 */

/** One cartridge standing upright: brass case, a rim at the head, a tip. */
function roundUp(img, x, y, w, h, tipH, brass, brassHi, tip, tipHi) {
  img.rectC(x, y + tipH, w, h - tipH, brass);
  img.rectC(x, y + tipH, 1, h - tipH, brassHi);              // the lit side of the case
  img.rectC(x, y + h - 2, w, 2, tipHi);                      // the extractor rim
  for (let i = 0; i < tipH; i++) {                           // the bullet, tapering
    const inset = Math.round((1 - i / tipH) * (w / 2 - 0.5));
    img.rectC(x + inset, y + i, Math.max(1, w - inset * 2), 1, i < 2 ? tipHi : tip);
  }
}

{ // ammo_pistol — a stripper clip of six stubby 9mm rounds in a card sleeve
  const img = new Img(48, 48, [0, 0, 0, 0]);
  const brass = [176, 138, 52], brassHi = [222, 186, 96];
  const lead = [178, 176, 168], leadHi = [214, 212, 204];
  img.rectC(6, 30, 36, 12, [104, 96, 74]);                   // the card sleeve
  img.rectC(6, 30, 36, 2, [138, 128, 96]);
  img.rectC(6, 40, 36, 2, [72, 66, 50]);
  for (let i = 0; i < 6; i++) roundUp(img, 8 + i * 6, 18, 5, 16, 5, brass, brassHi, lead, leadHi);
  img.rectC(6, 26, 36, 3, [128, 122, 110]);                  // the steel clip across them
  img.rectC(6, 26, 36, 1, [168, 164, 152]);
  img.outline([28, 26, 20, 255]);
  save('ammo_pistol.png', img);
}

{ // ammo_shotgun — four red plastic hulls with brass heads, in an open box
  const img = new Img(48, 48, [0, 0, 0, 0]);
  const hull = [150, 40, 32], hullHi = [196, 66, 52], head = [172, 134, 50], headHi = [220, 182, 92];
  for (let i = 0; i < 4; i++) {
    const x = 8 + i * 8;
    img.rectC(x, 12, 6, 20, hull);                           // the plastic tube
    img.rectC(x, 12, 2, 20, hullHi);
    img.rectC(x + 1, 12, 4, 2, [96, 24, 20]);                // the crimped star fold
    img.rectC(x + 2, 13, 2, 1, hullHi);
    img.rectC(x, 26, 6, 7, head);                            // the brass head
    img.rectC(x, 26, 2, 7, headHi);
    img.rectC(x, 31, 6, 2, [136, 100, 36]);                  // its rim
  }
  img.rectC(5, 30, 38, 12, [128, 108, 74]);                  // the kraft shell box
  img.rectC(5, 30, 38, 2, [162, 140, 100]);
  img.rectC(5, 40, 38, 2, [86, 72, 48]);
  img.rectC(10, 34, 28, 4, [176, 52, 40]);                   // the printed band
  img.outline([28, 22, 18, 255]);
  save('ammo_shotgun.png', img);
}

{ // ammo_rifle — a curved steel box magazine, top round proud of the lips
  const img = new Img(48, 48, [0, 0, 0, 0]);
  const steel = [72, 76, 82], steelHi = [116, 122, 130], steelLo = [40, 44, 50];
  roundUp(img, 20, 5, 6, 13, 5, [176, 138, 52], [222, 186, 96], [178, 176, 168], [214, 212, 204]);
  // The body leans a little further right the lower it goes — a magazine is a
  // section of an arc, and drawn straight it reads as a battery.
  for (let y = 0; y < 26; y++) {
    const lean = Math.round((y / 25) ** 1.6 * 7);
    img.rectC(16 + lean, 17 + y, 12, 1, steel);
    img.rectC(16 + lean, 17 + y, 2, 1, steelHi);             // the lit front edge
    img.rectC(26 + lean, 17 + y, 2, 1, steelLo);
    if (y % 7 === 3) img.rectC(18 + lean, 17 + y, 8, 1, steelLo); // the witness slots
  }
  img.rectC(16, 15, 12, 3, [96, 100, 106]);                  // the feed lips
  img.rectC(16, 15, 12, 1, steelHi);
  img.rectC(23, 41, 12, 3, [56, 60, 66]);                    // the floorplate
  img.outline([22, 24, 28, 255]);
  save('ammo_rifle.png', img);
}

{ // ammo_sniper — long match cartridges seated in a padded olive case
  const img = new Img(48, 48, [0, 0, 0, 0]);
  const brass = [166, 130, 48], brassHi = [214, 178, 88];
  const jacket = [148, 122, 96], jacketHi = [190, 168, 140];
  for (let i = 0; i < 3; i++) roundUp(img, 11 + i * 9, 6, 7, 28, 10, brass, brassHi, jacket, jacketHi);
  img.rectC(6, 28, 36, 14, [78, 84, 58]);                    // the olive-drab case
  img.rectC(6, 28, 36, 2, [104, 112, 78]);
  img.rectC(6, 40, 36, 2, [52, 56, 38]);
  for (let i = 0; i < 3; i++) img.rectC(10 + i * 9, 28, 9, 3, [44, 48, 34]); // the foam cutouts
  img.rectC(8, 34, 32, 3, [120, 128, 92]);                   // the stencil band
  img.rectC(20, 42, 8, 3, [92, 98, 68]);                     // the catch
  img.outline([24, 26, 18, 255]);
  save('ammo_sniper.png', img);
}

/**
 * Tokens: three coins, each as an eight-frame SPIN.
 *
 * A coin lying still on the grass is a disc of colour and reads as litter.
 * What makes a dropped coin catch the eye is that it turns, so each of these
 * is a flipbook laid out left to right along one strip (see COIN_LAYOUT in
 * TextureConfig.js): frame k is the coin rotated k/8 of a turn about its own
 * vertical axis, so the face narrows to an edge and opens out again, with the
 * milled edge slab drawn on whichever side is swinging away from the viewer.
 *
 * The three are told apart by value, so they are told apart by MASS as well as
 * by colour: copper is the small one, silver is a full-width plain disc, and
 * the gold is a broad piece with a stepped inner ring. At sprite scale that
 * difference in outline survives where a difference in hue alone would not.
 */
function coinSheet(name, o) {
  const F = 8, S = 32;                       // eight frames, 32px cells
  const img = new Img(S * F, S, [0, 0, 0, 0]);
  const [dark, mid, lite, hot] = o.pal;
  const R = o.radius, cy = S / 2, thick = o.thick;
  for (let f = 0; f < F; f++) {
    const a = (f / F) * Math.PI * 2;
    const cw = Math.abs(Math.cos(a)) * R;    // half-width of the face this frame
    const cx = f * S + S / 2;
    const edgeDir = Math.sin(a) >= 0 ? 1 : -1;
    // The milled edge first, so the face is drawn over its near side. Its
    // width is the SLAB seen at this angle — nothing face-on, the full
    // thickness edge-on — which is what stops it reading as a bar bolted to
    // the side of the coin at every frame.
    const ew = Math.round(thick * Math.abs(Math.sin(a)));
    for (let dy = -R; dy <= R && ew > 0; dy++) {
      if (Math.abs(dy) > R - 0.5) continue;
      const x0 = cx + edgeDir * cw - (edgeDir > 0 ? 0 : ew);
      for (let t = 0; t < ew; t++) {
        // knurling: every other pixel down the edge catches the light
        img.set(Math.round(x0 + t), Math.round(cy + dy), (dy & 1) ? dark : mid);
      }
    }
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -Math.ceil(cw); dx <= cw; dx++) {
        const u = cw < 0.5 ? 0 : dx / cw, v = dy / R;
        const r2 = u * u + v * v;
        if (r2 > 1) continue;
        // Shading rides the FACE, not the screen: a light from the upper left
        // plus a narrow bright band that sweeps across as the coin turns,
        // which is what sells the spin when the outline alone is nearly
        // symmetric between one frame and the next.
        const lit = -u * 0.6 - v * 0.8;      // > 0 toward the upper left
        let c = mid;
        if (r2 > 0.9) c = dark;                                    // the rim's shadow
        else if (r2 > 0.72) c = lit > -0.2 ? lite : dark;          // the raised rim, bevelled
        else if (o.innerRing && r2 > 0.46 && r2 < 0.58) c = dark;  // the gold's step
        else if (lit > 0.42) c = lite;
        else if (lit < -0.5) c = dark;
        if (Math.abs(u - Math.cos(a) * 0.5) < 0.1 && Math.abs(v) < 0.6) c = hot; // the glint
        // the stamped mark: a cross of raised metal, squashed with the face
        if (o.mark && ((Math.abs(u) < 0.4 && Math.abs(v) < 0.1) || (Math.abs(u) < 0.1 && Math.abs(v) < 0.4))) {
          c = r2 < 0.04 ? hot : dark;
        }
        img.set(Math.round(cx + dx), Math.round(cy + dy), c);
      }
    }
  }
  img.outline(o.line);
  save(name, img);
}

// copper: the common one. Small, dull, and the least of the three.
coinSheet('coin_copper.png', {
  radius: 9, thick: 2, mark: true,
  pal: [[104, 54, 28], [156, 88, 44], [206, 128, 66], [242, 186, 128]],
  line: [38, 20, 12, 255],
});
// silver: a full-width plain piece — no stamp, just a milled rim.
coinSheet('coin_silver.png', {
  radius: 12, thick: 3,
  pal: [[92, 98, 104], [148, 154, 160], [198, 204, 210], [244, 248, 252]],
  line: [30, 34, 38, 255],
});
// gold: the broad one, with a stepped inner ring and a struck mark.
coinSheet('coin_gold.png', {
  radius: 13, thick: 3, mark: true, innerRing: true,
  pal: [[122, 82, 14], [180, 134, 30], [226, 182, 62], [255, 238, 156]],
  line: [46, 30, 8, 255],
});

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

/* ================================================================== */
/* Facade material sets                                                */
/* ================================================================== */
/*
 * Every building draws its surfaces from a *material set* (see
 * src/world/Materials.js): wall, roof, door, window, foundation and trim are
 * chosen together, and no two neighbouring buildings share one. That only
 * reads as variety if the textures themselves are genuinely different, so the
 * families below differ in colour, in module size AND in pixel pattern —
 * courses, boards, panels, blocks — which is what stays legible when a wall is
 * eight pixels tall on screen.
 *
 * Weathered twins (moss, peeling paint, water staining, rot) are generated
 * from the same base so a decayed outskirt building reads as the SAME
 * building material that has been left out in the rain, not as a different
 * house.
 */

/** Overlay helpers shared by the weathered variants. --------------- */

/** Multiply a region of the image toward a colour (grime, damp, shade). */
function tintPixel(img, x, y, color, k) {
  const c = img.get(x, y);
  img.set(x, y, [
    (c[0] + (color[0] - c[0]) * k) | 0,
    (c[1] + (color[1] - c[1]) * k) | 0,
    (c[2] + (color[2] - c[2]) * k) | 0,
  ]);
}

/** Blotchy moss/algae creeping up from the bottom edge. */
function mossOverlay(img, seed, { greens = [[46, 62, 34], [58, 78, 42], [72, 94, 52]], reach = 0.55, bias = 0.5 } = {}) {
  const n = fbm(img.w, seed, 3, 24);
  for (let y = 0; y < img.h; y++) {
    // strongest along the base course, thinning as it climbs
    const climb = 1 - Math.min(1, (img.h - 1 - y) / (img.h * reach));
    for (let x = 0; x < img.w; x++) {
      const v = n(x, y) * 0.75 + climb * 0.45;
      if (v < bias + 0.22) continue;
      const g = greens[Math.min(greens.length - 1, Math.floor((v - bias) * 4))];
      tintPixel(img, x, y, g, Math.min(0.9, (v - bias) * 1.7));
    }
  }
}

/** Vertical water staining bleeding down from sills and parapets. */
function waterStains(img, seed, count = 9, dark = [58, 56, 50]) {
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x0 = Math.floor(rng() * img.w);
    const wdt = 2 + Math.floor(rng() * 5);
    const top = Math.floor(rng() * img.h * 0.4);
    const len = img.h * (0.3 + rng() * 0.6);
    for (let t = 0; t < len; t++) {
      const k = 0.42 * (1 - t / len);
      for (let dx = 0; dx < wdt; dx++) {
        if (((x0 + dx) * 3 + t) % 5 === 0) continue; // dithered edge, not a solid bar
        tintPixel(img, x0 + dx, top + t, dark, k);
      }
    }
  }
}

/** Paint flaking off in ragged patches, exposing grey timber beneath. */
function peelOverlay(img, seed, bare = [[92, 86, 76], [106, 100, 88], [120, 114, 100]]) {
  const rng = mulberry32(seed);
  const n = fbm(img.w, seed + 41, 3, 18);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (n(x, y) < 0.62) continue;
    img.set(x, y, pick(bare, dither(n(x, y) * 1.2 - 0.3, x, y, 0.22)));
  }
  for (let i = 0; i < 26; i++) { // curled edges catch the light
    const x = Math.floor(rng() * img.w), y = Math.floor(rng() * img.h);
    if (n(x, y) < 0.6 || n(x, y) > 0.66) continue;
    img.set(x, y, [212, 206, 192]);
  }
}

/* --- walls: new material families ---------------------------------- */

brickWall('wall_brick_brown.png',
  [[74, 52, 38], [88, 62, 44], [102, 74, 52], [116, 86, 60]], [112, 104, 92], 4101);

{ // whitewashed brick, the paint thinning over the courses
  const img = new Img(128, 128);
  const rng = mulberry32(4103);
  const bw = 32, bh = 16;
  const pal = [[176, 172, 162], [194, 190, 180], [208, 205, 196], [222, 219, 211]];
  for (let row = 0; row < 128 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 128 / bw + 1; col++) {
      const jitter = (rng() - 0.5) * 0.3;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const px = col * bw + off + x, py = row * bh + y;
        if (y >= bh - 2 || x >= bw - 2) { img.set(px, py, [150, 146, 138]); continue; }
        img.set(px, py, pick(pal, dither(0.55 + jitter, px, py, 0.18)));
      }
    }
  }
  // the red brick showing through where the whitewash gave up
  const n = fbm(128, 4104, 3, 20);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (n(x, y) > 0.68) img.set(x, y, pick([[124, 74, 58], [140, 88, 68]], dither(n(x, y), x, y, 0.2)));
  }
  save('wall_brick_painted.png', img);
}

{ // board-formed brutalist concrete: horizontal form lines + tie-rod holes
  const img = new Img(128, 128);
  const pal = [[104, 104, 100], [116, 116, 112], [128, 128, 122], [140, 140, 134]];
  noiseFill(img, pal, 4105, { baseCell: 34, ditherAmp: 0.12 });
  for (let y = 0; y < 128; y++) {
    const inBoard = y % 16;
    if (inBoard === 0) for (let x = 0; x < 128; x++) img.set(x, y, [72, 72, 70]);
    else if (inBoard === 1) for (let x = 0; x < 128; x++) img.set(x, y, [94, 94, 90]);
    else if (inBoard === 15) for (let x = 0; x < 128; x++) img.set(x, y, [150, 150, 144]);
  }
  for (let ty = 8; ty < 128; ty += 32) {
    for (let tx = 16; tx < 128; tx += 32) {
      img.disc(tx, ty, 2, [66, 66, 64]);
      img.disc(tx, ty - 1, 1, [86, 86, 84]);
    }
  }
  save('wall_concrete_brut.png', img);
}

{ // faded salmon stucco (coastal / older commercial strip)
  const img = new Img(128, 128);
  const pal = [[164, 112, 96], [180, 128, 110], [196, 146, 126], [210, 162, 142]];
  noiseFill(img, pal, 4107, { baseCell: 30, ditherAmp: 0.18 });
  const rng = mulberry32(4108);
  for (let i = 0; i < 5; i++) crack(img, rng, [122, 82, 70], 34);
  for (let i = 0; i < 22; i++) img.disc(rng() * 128, rng() * 128, 1 + rng() * 3, [150, 100, 86]); // patched render
  save('wall_stucco_pink.png', img);
}

sidingWall('wall_siding_cream.png', [[142, 132, 106], [162, 152, 124], [182, 172, 142], [202, 192, 162]], 4109);

{ // board-and-batten: VERTICAL boards with raised battens (barn red)
  const img = new Img(128, 128);
  const pal = [[86, 38, 32], [104, 46, 38], [120, 56, 44], [136, 66, 52]];
  const n = makeNoise(128, 12, 4111);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const inBay = x % 24;
    let v = 0.42 + n(Math.floor(x / 24) * 24, y) * 0.34;
    if (inBay < 4) v = inBay === 0 ? 0.08 : inBay === 3 ? 0.2 : 0.95;   // batten strip
    img.set(x, y, pick(pal, dither(v, x, y, 0.14)));
  }
  save('wall_siding_red.png', img);
}

{ // glazed commercial tile: small teal tiles, bright grout, deco storefronts
  const img = new Img(128, 128);
  const pal = [[26, 74, 78], [34, 92, 96], [44, 110, 114], [56, 128, 132]];
  const rng = mulberry32(4113);
  for (let ty = 0; ty < 128; ty += 16) for (let tx = 0; tx < 128; tx += 16) {
    const tone = (rng() - 0.5) * 0.3;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x < 2 || y < 2) { img.set(tx + x, ty + y, [186, 182, 170]); continue; }
      let v = 0.55 + tone - (y / 16) * 0.2 + (x < 4 ? 0.14 : 0); // glaze highlight
      img.set(tx + x, ty + y, pick(pal, dither(v, tx + x, ty + y, 0.14)));
    }
  }
  save('wall_tile_teal.png', img);
}

{ // curtain wall: mullion grid over dark reflective glass (high-rise skin)
  const img = new Img(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let v = 0.2 + ((x % 32) + (y % 32) * 2) / 190;
    if (((x - y) % 46 + 46) % 46 < 6) v += 0.26;  // raking sky reflection
    img.set(x, y, pick([[20, 28, 40], [28, 38, 54], [38, 50, 68], [52, 66, 86]], dither(v, x, y, 0.12)));
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (x % 32 < 3 || y % 32 < 3) img.set(x, y, [96, 100, 106]);        // mullion
    if (x % 32 === 2 || y % 32 === 2) img.set(x, y, [132, 136, 142]);   // lit edge
  }
  const rng = mulberry32(4115);
  for (let i = 0; i < 5; i++) { // a few blown-out panels
    const px = Math.floor(rng() * 4) * 32, py = Math.floor(rng() * 4) * 32;
    for (let y = 4; y < 31; y++) for (let x = 4; x < 31; x++) img.set(px + x, py + y, [12, 14, 18]);
  }
  save('wall_curtain.png', img);
}

{ // concrete block (CMU): big coursed blocks, deep raked joints
  const img = new Img(128, 128);
  const pal = [[118, 116, 110], [130, 128, 122], [142, 140, 132], [152, 150, 142]];
  const rng = mulberry32(4117);
  const bw = 42, bh = 21;
  for (let row = 0; row < Math.ceil(128 / bh); row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 128 / bw + 1; col++) {
      const tone = (rng() - 0.5) * 0.22;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const px = col * bw + off + x, py = row * bh + y;
        if (y >= bh - 3 || x >= bw - 3) { img.set(px, py, [84, 82, 78]); continue; }
        let v = 0.55 + tone + (y < 2 ? 0.18 : 0);
        img.set(px, py, pick(pal, dither(v, px, py, 0.2)));
      }
    }
  }
  save('wall_cinderblock.png', img);
}

{ // half-timbering: pale infill panels framed by dark oak members
  const img = new Img(128, 128);
  const pal = [[176, 168, 148], [190, 182, 162], [202, 195, 176], [214, 208, 190]];
  noiseFill(img, pal, 4119, { baseCell: 24, ditherAmp: 0.16 });
  const beam = [[52, 38, 26], [64, 48, 32], [76, 58, 38]];
  const bn = makeNoise(128, 8, 4120);
  const paintBeam = (x, y) => img.set(x, y, pick(beam, dither(bn(x, y), x, y, 0.2)));
  for (let y = 0; y < 128; y++) {          // posts
    for (const bx of [0, 1, 2, 3, 62, 63, 64, 65, 124, 125, 126, 127]) paintBeam(bx, y);
  }
  for (let x = 0; x < 128; x++) {          // rails
    for (const by of [0, 1, 2, 3, 60, 61, 62, 63, 124, 125, 126, 127]) paintBeam(x, by);
  }
  for (let t = 0; t < 58; t++) {           // diagonal braces in each panel
    for (const [ox, oy] of [[4, 4], [68, 68]]) {
      for (let w = 0; w < 4; w++) { paintBeam(ox + t + w, oy + t); paintBeam(ox + 57 - t + w, oy + t); }
    }
  }
  save('wall_timber_frame.png', img);
}

/* --- walls: weathered twins ---------------------------------------- */

{ // red brick with moss to the sill line and salt bloom above
  const img = new Img(128, 128);
  img.d.set(brickRed.d);
  const rng = mulberry32(4201);
  for (let i = 0; i < 6; i++) crack(img, rng, [42, 22, 18], 44);
  waterStains(img, 4202, 7, [48, 40, 34]);
  mossOverlay(img, 4203, { reach: 0.6, bias: 0.46 });
  save('wall_brick_red_moss.png', img);
}

{ // clapboard with the paint failing off grey timber
  const img = new Img(128, 128);
  const pal = [[44, 58, 72], [58, 74, 88], [72, 90, 104], [86, 106, 120]];
  const n = makeNoise(128, 10, 4205);
  for (let y = 0; y < 128; y++) {
    const row = Math.floor(y / 8);
    for (let x = 0; x < 128; x++) {
      let v = 0.45 + n(x, row * 8) * 0.25;
      if (y % 8 === 7) v = 0.06; else if (y % 8 === 0) v = Math.min(0.95, v + 0.16);
      img.set(x, y, pick(pal, dither(v, x, y, 0.12)));
    }
  }
  peelOverlay(img, 4206);
  waterStains(img, 4207, 6, [40, 42, 44]);
  save('wall_siding_peel.png', img);
}

{ // stucco gone grey with damp, render blown off in patches
  const img = new Img(128, 128);
  const pal = [[150, 138, 112], [164, 152, 124], [176, 164, 136], [188, 176, 148]];
  noiseFill(img, pal, 4209, { baseCell: 30, ditherAmp: 0.18 });
  const rng = mulberry32(4210);
  for (let i = 0; i < 12; i++) crack(img, rng, [104, 92, 74], 46);
  for (let i = 0; i < 6; i++) { // blown render exposing the brick behind
    // ragged patch, not a disc: a short random walk of overlapping blobs
    let cx = rng() * 128, cy = rng() * 128, a = rng() * 6.28;
    for (let s = 0; s < 7; s++) {
      const r = 1.5 + rng() * 2.6;
      img.disc(cx, cy, r, [112, 70, 54]);
      img.disc(cx, cy, r - 1, [130, 84, 64]);
      a += (rng() - 0.5) * 2.2;
      cx += Math.cos(a) * 3; cy += Math.sin(a) * 3;
    }
  }
  waterStains(img, 4211, 12, [72, 68, 56]);
  mossOverlay(img, 4212, { reach: 0.42, bias: 0.52 });
  save('wall_stucco_stained.png', img);
}

{ // concrete panels streaked black under every joint
  const img = new Img(128, 128);
  const pal = [[92, 92, 90], [104, 104, 100], [114, 114, 110], [126, 126, 120]];
  noiseFill(img, pal, 4213, { baseCell: 40, ditherAmp: 0.14 });
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (y % 64 < 2 || x % 64 < 2) img.set(x, y, [58, 58, 56]);
  }
  waterStains(img, 4214, 16, [44, 46, 44]);
  const rng = mulberry32(4215);
  for (let i = 0; i < 7; i++) crack(img, rng, [64, 64, 62], 50);
  for (let i = 0; i < 14; i++) { // spalled patches, rebar rust bleeding out
    const cx = rng() * 128, cy = rng() * 128;
    img.disc(cx, cy, 2 + rng() * 3, [118, 80, 54]);
  }
  mossOverlay(img, 4216, { reach: 0.35, bias: 0.56 });
  save('wall_concrete_stained.png', img);
}

{ // plank wall gone silver-grey, boards sprung and rotted at the foot
  const img = new Img(128, 128);
  const pal = [[70, 62, 50], [86, 78, 64], [102, 94, 78], [118, 110, 94]];
  const n = makeNoise(128, 8, 4217);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const plank = Math.floor(x / 16);
    let v = 0.35 + n(plank * 16, y) * 0.5 + (plank % 3) * 0.06;
    if (x % 16 === 0) v = 0.05; else if (x % 16 === 1) v = 0.2;
    img.set(x, y, pick(pal, dither(v, x, y, 0.16)));
  }
  const rng = mulberry32(4218);
  for (let i = 0; i < 6; i++) { // sprung boards leave black gaps
    const px = Math.floor(rng() * 8) * 16;
    const y0 = Math.floor(rng() * 90);
    for (let y = y0; y < Math.min(128, y0 + 30 + rng() * 40); y++) {
      img.set(px + 1, y, [18, 16, 14]); img.set(px + 2, y, [26, 22, 18]);
    }
  }
  mossOverlay(img, 4219, { reach: 0.7, bias: 0.44, greens: [[52, 58, 36], [64, 72, 44], [78, 88, 52]] });
  save('wall_wood_rot.png', img);
}

{ // block wall furred with moss and salt where the damp wicks up
  const img = new Img(128, 128);
  const pal = [[104, 104, 98], [116, 114, 108], [126, 124, 118], [136, 134, 126]];
  const rng = mulberry32(4221);
  const bw = 42, bh = 21;
  for (let row = 0; row < Math.ceil(128 / bh); row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 128 / bw + 1; col++) {
      const tone = (rng() - 0.5) * 0.24;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const px = col * bw + off + x, py = row * bh + y;
        if (y >= bh - 3 || x >= bw - 3) { img.set(px, py, [74, 74, 70]); continue; }
        img.set(px, py, pick(pal, dither(0.55 + tone, px, py, 0.2)));
      }
    }
  }
  waterStains(img, 4222, 10, [52, 54, 50]);
  mossOverlay(img, 4223, { reach: 0.75, bias: 0.42 });
  save('wall_cinderblock_moss.png', img);
}

/* --- foundations ---------------------------------------------------- */
/* Foundations tile at half the height of a wall texture and read darkest at
 * the ground line, so the eye lands on a real footing rather than a wall that
 * has been pushed into the dirt. */

{ // rubble stone footing: irregular field stones, thick mortar
  const img = new Img(128, 64);
  // Wide tonal spread against near-black mortar: at four pixels tall this has
  // to read as "big rough stones", and only contrast survives that far out.
  const pal = [[70, 66, 58], [92, 88, 78], [114, 110, 98], [136, 132, 118], [158, 154, 138]];
  const mortar = [40, 38, 34];
  img.rect(0, 0, 128, 64, mortar);
  const rng = mulberry32(4301);
  for (let row = 0; row < 4; row++) {
    let bx = Math.floor(rng() * 18);
    while (bx < 128) {
      const wdt = 12 + Math.floor(rng() * 16), hgt = 11 + Math.floor(rng() * 4);
      const tone = (rng() - 0.5) * 0.7;
      const yy = row * 16 + Math.floor(rng() * 3);
      for (let y = 0; y < hgt; y++) for (let x = 0; x < wdt; x++) {
        // rounded shoulders so the stones read as field rubble, not bricks
        if ((x === 0 || x === wdt - 1) && (y === 0 || y === hgt - 1)) continue;
        const lit = y < 2 ? 0.22 : y > hgt - 3 ? -0.2 : 0; // each stone catches the sky on top
        img.set(bx + x, yy + y, pick(pal, dither(0.5 + tone + lit, bx + x, yy + y, 0.22)));
      }
      bx += wdt + 2;
    }
  }
  for (let x = 0; x < 128; x++) for (let y = 58; y < 64; y++) tintPixel(img, x, y, [34, 32, 28], 0.5); // damp course
  save('foundation_stone.png', img);
}

{ // poured concrete footing: form-panel joints, tie holes, a damp tide line
  const img = new Img(128, 64);
  const pal = [[96, 96, 92], [108, 108, 104], [120, 120, 114], [130, 130, 124]];
  noiseFill(img, pal, 4303, { baseCell: 30, ditherAmp: 0.14 });
  for (let x = 0; x < 128; x += 32) for (let y = 0; y < 64; y++) img.set(x, y, [70, 70, 68]);
  for (let x = 0; x < 128; x++) img.set(x, 0, [140, 140, 134]); // top arris catches light
  for (let tx = 16; tx < 128; tx += 32) { img.disc(tx, 22, 2, [64, 64, 62]); img.disc(tx, 46, 2, [64, 64, 62]); }
  const rng = mulberry32(4304);
  for (let i = 0; i < 3; i++) crack(img, rng, [72, 72, 70], 26);
  for (let x = 0; x < 128; x++) {
    const line = 44 + Math.round(Math.sin(x * 0.09) * 3);
    for (let y = line; y < 64; y++) tintPixel(img, x, y, [58, 58, 52], 0.42 * (1 - (y - line) / 26));
  }
  save('foundation_concrete.png', img);
}

{ // dark engineering brick plinth under the older brick buildings
  const img = new Img(128, 64);
  const pal = [[52, 38, 34], [64, 46, 40], [76, 56, 48], [88, 66, 56]];
  const rng = mulberry32(4305);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 5; col++) {
      const tone = (rng() - 0.5) * 0.3;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
        const px = col * 32 + off + x, py = row * 16 + y;
        if (y >= 14 || x >= 30) { img.set(px, py, [92, 86, 78]); continue; }
        img.set(px, py, pick(pal, dither(0.5 + tone, px, py, 0.2)));
      }
    }
  }
  for (let x = 0; x < 128; x++) for (let y = 0; y < 3; y++) img.set(x, y, [110, 104, 94]); // stone cill on top
  mossOverlay(img, 4306, { reach: 0.5, bias: 0.5 });
  save('foundation_brick.png', img);
}

/* --- trim bands ----------------------------------------------------- */
/* Trim tiles are wide and short: they run as belt courses between storeys,
 * as cornices under a parapet, and as sills over shopfronts. */

{ // painted white timber trim with a bead moulding
  const img = new Img(64, 32);
  const pal = [[178, 174, 164], [198, 194, 184], [214, 211, 202], [230, 227, 219]];
  noiseFill(img, pal, 4401, { baseCell: 16, ditherAmp: 0.1, curve: (v) => 0.4 + v * 0.55 });
  img.rectC(0, 0, 64, 3, [236, 233, 226]);
  img.rectC(0, 12, 64, 3, [150, 146, 138]);   // bead shadow
  img.rectC(0, 15, 64, 2, [244, 241, 234]);   // bead highlight
  img.rectC(0, 28, 64, 4, [138, 134, 126]);
  const rng = mulberry32(4402);
  for (let i = 0; i < 10; i++) img.set(Math.floor(rng() * 64), 6 + Math.floor(rng() * 5), [156, 150, 140]);
  save('trim_wood_white.png', img);
}

{ // dressed limestone belt course
  const img = new Img(64, 32);
  const pal = [[142, 138, 124], [158, 154, 140], [172, 168, 152], [186, 182, 166]];
  noiseFill(img, pal, 4403, { baseCell: 18, ditherAmp: 0.12, curve: (v) => 0.35 + v * 0.6 });
  for (let x = 0; x < 64; x += 32) for (let y = 4; y < 28; y++) img.set(x, y, [108, 104, 94]);
  img.rectC(0, 0, 64, 4, [196, 192, 176]);
  img.rectC(0, 27, 64, 5, [102, 98, 88]);
  save('trim_stone.png', img);
}

{ // painted steel channel (industrial / modernist trim)
  const img = new Img(64, 32);
  const pal = [[46, 54, 60], [58, 68, 74], [70, 82, 88], [84, 96, 102]];
  noiseFill(img, pal, 4405, { baseCell: 14, ditherAmp: 0.14 });
  img.rectC(0, 0, 64, 3, [110, 122, 128]);
  img.rectC(0, 29, 64, 3, [30, 36, 40]);
  for (let bx = 6; bx < 64; bx += 16) { img.disc(bx, 16, 2, [26, 30, 34]); img.disc(bx, 15, 1, [120, 132, 138]); }
  const rust = makeNoise(64, 12, 4406);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (rust(x, y) > 0.78) img.set(x, y, [104, 66, 42]);
  save('trim_metal.png', img);
}

{ // glazed deco tile band over the shopfronts
  const img = new Img(64, 32);
  for (let ty = 0; ty < 32; ty += 16) for (let tx = 0; tx < 64; tx += 16) {
    const dark = ((tx / 16) + (ty / 16)) % 2 === 0;
    const pal = dark ? [[28, 78, 62], [36, 96, 76], [46, 114, 90]] : [[176, 154, 84], [196, 174, 100], [214, 192, 116]];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x < 2 || y < 2) { img.set(tx + x, ty + y, [200, 196, 184]); continue; }
      img.set(tx + x, ty + y, pick(pal, dither(0.55 + (x < 5 ? 0.16 : 0) - y / 40, tx + x, ty + y, 0.14)));
    }
  }
  save('trim_tile_green.png', img);
}

/* --- roofs ---------------------------------------------------------- */

{ // barrel clay tile (terracotta): arched pantiles in staggered courses
  const img = new Img(128, 128);
  const pal = [[112, 56, 34], [134, 68, 40], [156, 82, 48], [178, 98, 58], [196, 116, 72]];
  const rng = mulberry32(4501);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 8 : 0;
    for (let col = -1; col < 9; col++) {
      const tone = (rng() - 0.5) * 0.26;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const px = col * 16 + off + x, py = row * 16 + y;
        // barrel cross-section: bright over the crown, black in the valley
        let v = 0.5 + tone + Math.sin((x / 16) * Math.PI) * 0.4 - (y / 16) * 0.22;
        if (x < 1) v = 0.02;
        if (y >= 15) v = 0.06;
        img.set(px, py, pick(pal, dither(v, px, py, 0.16)));
      }
    }
  }
  save('roof_clay.png', img);
}

{ // green asphalt shingle
  const img = new Img(128, 128);
  const pal = [[36, 52, 40], [46, 66, 50], [56, 80, 60], [68, 94, 70]];
  const rng = mulberry32(4503);
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
  save('roof_shingle_green.png', img);
}

{ // shingles under moss and fallen needles (outskirt houses)
  const img = new Img(128, 128);
  const pal = [[46, 40, 36], [58, 50, 44], [68, 60, 52], [80, 70, 60]];
  const rng = mulberry32(4505);
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
  const n = fbm(128, 4506, 3, 22);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = n(x, y);
    if (v > 0.48) tintPixel(img, x, y, [72, 96, 48], Math.min(0.95, (v - 0.48) * 3.4));
  }
  for (let i = 0; i < 8; i++) { // slipped shingles leave bare sarking
    const px = Math.floor(rng() * 4) * 32 + Math.floor(rng() * 16), py = Math.floor(rng() * 8) * 16;
    for (let y = 0; y < 13; y++) for (let x = 0; x < 26; x++) img.set(px + x, py + y, [96, 74, 50]);
  }
  save('roof_shingle_moss.png', img);
}

{ // rusted corrugated roofing (sheds and outbuildings past saving)
  const img = new Img(128, 128);
  const pal = [[64, 60, 56], [78, 72, 66], [92, 84, 76]];
  const rust = makeNoise(128, 16, 4507);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let v = 0.5 + Math.sin(y * Math.PI / 8) * 0.3;
    let c = pick(pal, dither(v, x, y, 0.1));
    const r = rust(x, y);
    if (r > 0.7) c = [126, 76, 44];
    else if (r > 0.55) c = [104, 64, 40];
    img.set(x, y, c);
  }
  const rng = mulberry32(4508);
  for (let i = 0; i < 10; i++) { // rust-through holes down to the dark inside
    img.disc(rng() * 128, rng() * 128, 1 + rng() * 3, [22, 18, 16]);
  }
  save('roof_metal_rust.png', img);
}

{ // single-ply membrane roof: welded seams, ponding water, roof drains
  const img = new Img(128, 128);
  const pal = [[124, 126, 122], [136, 138, 134], [148, 150, 144], [158, 160, 154]];
  noiseFill(img, pal, 4509, { baseCell: 26, ditherAmp: 0.12 });
  for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x++) {
    img.set(x, y, [96, 98, 94]); img.set(x, y + 1, [166, 168, 162]);
  }
  const n = fbm(128, 4510, 2, 34);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (n(x, y) > 0.63) tintPixel(img, x, y, [56, 62, 66], (n(x, y) - 0.63) * 2.2); // standing water
  }
  const rng = mulberry32(4511);
  for (let i = 0; i < 40; i++) img.set(Math.floor(rng() * 128), Math.floor(rng() * 128), [92, 90, 86]);
  save('roof_membrane.png', img);
}

/* --- doors ---------------------------------------------------------- */

/** Six-panel timber door in an arbitrary paint colour. */
function panelDoor(name, pal, seed) {
  const img = new Img(64, 128);
  img.rect(0, 0, 64, 128, pal[0]);
  const n = makeNoise(64, 10, seed);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    img.set(x, y, pick(pal, dither(0.55 + n(x, y) * 0.3, x, y, 0.12)));
  }
  // stiles + rails read as raised frame, panels sunk between them
  for (const [px, py, pw, ph] of [[10, 10, 18, 34], [36, 10, 18, 34], [10, 52, 18, 30], [36, 52, 18, 30], [10, 90, 44, 28]]) {
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const edge = x < 2 || y < 2;
      const lip = x >= pw - 2 || y >= ph - 2;
      const v = edge ? 0.12 : lip ? 0.92 : 0.44 + n(px + x, py + y) * 0.2;
      img.set(px + x, py + y, pick(pal, dither(v, px + x, py + y, 0.1)));
    }
  }
  img.disc(54, 66, 3, [186, 158, 70]);  // knob
  img.disc(54, 65, 2, [222, 198, 108]);
  img.rectC(50, 58, 3, 16, [150, 126, 56]); // escutcheon plate
  save(name, img);
}
panelDoor('door_blue.png', [[28, 48, 74], [38, 62, 92], [48, 78, 112], [62, 94, 132]], 4601);
panelDoor('door_green.png', [[28, 54, 40], [38, 70, 52], [48, 86, 64], [60, 102, 78]], 4602);

{ // steel apartment door with a number plate and a spy hole
  const img = new Img(64, 128);
  const pal = [[62, 60, 62], [74, 72, 74], [86, 84, 86], [96, 94, 96]];
  noiseFill(img, pal, 4603, { baseCell: 20, ditherAmp: 0.12 });
  img.rectC(0, 0, 64, 3, [112, 110, 112]);
  img.rectC(0, 124, 64, 4, [40, 38, 40]);
  img.rectC(4, 4, 56, 120, [70, 68, 70]);
  for (const [py, ph] of [[10, 44], [62, 52]]) {   // shallow pressed panels
    img.rectC(10, py, 44, ph, [80, 78, 80]);
    img.rectC(10, py, 44, 2, [100, 98, 100]);
    img.rectC(10, py + ph - 2, 44, 2, [50, 48, 50]);
  }
  img.rectC(22, 16, 20, 12, [150, 146, 132]);      // number plate
  img.rectC(26, 19, 3, 7, [40, 38, 36]);
  img.rectC(32, 19, 3, 7, [40, 38, 36]);
  img.disc(32, 44, 2, [26, 26, 26]);               // spy hole
  img.rectC(48, 60, 4, 18, [168, 164, 150]);       // lever handle
  save('door_apartment.png', img);
}

{ // roll-up sectional (garage / loading bay)
  const img = new Img(128, 128);
  const pal = [[76, 78, 82], [90, 92, 96], [102, 104, 108], [114, 116, 120]];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const inSlat = y % 16;
    let v = 0.55 - Math.abs(inSlat - 8) / 22;
    if (inSlat === 0) v = 0.06;
    if (inSlat === 15) v = 0.9;
    img.set(x, y, pick(pal, dither(v, x, y, 0.12)));
  }
  const rust = makeNoise(128, 18, 4605);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (rust(x, y) > 0.74) img.set(x, y, [110, 68, 42]);
  for (const gx of [3, 124]) for (let y = 0; y < 128; y++) img.set(gx, y, [50, 52, 56]); // guide rails
  img.rectC(52, 112, 24, 6, [46, 48, 52]);  // lifting handle
  save('door_garage.png', img);
}

{ // office double door: two glazed leaves, push bars, transom above
  const img = new Img(128, 128);
  img.rect(0, 0, 128, 128, [58, 60, 64]);
  for (const ox of [6, 68]) {
    for (let y = 26; y < 118; y++) for (let x = 0; x < 54; x++) {
      let v = 0.24 + (x + y) / 300;
      if (((x - y) % 38 + 38) % 38 < 5) v += 0.22;
      img.set(ox + x, y, pick([[22, 30, 44], [30, 40, 56], [42, 54, 72], [56, 70, 88]], dither(v, ox + x, y, 0.12)));
    }
    img.rectC(ox, 62, 54, 5, [122, 126, 132]);   // push bar
    img.rectC(ox, 104, 54, 14, [46, 48, 52]);    // kick plate
  }
  for (let y = 6; y < 22; y++) for (let x = 6; x < 122; x++) {   // transom light
    img.set(x, y, pick([[34, 46, 62], [44, 58, 76], [56, 72, 92]], dither(0.4 + x / 300, x, y, 0.14)));
  }
  img.rectC(60, 26, 8, 92, [70, 72, 76]);        // meeting stile
  save('door_double_glass.png', img);
}

/* --- windows -------------------------------------------------------- */

{ // curtained residential window — you cannot see in. That is the point.
  const img = new Img(64, 64);
  img.rect(0, 0, 64, 64, [128, 122, 108]);        // painted timber frame
  img.rectC(3, 3, 58, 58, [22, 26, 32]);
  const curtain = [[92, 84, 74], [108, 100, 88], [124, 116, 102], [138, 130, 116]];
  for (let y = 5; y < 59; y++) for (let x = 5; x < 59; x++) {
    // hanging folds: a vertical ripple, darker toward the middle gap
    const fold = Math.sin(x * 0.9) * 0.22 + 0.5 - Math.abs(x - 32) / 150;
    img.set(x, y, pick(curtain, dither(fold, x, y, 0.12)));
  }
  for (let y = 5; y < 59; y++) { img.set(31, y, [40, 36, 30]); img.set(32, y, [52, 46, 38]); } // the gap between them
  img.rectC(5, 5, 54, 3, [66, 60, 52]);           // rail shadow
  img.rectC(29, 3, 5, 58, [128, 122, 108]);       // sash mullion
  img.rectC(3, 29, 58, 5, [128, 122, 108]);
  img.rectC(0, 58, 64, 6, [150, 144, 128]);       // sill
  save('window_curtain.png', img);
}

{ // office glazing: dark tinted panes in an aluminium grid
  const img = new Img(64, 64);
  img.rect(0, 0, 64, 64, [104, 108, 114]);
  for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
    let v = 0.18 + (y * 2 - x) / 380;
    if (((x + y) % 30 + 30) % 30 < 4) v += 0.3;   // ceiling strip lights reflected
    img.set(x, y, pick([[16, 22, 32], [24, 32, 44], [34, 44, 58], [48, 60, 76]], dither(v, x, y, 0.1)));
  }
  for (let i = 0; i < 64; i++) {
    img.set(i, 30, [118, 122, 128]); img.set(i, 31, [86, 90, 96]);
    img.set(30, i, [118, 122, 128]); img.set(31, i, [86, 90, 96]);
  }
  img.rectC(6, 40, 18, 18, [30, 34, 40]);         // a desk still at the glass
  save('window_office.png', img);
}

{ // the one lit window. There is no power in this town.
  const img = new Img(64, 64);
  img.rect(0, 0, 64, 64, [52, 42, 32]);
  const glow = [[128, 108, 62], [166, 142, 80], [198, 174, 104], [226, 204, 138]];
  for (let y = 5; y < 59; y++) for (let x = 5; x < 59; x++) {
    const r = Math.hypot(x - 32, y - 26) / 34;
    img.set(x, y, pick(glow, dither(1 - r * 0.9, x, y, 0.14)));
  }
  img.rectC(29, 4, 5, 56, [52, 42, 32]);
  img.rectC(4, 29, 56, 5, [52, 42, 32]);
  // a shape stands in it, off-centre, facing away
  img.rectC(38, 22, 9, 30, [58, 48, 34]);
  img.disc(42, 20, 4.5, [58, 48, 34]);
  save('window_lit.png', img);
}

{ // arched leaded window for the church and the chapel
  const img = new Img(64, 128);
  img.rect(0, 0, 64, 128, [58, 54, 48]);
  const glass = [[40, 34, 70], [58, 46, 96], [86, 52, 62], [122, 88, 46], [58, 82, 74]];
  const rng = mulberry32(4701);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    // pointed arch head over a rectangular light
    const inArch = y > 40
      ? (x > 5 && x < 59)
      : Math.abs(x - 32) < (y - 6) * 0.62;
    if (!inArch || y < 8 || y > 120) continue;
    const cell = Math.floor(x / 8) + Math.floor(y / 10) * 8;
    img.set(x, y, glass[(cell * 7 + (cell >> 2)) % glass.length]);
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) { // leading
    if (x % 8 === 0 || y % 10 === 0) {
      const c = img.get(x, y);
      if (c[0] !== 58 || c[1] !== 54 || c[2] !== 48) img.set(x, y, [30, 28, 26]);
    }
  }
  for (let i = 0; i < 24; i++) img.set(Math.floor(rng() * 64), Math.floor(rng() * 128), [176, 160, 128]); // glints
  save('window_arched.png', img);
}

/* --- interior surfaces ---------------------------------------------- */

{ // worn hotel/lobby carpet: a repeating figure, trodden bare down the middle
  const img = new Img(128, 128);
  const pal = [[68, 30, 32], [84, 38, 38], [98, 46, 44], [112, 56, 52]];
  noiseFill(img, pal, 4801, { baseCell: 12, ditherAmp: 0.22 });
  const gold = [[112, 94, 52], [134, 114, 64]];
  for (let cy = 0; cy < 128; cy += 32) for (let cx = 0; cx < 128; cx += 32) {
    for (let t = 0; t < 12; t++) { // diamond figure
      for (const [dx, dy] of [[t, 12 - t], [-t, 12 - t], [t, t - 12], [-t, t - 12]]) {
        img.set(cx + 16 + dx, cy + 16 + dy, gold[(t + cx) % 2]);
      }
    }
  }
  const rng = mulberry32(4802);
  for (let i = 0; i < 70; i++) img.disc(rng() * 128, rng() * 128, 1 + rng() * 2, [56, 26, 26]); // stains
  save('carpet_red.png', img);
}

{ // institutional linoleum: speckled sheet with welded seams
  const img = new Img(128, 128);
  const pal = [[142, 140, 128], [156, 154, 142], [168, 166, 154], [180, 178, 166]];
  noiseFill(img, pal, 4803, { baseCell: 8, octaves: 2, ditherAmp: 0.24 });
  const rng = mulberry32(4804);
  for (let i = 0; i < 400; i++) {
    const x = Math.floor(rng() * 128), y = Math.floor(rng() * 128);
    img.set(x, y, rng() > 0.5 ? [108, 108, 98] : [196, 194, 182]);
  }
  for (let y = 0; y < 128; y += 64) for (let x = 0; x < 128; x++) img.set(x, y, [120, 118, 108]);
  for (let i = 0; i < 4; i++) crack(img, rng, [104, 102, 94], 40); // scuffs / gouges
  save('linoleum.png', img);
}

{ // suspended ceiling grid — half the tiles have come down
  const img = new Img(128, 128);
  const pal = [[168, 166, 158], [180, 178, 170], [190, 188, 180], [200, 198, 190]];
  noiseFill(img, pal, 4805, { baseCell: 10, octaves: 2, ditherAmp: 0.2 });
  const rng = mulberry32(4806);
  for (let i = 0; i < 500; i++) img.set(Math.floor(rng() * 128), Math.floor(rng() * 128), [150, 148, 140]); // fissured face
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (x % 64 < 2 || y % 32 < 2) img.set(x, y, [206, 204, 198]);     // tee bars
    if (x % 64 === 2 || y % 32 === 2) img.set(x, y, [126, 124, 118]);
  }
  for (const [px, py] of [[64, 32], [0, 96]]) {  // missing tiles: the dark plenum
    for (let y = 3; y < 30; y++) for (let x = 3; x < 62; x++) img.set(px + x, py + y, [18, 18, 20]);
    for (let x = 6; x < 60; x += 9) for (let y = 5; y < 28; y++) img.set(px + x, py + y, [46, 44, 42]); // joists above
  }
  save('ceiling_tile.png', img);
}

{ // floral wallpaper, seams lifting (the older residential interiors)
  const img = new Img(128, 128);
  const pal = [[132, 122, 100], [148, 138, 114], [162, 152, 126], [174, 164, 138]];
  noiseFill(img, pal, 4807, { baseCell: 26, ditherAmp: 0.1, curve: (v) => 0.4 + v * 0.5 });
  for (let cy = 0; cy < 128; cy += 32) for (let cx = 0; cx < 128; cx += 32) {
    const ox = cx + ((cy / 32) % 2 ? 16 : 0);
    for (let p = 0; p < 5; p++) { // five petals around a centre
      const a = (p / 5) * Math.PI * 2;
      img.disc(ox + 16 + Math.cos(a) * 5, cy + 16 + Math.sin(a) * 5, 3, [150, 108, 112]);
      img.disc(ox + 16 + Math.cos(a) * 5, cy + 16 + Math.sin(a) * 5, 1.5, [172, 132, 134]);
    }
    img.disc(ox + 16, cy + 16, 2.5, [140, 126, 74]);
    img.disc(ox + 16, cy + 24, 1.5, [92, 106, 72]);
  }
  for (let y = 0; y < 128; y++) { // lifting seam every 64 px
    img.set(63, y, [104, 94, 76]); img.set(64, y, [186, 178, 158]);
  }
  const rng = mulberry32(4808);
  for (let i = 0; i < 5; i++) { // damp blooms
    const cx = rng() * 128, cy = rng() * 128;
    for (let r = 8; r > 0; r--) img.disc(cx, cy, r, [124 + r * 3, 112 + r * 3, 88 + r * 2]);
  }
  save('wallpaper_floral.png', img);
}

{ // white wall tile (kitchens, bathrooms, the clinic)
  const img = new Img(128, 128);
  for (let ty = 0; ty < 128; ty += 16) for (let tx = 0; tx < 128; tx += 16) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x < 2 || y < 2) { img.set(tx + x, ty + y, [148, 148, 140]); continue; }
      const v = 0.62 + (x < 5 ? 0.16 : 0) - y / 44;
      img.set(tx + x, ty + y, pick([[186, 188, 182], [204, 206, 200], [220, 222, 216], [234, 236, 230]], dither(v, tx + x, ty + y, 0.1)));
    }
  }
  const rng = mulberry32(4809);
  for (let i = 0; i < 6; i++) { // cracked and missing tiles
    const tx = Math.floor(rng() * 8) * 16, ty = Math.floor(rng() * 8) * 16;
    for (let y = 2; y < 16; y++) for (let x = 2; x < 16; x++) img.set(tx + x, ty + y, [104, 96, 86]);
  }
  waterStains(img, 4810, 5, [128, 130, 118]);
  save('wall_tile_white.png', img);
}

/* --- props ---------------------------------------------------------- */

{ // chain-link fence: a cutout diamond mesh (alpha-tested)
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const wire = [178, 180, 178], dim = [128, 130, 128];
  for (let i = 0; i < 64; i++) {
    for (const [dx, dy] of [[0, 0], [1, 0]]) {
      img.set(i + dx, i + dy, i % 4 < 2 ? wire : dim);
      img.set(i + dx, 63 - i + dy, i % 4 < 2 ? dim : wire);
    }
  }
  for (let k = 16; k < 64; k += 16) { // repeat the diagonals across the tile
    for (let i = 0; i < 64; i++) {
      img.set(i + k, i, i % 4 < 2 ? wire : dim);
      img.set(i + k, 63 - i, i % 4 < 2 ? dim : wire);
    }
  }
  for (let x = 0; x < 64; x++) { img.set(x, 0, wire); img.set(x, 1, dim); } // top rail
  save('chainlink.png', img);
}

{ // hazardous-material drum: yellow body, black hazard band, stencilled label
  const img = new Img(64, 64);
  const pal = [[142, 116, 24], [166, 138, 32], [190, 160, 42], [212, 182, 56]];
  noiseFill(img, pal, 4901, { baseCell: 18, ditherAmp: 0.14 });
  for (const ry of [8, 30, 52]) {   // rolling hoops
    img.rectC(0, ry, 64, 3, [110, 88, 18]);
    img.rectC(0, ry + 3, 64, 1, [226, 200, 84]);
  }
  img.rectC(10, 16, 44, 12, [26, 24, 20]);   // hazard placard
  for (let t = 0; t < 12; t++) { // trefoil-ish mark, readable at four pixels
    img.set(26 + t, 22 - Math.abs(t - 6) / 2 | 0, [206, 180, 60]);
    img.set(26 + t, 22 + Math.abs(t - 6) / 2 | 0, [206, 180, 60]);
  }
  const rust = makeNoise(64, 10, 4902);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (rust(x, y) > 0.76) img.set(x, y, [110, 62, 34]);
  save('barrel_hazard.png', img);
}

{ // stacked shipping pallet, viewed from the side
  const img = new Img(64, 64);
  img.rect(0, 0, 64, 64, [58, 46, 32]);
  const pal = [[104, 82, 52], [120, 96, 62], [136, 110, 72], [150, 124, 84]];
  const n = makeNoise(64, 6, 4903);
  for (const [dy, dh] of [[2, 9], [24, 9], [46, 9]]) {  // deck boards
    for (let y = dy; y < dy + dh; y++) for (let x = 0; x < 64; x++) {
      img.set(x, y, pick(pal, dither(0.5 + n(x, y) * 0.4 - (y - dy) / 26, x, y, 0.14)));
    }
  }
  for (const bx of [2, 28, 54]) for (let y = 11; y < 24; y++) for (let x = 0; x < 8; x++) { // blocks
    img.set(bx + x, y, pick(pal, dither(0.34 + n(bx + x, y) * 0.3, bx + x, y, 0.12)));
  }
  save('pallet.png', img);
}

{ // dead CRT screen — a 4x4 sheet of 16 static FRAMES, played back in code
  //
  // A single noise tile cannot be animated: scrolling it slides the tube mask
  // off the screen and reads as a photograph being dragged, not as static. So
  // this ships as a flipbook — CRTs.forEach draws one complete 64x64 screen,
  // and src/world/World.js steps the shared texture's offset through the grid
  // at ~12 fps, which is exactly how a dead set behaves.
  //
  // Frame 11 is not noise. There is a figure in it, about a quarter-tone above
  // the grain, on screen for one twelfth of a second at a time. You are meant
  // to fail to be sure about it.
  const CELL = 64, GRID = 4;
  const img = new Img(CELL * GRID, CELL * GRID);
  const pal = [[14, 16, 18], [30, 34, 36], [52, 58, 58], [80, 88, 86], [120, 128, 124]];
  for (let f = 0; f < GRID * GRID; f++) {
    const ox = (f % GRID) * CELL, oy = Math.floor(f / GRID) * CELL;
    const rng = mulberry32(4905 + f * 977);
    const roll = (f * 9) % CELL;              // vertical-hold band, drifting down
    for (let y = 0; y < CELL; y++) {
      const dy = Math.min(Math.abs(y - roll), CELL - Math.abs(y - roll));
      const bright = Math.max(0, 1 - dy / 5) * 0.34;
      for (let x = 0; x < CELL; x++) {
        const v = 0.2 + rng() * 0.52 + bright + Math.sin((y + f * 3) * 0.19) * 0.08;
        img.set(ox + x, oy + y, pick(pal, v));
      }
    }
    if (f === 11) {                            // the one that is not static
      for (let y = 14; y < CELL - 4; y++) {
        const half = y < 24 ? 5 : 9 + Math.floor((y - 24) / 9);   // head, then shoulders
        for (let x = -half; x <= half; x++) tintPixel(img, ox + 32 + x, oy + y, [10, 12, 16], 0.3);
      }
    }
    for (let y = f % 2; y < CELL; y += 2) for (let x = 0; x < CELL; x++) {
      tintPixel(img, ox + x, oy + y, [8, 10, 12], 0.35);          // scanlines, interlaced
    }
    for (let x = 6; x < CELL - 6; x++) {                          // tube mask, fixed
      img.set(ox + x, oy + 3, [10, 12, 14]);
      img.set(ox + x, oy + CELL - 4, [10, 12, 14]);
    }
  }
  save('tv_static.png', img);
}

{ // torn public-notice poster (evacuation, quarantine — nobody read it)
  const img = new Img(64, 64, [0, 0, 0, 0]);
  img.rectC(2, 1, 60, 62, [198, 192, 174]);
  img.rectC(2, 1, 60, 12, [148, 36, 30]);           // banner
  for (let i = 0; i < 5; i++) img.rectC(8 + i * 10, 5, 7, 4, [226, 222, 208]); // headline blocks
  for (let r = 0; r < 8; r++) {                      // body copy
    const w = 42 - (r % 3) * 8;
    img.rectC(7, 18 + r * 4, w, 2, [92, 88, 78]);
  }
  img.rectC(16, 50, 32, 10, [56, 54, 48]);           // official seal block
  const rng = mulberry32(4907);
  for (let y = 0; y < 64; y++) {                     // ragged torn right edge
    const tear = 52 + Math.floor(rng() * 12);
    for (let x = tear; x < 64; x++) img.set(x, y, [0, 0, 0, 0]);
  }
  for (let i = 0; i < 30; i++) img.set(Math.floor(rng() * 52), Math.floor(rng() * 64), [168, 160, 142]); // foxing
  save('poster_notice.png', img);
}

{ // painted shop fascia board — legible as "a sign" at any distance
  const img = new Img(128, 32);
  const pal = [[28, 38, 52], [36, 48, 64], [44, 58, 76]];
  noiseFill(img, pal, 4909, { baseCell: 14, ditherAmp: 0.12 });
  img.rectC(0, 0, 128, 3, [92, 104, 116]);
  img.rectC(0, 29, 128, 3, [16, 22, 30]);
  const gold = [212, 184, 96];
  for (let i = 0; i < 7; i++) {                      // word blocks, not letters
    const w = 8 + ((i * 5) % 12);
    img.rectC(10 + i * 16, 11, w, 10, gold);
    img.rectC(10 + i * 16, 11, w, 2, [240, 218, 150]);
  }
  const rng = mulberry32(4910);
  for (let i = 0; i < 40; i++) img.set(Math.floor(rng() * 128), Math.floor(rng() * 32), [70, 78, 88]); // flaked paint
  save('sign_shop.png', img);
}

{ // upholstery: worn brown corduroy weave for couches and armchairs
  const img = new Img(64, 64);
  const pal = [[62, 44, 30], [76, 54, 36], [90, 66, 44], [104, 78, 52]];
  const n = makeNoise(64, 9, 4911);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    // plain weave: warp and weft alternate in 2x2 blocks, so it reads as cloth
    // rather than as boards (a purely vertical rib looks like siding).
    const over = ((x >> 1) + (y >> 1)) & 1;
    const weave = over ? 0.17 : -0.17;
    const slub = ((x * 7 + y * 13) % 11 === 0) ? 0.12 : 0; // nubs in the yarn
    img.set(x, y, pick(pal, dither(0.5 + weave + slub + n(x, y) * 0.22, x, y, 0.16)));
  }
  const rng = mulberry32(4912);
  for (let i = 0; i < 5; i++) { // bald patches at the arms and seat front
    const cx = rng() * 64, cy = rng() * 64;
    for (let r = 5; r > 0; r--) img.disc(cx, cy, r, [96 + r * 2, 76 + r * 2, 56 + r]);
  }
  save('fabric_couch.png', img);
}

{ // the world barrier: ancient dressed-stone rampart, far older than the town
  const img = new Img(128, 128);
  const pal = [[82, 82, 78], [98, 98, 92], [114, 114, 106], [130, 130, 120], [146, 146, 134]];
  const mortar = [58, 58, 55];
  const rng = mulberry32(5001);
  img.rect(0, 0, 128, 128, mortar);
  const rowH = 32;
  for (let row = 0; row < 4; row++) {
    let bx = -Math.floor(rng() * 30);
    while (bx < 128) {
      const wdt = 26 + Math.floor(rng() * 22);
      const tone = (rng() - 0.5) * 0.34;
      for (let y = 0; y < rowH - 3; y++) for (let x = 0; x < wdt - 3; x++) {
        const px = bx + x, py = row * rowH + y;
        // heavy rustication: each block bevels back to its margin
        const bevel = Math.min(x, y, wdt - 4 - x, rowH - 4 - y);
        const lift = bevel < 2 ? (y < 3 ? 0.3 : -0.28) : 0;
        img.set(px, py, pick(pal, dither(0.5 + tone + lift, px, py, 0.2)));
      }
      bx += wdt;
    }
  }
  for (let i = 0; i < 5; i++) crack(img, rng, [50, 50, 46], 60);
  mossOverlay(img, 5002, { reach: 0.9, bias: 0.66, greens: [[62, 74, 50], [76, 90, 58], [92, 106, 68]] });
  save('wall_rampart.png', img);
}

/* ------------------------------------------------------------------ */
/* Eastgate Residential: the suburban material family                  */
/* ------------------------------------------------------------------ */
/*
 * A residential district cannot be dressed out of the commercial texture
 * library. Downtown is brick, render and glass; a street of houses is
 * painted clapboard, cedar shakes, shuttered sashes, block skirting and
 * lattice under the porch — with its own trim colours and its own roofs.
 * Everything below exists so Eastgate reads as a DIFFERENT KIND OF PLACE
 * at a glance, not as downtown with smaller footprints.
 */

/* --- walls ---------------------------------------------------------- */

sidingWall('wall_siding_yellow.png',
  [[128, 112, 62], [150, 132, 76], [172, 154, 92], [194, 176, 110]], 3011);

{ // cedar shake siding: staggered courses of split shingles, silvering off
  const img = new Img(128, 128);
  const pal = [[86, 68, 48], [102, 82, 58], [118, 98, 70], [134, 114, 84], [148, 130, 100]];
  const rng = mulberry32(3012);
  const courseH = 16;
  for (let row = 0; row < 128 / courseH; row++) {
    const off = (row % 2 ? 7 : 0) + Math.floor(rng() * 4);
    let sx = -12;
    while (sx < 128) {
      const wdt = 9 + Math.floor(rng() * 6);
      const tone = (rng() - 0.5) * 0.42;      // every shake weathered its own way
      for (let y = 0; y < courseH; y++) for (let x = 0; x < wdt; x++) {
        const px = sx + off + x, py = row * courseH + y;
        let v = 0.5 + tone + (y / courseH) * 0.18;
        if (x >= wdt - 1) v = 0.05;           // the split between shakes
        else if (y >= courseH - 2) v = 0.1;   // the shadow the course above casts
        else if (y < 2) v = Math.min(0.95, v + 0.2);
        img.set(px, py, pick(pal, dither(v, px, py, 0.16)));
      }
      sx += wdt;
    }
  }
  const grain = makeNoise(128, 5, 3013);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (grain(x * 4, y) > 0.78) tintPixel(img, x, y, [70, 58, 44], 0.3);
  }
  save('wall_shake_cedar.png', img);
  // ...and the same wall after twenty wet winters on its north face
  const worn = new Img(128, 128);
  worn.d.set(img.d);
  waterStains(worn, 3014, 11, [52, 52, 46]);
  mossOverlay(worn, 3015, { reach: 0.8, bias: 0.5, greens: [[52, 66, 40], [66, 82, 48], [82, 98, 58]] });
  save('wall_shake_moss.png', worn);
}

brickWall('wall_brick_clinker.png',
  [[52, 40, 40], [72, 52, 48], [96, 62, 52], [126, 84, 62]], [148, 140, 126], 3016);

/* --- roofs ---------------------------------------------------------- */

{ // brown asphalt shingle: the cheap suburban roof, tabs staggered
  const img = new Img(128, 128);
  const pal = [[56, 42, 30], [70, 54, 38], [84, 66, 46], [98, 80, 56]];
  const rng = mulberry32(3021);
  const rowH = 16, tabW = 24;
  for (let row = 0; row < 128 / rowH; row++) {
    const off = row % 2 ? tabW / 2 : 0;
    for (let x = -tabW; x < 128 + tabW; x++) {
      const tab = Math.floor((x - off) / tabW);
      const tone = (mulberry32(3022 + row * 31 + tab)() - 0.5) * 0.3;
      for (let y = 0; y < rowH; y++) {
        const py = row * rowH + y;
        let v = 0.55 + tone - (y / rowH) * 0.14;
        if (((x - off) % tabW + tabW) % tabW === 0) v = 0.08;   // the slot between tabs
        if (y >= rowH - 3) v = 0.14;                            // course shadow line
        img.set(x, py, pick(pal, dither(v, x, py, 0.16)));
      }
    }
  }
  const grit = mulberry32(3023);
  for (let i = 0; i < 520; i++) {   // mineral grit catching the light
    img.set(Math.floor(grit() * 128), Math.floor(grit() * 128), [116, 98, 74]);
  }
  save('roof_shingle_brown.png', img);
}

{ // split wood shakes: the steep, deep-pitched roof that sheds snow
  const img = new Img(128, 128);
  const pal = [[64, 52, 38], [80, 66, 48], [96, 80, 58], [112, 96, 72]];
  const rng = mulberry32(3024);
  const rowH = 21;
  for (let row = 0; row < Math.ceil(128 / rowH); row++) {
    let sx = -14;
    const off = Math.floor(rng() * 9);
    while (sx < 128) {
      const wdt = 11 + Math.floor(rng() * 8);
      const tone = (rng() - 0.5) * 0.46;
      for (let y = 0; y < rowH; y++) for (let x = 0; x < wdt; x++) {
        const px = sx + off + x, py = row * rowH + y;
        let v = 0.5 + tone + (rng() - 0.5) * 0.05;
        if (x >= wdt - 1) v = 0.04;
        else if (y >= rowH - 3) v = 0.1;
        img.set(px, py, pick(pal, dither(v, px, py, 0.18)));
      }
      sx += wdt;
    }
  }
  save('roof_shake_wood.png', img);
}

/* --- doors ---------------------------------------------------------- */

panelDoor('door_red.png', [[74, 28, 26], [96, 38, 32], [118, 50, 40], [140, 64, 50]], 3031);

{ // screen door: a timber frame over insect mesh, the room behind it dark
  const img = new Img(64, 128);
  img.rect(0, 0, 64, 128, [96, 86, 68]);
  const n = makeNoise(64, 9, 3032);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    img.set(x, y, pick([[78, 68, 52], [92, 82, 64], [106, 96, 76], [120, 110, 88]],
      dither(0.5 + n(x, y) * 0.34, x, y, 0.12)));
  }
  for (const [py, ph] of [[10, 62], [80, 40]]) {   // the two mesh panels
    for (let y = 0; y < ph; y++) for (let x = 0; x < 44; x++) {
      const px = 10 + x, qy = py + y;
      const wire = (px % 2 === 0) || (qy % 2 === 0);
      img.set(px, qy, wire ? [56, 54, 48] : [26, 26, 26]);
    }
    img.rectC(10, py, 44, 1, [58, 50, 38]);
    img.rectC(10, py + ph - 1, 44, 1, [58, 50, 38]);
  }
  img.rectC(0, 0, 64, 3, [58, 50, 38]); img.rectC(0, 125, 64, 3, [58, 50, 38]);
  img.rectC(0, 0, 3, 128, [58, 50, 38]); img.rectC(61, 0, 3, 128, [58, 50, 38]);
  img.rectC(48, 62, 10, 4, [162, 156, 140]);        // sprung pull handle
  const rng = mulberry32(3033);
  for (let i = 0; i < 30; i++) {                    // the mesh has been pushed through
    const x = 18 + Math.floor(rng() * 26), y = 20 + Math.floor(rng() * 40);
    img.set(x, y, [14, 14, 14]); img.set(x + 1, y, [14, 14, 14]);
  }
  save('door_screen.png', img);
}

/* --- windows -------------------------------------------------------- */

{ // shuttered sash: painted timber shutters flanking a curtained pane
  const img = new Img(64, 64);
  img.rect(0, 0, 64, 64, [130, 124, 110]);
  img.rectC(14, 3, 36, 58, [46, 38, 30]);
  for (let y = 5; y < 59; y++) for (let x = 16; x < 48; x++) {   // curtained glass
    const v = 0.3 + (x - 16) / 90 + (y % 9 === 0 ? 0.22 : 0);
    img.set(x, y, pick([[42, 40, 44], [58, 54, 54], [76, 70, 66], [96, 88, 80]], dither(v, x, y, 0.14)));
  }
  img.rectC(30, 5, 3, 54, [58, 50, 40]);            // meeting stile
  img.rectC(16, 30, 32, 3, [58, 50, 40]);           // sash rail
  for (const sx of [1, 51]) {                       // louvred shutters, hung open
    img.rectC(sx, 3, 12, 58, [58, 78, 62]);
    for (let y = 6; y < 58; y += 4) img.rectC(sx + 1, y, 10, 2, [42, 58, 46]);
    img.rectC(sx, 3, 12, 2, [78, 100, 80]);
    img.rectC(sx, 58, 12, 3, [40, 54, 42]);
  }
  img.rectC(12, 58, 40, 4, [150, 144, 130]);        // the sill
  save('window_shutters.png', img);
}

/* --- foundations ---------------------------------------------------- */

{ // concrete block skirting: the crawlspace wall under a timber house
  const img = new Img(128, 64);
  const pal = [[126, 124, 116], [140, 138, 128], [152, 150, 140], [164, 162, 150]];
  const rng = mulberry32(3041);
  const bw = 42, bh = 21;
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const tone = (rng() - 0.5) * 0.26;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const px = col * bw + off + x, py = row * bh + y;
        if (y >= bh - 2 || x >= bw - 2) { img.set(px, py, [104, 102, 96]); continue; }
        img.set(px, py, pick(pal, dither(0.5 + tone, px, py, 0.2)));
      }
    }
  }
  for (let i = 0; i < 3; i++) crack(img, rng, [88, 86, 80], 40);
  mossOverlay(img, 3042, { reach: 0.5, bias: 0.62 });
  save('foundation_block.png', img);
}

{ // porch lattice: crossed timber battens over the dark under-floor
  const img = new Img(128, 64);
  img.rect(0, 0, 128, 64, [22, 20, 18]);
  const slat = [[104, 88, 64], [122, 104, 76], [138, 120, 90]];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const a = ((x + y) % 16 + 16) % 16, b = ((x - y) % 16 + 16) % 16;
    if (a < 4) img.set(x, y, pick(slat, dither(0.7 - a * 0.1, x, y, 0.14)));
    else if (b < 4) img.set(x, y, pick(slat, dither(0.4 - b * 0.06, x, y, 0.14)));
  }
  const rng = mulberry32(3043);
  for (let i = 0; i < 60; i++) {   // weeds and dirt piled against the skirt
    const x = Math.floor(rng() * 128), y = 48 + Math.floor(rng() * 16);
    tintPixel(img, x, y, [46, 58, 34], 0.5 + rng() * 0.4);
  }
  img.rectC(0, 0, 128, 3, [92, 78, 58]);            // the trim board capping it
  save('foundation_lattice.png', img);
}

/* --- trim ----------------------------------------------------------- */

{ // painted green trim board (the second-most common porch colour in town)
  const img = new Img(64, 32);
  const pal = [[36, 56, 42], [46, 70, 52], [56, 84, 62], [68, 98, 74]];
  noiseFill(img, pal, 3051, { baseCell: 12, ditherAmp: 0.14 });
  for (let x = 0; x < 64; x++) { img.set(x, 0, [78, 108, 84]); img.set(x, 31, [26, 42, 32]); }
  const rng = mulberry32(3052);
  for (let i = 0; i < 22; i++) {   // paint gone at the corners, bare wood under
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 32);
    img.set(x, y, [116, 100, 74]);
  }
  save('trim_wood_green.png', img);
}

/* --- nature: the residential planting palette ----------------------- */

// A clipped boundary hedge: denser, flatter and darker than a wild bush, so a
// property line reads as a property line rather than as scrub.
foliage('hedge.png', 64, [[28, 52, 26], [36, 64, 30], [44, 76, 36], [54, 88, 42]], 260,
  (a) => 0.9 - Math.max(0, Math.sin(a)) * 0.06, 3061);

{ // garden flowers: a low mound of leaf with colour scattered through it
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const rng = mulberry32(3062);
  const greens = [[42, 72, 34], [54, 88, 40], [66, 102, 48]];
  for (let i = 0; i < 150; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 26 * (0.7 - Math.max(0, Math.sin(a)) * 0.34);
    const x = Math.round(32 + Math.cos(a) * r), y = Math.round(44 + Math.sin(a) * r * 0.9);
    const rad = 2 + rng() * 2;
    for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
      if (j * j + k * k > rad * rad || rng() < 0.3) continue;
      const px = Math.round(x + k), py = Math.round(y + j);
      if (px >= 0 && py >= 4 && px < 64 && py < 64) img.set(px, py, greens[Math.floor(rng() * 3)]);
    }
  }
  const blooms = [[178, 62, 66], [196, 152, 62], [156, 106, 174], [206, 198, 188]];
  for (let i = 0; i < 34; i++) {   // heads, still open, months after anyone watered them
    const x = 8 + Math.floor(rng() * 48), y = 12 + Math.floor(rng() * 34);
    if (img.get(x, y)[3] === 0) continue;
    const c = blooms[Math.floor(rng() * blooms.length)];
    img.disc(x, y, 1.6, c);
    img.set(x, y - 1, [c[0] + 24 > 255 ? 255 : c[0] + 24, c[1] + 24, c[2] + 24]);
  }
  img.outline([16, 28, 16, 255]);
  save('flowers.png', img);
}

{ // dry ragged weeds — what comes up through a pavement crack, not lawn
  //
  // Stalks are drawn TWO pixels wide, not one, and that is the whole reason
  // these read as plants. img.outline puts a dark rim on every opaque pixel;
  // on a one-pixel stalk the rim IS the stalk, so a sprite whose palette runs
  // olive-to-straw came out as a black spike stuck in the lawn. At two pixels
  // the outline is an edge again and the colour survives it.
  //
  // The palette also runs brighter than it reads on paper, for the same reason
  // the grass tufts do: these are vertical quads under a mostly overhead sun.
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const rng = mulberry32(3063);
  const pal = [[136, 140, 74], [158, 160, 86], [178, 176, 100], [196, 190, 126]];
  for (let s = 0; s < 22; s++) {
    const x0 = 7 + rng() * 50, h = 22 + rng() * 34;
    const lean = (rng() - 0.5) * 0.9;
    const c = pal[Math.floor(rng() * pal.length)];
    for (let t = 0; t < h; t++) {
      const f = t / h;
      const x = Math.round(x0 + lean * t * f);
      const y = 63 - t;
      const head = f > 0.86;
      const col = head ? [214, 204, 152] : c;
      img.rectC(x, y, 2, 1, col);
      if (f < 0.4) img.rectC(x - 1, y, 1, 1, col);              // thicker at the root
      if (head) img.rectC(x - 1, y, 4, 1, col);                 // seed head gone over
    }
  }
  img.outline([38, 40, 24, 255]);
  save('weeds.png', img);
}

{ // ivy: a dense creeper mat for a north-facing wall, leaves overlapping
  const img = new Img(64, 128, [0, 0, 0, 0]);
  const rng = mulberry32(3064);
  const greens = [[24, 48, 26], [32, 62, 32], [42, 76, 38], [54, 92, 46]];
  for (let v = 0; v < 6; v++) {   // the runners first, climbing and branching
    let x = 6 + rng() * 52, y = 127;
    const drift = (rng() - 0.5) * 0.6;
    while (y > 4) {
      img.set(Math.round(x), y, [56, 44, 30]);
      x += drift + (rng() - 0.5) * 0.8;
      y -= 1;
      if (x < 2) x = 2; if (x > 61) x = 61;
    }
  }
  for (let i = 0; i < 420; i++) {   // then the leaf mass, thickest at the foot
    const y = Math.round(127 - Math.pow(rng(), 0.62) * 124);
    const x = Math.round(2 + rng() * 60);
    const rad = 1.5 + rng() * 2.2;
    const c = greens[Math.floor(rng() * greens.length)];
    for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
      if (j * j + k * k > rad * rad || rng() < 0.22) continue;
      const px = Math.round(x + k), py = Math.round(y + j);
      if (px >= 0 && py >= 0 && px < 64 && py < 128) img.set(px, py, c);
    }
  }
  img.outline([12, 22, 14, 255]);
  save('ivy.png', img);
}

/* --- residential props ---------------------------------------------- */

{ // White picket fence: a CUTOUT, so you can see the garden through it. The
  // panel maps this once over its height, which is what lets the pickets have
  // pointed tops and lets the two rails sit at real heights.
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const pal = [[150, 146, 134], [176, 172, 160], [196, 192, 180], [214, 210, 198]];
  const rng = mulberry32(3071);
  const pitch = 16, wdt = 10;
  for (let p = 0; p < 4; p++) {
    const x0 = p * pitch + 2;
    const tone = (rng() - 0.5) * 0.3;
    const tip = 8 + Math.floor(rng() * 3);          // the point at the top
    for (let y = 2; y < 64; y++) for (let x = 0; x < wdt; x++) {
      // the picket narrows to a point over its top `tip` pixels
      const inset = y < 2 + tip ? Math.round((1 - (y - 2) / tip) * (wdt / 2)) : 0;
      if (x < inset || x >= wdt - inset) continue;
      let v = 0.55 + tone;
      if (x === 0 || x === wdt - 1) v = 0.18;       // shadowed edges give it depth
      img.set(x0 + x, y, pick(pal, dither(v, x0 + x, y, 0.14)));
    }
  }
  for (const [ry, rh] of [[20, 5], [46, 5]]) {      // the two rails behind them
    for (let y = ry; y < ry + rh; y++) for (let x = 0; x < 64; x++) {
      if (img.get(x, y)[3] > 0) continue;           // pickets stay in front
      img.set(x, y, pick(pal, dither(0.34, x, y, 0.12)));
    }
  }
  for (let i = 0; i < 70; i++) {                    // paint flaking to grey timber
    const x = Math.floor(rng() * 64), y = 4 + Math.floor(rng() * 58);
    if (img.get(x, y)[3] === 0) continue;
    img.set(x, y, [122, 114, 100]);
  }
  save('fence_picket.png', img);
}

{ // blue polythene tarpaulin, taut over whatever nobody came back for
  const img = new Img(64, 64);
  const pal = [[28, 54, 86], [38, 70, 108], [48, 86, 128], [62, 104, 148]];
  noiseFill(img, pal, 3073, { baseCell: 16, ditherAmp: 0.16 });
  const rng = mulberry32(3074);
  for (let i = 0; i < 9; i++) {        // creases catching the light
    let x = rng() * 64, y = rng() * 64;
    const dir = rng() * Math.PI * 2;
    for (let t = 0; t < 50; t++) {
      img.set(Math.round(x), Math.round(y), [86, 130, 172]);
      img.set(Math.round(x), Math.round(y) + 1, [22, 42, 68]);
      x += Math.cos(dir) + (rng() - 0.5) * 0.4;
      y += Math.sin(dir) + (rng() - 0.5) * 0.4;
    }
  }
  for (const [ex, ey] of [[3, 3], [60, 3], [3, 60], [60, 60]]) img.disc(ex, ey, 2, [150, 150, 146]); // eyelets
  save('tarp_blue.png', img);
}

{ // hopscotch chalked on a pavement. Ten squares. Count them.
  const img = new Img(64, 64, [0, 0, 0, 0]);
  const chalk = [232, 226, 210, 220];
  const line = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * (i / n)), y = Math.round(y0 + (y1 - y0) * (i / n));
      if ((x * 7 + y * 3) % 5 === 0) continue;   // chalk skips on rough concrete
      img.set(x, y, chalk);
    }
  };
  let y = 60;
  for (const pair of [0, 0, 1, 0, 1, 0]) {       // singles and doubles up the court
    const h = 9;
    if (pair) {
      line(10, y, 31, y); line(10, y - h, 31, y - h); line(10, y, 10, y - h);
      line(31, y, 31, y - h); line(21, y, 21, y - h);
      line(31, y, 53, y); line(31, y - h, 53, y - h); line(53, y, 53, y - h);
    } else {
      line(21, y, 42, y); line(21, y - h, 42, y - h);
      line(21, y, 21, y - h); line(42, y, 42, y - h);
    }
    y -= h;
  }
  save('chalk_hopscotch.png', img);
}

/* --- the vendor, and the gun it sells ------------------------------- */

{ // The vendor's lacquered enamel casing: a fairground machine's paintwork,
  // deep oxblood over steel, crazed where a century of weather got into it.
  const img = new Img(64, 64);
  const pal = [[58, 22, 24], [82, 30, 30], [104, 38, 36], [126, 48, 42]];
  noiseFill(img, pal, 5101, { baseCell: 22, ditherAmp: 0.1 });
  const rng = mulberry32(5102);
  for (let i = 0; i < 26; i++) crack(img, rng, [44, 18, 18], 18);  // crazing in the lacquer
  for (let i = 0; i < 30; i++) {                                   // chips down to primer
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 64);
    img.disc(x, y, 0.6 + rng() * 1.6, rng() < 0.5 ? [138, 126, 108] : [70, 62, 54]);
  }
  for (let x = 0; x < 64; x++) {                                   // the bead moulding
    img.set(x, 2, [156, 74, 62]); img.set(x, 3, [40, 16, 16]);
    img.set(x, 60, [156, 74, 62]); img.set(x, 61, [40, 16, 16]);
  }
  save('vendor_enamel.png', img);
}

{ // Polished brass for the vendor's fittings — the bezels, the coin throat,
  // the armature collars. Wiped bright on the faces people touch, dull in the
  // corners nobody has reached since it was installed.
  const img = new Img(64, 64);
  const pal = [[104, 76, 22], [148, 114, 36], [190, 154, 58], [226, 196, 108]];
  noiseFill(img, pal, 5104, { baseCell: 12, ditherAmp: 0.18 });
  const rng = mulberry32(5105);
  for (let i = 0; i < 90; i++) {                                   // the polishing grain
    const y = Math.floor(rng() * 64), len = 8 + rng() * 26, x0 = rng() * 64;
    const c = rng() < 0.5 ? [214, 182, 96] : [116, 88, 30];
    for (let t = 0; t < len; t++) img.set(Math.round(x0 + t), y, c);
  }
  for (let i = 0; i < 22; i++) img.disc(rng() * 64, rng() * 64, 0.8 + rng() * 1.4, [86, 66, 26]); // verdigris pitting
  save('vendor_brass.png', img);
}

{ // The trade sign that hangs off the kiosk: a coin struck on a board. Word
  // blocks rather than letters, the same way the shop fascia does it.
  const img = new Img(64, 32, [0, 0, 0, 0]);
  const pal = [[46, 34, 22], [58, 44, 28], [70, 54, 34]];
  noiseFill(img, pal, 5107, { baseCell: 10, ditherAmp: 0.14 });
  img.rectC(0, 0, 64, 2, [96, 76, 48]);
  img.rectC(0, 30, 64, 2, [26, 20, 12]);
  img.disc(13, 16, 8, [122, 90, 20]);                              // the struck coin
  img.disc(13, 16, 6, [200, 162, 58]);
  img.disc(13, 16, 3, [122, 90, 20]);
  img.disc(11, 14, 1.6, [246, 226, 150]);                          // its highlight
  for (const [wx, w] of [[26, 9], [38, 6], [47, 12]]) {            // the trade name
    img.rectC(wx, 12, w, 8, [204, 178, 104]);
    img.rectC(wx, 12, w, 2, [238, 220, 158]);
  }
  const rng = mulberry32(5108);
  for (let i = 0; i < 34; i++) img.set(Math.floor(rng() * 64), Math.floor(rng() * 32), [88, 70, 44]);
  save('sign_tokens.png', img);
}

{ // The sentry's armour: depot olive-drab over sheet steel, stencilled and
  // chipped back to bare metal on every edge a hand ever grabbed.
  const img = new Img(64, 64);
  const pal = [[46, 52, 34], [58, 66, 42], [70, 78, 50], [84, 92, 60]];
  noiseFill(img, pal, 5110, { baseCell: 20, ditherAmp: 0.12 });
  const rng = mulberry32(5111);
  for (const y of [10, 52]) {                                      // rolled panel seams
    for (let x = 0; x < 64; x++) { img.set(x, y, [34, 38, 24]); img.set(x, y + 1, [96, 104, 70]); }
  }
  for (const [rx, ry] of [[8, 6], [56, 6], [8, 57], [56, 57], [32, 6], [32, 57]]) {
    img.disc(rx, ry, 2, [40, 44, 30]);                             // fixing rivets
    img.disc(rx, ry - 0.5, 1.2, [110, 116, 84]);
  }
  for (let i = 0; i < 5; i++) {                                    // the stencilled block
    img.rectC(10 + i * 9, 26, 6, 11, [26, 30, 20]);
    img.rectC(11 + i * 9, 28, 4, 7, [82, 90, 58]);
  }
  for (let i = 0; i < 44; i++) {                                   // paint off, bare steel under
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 64);
    img.disc(x, y, 0.5 + rng() * 1.5, [126, 130, 122]);
  }
  save('sentry_plate.png', img);
}

console.log(`Wrote ${files.length} textures to ${OUT_DIR}:`);
for (const f of files) console.log('  ' + f);
