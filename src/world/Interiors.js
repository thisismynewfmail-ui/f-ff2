import * as THREE from '../../lib/three.module.js';
import { buildWeaponModel } from '../weapons/WeaponModels.js';
import { local2world, mergeStatic, mulberry32 } from './Buildings.js';
import { MACHINES, MACHINE_IDS, marqueeArt, screenSheet, sideArt, cabinetSkin }
  from '../rendering/Arcade.js';

/**
 * Interior population: furniture, equipment, loot containers, spawn points
 * and environmental storytelling for every enterable building, keyed by the
 * building's function (`spec.use`).
 *
 * Every layout is written once in a *canonical frame* where the door is on
 * the south (+Z) wall; `canonXform` rotates the layout to match the actual
 * door side, so one `_house` fits a house facing any street. Placements are
 * guarded against the door approach and the interior bounds, so a layout
 * degrades gracefully inside small footprints.
 *
 * Furniture registers real colliders (cover in combat) but does NOT block
 * the nav grid — rooms stay pathable and steering handles local avoidance.
 * Containers marked `loot` add world loot points; `_spawnAt` adds indoor
 * enemy spawn opportunities tied to the building's function.
 */

/** Half-width of the doorway, and how far into the room the entry lane that
 *  furniture may not stand in reaches. */
const DOOR_HALF = 0.85;
const DOOR_LANE = 2.6;
/** ...and the same idea for the doorways INSIDE a building. A partition's gap
 *  is the only way through to the room behind it, so nothing with a footprint
 *  may stand in it or in the stride either side — a body is 0.76 m across and
 *  has to be able to turn as it comes through. */
const GAP_LANE = 0.85;
/** How much two pieces may share before it reads as one growing out of the
 *  other. Loose enough that a chair tucked under a table is still fine. */
const FURNITURE_GAP = 0.12;

/**
 * THE THREE WEAPONS THAT ARE NOT IN THE STARTING LOADOUT.
 *
 * A run begins with a pistol and a bat. Every shoulder weapon in the game is
 * out in the town, in the building somebody left it in, and each one is a
 * district further out than the last:
 *
 *   coachgun    Eastgate, the blue clapboard house on the north side of
 *               Main St East — the first lot inside the district gate
 *   Foundry Gun Downtown, on the floor of the arcade on the south strip,
 *               where somebody put it down and did not come back for it
 *   long rifle  Southside Industrial, in the filling station out on the road
 *
 * That is the whole point of them being here rather than on the wheel: the
 * first fifty kills are a pistol run, and every one of these is a reward for
 * getting further out than you have been.
 *
 * `building` is a building NAME, not a use — these are the only three things
 * in the town placed by name. All three are laid out in the SAME case by the
 * same code (see weaponCase), so none of them can end up clipped into a wall
 * while the others are fine, and `spot` is an optional hand-picked canonical
 * position for a room whose floor plan the generic candidates do not suit.
 */
export const WEAPON_CACHES = [
  {
    id: 'shotgun', building: 'house01', loose: 'shells',
    prompt: 'Take the coachgun [E]',
    ammo: { type: 'ammo_shotgun', amount: 16, label: 'Shotgun shells' },
    found: 'A break-action coachgun, still oiled, and sixteen shells loose in the case. Somebody kept this well.',
  },
  {
    // The arcade has no back room to lay a case along, so this one is where a
    // case gets left in a room like that: open floor, in front of the machines.
    id: 'rifle', building: 'arcade', loose: 'drums', spot: [1.2, -1.3, Math.PI],
    prompt: 'Take the Foundry Gun [E]',
    ammo: { type: 'ammo_rifle', amount: 120, label: 'Rifle rounds' },
    found: 'A Foundry Gun, cased on the arcade floor with two full pan drums beside it. Somebody put this down and did not come back.',
  },
  {
    id: 'sniper', building: 'gasShop', loose: 'clips',
    prompt: 'Take the long rifle [E]',
    ammo: { type: 'ammo_sniper', amount: 15, label: 'Rifle clips' },
    found: 'A Meridian long rifle, cased on the floor of the filling station with three clips beside it. Whoever was watching this road was watching it a long way off.',
  },
];

/** How far past the case's own footprint the pool of light around it reaches.
 *  Every placement test is done on the LIT footprint rather than the solid
 *  one, because a glow through a wall is as wrong as a lid through one. */
const GLOW_PAD = 0.10;
/** Half a partition wall plus the air a case has to leave off one. */
const PART_BAND = 0.28;

/** Canonical-frame transform for a door side. cw/cd are the canonical
 *  width (door wall) and depth; m maps canonical -> building-local coords. */
export function canonXform(w, d, door) {
  switch (door) {
    case 'N': return { cw: w, cd: d, m: (x, z) => [-x, -z], yaw: Math.PI };
    case 'E': return { cw: d, cd: w, m: (x, z) => [z, -x], yaw: Math.PI / 2 };
    case 'W': return { cw: d, cd: w, m: (x, z) => [-z, x], yaw: -Math.PI / 2 };
    default: return { cw: w, cd: d, m: (x, z) => [x, z], yaw: 0 };
  }
}

/** Map canonical-frame partitions to the building-local partitions the
 *  BuildingKit consumes. Canonical axis 'x' runs along canonical X at z=at. */
export function mapPartitions(w, d, door, parts) {
  const c = canonXform(w, d, door);
  return parts.map((p) => {
    const [ax, az] = p.axis === 'x' ? [p.from, p.at] : [p.at, p.from];
    const [bx, bz] = p.axis === 'x' ? [p.to, p.at] : [p.at, p.to];
    const gap = p.gapAt ?? (p.from + p.to) / 2;
    const [gx, gz] = p.axis === 'x' ? [gap, p.at] : [p.at, gap];
    const A = c.m(ax, az), B = c.m(bx, bz), G = c.m(gx, gz);
    const alongX = Math.abs(B[0] - A[0]) > Math.abs(B[1] - A[1]);
    return alongX
      ? { axis: 'x', at: A[1], from: Math.min(A[0], B[0]), to: Math.max(A[0], B[0]), gapAt: G[0], gapW: p.gapW }
      : { axis: 'z', at: A[0], from: Math.min(A[1], B[1]), to: Math.max(A[1], B[1]), gapAt: G[1], gapW: p.gapW };
  });
}

/** Bedroom wall across the far end of a small house. */
export function housePartitions(w, d, door) {
  const { cw, cd } = canonXform(w, d, door);
  return mapPartitions(w, d, door, [
    { axis: 'x', at: -cd / 2 + 3.1, from: -cw / 2 + 0.3, to: cw / 2 - 0.3, gapAt: cw / 4, gapW: 1.2 },
  ]);
}

/** Maintenance room walled off across the back of a tower lobby. */
export function lobbyPartitions(w, d, door) {
  const { cw, cd } = canonXform(w, d, door);
  return mapPartitions(w, d, door, [
    { axis: 'x', at: -cd / 2 + 3.2, from: -cw / 2 + 0.3, to: cw / 2 - 0.3, gapAt: cw / 2 - 1.6, gapW: 1.2 },
  ]);
}

/** Walled-off corner office in the far-right corner of a warehouse. */
export function officePartitions(w, d, door) {
  const { cw, cd } = canonXform(w, d, door);
  return mapPartitions(w, d, door, [
    { axis: 'x', at: -cd / 2 + 4, from: cw / 2 - 4.5, to: cw / 2 - 0.3, gapAt: cw / 2 - 3.6, gapW: 1.2 },
    { axis: 'z', at: cw / 2 - 4.5, from: -cd / 2 + 0.3, to: -cd / 2 + 4, gapW: 0 },
  ]);
}

/** A canvas as a nearest-neighbour texture — the arcade's marquee and tube art. */
function retroCanvas(cv, { repeat = null } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.needsUpdate = true;
  return t;
}

export class InteriorKit {
  constructor(world) {
    this.w = world;
    this.P = world.props;
    this.kit = world.kit;
    this.populated = [];
    this.rejects = [];        // pieces refused for landing inside something
    this._room = [];
    this._canons = new Map();
    this._mats = new Map();
  }

  populate(built) {
    const fn = this['_' + built.spec.use];
    if (built.spec.solid || !built.spec.use || !fn) return;
    // Everything this building's layout creates lands in one bucket that is
    // collapsed to a handful of merged meshes — interiors cost almost no
    // per-object overhead at render time.
    this._bucket = new THREE.Group();
    this._room = [];          // footprints already down in THIS building
    fn.call(this, built);
    // The two things in the town placed by NAME rather than by use: the
    // shoulder weapons, each in a particular house (see WEAPON_CACHES).
    const cache = WEAPON_CACHES.find((c) => c.building === built.spec.name);
    if (cache) this._placeWeaponCache(built, cache);
    mergeStatic(this._bucket);
    // A room, and marked as one: the town's cull draws interiors only from the
    // street they open onto (see World.cullToFog).
    this._bucket.userData.indoor = true;
    this.w.group.add(this._bucket);
    this.populated.push(built.spec.name);
  }

  /* ---------------- placement core ---------------- */

  _canon(spec) {
    if (!this._canons.has(spec)) this._canons.set(spec, canonXform(spec.w, spec.d, spec.door || 'S'));
    return this._canons.get(spec);
  }

  /**
   * Place a furniture maker at canonical coords (lx, lz). Skips anything
   * outside the walls or blocking the door approach. opts:
   *   yaw     extra rotation in the canonical frame
   *   lift    extra height (mezzanine decks)
   *   loot    [ox, oz] canonical offset for a loot point (or true for front)
   *   spawn   register an indoor enemy spawn point here
   *   collide override the maker's collider ([hx,hy,hz] or null)
   */
  _put(built, maker, lx, lz, opts = {}) {
    const spec = built.spec;
    const c = this._canon(spec);
    const doorX = (spec.doorOffset ?? 0) * c.cw / 2;
    // The entry lane is a fraction of the room, never most of it: a fixed
    // 2.6 m lane is right for a shop and absurd inside a 2.8 m garden shed,
    // where it would refuse every shelf and leave the building empty.
    const lane = Math.min(DOOR_LANE, c.cd * 0.5);
    if (Math.abs(lx) > c.cw / 2 - 0.5 || Math.abs(lz) > c.cd / 2 - 0.5) return null;
    if (Math.hypot(lx - doorX, lz - c.cd / 2) < Math.min(1.7, c.cd * 0.42)) return null;
    const [mx, mz] = c.m(lx, lz);
    const p = local2world(spec, spec.rot || 0, mx, mz);
    const yaw = (opts.yaw ?? 0) + c.yaw - (spec.rot || 0) * Math.PI / 180;
    // Nothing may stand in the doorway. The radius test above only guards the
    // anchor point, which is fine for a chair and useless for a fire engine —
    // so anything with a footprint is tested as a footprint against the
    // entry lane, and simply not placed if it would block the way in.
    const foot = opts.collide === undefined ? maker.collide : opts.collide;
    if (foot && !opts.lift) {
      let [fx, , fz] = foot;
      const q = Math.round((opts.yaw ?? 0) / (Math.PI / 2));
      if (Math.abs((opts.yaw ?? 0) - q * Math.PI / 2) < 0.2 && Math.abs(q) % 2 === 1) [fx, fz] = [fz, fx];
      const overlapsX = Math.abs(lx - doorX) < fx + DOOR_HALF;
      const overlapsZ = lz + fz > c.cd / 2 - lane && lz - fz < c.cd / 2;
      if (overlapsX && overlapsZ) return null;
      // ...and the same for the doorways INSIDE the building, which the entry
      // lane above knows nothing about.
      if (!this._clearOfDoorways(spec, c, lx, lz, opts.yaw ?? 0, foot)) return null;
    }
    const collide = opts.collide === undefined ? maker.collide : opts.collide;
    const baseY = spec.y + 0.12 + (opts.lift ?? 0);
    // Nothing may stand inside something already in the room.
    //
    // Layouts are written once in a canonical frame and then rotated to match
    // whichever wall the door is on, so a pair that reads as comfortably apart
    // in the source can end up inside each other the moment a narrower
    // footprint or a mirrored variant reshapes the frame — which is exactly
    // how a television ended up growing out of a writing desk. The plan cannot
    // see it and a reviewer cannot either, so the check lives at the point of
    // placement: first come, first served, and a piece that would intersect an
    // earlier one is simply not put down. Refusals are recorded rather than
    // silently swallowed, so tests/world.mjs can name the room.
    let box = null;
    if (collide) {
      let [hx, hy, hz] = collide;
      const q = Math.round(yaw / (Math.PI / 2));
      if (Math.abs(yaw - q * Math.PI / 2) < 0.2 && Math.abs(q) % 2 === 1) [hx, hz] = [hz, hx];
      box = {
        minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz,
        minY: baseY, maxY: baseY + hy * 2, hy, lx, lz,
      };
      const hit = this._occupied(box);
      if (hit) {
        // Canonical coordinates for both pieces, so a refusal reads straight
        // back to the two layout lines that disagree.
        this.rejects.push(
          `${spec.use}:${spec.name} ${lx.toFixed(1)},${lz.toFixed(1)} into ${hit.lx.toFixed(1)},${hit.lz.toFixed(1)}`);
        return null;
      }
    }
    const g = maker.group;
    g.position.set(p.x, baseY, p.z);
    g.rotation.y = yaw;
    // A `live` maker keeps its hierarchy: it goes straight into the world
    // instead of the merge bucket. mergeStatic flattens a group into one mesh
    // per material and clears it, which silently detaches every sub-group
    // inside it — the piano's hinged key bank was registered for animation,
    // dutifully animated every frame, and no longer attached to anything you
    // could see. Anything with a moving part or its own screen has to opt out.
    (maker.live ? this.w.group : this._bucket).add(g);
    if (box) {
      this._room.push(box);
      // The id comes back so a piece that can LEAVE — the weapon cases, which
      // pack themselves away once you have taken what was in them — can take
      // its collider with it instead of leaving a box you walk into.
      g.userData.colliderId = this.w.collision.addBoxCentered(p.x, baseY + box.hy, p.z,
        (box.maxX - box.minX) / 2, box.hy, (box.maxZ - box.minZ) / 2, 'furniture');
    }
    if (opts.loot) {
      const [ox, oz] = opts.loot === true ? [0, 0.8] : opts.loot;
      const [lmx, lmz] = c.m(lx + ox, lz + oz);
      const lp = local2world(spec, spec.rot || 0, lmx, lmz);
      this.w.lootPoints.push({ x: lp.x, z: lp.z, zone: spec.zone });
    }
    if (opts.spawn) this.w.spawnPoints.push({ x: p.x, z: p.z, zone: spec.zone, indoor: true });
    return g;
  }

  /**
   * Is this footprint clear of the building's INTERIOR doorways?
   *
   * The front door has been guarded since the beginning; the doorway through
   * to the bedroom had not been, and it is the one that matters more — walk
   * into a house and the way on is a 1.2 m gap in one wall, so anything
   * standing in it seals off half the building for the player, the horde and
   * the pathfinder alike. It happened for a reason that no reviewer could see
   * in the layout: partitions are stated ONCE per plan and their gap always
   * falls in the same quarter of the canonical frame, while the furniture plan
   * MIRRORS for one variant in three. Half the houses in the town therefore
   * swung a writing desk across their own bedroom door.
   *
   * Partitions live in the building-local frame, so the footprint is taken
   * there to meet them: the door's own quarter turn rides on top of the
   * piece's yaw, and a quarter turn swaps the footprint's two half-extents.
   */
  _clearOfDoorways(spec, c, lx, lz, yaw, foot) {
    const parts = spec.partitions;
    if (!parts || !parts.length) return true;
    const a = yaw + c.yaw;
    const q = Math.round(a / (Math.PI / 2));
    const turned = Math.abs(a - q * (Math.PI / 2)) < 0.2 && Math.abs(q) % 2 === 1;
    const [hx, hz] = turned ? [foot[2], foot[0]] : [foot[0], foot[2]];
    const [mx, mz] = c.m(lx, lz);
    for (const p of parts) {
      if (!(p.gapW > 0)) continue;
      const gap = p.gapAt ?? (p.from + p.to) / 2, half = p.gapW / 2;
      const r = p.axis === 'x'
        ? { minX: gap - half, maxX: gap + half, minZ: p.at - GAP_LANE, maxZ: p.at + GAP_LANE }
        : { minX: p.at - GAP_LANE, maxX: p.at + GAP_LANE, minZ: gap - half, maxZ: gap + half };
      if (Math.min(mx + hx, r.maxX) > Math.max(mx - hx, r.minX)
        && Math.min(mz + hz, r.maxZ) > Math.max(mz - hz, r.minZ)) return false;
    }
    return true;
  }

  /** Does this footprint intersect anything already placed in this room?
   *  All three axes, so a lamp standing ON a nightstand is not a clash. */
  _occupied(box) {
    for (const o of this._room) {
      if (Math.min(box.maxX, o.maxX) - Math.max(box.minX, o.minX) <= FURNITURE_GAP) continue;
      if (Math.min(box.maxZ, o.maxZ) - Math.max(box.minZ, o.minZ) <= FURNITURE_GAP) continue;
      if (Math.min(box.maxY, o.maxY) - Math.max(box.minY, o.minY) <= FURNITURE_GAP) continue;
      return o;
    }
    return null;
  }

  _pt(built, lx, lz) {
    const c = this._canon(built.spec);
    const [mx, mz] = c.m(lx, lz);
    return local2world(built.spec, built.spec.rot || 0, mx, mz);
  }

  _rectWorld(built, x1, z1, x2, z2) {
    const a = this._pt(built, x1, z1), b = this._pt(built, x2, z2);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  }

  _spawnAt(built, lx, lz) {
    const p = this._pt(built, lx, lz);
    this.w.spawnPoints.push({ x: p.x, z: p.z, zone: built.spec.zone, indoor: true });
  }

  _mat(key, make) {
    if (!this._mats.has(key)) this._mats.set(key, make());
    return this._mats.get(key);
  }

  /* ---------------- storytelling details ---------------- */

