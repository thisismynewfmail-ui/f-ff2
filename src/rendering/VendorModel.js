import * as THREE from '../../lib/three.module.js';

/**
 * THE VENDOR — a coin-operated upper-torso animatronic, built once and used
 * twice: standing in its kiosk out in Eastgate (entities/ShopKeeper.js) and
 * turning on its own little stage inside the shop menu (rendering/ShopUI.js).
 *
 * The reference is a fairground fortune-teller machine crossed with a frontier
 * shopkeeper: a lacquered enamel cabinet with a brass-lipped delivery tray, a
 * coin throat and a lit marquee, and rising out of the counter a half-figure
 * in a waistcoat — moustache, pipe, wide-brim hat, lamps for eyes — jointed at
 * the waist, shoulders, elbows, neck and jaw. It has no legs and never had
 * any. It is bolted to the machine, and the machine is bolted to the ground.
 *
 * SIZE IS A HARD CONSTRAINT, not a preference: the whole assembly — cabinet
 * and figure together — stands no taller than the player's chest (see HEIGHT
 * against Player.height 1.75). You look DOWN at this thing. Everything below
 * is proportioned off HEIGHT so that stays true if the model is ever retuned.
 *
 * Textures come from the shared library, so the machine is painted in the same
 * pixel enamel as the rest of the town; the face and the marquee card are
 * drawn here as small nearest-filtered canvases, because a painted face is
 * paint, not geometry — everything that MOVES is geometry.
 *
 * The rig exposes named parts and one pose() entry point. Animation itself
 * lives in VendorAnimator (below), which both users drive: the world NPC picks
 * its state from what the player is doing, the shop UI pins it to 'deal'.
 */
/**
 * How big the finished machine is.
 *
 * The parts below are laid out at a natural 1:1 and the assembled group is
 * scaled as a whole, so the proportions are authored once and the SIZE is one
 * number. It stood chest-high at first and read as a novelty; at this scale it
 * is a machine you stand in front of rather than lean over — still comfortably
 * under the player's own 1.75 m, which is the constraint that matters.
 */
export const SCALE = 1.18;
// Total height, ground to the crown of the hat — measured off the assembled
// model rather than declared and hoped for (tests/shop.mjs checks the two
// agree, and that it stays under Player.height).
export const HEIGHT = 1.37 * SCALE;  // ≈ 1.62 m

/**
 * The stand, in the model's own units, and why it is two things.
 *
 * The figure used to be bolted straight onto the top of a 0.62 cabinet, and
 * its arms hang about 0.12 below the waist — so at rest both hands were inside
 * the case, which is to say the machine looked like a torso that had been
 * pushed down into its own box. The stand is the same total height it always
 * was; the top of it is now an OPEN BRASS COLUMN instead of more cabinet, so
 * the arms hang beside the works in clear air and the figure reads as rising
 * out of the machine rather than sunk into it.
 */
export const BASE_H = 0.48;                       // the enamel case
export const PEDESTAL = 0.17;                     // the column above it
export const STAND_H = BASE_H + PEDESTAL;         // 0.65
export const BASE_W = 0.70;
export const BASE_D = 0.54;
const COL_R = 0.13;                               // slim enough for the arms to miss

/* ------------------------------------------------------------------ */
/* painted surfaces                                                     */
/* ------------------------------------------------------------------ */

/**
 * The animatronic's face, painted at 32x32 and left unfiltered so it wears the
 * same pixel grid as every texture in the game. Sun-bleached enamel skin, a
 * heavy moustache, painted brows and the sockets the eye lamps sit in.
 */
