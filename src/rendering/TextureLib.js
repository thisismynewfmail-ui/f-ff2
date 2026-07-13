import * as THREE from '../../lib/three.module.js';
import { TEXTURES, SPRITES, TEXTURE_DIR, SPRITE_DIR } from './TextureConfig.js';

/**
 * Loads every texture named in TextureConfig and prepares it for the retro
 * pipeline: nearest-neighbour filtering, no mipmap blur, repeat wrapping.
 *
 * Sprite sheets ship as RGB on a white background, so they are keyed at load
 * time: a flood fill from the image border removes only the connected white
 * region, keeping interior whites (hair bows, teeth) intact.
 */
export class TextureLib {
  constructor() {
    this.textures = new Map();
    this.images = new Map();
  }

  async loadAll(onProgress) {
    const jobs = [];
    const total = Object.keys(TEXTURES).length + Object.keys(SPRITES).length;
    let done = 0;
    const tick = () => onProgress?.(++done / total);

    for (const [name, file] of Object.entries(TEXTURES)) {
      jobs.push(loadImage(TEXTURE_DIR + file).then((img) => {
        this.images.set(name, img);
        this.textures.set(name, makeTexture(img));
        tick();
      }));
    }
    for (const [name, file] of Object.entries(SPRITES)) {
      jobs.push(loadImage(SPRITE_DIR + file).then((img) => {
        const keyed = keyOutBackground(img);
        this.images.set(name, keyed);
        this.textures.set(name, makeTexture(keyed));
        tick();
      }));
    }
    await Promise.all(jobs);
  }

  /** Get the shared texture for a logical name from TextureConfig. */
  get(name) {
    const t = this.textures.get(name);
    if (!t) throw new Error(`Unknown texture "${name}" — add it to TextureConfig.js`);
    return t;
  }

  /** Source canvas/image for a logical name (post-keying for sprites). */
  image(name) {
    const img = this.images.get(name);
    if (!img) throw new Error(`Unknown image "${name}"`);
    return img;
  }

  /** Independent texture with its own repeat settings. */
  tiled(name, rx, ry) {
    const t = this.get(name).clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  }

  /**
   * Tinted copy of a keyed sprite/texture. `mode`:
   *  - 'multiply': channel-wise multiply (colored ammo boxes)
   *  - 'sprinter': shift toward feverish red
   *  - 'tank': darker, sickly green, higher contrast
   *  - 'gray': desaturate (mannequin)
   */
  tinted(name, mode, factors = [1, 1, 1]) {
    const src = this.image(name);
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (mode === 'multiply') {
        r *= factors[0]; g *= factors[1]; b *= factors[2];
      } else if (mode === 'sprinter') {
        r = r * 1.25 + 24; g *= 0.72; b *= 0.68;
      } else if (mode === 'tank') {
        r *= 0.62; g = g * 0.82 + 10; b *= 0.6;
      } else if (mode === 'gray') {
        const l = r * 0.3 + g * 0.59 + b * 0.11;
        r = g = b = l * 0.85;
      }
      d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b);
    }
    ctx.putImageData(data, 0, 0);
    return makeTexture(c);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function makeTexture(img) {
  const t = new THREE.Texture(img);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Remove the background of a white-backdrop sprite sheet.
 *
 * Flood fills from every border pixel across near-white pixels and clears
 * only that connected region, so interior white details survive. Then erodes
 * the antialiased near-white *fringe* the flood leaves behind — otherwise a
 * ring of half-white edge pixels stays opaque and reads as a white halo
 * around every sprite (which it did). Erosion only touches bright, desaturated
 * pixels on the silhouette edge, so grey skin and interior whites are safe.
 */
function keyOutBackground(img, threshold = 232) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const w = c.width, h = c.height;
  const isBg = (i) => d[i] >= threshold && d[i + 1] >= threshold && d[i + 2] >= threshold;

  const visited = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (visited[p]) continue;
    visited[p] = 1;
    if (!isBg(p * 4)) continue;
    d[p * 4 + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  erodeWhiteFringe(d, w, h);
  ctx.putImageData(data, 0, 0);
  return c;
}

/**
 * Clear the bright, near-white fringe pixels left along a keyed silhouette.
 * A pixel is eroded only if it is (a) still opaque, (b) near-white/desaturated
 * (every channel high), and (c) touching a transparent pixel. Two passes peel
 * the 1–2px antialiased halo without eating the sprite body.
 */
function erodeWhiteFringe(d, w, h, passes = 2, lightMin = 176) {
  const n = w * h;
  for (let pass = 0; pass < passes; pass++) {
    const alpha0 = new Uint8Array(n);
    for (let p = 0; p < n; p++) alpha0[p] = d[p * 4 + 3];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (alpha0[p] === 0) continue;
        const i = p * 4;
        if (Math.min(d[i], d[i + 1], d[i + 2]) < lightMin) continue; // grey/coloured body: keep
        const edge = (x > 0 && alpha0[p - 1] === 0) || (x < w - 1 && alpha0[p + 1] === 0)
          || (y > 0 && alpha0[p - w] === 0) || (y < h - 1 && alpha0[p + w] === 0);
        if (edge) d[i + 3] = 0;
      }
    }
  }
}
