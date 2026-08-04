import * as THREE from '../../lib/three.module.js';
import { WeaponMaterials as M } from '../rendering/WeaponMaterials.js';

/**
 * Procedural 3D first-person weapon models, generation three — every model
 * a novel take on its weapon type, steampunk / BioShock mechanical, each
 * with its own signature material family, silhouette and working action:
 *
 *   pistol   — MAINSPRING MACHINE PISTOL: stubby industrial blowback sidearm
 *              built to the supplied reference — a thin exposed barrel with
 *              a heavy coil mainspring wound around it, slotted compensator,
 *              phosphate slab-sided receiver tube, chipped caution banding
 *              on the deck and magazine, and a forward-canted open-flanked
 *              box magazine with twelve live brass rounds visible in the
 *              stack. Bolt and charging handle cycle against the spring
 *              (which visibly compresses and rebounds on every shot), the
 *              stack empties round by round as you fire, and the box drops
 *              free on reload.
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
 *              instrument — slim octagonal barrel under a tensioned brass
 *              truss (collars clamped on the barrel, tied by three rods),
 *              a 1-inch brass telescope with a glowing reticle seated low
 *              in split rings on the receiver rail, rangefinder drum, full
 *              bolt choreography on every shot (lift, draw, eject, close),
 *              en-bloc clip reload with five seat clicks. Its furniture is
 *              continuous: fore-end into receiver, receiver into wrist,
 *              wrist into butt, grip up into the trigger housing.
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

/** A helix running along -Z — the machine pistol's exposed barrel mainspring. */
class HelixCurve extends THREE.Curve {
  constructor(radius, length, turns) { super(); this.radius = radius; this.length = length; this.turns = turns; }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, -t * this.length);
  }
}
/** Wound coil spring as real swept tube geometry (not a stack of rings). */
function coil(radius, wire, length, turns, mat, seg = 16, rad = 7) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(new HelixCurve(radius, length, turns), Math.round(turns * seg), wire, rad, false),
    mat,
  );
}

/** One live cartridge: brass case, rim, jacketed tip. Nose points -Z. */
function cartridge() {
  const c = new THREE.Group();
  const case_ = cyl(0.0068, 0.0074, 0.03, brass(), 9);
  case_.rotation.x = -Math.PI / 2; c.add(case_);
  const rim = cyl(0.008, 0.008, 0.004, brassWornMat(), 9, 0, 0, 0.016);
  rim.rotation.x = -Math.PI / 2; c.add(rim);
  const tip = mesh(new THREE.ConeGeometry(0.0064, 0.014, 9), copper(), 0, 0, -0.022);
  tip.rotation.x = -Math.PI / 2; c.add(tip);
  return c;
}

/** Record a part's base transform so animation can offset from it. */
function anim(o) { o.userData.baseP = o.position.clone(); o.userData.baseR = o.rotation.clone(); return o; }

const nickel = () => M.get('nickel');
const blackSteel = () => M.get('blackSteel');
const hammered = () => M.get('hammeredIron');
const ebony = () => M.get('ebony');
const brass = () => M.get('brass');
const parkerized = () => M.get('parkerized');
const hazard = () => M.get('hazardEnamel');
const blued = () => M.get('bluedSteel');
const copper = () => M.get('copper');
const steel = () => M.get('steelBright');
const oak = () => M.get('oak');
const walnut = () => M.get('walnut');
const brassWornMat = () => M.get('brassWorn');
const leather = () => M.get('leather');
const canvasMat = () => M.get('canvas');

/* ================================================================== */
/* PISTOL — MAINSPRING MACHINE PISTOL: coil-wrapped industrial sidearm  */
/* ================================================================== */