function faceTexture() {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const px = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  px(0, 0, S, S, '#cdb68c');                       // the enamel skin
  px(0, 0, S, 3, '#b39c74');                       // shaded under the hat brim
  px(0, S - 4, S, 4, '#b39c74');
  for (let i = 0; i < 70; i++) {                   // crazing and grime in the paint
    const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * S;
    const y = (Math.sin(i * 78.233) * 43758.5453 % 1 + 1) % 1 * S;
    px(x | 0, y | 0, 1, 1, i % 3 ? '#bda87f' : '#a89268');
  }
  px(5, 8, 8, 2, '#5b4630');                       // brows
  px(19, 8, 8, 2, '#5b4630');
  px(4, 11, 9, 6, '#2a2018');                      // the sockets the lamps sit in
  px(19, 11, 9, 6, '#2a2018');
  px(14, 12, 4, 8, '#b9a175');                     // the nose
  px(14, 12, 1, 8, '#d8c39a');
  px(6, 21, 20, 4, '#4a3a24');                     // the moustache, heavy
  px(4, 22, 24, 3, '#5c4930');
  px(2, 23, 5, 2, '#4a3a24');                      // its waxed points
  px(25, 23, 5, 2, '#4a3a24');
  px(12, 27, 8, 2, '#3a2c1c');                     // the mouth line under it
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The gear train seen through the chest porthole — one wheel, drawn once. */
function gearTexture() {
  const S = 48, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1712'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#8a6a20';
  for (let i = 0; i < 12; i++) {                   // teeth
    const a = (i / 12) * Math.PI * 2;
    ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(a);
    ctx.fillRect(-2.5, -22, 5, 8);
    ctx.restore();
  }
  const ring = (r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2); ctx.fill(); };
  ring(16, '#a8842c'); ring(12, '#2a2118'); ring(5, '#c8a244'); ring(2, '#1a1712');
  for (let i = 0; i < 4; i++) {                    // spokes
    ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(i * Math.PI / 4 + 0.3);
    ctx.fillStyle = '#a8842c'; ctx.fillRect(-1.5, -14, 3, 28);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* the rig                                                              */
/* ------------------------------------------------------------------ */

/**
 * Build the machine. `texLib` supplies the shared pixel textures; pass null
 * and it falls back to flat colours (the headless tests build it that way).
 *
 * Returns { group, parts, height }. The group's origin is on the GROUND at
 * the centre of the cabinet, facing +Z, so a caller places it exactly the way
 * it places any other prop.
 */
export function buildVendorModel(texLib = null) {
  // `fallback` is the flat colour to wear when there is no texture library at
  // all (the headless tests build the rig that way). It is stripped rather
  // than spread, because three.js warns about every unknown key it is handed.
  const tex = (name, { fallback = 0x808080, ...opts } = {}) => (texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get(name), ...opts })
    : new THREE.MeshLambertMaterial({ color: fallback, ...opts }));
  const flat = (hex, opts = {}) => new THREE.MeshLambertMaterial({ color: hex, ...opts });

  const enamel = tex('vendorEnamel', { fallback: 0x6a221f });
  const brass = tex('vendorBrass', { fallback: 0xa8842c });
  const brassDark = flat(0x6f5518);
  const iron = flat(0x2b2b2c);
  const glass = flat(0x0f1418, { transparent: true, opacity: 0.62 });
  const cloth = flat(0x5c6a4a);           // the waistcoat
  const shirt = flat(0xb9b6a4);
  const leather = flat(0x4a3524);

  const g = new THREE.Group();
  const parts = {};
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (rt, rb, h, mat, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

  /* ---- the cabinet: a lacquered case on cast feet ---- */
  const hw = BASE_W / 2, hd = BASE_D / 2;
  const PLINTH_TOP = 0.11;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(at(cyl(0.045, 0.06, 0.06, brassDark, 8), sx * (hw - 0.07), 0.03, sz * (hd - 0.07)));
  }
  const plinth = at(box(BASE_W, 0.05, BASE_D, brassDark), 0, PLINTH_TOP - 0.025, 0);
  g.add(plinth);
  const CAB_TOP = BASE_H - 0.045;                 // the underside of the deck
  const cabH = CAB_TOP - PLINTH_TOP;
  const cab = at(box(BASE_W - 0.04, cabH, BASE_D - 0.04, enamel), 0, PLINTH_TOP + cabH / 2, 0);
  g.add(cab);
  // brass corner posts, so the case reads as panels bolted into a frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(at(box(0.045, cabH, 0.045, brass), sx * (hw - 0.03), PLINTH_TOP + cabH / 2, sz * (hd - 0.03)));
  }
  // The cap over the case, with a nosing. It is a CAPPING, not a counter: a
  // wide bright shelf up here made the figure look like it was standing on a
  // table rather than growing out of the machine, so it barely oversails and
  // it is the dark brass, not the bright.
  g.add(at(box(BASE_W + 0.02, 0.035, BASE_D + 0.02, brassDark), 0, BASE_H - 0.017, 0));
  g.add(at(box(BASE_W + 0.05, 0.018, 0.04, brass), 0, BASE_H - 0.042, hd + 0.02));

  // the delivery tray: a recess under the fascia with a brass lip
  g.add(at(box(0.28, 0.09, 0.05, flat(0x120e0a)), 0, 0.195, hd - 0.03));
  g.add(at(box(0.32, 0.03, 0.09, brass), 0, 0.145, hd - 0.01));
  // The working band across the fascia: gauge, trade card, coin throat, all on
  // one line at the height a hand falls to. The case is shorter than it was
  // (its top twelve centimetres went to the column) so the furniture that used
  // to be stacked up it now sits side by side.
  const BAND = 0.335;
  const throat = at(cyl(0.055, 0.04, 0.05, brass, 10), 0.21, BAND, hd - 0.03);
  throat.rotation.x = Math.PI / 2;
  g.add(throat);
  g.add(at(box(0.035, 0.012, 0.02, flat(0x0a0a0a)), 0.21, BAND, hd - 0.005));

  // the pressure dial: brass bezel, ivory card, a needle that actually moves
  const dialR = 0.075;
  g.add(at(cyl(dialR, dialR, 0.03, brass, 16), -0.21, BAND, hd - 0.02).rotateX(Math.PI / 2));
  const card = at(new THREE.Mesh(new THREE.CircleGeometry(dialR - 0.012, 18), flat(0xc9bd97)), -0.21, BAND, hd + 0.001);
  g.add(card);
  const needle = at(box(0.008, dialR - 0.03, 0.006, flat(0xa8281c)), 0, (dialR - 0.03) / 2, 0);
  const needlePivot = at(new THREE.Group(), -0.21, BAND, hd + 0.004);
  needlePivot.add(needle);
  g.add(needlePivot);
  parts.needle = needlePivot;

  // the marquee: the trade card between them, with a row of bulbs over it
  // that chase while the machine is awake
  const sign = at(box(0.24, 0.12, 0.02, tex('signTokens', { fallback: 0x3a2c1c })), 0, BAND, hd - 0.005);
  g.add(sign);
  parts.lamps = [];
  for (let i = 0; i < 5; i++) {
    const bulb = at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 6), flat(0xffd88a, { emissive: 0x704a10 })),
      -0.22 + i * 0.11, BASE_H - 0.075, hd - 0.02);
    g.add(bulb);
    parts.lamps.push(bulb);
  }

  /* ---- the column: the works the figure turns on ----
   *
   * Open, and slim on purpose. The arms hang about twelve centimetres below
   * the waist, so anything wider than the shoulders are apart is something for
   * them to disappear into — which is the whole reason the top of the stand
   * stopped being cabinet.
   */
  g.add(at(cyl(COL_R + 0.03, COL_R + 0.04, 0.03, brassDark, 14), 0, BASE_H + 0.015, 0));
  g.add(at(cyl(COL_R, COL_R, PEDESTAL - 0.05, brass, 14), 0, BASE_H + 0.02 + (PEDESTAL - 0.05) / 2, 0));
  // two banded rings up it, and the drive shaft showing through the gap
  for (const ry of [0.34, 0.72]) {
    g.add(at(cyl(COL_R + 0.018, COL_R + 0.018, 0.016, brassDark, 14), 0, BASE_H + 0.02 + PEDESTAL * ry, 0));
  }
  g.add(at(cyl(0.028, 0.028, PEDESTAL, flat(0x2a2118)), 0.075, BASE_H + PEDESTAL / 2, -0.03));

  /* ---- the figure: everything above the column ---- */
  const torso = at(new THREE.Group(), 0, STAND_H + 0.01, 0);
  g.add(torso);
  parts.torso = torso;

  // the turntable drum it swivels on
  torso.add(at(cyl(0.20, 0.22, 0.06, brass, 14), 0, 0.03, 0));
  // chest: a waistcoat over a shirt, cut down to the drum
  const chestH = 0.30;
  torso.add(at(box(0.34, chestH, 0.22, cloth), 0, 0.06 + chestH / 2, 0));
  torso.add(at(box(0.13, chestH - 0.02, 0.23, shirt), 0, 0.07 + chestH / 2, 0.005));
  torso.add(at(box(0.10, 0.05, 0.235, leather), 0, 0.07, 0.004));   // the belt across its waist
  // the porthole into the works, and the wheel turning behind it
  const gearMat = new THREE.MeshLambertMaterial({ map: gearTexture(), emissive: 0x151008 });
  const gear = at(new THREE.Mesh(new THREE.CircleGeometry(0.062, 16), gearMat), -0.09, 0.06 + chestH * 0.58, 0.113);
  torso.add(gear);
  parts.gear = gear;
  const bezel = at(new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.012, 6, 16), brass), -0.09, 0.06 + chestH * 0.58, 0.118);
  torso.add(bezel);
  torso.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.062, 16), glass), -0.09, 0.06 + chestH * 0.58, 0.122));
  // the trade badge on the other lapel
  torso.add(at(cyl(0.028, 0.028, 0.008, brass, 12), 0.10, 0.06 + chestH * 0.62, 0.116).rotateX(Math.PI / 2));

  // shoulders: a brass yoke the arms hang off
  const shY = 0.06 + chestH - 0.03;
  torso.add(at(box(0.40, 0.05, 0.10, brass), 0, shY, 0));

  parts.arms = [];
  for (const side of [-1, 1]) {
    // shoulder pivot -> upper arm -> elbow pivot -> forearm -> hand
    const shoulder = at(new THREE.Group(), side * 0.20, shY, 0);
    torso.add(shoulder);
    shoulder.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 7), brass), 0, 0, 0));
    const upper = at(box(0.07, 0.17, 0.075, cloth), 0, -0.095, 0);
    shoulder.add(upper);
    const elbow = at(new THREE.Group(), 0, -0.18, 0);
    shoulder.add(elbow);
    elbow.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.033, 8, 7), brass), 0, 0, 0));
    const fore = at(box(0.06, 0.15, 0.065, shirt), 0, -0.085, 0);
    elbow.add(fore);
    elbow.add(at(cyl(0.035, 0.035, 0.03, brass, 10), 0, -0.155, 0)); // the cuff ring
    const hand = at(new THREE.Group(), 0, -0.175, 0);
    elbow.add(hand);
    hand.add(at(box(0.055, 0.06, 0.045, flat(0xc0ab84)), 0, -0.028, 0));
    for (let f = 0; f < 3; f++) {                                    // three jointed fingers
      hand.add(at(box(0.014, 0.045, 0.016, flat(0xb59d76)), -0.016 + f * 0.016, -0.075, 0.008));
    }
    hand.add(at(box(0.014, 0.035, 0.016, flat(0xb59d76)), 0.026, -0.062, -0.012)); // and a thumb
    parts.arms.push({ shoulder, elbow, hand, side });
  }

  // neck armature and head
  const neck = at(cyl(0.035, 0.045, 0.06, brass, 10), 0, 0.06 + chestH + 0.02, 0);
  torso.add(neck);
  const head = at(new THREE.Group(), 0, 0.06 + chestH + 0.05, 0);
  torso.add(head);
  parts.head = head;
  const headH = 0.20;
  const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture() });
  const skull = at(box(0.19, headH, 0.17, flat(0xbfa87e)), 0, headH / 2, 0);
  head.add(skull);
  head.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.185, headH - 0.01), faceMat), 0, headH / 2, 0.0865));
  // eye lamps, sunk into the painted sockets
  parts.eyes = [];
  for (const side of [-1, 1]) {
    const eye = at(new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 7),
      new THREE.MeshLambertMaterial({ color: 0xffe6a0, emissive: 0xc07a10 })), side * 0.045, headH * 0.62, 0.082);
    head.add(eye);
    parts.eyes.push(eye);
  }
  // the jaw, hinged under the moustache
  const jaw = at(new THREE.Group(), 0, headH * 0.30, 0.03);
  head.add(jaw);
  jaw.add(at(box(0.13, 0.045, 0.10, flat(0xb59d76)), 0, -0.022, 0.02));
  parts.jaw = jaw;
  /* The pipe, clamped in the corner of that jaw.
   *
   * ONE ASSEMBLY, AIMED ONCE. The stem, the bowl and the ember used to be
   * three loose pieces each turned by its own hand-picked angles, and they
   * did not agree: the stem was pitched BACK into the head while the bowl sat
   * forward of it, so what you saw from the front was a stick lying flat
   * across the cheek with a lump floating off the end of it. Now the stem runs
   * along the assembly's +z from the mouth to the bowl and the whole thing is
   * pointed with one rotation — out past the moustache, forward, and up.
   * The bowl takes that pitch back out again so it stands upright wherever the
   * stem is aimed, and the ember rides in the top of it. */
  const pipe = at(new THREE.Group(), 0.062, -0.030, 0.060);
  pipe.rotation.set(-0.34, 0.62, 0);
  jaw.add(pipe);
  const STEM = 0.115;
  pipe.add(at(cyl(0.010, 0.010, STEM, leather, 8), 0, 0, STEM / 2).rotateX(Math.PI / 2));
  const bowl = at(new THREE.Group(), 0, 0.004, STEM + 0.006);
  bowl.rotation.x = 0.34;
  pipe.add(bowl);
  bowl.add(at(cyl(0.026, 0.021, 0.048, leather, 9), 0, 0.024, 0));
  parts.emberLight = at(new THREE.Mesh(new THREE.CircleGeometry(0.019, 10),
    new THREE.MeshBasicMaterial({ color: 0xff7a28, transparent: true, opacity: 0.5 })), 0, 0.049, 0);
  parts.emberLight.rotation.x = -Math.PI / 2;
  bowl.add(parts.emberLight);

  // the hat: a low crown and a wide brim, which is most of the silhouette
  const hat = at(new THREE.Group(), 0, headH - 0.005, 0);
  head.add(hat);
  hat.add(at(cyl(0.20, 0.21, 0.018, flat(0x6b5a3c), 14), 0, 0.009, 0.005));
  hat.add(at(cyl(0.088, 0.10, 0.075, flat(0x7a6846), 14), 0, 0.055, 0));
  hat.add(at(cyl(0.102, 0.102, 0.022, leather, 14), 0, 0.03, 0));      // the band
  parts.hat = hat;

  g.scale.setScalar(SCALE);
  return { group: g, parts, height: HEIGHT };
}

