import * as THREE from '../../lib/three.module.js';
import { Entity } from './Entity.js';
import { WEAPON_CONFIGS } from '../weapons/WeaponConfigs.js';
import { buildSentryModel, SENTRY_SCALE, SENTRY_EYE, SENTRY_MUZZLE } from '../rendering/SentryModel.js';

/**
 * THE PORTABLE SENTRY — a tripod-mounted automatic pistol you buy from the
 * vendor, carry in the satchel, and set down where you expect the line to
 * break.
 *
 * Its whole design is one trade: it shoots for you, but only where you pointed
 * it. The gun sits on a yaw ring that sweeps a 180° arc centred on the way it
 * was facing when you put it down — everything in front of it is covered,
 * everything behind it is not — and it reaches SENTRY_RANGE, about sixty feet,
 * which is far enough to hold a whole street. It is a pistol on a stand, quite
 * literally: it fires at the pistol's rate, for the pistol's damage, off the
 * same numbers in WeaponConfigs, so it is never better than the gun in your
 * hand — it is just a second one that never gets tired and never looks the
 * wrong way.
 *
 * The horde does not know it is there. Zombies acquire the player and then the
 * shared `friendlies` roster; a sentry is on neither, so nothing shoots back,
 * walks into it or beats on it. That is deliberate: a turret the horde could
 * kill would be a thing you stand and defend, and this is a thing you leave
 * behind you and walk away from.
 *
 * ── STATES ────────────────────────────────────────────────────────────────
 *   deploy   legs kick out, the mast rises, the iris opens, the head bore-
 *            sights its whole arc once. It cannot fire during this.
 *   scan     nothing to shoot: the head sweeps its arc, slowly, side to side
 *   track    a target in the arc and in range: it slews on and fires the
 *            moment the barrel is lined up
 *   cooling  the barrel has had enough for the moment — the louvres crack
 *            open, the fins glow, and the rate falls off until it recovers
 *   idle     nobody has come for a long time, and it starts doing things
 *
 * ── AND THE THINGS IT DOES WHEN NOBODY IS WATCHING ────────────────────────
 * A machine that only ever sweeps left and right is a metronome. Given long
 * enough with nothing to shoot, this one runs its own little routines, picked
 * so that a player who leaves one somewhere and comes back has something to
 * find:
 *
 *   SELF-TEST  every so often it runs the lamps as a chase, cycles the iris
 *              shut and open, and gives the tripod a shake down.
 *   DOZE       left alone long enough the barrel droops, the lamps go to a
 *              slow single heartbeat and the sweep almost stops. Anything in
 *              the arc snaps it awake with a jolt.
 *   SALUTE     stand in front of one, inside its arc, doing nothing, and it
 *              will notice you, bring the barrel up to the vertical, hold it
 *              there, and put it back down. It only does this for the player,
 *              and only when it has nothing better to do.
 *   TALLY      every twenty-fifth kill it taps the barrel down twice, like a
 *              gunner notching the stock.
 *   GRUMBLE    pick one up and put it down three times inside twenty seconds
 *              and it deploys with a shake of the head rather than a sweep.
 *
 * None of it changes what the gun does. All of it is visible from across the
 * street, which is the point.
 */
const PISTOL = WEAPON_CONFIGS.find((c) => c.id === 'pistol');
/** ~60 feet — the number the design is stated in, converted once, here. */
export const SENTRY_RANGE = 60 * 0.3048;      // 18.288 m
export const SENTRY_ARC = Math.PI;            // 180°, centred on its facing
export const SENTRY_DAMAGE = PISTOL.damage;         // 12 — the pistol's, exactly
export const SENTRY_INTERVAL = PISTOL.fireInterval; // 0.26 s — likewise

/**
 * How long the Mk I takes to stand up.
 *
 * Exported because the Mk II's deploy is defined as exactly twice this, and a
 * second machine that "takes about two seconds" is a number that drifts the
 * first time anyone touches this one.
 */
