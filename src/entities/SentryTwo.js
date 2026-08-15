import * as THREE from '../../lib/three.module.js';
import { Entity } from './Entity.js';
import { buildSentryTwoModel, TWO_SCALE, TWO_EYE, TWO_MUZZLE, TWO_SPREAD } from '../rendering/SentryTwoModel.js';
import { SENTRY_RANGE, SENTRY_DAMAGE, SENTRY_INTERVAL } from './Sentry.js';

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
 * longer to come up, and every so often it has to stop and change a drum,
 * which it does with its own arm while you watch.
 *
 *   range      2 × the Mk I's — the rangefinder bar is why, and it is on show
 *   arc        240°, which is the length of the slew ring's drag chain
 *   rate       a little faster than the Mk I, and TWO barrels fire together
 *   damage     the pistol's, per bullet, exactly as the Mk I — two bullets
 *   heat       a water jacket rather than fins: it holds longer, then BOILS
 *   feed       a saddle drum, and it changes its own
 *
 * The horde still does not know it is there. Like the Mk I it is on neither
 * the player's roster nor the friendlies list, so nothing shoots back, walks
 * into it or beats on it: it is a thing you leave behind you and walk away
 * from, not a thing you stand and defend.
 *
 * ── STATES ────────────────────────────────────────────────────────────────
 *   deploy   the case opens, four legs scissor out, the jacks screw down, the
 *            mast rises, the SPADE drives in behind it, the rangefinder bar
 *            extends, and the charging handle is pulled once. It cannot fire
 *            during any of that, and the sequence is the point: this thing is
 *            plainly being SET UP rather than dropped.
 *   scan     nothing to shoot: the head sweeps its 240°, the drag chain pays
 *            out and winds back, and the rangefinder prisms drift.
 *   track    a target: the prisms toe in and CONVERGE first — the optic sees
 *            it before the barrels get there — then the head slews on and
 *            both barrels fire together.
 *   reload   the drum is out. The arm lifts a fresh one off the rack, seats
 *            it, and the gun is back. It will not fire during this.
 *   cooling  the jackets have gone over: the relief valve lifts, steam comes
 *            off the header tank, and the rate falls away until it recovers.
 *   idle     nobody has come for a long time, and it finds things to do.
 *
 * ── AND THE THINGS IT DOES WHEN NOBODY IS WATCHING ────────────────────────
 *   SELF-TEST  lamps in a chase, the rangefinder swept end to end, the arm
 *              cycling once through its own travel.
 *   DOZE       barrels sink, lamps drop to a heartbeat, the arm hangs, and
 *              every so often the relief valve sighs a puff of steam. It is
 *              asleep at its post, and it snores.
 *   SALUTE     stand in front of one, in its arc, doing nothing, and it will
 *              notice you and TIP THE RANGEFINDER BAR at you like a hat brim,
 *              blinking the spotting lamp twice. Only for the player.
 *   TALLY      every twenty-fifth kill the arm reaches back and CUTS ANOTHER
 *              MARK INTO ITS OWN DATA PLATE. The marks are really there, on
 *              the texture, for the rest of the run.
 *   POLISH     left alone long enough it takes the rag out of its claw and
 *              wipes the rangefinder glass.
 *   GRUMBLE    set down three times in a hurry and it deploys in a mood: the
 *              spade goes in hard enough to make it rock, and the lamps go
 *              red.
 *   HANDSHAKE  deploy one within seven metres of a Mk I and the two of them
 *              acknowledge each other — the Mk II dips its bar, the Mk I runs
 *              its lamps. The old machine and the new one, on the same corner.
 */

/** Twice the Mk I's reach, off the same constant, so it can never drift. */
export const TWO_RANGE = SENTRY_RANGE * 2;          // 36.576 m
export const TWO_ARC = 240 * Math.PI / 180;         // 240°, the drag chain's length
export const TWO_DAMAGE = SENTRY_DAMAGE;            // per bullet — and it fires two
export const TWO_INTERVAL = SENTRY_INTERVAL * 0.85; // 0.221 s: slightly faster
export const TWO_BARRELS = 2;

const DEPLOY_TIME = 1.75;     // heavier than the Mk I's 1.05, and it shows
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

const SELFTEST_EVERY = 30;
const POLISH_EVERY = 44;
const DOZE_AFTER = 58;
const SALUTE_RANGE = 8.0;
const SALUTE_COOLDOWN = 24;
const TALLY_EVERY = 25;
const HANDSHAKE_RANGE = 7.0;

const EYE_H = TWO_EYE * TWO_SCALE;
const MUZZLE_OUT = TWO_MUZZLE * TWO_SCALE;
const SPREAD = TWO_SPREAD * TWO_SCALE;

const ease = (t) => t * t * (3 - 2 * t);
const pulse = (t, up = 0.2, down = 0.25) => (t < up ? ease(t / up)
  : t > 1 - down ? ease((1 - t) / down) : 1);
