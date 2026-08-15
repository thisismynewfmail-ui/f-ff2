import * as THREE from '../../lib/three.module.js';
import { Entity } from './Entity.js';
import {
  buildSentryTwoModel, poseTwoFolded, layoutTwoLift, subjectFor,
  TWO_SCALE, TWO_EYE, TWO_MUZZLE, TWO_SPREAD, TWO_HEIGHT, TWO_BRAIN_Y, TWO_ARM_REST,
} from '../rendering/SentryTwoModel.js';
import { SENTRY_RANGE, SENTRY_DAMAGE, SENTRY_INTERVAL, SENTRY_DEPLOY_TIME } from './Sentry.js';

/**
 * THE SENTRY MK II — "THE WARDEN". A twin-barrel post gun on a quadrupod,
 * bought from the vendor two at a time and set down where a street has to be
 * held rather than merely watched.
 *
 * WHAT IT IS, AGAINST THE MK I. The Mk I is a pistol on a tripod: it covers
 * the half of the world in front of it out to sixty feet, and it is honest
 * about being a second gun rather than a better one. The Mk II is the other
 * trade. It reaches TWICE as far, covers 240° instead of 180°, and puts two
 * rounds downrange every time it pulls — but it is heavier to place, it takes
 * twice as long to come up, and every so often it has to stop and change a
 * drum, which it does with its own arm while you watch.
 *
 *   range      2 × the Mk I's — the rangefinder bar is why, and it is on show
 *   arc        240°, which is the length of the slew ring's drag chain
 *   rate       a little faster than the Mk I, and TWO barrels fire together
 *   damage     the pistol's, per bullet, exactly as the Mk I — two bullets
 *   heat       a water jacket rather than fins: it holds longer, then BOILS
 *   feed       a saddle drum, and it changes its own
 *   deploy     2 × the Mk I's, in sixteen beats instead of four
 *
 * The horde still does not know it is there. Like the Mk I it is on neither
 * the player's roster nor the friendlies list, so nothing shoots back, walks
 * into it or beats on it: it is a thing you leave behind you and walk away
 * from, not a thing you stand and defend.
 *
 * ── AND THEN THERE IS THE OTHER THING ─────────────────────────────────────
 *
 * Behind two armoured doors in the front of the computing section there is a
 * glass vessel with a person's brain in it, and that brain is the fire control
 * computer. See SentryTwoModel.js for how it is built; what matters HERE is
 * that it is alive and the code treats it that way. It has a PULSE, and the
 * pulse is not a decoration — it is a real value on this class that speeds up
 * when the machine acquires, thumps when it fires, races when it overheats and
 * slows to almost nothing while it sleeps, and it drives the swelling of the
 * organ, the stroke of the perfusion pump, the brightness of the perfusate,
 * the needle on the oscillograph and an audible heartbeat you can hear from
 * across the street.
 *
 * Nothing ever explains it. The doors open, the plate under the glass has a
 * name on it, and everything charming the machine does stops being charming.
 *
 * ── STATES ────────────────────────────────────────────────────────────────
 *   deploy   sixteen beats, and every one of them is on screen — see BEATS
 *   boresight  the first thing it does once it is up: one sweep of the whole
 *            arc, which is also the machine checking it can still see
 *   scan     nothing to shoot: the head sweeps its 240°, the drag chain pays
 *            out and winds back, and the rangefinder prisms drift
 *   track    a target: the prisms toe in and CONVERGE first — the optic sees
 *            it before the barrels get there — then the head slews on and
 *            both barrels fire together
 *   reload   the drum is out. The arm lifts a fresh one off the rack, seats
 *            it, and the gun is back. It will not fire during this
 *   cooling  the jackets have gone over: the relief valve lifts, steam comes
 *            off the header tank, and the rate falls away until it recovers
 *   idle     nobody has come for a long time, and it finds things to do
 *
 * ── THE THINGS IT DOES WHEN NOBODY IS WATCHING ────────────────────────────
 *   SELF-TEST  lamps in a chase, the rangefinder swept end to end, the arm
 *              cycling once through its own travel.
 *   DOZE       barrels sink, the eye half-closes under its lid, lamps drop to
 *              a heartbeat, and the pulse in the jar falls to about forty. It
 *              is asleep at its post, and it snores.
 *   DREAM      dozing long enough, it starts dreaming: the pulse goes fast and
 *              irregular, the eye shuts right over and flickers behind the
 *              lid, the barrels twitch onto bearings there is nothing at, and
 *              the oscillograph stops writing a trace and writes a WORD.
 *   SALUTE     stand in front of one, in its arc, doing nothing, and it will
 *              notice you and TIP THE RANGEFINDER BAR at you like a hat brim.
 *   REGARD     ...and once in a while it does not do that. It stops, turns,
 *              puts its lamps out, and looks at you — for three and a half
 *              seconds, which is a very long time — with its pulse climbing.
 *              Then it catches itself and runs a self-test to cover.
 *   STARE      go right up to the glass and look INTO it, and the brain turns
 *              in its cradle to face you.
 *   STARTLE    the town whispers (see Anomalies.js) and the machine hears it.
 *              It breaks off, slews onto a bearing with nothing on it, and
 *              holds. Its optics converge on empty street.
 *   TALLY      every twenty-fifth kill the arm cuts another mark into its own
 *              data plate. Past a hundred and fifty the marks are not marks.
 *   POLISH     left alone long enough it wipes the rangefinder glass.
 *   SERVICE    the perfusate runs low over a long run, and the arm reaches
 *              down the front of its own body and taps the bottle.
 *   GRUMBLE    set down three times in a hurry and it deploys in a mood.
 *   HANDSHAKE  deploy one within seven metres of a Mk I and the two of them
 *              acknowledge each other. The old machine and the new one.
 *   COMMUNE    deploy two Mk IIs within nine metres and leave them alone, and
 *              they will eventually start talking to each other in lamps.
 */

/** Twice the Mk I's reach, off the same constant, so it can never drift. */
export const TWO_RANGE = SENTRY_RANGE * 2;          // 36.576 m
export const TWO_ARC = 240 * Math.PI / 180;         // 240°, the drag chain's length
export const TWO_DAMAGE = SENTRY_DAMAGE;            // per bullet — and it fires two
export const TWO_INTERVAL = SENTRY_INTERVAL * 0.85; // 0.221 s: slightly faster
export const TWO_BARRELS = 2;

/**
 * TWICE THE MK I'S DEPLOY, AND FOUR TIMES THE MACHINERY.
 *
 * Both halves of that are literal and both are checkable. The time is
 * SENTRY_DEPLOY_TIME × 2 rather than a number that happens to be about double,
 * so the two can never drift apart. The complexity is the table below: the
 * Mk I's deploy animates FOUR channels (hip, knee, ram, mast) off one eased
 * ramp, and this animates SIXTEEN NAMED BEATS, each with its own window, its
 * own moving part and its own sound.
 *
 * They overlap on purpose. A machine that did sixteen things strictly one
 * after another over two seconds would give each of them an eighth of a second
 * and read as a stutter; a real one has the legs still going out while the gun
 * is already running into battery. Read the table as a Gantt chart — what
 * matters is that at no point in those two seconds is only one thing moving,
 * and that the ORDER is mechanically true: you cannot drive the spade before
 * the legs are down, and you do not open the vessel until the gun is up.
 */
const BEATS = [
  { id: 'latch', a: 0.000, b: 0.055 },   //  1 four transit latches pop
  { id: 'clamp', a: 0.045, b: 0.140 },   //  2 the clamps over the cradle swing clear
  { id: 'splay', a: 0.100, b: 0.320 },   //  3 four legs scissor out
  { id: 'knee', a: 0.180, b: 0.400 },   //  4 knees fold, one beat behind
  { id: 'jack', a: 0.320, b: 0.505 },   //  5 the screw jacks wind down, turning
  { id: 'level', a: 0.470, b: 0.575 },   //  6 differential correction: it rocks level
  { id: 'spade', a: 0.520, b: 0.615 },   //  7 the drop spade goes in. THUMP
  { id: 'rise', a: 0.560, b: 0.670 },   //  8 the twin posts stand the deck up
  { id: 'battery', a: 0.620, b: 0.725 },   //  9 the gun runs out into battery
  { id: 'wings', a: 0.690, b: 0.765 },   // 10 shield wings out, ready rack drops
  { id: 'shutter', a: 0.735, b: 0.825 },   // 11 THE DOORS OPEN
  { id: 'perfuse', a: 0.790, b: 0.870 },   // 12 the pump starts. The first beat
  { id: 'cortex', a: 0.840, b: 0.895 },   // 13 the crown seats; the needle drops
  { id: 'range', a: 0.865, b: 0.930 },   // 14 the bar telescopes, the caps drop
  { id: 'charge', a: 0.905, b: 0.952 },   // 15 the handle, drawn and released
  { id: 'ready', a: 0.945, b: 1.000 },   // 16 lamps run, the talkback answers
];
const DEPLOY_TIME = SENTRY_DEPLOY_TIME * 2;   // 2.10 s

const SCAN_SPEED = 0.62;      // rad/s: a slower, heavier sweep over a wider arc
const TRACK_SPEED = 3.4;      // rad/s slewing onto a target
const AIM_TOLERANCE = 0.10;
const MUZZLE_FLASH = 0.055;

// The water jacket: it takes more before it goes over, and it sheds faster
// once it does — but when it goes, it BOILS rather than merely glowing.
const HEAT_PER_PULL = 0.055;
const HEAT_SHED = 0.26;
const HEAT_CEILING = 1.0;
const HEAT_RESUME = 0.45;

