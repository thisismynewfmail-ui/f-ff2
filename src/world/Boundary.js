import * as THREE from '../../lib/three.module.js';
import { mergeStatic } from './Buildings.js';

/**
 * The world barrier: a stone rampart that rings the entire map.
 *
 * This is NOT a district wall. The mosque-style zone barriers (see Zones.js)
 * are the doors the world opens as you earn them — they rumble and sink into
 * the ground when their kill threshold lands. This one never moves. It is the
 * edge of the world, and it was here before the town was.
 *
 * So it is deliberately the *opposite* of those walls in every register:
 * where they are white marble, gold and onion domes, this is dark rusticated
 * granite, mossed to the string course, with a battered base, buttresses on
 * the inner face, a crenellated parapet and octagonal bastions at the four
 * corners. Neutral, heavy, older than everything it encloses — the eye reads
 * it as geography rather than as architecture, which is exactly what a map
 * boundary should be.
 *
 * Where a road runs at the wall there is a gatehouse, and every gatehouse is
 * bricked up: the arch is there, the way through is not.
 *
 * Construction is terrain-following (each module is seated on the ground under
 * it, with its base buried deep enough to bridge the slope between modules),
 * merged down to a handful of draw calls, and collided with four long AABBs
 * plus four corner boxes rather than per-module colliders.
 */

/** Distance from the origin to the wall's centre line on each axis. */
export const BARRIER = 251;
const THICK = 2.8;          // wall thickness at the body
const BASE_EXTRA = 1.4;     // the battered plinth stands this much wider
const BODY_H = 12.5;        // top of the wall walk
const PARAPET_H = 1.5;      // merlons above the walk
const FOOT = 7;             // how far the base is buried (bridges slope)
const MODULE = 10;          // run length per module
const MERLON_PITCH = 2.0;

export class WorldBarrier {
  /**
   * @param {object} deps { texLib, collision, nav, terrain, group }
   */
  constructor({ texLib, collision, nav, terrain, group }) {
    this.texLib = texLib;
    this.collision = collision;
    this.nav = nav;
    this.terrain = terrain;
    this.group = group;
    this.mats = new Map();
    this.root = new THREE.Group();
  }

  mat(tex) {
    if (!this.mats.has(tex)) {
      this.mats.set(tex, new THREE.MeshLambertMaterial({ map: this.texLib.get(tex) }));
    }
    return this.mats.get(tex);
  }

