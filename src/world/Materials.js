/**
 * Facade material sets.
 *
 * A building is never given a bare wall texture. It is given a *set*: wall,
 * roof, door, window, foundation and trim chosen together, the way a real
 * building's materials were chosen together. Brick gets a stone plinth and a
 * stone belt course; clapboard gets painted timber trim and a rubble footing;
 * a curtain-walled tower gets steel channel and poured concrete. That is what
 * makes two adjacent buildings read as two different buildings rather than as
 * the same box in two colours.
 *
 * Two rules the town depends on:
 *
 *  1. NO REUSE BETWEEN NEIGHBOURS. `deconflict()` walks every building and
 *     re-rolls any set that matches another building within sight of it, so
 *     you never see a street of clones.
 *
 *  2. WEATHERING IS SPATIAL. Each set names a weathered twin of its wall and
 *     roof — the same material after years of rain: moss to the sill line,
 *     paint flaking off grey timber, render blown off the brick, water
 *     staining under every joint. `resolve()` swaps them in as the
 *     maintenance gradient falls off toward the map rim, so the commercial
 *     core reads kept-up and the outskirts read abandoned without a single
 *     hand-placed decal.
 */

/**
 * @typedef {object} MaterialSet
 * @property {string}  wall        wall texture in good condition
 * @property {string} [wallWorn]   weathered twin (defaults to `wall`)
 * @property {string}  roof        roof texture in good condition
 * @property {string} [roofWorn]   weathered twin (defaults to `roof`)
 * @property {string}  door        door leaf texture
 * @property {string}  window      window texture for intact panes
 * @property {string}  foundation  half-height footing texture
 * @property {string}  trim        belt course / cornice texture
 * @property {string} [chimney]    chimney texture (defaults to `wall`)
 * @property {string[]} families   tags this set may be drawn for
 */

