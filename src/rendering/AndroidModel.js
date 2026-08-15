import * as THREE from '../../lib/three.module.js';

/**
 * THE ADJUTANT — a refurbished companion android, and the only thing in
 * this town that walks beside you on purpose.
 *
 * She is built as a MACHINE SHAPED LIKE A PERSON, not as a person: enamel
 * panels with the seams showing, a chest core you can see running, cable looms
 * at the joints, and a service plate on her back with a county asset number on
 * it. The catgirl read comes from the silhouette — a bob, two swivelling ears,
 * a long counterweight tail — and every one of those is a mechanism with a job:
 * the ears are her directional microphones and they point at what she is
 * listening to, the tail is her balance mass and it swings against her turns,
 * and the bob is a cooling shroud with vents in it.
 *
 * SHE CARRIES NO GUN, and that is a design rule rather than an oversight. What
 * she has is built in and folded away where you cannot see it until she needs
 * it:
 *
 *   BLADES   one in each forearm. They slide out along the arm and lock over
 *            square, which is the whole animation — extend, then rotate.
 *   PODS     two on her shoulder blades, flush with the back plate until they
 *            hinge up and split open into an arc emitter each.
 *   CORE     the ring in her chest spins up and lights before either fires,
 *            so there is always a tell before anything happens.
 *
 * SHE IS SHORTER THAN YOU. HEIGHT is measured off the assembled rig and
 * checked against Player.height in tests/shop.mjs — you look down at her, and
 * that is deliberate: she reads as something you are responsible for.
 *
 * ── THE RIG ───────────────────────────────────────────────────────────────
 * Every joint here is driven by CompanionAnimator (below), which writes a POSE
 * and lets _apply ease the rig onto it. That is what makes the states flow
 * into one another without a single explicit transition being authored: the
 * pose is a target, not a keyframe, so walk-to-alert-to-melee is a continuous
 * thing whatever order it happens in.
 *
 *   hips           the whole body above the feet: bob, sway, turn
 *   spine → chest  lean and breathe; the core rides the chest
 *   head           yaw/pitch/roll, and the face plate on the front of it
 *   ears[]         two pivots: swivel toward sound, flick, flatten when cross
 *   hair           the shroud, with a little lag behind the head
 *   arms[]         shoulder → elbow → wrist → hand, plus the blade in the arm
 *   legs[]         hip → knee → ankle → foot
 *   tail[]         six segments, each following the one before it
 *   pods[]         lid + two emitter halves, per shoulder blade
 *   core           the chest ring, and the light inside it
 */

/** Ground to the tips of her ears. The player is 1.75 m. */
export const ANDROID_HEIGHT = 1.42;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* the face                                                            */
/* ------------------------------------------------------------------ */

/**
 * Her face, painted at 48×32 and left unfiltered so it wears the same pixel
 * grid as every texture in the game.
 *
 * It is a PANEL, not a face: a dark visor band with two lit lozenges behind it
 * and a small speaker grille for a mouth. Everything expressive about her is
 * done with the rig — ears, head tilt, tail — because a machine's face does
 * not move, and pretending otherwise is what makes an android look like a
 * cartoon instead of a machine.
 */
