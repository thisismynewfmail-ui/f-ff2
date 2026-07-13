import * as THREE from '../../lib/three.module.js';

/**
 * Procedural PBR material library for the first-person weapons.
 *
 * Every weapon surface is a full physically-based material set — albedo,
 * normal, roughness and metalness maps — generated on a <canvas> at load
 * time (no image files, matching the rest of the game's synthesised assets).
 * Albedo and normal maps are 1024² on the close-up "hero" palettes (brass,
 * blued steel, walnut) and 512² elsewhere; roughness/metalness ride at 512².
 *
 * The steampunk / Bioshock palette lives here: warm polished brass, blued
 * gunsteel, pitted cast iron, oxidised copper, gunmetal, oiled walnut, oak,
 * cracked leather, waxed canvas and lens glass. Each palette carries its own
 * wear, rivet and grain character so no two weapons read the same.
 *
 * Materials are cached by name and shared across weapons; ask for one with
 * `WeaponMaterials.get(name)`.
 */

/* ---------------- value noise ---------------- */

function hash(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 362437;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x, y, seed, oct = 4) {
  let f = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < oct; i++) {
    f += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    amp *= 0.5; freq *= 2;
  }
  return f;
}

/* ---------------- per-pixel field sampler ---------------- */

// Returns { h, wear, edge } for a surface point in [0,1]². h is a height for
// the normal map, wear is grime (0 clean .. 1 filthy), edge is exposed-metal
// scratch/rivet-rim brightness (0 none .. 1 bright).
function sampleField(u, v, cfg) {
  let h = 0.5, wear = 0, edge = 0;
  const s = cfg.seed;

  if (cfg.style === 'metal') {
    // brushed grain — stretched along u so it reads as a lathe/mill finish
    const grain = fbm(u * cfg.grainU, v * cfg.grainV, s, 4);
    h += (grain - 0.5) * 0.14 * cfg.grain;
    // large-scale mottling / oxidation
    const mott = fbm(u * 5, v * 5, s + 91, 4);
    wear = Math.min(1, Math.max(0, (mott - 0.42) * 1.6)) * cfg.wear;
    h -= wear * 0.05;
    // panel seams
    if (cfg.panels) {
      const pu = Math.abs(((u * cfg.panels) % 1) - 0.5);
      if (pu > 0.47) { h -= 0.16; edge = Math.max(edge, 0.25); }
    }
    // rivets on a grid
    if (cfg.rivets) {
      const g = cfg.rivets;
      const cu = (Math.floor(u * g) + 0.5) / g, cv = (Math.floor(v * g) + 0.5) / g;
      const d = Math.hypot((u - cu) * g, (v - cv) * g);
      if (d < 0.34) {
        const dome = Math.cos(d / 0.34 * Math.PI * 0.5);
        h += dome * 0.5;
        if (d > 0.24) edge = Math.max(edge, 0.55); // bright rim
      }
    }
    // fine scratches — thin bright lines of exposed metal
    const scr = fbm(u * 30 + v * 3, v * 220, s + 250, 2);
    if (scr > 0.74) { edge = Math.max(edge, (scr - 0.74) * 3.2); h += 0.04; }
  } else if (cfg.style === 'wood') {
    // long grain streaks + occasional knot rings
    const grain = fbm(u * 3 + fbm(u * 2, v * 30, s, 2) * 0.6, v * 40, s, 4);
    h += (grain - 0.5) * 0.35;
    wear = grain;
    const kx = 0.5 + 0.3 * Math.sin(s), ky = 0.35;
    const kd = Math.hypot((u - kx) * 2.2, (v - ky) * 0.7);
    const ring = Math.sin(kd * 34) * Math.exp(-kd * 2.4);
    h += ring * 0.12;
    wear = Math.min(1, wear + Math.max(0, ring));
  } else if (cfg.style === 'leather') {
    // pebbled hide: worley-ish cells with cracked seams
    let m = 1e9;
    const cell = cfg.cell || 9;
    const gx = Math.floor(u * cell), gy = Math.floor(v * cell);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const fx = (gx + ox + hash(gx + ox, gy + oy, s)) / cell;
      const fy = (gy + oy + hash(gx + ox, gy + oy, s + 5)) / cell;
      m = Math.min(m, Math.hypot((u - fx) * cell, (v - fy) * cell));
    }
    h += (0.5 - m) * 0.4;               // domed cells, sunken cracks
    wear = 0.4 + 0.4 * fbm(u * 8, v * 8, s + 3, 3);
    edge = m > 0.62 ? (m - 0.62) * 1.5 : 0;
  } else if (cfg.style === 'canvas') {
    // waxed webbing weave
    const wu = Math.sin(u * cfg.weave * Math.PI * 2);
    const wv = Math.sin(v * cfg.weave * Math.PI * 2);
    h += (wu * wv) * 0.18;
    wear = 0.5 + 0.5 * fbm(u * 10, v * 10, s, 3);
  }
  return { h: Math.min(1, Math.max(0, h)), wear: Math.min(1, wear), edge: Math.min(1, edge) };
}