// The drum. Forty pulls is nearly nine seconds of continuous fire, so it is
// rarely the thing that stops a fight — it is the thing you notice it doing
// afterwards, which is the whole reason the arm is on it.
const DRUM_PULLS = 40;
const RELOAD_TIME = 1.9;
const RACK_SIZE = 2;          // drums on the flank; must match the rig's rack

/**
 * THE PULSE, IN BEATS PER SECOND.
 *
 * These are the whole emotional range of the machine and they are deliberately
 * human numbers: 50 bpm asleep, 68 at rest, 132 in a fight, 150 when it is
 * frightened. A player never sees a number — they hear a rate through the hull
 * and watch a thing swell behind glass — but the rates being real is why the
 * doze reads as sleep rather than as a slow LED.
 */
const PULSE = {
  dead: 0, doze: 0.83, dream: 1.55, rest: 1.13, work: 1.55,
  fight: 2.20, hot: 2.45, fear: 2.60, regard: 1.90,
};
/** How long the perfusate lasts before the arm has to top it up. */
const PERFUSE_LIFE = 420;     // seconds of standing there
const PERFUSE_LOW = 0.34;

const SELFTEST_EVERY = 30;
const POLISH_EVERY = 44;
const DOZE_AFTER = 58;
const DREAM_AFTER = 22;       // ...of dozing
const SALUTE_RANGE = 8.0;
const SALUTE_COOLDOWN = 24;
const TALLY_EVERY = 25;
const HANDSHAKE_RANGE = 7.0;
const COMMUNE_RANGE = 9.0;
const COMMUNE_COOLDOWN = 70;
const REGARD_RANGE = 5.5;
const REGARD_COOLDOWN = 95;
const STARE_RANGE = 2.6;
const STARE_COOLDOWN = 80;
const STARTLE_COOLDOWN = 30;

const EYE_H = TWO_EYE * TWO_SCALE;
const MUZZLE_OUT = TWO_MUZZLE * TWO_SCALE;
const SPREAD = TWO_SPREAD * TWO_SCALE;

const ease = (t) => t * t * (3 - 2 * t);
const sat = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const pulse = (t, up = 0.2, down = 0.25) => (t < up ? ease(t / up)
  : t > 1 - down ? ease((1 - t) / down) : 1);
const damp = (cur, want, dt, rate) => cur + (want - cur) * Math.min(1, dt * rate);

/**
 * ONE HEARTBEAT, as a shape rather than as a sine.
 *
 * A sine is a hum. What makes this read as a heart is that it is TWO events a
 * fifth of a second apart with a long flat nothing after them — lub, dub, and
 * then silence for most of the cycle. Both the swelling of the organ and the
 * audible thump come off this one function, so they can never fall out of step.
 */
const heartbeat = (t) => {
  const lub = Math.exp(-((t - 0.06) ** 2) / 0.0020);
  const dub = Math.exp(-((t - 0.23) ** 2) / 0.0028) * 0.55;
  return Math.min(1, lub + dub);
};

export class SentryTwo extends Entity {
  constructor(events, world, texLib, { x, z, yaw, grumpy = false }) {
    super();
    this.events = events;
    this.world = world;
    this.kind = 'sentryTwo';
    this.addTag('sentry');
    // Not 'friendly', for the same reason the Mk I is not: nothing hunts this.

    const y = world.groundHeightFor(x, z, 1e9);
    this.position.set(x, y, z);
    this.yaw = yaw;              // the centre of its arc; fixed once placed
    this.height = TWO_HEIGHT * TWO_SCALE;
    this.radius = 0.38;

    // WHO IS IN IT. Off the position, so it survives a save, a checkpoint
    // rollback and a pack-up-and-put-down without becoming somebody else.
    this.subject = subjectFor(x, z);
    this.rig = buildSentryTwoModel(texLib, this.subject);
    this.mesh = this.rig.group;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = yaw;
    // It comes out of the satchel folded and stands up on screen, rather than
    // appearing already standing and animating from a pose nobody chose.
    poseTwoFolded(this.rig.parts);

    this.state = 'deploy';
    this.stateT = 0;
    this.headYaw = 0;            // relative to `yaw`; the arc is ±TWO_ARC/2
    this.headPitch = 0;
    this.scanDir = Math.random() < 0.5 ? -1 : 1;
    this.cooldown = 0;
    this.flashT = 0;
    this.recoil = 0;
    this.bolt = 0;
    this.heat = 0;
    this.shellT = 0;
    this.target = null;
    this.kills = 0;
    this.shotsFired = 0;         // pulls; each puts TWO_BARRELS rounds out
    this.roundsFired = 0;
    this.toRemove = false;
    this._beat = -1;             // which deploy beat has been announced

    // the feed
    this.drum = DRUM_PULLS;      // pulls left in the one that is on
    this.drumSpin = 0;
    this.spares = RACK_SIZE;     // drums standing in the ready rack right now

    // the optic: 0 wide open and drifting, 1 fully converged on something
    this.converge = 0;

    /* ---- THE THING IN THE JAR ---- */
    this.pulseT = 0;             // phase through the current beat, 0..1
    this.pulseRate = 0;          // Hz — nothing is beating until beat 12
    this.agitation = 0;          // 0 calm, 1 the trace is unreadable
    this.perfusion = 1;          // how much is left in the bottle
    /**
     * WHICH WAY THE THING IN THE JAR IS FACING.
     *
     * Not forward. It was installed at whatever angle it was installed at and
     * nobody straightened it, so it sits a little off the axis of the doors,
     * drifting by a few degrees over the course of a minute the way anything
     * suspended in fluid does. That resting angle is the whole reason the
     * STARE reads: a brain that already faced front would turn to face a
     * player standing directly in front of it and move by nothing at all.
     *
     * So it is never less than about sixteen degrees off, and which way it
     * leans is the machine's own — set from where it stands, like its name.
     * Which side is a detail nobody will consciously notice and everybody
     * will feel: none of these things is quite looking at the door.
     */
    this.brainRest = (Math.sin(x * 3.1 + z * 1.7) < 0 ? -1 : 1)
      * (0.28 + Math.abs(Math.sin(x * 1.9 - z * 2.3)) * 0.26);
    this.brainYaw = this.brainRest;
    this._oscT = 0;
    this._lidWant = 0;

    // the idle life
    this.quiet = 0;
    this.routine = null;
    this.routineT = 0;
    this.nextSelfTest = SELFTEST_EVERY * (0.7 + Math.random() * 0.6);
    this.nextPolish = POLISH_EVERY * (0.7 + Math.random() * 0.6);
    this.saluteReady = 0;
    this.sawPlayer = 0;
    this.regardReady = REGARD_COOLDOWN * 0.35;
    this.stareReady = 0;
    this.startleReady = 0;
    this.communeReady = COMMUNE_COOLDOWN * 0.5;
    this._watched = 0;           // how long the player has been looking at it
    this._peered = 0;            // ...and how long they have been looking IN
    this._armPose = { ...TWO_ARM_REST };   // out of the bag already folded
    this._grumpy = grumpy;
    this._handshakeDue = true;
    this._boresightDue = true;

    // The town whispers, and this machine hears it. Kept as an unsubscribe so
    // a packed-up sentry stops listening — a bus listener on a disposed entity
    // is a leak that only shows up after the twentieth redeploy.
    this._offWhisper = events.on('whisper', () => { this._whisperHeard = 1.2; });

    this.interactable = world.addInteractable({
      x, z, y, radius: 2.1,
      prompt: 'Pack up the Mk II [E]',
      enabled: () => !this.toRemove,
      onInteract: () => this.events.emit('sentry:retrieve', { sentry: this }),
    });
    this.events.emit('sentry:deployed', { pos: this.position.clone(), kind: this.kind });
  }

  /** Is this world point inside the covered wedge? */
  covers(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    if (dx * dx + dz * dz > TWO_RANGE * TWO_RANGE) return false;
    let rel = Math.atan2(dx, dz) - this.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    return Math.abs(rel) <= TWO_ARC / 2;
  }

  /** The centre of the pair, in world space — what line of sight is traced from. */
  muzzlePoint() {
    const a = this.yaw + this.headYaw;
    return new THREE.Vector3(
      this.position.x + Math.sin(a) * MUZZLE_OUT,
      this.position.y + EYE_H,
      this.position.z + Math.cos(a) * MUZZLE_OUT,
    );
  }

  /** Both bores, left then right — where the two rounds actually leave from. */
  muzzlePoints() {
    const a = this.yaw + this.headYaw;
    const fx = Math.sin(a), fz = Math.cos(a);
    const rx = Math.cos(a), rz = -Math.sin(a);          // the head's right
    return [-1, 1].map((s) => new THREE.Vector3(
      this.position.x + fx * MUZZLE_OUT + rx * s * SPREAD,
      this.position.y + EYE_H,
      this.position.z + fz * MUZZLE_OUT + rz * s * SPREAD,
    ));
  }

  /** Where the glass is, in world space — what the player peers into. */
  vesselPoint() {
    return new THREE.Vector3(
      this.position.x + Math.sin(this.yaw) * 0.10,
      this.position.y + TWO_BRAIN_Y,
      this.position.z + Math.cos(this.yaw) * 0.10,
    );
  }

  /** Nearest live zombie inside the wedge with a clear line to the muzzles. */
  _acquire(zombies) {
    const from = this.muzzlePoint();
    let best = null, bestD = Infinity;
    for (const z of zombies ?? []) {
      if (z.state === 'dead') continue;
      const d = Math.hypot(z.position.x - this.position.x, z.position.z - this.position.z);
      if (d >= bestD || !this.covers(z.position.x, z.position.z)) continue;
      // A gun this tall on a mast can see over more than the Mk I can, but it
      // still will not shoot at a cellar or a roof it merely happens to reach.
      if (Math.abs(z.position.y - this.position.y) > 2.6) continue;
      if (!this.world.hasLineOfSight(from.x, from.y, from.z,
        z.position.x, z.position.y + z.height * 0.5, z.position.z)) continue;
      best = z; bestD = d;
    }
    return best;
  }