function buildPistol() {
  const g = new THREE.Group();
  const BORE = 0.045;   // bore axis height above the rig origin

  /* ---- muzzle end: slotted compensator on a thin exposed barrel ---- */
  g.add(tube(0.0145, 0.25, steel(), 18, 0, BORE, -0.34));
  g.add(tube(0.024, 0.062, blackSteel(), 18, 0, BORE, -0.482));      // compensator
  for (let i = 0; i < 5; i++) {                                       // cut gas ports
    g.add(box(0.007, 0.022, 0.006, M.flat(0x0b0b0d, 0.9), 0, BORE + 0.015, -0.505 + i * 0.012));
  }
  g.add(ring(0.0245, 0.0042, steel(), 6, 16).translateY(BORE).translateZ(-0.452));
  const boreHole = mesh(new THREE.CircleGeometry(0.0125, 14), M.flat(0x08080a, 0.95), 0, BORE, -0.5135);
  boreHole.rotation.y = Math.PI; g.add(boreHole);

  /* ---- the signature: an exposed mainspring wound around the barrel ---- */
  // the helix runs from its origin toward -Z, so seat it at the REAR abutment
  const spring = coil(0.0235, 0.0044, 0.172, 9, blued(), 16);
  spring.position.set(0, BORE, -0.252);
  anim(spring); g.add(spring);
  // spring seats: a collar it pushes against at each end
  g.add(tube(0.028, 0.016, blackSteel(), 16, 0, BORE, -0.428));
  const springSeat = anim(tube(0.029, 0.018, hammered(), 16, 0, BORE, -0.244));
  g.add(springSeat);

  /* ---- gas block / front sight tower ---- */
  g.add(box(0.05, 0.055, 0.05, hammered(), 0, BORE + 0.004, -0.222));
  g.add(box(0.012, 0.03, 0.012, steel(), 0, BORE + 0.045, -0.222));  // sight post
  for (const x of [-0.026, 0.026]) g.add(box(0.006, 0.026, 0.01, blackSteel(), x, BORE + 0.04, -0.222)); // sight ears

  /* ---- receiver: a heavy tube with bolted slab sides ---- */
  g.add(tube(0.0435, 0.28, parkerized(), 24, 0, BORE - 0.004, -0.075));
  // flank plates kept shallow so the tube's round shoulders stay visible
  for (const x of [-0.043, 0.043]) {
    g.add(box(0.007, 0.05, 0.25, parkerized(), x, BORE - 0.006, -0.08));
    for (const z of [-0.185, -0.115, -0.045, 0.025]) {                      // hex bolts
      g.add(cyl(0.006, 0.006, 0.005, steel(), 6, x * 1.16, BORE + 0.014, z).rotateZ(Math.PI / 2));
    }
  }
  // fire selector + stamped serial plate breaking up the mid-flank
  const selector = cyl(0.012, 0.012, 0.008, hammered(), 10, -0.049, BORE - 0.026, 0.012);
  selector.rotation.z = Math.PI / 2; g.add(selector);
  g.add(box(0.005, 0.008, 0.024, steel(), -0.053, BORE - 0.026, 0.004));
  g.add(box(0.004, 0.022, 0.05, hammered(), -0.048, BORE - 0.03, 0.058));
  // caution banding on the deck and the left flank plate — the reference's yellow
  g.add(box(0.05, 0.012, 0.17, hazard(), 0, BORE + 0.042, -0.115));
  g.add(box(0.005, 0.036, 0.13, hazard(), -0.0485, BORE - 0.012, -0.13));
  // cooling slots milled through the top deck
  for (let i = 0; i < 6; i++) {
    g.add(box(0.03, 0.006, 0.008, M.flat(0x101012, 0.85), 0, BORE + 0.041, -0.02 + i * 0.016));
  }

  /* ---- bolt + charging handle riding an open slot on the left flank ---- */
  g.add(box(0.006, 0.014, 0.17, M.flat(0x0d0d0f, 0.9), -0.047, BORE + 0.016, -0.055)); // slot void
  const bolt = new THREE.Group();
  bolt.add(box(0.03, 0.03, 0.1, steel(), 0, 0, 0));                 // bolt carrier
  bolt.add(box(0.022, 0.014, 0.03, blackSteel(), -0.026, 0.002, 0.012));
  const knob = cyl(0.011, 0.013, 0.026, hammered(), 12, -0.05, 0.002, 0.012);
  knob.rotation.z = Math.PI / 2; bolt.add(knob);                    // knurled handle
  for (let i = 0; i < 6; i++) {                                     // knurling ribs
    const a = (i / 6) * Math.PI * 2;
    bolt.add(box(0.026, 0.004, 0.004, steel(), -0.05, 0.002 + Math.sin(a) * 0.011, 0.012 + Math.cos(a) * 0.011));
  }
  bolt.position.set(-0.024, BORE + 0.014, -0.03);
  anim(bolt); g.add(bolt);

  /* ---- ejection port + deflector on the far flank ---- */
  g.add(box(0.006, 0.03, 0.06, M.flat(0x0a0a0c, 0.9), 0.047, BORE + 0.008, -0.05));
  g.add(box(0.008, 0.034, 0.008, hammered(), 0.05, BORE + 0.01, -0.012));

  /* ---- rear housing: tube steps DOWN to a slim tail so the first-person
         camera, which sits right behind it, isn't looking at a fat disc ---- */
  g.add(barrel(0.033, 0.0435, 0.03, blackSteel(), 20, 0, BORE - 0.004, 0.052)); // shoulder
  g.add(tube(0.033, 0.055, blackSteel(), 20, 0, BORE - 0.004, 0.094));
  g.add(ring(0.0345, 0.005, hammered(), 6, 20).translateY(BORE - 0.004).translateZ(0.078));
  const backplate = mesh(new THREE.CircleGeometry(0.03, 16), hammered(), 0, BORE - 0.004, 0.1215);
  g.add(backplate);
  // recoil-spring guide boss + retaining ring: mechanism, not a blank cap
  g.add(tube(0.012, 0.026, steel(), 12, 0, BORE - 0.004, 0.133));
  g.add(tube(0.016, 0.007, hammered(), 12, 0, BORE - 0.004, 0.146));
  for (let i = 0; i < 4; i++) {                                          // cap screws
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    g.add(sphere(0.0045, steel(), 8)
      .translateX(Math.cos(a) * 0.023).translateY(BORE - 0.004 + Math.sin(a) * 0.023).translateZ(0.122));
  }
  g.add(box(0.024, 0.013, 0.01, steel(), 0, BORE + 0.036, 0.052));       // rear notch
  g.add(box(0.004, 0.011, 0.011, M.flat(0x0b0b0d, 0.9), 0, BORE + 0.039, 0.052));

  /* ---- magazine: forward-canted box, open flanks, live stack visible ---- */
  const mag = new THREE.Group();
  const MAGROT = 0.26;      // forward cant (the reference's rake)
  const PITCH = 0.0122;     // vertical spacing of the round stack
  mag.add(box(0.048, 0.168, 0.012, blackSteel(), 0, -0.012, -0.031));   // front wall
  mag.add(box(0.048, 0.168, 0.012, blackSteel(), 0, -0.012, 0.031));    // rear wall
  for (const x of [-0.026, 0.026]) {                                    // corner rails
    mag.add(box(0.006, 0.168, 0.008, parkerized(), x, -0.012, -0.026));
    mag.add(box(0.006, 0.168, 0.008, parkerized(), x, -0.012, 0.026));
  }
  mag.add(box(0.056, 0.014, 0.078, hammered(), 0, -0.103, 0));          // floorplate
  mag.add(box(0.052, 0.01, 0.07, hazard(), 0, -0.091, 0));              // caution band
  mag.add(box(0.05, 0.024, 0.014, hazard(), 0, 0.033, -0.036));         // front flash
  // the stack: twelve live rounds, top-fed, plus the follower under them
  const rounds = [];
  for (let i = 0; i < 12; i++) {
    const r = cartridge();
    r.position.set((i % 2 ? 1 : -1) * 0.005, 0.056 - i * PITCH, 0.002);
    mag.add(r); rounds.push(r);
  }
  const follower = anim(box(0.036, 0.012, 0.05, M.flat(0x2a2c30, 0.7), 0, -0.088, 0.002));
  mag.add(follower);
  mag.position.set(0, -0.048, -0.128); mag.rotation.x = MAGROT;
  anim(mag); g.add(mag);
  // magwell throat the box seats into
  g.add(box(0.062, 0.05, 0.086, hammered(), 0, BORE - 0.052, -0.135).rotateX(MAGROT));

  /* ---- trigger group, hung off a frame rail that ties magwell to grip ---- */
  g.add(box(0.042, 0.032, 0.15, parkerized(), 0, -0.003, -0.032));
  g.add(box(0.046, 0.01, 0.05, hammered(), 0, -0.016, 0.045));           // trigger housing floor
  const guard = ring(0.029, 0.006, hammered(), 7, 20);
  guard.rotation.y = Math.PI / 2; guard.position.set(0, -0.019, 0.023);
  guard.scale.set(1, 0.95, 1); g.add(guard);
  const trigger = anim(box(0.009, 0.03, 0.008, steel(), 0, -0.012, 0.03));
  g.add(trigger);

  /* ---- grip: raked, checkered panels, phosphate backstrap ---- */
  const grip = new THREE.Group();
  grip.add(box(0.046, 0.118, 0.062, blackSteel(), 0, 0, 0));
  // side panels with fine horizontal grip ribs, only just proud of the frame
  for (const x of [-0.0235, 0.0235]) {
    grip.add(box(0.004, 0.1, 0.052, parkerized(), x, 0.002, 0.002));
    for (let r = 0; r < 8; r++) {
      grip.add(box(0.0028, 0.005, 0.048, hammered(), x * 1.17, 0.04 - r * 0.0108, 0.002));
    }
  }
  grip.add(box(0.048, 0.015, 0.058, hammered(), 0, -0.062, 0));           // butt cap
  grip.add(box(0.013, 0.03, 0.01, steel(), 0.026, 0.036, 0.022));         // mag release
  grip.position.set(0, -0.088, 0.076); grip.rotation.x = -0.2;
  g.add(grip);
  const lanyard = ring(0.011, 0.0033, hammered(), 6, 12);
  lanyard.rotation.y = Math.PI / 2; lanyard.position.set(0, -0.163, 0.094);
  g.add(lanyard);

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, BORE, -0.515); g.add(muzzle);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.05, BORE + 0.01, -0.05); g.add(ejectPort);
  const magWell = new THREE.Object3D(); magWell.position.set(0, -0.19, -0.1); g.add(magWell);

  return {
    group: g, muzzle,
    parts: { bolt, spring, springSeat, mag, rounds, follower, trigger },
    anchors: { eject: ejectPort, magwell: magWell },
    eject: {
      onFire: { delay: 0.2, kind: 'casing', port: 'eject', dir: [1, 1.1, 0.35], speed: 1.05 },
      onReload: [{ at: 0.36, kind: 'mag', port: 'magwell', dir: [0.1, -1, -0.2], speed: 0.55 }],
    },
    rest: { position: [0.158, -0.108, -0.47], rotation: [0.04, 0.36, 0.02], scale: 0.72 },
    fireDuration: 0.16,
    _mag: 12,
    /** Live round count → the visible stack, so the magazine empties as you
     *  shoot. weapon.mag holds the leftover all through a reload and is only
     *  topped up at the end, so the box that drops away still shows what was
     *  left in it; reload() fills the stack again once the fresh one is in. */
    sync(weapon) { this._mag = weapon.mag; },
    /** Show the top `n` rounds and float the follower up under them. */
    _stack(n) {
      const rs = this.parts.rounds;
      const k = Math.max(0, Math.min(rs.length, n));
      for (let i = 0; i < rs.length; i++) rs[i].visible = i < k;
      // stack feeds from the top: the follower rises into the vacated space
      this.parts.follower.position.y =
        this.parts.follower.userData.baseP.y + (rs.length - k) * PITCH;
    },
    // 3 s idle loop: the mainspring breathes under tension, its seat creeping
    // with it, and the bolt rocks a hair in its slot
    idle(t, p) {
      const c = (t % 3) / 3 * Math.PI * 2;
      const breathe = Math.sin(c) * 0.5 + 0.5;            // 0..1, smooth and periodic
      p.spring.scale.z = 1 - breathe * 0.02;
      p.spring.position.z = p.spring.userData.baseP.z + breathe * 0.0017;
      p.springSeat.position.z = p.springSeat.userData.baseP.z - breathe * 0.003;
      p.bolt.position.z = p.bolt.userData.baseP.z + Math.sin(c) * 0.0015;
      p.bolt.rotation.x = 0;
      p.trigger.rotation.x = 0;
      p.mag.position.y = p.mag.userData.baseP.y;
      p.mag.visible = true;
      this._stack(this._mag);
    },
    fire(f, p) {
      // trigger breaks, the bolt slams back against the mainspring — the coil
      // visibly compresses and rebounds — then runs home and the stack drops a
      // round. Blowback: everything is driven by that one spring.
      p.trigger.rotation.x = Math.min(1, f * 6) * (1 - Math.min(1, Math.max(0, f - 0.45) / 0.4)) * 0.5;
      const cycle = Math.sin(Math.min(1, f * 1.75) * Math.PI);   // back then home
      p.bolt.position.z = p.bolt.userData.baseP.z + cycle * 0.058;
      p.spring.scale.z = 1 - cycle * 0.3;                        // coil bunches up
      p.spring.position.z = p.spring.userData.baseP.z + cycle * 0.026;
      p.springSeat.position.z = p.springSeat.userData.baseP.z + cycle * 0.052;
      p.bolt.rotation.x = cycle * 0.05;
      if (f === 0 || this._lastF > f) this._stack(Math.max(0, this._mag - 1));
      this._lastF = f;
    },
    reload(f, p, tactical) {
      const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      // mag release, the box drops clear (the falling one is real debris), a
      // fresh box rocks in and seats
      if (f < 0.36) {
        p.mag.visible = true;
        p.mag.position.y = p.mag.userData.baseP.y - ss(f / 0.36) * 0.055;
      } else if (f < 0.5) {
        p.mag.visible = false;                                   // airborne
      } else {
        p.mag.visible = true;
        const up = ss(Math.min(1, (f - 0.5) / 0.32));
        p.mag.position.y = p.mag.userData.baseP.y - (1 - up) * 0.19;
        this._stack(p.rounds.length);                            // fresh box, full stack
      }
      // Empty reload: the bolt is locked back on the follower and only drops
      // when the fresh box is home. A quick-tap never locks it — the gun is
      // still in battery, so the bolt is simply left alone.
      if (!tactical) {
        const drop = f < 0.84 ? 1 : 1 - ss((f - 0.84) / 0.16);
        p.bolt.position.z = p.bolt.userData.baseP.z + drop * 0.058;
        p.spring.scale.z = 1 - drop * 0.3;
        p.spring.position.z = p.spring.userData.baseP.z + drop * 0.026;
        p.springSeat.position.z = p.springSeat.userData.baseP.z + drop * 0.052;
      }
      p.trigger.rotation.x = 0;
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
  bg.add(tube(0.021, 0.46, blued(), 22, 0, -0.014, -0.26));
  bg.add(tube(0.021, 0.46, blued(), 22, 0, -0.06, -0.26));
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
  // walnut forend riding under the bores (swings up with them), hand-checkered
  bg.add(box(0.056, 0.048, 0.19, walnut(), 0, -0.096, -0.27));
  for (const x of [-0.029, 0.029]) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
      bg.add(box(0.003, 0.0075, 0.0125, walnut(), x, -0.08 - r * 0.012, -0.215 - c * 0.019));
    }
  }
  bg.add(box(0.06, 0.052, 0.018, brass(), 0, -0.094, -0.185)); // brass band
  {                                                            // front sling swivel
    const sw = ring(0.011, 0.0032, steel(), 6, 14);
    sw.position.set(0, -0.136, -0.3); bg.add(sw);
    bg.add(cyl(0.004, 0.004, 0.014, steel(), 8, 0, -0.124, -0.3));
  }
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
  // engraved brass sideplate on the camera-side flank, with scroll rosettes
  g.add(box(0.006, 0.066, 0.115, brass(), -0.0405, -0.005, 0.045));
  for (const z of [0.0, 0.045, 0.09]) g.add(sphere(0.0045, steel(), 6).translateX(-0.0455).translateY(-0.03).translateZ(z));
  for (const [ry, rz] of [[0.015, 0.015], [0.015, 0.075], [-0.022, 0.045]]) {
    const rose = ring(0.011, 0.0022, brassWornMat(), 6, 16);
    rose.rotation.y = Math.PI / 2; rose.position.set(-0.0445, ry, rz);
    g.add(rose);
  }
  // border bead framing all four edges of the plate
  for (let i = 0; i < 11; i++) {
    const z = -0.008 + i * 0.0106;
    for (const y of [0.028, -0.038]) {
      g.add(sphere(0.0022, brassWornMat(), 6).translateX(-0.0445).translateY(y).translateZ(z));
    }
  }
  for (let i = 0; i < 6; i++) {
    const y = 0.028 - i * 0.0132;
    for (const z of [-0.008, 0.098]) {
      g.add(sphere(0.0022, brassWornMat(), 6).translateX(-0.0445).translateY(y).translateZ(z));
    }
  }
  // hinge pin bosses and the forend iron the barrels pivot on
  for (const x of [-0.038, 0.038]) {
    const pin = cyl(0.009, 0.009, 0.008, steel(), 12, x, 0.062, -0.055);
    pin.rotation.z = Math.PI / 2; g.add(pin);
  }
  // rear sling swivel under the stock (the front one rides the barrel group,
  // added with the forend so it cranes up with it)
  {
    const sw = ring(0.011, 0.0032, steel(), 6, 14);
    sw.position.set(0, -0.088, 0.35); g.add(sw);
    g.add(cyl(0.004, 0.004, 0.014, steel(), 8, 0, -0.074, 0.35));
  }
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
  for (const x of [-0.0255, 0.0255]) {                       // checkered panels
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      grip.add(box(0.003, 0.0095, 0.0125, ebony(), x, 0.052 - r * 0.017, -0.017 + c * 0.017));
    }
  }
  grip.position.set(0, -0.095, 0.115); grip.rotation.x = -0.35;
  g.add(grip);
  const stock = box(0.06, 0.095, 0.24, ebony(), 0, -0.03, 0.27);
  stock.rotation.x = 0.13; g.add(stock);
  // ribbed rubber recoil pad on the butt
  g.add(box(0.064, 0.1, 0.018, steel(), 0, -0.048, 0.385).rotateX(0.13));
  for (let i = 0; i < 5; i++) {
    g.add(box(0.058, 0.014, 0.008, leather(), 0, -0.083 + i * 0.02, 0.39).rotateX(0.13));
  }
  g.add(box(0.045, 0.02, 0.1, leather(), 0, 0.026, 0.28).rotateX(0.13)); // cheek pad
  // checkered wrist panels on the stock
  for (const x of [-0.0305, 0.0305]) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      g.add(box(0.003, 0.0095, 0.0125, ebony(), x, -0.005 - r * 0.017, 0.19 + c * 0.018).rotateX(0.13));
    }
  }

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
  const jacket = tube(0.044, 0.32, M.get('gunmetal'), 22, 0, 0.012, -0.29);
  g.add(jacket);
  for (let i = 0; i < 11; i++) { // radiator fins
    const fin = ring(0.05, 0.006, M.get('castIron'), 7, 22);
    fin.position.set(0, 0.012, -0.15 - i * 0.028);
    fin.rotation.x = Math.PI / 2;
    g.add(fin);
  }
  // cooling perforations punched between the fins, two rows down each flank
  for (let i = 0; i < 10; i++) {
    for (const a of [-0.5, 0.5, Math.PI - 0.5, Math.PI + 0.5]) {
      const hole = cyl(0.007, 0.007, 0.008, M.flat(0x0b0b0d, 0.9), 8,
        Math.cos(a) * 0.045, 0.012 + Math.sin(a) * 0.045, -0.164 - i * 0.028);
      hole.rotation.z = Math.PI / 2; hole.rotation.y = Math.PI / 2 - a;
      g.add(hole);
    }
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
    // a real cartridge nose standing in each window — the pan is visibly loaded
    const round = cyl(0.0055, 0.0065, 0.024, brass(), 9, 0, 0, 0);
    round.rotation.z = Math.PI / 2;
    round.position.set(-0.026, Math.cos(a) * 0.042, Math.sin(a) * 0.042);
    drum.add(round);
    const nose = mesh(new THREE.ConeGeometry(0.0052, 0.011, 9), copper(), -0.043, Math.cos(a) * 0.042, Math.sin(a) * 0.042);
    nose.rotation.z = Math.PI / 2;
    drum.add(nose);
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
    reload(f, p, tactical) {
      const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
      if (tactical) {
        // Quick-tap: the drum is not empty, so it never comes off the spindle.
        // The gunner just slaps the feed latch and runs the bolt — a short,
        // tight action that reads as obviously cheaper than a drum swap.
        const slap = Math.sin(ss(Math.min(1, f / 0.45)) * Math.PI);
        p.drum.position.x = p.drum.userData.baseP.x;
        p.drum.position.y = p.drum.userData.baseP.y + slap * 0.012;
        p.drum.visible = true;
        p.drum.rotation.x = this._step + slap * 0.5;
        p.bolt.position.z = p.bolt.userData.baseP.z + Math.sin(ss(Math.max(0, (f - 0.35)) / 0.65) * Math.PI) * 0.055;
        p.valve.material.emissiveIntensity = 0.4;
        return;
      }
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
      p.bolt.position.z = p.bolt.userData.baseP.z;
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
  // Barrel truss: solid collars clamped ON the barrel, tied together by three
  // tension rods that land on them. (This replaced a "skeleton cage" of hoops
  // floating a centimetre off the barrel on stick rails, which read as bent
  // wire flapping loose rather than as structure.)
  for (const z of [-0.66, -0.5, -0.34]) {
    g.add(tube(0.0215, 0.018, steel(), 12, 0, 0.03, z));
    g.add(ring(0.0225, 0.003, brass(), 6, 14).translateY(0.03).translateZ(z));
  }
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
    const rod = tube(0.0042, 0.4, brass(), 8,
      Math.cos(a) * 0.0198, 0.03 + Math.sin(a) * 0.0198, -0.49);
    g.add(rod);
    // knurled tensioner nut where each rod passes the centre collar
    const nut = cyl(0.0075, 0.0075, 0.012, brassWornMat(), 8,
      Math.cos(a) * 0.0198, 0.03 + Math.sin(a) * 0.0198, -0.5);
    nut.rotation.x = Math.PI / 2; g.add(nut);
  }
  // compact blued receiver, long enough to bridge barrel to wrist
  g.add(box(0.055, 0.08, 0.2, blued(), 0, 0.022, -0.015));
  g.add(box(0.05, 0.014, 0.1, steel(), 0, 0.064, -0.062)); // polished top rail
  g.add(box(0.058, 0.02, 0.03, blued(), 0, 0.012, -0.112)); // barrel shank collar
  // ---- the bolt: full lift / draw / return / lock cycle on every shot ----
  const bolt = new THREE.Group();
  const boltBody = tube(0.011, 0.115, steel(), 10, 0, 0, -0.02);
  bolt.add(boltBody);
  bolt.add(barrel(0.013, 0.011, 0.02, steel(), 10, 0, 0, 0.04)); // bolt shroud
  // Bolt handle. The rest pose (turned DOWN against the stock) lives on an
  // inner group so the fire/reload hooks can keep driving handle.rotation.z as
  // an absolute lift. It used to stand straight out sideways on a 5 cm rod,
  // which read as a brass ball floating beside the gun.
  const handle = new THREE.Group();
  const armG = new THREE.Group();
  armG.rotation.z = -0.95;
  const arm = cyl(0.0052, 0.0052, 0.038, steel(), 8);
  arm.rotation.z = Math.PI / 2; arm.position.x = 0.019;
  armG.add(arm);
  armG.add(cyl(0.0075, 0.0075, 0.01, steel(), 8).rotateZ(Math.PI / 2)); // root boss
  armG.add(sphere(0.0115, brass(), 10).translateX(0.042));              // ball knob
  handle.add(armG);
  handle.position.set(0, 0, 0.03);
  anim(handle);
  bolt.add(handle);
  // anim() AFTER positioning: recorded at the origin, the fire hook's
  // `baseP.z + draw` snapped the whole bolt 4.5 cm forward on every shot
  bolt.position.set(0.026, 0.05, 0.045);
  anim(bolt); g.add(bolt);
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
  // Brass telescope: objective bell, turret, glowing reticle eyepiece. Sized
  // to a real 1-inch tube and seated low ON the receiver rail — it used to be
  // fatter than the barrel and stilted 8 cm over the bore, which read as a
  // ship's telescope resting on the gun rather than a mounted sight.
  const SCOPE_Y = 0.086;
  const scopeG = new THREE.Group();
  scopeG.add(tube(0.0135, 0.26, brass(), 14, 0, 0, -0.03));
  scopeG.add(barrel(0.019, 0.0145, 0.05, brass(), 14, 0, 0, -0.185)); // objective bell
  scopeG.add(mesh(new THREE.CircleGeometry(0.0175, 14), M.glass(0x264a5a, 0x0a1820), 0, 0, -0.2105));
  const turret = anim(cyl(0.008, 0.008, 0.014, nickel(), 10, 0, 0.02, -0.04)); // elevation turret
  scopeG.add(turret);
  scopeG.add(cyl(0.008, 0.008, 0.012, nickel(), 10, -0.019, 0, -0.04).rotateZ(Math.PI / 2)); // windage
  scopeG.add(barrel(0.0125, 0.0165, 0.042, blued(), 12, 0, 0, 0.119)); // eyepiece
  const reticle = mesh(new THREE.CircleGeometry(0.0115, 12), M.glow(0x66d9a3, 0.9), 0, 0, 0.141);
  reticle.rotation.y = Math.PI; // faces the shooter
  scopeG.add(reticle);
  scopeG.position.set(0, SCOPE_Y, -0.03);
  g.add(scopeG);
  for (const z of [-0.1, 0.01]) { // split rings clamped to a base on the rail
    const mount = ring(0.0155, 0.0038, nickel(), 6, 16);
    mount.position.set(0, SCOPE_Y, z); g.add(mount);
    g.add(box(0.022, 0.016, 0.018, nickel(), 0, SCOPE_Y - 0.014, z));   // base block
    g.add(box(0.026, 0.005, 0.022, steel(), 0, SCOPE_Y - 0.021, z));    // rail clamp foot
    for (const x of [-0.011, 0.011]) {                                  // clamp screws
      g.add(sphere(0.0032, steel(), 6).translateX(x).translateY(SCOPE_Y - 0.008).translateZ(z));
    }
  }
  // en-bloc clip: five brass noses proud of the receiver during a reload
  const clip = new THREE.Group();
  clip.add(box(0.018, 0.042, 0.032, brass(), 0, 0, 0));
  for (let i = 0; i < 5; i++) clip.add(tube(0.0045, 0.03, copper(), 6, 0, 0.012, -0.011 + i * 0.0055));
  // anim() AFTER positioning, as with the bolt: the reload offsets from baseP
  clip.position.set(0, 0.082, 0.012);
  anim(clip);
  clip.visible = false;
  g.add(clip);
  // trigger housing / floorplate: the strap a real rifle hangs its guard from,
  // running receiver to grip so the grip cannot read as a floating block
  g.add(box(0.044, 0.022, 0.185, blued(), 0, -0.025, 0.038));
  g.add(box(0.048, 0.008, 0.05, steel(), 0, -0.036, -0.03)); // magazine floorplate
  // trigger + guard — the guard loop stands in the YZ plane (a Y rotation), so
  // it reads as a guard from the flank instead of lying flat like a saucer
  const guard = ring(0.026, 0.0045, nickel(), 7, 18);
  guard.rotation.y = Math.PI / 2; guard.position.set(0, -0.042, 0.05);
  guard.scale.set(1, 0.95, 1); g.add(guard);
  const trigger = anim(box(0.007, 0.024, 0.005, brass(), 0, -0.036, 0.042));
  g.add(trigger);
  // Full-length walnut furniture with brass fittings. Every piece overlaps the
  // one behind it — fore-end into receiver, receiver into wrist, wrist into
  // butt, grip up into the wrist — so the rifle reads as one object. The old
  // layout left 5 cm of open air between receiver and butt and hung the grip
  // below the frame entirely.
  g.add(box(0.042, 0.05, 0.5, walnut(), 0, -0.006, -0.355));       // fore-end
  g.add(box(0.046, 0.054, 0.02, brass(), 0, -0.006, -0.596));      // fore cap
  for (const z of [-0.545, -0.36]) {                               // barrel bands
    g.add(box(0.05, 0.05, 0.016, brass(), 0, 0.008, z));
  }
  const wrist = box(0.046, 0.056, 0.115, walnut(), 0, 0.0, 0.135); // receiver → butt
  wrist.rotation.x = 0.08; g.add(wrist);
  const grip = new THREE.Group();
  grip.add(box(0.044, 0.125, 0.056, walnut(), 0, 0, 0));
  grip.add(box(0.048, 0.036, 0.06, leather(), 0, -0.024, 0));      // leather wrap
  grip.add(box(0.044, 0.012, 0.048, brassWornMat(), 0, -0.06, 0)); // grip cap
  grip.position.set(0, -0.058, 0.134); grip.rotation.x = -0.32;
  g.add(grip);
  const butt = box(0.048, 0.098, 0.25, walnut(), 0, -0.022, 0.28);
  butt.rotation.x = 0.11; g.add(butt);
  g.add(box(0.052, 0.105, 0.016, brass(), 0, -0.04, 0.4).rotateX(0.11));  // brass buttplate
  g.add(box(0.038, 0.02, 0.11, leather(), 0, 0.042, 0.27).rotateX(0.11)); // cheek riser
  for (const [y, z] of [[-0.036, -0.5], [-0.078, 0.33]]) {         // sling loops
    const l = ring(0.009, 0.003, steel(), 6, 12);
    l.position.set(0, y, z); g.add(l);
    g.add(cyl(0.0035, 0.0035, 0.012, steel(), 8, 0, y + 0.011, z));
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
  g.add(cyl(0.05, 0.026, 0.6, oak(), 24, 0, 0.11, 0));
  g.add(cyl(0.05, 0.046, 0.05, oak(), 24, 0, 0.42, 0)); // crown
  // hammered-iron cladding plates riveted around the head, proud studs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const plate = box(0.038, 0.2, 0.012, hammered(), 0, 0.3, 0);
    plate.position.x = Math.cos(a) * 0.045;
    plate.position.z = Math.sin(a) * 0.045;
    plate.rotation.y = -a + Math.PI / 2;
    g.add(plate);
    for (const dy of [-0.075, -0.025, 0.025, 0.075]) { // stud rows
      const stud = sphere(0.009, steel(), 7);
      stud.position.set(Math.cos(a) * 0.055, 0.3 + dy, Math.sin(a) * 0.055);
      g.add(stud);
    }
  }
  for (const y of [0.21, 0.3, 0.39]) { // iron retaining bands
    const band = ring(0.049, 0.007, hammered(), 8, 22);
    band.rotation.x = Math.PI / 2; band.position.y = y;
    g.add(band);
  }
  // compression spring collar at the neck — real wound wire, slams on impact
  const springG = new THREE.Group();
  // the helix runs from its own origin toward +Y once rotated, so it seats at 0
  const wire = coil(0.036, 0.006, 0.088, 5, steel(), 16);
  wire.rotation.x = Math.PI / 2;   // helix axis -Z → +Y
  springG.add(wire);
  // anim() AFTER positioning: the fire hook offsets from baseP, and recording
  // it at the origin made the collar snap to y=0 on the first swing
  springG.position.set(0, 0.08, 0);
  anim(springG); g.add(springG);
  g.add(cyl(0.042, 0.042, 0.014, hammered(), 14, 0, 0.175, 0)); // spring stop washer
  // grip: leather core bound with a wound leather cord, iron pommel
  g.add(cyl(0.03, 0.03, 0.2, leather(), 14, 0, -0.08, 0));
  const bind = coil(0.0325, 0.005, 0.185, 15, leather(), 12);
  bind.rotation.x = Math.PI / 2; bind.position.y = -0.172;
  g.add(bind);
  g.add(cyl(0.038, 0.032, 0.035, hammered(), 14, 0, -0.2, 0));
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
      p.spring.position.y = p.spring.userData.baseP.y;   // undo the swing's shift
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