/* ---------------- texture builders ---------------- */

function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function mix(a, b, t) { return a + (b - a) * t; }

function buildMaps(cfg) {
  const A = cfg.aSize, D = cfg.dSize;
  const [br, bg, bb] = cfg.color;

  // -- albedo + normal share the hi-res field --
  const H = new Float32Array(A * A);
  const albedo = document.createElement('canvas'); albedo.width = albedo.height = A;
  const aImg = albedo.getContext('2d').createImageData(A, A);
  const ad = aImg.data;
  for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
    const i = y * A + x;
    const f = sampleField((x + 0.5) / A, (y + 0.5) / A, cfg);
    H[i] = f.h;
    const shade = 0.72 + f.h * 0.5;            // height → lambert-ish shading baked faint
    const eg = f.edge * cfg.edgeBright;
    let cr = br * shade, cg = bg * shade, cb = bb * shade;
    if (cfg.wearTint) {
      // wear shifts toward a tint color (verdigris on old bronze) instead of
      // plain darkening
      const t = f.wear * cfg.grimeAmt;
      cr = mix(cr, cfg.wearTint[0], t); cg = mix(cg, cfg.wearTint[1], t); cb = mix(cb, cfg.wearTint[2], t);
    } else {
      const grime = 1 - f.wear * cfg.grimeAmt;
      cr *= grime; cg *= grime; cb *= grime;
    }
    ad[i * 4]     = Math.min(255, cr + eg * 120);
    ad[i * 4 + 1] = Math.min(255, cg + eg * 120);
    ad[i * 4 + 2] = Math.min(255, cb + eg * 120);
    ad[i * 4 + 3] = 255;
  }
  albedo.getContext('2d').putImageData(aImg, 0, 0);

  // normal map from the height field (central differences)
  const normal = document.createElement('canvas'); normal.width = normal.height = A;
  const nImg = normal.getContext('2d').createImageData(A, A);
  const nd = nImg.data;
  const str = cfg.normalStr;
  for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
    const l = H[y * A + ((x - 1 + A) % A)], r = H[y * A + ((x + 1) % A)];
    const u = H[((y - 1 + A) % A) * A + x], dn = H[((y + 1) % A) * A + x];
    let nx = (l - r) * str, ny = (u - dn) * str, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv; ny *= inv; nz *= inv;
    const i = (y * A + x) * 4;
    nd[i] = (nx * 0.5 + 0.5) * 255;
    nd[i + 1] = (ny * 0.5 + 0.5) * 255;
    nd[i + 2] = (nz * 0.5 + 0.5) * 255;
    nd[i + 3] = 255;
  }
  normal.getContext('2d').putImageData(nImg, 0, 0);

  // -- roughness + metalness at data res --
  const rough = document.createElement('canvas'); rough.width = rough.height = D;
  const metal = document.createElement('canvas'); metal.width = metal.height = D;
  const rImg = rough.getContext('2d').createImageData(D, D);
  const mImg = metal.getContext('2d').createImageData(D, D);
  const rd = rImg.data, md = mImg.data;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const f = sampleField((x + 0.5) / D, (y + 0.5) / D, cfg);
    // rougher where worn / scratched, smoother on polished high points
    let rgh = cfg.rough + f.wear * 0.3 - (f.h - 0.5) * 0.2 * cfg.polish - f.edge * 0.25;
    let mtl = cfg.metal;
    if (cfg.metal > 0.2) { mtl = cfg.metal - f.wear * 0.5 + f.edge * 0.4; } // grime dulls, scratches expose
    const i = (y * D + x) * 4;
    const rv = Math.min(255, Math.max(0, rgh * 255));
    rd[i] = rd[i + 1] = rd[i + 2] = rv; rd[i + 3] = 255;
    const mv = Math.min(255, Math.max(0, mtl * 255));
    md[i] = md[i + 1] = md[i + 2] = mv; md[i + 3] = 255;
  }
  rough.getContext('2d').putImageData(rImg, 0, 0);
  metal.getContext('2d').putImageData(mImg, 0, 0);

  return {
    map: tex(albedo, true),
    normalMap: tex(normal, false),
    roughnessMap: tex(rough, false),
    metalnessMap: tex(metal, false),
  };
}

/* ---------------- palettes ---------------- */

// aSize 1024 = hero close-up detail; 512 = supporting parts.
const P = (o) => ({
  aSize: 512, dSize: 512, normalStr: 2.2, grain: 1, grainU: 3, grainV: 60,
  wear: 0.6, grimeAmt: 0.4, edgeBright: 1, rough: 0.4, metal: 1, polish: 1,
  rivets: 0, panels: 0, ...o,
});