function faceTexture() {
  const W = 48, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const px = (a, b, w, h, col) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  px(0, 0, W, H, '#d9d2c4');                 // the enamel of the face plate
  px(0, 0, W, 5, '#c4bcac');                 // shaded under the brow
  px(0, H - 4, W, 4, '#c4bcac');
  for (let i = 0; i < 90; i++) {             // wear in the paint
    const a = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * W;
    const b = (Math.sin(i * 78.233) * 43758.5453 % 1 + 1) % 1 * H;
    px(a | 0, b | 0, 1, 1, i % 3 ? '#cfc7b8' : '#bab2a2');
  }
  px(4, 9, W - 8, 10, '#1b2028');            // the visor band
  px(4, 9, W - 8, 1, '#39424e');             // its top bevel
  px(10, 12, 8, 4, '#7ce8d0');               // left eye lozenge
  px(30, 12, 8, 4, '#7ce8d0');               // right
  px(11, 13, 6, 2, '#d6fff4');               // the hot core of each
  px(31, 13, 6, 2, '#d6fff4');
  px(21, 21, 6, 2, '#8d8577');               // the speaker grille
  px(21, 24, 6, 1, '#8d8577');
  px(20, 20, 8, 6, 'rgba(0,0,0,0)');
  px(21, 21, 6, 1, '#6c6558');
  px(21, 23, 6, 1, '#6c6558');
  px(21, 25, 6, 1, '#6c6558');
  px(2, 27, 12, 2, '#a89a6e');               // a stencilled unit number
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The service plate on her back — the county owned her once. */
function plateTexture() {
  const W = 32, H = 24;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#8a6a2c'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#6a4f1e'; x.fillRect(1, 1, W - 2, H - 2);
  x.fillStyle = '#d8c48a';
  x.fillRect(3, 4, 26, 1);
  x.fillRect(3, 8, 18, 1);
  x.fillRect(3, 12, 22, 1);
  x.fillRect(3, 16, 14, 1);
  x.fillStyle = '#c8a244';
  for (let i = 0; i < 4; i++) x.fillRect(24 + (i % 2) * 3, 8 + Math.floor(i / 2) * 3, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* the rig                                                             */
/* ------------------------------------------------------------------ */

export function buildAndroidModel(texLib = null) {
  const M = (hex, opts = {}) => new THREE.MeshLambertMaterial({ color: hex, ...opts });
  const enamel = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('vendorEnamel') })
    : M(0xd9d2c4);
  const shell = M(0xdcd6c8);        // her painted panels
  const shellDim = M(0xb9b2a2);     // the same, in shadow / underside
  const joint = M(0x3a3f46);        // the exposed articulation
  const steel = M(0x8f97a0);
  const oil = M(0x1a1c20);
  const trim = M(0x7a3f5a);         // the plum the county painted its adjutants
  const trimLit = M(0x9c5474);
  const brass = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('vendorBrass') })
    : M(0xa8842c);
  const hairMat = M(0x3c3a46);
  // Emissive, and kept as materials because the animator drives them:
  const eyeMat = new THREE.MeshBasicMaterial({ map: faceTexture() });
  const coreMat = M(0x1d3a38, { emissive: 0x0d5f52 });
  const bladeMat = M(0xb9c2cc, { emissive: 0x102028 });
  const arcMat = M(0x2a4a58, { emissive: 0x1a6a7a });
  const glowMat = M(0x2a3a44, { emissive: 0x11525f });

  const g = new THREE.Group();
  const parts = { ears: [], arms: [], legs: [], tail: [], pods: [], vents: [] };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const sph = (r, m, w = 8, h = 6) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  const add = (parent, o, x, y, z) => { parent.add(at(o, x, y, z)); return o; };

  /* ================================================================== *
   * LEGS — hip, knee, ankle, and a foot that stays flat                *
   * ================================================================== */

  const HIP_Y = 0.72;
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  g.add(hips);
  parts.hips = hips;

  // the pelvis casting, and the plum skirt panel over it
  add(hips, box(0.23, 0.15, 0.17, shell), 0, -0.02, 0);
  add(hips, box(0.25, 0.06, 0.19, trim), 0, -0.08, 0);
  for (const sx of [-1, 1]) add(hips, cyl(0.045, 0.045, 0.10, joint, 8), sx * 0.085, -0.06, 0)
    .rotateZ(Math.PI / 2);

  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.085, -0.075, 0);
    hips.add(hip);
    const THIGH = 0.30, SHIN = 0.28;
    add(hip, box(0.095, THIGH, 0.105, shell), 0, -THIGH / 2, 0);
    add(hip, box(0.055, THIGH * 0.7, 0.02, joint), side * 0.05, -THIGH / 2, -0.045);   // seam
    add(hip, cyl(0.030, 0.030, 0.075, joint, 8), 0, -THIGH * 0.55, 0).rotateZ(Math.PI / 2);

    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    add(knee, sph(0.048, steel), 0, 0, 0);
    add(knee, box(0.075, SHIN, 0.085, shell), 0, -SHIN / 2, 0);
    add(knee, box(0.055, SHIN * 0.5, 0.02, trim), 0, -SHIN * 0.45, 0.045);
    // the actuator down the back of the shin, because a leg has one
    add(knee, cyl(0.016, 0.016, SHIN * 0.7, steel, 6), 0, -SHIN * 0.45, -0.055);
    for (let k = 0; k < 4; k++) {
      add(knee, new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.004, 4, 8), oil),
        0, -0.06 - k * 0.05, -0.055).rotateX(Math.PI / 2);
    }

    const ankle = new THREE.Group();
    ankle.position.y = -SHIN;
    knee.add(ankle);
    add(ankle, cyl(0.030, 0.030, 0.055, joint, 8), 0, 0, 0).rotateZ(Math.PI / 2);
    const foot = new THREE.Group();
    ankle.add(foot);
    add(foot, box(0.095, 0.055, 0.20, shell), 0, -0.045, 0.035);
    add(foot, box(0.100, 0.020, 0.075, oil), 0, -0.070, 0.095);       // the sole's toe pad
    add(foot, box(0.100, 0.020, 0.060, oil), 0, -0.070, -0.030);      // and its heel
    add(foot, box(0.030, 0.030, 0.030, trim), 0, -0.030, 0.125);      // toe cap
    parts.legs.push({ side, hip, knee, ankle, foot, thigh: THIGH, shin: SHIN });
  }

  /* ================================================================== *
   * SPINE, CHEST, CORE — and the pods folded into her back             *
   * ================================================================== */

  const spine = new THREE.Group();
  spine.position.y = 0.06;
  hips.add(spine);
  parts.spine = spine;
  add(spine, box(0.19, 0.13, 0.15, shell), 0, 0.06, 0);              // the waist

  const chest = new THREE.Group();
  chest.position.y = 0.14;
  spine.add(chest);
  parts.chest = chest;
  add(chest, box(0.26, 0.22, 0.17, shell), 0, 0.09, 0);              // the ribcage shell
  add(chest, box(0.27, 0.055, 0.18, trim), 0, 0.185, 0);             // the collar band
  add(chest, box(0.20, 0.10, 0.02, shellDim), 0, 0.03, 0.086);       // the lower plate seam
  // the service plate on her back, with the county's asset number on it
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.08),
    new THREE.MeshBasicMaterial({ map: plateTexture() }));
  plateMesh.rotation.y = Math.PI;
  add(chest, plateMesh, 0, 0.055, -0.0862);

  // --- the core: a ring in her chest that spins and lights before anything
  const core = new THREE.Group();
  core.position.set(0, 0.10, 0.078);
  chest.add(core);
  parts.core = core;
  parts.coreMat = coreMat;
  add(core, cyl(0.048, 0.048, 0.020, steel, 14), 0, 0, 0).rotateX(Math.PI / 2);
  const coreRing = add(core, new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 6, 14), brass), 0, 0, 0.006);
  parts.coreRing = coreRing;
  for (let i = 0; i < 6; i++) {                                       // the rotor inside it
    const a = (i / 6) * TAU;
    add(coreRing, box(0.010, 0.026, 0.006, steel), Math.sin(a) * 0.024, Math.cos(a) * 0.024, 0);
  }
  parts.coreLight = add(core, new THREE.Mesh(new THREE.CircleGeometry(0.030, 14), coreMat), 0, 0, 0.012);

  // --- the dorsal pods: flush until they hinge up and split open
  for (const side of [-1, 1]) {
    const pod = new THREE.Group();
    pod.position.set(side * 0.075, 0.135, -0.082);
    chest.add(pod);
    add(pod, box(0.085, 0.100, 0.030, shellDim), 0, 0, -0.012);       // the housing
    const lid = new THREE.Group();
    pod.add(lid);
    add(lid, box(0.085, 0.100, 0.016, shell), 0, 0, 0.004);           // the cover, flush
    // the two emitter halves inside, which split apart when it opens
    const jawA = new THREE.Group(), jawB = new THREE.Group();
    pod.add(jawA); pod.add(jawB);
    add(jawA, box(0.020, 0.075, 0.026, steel), 0, 0, -0.012);
    add(jawB, box(0.020, 0.075, 0.026, steel), 0, 0, -0.012);
    const tipA = add(jawA, sph(0.014, arcMat), 0, 0.048, -0.012);
    const tipB = add(jawB, sph(0.014, arcMat), 0, 0.048, -0.012);
    parts.pods.push({ side, pod, lid, jawA, jawB, tipA, tipB });
  }
  parts.arcMat = arcMat;

  // --- cooling vents down her flanks, which open when she has been working
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Group();
      v.position.set(side * 0.132, 0.045 + i * 0.038, 0);
      chest.add(v);
      add(v, box(0.008, 0.010, 0.090, glowMat), 0, 0, 0);
      parts.vents.push(v);
    }
  }
  parts.glowMat = glowMat;

  /* ================================================================== *
   * ARMS — shoulder, elbow, wrist, hand, and the blade in the forearm  *
   * ================================================================== */

  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.145, 0.155, 0);
    chest.add(shoulder);
    add(shoulder, sph(0.052, trim), 0, 0, 0);                         // the pauldron
    add(shoulder, box(0.075, 0.045, 0.095, trimLit), side * 0.018, 0.020, 0);
    add(shoulder, cyl(0.032, 0.032, 0.060, joint, 8), 0, -0.015, 0).rotateZ(Math.PI / 2);

    const UPPER = 0.215, FORE = 0.195;
    add(shoulder, box(0.070, UPPER, 0.070, shell), 0, -UPPER / 2 - 0.02, 0);
    add(shoulder, box(0.030, UPPER * 0.6, 0.012, joint), side * 0.038, -UPPER / 2, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -UPPER - 0.02;
    shoulder.add(elbow);
    add(elbow, sph(0.040, steel), 0, 0, 0);

    const forearm = new THREE.Group();
    elbow.add(forearm);
    add(forearm, box(0.062, FORE, 0.075, shell), 0, -FORE / 2, 0);
    add(forearm, box(0.066, 0.045, 0.079, trim), 0, -FORE + 0.03, 0);  // the cuff

    // THE BLADE. Housed inside the forearm and invisible until it is wanted,
    // then driven DOWN past the hand and locked over square.
    //
    // Down rather than forward, and outboard of the wrist rather than through
    // it, because this has to read from thirty metres away in a silhouette:
    // a blade that extends along the line of sight is a dot, and a blade that
    // extends past the fist is unmistakable. The rail it runs on is on show
    // above it for the same reason the sentry's bolt is.
    const bladeHouse = new THREE.Group();
    bladeHouse.position.set(side * 0.046, -FORE * 0.42, 0.006);
    forearm.add(bladeHouse);
    add(bladeHouse, box(0.014, FORE * 0.7, 0.020, joint), 0, -0.02, 0);   // the rail
    const blade = new THREE.Group();
    bladeHouse.add(blade);
    add(blade, box(0.020, 0.070, 0.030, steel), 0, 0.02, 0);             // the carrier
    add(blade, box(0.016, 0.200, 0.026, bladeMat), 0, -0.115, 0);        // the spine
    add(blade, box(0.006, 0.190, 0.052, bladeMat), 0, -0.120, 0.014);    // the edge
    add(blade, box(0.010, 0.045, 0.020, bladeMat), 0, -0.230, 0.006);    // the point
    blade.visible = false;

    const wrist = new THREE.Group();
    wrist.position.y = -FORE;
    forearm.add(wrist);
    add(wrist, cyl(0.026, 0.026, 0.045, joint, 8), 0, 0, 0).rotateZ(Math.PI / 2);
    const hand = new THREE.Group();
    wrist.add(hand);
    add(hand, box(0.055, 0.075, 0.038, shell), 0, -0.040, 0);
    for (let f = 0; f < 3; f++) {                                      // three fingers
      add(hand, box(0.013, 0.050, 0.014, shellDim), -0.016 + f * 0.016, -0.098, 0.006);
    }
    add(hand, box(0.013, 0.038, 0.014, shellDim), side * 0.026, -0.084, -0.012);  // thumb

    parts.arms.push({ side, shoulder, elbow, forearm, wrist, hand, blade, bladeMat });
  }
  parts.bladeMat = bladeMat;

  /* ================================================================== *
   * HEAD — plate, shroud, and two ears that point at things            *
   * ================================================================== */

  const neck = new THREE.Group();
  neck.position.y = 0.205;
  chest.add(neck);
  add(neck, cyl(0.036, 0.042, 0.055, joint, 10), 0, 0.02, 0);

  const head = new THREE.Group();
  head.position.y = 0.075;
  neck.add(head);
  parts.head = head;
  add(head, box(0.165, 0.155, 0.155, shell), 0, 0.02, 0);
  add(head, box(0.140, 0.045, 0.020, shellDim), 0, -0.055, 0.070);     // the jaw line
  // the face plate itself, standing a hair proud of the skull
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.145, 0.115), eyeMat);
  add(head, face, 0, 0.025, 0.0785);
  parts.face = face;
  parts.eyeMat = eyeMat;

  // the shroud — her "hair" — a shell over the back and sides with vents in it
  const hair = new THREE.Group();
  head.add(hair);
  parts.hair = hair;
  add(hair, box(0.185, 0.150, 0.055, hairMat), 0, 0.030, -0.062);      // the back of it
  add(hair, box(0.045, 0.170, 0.150, hairMat), -0.078, 0.020, -0.010); // the sides
  add(hair, box(0.045, 0.170, 0.150, hairMat), 0.078, 0.020, -0.010);
  add(hair, box(0.180, 0.045, 0.150, hairMat), 0, 0.090, -0.010);      // the crown
  add(hair, box(0.155, 0.035, 0.020, hairMat), 0, 0.070, 0.078);       // the fringe
  for (let i = 0; i < 3; i++) {                                        // its cooling slots
    add(hair, box(0.100, 0.006, 0.010, oil), 0, 0.010 + i * 0.022, -0.090);
  }
  // the two side falls, longer, which lag behind the head when she turns
  for (const side of [-1, 1]) {
    const fall = new THREE.Group();
    fall.position.set(side * 0.082, 0.010, 0.010);
    hair.add(fall);
    add(fall, box(0.035, 0.150, 0.080, hairMat), 0, -0.075, 0);
    add(fall, box(0.028, 0.060, 0.060, hairMat), 0, -0.170, 0.006);
    parts[side < 0 ? 'fallL' : 'fallR'] = fall;
  }

  // THE EARS. Directional microphones on two axes: they swivel toward what
  // she is listening to, flick when startled, and lie flat when she is cross.
  for (const side of [-1, 1]) {
    const base = new THREE.Group();
    base.position.set(side * 0.058, 0.105, -0.012);
    head.add(base);
    const ear = new THREE.Group();
    base.add(ear);
    add(ear, cyl(0.010, 0.048, 0.115, hairMat, 6), 0, 0.058, 0);       // the cone
    add(ear, cyl(0.006, 0.030, 0.090, trim, 6), 0, 0.052, 0.010);      // the pink inside
    add(ear, cyl(0.014, 0.014, 0.016, steel, 8), 0, 0.002, 0);         // the bearing
    const tip = add(ear, sph(0.010, glowMat), 0, 0.112, 0);            // a lit tip
    parts.ears.push({ side, base, ear, tip });
  }
  // and the one loose strand that will not lie down, because every one of
  // these units has one and the county gave up trying to fix it
  const ahoge = new THREE.Group();
  ahoge.position.set(0.012, 0.105, -0.02);
  head.add(ahoge);
  add(ahoge, cyl(0.005, 0.008, 0.075, hairMat, 5), 0, 0.036, 0).rotateX(-0.5);
  parts.ahoge = ahoge;

  /* ================================================================== *
   * TAIL — six segments, a counterweight, and the best thing she has   *
   * ================================================================== */

  let node = hips;
  const tailBase = new THREE.Group();
  tailBase.position.set(0, -0.05, -0.085);
  hips.add(tailBase);
  node = tailBase;
  for (let i = 0; i < 6; i++) {
    const segLen = 0.105 - i * 0.008;
    const seg = new THREE.Group();
    seg.position.y = i === 0 ? 0 : -0;
    seg.position.z = i === 0 ? 0 : -(0.105 - (i - 1) * 0.008);
    node.add(seg);
    const t = i / 5;
    add(seg, box(0.052 - t * 0.020, 0.052 - t * 0.020, segLen, hairMat), 0, 0, -segLen / 2);
    add(seg, cyl(0.024 - t * 0.008, 0.024 - t * 0.008, 0.018, joint, 8), 0, 0, 0).rotateX(Math.PI / 2);
    if (i === 5) {
      add(seg, sph(0.030, trim), 0, 0, -segLen);                        // the tuft
      add(seg, cyl(0.006, 0.006, 0.030, glowMat, 6), 0, 0, -segLen - 0.02).rotateX(Math.PI / 2);
    }
    parts.tail.push(seg);
    node = seg;
  }

  return { group: g, parts, height: ANDROID_HEIGHT };
}