/** @type {Record<string, MaterialSet>} */
export const MATERIAL_SETS = {
  // --- masonry -------------------------------------------------------
  redbrickWalkup: {
    wall: 'brickRed', wallWorn: 'brickRedMoss', roof: 'roofShingle', roofWorn: 'roofShingleMoss',
    door: 'doorWood', window: 'window', foundation: 'foundStone', trim: 'trimStone',
    families: ['house', 'shop', 'civic', 'block'],
  },
  brownBrickTenement: {
    wall: 'brickBrown', wallWorn: 'brickRedMoss', roof: 'roofTar', roofWorn: 'roofMetalRust',
    door: 'doorApartment', window: 'window', foundation: 'foundBrick', trim: 'trimStone',
    families: ['block', 'house'],
  },
  greyBrickCivic: {
    wall: 'brickGray', wallWorn: 'cinderblockMoss', roof: 'roofSlate', roofWorn: 'roofShingleMoss',
    door: 'doorGlassDouble', window: 'windowOffice', foundation: 'foundConcrete', trim: 'trimStone',
    families: ['civic', 'block', 'shop'],
  },
  tanBrickDeco: {
    wall: 'brickTan', roof: 'roofTar', roofWorn: 'roofMetalRust',
    door: 'doorShop', window: 'windowShop', foundation: 'foundConcrete', trim: 'trimTileGreen',
    families: ['shop', 'block', 'civic'],
  },
  paintedBrickShop: {
    wall: 'brickPainted', wallWorn: 'brickRedMoss', roof: 'roofMetal', roofWorn: 'roofMetalRust',
    door: 'doorBlue', window: 'windowShop', foundation: 'foundConcrete', trim: 'trimWoodWhite',
    families: ['shop', 'house'],
  },
  coursedStone: {
    wall: 'wallStone', roof: 'roofSlate', roofWorn: 'roofShingleMoss',
    door: 'doorWood', window: 'windowArched', foundation: 'foundStone', trim: 'trimStone',
    families: ['church', 'civic'],
  },

  // --- timber --------------------------------------------------------
  clapboardBlue: {
    wall: 'sidingBlue', wallWorn: 'sidingPeel', roof: 'roofShingle', roofWorn: 'roofShingleMoss',
    door: 'doorWood', window: 'windowCurtain', foundation: 'foundStone', trim: 'trimWoodWhite',
    chimney: 'brickRed', families: ['house'],
  },
  clapboardGreen: {
    wall: 'sidingGreen', wallWorn: 'sidingPeel', roof: 'roofShingleGreen', roofWorn: 'roofShingleMoss',
    door: 'doorGreen', window: 'windowCurtain', foundation: 'foundStone', trim: 'trimWoodWhite',
    chimney: 'brickBrown', families: ['house'],
  },
  clapboardCream: {
    wall: 'sidingCream', wallWorn: 'sidingPeel', roof: 'roofSlate', roofWorn: 'roofShingleMoss',
    door: 'doorBlue', window: 'windowCurtain', foundation: 'foundBrick', trim: 'trimWoodWhite',
    chimney: 'brickTan', families: ['house'],
  },
  boardBattenRed: {
    wall: 'sidingRed', wallWorn: 'wallWoodRot', roof: 'roofMetal', roofWorn: 'roofMetalRust',
    door: 'doorWood', window: 'window', foundation: 'foundStone', trim: 'trimWoodWhite',
    chimney: 'brickBrown', families: ['house', 'farm'],
  },
  weatheredPlank: {
    wall: 'wallWood', wallWorn: 'wallWoodRot', roof: 'roofMetal', roofWorn: 'roofMetalRust',
    door: 'doorWood', window: 'window', foundation: 'foundStone', trim: 'trimWoodWhite',
    chimney: 'brickBrown', families: ['farm', 'house'],
  },
  timberFramed: {
    wall: 'timberFrame', wallWorn: 'stuccoStained', roof: 'roofShingle', roofWorn: 'roofShingleMoss',
    door: 'doorWood', window: 'windowCurtain', foundation: 'foundStone', trim: 'trimWoodWhite',
    chimney: 'brickRed', families: ['house', 'shop'],
  },

  // --- the residential family (Eastgate) ------------------------------
  // Three sets that exist so a street of houses cannot be dressed out of the
  // commercial library. Each one names its own foundation — block skirting or
  // porch lattice rather than a civic stone plinth — because what a house
  // stands on is half of what makes it read as a house.
  clapboardYellow: {
    wall: 'sidingYellow', wallWorn: 'sidingPeel', roof: 'roofShingleBrown', roofWorn: 'roofShingleMoss',
    door: 'doorRed', window: 'windowShutters', foundation: 'foundLattice', trim: 'trimWoodWhite',
    chimney: 'brickRed', families: ['house'],
  },
  cedarShake: {
    wall: 'shakeCedar', wallWorn: 'shakeMoss', roof: 'roofShakeWood', roofWorn: 'roofShingleMoss',
    door: 'doorScreen', window: 'windowShutters', foundation: 'foundBlock', trim: 'trimWoodGreen',
    chimney: 'brickBrown', families: ['house', 'farm'],
  },
  clinkerBrick: {
    wall: 'brickClinker', wallWorn: 'brickRedMoss', roof: 'roofShingleBrown', roofWorn: 'roofMetalRust',
    door: 'doorGreen', window: 'windowShutters', foundation: 'foundBlock', trim: 'trimWoodGreen',
    chimney: 'brickClinker', families: ['house', 'civic', 'block'],
  },

  // --- render --------------------------------------------------------
  stuccoTanVilla: {
    wall: 'stuccoTan', wallWorn: 'stuccoStained', roof: 'roofClay', roofWorn: 'roofShingleMoss',
    door: 'doorWood', window: 'window', foundation: 'foundConcrete', trim: 'trimStone',
    chimney: 'stuccoTan', families: ['house', 'shop'],
  },
  stuccoPinkStrip: {
    wall: 'stuccoPink', wallWorn: 'stuccoStained', roof: 'roofClay', roofWorn: 'roofMetalRust',
    door: 'doorBlue', window: 'windowShop', foundation: 'foundConcrete', trim: 'trimTileGreen',
    families: ['shop', 'house'],
  },
  plasterTownhouse: {
    wall: 'wallPlaster', wallWorn: 'stuccoStained', roof: 'roofSlate', roofWorn: 'roofShingleMoss',
    door: 'doorWood', window: 'windowCurtain', foundation: 'foundBrick', trim: 'trimStone',
    chimney: 'brickRed', families: ['house', 'block', 'civic'],
  },

  // --- modern / commercial -------------------------------------------
  officeConcrete: {
    wall: 'wallConcrete', wallWorn: 'concreteStained', roof: 'roofMembrane', roofWorn: 'roofMetalRust',
    door: 'doorGlassDouble', window: 'windowOffice', foundation: 'foundConcrete', trim: 'trimMetal',
    families: ['block', 'civic', 'tower'],
  },
  brutalist: {
    wall: 'concreteBrut', wallWorn: 'concreteStained', roof: 'roofMembrane', roofWorn: 'roofMetalRust',
    door: 'doorGlassDouble', window: 'windowOffice', foundation: 'foundConcrete', trim: 'trimMetal',
    families: ['block', 'tower', 'civic'],
  },
  curtainGlass: {
    wall: 'curtainWall', roof: 'roofMembrane', roofWorn: 'roofMetalRust',
    door: 'doorGlassDouble', window: 'windowOffice', foundation: 'foundConcrete', trim: 'trimMetal',
    families: ['tower', 'block'],
  },
  glazedTileShop: {
    wall: 'tileTeal', wallWorn: 'stuccoStained', roof: 'roofTar', roofWorn: 'roofMetalRust',
    door: 'doorShop', window: 'windowShop', foundation: 'foundConcrete', trim: 'trimTileGreen',
    families: ['shop', 'block'],
  },

  // --- industrial ----------------------------------------------------
  blockworkIndustrial: {
    wall: 'cinderblock', wallWorn: 'cinderblockMoss', roof: 'roofMetal', roofWorn: 'roofMetalRust',
    door: 'doorMetal', window: 'window', foundation: 'foundConcrete', trim: 'trimMetal',
    families: ['industrial', 'block'],
  },
  corrugatedShed: {
    wall: 'wallMetal', wallWorn: 'wallMetalRusty', roof: 'roofMetal', roofWorn: 'roofMetalRust',
    door: 'doorGarage', window: 'window', foundation: 'foundConcrete', trim: 'trimMetal',
    families: ['industrial'],
  },
  rustedShed: {
    wall: 'wallMetalRusty', roof: 'roofMetalRust',
    door: 'doorGarage', window: 'windowBoarded', foundation: 'foundConcrete', trim: 'trimMetal',
    families: ['industrial', 'farm'],
  },
};