/* ------------------------------------------------------------------ */
/* animation                                                            */
/* ------------------------------------------------------------------ */

/**
 * The vendor's animation states. Each is a whole little performance rather
 * than a pose, because a machine that only ever breathes reads as broken:
 *
 *   sleep   nobody has been past in a while. The head is down, the lamps are
 *           embers, one arm hangs. It creaks over on its bearing now and then.
 *   idle    the resting behaviour, and NOT one loop — the idle sets below are
 *           cycled through with pauses between, so it wipes the counter, then
 *           winds itself, then drums its fingers, then just looks around.
 *   greet   somebody came within range: it straightens up, both hands come to
 *           the counter, the lamps come up and the jaw works a welcome.
 *   deal    the shop is open. It presents the wares — hands turned out, head
 *           tracking whatever the customer is reading, jaw ticking along.
 *   sale    a purchase went through: one hand sweeps to the delivery tray, the
 *           needle kicks, the marquee flashes.
 *   refuse  it could not be paid. The head shakes once and a hand comes up.
 *
 * IDLE_SETS is the part that makes it read as a character. The animator picks
 * one, plays it once, holds for a beat and picks a DIFFERENT one, so you never
 * see the same gesture twice running.
 */
export const IDLE_SETS = ['survey', 'polish', 'wind', 'drum', 'doze'];

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
/** A 0..1 ramp that rises, holds and falls across a gesture's own clock. */
const pulse = (t, rise = 0.25, fall = 0.25) => (
  t < rise ? ease(t / rise) : t > 1 - fall ? ease((1 - t) / fall) : 1);