/* ================================================================== *
 * THE ANIMATOR                                                        *
 * ================================================================== */

/** The idle sets she cycles through when there is nothing else to do. */
export const IDLE_SETS = ['survey', 'groom', 'stretch', 'listen', 'tailchase', 'doze'];

const ease = (t) => t * t * (3 - 2 * t);
const pulse = (t, up = 0.2, down = 0.25) => (t < up ? ease(t / up)
  : t > 1 - down ? ease((1 - t) / down) : 1);
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Drives the rig from a state name and a little context.
 *
 * The important idea here is the same one the vendor uses and it is worth
 * restating: every state writes a POSE — a plain object of joint targets — and
 * `_apply` eases the rig toward that pose rather than setting it. Nothing in
 * here authors a transition, and yet every transition works, because there is
 * no such thing as a cut: walk into alert into melee into stow is one
 * continuous easing of the same numbers. A state that ends leaves the rig
 * wherever it happens to be and the next one pulls it home.
 *
 * The one exception is the blades and the pods, which are MECHANISMS: those
 * have their own extend/retract clocks, because a blade that eased out would
 * look like it was being pushed rather than fired.
 */
export class CompanionAnimator {
  constructor(rig) {
    this.rig = rig;
    this.t = 0;
    this.state = 'fold';
    this.stateT = 0;
    this.idleSet = 'survey';
    this.idleT = 0;
    this.idleHold = 1.4;
    // gait
    this.stride = 0;        // the leg cycle's own phase, advanced by speed
    this.speed = 0;
    // mechanisms, 0..1, with their own clocks
    this.bladeOut = 0;
    this.podOut = 0;
    this.charge = 0;
    this.wantBlades = false;
    this.wantPods = false;
    // what she is looking at, in her own frame
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.earYaw = 0;
    this.mood = 0;          // -1 cross, 0 neutral, +1 pleased
    this._blink = 2 + Math.random() * 3;
    this._flick = 1 + Math.random() * 2;
    // smoothed rig state, so _apply can ease rather than set
    this._s = {};
  }

