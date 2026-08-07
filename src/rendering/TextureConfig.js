/**
 * Single source of truth for every texture and sprite sheet in the game.
 *
 * Replacing any file on disk (same name) reskins the game with zero code
 * changes. Adding an entry here makes it available everywhere through
 * TextureLib.get(name).
 *
 * `sprites` entries are processed at load time: an edge flood-fill turns the
 * white background transparent while preserving interior whites (bows, teeth),
 * then the antialiased fringe left along the silhouette is un-matted back to
 * the art's own colour so sprites do not wear a light halo. Drop any
 * white-background sheet into assets/sprites/ and list it here to use it.
 */
export const TEXTURE_DIR = 'assets/textures/';
export const SPRITE_DIR = 'assets/sprites/';

export const TEXTURES = {
  // ground. Four grasses, blended across the map by src/world/Terrain.js —
  // a kept lawn, a parched one, deep park growth and unmown meadow.
  grass: 'grass.png',
  grassDry: 'grass_dry.png',
  grassLush: 'grass_lush.png',
  grassWild: 'grass_wild.png',
  dirt: 'dirt.png',
  gravel: 'gravel.png',
  road: 'road_asphalt.png',
  roadLine: 'road_line.png',
  crosswalk: 'crosswalk.png',
  sidewalk: 'sidewalk.png',
  concrete: 'concrete.png',
  water: 'water.png',
  // walls
  brickRed: 'wall_brick_red.png',
  brickGray: 'wall_brick_gray.png',
  brickTan: 'wall_brick_tan.png',
  brickCracked: 'wall_brick_cracked.png',
  wallWood: 'wall_wood.png',
  wallPlaster: 'wall_plaster.png',
  wallConcrete: 'wall_concrete.png',
  wallMetal: 'wall_metal.png',
  wallMetalRusty: 'wall_metal_rust_heavy.png',
  wallStone: 'wall_stone.png',
  marbleWhite: 'wall_marble.png',
  goldMetal: 'gold.png',
  archNiche: 'arch_niche.png',
  goldScreen: 'gold_screen.png',
  stuccoTan: 'wall_stucco_tan.png',
  sidingBlue: 'wall_siding_blue.png',
  sidingGreen: 'wall_siding_green.png',
  // walls, second family set (see src/world/Materials.js — every building
  // draws a coherent wall/roof/door/window/foundation/trim set from there, and
  // no two neighbours get the same one)
  brickBrown: 'wall_brick_brown.png',
  brickPainted: 'wall_brick_painted.png',
  concreteBrut: 'wall_concrete_brut.png',
  stuccoPink: 'wall_stucco_pink.png',
  sidingCream: 'wall_siding_cream.png',
  sidingRed: 'wall_siding_red.png',
  tileTeal: 'wall_tile_teal.png',
  curtainWall: 'wall_curtain.png',
  cinderblock: 'wall_cinderblock.png',
  timberFrame: 'wall_timber_frame.png',
  // walls, residential family (Eastgate): painted clapboard, split cedar
  // shakes and dark clinker brick — the materials a street of houses is made
  // of, kept out of the commercial sets so the districts never read alike.
  sidingYellow: 'wall_siding_yellow.png',
  shakeCedar: 'wall_shake_cedar.png',
  brickClinker: 'wall_brick_clinker.png',
  // weathered twins: the same material after years of rain. Buildings swap to
  // these as the maintenance gradient falls off toward the map rim.
  brickRedMoss: 'wall_brick_red_moss.png',
  sidingPeel: 'wall_siding_peel.png',
  stuccoStained: 'wall_stucco_stained.png',
  concreteStained: 'wall_concrete_stained.png',
  wallWoodRot: 'wall_wood_rot.png',
  cinderblockMoss: 'wall_cinderblock_moss.png',
  shakeMoss: 'wall_shake_moss.png',
  // foundations (half-height tiles: the footing under every building)
  foundStone: 'foundation_stone.png',
  foundConcrete: 'foundation_concrete.png',
  foundBrick: 'foundation_brick.png',
  foundBlock: 'foundation_block.png',
  foundLattice: 'foundation_lattice.png',
  // trim bands (belt courses, cornices, shopfront sills)
  trimWoodWhite: 'trim_wood_white.png',
  trimStone: 'trim_stone.png',
  trimMetal: 'trim_metal.png',
  trimTileGreen: 'trim_tile_green.png',
  trimWoodGreen: 'trim_wood_green.png',
  // openings
  doorWood: 'door_wood.png',
  doorMetal: 'door_metal.png',
  doorShop: 'door_shop.png',
  doorBlue: 'door_blue.png',
  doorGreen: 'door_green.png',
  doorApartment: 'door_apartment.png',
  doorGarage: 'door_garage.png',
  doorGlassDouble: 'door_double_glass.png',
  doorRed: 'door_red.png',
  doorScreen: 'door_screen.png',
  window: 'window.png',
  windowBroken: 'window_broken.png',
  windowBoarded: 'window_boarded.png',
  windowShop: 'window_shop.png',
  windowCurtain: 'window_curtain.png',
  windowOffice: 'window_office.png',
  windowLit: 'window_lit.png',
  windowArched: 'window_arched.png',
  windowShutters: 'window_shutters.png',
  awning: 'awning.png',
  // roofs / floors
  roofShingle: 'roof_shingle.png',
  roofSlate: 'roof_slate.png',
  roofMetal: 'roof_metal.png',
  roofTar: 'roof_tar.png',
  roofClay: 'roof_clay.png',
  roofShingleGreen: 'roof_shingle_green.png',
  roofShingleMoss: 'roof_shingle_moss.png',
  roofMetalRust: 'roof_metal_rust.png',
  roofMembrane: 'roof_membrane.png',
  roofShingleBrown: 'roof_shingle_brown.png',
  roofShakeWood: 'roof_shake_wood.png',
  floorWood: 'floor_wood.png',
  floorTile: 'floor_tile.png',
  carpetRed: 'carpet_red.png',
  linoleum: 'linoleum.png',
  ceilingTile: 'ceiling_tile.png',
  wallpaperFloral: 'wallpaper_floral.png',
  wallTileWhite: 'wall_tile_white.png',
  // nature
  bark: 'bark.png',
  leaves: 'leaves.png',
  bush: 'bush.png',
  grassTuft: 'grass_tuft.png',
  grassTuftDry: 'grass_tuft_dry.png',
  grassTuftWild: 'grass_tuft_wild.png',
  vine: 'vine.png',
  // residential planting: clipped boundary hedges, garden flowers, the dry
  // weeds that come up through a pavement crack, and wall ivy
  hedge: 'hedge.png',
  flowers: 'flowers.png',
  weeds: 'weeds.png',
  ivy: 'ivy.png',
  // props
  crate: 'crate.png',
  metalRust: 'metal_rust.png',
  rubble: 'rubble.png',
  rock: 'rock.png',
  barricade: 'barricade.png',
  manhole: 'manhole.png',
  shadowDecal: 'shadow_decal.png',
  graffiti: 'graffiti.png',
  oilStain: 'oil_stain.png',
  chainlink: 'chainlink.png',
  barrelHazard: 'barrel_hazard.png',
  pallet: 'pallet.png',
  tvStatic: 'tv_static.png',
  posterNotice: 'poster_notice.png',
  signShop: 'sign_shop.png',
  fabricCouch: 'fabric_couch.png',
  rampart: 'wall_rampart.png',
  picketFence: 'fence_picket.png',
  tarpBlue: 'tarp_blue.png',
  chalkHopscotch: 'chalk_hopscotch.png',
  // effects
  muzzleFlash: 'muzzle_flash.png', // used by the 3D weapon muzzle flash
  blood: 'blood.png',
  smoke: 'smoke.png',
  // pickups
  ammoBox: 'ammo_box.png',
  healthPack: 'health_pack.png',
  key: 'key.png',
  // NOTE: the old 2D first-person weapon sprites were removed — weapons are
  // now real 3D models (src/weapons/WeaponModels.js + WeaponView.js).
};

