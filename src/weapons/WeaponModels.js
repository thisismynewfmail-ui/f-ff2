import * as THREE from '../../lib/three.module.js';
import { WeaponMaterials as M } from '../rendering/WeaponMaterials.js';

/**
 * Procedural 3D first-person weapon models, generation three — every model
 * a novel take on its weapon type, steampunk / BioShock mechanical, each
 * with its own signature material family, silhouette and working action:
 *
 *   pistol   — REGENT AUTOLOADER: slim nickel-plated target automatic,
 *              ventilated sight rib, ring hammer, ivory grips, a chamber-
 *              pressure dial. Slide, barrel, hammer and trigger all cycle;
 *              brass ejects on every shot; the magazine visibly drops free.
 *   shotgun  — CRANE COACHGUN: modern over-under double bore that breaks
 *              UPWARD — the barrels crane skyward off a rear top hinge to
 *              reload, twin hulls ejecting over the shoulder, two fresh
 *              shells seating before the action snaps back down. Twin brass
 *              hammers, top latch lever, engraved sideplate, shell gauge.
 *   rifle    — FOUNDRY GUN: blackened-steel steam machine gun, perforated
 *              cooling jacket, a top-mounted pan drum that ratchets round
 *              with every shot (Lewis-gun style, in full view), copper
 *              boiler + feed pipe with a live pressure valve, reciprocating
 *              bolt, casing ejection, swaying canvas sling. Reload swaps
 *              the whole drum overhead.
 *   sniper   — MERIDIAN LONG RIFLE: precision bolt-action observatory
 *              instrument — slim fluted barrel inside a skeleton cage,
 *              brass telescope with glowing reticle, rangefinder drum,
 *              full bolt choreography on every shot (lift, draw, eject,
 *              close), en-bloc clip reload with five seat clicks.
 *   bat      — IRONSHOD SLUGGER: oak club clad in riveted hammered-iron
 *              plates with proud studs, a compression spring collar that
 *              slams on impact, leather wrap and a swinging wrist strap.
 *              Swings alternate forehand/backhand; charged is an overhead
 *              slam.
 *
 * Each factory returns a rig: the THREE.Group, a muzzle anchor, named
 * animatable parts, named `anchors` (ejection ports etc.), an `eject`
 * schedule for the WeaponView brass system, a rest transform, and idle /
 * fire / reload animation hooks. WeaponView drives whole-weapon motion
 * (bob, sway, three-phase recoil, equip/unequip, melee swings); the hooks
 * move internal parts. Idle loops cycle in 2–4 s. reload(f, parts,
 * tactical) receives the quick-tap flag for weapons with a tactical
 * reload. An optional reloadPose(env, f) overrides the whole-weapon
 * reload tilt (the coachgun pulls low so its upward break stays in frame).
 *
 * Alignment convention: every rig is built with its grip at the local
 * origin, muzzle down -Z, and its `rest` transform placing the grip in
 * the same lower-right anchor zone (x 0.14..0.17, y -0.15..-0.11,
 * z -0.48..-0.43). Rest yaw sits in 0.13..0.26 rad so every weapon faces
 * mostly FORWARD (muzzle near the crosshair) while still showing its
 * left flank to the camera.
 */

/* ---------------- build helpers ---------------- */

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
function box(w, h, d, mat, x, y, z) { return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z); }
function cyl(rt, rb, h, mat, seg = 14, x = 0, y = 0, z = 0) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
}
/** Cylinder laid along the Z axis (barrels, tubes). rt = muzzle end. */
function barrel(rt, rb, len, mat, seg = 16, x = 0, y = 0, z = 0) {
  const m = cyl(rt, rb, len, mat, seg, x, y, z);
  m.rotation.x = -Math.PI / 2; // cylinder top (rt) faces -Z
  return m;
}
function tube(r, len, mat, seg = 16, x = 0, y = 0, z = 0) { return barrel(r, r, len, mat, seg, x, y, z); }
function ring(radius, tubeR, mat, seg = 8, tSeg = 18) {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, tubeR, seg, tSeg), mat);
}
function sphere(r, mat, seg = 8) { return new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat); }

/** Record a part's base transform so animation can offset from it. */
function anim(o) { o.userData.baseP = o.position.clone(); o.userData.baseR = o.rotation.clone(); return o; }

const nickel = () => M.get('nickel');
const blackSteel = () => M.get('blackSteel');
const bronze = () => M.get('bronzePatina');
const hammered = () => M.get('hammeredIron');
const ivory = () => M.get('ivory');
const ebony = () => M.get('ebony');
const cherry = () => M.get('cherry');
const brass = () => M.get('brass');
const blued = () => M.get('bluedSteel');
const copper = () => M.get('copper');
const steel = () => M.get('steelBright');
const oak = () => M.get('oak');
const walnut = () => M.get('walnut');
const brassWornMat = () => M.get('brassWorn');
const leather = () => M.get('leather');
const canvasMat = () => M.get('canvas');

/* ================================================================== */
/* PISTOL — nickel target automatic, ivory grips                       */
/* ================================================================== */

