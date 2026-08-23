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
 * walk INTO would hide the machine that is the point of the detour. It is a
 * COUNTY HIGHWAY PULL-OFF: the bolted steel shelter a road crew puts up over
 * a piece of plant, on a poured concrete pad, at the side of the road they
 * are working on. Four galvanised stanchions on base plates, cross-braced,
 * carrying purlins and a corrugated deck pitched to the back. Nothing is
 * clad. You can see every joint in it, and through it to the trees.
 *
 * It was a timber lean-to first, and timber was the wrong material for this
 * town: Eastgate is poured kerbs, chain-link, filling-station canopies and a
 * water tower. A shingled frontier stall in the middle of that reads as set
 * dressing from a different game. Steel angle over concrete reads as
 * something the county left behind, which is exactly what a coin-operated
 * machine standing at a roadside ought to be sheltering under.
 *
 * THE FRONT IS OPEN TO THE GROUND, and that is the point. There was a boarded
 * counter across it at first, and it did exactly what a counter does: it hid
 * the machine from the waist down, so the thing you had walked across the
 * district to look at was a head and a hat over a plank. What keeps you OUT
 * now is what keeps you out of any working site — the plant is in the way.
 * Jersey barriers and a pallet stack in the front corners, a bottle rack, a
 * cable drum, a utility cabinet, a hazard drum, banded cones and a folded barricade
 * down the flanks: a clear lane down the middle to the machine and nowhere at
 * all to stand beside it.
 *
 * The build is one merged group of static geometry plus a few colliders (the
 * plant at either side, the back of the bay) — no interior, no doors, nothing
 * to furnish. The shopkeeper is placed by World at `counterSpot()`.
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
const D = 2.4;              // depth, front stanchion to back frame
const H_FRONT = 2.5;        // eaves at the open front
const H_BACK = 2.15;        // ...and at the back, so the deck sheds off the rear
const POST = 0.14;          // square-section stanchion
const DECK_H = 0.12;        // the concrete pad: a step up off the grass

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
      // ...and standing ON the concrete pad, not sunk a hand's width into it.
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
      steel: P.mat('metalRust'),
      pad: P.mat('concrete'),
      pallet: P.mat('pallet'),
      hazard: P.mat('barrelHazard'),
      barricade: P.mat('barricade'),
      brass: P.mat('vendorBrass'),
      sign: P.mat('signTokens'),
      tarp: P.mat('tarpBlue'),
      galv: P.colorMat(0x8e9298),      // galvanised: stanchions, base plates
      cabinet: P.colorMat(0x5d6a5e),   // the county's own paint
      cone: P.colorMat(0xc4531f),
      coneBand: P.colorMat(0xd8d4c6),
      cable: P.colorMat(0x24242a),
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

    // --- the pad: a poured slab a step up off the grass, with the kerb the
    // county always casts along the road edge of one
    put(box(W + 0.4, DECK_H, D + 0.4, mat.pad), 0, DECK_H / 2, 0);
    put(box(W + 0.4, 0.07, 0.10, mat.pad), 0, DECK_H + 0.02, (D + 0.4) / 2 - 0.05);
    // ...and what has been dripping on it since the crew left. depthWrite off
    // and a render order, the same way every other decal in the town is laid
    // down, so it never fights the slab it is painted on.
    const stain = put(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1),
      new THREE.MeshLambertMaterial({ map: P.texLib?.get('oilStain'), transparent: true, depthWrite: false })),
      0.5, DECK_H + 0.008, -0.35);
    stain.rotation.x = -Math.PI / 2;
    stain.renderOrder = 2;

    // --- four stanchions on bolted base plates, front pair taller so the
    // deck falls to the back. Square section, galvanised, nothing over them.
    const hw = W / 2, hd = D / 2;
    const stanchion = (sx, sz, h) => {
      put(box(0.26, 0.035, 0.26, mat.galv), sx * hw, DECK_H + 0.018, sz * hd);
      put(box(POST, h, POST, mat.galv), sx * hw, h / 2 + DECK_H, sz * hd);
      // a gusset in the inside face of each foot, the way a fabricated
      // stanchion is actually stiffened
      put(box(0.02, 0.22, 0.22, mat.galv), sx * (hw - 0.08), DECK_H + 0.13, sz * hd);
    };
    for (const sx of [-1, 1]) {
      stanchion(sx, 1, H_FRONT);
      stanchion(sx, -1, H_BACK);
    }

    /* --- the frame, left bare.
     *
     * Diagonal bracing down both flanks and across the back, plus three
     * purlins under the deck. This is the whole reason the shelter changed
     * material: a braced steel bay tells you at a glance how it stands up,
     * and a boarded timber one tells you nothing at all.
     */
    const brace = (x1, y1, z1, x2, y2, z2, t = 0.055) => {
      const len = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
      const b = box(t, len, t, mat.steel);
      b.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      // aim its local +Y down the run
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1).normalize());
      g.add(b);
      return b;
    };
    const yF = DECK_H + H_FRONT, yB = DECK_H + H_BACK;
    for (const sx of [-1, 1]) {
      brace(sx * hw, yF - 0.10, hd, sx * hw, DECK_H + 0.55, -hd);      // flank, front-top to back-low
      brace(sx * hw, DECK_H + 0.55, hd, sx * hw, yB - 0.10, -hd);      // ...and its opposite
      brace(sx * hw, yF - 0.55, hd - 0.02, sx * (hw - 0.5), yF - 0.06, hd - 0.02, 0.05); // knee brace at the eaves
    }
    brace(-hw, yB - 0.10, -hd, hw, DECK_H + 0.6, -hd);                 // the back bay, crossed
    brace(hw, yB - 0.10, -hd, -hw, DECK_H + 0.6, -hd);
    // head rails, front and back, tying the stanchions together
    put(box(W + POST, 0.10, 0.09, mat.steel), 0, yF - 0.05, hd);
    put(box(W + POST, 0.10, 0.09, mat.steel), 0, yB - 0.05, -hd);
    // purlins: three round tubes across the slope, on show under the deck
    const rise = H_FRONT - H_BACK;
    const slope = Math.atan2(rise, D);
    for (const f of [-0.34, 0, 0.34]) {
      const pz = f * D;
      const py = (yF + yB) / 2 - f * rise + 0.05;
      const pur = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, W + 0.8, 8), mat.steel);
      pur.rotation.z = Math.PI / 2;
      pur.position.set(0, py, pz);
      g.add(pur);
    }

    // --- the deck: one corrugated sheet slope, front eaves down to the back
    const deck = box(W + 0.9, 0.07, Math.hypot(D, rise) + 0.7, mat.steel);
    deck.position.set(0, (yF + yB) / 2 + 0.12, 0);
    deck.rotation.x = -slope;
    g.add(deck);
    // a folded channel across the front eaves, and the sign hung under it
    put(box(W + 0.9, 0.16, 0.08, mat.galv), 0, yF + 0.14, hd + 0.34);
    const sign = put(board(1.5, 0.62, 0.05, mat.sign), 0, yF - 0.30, hd + 0.36);
    sign.rotation.z = 0.04;                                          // hung slightly off true
    for (const sx of [-1, 1]) {                                      // its two chains
      put(box(0.025, 0.22, 0.025, mat.steel), sx * 0.6, yF, hd + 0.36);
    }

    // --- chain-link across the back bay and the upper flanks. It closes the
    // shelter without cladding it: you can see the trees through the back of
    // the pitch, which is what stops a bare frame reading as a solid shed.
    if (w.texLib) {
      const mesh = (len, h) => new THREE.Mesh(new THREE.PlaneGeometry(len, h),
        new THREE.MeshLambertMaterial({
          map: w.texLib.tiled('chainlink', Math.max(1, Math.round(len / 1.5)), Math.max(1, Math.round(h / 1.5))),
          alphaTest: 0.4, side: THREE.DoubleSide,
        }));
      const back = mesh(W, H_BACK - 0.35);
      back.position.set(0, DECK_H + (H_BACK - 0.35) / 2, -hd + 0.02);
      g.add(back);
      for (const sx of [-1, 1]) {
        const side = mesh(D, 0.95);
        side.rotation.y = Math.PI / 2;
        side.position.set(sx * (hw - 0.02), yB - 0.60, 0);
        g.add(side);
      }
    }

    // --- the work light over the bay. It is the only light on this stretch of
    // road, which is most of why the site reads as somewhere to walk toward.
    // A caged lamp on a conduit drop, not a shop lantern.
    put(box(0.04, 0.30, 0.04, mat.steel), 0, yF - 0.34, hd - 0.7);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.14, 10, 1, true), mat.galv);
    shade.position.set(0, yF - 0.52, hd - 0.7);
    g.add(shade);
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 5, 12), mat.steel);
    cage.rotation.x = Math.PI / 2;
    cage.position.set(0, yF - 0.63, hd - 0.7);
    g.add(cage);
    // the conduit run: along a purlin and down the near stanchion
    put(box(0.035, 0.035, 0.72, mat.steel), 0, yF - 0.20, hd - 0.36);
    put(box(0.035, 1.5, 0.035, mat.steel), -hw + 0.09, yF - 0.95, hd - 0.02);
    // The bulb's material is kept rather than its mesh: mergeStatic below
    // collapses the whole group and clears the originals, but a merged mesh
    // still draws with the same material object, so animating it still works.
    this.bulbMat = new THREE.MeshLambertMaterial({ color: 0xffe6b0, emissive: 0x9a6a1c });
    put(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.bulbMat), 0, yF - 0.70, hd - 0.7);

    /* --- THE PLANT, which is also the wall.
     *
     * Everything below is roadside kit, stacked in the two front corners and
     * up the flanks, head-high at the outside and stepping down toward the
     * middle, so the bay is visibly occupied and the only way in is the lane
     * the machine stands in. It replaces the counter that used to run across
     * the front: a bay you cannot walk into because there is plant in it reads
     * better than one you cannot walk into because there is a plank in the
     * way, and — the reason it was worth changing — it leaves the whole vendor
     * visible from the boots up.
     *
     * It also replaces the crates and grain sacks that stood here when this
     * was a timber stall. Barrels and churns belong to a different century
     * from the town they were standing in.
     */
    const PAD = DECK_H;

    /**
     * A jersey barrier: the tapered concrete block every closed lane has.
     *
     * The three courses are named rather than laid out by eye, because the
     * height of the thing is not private: cones are left standing ON these,
     * and a cone placed off a guessed number is a cone hanging in the air.
     * JERSEY_H is that number, and it comes from the block itself.
     */
    const J_FOOT = 0.20, J_MID = 0.22, J_TOP = 0.40;
    const JERSEY_H = J_FOOT + J_MID + J_TOP;     // 0.82 — the surface to stand on
    const J_TOP_W = 0.22;                        // ...and how wide that surface is
    const jersey = (px, pz, len, rot) => {
      const j = new THREE.Group();
      const foot = box(len, J_FOOT, 0.56, mat.pad); foot.position.y = J_FOOT / 2; j.add(foot);
      const mid = box(len, J_MID, 0.36, mat.pad); mid.position.y = J_FOOT + J_MID / 2; j.add(mid);
      const top = box(len, J_TOP, J_TOP_W, mat.pad); top.position.y = JERSEY_H - J_TOP / 2; j.add(top);
      j.position.set(px, PAD, pz);
      j.rotation.y = rot;
      g.add(j);
      return j;
    };

    /** A stack of pallets, each one a deck on three bearers. */
    const pallets = (px, pz, n, rot) => {
      for (let i = 0; i < n; i++) {
        const y = PAD + i * 0.145;
        const deckP = put(box(1.15, 0.055, 0.95, mat.pallet), px + (i % 2 ? 0.03 : -0.02), y + 0.118, pz + (i % 2 ? -0.02 : 0.03));
        deckP.rotation.y = rot + i * 0.05;
        for (const bz of [-0.38, 0, 0.38]) {
          const bear = put(box(1.15, 0.09, 0.10, mat.pallet), px, y + 0.045, pz + bz);
          bear.rotation.y = rot + i * 0.05;
        }
      }
      return PAD + n * 0.145;
    };

    /**
     * A traffic cone, banded.
     *
     * The bands used to be separate cylinders parked over a solid cone, and a
     * cylinder is a tube: because its radius could only match the taper at one
     * height, each band stood proud of the cone above and sank into it below —
     * a white doughnut threaded onto an orange spike. A real cone's bands are
     * PAINT, flush with the surface, so this one is built the way a moulded
     * cone actually is: one continuous taper cut into five frusta, each with
     * the exact radii the profile has at its own two heights, coloured orange
     * or white. There is nothing to stand proud of and nothing to z-fight,
     * because the bands ARE the cone.
     */
    const cone = (px, py, pz, s = 1) => {
      const H = 0.52 * s, R = 0.16 * s;
      const r = (t) => R * (1 - t * 0.96);        // profile radius at height t*H
      // [from, to, white?] — a wide lower band and a narrower upper one, the
      // proportions a moulded highway cone is actually striped in.
      const BANDS = [[0, 0.34, 0], [0.34, 0.50, 1], [0.50, 0.64, 0], [0.64, 0.74, 1]];
      let top = null;
      for (const [a, b, white] of BANDS) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(r(b), r(a), (b - a) * H, 8, 1, true),
          white ? mat.coneBand : mat.cone);
        seg.position.set(px, py + (a + b) / 2 * H, pz);
        g.add(seg);
        top = b;
      }
      // the moulded nose above the top band, closing the taper to a point
      const tip = new THREE.Mesh(new THREE.ConeGeometry(r(top), (1 - top) * H, 8), mat.cone);
      tip.position.set(px, py + (top + 1) / 2 * H, pz);
      g.add(tip);
      // the square foot it is moulded onto, with the chamfer the real ones have
      const base = put(box(0.34 * s, 0.03 * s, 0.34 * s, mat.cone), px, py + 0.015 * s, pz);
      base.rotation.y = 0.3;
      put(new THREE.Mesh(new THREE.CylinderGeometry(r(0), R * 1.28, 0.05 * s, 8), mat.cone),
        px, py + 0.055 * s, pz);
      return tip;
    };

    // --- the two front corners: barriers on the road side, plant behind them
    jersey(-hw + 0.44, hd - 0.55, 1.5, Math.PI / 2);
    jersey(hw - 0.44, hd - 0.58, 1.5, Math.PI / 2 + 0.03);
    // One left on top of each — STANDING on the block, not hovering over it,
    // and small enough that its foot is on the 0.22 top course rather than
    // hanging off both sides of it.
    cone(-hw + 0.45, PAD + JERSEY_H, hd - 0.55, 0.62);
    cone(hw - 0.43, PAD + JERSEY_H, hd - 0.62, 0.58);

    // --- left flank: a pallet stack with a cable drum leaning off it
    pallets(-hw + 0.52, hd - 1.55, 4, 0.06);
    const drum = new THREE.Group();
    for (const dz of [-0.13, 0.13]) {                    // two flanges and a hub
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.045, 14), mat.pallet);
      disc.rotation.x = Math.PI / 2; disc.position.z = dz; drum.add(disc);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.24, 12), mat.cable);
    hub.rotation.x = Math.PI / 2; drum.add(hub);
    drum.position.set(-hw + 0.48, PAD + 0.36, -hd + 0.62);
    drum.rotation.y = 0.35;
    g.add(drum);

    // --- right flank: the county's utility cabinet and a bottle rack
    const cab = put(box(0.72, 1.05, 0.46, mat.cabinet), hw - 0.46, PAD + 0.525, hd - 1.62);
    cab.rotation.y = -0.05;
    put(box(0.02, 0.95, 0.02, mat.galv), hw - 0.80, PAD + 0.53, hd - 1.62);   // its hinge stile
    put(box(0.09, 0.05, 0.03, mat.galv), hw - 0.14, PAD + 0.60, hd - 1.40);   // and the hasp
    put(box(0.78, 0.05, 0.52, mat.galv), hw - 0.46, PAD + 1.07, hd - 1.62).rotation.y = -0.05; // rain lip
    for (let i = 0; i < 3; i++) {                        // gas bottles in a frame
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.76, 10), mat.steel);
      b.position.set(hw - 0.62 + i * 0.24, PAD + 0.38, -hd + 0.52);
      g.add(b);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.10, 8), mat.galv);
      cap.position.set(hw - 0.62 + i * 0.24, PAD + 0.81, -hd + 0.52);
      g.add(cap);
    }
    put(box(0.80, 0.05, 0.05, mat.steel), hw - 0.38, PAD + 0.55, -hd + 0.40);  // the rack rail
    put(box(0.05, 0.95, 0.05, mat.steel), hw - 0.76, PAD + 0.48, -hd + 0.40);
    put(box(0.05, 0.95, 0.05, mat.steel), hw - 0.02, PAD + 0.48, -hd + 0.40);

    // --- the back of the bay: a hazard drum, a folded barricade, a sign panel
    const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.88, 12), mat.hazard);
    haz.position.set(-hw + 1.25, PAD + 0.44, -hd + 0.40);
    g.add(haz);
    put(box(0.60, 0.03, 0.60, mat.galv), -hw + 1.25, PAD + 0.885, -hd + 0.40);  // a board over it
    const barr = put(box(1.5, 0.60, 0.09, mat.barricade), 0.35, PAD + 0.42, -hd + 0.20);
    barr.rotation.set(-0.22, 0.04, 0);                                          // leaning on the frame
    // a road-sign panel nobody put back up, face-in against the chain-link
    const panel = put(board(0.66, 0.66, 0.04, mat.galv), -0.55, PAD + 0.50, -hd + 0.24);
    panel.rotation.set(-0.18, 0.12, 0.4);
    // a coil of cable and a toolbox, on the floor where they were dropped
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.065, 6, 14), mat.cable);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(-hw + 0.95, PAD + 0.065, hd - 0.35);
    g.add(coil);
    put(box(0.44, 0.20, 0.24, mat.cabinet), hw - 1.05, PAD + 0.10, -hd + 0.35).rotation.y = 0.24;
    // and a tarp over whatever the crew did not want rained on
    put(box(0.78, 0.42, 0.62, mat.tarp), -hw + 0.52, PAD + 0.79, hd - 1.55).rotation.y = 0.22;
    // the strongbox, on top of the right-hand cabinet where a trader would
    // keep it: in reach, in sight, and not on the floor
    put(box(0.32, 0.20, 0.24, mat.brass), hw - 0.46, PAD + 1.19, hd - 1.62).rotation.y = 0.18;
    // two more cones out on the apron, marking the lane in — held back from
    // the kerb by their own footprint, so no corner of a base plate is left
    // hanging over the edge of the slab
    cone(-1.05, PAD, hd - 0.06, 0.85);
    cone(1.15, PAD, hd - 0.10, 0.85);

    // Collapse the lot to one mesh per material, THEN hang the light on it:
    // mergeStatic clears the group as it goes, and a light is not geometry.
    mergeStatic(g);
    this.lamp = new THREE.PointLight(0xffd08a, 2.6, 7.5, 2);
    this.lamp.position.set(0, DECK_H + H_FRONT - 0.74, hd - 0.55);
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