export const SPRITES = {
  npcPeaceful: 'npc_spritesheet_peacefull.png',
  zombieBasic: 'npc_zombie_basic_update.png',
  // The Exploder's CS:GO retexture — a masked, turban'd bomber in a green vest
  // strapped with red charges. Standard 3x4 walk-cycle sheet: the top (front)
  // row carries the aim/fire frames the enemy shows the player while it primes.
  npcExploder: 'npc_csgo_exploder_update_skin.png',
  spitter: 'npc_csgo_midrange_double_pistol_gunholder.png',
  // The savable citizen: bound and hooded while captured, swapped to the
  // second sheet the instant she's freed (see entities/Citizen.js). Both are
  // standard 3x4 walk-cycle sheets, same layout as npcPeaceful.
  citizenCaptured: 'npc_save_captured.png',
  citizenReleased: 'npc_save_release.png',
};

/** Layout of the 3x4 walk-cycle sheets (RPG-Maker style). */
export const SHEET_LAYOUT = {
  cols: 3,
  rows: 4,
  // row index per facing, relative to the viewer
  row: { front: 0, left: 1, right: 2, back: 3 },
  // frame column sequence for a walk cycle
  walkFrames: [0, 1, 2, 1],
};

/**
 * Layout of the Exploder sheet (npc_csgo_exploder_update_skin.png, 512x1024).
 *
 * It is a standard 3x4 walk-cycle sheet, BUT the hand-drawn figures overrun a
 * naive 256px grid: the front/back rows are ~261px tall and every sprite's feet
 * spill a dozen-odd pixels past their nominal cell boundary into the row below.
 * Read on a uniform grid, that overspill surfaced as a slice of the previous
 * row's boots at the TOP of the next cell — feet hovering above the head when
 * the bomber turned. So each row is addressed by its own measured top/bottom
 * band (`rowTop`/`rowBottom`, image-Y of the head line and the feet) instead of
 * an even grid, cropping every facing to just its own figure — feet on the
 * ground, no bleed. Columns stay an even 3-way split.
 */