function buildPistol() {
  const g = new THREE.Group();

  // slim nickel frame
  g.add(box(0.062, 0.042, 0.27, nickel(), 0, 0, -0.02));
  // long nickel slide with rear ebony insert panel
  const slide = anim(box(0.068, 0.05, 0.34, nickel(), 0, 0.05, -0.05));
  g.add(slide);
  g.add(box(0.07, 0.02, 0.08, ebony(), 0, 0.056, 0.08));
  // slide serrations
  for (let i = 0; i < 6; i++) g.add(box(0.004, 0.046, 0.005, steel(), 0.036, 0.05, 0.05 + i * 0.011));
  // ventilated sight rib: raised rail on four posts over the slide
  const rib = box(0.018, 0.008, 0.3, blued(), 0, 0.085, -0.06);
  g.add(rib);
  for (let i = 0; i < 4; i++) g.add(box(0.01, 0.014, 0.012, blued(), 0, 0.075, 0.05 - i * 0.083));
  g.add(box(0.008, 0.014, 0.008, brass(), 0, 0.096, -0.2)); // brass bead front sight
  g.add(box(0.02, 0.012, 0.008, blued(), 0, 0.094, 0.075)); // notch rear sight
  // tilting match barrel with nickel bushing
  const bbl = anim(tube(0.017, 0.12, blued(), 14, 0, 0.05, -0.26));
  g.add(bbl);
  g.add(tube(0.023, 0.024, nickel(), 14, 0, 0.05, -0.305));
  // ring hammer (annular — the signature rear detail)
  const hammer = anim(ring(0.018, 0.006, steel(), 6, 14));
  hammer.position.set(0, 0.06, 0.125);
  g.add(hammer);
  // oval trigger guard (the blade trigger itself is added below, animated)
  const guard = ring(0.03, 0.005, nickel(), 6, 16);
  guard.rotation.x = Math.PI / 2; guard.position.set(0, -0.04, 0.015);
  guard.scale.set(1, 1.45, 1); g.add(guard);
  // raked grip: nickel core with ivory panels + engraved cap
  const grip = new THREE.Group();
  grip.add(box(0.05, 0.17, 0.062, nickel(), 0, 0, 0));
  grip.add(box(0.058, 0.15, 0.05, ivory(), 0, 0, 0.002));
  grip.add(box(0.052, 0.018, 0.055, brass(), 0, -0.088, 0));
  grip.position.set(0, -0.1, 0.065); grip.rotation.x = -0.3;
  g.add(grip);
  // lanyard loop at the heel
  const loop = ring(0.012, 0.004, brass(), 6, 10);
  loop.position.set(0, -0.185, 0.11); g.add(loop);
  // magazine (drops on full reload)
  const mag = anim(box(0.042, 0.15, 0.045, blackSteel(), 0, -0.115, 0.062));
  mag.rotation.x = -0.3; g.add(mag);
  // chamber-pressure dial on the left flank
  const dial = new THREE.Group();
  dial.add(tube(0.022, 0.01, brass(), 14, 0, 0, 0));
  dial.add(mesh(new THREE.CircleGeometry(0.017, 14), M.glass(0x3a6a5a, 0x0d201a), 0, 0, -0.006));
  const needle = anim(box(0.003, 0.015, 0.002, steel(), 0, 0.006, -0.007));
  dial.add(needle);
  dial.position.set(-0.04, 0.0, 0.03); dial.rotation.y = Math.PI / 2;
  g.add(dial);

  // blade trigger (animates on every pull)
  const trigger = anim(box(0.008, 0.028, 0.006, blued(), 0, -0.036, 0.015));
  g.add(trigger);

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05, -0.325); g.add(muzzle);
  // ejection port on the right flank of the slide
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.04, 0.06, 0.03); g.add(ejectPort);
  // where the magazine falls from
  const magWell = new THREE.Object3D(); magWell.position.set(0, -0.2, 0.09); g.add(magWell);

  return {
    group: g, muzzle, parts: { slide, hammer, mag, needle, bbl, trigger },
    anchors: { eject: ejectPort, magwell: magWell },
    eject: {
      onFire: { delay: 0.18, kind: 'casing', port: 'eject', dir: [1, 1.2, 0.4], speed: 1.05 },
      onReload: [{ at: 0.38, kind: 'mag', port: 'magwell', dir: [0.12, -1, 0.25], speed: 0.5 }],
    },
    rest: { position: [0.16, -0.125, -0.45], rotation: [0.03, 0.24, 0.02], scale: 0.86 },
    fireDuration: 0.16,
    // 3 s idle loop: the pressure needle breathes, the ring hammer eases
    idle(t, p) {
      const c = (t % 3) / 3 * Math.PI * 2;
      p.needle.rotation.z = Math.sin(c) * 0.3 + Math.sin(t * 6.3) * 0.03;
      p.hammer.rotation.x = Math.sin(c) * 0.02;
      p.slide.position.z = p.slide.userData.baseP.z;
      p.bbl.rotation.x = p.bbl.userData.baseR.x;
      p.mag.position.y = p.mag.userData.baseP.y;
      p.trigger.rotation.x = 0;
    },
    fire(f, p) {
      // trigger pulls, hammer falls, then the short-recoil cycle: slide racks
      // while the match barrel tips up, and the slide re-cocks the hammer on
      // its way home
      p.trigger.rotation.x = Math.min(1, f * 5) * (1 - Math.min(1, Math.max(0, f - 0.4) / 0.4)) * 0.45;
      const back = Math.sin(Math.min(1, f * 1.7) * Math.PI) * 0.062;
      p.slide.position.z = p.slide.userData.baseP.z + back;
      p.bbl.rotation.x = p.bbl.userData.baseR.x + back * 0.95;
      const fall = Math.min(1, f * 6) * 0.62;               // hammer strikes fast
      const recock = Math.max(0, Math.min(1, (f - 0.18) / 0.35)) * 0.62;
      p.hammer.rotation.x = -fall + recock;
      p.needle.rotation.z = 0.55 * (1 - f);                 // pressure spike
    },
    reload(f, p, tactical) {
      // mag slides free and falls (a real one drops via the debris system),
      // a fresh mag rises home, and a full reload drops the locked slide last
      if (f < 0.38) {
        p.mag.visible = true;
        p.mag.position.y = p.mag.userData.baseP.y - (f / 0.38) * 0.06;
      } else if (f < 0.55) {
        p.mag.visible = false;                              // airborne (debris)
      } else if (f < 0.85) {
        p.mag.visible = true;
        p.mag.position.y = p.mag.userData.baseP.y - 0.17 + ((f - 0.55) / 0.3) * 0.17;
      } else {
        p.mag.visible = true;
        p.mag.position.y = p.mag.userData.baseP.y;
      }
      // slide locked open through an empty reload, dropped by the release
      if (!tactical) {
        p.slide.position.z = p.slide.userData.baseP.z +
          (f < 0.82 ? 0.062 : 0.062 * (1 - (f - 0.82) / 0.18));
      }
      p.hammer.rotation.x = 0;
    },
  };
}

