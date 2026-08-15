import * as THREE from '../../lib/three.module.js';

/**
 * THE WARDEN — Sentry Mk II, as a machine rather than as a shape of a machine.
 *
 * The Mk I is a pistol on a tripod: light, hand-carried, one barrel, and it
 * says so. The Mk II is what the county bolted together when a pistol on a
 * tripod stopped being enough — a CREW-SERVED gun that happens to have no
 * crew. Everything about it is the heavier answer to a part of the Mk I, and
 * every one of those answers is visible from across the street:
 *
 *   Mk I                         Mk II
 *   three legs, folded by rams   FOUR legs on screw jacks, and a spade that
 *                                drives into the ground behind it
 *   one barrel, air-cooled fins  TWO barrels in a water JACKET, with a header
 *                                tank, a relief valve and a condenser coil
 *   a belt out of a side can     a SADDLE DRUM on top, turning as it feeds,
 *                                and a rack of spares on the flank
 *   an iris optic                a COINCIDENCE RANGEFINDER: a bar across the
 *                                top with a prism head at each end that toe in
 *                                onto what it is looking at. That bar is why
 *                                it shoots twice as far as the Mk I, and it is
 *                                the single most recognisable thing about it.
 *   180° of cover                240°, on a slew ring with a cable DRAG CHAIN
 *                                that winds and unwinds as it turns — which is
 *                                also the mechanical reason it is 240° and not
 *                                a full circle: the chain runs out.
 *   nothing but the gun          A LOADER ARM. One articulated arm on the left
 *                                that lifts drums out of the rack, feeds them,
 *                                taps the plate, wipes the rangefinder glass,
 *                                and tips the bar at anyone who stands in
 *                                front of it. It is the closest thing this
 *                                machine has to a face, and it is why it reads
 *                                as somebody rather than as something.
 *
 * MECHANISM FIRST, panelling left off — the same rule the Mk I is built to. If
 * a part of this moves in SentryTwo.js, the thing that moves it is on show.
 *
 * Built facing +Z with its feet at the origin, so the entity places it exactly
 * as it places any other object and `mesh.rotation.y = yaw` points it where
 * the player was looking. Three callers want one: the deployed gun, the
 * translucent ghost in the placement preview, and the copy in the player's
 * hands.
 *
 * THE RIG, and what drives each piece:
 *
 *   legs[i].hip        splay     the quadrupod opening out of its case
 *   legs[i].knee       fold      one beat behind the hip, as on the Mk I
 *   legs[i].jack       screw     the levelling jack, which visibly extends
 *   legs[i].pad        level     keeps the footpad flat as the leg swings
 *   spade              bite      the ground anchor, driven down on deploy
 *   mastStage / body   rise      the deck coming up off the base
 *   head               yaw       everything above the slew ring
 *   chain[i]           drag      the cable chain paying out around the ring
 *   counterweight      swing     the mass behind the breech, which lags
 *   cradle             pitch     the trunnion both barrels elevate in
 *   barrels[i].group   recoil    each barrel runs on its own spring
 *   barrels[i].bolt    cycle     two bolts, and they work together
 *   barrels[i].flash   fire      twin muzzle flashes
 *   shells[i]          eject     one case out of each side, per pair
 *   drum               feed      the saddle drum, turning as it empties
 *   arm.*              load      shoulder / elbow / wrist / claw
 *   rf.bar             extend    the rangefinder, folded for carry
 *   rf.headL/R         converge  the prisms toeing in onto a target
 *   jacketMat          heat      the water jacket going over
 *   steam[i]           boil      what comes out of the relief valve
 *   lamps[i]           say       four status lamps in a bar
 *   setTally(n)        notch     the kill marks SCRATCHED INTO the data plate
 */

/**
 * How big the finished machine is, applied to the assembled group.
 *
 * The Mk I stands at 1.35 and reads as waist-high. This one is authored a
 * little larger and scaled a little larger again, so that standing next to
 * one the difference is not a stat on a card — it is that the thing is
 * plainly bigger than the one you already own.
 */
export const TWO_SCALE = 1.52;

/**
 * Where the barrels sit and how far the muzzles stand out, in model units.
 *
 * Exported so the entity's ballistics read the model rather than guessing —
 * and MEASURED off the assembled rig rather than estimated, because these two
 * numbers are the origin of every line-of-sight test the gun does. Guess them
 * low and the machine shoots from inside its own mast: it refuses targets it
 * can plainly see, and there is nothing on screen to say why.
 */
export const TWO_EYE = 0.76;
export const TWO_MUZZLE = 0.42;
/** How far apart the two bores are — the entity fires from both. */
export const TWO_SPREAD = 0.062;

const TAU = Math.PI * 2;