  _bearingTo(target) {
    const rel = Math.atan2(target.position.x - this.position.x, target.position.z - this.position.z) - this.yaw;
    return Math.atan2(Math.sin(rel), Math.cos(rel));
  }

  update(dt, ctx) {
    this.stateT += dt;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (this.shellT > 0) this.shellT -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6.5);
    this.bolt = Math.max(0, this.bolt - dt * 12);
    this.heat = Math.max(0, this.heat - HEAT_SHED * dt);
    if (this._whisperHeard > 0) this._whisperHeard -= dt;

    if (this.state === 'deploy') {
      this._deployBeats(dt);
      if (this.stateT >= DEPLOY_TIME) {
        this.state = 'scan';
        this.stateT = 0;
        this.routine = null;
        this._greetNeighbour(ctx);
        // ...and if there is no older machine to say hello to, it checks its
        // own eyes instead. Either way the first thing it does is look around.
        if (!this.routine && this._boresightDue) {
          this._boresightDue = false;
          this._begin(this._grumpy ? 'grumble' : 'boresight');
        }
      }
      this._present(dt, ctx);
      return;
    }

    // A drum change runs to the end whatever turns up: the gun is open.
    if (this.state === 'reload') {
      if (this.stateT >= RELOAD_TIME) {
        this.drum = DRUM_PULLS;
        this.state = 'scan';
        this.stateT = 0;
        this.events.emit('sentry:reload', { pos: this.position.clone(), kind: this.kind });
      }
      this.target = this._acquire(ctx?.zombies);   // it still watches while it loads
      this._present(dt, ctx);
      return;
    }

    const limit = TWO_ARC / 2;
    this.target = this._acquire(ctx?.zombies);