/* ================================================================== */
/* SHOTGUN — CRANE COACHGUN: over-under that breaks UPWARD             */
/* ================================================================== */

/** One 12-bore shell: red hull, brass head. Lies along Z, head at +Z. */
function makeShell() {
  const s = new THREE.Group();
  const hull = tube(0.0185, 0.052, M.flat(0x8c2f24, 0.55), 10, 0, 0, -0.008);
  s.add(hull);
  const head = tube(0.0195, 0.016, brass(), 10, 0, 0, 0.024);
  s.add(head);
  return s;
}

function buildShotgun() {
  const g = new THREE.Group();

  /* --- barrel assembly: hinged at the TOP REAR, cranes skyward --- */
  const bg = anim(new THREE.Group());
  bg.position.set(0, 0.062, -0.055); // the hinge point
  // over-under bores, blued steel with a brass muzzle band
  bg.add(tube(0.021, 0.46, blued(), 14, 0, -0.014, -0.26));
  bg.add(tube(0.021, 0.46, blued(), 14, 0, -0.06, -0.26));
  bg.add(box(0.052, 0.096, 0.026, brass(), 0, -0.037, -0.468)); // muzzle band
  for (const y of [-0.014, -0.06]) { // the black voids of the bores
    const bore = mesh(new THREE.CircleGeometry(0.017, 12), M.flat(0x08080a, 0.95), 0, y, -0.4815);
    bore.rotation.y = Math.PI; bg.add(bore);
  }
  // ventilated sight rib: raised strip on posts (the modern read)
  bg.add(box(0.014, 0.006, 0.4, blued(), 0, 0.016, -0.26));
  for (let i = 0; i < 5; i++) bg.add(box(0.01, 0.01, 0.014, blued(), 0, 0.009, -0.08 - i * 0.09));
  bg.add(box(0.009, 0.012, 0.01, brass(), 0, 0.025, -0.455)); // brass bead
  // side joining ribs between the bores
  for (const x of [-0.02, 0.02]) bg.add(box(0.005, 0.04, 0.36, blued(), x, -0.037, -0.24));
  // walnut forend riding under the bores (swings up with them)
  bg.add(box(0.056, 0.048, 0.19, walnut(), 0, -0.096, -0.27));
  bg.add(box(0.06, 0.052, 0.018, brass(), 0, -0.094, -0.185)); // brass band
  // chamber monobloc + breech faces (visible when the action is open)
  bg.add(box(0.072, 0.1, 0.08, steel(), 0, -0.037, -0.03));
  for (const y of [-0.014, -0.06]) {
    const bore = mesh(new THREE.CircleGeometry(0.0195, 12), M.flat(0x0a0a0c, 0.9), 0, y, 0.011);
    bg.add(bore);
  }
  // extractor plate between the chambers (pops out as the action opens)
  const extractor = anim(box(0.012, 0.082, 0.014, steel(), 0, -0.037, 0.008));
  bg.add(extractor);
  // the two chambered shells (fresh ones slide in during the reload)
  const shellO = anim(makeShell()); shellO.position.set(0, -0.014, 0.008); bg.add(shellO);
  const shellU = anim(makeShell()); shellU.position.set(0, -0.06, 0.008); bg.add(shellU);
  g.add(bg);

  /* --- fixed receiver --- */
  g.add(box(0.075, 0.095, 0.15, M.get('gunmetal'), 0, -0.005, 0.045));
  g.add(box(0.07, 0.085, 0.014, steel(), 0, 0.005, -0.032)); // standing breech
  // engraved brass sideplate on the camera-side flank
  g.add(box(0.006, 0.066, 0.115, brass(), -0.0405, -0.005, 0.045));
  for (const z of [0.0, 0.045, 0.09]) g.add(sphere(0.0045, steel(), 6).translateX(-0.0455).translateY(-0.03).translateZ(z));
  g.add(box(0.05, 0.016, 0.12, blued(), 0, 0.052, 0.06)); // top strap
  // top latch lever (thumbs aside to break the action)
  const latch = anim(new THREE.Group());
  latch.add(box(0.014, 0.008, 0.055, steel(), 0, 0, -0.018));
  latch.add(box(0.022, 0.012, 0.02, steel(), 0, 0.003, 0.012)); // thumb pad
  latch.position.set(0, 0.064, 0.1); g.add(latch);
  // twin exposed brass hammers, side by side
  const hamL = anim(new THREE.Group());
  hamL.add(box(0.013, 0.04, 0.016, brass(), 0, 0.018, 0.006));
  hamL.add(sphere(0.0105, brass(), 8).translateY(0.042));
  hamL.position.set(-0.021, 0.045, 0.125); g.add(hamL);
  const hamR = anim(new THREE.Group());
  hamR.add(box(0.013, 0.04, 0.016, brass(), 0, 0.018, 0.006));
  hamR.add(sphere(0.0105, brass(), 8).translateY(0.042));
  hamR.position.set(0.021, 0.045, 0.125); g.add(hamR);
  // shell gauge on the right flank: brass bezel, needle tracks the chambers
  const gauge = new THREE.Group();
  gauge.add(tube(0.02, 0.01, brass(), 12));
  gauge.add(mesh(new THREE.CircleGeometry(0.0155, 12), M.glass(0x3a6a5a, 0x0d201a), 0, 0, -0.006));
  const needle = anim(box(0.0028, 0.013, 0.002, steel(), 0, 0.005, -0.007));
  gauge.add(needle);
  gauge.position.set(0.0405, -0.005, 0.075); gauge.rotation.y = -Math.PI / 2;
  g.add(gauge);
  // trigger guard + single trigger
  const guard = ring(0.03, 0.005, steel(), 6, 16);
  guard.rotation.x = Math.PI / 2; guard.position.set(0, -0.058, 0.06);
  guard.scale.set(1, 1.5, 1); g.add(guard);
  const trigger = anim(box(0.008, 0.026, 0.006, brass(), 0, -0.052, 0.055));
  g.add(trigger);
  // raked ebony grip with a leather wrap + short stock, steel buttplate
  const grip = new THREE.Group();
  grip.add(box(0.048, 0.15, 0.06, ebony(), 0, 0, 0));
  grip.add(box(0.052, 0.05, 0.064, leather(), 0, -0.01, 0));
  grip.position.set(0, -0.095, 0.115); grip.rotation.x = -0.35;
  g.add(grip);
  const stock = box(0.06, 0.095, 0.24, ebony(), 0, -0.03, 0.27);
  stock.rotation.x = 0.13; g.add(stock);
  g.add(box(0.064, 0.1, 0.018, steel(), 0, -0.048, 0.385).rotateX(0.13));
  g.add(box(0.045, 0.02, 0.1, leather(), 0, 0.026, 0.28).rotateX(0.13)); // cheek pad

  // anchors: muzzle + shell ejection ride the barrel assembly
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.037, -0.49); bg.add(muzzle);
  const chamberPort = new THREE.Object3D(); chamberPort.position.set(0, -0.037, 0.05); bg.add(chamberPort);

  const BREAK = 0.82; // radians of upward crane

  return {
    group: g, muzzle,
    parts: { bg, latch, hamL, hamR, trigger, extractor, shellO, shellU, needle },
    anchors: { chamber: chamberPort },
    eject: {
      // both hulls sail up over the shoulder the moment the action cranes open
      onReload: [{ at: 0.3, kind: 'shell', count: 2, port: 'chamber', dir: [0.55, 1.5, 0.4], speed: 0.85 }],
    },
    rest: { position: [0.15, -0.115, -0.46], rotation: [0.03, 0.18, 0.0], scale: 0.85 },
    fireDuration: 0.42,
    _hamDown: [false, false],
    _mag: 2,
    /** WeaponView hands us live weapon state each frame. */
    sync(weapon) {
      this._mag = weapon.mag;
      if (!weapon.reloading) {
        this.parts.shellO.visible = weapon.mag >= 1;
        this.parts.shellU.visible = weapon.mag >= 2;
      }
    },
    // 2.6 s idle loop: hammers breathe at full cock, the gauge needle hunts
    idle(t, p) {
      const c = (t % 2.6) / 2.6 * Math.PI * 2;
      const cock = -0.55;
      p.hamL.rotation.x = (this._hamDown[0] ? 0.18 : cock) + Math.sin(c) * 0.012;
      p.hamR.rotation.x = (this._hamDown[1] ? 0.18 : cock) + Math.sin(c + 1.2) * 0.012;
      p.needle.rotation.z = -0.5 + (this._mag / 2) * 1.0 + Math.sin(c * 2) * 0.02;
      p.bg.rotation.x = 0;
      p.latch.rotation.y = 0;
      p.extractor.position.z = p.extractor.userData.baseP.z;
      p.trigger.rotation.x = 0;
      p.shellO.position.z = p.shellO.userData.baseP.z;
      p.shellU.position.z = p.shellU.userData.baseP.z;
    },
    fire(f, p) {
      // trigger pulls, one hammer (or both) snaps down, the bores flex
      p.trigger.rotation.x = Math.min(1, f * 6) * (1 - Math.min(1, Math.max(0, f - 0.3) / 0.5)) * 0.4;
      const fall = Math.min(1, f * 8);
      if (this._lastF === undefined || this._lastF > f) {
        // a fresh shot: pick which hammer falls
        this._fireBoth = !!this._both;
        this._hIdx = this._hamDown[0] ? 1 : 0;
      }
      this._lastF = f;
      const drop = (i) => { this._hamDown[i] = true; };
      if (this._fireBoth) {
        p.hamL.rotation.x = -0.55 + fall * 0.73; p.hamR.rotation.x = -0.55 + fall * 0.73;
        if (fall >= 1) { drop(0); drop(1); }
      } else if (this._hIdx === 0) {
        p.hamL.rotation.x = -0.55 + fall * 0.73;
        if (fall >= 1) drop(0);
      } else {
        p.hamR.rotation.x = -0.55 + fall * 0.73;
        if (fall >= 1) drop(1);
      }
      // recoil flexes the barrel set against the hinge a hair
      p.bg.rotation.x = Math.sin(Math.min(1, f * 2.2) * Math.PI) * 0.018;
    },
    /** Pull the gun low and in so the skyward break stays in frame. */
    reloadPose(env) {
      return { py: -env * 0.13, pz: env * 0.05, px: -env * 0.035, rx: -env * 0.1 };
    },
    reload(f, p) {
      const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      // latch thumbs aside, hammers cock back
      p.latch.rotation.y = f < 0.1 ? ss(f / 0.1) * 0.5 : f < 0.82 ? 0.5 : ss((1 - f) / 0.18) * 0.5;
      const recock = ss((f - 0.06) / 0.2);
      p.hamL.rotation.x = 0.18 - recock * 0.73;
      p.hamR.rotation.x = 0.18 - recock * 0.73;
      if (recock >= 1) { this._hamDown[0] = false; this._hamDown[1] = false; }
      // the whole barrel set cranes UP, dwells, then snaps home with a bounce
      let open;
      if (f < 0.14) open = 0;
      else if (f < 0.34) open = ss((f - 0.14) / 0.2);
      else if (f < 0.66) open = 1;
      else if (f < 0.86) open = 1 - ss((f - 0.66) / 0.2);
      else open = Math.sin((f - 0.86) / 0.14 * Math.PI) * 0.03; // shudder at lockup
      p.bg.rotation.x = open * BREAK;
      // extractor kicks the hulls as it opens
      p.extractor.position.z = p.extractor.userData.baseP.z + ss((open - 0.5) * 2) * 0.022;
      // spent hulls vanish at the eject moment; fresh shells slide in from behind
      const seat = (sh, t0) => {
        if (f < 0.3) { sh.visible = true; sh.position.z = sh.userData.baseP.z; return; }
        if (f < t0) { sh.visible = false; return; }
        const s = Math.min(1, (f - t0) / 0.12);
        sh.visible = true;
        sh.position.z = sh.userData.baseP.z + (1 - ss(s)) * 0.085;
      };
      seat(p.shellO, 0.4);
      seat(p.shellU, 0.53);
    },
  };
}

