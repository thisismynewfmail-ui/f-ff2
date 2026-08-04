import * as THREE from '../../lib/three.module.js';
import { Terrain, EDGE_LIMIT } from './Terrain.js';
import { CollisionWorld } from './Collision.js';
import { NavGrid } from './NavGrid.js';
import { BuildingKit, mergeStatic, mulberry32 } from './Buildings.js';
import { InteriorKit, housePartitions, officePartitions, lobbyPartitions } from './Interiors.js';
import { PropKit } from './Props.js';
import { Vegetation } from './Vegetation.js';
import { Zones, ZONES } from './Zones.js';
import { Secrets } from './Secrets.js';
import { Anomalies } from './Anomalies.js';
import { CompanionCube } from './CompanionCube.js';
import { Scarecrow } from './Scarecrow.js';
import { deconflict, deconflictResolved, resolve } from './Materials.js';
import { WorldBarrier } from './Boundary.js';

/** Outward normal of each door side, and the lane kept clear in front of it. */
const DOOR_NORMAL = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const DOOR_APPROACH = 3.4;
const DOOR_LANE_HALF = 1.6;
// How much two solid footprints may overlap before it reads as a mistake.
// Small enough to catch a stall clipping a wall, loose enough that props
// deliberately tucked against something aren't refused.
const PROP_CLEARANCE = 0.12;

/** Which material-set family a building's function draws from. */
const FAMILY_FOR_USE = {
  house: 'house', hollow: 'house', apartment: 'block',
  tavern: 'shop', store: 'shop', bakery: 'shop', postOffice: 'shop', gasShop: 'shop',
  diner: 'shop', pawnShop: 'shop', boutique: 'shop', arcade: 'shop', barbers: 'shop',
  laundromat: 'shop', hardware: 'shop', pharmacy: 'shop', recordShop: 'shop',
  library: 'civic', townhall: 'civic', clinic: 'civic', school: 'civic',
  office: 'civic', towerLobby: 'tower', museum: 'civic', firehouse: 'civic',
  church: 'church',
  warehouse: 'industrial', warehouseMezz: 'industrial', factory: 'industrial',
  machineShop: 'industrial', substation: 'industrial',
  barn: 'farm', boathouse: 'farm',
};

/**
 * Assembles the whole town: terrain, six districts of buildings, streets,
 * props, vegetation, zone barriers and secrets. Exposes the queries the rest
 * of the game needs: walkable ground height, surface type underfoot,
 * spawn/loot points and nearby interactables.
 *
 * District tour (kill-count unlock order):
 *   0 Old Town Square  — claustrophobic walled plaza, the starting hub
 *   1 Eastgate         — houses on a rolling knoll, picket fences
 *   2 Downtown         — dense graded city grid, the visual centerpiece
 *   3 Hollow Park      — ravine, pond and dense woods
 *   4 Southside        — flat industrial yards and warehouses
 *   5 Chapel Ridge     — a 16 m hill with a chapel and graveyard
 */
export class World {
  constructor(events, texLib, scene) {
    this.events = events;
    this.texLib = texLib;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.terrain = new Terrain();
    this.collision = new CollisionWorld();
    this.nav = new NavGrid(this.terrain);
    this.kit = new BuildingKit(texLib, this.collision, this.nav);
    this.props = new PropKit(texLib, this.collision, this.nav, this.terrain);
    this.veg = new Vegetation(texLib, this.collision, this.nav, this.terrain);

    this.spawnPoints = [];   // {x, z, zone, indoor}
    this.lootPoints = [];    // {x, z, zone}
    this.surfaces = [];      // {minX,maxX,minZ,maxZ, surface}
    this.interactables = []; // {x, z, y, radius, prompt, onInteract, enabled}
    this.shootables = [];    // {x, y, z, r, onHit, active} — sphere bullet targets
    this.buildingSpecs = [];
    this.npcSpawn = { x: 3, z: 8 };
    this.playerSpawn = { x: 0, z: 20 };
    this.game = null;            // set by attach()
    // dynamic-prop registries, animated by Anomalies each frame
    this.doorwayRejects = [];    // props refused for standing somewhere solid
    this._solids = [];           // footprints of placed solid props
    this.beacons = [];           // {mesh, phase} — tower aviation lights
    this.windmillRotors = [];
    this.playgroundSwings = [];
    this.spinners = [];          // {node, speed} — carousel decks
    this.flags = [];             // {strips[], phase} — rippling cloth
    this.ropeSwings = [];        // pivots that keep an arc nobody started
    this.waterSurfaces = [];     // {mat, u, v} — sheets whose UVs drift
    this.alarmCars = [];         // {x, y, z, lights[]} — shootable car alarms
    this.phoneBoothPos = null;
  }

  /** Give the world (and its secrets/anomalies) access to the live game. */
  attach(game) {
    this.game = game;
    this.secrets.attach(game);
  }

  build() {
    // Terrain features first, buildings second: pads are applied in the order
    // they were registered, so whichever is added LAST wins inside its own
    // footprint. Registering the pond basin first is what stops it undercutting
    // the boathouse standing on its bank.
    this._planTerrain();            // pond basin
    this._planBuildings();          // building pads, which override it locally
    this.group.add(this.terrain.buildMesh(this.texLib));
    this._roads();
    this._constructBuildings();
    this.zones = new Zones(this.events, this.props, this.collision, this.nav, this.terrain, this.group);
    this._oldTown();
    this._eastgate();
    this._downtown();
    this._park();
    this._industrial();
    this._ridge();
    this._highrise();
    this._cityInteractables();
    // The edge of the world. Never sinks, never opens — see Boundary.js.
    this.barrier = new WorldBarrier({
      texLib: this.texLib, collision: this.collision, nav: this.nav,
      terrain: this.terrain, group: this.group,
    }).build();
    this.nav.bake();
    this._spawnGrid();
    this.secrets = new Secrets(this);
    this.anomalies = new Anomalies(this);
    this.companionCube = new CompanionCube(this);
    this.scarecrow = new Scarecrow(this);
    return this;
  }

  /* ---------------- queries ---------------- */

  groundHeightFor(x, z, y) { return this.terrain.groundHeightFor(x, z, y); }