  /** Box with world-scaled UVs, matching the rest of the town's texel density. */
  box(w, h, d, tex) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleUVs(geo, w, h, d);
    return new THREE.Mesh(geo, this.mat(tex));
  }

  build() {
    // Four runs, each laid out along +X in local space then rotated into
    // place, so one module builder serves all of them. `outward` is which way
    // the crenellated face looks (the parapet leans outward, buttresses in).
    const B = BARRIER;
    this._run(-B, -B, B, -B, 0);            // north
    this._run(B, B, -B, B, Math.PI);        // south
    this._run(B, -B, B, B, -Math.PI / 2);   // east
    this._run(-B, B, -B, -B, Math.PI / 2);  // west
    for (const [cx, cz] of [[-B, -B], [B, -B], [B, B], [-B, B]]) this._bastion(cx, cz);

    // Sealed gatehouses where a road points at the wall. They are the reason
    // the barrier reads as built rather than extruded — and every one of them
    // is filled in solid.
    this._gatehouse(B, -5, -Math.PI / 2);   // Main St East
    this._gatehouse(0, -B, 0);              // North Ave
    this._gatehouse(0, B, Math.PI);         // Foundry Rd South
    this._gatehouse(-B, 18, Math.PI / 2);   // Park Rd West

    mergeStatic(this.root);
    this.group.add(this.root);
    this._collide();
    return this;
  }

  /* ---------------- geometry ---------------- */

  /** One straight run of rampart between two corner points. */
  _run(x1, z1, x2, z2, yaw) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / MODULE));
    const mlen = len / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const wx = x1 + (x2 - x1) * t, wz = z1 + (z2 - z1) * t;
      const g = new THREE.Group();
      g.position.set(wx, this.terrain.heightAt(wx, wz), wz);
      g.rotation.y = yaw;
      this._module(g, mlen, i);
      this.root.add(g);
    }
  }

  /**
   * A single rampart module in local space: +X along the run, +Z outward.
   * Buried FOOT metres so neighbouring modules on different ground never
   * show daylight under the wall.
   */
  _module(g, len, index) {
    // battered plinth — wider than the body, so the wall reads as leaning back
    const base = this.box(len + 0.04, FOOT + 2.4, THICK + BASE_EXTRA, 'rampart');
    base.position.y = (FOOT + 2.4) / 2 - FOOT;
    g.add(base);
    // chamfer course capping the batter
    const chamfer = this.box(len + 0.04, 0.5, THICK + BASE_EXTRA * 0.45, 'wallStone');
    chamfer.position.y = 2.55;
    g.add(chamfer);
    // main body
    const body = this.box(len + 0.04, BODY_H - 2.4, THICK, 'rampart');
    body.position.y = 2.4 + (BODY_H - 2.4) / 2;
    g.add(body);
    // string course under the walk
    const string = this.box(len + 0.08, 0.4, THICK + 0.5, 'wallStone');
    string.position.y = BODY_H - 0.2;
    g.add(string);
    // wall walk
    const walk = this.box(len + 0.04, 0.3, THICK + 0.3, 'concrete');
    walk.position.y = BODY_H + 0.15;
    g.add(walk);
    // crenellated parapet on the outward face: merlons with embrasures between
    const merlons = Math.max(2, Math.round(len / MERLON_PITCH));
    for (let m = 0; m < merlons; m++) {
      const mx = ((m + 0.5) / merlons - 0.5) * len;
      const merlon = this.box(len / merlons * 0.62, PARAPET_H, 0.75, 'rampart');
      merlon.position.set(mx, BODY_H + 0.3 + PARAPET_H / 2, THICK / 2 - 0.15);
      g.add(merlon);
    }
    // continuous low kerb behind the merlons so there is no gap to see through
    const kerb = this.box(len + 0.04, 0.75, 0.75, 'rampart');
    kerb.position.set(0, BODY_H + 0.68, THICK / 2 - 0.15);
    g.add(kerb);
    // inner-face parapet, waist high — the walk reads as walkable
    const inner = this.box(len + 0.04, 0.9, 0.42, 'rampart');
    inner.position.set(0, BODY_H + 0.75, -THICK / 2 + 0.21);
    g.add(inner);
    // buttress every third module, on the inner face
    if (index % 3 === 1) {
      const bt = this.box(1.7, FOOT + BODY_H - 2.6, 1.9, 'rampart');
      bt.position.set(0, (BODY_H - 2.6) / 2 - FOOT / 2, -THICK / 2 - 0.9);
      g.add(bt);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.5, 4), this.mat('roofSlate'));
      cap.position.set(0, BODY_H - 2.6 + 0.75, -THICK / 2 - 0.9);
      cap.rotation.y = Math.PI / 4;
      g.add(cap);
    }
  }

  /** Octagonal corner bastion: drum, corbel band, crenellations, slate cone. */
  _bastion(cx, cz) {
    const y = this.terrain.heightAt(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, y, cz);
    const R = 6.2, H = BODY_H + 3.2;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 1.3, H + FOOT, 8), this.mat('rampart'));
    drum.position.y = (H + FOOT) / 2 - FOOT;
    g.add(drum);
    const corbel = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.7, R + 0.2, 0.8, 8), this.mat('wallStone'));
    corbel.position.y = H - 0.4;
    g.add(corbel);
    // parapet ring + merlons round the top
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.7, R + 0.7, 0.9, 8), this.mat('rampart'));
    ring.position.y = H + 0.45;
    g.add(ring);
    for (let m = 0; m < 8; m++) {
      const a = (m / 8) * Math.PI * 2 + Math.PI / 8;
      const merlon = this.box(2.2, 1.6, 0.8, 'rampart');
      merlon.position.set(Math.cos(a) * (R + 0.3), H + 1.7, Math.sin(a) * (R + 0.3));
      merlon.rotation.y = -a;
      g.add(merlon);
    }
    const cone = new THREE.Mesh(new THREE.ConeGeometry(R - 0.4, 6.5, 8), this.mat('roofSlate'));
    cone.position.y = H + 4.2;
    g.add(cone);
    // arrow slits, at the height a defender would have used them
    for (let m = 0; m < 8; m++) {
      const a = (m / 8) * Math.PI * 2;
      const slit = this.box(0.3, 2.0, 0.5, 'wallStone');
      slit.position.set(Math.cos(a) * (R - 0.1), H * 0.55, Math.sin(a) * (R - 0.1));
      slit.rotation.y = -a;
      g.add(slit);
    }
    this.root.add(g);
  }

  /**
   * A gatehouse astride the wall where a road runs out to it: twin drum
   * towers, a pointed relieving arch — and the opening beneath it filled
   * solid with later, cruder blockwork. Somebody sealed this from the inside.
   */
  _gatehouse(x, z, yaw) {
    const y = this.terrain.heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const H = BODY_H + 4.5;
    for (const s of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.6, H + FOOT, 8), this.mat('rampart'));
      tower.position.set(s * 6.4, (H + FOOT) / 2 - FOOT, 0);
      g.add(tower);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(3.4, 4.0, 8), this.mat('roofSlate'));
      cap.position.set(s * 6.4, H + 2.0, 0);
      g.add(cap);
    }
    // the arch head, stepped up over the (former) opening
    for (let step = 0; step < 3; step++) {
      const w = 9.4 - step * 2.2;
      const arch = this.box(w, 0.9, THICK + 1.6, 'rampart');
      arch.position.set(0, 7.4 + step * 0.9, 0);
      g.add(arch);
    }
    // the blocking: crude coursed stone filling the whole opening, flush
    const fill = this.box(9.4, 7.6, THICK + 1.2, 'wallStone');
    fill.position.y = 3.8;
    g.add(fill);
    const buried = this.box(9.4, FOOT, THICK + 1.2, 'rampart');
    buried.position.y = -FOOT / 2;
    g.add(buried);
    // machicolation corbels and a parapet over the arch
    for (let i = -3; i <= 3; i++) {
      const corbel = this.box(0.7, 0.7, THICK + 2.2, 'wallStone');
      corbel.position.set(i * 1.35, 10.4, 0);
      g.add(corbel);
    }
    const crown = this.box(11.0, 1.1, THICK + 2.4, 'rampart');
    crown.position.y = 11.3;
    g.add(crown);
    for (let m = 0; m < 5; m++) {
      const merlon = this.box(1.2, 1.5, 0.9, 'rampart');
      merlon.position.set((m - 2) * 2.2, 12.6, (THICK + 2.4) / 2 - 0.45);
      g.add(merlon);
    }
    this.root.add(g);
  }

  /* ---------------- collision + navigation ---------------- */

  /**
   * Four long slabs and four corner blocks, rather than a collider per
   * module: the wall is axis-aligned and unbroken, so this is exact where it
   * matters (the inner face) and far cheaper to test against.
   */
  _collide() {
    const B = BARRIER, half = THICK / 2 + BASE_EXTRA / 2;
    // generous vertical span: below any terrain the wall sits on, above its crown
    const lo = -40, hi = 60;
    const runs = [
      [-B - 8, -B - half, B + 8, -B + half],
      [-B - 8, B - half, B + 8, B + half],
      [-B - half, -B - 8, -B + half, B + 8],
      [B - half, -B - 8, B + half, B + 8],
    ];
    for (const [minX, minZ, maxX, maxZ] of runs) {
      this.collision.addBox(minX, lo, minZ, maxX, hi, maxZ, 'barrier');
      this.nav.blockBox(minX, minZ, maxX, maxZ, true);
    }
    // corner bastions bulge inside the run line
    for (const [cx, cz] of [[-B, -B], [B, -B], [B, B], [-B, B]]) {
      this.collision.addBox(cx - 7, lo, cz - 7, cx + 7, hi, cz + 7, 'barrier');
      this.nav.blockBox(cx - 7, cz - 7, cx + 7, cz + 7, true);
    }
  }
}

/** Scale a BoxGeometry's per-face UVs to world metres (2 m per tile). */
function scaleUVs(geo, w, h, d) {
  const T = 0.5;
  const uv = geo.attributes.uv;
  const scales = [
    [d * T, h * T], [d * T, h * T], [w * T, d * T], [w * T, d * T], [w * T, h * T], [w * T, h * T],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * scales[f][0], uv.getY(i) * scales[f][1]);
    }
  }
  uv.needsUpdate = true;
}