export const SENTRY_DEPLOY_TIME = 1.05;
const DEPLOY_TIME = SENTRY_DEPLOY_TIME;
const SCAN_SPEED = 0.85;      // rad/s while sweeping for something to shoot
const TRACK_SPEED = 4.2;      // rad/s slewing onto a target
const AIM_TOLERANCE = 0.12;   // how lined up it must be before it will fire
const MUZZLE_FLASH = 0.06;
// Heat: every round adds, every second sheds. Past the ceiling it stops to
// cool, which is the one thing that ever slows it down.
const HEAT_PER_SHOT = 0.075;
const HEAT_SHED = 0.20;       // per second
const HEAT_CEILING = 1.0;
const HEAT_RESUME = 0.55;
// Idle routines: how long with nothing to shoot before each becomes possible.
const SELFTEST_EVERY = 26;
const DOZE_AFTER = 52;
const SALUTE_RANGE = 7.0;     // it only notices you if you are actually near it
const SALUTE_COOLDOWN = 22;
const TALLY_EVERY = 25;
// Barrel height above the sentry's foot, and how far the muzzle stands out
// from the mount — both taken off the model so they follow it if it is
// resized rather than being two more numbers to keep in step by hand.
const EYE_H = SENTRY_EYE * SENTRY_SCALE;
const MUZZLE_OUT = SENTRY_MUZZLE * SENTRY_SCALE;

/** Smoothstep, for every ease in here. */
const ease = (t) => t * t * (3 - 2 * t);
/** A pulse that rises, holds, and falls over 0..1 — the shape of a gesture. */
const pulse = (t, up = 0.2, down = 0.25) => (t < up ? ease(t / up)
  : t > 1 - down ? ease((1 - t) / down) : 1);

export class Sentry extends Entity {
  constructor(events, world, texLib, { x, z, yaw, grumpy = false }) {
    super();
    this.events = events;
    this.world = world;
    this.addTag('sentry');
    // Not 'friendly' on purpose — see the class note. Nothing hunts this.

    const y = world.groundHeightFor(x, z, 1e9);
    this.position.set(x, y, z);
    this.yaw = yaw;          // the centre of its arc; never changes once placed
    this.height = 0.62 * SENTRY_SCALE;
    this.radius = 0.3;

    this.rig = buildSentryModel(texLib);
    this.mesh = this.rig.group;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = yaw;

    this.state = 'deploy';
    this.stateT = 0;
    this.headYaw = 0;        // relative to `yaw`; the arc is ±SENTRY_ARC/2
    this.headPitch = 0;      // the trunnion; only the routines ever use it
    this.scanDir = Math.random() < 0.5 ? -1 : 1;
    this.cooldown = 0;
    this.flashT = 0;
    this.recoil = 0;
    this.bolt = 0;           // 1 the instant a round goes off, decays to 0
    this.heat = 0;
    this.beltStep = 0;       // how far the belt has walked, in links
    this.shellT = 0;         // a spent case in flight
    this.target = null;
    this.kills = 0;
    this.shotsFired = 0;
    this.toRemove = false;

    // The idle life. `quiet` is how long since it last had anything to do.
    this.quiet = 0;
    this.routine = null;     // 'selftest' | 'doze' | 'salute' | 'tally' | 'grumble'
    this.routineT = 0;
    this.nextSelfTest = SELFTEST_EVERY * (0.7 + Math.random() * 0.6);
    this.saluteReady = 0;
    this.sawPlayer = 0;
    // Set by SentrySystem when this is the third re-placement in short order.
    if (grumpy) { this.routine = 'grumble'; this.routineT = 0; }

    this.interactable = world.addInteractable({
      x, z, y, radius: 1.9,
      prompt: 'Pack up the sentry [E]',
      enabled: () => !this.toRemove,
      onInteract: () => this.events.emit('sentry:retrieve', { sentry: this }),
    });
    this.events.emit('sentry:deployed', { pos: this.position.clone() });
  }

  /** Is this world point inside the sentry's covered wedge? */
  covers(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    if (dx * dx + dz * dz > SENTRY_RANGE * SENTRY_RANGE) return false;
    let rel = Math.atan2(dx, dz) - this.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    return Math.abs(rel) <= SENTRY_ARC / 2;
  }

  /** The muzzle, in world space — where its shots come from. */
  muzzlePoint() {
    const a = this.yaw + this.headYaw;
    return new THREE.Vector3(
      this.position.x + Math.sin(a) * MUZZLE_OUT,
      this.position.y + EYE_H,
      this.position.z + Math.cos(a) * MUZZLE_OUT,
    );
  }