/* ================================================================== */
/* RIFLE — FOUNDRY GUN: Lewis-pattern steam machine gun                */
/* ================================================================== */

function buildRifle() {
  const g = new THREE.Group();

  // blackened receiver
  g.add(box(0.072, 0.078, 0.34, blackSteel(), 0, 0, 0.02));
  g.add(box(0.078, 0.016, 0.3, M.get('gunmetal'), 0, 0.04, 0.02)); // top deck
  // brass maker's plate + rivet line on the camera-side flank
  g.add(box(0.006, 0.05, 0.11, brass(), -0.037, -0.008, 0.06));
  for (const z of [-0.08, -0.02, 0.04, 0.1, 0.15]) g.add(sphere(0.0045, steel(), 6).translateX(-0.038).translateY(0.03).translateZ(z));
  for (const z of [-0.08, -0.02, 0.04, 0.1, 0.15]) g.add(sphere(0.0045, steel(), 6).translateX(-0.038).translateY(-0.035).translateZ(z));
  // wide finned cooling shroud (the Lewis silhouette) over a blued barrel
  g.add(tube(0.018, 0.42, blued(), 12, 0, 0.012, -0.31));
  const jacket = tube(0.044, 0.32, M.get('gunmetal'), 18, 0, 0.012, -0.29);
  g.add(jacket);
  for (let i = 0; i < 11; i++) { // radiator fins
    const fin = ring(0.05, 0.006, M.get('castIron'), 6, 18);
    fin.position.set(0, 0.012, -0.15 - i * 0.028);
    fin.rotation.x = Math.PI / 2;
    g.add(fin);
  }
  g.add(tube(0.05, 0.04, blackSteel(), 18, 0, 0.012, -0.44)); // shroud mouth
  g.add(box(0.007, 0.022, 0.008, steel(), 0, 0.055, -0.45));  // front post
  g.add(box(0.01, 0.016, 0.01, brass(), 0, 0.058, -0.02));    // rear notch
  // ---- flank-mounted brass pan drum (turned to face the camera so its
  // rotation is unmissable; ratchets one cartridge per shot) ----
  const drum = anim(new THREE.Group());
  const drumBody = cyl(0.066, 0.066, 0.03, brass(), 22);
  drumBody.rotation.z = Math.PI / 2; // axis along X → face toward camera (-x)
  drum.add(drumBody);
  const rim = cyl(0.07, 0.07, 0.01, brassWornMat(), 22);
  rim.rotation.z = Math.PI / 2; rim.position.x = -0.016;
  drum.add(rim);
  for (let i = 0; i < 9; i++) { // radial cartridge windows read the spin
    const a = (i / 9) * Math.PI * 2;
    const rib = box(0.006, 0.05, 0.012, copper(), 0, 0, 0);
    rib.position.y = Math.cos(a) * 0.042; rib.position.z = Math.sin(a) * 0.042;
    rib.position.x = -0.02;
    rib.rotation.x = -a;
    drum.add(rib);
  }
  drum.add(cyl(0.013, 0.013, 0.05, steel(), 10).rotateZ(Math.PI / 2)); // spindle
  drum.add(sphere(0.012, brassWornMat(), 8).translateX(-0.028));       // center boss
  drum.position.set(-0.05, 0.045, 0.0); g.add(drum);
  // feed housing bridging the drum to the receiver top
  g.add(box(0.03, 0.03, 0.08, blackSteel(), -0.02, 0.05, 0.0));
  // charging handle on the camera side (reciprocates every shot)
  const bolt = anim(new THREE.Group());
  bolt.add(box(0.016, 0.02, 0.055, steel(), 0, 0, 0));
  bolt.add(sphere(0.013, blackSteel(), 8).translateX(0.03));
  bolt.position.set(0.05, 0.02, 0.09); g.add(bolt);
  // ejection port + brass deflector just forward of the handle
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.045, 0.0, 0.0); g.add(ejectPort);
  g.add(box(0.006, 0.03, 0.05, brass(), 0.046, 0.02, -0.04)); // brass deflector plate
  // copper boiler slung under the receiver, feed pipe forward, live valve
  const boiler = cyl(0.03, 0.03, 0.13, copper(), 14, 0, -0.07, 0.16);
  boiler.rotation.x = Math.PI / 2; g.add(boiler);
  g.add(ring(0.031, 0.005, brass(), 6, 12).translateY(-0.07).translateZ(0.1));
  g.add(ring(0.031, 0.005, brass(), 6, 12).translateY(-0.07).translateZ(0.22));
  const pipe = tube(0.008, 0.34, copper(), 8, 0.036, -0.035, 0.0);
  pipe.rotation.z = 0.05; g.add(pipe);
  const valve = anim(cyl(0.012, 0.012, 0.028, M.glow(0xff8a30, 0.5), 8, 0.036, -0.005, 0.2));
  valve.rotation.x = Math.PI / 2; g.add(valve);
  g.add(box(0.014, 0.05, 0.014, brass(), 0.036, -0.03, 0.2)); // valve stem stack
  // ebony pistol grip + trigger, canvas-wrapped stock
  const grip = box(0.044, 0.12, 0.05, ebony(), 0, -0.098, 0.14);
  grip.rotation.x = 0.28; g.add(grip);
  const trigger = anim(box(0.008, 0.026, 0.006, steel(), 0, -0.045, 0.1));
  g.add(trigger);
  const guard = ring(0.026, 0.004, steel(), 6, 14);
  guard.rotation.x = Math.PI / 2; guard.position.set(0, -0.05, 0.11);
  guard.scale.set(1, 1.5, 1); g.add(guard);
  const stock = box(0.05, 0.09, 0.2, ebony(), 0, -0.04, 0.29);
  stock.rotation.x = 0.1; g.add(stock);
  g.add(box(0.055, 0.1, 0.016, brass(), 0, -0.055, 0.385).rotateX(0.1)); // brass buttplate
  g.add(box(0.04, 0.018, 0.12, canvasMat(), 0, 0.01, 0.29).rotateX(0.1)); // canvas comb wrap
  // canvas sling strap off the shroud mouth (idle pendulum)
  const strap = anim(new THREE.Group());
  strap.add(box(0.016, 0.12, 0.006, canvasMat(), 0, -0.06, 0));
  strap.add(box(0.02, 0.012, 0.01, brass(), 0, -0.125, 0));
  strap.position.set(0, -0.03, -0.4); g.add(strap);

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.5); g.add(muzzle);

  return {
    group: g, muzzle, parts: { drum, bolt, strap, valve, trigger },
    anchors: { eject: ejectPort },
    eject: {
      onFire: { delay: 0.35, kind: 'casing', port: 'eject', dir: [1.1, 0.5, 0.1], speed: 1.0 },
    },
    rest: { position: [0.145, -0.095, -0.45], rotation: [0.05, 0.26, 0.0], scale: 0.8 },
    fireDuration: 0.095,
    _step: 0,
    // 2.5 s idle loop: the sling sways, the boiler valve breathes, drum still
    idle(t, p) {
      const c = (t % 2.5) / 2.5 * Math.PI * 2;
      p.strap.rotation.z = Math.sin(c) * 0.14;
      p.strap.rotation.x = Math.cos(c * 0.5) * 0.05;
      p.valve.material.emissiveIntensity = 0.4 + Math.sin(c) * 0.12;
      p.bolt.position.z = p.bolt.userData.baseP.z;
      p.drum.position.x = p.drum.userData.baseP.x;
      p.drum.position.y = p.drum.userData.baseP.y;
      p.drum.rotation.x = this._step;
      p.trigger.rotation.x = 0;
      p.drum.visible = true;
    },
    fire(f, p) {
      if (f === 0 || this._lastF > f) this._step += Math.PI / 4.5; // one cartridge per round
      this._lastF = f;
      const cyc = Math.sin(Math.min(1, f * 2) * Math.PI);
      p.drum.rotation.x = this._step + cyc * 0.18;      // drum ratchets round
      p.bolt.position.z = p.bolt.userData.baseP.z + cyc * 0.045; // handle slams back
      p.trigger.rotation.x = Math.min(1, f * 8) * 0.4;
      p.valve.material.emissiveIntensity = 2.0 * (1 - f) + 0.4; // pressure flares
      p.strap.rotation.z += 0.06 * (1 - f);             // fire rate rattles the sling
    },
    reload(f, p) {
      const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      // swing the spent drum out to the left off its spindle, dwell, seat a
      // fresh one back on
      let out;
      if (f < 0.4) out = ss(f / 0.4);
      else if (f < 0.6) out = 1;
      else out = 1 - ss((f - 0.6) / 0.4);
      p.drum.position.x = p.drum.userData.baseP.x - out * 0.16;
      p.drum.position.y = p.drum.userData.baseP.y + out * 0.05;
      p.drum.visible = !(f > 0.42 && f < 0.58);          // swapped while pulled clear
      p.drum.rotation.x = this._step + out * 3.4;        // spins as it's handled
      p.valve.material.emissiveIntensity = 0.4;
    },
  };
}