/**
 * The data plate, with the kill tally scratched into it.
 *
 * The Mk I taps its barrel every twenty-fifth kill and that is the end of it.
 * This one KEEPS SCORE: the loader arm reaches over and cuts another mark into
 * the plate, and the mark stays there for the rest of the run. Five to a gate,
 * gates wrapped onto three lines, and once the plate is full it stops counting
 * and simply says the number — which is its own small joke about a machine
 * that has been left somewhere far too long.
 *
 * Redrawn in place on the same canvas, so a tally costs one texture upload and
 * no new objects.
 */
function plateTexture() {
  const W = 96, H = 48;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const draw = (kills = 0) => {
    x.fillStyle = '#4a4634'; x.fillRect(0, 0, W, H);           // the painted plate
    x.fillStyle = '#3d3a2a'; x.fillRect(0, 0, W, 2); x.fillRect(0, H - 2, W, 2);
    for (let i = 0; i < 60; i++) {                              // grime in the paint
      const px = (Math.sin(i * 12.9898) * 43758.5 % 1 + 1) % 1 * W;
      const py = (Math.sin(i * 78.233) * 43758.5 % 1 + 1) % 1 * H;
      x.fillStyle = i % 3 ? '#565240' : '#413e2e';
      x.fillRect(px | 0, py | 0, 1, 1);
    }
    // the stencil: county property, and which mark of it this is
    x.fillStyle = '#c8b47a';
    x.font = 'bold 11px monospace';
    x.fillText('SENTRY MK II', 5, 13);
    x.font = '8px monospace';
    x.fillStyle = '#8fa06a';
    x.fillText('CO. CIVIL DEF.', 5, 22);
    // the tally, cut into the paint: four uprights and a stroke across five
    const GATES = 21;                       // what fits before it gives up
    const gates = Math.floor(kills / 5);
    if (gates > GATES) {
      x.fillStyle = '#d8c08a';
      x.font = 'bold 13px monospace';
      x.fillText(`${kills}`, 52, 40);
    } else {
      x.strokeStyle = '#d8c890';
      x.lineWidth = 1;
      for (let g = 0; g < gates; g++) {
        const col = g % 7, row = (g / 7) | 0;
        const gx = 5 + col * 13, gy = 30 + row * 6;
        x.beginPath();
        for (let s = 0; s < 4; s++) { x.moveTo(gx + s * 2.5 + 0.5, gy); x.lineTo(gx + s * 2.5 + 0.5, gy + 4); }
        x.moveTo(gx - 0.5, gy + 4); x.lineTo(gx + 9, gy);       // the stroke across
        x.stroke();
      }
      const rest = kills % 5;
      const col = gates % 7, row = (gates / 7) | 0;
      const gx = 5 + col * 13, gy = 30 + row * 6;
      x.beginPath();
      for (let s = 0; s < rest; s++) { x.moveTo(gx + s * 2.5 + 0.5, gy); x.lineTo(gx + s * 2.5 + 0.5, gy + 4); }
      x.stroke();
    }
  };
  draw(0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, draw };
}

