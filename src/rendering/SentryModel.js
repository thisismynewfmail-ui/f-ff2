import * as THREE from '../../lib/three.module.js';

/**
 * THE PORTABLE SENTRY, as a machine rather than as a shape of a machine.
 *
 * It used to be a drum on three sticks with a tube on top: correct in outline,
 * and completely mute about how any of it worked. Everything below is built the
 * other way round — MECHANISM FIRST, and the panelling left off. Every joint
 * that bends has the ram that bends it. Every rotation has the gear it runs on.
 * The receiver is a pair of rails with the bolt visible between them, the belt
 * is real links that step along as it feeds, the optic is an iris of six blades
 * that actually stop down, and the heat has somewhere to go. If a part of this
 * moves in Sentry.js, you can see the thing that moves it.
 *
 * That is what makes it read as a robot and not as a prop: not detail for its
 * own sake, but every animated state having a visible cause.
 *
 * Built facing +Z with its feet at the origin, so the entity places it exactly
 * as it places any other object and `mesh.rotation.y = yaw` points it where the
 * player was looking. Three callers want one — the deployed turret, the
 * translucent ghost in the placement preview, and the copy in the player's
 * hands — so it is built here rather than beside the entity.
 *
 * THE RIG, top to bottom, and what drives each piece:
 *
 *   legs[i].hip      splay      deploy/stow, the tripod opening out
 *   legs[i].knee     fold       driven off the same curve, one beat behind
 *   legs[i].ram      extend     the hydraulic that plainly does the folding
 *   legs[i].pad      level      keeps the footpad flat as the leg swings
 *   mast             rise       two telescoping stages out of the hub
 *   turret           yaw        the whole head, on the toothed ring
 *   pinion           spin       geared off the yaw, so the ring is driven
 *   cradle           pitch      the trunnion the gun elevates in
 *   barrel           recoil     slides on its spring, and the brake with it
 *   bolt             cycle      back and forward inside the rails, per shot
 *   belt[i]          feed       links stepping toward the feed tray
 *   shell            eject      one spent case, thrown out of the port
 *   iris[i]          stop       six blades, wide asleep and tight on a target
 *   lens             see        the emissive behind the iris
 *   vents[i]         cool       louvres that crack open as it heats
 *   antenna          sway       a whip that trails whatever the head does
 *   lamps[i]         say        three status lamps, run as a bar or a chase
 */

/**
 * How big the finished machine is, applied to the assembled group.
 *
 * The parts below are laid out at a natural 1:1 and then scaled as a whole, so
 * the proportions are authored once and the SIZE is one number. It was built
 * knee-high at first and read as a toy dropped in the grass; at this scale it
 * stands about waist height, which is what a crew-served weapon on a tripod
 * actually looks like next to a person.
 */
export const SENTRY_SCALE = 1.35;

/** Where the barrel sits, and how far the muzzle stands out from the mount.
 *  Exported so the entity's ballistics read the model rather than guessing. */
export const SENTRY_EYE = 0.52;
export const SENTRY_MUZZLE = 0.22;

const TAU = Math.PI * 2;

/** The bore-sight card on the optic housing — a tiny painted reticle, because
 *  a machine this fussy would have one and it costs one canvas. */
