import * as THREE from '../../lib/three.module.js';
import { mergeStatic, scaleBoxUVs } from './Buildings.js';

/**
 * THE TRADING POST — the structure the shopkeeper stands in, on the open
 * knoll just inside the Eastgate district gate.
 *
 * WHERE, and why there. A player comes out of the plaza, through the gate on
 * Main St East, and the first thing on their right is a break in the trees
 * with a track worn up to it. That is the whole reason this site was chosen:
 * it is the earliest ground in the run where a vendor can stand — a short walk
 * from where you spawn — without being IN anybody's front garden. Eastgate is
 * planned lot by lot (every house fronts a street, backs face backs), and a
 * shop shed dropped between two houses would break that rule on sight. The
 * knoll north of the road is the district's one piece of unplanned ground, so
 * the post sits in a clearing there the way a roadside stall actually would:
 * off the carriageway, facing the traffic, with its back to the trees.
 *
 * WHAT it is. Not a house — the district has enough of those, and a shop you
 * walk INTO would hide the machine that is the point of the detour. It is an
 * open-fronted timber lean-to: four posts, a shingled shed roof pitched to the
 * back, side hoardings, a hanging trade sign and a lamp over the pitch. You
 * walk up to it and the vendor is right there, lit, with the road behind you.
 *
 * THE FRONT IS OPEN TO THE GROUND, and that is the point. There was a boarded
 * counter across it at first, and it did exactly what a counter does: it hid
 * the machine from the waist down, so the thing you had walked across the
 * district to look at was a head and a hat over a plank. What keeps you OUT
 * now is the same thing that keeps you out of any working stall — it is full.
 * Crates stacked to head height in both front corners, barrels, sacks, a
 * tea-chest, a spare wheel, a churn: a pitch with its stock piled up around
 * the machine, leaving a clear lane down the middle to the vendor and nowhere
 * at all to stand beside it.
 *
 * The build is one merged group of static geometry plus a few colliders (the
 * stacked stock at either side, the back of the pitch) — no interior, no
 * doors, nothing to furnish. The shopkeeper is placed by World at
 * `counterSpot()`.
 */

// The site. Chosen against the district plan: north verge of Main St East,
// between the filling station at the gate (55, 12) and the first house on the
// street (house01 at 84, -11), clear of shed01 (79, -20) by a good ten metres.
//
// The yaw faces the OPEN front at the carriageway — a roadside stall that had
// its back to the road would be a shed. Everything below is built with the
// front at local +Z, and that maps to (sin yaw, cos yaw) ≈ (-0.19, +0.98):
// south, onto Main St East, canted a little west toward the district gate you
// arrive from.
export const TRADING_POST = { x: 62, z: -19, yaw: -Math.PI * 0.06 };
const W = 3.6;              // frontage
const D = 2.4;              // depth, front post to back wall
const H_FRONT = 2.5;        // eaves at the open front
const H_BACK = 2.15;        // ...and at the back, so the roof sheds off the rear
const POST = 0.16;
const DECK_H = 0.12;        // the plank floor: a step up off the grass

export class TradingPost {
  /**
   * @param world the World, for its prop kit, colliders, nav grid and terrain
   */
  constructor(world) {
    this.world = world;
    this.site = TRADING_POST;
  }

  /**
   * Where the vendor's cabinet stands: centred, and well forward in the pitch
   * so the whole machine — cabinet, tray, coin throat and all — is in the open
   * front rather than back in the shadow under the roof.
   */
  counterSpot() {
    const { x, z, yaw } = this.site;
    const fwd = 0.45;                        // metres toward the open front
    return {
      x: x + Math.sin(yaw) * fwd,
      z: z + Math.cos(yaw) * fwd,
      yaw,
      // ...and standing ON the plank deck, not sunk a hand's width into it.
      lift: DECK_H,
    };
  }

