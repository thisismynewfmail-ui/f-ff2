import * as THREE from '../../lib/three.module.js';

/**
 * RELIEF MAPS — where the depth comes from.
 *
 * Every wall in this town is one flat quad wearing one flat 128x128 painting.
 * Lambert shading gives that quad a single brightness for its whole surface,
 * so a brick wall lit from the left is exactly as flat as a sheet of paper
 * lit from the left: the mortar courses are painted shadow, and painted
 * shadow does not move when the sun does. That is the whole reason a stock
 * retro scene reads as cardboard no matter how good the texture art is.
 *
 * So this module gives every texture a SECOND map — a tangent-space relief
 * map baked from the art itself at load time — and SurfaceShading.js feeds it
 * to the light. The mortar recedes, the clapboard laps stand proud, the
 * corrugated shed catches a bar of sun down one flute and loses it down the
 * next, and all of it swings around as the day/night cycle walks the sun
 * across the sky. Nothing about the palette changes. The art is untouched.
 * The surfaces simply stop being flat.
 *
 * ---------------------------------------------------------------- the bake
 *
 * There is no height data to work from, so it has to be recovered from the
 * only thing there is: the painting. The move is to read the art the way a
 * painter wrote it — a texture artist darkens what is recessed and lightens
 * what catches the light — but to read it LOCALLY. Absolute brightness is
 * useless here: a pale brick and a dark brick are the same distance from the
 * wall, and treating "dark" as "deep" would tip whole bricks into slopes and
 * bend flat walls into hillsides. What actually marks a groove is a texel
 * being darker THAN ITS NEIGHBOURS.
 *
 * Hence a high pass. Blur the luminance, subtract it from itself, and what is
 * left is local relief with the large-scale colour thrown away — mortar
 * lines, plank gaps, shingle steps, the pit of a cinder block — with a pale
 * brick and a dark brick reading as equally flat, which is what they are.
 * That field is differentiated (Sobel, wrapping at the edges so tiling stays
 * seamless) into a normal, and the same field feeds a CAVITY term for the
 * crevices and a GLOSS mask for how sharply each texel takes a highlight.
 *
 * Four channels, one texture, one fetch:
 *
 *    R,G  tangent-space normal xy   (z reconstructed in the shader)
 *    B    HEIGHT, 0.5 = flat        (below = crevice, above = raised) — this
 *         one channel drives both the cavity darkening and the self-shadow
 *         march, so the shadow a mortar course casts agrees with the depth
 *         you can see in it
 *    A    gloss mask                (how hard this texel glints)
 *
 * -------------------------------------------------------------- profiles
 *
 * A bake is only ever as good as its assumptions, and the assumptions differ
 * per material — brickwork is deep and dead matt, sheet metal is shallow and
 * mirror-bright, glass is flat and glassy, grass is fine and matt. So every
 * texture is assigned a PROFILE (see PROFILES / profileFor) that sets how
 * hard the art is read and how the surface answers light. That is the
 * difference between "a normal map was applied" and a wall that looks like
 * brick and a roof that looks like metal.
 */

/**
 * @typedef {object} Profile
 * @property {number} smooth   pre-blur radius, texels — kills single-texel noise
 * @property {number} blur     high-pass radius, texels — the "local" in local relief
 * @property {number} detail   weight of the high-passed height (crisp features)
 * @property {number} form     weight of raw luminance (large-scale swell); usually tiny
 * @property {number} strength normal gain
 * @property {number} cavGain  how hard local relief maps into the cavity channel
 * @property {number} cavity   shader-side cavity depth
 * @property {number} shadow   how hard the height field shadows itself
 * @property {number} gloss    shader-side specular intensity
 * @property {number} glossVar bake-side gloss variation with luminance
 * @property {number} shine    specular exponent (tight highlight = high)
 * @property {number} env      sky-sheen amount
 * @property {number} fresnel  how much of that sheen is grazing-angle only
 * @property {boolean} [invert] art where light means deep, not proud
 */

const BASE = {
  smooth: 1, blur: 3, detail: 1, form: 0.08, strength: 3.2,
  cavGain: 1.8, cavity: 0.52, shadow: 0.7, gloss: 0.12, glossVar: 0.35, shine: 18,
  env: 0.14, fresnel: 0.8,
};