export class VendorAnimator {
  constructor(rig) {
    this.rig = rig;
    this.parts = rig.parts;
    this.t = 0;
    this.state = 'sleep';
    this.stateT = 0;
    this.wake = 0;              // 0 asleep .. 1 fully lit, eased between states
    this.idleSet = IDLE_SETS[0];
    this.idleT = 0;
    this.idleHold = 1.5;
    this._idleIndex = 0;
    this.lookYaw = 0;           // where the head is turned, radians, eased
    this.lookPitch = 0;
    this._flash = 0;            // marquee flash left over from a sale
    this._shake = 0;            // a refusal being shaken off
  }

  /** Switch behaviour. Re-entering the same state does not restart it. */
  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateT = 0;
    if (next === 'idle') this._nextIdle();
    if (next === 'sale') this._flash = 1;
    if (next === 'refuse') this._shake = 1;
  }

  /** Play a one-shot over whatever it is doing (a sale, a refusal). */
  poke(kind) {
    if (kind === 'sale') { this._flash = 1; this.setState('sale'); }
    else if (kind === 'refuse') { this._shake = 1; this.setState('refuse'); }
  }

  _nextIdle() {
    // Step to a DIFFERENT set each time. Cycling with a random skip keeps it
    // from repeating itself while still never picking the same one twice.
    this._idleIndex = (this._idleIndex + 1 + ((Math.random() * (IDLE_SETS.length - 1)) | 0)) % IDLE_SETS.length;
    this.idleSet = IDLE_SETS[this._idleIndex];
    this.idleT = 0;
    this.idleHold = 1.2 + Math.random() * 2.6;
  }

  /**
   * Advance one frame.
   *   dt      seconds
   *   look    { yaw, pitch } the head should turn toward, in the rig's own
   *           frame (0 = straight ahead), or null to face front
   */
  update(dt, look = null) {
    this.t += dt;
    this.stateT += dt;
    const p = this.parts;
    const awake = this.state !== 'sleep';
    this.wake += ((awake ? 1 : 0) - this.wake) * Math.min(1, dt * 2.2);
    this._flash = Math.max(0, this._flash - dt * 1.6);
    this._shake = Math.max(0, this._shake - dt * 1.4);

    // --- where the head is pointed. Eased, and clamped: it is bolted to a
    // machine, so it cannot look over its own shoulder.
    const wantYaw = Math.max(-0.85, Math.min(0.85, look?.yaw ?? 0));
    const wantPitch = Math.max(-0.45, Math.min(0.35, look?.pitch ?? 0));
    this.lookYaw += (wantYaw - this.lookYaw) * Math.min(1, dt * 3.4);
    this.lookPitch += (wantPitch - this.lookPitch) * Math.min(1, dt * 3.0);

    // --- the constant, whatever it is doing: the works turn and it breathes
    if (p.gear) p.gear.rotation.z -= dt * (0.4 + this.wake * 1.9);
    const breath = Math.sin(this.t * 1.15) * 0.012 * (0.4 + this.wake);

    // --- per-state pose, accumulated as offsets from rest
    const pose = {
      torsoYaw: 0, torsoPitch: 0, torsoLift: 0,
      headYaw: this.lookYaw, headPitch: this.lookPitch, headRoll: 0,
      jaw: 0, armL: { pitch: 0.05, roll: 0.12, elbow: -0.2 }, armR: { pitch: 0.05, roll: 0.12, elbow: -0.2 },
      eye: 0.25 + this.wake * 0.75,
    };
    if (this.state === 'sleep') this._poseSleep(pose);
    else if (this.state === 'idle') this._poseIdle(pose, dt);
    else if (this.state === 'greet') this._poseGreet(pose);
    else if (this.state === 'deal') this._poseDeal(pose);
    else if (this.state === 'sale') this._poseSale(pose);
    else if (this.state === 'refuse') this._poseRefuse(pose);

    // a refusal shakes the head whatever else is going on
    if (this._shake > 0) pose.headYaw += Math.sin(this._shake * 26) * 0.30 * this._shake;

    this._apply(pose, breath);
  }

  /* ---- the states ---- */

  _poseSleep(o) {
    const sag = 0.9;
    o.headPitch = 0.42 * sag + Math.sin(this.t * 0.31) * 0.02;
    o.headYaw = Math.sin(this.t * 0.11) * 0.10;          // it creaks on its bearing
    o.torsoPitch = 0.10;
    o.torsoYaw = Math.sin(this.t * 0.09) * 0.06;
    o.armL = { pitch: 0.55, roll: 0.05, elbow: -0.15 };  // one arm hanging
    o.armR = { pitch: 0.12, roll: 0.10, elbow: -0.55 };
    o.eye = 0.10 + Math.max(0, Math.sin(this.t * 0.7)) * 0.06;
  }

  /**
   * Resting behaviour: whichever idle set is up plays out over its own clock,
   * then a pause, then a different one. Every set leaves the rig where it
   * found it, so they can follow each other in any order.
   */
  _poseIdle(o, dt) {
    this.idleT += dt;
    const sway = Math.sin(this.t * 0.62) * 0.05;
    o.torsoYaw = sway;
    o.headYaw += Math.sin(this.t * 0.44 + 1.1) * 0.06;

    const DUR = { survey: 5.0, polish: 4.2, wind: 3.6, drum: 3.4, doze: 5.4 }[this.idleSet];
    const f = Math.min(1, this.idleT / DUR);
    const k = pulse(f, 0.2, 0.25);
    switch (this.idleSet) {
      case 'survey': {          // looks off down the road, then back
        const s = Math.sin(this.idleT * 0.9);
        o.headYaw += s * 0.55 * k;
        o.headPitch += -0.08 * k;
        o.torsoYaw += s * 0.12 * k;
        break;
      }
      case 'polish': {          // wipes the counter in front of it
        const s = Math.sin(this.idleT * 3.1);
        o.armR = { pitch: 1.15 * k + 0.05, roll: 0.30 + s * 0.22 * k, elbow: -1.05 * k - 0.2 };
        o.torsoPitch += 0.09 * k;
        o.headPitch += 0.22 * k;
        o.headYaw += s * 0.10 * k;
        break;
      }
      case 'wind': {            // winds the key in its own side, twice
        const s = (this.idleT * 2.6) % TAU;
        // The reach is the SHOULDER going back, not the arm swinging in: the
        // key is on its flank, and its flank is only 0.03 inboard of where the
        // hand already hangs. Rolling in to find it puts the hand in the works.
        o.armL = { pitch: 0.85 * k + 0.05, roll: 0.12 + 0.06 * k, elbow: -1.25 * k - 0.2 };
        o.torsoYaw += -0.16 * k;
        o.headPitch += 0.26 * k;
        o.headYaw += -0.24 * k;
        o.jaw = Math.max(0, Math.sin(s)) * 0.10 * k;
        break;
      }
      case 'drum': {            // drums its fingers, bored
        o.armR = { pitch: 1.25 * k + 0.05, roll: 0.18, elbow: -1.15 * k - 0.2 };
        o.armR.pitch += Math.abs(Math.sin(this.idleT * 7.5)) * 0.06 * k;
        o.headPitch += 0.12 * k;
        o.headYaw += Math.sin(this.idleT * 0.7) * 0.30 * k;
        break;
      }
      case 'doze': {            // nods off, catches itself, sits up again
        const droop = Math.min(1, f * 1.6);
        const jerk = f > 0.72 ? Math.exp(-(f - 0.72) * 26) : 0;
        o.headPitch += 0.40 * droop * (1 - jerk) - 0.22 * jerk;
        o.torsoPitch += 0.07 * droop * (1 - jerk);
        o.eye *= 1 - 0.7 * droop * (1 - jerk);
        o.jaw = jerk * 0.35;
        break;
      }
    }
    if (this.idleT > DUR + this.idleHold) this._nextIdle();
  }

  _poseGreet(o) {
    const f = Math.min(1, this.stateT / 1.1);
    const k = ease(f);
    o.torsoLift = 0.02 * k;
    o.torsoPitch = -0.06 * k;
    o.headPitch -= 0.10 * k;
    // both hands come up onto the counter — the same number for both, because
    // _apply is what mirrors them
    const arm = { pitch: 1.15 * k + 0.05, roll: 0.30 * k + 0.12, elbow: -1.0 * k - 0.2 };
    o.armL = { ...arm };
    o.armR = { ...arm };
    o.jaw = Math.max(0, Math.sin(this.stateT * 9)) * 0.30 * (1 - f * 0.5);
    o.headYaw += Math.sin(this.stateT * 1.6) * 0.06;
  }

  _poseDeal(o) {
    const s = Math.sin(this.t * 1.5), s2 = Math.sin(this.t * 0.9 + 2.0);
    // Hands turned out over the goods, alternating which one presents — the
    // alternation is in the numbers, not in their signs, since a negative roll
    // here means a hand crossing its own chest. The roll is kept small on
    // purpose: past about a fifth of a radian the arms stop reading as
    // presenting and start reading as a scarecrow.
    o.armL = { pitch: 1.05 + s * 0.16, roll: 0.20 + s2 * 0.07, elbow: -0.95 + s2 * 0.14 };
    o.armR = { pitch: 1.05 - s * 0.16, roll: 0.20 - s2 * 0.07, elbow: -0.95 - s2 * 0.14 };
    o.torsoPitch = -0.05 + s2 * 0.02;
    o.torsoYaw = s2 * 0.06;
    o.headPitch += 0.06;
    o.jaw = Math.max(0, Math.sin(this.t * 7.5)) * 0.22;   // talking the whole time
  }

  _poseSale(o) {
    const f = Math.min(1, this.stateT / 1.4);
    const k = pulse(f, 0.22, 0.3);
    // the right hand dives to the tray, the left stands clear of it
    o.armR = { pitch: 1.55 * k + 0.05, roll: 0.16, elbow: -1.5 * k - 0.2 };
    o.armL = { pitch: 0.75 * k + 0.05, roll: 0.30, elbow: -0.6 * k - 0.2 };
    o.torsoPitch = 0.16 * k;
    o.headPitch += 0.26 * k;
    o.jaw = Math.max(0, Math.sin(this.stateT * 8)) * 0.28 * k;
    if (f >= 1) this.setState('deal');
  }

  _poseRefuse(o) {
    const f = Math.min(1, this.stateT / 1.0);
    const k = pulse(f, 0.2, 0.35);
    o.armR = { pitch: 1.35 * k + 0.05, roll: 0.55 * k + 0.12, elbow: -1.25 * k - 0.2 };
    o.torsoPitch = -0.08 * k;
    o.headPitch -= 0.10 * k;
    o.jaw = 0.16 * k;
    if (f >= 1) this.setState('deal');
  }

  /* ---- push the pose onto the rig ---- */

  _apply(o, breath) {
    const p = this.parts;
    if (p.torso) {
      // These are the MODEL's own units — the group's scale is applied above
      // them — so the rest height here is the unscaled cabinet, not HEIGHT.
      p.torso.rotation.set(o.torsoPitch, o.torsoYaw, 0);
      p.torso.position.y = STAND_H + 0.01 + o.torsoLift + breath;
    }
    if (p.head) p.head.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    if (p.jaw) p.jaw.rotation.x = o.jaw;
    // ROLL IS WRITTEN BODY-RELATIVE, AND MIRRORED HERE. Positive is AWAY from
    // the chest on either side; negative crosses it. A pose says what BOTH
    // arms are doing with the same number and `a.side` is the only place the
    // two are ever told apart — say it in the pose as well and the arm on +x
    // lands on side × (−roll) and swings INTO the waistcoat while its opposite
    // number swings out. The chest is 0.34 across, the shoulders 0.40, so a
    // hand pulled inside ±0.17 is inside the machine.
    for (const a of p.arms ?? []) {
      const src = a.side < 0 ? o.armL : o.armR;
      a.shoulder.rotation.set(src.pitch, 0, a.side * src.roll);
      a.elbow.rotation.x = src.elbow;
    }
    const glow = Math.max(0, Math.min(1, o.eye)) * (0.85 + Math.sin(this.t * 13.7) * 0.07);
    for (const e of p.eyes ?? []) {
      e.material.emissive.setRGB(glow * 0.95, glow * 0.58, glow * 0.10);
    }
    if (p.emberLight) p.emberLight.material.opacity = 0.25 + this.wake * 0.35 + Math.sin(this.t * 2.3) * 0.12;
    // the marquee chases while it is awake, and floods on a sale
    const lamps = p.lamps ?? [];
    lamps.forEach((b, i) => {
      const chase = (Math.sin(this.t * 3.4 - i * 0.9) + 1) / 2;
      const v = Math.min(1, this.wake * (0.25 + chase * 0.55) + this._flash);
      b.material.emissive.setRGB(v * 0.85, v * 0.55, v * 0.14);
    });
    // the dial needle sits where the machine's mood is: dead asleep, hard over
    // when it has just taken your money
    if (p.needle) p.needle.rotation.z = lerp(0.9, -0.55, Math.min(1, this.wake * 0.7 + this._flash * 0.6));
  }
}