  setState(name) {
    if (this.state === name) return;
    this.state = name;
    this.stateT = 0;
    if (name === 'idle') this._nextIdle();
  }

  /** Pick a different idle from the one just played — never the same twice. */
  _nextIdle() {
    const pool = IDLE_SETS.filter((s) => s !== this.idleSet);
    this.idleSet = pool[(Math.random() * pool.length) | 0];
    this.idleT = 0;
    this.idleHold = 0.8 + Math.random() * 2.2;
  }

  /**
   * @param dt     seconds
   * @param ctx    { speed, lookAt, threat, moving } — how fast she is going,
   *               where she is looking in her own frame, and whether anything
   *               is worth being tense about
   */
  update(dt, ctx = {}) {
    this.t += dt;
    this.stateT += dt;
    this.speed = lerp(this.speed, ctx.speed || 0, Math.min(1, dt * 6));
    // the leg cycle runs off DISTANCE, not time, so her feet never skate
    this.stride += (ctx.speed || 0) * dt * 3.0;
    this.lookYaw = lerp(this.lookYaw, ctx.lookYaw || 0, Math.min(1, dt * 5));
    this.lookPitch = lerp(this.lookPitch, ctx.lookPitch || 0, Math.min(1, dt * 5));
    this.mood = lerp(this.mood, ctx.mood ?? 0, Math.min(1, dt * 2));

    // mechanisms run on their own clocks — snap out, draw back
    this.bladeOut = Math.max(0, Math.min(1, this.bladeOut + (this.wantBlades ? dt * 5.5 : -dt * 3)));
    this.podOut = Math.max(0, Math.min(1, this.podOut + (this.wantPods ? dt * 3.4 : -dt * 2.2)));
    this.charge = Math.max(0, this.charge - dt * 1.6);

    const pose = this._rest();
    const fn = this[`_pose_${this.state}`];
    if (fn) fn.call(this, pose, dt, ctx);
    this._apply(pose, dt);
  }