/* ================================================================== */
/* SNIPER — MERIDIAN LONG RIFLE: bolt-action observatory instrument    */
/* ================================================================== */

function buildSniper() {
  const g = new THREE.Group();

  // slim octagonal blued barrel — a precision instrument, not a pipe
  const oct = tube(0.0145, 0.62, blued(), 8, 0, 0.03, -0.42);
  oct.rotation.z = Math.PI / 8;
  g.add(oct);
  g.add(barrel(0.017, 0.0145, 0.035, nickel(), 8, 0, 0.03, -0.715)); // muzzle crown
  g.add(box(0.007, 0.016, 0.005, nickel(), 0, 0.055, -0.69));        // blade sight
  // skeleton stabilizer cage around the front half — brass rails + rings
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    g.add(box(0.006, 0.006, 0.3, brass(),
      Math.cos(a) * 0.027, 0.03 + Math.sin(a) * 0.027, -0.52));
  }
  for (const z of [-0.4, -0.52, -0.645]) {
    const r = ring(0.028, 0.0045, brass(), 6, 16);
    r.position.set(0, 0.03, z); g.add(r);
  }
  // compact blued receiver
  g.add(box(0.055, 0.075, 0.17, blued(), 0, 0.02, -0.01));
  g.add(box(0.05, 0.014, 0.16, steel(), 0, 0.062, -0.01)); // polished top rail
  // ---- the bolt: full lift / draw / return / lock cycle on every shot ----
  const bolt = anim(new THREE.Group());
  bolt.position.set(0.026, 0.055, 0.045);
  const boltBody = tube(0.011, 0.115, steel(), 10, 0, 0, -0.02);
  bolt.add(boltBody);
  bolt.add(barrel(0.013, 0.011, 0.02, steel(), 10, 0, 0, 0.04)); // bolt shroud
  const handle = anim(new THREE.Group());
  const arm = cyl(0.0055, 0.0055, 0.05, steel(), 8);
  arm.rotation.z = Math.PI / 2; arm.position.x = 0.025;
  handle.add(arm);
  handle.add(sphere(0.0135, brass(), 10).translateX(0.052)); // brass ball knob
  handle.position.set(0, 0, 0.03);
  bolt.add(handle);
  g.add(bolt);
  // rangefinder drum on the camera-side flank: engraved brass, steps per shot
  const drum = anim(new THREE.Group());
  const drumBody = cyl(0.021, 0.021, 0.022, brass(), 14);
  drumBody.rotation.z = Math.PI / 2;
  drum.add(drumBody);
  for (let i = 0; i < 8; i++) { // engraved tick studs so rotation reads
    const a = (i / 8) * Math.PI * 2;
    drum.add(box(0.02, 0.004, 0.004, blued(), 0.0, Math.sin(a) * 0.0165, Math.cos(a) * 0.0165));
  }
  drum.add(sphere(0.006, steel(), 6).translateX(-0.014));
  drum.position.set(-0.034, 0.04, 0.01); g.add(drum);
  // brass telescope: objective bell, turret, glowing reticle eyepiece
  const scopeG = new THREE.Group();
  scopeG.add(tube(0.019, 0.3, brass(), 14, 0, 0, -0.03));
  scopeG.add(barrel(0.026, 0.02, 0.06, brass(), 14, 0, 0, -0.2));  // objective bell
  scopeG.add(mesh(new THREE.CircleGeometry(0.018, 14), M.glass(0x264a5a, 0x0a1820), 0, 0, -0.231));
  const turret = anim(cyl(0.009, 0.009, 0.016, nickel(), 10, 0, 0.026, -0.04)); // elevation turret
  scopeG.add(turret);
  scopeG.add(barrel(0.017, 0.021, 0.045, blued(), 12, 0, 0, 0.12)); // eyepiece
  const reticle = mesh(new THREE.CircleGeometry(0.0155, 12), M.glow(0x66d9a3, 0.9), 0, 0, 0.143);
  reticle.rotation.y = Math.PI; // faces the shooter
  scopeG.add(reticle);
  scopeG.position.set(0, 0.108, -0.03);
  g.add(scopeG);
  for (const z of [-0.11, 0.05]) { // nickel ring mounts on posts
    const mount = ring(0.021, 0.004, nickel(), 6, 14);
    mount.position.set(0, 0.108, z); g.add(mount);
    g.add(box(0.012, 0.03, 0.014, nickel(), 0, 0.075, z));
  }
  // en-bloc clip: five brass noses proud of the receiver during a reload
  const clip = anim(new THREE.Group());
  clip.add(box(0.018, 0.042, 0.032, brass(), 0, 0, 0));
  for (let i = 0; i < 5; i++) clip.add(tube(0.0045, 0.03, copper(), 6, 0, 0.012, -0.011 + i * 0.0055));
  clip.position.set(0, 0.085, -0.01);
  clip.visible = false;
  g.add(clip);
  // trigger + guard
  const guard = ring(0.028, 0.0045, nickel(), 6, 16);
  guard.rotation.x = Math.PI / 2; guard.position.set(0, -0.045, 0.04);
  guard.scale.set(1, 1.6, 1); g.add(guard);
  const trigger = anim(box(0.007, 0.024, 0.005, brass(), 0, -0.04, 0.035));
  g.add(trigger);
  // full-length walnut furniture with brass fittings
  g.add(box(0.042, 0.048, 0.34, walnut(), 0, -0.006, -0.24));     // fore-end
  g.add(box(0.046, 0.052, 0.02, brass(), 0, -0.006, -0.4));       // fore cap
  const grip = new THREE.Group();
  grip.add(box(0.044, 0.13, 0.056, walnut(), 0, 0, 0));
  grip.add(box(0.048, 0.036, 0.06, leather(), 0, -0.02, 0));      // leather wrap
  grip.position.set(0, -0.075, 0.1); grip.rotation.x = -0.4;
  g.add(grip);
  const butt = box(0.048, 0.098, 0.26, walnut(), 0, -0.02, 0.26);
  butt.rotation.x = 0.11; g.add(butt);
  g.add(box(0.052, 0.105, 0.016, brass(), 0, -0.037, 0.385).rotateX(0.11)); // brass buttplate
  g.add(box(0.038, 0.02, 0.11, leather(), 0, 0.043, 0.25).rotateX(0.11));   // cheek riser
  for (const [y, z] of [[-0.035, -0.38], [-0.075, 0.3]]) { // sling loops
    const l = ring(0.009, 0.003, steel(), 6, 10);
    l.position.set(0, y, z); g.add(l);
  }

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.735); g.add(muzzle);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.03, 0.065, 0.02); g.add(ejectPort);

  return {
    group: g, muzzle,
    parts: { bolt, handle, drum, turret, clip, trigger, reticle },
    anchors: { eject: ejectPort },
    eject: {
      // the case leaves when the bolt comes back mid-cycle
      onFire: { delay: 0.4, kind: 'casing', port: 'eject', dir: [1, 1.3, 0.3], speed: 0.85 },
      // the spent en-bloc clip pings out as the bolt opens on a reload
      onReload: [{ at: 0.16, kind: 'clip', port: 'eject', dir: [0.8, 1.5, 0.4], speed: 0.7, fullOnly: true }],
    },
    rest: { position: [0.15, -0.115, -0.46], rotation: [0.02, 0.15, 0.01], scale: 0.82 },
    fireDuration: 1.15,
    _drumStep: 0,
    // 3.4 s idle loop: the drum hunts a reading, the reticle breathes
    idle(t, p) {
      const c = (t % 3.4) / 3.4 * Math.PI * 2;
      p.drum.rotation.x = this._drumStep + Math.sin(c) * 0.06;
      p.turret.rotation.y = Math.sin(c * 0.5) * 0.3;
      p.reticle.material.emissiveIntensity = 0.75 + Math.sin(c * 2) * 0.15;
      p.bolt.position.z = p.bolt.userData.baseP.z;
      p.handle.rotation.z = 0;
      p.trigger.rotation.x = 0;
      if (!this._reloading) p.clip.visible = false;
    },
    fire(f, p) {
      const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      if (this._lastF === undefined || this._lastF > f) this._drumStep += Math.PI / 4; // log the shot
      this._lastF = f;
      p.trigger.rotation.x = Math.min(1, f * 10) * (1 - ss((f - 0.1) / 0.2)) * 0.4;
      p.drum.rotation.x = this._drumStep - Math.sin(Math.min(1, f * 4) * Math.PI) * 0.1;
      p.reticle.material.emissiveIntensity = 2.2 * (1 - ss(f * 2)) + 0.75;
      // the full bolt cycle: lift, draw (case away), return, lock
      const lift = ss((f - 0.1) / 0.14) - ss((f - 0.78) / 0.14);
      const draw = ss((f - 0.28) / 0.18) - ss((f - 0.52) / 0.2);
      p.handle.rotation.z = lift * 1.15;
      p.bolt.position.z = p.bolt.userData.baseP.z + draw * 0.08;
    },
    reload(f, p, tactical) {
      const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      this._reloading = f < 0.98;
      // bolt open through the load, closed at the end
      const lift = ss(f / 0.1) - ss((f - 0.84) / 0.12);
      const draw = ss((f - 0.08) / 0.12) - ss((f - 0.86) / 0.1);
      p.handle.rotation.z = lift * 1.15;
      p.bolt.position.z = p.bolt.userData.baseP.z + draw * 0.08;
      // fresh clip pressed down into the open action, five seat ticks
      if (f > 0.3 && f < 0.78) {
        p.clip.visible = true;
        const seat = ss((f - 0.3) / 0.38);
        p.clip.position.y = p.clip.userData.baseP.y + 0.07 * (1 - seat);
        p.clip.position.z = p.clip.userData.baseP.z - 0.02 * (1 - seat);
        p.clip.rotation.x = (1 - seat) * -0.3;
        // seat ticks shiver the whole clip
        p.clip.position.y += Math.abs(Math.sin(seat * Math.PI * 5)) * 0.004 * (1 - seat * 0.6);
      } else {
        p.clip.visible = false;
      }
    },
  };
}

