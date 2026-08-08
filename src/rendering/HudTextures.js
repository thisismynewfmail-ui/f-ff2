/**
 * Procedural panel textures for every interface in the game, baked once to
 * data-URIs and used as CSS backgrounds. Same synthesised-asset philosophy as
 * the rest of the game: no image files.
 *
 * One material family, used everywhere — the HUD dock, the pause case, the
 * satchel, the arcade cabinet, the title rail. It is army-surplus equipment:
 * OLIVE-DRAB PAINTED STEEL, chipped back to bare metal in places and filthy
 * everywhere, with near-black wells sunk into it for the readouts and aged
 * CARD STOCK for anything that is documentation rather than instrumentation.
 * The chisel bevels that make a plate read as raised or recessed live in
 * styles.css (the --bev-* tokens); this file is only the surface.
 */

/* --------------------------------------------------------------------------
   The materials TILE. Panels in this game run from a 60px nameplate to a
   1600px console bar, so a stretched-to-fit bake smears the grain by 4x on
   anything tall and the whole family stops looking like one plate stock. The
   noise below is therefore PERIODIC — the lattice wraps at a whole number of
   cells across the bake — and the chips and scratches are drawn nine times,
   once per neighbouring tile, so a shape that runs off one edge comes back on
   the other. The result repeats seamlessly at its natural size, which is what
   sheet metal actually does: one stock, cut to whatever the panel needs.
   -------------------------------------------------------------------------- */

function noise(x, y, s) {
  let h = x * 374761393 + y * 668265263 + s * 362437;
  h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}
/** Value noise on a lattice that wraps at (px, py) cells. */
function smoothNoise(x, y, s, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = noise(x0, y0, s), b = noise(x1, y0, s), c = noise(x0, y1, s), dd = noise(x1, y1, s);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + dd * u * v;
}
/** Four octaves of it. Each octave doubles the cell count, so every one of
 *  them shares the same period and the sum stays seamless. */
function fbm(x, y, s, px, py) {
  let f = 0, a = 0.5, fr = 1;
  for (let i = 0; i < 4; i++) {
    f += a * smoothNoise(x * fr, y * fr, s + i * 7, px * fr, py * fr);
    a *= 0.5; fr *= 2;
  }
  return f;
}
/** Cell count for a feature of roughly `per` pixels, never below one octave. */
function cells(size, per) { return Math.max(2, Math.round(size / per)); }
/** Run `draw` once per neighbouring tile so shapes wrap across the seams. */
function wrapped(ctx, w, h, draw) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    ctx.save(); ctx.translate(ox * w, oy * h); draw(); ctx.restore();
  }
}

/**
 * OLIVE-DRAB PAINTED STEEL — the housing every panel in the game is cut from.
 *
 * The reference HUD is not black gunmetal, it is army-surplus equipment: a
 * plate sprayed olive at a depot, bolted into a rack, and then lived with for
 * a century. So the material is built the way that wears — a flat olive
 * undercoat, a brushed grain from the press, big soft grime blotches where
 * hands and weather have been, hard-edged chips where the paint has come off
 * to bare metal, and a scatter of fine scratches over everything. The chisel
 * bevels that make a plate read as raised or recessed are CSS (see the
 * --bev-* tokens in styles.css); this is only the surface.
 */