  build() {
    const w = this.world;
    const P = w.props;
    const { x, z, yaw } = this.site;
    const y = w.terrain.heightAt(x, z);
    const g = new THREE.Group();

    const mat = {
      post: P.mat('wallWood'),
      plank: P.mat('wallWoodRot'),
      roof: P.mat('roofShakeWood'),
      metal: P.mat('metalRust'),
      brass: P.mat('vendorBrass'),
      sign: P.mat('signTokens'),
      tarp: P.mat('tarpBlue'),
    };
    const box = (bw, bh, bd, m) => {
      const geo = new THREE.BoxGeometry(bw, bh, bd);
      scaleBoxUVs(geo, bw, bh, bd);   // tiling textures repeat by real size
      return new THREE.Mesh(geo, m);
    };
    // ...but a printed board (the sign) wants its whole image once, not a
    // crop of one tile, so it keeps the geometry's own 0..1 UVs.
    const board = (bw, bh, bd, m) => new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    const put = (m, px, py, pz) => { m.position.set(px, py, pz); g.add(m); return m; };

    // --- the floor: a plank deck a step up off the grass, so the post reads
    // as built rather than as furniture left in a field
    put(box(W + 0.3, DECK_H, D + 0.3, mat.plank), 0, DECK_H / 2, 0);

    // --- four posts, front pair taller so the roof falls to the back
    const hw = W / 2, hd = D / 2;
    for (const sx of [-1, 1]) {
      put(box(POST, H_FRONT, POST, mat.post), sx * hw, H_FRONT / 2 + 0.1, hd);
      put(box(POST, H_BACK, POST, mat.post), sx * hw, H_BACK / 2 + 0.1, -hd);
    }

    // --- back wall and side hoardings, boarded to shoulder height
    put(box(W + POST, H_BACK - 0.25, 0.09, mat.plank), 0, (H_BACK - 0.25) / 2 + 0.1, -hd);
    for (const sx of [-1, 1]) {
      put(box(0.08, 1.55, D, mat.plank), sx * hw, 1.55 / 2 + 0.1, 0);
    }

    // --- the roof: one shed slope from the front eaves down to the back
    const rise = H_FRONT - H_BACK;
    const slope = Math.atan2(rise, D);
    const deck = box(W + 0.9, 0.10, Math.hypot(D, rise) + 0.7, mat.roof);
    deck.position.set(0, (H_FRONT + H_BACK) / 2 + 0.2, 0);
    deck.rotation.x = -slope;
    g.add(deck);
    // a fascia board across the front eaves, and the sign hung under it
    put(box(W + 0.9, 0.20, 0.07, mat.post), 0, H_FRONT + 0.16, hd + 0.34);
    const sign = put(board(1.5, 0.62, 0.05, mat.sign), 0, H_FRONT - 0.28, hd + 0.36);
    sign.rotation.z = 0.04;                                          // hung slightly off true
    for (const sx of [-1, 1]) {                                      // its two chains
      put(box(0.025, 0.22, 0.025, mat.metal), sx * 0.6, H_FRONT + 0.02, hd + 0.36);
    }

    // --- the lamp over the pitch. It is the only light on this stretch of
    // road, which is most of why the site reads as somewhere to walk toward.
    put(box(0.05, 0.28, 0.05, mat.metal), 0, H_FRONT - 0.32, hd - 0.7);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.16, 10, 1, true), mat.metal);
    shade.position.set(0, H_FRONT - 0.5, hd - 0.7);
    g.add(shade);
    // The bulb's material is kept rather than its mesh: mergeStatic below
    // collapses the whole group and clears the originals, but a merged mesh
    // still draws with the same material object, so animating it still works.
    this.bulbMat = new THREE.MeshLambertMaterial({ color: 0xffe6b0, emissive: 0x9a6a1c });
    put(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.bulbMat), 0, H_FRONT - 0.58, hd - 0.7);

    /* --- THE STOCK, which is also the wall.
     *
     * Everything below is piled in the two front corners and up the flanks,
     * head-high at the outside and stepping down toward the middle, so the
     * pitch is visibly full and the only way in is the lane the machine
     * stands in. It replaces the counter that used to run across the front:
     * a stall you cannot walk into because it is packed reads better than one
     * you cannot walk into because there is a plank in the way, and — the
     * reason it was worth changing — it leaves the whole vendor visible from
     * the boots up.
     */
    const crate = P.mat('crate');
    const stack = (px, pz, tiers, sizeW, rot = 0) => {
      let py = 0.1;
      for (let i = 0; i < tiers; i++) {
        const s = sizeW * (1 - i * 0.09);
        const h = 0.44 - i * 0.03;
        const c = put(box(s, h, s * 0.92, crate), px + (i % 2 ? 0.04 : -0.03), py + h / 2, pz + (i % 2 ? -0.03 : 0.04));
        c.rotation.y = rot + i * 0.11;
        py += h;
      }
      return py;
    };
    // the two front corners: shoulder-to-head high, and the deepest part of
    // the pile is the bit nearest the road, so the stall reads as loaded
    stack(-hw + 0.42, hd - 0.44, 4, 0.66, 0.2);
    stack(hw - 0.42, hd - 0.46, 4, 0.66, -0.3);
    // ...running back along both flanks, stepping down
    stack(-hw + 0.40, hd - 1.22, 3, 0.60, -0.15);
    stack(hw - 0.40, hd - 1.20, 3, 0.60, 0.25);
    stack(-hw + 0.38, -hd + 0.45, 2, 0.56, 0.35);

    // barrels, sacks and the odd bit of freight nobody unpacked
    const barrel = (px, pz, r, h, m) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), m);
      b.position.set(px, 0.1 + h / 2, pz);
      g.add(b);
      return b;
    };
    barrel(hw - 0.46, -hd + 0.5, 0.26, 0.78, mat.metal);
    barrel(hw - 0.5, -hd + 1.1, 0.22, 0.66, mat.post);
    barrel(-hw + 0.5, hd - 1.85, 0.24, 0.7, mat.metal);
    // a churn on its side, and a spare wheel leaning on the pile
    const churn = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.54, 10), mat.brass);
    churn.rotation.z = Math.PI / 2;
    churn.position.set(-hw + 0.44, 0.1 + 0.19, hd - 1.75);
    g.add(churn);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.075, 6, 14), mat.metal);
    wheel.rotation.set(0.28, 0.3, 0);
    wheel.position.set(hw - 0.34, 0.42, hd - 1.7);
    g.add(wheel);
    // sacks: squat, leaning, stacked two deep against the back boards
    for (const [sx2, sz2, sr] of [[-0.75, -hd + 0.36, 0.2], [-0.42, -hd + 0.33, -0.3], [0.66, -hd + 0.38, 0.5]]) {
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), mat.tarp);
      sack.scale.set(1, 0.86, 0.8);
      sack.rotation.z = sr;
      sack.position.set(sx2, 0.1 + 0.2, sz2);
      g.add(sack);
    }
    // a tarp over whatever is under it, in the back corner
    put(box(0.7, 0.44, 0.6, mat.tarp), -hw + 1.15, 0.32, -hd + 0.42).rotation.y = 0.3;
    // and the strongbox, on top of the left-hand front stack where a trader
    // would keep it: in reach, in sight, and not on the floor
    put(box(0.34, 0.22, 0.26, mat.brass), -hw + 0.44, 1.72, hd - 0.44).rotation.y = 0.2;

    // Collapse the lot to one mesh per material, THEN hang the light on it:
    // mergeStatic clears the group as it goes, and a light is not geometry.
    mergeStatic(g);
    this.lamp = new THREE.PointLight(0xffd08a, 2.6, 7.5, 2);
    this.lamp.position.set(0, H_FRONT - 0.62, hd - 0.55);
    g.add(this.lamp);
    P.place(g, x, z, { yaw });
    w.group.add(g);
    this.group = g;

    /* --- collision.
     *
     * Three boxes, one per thing the player can actually feel: the loaded
     * pile down the left flank, the pile down the right, and the back of the
     * pitch. Between the two piles is a lane the width of the machine, and
     * the vendor's own cabinet (registered by ShopKeeper) closes it — so you
     * can step up under the roof and stand at the machine, and you cannot get
     * past it. That is what the geometry now says too, which is the whole
     * point of taking the counter out.
     *
     * Each box is stated in the post's LOCAL frame and swollen to its rotated
     * extent, so they stay axis-aligned like every other collider in the
     * game. They are deliberately kept apart rather than made to meet:
     * inflated boxes that close a rectangle necessarily overlap each other,
     * and an overlap is a real defect the world audit checks for.
     */
    const c = (lx, lz, hx, hz, hy) => {
      const s = Math.sin(yaw), co = Math.cos(yaw);
      const wx = x + lx * co + lz * s;
      const wz = z - lx * s + lz * co;
      const ex = Math.abs(hx * co) + Math.abs(hz * s);
      const ez = Math.abs(hx * s) + Math.abs(hz * co);
      w.collision.addBoxCentered(wx, y + hy, wz, ex, hy, ez, 'prop');
      return { wx, wz, ex, ez };
    };
    const LANE = 0.62;                 // half-width of the clear lane in the middle
    const flankHW = (W / 2 + 0.1 - LANE) / 2;
    const flankAt = LANE + flankHW;
    c(-flankAt, 0.05, flankHW, D / 2 + 0.05, 1.0);   // the left-hand pile
    c(flankAt, 0.05, flankHW, D / 2 + 0.05, 1.0);    // ...and the right
    c(0, -D / 2 + 0.25, LANE, 0.3, 1.0);             // the back of the pitch

    // Nav: block the whole footprint. The horde has no business threading a
    // one-metre lane into a dead end, and a route that ends at the vendor is
    // a route that ends nowhere.
    const nx = Math.abs((W / 2 + 0.4) * Math.cos(yaw)) + Math.abs((D / 2 + 0.4) * Math.sin(yaw));
    const nz = Math.abs((W / 2 + 0.4) * Math.sin(yaw)) + Math.abs((D / 2 + 0.4) * Math.cos(yaw));
    w.nav.blockBox(x - nx, z - nz, x + nx, z + nz);
    // ...and tell the prop system this ground is taken, so nothing else is
    // placed inside the structure later.
    w._solids.push({ minX: x - nx, maxX: x + nx, minZ: z - nz, maxZ: z + nz });
    this.footprint = { x, z, hx: nx, hz: nz };
    return this;
  }

  /** The lamp gutters — it is running off whatever is left in the machine. */
  update(_dt, time) {
    if (!this.lamp) return;
    const flicker = 0.86 + Math.sin(time * 7.3) * 0.05 + Math.sin(time * 19.7) * 0.035;
    this.lamp.intensity = 2.6 * flicker;
    this.bulbMat.emissive.setRGB(0.6 * flicker, 0.42 * flicker, 0.11 * flicker);
  }
}