/* ================================================================== */
/* BAT — ironshod oak slugger                                          */
/* ================================================================== */

function buildBat() {
  const g = new THREE.Group();

  // tapered oak body
  g.add(cyl(0.05, 0.026, 0.6, oak(), 16, 0, 0.11, 0));
  g.add(cyl(0.05, 0.046, 0.05, oak(), 16, 0, 0.42, 0)); // crown
  // hammered-iron cladding plates riveted around the head, proud studs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const plate = box(0.045, 0.2, 0.012, hammered(), 0, 0.3, 0);
    plate.position.x = Math.cos(a) * 0.045;
    plate.position.z = Math.sin(a) * 0.045;
    plate.rotation.y = -a + Math.PI / 2;
    g.add(plate);
    for (const dy of [-0.06, 0, 0.06]) { // stud rows
      const stud = sphere(0.009, steel(), 6);
      stud.position.set(Math.cos(a) * 0.055, 0.3 + dy, Math.sin(a) * 0.055);
      g.add(stud);
    }
  }
  for (const y of [0.21, 0.39]) { // iron retaining bands
    const band = ring(0.049, 0.007, hammered(), 6, 16);
    band.rotation.x = Math.PI / 2; band.position.y = y;
    g.add(band);
  }
  // compression spring collar at the neck (slams on impact)
  const springG = anim(new THREE.Group());
  for (let i = 0; i < 5; i++) {
    const coilRing = ring(0.036, 0.006, steel(), 6, 14);
    coilRing.rotation.x = Math.PI / 2;
    coilRing.position.y = i * 0.018;
    springG.add(coilRing);
  }
  springG.position.set(0, 0.08, 0);
  g.add(springG);
  g.add(cyl(0.042, 0.042, 0.014, hammered(), 12, 0, 0.175, 0)); // spring stop washer
  // leather-wrapped grip + iron pommel
  g.add(cyl(0.03, 0.03, 0.2, leather(), 12, 0, -0.08, 0));
  g.add(cyl(0.038, 0.032, 0.035, hammered(), 12, 0, -0.2, 0));
  // wrist strap hanging from the pommel (idle pendulum)
  const strap = anim(new THREE.Group());
  strap.add(box(0.012, 0.09, 0.005, leather(), 0, -0.045, 0));
  const strapRing = ring(0.014, 0.004, brass(), 6, 10);
  strapRing.position.y = -0.095;
  strap.add(strapRing);
  strap.position.set(0.02, -0.21, 0);
  g.add(strap);

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.4, 0); g.add(muzzle);

  return {
    group: g, muzzle, parts: { spring: springG, strap },
    rest: { position: [0.17, -0.2, -0.47], rotation: [-0.4, 0.66, -0.6], scale: 0.8 },
    fireDuration: 0.55,
    // 3.2 s idle loop: the wrist strap swings, the spring settles
    idle(t, p) {
      const c = (t % 3.2) / 3.2 * Math.PI * 2;
      p.strap.rotation.z = Math.sin(c) * 0.22;
      p.strap.rotation.x = Math.cos(c * 0.7) * 0.1;
      p.spring.scale.y = 1 + Math.sin(c * 2) * 0.015;
    },
    fire(f, p) {
      // spring compresses through the swing and slams back on impact
      const heavy = p._both ? 1.5 : 1;
      const squash = f < 0.35 ? (f / 0.35) : Math.max(0, 1 - (f - 0.35) / 0.4);
      p.spring.scale.y = 1 - squash * 0.45 * heavy;
      p.spring.position.y = p.spring.userData.baseP.y + squash * 0.02;
      p.strap.rotation.z = Math.sin(f * Math.PI) * -0.9 * heavy;
    },
    reload() {},
  };
}

/* ---------------- registry ---------------- */

const BUILDERS = {
  pistol: buildPistol,
  shotgun: buildShotgun,
  rifle: buildRifle,
  sniper: buildSniper,
  bat: buildBat,
};

/** Build the rig for a weapon id (pistol/shotgun/rifle/sniper/bat). */
export function buildWeaponModel(id) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error(`No 3D model for weapon "${id}"`);
  return fn();
}