  /** The pose everything starts from: standing, arms down, tail low. */
  _rest() {
    return {
      hipY: 0, hipRoll: 0, hipYaw: 0, hipPitch: 0,
      spinePitch: 0.02, spineRoll: 0, chestPitch: 0,
      headYaw: this.lookYaw, headPitch: this.lookPitch, headRoll: 0,
      earPitch: 0, earYaw: 0, earSpread: 0,
      armL: { pitch: 0.06, roll: 0.10, elbow: -0.22, wrist: 0 },
      armR: { pitch: 0.06, roll: 0.10, elbow: -0.22, wrist: 0 },
      legL: { hip: 0, knee: 0, ankle: 0 },
      legR: { hip: 0, knee: 0, ankle: 0 },
      tail: { curl: 0.30, sway: 0, lift: 0.12 },
      glow: 0.25,
    };
  }

  /* ---- states ---- */

  /** Folded into the satchel: knees to chest, tail round, ears flat. */
  _pose_fold(o) {
    o.hipY = -0.42;
    o.spinePitch = 0.85;
    o.headPitch = 0.55;
    o.earPitch = -1.1;
    // tucked in against the knees — negative roll is toward the chest, and
    // both arms take the same number because _apply mirrors it
    o.armL = { pitch: 1.5, roll: -0.25, elbow: -2.2, wrist: 0 };
    o.armR = { pitch: 1.5, roll: -0.25, elbow: -2.2, wrist: 0 };
    o.legL = { hip: -1.7, knee: 2.3, ankle: 0.5 };
    o.legR = { hip: -1.7, knee: 2.3, ankle: 0.5 };
    o.tail = { curl: 1.5, sway: 0, lift: -0.2 };
    o.glow = 0.02;
  }

  /**
   * Coming out of the fold: she uncurls, plants a foot, stands, and then does
   * the one bit of theatre she has — a stretch with the ears flat back, the
   * way anything does when it gets up.
   */
  _pose_unfold(o) {
    const f = Math.min(1, this.stateT / 2.4);
    const k = ease(Math.min(1, f / 0.55));
    const stretch = f > 0.6 ? pulse((f - 0.6) / 0.4, 0.3, 0.4) : 0;
    o.hipY = lerp(-0.42, 0, k) + stretch * 0.04;
    o.spinePitch = lerp(0.85, 0.02, k) - stretch * 0.22;
    o.chestPitch = -stretch * 0.14;
    o.headPitch = lerp(0.55, 0, k) - stretch * 0.35;
    o.earPitch = lerp(-1.1, 0, k) - stretch * 0.7;
    // out of the tuck and then thrown wide for the stretch, both arms alike
    const armK = {
      pitch: lerp(1.5, 0.06, k) - stretch * 1.9,
      roll: lerp(-0.25, 0.10, k) + stretch * 0.35,
      elbow: lerp(-2.2, -0.22, k) + stretch * 0.6,
      wrist: 0,
    };
    o.armL = { ...armK }; o.armR = { ...armK };
    const legK = { hip: lerp(-1.7, 0, k), knee: lerp(2.3, 0, k), ankle: lerp(0.5, 0, k) };
    o.legL = { ...legK }; o.legR = { ...legK };
    o.tail = { curl: lerp(1.5, 0.30, k) - stretch * 0.5, sway: Math.sin(f * 9) * 0.2 * stretch, lift: lerp(-0.2, 0.12, k) + stretch * 0.5 };
    o.glow = k;
  }

  /** Standing about, cycling little routines. */
  _pose_idle(o, dt) {
    this.idleT += dt;
    const breathe = Math.sin(this.t * 1.5) * 0.012;
    o.chestPitch = breathe;
    o.hipY = Math.sin(this.t * 1.5) * 0.006;
    o.tail.sway = Math.sin(this.t * 0.8) * 0.20;
    o.tail.curl = 0.30 + Math.sin(this.t * 0.55) * 0.10;
    o.headYaw += Math.sin(this.t * 0.42 + 1.1) * 0.06;

    const DUR = { survey: 4.2, groom: 5.0, stretch: 3.4, listen: 3.0, tailchase: 4.6, doze: 6.0 }[this.idleSet];
    const f = Math.min(1, this.idleT / DUR);
    const k = pulse(f, 0.2, 0.25);
    switch (this.idleSet) {
      case 'survey': {                       // looks down the road and back
        const s = Math.sin(this.idleT * 0.9);
        o.headYaw += s * 0.7 * k;
        o.earYaw = s * 0.5 * k;
        o.hipYaw = s * 0.10 * k;
        break;
      }
      case 'groom': {                        // cleans the back of a hand. Cat.
        // The one pose that is meant to be one-sided: the negative roll takes
        // that hand ACROSS to her face, and only that arm is written.
        const s = Math.sin(this.idleT * 4.2);
        o.armR = { pitch: 1.75 * k + 0.06, roll: -0.55 * k, elbow: -1.85 * k - 0.22, wrist: s * 0.3 * k };
        o.headPitch += 0.42 * k;
        o.headRoll = s * 0.12 * k;
        o.earPitch = -0.25 * k;
        o.tail.curl += 0.35 * k;
        break;
      }
      case 'stretch': {                      // the full one, ears back
        const s = pulse(f, 0.3, 0.35);
        o.spinePitch -= 0.30 * s;
        o.chestPitch -= 0.12 * s;
        o.headPitch -= 0.40 * s;
        o.earPitch = -0.85 * s;
        o.armL = { pitch: -1.6 * s + 0.06, roll: 0.4 * s, elbow: -0.3, wrist: 0 };
        o.armR = { pitch: -1.6 * s + 0.06, roll: 0.4 * s, elbow: -0.3, wrist: 0 };
        o.tail.lift += 0.7 * s;
        o.hipY += 0.02 * s;
        break;
      }
      case 'listen': {                       // both ears swing onto one bearing
        const s = Math.sin(this.idleT * 1.6);
        o.earYaw = s * 0.85 * k;
        o.earPitch = 0.25 * k;
        o.headYaw += s * 0.22 * k;
        o.headRoll = -s * 0.10 * k;
        break;
      }
      case 'tailchase': {                    // she goes after it. Twice.
        const s = this.idleT * 3.4;
        o.hipYaw = Math.sin(s) * 0.55 * k;
        o.spineRoll = Math.sin(s) * 0.14 * k;
        o.headYaw = Math.sin(s) * 1.0 * k;
        o.headPitch = 0.30 * k;
        o.tail.sway = Math.sin(s + 1.2) * 0.8 * k;
        o.tail.curl = 0.30 + 0.5 * k;
        o.earPitch = 0.35 * k;
        break;
      }
      case 'doze': {                         // she sits down and nods off
        const droop = Math.min(1, f * 1.7);
        const jerk = f > 0.74 ? Math.exp(-(f - 0.74) * 22) : 0;
        o.hipY = -0.22 * droop;
        o.legL = { hip: -0.9 * droop, knee: 1.5 * droop, ankle: -0.3 * droop };
        o.legR = { hip: -0.9 * droop, knee: 1.5 * droop, ankle: -0.3 * droop };
        o.spinePitch += 0.12 * droop;
        o.headPitch += 0.5 * droop * (1 - jerk) - 0.3 * jerk;
        o.earPitch = -0.5 * droop * (1 - jerk);
        o.tail.curl = 0.3 + 0.9 * droop;
        o.tail.sway = Math.sin(this.t * 0.5) * 0.12;
        o.glow = 0.25 - 0.18 * droop * (1 - jerk);
        break;
      }
    }
    if (this.idleT > DUR + this.idleHold) this._nextIdle();
  }