    if (this.target) {
      if (this.routine === 'doze' || this.routine === 'dream') {
        this.events.emit('sentry:wake', { pos: this.position.clone(), kind: this.kind });
      }
      this.routine = null;
      this.quiet = 0;
      this._watched = this._peered = 0;
      if (this.state !== 'track') { this.state = 'track'; this.stateT = 0; }
      // THE OPTIC LEADS THE GUN. The prisms converge in about a fifth of a
      // second, and the barrels only start slewing once they have — which is
      // what makes a long-range machine look like it is RANGING rather than
      // simply snapping round.
      this.converge = damp(this.converge, 1, dt, 6);
      const want = Math.max(-limit, Math.min(limit, this._bearingTo(this.target)));
      const step = TRACK_SPEED * dt * (0.35 + 0.65 * this.converge);
      const delta = want - this.headYaw;
      this.headYaw += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
      this.headPitch = damp(this.headPitch, 0, dt, 8);
      const lined = Math.abs(want - this.headYaw) < AIM_TOLERANCE;
      if (lined && this.cooldown <= 0 && this.state !== 'cooling' && this.converge > 0.75) {
        this._fire(this.target);
      }
      if (this.heat >= HEAT_CEILING) { this.state = 'cooling'; this.stateT = 0; }
    } else {
      this.quiet += dt;
      this.converge = damp(this.converge, 0, dt, 2.5);
      if (this.state !== 'scan') { this.state = 'scan'; this.stateT = 0; }
      this._idleLife(dt, ctx);
      if (!this.routine) {
        this.headYaw += this.scanDir * SCAN_SPEED * dt;
        if (this.headYaw > limit) { this.headYaw = limit; this.scanDir = -1; }
        if (this.headYaw < -limit) { this.headYaw = -limit; this.scanDir = 1; }
        this.headPitch = damp(this.headPitch, 0, dt, 4);
      }
    }
    if (this.state === 'cooling' && this.heat <= HEAT_RESUME) {
      this.state = this.target ? 'track' : 'scan';
      this.stateT = 0;
    }
    // an empty drum is changed the moment there is a gap in the work
    if (this.drum <= 0 && this.state !== 'reload') {
      this.state = 'reload';
      this.stateT = 0;
      // The rack on the flank is the READY rack, not the reserve: the reserve
      // is in the case the machine is standing on. So the two drums on the
      // flank drain over two changes and the third change brings a fresh pair
      // up from the base — which is why a rack you watched go empty is full
      // again the next time you look, rather than a gun that reloads out of
      // nowhere off an empty rack.
      this.spares = this.spares > 0 ? this.spares - 1 : RACK_SIZE;
    }
    // The perfusate goes down while it stands there, and once it is low the
    // machine will service itself at the first quiet moment.
    this.perfusion = Math.max(0.12, this.perfusion - dt / PERFUSE_LIFE);
    this._present(dt, ctx);
  }

  /**
   * Announce each beat of the deploy as it passes, exactly once.
   *
   * The sequence is SOUND-LED: the sixteen beats in BEATS each have their own
   * recipe in the audio manager, and what makes two seconds of unfolding read
   * as machinery rather than as an animation is that every visible motion has
   * a noise arriving with it. Guarded by an index rather than by a time test
   * per beat, so a frame long enough to skip one still fires it.
   */
  _deployBeats(dt) {
    const f = Math.min(1, this.stateT / DEPLOY_TIME);
    while (this._beat + 1 < BEATS.length && f >= BEATS[this._beat + 1].a) {
      this._beat++;
      const beat = BEATS[this._beat];
      this.events.emit('sentry:deploy:beat', {
        pos: this.position.clone(), beat: beat.id, kind: this.kind,
      });
      if (beat.id === 'spade') {
        // it really does go into the ground, so it really does throw dirt
        this.events.emit('impact', {
          pos: {
            x: this.position.x - Math.sin(this.yaw) * 0.24,
            y: this.position.y + 0.05,
            z: this.position.z - Math.cos(this.yaw) * 0.24,
          },
        });
      }
      if (beat.id === 'perfuse') {
        // the moment it stops being equipment
        this.pulseRate = PULSE.rest;
        this.pulseT = 0.9;
        this.events.emit('sentry:vessel', { pos: this.position.clone(), kind: 'prime' });
      }
      if (beat.id === 'ready') {
        this.events.emit('sentry:voice', { pos: this.position.clone(), phrase: 'station' });
        this.events.emit('subtitle', {
          text: `Mk II on station. Computing section ${this.subject.no} — ${this.subject.name}`,
        });
      }
    }
  }

  /**
   * Eased progress through every named beat of the deploy, as one record.
   *
   * Built in a single pass over the table rather than looked up per beat: the
   * presenter wants all sixteen every frame, and asking for them one at a time
   * turned a sixteen-element table into two hundred and fifty-six comparisons
   * a frame for no reason at all.
   */
  _stages() {
    const st = {};
    if (this.state !== 'deploy') {
      for (const b of BEATS) st[b.id] = 1;
      return st;
    }
    const f = Math.min(1, this.stateT / DEPLOY_TIME);
    for (const b of BEATS) st[b.id] = ease(sat((f - b.a) / (b.b - b.a)));
    return st;
  }

  /**
   * THE HANDSHAKE. Coming up beside an older machine, it says hello.
   *
   * Only once, only on deploy, and only if a Mk I is genuinely within a few
   * metres — so it is a thing a player finds by setting the two of them on the
   * same corner, which is exactly what a player does with two turrets.
   */
  _greetNeighbour(ctx) {
    if (!this._handshakeDue) return;
    const near = (ctx?.sentries ?? []).find((s) => s !== this && s.kind !== 'sentryTwo'
      && Math.hypot(s.position.x - this.position.x, s.position.z - this.position.z) < HANDSHAKE_RANGE);
    if (!near) return;
    this._handshakeDue = false;
    this._begin('handshake');
    this.events.emit('sentry:handshake', { pos: this.position.clone(), other: near });
  }

  /* ================================================================== *
   * THE IDLE LIFE                                                       *
   * ================================================================== */

  /**
   * How much attention the player is paying, and to WHAT.
   *
   * Two different easter eggs hang off this and they need different answers:
   * one wants "are they looking at this machine", the other wants "are they
   * looking INTO the jar", and the difference is about thirty centimetres of
   * aim at two metres' range. So both are measured against the vessel's own
   * world position rather than the entity's origin, and the tighter one simply
   * demands a tighter cone and a shorter range.
   */
  _attention(ctx) {
    const p = ctx?.player;
    if (!p?.alive || !p.lookDirection) return null;
    const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
    if (d > REGARD_RANGE + 1) return null;
    const v = this.vesselPoint();
    const eyeY = p.position.y + (p.eyeHeight ?? 1.6);
    const vx = v.x - p.position.x, vy = v.y - eyeY, vz = v.z - p.position.z;
    const len = Math.hypot(vx, vy, vz) || 1;
    const look = p.lookDirection();
    const dot = (look.x * vx + look.y * vy + look.z * vz) / len;
    // ...and whether they are stood in front of the doors or off to one side
    const rel = Math.atan2(p.position.x - this.position.x, p.position.z - this.position.z) - this.yaw;
    return { d, dot, front: Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel))) };
  }

  _idleLife(dt, ctx) {
    for (const k of ['saluteReady', 'regardReady', 'stareReady', 'startleReady', 'communeReady']) {
      if (this[k] > 0) this[k] -= dt;
    }

    if (this.routine) {
      this.routineT += dt;
      const done = this[`_run_${this.routine}`]?.(dt, ctx);
      if (done) { this.routine = null; this.routineT = 0; }
      return;
    }

    // THE WHISPER FIRST, because it is the one thing that interrupts. Only if
    // the player is near enough to witness it — a machine that startles alone
    // in an empty field is a state change nobody will ever observe.
    if (this._whisperHeard > 0 && this.startleReady <= 0) {
      const p = ctx?.player;
      if (p && Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z) < 26) {
        this._whisperHeard = 0;
        this.startleReady = STARTLE_COOLDOWN;
        // Onto a bearing chosen NOW, and chosen at random, because the point
        // is that there is nothing there. Anything derived from the world
        // would eventually be something.
        this._begin('startle', {
          _startleYaw: (Math.random() * 2 - 1) * TWO_ARC / 2 * 0.9, _startled: false,
        });
        return;
      }
    }

    const att = this._attention(ctx);
    if (att) {
      // peering into the glass, up close and dead on
      if (att.d < STARE_RANGE && att.dot > 0.965 && att.front < 1.0) {
        this._peered += dt;
        if (this._peered > 2.6 && this.stareReady <= 0) {
          this._peered = 0;
          this.stareReady = STARE_COOLDOWN;
          this._begin('stare');
          return;
        }
      } else this._peered = Math.max(0, this._peered - dt * 2);
      // ...and merely looking at it, from further off
      if (att.d < REGARD_RANGE && att.dot > 0.93) {
        this._watched += dt;
        if (this._watched > 2.2 && this.regardReady <= 0 && this.quiet > 6) {
          this._watched = 0;
          this.regardReady = REGARD_COOLDOWN;
          this._begin('regard');
          return;
        }
      } else this._watched = Math.max(0, this._watched - dt * 1.5);
    } else {
      this._watched = Math.max(0, this._watched - dt * 1.5);
      this._peered = Math.max(0, this._peered - dt * 2);
    }

    const p = ctx?.player;
    if (p?.alive && this.saluteReady <= 0 && this.quiet > 3) {
      const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
      if (d < SALUTE_RANGE && this.covers(p.position.x, p.position.z)) {
        this.sawPlayer += dt;
        if (this.sawPlayer > 1.5) {
          this._begin('salute');
          this.sawPlayer = 0;
          this.saluteReady = SALUTE_COOLDOWN;
          return;
        }
      } else {
        this.sawPlayer = Math.max(0, this.sawPlayer - dt * 2);
      }
    }

    // the bottle wants topping up, and it will not do it in front of company
    if (this.perfusion < PERFUSE_LOW && this.quiet > 5) { this._begin('service'); return; }
    // two of them, left alone together, eventually start talking
    if (this.communeReady <= 0 && this.quiet > 12 && this._startCommune(ctx)) return;

    if (this.quiet > DOZE_AFTER) { this._begin('doze'); return; }
    if (this.quiet > this.nextPolish) {
      this._begin('polish');
      this.nextPolish = this.quiet + POLISH_EVERY * (0.7 + Math.random() * 0.6);
      return;
    }
    if (this.quiet > this.nextSelfTest) {
      this._begin('selftest');
      this.nextSelfTest = this.quiet + SELFTEST_EVERY * (0.7 + Math.random() * 0.6);
    }
  }

  /**
   * Start a routine, and set up whatever it needs ONCE.
   *
   * Several of these pick a random bearing or a role when they begin, and
   * doing that inside the per-frame runner means re-rolling it every frame or
   * guarding it with a "have I started yet" test that is wrong the first time
   * the frame rate dips. The initialiser runs exactly once, here.
   */
  _begin(name, init = null) {
    this.routine = name;
    this.routineT = 0;
    this._lastSlot = -1;
    this._dreamSeg = -1;
    /**
     * AND CLEAR THE ONE-SHOTS, HERE, WHERE IT ACTUALLY HAPPENS.
     *
     * Each routine that fires a sound part-way through guards it with a flag,
     * and each of them used to clear that flag with a line reading
     * `if (f >= 1) this._saluted = false;` — sitting UNDERNEATH the routine's
     * own `if (f >= 1) return true;`. Unreachable, every one of them. The
     * visible symptom is nothing at all the first time and silence for ever
     * after: a machine salutes you once in its life, cuts exactly one tally
     * however long you leave it out, and grumbles quietly the second time you
     * annoy it. Clearing them at the START of a routine is the only place that
     * cannot be skipped, because a routine that never begins has nothing to
     * reset.
     */
    this._saluted = this._regarded = this._stared = false;
    this._startled = this._tapped = this._notched = this._grumbled = false;
    if (init) Object.assign(this, init);
  }

  /**
   * COMMUNE — find another Warden standing idle nearby, and start something.
   *
   * The initiator sets the other one going too, because a conversation with
   * one participant is a machine talking to itself. Both take a long cooldown
   * so it stays a thing you stumble on rather than a thing they do constantly,
   * and the second one is given the answering role so their lamps alternate
   * instead of both of them saying the same thing at once.
   */
  _startCommune(ctx) {
    const other = (ctx?.sentries ?? []).find((s) => s !== this && s.kind === 'sentryTwo'
      && !s.routine && !s.target && s.state === 'scan' && s.communeReady <= 0
      && Math.hypot(s.position.x - this.position.x, s.position.z - this.position.z) < COMMUNE_RANGE);
    if (!other) return false;
    this.communeReady = other.communeReady = COMMUNE_COOLDOWN;
    this._communeRole = 0;
    other._communeRole = 1;
    this._communeWith = other;
    other._communeWith = this;
    this._begin('commune');
    other._begin('commune');
    this.events.emit('sentry:commune', { pos: this.position.clone(), other: other.position.clone() });
    return true;
  }

  /** The first thing it does once it is standing: one sweep of the whole arc. */
  _run_boresight(dt) {
    const f = this.routineT / 2.2;
    if (f >= 1) return true;
    const limit = TWO_ARC / 2;
    // out to one limit, across to the other, and back to the middle
    const s = f < 0.3 ? f / 0.3 : f < 0.75 ? 1 - (f - 0.3) / 0.45 * 2 : -1 + (f - 0.75) / 0.25;
    this.headYaw = s * limit;
    this.headPitch = Math.sin(f * Math.PI) * 0.07;
    this._convergeWant = 0.3 + 0.5 * Math.abs(Math.sin(f * Math.PI * 3));
    this._lampMode = 'chase';
    this._agitate = 0.25;
    return false;
  }

  /** Lamps chase, the bar sweeps end to end, the arm runs its travel. ~3.6 s. */
  _run_selftest(dt) {
    const f = this.routineT / 3.6;
    if (f >= 1) return true;
    const k = pulse(f, 0.12, 0.2);
    this.headYaw = damp(this.headYaw, 0, dt, 2.2);
    this.headPitch = Math.sin(f * Math.PI * 2) * 0.10 * k;
    this._lampMode = 'chase';
    this._convergeWant = 0.5 + 0.5 * Math.sin(f * Math.PI * 4);
    // the arm runs its whole travel once: round, out, and back
    const swing = Math.abs(Math.sin(f * Math.PI * 2));
    this._armWant = {
      yaw: Math.sin(f * Math.PI * 2) * 1.5 * k,
      shoulder: 0.85 * swing * k,
      elbow: 0.90 * swing * k,
      wrist: Math.sin(f * Math.PI * 6) * 0.4 * k,
      claw: Math.abs(Math.sin(f * Math.PI * 5)) * k,
    };
    this._legShake = Math.sin(f * Math.PI * 9) * 0.022 * k;
    return false;
  }

  /** Nods off. The barrels sink, the eye half shuts, and the pulse falls. */
  _run_doze(dt, ctx) {
    const settle = Math.min(1, this.routineT / 4);
    this.headPitch = damp(this.headPitch, -0.30 * settle, dt, 1.3);
    this.headYaw += this.scanDir * SCAN_SPEED * 0.1 * dt;
    const limit = TWO_ARC / 2;
    if (this.headYaw > limit) { this.headYaw = limit; this.scanDir = -1; }
    if (this.headYaw < -limit) { this.headYaw = -limit; this.scanDir = 1; }
    this._lampMode = 'heartbeat';
    this._convergeWant = 0.05;
    this._pulseWant = PULSE.doze;
    this._agitate = 0;
    this._lidWant = 0.55 * settle;
    // the arm sags on its post, the way a hand goes slack
    this._armWant = {
      yaw: 0.15 * settle, shoulder: -0.18 * settle, elbow: -0.20 * settle,
      wrist: 0.2 * settle, claw: -0.05 * settle,
    };
    // it snores: a puff off the relief valve every few seconds
    if (Math.sin(this.routineT * 0.55) > 0.995) this._sigh = 1;
    if (this._disturbed(ctx)) return true;
    // ...and if nothing comes for long enough, it starts dreaming
    if (this.routineT > DREAM_AFTER) this._begin('dream');
    return false;
  }

  /**
   * Has somebody walked right up to it while it was asleep?
   *
   * Without this, doze and dream only ever end on a target — so a machine that
   * has been quiet for eighty seconds can never be woken by the one person who
   * would want to wake it, and every routine that answers the player is
   * unreachable for the rest of the run. Close enough to touch is close enough
   * to notice.
   */
  _disturbed(ctx) {
    const p = ctx?.player;
    if (!p?.alive) return false;
    if (Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z) > 3.2) return false;
    this.quiet = 0;
    this.events.emit('sentry:wake', { pos: this.position.clone(), kind: this.kind });
    return true;
  }

  /**
   * DREAM.
   *
   * This is the one. Everything else on this machine is a machine doing
   * machine things with a strange component inside it; this is the component
   * doing something the machine has no instruction for. The pulse goes to a
   * fast irregular rhythm that is unmistakably REM, the eye shuts right over
   * and flickers behind the lid, the barrels twitch onto bearings with nothing
   * on them — and the oscillograph, which has written nothing but a trace
   * since the day it was built, writes a word.
   *
   * It runs until something turns up, and it will happily run for minutes. A
   * player who leaves one on a quiet corner and comes back is the audience.
   */
  _run_dream(dt, ctx) {
    if (this._disturbed(ctx)) return true;
    const t = this.routineT;
    this._lampMode = 'dream';
    this._pulseWant = PULSE.dream;
    this._lidWant = 1;
    this._convergeWant = 0.15 + 0.35 * Math.sin(t * 0.7);
    // the irregular part: the rate itself wanders, which is what makes it
    // read as a rhythm rather than as a faster metronome
    this._pulseJitter = 0.55;
    this._agitate = 0.72 + Math.sin(t * 1.7) * 0.25;
    // it looks at things that are not there, in little jerks, then holds
    const seg = Math.floor(t / 3.4);
    if (seg !== this._dreamSeg) {
      this._dreamSeg = seg;
      this._dreamYaw = (Math.random() * 2 - 1) * TWO_ARC / 2 * 0.8;
      this._dreamPitch = (Math.random() - 0.35) * 0.3;
      // once in a while the whole machine says something it should not be
      // able to say — and once in a while, the paper says it instead
      if (seg > 0 && Math.random() < 0.45) {
        this.events.emit('sentry:voice', { pos: this.position.clone(), phrase: 'dream' });
      }
      if (seg > 0 && Math.random() < 0.5) this._oscWord = 2.6;
    }
    this.headYaw = damp(this.headYaw, this._dreamYaw ?? 0, dt, 3.2);
    this.headPitch = damp(this.headPitch, this._dreamPitch ?? -0.2, dt, 2.4);
    this._armWant = {
      yaw: Math.sin(t * 0.9) * 0.25, shoulder: -0.1, elbow: -0.15,
      wrist: Math.sin(t * 2.3) * 0.3, claw: 0,
    };
    // and it is looking around in there, too, at whatever it is seeing
    this._brainWant = this.brainRest + Math.sin(t * 0.62) * 0.55;
    if (Math.sin(t * 0.9) > 0.994) this._sigh = 1;
    return false;      // only a target, or a player, ends this
  }

  /**
   * SALUTE — it tips the rangefinder bar at you, the way a man tips a hat.
   *
   * The Mk I puts its barrel up. This one has a brim, so it uses it: the bar
   * rolls forward and back while the spotting lamp blinks twice. It is the
   * single most human thing the GUN does, and it is only ever for the player.
   */
  _run_salute(dt, ctx) {
    const f = this.routineT / 2.5;
    if (f >= 1) return true;
    const p = ctx?.player;
    if (p) {
      const want = Math.max(-TWO_ARC / 2, Math.min(TWO_ARC / 2, this._bearingTo(p)));
      this.headYaw = damp(this.headYaw, want, dt, 4);
    }
    const tip = pulse(f, 0.3, 0.35);
    this._barTip = tip * 0.55;                 // the brim coming down
    this.headPitch = tip * 0.12;
    this._lampMode = 'friendly';
    this._convergeWant = 0.85;
    this._pulseWant = PULSE.rest;
    // and the arm comes up with it, unfolding out to the side like a wave
    this._armWant = { yaw: -0.7 * tip, shoulder: 0.85 * tip, elbow: 1.25 * tip, wrist: 0, claw: 0.5 * tip };
    if (f > 0.22 && !this._saluted) {
      this._saluted = true;
      this.events.emit('sentry:salute', { pos: this.position.clone(), kind: this.kind });
    }
    return false;
  }

  /**
   * REGARD — the one where it does not do the charming thing.
   *
   * The salute is the machine acknowledging a person. This is the person
   * acknowledging a person, and the whole design of it is ABSENCE: the lamps
   * go out, the scan stops, the barrels stop moving, and the only things still
   * happening are a pulse climbing from sixty-eight to a hundred and fourteen
   * and a needle that has stopped drawing a clean wave. Three and a half
   * seconds of a gun looking at you and doing nothing at all.
   *
   * Then it snaps out of it and runs a self-test, which is a machine's way of
   * clearing its throat, and that recovery is what sells the whole thing: it
   * did not mean to do that, and now it is pretending it did not.
   */
  _run_regard(dt, ctx) {
    const f = this.routineT / 3.6;
    if (f >= 1) { this._begin('selftest'); return false; }
    const p = ctx?.player;
    if (p) {
      const want = Math.max(-TWO_ARC / 2, Math.min(TWO_ARC / 2, this._bearingTo(p)));
      this.headYaw = damp(this.headYaw, want, dt, f < 0.25 ? 5 : 0.6);
    }
    this.headPitch = damp(this.headPitch, -0.06, dt, 3);
    this._lampMode = 'dark';
    this._convergeWant = 1;
    this._pulseWant = PULSE.rest + (PULSE.regard - PULSE.rest) * Math.min(1, f * 1.6);
    this._agitate = 0.35 + f * 0.4;
    this._eyeWant = 0.05;
    this._armWant = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0, claw: 0 };
    if (f > 0.12 && !this._regarded) {
      this._regarded = true;
      this.events.emit('sentry:voice', { pos: this.position.clone(), phrase: 'query' });
    }
    return false;
  }

  /**
   * STARE — you looked into the jar, and it looked back.
   *
   * The only animation on this machine that moves the ORGAN rather than the
   * hardware: the brain rotates in its cradle, against six platinum pins that
   * are supposed to be holding it still, until it is facing the glass. It
   * holds there, the pulse drops to almost nothing, and then there is one
   * single hard beat and it turns back. The gun above it never moves and never
   * acknowledges any of it.
   */
  _run_stare(dt, ctx) {
    const f = this.routineT / 4.4;
    if (f >= 1) return true;
    const p = ctx?.player;
    let want = 0;
    if (p) {
      const rel = Math.atan2(p.position.x - this.position.x, p.position.z - this.position.z) - this.yaw;
      want = Math.max(-1.2, Math.min(1.2, Math.atan2(Math.sin(rel), Math.cos(rel))));
    }
    // out slowly, hold, and back — the hold is most of it
    const turn = f < 0.35 ? ease(f / 0.35) : f < 0.78 ? 1 : 1 - ease((f - 0.78) / 0.22);
    this._brainWant = this.brainRest + (want - this.brainRest) * turn;
    // The gun above does not move and is not told to: with a routine running,
    // the ordinary scan in update() is skipped, so holding still is the
    // default and saying so would only be a line that does nothing.
    this._lampMode = 'dark';
    this._eyeWant = 0.03;
    // it all but stops, and then there is one beat you feel through the floor
    this._pulseWant = f < 0.75 ? 0.34 : 1.1;
    this._agitate = f < 0.75 ? 0.1 : 0.9;
    if (f > 0.10 && !this._stared) {
      this._stared = true;
      this.events.emit('sentry:vessel', { pos: this.position.clone(), kind: 'turn' });
    }
    if (f > 0.76 && this._stared) {
      this._stared = false;
      this.pulseT = 0;                                        // the hard one
      this.events.emit('sentry:pulse', { pos: this.position.clone(), rate: 0.5, strength: 1.9 });
    }
    return false;
  }

  /**
   * STARTLE — the town whispered, and the gun heard it.
   *
   * The player gets a whisper on the soundtrack. The machine gets one too, and
   * it does the thing an animal does: everything stops, it swings onto a
   * bearing there is nothing at, the optics converge hard on empty street, and
   * it stays there until it has decided nothing is coming. The lamps go out for
   * the first half-second, which is the tell that this is not a target.
   */
  _run_startle(dt) {
    const f = this.routineT / 2.6;
    if (f >= 1) return true;
    this.headYaw = damp(this.headYaw, this._startleYaw, dt, f < 0.3 ? 9 : 1.2);
    this.headPitch = damp(this.headPitch, 0.05, dt, 6);
    this._lampMode = f < 0.22 ? 'dark' : 'alarm';
    this._convergeWant = 1;
    this._pulseWant = PULSE.fear * (1 - f * 0.45);
    this._pulseJitter = 0.3;
    this._agitate = 1 - f * 0.5;
    this._legShake = Math.sin(f * Math.PI * 22) * 0.014 * pulse(f, 0.06, 0.5);
    if (f > 0.05 && !this._startled) {
      this._startled = true;
      this.events.emit('sentry:vessel', { pos: this.position.clone(), kind: 'startle' });
    }
    return false;
  }

  /** COMMUNE — two of them, on the same corner, in lamps. */
  _run_commune(dt, ctx) {
    const f = this.routineT / 5.0;
    if (f >= 1) { this._communeWith = null; return true; }
    const other = this._communeWith;
    if (other && !other.toRemove) {
      const rel = Math.atan2(other.position.x - this.position.x, other.position.z - this.position.z) - this.yaw;
      const want = Math.max(-TWO_ARC / 2, Math.min(TWO_ARC / 2, Math.atan2(Math.sin(rel), Math.cos(rel))));
      this.headYaw = damp(this.headYaw, want, dt, 2.6);
    }
    // they take turns: one talks on the odd half-seconds, the other on the even
    const slot = Math.floor(f * 10) % 2;
    const mine = slot === (this._communeRole ?? 0);
    this._lampMode = mine ? 'talk' : 'listen';
    this._convergeWant = 0.6;
    this._pulseWant = PULSE.rest * 1.15;
    this._agitate = mine ? 0.5 : 0.15;
    this._barTip = mine ? 0.12 : 0;
    if (mine && slot !== this._lastSlot) {
      this._lastSlot = slot;
      this.events.emit('sentry:voice', { pos: this.position.clone(), phrase: 'greet' });
    } else if (!mine) this._lastSlot = slot;
    return false;
  }

  /**
   * SERVICE — the arm reaches down the front of its own body and taps the
   * bottle, twice, the way you tap a gauge you do not trust.
   *
   * Which is a completely mundane piece of maintenance, and that is the point:
   * it is the machine looking after the person inside it, entirely as a matter
   * of routine, and it never once treats it as anything else.
   */
  _run_service(dt) {
    const f = this.routineT / 3.0;
    if (f >= 1) { this.perfusion = Math.min(1, this.perfusion + 0.55); return true; }
    const k = pulse(f, 0.22, 0.28);
    this.headYaw = damp(this.headYaw, -0.55, dt, 2.2);
    this.headPitch = damp(this.headPitch, -0.14, dt, 2);
    // down the front-left, where the plant is
    this._armWant = {
      yaw: -1.55 * k,
      shoulder: 1.35 * k,
      elbow: 0.55 * k,
      wrist: Math.sin(f * Math.PI * 10) * 0.55 * k,
      claw: 0.35 * k,
    };
    this._lampMode = 'load';
    this._pulseWant = PULSE.rest * 0.85;
    this._pulseJitter = 0.45;                 // the pressure is not steady
    this._agitate = 0.4;
    if (f > 0.42 && !this._tapped) {
      this._tapped = true;
      this.events.emit('sentry:vessel', { pos: this.position.clone(), kind: 'tap' });
      this.events.emit('sentry:voice', { pos: this.position.clone(), phrase: 'grief' });
    }
    return false;
  }

  /**
   * TALLY — the arm reaches back and cuts another mark into the data plate.
   *
   * The mark is not a gesture: the plate's texture is redrawn with one more
   * stroke on it and it stays there. Leave one somewhere busy, come back, and
   * you can read off what it has been doing from six feet away — and past a
   * hundred and fifty of them, what you read is not a number.
   */
  _run_tally(dt) {
    const f = this.routineT / 1.7;
    if (f >= 1) return true;
    const k = pulse(f, 0.25, 0.3);
    this.headYaw = damp(this.headYaw, 0, dt, 2.5);
    // right round to the plate at the back, three short strokes, and back
    this._armWant = {
      yaw: 2.5 * k,
      shoulder: 0.60 * k,
      elbow: 0.55 * k,
      wrist: Math.sin(f * Math.PI * 9) * 0.5 * k,
      claw: 0.85 * k,
    };
    this._lampMode = 'chase';
    this._agitate = this.kills >= 150 ? 0.85 : 0.3;
    if (f > 0.45 && !this._notched) {
      this._notched = true;
      this.rig.parts.setTally?.(this.kills);
      this.events.emit('sentry:tally', { pos: this.position.clone(), kills: this.kills });
    }
    return false;
  }

  /** POLISH — the rag comes out and the rangefinder glass gets a wipe. */
  _run_polish(dt) {
    const f = this.routineT / 3.4;
    if (f >= 1) return true;
    const k = pulse(f, 0.2, 0.25);
    this.headYaw = damp(this.headYaw, 0, dt, 2);
    // up and over to the rangefinder glass, and the rag comes out
    this._armWant = {
      yaw: -1.25 * k,
      shoulder: 1.05 * k,
      elbow: 1.15 * k,
      wrist: Math.sin(f * Math.PI * 8) * 0.75 * k,   // the wiping itself
      claw: 0.4,
      rag: true,
    };
    this._convergeWant = 0.15 + 0.5 * Math.abs(Math.sin(f * Math.PI * 4));
    this._lampMode = 'idle';
    return false;
  }

  /** Set down for the third time in a hurry: the spade goes in hard. */
  _run_grumble(dt) {
    const f = this.routineT / 1.8;
    if (f >= 1) return true;
    const k = pulse(f, 0.15, 0.3);
    this.headYaw = Math.sin(f * Math.PI * 6) * 0.38 * k;
    this.headPitch = -0.09 * k;
    this._spadeStamp = Math.abs(Math.sin(f * Math.PI * 3)) * 0.045 * k;
    this._legShake = Math.sin(f * Math.PI * 14) * 0.03 * k;
    this._lampMode = 'cross';
    this._pulseWant = PULSE.work;
    this._agitate = 0.8;
    if (f > 0.2 && !this._grumbled) {
      this._grumbled = true;
      this.events.emit('sentry:voice', { pos: this.position.clone(), phrase: 'grief' });
    }
    return false;
  }

  /** HANDSHAKE — a dip of the bar at the older machine on the same corner. */
  _run_handshake(dt) {
    const f = this.routineT / 1.9;
    if (f >= 1) return true;
    const k = pulse(f, 0.25, 0.3);
    this._barTip = k * 0.4;
    this._armWant = { yaw: -0.7 * k, shoulder: 0.75 * k, elbow: 1.0 * k, wrist: 0.3 * k, claw: 0.9 * k };
    this._lampMode = 'friendly';
    return false;
  }

  /**
   * ONE PULL: TWO ROUNDS, one out of each barrel, at the same instant.
   *
   * Resolved directly against the tracked target rather than as two rays, for
   * the same reason the Mk I does it: the head is proven lined up and the line
   * proven clear, so re-tracing would only invent ways to miss something it
   * can plainly see. Each round goes through the ordinary takeDamage pipeline,
   * so a Mk II kill scores, drops and sounds exactly like one of yours.
   */
  _fire(target) {
    this.cooldown = TWO_INTERVAL;
    this.flashT = MUZZLE_FLASH;
    this.recoil = 1;
    this.bolt = 1;
    this.shellT = 0.44;
    this.heat = Math.min(HEAT_CEILING, this.heat + HEAT_PER_PULL);
    this.shotsFired++;
    this.roundsFired += TWO_BARRELS;
    this.drum--;
    this.drumSpin += 1;

    const dx = target.position.x - this.position.x, dz = target.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / d, z: dz / d };
    for (let i = 0; i < TWO_BARRELS; i++) {
      const wasAlive = target.state !== 'dead';
      target.takeDamage(TWO_DAMAGE, dir, 0);
      if (wasAlive && target.state === 'dead') {
        this.kills++;
        if (this.kills % TALLY_EVERY === 0) this._tallyOwed = true;
        break;                      // the second round of a pair does not
      }                             // kill something already down
    }
    this.events.emit('sentry:fire', {
      pos: this.muzzlePoint(), yaw: this.yaw + this.headYaw, kind: this.kind, barrels: TWO_BARRELS,
    });
  }

  /* ================================================================== *
   * PRESENT — push the state onto the rig                               *
   * ================================================================== */

  /**
   * THE VESSEL, once per frame.
   *
   * Split out of _present because it is a self-contained little organ system
   * and because every one of the routines above talks to it through the same
   * three fields — _pulseWant, _pulseJitter and _agitate — rather than by
   * reaching into the rig. What the routines say is how the thing FEELS; what
   * happens to the glass, the pump, the bubbles, the gauge and the paper is
   * decided here, once, in one place.
   */
  _vessel(dt, now) {
    const p = this.rig.parts;

    // the rate this state wants, eased toward rather than jumped to — a heart
    // that changed rate instantly would read as a dial being turned
    const base = this._pulseWant ?? (
      this.state === 'deploy' ? (this._beat >= 11 ? PULSE.rest : PULSE.dead)
        : this.state === 'cooling' ? PULSE.hot
          : this.state === 'reload' ? PULSE.work
            : this.target ? PULSE.fight : PULSE.rest);
    this._pulseWant = null;
    const jitter = this._pulseJitter ?? 0;
    this._pulseJitter = null;
    this.pulseRate = damp(this.pulseRate, base, dt, 1.6);
    // firing drives it up over and above whatever the state asked for
    // Firing drives it up over and above whatever the state asked for: the
    // recoil term IS the flinch, one per pull, decaying over about a sixth of
    // a second — so a machine in a firefight has a visibly racing heart.
    const drive = this.pulseRate * (1 + Math.min(0.55, this.recoil * 0.4))
      * (1 + jitter * Math.sin(now * 0.00083) * Math.sin(now * 0.00031));
    this._perfStroke = Math.max(0, (this._perfStroke ?? 0) - dt * 2.6);
    this.pulseT += dt * Math.max(0, drive);
    if (this.pulseT >= 1) {
      this.pulseT -= 1;
      this._perfStroke = 1;                 // armed after the decay, or it
      if (drive > 0.05) {                   // would die on the frame it fired
        this.events.emit('sentry:pulse', {
          pos: this.position.clone(), rate: drive, strength: Math.min(1.4, 0.6 + drive * 0.35),
        });
      }
    }
    const b = drive > 0.02 ? heartbeat(this.pulseT) : 0;

    // THE ORGAN. It swells on the systole and settles, and it nods forward a
    // little as it does — which is the difference between a beating thing and
    // a pulsing light behind a bottle.
    const swell = 1 + b * 0.052;
    p.brain.scale.set(swell, swell * 0.985 + 0.015, swell);
    p.brain.position.y = b * 0.004;
    p.brain.rotation.x = b * 0.05;
    // ...and it drifts, slowly, unless something has told it where to look
    const drift = Math.sin(now * 0.00011 + this.brainRest * 9) * 0.10;
    this.brainYaw = damp(this.brainYaw, this._brainWant ?? (this.brainRest + drift), dt, 1.4);
    this._brainWant = null;
    p.brainTurn.rotation.y = this.brainYaw;

    // the perfusate: brighter on the beat, and dimmer as the bottle empties
    const lit = (0.34 + b * 0.5) * (0.45 + 0.55 * this.perfusion);
    p.fluidMat.emissive.setRGB(lit * 0.10, lit * 0.42, lit * 0.28);
    p.fluidMat.opacity = 0.26 + b * 0.06;
    p.bottleFill.scale.y = Math.max(0.06, this.perfusion);

    // the pump: one stroke per beat, and the gauge kicks with it
    const stroke = this._perfStroke ?? 0;
    p.pumpRod.position.y = 0.052 - stroke * 0.020;
    p.gauge.rotation.z = -0.9 + b * 1.5 + (1 - this.perfusion) * 0.4;

    // the bubbles, climbing out of the inlet and wobbling as they go
    for (const bb of p.bubbles) {
      const rate = 0.16 + drive * 0.10;
      const t = ((now * 0.001 * rate) + bb.seed) % 1;
      const r = 0.018 + bb.seed * 0.030;
      const a = bb.seed * 7 + t * 2.4;
      bb.mesh.visible = drive > 0.03;
      bb.mesh.position.set(Math.sin(a) * r, -0.070 + t * 0.128, Math.cos(a) * r);
      bb.mesh.scale.setScalar(0.6 + t * 0.9 + b * 0.4);
      bb.mesh.material.opacity = 0.45 * Math.min(1, (1 - t) * 3) * Math.min(1, t * 6);
    }

    // THE PAPER. Twenty-four columns a second, whatever the frame rate, so the
    // trace scrolls at the same speed on every machine and a slow frame does
    // not draw one fat column instead of three thin ones.
    const agit = this._agitate ?? (this.target ? 0.45 : 0.12);
    this._agitate = null;
    this.agitation = damp(this.agitation, agit, dt, 3);
    if (this._oscWord > 0) {
      this._oscWord -= dt;
      if (!this._oscWordDrawn) { p.osc.word(this.subject.word); this._oscWordDrawn = true; }
      p.osc.needle.rotation.z = Math.sin(now * 0.004) * 0.05;
    } else if (this.state !== 'deploy' || this._beat >= 12) {
      // ...and nothing is written at all until the thirteenth beat lowers the
      // needle onto the paper. A trace that starts before the pen is down is a
      // record of a machine that was not switched on yet.
      this._oscWordDrawn = false;
      this._oscT += dt;
      const step = 1 / 24;
      let guard = 0;
      while (this._oscT >= step && guard++ < 6) {
        this._oscT -= step;
        const noise = (Math.random() - 0.5) * this.agitation * 1.1;
        p.osc.push(Math.max(-1, Math.min(1, b * 0.85 - 0.12 + noise)));
      }
      p.osc.needle.rotation.z = (b * 0.85 - 0.12) * 0.42;
    }
  }

  _present(dt, ctx) {
    const p = this.rig.parts;
    const now = performance.now();

    if (this._tallyOwed && !this.target && !this.routine && this.state === 'scan') {
      this._tallyOwed = false;
      this._begin('tally');
    }

    /* ---- the sixteen beats, as sixteen numbers ---- */
    const st = this._stages();

    /* ---- the undercarriage: latches, legs, jacks, spade ---- */
    const shake = this._legShake || 0;
    for (const leg of p.legs) {
      leg.hip.rotation.x = -0.05 + (leg.splay + 0.05) * st.splay + shake;
      leg.knee.rotation.x = leg.fold * st.knee;
      leg.pad.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x);
      leg.ram.position.y = -0.122 - st.splay * 0.032;
      leg.ram.scale.y = 1 + st.splay * 0.35;
      // the jack screws down last, and it TURNS as it does — the thread is
      // right there, so a jack that extended without turning would be a lie
      leg.jack.position.y = -0.120 - st.jack * 0.038;
      leg.jack.rotation.y = st.jack * 7.5;
    }
    this._legShake = 0;
    for (const l of p.latches) l.node.rotation.x = -1.35 * st.latch;
    // the spade drives down its guide, and a grumble stamps it in again
    p.spade.position.y = p.spadeUp + (p.spadeDown - p.spadeUp) * st.spade - (this._spadeStamp || 0);
    this._spadeStamp = 0;

    /**
     * LEVELLING, AND THE ROCK IT SITS IN.
     *
     * Beat six is the jacks making a differential correction, and the only way
     * to show a machine levelling itself is to let it be UNLEVEL first: it
     * lands a couple of degrees out, the jacks argue about it, and it settles.
     * The same two channels then carry every other reason this thing is not
     * perfectly upright for the rest of its life — the kick when both barrels
     * go off against a spade in soft ground, and the shudder of a grumble.
     */
    const settling = (1 - st.level) * st.jack;
    this._tiltX = damp(this._tiltX ?? 0,
      settling * 0.045 * Math.sin(this.stateT * 15) - this.recoil * 0.012, dt, 12);
    this._tiltZ = damp(this._tiltZ ?? 0, settling * 0.055 * Math.cos(this.stateT * 11), dt, 12);
    this.mesh.rotation.set(this._tiltX, this.yaw, this._tiltZ);

    /* ---- the lift: the posts, the kingpin, the loom, the deck ---- */
    const deckY = p.deckFold + (p.deckY - p.deckFold) * st.rise;
    p.body.position.y = deckY;
    layoutTwoLift(p, deckY, this.headYaw);

    /* ---- the ring: yaw, pinion, drag chain, and the counterweight lag ---- */
    const lastYaw = this._lastHeadYaw ?? this.headYaw;
    p.head.rotation.y = this.headYaw;
    p.pinion.rotation.y -= (this.headYaw - lastYaw) * (34 / 8);
    this._lastHeadYaw = this.headYaw;
    // The drag chain lies in the gutter and pays out as the head turns: the
    // links bunch behind it and open up in front, which is what a real chain
    // in a real gutter does and what makes the 240° limit legible.
    const span = TWO_ARC * 0.5;
    for (const link of p.chain) {
      const t = link.i / (p.chain.length - 1);
      const a = -span + t * (span + this.headYaw + span) * 0.5;
      link.node.position.set(Math.sin(a) * 0.148, 0.006, Math.cos(a) * 0.148);
      link.node.rotation.y = a;
    }
    // the mass behind the breech lags the slew, then settles
    const swing = this.headYaw - (this._cwLast ?? this.headYaw);
    this._cwLast = this.headYaw;
    this._cwV = (this._cwV ?? 0) * 0.88 - swing * 2.2;
    p.counterweight.rotation.y = Math.max(-0.28, Math.min(0.28, this._cwV));
    p.cradle.rotation.x = -this.headPitch - this.recoil * 0.05;

    /* ---- the gun: clamps off, into battery, wings out, then it fires ---- */
    for (const c of p.clamps) c.node.rotation.z = -c.sx * 1.5 * st.clamp;
    p.cradle.position.z = p.stowZ + (p.batteryZ - p.stowZ) * st.battery - this.recoil * 0.012;
    for (const w of p.wings) w.node.rotation.y = w.sx * 0.55 * st.wings;
    p.rackArm.rotation.z = p.rackIn + (p.rackOut - p.rackIn) * st.wings;
    for (let i = 0; i < p.barrels.length; i++) {
      const b = p.barrels[i];
      b.group.position.z = b.home - this.recoil * 0.05;
      b.bolt.position.z = b.boltZ - this.bolt * 0.06;
      b.flash.visible = this.flashT > 0;
      if (b.flash.visible) {
        // Two of these go off at once, a hand's width apart, and they are
        // additive — so each one has to be modest or the pair together simply
        // paints the front of the machine out.
        b.flash.scale.setScalar(0.62 + Math.random() * 0.45);
        b.flash.rotation.z = Math.random() * Math.PI;
      }
    }
    // the charging handle: drawn once at beat fifteen, and again on a drum
    // change — the beat that says the gun has been made ready.
    const chargePull = this.state === 'deploy'
      ? Math.sin(st.charge * Math.PI)
      : this.state === 'reload'
        ? Math.max(0, Math.sin(Math.max(0, (this.stateT / RELOAD_TIME - 0.7)) / 0.3 * Math.PI))
        : 0;
    p.charge.position.z = p.chargeZ - chargePull * 0.07;
    // a case out of each side, thrown clear and falling away
    for (let i = 0; i < p.shells.length; i++) {
      const s = p.shells[i];
      s.mesh.visible = this.shellT > 0;
      if (!s.mesh.visible) continue;
      const t = 1 - this.shellT / 0.44;
      s.mesh.position.set(s.side * (0.098 + t * 0.15), 0.014 + t * 0.10 - t * t * 0.28, -0.02 - t * 0.05);
      s.mesh.rotation.set(t * 9, t * 5, t * 7 * s.side);
    }

    /* ---- the feed: the drum turns as it empties, and gets changed ---- */
    p.drum.rotation.y = -this.drumSpin * 0.24;
    // the drum sinks and lifts as the arm swaps it; the rack empties with it
    const rel = this.state === 'reload' ? this.stateT / RELOAD_TIME : 0;
    p.drum.position.y = 0.098 + (rel > 0 ? Math.sin(rel * Math.PI) * 0.055 : 0);
    p.drum.rotation.z = rel > 0 ? Math.sin(rel * Math.PI) * 0.5 : 0;
    for (let i = 0; i < p.rack.length; i++) p.rack[i].visible = i < this.spares;

    /* ---- the loader arm ---- */
    // The post stands up during the deploy; below that, while a drum is being
    // changed the arm HAS to be doing it, and the idle routines only get the
    // arm when there is nothing else for it.
    p.arm.post.scale.y = 0.18 + 0.82 * st.wings;
    let want = this._armWant;
    if (this.state === 'reload') {
      // One continuous move, and it is readable as one: round to the rack,
      // stoop, take a drum, come back over the top, and set it on the feed.
      const f = rel;
      const out = Math.sin(Math.min(1, f * 2) * Math.PI * 0.5);       // going for it
      const back = Math.max(0, (f - 0.5) * 2);                         // coming back
      want = {
        yaw: 2.15 * out - 2.90 * back * out,
        shoulder: 0.75 * out - 0.35 * back,
        elbow: 1.05 * out - 0.45 * back,
        wrist: 0.4 * Math.sin(f * Math.PI * 2),
        claw: f > 0.35 && f < 0.85 ? 0.9 : 0,
      };
    }
    this._armWant = null;
    const a = this._armPose;
    const rate = this.state === 'reload' ? 12 : 6;
    // A routine's pose is a DEPARTURE from the rest pose, not from zero — the
    // routines are all written as "how far from folded", which is why they can
    // be authored as small numbers and still read as whole gestures.
    a.yaw = damp(a.yaw, TWO_ARM_REST.yaw + (want?.yaw ?? 0), dt, rate);
    a.shoulder = damp(a.shoulder, TWO_ARM_REST.shoulder + (want?.shoulder ?? 0), dt, rate);
    a.elbow = damp(a.elbow, TWO_ARM_REST.elbow + (want?.elbow ?? 0), dt, rate);
    a.wrist = damp(a.wrist, TWO_ARM_REST.wrist + (want?.wrist ?? 0), dt, rate);
    a.claw = damp(a.claw, TWO_ARM_REST.claw + (want?.claw ?? 0), dt, rate);
    p.arm.base.rotation.y = a.yaw;
    p.arm.shoulder.rotation.x = a.shoulder;
    p.arm.elbow.rotation.x = a.elbow;
    p.arm.wrist.rotation.z = a.wrist;
    p.arm.clawL.rotation.z = a.claw * 0.5;
    p.arm.clawR.rotation.z = -a.claw * 0.5;
    p.arm.rag.visible = !!want?.rag;

    /* ---- the rangefinder: it extends on deploy and converges on a target ---- */
    p.rf.bar.scale.x = 0.30 + st.range * 0.70;
    p.rf.capL.rotation.x = p.rf.capR.rotation.x = 2.3 * st.range;
    const conv = this._convergeWant ?? this.converge;
    this._convergeWant = null;
    this._conv = damp(this._conv ?? 0, conv, dt, 8);
    // the two prism heads toe IN as it converges — the optical tell
    p.rf.headL.rotation.y = this._conv * 0.42;
    p.rf.headR.rotation.y = -this._conv * 0.42;
    // and the bar tips forward when it is greeting somebody
    p.rf.bar.rotation.x = (this._barTip || 0);
    this._barTip = damp(this._barTip || 0, 0, dt, 5);

    /* ---- the vessel, and the thing in it ---- */
    for (const [k, leaf] of Object.entries(p.doors)) {
      leaf.rotation.y = (k === 'L' ? -p.doorOpen : p.doorOpen) * st.shutter;
    }
    p.crown.position.y = 0.072 - 0.028 * st.cortex;
    this._vessel(dt, now);

    /* ---- heat: the valve lifts, the louvres crack, and it boils over ---- */
    const h = this.heat;
    p.jacketMat.emissive.setRGB(h * h * 0.55, h * h * 0.18, h * h * 0.06);
    for (let i = 0; i < p.louvres.length; i++) {
      p.louvres[i].rotation.x = h * (0.5 + i * 0.06);
      p.louvres[i].position.z = 0.008 + h * 0.010;
    }
    // the chimney cowl turns whenever it is thinking, and faster when it is
    // working — the one thing on it that never stops while the lamps are lit
    p.cowl.rotation.y += dt * (0.9 + this.pulseRate * 1.7 + h * 3.5);
    const boiling = h > 0.55 || this._sigh > 0;
    p.valve.rotation.z = (h > 0.55 ? (h - 0.55) * 0.9 : 0) + (this._sigh ? 0.5 : 0);
    for (const s of p.steam) {
      const life = ((now * 0.0007 + s.i * 0.25) % 1);
      const on = boiling ? Math.max(0, h - 0.5) * 2 + (this._sigh || 0) : 0;
      s.mesh.visible = on > 0.02;
      if (!s.mesh.visible) continue;
      s.mesh.position.set(-0.02, 0.055 + life * 0.16, life * 0.02);
      s.mesh.scale.setScalar(0.5 + life * 1.6);
      s.mesh.material.opacity = Math.max(0, (1 - life) * 0.5 * Math.min(1, on));
    }
    this._sigh = Math.max(0, (this._sigh || 0) - dt * 1.2);

    /* ---- the eye, its lid, and the spotting lamp ---- */
    const lid = damp(this._lid ?? 0, this._lidWant ?? 0, dt, 6);
    this._lid = lid;
    this._lidWant = 0;
    // and it blinks — rarely, irregularly, and never at something it can see
    const blink = !this.target && Math.sin(now * 0.00037 + this.position.x) > 0.9993 ? 1 : 0;
    p.eyeLid.position.y = p.eyeLidOpen - Math.min(1, lid + blink) * 0.021;
    const eyeGlow = this._eyeWant ?? (this.state === 'reload' ? 0.25 : this.target ? 0.85 : 0.3);
    this._eyeWant = null;
    // during a dream it is not steady, it flickers behind a shut lid
    const flick = this.routine === 'dream' ? 0.4 + Math.random() * 0.6 : 1;
    p.lensMat.emissive.setRGB(eyeGlow * 0.16 * flick, eyeGlow * 0.9 * flick, eyeGlow * 0.55 * flick);
    const spotOn = this.routine === 'salute'
      ? (Math.sin(this.routineT * 18) > 0 ? 1 : 0.1)          // the two blinks
      : this.routine === 'regard' || this.routine === 'stare' ? 0
        : this.target ? 0.75 : 0.12;
    p.spot.material.emissive.setRGB(spotOn * 0.9, spotOn * 0.78, spotOn * 0.4);

    /* ---- the lamps: four of them, and they are what it is saying ---- */
    const mode = this._lampMode
      || (this.state === 'deploy' ? (st.ready > 0 ? 'run' : 'dark')
        : this.state === 'reload' ? 'load'
          : this.state === 'cooling' ? 'hot'
            : this.target ? 'alert' : 'idle');
    this._lampMode = null;
    for (let i = 0; i < p.lamps.length; i++) {
      const m = p.lamps[i].material;
      let r = 0, gg = 0, b = 0;
      if (mode === 'chase') {
        const on = (Math.floor(now * 0.006) % 4) === i ? 1 : 0.08;
        r = on * 0.7; gg = on * 0.6; b = on * 0.1;
      } else if (mode === 'run') {                 // the ready sweep, once
        const on = st.ready * 4 > i ? 0.9 : 0.05;
        r = on * 0.65; gg = on * 0.62; b = on * 0.15;
      } else if (mode === 'dark') {
        r = gg = b = 0;
      } else if (mode === 'heartbeat') {
        const beat = Math.max(0, Math.sin(now * 0.0016)) ** 8;
        r = beat * 0.22; gg = beat * 0.16; b = beat * 0.03;
      } else if (mode === 'dream') {
        // the lamps go with the pulse in the jar, not with a clock
        const beat = heartbeat(this.pulseT);
        r = beat * 0.20; gg = beat * 0.05; b = beat * 0.26;
      } else if (mode === 'friendly') {
        const on = 0.35 + Math.sin(now * 0.012 + i) * 0.25;
        r = on * 0.12; gg = on * 0.8; b = on * 0.55;
      } else if (mode === 'talk') {                // its half of a conversation
        const on = (Math.floor(now * 0.011 + i * 1.7) % 3) ? 0.75 : 0.06;
        r = on * 0.15; gg = on * 0.7; b = on * 0.65;
      } else if (mode === 'listen') {
        const on = 0.12 + Math.sin(now * 0.003 + i) * 0.05;
        r = on * 0.1; gg = on * 0.4; b = on * 0.4;
      } else if (mode === 'alarm') {
        const on = (Math.floor(now * 0.014) % 2) ? 0.9 : 0.1;
        r = on * 0.5; gg = on * 0.5; b = on * 0.9;
      } else if (mode === 'cross') {
        const on = (Math.floor(now * 0.01) % 2) ? 0.85 : 0.05;
        r = on * 0.9; gg = on * 0.1; b = 0;
      } else if (mode === 'load') {
        // a bar filling left to right while the drum goes on
        const fill = this.state === 'reload' ? this.stateT / RELOAD_TIME : this.routineT / 3;
        const on = fill * p.lamps.length > i ? 0.8 : 0.06;
        r = on * 0.75; gg = on * 0.55; b = on * 0.1;
      } else if (mode === 'hot') {
        const on = 0.45 + Math.sin(now * 0.009 + i * 1.4) * 0.3;
        r = on * 0.95; gg = on * 0.2; b = 0;
      } else if (mode === 'alert') {
        const on = 0.55 + Math.sin(now * 0.016) * 0.3;
        r = on * 0.95; gg = on * 0.08; b = 0;
      } else {
        const on = 0.4 + Math.sin(now * 0.0035 + i * 0.9) * 0.18;
        r = on * 0.5; gg = on * 0.42; b = on * 0.08;
      }
      m.emissive.setRGB(r, gg, b);
    }
    p.lampMat.emissive.copy(p.lamps[1].material.emissive);
  }

  dispose() {
    this._offWhisper?.();
    this._communeWith = null;
    this.world.removeInteractable(this.interactable);
    this.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
    });
  }
}
