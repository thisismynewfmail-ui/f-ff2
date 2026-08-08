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
 * back, a plank counter across the front, side hoardings, a hanging trade sign
 * and a lamp over the counter. You walk up to it and the vendor is right
 * there, lit, at chest height, with the road behind you.
 *
 * The build is one merged group of static geometry plus a handful of colliders
 * (the posts, the counter, the back wall) — no interior, no doors, nothing to
 * furnish. The shopkeeper itself is placed by World, at `counterSpot()`.
 */

// The site. Chosen against the district plan: north verge of Main St East,
// between the filling station at the gate (55, 12) and the first house on the
// street (house01 at 84, -11), clear of shed01 (79, -20) by a good ten metres.
export const TRADING_POST = { x: 62, z: -19, yaw: Math.PI * 0.94 };
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
   * Where the vendor's cabinet stands: centred, just inside the counter, so
   * from the customer's side of the plank you see the machine's head and
   * shoulders over the top of it and nothing else — which is the whole read of
   * a shopkeeper behind a counter.
   */
  counterSpot() {
    const { x, z, yaw } = this.site;
    const fwd = 0.25;                        // metres toward the counter line
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

    // --- the counter across the open front: a plank top on a boarded skirt
    put(box(W + 0.2, 0.09, 0.46, mat.post), 0, 1.02, hd - 0.18);
    put(box(W, 0.86, 0.10, mat.plank), 0, 0.55, hd - 0.05);
    put(box(W + 0.24, 0.05, 0.06, mat.brass), 0, 1.09, hd + 0.03);   // the brass nosing

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

    // --- the lamp over the counter. It is the only light on this stretch of
    // road, which is most of why the site reads as somewhere to walk toward.
    put(box(0.05, 0.28, 0.05, mat.metal), 0, H_FRONT - 0.32, hd - 0.55);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.16, 10, 1, true), mat.metal);
    shade.position.set(0, H_FRONT - 0.5, hd - 0.55);
    g.add(shade);
    // The bulb's material is kept rather than its mesh: mergeStatic below
    // collapses the whole group and clears the originals, but a merged mesh
    // still draws with the same material object, so animating it still works.
    this.bulbMat = new THREE.MeshLambertMaterial({ color: 0xffe6b0, emissive: 0x9a6a1c });
    put(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.bulbMat), 0, H_FRONT - 0.58, hd - 0.55);

    // --- what a trader accumulates: stacked crates, a barrel, a tarp bundle
    // under the counter, and a strongbox nobody has opened in a long time
    put(box(0.62, 0.5, 0.55, P.mat('crate')), -hw + 0.55, 0.35, -hd + 0.55);
    put(box(0.5, 0.42, 0.46, P.mat('crate')), -hw + 0.5, 0.81, -hd + 0.6).rotation.y = 0.4;
    put(box(0.44, 0.36, 0.42, mat.tarp), hw - 0.5, 0.28, -hd + 0.5);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.72, 12), mat.metal);
    barrel.position.set(hw - 0.55, 0.46, -hd + 1.25);
    g.add(barrel);
    put(box(0.34, 0.24, 0.26, mat.brass), 0.9, 1.19, hd - 0.2);       // the till on the counter

    // Collapse the lot to one mesh per material, THEN hang the light on it:
    // mergeStatic clears the group as it goes, and a light is not geometry.
    mergeStatic(g);
    this.lamp = new THREE.PointLight(0xffd08a, 2.6, 7.5, 2);
    this.lamp.position.set(0, H_FRONT - 0.62, hd - 0.55);
    g.add(this.lamp);
    P.place(g, x, z, { yaw });
    w.group.add(g);
    this.group = g;

    // --- collision. ONE box over the whole body of the kiosk, not one per
    // panel. The panels are a few centimetres apart and sit at a slight angle
    // to the world axes, so modelling them as separate axis-aligned boxes
    // means inflating each to its rotated extent — and inflated boxes that
    // close a rectangle necessarily overlap each other, which is a real defect
    // (tests/world.mjs checks exactly that) dressed up as detail nobody can
    // feel. What the player experiences is a counter they walk UP to, so what
    // the collision says is: this footprint is solid, stand outside it.
    const ex = Math.abs((W / 2 + 0.1) * Math.cos(yaw)) + Math.abs((D / 2) * Math.sin(yaw));
    const ez = Math.abs((W / 2 + 0.1) * Math.sin(yaw)) + Math.abs((D / 2) * Math.cos(yaw));
    this.colliderId = w.collision.addBoxCentered(x, y + 1.0, z, ex, 1.0, ez, 'prop');
    // Nav: block the footprint so the horde routes AROUND the kiosk rather
    // than trying to walk through the counter to reach something behind it.
    w.nav.blockBox(x - ex - 0.4, z - ez - 0.4, x + ex + 0.4, z + ez + 0.4);
    // ...and tell the prop system this ground is taken, so nothing else is
    // placed inside the structure later.
    w._solids.push({ minX: x - ex - 0.3, maxX: x + ex + 0.3, minZ: z - ez - 0.3, maxZ: z + ez + 0.3 });
    this.footprint = { x, z, hx: ex, hz: ez };
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