  /**
   * WALK. A four-beat gait driven by distance travelled, with the tail and the
   * arms counter-swinging — which is the thing that stops a walk cycle looking
   * like a doll being slid along the floor.
   */
  _pose_walk(o) {
    const s = this.stride;
    const amp = Math.min(1, this.speed / 2.2);
    const bounce = Math.abs(Math.sin(s)) * 0.030 * amp;
    o.hipY = bounce - 0.012 * amp;
    o.hipRoll = Math.sin(s) * 0.055 * amp;
    o.hipYaw = -Math.sin(s) * 0.10 * amp;
    o.spinePitch = 0.05 + 0.03 * amp;
    o.spineRoll = -Math.sin(s) * 0.05 * amp;
    o.chestPitch = Math.sin(s * 2) * 0.02 * amp;
    o.headYaw += Math.sin(s) * 0.05 * amp;
    o.headRoll = Math.sin(s) * 0.04 * amp;
    o.earPitch = 0.08 * amp + Math.sin(s * 2 + 0.6) * 0.10 * amp;   // they bob

    // legs, half a cycle apart: swing forward with the knee up, plant, push
    const leg = (ph) => {
      const a = Math.sin(s + ph), b = Math.cos(s + ph);
      const lift = Math.max(0, b);
      return {
        hip: a * 0.62 * amp,
        knee: -(0.12 + lift * 0.95) * amp,
        ankle: (-a * 0.28 + lift * 0.22) * amp,
      };
    };
    o.legL = leg(0);
    o.legR = leg(Math.PI);
    // arms swing opposite their leg, and both stand a little further off the
    // ribs the faster she is going, so the elbows never brush the torso
    const arm = (ph) => ({
      pitch: 0.06 - Math.sin(s + ph) * 0.55 * amp,
      roll: 0.10 + 0.04 * amp,
      elbow: -0.22 - Math.max(0, Math.sin(s + ph)) * 0.45 * amp,
      wrist: 0,
    });
    o.armL = arm(Math.PI);
    o.armR = arm(0);
    // and the tail counterweights the hips, a beat behind them
    o.tail.sway = -Math.sin(s - 0.7) * 0.42 * amp;
    o.tail.lift = 0.12 + Math.abs(Math.sin(s)) * 0.18 * amp;
    o.tail.curl = 0.30 - 0.12 * amp;
  }

  /** RUN — the same gait, leaned in, with more of everything. */
  _pose_run(o) {
    this._pose_walk(o);
    const amp = Math.min(1, this.speed / 4.2);
    o.spinePitch = 0.05 + 0.28 * amp;
    o.chestPitch -= 0.10 * amp;
    o.headPitch -= 0.14 * amp;
    o.earPitch = -0.35 * amp;                 // laid back against the air
    o.tail.lift = 0.5 + 0.25 * amp;
    o.tail.curl = 0.12;
    o.armL.elbow -= 0.6 * amp;
    o.armR.elbow -= 0.6 * amp;
  }

  /** ALERT — crouched, weight back, ears up, tail lashing. */
  _pose_alert(o) {
    const l = Math.sin(this.t * 5.5);
    o.hipY = -0.075;
    o.spinePitch = 0.22;
    o.chestPitch = -0.10;
    o.headPitch -= 0.10;
    o.earPitch = 0.30;
    o.earSpread = 0.18;
    o.legL = { hip: 0.22, knee: -0.55, ankle: 0.30 };
    o.legR = { hip: -0.12, knee: -0.45, ankle: 0.22 };
    o.armL = { pitch: 0.45, roll: 0.35, elbow: -1.15, wrist: 0 };
    o.armR = { pitch: 0.45, roll: 0.35, elbow: -1.15, wrist: 0 };
    o.tail.sway = l * 0.65;                   // the lash: fast, wide, unhappy
    o.tail.lift = 0.55 + l * 0.12;
    o.tail.curl = 0.10;
    o.glow = 0.7;
  }