const damp = (cur, want, dt, rate) => cur + (want - cur) * Math.min(1, dt * rate);

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
    this.height = 0.78 * TWO_SCALE;
    this.radius = 0.36;

    this.rig = buildSentryTwoModel(texLib);
    this.mesh = this.rig.group;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = yaw;

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

    // the feed
    this.drum = DRUM_PULLS;      // pulls left in the one that is on
    this.drumSpin = 0;
    this.spares = RACK_SIZE;     // drums standing in the ready rack right now

    // the optic: 0 wide open and drifting, 1 fully converged on something
    this.converge = 0;

    // the idle life
    this.quiet = 0;
    this.routine = null;
    this.routineT = 0;
    this.nextSelfTest = SELFTEST_EVERY * (0.7 + Math.random() * 0.6);
    this.nextPolish = POLISH_EVERY * (0.7 + Math.random() * 0.6);
    this.saluteReady = 0;
    this.sawPlayer = 0;
    this._armPose = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0, claw: 0 };
    if (grumpy) { this.routine = 'grumble'; this.routineT = 0; }
    this._handshakeDue = true;

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
    let rel = Math.atan2(target.position.x - this.position.x, target.position.z - this.position.z) - this.yaw;
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

    if (this.state === 'deploy') {
      if (this.stateT >= DEPLOY_TIME) {
        this.state = 'scan';
        this.stateT = 0;
        this.routine = null;
        this._greetNeighbour(ctx);
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
      if (this.routine === 'doze') this.events.emit('sentry:wake', { pos: this.position.clone(), kind: this.kind });
      this.routine = null;
      this.quiet = 0;
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
      this.spares = this.spares > 0 ? this.spares - 1 : RACK_SIZE - 1;
    }
    this._present(dt, ctx);
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

  _idleLife(dt, ctx) {
    if (this.saluteReady > 0) this.saluteReady -= dt;

    if (this.routine) {
      this.routineT += dt;
      const done = this[`_run_${this.routine}`]?.(dt, ctx);
      if (done) { this.routine = null; this.routineT = 0; }
      return;
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

  _begin(name) { this.routine = name; this.routineT = 0; }

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
    this._armWant = {
      yaw: Math.sin(f * Math.PI * 2) * 1.5 * k,
      shoulder: 0.55 * Math.abs(Math.sin(f * Math.PI * 2)) * k,
      elbow: -0.8 * Math.abs(Math.sin(f * Math.PI * 2)) * k,
      wrist: Math.sin(f * Math.PI * 6) * 0.4 * k,
      claw: Math.abs(Math.sin(f * Math.PI * 5)) * k,
    };
    this._legShake = Math.sin(f * Math.PI * 9) * 0.022 * k;
    return false;
  }

  /** Nods off. The barrels sink, the lamps beat, and the valve sighs. */
  _run_doze(dt) {
    const settle = Math.min(1, this.routineT / 4);
    this.headPitch = damp(this.headPitch, -0.30 * settle, dt, 1.3);
    this.headYaw += this.scanDir * SCAN_SPEED * 0.1 * dt;
    const limit = TWO_ARC / 2;
    if (this.headYaw > limit) { this.headYaw = limit; this.scanDir = -1; }
    if (this.headYaw < -limit) { this.headYaw = -limit; this.scanDir = 1; }
    this._lampMode = 'heartbeat';
    this._convergeWant = 0.05;
    // the arm droops on its post, the way a hand goes slack
    this._armWant = { yaw: 0.3 * settle, shoulder: 0.75 * settle, elbow: -0.55 * settle, wrist: 0.2, claw: 0.1 };
    // it snores: a puff off the relief valve every few seconds
    const s = Math.sin(this.routineT * 0.55);
    if (s > 0.995) this._sigh = 1;
    return false;
  }

  /**
   * SALUTE — it tips the rangefinder bar at you, the way a man tips a hat.
   *
   * The Mk I puts its barrel up. This one has a brim, so it uses it: the bar
   * rolls forward and back while the spotting lamp blinks twice. It is the
   * single most human thing either machine does, and it is only ever for the
   * player.
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
    // and the arm comes up with it, held out to the side like a wave
    this._armWant = { yaw: -0.9 * tip, shoulder: -0.35 * tip, elbow: -0.45 * tip, wrist: 0, claw: 0.6 * tip };
    if (f > 0.22 && !this._saluted) {
      this._saluted = true;
      this.events.emit('sentry:salute', { pos: this.position.clone(), kind: this.kind });
    }
    if (f >= 1) this._saluted = false;
    return false;
  }

  /**
   * TALLY — the arm reaches back and cuts another mark into the data plate.
   *
   * The mark is not a gesture: the plate's texture is redrawn with one more
   * stroke on it and it stays there. Leave one somewhere busy, come back, and
   * you can read off what it has been doing from six feet away.
   */
  _run_tally(dt) {
    const f = this.routineT / 1.7;
    if (f >= 1) return true;
    const k = pulse(f, 0.25, 0.3);
    this.headYaw = damp(this.headYaw, 0, dt, 2.5);
    // right round to the plate at the back, three short strokes, and back
    this._armWant = {
      yaw: 2.5 * k,
      shoulder: 1.15 * k,
      elbow: -1.05 * k,
      wrist: Math.sin(f * Math.PI * 9) * 0.5 * k,
      claw: 0.85 * k,
    };
    this._lampMode = 'chase';
    if (f > 0.45 && !this._notched) {
      this._notched = true;
      this.rig.parts.setTally?.(this.kills);
      this.events.emit('sentry:tally', { pos: this.position.clone(), kills: this.kills });
    }
    if (f >= 1) this._notched = false;
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
      shoulder: -0.62 * k,
      elbow: -0.30 * k,
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
    this._spadeStamp = Math.abs(Math.sin(f * Math.PI * 3)) * 0.35 * k;
    this._legShake = Math.sin(f * Math.PI * 14) * 0.03 * k;
    this._lampMode = 'cross';
    return false;
  }

  /** HANDSHAKE — a dip of the bar at the older machine on the same corner. */
  _run_handshake(dt) {
    const f = this.routineT / 1.9;
    if (f >= 1) return true;
    const k = pulse(f, 0.25, 0.3);
    this._barTip = k * 0.4;
    this._armWant = { yaw: -0.7 * k, shoulder: -0.3 * k, elbow: -0.5 * k, wrist: 0.3 * k, claw: 0.9 * k };
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

  _present(dt, ctx) {
    const p = this.rig.parts;
    const now = performance.now();

    if (this._tallyOwed && !this.target && !this.routine && this.state === 'scan') {
      this._tallyOwed = false;
      this._begin('tally');
    }

    /* ---- the undercarriage: legs, jacks, pads, spade, mast ---- */
    const deploy = this.state === 'deploy' ? Math.min(1, this.stateT / DEPLOY_TIME) : 1;
    const open = ease(Math.min(1, deploy / 0.55));                 // legs first
    const jackOut = ease(Math.max(0, Math.min(1, (deploy - 0.35) / 0.35)));
    const spadeIn = ease(Math.max(0, Math.min(1, (deploy - 0.62) / 0.28)));
    const knee = ease(Math.max(0, Math.min(1, (open - 0.18) / 0.82)));
    const shake = this._legShake || 0;
    for (const leg of p.legs) {
      leg.hip.rotation.x = leg.splay * open + shake;
      leg.knee.rotation.x = leg.fold * knee;
      leg.pad.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x);
      leg.ram.position.y = -0.145 - open * 0.038;
      leg.ram.scale.y = 1 + open * 0.35;
      // the jack screws down last, and it TURNS as it does — the thread is
      // right there, so a jack that extended without turning would be a lie
      leg.jack.position.y = -0.15 - jackOut * 0.045;
      leg.jack.rotation.y = jackOut * 7.5;
    }
    this._legShake = 0;
    // the spade drives in behind it, and a grumble stamps it
    p.spade.rotation.x = -0.15 + spadeIn * 1.05 + (this._spadeStamp || 0);
    this._spadeStamp = 0;
    p.mastStage.position.y = 0.135 + open * 0.06;
    p.body.position.y = 0.30 + 0.14 * open;

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

    /* ---- the guns: recoil, bolts, brass, flashes ---- */
    for (let i = 0; i < p.barrels.length; i++) {
      const b = p.barrels[i];
      b.group.position.z = b.home - this.recoil * 0.05;
      b.bolt.position.z = b.boltZ - this.bolt * 0.06;
      b.flash.visible = this.flashT > 0;
      if (b.flash.visible) {
        b.flash.scale.setScalar(0.7 + Math.random() * 0.6);
        b.flash.rotation.z = Math.random() * Math.PI;
      }
    }
    // the charging handle: pulled once during the deploy, and again on a
    // drum change — the beat that says the gun has been made ready.
    const chargePull = this.state === 'deploy'
      ? Math.max(0, Math.sin(Math.max(0, (deploy - 0.72)) / 0.28 * Math.PI))
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
    p.drum.position.y = 0.105 + (rel > 0 ? Math.sin(rel * Math.PI) * 0.055 : 0);
    p.drum.rotation.z = rel > 0 ? Math.sin(rel * Math.PI) * 0.5 : 0;
    for (let i = 0; i < p.rack.length; i++) p.rack[i].visible = i < this.spares;

    /* ---- the loader arm ---- */
    // While a drum is being changed the arm HAS to be doing it; the idle
    // routines only get the arm when there is nothing else for it.
    let want = this._armWant;
    if (this.state === 'reload') {
      // One continuous move, and it is readable as one: round to the rack,
      // stoop, take a drum, come back over the top, and set it on the feed.
      const f = rel;
      const out = Math.sin(Math.min(1, f * 2) * Math.PI * 0.5);       // going for it
      const back = Math.max(0, (f - 0.5) * 2);                         // coming back
      want = {
        yaw: 1.85 * out - 2.6 * back * out,
        shoulder: 1.05 * out - 0.65 * back,
        elbow: -0.95 * out + 0.55 * back,
        wrist: 0.4 * Math.sin(f * Math.PI * 2),
        claw: f > 0.35 && f < 0.85 ? 1 : 0.1,
      };
    }
    this._armWant = null;
    const a = this._armPose;
    const rate = this.state === 'reload' ? 12 : 6;
    a.yaw = damp(a.yaw, want?.yaw ?? 0, dt, rate);
    a.shoulder = damp(a.shoulder, want?.shoulder ?? 0, dt, rate);
    a.elbow = damp(a.elbow, want?.elbow ?? 0, dt, rate);
    a.wrist = damp(a.wrist, want?.wrist ?? 0, dt, rate);
    a.claw = damp(a.claw, want?.claw ?? 0, dt, rate);
    p.arm.base.rotation.y = a.yaw;
    p.arm.shoulder.rotation.x = a.shoulder;
    p.arm.elbow.rotation.x = a.elbow;
    p.arm.wrist.rotation.z = a.wrist;
    p.arm.clawL.rotation.z = a.claw * 0.5;
    p.arm.clawR.rotation.z = -a.claw * 0.5;
    p.arm.rag.visible = !!want?.rag;

    /* ---- the rangefinder: it extends on deploy and converges on a target ---- */
    const ext = ease(Math.max(0, Math.min(1, (deploy - 0.45) / 0.4)));
    p.rf.bar.scale.x = 0.35 + ext * 0.65;
    const conv = this._convergeWant ?? this.converge;
    this._convergeWant = null;
    this._conv = damp(this._conv ?? 0, conv, dt, 8);
    // the two prism heads toe IN as it converges — the optical tell
    p.rf.headL.rotation.y = this._conv * 0.42;
    p.rf.headR.rotation.y = -this._conv * 0.42;
    // and the bar tips forward when it is greeting somebody
    p.rf.bar.rotation.x = (this._barTip || 0);
    this._barTip = damp(this._barTip || 0, 0, dt, 5);

    /* ---- heat: the valve lifts, the jacket glows, and it boils over ---- */
    const h = this.heat;
    p.jacketMat.emissive.setRGB(h * h * 0.55, h * h * 0.18, h * h * 0.06);
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

    /* ---- the eye and the spotting lamp ---- */
    const eyeGlow = this.state === 'reload' ? 0.25 : this.target ? 0.85 : 0.3;
    p.lensMat.emissive.setRGB(eyeGlow * 0.16, eyeGlow * 0.9, eyeGlow * 0.55);
    const spotOn = this.routine === 'salute'
      ? (Math.sin(this.routineT * 18) > 0 ? 1 : 0.1)          // the two blinks
      : this.target ? 0.75 : 0.12;
    p.spot.material.emissive.setRGB(spotOn * 0.9, spotOn * 0.78, spotOn * 0.4);

    /* ---- the lamps: four of them, and they are what it is saying ---- */
    const mode = this._lampMode
      || (this.state === 'reload' ? 'load'
        : this.state === 'cooling' ? 'hot'
          : this.target ? 'alert' : 'idle');
    this._lampMode = null;
    for (let i = 0; i < p.lamps.length; i++) {
      const m = p.lamps[i].material;
      let r = 0, gg = 0, b = 0;
      if (mode === 'chase') {
        const on = (Math.floor(now * 0.006) % 4) === i ? 1 : 0.08;
        r = on * 0.7; gg = on * 0.6; b = on * 0.1;
      } else if (mode === 'heartbeat') {
        const beat = Math.max(0, Math.sin(now * 0.0016)) ** 8;
        r = beat * 0.22; gg = beat * 0.16; b = beat * 0.03;
      } else if (mode === 'friendly') {
        const on = 0.35 + Math.sin(now * 0.012 + i) * 0.25;
        r = on * 0.12; gg = on * 0.8; b = on * 0.55;
      } else if (mode === 'cross') {
        const on = (Math.floor(now * 0.01) % 2) ? 0.85 : 0.05;
        r = on * 0.9; gg = on * 0.1; b = 0;
      } else if (mode === 'load') {
        // a bar filling left to right while the drum goes on
        const fill = this.stateT / RELOAD_TIME;
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
    this.world.removeInteractable(this.interactable);
    this.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
    });
  }
}