  /**
   * Nearest live zombie inside the wedge with a clear line to the muzzle.
   * Line of sight is checked from the barrel, so a sentry set behind a wall
   * covers the doorway rather than the wall.
   */
  _acquire(zombies) {
    const from = this.muzzlePoint();
    let best = null, bestD = Infinity;
    for (const z of zombies ?? []) {
      if (z.state === 'dead') continue;
      const d = Math.hypot(z.position.x - this.position.x, z.position.z - this.position.z);
      if (d >= bestD || !this.covers(z.position.x, z.position.z)) continue;
      if (Math.abs(z.position.y - this.position.y) > 2.2) continue;   // not on this floor
      if (!this.world.hasLineOfSight(from.x, from.y, from.z,
        z.position.x, z.position.y + z.height * 0.5, z.position.z)) continue;
      best = z; bestD = d;
    }
    return best;
  }

  /** Angle (relative to the mount) the head would need to face `target`. */
  _bearingTo(target) {
    let rel = Math.atan2(target.position.x - this.position.x, target.position.z - this.position.z) - this.yaw;
    return Math.atan2(Math.sin(rel), Math.cos(rel));
  }

  update(dt, ctx) {
    this.stateT += dt;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (this.shellT > 0) this.shellT -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.bolt = Math.max(0, this.bolt - dt * 11);
    this.heat = Math.max(0, this.heat - HEAT_SHED * dt);

    if (this.state === 'deploy') {
      if (this.stateT >= DEPLOY_TIME) {
        this.state = 'scan';
        this.stateT = 0;
        this.routine = null;
      }
      this._present(dt, ctx);
      return;
    }

    const limit = SENTRY_ARC / 2;
    this.target = this._acquire(ctx?.zombies);

    if (this.target) {
      // Anything in the arc ends every routine at once, and wakes it hard.
      if (this.routine === 'doze') this.events.emit('sentry:wake', { pos: this.position.clone() });
      this.routine = null;
      this.quiet = 0;
      if (this.state !== 'track') { this.state = 'track'; this.stateT = 0; }
      const want = Math.max(-limit, Math.min(limit, this._bearingTo(this.target)));
      const step = TRACK_SPEED * dt;
      const delta = want - this.headYaw;
      this.headYaw += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
      this.headPitch += (0 - this.headPitch) * Math.min(1, dt * 8);
      const lined = Math.abs(want - this.headYaw) < AIM_TOLERANCE;
      const hot = this.state === 'cooling';
      if (lined && this.cooldown <= 0 && !hot) this._fire(this.target);
      // Too hot to keep it up: stop, open the louvres, wait for the fins.
      if (this.heat >= HEAT_CEILING) { this.state = 'cooling'; this.stateT = 0; }
    } else {
      this.quiet += dt;
      if (this.state !== 'scan') { this.state = 'scan'; this.stateT = 0; }
      this._idleLife(dt, ctx);
      if (!this.routine) {
        // the ordinary sweep — everything else above overrides it
        this.headYaw += this.scanDir * SCAN_SPEED * dt;
        if (this.headYaw > limit) { this.headYaw = limit; this.scanDir = -1; }
        if (this.headYaw < -limit) { this.headYaw = -limit; this.scanDir = 1; }
        this.headPitch += (0 - this.headPitch) * Math.min(1, dt * 4);
      }
    }
    // cooling clears itself once the barrel is back under the resume mark
    if (this.state === 'cooling' && this.heat <= HEAT_RESUME) {
      this.state = this.target ? 'track' : 'scan';
      this.stateT = 0;
    }
    this._present(dt, ctx);
  }

  /* ================================================================== *
   * THE IDLE LIFE                                                       *
   * ================================================================== */