  /**
   * MELEE — a two-beat combo on the blades: one hand across and the other held
   * back out of the way, the two swapping on the second beat, with the hips
   * leading each swing because that is where the power is.
   */
  _pose_melee(o) {
    const f = (this.stateT % 0.9) / 0.9;
    const first = Math.floor(this.stateT / 0.9) % 2 === 0;
    const k = pulse(f, 0.22, 0.45);
    const dir = first ? 1 : -1;
    o.hipY = -0.05;
    o.hipYaw = -dir * 0.55 * k;
    o.spineRoll = dir * 0.20 * k;
    o.spinePitch = 0.18;
    o.headYaw += dir * 0.25 * k;
    o.earPitch = -0.55;
    o.earSpread = 0.25;
    // The swinging arm crosses the chest and the other one is held out of the
    // way, whichever arm is which this beat — body-relative, so the pair reads
    // the same on the backhand as on the forehand.
    const swing = { pitch: 1.15 * k + 0.06, roll: -0.85 * k, elbow: -0.35 - 0.8 * (1 - k), wrist: 0.6 * k };
    const guard = { pitch: 0.55 * k + 0.06, roll: 0.5 * k, elbow: -1.5, wrist: 0 };
    if (first) { o.armR = swing; o.armL = guard; } else { o.armL = swing; o.armR = guard; }
    o.legL = { hip: 0.30 * dir, knee: -0.5, ankle: 0.25 };
    o.legR = { hip: -0.30 * dir, knee: -0.4, ankle: 0.2 };
    o.tail.sway = -dir * 0.9 * k;
    o.tail.lift = 0.7;
    o.glow = 1;
  }

  /**
   * RANGED — she plants, the pods come up over her shoulders, the core spins
   * to charge, and the discharge throws her back a step. No gun anywhere.
   */
  _pose_ranged(o) {
    const f = (this.stateT % 1.4) / 1.4;
    const charge = Math.min(1, f / 0.62);
    const fire = f > 0.62 ? pulse((f - 0.62) / 0.38, 0.12, 0.5) : 0;
    o.hipY = -0.045 - fire * 0.03;
    o.spinePitch = 0.10 - fire * 0.22;        // braced, then rocked back
    o.chestPitch = -0.06 - fire * 0.10;
    o.headPitch -= 0.06;
    o.earPitch = 0.15 - fire * 0.6;
    o.earSpread = 0.22;
    o.armL = { pitch: 0.30, roll: 0.55 + fire * 0.2, elbow: -0.9, wrist: 0 };
    o.armR = { pitch: 0.30, roll: 0.55 + fire * 0.2, elbow: -0.9, wrist: 0 };
    o.legL = { hip: 0.26, knee: -0.42, ankle: 0.20 };
    o.legR = { hip: -0.26, knee: -0.42, ankle: 0.20 };
    o.tail.lift = 0.35 + charge * 0.4;
    o.tail.sway = Math.sin(this.t * 7) * 0.12 * charge;
    o.glow = 0.4 + charge * 0.6;
    this.charge = Math.max(this.charge, charge);
  }

  /**
   * SIT — the STAY command. She folds down onto her heels, tail round her
   * feet, and waits. She will still look at things while she does it.
   */
  _pose_sit(o) {
    const k = ease(Math.min(1, this.stateT / 0.9));
    o.hipY = -0.30 * k;
    o.legL = { hip: -1.15 * k, knee: 1.85 * k, ankle: -0.5 * k };
    o.legR = { hip: -1.15 * k, knee: 1.85 * k, ankle: -0.5 * k };
    o.spinePitch = 0.02 + 0.06 * k;
    o.armL = { pitch: 0.10, roll: 0.18 * k, elbow: -0.35, wrist: 0 };
    o.armR = { pitch: 0.10, roll: 0.18 * k, elbow: -0.35, wrist: 0 };
    o.tail.curl = 0.30 + 0.75 * k;
    o.tail.sway = Math.sin(this.t * 0.9) * 0.18;
    o.tail.lift = 0.12 - 0.10 * k;
    o.chestPitch = Math.sin(this.t * 1.4) * 0.012;
    o.earPitch = Math.sin(this.t * 0.6) * 0.10;
  }

  /** ACKNOWLEDGE — one crisp nod, ears up. Played on every order. */
  _pose_ack(o) {
    const f = Math.min(1, this.stateT / 0.65);
    const k = pulse(f, 0.25, 0.4);
    o.headPitch += 0.42 * k;
    o.earPitch = 0.45 * k;
    o.tail.lift = 0.12 + 0.45 * k;
    o.tail.sway = Math.sin(this.stateT * 14) * 0.25 * k;
    o.glow = 0.3 + 0.5 * k;
  }

  /* ---- push the pose onto the rig ---- */

