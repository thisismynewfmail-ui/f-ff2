import * as THREE from '../../lib/three.module.js';
import { local2world, mergeStatic, mulberry32 } from './Buildings.js';

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

/** Walled-off corner office in the far-right corner of a warehouse. */
export function officePartitions(w, d, door) {
  const { cw, cd } = canonXform(w, d, door);
  return mapPartitions(w, d, door, [
    { axis: 'x', at: -cd / 2 + 4, from: cw / 2 - 4.5, to: cw / 2 - 0.3, gapAt: cw / 2 - 3.6, gapW: 1.2 },
    { axis: 'z', at: cw / 2 - 4.5, from: -cd / 2 + 0.3, to: -cd / 2 + 4, gapW: 0 },
  ]);
}

export class InteriorKit {
  constructor(world) {
    this.w = world;
    this.P = world.props;
    this.kit = world.kit;
    this.populated = [];
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
    fn.call(this, built);
    mergeStatic(this._bucket);
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
    if (Math.abs(lx) > c.cw / 2 - 0.5 || Math.abs(lz) > c.cd / 2 - 0.5) return null;
    if (Math.hypot(lx - doorX, lz - c.cd / 2) < 1.7) return null;
    const [mx, mz] = c.m(lx, lz);
    const p = local2world(spec, spec.rot || 0, mx, mz);
    const yaw = (opts.yaw ?? 0) + c.yaw - (spec.rot || 0) * Math.PI / 180;
    const g = maker.group;
    g.position.set(p.x, spec.y + 0.12 + (opts.lift ?? 0), p.z);
    g.rotation.y = yaw;
    this._bucket.add(g);
    const collide = opts.collide === undefined ? maker.collide : opts.collide;
    if (collide) {
      let [hx, hy, hz] = collide;
      const q = Math.round(yaw / (Math.PI / 2));
      if (Math.abs(yaw - q * Math.PI / 2) < 0.2 && Math.abs(q) % 2 === 1) [hx, hz] = [hz, hx];
      this.w.collision.addBoxCentered(p.x, spec.y + 0.12 + (opts.lift ?? 0) + hy, p.z, hx, hy, hz, 'furniture');
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

  arcadeCab(color = 0x39465e) {
    const g = new THREE.Group();
    const body = this.P.box(0.72, 1.75, 0.8, this.P.colorMat(color));
    body.position.y = 0.88;
    const screen = this.P.box(0.55, 0.45, 0.04, this.P.colorMat(0x10161c));
    screen.position.set(0, 1.35, 0.41);
    const deck = this.P.box(0.6, 0.08, 0.3, this.P.colorMat(0x1c2026));
    deck.position.set(0, 0.95, 0.48);
    g.add(body, screen, deck);
    return { group: g, collide: [0.38, 0.9, 0.45] };
  }

  displayStand() {
    const g = new THREE.Group();
    const ped = this.P.box(0.6, 0.9, 0.6, 'wallPlaster');
    ped.position.y = 0.45;
    g.add(ped);
    return { group: g, collide: [0.32, 0.5, 0.32] };
  }

  /* ---------------- building layouts (canonical: door at +Z) ---------- */

  _house(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // bedroom behind the partition at the far end
    this._put(b, this.bed(), -hw + 0.75, -hd + 1.3);
    this._put(b, this.cabinet(), 0.4, -hd + 0.6, { yaw: Math.PI, loot: [0, 0.9] });
    // kitchenette against the east wall of the main room
    this._put(b, this.stove(), hw - 0.55, -hd + 3.85, { yaw: -Math.PI / 2 });
    this._put(b, this.fridge(), hw - 0.55, -hd + 4.9, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    // dining set, west of the partition-gap corridor
    const tx = -hw * 0.25, tz = hd * 0.3;
    if (this._put(b, this.table(1.5, 0.95), tx, tz)) {
      this._put(b, this.chair(), tx - 1.1, tz, { yaw: Math.PI / 2 });
      this._put(b, this.tippedChair(), tx + 1.15, tz + 0.3);
      this._meal(b, tx - 0.3, tz);
      this._meal(b, tx + 0.35, tz - 0.15);
    }
    this._put(b, this.shelf(1.5), -hw + 0.5, 0.6, { yaw: Math.PI / 2 });
    this._put(b, this.sofa(), -hw + 1.2, hd - 1.1, { yaw: Math.PI });
    this._papers(b, tx + 0.8, tz + 1.0, 3);
    if ((b.spec.derelict ?? 0) > 0.45) this._stain(b, 0.4, -hd + 2.2, 1.4);
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
    this._stain(b, 1.8, hd - 1.5, 1.6);
    this._papers(b, -0.5, hd - 2.5, 2);
  }

  _store(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    this._put(b, this.counter(2.2), hw - 1.6, hd - 1.9, { yaw: Math.PI, loot: [0, -0.9] });
    const rows = Math.min(3, Math.max(1, Math.floor((c.cd - 4.5) / 2.2)));
    for (let r = 0; r < rows; r++) {
      const z = -hd + 1.6 + r * 2.2;
      this._put(b, this.shelf(Math.min(3.2, c.cw - 3.5)), -0.6, z, { loot: r === 0 ? [0, 0.9] : false });
    }
    this._put(b, this.rack(2.2), -hw + 0.6, -0.5, { yaw: -Math.PI / 2 });
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
    this._put(b, this.stove(), -hw + 0.6, -hd + 0.9, { yaw: Math.PI / 2 });
    this._put(b, this.fridge(), -hw + 0.6, -hd + 1.9, { yaw: Math.PI / 2 });
    this._stain(b, 1.6, 0.2, 1.3);
    this._papers(b, 0.5, 0.8, 2);
  }

  _office(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    for (const [ox, oz] of [[-hw + 1.6, -hd + 1.4], [-hw + 1.6, 0.6], [1.0, -hd + 1.4], [1.0, 0.6]]) {
      this._put(b, this.desk(), ox, oz);
      this._put(b, this.chair(), ox, oz - 0.9, { yaw: 0 });
    }
    this._put(b, this.cabinet(), hw - 0.55, -hd + 0.7, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.cabinet(), hw - 0.55, -hd + 1.9, { yaw: -Math.PI / 2 });
    this._put(b, this.tippedChair(), 1.8, 1.6);
    this._papers(b, 0, 0.2, 6);
  }

  _apartment(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // Perfectly tidy. (Except the chair on the ceiling — secret #6 keeps its
    // corner clear at canonical (-1, -1.5).)
    this._put(b, this.sofa(), -hw + 1.3, hd - 1.2, { yaw: Math.PI });
    this._put(b, this.table(1.1, 0.8), -hw + 1.4, hd - 2.6);
    this._put(b, this.bed(), hw - 0.8, -hd + 1.3);
    this._put(b, this.cabinet(), hw - 0.55, -hd + 2.9, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    this._put(b, this.shelf(1.4), -hw + 0.5, -hd + 1.2, { yaw: Math.PI / 2 });
    this._put(b, this.fridge(), -hw + 0.55, 0.4, { yaw: Math.PI / 2 });
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

  _arcade(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    const cols = [0x5e2430, 0x39465e, 0x2e4433, 0x6b4a1e];
    for (let i = 0; i < 4; i++) this._put(b, this.arcadeCab(cols[i]), -hw + 1.0 + i * 1.1, -hd + 0.8);
    for (let i = 0; i < 3; i++) this._put(b, this.arcadeCab(cols[(i + 2) % 4]), -hw + 1.2 + i * 1.1, 0.5, { yaw: Math.PI });
    this._put(b, this.counter(1.8), hw - 1.5, hd - 2.0, { yaw: Math.PI, loot: [0, -0.9] });
    this._stain(b, -1.0, 1.8, 1.2);
  }

  _boutique(b) {
    const c = this._canon(b.spec);
    const hw = c.cw / 2, hd = c.cd / 2;
    // The display window by the door belongs to the mannequin. Leave it be.
    this._put(b, this.counter(2.0), hw - 1.5, 0.4, { yaw: -Math.PI / 2, loot: [-0.9, 0] });
    for (const [ox, oz] of [[-1.6, -hd + 1.3], [0.4, -hd + 1.3], [-2.6, 0.6]]) this._put(b, this.displayStand(), ox, oz);
    this._put(b, this.shelf(2.4, false), 1.8, -hd + 0.55);
    this._put(b, this.tippedChair(), -0.8, 1.8);
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
    this._put(b, this.tippedChair(), 2.4, 1.0);
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
    for (const [ox, oz] of [[2.5, -1.5], [3.1, -0.6], [2.2, 3.8]]) this._put(b, this.P.barrel(), ox, oz);
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
    for (const [ox, oz] of [[-5.5, 3.0], [5.8, -2.8]]) this._put(b, this.P.barrel(), ox, oz);
    this._spawnAt(b, -2.0, -1.0); // things nest among the crates
    this._stainOil(b, 0.5, 2.0, 1.6);
  }

  /** Warehouse B: crate floor plus a raised mezzanine deck with stairs —
   *  vertical combat and top-shelf loot. */
  _warehouseMezz(b) {
    const s = b.spec;
    const c = this._canon(s);
    const hw = c.cw / 2, hd = c.cd / 2;
    const deckY = s.y + 3.1;

    // deck across the far end of the hall
    const deck = this._rectWorld(b, -hw + 0.6, -hd + 0.5, hw - 0.7, -hd + 5.3);
    const slab = this.kit.box(deck.maxX - deck.minX, 0.22, deck.maxZ - deck.minZ, 'floorWood');
    slab.position.set((deck.minX + deck.maxX) / 2, deckY, (deck.minZ + deck.maxZ) / 2);
    this._bucket.add(slab);
    this.w.collision.addBox(deck.minX, deckY - 0.11, deck.minZ, deck.maxX, deckY + 0.11, deck.maxZ, 'wall');
    this.w.terrain.addPlatform(deck.minX, deck.maxX, deck.minZ, deck.maxZ, deckY + 0.11);

    // support posts under the open edge
    const frontZ = Math.abs(deck.minZ - s.z) < Math.abs(deck.maxZ - s.z) ? deck.minZ : deck.maxZ;
    const postZ = frontZ + (frontZ === deck.minZ ? 0.25 : -0.25);
    for (const t of [0.15, 0.5, 0.85]) {
      const px = deck.minX + (deck.maxX - deck.minX) * t;
      const post = this.kit.box(0.28, 3.1, 0.28, 'wallWood');
      post.position.set(px, s.y + 1.55, postZ);
      this._bucket.add(post);
      this.w.collision.addBoxCentered(px, s.y + 1.55, postZ, 0.16, 1.55, 0.16, 'furniture');
    }

    // stair ramp up the east side, arriving at the deck edge
    const ramp = this._rectWorld(b, hw - 3.0, -hd + 5.3, hw - 0.8, -hd + 10.3);
    const rcx = (ramp.minX + ramp.maxX) / 2, rcz = (ramp.minZ + ramp.maxZ) / 2;
    const top = this._pt(b, hw - 1.9, -hd + 5.4);
    const alongX = (ramp.maxX - ramp.minX) > (ramp.maxZ - ramp.minZ);
    const rhx = (ramp.maxX - ramp.minX) / 2, rhz = (ramp.maxZ - ramp.minZ) / 2;
    let y0 = s.y, y1 = deckY + 0.11;
    if (alongX ? top.x < rcx : top.z < rcz) [y0, y1] = [y1, y0];
    this.w.terrain.addRamp(rcx, rcz, rhx, rhz, alongX ? 'x' : 'z', y0, y1);
    // visual steps under the ramp line
    const halfLen = alongX ? rhx : rhz;
    const dirX = alongX ? Math.sign(top.x - rcx) : 0;
    const dirZ = alongX ? 0 : Math.sign(top.z - rcz);
    for (let i = 0; i < 7; i++) {
      const t = ((i + 0.5) / 7) * 2 - 1; // -1 = low end, +1 = deck end
      const stepLen = (halfLen * 2) / 7 + 0.06;
      const step = this.kit.box(alongX ? stepLen : rhx * 2 - 0.1, 0.14, alongX ? rhz * 2 - 0.1 : stepLen, 'wallWood');
      step.position.set(rcx + dirX * t * (halfLen - stepLen / 2),
        s.y + (deckY + 0.11 - s.y) * ((t * (halfLen - stepLen / 2) / halfLen + 1) / 2) - 0.06,
        rcz + dirZ * t * (halfLen - stepLen / 2));
      this._bucket.add(step);
    }

    // railing along the open edge, leaving the stair bay clear
    const railRect = this._rectWorld(b, -hw + 0.7, -hd + 5.2, hw - 3.2, -hd + 5.4);
    const rail = this.kit.box(Math.max(railRect.maxX - railRect.minX, 0.08), 0.12, Math.max(railRect.maxZ - railRect.minZ, 0.08), 'metalRust');
    rail.position.set((railRect.minX + railRect.maxX) / 2, deckY + 1.0, (railRect.minZ + railRect.maxZ) / 2);
    this._bucket.add(rail);
    this.w.collision.addBox(railRect.minX - 0.05, deckY + 0.1, railRect.minZ - 0.05, railRect.maxX + 0.05, deckY + 1.1, railRect.maxZ + 0.05, 'wall');

    // top-shelf loot + crates on the deck; more cover below
    this._put(b, this.P.crateStack(2), -hw + 2.0, -hd + 2.0, { yaw: 0.3, lift: 3.2, loot: [1.2, 0] });
    this._put(b, this.P.crateStack(2), 1.0, -hd + 3.4, { yaw: 1.1, lift: 3.2 });
    this._put(b, this.rack(3.0), -2.5, -hd + 1.1, { lift: 3.2, loot: [0, 1.0] });
    for (const [ox, oz, n] of [[-4.0, 1.0, 3], [0.5, 0.0, 2], [4.5, 2.0, 4], [-1.5, 3.8, 2]]) {
      this._put(b, this.P.crateStack(n), ox, oz, { yaw: (ox + oz) % 1.5, loot: n >= 4 ? [1.2, 0] : false });
    }
    for (const [ox, oz] of [[5.8, -1.0], [-5.2, 4.4]]) this._put(b, this.P.barrel(), ox, oz);
    this._spawnAt(b, 2.5, 1.5);
    this._stainOil(b, -1.0, 2.5, 1.8);
  }
}