const P = (o) => ({ ...BASE, ...o });

/** @type {Record<string, Profile>} */
export const PROFILES = {
  // Masonry. The deepest relief in the game: mortar courses are real gaps and
  // a brick wall raked by a low sun should read as a grid of little shadows.
  masonry: P({ blur: 3, strength: 5.6, cavGain: 3.0, cavity: 0.85, shadow: 1.0, gloss: 0.10, shine: 13, env: 0.14 }),
  // Cut stone and plinths: same depth, calmer face, a faint polished sheen.
  stone: P({ blur: 4, strength: 4.8, cavGain: 2.6, cavity: 0.74, shadow: 0.9, gloss: 0.18, shine: 24, env: 0.24 }),
  // Lapped timber. Each board stands off the one below it, so the step at the
  // lap is the feature — crisp, and shallower across the board face.
  plank: P({ smooth: 1, blur: 2, strength: 4.6, cavGain: 2.4, cavity: 0.72, shadow: 1.0, gloss: 0.22, glossVar: 0.5, shine: 30, env: 0.20 }),
  // Render, plaster, poured concrete: a fine tooth, almost no gloss.
  render: P({ blur: 2, strength: 3.2, cavGain: 1.8, cavity: 0.52, shadow: 0.6, gloss: 0.08, shine: 16, env: 0.12 }),
  // Sheet metal. Shallow, but it is the one surface that really GLINTS: a
  // tight highlight that slides along the flutes as you walk past it.
  metal: P({ smooth: 1, blur: 3, strength: 3.6, cavGain: 1.8, cavity: 0.46, shadow: 0.7, gloss: 0.95, glossVar: 0.55, shine: 58, env: 0.75, fresnel: 0.6 }),
  // Rusted metal: the pitting is deep, the shine is mostly gone with it.
  rust: P({ blur: 2, strength: 4.2, cavGain: 2.2, cavity: 0.66, shadow: 0.9, gloss: 0.30, glossVar: 0.7, shine: 26, env: 0.30 }),
  // Polished metal (brass fittings, gilding): flat and hot.
  polish: P({ blur: 3, strength: 2.4, cavGain: 1.3, cavity: 0.34, shadow: 0.4, gloss: 1.20, glossVar: 0.4, shine: 84, env: 1.05, fresnel: 0.5 }),
  // Glass. Nearly flat, and almost all of its look is the sky it reflects —
  // which is why windows finally read as windows once the sheen turns on.
  glass: P({ blur: 3, strength: 1.6, cavGain: 1.1, cavity: 0.28, shadow: 0.3, gloss: 1.10, glossVar: 0.3, shine: 96, env: 1.30, fresnel: 0.9 }),
  // Fired/glazed tile, marble, slate: crisp joints, a wet-looking face.
  tile: P({ blur: 3, strength: 3.8, cavGain: 2.2, cavity: 0.62, shadow: 0.8, gloss: 0.60, glossVar: 0.4, shine: 52, env: 0.50 }),
  // Roofing. Seen from below and at a rake, so the course steps matter most.
  shingle: P({ blur: 3, strength: 5.0, cavGain: 2.8, cavity: 0.80, shadow: 1.0, gloss: 0.18, shine: 22, env: 0.18 }),
  // Ground cover. Fine and matt — enough to break the flatness of a lawn
  // underfoot without turning the map into a bumpy mess at distance.
  ground: P({ smooth: 1, blur: 2, strength: 3.0, cavGain: 1.7, cavity: 0.46, shadow: 0.5, gloss: 0.06, shine: 10, env: 0.08 }),
  // Made ground: asphalt and pavement keep a low damp sheen, which is what
  // stops a road reading as grey felt.
  asphalt: P({ blur: 3, strength: 2.6, cavGain: 1.5, cavity: 0.40, shadow: 0.4, gloss: 0.32, glossVar: 0.5, shine: 34, env: 0.40, fresnel: 0.95 }),
  // Loose aggregate: gravel and rubble are all relief and no shine.
  aggregate: P({ smooth: 0, blur: 2, strength: 4.6, cavGain: 2.5, cavity: 0.70, shadow: 1.0, gloss: 0.10, shine: 12, env: 0.10 }),
  // Cloth: soft, deep-ish weave, no highlight to speak of.
  fabric: P({ blur: 3, strength: 3.2, cavGain: 2.0, cavity: 0.52, shadow: 0.6, gloss: 0.08, shine: 12, env: 0.07 }),
  // Cutout planting. Gentle — the silhouette does the work, and hard normals
  // on a two-triangle leaf card look like foil.
  foliage: P({ blur: 2, strength: 2.4, cavGain: 1.4, cavity: 0.42, shadow: 0.3, gloss: 0.18, glossVar: 0.5, shine: 24, env: 0.16 }),
  bark: P({ smooth: 0, blur: 2, strength: 5.2, cavGain: 2.6, cavity: 0.78, shadow: 1.0, gloss: 0.07, shine: 11, env: 0.09 }),
  // Water: flat, and almost entirely the sky.
  water: P({ blur: 3, strength: 1.8, cavGain: 0.9, cavity: 0.18, shadow: 0.2, gloss: 1.30, glossVar: 0.2, shine: 120, env: 1.40, fresnel: 0.9 }),
  // Printed matter: paper tooth and a hint of ink sheen, nothing more.
  paper: P({ blur: 2, strength: 1.8, cavGain: 1.2, cavity: 0.36, shadow: 0.4, gloss: 0.14, shine: 26, env: 0.14 }),
};

