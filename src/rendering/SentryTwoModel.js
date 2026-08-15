import * as THREE from '../../lib/three.module.js';

/**
 * THE WARDEN — Sentry Mk II, and what the county actually built.
 *
 * ── THE ONE THING TO KNOW ─────────────────────────────────────────────────
 *
 * The Mk I is a pistol on a tripod. The Mk II is a pistol on a tripod bolted
 * to the top of a PERSON.
 *
 * The county's manual calls the bottom half the COMPUTING SECTION and leaves
 * it at that. It is a cast drum standing on four legs, and behind two armoured
 * doors in the front of it there is a glass vessel with a human brain in it,
 * perfused, wired, and doing the arithmetic. Everything charming the machine
 * does — the salute, the little self-tests, the tally it cuts into its own
 * data plate — is the same machine, and the second time you look at it none of
 * it is charming.
 *
 * Nothing in the game ever says this out loud. The doors open on deploy, the
 * jar is at the height of your own chest, and the plate under it has a name
 * on it. That is the whole delivery.
 *
 * ── THE TWO HALVES, AND WHY THE MACHINE IS SHAPED LIKE THIS ───────────────
 *
 *   LOWER — THE COMPUTING SECTION
 *     An octagonal cast drum with a face to each point of the compass, so
 *     walking round one is worth doing:
 *       FRONT   the vessel: armoured double doors, the glass, the brain, the
 *               electrode crown, and the subject plate under the sill
 *       LEFT    the perfusion plant: a bottle in a cage, a piston pump that
 *               strokes in time with the heartbeat, and a pressure gauge —
 *               on the left because that is the side the loader arm is on,
 *               and the arm is what taps the bottle when the level drops
 *       RIGHT   heat louvres that crack open when the jackets go over, and a
 *               spanner somebody clipped there and never came back for
 *       BACK    the oscillograph — a real scrolling paper trace of what the
 *               thing in the jar is doing — the nerve-loom drum, and a
 *               chimney with a cowl that turns whenever it is thinking
 *
 *   UPPER — THE GUN
 *     Twin water-jacketed barrels on a slew ring, a coincidence rangefinder,
 *     a saddle drum, a loader arm and a shield. It is crew-served kit with no
 *     crew, because the crew is downstairs in the jar.
 *
 * The deck rides on TWIN REAR POSTS and a kingpin rather than a central mast:
 * the whole front of the drum had to be left clear for the vessel, so the load
 * path went round it. The counterweight hangs directly over those posts, which
 * is the mechanical reason the mass behind the breech is where it is.
 *
 * ── MECHANISM FIRST ───────────────────────────────────────────────────────
 * Panelling left off, exactly as the Mk I is built. If a part of this moves in
 * SentryTwo.js, the thing that moves it is on show.
 *
 * Built facing +Z with its feet ON the origin plane — the four pads land at
 * y=0 and only the spade goes below it — so the entity places it exactly as it
 * places any other object and `mesh.rotation.y = yaw` points it where the
 * player was looking. Every height in here derives from HUB_Y, PED_Y0 and
 * DECK_Y, which are stated once each and never guessed at again.
 *
 * Four callers want this rig: the deployed gun, the translucent ghost in the
 * placement preview, the copy in the player's hands, and the folded copy the
 * deploy animation starts from. The last three are all poses, and rather than
 * let three files each keep their own opinion of what "folded" means, the two
 * poses are exported from here — poseTwoDeployed() and poseTwoFolded().
 *
 * ── THE RIG, and what drives each piece ───────────────────────────────────
 *
 *   legs[i].hip        splay     the quadrupod opening out of its case
 *   legs[i].knee       fold      one beat behind the hip, as on the Mk I
 *   legs[i].jack       screw     the levelling jack, which visibly extends
 *   legs[i].pad        level     keeps the footpad flat as the leg swings
 *   latches[i]         pop       four transit latches off the case joint
 *   spade              bite      the drop spade, driven down into the turf
 *   posts[i]           rise      the twin rear posts the deck stands on
 *   body               rise      the deck coming up off the drum's shoulders
 *   head               yaw       everything above the slew ring
 *   chain[i]           drag      the cable chain paying out around the ring
 *   loom[i]            twist     the nerve loom, wound round the kingpin
 *   counterweight      swing     the mass behind the breech, which lags
 *   cradle             pitch     the trunnion both barrels elevate in
 *   cradle.position.z  battery   the whole gun running out into battery
 *   clamps[i]          release   the transit clamps that hold it for carry
 *   wings[i]           spread    the shield's side wings
 *   barrels[i].group   recoil    each barrel runs on its own spring
 *   barrels[i].bolt    cycle     two bolts, and they work together
 *   barrels[i].flash   fire      twin muzzle flashes
 *   shells[i]          eject     one case out of each side, per pair
 *   drum               feed      the saddle drum, turning as it empties
 *   arm.*              load      base / post / shoulder / elbow / wrist / claw
 *   rf.bar             extend    the rangefinder, telescoped down for carry
 *   rf.capL/R          uncover   the prism caps flipping off the glass
 *   rf.headL/R         converge  the prisms toeing in onto a target
 *   jacketMat          heat      the water jacket going over
 *   louvres[i]         vent      the drum's heat louvres cracking open
 *   steam[i]           boil      what comes out of the relief valve
 *   lamps[i]           say       four status lamps in a bar
 *   eyeLid             blink     the shutter over the vision slit
 *   cowl               think     the chimney cowl, turning while it computes
 *
 *   doors.L/R          open      the armoured doors over the vessel
 *   brain              beat      the thing in the jar, swelling on every pulse
 *   brainTurn          regard    the thing in the jar, turning to look at you
 *   crown              seat      the electrode crown coming down onto the stem
 *   bubbles[]          perfuse   what rises through the fluid
 *   fluidMat           glow      the vessel lamp behind the glass
 *   pump / pumpRod     stroke    the perfusion piston, on the heartbeat
 *   bottleFill         drain     how much perfusate is left, visibly
 *   gauge              read      the pressure needle
 *   osc.push(v)        write     one more column of the paper trace
 *   osc.word(s)        say       ...and once in a while, a word instead
 *   setTally(n)        notch     the kill marks SCRATCHED INTO the data plate
 */

/**
 * How big the finished machine is, applied to the assembled group.
 *
 * The Mk I stands at 1.35 and reads as waist-high. This one is authored a
 * little larger and scaled a little larger again, so that standing next to one
 * the difference is not a stat on a card — it is that the thing is plainly
 * bigger than the one you already own, and that the window in the front of it
 * is at the height of your own chest.
 */
export const TWO_SCALE = 1.52;

/**
 * Where the barrels sit and how far the muzzles stand out, in model units.
 *
 * Exported so the entity's ballistics read the model rather than guessing —
 * and MEASURED off the assembled rig rather than estimated, because these two
 * numbers are the origin of every line-of-sight test the gun does. Guess them
 * low and the machine shoots from inside its own drum: it refuses targets it
 * can plainly see, and there is nothing on screen to say why.
 */
export const TWO_EYE = 0.866;
export const TWO_MUZZLE = 0.42;
/** How far apart the two bores are — the entity fires from both. */
export const TWO_SPREAD = 0.062;
/** Top of the rangefinder, in model units — the entity's collision height. */
export const TWO_HEIGHT = 0.970;
/**
 * How high the thing in the jar sits, in WORLD metres above the machine's feet.
 *
 * Exported because the entity has to know where its own vessel is in order to
 * work out whether the player is looking AT IT rather than merely at the gun —
 * which is the difference between two of the easter eggs firing and neither of
 * them ever firing.
 */
export const TWO_BRAIN_Y = 0.505 * TWO_SCALE;

const TAU = Math.PI * 2;

/* ====================================================================== *
 * THE STACK. Every height in the machine comes off one of these four.    *
 * ====================================================================== */

/** The hip line: where the legs hang off the case. */
const HUB_Y = 0.385;
/** The computing drum: bottom, top, and the radius of its eight faces. */
const PED_Y0 = 0.412;
const PED_Y1 = 0.630;
const PED_R = 0.150;
/** An octagon's flat face is nearer the axis than its corners. */
const FACE_Z = PED_R * Math.cos(Math.PI / 8);      // 0.1386
/** The gun deck, standing, and how far it drops for carry. */
const DECK_Y = 0.712;
const DECK_LIFT = 0.054;

/** The vessel: where the glass is, and how big the thing inside it is. */
const JAR_Y = 0.524;
const JAR_Z = 0.020;         // dead centre of the frame, in the open air
const JAR_R = 0.070;
const JAR_H = 0.168;
/**
 * THE BRAIN, IN SCALE, AND WHY THAT MATTERS MORE THAN IT SOUNDS.
 *
 * A real brain is about 167 mm front to back, 140 across and 93 tall. Divide
 * by TWO_SCALE and that is exactly the box below — so the thing behind the
 * glass is life-size, and the vessel had to be built around it rather than the
 * other way round. Get this wrong in either direction and the whole reveal
 * goes with it: a big one is an aquarium prop, and a small one is a walnut in
 * a jam jar. At 0.505 model units it sits 0.77 m off the ground, which is the
 * player's chest — you meet it at eye level the moment you crouch.
 */
const BRAIN_L = 0.103;       // front to back  (0.167 m assembled)
const BRAIN_W = 0.081;       // side to side   (0.140 m assembled)
const BRAIN_H = 0.053;       // top to bottom  (0.093 m assembled)
const BRAIN_Y = 0.505;

/**
 * WHO IS IN THERE.
 *
 * Eight of them, and a machine picks one by where it is standing so it keeps
 * the same identity across a save, a checkpoint rollback and a pack-up. Deploy
 * two and they are two different people, which is the fastest way to make the
 * point without a line of dialogue anywhere.
 *
 * `word` is the one thing that still surfaces: it is what the oscillograph
 * writes instead of a trace when the machine is dreaming, and what the arm
 * eventually scratches into the data plate once the tally runs off the end.
 */
export const SUBJECTS = [
  { no: '07-1187', name: 'HALVORSEN, E.', note: 'VOL.  11 MAR', word: 'WARM' },
  { no: '07-1204', name: 'OKONKWO, A.', note: 'VOL.  02 APR', word: 'STILL HERE' },
  { no: '07-1219', name: 'REDDING, M.', note: 'NON-VOL.', word: 'WHO' },
  { no: '07-1233', name: 'SZABO, I.', note: 'VOL.  19 APR', word: 'COLD' },
  { no: '07-1240', name: 'BRACE, T.', note: 'NON-VOL.', word: 'LET ME' },
  { no: '07-1258', name: 'AMBROSE, R.', note: 'STAFF', word: 'I AGREED' },
  { no: '07-1266', name: 'DELACROIX, J.', note: 'VOL.  30 APR', word: 'MOTHER' },
  { no: '07-1271', name: 'FENN, W.', note: 'NON-VOL.', word: 'HOME' },
];

/** Stable per-position pick, so a machine keeps its name across a save. */
export function subjectFor(x = 0, z = 0) {
  const h = Math.abs(Math.round(x * 71.3) * 2654435761 ^ Math.round(z * 53.7) * 40503);
  return SUBJECTS[h % SUBJECTS.length];
}

/* ====================================================================== *
 * CANVAS TEXTURES — the four surfaces that carry writing                 *
 * ====================================================================== */

/** Deterministic hash noise, so grime is the same grime every run. */
const hash = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;