/** The rangefinder's own scale card, seen through the prism head. */
function rangeCardTexture() {
  const S = 32, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#101a14'; x.fillRect(0, 0, S, S);
  x.strokeStyle = '#7ad0a0'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(2, S / 2 + 0.5); x.lineTo(S - 2, S / 2 + 0.5); x.stroke();
  x.fillStyle = '#7ad0a0';
  for (let i = 0; i < 7; i++) {                    // a range scale in hundreds
    const h = i % 2 ? 4 : 7;
    x.fillRect(3 + i * 4, S / 2 - h, 1, h);
  }
  x.fillStyle = '#e0c060';
  x.fillRect(S / 2 - 1, 4, 2, S - 8);              // the coincidence line
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSentryTwoModel(texLib = null) {
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
  // The Mk II's own colour: the county sprayed its heavy kit a darker olive and
  // banded the moving parts in hazard yellow, which is the one warm accent on
  // an otherwise cold machine.
  const hull = new THREE.MeshLambertMaterial({ color: 0x4a5236 });
  const hazard = new THREE.MeshLambertMaterial({ color: 0xb99a2a });
  // Animated materials. Kept as materials rather than meshes because the
  // entity drives emissive on all of them and a merged mesh still draws with
  // the same material object.
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffcc66, emissive: 0x704a10 });
  const lensMat = new THREE.MeshLambertMaterial({ color: 0x24403a, emissive: 0x0e4a34 });
  const jacketMat = new THREE.MeshLambertMaterial({ color: 0x2e3a3a, emissive: 0x000000 });
  const steamMat = new THREE.MeshBasicMaterial({
    color: 0xdfeee8, transparent: true, opacity: 0, depthWrite: false, fog: false,
  });

  const g = new THREE.Group();
  const parts = {
    legs: [], chain: [], barrels: [], shells: [], lamps: [], steam: [], rack: [],
    lampMat, lensMat, jacketMat, steamMat,
  };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

  /* ================================================================== *
   * THE BASE — a square case, four legs, four screw jacks, one spade    *
   * ================================================================== */

  // How high the case rides. It is not a free number: the legs below it have a
  // length and a splay, and this is what puts the PADS ON THE GROUND rather
  // than through it. Change a leg dimension and this changes with it.
  const HUB_Y = 0.385;
  // the case the whole thing folds into: a box with lifting eyes at its corners
  g.add(at(box(0.26, 0.085, 0.26, plate), 0, HUB_Y - 0.02, 0));
  g.add(at(box(0.27, 0.014, 0.27, steel), 0, HUB_Y + 0.028, 0));       // the lid
  g.add(at(box(0.27, 0.016, 0.030, hazard), 0, HUB_Y + 0.030, 0.118));  // one stripe, at the front
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 5, 8), chrome),
      sx * 0.10, HUB_Y + 0.044, sz * 0.10).rotateX(Math.PI / 2));      // lifting eyes
  }

  // FOUR legs, one to each corner of the case. The Mk I splays three legs off a
  // round hub; this one has a corner to bolt each leg to, which is why it is
  // square, and it is square because four legs on a square base is what you
  // build when the gun on top is heavy enough to walk itself off a tripod.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;          // corners, not faces
    const hip = new THREE.Group();
    hip.position.set(Math.sin(a) * 0.115, HUB_Y - 0.012, Math.cos(a) * 0.115);
    /**
     * ORDER MATTERS HERE, and getting it wrong is invisible in the code and
     * unmissable on screen.
     *
     * The hip carries TWO rotations: a fixed Y that aims the leg at its corner,
     * and an animated X that swings it out as the machine deploys. Under the
     * default XYZ order the X is applied in the PARENT's frame, so every leg
     * tips the same way in model space — all four reach out behind the machine
     * instead of one to each corner, and the pads end up under the pavement.
     * YXZ puts the corner rotation first, which is what makes the X a splay
     * rather than a lean.
     *
     * With the corner applied first, local +Z points OUTWARD, and a positive X
     * tips the leg toward local −Z — inward. So the splay below is negative and
     * the knee folds back positive: both are stated once, in the parts record,
     * and every pose reads them from there.
     */
    hip.rotation.order = 'YXZ';
    hip.rotation.y = a;
    g.add(hip);

    hip.add(at(cyl(0.030, 0.030, 0.062, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
    // the thigh: a box section with a lightening cut down it, not a stick
    const thighH = 0.195;
    hip.add(at(box(0.056, thighH, 0.042, steel), 0, -thighH / 2, 0));
    hip.add(at(box(0.020, thighH * 0.7, 0.046, oil), 0, -thighH / 2, 0));
    hip.add(at(box(0.060, 0.010, 0.046, hazard), 0, -thighH + 0.012, 0));  // banded end

    // the ram that folds it, as on the Mk I — the family resemblance is the
    // point: these two machines came out of the same shed.
    const ramPivot = new THREE.Group();
    ramPivot.position.set(0.050, -0.014, 0);
    hip.add(ramPivot);
    ramPivot.add(at(cyl(0.018, 0.018, 0.090, oil, 8), 0, -0.045, 0));
    const rod = at(cyl(0.009, 0.009, 0.105, chrome, 6), 0, -0.122, 0);
    ramPivot.add(rod);

    // knee, and the shin below it
    const knee = new THREE.Group();
    knee.position.set(0, -thighH, 0);
    hip.add(knee);
    knee.add(at(cyl(0.024, 0.024, 0.052, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
    const shinH = 0.150;
    knee.add(at(box(0.042, shinH, 0.042, steel), 0, -shinH / 2, 0));

    /**
     * THE LEVELLING JACK. A screw thread and a collar, and it extends as the
     * leg goes down — because a gun this heavy has to sit LEVEL, and the
     * honest way to say that is to show the thing that levels it. The Mk I
     * simply lands on its pads and hopes.
     */
    const jack = new THREE.Group();
    jack.position.set(0, -shinH, 0);
    knee.add(jack);
    jack.add(at(cyl(0.013, 0.013, 0.075, chrome, 8), 0, -0.037, 0));
    for (let k = 0; k < 5; k++) {                   // the thread, as real turns
      jack.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.0035, 4, 9), chrome),
        0, -0.012 - k * 0.013, 0).rotateX(Math.PI / 2));
    }
    jack.add(at(cyl(0.024, 0.024, 0.018, brass, 8), 0, -0.006, 0));        // the collar
    jack.add(at(box(0.048, 0.008, 0.012, brass), 0, -0.006, 0));           // its tommy bar

    const pad = new THREE.Group();
    pad.position.set(0, -0.070, 0);
    jack.add(pad);
    pad.add(at(cyl(0.058, 0.066, 0.020, dark, 10), 0, -0.010, 0));
    pad.add(at(cyl(0.032, 0.032, 0.014, chrome, 8), 0, 0.006, 0));
    for (let k = 0; k < 4; k++) {                   // grousers
      const ga = (k / 4) * TAU;
      pad.add(at(box(0.014, 0.011, 0.046, oil), Math.sin(ga) * 0.032, -0.022, Math.cos(ga) * 0.032)
        .rotateY(ga));
    }
    // Negative out, positive back — see the note on the rotation order above.
    parts.legs.push({ hip, knee, jack, pad, ram: rod, splay: -0.62, fold: 0.44 });
  }

  /**
   * THE SPADE. A blade on an arm behind the case that drives into the ground
   * as it deploys and takes the recoil the legs would otherwise walk on. It is
   * the loudest single beat of the deploy — legs, mast, and then the spade
   * going in — and it is the reason this machine does not creep backwards
   * while it is firing.
   */
  const spadeArm = new THREE.Group();
  spadeArm.position.set(0, HUB_Y - 0.03, -0.13);
  g.add(spadeArm);
  parts.spade = spadeArm;
  spadeArm.add(at(box(0.05, 0.035, 0.11, steel), 0, 0, -0.055));
  spadeArm.add(at(box(0.13, 0.075, 0.012, plate), 0, -0.045, -0.105));     // the blade
  spadeArm.add(at(box(0.13, 0.012, 0.030, hazard), 0, -0.010, -0.105));    // its shoulder
  for (const sx of [-1, 1]) {                                             // its teeth
    spadeArm.add(at(box(0.020, 0.028, 0.010, chrome), sx * 0.042, -0.082, -0.105));
  }

  /* ================================================================== *
   * THE MAST — two stages, and the loom that feeds the deck            *
   * ================================================================== */

  const mast = new THREE.Group();
  mast.position.y = HUB_Y + 0.030;
  g.add(mast);
  parts.mast = mast;
  mast.add(at(cyl(0.072, 0.080, 0.16, steel, 12), 0, 0.080, 0));
  const stage2 = at(cyl(0.056, 0.058, 0.185, chrome, 12), 0, 0.215, 0);
  mast.add(stage2);
  parts.mastStage = stage2;
  for (let k = 0; k < 10; k++) {                    // the cable loom, wrapped
    const t = k / 9, a = t * Math.PI * 3.2;
    mast.add(at(cyl(0.006, 0.006, 0.024, oil, 5),
      Math.sin(a) * 0.066, 0.02 + t * 0.15, Math.cos(a) * 0.066).rotateX(1.2));
  }

  /* ================================================================== *
   * THE SLEW RING — the race, its pinion, and the DRAG CHAIN           *
   * ================================================================== */

  /**
   * The deck rides on the case, so its height is DERIVED from the case's.
   *
   * It is parented to the model root rather than to the mast — the mast
   * telescopes underneath it and would drag it up and down — which means
   * nothing ties the two together except this number. Both heights are put on
   * the rig (`deckY` standing, `deckFold` collapsed) so the entity's deploy,
   * the ghost's frozen pose and the carry model in your hands all read the
   * same figures instead of each keeping a copy.
   */
  const DECK_Y = HUB_Y + 0.220;
  parts.deckY = DECK_Y;
  parts.deckFold = DECK_Y - 0.14;
  const body = new THREE.Group();
  body.position.y = DECK_Y;
  g.add(body);
  parts.body = body;

  body.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 6, 22), brass), 0, 0.02, 0)
    .rotateX(Math.PI / 2));
  for (let i = 0; i < 34; i++) {                    // thirty-four teeth on the race
    const a = (i / 34) * TAU;
    body.add(at(box(0.013, 0.022, 0.022, brass), Math.sin(a) * 0.150, 0.02, Math.cos(a) * 0.150).rotateY(a));
  }
  // twin slew motors, because one of them would not turn this
  for (const sx of [-1, 1]) {
    body.add(at(cyl(0.030, 0.030, 0.070, oil, 8), sx * 0.155, -0.025, -0.03));
    body.add(at(box(0.046, 0.030, 0.046, steel), sx * 0.155, -0.075, -0.03));
  }
  const pinion = at(cyl(0.030, 0.030, 0.026, chrome, 8), 0.155, 0.02, -0.03);
  body.add(pinion);
  parts.pinion = pinion;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    pinion.add(at(box(0.008, 0.026, 0.010, chrome), Math.sin(a) * 0.032, 0, Math.cos(a) * 0.032).rotateY(a));
  }

  /**
   * THE DRAG CHAIN, and why the cover is 240°.
   *
   * Everything above the ring is fed by a cable, and a cable cannot go round
   * and round for ever — so it lives in a chain of links that lies in a
   * gutter around the race and pays out as the head turns. The chain is
   * exactly as long as 240° of travel, which is the mechanical fact the
   * covered arc is: turn past it and you would tear the loom out. Twelve
   * links, laid round the gutter, each one nudged along as the head turns.
   */
  for (let i = 0; i < 12; i++) {
    const link = new THREE.Group();
    link.add(at(box(0.026, 0.014, 0.018, oil), 0, 0, 0));
    link.add(at(cyl(0.005, 0.005, 0.020, chrome, 5), 0.011, 0, 0).rotateX(Math.PI / 2));
    body.add(link);
    parts.chain.push({ node: link, i });
  }

  /* ================================================================== *
   * THE HEAD — everything above the ring turns                          *
   * ================================================================== */

  const head = new THREE.Group();
  head.position.y = 0.050;
  body.add(head);
  parts.head = head;

  head.add(at(cyl(0.118, 0.126, 0.026, plate, 14), 0, 0, 0));            // the deck plate
  head.add(at(box(0.24, 0.010, 0.10, dark), 0, 0.014, -0.02));           // tread plate

  /**
   * THE COUNTERWEIGHT. A cast mass on an arm behind the breech, which is what
   * lets two barrels and a water jacket sit that far in front of the ring
   * without the slew motors fighting the whole time. It hangs on a short
   * pivot, so it LAGS the head a little when it slews — which is the one
   * detail that makes this thing read as heavy rather than as big.
   */
  const cw = new THREE.Group();
  cw.position.set(0, 0.050, -0.135);
  head.add(cw);
  parts.counterweight = cw;
  cw.add(at(box(0.13, 0.075, 0.075, steel), 0, -0.010, -0.03));
  cw.add(at(box(0.14, 0.014, 0.085, steel), 0, 0.030, -0.03));
  cw.add(at(cyl(0.012, 0.012, 0.10, chrome, 6), 0, 0.030, 0).rotateZ(Math.PI / 2));

  /* ---- the cradle: both barrels elevate in one trunnion ---- */
  const cradle = new THREE.Group();
  cradle.position.set(0, 0.100, 0.015);
  head.add(cradle);
  parts.cradle = cradle;

  // the receiver: one body, two bolt ways, and the rails on show between them
  cradle.add(at(box(0.175, 0.070, 0.20, steel), 0, 0, 0));
  cradle.add(at(box(0.185, 0.014, 0.205, dark), 0, 0.040, 0));
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {                                        // lightening holes
      cradle.add(at(cyl(0.012, 0.012, 0.020, oil, 8), sx * 0.088, -0.004, -0.06 + k * 0.042)
        .rotateZ(Math.PI / 2));
    }
  }
  // the trunnion pins, and the elevation screw under the tail
  head.add(at(cyl(0.018, 0.018, 0.20, chrome, 8), 0, 0.100, 0.015).rotateZ(Math.PI / 2));
  head.add(at(cyl(0.011, 0.011, 0.085, chrome, 6), 0, 0.056, -0.095));
  head.add(at(box(0.030, 0.022, 0.030, brass), 0, 0.014, -0.095));
  // the common charging handle: ONE handle, both bolts, and it is pulled once
  // on deploy — the beat that says the gun has just been made ready.
  const charge = at(box(0.026, 0.020, 0.055, chrome), 0.095, 0.030, -0.055);
  cradle.add(charge);
  parts.charge = charge;
  parts.chargeZ = -0.055;

  /* ---- TWO BARRELS, each on its own spring, in a shared water jacket ---- */
  for (let b = 0; b < 2; b++) {
    const sx = b === 0 ? -1 : 1;
    const grp = new THREE.Group();
    grp.position.set(sx * TWO_SPREAD, 0.004, 0.125);
    cradle.add(grp);

    grp.add(at(cyl(0.019, 0.019, 0.34, steel, 10), 0, 0, 0.07).rotateX(Math.PI / 2));
    grp.add(at(cyl(0.012, 0.012, 0.38, oil, 8), 0, 0, 0.08).rotateX(Math.PI / 2));   // bore
    // the jacket around it: a sleeve with its filler cap and a drain
    grp.add(at(cyl(0.030, 0.030, 0.155, jacketMat, 12), 0, 0, 0.00).rotateX(Math.PI / 2));
    for (let k = 0; k < 4; k++) {                                        // jacket bands
      grp.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.004, 4, 12), chrome),
        0, 0, -0.06 + k * 0.042));
    }
    // muzzle: a brake with ports, and the front sight ear beside it
    const brake = at(cyl(0.027, 0.023, 0.050, steel, 8), 0, 0, 0.245);
    brake.rotation.x = Math.PI / 2;
    grp.add(brake);
    for (let k = 0; k < 3; k++) {
      grp.add(at(box(0.006, 0.032, 0.010, oil), 0.025, 0, 0.232 + k * 0.010));
      grp.add(at(box(0.006, 0.032, 0.010, oil), -0.025, 0, 0.232 + k * 0.010));
    }
    // the bolt for this barrel, visible in its way at the back
    const bolt = at(box(0.052, 0.038, 0.062, chrome), sx * TWO_SPREAD, 0.006, -0.045);
    cradle.add(bolt);
    // the muzzle flash for this barrel, hidden until it fires
    // The flash is LIGHT, not paper: additive, so two of them going off
    // together brighten the muzzle rather than pasting two cream rectangles
    // over the machine — which is exactly what a pair of opaque planes at
    // this scale did.
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.072, 0.072),
      new THREE.MeshBasicMaterial({
        color: 0xffd88a, transparent: true, opacity: 0.62,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    flash.position.set(0, 0, 0.285);
    flash.visible = false;
    grp.add(flash);
    // a spent case out of this side
    const shell = at(cyl(0.007, 0.008, 0.026, brass, 6), sx * 0.098, 0.014, -0.02);
    shell.visible = false;
    cradle.add(shell);

    parts.barrels.push({ group: grp, bolt, flash, home: 0.125, boltZ: -0.045, side: sx });
    parts.shells.push({ mesh: shell, side: sx });
  }

  /**
   * THE COOLING PLANT — the reason it can hold a street down.
   *
   * A header tank over the breech, a condenser coil down the back of it, and a
   * relief valve on top. When the jackets go over, the valve lifts and the
   * steam comes out of it: the Mk I glows, this one BOILS, and you can see
   * which from the other end of the road.
   */
  const tank = new THREE.Group();
  tank.position.set(0, 0.070, -0.02);
  cradle.add(tank);
  tank.add(at(cyl(0.040, 0.040, 0.115, jacketMat, 12), 0, 0, 0).rotateZ(Math.PI / 2));
  tank.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.005, 4, 12), brass), -0.045, 0, 0)
    .rotateY(Math.PI / 2));
  tank.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.005, 4, 12), brass), 0.045, 0, 0)
    .rotateY(Math.PI / 2));
  tank.add(at(cyl(0.014, 0.014, 0.020, brass, 8), 0.02, 0.038, 0));         // filler cap
  // the condenser coil, run down the back where it can shed
  for (let k = 0; k < 5; k++) {
    tank.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.004, 4, 10), copper),
      -0.05 + k * 0.025, -0.030, -0.045).rotateX(Math.PI / 2));
  }
  // the relief valve, which lifts when it is boiling
  const valve = new THREE.Group();
  valve.position.set(-0.02, 0.040, 0);
  tank.add(valve);
  valve.add(at(cyl(0.010, 0.013, 0.026, brass, 8), 0, 0.012, 0));
  valve.add(at(box(0.030, 0.006, 0.010, chrome), 0.012, 0.026, 0));         // its lever
  parts.valve = valve;
  // and what comes out of it: four puffs that rise and fade
  for (let k = 0; k < 4; k++) {
    const puff = at(new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), steamMat.clone()),
      -0.02, 0.055, 0);
    puff.visible = false;
    tank.add(puff);
    parts.steam.push({ mesh: puff, i: k });
  }

  /* ================================================================== *
   * THE FEED — a saddle drum that turns, and a rack of spares          *
   * ================================================================== */

  const drum = new THREE.Group();
  drum.position.set(0, 0.098, 0.010);
  cradle.add(drum);
  parts.drum = drum;
  drum.add(at(cyl(0.058, 0.058, 0.040, plate, 14), 0, 0, 0));
  drum.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.006, 5, 16), steel), 0, 0.020, 0)
    .rotateX(Math.PI / 2));
  drum.add(at(cyl(0.018, 0.018, 0.050, chrome, 8), 0, 0.004, 0));           // its spindle
  for (let k = 0; k < 8; k++) {                                            // the rounds in it
    const a = (k / 8) * TAU;
    drum.add(at(cyl(0.006, 0.006, 0.028, brass, 5),
      Math.sin(a) * 0.040, 0.023, Math.cos(a) * 0.040));
  }
  drum.add(at(box(0.028, 0.012, 0.018, hazard), 0.040, 0.024, 0));          // the carry lug
  // the chute from the drum down into the receiver, so the path is visible
  cradle.add(at(box(0.044, 0.042, 0.030, dark), 0, 0.068, 0.010));

  // the rack of spare drums on the left flank — what the loader arm reaches for
  const rack = new THREE.Group();
  rack.position.set(-0.150, 0.010, -0.075);
  head.add(rack);
  rack.add(at(box(0.020, 0.090, 0.130, steel), 0.010, 0.045, 0));
  for (let k = 0; k < 2; k++) {
    const spare = at(cyl(0.062, 0.062, 0.036, plate, 12), -0.030, 0.030 + k * 0.052, 0);
    spare.rotation.z = Math.PI / 2;
    rack.add(spare);
    rack.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.006, 4, 14), brass),
      -0.048, 0.030 + k * 0.052, 0).rotateY(Math.PI / 2));
    parts.rack.push(spare);
  }

  /* ================================================================== *
   * THE LOADER ARM — the closest thing it has to a face                *
   * ================================================================== */

  /**
   * A GANTRY, not a hanging arm.
   *
   * It was a limb dangling off the deck at first, and dangling off the deck is
   * where nothing is visible: the ring, the mast and the drum rack are all in
   * the way, so the one part of this machine with any personality spent its
   * life behind the other parts. It stands UP now — a post on the left of the
   * deck with a jointed arm on top of it — and it slews on its own little
   * turntable, which is what lets one arm reach three places that are nowhere
   * near each other: DOWN AND BACK to the drum rack, UP AND OVER to the feed,
   * and RIGHT ROUND to the data plate at the back to cut a tally into it.
   *
   * Everything is authored pointing UP from its joint, so a rotation of zero
   * is the arm standing to attention and the poses are all departures from it.
   */
  const arm = {};
  const armBase = new THREE.Group();               // the turntable it slews on
  armBase.position.set(-0.115, 0.020, -0.015);
  head.add(armBase);
  arm.base = armBase;
  armBase.add(at(cyl(0.030, 0.034, 0.026, steel, 10), 0, 0.012, 0));
  armBase.add(at(cyl(0.022, 0.022, 0.075, chrome, 8), 0, 0.055, 0));       // the post

  const shoulder = new THREE.Group();
  shoulder.position.set(0, 0.090, 0);
  armBase.add(shoulder);
  arm.shoulder = shoulder;
  shoulder.add(at(cyl(0.020, 0.020, 0.036, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
  shoulder.add(at(box(0.028, 0.115, 0.028, steel), 0, 0.058, 0));          // upper arm
  shoulder.add(at(box(0.012, 0.095, 0.032, oil), 0, 0.058, 0));            // its web
  for (let k = 0; k < 3; k++) {                                            // its actuator
    shoulder.add(at(cyl(0.005, 0.005, 0.026, copper, 5), 0.016, 0.030 + k * 0.030, 0));
  }

  const elbow = new THREE.Group();
  elbow.position.set(0, 0.115, 0);
  shoulder.add(elbow);
  arm.elbow = elbow;
  elbow.add(at(cyl(0.016, 0.016, 0.030, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
  elbow.add(at(box(0.022, 0.100, 0.022, steel), 0, 0.050, 0));             // forearm
  elbow.add(at(box(0.030, 0.014, 0.026, hazard), 0, 0.030, 0));            // its one band

  const wrist = new THREE.Group();
  wrist.position.set(0, 0.100, 0);
  elbow.add(wrist);
  arm.wrist = wrist;
  wrist.add(at(cyl(0.014, 0.014, 0.024, chrome, 8), 0, 0, 0).rotateZ(Math.PI / 2));
  // a two-finger claw, which is what a machine that only ever picks up drums
  // and holds a rag would actually have
  for (const sx of [-1, 1]) {
    const finger = new THREE.Group();
    finger.position.set(sx * 0.012, 0.012, 0);
    wrist.add(finger);
    finger.add(at(box(0.009, 0.038, 0.022, chrome), 0, 0.019, 0));
    finger.add(at(box(0.007, 0.011, 0.024, hazard), sx * 0.002, 0.040, 0));
    arm[sx < 0 ? 'clawL' : 'clawR'] = finger;
  }
  // the rag, tucked in the claw and only out when it is cleaning something
  const rag = at(box(0.028, 0.024, 0.006, new THREE.MeshLambertMaterial({ color: 0xb8452e })),
    0, 0.044, 0.004);
  rag.visible = false;
  wrist.add(rag);
  arm.rag = rag;
  parts.arm = arm;

  /* ================================================================== *
   * THE RANGEFINDER — the bar that makes it a long-range gun            *
   * ================================================================== */

  const rfCard = rangeCardTexture();
  const rf = {};
  const bar = new THREE.Group();
  // A coincidence rangefinder wants a long base, and at 0.60 it had one: a bar
  // two and a half times the width of the machine carrying it, which read as a
  // pair of wings bolted to a gun rather than as part of one. 0.38 is still
  // plainly the longest thing on it and still the reason it can range, without
  // being the whole silhouette.
  bar.position.set(0, 0.185, -0.015);
  head.add(bar);
  rf.bar = bar;
  bar.add(at(box(0.38, 0.030, 0.036, plate), 0, 0, 0));                    // the tube itself
  bar.add(at(box(0.40, 0.010, 0.040, steel), 0, 0.019, 0));
  bar.add(at(cyl(0.014, 0.014, 0.10, chrome, 8), 0, -0.022, 0));           // its pedestal
  // the two braces that actually hold it up, so it is mounted and not floating
  for (const sx of [-1, 1]) {
    bar.add(at(box(0.010, 0.075, 0.010, steel), sx * 0.062, -0.038, 0.004).rotateZ(sx * 0.42));
  }
  bar.add(at(box(0.070, 0.040, 0.046, steel), 0, 0.004, -0.024));          // the eyepiece box
  // the two prism heads, one at each end, which TOE IN onto a target: the
  // whole optical trick of a coincidence rangefinder, and the animation that
  // tells you it has seen something long before the barrels have swung.
  for (const sx of [-1, 1]) {
    const headG = new THREE.Group();
    headG.position.set(sx * 0.185, 0, 0);
    bar.add(headG);
    headG.add(at(box(0.055, 0.055, 0.055, steel), 0, 0, 0));
    headG.add(at(cyl(0.020, 0.020, 0.020, dark, 10), 0, 0, 0.030).rotateX(Math.PI / 2));
    const glass = at(new THREE.Mesh(new THREE.CircleGeometry(0.017, 12), lensMat), 0, 0, 0.041);
    headG.add(glass);
    headG.add(at(box(0.060, 0.010, 0.030, hazard), 0, 0.031, 0));   // the one stripe on it
    rf[sx < 0 ? 'headL' : 'headR'] = headG;
  }
  // the range card on the eyepiece box, because a machine this fussy has one
  const card = at(new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.048),
    new THREE.MeshBasicMaterial({ map: rfCard })), 0.040, 0.006, -0.026);
  card.rotation.y = Math.PI / 2;
  bar.add(card);
  parts.rf = rf;

  /**
   * THE SHIELD — a plate of armour over the breech with a vision slit in it.
   *
   * It does nothing mechanically (nothing shoots back at this machine) and it
   * is not there for nothing: it is the silhouette. A shield with a slit is
   * the single most "gun emplacement" shape there is, and it is what makes the
   * Mk II read as a POST rather than as a tripod.
   */
  const shield = new THREE.Group();
  shield.position.set(0, 0.088, 0.095);
  head.add(shield);
  shield.add(at(box(0.235, 0.115, 0.012, plate), 0, 0.02, 0));
  shield.add(at(box(0.245, 0.012, 0.020, hazard), 0, 0.080, 0));
  for (const sx of [-1, 1]) {                                             // folded wings
    const wing = at(box(0.070, 0.100, 0.010, plate), sx * 0.150, 0.02, -0.018);
    wing.rotation.y = sx * 0.55;
    shield.add(wing);
  }
  // the slit, and the lamp behind it — this is the machine's eye
  shield.add(at(box(0.105, 0.016, 0.016, oil), 0, 0.048, -0.006));
  const eye = at(new THREE.Mesh(new THREE.PlaneGeometry(0.092, 0.012), lensMat), 0, 0.048, 0.008);
  shield.add(eye);
  parts.eye = eye;
  // the spotting lamp under the slit, in a hood
  const lampHood = new THREE.Group();
  lampHood.position.set(0, -0.020, 0.012);
  shield.add(lampHood);
  lampHood.add(at(cyl(0.026, 0.030, 0.030, steel, 10), 0, 0, 0).rotateX(Math.PI / 2));
  const spot = at(new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), lampMat.clone()), 0, 0, 0.017);
  lampHood.add(spot);
  parts.spot = spot;

  /* ================================================================== *
   * STATUS — four lamps, and the plate they keep the score on          *
   * ================================================================== */

  for (let i = 0; i < 4; i++) {
    const l = at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 7, 6), lampMat.clone()),
      -0.033 + i * 0.022, 0.062, -0.118);
    head.add(l);
    head.add(at(cyl(0.015, 0.015, 0.008, dark, 8), -0.033 + i * 0.022, 0.062, -0.124)
      .rotateX(Math.PI / 2));
    parts.lamps.push(l);
  }
  // the data plate, with the tally the loader arm cuts into it
  const plateTex = plateTexture();
  const dataPlate = at(new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.058),
    new THREE.MeshBasicMaterial({ map: plateTex.texture })), 0, 0.024, -0.1265);
  dataPlate.rotation.y = Math.PI;
  head.add(dataPlate);
  parts.dataPlate = dataPlate;
  parts.setTally = (kills) => { plateTex.draw(kills); plateTex.texture.needsUpdate = true; };

  g.scale.setScalar(TWO_SCALE);
  return { group: g, parts };
}