/**
 * Texture → profile. Anything not named here is left FLAT on purpose (see the
 * `null` list): sprites, decals, particles and pickup icons are alpha-blended
 * billboards whose "surface" is a camera-facing card, so relief on them would
 * be relief on nothing — and the fringe around a cutout would bake into a
 * bevel that follows the player around.
 */
const ASSIGN = {
  masonry: ['brickRed', 'brickGray', 'brickTan', 'brickCracked', 'brickBrown', 'brickPainted',
    'brickClinker', 'brickRedMoss', 'cinderblock', 'cinderblockMoss', 'foundBrick', 'foundBlock',
    'rampart', 'wallStone', 'foundStone'],
  stone: ['trimStone', 'marbleWhite', 'archNiche', 'rock', 'foundConcrete'],
  plank: ['wallWood', 'wallWoodRot', 'sidingBlue', 'sidingGreen', 'sidingCream', 'sidingRed',
    'sidingYellow', 'sidingPeel', 'shakeCedar', 'shakeMoss', 'timberFrame', 'floorWood', 'pallet',
    'crate', 'picketFence', 'foundLattice', 'trimWoodWhite', 'trimWoodGreen', 'doorWood',
    'doorBlue', 'doorGreen', 'doorRed', 'doorApartment', 'doorScreen', 'doorShop', 'barricade',
    'windowBoarded', 'windowShutters', 'roofShakeWood'],
  render: ['wallPlaster', 'wallConcrete', 'concreteBrut', 'concreteStained', 'stuccoTan',
    'stuccoPink', 'stuccoStained', 'concrete', 'ceilingTile', 'sidewalk'],
  metal: ['wallMetal', 'roofMetal', 'trimMetal', 'doorMetal', 'doorGarage', 'chainlink',
    'sentryPlate', 'barrelHazard', 'roofMembrane'],
  rust: ['wallMetalRusty', 'roofMetalRust', 'metalRust', 'vendorEnamel'],
  polish: ['goldMetal', 'goldScreen', 'vendorBrass'],
  glass: ['window', 'windowShop', 'windowCurtain', 'windowOffice', 'windowLit', 'windowArched',
    'windowBroken', 'curtainWall', 'doorGlassDouble'],
  tile: ['floorTile', 'wallTileWhite', 'tileTeal', 'trimTileGreen', 'linoleum', 'roofClay',
    'roofSlate', 'manhole'],
  shingle: ['roofShingle', 'roofShingleGreen', 'roofShingleMoss', 'roofShingleBrown', 'roofTar'],
  ground: ['grass', 'grassDry', 'grassLush', 'grassWild', 'dirt'],
  asphalt: ['road', 'roadLine', 'crosswalk'],
  aggregate: ['gravel', 'rubble'],
  fabric: ['carpetRed', 'fabricCouch', 'tarpBlue', 'awning', 'wallCurtain', 'wallpaperFloral'],
  foliage: ['leaves', 'bush', 'hedge', 'ivy', 'vine', 'flowers', 'weeds',
    'grassTuft', 'grassTuftDry', 'grassTuftWild'],
  bark: ['bark'],
  water: ['water'],
  paper: ['posterNotice', 'signShop', 'signTokens', 'graffiti'],
};