  /** Scattered papers on the floor — someone left in a hurry. */
  _papers(built, lx, lz, n = 4) {
    const rng = mulberry32(Math.floor(built.spec.x * 5 + built.spec.z * 11 + lx * 3) & 0x7fffffff);
    const mat = this._mat('paper', () => new THREE.MeshLambertMaterial({ color: 0xd6d2c4, side: THREE.DoubleSide }));
    for (let i = 0; i < n; i++) {
      const p = this._pt(built, lx + (rng() - 0.5) * 2.4, lz + (rng() - 0.5) * 2.4);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.38), mat);
      q.rotation.set(-Math.PI / 2, 0, rng() * Math.PI);
      q.position.set(p.x, built.spec.y + 0.125 + i * 0.004, p.z);
      q.renderOrder = 2;
      this._bucket.add(q);
    }
  }

  /** A meal abandoned on a table (call after placing the table). */
  _meal(built, lx, lz) {
    const p = this._pt(built, lx, lz);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 8),
      this._mat('plate', () => new THREE.MeshLambertMaterial({ color: 0xc8c2b0 })));
    plate.position.set(p.x, built.spec.y + 0.92, p.z);
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.05, 6),
      this._mat('food', () => new THREE.MeshLambertMaterial({ color: 0x5e482c })));
    food.position.set(p.x, built.spec.y + 0.95, p.z);
    this._bucket.add(plate, food);
  }

  _decalAt(built, tex, lx, lz, size, tint) {
    const c = this._canon(built.spec);
    if (Math.abs(lx) > c.cw / 2 - 0.4 || Math.abs(lz) > c.cd / 2 - 0.4) return;
    const p = this._pt(built, lx, lz);
    const mat = this._mat(tex + ':' + tint, () => new THREE.MeshLambertMaterial({
      map: this.w.texLib.get(tex), transparent: true, depthWrite: false, ...(tint ? { color: tint } : {}),
    }));
    const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    q.rotation.set(-Math.PI / 2, 0, (lx * 7 + lz * 13) % 3);
    q.position.set(p.x, built.spec.y + 0.125, p.z);
    q.renderOrder = 2;
    this._bucket.add(q);
  }

  _stain(built, lx, lz, size = 1.3, color = 0x4a1414) { this._decalAt(built, 'shadowDecal', lx, lz, size, color); }
  _stainOil(built, lx, lz, size = 1.5) { this._decalAt(built, 'oilStain', lx, lz, size, null); }

  /* ---------------- furniture factories ---------------- */

  table(w = 1.6, dd = 0.9) {
    const g = new THREE.Group();
    const top = this.P.box(w, 0.07, dd, 'floorWood');
    top.position.y = 0.73;
    g.add(top);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = this.P.box(0.09, 0.7, 0.09, 'wallWood');
      leg.position.set(sx * (w / 2 - 0.12), 0.35, sz * (dd / 2 - 0.12));
      g.add(leg);
    }
    return { group: g, collide: [w / 2, 0.42, dd / 2] };
  }

  chair() {
    const g = new THREE.Group();
    const seat = this.P.box(0.46, 0.07, 0.46, 'wallWood');
    seat.position.y = 0.45;
    const back = this.P.box(0.46, 0.5, 0.07, 'wallWood');
    back.position.set(0, 0.78, -0.2);
    g.add(seat, back);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = this.P.box(0.06, 0.45, 0.06, 'wallWood');
      leg.position.set(sx * 0.18, 0.22, sz * 0.18);
      g.add(leg);
    }
    return { group: g, collide: [0.25, 0.5, 0.25] };
  }

  /** A chair knocked onto its side. No collider — it's debris underfoot. */
  tippedChair() {
    const c = this.chair();
    c.group.rotation.set(0, 0.7, Math.PI / 2 - 0.12);
    return { group: c.group, collide: null };
  }

  stool() {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 8), this.P.mat('wallWood'));
    seat.position.y = 0.62;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6), this.P.colorMat(0x2c3036));
    leg.position.y = 0.3;
    g.add(seat, leg);
    return { group: g, collide: [0.22, 0.35, 0.22] };
  }

  bed() {
    const g = new THREE.Group();
    const frame = this.P.box(1.0, 0.3, 2.05, 'wallWood');
    frame.position.y = 0.25;
    const mattress = this.P.box(0.92, 0.18, 1.9, this.P.colorMat(0x8a8878));
    mattress.position.y = 0.48;
    const pillow = this.P.box(0.7, 0.12, 0.4, this.P.colorMat(0xb8b4a4));
    pillow.position.set(0, 0.6, -0.72);
    const head = this.P.box(1.0, 0.55, 0.08, 'wallWood');
    head.position.set(0, 0.55, -1.02);
    g.add(frame, mattress, pillow, head);
    return { group: g, collide: [0.52, 0.4, 1.05] };
  }

  /** Hospital cot: metal frame, thin pale mattress. */
  cot() {
    const g = new THREE.Group();
    const frame = this.P.box(0.9, 0.45, 2.0, 'metalRust');
    frame.position.y = 0.28;
    const mattress = this.P.box(0.84, 0.14, 1.9, this.P.colorMat(0xb4bab6));
    mattress.position.y = 0.56;
    g.add(frame, mattress);
    return { group: g, collide: [0.47, 0.4, 1.0] };
  }

  shelf(w = 1.8, books = true) {
    const g = new THREE.Group();
    const body = this.P.box(w, 2.2, 0.42, 'wallWood');
    body.position.y = 1.1;
    g.add(body);
    const cols = [0x7a3b30, 0x39586b, 0x6b7280, 0x8a6a2e];
    for (let r = 0; r < 3; r++) {
      const row = this.P.box(w - 0.2, 0.3, 0.1, this.P.colorMat(books ? cols[(r + Math.floor(w * 3)) % 4] : 0x241f18));
      row.position.set(0, 0.5 + r * 0.6, 0.22);
      g.add(row);
    }
    return { group: g, collide: [w / 2, 1.1, 0.22] };
  }

  counter(len = 2.4) {
    const g = new THREE.Group();
    const body = this.P.box(len, 1.0, 0.7, 'wallWood');
    body.position.y = 0.5;
    const top = this.P.box(len + 0.1, 0.06, 0.85, 'floorTile');
    top.position.y = 1.03;
    g.add(body, top);
    return { group: g, collide: [len / 2, 0.55, 0.43] };
  }

  desk() {
    const g = new THREE.Group();
    const top = this.P.box(1.5, 0.06, 0.8, 'floorWood');
    top.position.y = 0.74;
    const ped = this.P.box(0.45, 0.7, 0.7, 'wallWood');
    ped.position.set(0.5, 0.35, 0);
    const leg = this.P.box(0.07, 0.72, 0.7, 'wallWood');
    leg.position.set(-0.68, 0.36, 0);
    g.add(top, ped, leg);
    return { group: g, collide: [0.75, 0.4, 0.4] };
  }

  cabinet() {
    const g = new THREE.Group();
    const body = this.P.box(1.0, 1.3, 0.5, 'wallWood');
    body.position.y = 0.65;
    const face = this.P.box(0.9, 1.1, 0.06, 'doorWood');
    face.position.set(0, 0.65, 0.25);
    g.add(body, face);
    return { group: g, collide: [0.5, 0.7, 0.27] };
  }

  locker() {
    const g = new THREE.Group();
    const body = this.P.box(0.9, 1.9, 0.5, 'wallMetal');
    body.position.y = 0.95;
    const face = this.P.box(0.84, 1.8, 0.04, 'doorMetal');
    face.position.set(0, 0.95, 0.26);
    g.add(body, face);
    return { group: g, collide: [0.47, 0.95, 0.27] };
  }

  fridge() {
    const g = new THREE.Group();
    const body = this.P.box(0.75, 1.7, 0.7, this.P.colorMat(0x9aa39e));
    body.position.y = 0.85;
    const handle = this.P.box(0.05, 1.0, 0.05, this.P.colorMat(0x565e5a));
    handle.position.set(0.28, 0.9, 0.36);
    g.add(body, handle);
    return { group: g, collide: [0.4, 0.85, 0.38] };
  }

  stove() {
    const g = new THREE.Group();
    const body = this.P.box(0.75, 0.95, 0.7, this.P.colorMat(0x565a5e));
    body.position.y = 0.48;
    g.add(body);
    for (const [sx, sz] of [[-0.18, -0.15], [0.18, -0.15], [-0.18, 0.18], [0.18, 0.18]]) {
      const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 8), this.P.colorMat(0x1c1e20));
      burner.position.set(sx, 0.97, sz);
      g.add(burner);
    }
    return { group: g, collide: [0.4, 0.5, 0.38] };
  }

  sofa() {
    const g = new THREE.Group();
    const base = this.P.box(1.9, 0.45, 0.85, this.P.colorMat(0x5e4a38));
    base.position.y = 0.3;
    const back = this.P.box(1.9, 0.55, 0.25, this.P.colorMat(0x6a543f));
    back.position.set(0, 0.75, -0.3);
    g.add(base, back);
    for (const s of [-0.85, 0.85]) {
      const arm = this.P.box(0.2, 0.3, 0.85, this.P.colorMat(0x6a543f));
      arm.position.set(s, 0.62, 0);
      g.add(arm);
    }
    return { group: g, collide: [1.0, 0.5, 0.45] };
  }

  pew(len = 2.4) {
    const g = new THREE.Group();
    const seat = this.P.box(len, 0.09, 0.5, 'wallWood');
    seat.position.y = 0.46;
    const back = this.P.box(len, 0.62, 0.09, 'wallWood');
    back.position.set(0, 0.82, -0.26);
    g.add(seat, back);
    for (const s of [-len / 2 + 0.1, len / 2 - 0.1]) {
      const end = this.P.box(0.09, 0.62, 0.55, 'wallWood');
      end.position.set(s, 0.31, 0);
      g.add(end);
    }
    return { group: g, collide: [len / 2, 0.55, 0.3] };
  }

  altar() {
    const g = new THREE.Group();
    const slab = this.P.box(1.9, 0.95, 0.8, 'wallStone');
    slab.position.y = 0.48;
    const top = this.P.box(2.1, 0.09, 0.95, 'concrete');
    top.position.y = 1.0;
    const cloth = this.P.box(1.5, 0.02, 0.6, this.P.colorMat(0x7a2a2e));
    cloth.position.y = 1.06;
    g.add(slab, top, cloth);
    return { group: g, collide: [1.05, 0.55, 0.5] };
  }

  /** Open industrial shelving with a few crates left on it. */
  rack(len = 3) {
    const g = new THREE.Group();
    for (const s of [-len / 2 + 0.1, len / 2 - 0.1]) {
      const up = this.P.box(0.12, 2.4, 0.9, 'metalRust');
      up.position.set(s, 1.2, 0);
      g.add(up);
    }
    for (const yy of [0.5, 1.3, 2.1]) {
      const slab = this.P.box(len, 0.08, 0.95, 'wallWood');
      slab.position.y = yy;
      g.add(slab);
    }
    for (const [ox, oy] of [[-len / 4, 0.54], [len / 5, 0.54], [-len / 6, 1.34], [len / 3.2, 2.14]]) {
      const c = this.P.box(0.62, 0.62, 0.62, 'crate');
      c.position.set(ox, oy + 0.31, 0);
      g.add(c);
    }
    return { group: g, collide: [len / 2, 1.25, 0.5] };
  }

  workbench(len = 2) {
    const g = new THREE.Group();
    const top = this.P.box(len, 0.09, 0.85, 'wallWood');
    top.position.y = 0.88;
    g.add(top);
    for (const s of [-len / 2 + 0.15, len / 2 - 0.15]) {
      const leg = this.P.box(0.12, 0.85, 0.75, 'metalRust');
      leg.position.set(s, 0.44, 0);
      g.add(leg);
    }
    for (const [ox, oz, c] of [[-0.4, 0.1, 0x8a2a22], [0.3, -0.15, 0x39465e], [0.05, 0.2, 0x6b7280]]) {
      const tool = this.P.box(0.28, 0.12, 0.16, this.P.colorMat(c));
      tool.position.set(ox, 0.98, oz);
      g.add(tool);
    }
    return { group: g, collide: [len / 2, 0.5, 0.45] };
  }

  /** Heavy factory machine — hard cover. */
  machine() {
    const g = new THREE.Group();
    const body = this.P.box(1.8, 1.6, 1.2, 'wallMetal');
    body.position.y = 0.8;
    const hopper = this.P.box(1.0, 0.7, 0.9, 'metalRust');
    hopper.position.set(0.2, 1.95, 0);
    const panel = this.P.box(0.5, 0.4, 0.06, this.P.colorMat(0x2e4433));
    panel.position.set(-0.6, 1.1, 0.64);
    g.add(body, hopper, panel);
    return { group: g, collide: [0.95, 1.2, 0.65] };
  }

  /**
   * An arcade cabinet — a specific machine, not a coloured box.
   *
   * Each one wears its own game: the marquee carries that game's title, the
   * screen shows a real frame OF that game (drawn by Arcade.screenArt, so a
   * cabinet across the room is recognisably the machine you played), and the
   * body and trim are in its palette. The tube keeps the attract flicker every
   * screen in this town has; the marquee runs off the same tube, so a cabinet
   * dying takes its own sign with it.
   *
   * `live`: the cabinet keeps its own materials and hierarchy rather than
   * being flattened into the room's merge, because its screen is its own
   * texture and its own flicker phase.
   */
  arcadeCab(id) {
    const g = new THREE.Group();
    const body = this.P.box(0.72, 1.75, 0.8, this._cabSkin(id));
    body.position.y = 0.88;
    // PRINTED side art, not a coloured slab: deco rays, the title running up
    // the flank, and the paint kicked off along the bottom edge. Planes rather
    // than boxes for the same reason the marquee is one — P.box rescales UVs
    // by physical size, which would crop the artwork instead of fitting it.
    for (const sx of [-1, 1]) {
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.1), this._sideArtMat(id));
      art.position.set(sx * 0.363, 1.0, -0.02);
      // Yaw alone is enough, and a scale flip is actively wrong: turning the
      // plane to face out already carries its U axis round with it, so
      // mirroring on top of that reverses the printing and the title comes out
      // backwards on one flank.
      art.rotation.y = sx * Math.PI / 2;
      g.add(art);
    }
    const face = this._screenFace(id);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), face.mat);
    screen.position.set(0, 1.35, 0.412);
    const hood = this.P.box(0.62, 0.06, 0.1, this.P.colorMat(0x14161a));   // glare hood
    hood.position.set(0, 1.6, 0.44);
    // A PLANE, not a box: PropKit.box rescales UVs by physical size for tiling
    // wall textures, which maps a corner of a 128x32 sign across the whole
    // face — the marquee came out as a flat coloured bar with the title
    // stretched off the edge of it. Art wants 0..1 UVs.
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.17), this._marqueeMat(id));
    marquee.position.set(0, 1.71, 0.428);
    const marqueeBox = this.P.box(0.64, 0.19, 0.05, this.P.colorMat(0x0c0e0a));
    marqueeBox.position.set(0, 1.71, 0.4);
    const deck = this.P.box(0.6, 0.08, 0.3, this.P.colorMat(0x1c2026));
    deck.position.set(0, 0.95, 0.48);
    g.add(body, screen, hood, marqueeBox, marquee, deck);
    // stick, buttons and a coin door, so the deck reads as something you play
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.1, 5), this.P.colorMat(0x14161a));
    stick.position.set(-0.17, 1.03, 0.48);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), this.P.colorMat(0x8c2a22));
    ball.position.set(-0.17, 1.09, 0.48);
    const coin = this.P.box(0.24, 0.16, 0.03, this.P.colorMat(0x2a2d24));
    coin.position.set(0, 0.62, 0.41);
    const slot = this.P.box(0.02, 0.06, 0.02, this.P.colorMat(0x07080a));
    slot.position.set(0, 0.64, 0.43);
    g.add(stick, ball, coin, slot);
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 6),
        this.P.colorMat([0xc8b040, 0x3a6ea8, 0x40a06a][i]));
      btn.position.set(0.02 + i * 0.08, 1.0, 0.48);
      g.add(btn);
    }
    return { group: g, collide: [0.38, 0.9, 0.45], live: true, machine: id, flip: face.flip };
  }

  /** The lit marquee: this machine's title, on its own flicker phase. */
  _marqueeMat(id) {
    const tex = this._mat('marqueeTex:' + id, () => retroCanvas(marqueeArt(id)));
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
    this.w._animateMat(mat, 'tube', { r: 1, g: 1, b: 1, hi: 0.95, lo: 0.22, duty: 0.93, rate: 0.6 + Math.random() });
    return mat;
  }

  /**
   * The tube: the machine's own game, PLAYING.
   *
   * Four frames of its attract loop live in one 2x2 atlas, and the world's
   * existing flipbook driver walks them in order on a slow beat — so a cabinet
   * across the room reads as something running rather than as a lit still. The
   * tube flicker rides on top of it on its own phase, so a machine dying takes
   * its picture with it.
   */
  _screenFace(id) {
    const tex = this._mat('screenSheet:' + id, () => retroCanvas(screenSheet(id)));
    tex.repeat.set(0.5, 0.5);
    tex.offset.set(0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
    // The flip entry is handed back so _cabinet can stamp the cabinet's world
    // position on it once it is placed — that is what lets the attract bleep
    // come from the machine rather than from nowhere.
    const flip = this.w._animateMat(null, 'flip', {
      map: tex, cols: 2, rows: 2, rate: 0.34 + Math.random() * 0.1, frame: 0, steady: true, sound: id,
    });
    this.w._animateMat(mat, 'tube', { r: 1, g: 1, b: 1, hi: 0.9, lo: 0.16, duty: 0.9, rate: 0.5 + Math.random() });
    return { mat, flip };
  }

  /** Painted sheet steel, tiled over the cabinet body. */
  _cabSkin(id) {
    return this._mat('cabSkin:' + id, () => new THREE.MeshLambertMaterial({
      map: retroCanvas(cabinetSkin(id), { repeat: 4 }),
    }));
  }

  /** The printed flank. Double-sided so the mirrored copy still shows. */
  _sideArtMat(id) {
    return this._mat('cabArt:' + id, () => new THREE.MeshLambertMaterial({
      map: retroCanvas(sideArt(id)), side: THREE.DoubleSide,
    }));
  }

  displayStand() {
    const g = new THREE.Group();
    const ped = this.P.box(0.6, 0.9, 0.6, 'wallPlaster');
    ped.position.y = 0.45;
    g.add(ped);
    return { group: g, collide: [0.32, 0.5, 0.32] };
  }

  /** Potted lobby plant, long past watering but still green. */
  plant() {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 7), this.P.colorMat(0x6e4634));
    pot.position.y = 0.2;
    const leaf = this.w.veg._cross(this.w.veg.bushMat, 0.85, 0.95);
    leaf.position.y = 0.34;
    g.add(pot, leaf);
    return { group: g, collide: [0.26, 0.4, 0.26] };
  }

  /** Sealed elevator: brushed doors, a call panel, a floor dial stuck between
   *  floors. The doors never open — but the building remembers having floors. */
  elevatorDoors() {
    const g = new THREE.Group();
    const frame = this.P.box(1.9, 2.5, 0.16, 'wallConcrete');
    frame.position.y = 1.25;
    const doors = this.P.box(1.5, 2.3, 0.1, 'doorMetal');
    doors.position.set(0, 1.15, 0.06);
    const seam = this.P.box(0.03, 2.3, 0.12, this.P.colorMat(0x14161a));
    seam.position.set(0, 1.15, 0.06);
    const dial = this.P.box(0.6, 0.18, 0.06, this.P.colorMat(0x2d2a24));
    dial.position.set(0, 2.62, 0.06);
    g.add(frame, doors, seam, dial);
    return { group: g, collide: [0.95, 1.25, 0.12] };
  }

  /* ---------------- domestic furnishings ---------------- */

  /** Chest of drawers. One drawer was pulled out and never pushed back. */
  dresser() {
    const g = new THREE.Group();
    const body = this.P.box(1.15, 0.88, 0.52, 'wallWood');
    body.position.y = 0.44;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const open = i === 1 ? 0.16 : 0;
      const face = this.P.box(1.0, 0.24, 0.06, 'floorWood');
      face.position.set(0, 0.18 + i * 0.27, 0.26 + open);
      const pull = this.P.box(0.26, 0.05, 0.05, this.P.colorMat(0x6b5a34));
      pull.position.set(0, 0.18 + i * 0.27, 0.31 + open);
      g.add(face, pull);
      if (open) { // the drawer's spilled contents hang over the lip
        const cloth = this.P.box(0.5, 0.06, 0.18, this.P.colorMat(0x8a8878));
        cloth.position.set(-0.1, 0.24 + i * 0.27, 0.34);
        g.add(cloth);
      }
    }
    const top = this.P.box(1.2, 0.05, 0.56, 'floorWood');
    top.position.y = 0.9;
    g.add(top);
    return { group: g, collide: [0.58, 0.46, 0.28] };
  }

  /** Double wardrobe. Deep, dark and standing open — good cover, bad news. */
  wardrobe() {
    const g = new THREE.Group();
    const body = this.P.box(1.2, 2.1, 0.62, 'wallWood');
    body.position.y = 1.05;
    const cavity = this.P.box(1.06, 1.9, 0.06, this.P.colorMat(0x14120f));
    cavity.position.set(0, 1.05, 0.3);
    g.add(body, cavity);
    const leaf = this.P.box(0.58, 1.9, 0.05, 'doorWood');
    leaf.position.set(-0.55, 1.05, 0.52);
    leaf.rotation.y = 0.9;
    const shut = this.P.box(0.58, 1.9, 0.05, 'doorWood');
    shut.position.set(0.3, 1.05, 0.32);
    g.add(leaf, shut);
    const rail = this.P.box(1.0, 0.04, 0.04, this.P.colorMat(0x8a8070));
    rail.position.set(0, 1.85, 0.16);
    g.add(rail);
    for (const [ox, c] of [[-0.28, 0x4a4038], [-0.1, 0x5c5240], [0.08, 0x3e4a52]]) {
      const coat = this.P.box(0.14, 1.0, 0.14, this.P.colorMat(c));
      coat.position.set(ox, 1.3, 0.16);
      g.add(coat);
    }
    return { group: g, collide: [0.6, 1.05, 0.32] };
  }

  nightstand() {
    const g = new THREE.Group();
    const body = this.P.box(0.48, 0.55, 0.42, 'wallWood');
    body.position.y = 0.28;
    const drawer = this.P.box(0.42, 0.16, 0.05, 'floorWood');
    drawer.position.set(0, 0.36, 0.22);
    g.add(body, drawer);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.26, 6), this.P.colorMat(0x4a4238));
    lamp.position.y = 0.68;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 0.18, 8), this.P.colorMat(0xb8ab8c));
    shade.position.y = 0.88;
    g.add(lamp, shade);
    return { group: g, collide: [0.25, 0.3, 0.22] };
  }

  /** CRT television on a stand. The tube is dead. Mostly. */
  crtTv() {
    const g = new THREE.Group();
    const stand = this.P.box(1.0, 0.55, 0.5, 'wallWood');
    stand.position.y = 0.28;
    g.add(stand);
    const shelf = this.P.box(0.9, 0.05, 0.44, 'floorWood');
    shelf.position.y = 0.3;
    const box = this.P.box(0.72, 0.62, 0.62, this.P.colorMat(0x3a3630));
    box.position.y = 0.87;
    g.add(shelf, box);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.44), this.P.mat('tvStatic'));
    screen.position.set(0, 0.9, 0.315);
    g.add(screen);
    const bezel = this.P.box(0.14, 0.6, 0.02, this.P.colorMat(0x2a2724));
    bezel.position.set(0.3, 0.87, 0.315);
    g.add(bezel);
    for (const oy of [0.78, 0.94]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6), this.P.colorMat(0x1e1c1a));
      knob.rotation.x = Math.PI / 2;
      knob.position.set(0.3, oy, 0.33);
      g.add(knob);
    }
    const aerial = this.P.box(0.02, 0.5, 0.02, this.P.colorMat(0x8a8a86));
    aerial.position.set(-0.2, 1.42, 0);
    aerial.rotation.z = 0.5;
    g.add(aerial);
    return { group: g, collide: [0.5, 0.45, 0.3] };
  }

  /** Floor rug. No collider — it is a decal with a nap. */
  rug(w = 2.0, d = 1.4, tex = 'carpetRed') {
    const g = new THREE.Group();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.P.mat(tex));
    q.rotation.x = -Math.PI / 2;
    q.position.y = 0.012;
    q.renderOrder = 2;
    g.add(q);
    return { group: g, collide: null };
  }

  /** Kitchen run: base units, worktop, sink, tap and wall cabinets over. */
  kitchenRun(len = 2.4) {
    const g = new THREE.Group();
    const base = this.P.box(len, 0.86, 0.6, 'wallWood');
    base.position.y = 0.43;
    const top = this.P.box(len + 0.06, 0.07, 0.66, 'floorTile');
    top.position.y = 0.9;
    g.add(base, top);
    for (let i = 0; i * 0.6 < len - 0.3; i++) {  // door fronts
      const door = this.P.box(0.5, 0.7, 0.04, 'doorWood');
      door.position.set(-len / 2 + 0.35 + i * 0.6, 0.44, 0.31);
      g.add(door);
    }
    const bowl = this.P.box(0.5, 0.04, 0.4, this.P.colorMat(0x8f9a9c));
    bowl.position.set(len / 2 - 0.45, 0.9, 0);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.24, 5), this.P.colorMat(0x9aa2a4));
    tap.position.set(len / 2 - 0.45, 1.05, -0.2);
    g.add(bowl, tap);
    const upper = this.P.box(len - 0.4, 0.62, 0.34, 'wallWood');
    upper.position.set(0, 1.75, -0.1);
    g.add(upper);
    const splash = this.P.box(len, 0.7, 0.03, 'wallTileWhite');
    splash.position.set(0, 1.28, -0.28);
    g.add(splash);
    return { group: g, collide: [len / 2, 0.48, 0.32] };
  }

  /** Bathroom fittings, grouped: the whole room in one placement. */
  bathroom() {
    const g = new THREE.Group();
    const tub = this.P.box(1.6, 0.55, 0.75, this.P.colorMat(0xc4c8c4));
    tub.position.set(0, 0.28, 0);
    const inner = this.P.box(1.4, 0.1, 0.58, this.P.colorMat(0x8e9490));
    inner.position.set(0, 0.5, 0);
    g.add(tub, inner);
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.42, 8), this.P.colorMat(0xcfd2cd));
    pan.position.set(1.15, 0.21, 0.1);
    const cistern = this.P.box(0.44, 0.36, 0.18, this.P.colorMat(0xcfd2cd));
    cistern.position.set(1.15, 0.6, -0.12);
    g.add(pan, cistern);
    const basin = this.P.box(0.5, 0.14, 0.4, this.P.colorMat(0xcfd2cd));
    basin.position.set(-1.2, 0.82, 0);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.75, 6), this.P.colorMat(0xcfd2cd));
    ped.position.set(-1.2, 0.38, 0);
    const mirror = this.P.box(0.44, 0.5, 0.03, this.P.colorMat(0x39424a));
    mirror.position.set(-1.2, 1.5, -0.18);
    g.add(basin, ped, mirror);
    return { group: g, collide: [1.4, 0.4, 0.4] };
  }

  /** Framed picture hung on a wall (place against a wall, no collider). */
  picture(w = 0.6, h = 0.45) {
    const g = new THREE.Group();
    const frame = this.P.box(w, h, 0.04, 'wallWood');
    const art = this.P.box(w - 0.1, h - 0.1, 0.02, this.P.colorMat(0x5a6a72));
    art.position.z = 0.02;
    frame.position.y = 1.7; art.position.y = 1.7;
    g.add(frame, art);
    return { group: g, collide: null };
  }

  /* ---------------- commercial fittings ---------------- */

  /** Shop counter with a till on it. */
  registerCounter(len = 2.2) {
    const c = this.counter(len);
    const till = this.P.box(0.42, 0.3, 0.36, this.P.colorMat(0x4a4e52));
    till.position.set(len / 2 - 0.5, 1.2, 0);
    const drawer = this.P.box(0.4, 0.1, 0.3, this.P.colorMat(0x2c3034));
    drawer.position.set(len / 2 - 0.5, 1.08, 0.24); // rung open and emptied
    const keys = this.P.box(0.3, 0.02, 0.18, this.P.colorMat(0xc8c2b0));
    keys.position.set(len / 2 - 0.5, 1.36, 0.06);
    c.group.add(till, drawer, keys);
    return c;
  }

  /** Free-standing clothing rail, garments still on it. */
  clothesRack(len = 1.8) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.65, 6), this.P.mat('metalRust'));
      post.position.set(s * (len / 2 - 0.05), 0.82, 0);
      const foot = this.P.box(0.08, 0.05, 0.6, 'metalRust');
      foot.position.set(s * (len / 2 - 0.05), 0.03, 0);
      g.add(post, foot);
    }
    const rail = this.P.box(len, 0.04, 0.04, 'metalRust');
    rail.position.y = 1.62;
    g.add(rail);
    const cols = [0x4a4038, 0x39465e, 0x5c5240, 0x6b3a32, 0x3e4a52];
    for (let i = 0; i * 0.16 < len - 0.3; i++) {
      const garment = this.P.box(0.13, 0.85 + (i % 3) * 0.1, 0.3, this.P.colorMat(cols[i % cols.length]));
      garment.position.set(-len / 2 + 0.2 + i * 0.16, 1.1, 0);
      g.add(garment);
    }
    return { group: g, collide: [len / 2, 0.85, 0.2] };
  }

  /** Headless shop mannequin on a stand. */
  mannequin() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.05, 8), this.P.colorMat(0x3a3a3c));
    base.position.y = 0.03;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), this.P.colorMat(0x8a8a8c));
    pole.position.y = 0.4;
    const torso = this.P.box(0.34, 0.66, 0.2, this.P.colorMat(0xbdb6a8));
    torso.position.y = 1.1;
    const hips = this.P.box(0.3, 0.16, 0.2, this.P.colorMat(0xbdb6a8));
    hips.position.y = 0.76;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 6), this.P.colorMat(0xbdb6a8));
    neck.position.y = 1.48;
    g.add(base, pole, torso, hips, neck);
    return { group: g, collide: [0.22, 0.8, 0.16] };
  }

  /** Lit vending machine. There is no power in this town.
   *  The tube behind the glass strikes, holds, and drops out again — the way a
   *  fluorescent does when it is on its last few hundred hours. */
  vending() {
    const g = new THREE.Group();
    const body = this.P.box(0.9, 1.9, 0.7, this.P.colorMat(0x8a2a24));
    body.position.y = 0.95;
    g.add(body);
    const lit = this._mat('vendingTube', () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x2a3a30 });
      this.w._animateMat(mat, 'tube', { r: 0.42, g: 0.86, b: 0.62, hi: 0.44, lo: 0.11, duty: 0.86, rate: 0.9 });
      return mat;
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 1.3), lit);
    glass.position.set(-0.05, 1.15, 0.36);
    g.add(glass);
    const strip = this.P.box(0.66, 0.04, 0.03, lit);   // the tube itself, over the rack
    strip.position.set(-0.05, 1.78, 0.35);
    g.add(strip);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if ((r * 4 + c) % 3 === 0) continue; // half of it sold out
        const can = this.P.box(0.11, 0.16, 0.02, this.P.colorMat([0xc8b040, 0x3a6ea8, 0xa83a3a, 0x40a06a][(r + c) % 4]));
        can.position.set(-0.29 + c * 0.16, 0.66 + r * 0.32, 0.37);
        g.add(can);
      }
    }
    const tray = this.P.box(0.5, 0.16, 0.06, this.P.colorMat(0x1c1e20));
    tray.position.set(-0.05, 0.34, 0.36);
    g.add(tray);
    return { group: g, collide: [0.46, 0.95, 0.36] };
  }

  waterCooler() {
    const g = new THREE.Group();
    const body = this.P.box(0.36, 0.95, 0.36, this.P.colorMat(0xd0d4d2));
    body.position.y = 0.48;
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.45, 8), this.P.colorMat(0x9ac0cc));
    bottle.position.y = 1.2;
    const cup = this.P.box(0.1, 0.16, 0.1, this.P.colorMat(0xc8c2b0));
    cup.position.set(0.22, 0.7, 0.1);
    g.add(body, bottle, cup);
    return { group: g, collide: [0.2, 0.5, 0.2] };
  }

  /** Four-drawer steel filing cabinet, top drawer standing open. */
  fileCabinet() {
    const g = new THREE.Group();
    const body = this.P.box(0.5, 1.35, 0.62, 'wallMetal');
    body.position.y = 0.68;
    g.add(body);
    for (let i = 0; i < 4; i++) {
      const open = i === 3 ? 0.24 : 0;
      const face = this.P.box(0.46, 0.3, 0.04, 'doorMetal');
      face.position.set(0, 0.2 + i * 0.32, 0.31 + open);
      const pull = this.P.box(0.16, 0.03, 0.03, this.P.colorMat(0x8a8e90));
      pull.position.set(0, 0.2 + i * 0.32, 0.34 + open);
      g.add(face, pull);
    }
    return { group: g, collide: [0.26, 0.68, 0.32] };
  }

  /* ---------------- specialist shop fittings ---------------- */

  /** Bank of coin-op washing machines. */
  washerBank(n = 3) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const body = this.P.box(0.68, 0.95, 0.68, this.P.colorMat(0xc2c6c4));
      body.position.set(i * 0.72, 0.48, 0);
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), this.P.colorMat(0x22282c));
      door.position.set(i * 0.72, 0.52, 0.35);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 5, 12), this.P.colorMat(0x8a8e90));
      ring.position.set(i * 0.72, 0.52, 0.35);
      const panel = this.P.box(0.6, 0.14, 0.03, this.P.colorMat(0x3a4046));
      panel.position.set(i * 0.72, 0.86, 0.35);
      g.add(body, door, ring, panel);
    }
    const len = (n - 1) * 0.72 + 0.68;
    return { group: g, collide: [len / 2, 0.5, 0.35] };
  }

  /** Record browsing bin, sleeves standing on edge. */
  recordBin(len = 1.6) {
    const g = new THREE.Group();
    const body = this.P.box(len, 0.85, 0.62, 'wallWood');
    body.position.y = 0.43;
    g.add(body);
    const well = this.P.box(len - 0.14, 0.06, 0.5, this.P.colorMat(0x2c2620));
    well.position.y = 0.86;
    g.add(well);
    const cols = [0x2c3a4a, 0x6b3a32, 0x3a5240, 0xa08a44, 0x4a3a52];
    for (let i = 0; i * 0.045 < len - 0.3; i++) {
      const sleeve = this.P.box(0.035, 0.34, 0.34, this.P.colorMat(cols[i % cols.length]));
      sleeve.position.set(-len / 2 + 0.14 + i * 0.045, 1.0, 0);
      sleeve.rotation.x = 0.14;
      g.add(sleeve);
    }
    return { group: g, collide: [len / 2, 0.45, 0.32] };
  }

  /** Barber chair: pedestal, seat, back, headrest. */
  barberChair() {
    const g = new THREE.Group();
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.1, 10), this.P.colorMat(0x3a3e42));
    foot.position.y = 0.05;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.42, 8), this.P.colorMat(0x8a8e90));
    column.position.y = 0.3;
    const seat = this.P.box(0.56, 0.16, 0.54, this.P.colorMat(0x3c2b26));
    seat.position.y = 0.6;
    const back = this.P.box(0.56, 0.7, 0.14, this.P.colorMat(0x3c2b26));
    back.position.set(0, 1.0, -0.24);
    const head = this.P.box(0.26, 0.16, 0.1, this.P.colorMat(0x3c2b26));
    head.position.set(0, 1.42, -0.22);
    g.add(foot, column, seat, back, head);
    for (const s of [-1, 1]) {
      const arm = this.P.box(0.08, 0.08, 0.5, this.P.colorMat(0x8a8e90));
      arm.position.set(s * 0.3, 0.8, 0);
      g.add(arm);
    }
    return { group: g, collide: [0.34, 0.5, 0.34] };
  }

  /** Wall mirror over a shelf — the barbershop's back wall. */
  mirrorRun(len = 2.4) {
    const g = new THREE.Group();
    const glass = this.P.box(len, 1.1, 0.04, this.P.colorMat(0x4a545c));
    glass.position.set(0, 1.45, 0);
    const frame = this.P.box(len + 0.1, 1.2, 0.02, 'wallWood');
    frame.position.set(0, 1.45, -0.03);
    const shelf = this.P.box(len, 0.06, 0.22, 'floorWood');
    shelf.position.set(0, 0.85, 0.09);
    g.add(frame, glass, shelf);
    for (let i = 0; i * 0.3 < len - 0.3; i++) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 6),
        this.P.colorMat([0x4a6a52, 0x6a4a52, 0x52604a][i % 3]));
      bottle.position.set(-len / 2 + 0.2 + i * 0.3, 0.97, 0.09);
      g.add(bottle);
    }
    return { group: g, collide: [len / 2, 0.4, 0.12] };
  }

  /** Pharmacy dispensing shelving: small stock boxes in tight ranks. */
  stockShelf(len = 2.0) {
    const g = new THREE.Group();
    const body = this.P.box(len, 2.3, 0.4, 'wallMetal');
    body.position.y = 1.15;
    g.add(body);
    const cols = [0xc8c2b0, 0xb0c2c8, 0xc8b0b8, 0xbcc8b0];
    for (let r = 0; r < 4; r++) {
      const shelf = this.P.box(len - 0.08, 0.05, 0.36, 'wallMetal');
      shelf.position.set(0, 0.42 + r * 0.56, 0.02);
      g.add(shelf);
      for (let i = 0; i * 0.22 < len - 0.3; i++) {
        if ((r * 7 + i * 3) % 5 === 0) continue; // gaps where it was cleared out
        const carton = this.P.box(0.17, 0.24, 0.24, this.P.colorMat(cols[(r + i) % 4]));
        carton.position.set(-len / 2 + 0.18 + i * 0.22, 0.57 + r * 0.56, 0.04);
        g.add(carton);
      }
    }
    return { group: g, collide: [len / 2, 1.15, 0.22] };
  }

  /** Hardware-store aisle: deep shelving with paint tins and boxed stock. */
  hardwareAisle(len = 3.0) {
    const g = new THREE.Group();
    for (const s of [-len / 2 + 0.1, len / 2 - 0.1]) {
      const up = this.P.box(0.1, 2.4, 0.85, 'metalRust');
      up.position.set(s, 1.2, 0);
      g.add(up);
    }
    for (const yy of [0.45, 1.1, 1.75]) {
      const slab = this.P.box(len, 0.07, 0.9, 'wallMetal');
      slab.position.y = yy;
      g.add(slab);
    }
    const tins = [0x8a3a30, 0x3a5a8a, 0x4a7a4a, 0xb0a040];
    for (let i = 0; i * 0.3 < len - 0.4; i++) {
      const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 8), this.P.colorMat(tins[i % 4]));
      tin.position.set(-len / 2 + 0.3 + i * 0.3, 0.6, -0.18);
      g.add(tin);
      if (i % 2 === 0) {
        const boxed = this.P.box(0.26, 0.26, 0.3, 'crate');
        boxed.position.set(-len / 2 + 0.3 + i * 0.3, 1.28, 0.12);
        g.add(boxed);
      }
    }
    const timber = this.P.box(len - 0.3, 0.16, 0.5, 'wallWood');
    timber.position.set(0, 1.9, 0);
    g.add(timber);
    return { group: g, collide: [len / 2, 1.2, 0.48] };
  }

  /** Pegboard of hand tools over a bench. */
  toolBoard(len = 1.8) {
    const g = new THREE.Group();
    const board = this.P.box(len, 1.1, 0.05, 'wallWood');
    board.position.y = 1.6;
    g.add(board);
    for (let i = 0; i * 0.3 < len - 0.2; i++) {
      const tool = this.P.box(0.06, 0.36 + (i % 3) * 0.1, 0.05, this.P.colorMat([0x8a2a22, 0x39465e, 0x6b7280, 0x8a6a2e][i % 4]));
      tool.position.set(-len / 2 + 0.2 + i * 0.3, 1.5 + (i % 2) * 0.2, 0.05);
      g.add(tool);
    }
    return { group: g, collide: null };
  }

  /* ---------------- industrial fittings ---------------- */

  /** Stack of pallets — waist-high cover that reads instantly as a warehouse. */
  palletStack(n = 3) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const p = this.P.box(1.2, 0.16, 1.0, 'pallet');
      p.position.set((i % 2) * 0.06 - 0.03, 0.08 + i * 0.17, 0);
      p.rotation.y = (i % 2) * 0.06;
      g.add(p);
    }
    return { group: g, collide: [0.62, n * 0.09, 0.52] };
  }

  /** Loaded pallet: goods shrink-wrapped on a deck. Chest-high hard cover. */
  loadedPallet() {
    const g = new THREE.Group();
    const deck = this.P.box(1.2, 0.16, 1.0, 'pallet');
    deck.position.y = 0.08;
    const load = this.P.box(1.08, 0.95, 0.9, 'crate');
    load.position.y = 0.64;
    const wrap = this.P.box(1.12, 0.5, 0.94, this.P.colorMat(0x9aa4a0));
    wrap.position.y = 0.5;
    g.add(deck, load, wrap);
    return { group: g, collide: [0.62, 0.58, 0.52] };
  }

  /** Yellow hazardous-material drum. */
  hazardDrum() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.0, 10), this.P.mat('barrelHazard'));
    b.position.y = 0.5;
    g.add(b);
    return { group: g, collide: [0.4, 0.6, 0.4] };
  }

  /** Chain-link partition panel: see-through cover, real collision. */
  chainPanel(len = 3.0, h = 2.4) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, h),
      this._mat('chainlink', () => new THREE.MeshLambertMaterial({
        map: this.w.texLib.tiled('chainlink', Math.max(1, Math.round(len / 1.5)), Math.max(1, Math.round(h / 1.5))),
        alphaTest: 0.4, side: THREE.DoubleSide,
      })));
    mesh.position.y = h / 2;
    g.add(mesh);
    for (const s of [-len / 2, 0, len / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 6), this.P.mat('metalRust'));
      post.position.set(s, h / 2, 0);
      g.add(post);
    }
    const rail = this.P.box(len, 0.06, 0.06, 'metalRust');
    rail.position.y = h - 0.05;
    g.add(rail);
    return { group: g, collide: [len / 2, h / 2, 0.12] };
  }

  /** Fire engine, parked in its bay. Blunt, red and unmistakable. */
  fireEngine() {
    const g = new THREE.Group();
    const red = this.P.colorMat(0x8f2420);
    const chassis = this.P.box(6.4, 1.0, 2.3, red);
    chassis.position.y = 1.15;
    const cab = this.P.box(2.0, 1.2, 2.25, red);
    cab.position.set(2.1, 2.2, 0);
    const glass = this.P.box(0.1, 0.7, 2.0, 'window');
    glass.position.set(3.06, 2.4, 0);
    const body = this.P.box(4.0, 1.1, 2.25, red);
    body.position.set(-1.1, 2.15, 0);
    g.add(chassis, cab, glass, body);
    for (const s of [-1, 1]) { // locker shutters down each flank
      for (const ox of [-2.4, -1.1, 0.2]) {
        const shutter = this.P.box(1.1, 0.85, 0.06, this.P.colorMat(0x9aa0a2));
        shutter.position.set(ox, 2.1, s * 1.15);
        g.add(shutter);
      }
    }
    const ladder = this.P.box(5.2, 0.12, 0.5, this.P.colorMat(0xb4b8ba));
    ladder.position.set(-0.8, 2.78, 0.55);
    const light = this.P.box(1.0, 0.16, 0.3, new THREE.MeshBasicMaterial({ color: 0xd8302a }));
    light.position.set(2.1, 2.88, 0);
    g.add(ladder, light);
    for (const [wx, wz] of [[-2.2, 1], [2.0, 1], [-2.2, -1], [2.0, -1]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.36, 10), this.P.colorMat(0x14161a));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.62, wz * 1.05);
      g.add(wheel);
    }
    return { group: g, collide: [3.2, 1.5, 1.2] };
  }

  /* ---------------- residential outbuildings ---------------- */

  /** Chairs stacked six high against a hall wall, as they were left. */
  chairStack(n = 6) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const seat = this.P.box(0.44, 0.05, 0.44, this.P.colorMat(0x6b5334));
      seat.position.set((i % 2) * 0.03, 0.36 + i * 0.11, (i % 3) * 0.02);
      const back = this.P.box(0.44, 0.42, 0.05, this.P.colorMat(0x6b5334));
      back.position.set((i % 2) * 0.03, 0.58 + i * 0.11, -0.2 + (i % 3) * 0.02);
      g.add(seat, back);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = this.P.box(0.04, 0.36, 0.04, this.P.colorMat(0x4a4038));
      leg.position.set(sx * 0.18, 0.18, sz * 0.18);
      g.add(leg);
    }
    return { group: g, collide: [0.28, 0.55, 0.28] };
  }

  /** Folding trestle table, one leaf still up. */
  trestle(len = 2.4) {
    const g = new THREE.Group();
    const top = this.P.box(len, 0.05, 0.7, this.P.colorMat(0xb6a887));
    top.position.y = 0.74;
    g.add(top);
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        const leg = this.P.box(0.05, 0.74, 0.05, 'metalRust');
        leg.position.set(s * (len / 2 - 0.25), 0.37, t * 0.28);
        leg.rotation.z = -s * t * 0.06;
        g.add(leg);
      }
    }
    return { group: g, collide: [len / 2, 0.42, 0.36] };
  }

  /**
   * Upright piano — case, music desk, candle sconces, pedal lyre, castors, and
   * a keyboard that is a real bank of keys rather than a painted stripe.
   *
   * The key bank is returned as its own pivot hinged at the BACK of the keys,
   * so dipping it a couple of degrees reads as somebody putting their hands
   * down on it. That is what makes the thing worth walking over to: it is the
   * one instrument in the district you can actually sound, and it is loud.
   */
  piano() {
    const g = new THREE.Group();
    const case_ = this.P.colorMat(0x2e2119);
    const dark = this.P.colorMat(0x241a13);
    const body = this.P.box(1.5, 1.15, 0.6, case_);
    body.position.set(0, 0.6, -0.06);
    const lid = this.P.box(1.56, 0.06, 0.7, dark);
    lid.position.set(0, 1.2, -0.02);
    const front = this.P.box(1.34, 0.5, 0.04, this.P.colorMat(0x372a1e));  // upper panel
    front.position.set(0, 0.92, 0.25);
    const desk = this.P.box(1.2, 0.34, 0.03, dark);                        // music desk
    desk.position.set(0, 0.99, 0.29);
    desk.rotation.x = -0.22;
    const sheet = this.P.box(0.46, 0.3, 0.01, this.P.colorMat(0xcfc9b4));  // the music, still open
    sheet.position.set(-0.1, 1.0, 0.32);
    sheet.rotation.x = -0.22;
    const fall = this.P.box(1.4, 0.13, 0.06, this.P.colorMat(0x120d09));   // fallboard
    fall.position.set(0, 0.85, 0.32);
    g.add(body, lid, front, desk, sheet, fall);
    /* Candle sconces, with wicks that catch while it is being played. Nobody
     * lights them. That is the point of them.
     *
     * They stand ON the lid. They used to be hung off the front panel at
     * y = 1.16, which is INSIDE the lid (1.17–1.23) — so the wax ran through
     * the piano's own top and all you could see was two flames floating over
     * a closed instrument. A sconce belongs on the lid of an upright anyway:
     * a brass dish sat on the timber, a candle standing in it, a dark wick,
     * and the flame above that. Every part below is measured off LID_TOP, so
     * the whole set moves with the lid if the case is ever reproportioned.
     */
    const LID_TOP = 1.23;                 // lid: 0.06 thick, centred at 1.20
    const flames = [];
    for (const sx of [-0.52, 0.52]) {
      const dish = this.P.box(0.13, 0.014, 0.11, this.P.colorMat(0x8a7433));
      dish.position.set(sx, LID_TOP + 0.007, 0.16);
      const collar = this.P.box(0.05, 0.03, 0.05, this.P.colorMat(0xa08a3e));
      collar.position.set(sx, LID_TOP + 0.028, 0.16);
      const candle = this.P.box(0.032, 0.15, 0.032, this.P.colorMat(0xd6cdb2));
      candle.position.set(sx, LID_TOP + 0.118, 0.16);
      const wick = this.P.box(0.006, 0.022, 0.006, this.P.colorMat(0x2a241c));
      wick.position.set(sx, LID_TOP + 0.203, 0.16);
      g.add(dish, collar, candle, wick);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.085, 5, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffd070, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
      // seated on the wick, so it grows out of the candle rather than hovering
      flame.position.set(sx, LID_TOP + 0.256, 0.16);
      flame.renderOrder = 3;
      g.add(flame);
      flames.push(flame);
    }
    // the keyboard: a hinged bank so it can be played
    const keys = new THREE.Group();
    keys.position.set(0, 0.78, 0.18);       // hinge line, at the back of the keys
    const whites = this.P.box(1.32, 0.035, 0.26, this.P.colorMat(0xd8d2c0));
    whites.position.set(0, 0, 0.15);
    keys.add(whites);
    for (let i = 0; i < 15; i++) {          // key gaps
      const gap = this.P.box(0.012, 0.038, 0.24, this.P.colorMat(0x9a9482));
      gap.position.set(-0.62 + i * 0.088, 0.001, 0.16);
      keys.add(gap);
    }
    for (let i = 0; i < 10; i++) {          // sharps, in their real 2–3 grouping
      const n = i % 5;
      if (n === 2) continue;
      const black = this.P.box(0.042, 0.03, 0.16, this.P.colorMat(0x14110e));
      black.position.set(-0.58 + i * 0.125, 0.03, 0.09);
      keys.add(black);
    }
    const cheekL = this.P.box(0.08, 0.1, 0.3, dark);
    cheekL.position.set(-0.7, 0.79, 0.33);
    const cheekR = cheekL.clone();
    cheekR.position.x = 0.7;
    g.add(keys, cheekL, cheekR);
    // pedal lyre and castors
    const lyre = this.P.box(0.26, 0.3, 0.05, dark);
    lyre.position.set(0, 0.16, 0.16);
    g.add(lyre);
    for (const px of [-0.06, 0.06]) {
      const pedal = this.P.box(0.05, 0.02, 0.14, this.P.colorMat(0xa8913f));
      pedal.position.set(px, 0.1, 0.22);
      g.add(pedal);
    }
    for (const sx of [-1, 1]) {
      const leg = this.P.box(0.13, 0.3, 0.58, dark);
      leg.position.set(sx * 0.62, 0.15, -0.06);
      g.add(leg);
      const castor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6),
        this.P.colorMat(0x4a4038));
      castor.rotation.z = Math.PI / 2;
      castor.position.set(sx * 0.62, 0.045, 0.16);
      g.add(castor);
    }
    // `live`: the hinged key bank and the flames must survive the interior
    // merge (see _put)
    return { group: g, collide: [0.78, 0.6, 0.36], keys, flames, live: true };
  }

  /** Potting bench with seed trays — the working surface of a glasshouse. */
  pottingBench(len = 2.2) {
    const g = new THREE.Group();
    const top = this.P.box(len, 0.07, 0.62, 'wallWood');
    top.position.y = 0.88;
    const shelf = this.P.box(len, 0.05, 0.5, 'wallWood');
    shelf.position.y = 0.3;
    g.add(top, shelf);
    for (const s of [-1, 1]) {
      const leg = this.P.box(0.09, 0.88, 0.55, 'wallWood');
      leg.position.set(s * (len / 2 - 0.1), 0.44, 0);
      g.add(leg);
    }
    for (let i = 0; i * 0.55 < len - 0.5; i++) {
      const tray = this.P.box(0.44, 0.09, 0.34, this.P.colorMat(0x4a3324));
      tray.position.set(-len / 2 + 0.35 + i * 0.55, 0.96, 0.04);
      const soil = this.P.box(0.4, 0.04, 0.3, 'dirt');
      soil.position.set(-len / 2 + 0.35 + i * 0.55, 1.02, 0.04);
      g.add(tray, soil);
      const shoots = this.w.veg._cross(this.w.veg.bushMat, 0.32, 0.28);
      shoots.position.set(-len / 2 + 0.35 + i * 0.55, 1.04, 0.04);
      g.add(shoots);
    }
    for (let i = 0; i < 5; i++) {   // stacked pots underneath
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.13, 7), this.P.colorMat(0x8a5238));
      pot.position.set(-len / 2 + 0.4 + (i % 3) * 0.4, 0.42 + Math.floor(i / 3) * 0.14, -0.06);
      g.add(pot);
    }
    return { group: g, collide: [len / 2, 0.5, 0.32] };
  }

  /** Grow bed: a timber frame of soil with something still coming up in it. */
  growBed(len = 2.0) {
    const g = new THREE.Group();
    for (const [ox, oz, w, d] of [[0, -0.5, len, 0.1], [0, 0.5, len, 0.1],
      [-len / 2, 0, 0.1, 1.0], [len / 2, 0, 0.1, 1.0]]) {
      const board = this.P.box(w, 0.28, d, 'wallWood');
      board.position.set(ox, 0.14, oz);
      g.add(board);
    }
    const soil = this.P.box(len - 0.1, 0.2, 0.9, 'dirt');
    soil.position.y = 0.14;
    g.add(soil);
    for (let i = 0; i < 5; i++) {
      const plant = this.w.veg._cross(this.w.veg.bushMat, 0.42, 0.5);
      plant.position.set(-len / 2 + 0.4 + i * (len - 0.8) / 4, 0.22, (i % 2) * 0.24 - 0.12);
      g.add(plant);
    }
    return { group: g, collide: [len / 2, 0.2, 0.55] };
  }

  /** Wall of garden tools leaning in a corner: rakes, forks, a spade. */
  toolLean() {
    const g = new THREE.Group();
    const cols = [0x6b5334, 0x4a4038, 0x7a6444];
    for (let i = 0; i < 5; i++) {
      const shaft = this.P.box(0.045, 1.5, 0.045, this.P.colorMat(cols[i % 3]));
      shaft.position.set(-0.22 + i * 0.11, 0.75, 0.06 * (i % 2));
      shaft.rotation.z = 0.1 - i * 0.045;
      const head = this.P.box(0.16, 0.22, 0.05, 'metalRust');
      head.position.set(-0.3 + i * 0.12, 0.09, 0.06 * (i % 2));
      g.add(shaft, head);
    }
    return { group: g, collide: [0.35, 0.7, 0.2] };
  }

  /** A car hulk on axle stands, mid-repair. The garage's one real landmark. */
  strippedCar() {
    const g = new THREE.Group();
    const body = this.P.box(1.7, 0.62, 3.5, this.P.colorMat(0x55504a));
    body.position.y = 0.72;
    const cabin = this.P.box(1.5, 0.5, 1.6, this.P.colorMat(0x4a4640));
    cabin.position.set(0, 1.24, -0.2);
    g.add(body, cabin);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const stand = this.P.box(0.24, 0.4, 0.24, 'metalRust');
      stand.position.set(sx * 0.72, 0.2, sz * 1.3);
      g.add(stand);
    }
    const bonnet = this.P.box(1.6, 0.06, 1.1, this.P.colorMat(0x55504a));
    bonnet.position.set(0, 1.52, 1.35);
    bonnet.rotation.x = -0.45;    // propped open on nothing
    g.add(bonnet);
    return { group: g, collide: [0.9, 0.7, 1.8] };
  }

  /** Turnout gear on a rail: helmets, coats, boots, ready and never used. */
  gearRack(n = 4) {
    const g = new THREE.Group();
    const rail = this.P.box(n * 0.75, 0.08, 0.08, 'metalRust');
    rail.position.y = 2.0;
    g.add(rail);
    for (let i = 0; i < n; i++) {
      const x = -n * 0.375 + 0.375 + i * 0.75;
      const coat = this.P.box(0.5, 1.0, 0.24, this.P.colorMat(0x9a7a2a));
      coat.position.set(x, 1.4, 0);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.P.colorMat(0xb03028));
      helmet.position.set(x, 2.1, 0);
      const boots = this.P.box(0.34, 0.34, 0.4, this.P.colorMat(0x22262a));
      boots.position.set(x, 0.17, 0.06);
      g.add(coat, helmet, boots);
    }
    return { group: g, collide: [n * 0.375, 0.4, 0.2] };
  }

  /* ---------------- room-scale helpers ---------------- */

  /**
   * A suspended ceiling over a commercial interior, with one tile bay left
   * open. Buildings with a drop ceiling get a plenum you can see into and a
   * blind volume overhead — the brief's "drop-ceiling spawn opportunity", and
   * cheap enclosure that stops big interiors reading as roofless boxes.
   */
  _dropCeiling(b, y = 2.95) {
    const s = b.spec;
    if (s.h < y + 0.5) return;
    const c = this._canon(s);
    const inset = 0.34;
    const rect = this._rectWorld(b, -c.cw / 2 + inset, -c.cd / 2 + inset, c.cw / 2 - inset, c.cd / 2 - inset);
    const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ;
    // A downward-facing surface only ever catches the hemisphere light's
    // GROUND colour, which would render the ceiling as a black lid over the
    // room. A little emissive stands in for the light the fittings used to
    // throw, and keeps the interior readable without paying for a real lamp.
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      this._mat('ceil', () => new THREE.MeshLambertMaterial({
        map: this.w.texLib.tiled('ceilingTile', 1, 1), emissive: 0x2a2a26,
      })));
    grid.material.map.repeat.set(Math.max(1, w / 4), Math.max(1, d / 4));
    grid.rotation.x = Math.PI / 2;   // faces down
    grid.position.set((rect.minX + rect.maxX) / 2, s.y + y, (rect.minZ + rect.maxZ) / 2);
    this._bucket.add(grid);
    // two strip fittings, cold and unlit but still catching what light there
    // is — they give the ceiling plane a readable scale
    const lampMat = this._mat('striplight', () => new THREE.MeshBasicMaterial({ color: 0x8e9490 }));
    for (const t of [0.3, 0.7]) {
      const along = w >= d;
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(along ? w * 0.4 : 0.22, along ? 0.22 : d * 0.4), lampMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(
        along ? (rect.minX + rect.maxX) / 2 : rect.minX + w * t,
        s.y + y - 0.03,
        along ? rect.minZ + d * t : (rect.minZ + rect.maxZ) / 2);
      this._bucket.add(lamp);
    }
  }

  /**
   * A walled-off closet in a corner: two stub partitions, a dark interior and
   * an indoor spawn point inside it. You do not see what is in here until it
   * is in the room with you.
   */
  _closet(b, lx, lz, w = 1.5, d = 1.2, opening = 'z') {
    const s = b.spec;
    const H = Math.min(2.5, s.h - 0.3);
    const t = 0.16;
    const wall = (cx, cz, lenX, lenZ) => {
      const g = new THREE.Group();
      const m = this.kit.box(lenX, H, lenZ, s.innerTex || 'wallPlaster');
      m.position.y = H / 2;
      g.add(m);
      this._put(b, { group: g }, cx, cz, { collide: [lenX / 2, H / 2, lenZ / 2] });
    };
    if (opening === 'z') {          // opens toward +z (canonical front)
      wall(lx, lz - d / 2, w, t);
      wall(lx - w / 2, lz, t, d);
      wall(lx + w / 2, lz, t, d);
    } else {                        // opens toward +x
      wall(lx - w / 2, lz, t, d);
      wall(lx, lz - d / 2, w, t);
      wall(lx, lz + d / 2, w, t);
    }
    // the dark inside: an unlit ceiling plate so the cavity reads black
    const cap = this.kit.box(w, 0.12, d, 'wallConcrete');
    const p = this._pt(b, lx, lz);
    cap.position.set(p.x, s.y + H, p.z);
    this._bucket.add(cap);
    this._spawnAt(b, lx, lz);
  }

  /**
   * A mezzanine deck across one end of a hall, reached by a stair ramp up one
   * side, with a railing along the open edge. Returns the deck's world rect
   * and its floor height so a caller can furnish upstairs.
   *
   * Generalised out of warehouse B, which is still its heaviest user: the
   * deck is a real walkable platform (terrain platform + collider), the ramp
   * is a real terrain ramp, and the steps under it are cosmetic.
   */
  _mezzanine(b, { depth = 4.8, height = 3.1, stairSide = 1, stairWidth = 2.2, tex = 'floorWood' } = {}) {
    const s = b.spec;
    const c = this._canon(s);
    const hw = c.cw / 2, hd = c.cd / 2;
    const deckY = s.y + height;

    const deck = this._rectWorld(b, -hw + 0.6, -hd + 0.5, hw - 0.7, -hd + depth + 0.5);
    const slab = this.kit.box(deck.maxX - deck.minX, 0.22, deck.maxZ - deck.minZ, tex);
    slab.position.set((deck.minX + deck.maxX) / 2, deckY, (deck.minZ + deck.maxZ) / 2);
    this._bucket.add(slab);
    this.w.collision.addBox(deck.minX, deckY - 0.11, deck.minZ, deck.maxX, deckY + 0.11, deck.maxZ, 'wall');
    this.w.terrain.addPlatform(deck.minX, deck.maxX, deck.minZ, deck.maxZ, deckY + 0.11);

    // support posts under the open edge
    const frontZ = Math.abs(deck.minZ - s.z) < Math.abs(deck.maxZ - s.z) ? deck.minZ : deck.maxZ;
    const postZ = frontZ + (frontZ === deck.minZ ? 0.25 : -0.25);
    for (const t of [0.15, 0.5, 0.85]) {
      const px = deck.minX + (deck.maxX - deck.minX) * t;
      const post = this.kit.box(0.28, height, 0.28, 'wallWood');
      post.position.set(px, s.y + height / 2, postZ);
      this._bucket.add(post);
      this.w.collision.addBoxCentered(px, s.y + height / 2, postZ, 0.16, height / 2, 0.16, 'furniture');
    }

    // stair ramp arriving at the deck edge
    const sx0 = stairSide > 0 ? hw - 0.8 - stairWidth : -hw + 0.8;
    const sx1 = stairSide > 0 ? hw - 0.8 : -hw + 0.8 + stairWidth;
    const ramp = this._rectWorld(b, Math.min(sx0, sx1), -hd + depth + 0.5, Math.max(sx0, sx1), -hd + depth + 5.5);
    const rcx = (ramp.minX + ramp.maxX) / 2, rcz = (ramp.minZ + ramp.maxZ) / 2;
    const top = this._pt(b, (sx0 + sx1) / 2, -hd + depth + 0.6);
    const alongX = (ramp.maxX - ramp.minX) > (ramp.maxZ - ramp.minZ);
    const rhx = (ramp.maxX - ramp.minX) / 2, rhz = (ramp.maxZ - ramp.minZ) / 2;
    let y0 = s.y, y1 = deckY + 0.11;
    if (alongX ? top.x < rcx : top.z < rcz) [y0, y1] = [y1, y0];
    this.w.terrain.addRamp(rcx, rcz, rhx, rhz, alongX ? 'x' : 'z', y0, y1);
    const halfLen = alongX ? rhx : rhz;
    const dirX = alongX ? Math.sign(top.x - rcx) : 0;
    const dirZ = alongX ? 0 : Math.sign(top.z - rcz);
    for (let i = 0; i < 8; i++) {
      const t = ((i + 0.5) / 8) * 2 - 1;
      const stepLen = (halfLen * 2) / 8 + 0.06;
      const step = this.kit.box(alongX ? stepLen : rhx * 2 - 0.1, 0.14, alongX ? rhz * 2 - 0.1 : stepLen, 'wallWood');
      step.position.set(rcx + dirX * t * (halfLen - stepLen / 2),
        s.y + (deckY + 0.11 - s.y) * ((t * (halfLen - stepLen / 2) / halfLen + 1) / 2) - 0.06,
        rcz + dirZ * t * (halfLen - stepLen / 2));
      this._bucket.add(step);
    }

    // railing along the open edge, leaving the stair bay clear
    const railA = stairSide > 0 ? -hw + 0.7 : Math.max(sx0, sx1) + 0.2;
    const railB = stairSide > 0 ? Math.min(sx0, sx1) - 0.2 : hw - 0.7;
    const railRect = this._rectWorld(b, railA, -hd + depth + 0.4, railB, -hd + depth + 0.6);
    const rail = this.kit.box(Math.max(railRect.maxX - railRect.minX, 0.08), 0.12,
      Math.max(railRect.maxZ - railRect.minZ, 0.08), 'metalRust');
    rail.position.set((railRect.minX + railRect.maxX) / 2, deckY + 1.0, (railRect.minZ + railRect.maxZ) / 2);
    this._bucket.add(rail);
    this.w.collision.addBox(railRect.minX - 0.05, deckY + 0.1, railRect.minZ - 0.05,
      railRect.maxX + 0.05, deckY + 1.1, railRect.maxZ + 0.05, 'wall');
    return { deck, deckY, lift: height + 0.11 };
  }

  /* ---------------- building layouts (canonical: door at +Z) ---------- */

  /**
   * A lived-in house.
   *
   * The layout follows the daily round of the people who left it: you sleep
   * behind the partition, you cook against one wall, you eat in the middle of
   * the room, and you sit in front of the television facing away from the
   * door. Every one of those things is still here.
   *
   * Three plans, not one. A street where every front door opens onto the same
   * furniture in the same places is the fastest way to make a neighbourhood
   * read as generated, and the variant is picked from the spec so it is stable
   * across a reload — and so three particular houses in Eastgate can be given
   * the SAME one on purpose. Look at them.
   */
  _house(b) {
    const s = b.spec;
    const c = this._canon(s);
    const hw = c.cw / 2, hd = c.cd / 2;
    const v = s.variant ?? (Math.abs(Math.round(s.x * 3 + s.z * 7)) % 3);
    const m = v === 1 ? -1 : 1;          // variant 1 is the mirrored plan
    // --- bedroom, behind the partition at the far end
    this._put(b, this.bed(), m * (-hw + 0.75), -hd + 1.3);
    this._put(b, this.nightstand(), m * (-hw + 0.75), -hd + 2.6);
    this._put(b, this.dresser(), m * 0.4, -hd + 0.6, { yaw: Math.PI, loot: [0, 0.9] });
    this._put(b, this.wardrobe(), m * (hw - 0.9), -hd + 0.55, { yaw: Math.PI, loot: [0, 1.0] });
    this._put(b, this.picture(0.5, 0.4), m * (-hw + 0.35), -hd + 1.9,
      { yaw: m * Math.PI / 2, collide: null });
    if (v === 2) {   // the family plan: somebody small slept in here too
      this._put(b, this.cot(), m * (hw - 0.9), -hd + 2.0, { yaw: Math.PI });
      this._decalAt(b, 'chalkHopscotch', m * (hw - 1.6), -hd + 1.6, 1.1, null);
    }
    // --- kitchen along the side wall of the main room.
    // Laid out END TO END from one running mark rather than from three fixed
    // anchors: the anchors were spaced for one particular room depth, so in
    // any other the counter ran through the cooker. Real units butt up to each
    // other, and this way they do that at every size.
    const kx = m * (hw - 0.6), kyaw = -m * Math.PI / 2;
    const kStart = -hd + 3.9, kEnd = hd - 0.9;   // between the bedroom wall and the front
    let kz = kStart + 0.4;
    this._put(b, this.stove(), kx, kz, { yaw: kyaw });
    const runLen = Math.min(2.4, kEnd - kStart - 1.9);
    if (runLen >= 1.0) {                          // a small cottage gets no worktop
      kz += 0.55 + runLen / 2;
      this._put(b, this.kitchenRun(runLen), kx, kz, { yaw: kyaw });
      kz += runLen / 2;
    }
    kz += 0.55;
    this._put(b, this.fridge(), kx, kz, { yaw: kyaw, loot: [-m * 0.9, 0] });
    // --- dining set, off the partition-gap corridor
    const tx = m * -hw * 0.25, tz = hd * 0.28;
    if (this._put(b, this.table(1.5, 0.95), tx, tz)) {
      // Pulled out at the END of the table, not the side: the side chair stood
      // in the same half-metre as the television.
      this._put(b, this.chair(), tx, tz - 0.95, { yaw: 0 });
      this._put(b, this.tippedChair(), tx + m * 1.15, tz + 0.3);
      this._meal(b, tx - 0.3, tz);
      if (v !== 2) this._meal(b, tx + 0.35, tz - 0.15);
    }
    // --- living end: sofa, rug and a television nobody turned off
    this._put(b, this.rug(2.0, 1.4), m * (-hw + 1.5), hd - 2.0, { collide: null });
    this._put(b, this.sofa(), m * (-hw + 1.2), hd - 1.1, { yaw: Math.PI });
    this._put(b, this.crtTv(), m * (-hw + 1.4), hd - 3.4, { yaw: 0 });
    // Against the BEDROOM WALL facing the room, not against the side wall: the
    // side wall is the television's, and a writing desk half a metre from a
    // television set is a writing desk growing out of a television set.
    //
    // Which END of that wall, though, is not the plan's to choose. The gap
    // through to the bedroom is always in the +x quarter of the canonical
    // frame while this plan mirrors, so the mirrored variant put this piece
    // squarely in the bedroom doorway. Offer the mirrored end first and the
    // other end second: _put refuses a placement that would stand in a
    // doorway, so it lands on whichever end of the wall is actually free.
    const bz = -hd + 3.5;
    const backPiece = v === 1 ? this.desk() : this.shelf(v === 0 ? 1.5 : 1.3, v === 0);
    for (const bx of [m * (-hw + 1.6), -m * (-hw + 1.6)]) {
      if (this._put(b, backPiece, bx, bz, v === 1 ? { loot: [0, 0.9] } : {})) break;
    }
    this._papers(b, tx + 0.8, tz + 1.0, 3);
    if ((s.derelict ?? 0) > 0.45) this._stain(b, m * 0.4, -hd + 2.2, 1.4);
  }

  /**
   * The ember's own shape: one soft dot, drawn once and shared.
   *
   * A Points cloud with no map draws hard squares, and a hard-edged square is
   * the same fault as the painted ellipse this replaced — an edge where light
   * has none. The falloff is squared rather than linear so the middle stays
   * small and bright and the outside is almost nothing, which is what stops a
   * dozen of these overlapping into one orange smear.
   */
  _emberDot() {
    return this._mat('emberDot', () => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const g = cv.getContext('2d');
      const img = g.createImageData(32, 32);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
          const a = Math.max(0, 1 - d) ** 2;
          const o = (y * 32 + x) * 4;
          img.data[o] = 255; img.data[o + 1] = 226; img.data[o + 2] = 172;
          img.data[o + 3] = Math.round(a * 255);
        }
      }
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    });
  }

  /**
   * THE GUN CASE.
   *
   * Neither shoulder weapon is in the player's hands at the start of a run any
   * more; each one is in its owner's house, in the case they kept it in. That
   * is the whole point of moving them: the first fifty kills are a pistol run,
   * and what opening a district buys you is a real weapon lying where a real
   * weapon would be lying.
   *
   * ONE case builds BOTH, because two hand-built cases is two sets of numbers
   * to get wrong and only one of them ever gets looked at. The gun goes in
   * first, the case is sized around the bounding box it actually occupies once
   * laid flat, the footprint is measured off the finished assembly rather than
   * assumed, and the pool of light is cut to that footprint. Everything
   * downstream — the collider, the wall clearance, the doorway test — is that
   * one measurement, so a longer weapon gets a longer case instead of a lid
   * through the plaster.
   *
   * It is built from the SAME 3D model the first-person view uses, so what you
   * pick up off the floor is what appears in your hands a second later — not a
   * sprite of a gun and then a different gun.
   *
   * `live` keeps it out of the room's merge, because it has to be able to
   * disappear when it is taken (and come back when a run restarts).
   */
  weaponCase(cfg) {
    const root = new THREE.Group();
    const g = new THREE.Group();
    root.add(g);
    const wood = this._mat('gunCaseWood', () => new THREE.MeshLambertMaterial({ color: 0x4a3524 }));
    const baize = this._mat('gunCaseBaize', () => new THREE.MeshLambertMaterial({ color: 0x2b4433 }));
    const brass = this._mat('gunCaseBrass', () => new THREE.MeshLambertMaterial({ color: 0xa98b3c }));
    const card = this._mat('shellBox', () => new THREE.MeshLambertMaterial({ color: 0x8c3a2c }));
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

    // The gun first, laid on its side with the barrel along the case, so the
    // case can be built to fit what is actually in it.
    const gun = buildWeaponModel(cfg.id).group;
    gun.rotation.set(0, Math.PI / 2, Math.PI / 2);
    gun.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(gun);
    const CH = 0.16;                                  // the case is shallow
    const CW = Math.max(1.28, bb.max.x - bb.min.x + 0.22);
    const CD = Math.max(0.42, bb.max.z - bb.min.z + 0.16);
    gun.position.set(
      -(bb.min.x + bb.max.x) / 2, CH + 0.03 - bb.min.y, -(bb.min.z + bb.max.z) / 2);

    // the case shell, its lining, and the lid folded back flat behind it
    const base = box(CW, CH, CD, wood);
    base.position.y = CH / 2;
    const lining = box(CW - 0.08, 0.02, CD - 0.08, baize);
    lining.position.y = CH - 0.01;
    g.add(base, lining);
    /**
     * THE LID IS ON A REAL HINGE.
     *
     * It used to be two loose slabs lying on the boards behind the case,
     * placed where an open lid looks like it should be — which is fine until
     * something has to CLOSE it, and then there is no hinge to close it about
     * and no way to make the shut lid land on the rim.
     *
     * So the lid hangs off a pivot on the back rim, and the offsets below are
     * solved rather than eyeballed: a rigid half-turn about this axis takes
     * the lid from exactly where it has always rested — flat on the floor
     * behind the case, lining upward — to exactly on top of the shell with the
     * lining face down inside it. Nothing about the case at rest changed; what
     * changed is that the rest pose is now one end of an arc.
     *
     * (H = (0, CH/2 + 0.025, -CD/2 - 0.01) with the lid at local
     *  (0, CH/2, CD/2 + 0.01) is the unique solution of "closed at 0 rad,
     *  today's open pose at -PI".)
     */
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, CH / 2 + 0.025, -CD / 2 - 0.01);
    lidPivot.rotation.x = -Math.PI;
    const lid = box(CW, 0.05, CD, wood);
    lid.position.set(0, CH / 2, CD / 2 + 0.01);
    const lidFelt = box(CW - 0.08, 0.02, CD - 0.08, baize);
    lidFelt.position.set(0, CH / 2 - 0.03, CD / 2 + 0.01);
    lidPivot.add(lid, lidFelt);
    g.add(lidPivot);
    for (const sx of [-CW / 2 + 0.16, CW / 2 - 0.16]) {   // the hinge barrel
      const h = box(0.1, 0.03, 0.06, brass);
      h.position.set(sx, CH / 2 + 0.025, -CD / 2 - 0.01);
      g.add(h);
    }
    const catchPlate = box(0.12, 0.05, 0.04, brass);
    catchPlate.position.set(0, CH * 0.55, CD / 2 + 0.01);
    g.add(catchPlate);
    g.add(gun);

    // ...and what was left with it, in its torn box beside the case: loose
    // shells for the coachgun, two pan drums for the Foundry Gun.
    const kit = box(0.19, 0.1, 0.13, card);
    kit.position.set(-CW / 2 - 0.16, 0.05, 0.02);
    kit.rotation.y = 0.3;
    g.add(kit);
    if (cfg.loose === 'drums') {
      for (let i = 0; i < 2; i++) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.048, 14), brass);
        drum.rotation.z = Math.PI / 2;
        drum.position.set(-CW / 2 - 0.30 + i * 0.06, 0.085, -0.08 + i * 0.1);
        g.add(drum);
      }
    } else if (cfg.loose === 'clips') {
      for (let i = 0; i < 3; i++) {          // en-bloc clips, stacked flat
        const clip = box(0.075, 0.018, 0.13, brass);
        clip.position.set(-CW / 2 - 0.30 + i * 0.02, 0.012 + i * 0.019, -0.09 + i * 0.07);
        clip.rotation.y = 0.2 - i * 0.18;
        g.add(clip);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.065, 7), card);
        sh.rotation.set(Math.PI / 2, 0, i * 0.7);
        sh.position.set(-CW / 2 - 0.34 + i * 0.05, 0.012, -0.1 + i * 0.06);
        g.add(sh);
      }
    }

    /**
     * THE FOOTPRINT, MEASURED.
     *
     * The case is NOT symmetric about the point it is built around: the lid
     * folds back a whole case-depth behind it and the box of ammunition lies
     * off its left end, so the assembly runs a good deal further in -x and -z
     * than in +x and +z. A collider centred on the build origin therefore
     * described a box the case was not in, and a spot that looked clear by it
     * put the lid inside the bedroom partition.
     *
     * So the real extremes are worked out here and the assembly is shifted
     * onto the middle of them. After this the anchor means what every
     * placement test assumes it means — the centre of the thing — and the
     * collider below is the real footprint plus a hand's width.
     */
    const minX = -CW / 2 - 0.36, maxX = CW / 2;
    const minZ = -CD * 1.5 - 0.02, maxZ = CD / 2;
    g.position.set(-(minX + maxX) / 2, 0, -(minZ + maxZ) / 2);
    const foot = [(maxX - minX) / 2 + 0.09, CH, (maxZ - minZ) / 2 + 0.11];

    /**
     * ...and the thing that says it is a pickup.
     *
     * An open case on a floorboard in an unlit house is a prop. What separates
     * a prop from something the game wants you to walk up to is that it puts
     * out LIGHT — so this one does. It used to do it with a painted ellipse
     * lying on the boards and a translucent cone standing in it, and both of
     * those are the same mistake: a flat surface pretending to be light. Read
     * from anywhere but head-on they were a sheet of orange lying on the
     * floor, they had a visible EDGE where light does not have one, and the
     * cone had a silhouette, which is what turns a hint into a beacon.
     *
     * So it is EMBERS now. A few dozen sparks lift out of the case on their
     * own clocks, curl inward as they rise, brighten as they leave the lining
     * and go out before they reach the top of their run — one Points cloud,
     * one draw call, one small canvas of a soft dot between them. Nothing is
     * bright: a single ember is at the edge of visible and the effect is what
     * two dozen of them do together, which is the difference between a warm
     * thing on a dark floor and a rune. Nothing is fast either, and no two
     * share a phase, so it never settles into a pulse you can predict.
     *
     * The only real LIGHT is the lamp, which is the part that carries from a
     * doorway: a point source low over the boards, breathing slowly. Real
     * light has no edge and no silhouette, so it can afford to be the one
     * thing here that is not a particle.
     *
     * The whole lot hangs off the ROOT rather than off the case, so it is
     * centred on the footprint every placement test is done with, and the
     * cloud is additive and depth-write-free so it never occludes the gun it
     * is advertising.
     */
    const glow = new THREE.Group();
    glow.position.y = CH + 0.02;
    const N = 30;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const seeds = [];
    let top = 0;
    // Deterministic, so a case looks the same every time the run rebuilds it.
    let seed = 0x5eed;
    for (const ch of cfg.id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const rnd = mulberry32(seed);
    for (let i = 0; i < N; i++) {
      seeds.push({
        // Where it leaves the case: anywhere over the lining, biased to the
        // middle, so the column has a soft base rather than a rim.
        ax: (rnd() * 2 - 1) * Math.sqrt(rnd()),
        az: (rnd() * 2 - 1) * Math.sqrt(rnd()),
        rise: 0.34 + rnd() * 0.5,          // how far this one gets
        speed: 0.16 + rnd() * 0.2,         // ...and how long it takes
        phase: rnd(),
        curl: (rnd() * 2 - 1) * 1.1,       // lateral drift on the way up
        warm: 0.72 + rnd() * 0.28,         // some run hotter than others
      });
      top = Math.max(top, seeds[i].rise);
    }
    // Every position starts at the origin and every colour at black, which
    // under additive blending is nothing at all — so the cloud is invisible
    // until the first animation frame writes it, with no parked-at-minus-99
    // vertex to blow the bounds out in the meantime.
    const spread = [foot[0] * 0.7 + 0.1, foot[2] * 0.7 + 0.1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Stated rather than computed: the buffer is rewritten every frame, so a
    // box worked out from whatever happened to be in it once is a box that is
    // wrong for the rest of the run. These are the extremes the seeds above
    // can actually reach, and everything that asks how much room this effect
    // needs — the placement test, the wall clearance — reads them.
    // (the 0.09 is the lateral drift the animation adds on top of the spread,
    // and the drift on z is one-sided — see Anomalies, kind 'pickupGlow')
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(-spread[0] - 0.09, 0, -spread[1] - 0.18),
      new THREE.Vector3(spread[0] + 0.09, top + 0.01, spread[1]));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, top / 2, 0), Math.hypot(spread[0] + 0.09, spread[1] + 0.18) + top);
    const emberMat = new THREE.PointsMaterial({
      map: this._emberDot(), size: 0.085, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
    });
    const embers = new THREE.Points(geo, emberMat);
    embers.renderOrder = 4;
    embers.frustumCulled = false;
    glow.add(embers);
    const lamp = new THREE.PointLight(0xffb04a, 1.1, 3.4, 2);
    lamp.position.y = 0.32;
    glow.add(lamp);
    root.add(glow);

    return {
      group: root, collide: foot, foot, live: true, gun, lidPivot, cfg,
      glow: { node: glow, embers, pos, col, seeds, spread, lamp },
    };
  }

  /**
   * Put the case down somewhere it actually fits — and somewhere you find it.
   *
   * It used to go in the BEDROOM, behind the partition at the back of the
   * house, which is the last room a player walks into and the one they walk
   * into with a wall between them and the light. It goes in the FRONT ROOM
   * now: the room the front door opens into, laid along the bedroom wall
   * facing the way you came in, so the pool of light is the first thing in the
   * house you see. The lid folds back INTO the room rather than into the wall
   * behind it, which is both how a gun case is left and the only orientation
   * whose lid cannot end up inside masonry.
   *
   * Candidates are tried in order and every one of them is offered as a LIT
   * footprint — the case plus the pool of light around it — so a spot is only
   * taken if the whole glow clears the walls, the partitions and the doorway
   * through them. _put rejects anything that would stand in the entry lane, in
   * an interior doorway or inside a piece already in the room. The last resort
   * is the middle of the floor, which is ugly and always legal.
   */
  _placeWeaponCache(built, cfg) {
    const c = this._canon(built.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // Built ONCE and offered to each spot in turn. _put rejects a placement
    // before it touches the group, so a refused attempt leaves the maker
    // untouched and reusable — and the alternative is assembling (and throwing
    // away) up to six copies of a weapon model at load time.
    const maker = this.weaponCase(cfg);
    const lit = [maker.foot[0] + GLOW_PAD, maker.foot[2] + GLOW_PAD];
    // half-extents of the lit footprint along canonical x and z, for a yaw
    const ext = (yaw) => (Math.abs(Math.round(yaw / (Math.PI / 2))) % 2 ? [lit[1], lit[0]] : lit);
    const part = -hd + 3.1;                  // the bedroom wall (housePartitions)
    const AIR = 0.06;                        // a gap you can see between things
    const [, dz] = ext(Math.PI), [sx] = ext(Math.PI / 2);
    // [x, z, yaw] in the canonical frame. yaw PI lays the case along X with
    // the lid folding back toward +Z — into the front room — and yaw 0 folds
    // it back toward -Z. Standing off a partition by PART_BAND rather than by
    // half its thickness is what _caseFits measures against, so a candidate
    // written this way is a candidate that can actually be taken.
    const spots = [
      // A hand-picked spot for a room whose plan the generic candidates do not
      // suit — the arcade has no back wall to lay a case along, only floor.
      ...(cfg.spot ? [cfg.spot] : []),
      [0.6, part + PART_BAND + dz + AIR, Math.PI],       // front room, off the bedroom wall
      [-1.4, part + PART_BAND + dz + AIR, Math.PI],
      [-(hw - 0.3 - sx), hd - 2.6, -Math.PI / 2],        // ...or along a side wall
      [hw - 0.3 - sx, hd - 2.6, Math.PI / 2],
      [0.6, part - PART_BAND - dz - AIR, 0],             // ...or back in the bedroom
      [-1.4, part - PART_BAND - dz - AIR, 0],
    ];
    // ...and if the room's own furniture has taken all six, walk the front
    // room on a half-metre grid until something fits. A hand-written list of
    // spots is a list of guesses about a floor plan that mirrors, resizes and
    // rotates under it; the sweep is what makes "the weapon is in this house"
    // true rather than likely, and a weapon that failed to place is a weapon
    // the run can never find.
    for (let lz = part + PART_BAND + dz + AIR; lz < hd - 1.0; lz += 0.5) {
      for (let lx = -hw + 1.0; lx < hw - 1.0; lx += 0.5) spots.push([lx, lz, Math.PI]);
    }
    for (const [lx, lz, yaw] of spots) {
      if (!this._caseFits(built, lx, lz, yaw, ext(yaw))) continue;
      const g = this._put(built, maker, lx, lz, { yaw });
      if (!g) continue;
      this.w.registerWeaponCache(g, maker, built.spec);
      return true;
    }
    this.rejects.push(`${cfg.id} case: nowhere in ${built.spec.name} fits it`);
    return false;
  }

  /**
   * Is this canonical spot somewhere the case may actually go?
   *
   * Measured on the LIT footprint (`half`), not the solid one: light through a
   * wall reads exactly as wrong as a lid through one, and the pool around this
   * case is wider than the case.
   *
   * Three ways it can fail. It can run through an OUTER WALL, which is a
   * bounds test in the canonical frame. It can run through an INTERIOR
   * PARTITION — those are stored in the building-local frame, so the footprint
   * is mapped there to meet them, and the doorway gap counts as part of the
   * line because a case standing in it seals the only way through.
   *
   * And it can land on the room's INDOOR SPAWN POINT, which every enterable
   * building registers at local (0, -d/4) — the middle of the back room, which
   * is exactly where a case laid along the back wall wants to be. A zombie
   * that streams in there arrives inside a solid box and has to squeeze itself
   * out of it before it can go anywhere, which is a route that sometimes does
   * not finish. Nothing else in the room can bury that point, because nothing
   * else in the room is placed by name — this case is.
   */
  _caseFits(built, lx, lz, yaw, half) {
    const spec = built.spec;
    const c = this._canon(spec);
    // Two frames, two rotations: in the canonical frame the case is turned by
    // yaw alone, and in the building-local frame the door's own quarter turn
    // is on top of it.
    const quarters = (a) => Math.abs(Math.round(a / (Math.PI / 2))) % 2;
    const [cx, cz] = half;
    if (Math.abs(lx) + cx > c.cw / 2 - 0.24) return false;
    if (Math.abs(lz) + cz > c.cd / 2 - 0.24) return false;
    const [hx, hz] = quarters(c.yaw) ? [cz, cx] : [cx, cz];
    const [mx, mz] = c.m(lx, lz);
    for (const p of spec.partitions ?? []) {
      // The whole line counts, gap included: standing a case in the gap blocks
      // the only way through to the bedroom.
      const a = p.axis === 'x'
        ? { minX: p.from, maxX: p.to, minZ: p.at - PART_BAND, maxZ: p.at + PART_BAND }
        : { minX: p.at - PART_BAND, maxX: p.at + PART_BAND, minZ: p.from, maxZ: p.to };
      if (Math.min(mx + hx, a.maxX) > Math.max(mx - hx, a.minX)
        && Math.min(mz + hz, a.maxZ) > Math.max(mz - hz, a.minZ)) return false;
    }
    // ...and the spawn point, in world coordinates, where they already are.
    const w = local2world(spec, spec.rot || 0, mx, mz);
    const ROOM = 0.6;                    // somewhere to stand, not just to fit
    for (const p of built.spawnPoints ?? []) {
      if (Math.abs(p.x - w.x) < hx + ROOM && Math.abs(p.z - w.z) < hz + ROOM) return false;
    }
    return true;
  }

  _tavern(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(Math.min(4.5, c.cd - 3)), -hw + 1.0, -0.2, { yaw: -Math.PI / 2, loot: [0.9, 0] });
    for (const oz of [-1.4, -0.2, 1.0]) this._put(b, this.stool(), -hw + 1.9, oz);
    this._put(b, this.shelf(2.2, false), -hw + 0.5, -hd + 1.2, { yaw: Math.PI / 2, loot: [0.9, 0] });
    for (const [tx, tz] of [[1.2, -hd + 1.6], [hw - 1.6, 0.4], [1.0, hd - 2.2]]) {
      if (!this._put(b, this.table(1.2, 1.2), tx, tz)) continue;
      this._put(b, this.chair(), tx - 0.95, tz, { yaw: Math.PI / 2 });
      this._put(b, this.chair(), tx + 0.95, tz, { yaw: -Math.PI / 2 });
      this._meal(b, tx, tz);
    }
    this._put(b, this.tippedChair(), 0.2, 0.6);
    this._put(b, this.crtTv(), hw - 0.8, -hd + 0.9, { yaw: -Math.PI / 2, lift: 1.5, collide: null });
    this._put(b, this.rug(2.2, 1.5), 0.4, hd - 2.6, { collide: null });
    this._put(b, this.picture(0.7, 0.5), -1.2, -hd + 0.35, { yaw: 0, collide: null });
    this._put(b, this.P.crateStack(2), hw - 1.1, hd - 1.4, { yaw: 0.4, loot: [-1.2, 0] });
    this._stain(b, 1.8, hd - 1.5, 1.6);
    this._papers(b, -0.5, hd - 2.5, 2);
  }

  _store(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b);
    this._put(b, this.registerCounter(2.2), hw - 1.6, hd - 1.9, { yaw: Math.PI, loot: [0, -0.9] });
    const rows = Math.min(3, Math.max(1, Math.floor((c.cd - 4.5) / 2.2)));
    for (let r = 0; r < rows; r++) {
      const z = -hd + 1.6 + r * 2.2;
      this._put(b, this.shelf(Math.min(3.2, c.cw - 3.5)), -0.6, z, { loot: r === 0 ? [0, 0.9] : false });
    }
    this._put(b, this.rack(2.2), -hw + 0.6, -0.5, { yaw: -Math.PI / 2 });
    this._put(b, this.fridge(), -hw + 0.55, hd - 1.4, { yaw: Math.PI / 2 });
    this._put(b, this.palletStack(2), hw - 1.1, -hd + 0.9, { yaw: 0.3 });
    this._put(b, this.vending(), hw - 0.6, 0.6, { yaw: -Math.PI / 2 });
    this._papers(b, 1.2, 0.5, 3);
  }

  _bakery(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(2.2), -0.4, hd - 2.0, { yaw: Math.PI, loot: [0, -0.9] });
    this._put(b, this.stove(), -hw + 0.55, -hd + 0.8, { yaw: Math.PI / 2 });
    this._put(b, this.stove(), -hw + 0.55, -hd + 1.7, { yaw: Math.PI / 2 });
    this._put(b, this.table(1.6, 0.9), 0.6, -hd + 1.2, { loot: [0, 0.9] });
    this._put(b, this.shelf(1.5, false), hw - 0.5, -0.4, { yaw: -Math.PI / 2 });
    this._papers(b, 0.4, 0.4, 2);
  }

  _postOffice(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(3.0), 0, 0.3, { loot: [0, 0.9] });
    this._put(b, this.rack(2.2), -0.4, -hd + 0.85, { loot: [0, 0.9] });
    this._put(b, this.desk(), hw - 1.2, -hd + 1.0, { yaw: -Math.PI / 2 });
    this._put(b, this.P.crateStack(2), -hw + 0.95, -hd + 0.95);
    this._papers(b, 0.6, 1.4, 6); // undelivered mail drifts
  }

  _library(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // Everything stays south of the sealed reading room (secret #2) at the
    // north end — the sliding shelf needs its runway.
    const zMin = -hd + 4.4;
    for (let r = 0; r < 3; r++) {
      const z = zMin + 1.0 + r * 2.0;
      if (z > hd - 2.4) break;
      this._put(b, this.shelf(3.4), -hw + 2.2, z);
      this._put(b, this.shelf(3.4), hw - 2.2, z);
    }
    const tz = hd - 2.4;
    this._put(b, this.table(2.2, 1.0), 0.4, tz);
    this._put(b, this.chair(), -0.4, tz - 0.95, { yaw: 0 });
    this._put(b, this.tippedChair(), 1.4, tz + 0.8);
    this._put(b, this.desk(), -hw + 1.3, hd - 1.6, { yaw: Math.PI / 2, loot: [0.9, 0] });
    this._put(b, this.fileCabinet(), hw - 0.6, hd - 1.4, { yaw: -Math.PI / 2 });   // card catalogue
    this._put(b, this.fileCabinet(), hw - 0.6, hd - 2.3, { yaw: -Math.PI / 2 });
    this._put(b, this.rug(2.4, 1.6), 0.4, tz, { collide: null });
    this._put(b, this.plant(), -hw + 0.7, hd - 3.0);
    this._spawnAt(b, hw - 2.4, zMin + 2.0);   // between the stacks, out of sight
    this._papers(b, 0.2, tz + 0.9, 4);
  }

  _diner(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(Math.min(4.0, c.cw - 4)), -0.8, -hd + 2.0, { loot: [0, 0.9] });
    for (const ox of [-1.5, -0.5, 0.5, 1.5]) this._put(b, this.stool(), -0.8 + ox, -hd + 3.0);
    for (const s of [-1, 1]) { // window booths
      const bx = s * (hw - 1.6);
      this._put(b, this.table(0.9, 0.9), bx, hd - 2.0);
      this._put(b, this.pew(1.4), bx, hd - 1.05, { yaw: Math.PI });
      this._meal(b, bx, hd - 2.0);
    }
    this._put(b, this.kitchenRun(2.2), -hw + 0.6, -hd + 3.4, { yaw: Math.PI / 2 });
    this._put(b, this.stove(), -hw + 0.6, -hd + 0.9, { yaw: Math.PI / 2 });
    this._put(b, this.fridge(), -hw + 0.6, -hd + 1.9, { yaw: Math.PI / 2 });
    this._put(b, this.vending(), hw - 0.6, -hd + 1.2, { yaw: -Math.PI / 2 });
    this._put(b, this.crtTv(), hw - 0.8, -hd + 3.0, { yaw: -Math.PI / 2, lift: 1.6, collide: null });
    this._closet(b, -hw + 1.4, hd - 1.2, 1.5, 1.3);
    this._stain(b, 1.6, 0.2, 1.3);
    this._papers(b, 0.5, 0.8, 2);
  }

  _office(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b);
    for (const [ox, oz] of [[-hw + 1.6, -hd + 1.4], [-hw + 1.6, 0.6], [1.0, -hd + 1.4], [1.0, 0.6]]) {
      this._put(b, this.desk(), ox, oz);
      this._put(b, this.chair(), ox, oz - 0.9, { yaw: 0 });
    }
    this._put(b, this.fileCabinet(), hw - 0.55, -hd + 0.7, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.fileCabinet(), hw - 0.55, -hd + 1.5, { yaw: -Math.PI / 2 });
    this._put(b, this.cabinet(), hw - 0.55, -hd + 2.5, { yaw: -Math.PI / 2 });
    this._put(b, this.waterCooler(), hw - 0.5, hd - 1.5, { yaw: -Math.PI / 2 });
    this._put(b, this.plant(), -hw + 0.6, hd - 1.2);
    this._put(b, this.tippedChair(), 1.8, 1.6);
    this._closet(b, hw - 1.6, hd - 1.0, 1.5, 1.3);
    this._papers(b, 0, 0.2, 6);
  }

  _apartment(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // Perfectly tidy. Everything squared to the walls, the bed made, the
    // meal laid out and untouched. (Except the chair on the ceiling — secret
    // #6 keeps its corner clear at canonical (-1, -1.5).)
    this._put(b, this.rug(1.9, 1.3), -hw + 1.4, hd - 1.9, { collide: null });
    this._put(b, this.sofa(), -hw + 1.3, hd - 1.2, { yaw: Math.PI });
    this._put(b, this.table(1.1, 0.8), -hw + 1.4, hd - 2.6);
    this._put(b, this.crtTv(), 1.2, hd - 1.2, { yaw: Math.PI });
    this._put(b, this.bed(), hw - 0.8, -hd + 1.3);
    this._put(b, this.nightstand(), hw - 0.75, -hd + 2.7);
    this._put(b, this.dresser(), hw - 0.6, -hd + 4.0, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.shelf(1.4), -hw + 0.5, -hd + 1.2, { yaw: Math.PI / 2 });
    this._put(b, this.kitchenRun(2.0), -hw + 0.6, 0.9, { yaw: Math.PI / 2 });
    this._put(b, this.fridge(), -hw + 0.55, -0.6, { yaw: Math.PI / 2 });
    this._put(b, this.picture(0.55, 0.42), 0.2, -hd + 0.35, { yaw: 0, collide: null });
    this._meal(b, -hw + 1.4, hd - 2.6);
  }

  _pawnShop(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(3.0), 0, 0.8, { loot: [0, 0.9] });
    this._put(b, this.shelf(2.0, false), -hw + 0.5, -0.6, { yaw: Math.PI / 2, loot: [0.9, 0] });
    this._put(b, this.displayStand(), -1.5, -hd + 1.5);
    this._put(b, this.displayStand(), 0.2, -hd + 1.5);
    // the safe in the back corner — the good stuff
    this._put(b, this.locker(), hw - 0.7, -hd + 0.8, { yaw: Math.PI, loot: [0, 0.9] });
    this._papers(b, 0.8, 1.8, 3);
  }

  /** Stand a cabinet, and make it a machine you can actually walk up to and
   *  play. The prompt stands in FRONT of the deck, not inside the cabinet. */
  _cabinet(b, id, lx, lz, yaw) {
    const cab = this.arcadeCab(id);
    const g = this._put(b, cab, lx, lz, { yaw });
    if (!g) return null;
    g.userData.cab = id;
    // now the cabinet has a place in the world, the attract loop can be heard
    // from it — and culled by distance like every other surface animation
    if (cab.flip) { cab.flip.x = g.position.x; cab.flip.z = g.position.z; }
    const reach = 0.75;
    const px = g.position.x + Math.sin(g.rotation.y) * reach;
    const pz = g.position.z + Math.cos(g.rotation.y) * reach;
    this.w.addInteractable({
      x: px, z: pz, y: b.spec.y, radius: 1.9,
      prompt: `Play ${MACHINES[id].title} [E]`,
      onInteract: () => this.w.events.emit('arcade:play', { id }),
    });
    return g;
  }

  _arcade(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // The back wall carries one of each machine, in order, so a player walking
    // in meets the whole line-up before anything repeats.
    for (let i = 0; i < 4; i++) {
      this._cabinet(b, MACHINE_IDS[i], -hw + 1.0 + i * 1.1, -hd + 0.8, 0);
    }
    for (let i = 0; i < 3; i++) {
      this._cabinet(b, MACHINE_IDS[(i + 2) % 4], -hw + 1.2 + i * 1.1, 0.5, Math.PI);
    }
    this._put(b, this.registerCounter(1.8), hw - 1.5, hd - 2.0, { yaw: Math.PI, loot: [0, -0.9] });
    this._put(b, this.vending(), hw - 0.6, -hd + 1.2, { yaw: -Math.PI / 2 });
    this._cabinet(b, MACHINE_IDS[1], hw - 0.8, -0.8, -Math.PI / 2);
    this._put(b, this.rug(2.2, 1.5, 'carpetRed'), -0.6, 1.8, { collide: null });
    this._dropCeiling(b, 2.9);
    this._closet(b, -hw + 1.3, hd - 1.2, 1.5, 1.3);
    this._stain(b, -1.0, 1.8, 1.2);
  }

  _boutique(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // The display window by the door belongs to secret #10's mannequin. Leave
    // it be — but give it company, so the one that moves has somewhere to hide.
    this._dropCeiling(b);
    this._put(b, this.registerCounter(2.0), hw - 1.5, 0.4, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    for (const [ox, oz] of [[-1.6, -hd + 1.3], [0.4, -hd + 1.3], [-2.6, 0.6]]) this._put(b, this.displayStand(), ox, oz);
    for (const [ox, oz, yw] of [[-1.6, -hd + 1.3, 0.4], [0.4, -hd + 1.3, -1.1]]) {
      this._put(b, this.mannequin(), ox, oz, { yaw: yw, collide: null, lift: 0.9 });
    }
    this._put(b, this.clothesRack(2.0), -0.8, 1.0, { yaw: 0.1 });
    this._put(b, this.clothesRack(1.6), 1.6, 2.0, { yaw: Math.PI / 2 });
    this._put(b, this.shelf(2.4, false), 1.8, -hd + 0.55);
    this._put(b, this.mirrorRun(1.4), -hw + 0.55, -1.4, { yaw: Math.PI / 2 });
    this._put(b, this.tippedChair(), -0.8, 1.8);
    this._closet(b, hw - 1.5, -hd + 1.0, 1.5, 1.3);  // the fitting room
    this._papers(b, 0.4, 2.4, 2);
  }

  _school(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.desk(), -2.0, -hd + 1.2, { yaw: Math.PI }); // teacher's desk
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const x = -3.4 + col * 2.6, z = -hd + 3.0 + r * 1.9;
        this._put(b, this.table(1.1, 0.7), x, z);
        this._put(b, this.chair(), x, z + 0.8, { yaw: Math.PI });
      }
    }
    for (let i = 0; i < 3; i++) {
      this._put(b, this.locker(), hw - 0.6, -hd + 2.0 + i * 1.0, { yaw: -Math.PI / 2, loot: i === 1 ? [-0.9, 0] : false });
    }
    this._put(b, this.shelf(2.0), -hw + 0.5, 0.5, { yaw: Math.PI / 2 });
    this._put(b, this.locker(), hw - 0.6, -hd + 5.0, { yaw: -Math.PI / 2 });
    this._put(b, this.waterCooler(), -hw + 0.5, hd - 1.5, { yaw: Math.PI / 2 });
    this._put(b, this.picture(0.8, 0.6), -2.0, -hd + 0.35, { yaw: 0, collide: null }); // the blackboard
    this._put(b, this.tippedChair(), 2.4, 1.0);
    this._closet(b, -hw + 1.3, hd - 1.3, 1.6, 1.4);
    this._dropCeiling(b, 3.1);
    this._papers(b, 0.5, 1.5, 5);
  }

  _clinic(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.cot(), -hw + 0.85, -hd + 1.4);
    this._put(b, this.cot(), -hw + 0.85, -hd + 3.6);
    // medicine cabinets: health-tier loot
    this._put(b, this.cabinet(), hw - 0.55, -hd + 0.8, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.cabinet(), hw - 0.55, -hd + 2.0, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.desk(), hw - 1.3, hd - 1.9, { yaw: Math.PI / 2 });
    this._put(b, this.chair(), hw - 2.3, hd - 1.9, { yaw: -Math.PI / 2 });
    this._put(b, this.cot(), -hw + 0.85, hd - 2.0);
    this._put(b, this.stockShelf(1.8), -hw + 0.6, 0.6, { yaw: Math.PI / 2, loot: [1.0, 0] });
    this._put(b, this.fileCabinet(), hw - 0.55, 0.4, { yaw: -Math.PI / 2 });
    this._put(b, this.waterCooler(), 1.6, hd - 1.4);
    this._dropCeiling(b, 2.9);
    this._papers(b, -0.4, 0.6, 4);
    this._stain(b, -1.2, -0.4, 1.5);
  }

  _townhall(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(Math.min(5, c.cw - 4)), 0, -0.2, { loot: [0, 0.9] });
    for (const s of [-1, 1]) this._put(b, this.pew(2.0), s * 2.2, hd - 1.6, { yaw: Math.PI });
    this._put(b, this.desk(), -hw + 1.3, -hd + 1.0);
    this._put(b, this.cabinet(), hw - 0.55, -hd + 0.8, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._papers(b, 0.6, 0.7, 6);
  }

  _church(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.altar(), 0, -hd + 1.3, { loot: [0, 1.0] });
    const rows = Math.min(5, Math.floor((c.cd - 5) / 2.0));
    for (let r = 0; r < rows; r++) {
      const z = -hd + 3.4 + r * 2.0;
      for (const s of [-1, 1]) this._put(b, this.pew(Math.min(2.6, c.cw / 2 - 0.9)), s * (c.cw / 4 + 0.1), z, { yaw: Math.PI });
    }
    this._put(b, this.tippedChair(), 0.3, hd - 2.3);
    this._papers(b, -0.4, -hd + 2.4, 3); // scattered hymn sheets
  }

  _gasShop(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(1.8), hw - 1.4, -hd + 1.1, { loot: [0, 0.9] });
    this._put(b, this.shelf(1.8, false), -hw + 1.2, -hd + 0.55, { loot: [0, 0.9] });
    this._put(b, this.fridge(), -hw + 0.55, 0.8, { yaw: Math.PI / 2 });
    this._papers(b, 0.3, 0.6, 2);
  }

  /**
   * A low walkable platform inside a building — a stage, a dais, a step.
   * Slab, collider and terrain platform together, in canonical coordinates,
   * so you can genuinely get up on it and fight from it.
   */
  _platform(b, lx, lz, w, d, h) {
    const s = b.spec;
    const r = this._rectWorld(b, lx - w / 2, lz - d / 2, lx + w / 2, lz + d / 2);
    const slab = this.kit.box(r.maxX - r.minX, h, r.maxZ - r.minZ, 'floorWood');
    slab.position.set((r.minX + r.maxX) / 2, s.y + h / 2 + 0.1, (r.minZ + r.maxZ) / 2);
    this._bucket.add(slab);
    this.w.terrain.addPlatform(r.minX, r.maxX, r.minZ, r.maxZ, s.y + h + 0.1);
    return r;
  }

  /**
   * Eastgate Community Hall: the one clear span in the district.
   *
   * Everything is against the walls, which is exactly why it matters — it is
   * the only Eastgate interior with enough open floor to fight a wave in, and
   * the stage at the far end is high ground you can back onto. The chairs are
   * stacked because whatever was on that last night was over before it
   * started.
   */
  _hall(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b, 3.3);
    this._platform(b, 0, -hd + 1.5, c.cw - 2.4, 2.4, 0.42);
    // The piano stands ON the stage, square to the room and well inboard of the
    // edge — it used to sit half off the end of the platform with no collider,
    // so you walked through it. Now it is solid, it faces the hall, and it
    // works: see the interactable below.
    const pn = this.piano();
    const pg = this._put(b, pn, -hw + 3.2, -hd + 1.5, { lift: 0.54, loot: [0, 1.4] });
    if (pg) {
      this._put(b, this.stool(), -hw + 3.2, -hd + 2.5, { lift: 0.54 });
      const press = this.w._animate(pn.keys, 'keys', pg.position.x, pg.position.z,
        { axis: 'x', amp: 0.13, dur: 3.2, beat: 6.2, t: 0, flames: pn.flames });
      const pos = { x: pg.position.x, y: b.spec.y + 1.3, z: pg.position.z };
      this.w.addInteractable({
        x: pg.position.x, z: pg.position.z + 1.0, y: b.spec.y, radius: 2.2,
        prompt: 'Play the piano [E]',
        onInteract: () => {
          if (press) press.t = press.dur;
          this.w.events.emit('anomaly:sound', { kind: 'piano', pos });
          // A hall piano in an empty street is the loudest thing you own.
          this.w.events.emit('noise', { pos, radius: 85 });
          this.w.events.emit('subtitle', {
            text: 'The chord holds far longer than the room should let it. Something outside keeps time.',
          });
          this.w.events.emit('whisper', { intensity: 0.5 });
        },
      });
    }
    this._put(b, this.picture(1.6, 1.0), 1.0, -hd + 0.35, { yaw: 0, collide: null });   // the banner
    for (const s of [-1, 1]) {
      this._put(b, this.chairStack(6), s * (hw - 0.85), -hd + 4.2, { yaw: -s * Math.PI / 2 });
      this._put(b, this.chairStack(5), s * (hw - 0.85), -hd + 5.6, { yaw: -s * Math.PI / 2 });
    }
    this._put(b, this.trestle(2.6), -hw + 4.2, hd - 1.9, { yaw: 0.08, loot: [0, -0.9] });
    this._put(b, this.trestle(2.2), hw - 1.6, hd - 2.0, { yaw: -0.06 });
    this._put(b, this.counter(2.6), hw - 1.5, 0.4, { yaw: -Math.PI / 2, loot: [-0.9, 0] });  // the serving hatch
    this._put(b, this.waterCooler(), -hw + 0.6, 1.6, { yaw: Math.PI / 2 });
    this._put(b, this.tippedChair(), 1.6, 1.2);
    this._put(b, this.tippedChair(), -2.4, 2.6);
    this._put(b, this.chair(), 2.6, -1.0, { yaw: Math.PI });
    // the store cupboard off the back corner, and what waits in it
    this._closet(b, -hw + 1.4, hd - 1.2, 1.6, 1.4);
    this._spawnAt(b, hw - 3.0, -hd + 3.4);
    this._papers(b, 0, 0.6, 7);           // the raffle tickets, everywhere
    this._stain(b, -1.4, -hd + 3.0, 1.5);
  }

  /**
   * A back-lane garage. Half workshop, half everything that would not fit in
   * the house — and the one Eastgate interior that pays out in hardware.
   */
  _garage(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.workbench(2.0), 0, -hd + 0.75, { loot: [0, 0.9] });
    this._put(b, this.toolBoard(1.6), 0, -hd + 0.28, { collide: null, lift: 1.15 });
    this._put(b, this.rack(2.2), -hw + 0.75, -0.4, { yaw: Math.PI / 2, loot: [1.0, 0] });
    this._put(b, this.P.barrel(), hw - 0.85, -hd + 1.2);
    this._put(b, this.locker(), hw - 0.65, 0.6, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.P.crateStack(2), hw - 1.4, hd - 0.9, { yaw: 0.35 });
    this._stainOil(b, 0, 0.6, 2.0);
    this._stainOil(b, -1.2, -1.4, 1.2);
    this._spawnAt(b, -0.6, 0.4);
    this._papers(b, 1.2, -0.4, 2);
  }

  /**
   * A garden shed: two square metres of somebody's whole outdoor life. Small
   * enough that walking in is a decision, which is what makes finding
   * something in one feel earned.
   */
  _shed(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.toolLean(), -hw + 0.5, -hd + 0.5, { yaw: 0.2 });
    this._put(b, this.shelf(1.4, false), 0.2, -hd + 0.35, { loot: [0, 0.7] });
    this._put(b, this.P.barrel(), hw - 0.55, -hd + 0.6);
    this._decalAt(b, 'oilStain', -0.3, 0.2, 1.0, null);
    this._spawnAt(b, 0, -hd + 0.9);
  }

  /**
   * The nursery glasshouse. Everything in here is still alive, which in a town
   * where nothing has been watered for a year is the part to think about.
   */
  _greenhouse(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.pottingBench(Math.min(2.4, c.cw - 1.4)), 0, -hd + 0.6, { loot: [0, 0.9] });
    this._put(b, this.growBed(Math.min(2.2, c.cw - 1.6)), -0.2, 0.35);
    this._put(b, this.P.barrel(), hw - 0.6, hd - 0.9);
    this._put(b, this.plant(), -hw + 0.55, hd - 0.9);
    this._put(b, this.plant(), hw - 0.6, -hd + 0.7);
    this._decalAt(b, 'oilStain', 1.2, -0.4, 1.1, 0x2e4020);
  }

  /** Ground floor of the Meridian Tower: reception hall, dead elevators, and
   *  the maintenance room behind the partition (where the cube waits). */
  _towerLobby(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // reception desk facing the entrance
    this._put(b, this.counter(3.2), 0, hd - 3.4, { yaw: Math.PI, loot: [0, -0.9] });
    this._put(b, this.chair(), 0.4, hd - 4.2, { yaw: Math.PI });
    // waiting corner by the glass
    this._put(b, this.sofa(), -hw + 1.4, hd - 1.3, { yaw: Math.PI });
    this._put(b, this.plant(), -hw + 0.6, hd - 2.7);
    this._put(b, this.plant(), hw - 0.6, hd - 0.8);
    this._put(b, this.tippedChair(), -1.8, hd - 3.6);
    // elevator bank on the west wall of the hall
    for (const lz of [-0.6, 1.6]) {
      this._put(b, this.elevatorDoors(), -hw + 0.55, lz, { yaw: -Math.PI / 2 });
    }
    // the call button still lights; the cars stopped answering years ago
    const btn = this._pt(b, -hw + 1.1, 0.5);
    this.w.addInteractable({
      x: btn.x, z: btn.z, y: b.spec.y, radius: 2.0,
      prompt: 'Call the elevator [E]',
      onInteract: () => this.w.events.emit('elevator:call', { pos: { x: btn.x, y: b.spec.y + 1.5, z: btn.z } }),
    });
    // maintenance room behind the partition (north end)
    this._put(b, this.locker(), hw - 2.6, -hd + 0.8, { yaw: Math.PI, loot: [0, 0.9] });
    this._put(b, this.P.crateStack(2), 0.6, -hd + 1.2, { yaw: 0.4 });
    this._stainOil(b, 1.8, -hd + 1.6, 1.3);
    this._papers(b, -0.5, hd - 4.6, 5);
    this._spawnAt(b, 2.4, 0.2);
  }

  /**
   * The hollow cottage. From the street it is a normal house with curtained
   * windows. Inside, a second set of walls stands less than a metre within the
   * first — windowless, seamless — and the room they enclose is far too small
   * for the roofline. A dark traffic light stands in the middle of it, and one
   * chair faces the traffic light. Nothing else was ever moved in.
   */
  _hollow(b) {
    const s = b.spec;
    const c = this._canon(s);
    const hw = c.cw / 2, hd = c.cd / 2;
    const inset = 0.85, t = 0.18;
    const H = s.h - 0.2;
    const iw = hw - inset, id = hd - inset;
    const wall = (cx, cz, lenX, lenZ) => {
      const g = new THREE.Group();
      const m = this.kit.box(lenX, H, lenZ, 'wallPlaster');
      m.position.y = H / 2;
      g.add(m);
      this._put(b, { group: g }, cx, cz, { collide: [lenX / 2, H / 2, lenZ / 2] });
    };
    // front wall keeps a gap aligned with the real door; the threshold between
    // the two walls reads almost a metre deep on the way in
    wall((-iw - 0.65) / 2, id, iw - 0.65, t);
    wall((iw + 0.65) / 2, id, iw - 0.65, t);
    wall(0, -id, iw * 2, t);
    wall(-iw, 0, t, id * 2);
    wall(iw, 0, t, id * 2);
    this._put(b, this.P.trafficLight(), 0.5, -0.7, { collide: [0.14, 1.7, 0.14] });
    this._put(b, this.chair(), 0.5, 0.9, { yaw: Math.PI, loot: [0, 0.8] });
  }

  _boathouse(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.P.crateStack(2), -1.2, -hd + 1.2, { yaw: 0.3 });
    this._put(b, this.P.barrel(), 1.4, -hd + 0.8);
    this._put(b, this.workbench(1.8), -hw + 0.95, 1.2, { yaw: Math.PI / 2, loot: [0.9, 0] });
    this._put(b, this.shelf(1.6, false), 1.0, -hd + 0.55);
    this._stain(b, 0.5, 1.5, 1.2, 0x1c2a34); // something dripped dry here
  }

  _barn(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    for (const [ox, oz] of [[-4.5, -2.8], [-2.6, -3.2], [-4.2, -1.0], [3.8, -3.0], [4.6, -1.4]]) {
      this._put(b, this.P.hayBale(), ox, oz, { yaw: ((ox * 7) % 3) * 0.4 });
    }
    this._put(b, this.P.crateStack(3), 4.0, 1.0, { yaw: 0.2, loot: [1.1, 1.1] });
    this._put(b, this.workbench(2.0), -hw + 1.1, 1.8, { yaw: Math.PI / 2 });
    this._put(b, this.P.barrel(), -2.0, 1.0);
    this._spawnAt(b, 0.5, -2.0);
  }

  _machineShop(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.workbench(2.2), -hw + 1.2, -hd + 0.85, { loot: [0, 0.9] });
    this._put(b, this.workbench(2.0), hw - 0.65, -0.5, { yaw: -Math.PI / 2 });
    this._put(b, this.rack(2.4), -hw + 0.85, 0.8, { yaw: Math.PI / 2 });
    this._put(b, this.P.barrel(), 1.3, -1.2);
    this._put(b, this.P.crateStack(2), -0.8, 1.6, { yaw: 0.5 });
    this._put(b, this.locker(), hw - 0.7, -hd + 0.8, { yaw: Math.PI, loot: [0, 0.9] });
    this._stainOil(b, 0.4, -0.4, 1.6);
    this._stainOil(b, -1.6, 0.9, 1.2);
  }

  _factory(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    for (let i = 0; i < 3; i++) { // the production line
      this._put(b, this.machine(), -2.0, -hd + 2.5 + i * 3.4, { loot: i === 1 ? [1.5, 0] : false });
    }
    this._put(b, this.rack(3.0), hw - 0.9, -hd + 3.0, { yaw: -Math.PI / 2 });
    this._put(b, this.rack(2.6), -hw + 0.9, 2.0, { yaw: Math.PI / 2 });
    for (const [ox, oz] of [[2.5, -1.5], [3.1, -0.6], [2.2, 3.8]]) this._put(b, this.hazardDrum(), ox, oz);
    this._put(b, this.chainPanel(4.0), -1.0, 4.8);
    this._put(b, this.loadedPallet(), 3.6, 2.2);
    this._put(b, this.palletStack(3), 4.2, 4.0, { yaw: 0.3 });
    this._put(b, this.P.crateStack(3), -3.5, 3.5, { yaw: 0.4 });
    this._put(b, this.locker(), -hw + 0.6, -hd + 1.0, { yaw: Math.PI / 2, loot: [0.9, 0] });
    this._stainOil(b, -0.5, 0.5, 1.8);
    this._stainOil(b, 1.5, -3.0, 1.4);
    this._spawnAt(b, 0, 2.5);
  }

  _warehouse(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    const rng = mulberry32(Math.floor(b.spec.x * 3 + b.spec.z * 5) & 0x7fffffff);
    // corner office (behind the partition walls)
    this._put(b, this.desk(), hw - 2.5, -hd + 1.1, { yaw: Math.PI });
    this._put(b, this.chair(), hw - 2.5, -hd + 2.0, { yaw: Math.PI });
    this._put(b, this.locker(), hw - 0.8, -hd + 1.0, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._papers(b, hw - 2.6, -hd + 2.4, 4);
    // storage racks along the west wall
    for (let i = 0; i < 2; i++) this._put(b, this.rack(3.2), -hw + 0.85, -hd + 2.4 + i * 4.2, { yaw: Math.PI / 2 });
    // crate lanes through the floor: hard cover and choke points
    for (const [ox, oz, n] of [[-3.5, -2.0, 3], [1.5, -3.0, 2], [-1.0, 1.5, 4], [4.5, 0.5, 2], [2.0, 3.5, 3]]) {
      this._put(b, this.P.crateStack(n), ox, oz, { yaw: rng(), loot: n >= 4 ? [1.2, 0] : false });
    }
    for (const [ox, oz] of [[-5.5, 3.0], [5.8, -2.8]]) this._put(b, this.hazardDrum(), ox, oz);
    for (const [ox, oz] of [[-6.2, -3.4], [-4.9, -3.4], [-6.2, -2.1]]) this._put(b, this.loadedPallet(), ox, oz);
    this._put(b, this.palletStack(4), 3.4, -3.6, { yaw: 0.2 });
    this._put(b, this.chainPanel(3.6), 0.4, 4.6);   // the caged bay nobody emptied
    this._spawnAt(b, -2.0, -1.0); // things nest among the crates
    this._stainOil(b, 0.5, 2.0, 1.6);
  }

  /** Warehouse B: crate floor plus a raised mezzanine deck with stairs —
   *  vertical combat and top-shelf loot. */
  _warehouseMezz(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    const { lift } = this._mezzanine(b, { depth: 4.8, height: 3.1, stairSide: 1 });

    // top-shelf loot + crates on the deck; more cover below
    this._put(b, this.P.crateStack(2), -hw + 2.0, -hd + 2.0, { yaw: 0.3, lift, loot: [1.2, 0] });
    this._put(b, this.loadedPallet(), 1.0, -hd + 3.4, { yaw: 1.1, lift });
    this._put(b, this.rack(3.0), -2.5, -hd + 1.1, { lift, loot: [0, 1.0] });
    this._put(b, this.fileCabinet(), -hw + 1.0, -hd + 3.6, { yaw: Math.PI / 2, lift });
    for (const [ox, oz, n] of [[-4.0, 1.0, 3], [0.5, 0.0, 2], [4.5, 2.0, 4], [-1.5, 3.8, 2]]) {
      this._put(b, this.P.crateStack(n), ox, oz, { yaw: (ox + oz) % 1.5, loot: n >= 4 ? [1.2, 0] : false });
    }
    // shrink-wrapped pallets in ranks: the aisles between them are the fight
    for (const [ox, oz] of [[-5.6, 5.6], [-5.6, 7.0], [-4.2, 5.6], [5.6, 5.4], [5.6, 6.8]]) {
      this._put(b, this.loadedPallet(), ox, oz, { yaw: (ox * 3) % 0.4 });
    }
    this._put(b, this.palletStack(4), 2.6, 6.4, { yaw: 0.3 });
    this._put(b, this.chainPanel(4.2), -1.2, -hd + 6.4, { yaw: 0 }); // caged goods bay
    for (const [ox, oz] of [[5.8, -1.0], [-5.2, 4.4]]) this._put(b, this.hazardDrum(), ox, oz);
    this._spawnAt(b, 2.5, 1.5);
    this._stainOil(b, -1.0, 2.5, 1.8);
  }

  /* ---------------- downtown street-wall shops ---------------- */

  /** Pharmacy: dispensing counter, ranked stock shelving, a raided store room. */
  _pharmacy(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b);
    this._put(b, this.registerCounter(Math.min(3.4, c.cw - 4)), 0.4, -hd + 1.5, { yaw: Math.PI, loot: [0, 1.0] });
    this._put(b, this.stockShelf(2.6), 0.2, -hd + 0.6, { yaw: Math.PI, loot: [0, 1.2] });
    for (let r = 0; r < 2; r++) {
      this._put(b, this.shelf(Math.min(3.0, c.cw - 4)), -0.4, -hd + 3.6 + r * 2.1);
    }
    this._put(b, this.stockShelf(2.2), -hw + 0.55, 0.4, { yaw: Math.PI / 2, loot: [1.0, 0] });
    this._put(b, this.vending(), hw - 0.6, hd - 1.6, { yaw: -Math.PI / 2 });
    this._put(b, this.waterCooler(), hw - 0.55, -0.6, { yaw: -Math.PI / 2 });
    this._put(b, this.tippedChair(), 1.4, 1.2);
    this._closet(b, hw - 1.3, -hd + 1.1, 1.6, 1.4);
    this._papers(b, 0.2, 0.8, 5);
    this._stain(b, -1.6, 2.0, 1.3);
  }

  /** Hardware store: deep aisles, a timber rack, a bench of hand tools. */
  _hardware(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b, 3.2);
    this._put(b, this.registerCounter(2.2), hw - 1.6, hd - 2.0, { yaw: Math.PI, loot: [0, -1.0] });
    for (let r = 0; r < 2; r++) {
      this._put(b, this.hardwareAisle(Math.min(3.6, c.cw - 3.4)), -0.6, -hd + 2.0 + r * 2.6, { loot: r === 0 ? [0, 1.1] : false });
    }
    this._put(b, this.workbench(2.0), -hw + 1.2, hd - 1.4, { yaw: 0, loot: [0, -1.0] });
    this._put(b, this.toolBoard(1.8), -hw + 1.2, hd - 0.6, { yaw: Math.PI });
    this._put(b, this.palletStack(3), hw - 1.4, -hd + 1.2, { yaw: 0.4 });
    this._put(b, this.hazardDrum(), hw - 1.5, -hd + 2.6);
    this._put(b, this.P.crateStack(2), -hw + 0.9, -hd + 1.0, { yaw: 0.2, loot: [1.2, 0] });
    this._spawnAt(b, -hw + 1.4, -hd + 2.4);
    this._papers(b, 0.8, 1.6, 3);
  }

  /** Laundromat: machine banks down both walls, folding table, plastic chairs. */
  _laundromat(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b);
    this._put(b, this.washerBank(3), -hw + 1.6, -hd + 0.7, { yaw: Math.PI });
    this._put(b, this.washerBank(3), -hw + 0.6, hd - 3.2, { yaw: Math.PI / 2 });
    this._put(b, this.washerBank(2), hw - 0.6, -0.4, { yaw: -Math.PI / 2, loot: [-1.0, 0] });
    this._put(b, this.table(1.8, 0.8), 0.4, 0.6, { loot: [0, 1.0] });
    for (const ox of [-0.8, 0.8]) this._put(b, this.chair(), 0.4 + ox, 1.7, { yaw: Math.PI });
    this._put(b, this.tippedChair(), -1.0, 2.2);
    this._put(b, this.vending(), hw - 0.6, hd - 1.4, { yaw: -Math.PI / 2 });
    this._put(b, this.rug(1.6, 1.0, 'linoleum'), 0, 2.6, { collide: null });
    this._stain(b, 1.2, -1.4, 1.5, 0x2a3a3e); // something ran, and dried
    this._papers(b, -0.4, 1.4, 3);
  }

  /** Record shop: browsing bins, a listening booth, posters over everything. */
  _recordShop(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b);
    this._put(b, this.registerCounter(2.0), hw - 1.5, -hd + 1.2, { yaw: Math.PI, loot: [0, 1.0] });
    for (let r = 0; r < 3; r++) {
      const z = -hd + 3.0 + r * 1.5;
      if (z > hd - 1.6) break;
      this._put(b, this.recordBin(Math.min(2.6, c.cw - 3.4)), -0.5, z, { loot: r === 1 ? [0, 0.9] : false });
    }
    this._put(b, this.shelf(2.2, true), -hw + 0.5, -hd + 1.4, { yaw: Math.PI / 2 });
    this._put(b, this.crtTv(), hw - 0.7, hd - 1.6, { yaw: -Math.PI / 2 });
    this._put(b, this.sofa(), -hw + 1.2, hd - 1.2, { yaw: Math.PI });
    this._put(b, this.rug(2.0, 1.4), -hw + 1.4, hd - 2.4, { collide: null });
    this._spawnAt(b, hw - 1.6, hd - 3.0);
    this._papers(b, 0.6, 1.0, 4);
  }

  /** Barbershop: chairs facing a mirror run, a waiting bench, hair on the floor. */
  _barbers(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._dropCeiling(b, 2.8);
    this._put(b, this.mirrorRun(Math.min(3.0, c.cw - 3)), -0.4, -hd + 0.5, { yaw: Math.PI });
    for (const ox of [-1.4, 0.2, 1.6]) this._put(b, this.barberChair(), ox, -hd + 1.9, { yaw: Math.PI });
    this._put(b, this.pew(2.0), -hw + 1.4, hd - 1.2, { yaw: Math.PI });
    this._put(b, this.table(0.7, 0.6), -hw + 1.4, hd - 2.3);
    this._put(b, this.registerCounter(1.6), hw - 1.2, hd - 1.6, { yaw: Math.PI, loot: [0, -0.9] });
    this._put(b, this.cabinet(), hw - 0.6, -0.6, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.tippedChair(), 0.6, 1.4);
    this._papers(b, -0.2, 0.4, 3);
    this._stain(b, 0.2, -hd + 2.8, 1.2, 0x2a1c14); // swept into a pile. Not hair.
  }

  /**
   * The firehouse: one clear-span appliance bay with the engine still in it,
   * turnout gear on the rail, and a watch room walled off at the back. The
   * best hard cover downtown — you can fight around the engine all day.
   */
  _firehouse(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // The engine is parked hard against the west side of the bay, so the
    // apron in front of the doors stays clear and you can fight round it.
    this._put(b, this.fireEngine(), -2.7, 0.2, { yaw: Math.PI / 2 });
    this._put(b, this.gearRack(4), -hw + 0.7, -hd + 2.6, { yaw: Math.PI / 2 });
    this._put(b, this.locker(), -hw + 0.6, -hd + 0.9, { yaw: Math.PI / 2, loot: [1.0, 0] });
    this._put(b, this.workbench(1.8), hw - 0.75, -hd + 1.2, { yaw: -Math.PI / 2, loot: [-1.0, 0] });
    this._put(b, this.toolBoard(1.6), hw - 0.3, -hd + 1.2, { yaw: -Math.PI / 2 });
    this._put(b, this.hazardDrum(), hw - 1.0, -hd + 2.8);
    this._put(b, this.desk(), hw - 1.4, hd - 1.8, { yaw: -Math.PI / 2 });
    this._put(b, this.chair(), hw - 2.4, hd - 1.8, { yaw: Math.PI / 2 });
    this._put(b, this.waterCooler(), hw - 0.6, hd - 3.2, { yaw: -Math.PI / 2 });
    this._closet(b, -hw + 1.2, hd - 1.4, 1.8, 1.5);
    this._stainOil(b, -0.4, 2.6, 2.2);
    this._papers(b, hw - 2.0, hd - 2.6, 4);
  }
}
