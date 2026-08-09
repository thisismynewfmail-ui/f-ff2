import * as THREE from '../../lib/three.module.js';
import { TEXTURES, SPRITES, TEXTURE_DIR, SPRITE_DIR } from './TextureConfig.js';
import { assetUrl } from './assetUrl.js';

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
    // Cache-bust so an edited PNG on disk is actually re-fetched on reload
    // instead of served stale from the browser cache.
    img.src = assetUrl(url);
  });
}

/**
 * Wrap a source image/canvas as a retro texture. Resolution-independent: the
 * source may be any power-of-two size (16 up to 512x512 and beyond) — nothing
 * here or downstream assumes a fixed pixel size, so dropping a 512x512
 * grass.png in place of the 128x128 one tiles seamlessly with zero code
 * changes. Tiling relies on RepeatWrapping, which every power-of-two size
 * supports.
 */
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
 * only that connected region, so interior white details survive. Then undoes
 * the white matte on the antialiased fringe the flood leaves behind — see
 * unmatteFringe, which is what stops every sprite wearing a light halo.
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

  unmatteFringe(d, w, h, [255, 255, 255]);
  ctx.putImageData(data, 0, 0);
  return c;
}

/**
 * Undo the background matte along a keyed silhouette.
 *
 * These sheets are RGB art composited over a flat backdrop K, so every edge
 * texel is a blend of the art and that backdrop: c = a*S + (1-a)*K, for some
 * coverage a and the art's true colour S. The flood fill removes what is close
 * enough to K to read as pure background, which leaves the tail of that blend
 * behind — texels carrying real coverage but a colour washed toward K. Drawn
 * against anything else they are a rim of the WRONG COLOUR around the whole
 * sprite: a light halo on the white-backed sheets, and a pale green-lit outline
 * on the green-screened HUD portraits (see rendering/Portrait.js), which is the
 * same defect wearing a different colour.
 *
 * Eroding them does not work, and neither does any brightness threshold. The
 * fringe's colour depends entirely on what the art is blending INTO: white over
 * pale skin lands near 240 and white over dark hair lands near 150, so a floor
 * high enough to spare the skin leaves the hair haloed, and one low enough to
 * catch the hair eats the skin. Judging a texel against its neighbours fails
 * too, because in a two-or-three-texel ramp a fringe texel's neighbours are
 * mostly more fringe.
 *
 * So solve the blend instead of guessing at it:
 *   1. peel `rim` layers inward to separate rim texels from solid core art,
 *   2. flood the core's colour back out through those layers, giving every rim
 *      texel an estimate of the S it was blended from,
 *   3. recover a = (255 - c) / (255 - S) on whichever channel has the most
 *      contrast against white, and rewrite the texel as opaque S or drop it,
 *      splitting at half coverage the way alpha-tested rendering does anyway.
 *
 * Two guards keep real art safe. A texel whose own core colour is near-white
 * (a shirt, teeth, the eye whites) carries no usable signal, so it is left
 * exactly as it is. And a feature too thin to have any core at all — a finger,
 * a bikini strap — is left alone rather than thinned away.
 */
export function unmatteFringe(d, w, h, key = [255, 255, 255], rim = 3) {
  const n = w * h;
  const CUT = 0.5;      // coverage below which a texel is background
  const FLAT = 25;      // channel contrast against the key needed to trust `a`

  // 1. Layer the silhouette: 0 = transparent, 1..rim = fringe, 255 = core art.
  const layer = new Uint8Array(n);
  for (let p = 0; p < n; p++) layer[p] = d[p * 4 + 3] ? 255 : 0;
  for (let k = 1; k <= rim; k++) {
    const front = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (layer[p] !== 255) continue;
        const near = (x > 0 && layer[p - 1] < k) || (x < w - 1 && layer[p + 1] < k)
          || (y > 0 && layer[p - w] < k) || (y < h - 1 && layer[p + w] < k);
        if (near) front.push(p);
      }
    }
    for (const p of front) layer[p] = k;
  }

  // 2. Flood the core colour outward, one layer at a time.
  const sr = new Uint8Array(n), sg = new Uint8Array(n), sb = new Uint8Array(n);
  const known = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (layer[p] !== 255) continue;
    const i = p * 4;
    sr[p] = d[i]; sg[p] = d[i + 1]; sb[p] = d[i + 2]; known[p] = 1;
  }
  for (let k = rim; k >= 1; k--) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (layer[p] !== k || known[p]) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (!known[q] || layer[q] <= k) continue;   // strictly further in
            r += sr[q]; g += sg[q]; b += sb[q]; count++;
          }
        }
        if (!count) continue;                            // no core behind it
        sr[p] = r / count; sg[p] = g / count; sb[p] = b / count; known[p] = 1;
      }
    }
  }

  // 3. Solve the blend and rewrite.
  for (let p = 0; p < n; p++) {
    const k = layer[p];
    if (k === 0 || k === 255 || !known[p]) continue;
    const i = p * 4;
    const S = [sr[p], sg[p], sb[p]];
    // Whichever channel separates the art from the key most is the one that
    // measures coverage best; on a white backdrop that is always the darkest
    // channel, but against an arbitrary key it can be any of the three, and it
    // can separate in either direction.
    let denom = 0, a = 1;
    for (let ch = 0; ch < 3; ch++) {
      const dk = Math.abs(key[ch] - S[ch]);
      if (dk > denom) { denom = dk; a = (key[ch] - d[i + ch]) / (key[ch] - S[ch]); }
    }
    if (denom < FLAT) continue;                          // art matches the key: leave it
    if (a < CUT) { d[i + 3] = 0; continue; }
    d[i] = S[0]; d[i + 1] = S[1]; d[i + 2] = S[2];       // un-washed art colour
  }
}