/** Flat by design — camera-facing cards, blended decals and particles. */
const FLAT = new Set([
  'muzzleFlash', 'blood', 'smoke', 'shadowDecal', 'tvStatic', 'oilStain', 'chalkHopscotch',
  'ammoPistol', 'ammoShotgun', 'ammoRifle', 'ammoSniper', 'healthPack', 'key',
  'coinCopper', 'coinSilver', 'coinGold',
]);

const BY_NAME = new Map();
for (const [profile, names] of Object.entries(ASSIGN)) {
  for (const n of names) BY_NAME.set(n, profile);
}

/**
 * The profile for a logical texture name, or null for "leave it flat".
 *
 * Unlisted names fall back by keyword rather than being dropped, so a texture
 * added to TextureConfig tomorrow gets sensible relief without being wired in
 * here first — a new `wall_brick_*` is masonry, a new `roof_*` is shingle.
 */
export function profileFor(name) {
  if (FLAT.has(name)) return null;
  const hit = BY_NAME.get(name);
  if (hit) return PROFILES[hit];
  const n = name.toLowerCase();
  if (n.includes('brick') || n.includes('block')) return PROFILES.masonry;
  if (n.includes('window') || n.includes('glass')) return PROFILES.glass;
  if (n.includes('metal') || n.includes('steel')) return PROFILES.metal;
  if (n.includes('wood') || n.includes('siding') || n.includes('door') || n.includes('plank')) return PROFILES.plank;
  if (n.includes('roof')) return PROFILES.shingle;
  if (n.includes('grass') || n.includes('dirt')) return PROFILES.ground;
  if (n.includes('stucco') || n.includes('concrete') || n.includes('plaster')) return PROFILES.render;
  if (n.includes('tile') || n.includes('marble')) return PROFILES.tile;
  if (n.includes('stone') || n.includes('trim') || n.includes('found')) return PROFILES.stone;
  return PROFILES.render;
}

/**
 * name → { map, profile } for every texture that has relief.
 *
 * Keyed a second time by the albedo's IMAGE, because TextureLib.tiled() hands
 * out clones with their own repeat and a clone is a different Texture object —
 * but clones share their source image, so the image is the stable identity
 * that survives cloning. (userData cannot be used for this: THREE.Texture.copy
 * round-trips userData through JSON, which would shred a Texture stored in it.)
 */
const byName = new Map();
const byImage = new WeakMap();

/** Relief entry for a material's diffuse map, or undefined if it has none. */
export function reliefFor(map) {
  return map && map.image ? byImage.get(map.image) : undefined;
}

/** Relief entry by logical texture name (used by the hand-written shaders). */
export function reliefNamed(name) {
  return byName.get(name);
}

/**
 * Bake `img` into a relief map and register it under `name`. Returns the entry
 * (or null when the profile says leave it flat). Called by TextureLib as each
 * texture lands, so the cost is spread across the loading bar.
 */
export function registerRelief(name, img) {
  const profile = profileFor(name);
  if (!profile) return null;
  let entry = null;
  try {
    entry = { map: bakeRelief(img, profile), profile };
  } catch {
    return null; // a texture we cannot read is simply left flat
  }
  byName.set(name, entry);
  byImage.set(img, entry);
  return entry;
}

/**
 * Bake one albedo image into a packed relief texture.
 *
 * Every neighbourhood lookup WRAPS. These textures tile — a brick wall is the
 * same 128 texels repeated fifty times across a facade — so a bake that
 * clamped at the border would put a seam of false relief down every repeat,
 * which is far more visible than the relief itself.
 */