const PALETTES = {
  // --- brass family (warm, the steampunk signature) ---
  brass:      P({ seed: 11, color: [196, 150, 58], aSize: 1024, normalStr: 2.4, rough: 0.3, grainU: 4, grainV: 40, wear: 0.5, rivets: 5, edgeBright: 1.1 }),
  brassWorn:  P({ seed: 12, color: [150, 112, 46], rough: 0.46, wear: 0.8, rivets: 6, panels: 4 }),
  copper:     P({ seed: 21, color: [168, 96, 54], rough: 0.4, wear: 0.7, grainV: 30, rivets: 0 }),
  // --- steels ---
  bluedSteel: P({ seed: 31, color: [40, 46, 58], aSize: 1024, normalStr: 2.0, rough: 0.26, wear: 0.35, grainU: 3, grainV: 90, polish: 1.3 }),
  gunmetal:   P({ seed: 32, color: [70, 74, 82], rough: 0.42, wear: 0.5, panels: 5, rivets: 7 }),
  castIron:   P({ seed: 33, color: [46, 44, 46], rough: 0.62, wear: 0.85, grain: 1.6, grainU: 8, grainV: 8, rivets: 4 }),
  steelBright:P({ seed: 34, color: [150, 156, 166], rough: 0.22, wear: 0.25, polish: 1.4 }),
  // --- non-metals ---
  walnut:     P({ seed: 41, color: [96, 56, 32], aSize: 1024, style: 'wood', metal: 0, rough: 0.5, normalStr: 1.7, grimeAmt: 0.5 }),
  oak:        P({ seed: 42, color: [128, 88, 46], style: 'wood', metal: 0, rough: 0.58, normalStr: 1.6, grimeAmt: 0.5 }),
  leather:    P({ seed: 51, color: [74, 46, 28], style: 'leather', metal: 0, rough: 0.72, normalStr: 2.2, cell: 10, grimeAmt: 0.55 }),
  canvas:     P({ seed: 61, color: [104, 92, 60], style: 'canvas', metal: 0, rough: 0.86, normalStr: 1.5, weave: 26, grimeAmt: 0.5 }),
  // --- the 2nd-generation weapon families (one signature set per weapon) ---
  nickel:       P({ seed: 71, color: [164, 170, 182], aSize: 1024, normalStr: 1.8, rough: 0.24, wear: 0.3, grainU: 4, grainV: 70, polish: 1.5, edgeBright: 0.8 }),
  blackSteel:   P({ seed: 72, color: [32, 34, 38], aSize: 1024, normalStr: 2.2, rough: 0.5, wear: 0.55, grainU: 5, grainV: 40, panels: 6, rivets: 6, edgeBright: 1.4 }),
  bronzePatina: P({ seed: 73, color: [128, 106, 58], rough: 0.52, wear: 0.9, grainV: 24, rivets: 5, grimeAmt: 0.6, edgeBright: 1.0, wearTint: [88, 134, 110] }),
  hammeredIron: P({ seed: 74, color: [54, 52, 54], rough: 0.6, wear: 0.7, grain: 2.4, grainU: 12, grainV: 12, edgeBright: 0.9 }),
  ivory:        P({ seed: 75, color: [216, 204, 178], style: 'wood', metal: 0, rough: 0.3, normalStr: 0.8, grimeAmt: 0.35 }),
  ebony:        P({ seed: 76, color: [40, 32, 28], style: 'wood', metal: 0, rough: 0.4, normalStr: 1.4, grimeAmt: 0.3 }),
  cherry:       P({ seed: 77, color: [116, 54, 36], style: 'wood', metal: 0, rough: 0.5, normalStr: 1.6, grimeAmt: 0.45 }),
};

/* ---------------- public API ---------------- */

const _cache = new Map();

export const WeaponMaterials = {
  /** Cached MeshStandardMaterial for a named palette (see PALETTES). */
  get(name) {
    if (_cache.has(name)) return _cache.get(name);
    const cfg = PALETTES[name];
    if (!cfg) throw new Error(`Unknown weapon palette "${name}"`);
    const maps = buildMaps(cfg);
    const m = new THREE.MeshStandardMaterial({
      ...maps,
      metalness: 1, roughness: 1, // real values ride in the maps
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    m.name = 'wpn_' + name;
    _cache.set(name, m);
    return m;
  },

  /** Lens / gauge glass — a simple emissive-tinted translucent material. */
  glass(color = 0x2a5a6a, emissive = 0x0a1a1e) {
    const key = 'glass_' + color + '_' + emissive;
    if (_cache.has(key)) return _cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: 0.5,
      metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.62,
    });
    _cache.set(key, m);
    return m;
  },

  /** Flat matte accent (paint, rubber, bakelite) — no maps, cheap. */
  flat(color, roughness = 0.7, metalness = 0.0) {
    const key = 'flat_' + color + '_' + roughness + '_' + metalness;
    if (_cache.has(key)) return _cache.get(key);
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    _cache.set(key, m);
    return m;
  },

  /** Emissive glow (dials, filament, valve indicators). */
  glow(color, intensity = 1.4) {
    const key = 'glow_' + color + '_' + intensity;
    if (_cache.has(key)) return _cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: intensity,
      metalness: 0, roughness: 0.5,
    });
    _cache.set(key, m);
    return m;
  },

  dispose() {
    for (const m of _cache.values()) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) m[k]?.dispose?.();
      m.dispose?.();
    }
    _cache.clear();
  },
};