const pixelTex = (canvas) => {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/**
 * The data plate, with the kill tally scratched into it.
 *
 * The Mk I taps its barrel every twenty-fifth kill and that is the end of it.
 * This one KEEPS SCORE: the loader arm reaches over and cuts another mark into
 * the plate, and the mark stays there for the rest of the run. Five to a gate,
 * gates wrapped onto three lines.
 *
 * And then it runs out of plate. What a tidy machine would do is stop and
 * print the number. What this one does is keep cutting — the gates go crooked,
 * they overrun the border, and somewhere past a hundred and fifty the strokes
 * stop being tally marks at all and resolve into the one word the thing in the
 * jar has left. It is the longest-fused easter egg on the machine and the only
 * one you have to actually earn.
 *
 * Redrawn in place on the same canvas, so a tally costs one texture upload and
 * no new objects.
 */
function plateTexture(word = 'WARM') {
  const W = 96, H = 48;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const draw = (kills = 0) => {
    x.fillStyle = '#4a4634'; x.fillRect(0, 0, W, H);           // the painted plate
    x.fillStyle = '#3d3a2a'; x.fillRect(0, 0, W, 2); x.fillRect(0, H - 2, W, 2);
    for (let i = 0; i < 60; i++) {                              // grime in the paint
      x.fillStyle = i % 3 ? '#565240' : '#413e2e';
      x.fillRect((hash(i * 1.7) * W) | 0, (hash(i * 3.1) * H) | 0, 1, 1);
    }
    // the stencil: county property, and which mark of it this is
    x.fillStyle = '#c8b47a';
    x.font = 'bold 11px monospace';
    x.fillText('SENTRY MK II', 5, 13);
    x.font = '8px monospace';
    x.fillStyle = '#8fa06a';
    x.fillText('CO. CIVIL DEF.', 5, 22);

    // Past this the marks are no longer marks. The hand cutting them has
    // stopped counting and started writing.
    if (kills >= 150) {
      x.save();
      x.translate(48, 36);
      x.rotate(-0.06);
      x.strokeStyle = '#e6d3a0';
      x.lineWidth = 1.4;
      x.font = 'bold 13px monospace';
      x.strokeText(word, -x.measureText(word).width / 2, 5);
      x.restore();
      // and the gates it gave up on, still underneath
      x.globalAlpha = 0.35;
      x.strokeStyle = '#cfc08c';
      x.lineWidth = 1;
      for (let g = 0; g < 21; g++) {
        const gx = 5 + (g % 7) * 13, gy = 30 + ((g / 7) | 0) * 6;
        x.beginPath();
        for (let s = 0; s < 4; s++) { x.moveTo(gx + s * 2.5 + 0.5, gy); x.lineTo(gx + s * 2.5 + 0.5, gy + 4); }
        x.moveTo(gx - 0.5, gy + 4); x.lineTo(gx + 9, gy);
        x.stroke();
      }
      x.globalAlpha = 1;
      return;
    }

    // the tally, cut into the paint: four uprights and a stroke across five
    const gates = Math.floor(kills / 5);
    x.strokeStyle = '#d8c890';
    x.lineWidth = 1;
    const gate = (g, strokes) => {
      const col = g % 7, row = (g / 7) | 0;
      // Past the twenty-first gate the hand is cutting over its own work and
      // no longer keeping the lines straight.
      const over = Math.max(0, g - 20);
      const wob = over ? (hash(g * 5.3) - 0.5) * Math.min(3.5, over * 0.5) : 0;
      const gx = 5 + col * 13 + wob, gy = 30 + (row % 3) * 6 + wob * 0.6;
      x.save();
      if (over) { x.globalAlpha = 0.85; x.translate(gx, gy); x.rotate(wob * 0.05); x.translate(-gx, -gy); }
      x.beginPath();
      for (let s = 0; s < Math.min(4, strokes); s++) {
        x.moveTo(gx + s * 2.5 + 0.5, gy); x.lineTo(gx + s * 2.5 + 0.5, gy + 4);
      }
      if (strokes >= 5) { x.moveTo(gx - 0.5, gy + 4); x.lineTo(gx + 9, gy); }
      x.stroke();
      x.restore();
    };
    for (let g = 0; g < gates; g++) gate(g, 5);
    if (kills % 5) gate(gates, kills % 5);
  };
  draw(0);
  return { texture: pixelTex(c), draw };
}

/**
 * The subject plate, screwed to the sill under the vessel window.
 *
 * Brass, stamped, and completely matter-of-fact about it — which is the point.
 * Nobody who made this thought they were doing anything remarkable, and the
 * plate reads like a label on a fuse box.
 */
function subjectTexture(subject) {
  const W = 128, H = 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#7d6a34'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#8d7a3e'; x.fillRect(1, 1, W - 2, H - 2);
  for (let i = 0; i < 70; i++) {                     // tarnish
    x.fillStyle = hash(i * 2.3) > 0.5 ? '#6f5e2d' : '#9b8949';
    x.fillRect((hash(i * 1.1) * W) | 0, (hash(i * 4.7) * H) | 0, 1, 1);
  }
  x.fillStyle = '#2a2412';
  x.font = 'bold 8px monospace';
  x.fillText('COMPUTING SECTION MK II', 5, 10);
  x.font = 'bold 10px monospace';
  x.fillText(`SUBJ ${subject.no}`, 5, 22);
  x.font = '8px monospace';
  x.fillText(subject.name, 5, 32);
  x.fillText(subject.note, 84, 32);
  // the line nobody was ever meant to have to read
  x.fillStyle = '#5e2418';
  x.font = 'bold 7px monospace';
  x.fillText('SEALED — DO NOT OPEN', 62, 11);
  // two stamped screw heads
  x.fillStyle = '#5b4d22';
  for (const sx of [3, W - 5]) { x.fillRect(sx, H / 2 - 1, 3, 3); }
  return pixelTex(c);
}

/**
 * THE OSCILLOGRAPH PAPER, on the back of the drum.
 *
 * A real scrolling trace, drawn one column at a time onto a canvas that
 * shifts left under itself — so it is genuinely a record of the last few
 * seconds rather than a looping decal. The needle above it rides the same
 * value. Walk round behind a Mk II while it is fighting and the paper is
 * jagged; walk round behind one that has been asleep for a minute and it is a
 * slow, regular, entirely human rhythm.
 *
 * `word()` overwrites the visible paper with handwriting, which is what the
 * dream state uses. Nothing else in the machine can write words.
 */
function traceTexture() {
  const W = 128, H = 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const paper = () => { x.fillStyle = '#bdb69c'; x.fillRect(0, 0, W, H); };
  paper();
  const tex = pixelTex(c);
  let col = 0;
  // one column of chart paper, then the trace pixel on top of it
  const push = (v, ink = '#3a2f22') => {
    x.fillStyle = '#bdb69c';
    x.fillRect(col, 0, 2, H);
    x.fillStyle = '#a9a289';
    if (col % 16 < 2) x.fillRect(col, 0, 1, H);              // the ruled grid
    x.fillRect(col, H / 2, 2, 1);
    const y = Math.max(1, Math.min(H - 2, H / 2 - v * (H / 2 - 2)));
    x.fillStyle = ink;
    x.fillRect(col, y - 1, 2, 3);
    col = (col + 2) % W;
    x.fillStyle = '#8d1f14';                                  // the live needle mark
    x.fillRect(col, 0, 1, H);
    tex.needsUpdate = true;
  };
  const word = (s) => {
    paper();
    x.fillStyle = '#b9b29a';
    for (let i = 0; i < W; i += 16) x.fillRect(i, 0, 1, H);
    x.save();
    x.translate(W / 2, H / 2 + 6);
    x.rotate(-0.05);
    x.fillStyle = '#3a2f22';
    x.font = 'bold 16px monospace';
    x.fillText(s, -x.measureText(s).width / 2, 0);
    x.restore();
    tex.needsUpdate = true;
  };
  return { texture: tex, push, word };
}

/**
 * THE MK II'S OWN SKIN.
 *
 * It used to borrow the Mk I's armour plate — county olive drab — and that was
 * wrong twice over. Wrong once because the Mk I is a hand-carried pistol on a
 * tripod and this is not that machine; wrong twice because the whole front of
 * this thing now glows green, and hanging a green lamp on a green machine
 * means neither of them reads.
 *
 * So: cold gunmetal, sprayed over steel, and then LEFT OUT. Paint chipped back
 * to bare metal along every edge, rust bleeding down out of the rivet lines,
 * weld seams where the panels meet, and the grime of something that has been
 * stood in a field for a long time. The palette is deliberately all blues and
 * greys and browns, so the single green thing on the machine is the only green
 * thing on the machine.
 */
function wardenPlate() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#444d55'; x.fillRect(0, 0, S, S);
  // mottled spray, so it is not a flat swatch
  for (let i = 0; i < 340; i++) {
    const v = hash(i * 1.7);
    x.fillStyle = v > 0.72 ? '#4e5860' : v > 0.4 ? '#3d454c' : '#485159';
    x.fillRect((hash(i * 2.9) * S) | 0, (hash(i * 5.1) * S) | 0, 1 + ((v * 2) | 0), 1);
  }
  // weld seams across the panel
  for (const y of [15, 46]) {
    x.fillStyle = '#333a40'; x.fillRect(0, y, S, 1);
    x.fillStyle = '#59636b'; x.fillRect(0, y + 1, S, 1);
  }
  // rivets, each with a shadow under it — and rust bleeding from some of them
  for (let i = 0; i < 14; i++) {
    const rx = (hash(i * 7.3) * (S - 6) + 3) | 0;
    const ry = (hash(i * 4.1) * (S - 6) + 3) | 0;
    x.fillStyle = '#69737b'; x.fillRect(rx, ry, 2, 2);
    x.fillStyle = '#2e343a'; x.fillRect(rx, ry + 2, 2, 1);
    if (hash(i * 9.7) > 0.55) {
      const run = 4 + ((hash(i * 3.7) * 12) | 0);
      for (let k = 0; k < run; k++) {
        x.fillStyle = `rgba(112,62,34,${0.42 * (1 - k / run)})`;
        x.fillRect(rx, ry + 3 + k, 2 - (k > run * 0.6 ? 1 : 0), 1);
      }
    }
  }
  // paint chipped back to bare steel, mostly along the edges
  for (let i = 0; i < 26; i++) {
    const w = 1 + ((hash(i * 6.1) * 3) | 0), h = 1 + ((hash(i * 8.9) * 3) | 0);
    const edge = hash(i * 2.2);
    const cx = edge > 0.5 ? (hash(i * 3.4) > 0.5 ? (hash(i) * 5) | 0 : S - 5 + ((hash(i) * 5) | 0))
      : (hash(i * 1.3) * S) | 0;
    const cy = edge > 0.5 ? (hash(i * 5.5) * S) | 0
      : (hash(i * 4.4) > 0.5 ? (hash(i) * 5) | 0 : S - 5 + ((hash(i) * 5) | 0));
    x.fillStyle = '#78828b'; x.fillRect(cx, cy, w, h);
    x.fillStyle = '#333a40'; x.fillRect(cx, cy + h, w, 1);
  }
  // and the grime that collects in the low corners
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(30,26,22,${0.10 + hash(i * 3.3) * 0.2})`;
    x.fillRect((hash(i * 1.9) * S) | 0, (S - 12 + hash(i * 7.7) * 12) | 0, 2, 1);
  }
  const t = pixelTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
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
  return pixelTex(c);
}

/**
 * THE BRAIN'S OWN SURFACE.
 *
 * Geometry gets the lumps; this gets the folds. A handful of scaled spheres
 * will read as a brain from three metres and as a bag of potatoes from one,
 * and the difference is entirely the sulci — so they are painted, in the same
 * seeded-noise way every other surface in this game is, rather than modelled.
 * Wrapped round a sphere the vertical banding becomes the fissures running
 * fore-and-aft over the top, which is exactly where they belong.
 */
function brainTexture() {
  const W = 64, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#c99a92');
  grad.addColorStop(0.55, '#bd8880');
  grad.addColorStop(1, '#9d6b66');
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  // the folds: meandering vertical furrows, each with a lit crest above it
  x.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const x0 = hash(i * 7.1) * W;
    x.strokeStyle = 'rgba(112,60,58,0.85)';
    x.beginPath();
    let px = x0;
    for (let y = 0; y <= H; y += 4) {
      px += (hash(i * 3.3 + y * 0.7) - 0.5) * 5;
      if (y === 0) x.moveTo(px, y); else x.lineTo(px, y);
    }
    x.stroke();
    x.strokeStyle = 'rgba(224,176,168,0.5)';
    x.beginPath();
    px = x0 + 1.6;
    for (let y = 0; y <= H; y += 4) {
      px += (hash(i * 3.3 + y * 0.7) - 0.5) * 5;
      if (y === 0) x.moveTo(px, y); else x.lineTo(px, y);
    }
    x.stroke();
  }
  // fine vessels over the top of it
  for (let i = 0; i < 40; i++) {
    x.fillStyle = hash(i * 5.9) > 0.6 ? 'rgba(150,52,52,0.5)' : 'rgba(206,150,146,0.4)';
    x.fillRect((hash(i * 2.7) * W) | 0, (hash(i * 8.3) * H) | 0, 1 + ((hash(i) * 3) | 0), 1);
  }
  const t = pixelTex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* ====================================================================== *
 * THE BUILD                                                              *
 * ====================================================================== */

export function buildSentryTwoModel(texLib = null, subject = SUBJECTS[0]) {
  /**
   * THE PALETTE, and the one rule it is built around.
   *
   * Everything on this machine is a cold blue-grey, a warm brown or a dull
   * brass. Nothing else. Not one part of the hardware is green — which is the
   * whole point, because the perfusate is, and a green lamp on a green machine
   * is a lamp nobody sees. The single saturated colour on the Warden is the
   * thing in the jar, and the paint is chosen to get out of its way.
   */
  const wardenTex = wardenPlate();
  const plateMat = new THREE.MeshLambertMaterial({ map: wardenTex });
  const steel = new THREE.MeshLambertMaterial({ color: 0x49515a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x232830 });
  const oil = new THREE.MeshLambertMaterial({ color: 0x15181c });
  const chrome = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
  const brass = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('vendorBrass') })
    : new THREE.MeshLambertMaterial({ color: 0xa8842c });
  const copper = new THREE.MeshLambertMaterial({ color: 0x8a5a2c });
  const hull = new THREE.MeshLambertMaterial({ color: 0x3f474f });
  const hazard = new THREE.MeshLambertMaterial({ color: 0xc9a63a });
  // Two kinds of hose. Black rubber for the cable looms and the dry runs, and
  // a dark oxblood for the ones with somebody's perfusate going through them —
  // which is a distinction you are never told about and can read at a glance
  // once you have noticed the second colour exists.
  const rubber = new THREE.MeshLambertMaterial({ color: 0x24201e });
  const flesh = new THREE.MeshLambertMaterial({ color: 0x4c2b25 });

  // Animated materials. Kept as materials rather than meshes because the
  // entity drives emissive on all of them and a merged mesh still draws with
  // the same material object.
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffcc66, emissive: 0x704a10 });
  const lensMat = new THREE.MeshLambertMaterial({ color: 0x24403a, emissive: 0x0e4a34 });
  const jacketMat = new THREE.MeshLambertMaterial({ color: 0x2e3a3a, emissive: 0x000000 });
  const steamMat = new THREE.MeshBasicMaterial({
    color: 0xdfeee8, transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  /**
   * THE VESSEL'S THREE LAYERS, and the order they have to draw in.
   *
   * Brain opaque, perfusate over it, armoured glass over that. All three are
   * concentric and two of them are transparent, which is the classic way to
   * get a jar that renders as a flat green disc: with depth writing on, the
   * glass writes the near wall and the brain behind it is discarded. So the
   * fluid and the glass write no depth and are given explicit render orders,
   * and the thing in the jar is visible through both of them.
   */
  const fluidMat = new THREE.MeshLambertMaterial({
    color: 0x8fd8ac, emissive: 0x2a6b48, transparent: true, opacity: 0.26,
    depthWrite: false,
  });
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0xbcd8dc, emissive: 0x16282c, transparent: true, opacity: 0.15,
    depthWrite: false,
  });
  const bubbleMat = new THREE.MeshBasicMaterial({
    color: 0xdff4e6, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  });
  const brainTex = brainTexture();
  const brainMat = new THREE.MeshLambertMaterial({ map: brainTex, emissive: 0x2a1512 });
  const stemMat = new THREE.MeshLambertMaterial({ color: 0xb99a90 });

  const g = new THREE.Group();
  const parts = {
    legs: [], chain: [], loom: [], barrels: [], shells: [], lamps: [], steam: [],
    rack: [], latches: [], clamps: [], wings: [], louvres: [], posts: [],
    bubbles: [], electrodes: [], arm: {}, rf: {},
    lampMat, lensMat, jacketMat, steamMat, fluidMat, glassMat, brainMat,
    subject,
    /**
     * THE TEXTURES THIS RIG OWNS, and only those.
     *
     * Four canvases are drawn fresh for every Warden — the brain's surface,
     * the subject plate, the oscillograph paper and the tally plate — and up
     * to four rigs exist at once (two deployed, the placement ghost, the copy
     * in your hands), redrawn every time one is packed up and set down again.
     * They have to be given back.
     *
     * What must NOT be given back is anything out of the shared texture
     * library: `texLib.get()` hands out the ONE instance the whole game draws
     * with, so disposing a sentry's armour plate takes the vendor's brass and
     * everything else painted with it down with it. Hence an explicit list
     * rather than walking the rig and disposing every material's map.
     */
    ownedTextures: [],
  };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const tor = (r, t, m, rs = 5, ts = 12) => new THREE.Mesh(new THREE.TorusGeometry(r, t, rs, ts), m);
  const sph = (r, m, w = 8, h = 6) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
  const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  /** An eight-sided prism with a FLAT face pointing at +Z, not a corner. */
  const oct = (r, h, m) => new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 8, 1, false, -Math.PI / 8, TAU), m);

  /* ================================================================== *
   * THE BASE — a square case, four legs, four screw jacks, one spade    *
   * ================================================================== */

  // How high the case rides. It is not a free number: the legs below it have a
  // length and a splay, and this is what puts the PADS ON THE GROUND rather
  // than through it. Change a leg dimension and this changes with it.
  g.add(at(box(0.28, 0.090, 0.28, plateMat), 0, HUB_Y - 0.02, 0));
  g.add(at(box(0.29, 0.014, 0.29, steel), 0, HUB_Y + 0.028, 0));        // the deck of it
  g.add(at(box(0.29, 0.016, 0.030, hazard), 0, HUB_Y + 0.030, 0.128));   // one stripe, at the front

  /**
   * FOUR TRANSIT LATCHES, one to each corner, and they are the first thing
   * that moves. A machine that simply unfolds has been switched on; a machine
   * that pops four latches and THEN unfolds has been unpacked, and the
   * difference is a quarter of a second at the very start of the sequence.
   */
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const latch = new THREE.Group();
    latch.position.set(sx * 0.105, HUB_Y + 0.036, sz * 0.105);
    g.add(latch);
    latch.add(at(box(0.030, 0.010, 0.044, chrome), 0, 0.005, 0));       // the over-centre lever
    latch.add(at(box(0.012, 0.026, 0.012, hazard), 0, 0.018, 0.020));   // its handle
    latch.add(at(tor(0.014, 0.004, chrome, 5, 8), 0, -0.004, 0).rotateX(Math.PI / 2));
    parts.latches.push({ node: latch, sx, sz });
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
      jack.add(at(tor(0.015, 0.0035, chrome, 4, 9), 0, -0.012 - k * 0.013, 0).rotateX(Math.PI / 2));
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
   * THE SPADE — a blade behind the case that drives into the ground and takes
   * the recoil the legs would otherwise walk on. It is the loudest single beat
   * of the deploy, and the reason this machine does not creep backwards while
   * it is firing.
   *
   * IT DROPS, IT DOES NOT SWING, and that is not a stylistic choice. It was a
   * blade on a short hinged arm before, which looks like a spade right up until
   * you do the arithmetic: the pivot sits 0.355 above the ground and the arm
   * reaches 0.114, so the blade's lowest possible point in its entire travel is
   * a third of a metre in the air. It could not have touched the ground at any
   * angle. A DROP SPADE on a vertical guide — which is what real gun mounts
   * use, for exactly this reason — starts stowed inside its housing and is
   * driven straight down until the teeth are under the turf, and the travel is
   * a distance rather than an angle so it is obvious at a glance whether it
   * reaches.
   */
  g.add(at(box(0.170, 0.030, 0.056, steel), 0, HUB_Y - 0.020, -0.155));       // the head of the guide
  for (const sx of [-1, 1]) {                                                  // its two rails
    g.add(at(box(0.014, 0.150, 0.050, steel), sx * 0.062, HUB_Y - 0.100, -0.155));
  }
  g.add(at(box(0.170, 0.014, 0.020, hazard), 0, HUB_Y - 0.006, -0.170));
  const spade = new THREE.Group();
  spade.position.set(0, HUB_Y + 0.080, -0.155);
  g.add(spade);
  parts.spade = spade;
  // Both are ABSOLUTE heights for the slide, not offsets from where it was
  // authored: the entity writes spade.position.y straight from these, and an
  // offset would silently be measured from the origin instead.
  parts.spadeUp = HUB_Y + 0.080;    // stowed, drawn right up into the housing
  parts.spadeDown = HUB_Y - 0.205;  // driven, teeth well under the turf
  spade.add(at(box(0.048, 0.160, 0.030, chrome), 0, -0.080, 0));               // the shank
  spade.add(at(box(0.056, 0.020, 0.038, steel), 0, -0.020, 0));                // its head
  spade.add(at(box(0.150, 0.080, 0.014, plateMat), 0, -0.180, 0));             // the blade
  spade.add(at(box(0.150, 0.014, 0.032, hazard), 0, -0.146, 0));               // its shoulder
  for (const sx of [-1, 0, 1]) {                                               // its teeth
    spade.add(at(box(0.024, 0.030, 0.012, chrome), sx * 0.050, -0.226, 0));
  }

  /* ================================================================== *
   * THE COMPUTING SECTION — an open frame with a person hung in it      *
   * ================================================================== */

  /**
   * THERE IS NO CASING. That is the design.
   *
   * The first version of this was a cast drum with two armoured doors in the
   * front of it, and the doors were the problem: a box that opens is still a
   * box, the vessel was only ever visible through one aperture from one angle,
   * and the plumbing that keeps the occupant alive was all sealed up inside
   * where it could not be seen doing it. A machine that HIDES the thing in its
   * belly is a machine with a secret. This one has no secret. It has an
   * exposed nervous system.
   *
   * So the casing came off entirely and what is left is the structure: four
   * corner posts, a floor pan, a top ring, X-braces on three faces and nothing
   * at all across the front. Slung in the middle of that, in a brass gimbal, in
   * the open air, is the vessel — and threaded through the whole frame, in
   * front of it and behind it and round it, is the circuit that keeps the
   * occupant going. A peristaltic pump with a rotor you can watch turning. A
   * bellows that compresses on every heartbeat. Sight glasses with the fluid
   * level bobbing in them. Six hoses, ribbed, sagging under their own weight,
   * two of them oxblood because of what is inside them.
   *
   * It is meant to be unpleasant to look at closely and completely
   * matter-of-fact about being unpleasant, which is the only register this
   * whole machine is written in.
   */

  const FR_Y0 = PED_Y0;
  const FR_Y1 = PED_Y1;
  const FR_H = FR_Y1 - FR_Y0;
  const FR_MID = (FR_Y0 + FR_Y1) / 2;
  const FR_X = 0.116;                    // half the frame's width, corner to corner
  const frame = new THREE.Group();
  g.add(frame);
  parts.ped = frame;
  parts.frame = frame;

  // --- the floor pan: a shallow tray, because things drip
  frame.add(at(box(FR_X * 2 + 0.03, 0.014, FR_X * 2 + 0.03, plateMat), 0, FR_Y0 + 0.007, 0));
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    frame.add(at(box(ax ? 0.010 : FR_X * 2 + 0.03, 0.022, az ? 0.010 : FR_X * 2 + 0.03, steel),
      ax * (FR_X + 0.012), FR_Y0 + 0.018, az * (FR_X + 0.012)));
  }
  // ...and what has dripped into it, which nobody has cleaned out
  const puddle = at(new THREE.Mesh(new THREE.CircleGeometry(0.070, 12), fluidMat), 0.030, FR_Y0 + 0.016, -0.020);
  puddle.rotation.x = -Math.PI / 2;
  puddle.renderOrder = 1;
  frame.add(puddle);

  // --- four corner posts, and the top ring the gun stands on
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    frame.add(at(box(0.022, FR_H, 0.022, steel), sx * FR_X, FR_MID, sz * FR_X));
    frame.add(at(box(0.030, 0.012, 0.030, hazard), sx * FR_X, FR_Y1 - 0.030, sz * FR_X));
    frame.add(at(box(0.030, 0.012, 0.030, hazard), sx * FR_X, FR_Y0 + 0.034, sz * FR_X));
  }
  /**
   * The top is a RING OF RAILS with two cross beams under the kingpin, not a
   * lid. A lid is the one thing that undoes the whole design: the front of the
   * frame is open, but the machine is a metre and a half tall and the player
   * is looking DOWN at it from about forty degrees, so a solid plate across
   * the top closes the interior off from the angle it is actually viewed at.
   * Rails carry the same load and you can see straight down into the frame.
   */
  for (const [ax, az, rot] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
    frame.add(at(box(FR_X * 2 + 0.044, 0.020, 0.026, plateMat),
      ax * (FR_X + 0.010), FR_Y1 - 0.010, az * (FR_X + 0.010)).rotateY(rot));
  }
  frame.add(at(box(0.052, 0.016, FR_X * 2, steel), 0, FR_Y1 - 0.014, -0.040));
  frame.add(at(box(FR_X * 2, 0.016, 0.052, steel), 0, FR_Y1 - 0.014, -0.040));
  for (const sx of [-1, 1]) {                        // and a pad under each post
    frame.add(at(box(0.046, 0.014, 0.046, steel), sx * 0.100, FR_Y1 - 0.014, -0.075));
  }
  // a mid-rail on three sides, and X-braces above it — the front stays open
  for (const [sx, sz, rot] of [[0, -1, 0], [-1, 0, Math.PI / 2], [1, 0, Math.PI / 2]]) {
    const rail = (y) => frame.add(at(box(FR_X * 2, 0.014, 0.014, steel),
      sx * FR_X, y, sz * FR_X).rotateY(rot));
    rail(FR_MID);
    for (const d of [-1, 1]) {                                  // the X itself
      const br = at(box(FR_X * 2.1, 0.010, 0.010, steel), sx * FR_X, FR_MID + 0.055, sz * FR_X);
      br.rotation.y = rot;
      br.rotation.z = d * 0.52;
      frame.add(br);
    }
  }

  /* ---- THE VESSEL, slung in a gimbal, out in the open ---- */

  /**
   * THE PRESENTATION, which is the animation that replaced the doors.
   *
   * Folded, the vessel is DOWN between the frame's legs and laid over on its
   * back, tucked where it can survive being carried in a bag. On deploy the ram
   * under it extends, the whole vessel RISES OUT OF THE MACHINE and rights
   * itself, two latch arms close over its gimbal ring — and every hose attached
   * to it is dragged up with it and pulled taut on the way.
   *
   * A door opening tells you there is something behind the door. This tells you
   * the machine is holding something up.
   *
   * AND WHY IT IS A RAM AND NOT A YOKE. A pair of hinged yoke arms was the
   * obvious way to swing a jar upright, and it does not work: an arm long
   * enough to look right is about 0.05 units and the vessel has to travel 0.13
   * from stowed to presented. No rotation of a short arm reaches that far, so
   * the trunnions would tear straight out of the ring halfway up — invisible in
   * the code, unmissable on screen. A straight-line lift has its travel written
   * down as a DISTANCE, and a distance cannot come apart.
   */
  const lift = new THREE.Group();
  frame.add(lift);
  parts.vesselLift = lift;
  parts.vesselUp = JAR_Y;
  parts.vesselDown = JAR_Y - 0.128;
  parts.vesselTilt = -1.22;              // laid on its back for carry
  lift.position.set(0, JAR_Y, JAR_Z);

  const ramTube = at(cyl(0.022, 0.024, 0.076, oil, 8), 0, FR_Y0 + 0.054, JAR_Z);
  frame.add(ramTube);
  const ramRod = at(cyl(0.012, 0.012, 0.100, chrome, 6), 0, FR_Y0 + 0.130, JAR_Z);
  frame.add(ramRod);
  parts.vesselRam = ramRod;
  parts.ramFoot = FR_Y0 + 0.086;                 // where the rod leaves the tube
  for (const sx of [-1, 1]) {                    // the two rails it runs between
    frame.add(at(box(0.012, FR_H - 0.06, 0.012, chrome), sx * 0.100, FR_MID, JAR_Z));
    frame.add(at(box(0.020, 0.014, 0.026, steel), sx * 0.100, FR_Y1 - 0.044, JAR_Z));
    frame.add(at(box(0.020, 0.014, 0.026, steel), sx * 0.100, FR_Y0 + 0.044, JAR_Z));
  }

  const tilt = new THREE.Group();
  lift.add(tilt);
  parts.vesselTiltNode = tilt;
  // the two latch arms, carried on the lift, that close over the gimbal ring
  for (const sx of [-1, 1]) {
    const latch = new THREE.Group();
    latch.position.set(sx * 0.100, 0, 0);
    lift.add(latch);
    latch.add(at(box(0.032, 0.014, 0.018, steel), -sx * 0.016, 0, 0));
    latch.add(at(cyl(0.010, 0.010, 0.020, chrome, 6), 0, 0, 0).rotateX(Math.PI / 2));
    latch.add(at(box(0.014, 0.030, 0.018, hazard), -sx * 0.030, 0.004, 0));
    parts[sx < 0 ? 'latchL' : 'latchR'] = latch;
  }
  const vessel = new THREE.Group();
  tilt.add(vessel);
  parts.vessel = vessel;

  // the fluid, then the glass over it, then the cage over that
  const fluid = cyl(JAR_R - 0.008, JAR_R - 0.008, JAR_H - 0.020, fluidMat, 14);
  fluid.renderOrder = 1;
  vessel.add(fluid);
  parts.fluid = fluid;
  const glass = cyl(JAR_R, JAR_R, JAR_H, glassMat, 14);
  glass.renderOrder = 3;
  vessel.add(glass);
  // meniscus: the fluid does not fill it, and the line where it stops is the
  // single cheapest thing that makes a jar read as a jar
  const meniscus = at(new THREE.Mesh(
    new THREE.RingGeometry(JAR_R - 0.020, JAR_R - 0.007, 14),
    new THREE.MeshBasicMaterial({ color: 0xbfe6cd, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  ), 0, JAR_H / 2 - 0.026, 0);
  meniscus.rotation.x = -Math.PI / 2;
  meniscus.renderOrder = 2;
  vessel.add(meniscus);

  vessel.add(at(cyl(JAR_R + 0.008, JAR_R + 0.008, 0.018, brass, 14), 0, JAR_H / 2 - 0.004, 0));
  vessel.add(at(cyl(JAR_R + 0.010, JAR_R + 0.012, 0.022, brass, 14), 0, -JAR_H / 2 + 0.006, 0));
  // the gimbal ring the latch arms close onto, round the jar's waist
  vessel.add(at(tor(JAR_R + 0.012, 0.008, brass, 5, 16), 0, 0, 0).rotateX(Math.PI / 2));
  for (const sx of [-1, 1]) {
    vessel.add(at(cyl(0.013, 0.013, 0.026, brass, 8), sx * (JAR_R + 0.016), 0, 0).rotateZ(Math.PI / 2));
  }
  // FOUR cage bars, clocked to the diagonals. Six evenly spaced put two of
  // them straight across the front of the glass, which is a cage in front of
  // the one thing the whole machine exists to show you.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    vessel.add(at(box(0.008, JAR_H - 0.02, 0.008, brass),
      Math.sin(a) * (JAR_R + 0.003), 0, Math.cos(a) * (JAR_R + 0.003)).rotateY(a));
  }
  // somebody taped a crack once and it held. Nobody came back for it.
  const tape = at(box(0.020, 0.040, 0.003, new THREE.MeshLambertMaterial({ color: 0x8d8674 })),
    -0.050, -0.040, JAR_R * 0.72);
  tape.rotation.set(0, -0.7, 0.5);
  vessel.add(tape);

  /**
   * THE THING IN THE JAR.
   *
   * Two hemispheres, four lobes, a cerebellum and a stem — the smallest number
   * of scaled spheres that still has the right silhouette from every angle,
   * with the folds painted on rather than modelled. It is parented through
   * `brainTurn` so that the whole organ can rotate INSIDE its cradle without
   * moving the electrodes that are supposed to be attached to it, which is
   * precisely the thing the machine is not supposed to be able to do.
   */
  const brainTurn = new THREE.Group();
  brainTurn.position.set(0, BRAIN_Y - JAR_Y, 0);
  vessel.add(brainTurn);
  parts.brainTurn = brainTurn;
  const brain = new THREE.Group();
  brainTurn.add(brain);
  parts.brain = brain;

  const lobe = (x, y, z, sx, sy, sz, m = brainMat) => {
    const sp = sph(0.5, m, 10, 8);
    sp.position.set(x, y, z);
    sp.scale.set(sx, sy, sz);
    brain.add(sp);
    return sp;
  };
  for (const sx of [-1, 1]) {
    lobe(sx * BRAIN_W * 0.235, 0, -0.004, BRAIN_W * 0.55, BRAIN_H * 0.98, BRAIN_L * 0.86);
    lobe(sx * BRAIN_W * 0.200, -0.004, BRAIN_L * 0.335, BRAIN_W * 0.42, BRAIN_H * 0.80, BRAIN_L * 0.42);  // frontal
    lobe(sx * BRAIN_W * 0.215, 0.004, -BRAIN_L * 0.300, BRAIN_W * 0.44, BRAIN_H * 0.76, BRAIN_L * 0.44);  // occipital
    lobe(sx * BRAIN_W * 0.415, -BRAIN_H * 0.20, 0.002, BRAIN_W * 0.30, BRAIN_H * 0.56, BRAIN_L * 0.52);   // temporal
    // the cerebellum, tucked under the back — darker, and finer grained
    lobe(sx * BRAIN_W * 0.155, -BRAIN_H * 0.44, -BRAIN_L * 0.335,
      BRAIN_W * 0.34, BRAIN_H * 0.42, BRAIN_L * 0.30, stemMat);
  }
  // the stem, running down out of the cradle
  brain.add(at(cyl(0.011, 0.014, 0.030, stemMat, 8), 0, -BRAIN_H * 0.58, -BRAIN_L * 0.10));

  /**
   * THE ELECTRODE CROWN. Six platinum pins on a ring that comes DOWN onto the
   * cortex during the deploy and seats there — the thirteenth beat of the
   * sequence, and the one that turns a specimen into a computer.
   */
  const crown = new THREE.Group();
  crown.position.set(0, JAR_H / 2 - 0.040, 0);
  vessel.add(crown);
  parts.crown = crown;
  crown.add(at(tor(0.040, 0.005, chrome, 4, 12), 0, 0, 0).rotateX(Math.PI / 2));
  crown.add(at(cyl(0.009, 0.009, 0.026, brass, 6), 0, 0.014, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const pin = at(cyl(0.0022, 0.0022, 0.036, chrome, 4),
      Math.sin(a) * 0.030, -0.020, Math.cos(a) * 0.030);
    crown.add(pin);
    crown.add(at(sph(0.004, brass, 5, 4), Math.sin(a) * 0.030, -0.002, Math.cos(a) * 0.030));
    parts.electrodes.push(pin);
  }
  // the cradle it sits in, and the perfusion inlet and outlet under it
  vessel.add(at(tor(0.042, 0.006, chrome, 4, 12), 0, -JAR_H / 2 + 0.030, 0).rotateX(Math.PI / 2));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    vessel.add(at(box(0.006, 0.030, 0.006, chrome),
      Math.sin(a) * 0.040, -JAR_H / 2 + 0.016, Math.cos(a) * 0.040));
  }
  for (const sx of [-1, 1]) {
    vessel.add(at(cyl(0.011, 0.011, 0.024, copper, 6), sx * 0.034, -JAR_H / 2 - 0.006, 0));
  }

  // bubbles: they climb, they wobble, and there are more of them on a beat.
  // A material EACH, because the entity fades every one of them separately as
  // it rises — share one and all eight take whichever opacity the loop set
  // last, which is eight bubbles blinking in perfect unison.
  for (let i = 0; i < 8; i++) {
    const b = sph(0.005 + (i % 3) * 0.0018, bubbleMat.clone(), 5, 4);
    b.renderOrder = 2;
    vessel.add(b);
    parts.bubbles.push({ mesh: b, i, seed: hash(i * 9.7) });
  }
  // the vessel lamp, under the jar, shining up through the perfusate
  const vLamp = at(new THREE.Mesh(new THREE.CircleGeometry(0.030, 12), fluidMat), 0, -JAR_H / 2 + 0.012, 0);
  vLamp.rotation.x = -Math.PI / 2;
  vessel.add(vLamp);

  /* ---- THE PLANT: everything that keeps the occupant going ---- */

  /**
   * THE PERISTALTIC PUMP.
   *
   * A rotor with three rollers squeezing a loop of tube round a race, which is
   * how you move a fluid without the pump ever touching it. It turns on the
   * heartbeat, and it is mounted on the front-left post at about knee height
   * where you cannot miss it: the most medical-looking object on a gun.
   */
  const pumpPlate = at(box(0.100, 0.100, 0.014, plateMat), -0.088, FR_Y0 + 0.088, FR_X - 0.004);
  frame.add(pumpPlate);
  const pump = new THREE.Group();
  pump.position.set(-0.088, FR_Y0 + 0.088, FR_X + 0.014);
  frame.add(pump);
  parts.pump = pump;
  pump.add(at(cyl(0.040, 0.040, 0.016, oil, 14), 0, 0, 0).rotateX(Math.PI / 2));
  pump.add(at(tor(0.036, 0.007, flesh, 4, 16), 0, 0, 0.004));          // the tube in its race
  const rotor = new THREE.Group();
  rotor.position.set(0, 0, 0.012);
  pump.add(rotor);
  parts.rotor = rotor;
  rotor.add(at(cyl(0.014, 0.014, 0.016, chrome, 8), 0, 0, 0).rotateX(Math.PI / 2));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    rotor.add(at(cyl(0.008, 0.008, 0.020, chrome, 6),
      Math.sin(a) * 0.026, Math.cos(a) * 0.026, 0).rotateX(Math.PI / 2));
    rotor.add(at(box(0.006, 0.052, 0.008, chrome), Math.sin(a) * 0.013, Math.cos(a) * 0.013, 0)
      .rotateZ(-a));
  }

  /**
   * THE BELLOWS. A concertina on the right-hand post that compresses on every
   * systole and lets go between them, which from ten feet away is a machine
   * with a small pair of lungs on the outside of it.
   */
  const bellows = new THREE.Group();
  bellows.position.set(0.096, FR_Y0 + 0.098, 0.030);
  frame.add(bellows);
  parts.bellows = bellows;
  bellows.add(at(box(0.052, 0.010, 0.052, steel), 0, -0.050, 0));
  bellows.add(at(box(0.052, 0.010, 0.052, steel), 0, 0.050, 0));
  for (let i = 0; i < 5; i++) {
    bellows.add(at(cyl(0.030, 0.030, 0.009, i % 2 ? flesh : rubber, 10), 0, -0.036 + i * 0.018, 0));
  }
  bellows.add(at(cyl(0.006, 0.006, 0.110, chrome, 6), 0.030, 0, 0));    // its guide rod

  /**
   * TWO SIGHT GLASSES, on the back-left post. The column in each bobs with the
   * pressure, which is the only readout on this machine anybody could actually
   * use, and it is calibrated in nothing at all.
   */
  parts.sight = [];
  for (let i = 0; i < 2; i++) {
    const gx = -0.070 - i * 0.028, gz = -FR_X - 0.006;
    frame.add(at(cyl(0.010, 0.010, 0.078, glassMat, 8), gx, FR_MID + 0.020, gz));
    const col = at(cyl(0.007, 0.007, 0.060, fluidMat, 8), gx, FR_MID + 0.010, gz);
    col.geometry.translate(0, 0.030, 0);
    col.renderOrder = 1;
    frame.add(col);
    for (const y of [-0.040, 0.040]) {
      frame.add(at(cyl(0.012, 0.012, 0.008, brass, 8), gx, FR_MID + 0.020 + y, gz));
    }
    parts.sight.push(col);
  }

  // the perfusion bottle, in its cage on the left post, where the arm can
  // reach it. It empties, visibly, over a long run.
  const bottleFill = at(cyl(0.024, 0.024, 0.090, fluidMat, 10), -FR_X - 0.026, FR_MID + 0.006, -0.046);
  bottleFill.geometry.translate(0, 0.045, 0);
  bottleFill.renderOrder = 1;
  frame.add(bottleFill);
  parts.bottleFill = bottleFill;
  frame.add(at(cyl(0.028, 0.028, 0.104, glassMat, 10), -FR_X - 0.026, FR_MID + 0.052, -0.046));
  frame.add(at(cyl(0.030, 0.030, 0.012, brass, 10), -FR_X - 0.026, FR_MID + 0.108, -0.046));
  for (const y of [0.014, 0.090]) {
    frame.add(at(tor(0.032, 0.004, chrome, 4, 10), -FR_X - 0.026, FR_MID + y, -0.046).rotateX(Math.PI / 2));
  }
  // the pressure gauge, beside the pump
  frame.add(at(cyl(0.024, 0.024, 0.012, brass, 12), -0.088, FR_Y0 + 0.156, FR_X + 0.006).rotateX(Math.PI / 2));
  const gauge = at(box(0.004, 0.020, 0.002, new THREE.MeshBasicMaterial({ color: 0xc8302a })),
    -0.088, FR_Y0 + 0.156, FR_X + 0.014);
  gauge.geometry.translate(0, 0.010, 0);
  frame.add(gauge);
  parts.gauge = gauge;
  // the condenser, on the back, and the heat louvres beside it
  for (let i = 0; i < 5; i++) {
    frame.add(at(tor(0.020, 0.005, copper, 4, 10), 0.052, FR_MID - 0.048 + i * 0.020, -FR_X - 0.008)
      .rotateX(Math.PI / 2));
  }
  const louvrePanel = new THREE.Group();
  louvrePanel.position.set(FR_X + 0.004, FR_MID + 0.052, 0.034);
  louvrePanel.rotation.y = Math.PI / 2;
  frame.add(louvrePanel);
  louvrePanel.add(at(box(0.100, 0.014, 0.012, hazard), 0, 0.020, 0.006));
  for (let i = 0; i < 4; i++) {
    // Authored INSIDE a panel that already faces +X, so the entity can tip
    // each slat about its own local X and stand it proud along its own local
    // Z without knowing which face of the frame it happens to be bolted to.
    const l = at(box(0.090, 0.013, 0.010, steel), 0, -0.010 - i * 0.022, 0.008);
    louvrePanel.add(l);
    parts.louvres.push(l);
  }
  // the spanner: clipped on a post, left behind, and exactly the size of the
  // collar nuts on the vessel. Somebody was going to open it.
  const spanner = new THREE.Group();
  spanner.position.set(FR_X + 0.014, FR_Y0 + 0.080, -0.050);
  spanner.rotation.set(0, Math.PI / 2, 0.22);
  frame.add(spanner);
  spanner.add(at(box(0.012, 0.086, 0.007, chrome), 0, 0, 0));
  spanner.add(at(box(0.026, 0.020, 0.007, chrome), 0, 0.048, 0));
  spanner.add(at(box(0.010, 0.012, 0.009, oil), 0, 0.052, 0));

  /**
   * THE HOSES, and why they are laid out per frame rather than modelled.
   *
   * Six of them, each a chain of ribbed segments strung between a fixed anchor
   * on the frame and a point on the VESSEL — which moves, a long way, every
   * time the machine stands up or packs down. Modelled as static geometry they
   * would either float in the air when the vessel is up or run through it when
   * it is down. So each one is re-laid every frame along a sagging curve
   * between its two ends (see layPlumbing), which means they are dragged up with
   * the vessel during the presentation, swing as it rights itself, and hang
   * slack when it is stowed.
   *
   * Two of them are oxblood and swell on the heartbeat, because those are the
   * two with somebody's perfusate going through them.
   */
  const HOSE_SEGS = 7;
  const hoses = [];
  parts.hoses = hoses;
  const makeHose = (from, to, { sag = 0.05, mat = rubber, pulses = false, r = 0.010, fixed = false } = {}) => {
    const segs = [];
    for (let i = 0; i < HOSE_SEGS; i++) {
      // alternating radii, which is a corrugated hose for the price of nothing
      const seg = cyl(r * (i % 2 ? 1 : 1.22), r * (i % 2 ? 1.22 : 1), 0.10, mat, 6);
      frame.add(seg);
      segs.push(seg);
    }
    hoses.push({ segs, from, to, sag, pulses, r, fixed });
  };
  const JB = -JAR_H / 2, JT = JAR_H / 2;
  //          fixed end (frame space)                        moving end (vessel space)
  makeHose({ x: -0.088, y: FR_Y0 + 0.118, z: FR_X + 0.014 }, { x: -0.034, y: JB - 0.014, z: 0 },
    { sag: 0.055, mat: flesh, pulses: true, r: 0.011 });                       // pump → vessel in
  makeHose({ x: 0.096, y: FR_Y0 + 0.152, z: 0.030 }, { x: 0.034, y: JB - 0.014, z: 0 },
    { sag: 0.050, mat: flesh, pulses: true, r: 0.011 });                       // vessel out → bellows
  makeHose({ x: -FR_X - 0.026, y: FR_MID + 0.014, z: -0.046 }, { x: -0.040, y: JB + 0.010, z: -0.030 },
    { sag: 0.062, mat: rubber, r: 0.009 });                                    // bottle → vessel
  makeHose({ x: 0.052, y: FR_MID - 0.050, z: -FR_X - 0.010 }, { x: 0.030, y: JB + 0.012, z: -0.034 },
    { sag: 0.058, mat: rubber, r: 0.009 });                                    // condenser → vessel
  makeHose({ x: 0.0, y: FR_Y1 - 0.026, z: -0.052 }, { x: 0, y: JT + 0.020, z: -0.010 },
    { sag: 0.030, mat: oil, r: 0.012 });                                       // crown → the gun
  makeHose({ x: -0.070, y: FR_MID + 0.062, z: -FR_X - 0.006 }, { x: -0.028, y: JT + 0.006, z: -0.026 },
    { sag: 0.034, mat: rubber, r: 0.008 });                                    // sight glass → head
  // ...and three that go nowhere near the vessel, draped across the frame
  // between fittings. Not one of them is doing anything you could name, which
  // is exactly why they are there: machinery is untidy, and a frame with only
  // the hoses it strictly needs reads as a diagram.
  makeHose({ x: -FR_X - 0.010, y: FR_Y0 + 0.048, z: 0.060 }, { x: -0.088, y: FR_Y0 + 0.062, z: FR_X + 0.010 },
    { sag: 0.040, mat: flesh, r: 0.009, fixed: true });
  makeHose({ x: FR_X + 0.008, y: FR_MID + 0.058, z: 0.034 }, { x: 0.096, y: FR_Y0 + 0.154, z: 0.030 },
    { sag: 0.026, mat: rubber, r: 0.008, fixed: true });
  makeHose({ x: -FR_X + 0.006, y: FR_Y1 - 0.034, z: -FR_X - 0.004 }, { x: FR_X - 0.010, y: FR_MID - 0.010, z: -FR_X - 0.008 },
    { sag: 0.048, mat: oil, r: 0.010, fixed: true });

  /**
   * Lay every hose along the curve between its two ends, given where the
   * vessel currently is. Called once a frame by the entity, after it has set
   * the lift and the tilt — the hoses are downstream of the vessel, and there
   * is no order in which they can be computed first.
   */
  const HOSE_UP = new THREE.Vector3(0, 1, 0);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _t = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  parts.layPlumbing = (beat = 0) => {
    lift.updateMatrix();
    tilt.updateMatrix();
    // the ram rod stretches from its tube up to whatever height the lift is at
    const reach = Math.max(0.02, lift.position.y - parts.ramFoot);
    ramRod.scale.y = reach / 0.100;
    ramRod.position.y = parts.ramFoot + reach / 2;
    for (const h of hoses) {
      _a.set(h.from.x, h.from.y, h.from.z);
      _b.set(h.to.x, h.to.y, h.to.z);
      // A hose strung frame-to-frame does not care where the vessel is; one
      // strung TO the vessel has to be taken through the lift and the tilt to
      // find out where its far end has got to.
      if (!h.fixed) _b.applyMatrix4(tilt.matrix).applyMatrix4(lift.matrix);
      // one quadratic bezier, with the control point hung below the midpoint
      _c.copy(_a).add(_b).multiplyScalar(0.5);
      _c.y -= h.sag;
      const bez = (u, out) => {
        const v = 1 - u;
        out.set(
          v * v * _a.x + 2 * v * u * _c.x + u * u * _b.x,
          v * v * _a.y + 2 * v * u * _c.y + u * u * _b.y,
          v * v * _a.z + 2 * v * u * _c.z + u * u * _b.z,
        );
        return out;
      };
      const swell = h.pulses ? 1 + beat * 0.30 : 1;
      for (let i = 0; i < h.segs.length; i++) {
        bez(i / h.segs.length, _p);
        bez((i + 1) / h.segs.length, _q);
        const seg = h.segs[i];
        seg.position.copy(_p).add(_q).multiplyScalar(0.5);
        _t.copy(_q).sub(_p);
        const len = _t.length() || 1e-4;
        _quat.setFromUnitVectors(HOSE_UP, _t.divideScalar(len));
        seg.quaternion.copy(_quat);
        seg.scale.set(swell, len / 0.10, swell);
      }
    }
  };

  /* ---- what is written on it: the plate, the paper, the stack ---- */

  // the subject plate, on the front rail under the vessel, where you read it
  const subjTex = subjectTexture(subject);
  // Tilted up off the skirt like a placard, NOT hung across the front of the
  // frame — which is where it was, and where a 0.166-wide panel of armour
  // covered the bottom third of the glass and most of the occupant with it.
  // Down here it is read by looking down at the machine, and it obscures
  // nothing but the floor pan.
  const subjPlate = at(new THREE.Mesh(
    new THREE.PlaneGeometry(0.150, 0.047),
    new THREE.MeshBasicMaterial({ map: subjTex, side: THREE.DoubleSide }),
  ), 0, FR_Y0 + 0.030, FR_X + 0.026);
  subjPlate.rotation.x = -0.62;
  const subjBack = at(box(0.164, 0.056, 0.008, plateMat), 0, FR_Y0 + 0.028, FR_X + 0.023);
  subjBack.rotation.x = -0.62;
  frame.add(subjBack);
  frame.add(subjPlate);
  parts.subjectPlate = subjPlate;

  // the oscillograph, on a bracket off the back
  const osc = traceTexture();
  const back = new THREE.Group();
  back.position.set(0, FR_MID + 0.038, -FR_X - 0.020);
  back.rotation.y = Math.PI;
  frame.add(back);
  back.add(at(box(0.176, 0.086, 0.020, plateMat), 0, 0, 0.008));
  back.add(at(box(0.166, 0.076, 0.008, oil), 0, 0, 0.018));
  const paper = at(new THREE.Mesh(
    new THREE.PlaneGeometry(0.156, 0.049),
    new THREE.MeshBasicMaterial({ map: osc.texture }),
  ), 0, -0.004, 0.024);
  back.add(paper);
  back.add(at(cyl(0.016, 0.016, 0.150, brass, 8), 0, -0.048, 0.018).rotateZ(Math.PI / 2));
  const needle = new THREE.Group();
  needle.position.set(0.070, -0.004, 0.028);
  back.add(needle);
  needle.add(at(box(0.062, 0.004, 0.004, chrome), -0.031, 0, 0));
  needle.add(at(box(0.005, 0.010, 0.005, hazard), -0.062, 0, 0));
  needle.add(at(cyl(0.008, 0.008, 0.010, chrome, 6), 0, 0, 0).rotateX(Math.PI / 2));
  parts.osc = { push: osc.push, word: osc.word, needle, paper };
  back.add(at(box(0.176, 0.012, 0.016, hazard), 0, 0.048, 0.008));

  // the nerve-loom drum, on a spring so the head can turn without tearing it
  const loomDrum = at(cyl(0.030, 0.030, 0.048, oil, 10), -0.060, FR_Y1 - 0.048, -FR_X + 0.010);
  loomDrum.rotation.z = Math.PI / 2;
  frame.add(loomDrum);
  frame.add(at(tor(0.031, 0.005, brass, 4, 10), -0.086, FR_Y1 - 0.048, -FR_X + 0.010).rotateY(Math.PI / 2));
  parts.loomDrum = loomDrum;

  /**
   * THE CHIMNEY, and the cowl on top of it.
   *
   * The frame runs warm — there is a person in it — and the waste heat goes up
   * a stack at the back with a four-vane cowl on top. The cowl TURNS whenever
   * the machine is computing, which is almost always, and faster when it is
   * working hard. It is the one part of this thing that is moving even when
   * everything else has gone still, and it is what makes a dozing Warden read
   * as asleep rather than as switched off.
   */
  const stack = new THREE.Group();
  stack.position.set(0.070, FR_Y1 - 0.010, -0.076);
  frame.add(stack);
  stack.add(at(cyl(0.026, 0.030, 0.056, steel, 10), 0, 0.026, 0));
  stack.add(at(tor(0.028, 0.005, brass, 4, 10), 0, 0.050, 0).rotateX(Math.PI / 2));
  const cowl = new THREE.Group();
  cowl.position.set(0, 0.062, 0);
  stack.add(cowl);
  cowl.add(at(cyl(0.012, 0.012, 0.024, chrome, 6), 0, 0, 0));
  cowl.add(at(cyl(0.020, 0.014, 0.010, brass, 8), 0, 0.014, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const vane = at(box(0.046, 0.034, 0.005, steel), Math.sin(a) * 0.030, 0.002, Math.cos(a) * 0.030);
    vane.rotation.y = a;
    vane.rotation.x = 0.5;
    cowl.add(vane);
  }
  parts.cowl = cowl;

  /* ================================================================== *
   * THE LIFT — twin rear posts, a kingpin, and the loom between them    *
   * ================================================================== */

  /**
   * Why not a mast up the middle, like the Mk I?
   *
   * Because the middle is occupied. The whole front of the drum is the vessel,
   * so the load path went round it: a KINGPIN just behind the glass takes the
   * weight, and two POSTS at the back take the moment — which is also why the
   * counterweight hangs where it does, directly over them. The deck rides up
   * this last two inches at the eighth beat of the deploy, and it is the
   * moment the machine stops being a box and becomes a gun.
   */
  const kingSleeve = at(cyl(0.046, 0.050, 0.070, steel, 10), 0, PED_Y1 + 0.016, -0.040);
  g.add(kingSleeve);
  const kingpin = at(cyl(0.036, 0.036, 0.120, chrome, 10), 0, PED_Y1 + 0.040, -0.040);
  g.add(kingpin);
  parts.kingpin = kingpin;
  for (const sx of [-1, 1]) {
    g.add(at(box(0.048, 0.038, 0.048, steel), sx * 0.100, PED_Y1 - 0.004, -0.075));  // shoulder boss
    const sleeve = at(cyl(0.028, 0.030, 0.048, oil, 8), sx * 0.100, PED_Y1 + 0.018, -0.075);
    g.add(sleeve);
    const post = at(cyl(0.021, 0.021, 0.110, chrome, 8), sx * 0.100, PED_Y1 + 0.050, -0.075);
    g.add(post);
    parts.posts.push({ node: post, sx });
    // the lock collar that grips it once it is up
    g.add(at(tor(0.026, 0.005, brass, 4, 10), sx * 0.100, PED_Y1 + 0.040, -0.075).rotateX(Math.PI / 2));
  }
  /**
   * THE NERVE LOOM, run up the outside of the kingpin as a braid of eight
   * strands. It TWISTS as the head slews, because it is bolted to the deck at
   * the top and to the drum at the bottom, and it is the visible reason the
   * machine's arc has an end.
   */
  for (let i = 0; i < 8; i++) {
    const strand = new THREE.Group();
    g.add(strand);
    const c = i % 3 === 0 ? copper : i % 3 === 1 ? oil : rubber;
    strand.add(at(cyl(0.0055, 0.0055, 0.10, c, 5), 0, 0, 0));
    parts.loom.push({ node: strand, i });
  }

  /* ================================================================== *
   * THE SLEW RING — the race, its pinion, and the DRAG CHAIN            *
   * ================================================================== */

  parts.deckY = DECK_Y;
  parts.deckFold = DECK_Y - DECK_LIFT;
  const body = new THREE.Group();
  body.position.y = DECK_Y;
  g.add(body);
  parts.body = body;

  body.add(at(oct(PED_R - 0.006, 0.024, steel), 0, -0.014, 0));               // the deck's underside
  body.add(at(tor(0.135, 0.018, brass, 6, 22), 0, 0.02, 0).rotateX(Math.PI / 2));
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

  head.add(at(cyl(0.118, 0.126, 0.026, plateMat, 14), 0, 0, 0));         // the deck plate
  head.add(at(box(0.24, 0.010, 0.10, dark), 0, 0.014, -0.02));           // tread plate

  /**
   * THE COUNTERWEIGHT. A cast mass on an arm behind the breech, which is what
   * lets two barrels and a water jacket sit that far in front of the ring
   * without the slew motors fighting the whole time. It hangs on a short
   * pivot, so it LAGS the head a little when it slews — which is the one
   * detail that makes this thing read as heavy rather than as big.
   */
  const cw = new THREE.Group();
  // Set a little low, so the cradle can run all the way back over it into the
  // transit position without the two occupying the same air.
  cw.position.set(0, 0.042, -0.135);
  head.add(cw);
  parts.counterweight = cw;
  cw.add(at(box(0.13, 0.075, 0.075, steel), 0, -0.010, -0.03));
  cw.add(at(box(0.14, 0.014, 0.085, steel), 0, 0.030, -0.03));
  cw.add(at(cyl(0.012, 0.012, 0.10, chrome, 6), 0, 0.030, 0).rotateZ(Math.PI / 2));

  /* ---- the cradle: both barrels elevate in one trunnion, and the whole
   *      thing RUNS OUT INTO BATTERY on the ninth beat of the deploy ---- */
  const cradle = new THREE.Group();
  cradle.position.set(0, 0.100, 0.015);
  head.add(cradle);
  parts.cradle = cradle;
  parts.batteryZ = 0.015;          // in battery
  parts.stowZ = -0.085;            // drawn back on its rails for carry

  // the receiver: one body, two bolt ways, and the rails on show between them
  cradle.add(at(box(0.175, 0.070, 0.20, steel), 0, 0, 0));
  cradle.add(at(box(0.185, 0.014, 0.205, dark), 0, 0.040, 0));
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {                                        // lightening holes
      cradle.add(at(cyl(0.012, 0.012, 0.020, oil, 8), sx * 0.088, -0.004, -0.06 + k * 0.042)
        .rotateZ(Math.PI / 2));
    }
  }
  // the rails it runs out along, fixed to the head, so the travel is visible
  for (const sx of [-1, 1]) {
    head.add(at(box(0.014, 0.016, 0.30, chrome), sx * 0.096, 0.076, 0.010));
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

  /**
   * THE TRANSIT CLAMPS. Two hooks over the cradle that hold the gun still in
   * the satchel, and the second thing to move on deploy: they swing outboard
   * and hang there for the rest of the machine's life, which is exactly what
   * transit hardware does on real kit.
   */
  for (const sx of [-1, 1]) {
    const clamp = new THREE.Group();
    clamp.position.set(sx * 0.104, 0.056, 0.070);
    head.add(clamp);
    clamp.add(at(box(0.012, 0.060, 0.014, steel), 0, 0.030, 0));
    clamp.add(at(box(0.030, 0.014, 0.014, hazard), -sx * 0.011, 0.060, 0));
    clamp.add(at(cyl(0.008, 0.008, 0.016, chrome, 6), 0, 0, 0).rotateZ(Math.PI / 2));
    parts.clamps.push({ node: clamp, sx });
  }

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
      grp.add(at(tor(0.031, 0.004, chrome, 4, 12), 0, 0, -0.06 + k * 0.042));
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
  tank.add(at(tor(0.041, 0.005, brass, 4, 12), -0.045, 0, 0).rotateY(Math.PI / 2));
  tank.add(at(tor(0.041, 0.005, brass, 4, 12), 0.045, 0, 0).rotateY(Math.PI / 2));
  tank.add(at(cyl(0.014, 0.014, 0.020, brass, 8), 0.02, 0.038, 0));         // filler cap
  // the condenser coil, run down the back where it can shed
  for (let k = 0; k < 5; k++) {
    tank.add(at(tor(0.020, 0.004, copper, 4, 10), -0.05 + k * 0.025, -0.030, -0.045).rotateX(Math.PI / 2));
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
    const puff = at(sph(0.026, steamMat.clone(), 6, 5), -0.02, 0.055, 0);
    puff.visible = false;
    tank.add(puff);
    parts.steam.push({ mesh: puff, i: k });
  }

  /* ================================================================== *
   * THE FEED — a saddle drum that turns, and a rack of spares           *
   * ================================================================== */

  const drum = new THREE.Group();
  drum.position.set(0, 0.098, 0.010);
  cradle.add(drum);
  parts.drum = drum;
  drum.add(at(cyl(0.058, 0.058, 0.040, plateMat, 14), 0, 0, 0));
  drum.add(at(tor(0.058, 0.006, steel, 5, 16), 0, 0.020, 0).rotateX(Math.PI / 2));
  drum.add(at(cyl(0.018, 0.018, 0.050, chrome, 8), 0, 0.004, 0));           // its spindle
  for (let k = 0; k < 8; k++) {                                            // the rounds in it
    const a = (k / 8) * TAU;
    drum.add(at(cyl(0.006, 0.006, 0.028, brass, 5),
      Math.sin(a) * 0.040, 0.023, Math.cos(a) * 0.040));
  }
  drum.add(at(box(0.028, 0.012, 0.018, hazard), 0.040, 0.024, 0));          // the carry lug
  // the chute from the drum down into the receiver, so the path is visible
  cradle.add(at(box(0.044, 0.042, 0.030, dark), 0, 0.068, 0.010));

  /**
   * THE READY DRUMS — on the floor of the frame, not hanging off the gun.
   *
   * They were two flat discs slung from a pivot on the edge of the deck, and
   * from anywhere but dead astern they read as two coins stuck to the side of
   * the turret with nothing holding them: no bracket you could see, no reason
   * for them to be at that height, and a silhouette that made the machine look
   * broken. Now they are where spare ammunition actually goes — stood on the
   * floor pan between the legs, inside the frame, under a clamp bar that lifts
   * off them on deploy. The loader arm reaches DOWN through the deck for one,
   * which is a longer and better-looking move than reaching sideways.
   */
  for (let k = 0; k < 2; k++) {
    const sx = k ? 1 : -1;
    const spare = at(cyl(0.050, 0.050, 0.030, plateMat, 12), sx * 0.058, FR_Y0 + 0.033, -0.062);
    frame.add(spare);
    frame.add(at(tor(0.050, 0.005, brass, 4, 14), sx * 0.058, FR_Y0 + 0.048, -0.062).rotateX(Math.PI / 2));
    parts.rack.push(spare);
  }
  // the clamp bar over them, which lifts on the tenth beat
  const clampBar = new THREE.Group();
  clampBar.position.set(0, FR_Y0 + 0.052, -0.112);
  frame.add(clampBar);
  parts.rackArm = clampBar;
  clampBar.add(at(box(0.170, 0.012, 0.014, steel), 0, 0.006, 0.050));
  clampBar.add(at(box(0.170, 0.010, 0.012, hazard), 0, 0.014, 0.050));
  for (const sx of [-1, 1]) clampBar.add(at(box(0.012, 0.012, 0.052, steel), sx * 0.078, 0.004, 0.026));
  parts.rackOut = -0.95;      // lifted clear of the drums
  parts.rackIn = 0;           // clamped down for carry
  parts.latchOpen = LATCH_OPEN;

  /* ================================================================== *
   * THE LOADER ARM — the closest thing the gun has to a face             *
   * ================================================================== */

  /**
   * A GANTRY, not a hanging arm.
   *
   * It was a limb dangling off the deck at first, and dangling off the deck is
   * where nothing is visible: the ring, the posts and the drum rack are all in
   * the way, so the one part of this machine with any personality spent its
   * life behind the other parts. It stands UP now — a post on the left of the
   * deck with a jointed arm on top of it — and it slews on its own little
   * turntable, which is what lets one arm reach four places that are nowhere
   * near each other: DOWN AND BACK to the drum rack, UP AND OVER to the feed,
   * RIGHT ROUND to the data plate to cut a tally into it, and — the one it was
   * never drawn for — DOWN THE FRONT, to tap the perfusion bottle when the
   * level gets low.
   *
   * Everything is authored pointing UP from its joint, so a rotation of zero
   * is the arm standing to attention and the poses are all departures from it.
   * The post itself telescopes, so the whole assembly can go flat for carry.
   */
  const arm = parts.arm;
  const armBase = new THREE.Group();               // the turntable it slews on
  armBase.position.set(-0.115, 0.020, -0.015);
  head.add(armBase);
  arm.base = armBase;
  armBase.add(at(cyl(0.030, 0.034, 0.026, steel, 10), 0, 0.012, 0));
  const armPost = new THREE.Group();
  armBase.add(armPost);
  arm.post = armPost;
  armPost.add(at(cyl(0.022, 0.022, 0.075, chrome, 8), 0, 0.055, 0));       // the post

  const shoulder = new THREE.Group();
  shoulder.position.set(0, 0.090, 0);
  armPost.add(shoulder);
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

  /* ================================================================== *
   * THE RANGEFINDER — the bar that makes it a long-range gun            *
   * ================================================================== */

  const rfCard = rangeCardTexture();
  const rf = parts.rf;
  const bar = new THREE.Group();
  // A coincidence rangefinder wants a long base, and at 0.60 it had one: a bar
  // two and a half times the width of the machine carrying it, which read as a
  // pair of wings bolted to a gun rather than as part of one. 0.38 is still
  // plainly the longest thing on it and still the reason it can range, without
  // being the whole silhouette.
  bar.position.set(0, 0.172, -0.015);
  head.add(bar);
  rf.bar = bar;
  bar.add(at(box(0.38, 0.030, 0.036, plateMat), 0, 0, 0));                 // the tube itself
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
    const glassL = at(new THREE.Mesh(new THREE.CircleGeometry(0.017, 12), lensMat), 0, 0, 0.041);
    headG.add(glassL);
    headG.add(at(box(0.060, 0.010, 0.030, hazard), 0, 0.031, 0));   // the one stripe on it
    // The cap over the prism, hinged at the BOTTOM and dropped on deploy.
    // Hinging it at the top was the obvious way round and put the open cap
    // above the bar, which made the flipped-back caps the tallest thing on the
    // machine — a gun whose silhouette is set by two lens covers. Dropped, they
    // hang under the prism heads where they belong and the rangefinder is once
    // again the highest thing on it.
    const cap = new THREE.Group();
    cap.position.set(0, -0.028, 0.030);
    headG.add(cap);
    cap.add(at(box(0.050, 0.048, 0.008, steel), 0, 0.024, 0.010));
    cap.add(at(cyl(0.006, 0.006, 0.050, chrome, 6), 0, 0, 0).rotateZ(Math.PI / 2));
    rf[sx < 0 ? 'capL' : 'capR'] = cap;
    rf[sx < 0 ? 'headL' : 'headR'] = headG;
  }
  // the range card on the eyepiece box, because a machine this fussy has one
  const card = at(new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.048),
    new THREE.MeshBasicMaterial({ map: rfCard })), 0.040, 0.006, -0.026);
  card.rotation.y = Math.PI / 2;
  bar.add(card);

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
  shield.add(at(box(0.235, 0.115, 0.012, plateMat), 0, 0.02, 0));
  shield.add(at(box(0.245, 0.012, 0.020, hazard), 0, 0.080, 0));
  for (const sx of [-1, 1]) {                                             // the wings
    const hinge = new THREE.Group();
    hinge.position.set(sx * 0.116, 0.02, 0);
    shield.add(hinge);
    const wing = at(box(0.070, 0.100, 0.010, plateMat), sx * 0.035, 0, -0.018);
    hinge.add(wing);
    hinge.add(at(box(0.008, 0.100, 0.012, steel), 0, 0, -0.004));
    parts.wings.push({ node: hinge, sx });
  }
  // the slit, and the lamp behind it — this is the machine's eye
  shield.add(at(box(0.105, 0.016, 0.016, oil), 0, 0.048, -0.006));
  const eye = at(new THREE.Mesh(new THREE.PlaneGeometry(0.092, 0.012), lensMat), 0, 0.048, 0.008);
  shield.add(eye);
  parts.eye = eye;
  /**
   * ...AND ITS LID. A shutter that drops over the slit.
   *
   * A machine that dims its lamp has been turned down. A machine that CLOSES
   * something over its eye has gone to sleep, and the difference is one box
   * and about four lines of animation. It half-closes on a doze, closes right
   * over during a dream, and blinks — rarely, irregularly, and never while it
   * is looking at anything.
   */
  const eyeLid = at(box(0.100, 0.020, 0.008, steel), 0, 0.066, 0.012);
  shield.add(eyeLid);
  parts.eyeLid = eyeLid;
  parts.eyeLidOpen = 0.066;
  // the spotting lamp under the slit, in a hood
  const lampHood = new THREE.Group();
  lampHood.position.set(0, -0.020, 0.012);
  shield.add(lampHood);
  lampHood.add(at(cyl(0.026, 0.030, 0.030, steel, 10), 0, 0, 0).rotateX(Math.PI / 2));
  const spot = at(new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), lampMat.clone()), 0, 0, 0.017);
  lampHood.add(spot);
  parts.spot = spot;

  /**
   * THE TALKBACK. A horn speaker on the shield's left cheek.
   *
   * The machine has no voice and was never given one; what it has is a field
   * telephone's earpiece wired backwards, and everything it says comes out of
   * this — two-note acknowledgements, mostly, and a carrier click before and
   * after each one. Once in a very long while, when it is dreaming, something
   * comes out of it that is not two notes.
   */
  const talk = new THREE.Group();
  talk.position.set(-0.086, -0.010, 0.014);
  shield.add(talk);
  talk.add(at(cyl(0.012, 0.024, 0.030, steel, 8), 0, 0, 0).rotateX(-Math.PI / 2));
  const talkCone = at(new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), oil), 0, 0, 0.016);
  talk.add(talkCone);
  for (let i = 0; i < 3; i++) talk.add(at(box(0.040, 0.003, 0.004, chrome), 0, -0.008 + i * 0.008, 0.018));
  parts.talkback = talk;

  /* ================================================================== *
   * STATUS — four lamps, and the plate they keep the score on           *
   * ================================================================== */

  for (let i = 0; i < 4; i++) {
    const l = at(sph(0.012, lampMat.clone(), 7, 6), -0.033 + i * 0.022, 0.062, -0.118);
    head.add(l);
    head.add(at(cyl(0.015, 0.015, 0.008, dark, 8), -0.033 + i * 0.022, 0.062, -0.124)
      .rotateX(Math.PI / 2));
    parts.lamps.push(l);
  }
  // the data plate, with the tally the loader arm cuts into it
  const plateTex = plateTexture(subject.word);
  const dataPlate = at(new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.058),
    new THREE.MeshBasicMaterial({ map: plateTex.texture })), 0, 0.024, -0.1265);
  dataPlate.rotation.y = Math.PI;
  head.add(dataPlate);
  parts.dataPlate = dataPlate;
  parts.setTally = (kills) => { plateTex.draw(kills); plateTex.texture.needsUpdate = true; };

  parts.ownedTextures.push(brainTex, subjTex, rfCard, osc.texture, plateTex.texture);
  g.scale.setScalar(TWO_SCALE);
  poseTwoDeployed(parts);
  return { group: g, parts };
}

/* ====================================================================== *
 * THE TWO POSES                                                          *
 *                                                                        *
 * The deployed machine, and the folded one. Everything that is not the    *
 * live entity wants one of these two, and before they lived here every    *
 * caller kept its own half-remembered copy — which is how you end up with *
 * a ghost that stands differently from the turret it is previewing. Add a *
 * moving part to the rig and you set it in both of these, once, and the   *
 * preview, the carry model and the deploy animation all agree.            *
 * ====================================================================== */

/** How far the prism caps drop off the lenses. */
const CAP_OPEN = 2.3;

/** How far the vessel's latch arms splay while it is still moving. */
const LATCH_OPEN = 1.15;

/** Where the electrode crown rides: seated on the cortex, and lifted clear. */
const CROWN_SEATED = JAR_H / 2 - 0.040;
const CROWN_LIFTED = JAR_H / 2 - 0.012;

/**
 * WHERE THE LOADER ARM LIVES WHEN IT HAS NOTHING TO DO.
 *
 * Every joint of the arm is authored pointing straight UP, so "no pose" means
 * the arm standing bolt upright — a thin fork sticking a foot above the machine
 * and reading as an aerial somebody bolted on. An arm at rest is a FOLDED arm:
 * elbow shut, leaning back off the breech, claw parked just over the deck.
 * Exported because the entity eases every routine back to it and the two
 * static poses have to agree with the live one.
 */
export const TWO_ARM_REST = { yaw: -0.30, shoulder: -0.55, elbow: -1.75, wrist: 0, claw: 0.12 };

const setArm = (parts, p) => {
  parts.arm.base.rotation.y = p.yaw;
  parts.arm.shoulder.rotation.x = p.shoulder;
  parts.arm.elbow.rotation.x = p.elbow;
  parts.arm.wrist.rotation.z = p.wrist;
  parts.arm.clawL.rotation.z = p.claw * 0.5;
  parts.arm.clawR.rotation.z = -p.claw * 0.5;
};

/** Standing, ready, doors open — the pose the placement ghost is frozen in. */
export function poseTwoDeployed(parts) {
  for (const leg of parts.legs) {
    leg.hip.rotation.x = leg.splay;
    leg.knee.rotation.x = leg.fold;
    leg.pad.rotation.x = -(leg.splay + leg.fold);
    leg.ram.position.y = -0.154;
    leg.ram.scale.y = 1.35;
    leg.jack.position.y = -0.158;
  }
  for (const l of parts.latches) l.node.rotation.x = -1.35;
  parts.spade.position.y = parts.spadeDown;
  parts.body.position.y = parts.deckY;
  for (const c of parts.clamps) c.node.rotation.z = -c.sx * 1.5;
  for (const w of parts.wings) w.node.rotation.y = w.sx * 0.55;
  parts.rackArm.rotation.x = parts.rackOut;
  parts.cradle.position.z = parts.batteryZ;
  parts.rf.bar.scale.x = 1;
  parts.rf.capL.rotation.x = CAP_OPEN;
  parts.rf.capR.rotation.x = CAP_OPEN;
  parts.arm.post.scale.y = 1;
  setArm(parts, TWO_ARM_REST);
  // the vessel, up and presented, latched into its gimbal
  parts.vesselLift.position.y = parts.vesselUp;
  parts.vesselTiltNode.rotation.x = 0;
  parts.latchL.rotation.z = 0;
  parts.latchR.rotation.z = 0;
  parts.crown.position.y = CROWN_SEATED;
  parts.eyeLid.position.y = parts.eyeLidOpen;
  parts.bottleFill.scale.y = 1;
  layoutTwoLift(parts, parts.deckY);
  parts.layPlumbing(0);
}

/** Folded, latched, shut — how it comes out of the satchel. */
export function poseTwoFolded(parts) {
  for (const leg of parts.legs) {
    leg.hip.rotation.x = -0.05;          // out, not back: see the note on order
    leg.knee.rotation.x = 0;
    leg.pad.rotation.x = 0.05;
    leg.ram.position.y = -0.122;
    leg.ram.scale.y = 1;
    leg.jack.position.y = -0.120;        // screwed all the way up
  }
  for (const l of parts.latches) l.node.rotation.x = 0;
  parts.spade.position.y = parts.spadeUp;
  parts.body.position.y = parts.deckFold;
  for (const c of parts.clamps) c.node.rotation.z = 0;
  for (const w of parts.wings) w.node.rotation.y = 0;
  parts.rackArm.rotation.x = parts.rackIn;
  parts.cradle.position.z = parts.stowZ;
  parts.rf.bar.scale.x = 0.30;
  parts.rf.capL.rotation.x = 0;
  parts.rf.capR.rotation.x = 0;
  parts.arm.post.scale.y = 0.18;
  setArm(parts, { yaw: 0, shoulder: -0.95, elbow: -2.45, wrist: 0, claw: 0 });
  // the vessel, struck down between the legs and laid on its back
  parts.vesselLift.position.y = parts.vesselDown;
  parts.vesselTiltNode.rotation.x = parts.vesselTilt;
  parts.latchL.rotation.z = LATCH_OPEN;
  parts.latchR.rotation.z = -LATCH_OPEN;
  parts.crown.position.y = CROWN_LIFTED;
  parts.eyeLid.position.y = parts.eyeLidOpen - 0.021;
  parts.bottleFill.scale.y = 1;
  layoutTwoLift(parts, parts.deckFold);
  parts.layPlumbing(0);
}

/**
 * Put the twin posts, the kingpin and the nerve loom where a deck at height
 * `y` needs them, with the loom wound round by `twist` radians of head slew.
 *
 * The posts have to REACH the deck rather than merely be near it, and the loom
 * and the kingpin have to span the same gap, so all three are stretched off
 * one number rather than animated separately and hoped over. Exported because
 * the entity drives the deck height every frame and the static poses set it
 * once — and neither should be keeping its own copy of this arithmetic.
 */
export function layoutTwoLift(parts, y, twist = 0) {
  const foot = PED_Y1 + 0.018;                       // the top of the post sleeves
  const len = Math.max(0.012, y - foot + 0.012);
  for (const p of parts.posts) {
    p.node.scale.y = len / 0.110;
    p.node.position.y = foot + len / 2 - 0.008;
  }
  // the kingpin, which is the load path and rises out of its own sleeve
  const kLen = Math.max(0.020, y - PED_Y1 + 0.010);
  parts.kingpin.scale.y = kLen / 0.120;
  parts.kingpin.position.y = PED_Y1 - 0.010 + kLen / 2;
  // the loom, braided round the kingpin and twisted by however far the head
  // has turned — the visible reason the arc has an end
  for (const s of parts.loom) {
    const a = (s.i / 8) * TAU + twist * 0.55;
    const r = 0.048 + (s.i % 2) * 0.006;
    s.node.position.set(Math.sin(a) * r, PED_Y1 - 0.008 + kLen / 2, -0.040 + Math.cos(a) * r);
    s.node.scale.y = kLen / 0.10;
    s.node.rotation.y = a;
    s.node.rotation.z = Math.sin(a) * 0.12 + twist * 0.05;
  }
}