export function bakeRelief(img, p) {
  const w = img.width | 0, h = img.height | 0;
  if (!w || !h) throw new Error('empty image');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;

  // Luminance, and the cutout mask. A texture with holes in it (leaf cards,
  // railings) must not take gradients across the hole edge: whatever colour
  // the artist left under the transparent texels is not surface, and reading
  // it as surface bevels the silhouette.
  const lum = new Float32Array(n);
  const solid = new Uint8Array(n);
  let cut = false;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = (src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114) / 255;
    solid[i] = src[o + 3] >= 128 ? 1 : 0;
    if (!solid[i]) cut = true;
  }
  if (cut) {
    // Hold the hole at the local average so the edge ramps to flat instead of
    // falling off a cliff.
    const mean = meanOf(lum, solid);
    for (let i = 0; i < n; i++) if (!solid[i]) lum[i] = mean;
  }

  // Local relief: smooth away single-texel noise, then subtract the blurred
  // copy. What survives is what the eye reads as depth.
  const fine = p.smooth > 0 ? blurWrap(lum, w, h, p.smooth) : lum;
  const low = blurWrap(fine, w, h, p.blur);
  const height = new Float32Array(n);
  const sign = p.invert ? -1 : 1;
  for (let i = 0; i < n; i++) {
    height[i] = sign * ((fine[i] - low[i]) * p.detail + (fine[i] - 0.5) * p.form);
  }

  // Gradient gain is normalised against texel density, so a 256px texture and
  // a 128px one covering the same wall come out with the same depth instead
  // of the finer art quietly reading as flatter.
  const gain = p.strength * (Math.max(w, h) / 128);

  const out = ctx.createImageData(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const y0 = ((y - 1 + h) % h) * w, y1 = y * w, y2 = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const x0 = (x - 1 + w) % w, x1 = x, x2 = (x + 1) % w;
      // Sobel, /8 for the kernel's weight.
      const gx = ((height[y0 + x2] + 2 * height[y1 + x2] + height[y2 + x2])
        - (height[y0 + x0] + 2 * height[y1 + x0] + height[y2 + x0])) / 8;
      const gy = ((height[y2 + x0] + 2 * height[y2 + x1] + height[y2 + x2])
        - (height[y0 + x0] + 2 * height[y0 + x1] + height[y0 + x2])) / 8;

      // Surface normal of the height field. UVs run up the image while rows
      // run down it (textures are uploaded flipY), so the v derivative is the
      // negated row derivative — which is why gy enters unnegated and gx does
      // not. Get this backwards and every groove lights from the wrong side.
      const i = y1 + x;
      const solidHere = solid[i];
      let nx = -gx * gain * solidHere;
      let ny = gy * gain * solidHere;
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;

      // B is a HEIGHT, 0.5 = the surface's own local mean. It drives the
      // cavity darkening AND the self-shadow march in the shader, so the
      // shadow a mortar course casts agrees with the depth you can see.
      const cav = solidHere ? clamp01(0.5 + height[i] * p.cavGain) : 0.5;
      const gloss = solidHere ? clamp01(1 + p.glossVar * (fine[i] * 2 - 1)) : 0;

      const o = i * 4;
      d[o] = Math.round((nx * 0.5 + 0.5) * 255);
      d[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[o + 2] = Math.round(cav * 255);
      d[o + 3] = Math.round(gloss * 255);
    }
  }

  const cv2 = document.createElement('canvas');
  cv2.width = w; cv2.height = h;
  cv2.getContext('2d').putImageData(out, 0, 0);

  const tex = new THREE.Texture(cv2);
  // Filtered exactly like the albedo it belongs to: the relief has to land on
  // the same texel grid as the art, or the shading slides off the detail it
  // is supposed to be shading. It is DATA, not colour, so no sRGB decode.
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function meanOf(a, mask) {
  let sum = 0, count = 0;
  for (let i = 0; i < a.length; i++) if (mask[i]) { sum += a[i]; count++; }
  return count ? sum / count : 0.5;
}

/** Separable box blur with wrapping edges; two passes for a gaussian-ish tail. */
function blurWrap(src, w, h, radius) {
  let a = src, b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    boxH(a, b, w, h, radius);
    const t = new Float32Array(src.length);
    boxV(b, t, w, h, radius);
    a = t;
  }
  return a;
}

function boxH(src, dst, w, h, r) {
  const inv = 1 / (r * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + ((x + k + w * 4) % w)];
      dst[row + x] = sum * inv;
    }
  }
}

function boxV(src, dst, w, h, r) {
  const inv = 1 / (r * 2 + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[((y + k + h * 4) % h) * w + x];
      dst[y * w + x] = sum * inv;
    }
  }
}
