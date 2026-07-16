/**
 * Procedural panel textures for the HUD, baked once to data-URIs and used as
 * CSS backgrounds. Same synthesised-asset philosophy as the rest of the game
 * (no image files). The whole instrument dock — the centre console bar and
 * the two flanking field devices — shares one housing family: near-black
 * scratched gunmetal, with dark bakelite inset screens behind the readouts.
 */

function noise(x, y, s) {
  let h = x * 374761393 + y * 668265263 + s * 362437;
  h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function fbm(x, y, s) {
  let f = 0, a = 0.5, fr = 1;
  for (let i = 0; i < 4; i++) { f += a * smoothNoise(x * fr, y * fr, s + i * 7); a *= 0.5; fr *= 2; }
  return f;
}
function smoothNoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = noise(xi, yi, s), b = noise(xi + 1, yi, s), c = noise(xi, yi + 1, s), dd = noise(xi + 1, yi + 1, s);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + dd * u * v;
}

/** Pitted, oil-stained cast iron with a subtle brushed grain. */
function ironPanel(w, h, { seed = 3, base = [46, 44, 46], rust = [96, 58, 34] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const grain = fbm(x * 0.05, y * 0.9, seed);          // fine vertical brushing
    const blotch = fbm(x * 0.02, y * 0.02, seed + 40);   // large mottle
    const pit = noise(x, y, seed + 99);
    let sh = 0.7 + grain * 0.5 + (blotch - 0.5) * 0.25;
    const rustAmt = Math.max(0, blotch - 0.55) * 1.8;
    let r = base[0] * sh, g = base[1] * sh, b = base[2] * sh;
    r += (rust[0] - base[0]) * rustAmt * 0.5;
    g += (rust[1] - base[1]) * rustAmt * 0.5;
    b += (rust[2] - base[2]) * rustAmt * 0.5;
    if (pit > 0.985) { r *= 0.4; g *= 0.4; b *= 0.4; } // deep pits
    d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Oxidised brass strip for trim / bezels. */
function brassStrip(w, h, seed = 7) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const grain = fbm(x * 0.3, y * 0.08, seed);
    const patina = Math.max(0, fbm(x * 0.03, y * 0.05, seed + 20) - 0.55) * 2;
    let sh = 0.72 + grain * 0.5;
    let r = 190 * sh, g = 150 * sh, b = 66 * sh;
    r += (70 - r) * patina * 0.35; g += (128 - g) * patina * 0.3; b += (104 - b) * patina * 0.35; // verdigris
    d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Near-black scratched gunmetal for the instrument-dock housings — the dark,
 *  hard-worn detector casing of the reference unit: mottled charcoal steel,
 *  lighter worn patches, glinting nicks and long thin scratches. Used by the
 *  side-HUD field devices and the centre console bar alike. */
function gunmetalPanel(w, h, seed = 21, scratches = 26) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const grain = fbm(x * 0.5, y * 0.06, seed);          // fine horizontal brushing
    const blotch = fbm(x * 0.025, y * 0.025, seed + 31); // large worn mottle
    const pit = noise(x, y, seed + 77);
    const sh = 0.75 + grain * 0.4 + (blotch - 0.5) * 0.3;
    let r = 30 * sh, g = 31 * sh, b = 29 * sh;
    const wear = Math.max(0, blotch - 0.62) * 2.2;       // paint rubbed to bare metal
    r += 34 * wear; g += 33 * wear; b += 28 * wear;
    if (pit > 0.992) { r += 52; g += 52; b += 46; }      // glinting nicks
    else if (pit < 0.01) { r *= 0.4; g *= 0.4; b *= 0.4; } // dents
    d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // long thin scratches over the top
  for (let s = 0; s < scratches; s++) {
    const x0 = noise(s, 1, seed) * w, y0 = noise(s, 2, seed) * h;
    const ang = noise(s, 3, seed) * Math.PI, len = 6 + noise(s, 4, seed) * 30;
    ctx.strokeStyle = `rgba(150,152,142,${(0.05 + noise(s, 5, seed) * 0.1).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
    ctx.stroke();
  }
  return c;
}

let _cache = null;
export function hudTextures() {
  if (_cache) return _cache;
  _cache = {
    // the console bar wears the same gunmetal as the side devices (its own
    // seed so the wear pattern doesn't visibly repeat; wider bake + more
    // scratches because it stretches across the full 1180px panel)
    bar: gunmetalPanel(512, 144, 5, 46).toDataURL(),
    inset: ironPanel(128, 128, { seed: 11, base: [30, 30, 33], rust: [60, 40, 28] }).toDataURL(),
    brass: brassStrip(256, 24, 7).toDataURL(),
    device: gunmetalPanel(256, 160, 21).toDataURL(),
  };
  return _cache;
}