  /**
   * Ease every joint toward its target. `rate` is per-joint on purpose: the
   * head and ears are quick because they are light and because a slow head
   * reads as a stunned one, the hips and legs are slower because they carry
   * the whole machine, and the tail is slowest of all so it always trails.
   */
  _apply(o, dt) {
    const p = this.rig.parts;
    const s = this._s;
    const k = (rate) => Math.min(1, dt * rate);
    const sm = (key, want, rate) => {
      s[key] = s[key] === undefined ? want : lerp(s[key], want, k(rate));
      return s[key];
    };

    // --- hips: the root of everything
    p.hips.position.y = 0.72 + sm('hipY', o.hipY, 9);
    p.hips.rotation.set(sm('hipPitch', o.hipPitch, 8), sm('hipYaw', o.hipYaw, 7), sm('hipRoll', o.hipRoll, 8));
    p.spine.rotation.set(sm('spinePitch', o.spinePitch, 7), 0, sm('spineRoll', o.spineRoll, 7));
    p.chest.rotation.x = sm('chestPitch', o.chestPitch, 8);

    // --- head, and the shroud that lags it
    const hy = sm('headYaw', o.headYaw, 11), hp = sm('headPitch', o.headPitch, 11);
    p.head.rotation.set(hp, hy, sm('headRoll', o.headRoll, 10));
    const lag = sm('hairLag', hy, 4);
    p.hair.rotation.y = (lag - hy) * 0.55;
    if (p.fallL) p.fallL.rotation.z = (lag - hy) * 0.8;
    if (p.fallR) p.fallR.rotation.z = (lag - hy) * 0.8;
    // the strand that will not lie down
    p.ahoge.rotation.z = Math.sin(this.t * 3.1) * 0.12 + (lag - hy) * 1.4;
    p.ahoge.rotation.x = Math.sin(this.t * 2.3 + 0.7) * 0.10;

    // --- ears: pitch, swivel, spread, and the odd involuntary flick
    this._flick -= dt;
    let flick = 0;
    if (this._flick <= 0) {
      flick = Math.max(0, Math.sin((-this._flick) * 26)) * Math.exp(this._flick * 3);
      if (this._flick < -0.35) this._flick = 1.5 + Math.random() * 3.5;
    }
    const ep = sm('earPitch', o.earPitch, 12), ey = sm('earYaw', o.earYaw, 12);
    const es = sm('earSpread', o.earSpread, 10);
    for (const e of p.ears) {
      e.base.rotation.x = -ep + flick * 0.5;
      e.base.rotation.z = e.side * (0.22 + es) + ey * 0.4;
      e.base.rotation.y = ey * e.side * 0.5;
    }

    // --- arms
    //
    // ROLL AND WRIST ARE WRITTEN BODY-RELATIVE, AND MIRRORED HERE. Positive is
    // AWAY from the torso on either side; negative crosses the chest. A pose
    // therefore states what BOTH arms are doing with the same number, and the
    // `a.side` below is the only place the two sides are ever told apart.
    //
    // Say it in the pose as well and you mirror twice: the arm on +x lands on
    // side × (−roll) and swings INTO the ribs while its opposite number swings
    // out, which is what a companion clipping her own elbow through her chest
    // in every braced pose looks like from the outside.
    const armFrom = (src, key, a) => {
      a.shoulder.rotation.set(sm(key + 'p', src.pitch, 9), 0, a.side * sm(key + 'r', src.roll, 9));
      a.elbow.rotation.x = sm(key + 'e', src.elbow, 9);
      a.wrist.rotation.z = a.side * sm(key + 'w', src.wrist ?? 0, 10);
    };
    armFrom(o.armL, 'aL', p.arms[0]);
    armFrom(o.armR, 'aR', p.arms[1]);

    // --- legs
    const legFrom = (src, key, l) => {
      l.hip.rotation.x = sm(key + 'h', src.hip, 10);
      l.knee.rotation.x = sm(key + 'k', src.knee, 10);
      // the ankle keeps the foot flat unless the pose says otherwise
      l.ankle.rotation.x = sm(key + 'a', src.ankle, 10) - l.hip.rotation.x - l.knee.rotation.x;
    };
    legFrom(o.legL, 'lL', p.legs[0]);
    legFrom(o.legR, 'lR', p.legs[1]);

    // --- tail: each segment takes a share of the curl, and the sway runs
    // down it as a wave, so the tip always arrives last
    const curl = sm('tailCurl', o.tail.curl, 4);
    const sway = sm('tailSway', o.tail.sway, 5);
    const lift = sm('tailLift', o.tail.lift, 4.5);
    for (let i = 0; i < p.tail.length; i++) {
      const t = i / (p.tail.length - 1);
      p.tail[i].rotation.x = (i === 0 ? -lift : curl * 0.42);
      p.tail[i].rotation.y = sway * (0.35 + t * 0.9) * Math.cos(t * 2.2 - this.t * 3);
    }

    // --- the mechanisms
    const bo = this.bladeOut;
    for (const a of p.arms) {
      a.blade.visible = bo > 0.01;
      // it drives down out of the forearm and past the fist...
      a.blade.position.y = -0.02 - ease(Math.min(1, bo / 0.7)) * 0.20;
      // ...and then rolls over square and locks, which is the second half of
      // the sound and the reason it is two beats rather than one
      a.blade.rotation.y = ease(Math.max(0, (bo - 0.6) / 0.4)) * Math.PI / 2;
    }
    p.bladeMat.emissive.setRGB(0.06 * bo, 0.16 * bo, 0.22 * bo);

    const po = this.podOut;
    for (const pod of p.pods) {
      // They come UP AND OUT, clearing her shoulders, so from the front you
      // see two emitters over her collar rather than a bulge behind her back.
      pod.pod.rotation.x = -po * 1.30;
      pod.pod.rotation.z = -pod.side * po * 0.42;
      pod.pod.position.y = 0.135 + po * 0.090;
      pod.pod.position.x = pod.side * (0.075 + po * 0.052);
      pod.lid.rotation.x = po * 0.9;                         // the cover swings clear
      pod.lid.position.z = po * 0.02;
      const split = ease(Math.max(0, (po - 0.45) / 0.55));
      pod.jawA.rotation.z = split * 0.55;
      pod.jawB.rotation.z = -split * 0.55;
      pod.jawA.position.x = -split * 0.012;
      pod.jawB.position.x = split * 0.012;
    }
    const arc = Math.min(1, this.charge * po);
    p.arcMat.emissive.setRGB(arc * 0.15, arc * 0.75, arc * 0.95);

    // --- the core: spins with charge, lights with everything
    p.coreRing.rotation.z += dt * (1.2 + this.charge * 22 + bo * 4);
    const glow = sm('glow', Math.max(o.glow, this.charge), 5);
    p.coreMat.emissive.setRGB(glow * 0.10, glow * 0.62, glow * 0.52);
    p.glowMat.emissive.setRGB(glow * 0.06, glow * 0.34, glow * 0.42);
    for (const e of p.ears) e.tip.material = p.glowMat;

    // --- the vents crack open the harder she has been working
    for (let i = 0; i < p.vents.length; i++) {
      p.vents[i].rotation.z = glow * 0.5 * (i % 3 === 0 ? 1 : 0.7);
    }

    // --- the eyes blink, because a light that never blinks is a lamp
    this._blink -= dt;
    if (this._blink <= 0) {
      const shut = Math.max(0, 1 - Math.abs(this._blink) * 14);
      p.face.scale.y = 1 - shut * 0.86;
      p.face.position.y = 0.025 + shut * 0.008;
      if (this._blink < -0.16) this._blink = 2.5 + Math.random() * 4;
    } else {
      p.face.scale.y = 1;
      p.face.position.y = 0.025;
    }
  }
}