function oliveSteel(w, h, { seed = 21, base = [96, 94, 66], scratches = 26, chips = 14 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // The grain runs ALONG the plate the way rolled steel comes off the mill:
  // slow across the width, fine down it, so the streaks read horizontal.
  const gx = cells(w, 26), gy = cells(h, 2.2);
  const bx = cells(w, 62), by = cells(h, 62);       // grime blotches: big and round
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const grain = fbm(x * gx / w, y * gy / h, seed, gx, gy);        // rolled grain
    const grime = fbm(x * bx / w, y * by / h, seed + 31, bx, by);   // soiled patches
    const speck = noise(x, y, seed + 77);
    // the grime is the character: it takes the plate from olive down to
    // near-brown wherever it has settled, and never quite lifts it back
    const sh = 0.66 + grain * 0.28 + (grime - 0.5) * 0.42;
    let r = base[0] * sh, g = base[1] * sh, b = base[2] * sh;
    const soil = Math.max(0, grime - 0.56) * 1.9;          // brown, in the low spots
    r += (74 - r) * soil * 0.55; g += (60 - g) * soil * 0.6; b += (34 - b) * soil * 0.5;
    if (speck > 0.9935) { r += 44; g += 44; b += 36; }     // grit catching the light
    else if (speck < 0.008) { r *= 0.45; g *= 0.45; b *= 0.45; }
    d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // paint chipped back to bare steel, each with a dark lip on its low side
  wrapped(ctx, w, h, () => {
    for (let k = 0; k < chips; k++) {
      const cx = noise(k, 11, seed) * w, cy = noise(k, 12, seed) * h;
      const rr = 1.5 + noise(k, 13, seed) * 4.5;
      ctx.fillStyle = `rgba(122,120,108,${(0.2 + noise(k, 14, seed) * 0.22).toFixed(2)})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.7, noise(k, 15, seed) * 3, 0, 6.284); ctx.fill();
      ctx.fillStyle = 'rgba(18,17,10,0.38)';
      ctx.beginPath(); ctx.ellipse(cx, cy + rr * 0.55, rr * 0.8, rr * 0.3, 0, 0, 6.284); ctx.fill();
    }
    for (let k = 0; k < scratches; k++) {
      const x0 = noise(k, 1, seed) * w, y0 = noise(k, 2, seed) * h;
      const ang = noise(k, 3, seed) * Math.PI, len = 8 + noise(k, 4, seed) * 46;
      ctx.strokeStyle = `rgba(168,164,140,${(0.05 + noise(k, 5, seed) * 0.12).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      ctx.stroke();
    }
  });
  return c;
}

/** The dark well a readout sits in: pitted, near-black, faintly green. */
function recessField(w, h, seed = 11) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const gx = cells(w, 1.1), gy = cells(h, 1.1);     // pitting
  const bx = cells(w, 33), by = cells(h, 33);       // dirt shading
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const grain = fbm(x * gx / w, y * gy / h, seed, gx, gy);
    const blotch = fbm(x * bx / w, y * by / h, seed + 17, bx, by);
    const sh = 0.55 + grain * 0.5 + (blotch - 0.5) * 0.5;
    d[i] = 22 * sh; d[i + 1] = 25 * sh; d[i + 2] = 17 * sh; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * AGED CARD STOCK — the description panel in the reference is not a screen,
 * it is a printed card slipped behind glass: foxed paper, a warm cast toward
 * the edges, and the odd stain. Anything that reads as DOCUMENTATION rather
 * than instrumentation is drawn on this.
 */
function parchment(w, h, seed = 5) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const gx = cells(w, 1.4), gy = cells(h, 1.4);     // paper fibre
  const bx = cells(w, 50), by = cells(h, 50);       // age cast
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const fibre = fbm(x * gx / w, y * gy / h, seed, gx, gy) * 0.16;
    const age = fbm(x * bx / w, y * by / h, seed + 23, bx, by);
    const sh = 0.88 + fibre + (age - 0.5) * 0.22;
    d[i] = Math.min(255, 208 * sh);
    d[i + 1] = Math.min(255, 189 * sh);
    d[i + 2] = Math.min(255, 142 * sh);
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  wrapped(ctx, w, h, () => {
    for (let k = 0; k < 18; k++) {                    // foxing
      const cx = noise(k, 31, seed) * w, cy = noise(k, 32, seed) * h;
      ctx.fillStyle = `rgba(124,96,52,${(0.03 + noise(k, 33, seed) * 0.06).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 2 + noise(k, 34, seed) * 9, 0, 6.284);
      ctx.fill();
    }
  });
  return c;
}

/**
 * Publish the baked materials as CSS custom properties on :root.
 *
 * Every panel in the game is cut from the same plate, so the alternative is a
 * JS assignment per element — dozens of them, all saying the same thing, and
 * every new panel a chance to forget one. Installing the data-URIs as tokens
 * lets styles.css do it declaratively (`background-image: var(--tex-steel)`)
 * and keeps the material decision in the same file as the bevels that go with
 * it. Safe to call more than once; the bake is cached.
 */
export function installHudTextures() {
  const t = hudTextures();
  const r = document.documentElement.style;
  r.setProperty('--tex-steel', `url(${t.device})`);
  r.setProperty('--tex-bar', `url(${t.bar})`);
  r.setProperty('--tex-plate', `url(${t.plate})`);
  r.setProperty('--tex-recess', `url(${t.inset})`);
  r.setProperty('--tex-paper', `url(${t.paper})`);
  return t;
}

let _cache = null;
export function hudTextures() {
  if (_cache) return _cache;
  _cache = {
    // Every housing in the game is cut from the same olive plate. The bakes
    // differ only by seed, so no two panels wear identically, and they share
    // a grain SCALE — a nameplate and the console bar are visibly the same
    // stock because each repeats the tile rather than stretching it.
    bar: oliveSteel(384, 256, { seed: 5, scratches: 44, chips: 22 }).toDataURL(),
    device: oliveSteel(384, 256, { seed: 21, scratches: 40, chips: 18 }).toDataURL(),
    plate: oliveSteel(128, 96, { seed: 43, scratches: 12, chips: 5 }).toDataURL(),
    inset: recessField(128, 128, 11).toDataURL(),
    paper: parchment(256, 192, 5).toDataURL(),
  };
  return _cache;
}