export const EXPLODER_LAYOUT = {
  cols: 3,
  rows: 4,
  imgW: 512,
  imgH: 1024,
  row: { front: 0, left: 1, right: 2, back: 3 },
  walkFrames: [0, 1, 2, 1],
  rowTop: [11, 283, 523, 764],       // head line (image-Y) per row
  rowBottom: [272, 516, 755, 1023],  // feet baseline (image-Y) per row
  // Cell aspect (column width / typical figure height) so the plane never
  // distorts the sprite.
  aspect: (512 / 3) / 256,
};

/**
 * Layout of the Spitter sheet (npc_csgo_midrange_double_pistol_gunholder.png,
 * 512x1500). It is a standard 3-column walk-cycle sheet with an EXTRA top row
 * of front-facing combat poses:
 *
 *   row 0 — special: col 0 = FIRE (dual muzzle flash), col 1 = AIM (guns raised)
 *   row 1 — front walk cycle
 *   row 2 — left  walk cycle
 *   row 3 — right walk cycle
 *   row 4 — back  walk cycle
 *
 * The hand-drawn rows are NOT evenly pitched, so instead of a naive uniform
 * grid each row is addressed by its own feet baseline (`rowBottom`, the image-Y
 * of the sprite's feet) and a shared cell size. Billboard UVs are derived from
 * these anchors, which keeps every frame the same scale and feet-aligned so the
 * character never jumps as it switches between walking, aiming and firing.
 */
export const SPITTER_LAYOUT = {
  cols: 3,
  rows: 5,
  imgW: 512,
  imgH: 1500,
  cellW: 512 / 3,           // ~170.67px per column
  cellH: 236,               // uniform cell height (tallest row band)
  rowBottom: [429, 730, 985, 1241, 1499], // feet baseline (image-Y) per row
  // Walk rows sit one below the standard sheet because row 0 is the pose row.
  row: { front: 1, left: 2, right: 3, back: 4 },
  walkFrames: [0, 1, 2, 1],
  // Static combat poses, front-facing (the Spitter faces the player to shoot).
  pose: { fire: { col: 0, row: 0 }, aim: { col: 1, row: 0 } },
  // Cell aspect (width/height) so the billboard plane never distorts the sprite.
  aspect: (512 / 3) / 236,
};