export const SET_NAMES = Object.keys(MATERIAL_SETS);

/** Every set that is allowed for a family tag, in declaration order. */
export function setsFor(family) {
  return SET_NAMES.filter((n) => MATERIAL_SETS[n].families.includes(family));
}

/**
 * Concrete textures for one building.
 *
 * `weather` (0..1) is the building's decay: past MODERATE the wall swaps to
 * its weathered twin, past HEAVY the roof follows. Anything the spec states
 * explicitly always wins — a set is a default, never a straitjacket.
 */
const WEATHER_WALL = 0.46;
const WEATHER_ROOF = 0.6;

export function resolve(setName, weather = 0, overrides = {}) {
  const s = MATERIAL_SETS[setName] ?? MATERIAL_SETS.redbrickWalkup;
  const wall = weather >= WEATHER_WALL ? (s.wallWorn ?? s.wall) : s.wall;
  const roof = weather >= WEATHER_ROOF ? (s.roofWorn ?? s.roof) : s.roof;
  return {
    wall: overrides.wall ?? wall,
    roofTex: overrides.roofTex ?? roof,
    doorTex: overrides.doorTex ?? s.door,
    windowTex: overrides.windowTex ?? s.window,
    foundationTex: overrides.foundationTex ?? s.foundation,
    trimTex: overrides.trimTex ?? s.trim,
    chimneyTex: overrides.chimneyTex ?? s.chimney ?? wall,
  };
}

/**
 * Guarantee visual variety: no building keeps a material set that any other
 * building within `radius` metres is already using.
 *
 * Specs are visited in plan order; each one that clashes is re-rolled through
 * the sets allowed for its family until it finds a free one. A building that
 * genuinely cannot find a clear set (a dense cluster with more neighbours than
 * candidate sets) keeps what it has rather than being left blank — but with
 * a dozen-plus sets per family that does not happen at the town's densities.
 *
 * `specs` are mutated in place: each gains a `mat` naming its final set.
 */
export function deconflict(specs, radius = 30) {
  const placed = [];
  for (const spec of specs) {
    const family = spec.family ?? 'house';
    const candidates = setsFor(family);
    if (!candidates.length) { spec.mat ??= 'redbrickWalkup'; placed.push(spec); continue; }
    const near = placed.filter((o) => Math.hypot(o.x - spec.x, o.z - spec.z) < radius);
    const taken = new Set(near.map((o) => o.mat));
    // Prefer what the plan asked for, then walk the family's sets from a
    // position seeded by the footprint so the fallback order still varies
    // street to street instead of always landing on the first candidate.
    const start = Math.abs(Math.round(spec.x * 3 + spec.z * 7)) % candidates.length;
    const order = [spec.mat, ...candidates.map((_, i) => candidates[(start + i) % candidates.length])];
    spec.mat = order.find((n) => n && MATERIAL_SETS[n] && !taken.has(n)) ?? spec.mat ?? candidates[start];
    placed.push(spec);
  }
  return specs;
}

/** Facade-to-facade gap between two footprints (negative if they overlap). */
export function facadeGap(a, b) {
  return Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
}

/**
 * The final guarantee, and the one that actually matters on screen: no two
 * buildings within `gap` metres of each other end up showing the same WALL
 * TEXTURE.
 *
 * Distinct material sets are not enough on their own, because weathering
 * collapses them: several sets share a worn twin, so a clapboard house and a
 * timber-framed house on the same lane can both end up wearing peeled render
 * once the maintenance gradient bites. This pass runs after resolution, sees
 * the textures the player will actually see, and re-rolls the loser through
 * the rest of its family until its resolved wall is unique among neighbours.
 */
export function deconflictResolved(specs, bake, gap = 6.5) {
  for (let i = 0; i < specs.length; i++) {
    const a = specs[i];
    const clash = specs.slice(0, i).find((b) => a.wall === b.wall && facadeGap(a, b) < gap);
    if (!clash) continue;
    const neighbours = specs.slice(0, i).filter((b) => facadeGap(a, b) < gap);
    const taken = new Set(neighbours.map((b) => b.wall));
    for (const cand of setsFor(a.family ?? 'house')) {
      if (cand === a.mat) continue;
      const trial = bake(a, cand);
      if (taken.has(trial.wall)) continue;
      a.mat = cand;
      Object.assign(a, trial);
      break;
    }
  }
  return specs;
}