  surfaceAt(x, z) {
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const s = this.surfaces[i];
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s.surface;
    }
    return 'grass';
  }

  addSurface(minX, minZ, maxX, maxZ, surface) {
    this.surfaces.push({ minX, maxX, minZ, maxZ, surface });
  }

  addShootable(s) {
    this.shootables.push({ active: true, ...s });
  }

  /**
   * Nearest active shootable target along a ray, or null.
   * Returns { target, dist }; caller invokes target.onHit() and deactivates
   * it when onHit returns true.
   */
  raycastShootables(origin, dir, maxDist) {
    let best = null, bestD = maxDist;
    for (const s of this.shootables) {
      if (!s.active) continue;
      const ox = s.x - origin.x, oy = s.y - origin.y, oz = s.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > bestD) continue;
      const px = origin.x + dir.x * t - s.x;
      const py = origin.y + dir.y * t - s.y;
      const pz = origin.z + dir.z * t - s.z;
      if (px * px + py * py + pz * pz <= s.r * s.r && t < bestD) {
        best = s; bestD = t;
      }
    }
    return best ? { target: best, dist: bestD } : null;
  }

  addInteractable(it) {
    // Store and return the SAME object (defaults filled in), so a caller can
    // keep the handle and move its interactable later (the Companion Cube
    // re-seats its prompt wherever it gets dropped).
    if (it.radius === undefined) it.radius = 2.2;
    if (it.enabled === undefined) it.enabled = () => true;
    this.interactables.push(it);
    return it;
  }

  /** Drop an interactable registered by addInteractable(). Fixtures never need
   *  this, but an entity that comes and goes (the savable citizen, one per
   *  wave roll) does: its handle closes over the entity, so leaving spent
   *  prompts on the list pins every disposed sprite for the rest of the run. */
  removeInteractable(it) {
    const i = this.interactables.indexOf(it);
    if (i >= 0) this.interactables.splice(i, 1);
  }

  nearestInteractable(x, y, z) {
    let best = null, bestD = Infinity;
    for (const it of this.interactables) {
      if (!it.enabled()) continue;
      const d = Math.hypot(it.x - x, it.z - z) + Math.abs((it.y ?? y) - y) * 0.5;
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  /** Line of sight between two points: buildings/props AND terrain. */
  hasLineOfSight(ax, ay, az, bx, by, bz) {
    if (this.collision.segmentBlocked(ax, ay, az, bx, by, bz)) return false;
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.floor(dist / 7));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const h = this.terrain.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (h > ay + (by - ay) * t + 0.25) return false;
    }
    return true;
  }

  clampToWorld(pos) {
    pos.x = Math.max(-EDGE_LIMIT, Math.min(EDGE_LIMIT, pos.x));
    pos.z = Math.max(-EDGE_LIMIT, Math.min(EDGE_LIMIT, pos.z));
    return pos;
  }

  update(dt, time, cameraPos) {
    this.updateAmbient(dt, time, cameraPos);
    this.secrets.update(dt);
  }

  /** The visual/ambient systems only — no secret triggers — so the title
   *  menu's cinematic orbit can run the living town without touching a run. */
  updateAmbient(dt, time, cameraPos) {
    this.zones.update(dt);
    this.veg.update(time, cameraPos);
    this.anomalies.update(dt, time, cameraPos);
    this.companionCube.update(dt, time);
    this.scarecrow.update(dt, time, cameraPos);
    this._updateClock();
  }

  /** Drive the tower clock from the sky: phase 0 = sunrise = 06:00. */
  _updateClock() {
    const sky = this.game?.sky;
    if (!sky || !this.clockHands) return;
    const hours = (sky.phase * 24 + 6) % 24;
    this.clockHands.hour.rotation.z = -((hours % 12) / 12) * Math.PI * 2;
    this.clockHands.minute.rotation.z = -(hours % 1) * Math.PI * 2;
  }

  /* ---------------- construction ---------------- */

  _spec(spec) {
    spec.y = this.terrain.padAtGrade(spec.x, spec.z, spec.w / 2 + 1, spec.d / 2 + 1);
    spec.derelict ??= this._derelictFor(spec.x, spec.z, spec.zone);
    spec.weather ??= this._weatherFor(spec.x, spec.z, spec.zone);
    spec.family ??= FAMILY_FOR_USE[spec.use] ?? (spec.solid ? 'block' : 'house');
    this.buildingSpecs.push(spec);
    return spec;
  }

  /**
   * Maintenance gradient: the town core is kept up, condition decays toward
   * the map rim, downtown reads abandoned, and the industrial zone carries
   * its own heavier decay signature. Drives boarded/broken windows.
   */
  _derelictFor(x, z, zone) {
    let v = 0.08 + Math.min(1, Math.hypot(x, z) / 250) * 0.6;
    if (zone === 0) v *= 0.45;
    else if (zone === 2) v = Math.max(v, 0.42);
    else if (zone === 4) v = Math.max(v, 0.58);
    return Math.min(0.85, v);
  }

  /**
   * Spatial weathering, 0..1. This is the value that decides whether a
   * building wears its clean texture or its weathered twin (moss to the sill
   * line, paint off the boards, render blown off the brick).
   *
   * The commercial core is swept and intact; condition falls away with
   * distance, and it falls away SLOWLY at first — the curve is squared — so
   * the change reads as a gradient across the town rather than a ring of
   * decay drawn around the plaza. Districts that were lost before the rest
   * carry a floor of their own on top of that.
   */
  _weatherFor(x, z, zone) {
    let v = Math.min(1, Math.hypot(x, z) / 235);
    v = v * v * 0.95;
    if (zone === 0) v *= 0.22;              // the square is still being kept
    else if (zone === 2) v = Math.max(v, 0.36); // downtown emptied first
    else if (zone === 4) v = Math.max(v, 0.68); // the yards rusted long before
    else if (zone === 5) v = Math.max(v, 0.72); // nobody has climbed the ridge in years
    return Math.min(1, v);
  }

  /**
   * Give every building a coherent material set, then guarantee no two
   * neighbours share one, then bake the set (plus this building's weathering)
   * down to the concrete wall/roof/door/window/foundation/trim textures the
   * BuildingKit consumes. Anything a spec states outright survives untouched.
   */
  _assignMaterials() {
    // What the plan stated outright is honoured to the end; everything else
    // is the set's to decide. Captured before the first bake, because baking
    // writes the resolved textures onto the spec itself.
    const stated = new Map(this.buildingSpecs.map((s) => [s, {
      wall: s.wall, roofTex: s.roofTex, doorTex: s.doorTex, windowTex: s.windowTex,
      foundationTex: s.foundationTex, trimTex: s.trimTex, chimneyTex: s.chimneyTex,
    }]));
    const bake = (s, setName) => resolve(setName, s.weather, stated.get(s));
    deconflict(this.buildingSpecs, 32);
    for (const s of this.buildingSpecs) Object.assign(s, bake(s, s.mat));
    deconflictResolved(this.buildingSpecs, bake);
  }

  /**
   * Terrain features that are not buildings. Everything here has to be
   * registered BEFORE Terrain.buildMesh runs, or the ground mesh is displaced
   * without it and the feature ends up floating over its own hole.
   */
  _planTerrain() {
    // The pond basin: a shallow bowl sunk into the ravine floor, with a long
    // blend so the banks shelve into it instead of stepping down.
    const x = -150, z = 85;
    const floorY = this.terrain.baseHeight(x, z) - 1.7;
    const hx = 13, hz = 11, blend = 12;
    this.terrain.addPad(x, z, hx, hz, floorY, blend);
    // rx/rz bound the water itself. Without them the sheet follows the pad's
    // blend wherever the ground happens to stay low, and the lake creeps
    // twenty-five metres out to lap at the boathouse.
    this.pondBasin = { x, z, hx, hz, blend, floorY, level: floorY + 1.25, rx: hx + 6.0, rz: hz + 5.5 };
  }

  _planBuildings() {
    const S = (o) => this._spec(o);
    // --- Old Town (zone 0): the kept-up civic heart around the plaza.
    // Commercial fronts face the square; the two cottages face the plaza too.
    S({ x: -18, z: -14, w: 12, d: 9, h: 4.6, mat: 'redbrickWalkup', roof: 'gable', door: 'S', chimney: true, shopfront: true, awning: true, name: 'tavern', use: 'tavern', zone: 0 });
    S({ x: 15, z: -17, w: 10, d: 8, h: 4.2, mat: 'paintedBrickShop', roof: 'flat', door: 'S', shopfront: true, awning: true, name: 'store', use: 'store', zone: 0 });
    S({ x: -17, z: 13, w: 8, d: 7, h: 3.8, mat: 'plasterTownhouse', roof: 'gable', door: 'E', chimney: true, partitions: housePartitions(8, 7, 'E'), name: 'npcHouse', use: 'house', zone: 0 });
    S({ x: 14, z: 15, w: 5, d: 5, h: 14, mat: 'greyBrickCivic', family: 'civic', roof: 'flat', solid: true, name: 'clocktower', zone: 0 });
    S({ x: -32, z: 26, w: 7, d: 6, h: 3.8, mat: 'stuccoTanVilla', roof: 'gable', door: 'E', shopfront: true, awning: true, name: 'bakery', use: 'bakery', zone: 0 });
    S({ x: 28, z: 26, w: 8, d: 6, h: 4.0, mat: 'tanBrickDeco', roof: 'flat', door: 'W', name: 'postOffice', use: 'postOffice', zone: 0 });
    S({ x: 34, z: -30, w: 7, d: 6, h: 3.6, mat: 'clapboardGreen', roof: 'gable', door: 'W', chimney: true, partitions: housePartitions(7, 6, 'W'), name: 'cottage', use: 'house', zone: 0 });

    // --- Eastgate Residential (zone 1): neighbourhoods along shared streets.
    // Doors face the road each row fronts; material sets rotate so no two
    // neighbours match; density thins toward the map edge.
    const houseSets = [
      'redbrickWalkup', 'clapboardBlue', 'stuccoTanVilla', 'plasterTownhouse',
      'clapboardGreen', 'weatheredPlank', 'clapboardCream', 'timberFramed',
      'boardBattenRed', 'brownBrickTenement',
    ];
    const houses = [
      // Main St row (fronting the z≈0 road)
      [70, -14, 'S', 0], [92, -16, 'S', 1], [116, -15, 'S', 2], [142, -18, 'S', 3],
      [72, 24, 'N', 2], [95, 18, 'N', 3], [120, 60, 'W', 1, true], [145, 16, 'N', 0],
      // north loop (x=100/x=168 ring)
      [92, -48, 'E', 1], [92, -74, 'E', 0], [128, -78, 'S', 2], [162, -48, 'W', 3],
      // south loop
      [110, 42, 'S', 4], [140, 68, 'N', 1], [172, 40, 'W', 2], [190, -20, 'S', 3, true],
      // second wave: loop infill + spread-out outskirt places
      [110, -32, 'W', 4], [134, -44, 'N', 5], [152, -30, 'E', 6],
      [98, 52, 'W', 7], [126, 90, 'N', 4], [170, 92, 'N', 6],
      [206, 60, 'W', 5], [208, -44, 'W', 7],
      // third wave: the west lanes near Foundry Rd, the far-east outskirts and
      // the back row above the south loop — the neighbourhood finally reads full
      [60, 44, 'E', 3], [60, 78, 'E', 6], [100, 72, 'S', 1], [160, 96, 'N', 5],
      [196, 82, 'N', 2], [216, 20, 'W', 0], [228, -18, 'W', 4], [186, -58, 'S', 7],
    ];
    let hi = 0;
    for (const [hx, hz, door, style, solid] of houses) {
      const w = 9 + (hi % 3), d = 7 + ((hi + 1) % 2) * 2;
      S({ x: hx, z: hz, w, d, h: 3.8 + (hi % 2) * 0.5, mat: houseSets[(style + hi) % houseSets.length],
          roof: 'gable', door, chimney: true,
          solid: !!solid, partitions: solid ? undefined : housePartitions(w, d, door), name: 'house' + hi, use: 'house', zone: 1 });
      hi++;
    }
    S({ x: 150, z: -70, w: 10, d: 16, h: 6, mat: 'coursedStone', roof: 'gable', door: 'S', name: 'church', use: 'church', zone: 1 });
    S({ x: 105, z: 30, w: 9, d: 7, h: 4, mat: 'glazedTileShop', roof: 'flat', door: 'N', shopfront: true, awning: true, name: 'cornerShop', use: 'store', zone: 1 });
    S({ x: 70, z: 13, w: 7, d: 6, h: 3.6, mat: 'officeConcrete', roof: 'shed', roofTex: 'roofMetal', floor: 'floorTile', door: 'W', doorTex: 'doorShop', name: 'gasEast', use: 'gasShop', zone: 1 });
    // The hollow cottage: an ordinary house from the street. Its interior
    // (see Interiors._hollow) is walled almost a metre inside its exterior.
    S({ x: 82, z: 96, w: 8, d: 7, h: 3.9, mat: 'plasterTownhouse', roof: 'gable', door: 'S', chimney: true, name: 'hollowCottage', use: 'hollow', zone: 1 });

    // --- Downtown (zone 2): blocks between streets x=-100,-50,0 / z=-70,-120,-170,-220
    const blocks = [
      [-75, -95, 16, 12, 8, 'coursedStone', 'S', 'library', false, 'library'],
      [-25, -92, 14, 11, 7, 'officeConcrete', 'S', 'office', false, 'office'],
      [-122, -95, 12, 10, 9, 'brownBrickTenement', 'E', 'apartmentA', true],
      [-75, -145, 13, 10, 8, 'stuccoPinkStrip', 'N', 'diner', false, 'diner'],
      [-25, -145, 12, 10, 9, 'redbrickWalkup', 'W', 'apartmentB', false, 'apartment'],
      [-122, -145, 14, 11, 8, 'tanBrickDeco', 'E', 'theater', true],
      [-75, -195, 15, 12, 9, 'greyBrickCivic', 'S', 'department', true],
      [-25, -195, 12, 10, 7, 'plasterTownhouse', 'S', 'pawnShop', false, 'pawnShop'],
      [-122, -195, 12, 10, 8, 'brownBrickTenement', 'E', 'hotel', true],
      [22, -95, 12, 10, 7, 'glazedTileShop', 'W', 'mannequinShop', false, 'boutique'],
      [22, -145, 13, 10, 8, 'brutalist', 'W', 'bank', true],
      [22, -195, 12, 10, 7, 'paintedBrickShop', 'W', 'arcade', false, 'arcade'],
    ];
    const shopfronts = new Set(['diner', 'pawnShop', 'boutique', 'arcade']);
    for (const [bx, bz, w, d, h, mat, door, name, solid, use] of blocks) {
      S({ x: bx, z: bz, w, d, h, mat, roof: 'flat', floor: 'floorTile', door, solid: !!solid, name, use,
          shopfront: shopfronts.has(use), awning: shopfronts.has(use), zone: 2 });
    }
    // Institutional strip north of the grid: civic buildings face the z=-70
    // road, central and reachable from every district.
    S({ x: -75, z: -57, w: 14, d: 9, h: 6, mat: 'tanBrickDeco', roof: 'flat', floor: 'floorTile', door: 'N', name: 'townHall', use: 'townhall', zone: 2 });
    S({ x: -25, z: -57, w: 11, d: 8, h: 5, mat: 'greyBrickCivic', roof: 'flat', floor: 'linoleum', door: 'N', name: 'clinic', use: 'clinic', zone: 2 });
    // School east of the grid, on the extended z=-120 road, yard behind it
    // (kept clear of the zone-1 border wall running along z=-110).
    S({ x: 58, z: -102, w: 15, d: 11, h: 6, mat: 'redbrickWalkup', family: 'civic', roof: 'flat', floor: 'linoleum', door: 'S', name: 'school', use: 'school', zone: 2 });
    // Third gas station serving the south end of the grid.
    S({ x: 34, z: -227, w: 7, d: 6, h: 3.6, mat: 'officeConcrete', roof: 'shed', roofTex: 'roofMetal', floor: 'floorTile', door: 'N', doorTex: 'doorShop', name: 'gasDowntown', use: 'gasShop', zone: 2 });

    // Street-wall shops facing the z=-120 cross street, in pairs with a 3 m
    // service alley between them (see _alleys): the flanking routes that make
    // the grid worth learning. All enterable, all stocked.
    // Spacing is not cosmetic here: the nav grid's cells are 2 m and a
    // blockBox rounds OUT to whole cells, so a three-metre slot between two
    // buildings is swallowed whole and nothing can path down it. Each gap is
    // 6.5 m, which always leaves two clear cells — narrow enough to be an
    // alley, wide enough to be a route. See _alleys().
    // Frontages, left to right, with a 6.5 m slot between each pair:
    //   infill0 [-96.5,-88.5] | laundromat [-82,-74] | pharmacy [-67.5,-56.5]
    //   recordShop [-46.5,-37.5] | barbers [-31,-23] | infill1 [-16.5,-8.5]
    const strip = [
      [-62, -110, 11, 9, 4.8, 'N', 'pharmacy', 'pharmacy', 'stuccoPinkStrip'],
      [-78, -110, 8, 9, 5.2, 'N', 'laundromat', 'laundromat', 'glazedTileShop'],
      [-42, -110, 9, 9, 5.0, 'N', 'recordShop', 'recordShop', 'paintedBrickShop'],
      [-27, -110, 8, 9, 4.6, 'N', 'barbers', 'barbers', 'timberFramed'],
      [14, -110, 10, 9, 5.4, 'N', 'hardware', 'hardware', 'brownBrickTenement'],
    ];
    for (const [bx, bz, w, d, h, door, name, use, mat] of strip) {
      S({ x: bx, z: bz, w, d, h, mat, roof: 'flat', floor: 'floorTile', door, name, use,
          shopfront: true, awning: true, zone: 2 });
    }
    // The firehouse: roll-up bay doors onto the z=-120 street, a landmark in
    // its own right and the one downtown interior with a clear open span.
    // Bay doors onto the z=-120 street, which lies to the SOUTH of it — the
    // appliance has to be able to get out onto the carriageway.
    S({ x: -70, z: -129.5, w: 12, d: 10, h: 6.2, mat: 'redbrickWalkup', family: 'civic', roof: 'flat',
        floor: 'concrete', door: 'S', doorTex: 'doorGarage', name: 'firehouse', use: 'firehouse', zone: 2 });

    // Downtown infill: extra buildings inside the blocks (clear of streets
    // at x=-100/-50/0 and z=-70/-120/-170/-220) so the grid reads dense.
    // Varied heights + materials so no adjacent pair matches.
    const infill = [
      [-92.5, -110, 8, 9, 8], [-12.5, -110, 8, 9, 7],
      [-60, -158, 8, 8, 9],
      [-134, -110, 8, 8, 12], [34, -128, 8, 8, 9],
      [-132, -160, 8, 8, 8], [-10, -180, 8, 8, 10],
    ];
    let fi = 0;
    for (const [bx, bz, w, d, h] of infill) {
      S({ x: bx, z: bz, w, d, h, family: 'block', roof: 'flat', solid: true, name: 'infill' + fi++, zone: 2 });
    }
    // Tower block on the south rim — the tall landmark that orients the grid.
    S({ x: -134, z: -234, w: 10, d: 10, h: 14, mat: 'brownBrickTenement', family: 'tower', roof: 'flat', solid: true, name: 'towerBlock', zone: 2 });
    // The skyline: a corporate row along the south rim plus scattered
    // high-rises inside the blocks. All solid shafts — their windows stack
    // rows every storey so they read multi-floor — capped by _highrise()
    // with water tanks, masts and aviation beacons.
    const towers = [
      [-108, -236, 12, 12, 26, 'officeConcrete', 'tank'],
      [-76, -237, 13, 13, 34, 'curtainGlass', 'mast'],
      [-44, -236, 12, 12, 22, 'brutalist', 'tank'],
      [-12, -237, 12, 12, 30, 'greyBrickCivic', 'mast'],
      [-112, -80, 9, 9, 16, 'redbrickWalkup', 'tank'],
      [-88, -130, 9, 9, 18, 'tanBrickDeco', 'tank'],
      [34, -186, 10, 10, 20, 'curtainGlass', 'mast'],
    ];
    let ti = 0;
    for (const [bx, bz, w, d, h, mat] of towers) {
      S({ x: bx, z: bz, w, d, h, mat, family: 'tower', roof: 'flat', solid: true, name: 'tower' + ti++, zone: 2 });
    }
    this._towerCrowns = towers.map((t, i) => ['tower' + i, t[6]]);
    this._towerCrowns.push(['towerBlock', 'tank']);
    // The Meridian Tower: the one high-rise you can enter. A furnished lobby
    // with a dead elevator bank and a maintenance room; the glass shaft above
    // is raised by _highrise(). The interior stops at the first ceiling — the
    // other twenty-six floors are somebody else's problem now.
    S({ x: -30, z: -131, w: 12, d: 11, h: 5.4, mat: 'curtainGlass', roof: 'flat', floor: 'floorTile', door: 'S', partitions: lobbyPartitions(12, 11, 'S'), name: 'meridianTower', use: 'towerLobby', zone: 2 });

    // Northern outskirt farms (east of downtown grid)
    S({ x: 120, z: -160, w: 11, d: 8, h: 4, mat: 'weatheredPlank', roof: 'gable', door: 'S', chimney: true, partitions: housePartitions(11, 8, 'S'), name: 'farmhouseA', use: 'house', zone: 2 });
    S({ x: 170, z: -190, w: 14, d: 10, h: 6, mat: 'boardBattenRed', family: 'farm', roof: 'gable', door: 'S', name: 'barn', use: 'barn', zone: 2 });
    S({ x: 80, z: -200, w: 9, d: 7, h: 3.8, mat: 'stuccoTanVilla', roof: 'gable', door: 'E', name: 'farmhouseB', zone: 2, solid: true });

    // --- Hollow Park (zone 3)
    S({ x: -135, z: 70, w: 8, d: 6, h: 3.6, mat: 'weatheredPlank', family: 'farm', roof: 'gable', door: 'E', name: 'boathouse', use: 'boathouse', zone: 3 });
    S({ x: -210, z: 20, w: 9, d: 7, h: 4, mat: 'timberFramed', roof: 'gable', door: 'E', chimney: true, partitions: housePartitions(9, 7, 'E'), name: 'lodge', use: 'house', zone: 3 });

    // --- Southside Industrial (zone 4): heavy sheds on the map's south rim,
    // truck access off the service loop, decay signature all their own.
    S({ x: -60, z: 190, w: 24, d: 16, h: 8, mat: 'corrugatedShed', roof: 'flat', floor: 'concrete', door: 'N', doorTex: 'doorMetal', partitions: officePartitions(24, 16, 'N'), name: 'warehouseA', use: 'warehouse', zone: 4 });
    S({ x: 0, z: 200, w: 26, d: 18, h: 9, mat: 'blockworkIndustrial', roof: 'flat', floor: 'concrete', door: 'N', doorTex: 'doorMetal', name: 'warehouseB', use: 'warehouseMezz', zone: 4 });
    S({ x: 62, z: 185, w: 22, d: 15, h: 8, mat: 'rustedShed', roof: 'gable', floor: 'concrete', door: 'N', doorTex: 'doorMetal', partitions: officePartitions(22, 15, 'N'), name: 'warehouseC', use: 'warehouse', zone: 4 });
    S({ x: 124, z: 195, w: 20, d: 14, h: 7, mat: 'corrugatedShed', roof: 'flat', floor: 'concrete', door: 'W', name: 'depot', zone: 4, solid: true, family: 'industrial' });
    S({ x: 34, z: 122, w: 8, d: 6, h: 3.6, mat: 'officeConcrete', roof: 'flat', floor: 'floorTile', door: 'W', doorTex: 'doorShop', name: 'gasShop', use: 'gasShop', zone: 4 });
    S({ x: -100, z: 150, w: 10, d: 8, h: 4.5, mat: 'blockworkIndustrial', roof: 'shed', floor: 'concrete', door: 'E', doorTex: 'doorMetal', name: 'machineShop', use: 'machineShop', zone: 4 });
    S({ x: -105, z: 205, w: 20, d: 14, h: 9, mat: 'rustedShed', roof: 'flat', floor: 'concrete', door: 'E', doorTex: 'doorMetal', name: 'factory', use: 'factory', zone: 4 });

    // --- Chapel Ridge (zone 5)
    S({ x: -195, z: -198, w: 12, d: 18, h: 7, mat: 'coursedStone', roof: 'gable', door: 'S', name: 'chapel', use: 'church', zone: 5 });
    S({ x: -168, z: -170, w: 8, d: 6, h: 3.6, mat: 'plasterTownhouse', roof: 'gable', door: 'W', name: 'caretaker', zone: 5, solid: true });

    this._assignMaterials();
  }

  _constructBuildings() {
    this.built = new Map();
    this.interiors = new InteriorKit(this);
    for (const spec of this.buildingSpecs) {
      const b = this.kit.build(spec);
      mergeStatic(b.group); // one mesh per material per building
      this.group.add(b.group);
      const entry = { spec, ...b };
      this.built.set(spec.name, entry);
      for (const p of b.lootPoints) this.lootPoints.push({ x: p.x, z: p.z, zone: spec.zone });
      for (const p of b.spawnPoints) this.spawnPoints.push({ x: p.x, z: p.z, zone: spec.zone, indoor: true });
      // furnish the interior to match the building's function
      this.interiors.populate(entry);
    }
  }

  _road(points, tex, width, surface = 'road') {
    const mat = new THREE.MeshLambertMaterial({ map: this.texLib.tiled(tex, 1, 1) });
    const mesh = this.terrain.makeRibbon(points, width, mat);
    this.group.add(mesh);
    for (let i = 1; i < points.length; i++) {
      const [x1, z1] = points[i - 1], [x2, z2] = points[i];
      this.addSurface(Math.min(x1, x2) - width / 2, Math.min(z1, z2) - width / 2,
        Math.max(x1, x2) + width / 2, Math.max(z1, z2) + width / 2, surface);
    }
    return mesh;
  }

  _patch(x, z, hx, hz, tex, surface, repeat = 8) {
    const mat = new THREE.MeshLambertMaterial({ map: this.texLib.tiled(tex, repeat, repeat) });
    this.group.add(this.terrain.makePatch(x, z, hx, hz, mat));
    if (surface) this.addSurface(x - hx, z - hz, x + hx, z + hz, surface);
  }

  _roads() {
    // Old town cross
    this._road([[-45, 0], [-20, 0], [20, 0], [45, 0]], 'roadLine', 7);
    this._road([[0, -45], [0, -20], [0, 20], [0, 45]], 'roadLine', 7);
    // Main St East: curves over the knoll
    this._road([[45, 0], [90, 3], [140, 7], [190, 2], [232, -5]], 'roadLine', 7);
    // Eastgate loops
    this._road([[100, 0], [100, -30], [100, -60], [135, -62], [168, -60], [168, -30], [168, 0]], 'road', 5.5);
    this._road([[90, 5], [90, 45], [90, 80], [135, 82], [180, 80], [180, 40], [180, 8]], 'road', 5.5);
    // North Ave into downtown
    this._road([[0, -45], [0, -80], [-2, -120], [-2, -180], [0, -232]], 'roadLine', 8);
    // Downtown grid (the z=-120 cross street runs east to serve the school)
    for (const sx of [-100, -50]) this._road([[sx, -60], [sx, -120], [sx, -180], [sx, -228]], 'road', 6.5);
    for (const sz of [-70, -170, -220]) this._road([[-138, sz], [-90, sz], [-40, sz], [10, sz], [40, sz]], 'road', 6.5);
    this._road([[-138, -120], [-90, -120], [-40, -120], [10, -120], [40, -120], [75, -120]], 'road', 6.5);
    // Downtown sidewalks
    for (const sx of [-100, -50, 0]) {
      for (const off of [-5.6, 5.6]) {
        this._road([[sx + off, -60], [sx + off, -140], [sx + off, -225]], 'sidewalk', 2.4, 'concrete');
      }
    }
    // Side streets: short connectors branching off the through-roads, so the
    // grid reads as a place that grew rather than as a lattice. Rowan Lane
    // runs the length of the west block down to the service alley; the second
    // is Founders Square's own approach off the x=-50 street.
    this._road([[-59, -74], [-59, -90], [-59, -101]], 'road', 5.0);
    this._road([[-47.5, -157], [-42, -157]], 'concrete', 4.2, 'concrete');
    // Road to farms
    this._road([[10, -170], [60, -168], [120, -164], [168, -184]], 'road', 5);
    // Park Rd + trails
    this._road([[-45, 0], [-80, 6], [-118, 16]], 'road', 6);
    this._road([[-118, 16], [-140, 40], [-147, 66]], 'gravel', 3.5, 'dirt');
    this._road([[-118, 16], [-160, 4], [-205, 18]], 'gravel', 3.5, 'dirt');
    // Foundry Rd South + service loop + factory spur (truck access)
    this._road([[0, 45], [0, 90], [0, 130], [0, 160]], 'roadLine', 7);
    this._road([[-120, 160], [-60, 160], [0, 160], [60, 160], [130, 160], [200, 162]], 'road', 6.5);
    this._road([[-105, 162], [-98, 180], [-92, 198]], 'gravel', 5, 'dirt');
    // Ridge switchback
    this._road([[-140, -175], [-158, -182], [-172, -192], [-186, -200], [-196, -206], [-202, -198], [-198, -192]], 'gravel', 4.5, 'dirt');
    // Plazas, lots and aprons
    this._patch(0, 0, 16, 16, 'sidewalk', 'concrete', 12);
    this._patch(-50, -145, 10, 8, 'sidewalk', 'concrete', 8);
    this._patch(30, 190, 90, 45, 'gravel', 'dirt', 40);        // industrial yard
    this._patch(30, 122, 12, 9, 'concrete', 'concrete', 8);    // gas station apron (south)
    this._patch(61, 12, 11, 6.5, 'concrete', 'concrete', 8);   // gas station apron (Eastgate)
    this._patch(27, -228, 12, 6, 'concrete', 'concrete', 8);   // gas station apron (downtown)
    this._patch(-42, -134, 4.5, 7.5, 'road', 'road', 6);       // midtown parking lot
    this._patch(-75, -212, 8, 5, 'road', 'road', 6);           // department-store lot
    this._patch(58, -90, 8, 6, 'gravel', 'dirt', 6);           // school yard
    this._patch(-62, -228, 58, 3.5, 'sidewalk', 'concrete', 30); // corporate-row forecourt
    this._patch(-30, -124.5, 7, 1.2, 'sidewalk', 'concrete', 6); // Meridian Tower step
    this._patch(134, 33, 8, 6, 'gravel', 'dirt', 6);           // Eastgate playground
    this._patch(100, -190, 14, 9, 'dirt', 'dirt', 10);         // east farm field
    this._patch(150, -150, 12, 7, 'dirt', 'dirt', 9);          // north farm field
    this._patch(200, -150, 3, 3, 'dirt', 'dirt', 3);           // windmill pad
  }

  _decal(tex, x, z, size, yaw = 0, tint = null) {
    const mat = new THREE.MeshLambertMaterial({
      map: this.texLib.get(tex), transparent: true, depthWrite: false,
      ...(tint ? { color: tint } : {}),
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    q.rotation.set(-Math.PI / 2, 0, yaw);
    q.position.set(x, this.terrain.heightAt(x, z) + 0.1, z);
    q.renderOrder = 2;
    this.group.add(q);
    return q;
  }

  /**
   * Place a prop, unless it would stand in somebody's doorway.
   *
   * Market stalls parked across a shop's own front door is the single most
   * common way a hand-placed town goes wrong, and it is invisible in the
   * plan — the coordinates look fine, and then you walk up to the building
   * and cannot get in. So the check lives at the point of placement rather
   * than in a reviewer's head: anything with a collider is tested against
   * every building's entry lane, and refused if it lands in one.
   *
   * Refusals are recorded rather than silently swallowed (`doorwayRejects`),
   * so tests/world.mjs can name the offender instead of leaving a prop
   * quietly missing from the map.
   */
  _prop(maker, x, z, opts = {}) {
    const p = maker;
    const collide = opts.collide === undefined ? p.collide : opts.collide;
    if (collide && !opts.lift) {
      const hx = collide[0], hz = collide[2];
      if (this._inDoorway(x, z, Math.max(hx, hz))) {
        this.doorwayRejects.push({ x, z, why: 'doorway' });
        return null;
      }
      // Nothing solid may stand inside a building or inside another solid
      // prop. A market stall half-buried in a shop wall and two cars sharing
      // the same parking bay are the same mistake, and neither is visible in
      // the plan — the coordinates look reasonable right up until you walk
      // round the corner and see a canopy growing out of the brickwork.
      const clash = this._overlapsSolid(x, z, hx, hz);
      if (clash) {
        this.doorwayRejects.push({ x, z, why: clash });
        return null;
      }
      this._solids.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
    }
    this.props.place(p.group, x, z, { collide: p.collide, ...opts });
    this.group.add(p.group);
    return p.group;
  }

  /**
   * What a solid prop footprint at (x, z) would be standing inside, or null.
   *
   * Buildings are tested against their real footprint; other props only
   * against ones big enough for the overlap to read (a hydrant clipping a
   * kerbstone is nobody's problem, two vehicles in the same bay is).
   */
  _overlapsSolid(x, z, hx, hz) {
    const minX = x - hx, maxX = x + hx, minZ = z - hz, maxZ = z + hz;
    for (const s of this.buildingSpecs) {
      const ox = Math.min(maxX, s.x + s.w / 2) - Math.max(minX, s.x - s.w / 2);
      const oz = Math.min(maxZ, s.z + s.d / 2) - Math.max(minZ, s.z - s.d / 2);
      if (ox > PROP_CLEARANCE && oz > PROP_CLEARANCE) return 'in ' + s.name;
    }
    if (Math.max(hx, hz) < 1.2) return null;   // small props may share space
    for (const o of this._solids) {
      if (Math.max(o.maxX - o.minX, o.maxZ - o.minZ) < 2.4) continue;
      const ox = Math.min(maxX, o.maxX) - Math.max(minX, o.minX);
      const oz = Math.min(maxZ, o.maxZ) - Math.max(minZ, o.minZ);
      if (ox > PROP_CLEARANCE && oz > PROP_CLEARANCE) {
        return `into prop@${((o.minX + o.maxX) / 2).toFixed(0)},${((o.minZ + o.maxZ) / 2).toFixed(0)}`;
      }
    }
    return null;
  }

  /**
   * Is (x, z) — grown by `pad` — inside the approach lane of any building's
   * front door? The lane is DOOR_APPROACH metres straight out from the
   * threshold and DOOR_LANE_HALF either side of its centre.
   */
  _inDoorway(x, z, pad = 0) {
    for (const s of this.buildingSpecs) {
      if (!s.door || s.solid) continue;
      const n = DOOR_NORMAL[s.door];
      if (!n) continue;
      const half = n[0] ? s.w / 2 : s.d / 2;
      const along = (x - s.x) * n[0] + (z - s.z) * n[1] - half;
      if (along < -0.5 - pad || along > DOOR_APPROACH + pad) continue;
      const across = Math.abs((x - s.x) * -n[1] + (z - s.z) * n[0]);
      if (across < DOOR_LANE_HALF + pad) return true;
    }
    return false;
  }

  /** Decal quad on a building facade. side is a world direction N/S/E/W. */
  _wallDecal(tex, name, side, offset = 0, w = 3.4, h = 1.7) {
    const b = this.built.get(name);
    if (!b) return;
    const s = b.spec;
    const mat = new THREE.MeshLambertMaterial({ map: this.texLib.get(tex), transparent: true, depthWrite: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const y = s.y + 1.3;
    if (side === 'S') { q.position.set(s.x + offset, y, s.z + s.d / 2 + 0.06); }
    else if (side === 'N') { q.position.set(s.x + offset, y, s.z - s.d / 2 - 0.06); q.rotation.y = Math.PI; }
    else if (side === 'E') { q.position.set(s.x + s.w / 2 + 0.06, y, s.z + offset); q.rotation.y = Math.PI / 2; }
    else { q.position.set(s.x - s.w / 2 - 0.06, y, s.z + offset); q.rotation.y = -Math.PI / 2; }
    q.renderOrder = 2;
    this.group.add(q);
    return q;
  }

  /** A run of utility poles with sagging wires between them. */
  _poleLine(points) {
    const P = this.props;
    let prev = null;
    for (const [x, z] of points) {
      this._prop(P.utilityPole(), x, z);
      const top = this.terrain.heightAt(x, z) + 6.8;
      if (prev) {
        P.wireRun(this.group, prev.x, prev.y, prev.z, x, top, z);
        P.wireRun(this.group, prev.x, prev.y - 0.4, prev.z, x, top - 0.4, z, 1.1);
      }
      prev = { x, y: top, z };
    }
  }

  _oldTown() {
    const P = this.props;
    this._prop(P.well(), 0, 6);
    for (const [x, z] of [[-14, -6], [14, -6], [-12.2, 15], [14, 10]]) this._prop(P.lamppost(), x, z);
    // The lamp at the alley mouth casts a shadow the wrong way (secret #9
    // registers the trigger; this is the visual).
    this.wrongShadowLamp = this._prop(P.lamppost(), 22, -4);
    this._decal('shadowDecal', 23.5, -2.2, 3.2, 0.8); // sun comes from the west; this points west too
    for (const [x, z, yaw] of [[-6, 12, 0.3], [8, -10, -1.2]]) this._prop(P.bench(), x, z, { yaw });
    this._prop(P.wreckedCar(0x4a4238), -10, 26, { yaw: 0.4 });
    this._prop(P.crateStack(3), -24, -20);
    this._prop(P.mailbox(), -12, 10);
    // The tower clock — LIVE: its hands track the sky's day cycle (phase 0 =
    // sunrise = 06:00, 0.25 = noon; see _updateClock). Each hand is a plane
    // inside a spinner group pivoted at the face centre; the outer group's
    // rotation.y = π faces the dial south, and because that flip mirrors the
    // local X axis, a spinner rotation of −θ reads as θ CLOCKWISE from 12 to
    // the viewer in the plaza below.
    const t = this.built.get('clocktower');
    const cx = t.spec.x, cy = t.spec.y + 11.5, cz = t.spec.z;
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), new THREE.MeshBasicMaterial({ color: 0xd8d2c0 }));
    clock.position.set(cx, cy, cz - 2.55);
    clock.rotation.y = Math.PI;
    this.group.add(clock);
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x1c1c22 });
    for (let k = 0; k < 12; k++) { // hour ticks, quarters heavier
      const a = k * Math.PI / 6;
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(k % 3 === 0 ? 0.1 : 0.06, k % 3 === 0 ? 0.24 : 0.14), darkMat);
      tick.position.set(cx + Math.sin(a) * 1.2, cy + Math.cos(a) * 1.2, cz - 2.56);
      tick.rotation.set(0, Math.PI, a);
      this.group.add(tick);
    }
    const mkHand = (len, width, zOff) => {
      const pivot = new THREE.Group();
      pivot.position.set(cx, cy, cz - zOff);
      pivot.rotation.y = Math.PI;
      const spinner = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(width, len + 0.14), darkMat);
      blade.position.y = len / 2 - 0.14; // short counterweight tail past the pivot
      spinner.add(blade);
      pivot.add(spinner);
      this.group.add(pivot);
      return spinner;
    };
    this.clockHands = { hour: mkHand(0.62, 0.13, 2.57), minute: mkHand(0.98, 0.09, 2.58) };
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), darkMat);
    hub.position.set(cx, cy, cz - 2.59);
    hub.rotation.y = Math.PI;
    this.group.add(hub);
    // street furniture serving the new plaza-facing buildings
    for (const [x, z] of [[-28, 18], [32, 18]]) this._prop(P.lamppost(), x, z);
    this._prop(P.bench(), -26, 30, { yaw: 1.2 });
    this._prop(P.hydrant(), 9, -8);
    this._prop(P.hydrant(), -9, 11);
    this._prop(P.signPost(0x39586b), 5, 5);
    this._prop(P.mailbox(), 24, 22);
    // market morning that never ended: stalls still stocked around the plaza
    this._prop(P.marketStall(0x7a3b30), -9.5, -12, { yaw: 0.2 });
    this._prop(P.marketStall(0x39586b), 11, -11, { yaw: -0.15 });
    this._prop(P.marketStall(0x4a5a38), -7.5, 16.5, { yaw: 2.6 });
    this._prop(P.crateStack(2), -14.5, -8.5, { yaw: 0.5 });
    for (const [x, z] of [[-38, 34], [24, -38], [-34, -30], [38, 32], [26, 18], [-28, 4]]) this.veg.tree(this.group, x, z, 0.9);
    for (const [x, z] of [[-22, 24], [18, 28], [-26, -6]]) this.veg.bush(this.group, x, z);
    this._sprinkleTufts(0, 0, 40, 26, 42);
    this._zoneSpawns(0, 10, 26, 40);
  }

  _eastgate() {
    const P = this.props;
    const rng = mulberry32(11);
    // Fenced yards between neighbouring houses on the main row
    for (const [x1, z1, x2, z2] of [[64, -8, 64, -22], [104, -8, 104, -24], [130, -8, 130, -24], [82, 10, 82, 26], [132, 10, 132, 26]]) {
      this.props.fenceRun(x1, z1, x2, z2, this.group);
    }
    for (const [x, z, yaw] of [[80, -4, 0.1], [125, 4, -0.15], [160, -6, 0.5], [96, 60, 1.2]]) {
      this._prop(P.wreckedCar([0x5a3b34, 0x39465e, 0x4c5548][Math.floor(rng() * 3)]), x, z, { yaw });
    }
    // wired pole line follows Main St over the knoll; spurs stay bare
    this._poleLine([[60, -8], [85, -7], [110, -8], [135, -7], [160, 8]]);
    for (const [x, z] of [[92, 34], [150, 60]]) this._prop(P.utilityPole(), x, z);
    for (const [x, z] of [[75, -10], [98, 12], [138, -12], [118, 52]]) this._prop(P.mailbox(), x, z);
    this._prop(P.busStop(), 55, 6, { yaw: Math.PI });
    // the Eastgate filling station on Main St
    P.gasStation(58, 12, this.group);
    // street signs at the loop-road corners, hydrants along the mains
    for (const [x, z, c] of [[97, -3, 0x6b7280], [165, -3, 0x7a3b30], [93, 42, 0x39586b], [177, 44, 0x6b7280]]) {
      this._prop(P.signPost(c), x, z);
    }
    for (const [x, z] of [[72, -5], [118, -4], [152, 10]]) this._prop(P.hydrant(), x, z);
    // Playground on the gravel lot between the loop roads. One of the swings
    // keeps moving. There is no wind today.
    const swings = P.swingSet();
    this._prop(swings, 132, 31, { yaw: 0.12 });
    this.playgroundSwings = swings.swings;
    this._prop(P.slide(), 138, 35, { yaw: -0.4 });
    this._prop(P.bench(), 127, 36, { yaw: 0.9 });
    this._prop(P.bench(), 139, 29, { yaw: -2.1 });
    // mailboxes for the new back rows
    for (const [x, z] of [[212, 24], [192, 86], [66, 46]]) this._prop(P.mailbox(), x, z);
    // Church graveyard
    for (let i = 0; i < 8; i++) {
      const gx = 138 + (i % 4) * 3.2, gz = -84 - Math.floor(i / 4) * 3;
      const stone = P.box(0.7, 1.0, 0.18, 'brickGray');
      const g = new THREE.Group(); g.add(stone); stone.position.y = 0.5;
      this._prop({ group: g }, gx, gz);
    }
    // Trees + bushes over the knoll
    for (let i = 0; i < 38; i++) {
      const x = 55 + rng() * 175, z = -100 + rng() * 200;
      if (this._nearBuilding(x, z, 6) || this.surfaceAt(x, z) !== 'grass') continue;
      if (rng() < 0.65) this.veg.tree(this.group, x, z, 0.8 + rng() * 0.5);
      else this.veg.bush(this.group, x, z, 0.8 + rng() * 0.5);
    }
    this._sprinkleTufts(140, 0, 95, 100, 70);
    this._zoneSpawns(1, 20, 60, 190, 0, 0);
  }

  _downtown() {
    const P = this.props;
    const rng = mulberry32(22);
    // Intersections: traffic lights, street signs, crosswalks, hydrants,
    // manholes — the full municipal kit, dead but present.
    const signCols = [0x6b7280, 0x7a3b30, 0x39586b];
    let ii = 0;
    for (const ix of [-100, -50, 0]) {
      for (const iz of [-70, -120, -170, -220]) {
        if (rng() < 0.7) this._prop(P.trafficLight(), ix + 4.5, iz + 4.5, { yaw: rng() * 6 });
        this._prop(P.signPost(signCols[ii++ % 3]), ix - 4.8, iz - 4.8);
        this._decal('crosswalk', ix, iz - 5.5, 6, 0);
        this._decal('crosswalk', ix - 5.5, iz, 6, Math.PI / 2);
        if (rng() < 0.5) this._prop(P.hydrant(), ix - 4.5, iz + 5);
        if (rng() < 0.8) this._decal('manhole', ix + 2 + rng() * 3, iz + 2, 1.1);
        // trees force through the cracked pavement
        if (rng() < 0.55) this.veg.tree(this.group, ix - 4 - rng() * 3, iz - 4 - rng() * 3, 0.7 + rng() * 0.3);
      }
    }
    // hydrants at regular intervals down North Ave, manholes mid-road
    for (const hz of [-90, -125, -160, -195]) this._prop(P.hydrant(), 6.8, hz);
    for (const [mx, mz] of [[1, -85], [-3, -130], [2, -190]]) this._decal('manhole', mx, mz, 1.1);
    // wired utility poles: along the z=-70 road and down North Ave
    this._poleLine([[-130, -63], [-96, -63], [-64, -63], [-30, -63]]);
    this._poleLine([[8.2, -76], [8.2, -111], [8.2, -146], [8.2, -181], [8.2, -216]]);
    // The odd manhole (secret #7) sits mid-block, greener than the rest.
    this.oddManhole = this._decal('manhole', -20, -95, 1.15, 0.3, 0x9fdf9f);
    for (const [x, z, yaw] of [[-70, -75, 0.2], [-39, -122, 1.7], [-104, -168, 0.1], [-55, -218, -0.3], [8, -100, 1.6], [-96, -122, 0.4]]) {
      this._prop(P.wreckedCar([0x6b3232, 0x39465e, 0x555c46, 0x694f28][Math.floor(rng() * 4)]), x, z, { yaw });
    }
    // abandoned lots: cars still parked where their owners left them
    for (const [x, z, yaw] of [[-43.5, -131, 1.6], [-41, -137, 1.5], [-77, -211, 0.05], [-71.5, -213, -0.1]]) {
      this._prop(P.wreckedCar([0x39465e, 0x555c46, 0x694f28][Math.floor(rng() * 3)]), x, z, { yaw });
    }
    this._prop(P.signPost(0x39586b), -47.5, -128);
    for (const [x, z] of [[-88, -95, 0], [-38, -145, 0], [-88, -195, 0], [10, -170, 0]]) this._prop(P.busStop(), x, z);
    for (const [x, z] of [[-64, -97], [-37, -132], [-110, -132], [-63, -182], [-20, -100], [-110, -182]]) this._prop(P.dumpster(), x, z, { yaw: rng() });
    for (const [x, z] of [[-95, -75], [-45, -75], [-95, -165], [-45, -165], [5, -125], [5, -215]]) this._prop(P.lamppost(), x, z);
    // graffiti where the maintenance gave out
    this._wallDecal('graffiti', 'office', 'S', -3.5);
    this._wallDecal('graffiti', 'apartmentB', 'N', 2.0);
    this._wallDecal('graffiti', 'arcade', 'N', -1.5);
    this._wallDecal('graffiti', 'department', 'E', 3.0);
    this._wallDecal('graffiti', 'hotel', 'W', -2.0);
    // The 41 stopped here and never moved again: slewed across the z=-170
    // lane, it is the heaviest cover downtown and a thing you give directions
    // by. Vans and pickups break up the parked sedans elsewhere in the grid.
    this._prop(P.bus(0x2f6a52), -62, -168.4, { yaw: 0.34 });
    this._prop(P.van(0x6b6f60, true), -93, -200, { yaw: 1.58 });
    this._prop(P.van(0x7a5b3a), 19.5, -118, { yaw: 1.55 });
    // pocket park north of the z=-170 road — a breath between the blocks
    this._prop(P.bench(), 31, -160, { yaw: 2.4 });
    this._prop(P.bench(), 37, -162, { yaw: -0.6 });
    this.veg.tree(this.group, 28, -158, 0.9);
    this.veg.tree(this.group, 40, -160, 0.8);
    // school yard details
    this._prop(P.bench(), 52, -90, { yaw: 0.2 });
    this._prop(P.signPost(0x7a3b30), 50, -113);
    this._alleys();
    this._downtownSquare();
    // Vines climb the north faces (away from the dying sun)
    for (const name of ['library', 'diner', 'apartmentB', 'hotel', 'department']) {
      const b = this.built.get(name);
      if (!b) continue;
      const s = b.spec;
      for (let i = 0; i < 2; i++) {
        this.veg.vine(this.group, s.x - s.w / 4 + i * (s.w / 2), s.y + 0.4, s.z - s.d / 2 - 0.06, Math.PI, Math.min(4, s.h - 1));
      }
    }
    // Theater marquee
    const th = this.built.get('theater');
    const marquee = P.box(8, 1.4, 2.2, P.colorMat(0x5e2430));
    marquee.position.set(th.spec.x + th.spec.w / 2 + 1.1, th.spec.y + 4.6, th.spec.z);
    this.group.add(marquee);
    // Farms NE
    this._prop(P.pickup(0x694f28, true), 130, -168, { yaw: 0.2 });
    this._prop(P.pickup(0x4c5548), 128, -155, { yaw: 1.5 });
    this._prop(P.pickup(0x6b3a32, true), 156, -180, { yaw: -0.3 });
    for (const [x1, z1, x2, z2] of [[105, -150, 105, -175], [105, -175, 140, -178]]) this.props.fenceRun(x1, z1, x2, z2, this.group);
    // Working farmland fills the east flats: two fields still holding their
    // crop rows, an orchard planted in ranks, and the windmill idling at the
    // corner of the far field — it turns whether or not there is wind.
    for (const [fx, fz, hx, hz] of [[100, -190, 13, 8], [150, -150, 11, 6]]) {
      const rows = [];
      for (let rz = -hz; rz <= hz; rz += 2.4) {
        for (let rx = -hx; rx <= hx; rx += 1.5) rows.push([fx + rx, fz + rz]);
      }
      this.veg.tuftField(this.group, rows);
    }
    // The scarecrow itself is a standalone aware entity (src/world/Scarecrow.js),
    // built after nav.bake() at (100, -193) — it watches, sways and can be touched.
    for (const [x, z] of [[116, -186], [146, -143], [88, -178]]) this._prop(P.hayBale(), x, z, { yaw: (x * 3) % 1 });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) this.veg.tree(this.group, 84 + i * 8, -136 + j * 7, 0.85);
    }
    const wm = P.windmill();
    this._prop(wm, 200, -150);
    this.windmillRotors.push(wm.rotor);
    const rng2 = mulberry32(33);
    for (let i = 0; i < 26; i++) {
      const x = 60 + rng2() * 170, z = -235 + rng2() * 100;
      if (this._nearBuilding(x, z, 6) || this.surfaceAt(x, z) !== 'grass') continue;
      this.veg.tree(this.group, x, z, 0.9 + rng2() * 0.6);
    }
    this._sprinkleTufts(-60, -145, 80, 90, 60);
    this._sprinkleTufts(140, -180, 90, 60, 40);
    this._zoneSpawns(2, 26, -60, -140, 0, 0);
  }

  /**
   * The alley network behind the z=-120 shop row.
   *
   * Three slots barely three metres wide run north between the shops, feeding
   * a continuous service lane squeezed between their back walls and the back
   * of the library. That is the whole point of them: they are the flanking
   * route through a block you would otherwise have to go round, they are too
   * narrow to fight in at range, and a horde that follows you into one has
   * you in a corridor. Every alley is dressed the same way a real one is —
   * bins, dropped pallets, a fire escape overhead, pipework, and the graffiti
   * that only ever appears where nobody official goes.
   */
  _alleys() {
    const P = this.props;
    // The service lane along the back of the row, between the shops' rear
    // walls (z = -105.5) and the back of the library (z = -101). It runs in
    // two halves because the Hollow Park border wall crosses x = -45 — that
    // wall is not ours to move, and the lane picks up again on the far side
    // of it once the district opens.
    this._road([[-96, -103.3], [-70, -103.3], [-47.5, -103.3]], 'concrete', 4.0, 'concrete');
    this._road([[-42.5, -103.3], [-30, -103.3], [-18, -103.3]], 'concrete', 4.0, 'concrete');
    // the four slots down to the street, each in the middle of a 6.5 m gap
    // [slot centre, the shop whose flank faces it, that flank's x]
    const slots = [
      [-85.25, 'laundromat', -82.0],
      [-70.75, 'pharmacy', -67.5],
      [-34.25, 'barbers', -31.0],
      [-19.75, null, 0],
    ];
    for (const [ax] of slots) this._road([[ax, -117], [ax, -103.3]], 'concrete', 3.6, 'concrete');

    // Dressing. A bin at the mouth, something dropped halfway down, pipework
    // and a fire escape overhead — an alley is unmistakable within a second
    // of turning into one, and that legibility is what makes it usable as a
    // flanking route under pressure.
    // Alley furniture is solid to bodies but INVISIBLE to the nav grid
    // (`nav: false`). A slot only has two clear 2 m cells to begin with, so a
    // dumpster registered as a nav block would seal the route outright and the
    // flanking path would exist for the player alone. Steering handles the
    // local avoidance, which is what makes threading a bin-strewn alley feel
    // like threading a bin-strewn alley.
    let di = 0;
    for (const [ax, wallName, face] of slots) {
      this._prop(P.dumpster(), ax + 0.35, -114.6, { yaw: 1.55, nav: false });
      this._prop(P.trashCan(), ax - 1.1, -110.8, { nav: false });
      this._prop(P.crateStack(2), ax + 0.7, -107.4, { yaw: 0.6, nav: false });
      if (!wallName) continue;
      this._prop(P.wallPipes(6), face - 0.35, -111.6, { yaw: -Math.PI / 2, nav: false });
      this._prop(P.fireEscape(2), face - 0.25, -108.4, { yaw: -Math.PI / 2, nav: false });
      this._wallDecal('graffiti', wallName, 'W', -1.6 + di, 3.0, 1.5);
      this._decal('oilStain', ax + 0.5, -112.2, 1.8);
      di += 1.2;
    }
    // the lane itself: a hooded light that stopped working years ago, more
    // bins, and the back doors nobody ever used from the outside
    for (const [x, z] of [[-88, -103.3], [-52, -103.3], [-28, -103.3]]) this._prop(P.lamppost(), x, z, { nav: false });
    for (const [x, z, yaw] of [[-60, -102.3, 0.2], [-45, -104.3, -0.3]]) this._prop(P.dumpster(), x, z, { yaw, nav: false });
    for (const [x, z] of [[-68, -102.5], [-38, -104.4]]) this._prop(P.trashCan(), x, z, { nav: false });
    this._prop(P.crateStack(3), -56, -104.4, { yaw: 0.4, nav: false });
    this._wallDecal('graffiti', 'library', 'N', 3.4, 3.6, 1.8);
    for (const [x, z] of [[-80, -103], [-48, -103.8], [-24, -103]]) this._decal('oilStain', x, z, 1.6);
  }

  /**
   * Founders Square: the public space that breaks up the block grid and, more
   * usefully, the open ground the mid-game fights want. A paved plaza with a
   * statue in the middle you can see from three streets away, benches and
   * planters round the edge for cover, and the old fountain moved here off
   * the carriageway where it used to sit.
   */
  _downtownSquare() {
    const P = this.props;
    this._patch(-40, -158, 6, 8, 'sidewalk', 'concrete', 8);
    this.statuePos = { x: -40, z: -158 };
    this._prop(P.statue(), -40, -158, { yaw: 0.4 });
    this._prop(P.well(), -40, -150.5);                       // the fountain
    for (const [x, z, yaw] of [[-45, -153, 1.4], [-35, -153, -1.4], [-45, -163, 2.0], [-35, -163, -2.0]]) {
      this._prop(P.bench(), x, z, { yaw });
    }
    for (const [x, z] of [[-44.5, -157.5], [-35.5, -157.5], [-40, -165.5]]) {
      this._prop(P.planter(this.veg._cross(this.veg.bushMat, 1.1, 0.9)), x, z);
    }
    for (const [x, z] of [[-45.5, -149.5], [-34.5, -149.5]]) this._prop(P.bollard(), x, z);
    this._prop(P.trashCan(), -36.5, -151.5);
    this._prop(P.newsstand(), -45.2, -166, { yaw: 0.3 });
    for (const [x, z] of [[-46, -160], [-34, -160.5], [-46, -155]]) this.veg.tree(this.group, x, z, 0.85);
    this._decal('crosswalk', -40, -148.5, 5.5, 0);
  }

  _park() {
    const P = this.props;
    const rng = mulberry32(44);
    this._pond();
    const pb = this.pondBasin;
    // Bandstand
    const band = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.2, 0.5, 10), this.kit.mat('floorWood'));
    deck.position.y = 0.25;
    band.add(deck);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const post = P.box(0.16, 2.6, 0.16, 'wallWood');
      post.position.set(Math.cos(a) * 3.4, 1.55, Math.sin(a) * 3.4);
      band.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.6, 10), this.kit.mat('roofShingle'));
    roof.position.y = 3.4;
    band.add(roof);
    this.props.place(band, -120, 20);
    this.group.add(band);
    this.terrain.addPlatform(-124, -116, 16, 24, this.terrain.heightAt(-120, 20) + 0.5);
    for (const [x, z, yaw] of [[-112, 26, 0.9], [-126, 12, -0.8], [-95, 8, 0.2], [-140, 45, 1.9]]) this._prop(P.bench(), x, z, { yaw });
    this._prop(P.picnicTable(), -112, 14, { yaw: 0.4 });
    this._prop(P.picnicTable(), -128, 27, { yaw: -0.7 });
    this._prop(P.wreckedCar(0x555c46), -70, 10, { yaw: -0.3 });

    // --- the park's moving parts.
    // Everything else in town is stopped. Here the carousel turns, the flag
    // ripples and the rope swing keeps its arc — slowly, quietly, and with
    // nobody near any of them. It reads as a place that is still running
    // rather than as a place that has been staged, which is a much colder
    // thing to walk into.
    const car = P.carousel();
    this._prop(car, -100, 34);
    this.spinners.push({ node: car.deck, speed: 0.16 });
    const pole = P.flagpole(7, 0x8a2a24);
    this._prop(pole, -113, 27);
    this.flags.push({ strips: pole.strips, phase: 0 });
    // the rope swing hangs from a real bough on a real tree — plant the tree
    // first, or the rope is tied to nothing
    this.veg.tree(this.group, -92.6, 20.4, 1.35);
    const swing = P.ropeSwing();
    this._prop(swing, -92, 20, { yaw: 0.7 });
    this.ropeSwings.push(swing.pivot);
    this._prop(P.noticeBoard(), -117, 12, { yaw: 0.2 });
    this._prop(P.drinkingFountain(), -108, 18);
    for (const [x, z] of [[-104, 26], [-96, 14]]) this._prop(P.trashCan(), x, z);

    // The jetty runs out from the shore over open water: its foot is set on
    // the measured bank and it is aimed at the middle of the pond.
    {
      const a = -1.414;                    // where the lakeside trail arrives
      const r = this._shoreRadius(a) - 0.6;
      const jx = pb.x + Math.cos(a) * r, jz = pb.z + Math.sin(a) * r;
      this._prop(P.jetty(6), jx, jz, { yaw: Math.atan2(pb.x - jx, pb.z - jz), nav: false });
    }
    this._prop(P.footbridge(9), -124, 58, { yaw: Math.PI / 2 });
    // Rocks along the ravine lip
    for (const [x, z, s] of [[-172, 62, 1.6], [-125, 75, 1.3], [-166, 105, 1.8], [-134, 104, 1.2]]) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.kit.mat('rock'));
      const g = new THREE.Group(); g.add(rock); rock.position.y = s * 0.5;
      this._prop({ group: g, collide: [s * 0.8, s * 0.7, s * 0.8] }, x, z, { yaw: rng() * 3 });
    }
    // A rowboat hauled up on the pond's north shore, oars long gone.
    {
      const a = -1.9, r = this._shoreRadius(a) + 1.3;
      this._prop(P.rowboat(), pb.x + Math.cos(a) * r, pb.z + Math.sin(a) * r, { yaw: 0.7 });
    }
    // Dense woods — including the ring that hides the campsite (secret #8)
    for (let i = 0; i < 60; i++) {
      const x = -240 + rng() * 190, z = -130 + rng() * 230;
      if (this._nearBuilding(x, z, 6) || this.surfaceAt(x, z) !== 'grass') continue;
      if (Math.hypot(x + 200, z + 40) < 9) continue; // campsite clearing
      if (Math.hypot(x + 172, z - 55) < 5) continue; // the door's clearing (Anomalies)
      this.veg.tree(this.group, x, z, 0.9 + rng() * 0.7);
      if (rng() < 0.4) this.veg.bush(this.group, x + 2, z + 1, 0.7 + rng() * 0.5);
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 5.5) {
      this.veg.tree(this.group, -200 + Math.cos(a) * 11, -40 + Math.sin(a) * 11, 1.2);
    }
    this._prop(P.tent(), -202, -42, { yaw: 0.6 });
    this._prop(P.campfire(), -197, -38);
    this._prop(P.crateStack(2), -204, -36);
    // Reeds and scrub along the pond margin, set from the MEASURED shoreline
    // rather than a guessed radius — the bank is not a circle, and reeds
    // standing in open water were how the old disc gave itself away.
    const reeds = [];
    for (let a = 0; a < Math.PI * 2; a += 0.13) {
      const r = this._shoreRadius(a) + 0.3 + Math.sin(a * 3.7) * 0.5;
      reeds.push([pb.x + Math.cos(a) * r, pb.z + Math.sin(a) * r]);
    }
    this.veg.tuftField(this.group, reeds);
    for (let a = 0.1; a < Math.PI * 2; a += 0.85) {
      const r = this._shoreRadius(a) + 2.4;
      this.veg.bush(this.group, pb.x + Math.cos(a) * r, pb.z + Math.sin(a) * r, 0.9);
    }

    this._sprinkleTufts(-140, 20, 100, 120, 110);
    this._zoneSpawns(3, 14, -150, 0, 0, 0);
    // and the ones you do not see coming: in the lee of the treeline, behind
    // the bandstand, among the ravine boulders, back in the woods
    this._concealedSpawns(3, [
      [-108, 40, 1, -1], [-131, 40, 1, -0.6], [-95, 30, 1, 0.4],
      [-146, 52, 0.4, -1], [-163, 34, 1, -0.4], [-176, 70, 1, 0.5],
      [-190, 12, 1, -0.3], [-112, 62, 0.2, -1], [-133, 100, 0.5, -1],
      [-168, 100, 0.8, -1], [-88, -14, 0.6, 1], [-205, 52, 1, -0.2],
    ]);
  }

  _industrial() {
    const P = this.props;
    const rng = mulberry32(55);
    // South-end filling station
    P.gasStation(24, 122, this.group);
    this._prop(P.dumpster(), 40, 118, { yaw: 0.2 }); // the key hides behind this one
    // Factory landmarks: the smokestack owns the south-west skyline, the
    // water tower the south-east, so the yard is legible from anywhere.
    this._prop(P.smokestack(16), -118, 208);
    this._prop(P.waterTower(), 166, 214);
    this._prop(P.fuelTank(), -86, 202);
    this._prop(P.fuelTank(), -86, 209);
    this._prop(P.crateStack(3), -88, 195, { yaw: 0.3 });
    this._prop(P.barrel(), -91, 199);
    // Loading dock on warehouse A's truck face: raised platform + ramp.
    const wa = this.built.get('warehouseA').spec;
    const dock = P.box(6, 1.15, 3.2, 'concrete');
    dock.position.set(-70, wa.y + 0.58, 180.1);
    this.group.add(dock);
    this.collision.addBoxCentered(-70, wa.y + 0.58, 180.1, 3, 0.58, 1.6, 'prop');
    this.terrain.addPlatform(-73, -67, 178.5, 181.7, wa.y + 1.15);
    this.terrain.addRamp(-74.5, 180.1, 1.5, 1.6, 'x', wa.y, wa.y + 1.15);
    const rampV = P.box(3, 0.18, 3.2, 'concrete');
    rampV.position.set(-74.5, wa.y + 0.55, 180.1);
    rampV.rotation.z = Math.atan2(1.15, 3);
    this.group.add(rampV);
    this._prop(P.crateStack(2), -68.4, 180, { lift: 1.15 });
    // Yard clutter
    for (const [x, z] of [[-30, 175], [-20, 210], [30, 170], [90, 205], [45, 215], [100, 170], [-80, 205]]) {
      this._prop(P.crateStack(2 + Math.floor(rng() * 3)), x, z, { yaw: rng() });
    }
    for (const [x, z] of [[-40, 165], [20, 178], [70, 168], [110, 210], [-70, 172]]) this._prop(P.barrel(), x, z);
    for (const [x, z, yaw] of [[-15, 155, 0.1], [140, 165, -0.2]]) this._prop(P.wreckedCar(0x4c5548), x, z, { yaw });
    this._prop(P.van(0x6b6f60, true), 55, 158, { yaw: 1.8 });
    this._prop(P.van(0x8a8272), -46, 176, { yaw: 0.2 });
    this._prop(P.pickup(0x555c46, true), 40, 170, { yaw: 0.3 });
    // Oil soaked into the yard dirt under decades of trucks
    for (const [x, z, s] of [[12, 185, 2.6], [45, 196, 2.0], [70, 178, 2.4], [-15, 192, 2.2], [30, 130, 1.8]]) {
      this._decal('oilStain', x, z, s);
    }
    // the pole line along the service loop still carries its dead wires
    this._poleLine([[-110, 152], [-68, 152], [-26, 152], [16, 152], [58, 152], [100, 152], [142, 152]]);
    this._prop(P.signPost(0x6b7280), 6, 156);
    for (const [x1, z1, x2, z2] of [[-120, 232, 40, 236], [70, 234, 180, 232]]) this.props.fenceRun(x1, z1, x2, z2, this.group);
    // scraggly weeds through the yard cracks
    this._sprinkleTufts(30, 190, 85, 40, 60);
    for (let i = 0; i < 8; i++) {
      const x = -130 + rng() * 80, z = 120 + rng() * 100;
      if (this._nearBuilding(x, z, 7) || this.surfaceAt(x, z) !== 'grass') continue;
      this.veg.tree(this.group, x, z, 0.7 + rng() * 0.4);
    }
    this._zoneSpawns(4, 18, 20, 180, 0, 0);
  }

  _ridge() {
    const P = this.props;
    const rng = mulberry32(66);
    const chapel = this.built.get('chapel');
    // Bell tower attached to the chapel front
    const s = chapel.spec;
    const towerX = s.x - 4.6, towerZ = s.z + s.d / 2 + 2.5;
    const towerY = s.y;
    const tower = P.box(4, 11, 4, 'wallPlaster');
    const tg = new THREE.Group();
    tower.position.y = 5.5;
    tg.add(tower);
    for (const [px, pz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const post = P.box(0.3, 2.2, 0.3, 'wallWood');
      post.position.set(px, 12.1, pz);
      tg.add(post);
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3, 2.6, 4), this.kit.mat('roofShingle'));
    spire.position.y = 14.5;
    spire.rotation.y = Math.PI / 4;
    tg.add(spire);
    // The bell (shootable secret #3)
    this.bell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 1.0, 8), this.kit.mat('metalRust'));
    this.bell.position.y = 11.9;
    tg.add(this.bell);
    tg.position.set(towerX, towerY, towerZ);
    this.group.add(tg);
    this.bellWorld = { x: towerX, y: towerY + 11.9, z: towerZ, r: 1.0 };
    this.collision.addBoxCentered(towerX, towerY + 5.5, towerZ, 2, 5.5, 2, 'wall');
    this.nav.blockBox(towerX - 2, towerZ - 2, towerX + 2, towerZ + 2);
    // Graveyard
    for (let i = 0; i < 14; i++) {
      const gx = -215 + (i % 5) * 4, gz = -178 + Math.floor(i / 5) * 4.5;
      const stone = P.box(0.7, 1.1, 0.2, 'brickGray');
      const g = new THREE.Group(); g.add(stone); stone.position.y = 0.55;
      this._prop({ group: g }, gx, gz, { yaw: (rng() - 0.5) * 0.4 });
    }
    this.props.fenceRun(-220, -172, -220, -196, this.group);
    this.props.fenceRun(-220, -196, -204, -196, this.group);
    // Bare dead trees
    for (let i = 0; i < 12; i++) {
      const x = -240 + rng() * 95, z = -240 + rng() * 95;
      if (this._nearBuilding(x, z, 7)) continue;
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 3.4, 5), this.veg.barkMat);
      trunk.position.y = 1.7;
      g.add(trunk);
      for (let b = 0; b < 3; b++) {
        const br = P.box(1.4, 0.09, 0.09, 'bark');
        br.position.set(0.4 - rng() * 0.8, 2 + rng() * 1.2, 0);
        br.rotation.z = 0.4 + rng() * 0.6;
        br.rotation.y = rng() * 3;
        g.add(br);
      }
      this._prop({ group: g, collide: [0.25, 1.7, 0.25] }, x, z);
    }
    this._sprinkleTufts(-195, -195, 45, 45, 30);
    this._zoneSpawns(5, 18, -195, -195, 0, 0);
  }

  /**
   * The vertical pass over Downtown: the Meridian Tower's glass shaft, rooftop
   * crowns with blinking aviation beacons on every high-rise, the abandoned
   * checkpoint on North Ave, alarmed parked cars and the library phone booth.
   */
  _highrise() {
    const P = this.props;

    // Meridian shaft: alternating spandrel and glass ribbon bands above the
    // lobby, corner piers, and a parapet crown. Solid to bullets and sight
    // lines, but it starts above head height so the lobby stays walkable.
    const m = this.built.get('meridianTower').spec;
    const sw = m.w - 1.6, sd = m.d - 1.6;
    const shaft = new THREE.Group();
    const floors = 9;
    let y = m.h + 0.35;
    for (let f = 0; f < floors; f++) {
      const band = this.kit.box(sw, 1.1, sd, 'wallConcrete');
      band.position.y = y + 0.55;
      const glass = this.kit.box(sw - 0.4, 1.5, sd - 0.4, 'window');
      glass.position.y = y + 1.85;
      shaft.add(band, glass);
      y += 2.6;
    }
    for (const [px, pz] of [[-sw / 2, -sd / 2], [sw / 2, -sd / 2], [-sw / 2, sd / 2], [sw / 2, sd / 2]]) {
      const pier = this.kit.box(0.7, y - m.h, 0.7, 'wallConcrete');
      pier.position.set(px, m.h + (y - m.h) / 2, pz);
      shaft.add(pier);
    }
    const cap = this.kit.box(sw + 0.6, 0.5, sd + 0.6, 'wallConcrete');
    cap.position.y = y + 0.25;
    shaft.add(cap);
    mergeStatic(shaft);
    shaft.position.set(m.x, m.y, m.z);
    this.group.add(shaft);
    this.collision.addBox(m.x - sw / 2, m.y + m.h, m.z - sd / 2, m.x + sw / 2, m.y + y + 0.5, m.z + sd / 2, 'wall');
    const crown = P.roofCrown(sw, sd, 'mast');
    crown.group.position.set(m.x, m.y + y + 0.5, m.z);
    this.group.add(crown.group);
    this.beacons.push({ mesh: crown.beacon, phase: 0.5 });

    // rooftop crowns + beacons for the solid towers
    let bi = 0;
    for (const [name, kind] of this._towerCrowns) {
      const t = this.built.get(name);
      if (!t) continue;
      const s = t.spec;
      const c = P.roofCrown(s.w - 0.6, s.d - 0.6, kind);
      c.group.position.set(s.x, s.y + s.h + 0.26, s.z);
      this.group.add(c.group);
      this.beacons.push({ mesh: c.beacon, phase: (bi++ * 0.37) % 1 });
    }

    // The North Ave checkpoint: barriers dragged across the lane, a cruiser
    // with its doors long closed. Nobody manned it for long.
    this._prop(P.jerseyBarrier(), -2.2, -78, { yaw: 0.12 });
    this._prop(P.jerseyBarrier(), 0.6, -77.2, { yaw: -0.1 });
    this._prop(P.jerseyBarrier(), 3.2, -78.4, { yaw: 0.2 });
    this._prop(P.crateStack(2), -5.5, -80);
    this._decal('oilStain', 1.5, -82, 2.0);
    const cruiser = P.parkedCar(0x22304a);
    this._prop(cruiser, 4.6, -84, { yaw: 0.5 });
    this._registerAlarmCar(cruiser, 4.6, -84);

    // alarmed civilian cars: shoot one and the horde goes to it, not you
    const lotCar = P.parkedCar(0x555c46);
    this._prop(lotCar, -42, -133.5, { yaw: 0.1 });
    this._registerAlarmCar(lotCar, -42, -133.5);
    const plazaCar = P.parkedCar(0x6b3a32);
    this._prop(plazaCar, 20, 6.5, { yaw: 0.05 });
    this._registerAlarmCar(plazaCar, 20, 6.5);
    const stationCar = P.parkedCar(0x39465e);
    this._prop(stationCar, 53, 17, { yaw: 0.2 });
    this._registerAlarmCar(stationCar, 53, 17);

    // the phone booth outside the library (Anomalies gives it its voice)
    const booth = P.phoneBooth();
    this._prop(booth, -86, -76, { yaw: Math.PI });
    this.phoneBoothPos = { x: -86, y: this.terrain.heightAt(-86, -76), z: -76 };

    // forecourt furniture along the corporate row
    for (const [x, z] of [[-96, -228], [-58, -228], [-24, -228]]) this._prop(P.lamppost(), x, z);
    this._prop(P.bench(), -88, -229, { yaw: 0.1 });
    this._prop(P.bench(), -32, -229, { yaw: -0.15 });
    this._prop(P.hydrant(), -50, -227);
  }

  _registerAlarmCar(car, x, z) {
    this.alarmCars.push({ x, y: this.terrain.heightAt(x, z), z, lights: car.lights });
  }

  /**
   * Things in the town you can actually put your hands on.
   *
   * Two of these are tools rather than dressing. The firehouse siren and the
   * record-shop turntable both emit a real 'noise' event — the same signal a
   * car alarm sends, so every zombie in earshot converges on the sound
   * instead of on you. Setting one running and leaving down the alley behind
   * it is a legitimate way to clear a block.
   *
   * The rest are here because a dead town you cannot touch is a diorama. They
   * also carry a share of the district's quiet wrongness: the notice is dated
   * after the evacuation it announces, and the pump still has pressure behind
   * it.
   */
  _cityInteractables() {
    const fire = this.built.get('firehouse');
    if (fire) {
      const s = fire.spec;
      const pos = { x: s.x + 3.6, y: s.y + 1.2, z: s.z + s.d / 2 - 1.6 };  // by the bay doors
      this.addInteractable({
        x: pos.x, z: pos.z, y: s.y, radius: 2.4,
        prompt: 'Start the siren [E]',
        onInteract: () => {
          this.events.emit('noise', { pos, radius: 110 });
          this.events.emit('car:alarm', { pos });
          this.events.emit('subtitle', { text: 'The siren winds up. Something in the street answers it.' });
        },
      });
    }

    const rec = this.built.get('recordShop');
    if (rec) {
      const s = rec.spec;
      const pos = { x: s.x + s.w / 2 - 1.6, y: s.y + 1.2, z: s.z - s.d / 2 + 1.4 };
      this.addInteractable({
        x: pos.x, z: pos.z, y: s.y, radius: 2.0,
        prompt: 'Drop the needle [E]',
        onInteract: () => {
          this.events.emit('noise', { pos, radius: 62 });
          this.events.emit('subtitle', { text: 'The record catches. It is a song you have never heard and know every word of.' });
          this.events.emit('whisper', { intensity: 0.5 });
        },
      });
    }

    // The carousel: give it a push and it runs faster for a while. It was
    // already turning before you touched it.
    const spin = this.spinners[0];
    if (spin?.node.parent) {
      const p = spin.node.parent;
      this.addInteractable({
        x: p.position.x, z: p.position.z, y: p.position.y, radius: 4.2,
        prompt: 'Push the carousel [E]',
        onInteract: () => {
          spin.speed = Math.min(1.5, spin.speed + 0.55);
          this.events.emit('subtitle', { text: 'It takes the push easily. It was never stiff.' });
        },
      });
    }

    // the park noticeboard, and Founders Square's pump
    this.addInteractable({
      x: -117, z: 12, y: this.terrain.heightAt(-117, 12), radius: 2.2,
      prompt: 'Read the notice [E]',
      onInteract: () => this.events.emit('subtitle', {
        text: 'EVACUATION COMPLETE — ALL RESIDENTS ACCOUNTED FOR. The date on it is next Tuesday.',
      }),
    });
    this.addInteractable({
      x: -40, z: -150.5, y: this.terrain.heightAt(-40, -150.5), radius: 2.2,
      prompt: 'Work the pump [E]',
      onInteract: () => {
        this.events.emit('anomaly:sound', { kind: 'drip', pos: { x: -40, y: 0, z: -150.5 } });
        this.events.emit('subtitle', { text: 'Still pressure behind it. Whatever comes up is warm.' });
      },
    });
  }

  _nearBuilding(x, z, margin) {
    for (const s of this.buildingSpecs) {
      if (Math.abs(x - s.x) < s.w / 2 + margin && Math.abs(z - s.z) < s.d / 2 + margin) return true;
    }
    return false;
  }

  _sprinkleTufts(cx, cz, hx, hz, count) {
    const rng = mulberry32(Math.floor(cx * 3 + cz * 7));
    const pts = [];
    for (let i = 0; i < count; i++) {
      const x = cx + (rng() - 0.5) * 2 * hx, z = cz + (rng() - 0.5) * 2 * hz;
      if (this._nearBuilding(x, z, 1)) continue;
      pts.push([x, z]);
    }
    if (pts.length) this.veg.tuftField(this.group, pts);
  }

  /**
   * The pond in the ravine.
   *
   * It used to be a flat disc dropped at the terrain height of its centre.
   * Water is flat and the ravine floor is not, so the disc cut straight
   * through the slope: five metres in the air on the high side, buried on the
   * low side, and dead still. A lake has to be a *basin* first.
   *
   * So the basin is a terrain pad (registered in _planTerrain, before the
   * ground mesh is built) and the water is a grid clipped to it: a quad is
   * emitted only where all four of its corners are genuinely below the water
   * line. The shoreline that falls out of that follows the real ground
   * exactly and can never float, and because the clip is done per cell the
   * edge is pixel-ragged in a way that suits the rest of the art.
   */
  _pond() {
    const b = this.pondBasin;
    const bed = this._clippedSheet(b, { drape: true, tex: 'dirt', tiles: 0.35, lift: 0.03 });
    if (bed) this.group.add(bed);
    const water = this._clippedSheet(b, {
      tex: 'water', tiles: 0.16,
      mat: { transparent: true, opacity: 0.88 },
    });
    if (water) {
      this.group.add(water);
      this.waterSurfaces.push({ mat: water.material, u: 0.011, v: 0.006 });
    }
    // A second sheet a hand's width above, scrolling the other way at a
    // different scale. Two slow drifts crossing each other is what reads as
    // moving water; one on its own just looks like a sliding texture.
    const sheen = this._clippedSheet(b, {
      tex: 'water', tiles: 0.075, lift: 0.05,
      mat: { transparent: true, opacity: 0.3, depthWrite: false },
    });
    if (sheen) {
      sheen.renderOrder = 3;
      this.group.add(sheen);
      this.waterSurfaces.push({ mat: sheen.material, u: -0.007, v: 0.013 });
    }
    this.addSurface(b.x - b.hx - 4, b.z - b.hz - 4, b.x + b.hx + 4, b.z + b.hz + 4, 'water');
  }

  /**
   * A horizontal (or terrain-draped) sheet covering only the cells where the
   * ground lies below `basin.level`. Returns null if nothing qualifies.
   */
  _clippedSheet(basin, { drape = false, tex, tiles, lift = 0, mat = {} } = {}) {
    const R = Math.max(basin.rx, basin.rz) + 2;
    const step = 0.9;
    const n = Math.ceil((R * 2) / step);
    const h = (x, z) => this.terrain.heightAt(x, z);
    const pos = [], uv = [], idx = [];
    let base = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = basin.x - R + i * step, z0 = basin.z - R + j * step;
        const x1 = x0 + step, z1 = z0 + step;
        if (!this._inBasin((x0 + x1) / 2, (z0 + z1) / 2)) continue;   // outside the bowl
        const c = [h(x0, z0), h(x1, z0), h(x1, z1), h(x0, z1)];
        if (Math.max(...c) >= basin.level - 0.02) continue;   // above the water line
        const ys = drape ? c.map((v) => v + lift) : [0, 0, 0, 0].map(() => basin.level + lift);
        pos.push(x0, ys[0], z0, x1, ys[1], z0, x1, ys[2], z1, x0, ys[3], z1);
        uv.push(x0 * tiles, z0 * tiles, x1 * tiles, z0 * tiles, x1 * tiles, z1 * tiles, x0 * tiles, z1 * tiles);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        base += 4;
      }
    }
    if (!base) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: this.texLib.tiled(tex, 1, 1), ...mat,
    }));
  }

  /**
   * How far the water reaches on a given bearing from the basin centre —
   * used to stand reeds, boats and jetties on the actual shore instead of
   * guessing a radius and finding half of them afloat.
   */
  _shoreRadius(angle, from = 4) {
    const b = this.pondBasin;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const to = Math.max(b.rx, b.rz) + 1;
    for (let r = from; r <= to; r += 0.35) {
      const x = b.x + dx * r, z = b.z + dz * r;
      if (!this._inBasin(x, z) || this.terrain.heightAt(x, z) >= b.level) return r;
    }
    return to;
  }

  /**
   * Inside the pond's bounding ellipse, and clear of every building — the
   * limit of the water sheet. The building test is not fussiness: the
   * boathouse sits on its own pad at its own grade, so without it the lake
   * runs straight through the floor of the one structure on its bank.
   */
  _inBasin(x, z) {
    const b = this.pondBasin;
    const dx = (x - b.x) / b.rx, dz = (z - b.z) / b.rz;
    if (dx * dx + dz * dz > 1) return false;
    for (const s of this.buildingSpecs) {
      if (Math.abs(x - s.x) < s.w / 2 + 1.2 && Math.abs(z - s.z) < s.d / 2 + 1.2) return false;
    }
    return true;
  }

  /**
   * Spawn points placed deliberately BEHIND cover, with the cover planted to
   * make sure of it.
   *
   * Scattered spawns (see _zoneSpawns) put things on open ground, which in a
   * park means you watch them arrive from sixty metres away. These sit in the
   * lee of a trunk, a boulder or a bush thicket: each one gets a screen of
   * vegetation planted between it and the direction you would be looking
   * from, so the first you know of it is the movement, not the spawn.
   *
   * @param {number} zone
   * @param {Array<[number, number, number, number]>} spots
   *        [x, z, screenX, screenZ] — the point, and the direction the cover
   *        goes in (normally toward the open ground you would approach from).
   */
  _concealedSpawns(zone, spots) {
    for (const [x, z, sx, sz] of spots) {
      const len = Math.hypot(sx, sz) || 1;
      const nx = sx / len, nz = sz / len;
      // a screen of two bushes and a tree, offset across the sight line so it
      // reads as undergrowth rather than as a planted wall
      this.veg.bush(this.group, x + nx * 1.6 - nz * 0.9, z + nz * 1.6 + nx * 0.9, 1.15);
      this.veg.bush(this.group, x + nx * 2.1 + nz * 0.8, z + nz * 2.1 - nx * 0.8, 0.95);
      this.veg.tree(this.group, x + nx * 3.2 + nz * 1.4, z + nz * 3.2 - nx * 1.4, 1.05);
      this.spawnPoints.push({ x, z, zone, indoor: false });
    }
  }

  /** Outdoor spawn points scattered through a zone (off nav-blocked cells). */
  _zoneSpawns(zone, count, cx, cz) {
    const r = ZONES[zone].rect;
    const rng = mulberry32(zone * 97 + 13);
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 20) {
      const x = r.minX + 6 + rng() * (r.maxX - r.minX - 12);
      const z = r.minZ + 6 + rng() * (r.maxZ - r.minZ - 12);
      if (this._nearBuilding(x, z, 2)) continue;
      this.spawnPoints.push({ x, z, zone, indoor: false });
      placed++;
    }
  }

  _spawnGrid() {
    // Drop spawn points that ended up on blocked nav cells.
    this.spawnPoints = this.spawnPoints.filter((p) => {
      const cx = this.nav.toCell(p.x), cz = this.nav.toCell(p.z);
      return p.indoor || !this.nav.isBlocked(cx, cz);
    });
  }
}
