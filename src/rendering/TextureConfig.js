/**
 * Single source of truth for every texture and sprite sheet in the game.
 *
 * Replacing any file on disk (same name) reskins the game with zero code
 * changes. Adding an entry here makes it available everywhere through
 * TextureLib.get(name).
 *
 * `sprites` entries are processed at load time with an edge flood-fill that
 * turns the white background transparent while preserving interior whites
 * (bows, teeth). Drop any white-background sheet into assets/sprites/ and
 * list it here to use it.
 */
export const TEXTURE_DIR = 'assets/textures/';
export const SPRITE_DIR = 'assets/sprites/';

export const TEXTURES = {
  // ground
  grass: 'grass.png',
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
  // openings
  doorWood: 'door_wood.png',
  doorMetal: 'door_metal.png',
  doorShop: 'door_shop.png',
  window: 'window.png',
  windowBroken: 'window_broken.png',
  windowBoarded: 'window_boarded.png',
  windowShop: 'window_shop.png',
  awning: 'awning.png',
  // roofs / floors
  roofShingle: 'roof_shingle.png',
  roofSlate: 'roof_slate.png',
  roofMetal: 'roof_metal.png',
  roofTar: 'roof_tar.png',
  floorWood: 'floor_wood.png',
  floorTile: 'floor_tile.png',
  // nature
  bark: 'bark.png',
  leaves: 'leaves.png',
  bush: 'bush.png',
  grassTuft: 'grass_tuft.png',
  vine: 'vine.png',
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
  zombieBasic: 'npc_spritesheet_zombie_basic.png',
  npcExploder: 'npc_exploder.png',
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