  /**
   * Choose and drive whatever it is doing with itself. Only ever runs with no
   * target, and every routine leaves the rig where it found it so they can
   * follow one another in any order.
   */
  _idleLife(dt, ctx) {
    if (this.saluteReady > 0) this.saluteReady -= dt;

    if (this.routine) {
      this.routineT += dt;
      const done = this[`_run_${this.routine}`]?.(dt, ctx);
      if (done) { this.routine = null; this.routineT = 0; }
      return;
    }

    // SALUTE first, because it is the one that answers the player. It wants
    // them close, in the arc, and standing still enough to be looked at.
    const p = ctx?.player;
    if (p?.alive && this.saluteReady <= 0 && this.quiet > 3) {
      const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
      if (d < SALUTE_RANGE && this.covers(p.position.x, p.position.z)) {
        this.sawPlayer += dt;
        if (this.sawPlayer > 1.6) {
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
    if (this.quiet > this.nextSelfTest) {
      this._begin('selftest');
      this.nextSelfTest = this.quiet + SELFTEST_EVERY * (0.7 + Math.random() * 0.6);
    }
  }

  _begin(name) { this.routine = name; this.routineT = 0; }

  /** Lamps chase, the iris cycles, the legs take a shake down. ~3.2 s. */
  _run_selftest(dt) {
    const f = this.routineT / 3.2;
    if (f >= 1) return true;
    const k = pulse(f, 0.12, 0.2);
    // the head parks square while it checks itself over
    this.headYaw += (0 - this.headYaw) * Math.min(1, dt * 2.2);
    this.headPitch = Math.sin(f * Math.PI * 2) * 0.12 * k;
    this._lampMode = 'chase';
    this._irisWant = 0.15 + 0.85 * Math.abs(Math.sin(f * Math.PI * 3));
    this._legShake = Math.sin(f * Math.PI * 8) * 0.03 * k;
    return false;
  }

  /**
   * Nods off. The barrel sinks, the sweep all but stops and the lamps drop to
   * one slow heartbeat — and it stays that way until something turns up, which
   * is the whole joke: you come back an hour later and it is asleep at its post.
   */
  _run_doze(dt) {
    const settle = Math.min(1, this.routineT / 3.5);
    this.headPitch += (-0.34 * settle - this.headPitch) * Math.min(1, dt * 1.4);
    this.headYaw += this.scanDir * SCAN_SPEED * 0.12 * dt;
    const limit = SENTRY_ARC / 2;
    if (this.headYaw > limit) { this.headYaw = limit; this.scanDir = -1; }
    if (this.headYaw < -limit) { this.headYaw = -limit; this.scanDir = 1; }
    this._lampMode = 'heartbeat';
    this._irisWant = 0.08;
    // every so often it twitches, the way anything asleep does
    if (Math.sin(this.routineT * 0.7) > 0.995) this.headPitch += 0.05;
    return false;      // only a target ends this
  }

  /** Barrel to the vertical, held, and back down. For the player, once. */
  _run_salute(dt, ctx) {
    const f = this.routineT / 2.3;
    if (f >= 1) return true;
    const p = ctx?.player;
    if (p) {
      // turn onto them first, then bring the barrel up
      const want = Math.max(-SENTRY_ARC / 2, Math.min(SENTRY_ARC / 2, this._bearingTo(p)));
      this.headYaw += (want - this.headYaw) * Math.min(1, dt * 4);
    }
    this.headPitch = pulse(f, 0.28, 0.34) * 1.15;
    this._lampMode = 'friendly';
    this._irisWant = 0.9;
    if (f > 0.25 && !this._saluted) {
      this._saluted = true;
      this.events.emit('sentry:salute', { pos: this.position.clone() });
    }
    if (f >= 1) this._saluted = false;
    return false;
  }

  /** Two taps of the barrel, the way a gunner notches a stock. ~1.1 s. */
  _run_tally(dt) {
    const f = this.routineT / 1.1;
    if (f >= 1) return true;
    this.headPitch = -0.22 * Math.abs(Math.sin(f * Math.PI * 2));
    this._lampMode = 'chase';
    return false;
  }

  /** Set down for the third time in a hurry: it shakes its head about it. */
  _run_grumble(dt) {
    const f = this.routineT / 1.6;
    if (f >= 1) return true;
    this.headYaw = Math.sin(f * Math.PI * 6) * 0.42 * pulse(f, 0.15, 0.3);
    this.headPitch = -0.10 * pulse(f, 0.2, 0.3);
    this._lampMode = 'cross';
    return false;
  }

  /**
   * One round, resolved directly against the target it is tracking rather
   * than as a ray: the head is already proven lined up and the line already
   * proven clear, so re-tracing it would only add a way for the sentry to
   * miss a target it can plainly see. Damage goes through the ordinary
   * takeDamage pipeline, so a sentry kill scores, drops and sounds exactly
   * like one of yours.
   */
  _fire(target) {
    this.cooldown = SENTRY_INTERVAL;
    this.flashT = MUZZLE_FLASH;
    this.recoil = 1;
    this.bolt = 1;
    this.shellT = 0.42;
    this.beltStep += 1;
    this.heat = Math.min(HEAT_CEILING, this.heat + HEAT_PER_SHOT);
    this.shotsFired++;
    const wasAlive = target.state !== 'dead';
    const dx = target.position.x - this.position.x, dz = target.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    target.takeDamage(SENTRY_DAMAGE, { x: dx / d, z: dz / d }, 0);
    // A tally is owed on every twenty-fifth confirmed kill; it is paid the
    // next time the arc is quiet, so it never interrupts a fight.
    if (wasAlive && target.state === 'dead') {
      this.kills++;
      if (this.kills % TALLY_EVERY === 0) this._tallyOwed = true;
    }
    this.events.emit('sentry:fire', { pos: this.muzzlePoint(), yaw: this.yaw + this.headYaw });
  }

  /* ================================================================== *
   * PRESENT — push the state onto the rig                               *
   * ================================================================== */

  _present(dt, ctx) {
    const p = this.rig.parts;
    const now = performance.now();

    // A tally that fell due mid-fight is paid at the first quiet moment.
    if (this._tallyOwed && !this.target && !this.routine && this.state === 'scan') {
      this._tallyOwed = false;
      this._begin('tally');
    }

    /* ---- the undercarriage: legs, rams, pads, mast ---- */
    const deploy = this.state === 'deploy' ? Math.min(1, this.stateT / DEPLOY_TIME) : 1;
    const open = ease(deploy);
    // the knee lags the hip by a beat, which is what makes it look driven
    const knee = ease(Math.max(0, Math.min(1, (deploy - 0.18) / 0.82)));
    const shake = this._legShake || 0;
    for (const leg of p.legs) {
      leg.hip.rotation.x = leg.splay * open + shake;
      leg.knee.rotation.x = leg.fold * knee;
      // the pad stays flat to the ground whatever the two joints above it do
      leg.pad.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x);
      // the ram extends as the leg opens — it is doing the work, visibly
      leg.ram.position.y = -0.14 - open * 0.035;
      leg.ram.scale.y = 1 + open * 0.35;
    }
    this._legShake = 0;
    // the mast telescopes up out of the hub, and the body rides it
    p.mastStage.position.y = 0.09 + open * 0.055;
    p.body.position.y = 0.10 + 0.16 * open;

    /* ---- the turret: yaw, its pinion, and the pitch in the trunnion ---- */
    const lastYaw = this._lastHeadYaw ?? this.headYaw;
    p.head.rotation.y = this.headYaw;
    // the pinion is GEARED to the ring: it turns because the head turned, at
    // the ratio the tooth counts imply (28 on the race, 8 on the pinion).
    p.pinion.rotation.y -= (this.headYaw - lastYaw) * (28 / 8);
    this._lastHeadYaw = this.headYaw;
    p.cradle.rotation.x = -this.headPitch - this.recoil * 0.06;

    /* ---- the gun: recoil, bolt, belt, brass ---- */
    p.barrel.position.z = p.barrelZ + this.recoil * 0.045;
    // the bolt runs back and returns, inside the rails, once per round
    p.bolt.position.z = p.boltZ - this.bolt * 0.055;
    // the belt walks toward the feed tray, one link per shot, and the links
    // climb out of the can along a fixed path so the motion reads as feeding
    for (const link of p.belt) {
      const t = ((link.i - this.beltStep * 0.5) % 7 + 7) % 7 / 7;
      link.node.position.set(0.012 + t * 0.052, -0.052 + t * 0.088, 0.006 + t * 0.012);
      link.node.rotation.z = -0.9 + t * 0.9;
    }
    // one spent case, thrown out of the port and falling away
    p.shell.visible = this.shellT > 0;
    if (p.shell.visible) {
      const t = 1 - this.shellT / 0.42;
      p.shell.position.set(0.075 + t * 0.16, 0.012 + t * 0.10 - t * t * 0.26, -0.005 - t * 0.05);
      p.shell.rotation.set(t * 9, t * 5, t * 7);
    }
    p.flash.visible = this.flashT > 0;
    if (p.flash.visible) {
      p.flash.scale.setScalar(0.7 + Math.random() * 0.6);
      p.flash.rotation.z = Math.random() * Math.PI;
    }

    /* ---- the optic: the iris stops down onto a target ---- */
    // wide when it has nothing, tight when it is looking at something — the
    // same thing your own eye does, and legible from across the road.
    const want = this._irisWant ?? (this.target ? 0.18 : 0.62);
    this._irisWant = null;
    this._iris = (this._iris ?? 0) + (want - (this._iris ?? 0)) * Math.min(1, dt * 6);
    for (const b of p.iris) b.blade.position.x = b.home * (0.35 + this._iris * 0.9);
    const lensGlow = this.target ? 0.55 : 0.18;
    p.lensMat.emissive.setRGB(lensGlow * 0.25, lensGlow, lensGlow * 0.7);

    /* ---- heat: louvres crack open, fins glow, and it is visible ---- */
    const h = this.heat;
    for (let i = 0; i < p.vents.length; i++) {
      p.vents[i].rotation.z = -h * (0.5 + i * 0.06);
      p.vents[i].position.x = -0.088 - h * 0.012;
    }
    p.heatMat.emissive.setRGB(h * h * 0.75, h * h * 0.16, 0);

    /* ---- the aerial trails whatever the head just did ---- */
    const swing = (this.headYaw - (this._antLast ?? this.headYaw));
    this._antLast = this.headYaw;
    this._antV = (this._antV ?? 0) * 0.86 - swing * 2.6;
    p.antenna.rotation.z = Math.max(-0.5, Math.min(0.5, this._antV))
      + Math.sin(now * 0.0021) * 0.03;
    p.antenna.rotation.x = Math.sin(now * 0.0017 + 1.1) * 0.03;

    /* ---- the lamps: the one part of it that is actually talking ---- */
    const mode = this._lampMode
      || (this.state === 'cooling' ? 'hot' : this.target ? 'alert' : 'idle');
    this._lampMode = null;
    for (let i = 0; i < p.lamps.length; i++) {
      const m = p.lamps[i].material;
      let r = 0, gg = 0, b = 0;
      if (mode === 'chase') {
        const on = (Math.floor(now * 0.006) % 3) === i ? 1 : 0.08;
        r = on * 0.7; gg = on * 0.6; b = on * 0.1;
      } else if (mode === 'heartbeat') {
        const beat = Math.max(0, Math.sin(now * 0.0016)) ** 8;
        r = beat * 0.25; gg = beat * 0.18; b = beat * 0.03;
      } else if (mode === 'friendly') {
        const on = 0.35 + Math.sin(now * 0.012 + i) * 0.25;
        r = on * 0.15; gg = on * 0.75; b = on * 0.55;
      } else if (mode === 'cross') {
        const on = (Math.floor(now * 0.01) % 2) ? 0.8 : 0.05;
        r = on * 0.85; gg = on * 0.12; b = 0;
      } else if (mode === 'hot') {
        const on = 0.4 + Math.sin(now * 0.009 + i * 1.4) * 0.3;
        r = on * 0.9; gg = on * 0.25; b = 0;
      } else if (mode === 'alert') {
        const on = 0.55 + Math.sin(now * 0.016) * 0.3;
        r = on * 0.95; gg = on * 0.10; b = 0;
      } else {                                   // idle: a slow amber breath
        const on = 0.4 + Math.sin(now * 0.0035 + i * 0.9) * 0.18;
        r = on * 0.55; gg = on * 0.42; b = on * 0.06;
      }
      m.emissive.setRGB(r, gg, b);
    }
    // the old single-lamp material is kept in step, since the ghost shares it
    p.lampMat.emissive.copy(p.lamps[1].material.emissive);
  }

  dispose() {
    this.world.removeInteractable(this.interactable);
    // Every part of the rig is built fresh per sentry (no shared cache), so
    // both halves are this instance's to give back.
    this.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
    });
  }
}