function reticleTexture() {
  const S = 32, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#141a12'; x.fillRect(0, 0, S, S);
  x.strokeStyle = '#5f7a4a'; x.lineWidth = 1;
  x.strokeRect(2.5, 2.5, S - 5, S - 5);
  x.strokeStyle = '#8fd06a';
  x.beginPath();
  x.moveTo(S / 2, 5); x.lineTo(S / 2, S - 5);
  x.moveTo(5, S / 2); x.lineTo(S - 5, S / 2);
  x.stroke();
  x.beginPath(); x.arc(S / 2, S / 2, 7, 0, TAU); x.stroke();
  x.fillStyle = '#d8b44a';
  for (let i = 0; i < 4; i++) x.fillRect(S / 2 - 0.5, 8 + i * 4, 1, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSentryModel(texLib = null) {
  const plate = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('sentryPlate') })
    : new THREE.MeshLambertMaterial({ color: 0x4a5236 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x35383c });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1e2023 });
  const oil = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const chrome = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
  const brass = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('vendorBrass') })
    : new THREE.MeshLambertMaterial({ color: 0xa8842c });
  const copper = new THREE.MeshLambertMaterial({ color: 0x8a5a2c });
  // Kept as materials rather than meshes: the entity animates emissive on all
  // three, and a merged or cloned mesh still draws with the same material.
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffcc66, emissive: 0x704a10 });
  const lensMat = new THREE.MeshLambertMaterial({ color: 0x2a4038, emissive: 0x123f2a });
  const heatMat = new THREE.MeshLambertMaterial({ color: 0x2a2622, emissive: 0x000000 });

  const g = new THREE.Group();
  const parts = {
    legs: [], belt: [], iris: [], vents: [], lamps: [],
    lampMat, lensMat, heatMat,
  };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

  /* ================================================================== *
   * THE UNDERCARRIAGE — three legs, and the rams that fold them        *
   * ================================================================== */

  /**
   * THE TRIPOD, AND THE TWO THINGS IT USED TO GET WRONG.
   *
   * FIRST: THE ROTATION ORDER. Each hip carries a fixed Y that aims the leg at
   * its third of the circle, and an animated X that swings it out. Under the
   * default XYZ order the X is applied in the PARENT's frame — so it is not a
   * splay at all, it is a LEAN, and all three legs tipped the same way in model
   * space. Measured, the deployed tripod put its three pads at −0.08, −0.15 and
   * −0.15 below the ground plane, at radii of 0.40, 0.22 and 0.22, all of them
   * behind the mount: not a tripod, a machine lying on its back with its feet
   * buried. YXZ applies the third-of-a-circle FIRST, which is what turns the X
   * into a splay.
   *
   * SECOND: WHICH WAY IS OUT. With the bearing applied first, local +Z points
   * radially outward and a POSITIVE X rotation tips the leg toward local −Z,
   * which is inward. So splay is negative and the knee folds back positive —
   * the same convention the Mk II is built to, stated once here and read from
   * the parts record by every pose.
   *
   * And the hub height is DERIVED from all of it rather than asserted, so the
   * pads land on y = 0 by construction. Change an angle or a bone length and
   * the machine still stands on the ground instead of in it.
   */
  const SPLAY = -1.10;                 // hip, deployed: 63° out from vertical
  const FOLD = 0.58;                   // knee, deployed: folds back under
  /**
   * And where the knee sits STOWED, which is not zero.
   *
   * A straight leg hanging off the hub is 0.32 long and the hub is 0.20 up, so
   * a tripod folded with its knees straight has its feet twelve centimetres
   * under the pavement for the whole first half of the deploy. Real folding
   * kit does not do that: the shin comes back up alongside the thigh. Folded
   * to −1.55 the shin lies almost horizontal and the pads sit just clear of
   * the ground, which is both what a packed tripod looks like and the only way
   * this one starts its deploy above the floor.
   */
  const FOLD_STOW = -1.55;
  const thighH = 0.19;
  const shinH = 0.131;
  const HUB_Y = thighH * Math.cos(SPLAY) + shinH * Math.cos(SPLAY + FOLD);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI;              // one leg to the rear
    // hip: swings the whole leg outward as it deploys
    const hip = new THREE.Group();
    hip.position.set(Math.sin(a) * 0.055, HUB_Y, Math.cos(a) * 0.055);
    hip.rotation.order = 'YXZ';        // bearing first, then splay. See above.
    hip.rotation.y = a;
    g.add(hip);

    // the hip casting itself, so the pivot is a THING and not a gap
    hip.add(at(cyl(0.032, 0.032, 0.07, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
    // thigh: an I-section rather than a stick — two flanges and a web
    hip.add(at(box(0.052, thighH, 0.016, steel), 0, -thighH / 2, 0.014));
    hip.add(at(box(0.052, thighH, 0.016, steel), 0, -thighH / 2, -0.014));
    hip.add(at(box(0.018, thighH, 0.030, dark), 0, -thighH / 2, 0));

    // the hydraulic ram alongside it: a barrel anchored at the hub and a
    // polished rod running down to the knee. It is the reason the leg folds.
    const ramPivot = new THREE.Group();
    ramPivot.position.set(0.052, -0.012, 0);
    hip.add(ramPivot);
    ramPivot.add(at(cyl(0.017, 0.017, 0.10, oil, 8), 0, -0.05, 0));
    const rod = at(cyl(0.008, 0.008, 0.12, chrome, 6), 0, -0.14, 0);
    ramPivot.add(rod);
    // the hose that feeds it, drooping the way a hose does
    for (let k = 0; k < 4; k++) {
      const t = k / 3;
      hip.add(at(cyl(0.006, 0.006, 0.035, copper, 5),
        0.03 + t * 0.02, -0.02 - t * 0.05 + Math.sin(t * Math.PI) * 0.018, -0.026));
    }

    // knee: the shin hangs off it and folds one beat behind the hip
    const knee = new THREE.Group();
    knee.position.set(0, -thighH, 0);
    hip.add(knee);
    knee.add(at(cyl(0.024, 0.024, 0.055, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
    knee.add(at(box(0.036, shinH, 0.036, steel), 0, -shinH / 2, 0));
    knee.add(at(box(0.010, shinH * 0.8, 0.048, dark), 0, -shinH / 2, 0));  // web
    // a spring wound round the shin, because a leg that takes a landing has
    // one — spaced off the shin's own length so the coils stay ON the shin if
    // it is ever resized, rather than hanging off the end of it
    for (let k = 0; k < 5; k++) {
      knee.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 4, 10), chrome),
        0, -shinH * (0.30 + k * 0.145), 0).rotateX(Math.PI / 2));
    }

    // pad: kept flat to the ground whatever the leg above it is doing
    const pad = new THREE.Group();
    pad.position.set(0, -shinH, 0);
    knee.add(pad);
    pad.add(at(cyl(0.055, 0.062, 0.018, dark, 10), 0, -0.009, 0));
    pad.add(at(cyl(0.030, 0.030, 0.014, chrome, 8), 0, 0.006, 0));
    for (let k = 0; k < 3; k++) {                    // grousers, so it bites
      const ga = (k / 3) * TAU;
      pad.add(at(box(0.014, 0.010, 0.042, oil), Math.sin(ga) * 0.03, -0.020, Math.cos(ga) * 0.03)
        .rotateY(ga));
    }
    parts.legs.push({ hip, knee, pad, ram: rod, splay: SPLAY, fold: FOLD, foldStow: FOLD_STOW });
  }

  // the hub the legs hang off: a machined block with bolt heads on show
  g.add(at(cyl(0.085, 0.095, 0.075, steel, 12), 0, HUB_Y, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    g.add(at(cyl(0.011, 0.011, 0.012, chrome, 6), Math.sin(a) * 0.068, HUB_Y + 0.040, Math.cos(a) * 0.068));
  }

  /* ================================================================== *
   * THE MAST — two telescoping stages, so standing up is a MOVEMENT    *
   * ================================================================== */

  const mast = new THREE.Group();
  mast.position.y = HUB_Y + 0.035;
  g.add(mast);
  parts.mast = mast;
  mast.add(at(cyl(0.062, 0.068, 0.09, steel, 10), 0, 0.045, 0));         // stage 1, fixed
  const stage2 = at(cyl(0.048, 0.050, 0.10, chrome, 10), 0, 0.12, 0);    // stage 2, rises
  mast.add(stage2);
  parts.mastStage = stage2;
  // the loom of cable that runs up it, in a spiral wrap
  for (let k = 0; k < 9; k++) {
    const t = k / 8, a = t * Math.PI * 3;
    mast.add(at(cyl(0.006, 0.006, 0.022, oil, 5),
      Math.sin(a) * 0.058, 0.02 + t * 0.13, Math.cos(a) * 0.058).rotateX(1.2));
  }

  /* ================================================================== *
   * THE RING — the yaw bearing, with teeth and a pinion that drives it *
   * ================================================================== */

  const body = new THREE.Group();
  body.position.y = 0.26;
  g.add(body);
  parts.body = body;

  // the race, and its teeth: twenty-eight of them, on show
  body.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.016, 6, 20), brass), 0, 0.02, 0)
    .rotateX(Math.PI / 2));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    body.add(at(box(0.012, 0.020, 0.020, brass), Math.sin(a) * 0.128, 0.02, Math.cos(a) * 0.128).rotateY(a));
  }
  // the motor that turns it, hung off the side of the race, and its pinion
  body.add(at(cyl(0.030, 0.030, 0.075, oil, 8), 0.145, -0.02, -0.02));
  body.add(at(box(0.048, 0.030, 0.048, steel), 0.145, -0.072, -0.02));    // its gearbox
  const pinion = at(cyl(0.028, 0.028, 0.024, chrome, 8), 0.145, 0.02, -0.02);
  body.add(pinion);
  parts.pinion = pinion;
  for (let i = 0; i < 8; i++) {                                           // pinion teeth
    const a = (i / 8) * TAU;
    pinion.add(at(box(0.008, 0.024, 0.010, chrome), Math.sin(a) * 0.030, 0, Math.cos(a) * 0.030).rotateY(a));
  }
  // the carry handle, folded down the back
  body.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.010, 6, 12, Math.PI), steel),
    0, -0.03, -0.125).rotateX(Math.PI / 2));

  /* ================================================================== *
   * THE TURRET — everything above the ring turns                        *
   * ================================================================== */

  const turret = new THREE.Group();
  turret.position.y = 0.045;
  body.add(turret);
  parts.head = turret;                 // kept as `head` for the entity's sake

  // the deck plate the whole works is bolted to
  turret.add(at(cyl(0.100, 0.108, 0.022, plate, 12), 0, 0, 0));

  // --- the receiver, as two RAILS with the mechanism between them
  const cradle = new THREE.Group();
  cradle.position.set(0, 0.085, 0.01);
  turret.add(cradle);
  parts.cradle = cradle;               // the trunnion: the gun pitches in this

  for (const sx of [-1, 1]) {
    cradle.add(at(box(0.014, 0.075, 0.215, steel), sx * 0.052, 0, 0.01));      // rail
    cradle.add(at(box(0.020, 0.014, 0.215, dark), sx * 0.052, 0.030, 0.01));   // top flat
    for (let k = 0; k < 4; k++) {                                             // lightening holes
      cradle.add(at(cyl(0.013, 0.013, 0.018, oil, 8), sx * 0.052, -0.005, -0.06 + k * 0.045)
        .rotateZ(Math.PI / 2));
    }
  }
  // the bolt carrier, between the rails, where you can watch it work
  const bolt = at(box(0.062, 0.042, 0.070, chrome), 0, 0.004, -0.03);
  cradle.add(bolt);
  parts.bolt = bolt;
  parts.boltZ = -0.03;
  cradle.add(at(cyl(0.008, 0.008, 0.14, chrome, 6), 0, 0.004, -0.05).rotateX(Math.PI / 2)); // op rod
  cradle.add(at(box(0.030, 0.030, 0.055, dark), 0, -0.030, -0.075));          // buffer at the back
  for (let k = 0; k < 6; k++) {                                              // recoil spring
    cradle.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 4, 9), chrome),
      0, 0.004, -0.055 - k * 0.012).rotateY(Math.PI / 2).rotateZ(Math.PI / 2));
  }
  // the trunnion pins the whole cradle rocks on, one each side
  turret.add(at(cyl(0.016, 0.016, 0.150, chrome, 8), 0, 0.085, 0.01).rotateZ(Math.PI / 2));
  // and the elevation screw under the tail, which is what actually pitches it
  turret.add(at(cyl(0.010, 0.010, 0.075, chrome, 6), 0, 0.048, -0.085));
  turret.add(at(box(0.028, 0.020, 0.028, brass), 0, 0.012, -0.085));

  // --- the barrel group: slides on the spring, brake and shroud with it
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.006, 0.115);
  cradle.add(barrel);
  parts.barrel = barrel;
  parts.barrelZ = 0.115;
  barrel.add(at(cyl(0.020, 0.020, 0.20, steel, 10), 0, 0, 0.02).rotateX(Math.PI / 2));
  // Cooling fins down the barrel. A torus lies in the XY plane with its hole
  // along Z, which is already square to a barrel that points down +Z — no
  // rotation, and they glow with the rest of heatMat as the gun works.
  for (let k = 0; k < 7; k++) {
    barrel.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 4, 10), heatMat),
      0, 0, -0.05 + k * 0.024));
  }
  barrel.add(at(cyl(0.013, 0.013, 0.235, oil, 8), 0, 0, 0.03).rotateX(Math.PI / 2));  // bore
  const brake = at(cyl(0.026, 0.022, 0.045, brass, 8), 0, 0, 0.145);
  brake.rotation.x = Math.PI / 2;
  barrel.add(brake);
  for (let k = 0; k < 3; k++) {                    // the brake's ports
    barrel.add(at(box(0.006, 0.030, 0.010, oil), 0.024, 0, 0.135 + k * 0.008));
    barrel.add(at(box(0.006, 0.030, 0.010, oil), -0.024, 0, 0.135 + k * 0.008));
  }
  // the gas tube over the top, tapped near the muzzle — how a real one cycles
  barrel.add(at(cyl(0.008, 0.008, 0.17, chrome, 6), 0, 0.030, 0.02).rotateX(Math.PI / 2));
  barrel.add(at(cyl(0.014, 0.014, 0.022, brass, 8), 0, 0.018, 0.098));

  // --- the feed: a box on the flank, a belt of links, a tray, an eject port
  const feed = new THREE.Group();
  feed.position.set(-0.085, -0.020, -0.015);
  cradle.add(feed);
  feed.add(at(box(0.070, 0.090, 0.105, plate), 0, -0.035, 0));            // the can
  feed.add(at(box(0.074, 0.010, 0.109, brass), 0, 0.012, 0));             // its lid
  feed.add(at(cyl(0.010, 0.010, 0.030, chrome, 6), 0.030, 0.020, 0));     // the lid catch
  // the links, climbing out of the can and along the tray into the receiver
  for (let k = 0; k < 7; k++) {
    const link = new THREE.Group();
    link.add(at(box(0.014, 0.011, 0.020, brass), 0, 0, 0));
    link.add(at(cyl(0.005, 0.005, 0.024, copper, 6), 0, 0.008, 0).rotateX(Math.PI / 2));
    feed.add(link);
    parts.belt.push({ node: link, i: k });
  }
  // the ejection port on the other flank, and the deflector over it
  cradle.add(at(box(0.010, 0.034, 0.055, oil), 0.060, 0.010, -0.005));
  cradle.add(at(box(0.022, 0.010, 0.040, steel), 0.068, 0.030, -0.005).rotateZ(-0.5));
  // one spent case, hidden until a round is fired and then thrown clear
  const shell = at(cyl(0.006, 0.007, 0.022, brass, 6), 0.075, 0.012, -0.005);
  shell.visible = false;
  cradle.add(shell);
  parts.shell = shell;

  /* ================================================================== *
   * THE OPTIC — six iris blades, a lens, and a card with a reticle      *
   * ================================================================== */

  const pod = new THREE.Group();
  pod.position.set(0.052, 0.075, 0.055);
  turret.add(pod);
  parts.pod = pod;
  pod.add(at(cyl(0.034, 0.034, 0.065, steel, 12), 0, 0, 0).rotateX(Math.PI / 2));
  pod.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.006, 6, 14), brass), 0, 0, 0.033));
  const lens = at(new THREE.Mesh(new THREE.CircleGeometry(0.027, 16), lensMat), 0, 0, 0.030);
  pod.add(lens);
  parts.lens = lens;
  // six blades that close over the lens — an aperture, not a shutter graphic
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const hinge = new THREE.Group();
    hinge.position.set(0, 0, 0.034);
    hinge.rotation.z = a;
    pod.add(hinge);
    const blade = at(box(0.030, 0.008, 0.004, dark), 0.020, 0, 0);
    hinge.add(blade);
    parts.iris.push({ hinge, blade, home: 0.020 });
  }
  // the bore-sight card on the pod's flank
  const card = at(new THREE.Mesh(new THREE.PlaneGeometry(0.040, 0.040),
    new THREE.MeshBasicMaterial({ map: reticleTexture() })), 0.035, 0.001, 0.005);
  card.rotation.y = Math.PI / 2;
  pod.add(card);

  /* ================================================================== *
   * COOLING, AERIAL, LAMPS — the things that say what it is doing       *
   * ================================================================== */

  // louvres down the left flank of the turret that crack open as it heats
  for (let i = 0; i < 4; i++) {
    const v = new THREE.Group();
    v.position.set(-0.088, 0.055 + i * 0.018, -0.045);
    turret.add(v);
    v.add(at(box(0.006, 0.014, 0.070, heatMat), 0, 0, 0));
    parts.vents.push(v);
  }
  // the whip aerial, in three segments so it can trail in a curve
  const antenna = new THREE.Group();
  antenna.position.set(-0.060, 0.100, -0.070);
  turret.add(antenna);
  parts.antenna = antenna;
  let seg = antenna;
  for (let i = 0; i < 3; i++) {
    const next = new THREE.Group();
    next.position.y = 0.055;
    const rod2 = at(cyl(0.0045 - i * 0.001, 0.005 - i * 0.001, 0.055, chrome, 5), 0, 0.028, 0);
    seg.add(rod2);
    seg.add(next);
    seg = next;
  }
  seg.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), brass), 0, 0, 0));
  parts.antennaTip = seg;

  // three status lamps in a strip on the back of the turret
  for (let i = 0; i < 3; i++) {
    const l = at(new THREE.Mesh(new THREE.SphereGeometry(0.011, 7, 6), lampMat.clone()),
      -0.022 + i * 0.022, 0.052, -0.098);
    turret.add(l);
    turret.add(at(cyl(0.014, 0.014, 0.008, dark, 8), -0.022 + i * 0.022, 0.052, -0.104)
      .rotateX(Math.PI / 2));
    parts.lamps.push(l);
  }
  // a data plate under them, because everything the county owns has one
  turret.add(at(box(0.072, 0.024, 0.004, brass), 0, 0.022, -0.100));

  // the muzzle flash, hidden until it fires
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  flash.position.set(0, 0, 0.19);
  flash.visible = false;
  barrel.add(flash);
  parts.flash = flash;

  g.scale.setScalar(SENTRY_SCALE);
  return { group: g, parts };
}
