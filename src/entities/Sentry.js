import * as THREE from '../../lib/three.module.js';
import { Entity } from './Entity.js';
import { WEAPON_CONFIGS } from '../weapons/WeaponConfigs.js';
import { buildSentryModel, SENTRY_SCALE } from '../rendering/SentryModel.js';

/**
 * THE PORTABLE SENTRY — a tripod-mounted automatic pistol you buy from the
 * vendor, carry in the satchel, and set down where you expect the line to
 * break.
 *
 * Its whole design is one trade: it shoots for you, but only where you pointed
 * it. The gun sits on a yaw ring that sweeps a 180° arc centred on the way it
 * was facing when you put it down — everything in front of it is covered,
 * everything behind it is not — and it reaches SENTRY_RANGE, which is about
 * twenty feet. It is a pistol on a stand, quite literally: it fires at the
 * pistol's rate, for the pistol's damage, off the same numbers in
 * WeaponConfigs, so it is never better than the gun in your hand — it is just
 * a second one that never gets tired and never looks the wrong way.
 *
 * The horde does not know it is there. Zombies acquire the player and then the
 * shared `friendlies` roster; a sentry is on neither, so nothing shoots back,
 * walks into it or beats on it. That is deliberate: a turret the horde could
 * kill would be a thing you stand and defend, and this is a thing you leave
 * behind you and walk away from.
 *
 * Behaviour:
 *   stow    it is in the satchel, not in the world at all
 *   deploy  the legs kick out and the head cycles once — it cannot fire yet
 *   scan    no target: the head sweeps its arc, slowly, side to side
 *   track   a target in the arc and in range: the head turns onto it, and the
 *           barrel fires the moment it is lined up
 *   pickup  press [E] on it and it folds back into the satchel
 */
const PISTOL = WEAPON_CONFIGS.find((c) => c.id === 'pistol');
/** ~20 feet. The number the design is stated in, converted once, here. */
export const SENTRY_RANGE = 20 * 0.3048;      // 6.096 m
export const SENTRY_ARC = Math.PI;            // 180°, centred on its facing
export const SENTRY_DAMAGE = PISTOL.damage;         // 12 — the pistol's, exactly
export const SENTRY_INTERVAL = PISTOL.fireInterval; // 0.26 s — likewise
const DEPLOY_TIME = 0.85;
const SCAN_SPEED = 0.85;      // rad/s while sweeping for something to shoot
const TRACK_SPEED = 4.2;      // rad/s slewing onto a target
const AIM_TOLERANCE = 0.12;   // how lined up it must be before it will fire
const MUZZLE_FLASH = 0.06;
// Barrel height above the sentry's foot, and how far the muzzle stands out
// from the mount — both taken off the model so they follow it if it is
// resized rather than being two more numbers to keep in step by hand.
const EYE_H = 0.52 * SENTRY_SCALE;
const MUZZLE_OUT = 0.22 * SENTRY_SCALE;

export class Sentry extends Entity {
  constructor(events, world, texLib, { x, z, yaw }) {
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
    this.scanDir = Math.random() < 0.5 ? -1 : 1;
    this.cooldown = 0;
    this.flashT = 0;
    this.recoil = 0;
    this.target = null;
    this.shotsFired = 0;
    this.toRemove = false;

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
    this.recoil = Math.max(0, this.recoil - dt * 6);

    if (this.state === 'deploy') {
      if (this.stateT >= DEPLOY_TIME) { this.state = 'scan'; this.stateT = 0; }
      this._present(dt);
      return;
    }

    const limit = SENTRY_ARC / 2;
    this.target = this._acquire(ctx?.zombies);

    if (this.target) {
      if (this.state !== 'track') { this.state = 'track'; this.stateT = 0; }
      const want = Math.max(-limit, Math.min(limit, this._bearingTo(this.target)));
      const step = TRACK_SPEED * dt;
      const delta = want - this.headYaw;
      this.headYaw += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
      if (Math.abs(want - this.headYaw) < AIM_TOLERANCE && this.cooldown <= 0) this._fire(this.target);
    } else {
      if (this.state !== 'scan') { this.state = 'scan'; this.stateT = 0; }
      this.headYaw += this.scanDir * SCAN_SPEED * dt;
      if (this.headYaw > limit) { this.headYaw = limit; this.scanDir = -1; }
      if (this.headYaw < -limit) { this.headYaw = -limit; this.scanDir = 1; }
    }
    this._present(dt);
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
    this.shotsFired++;
    const dx = target.position.x - this.position.x, dz = target.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    target.takeDamage(SENTRY_DAMAGE, { x: dx / d, z: dz / d }, 0);
    this.events.emit('sentry:fire', { pos: this.muzzlePoint(), yaw: this.yaw + this.headYaw });
  }

  /* ---- present ---- */

  _present(dt) {
    const p = this.rig.parts;
    // deploy: the legs swing down and the head does one full sweep of its arc
    const deploy = this.state === 'deploy' ? Math.min(1, this.stateT / DEPLOY_TIME) : 1;
    const legDrop = deploy * deploy * (3 - 2 * deploy);
    for (const leg of p.legs) leg.group.rotation.x = leg.rest * legDrop;
    p.body.position.y = 0.10 + 0.16 * legDrop;
    if (this.state === 'deploy') this.headYaw = Math.sin(deploy * Math.PI * 2) * (SENTRY_ARC / 2);

    p.head.rotation.y = this.headYaw;
    // the barrel rides back on the recoil spring and the shroud rocks with it
    p.barrel.position.z = p.barrelZ + this.recoil * 0.045;
    p.head.rotation.x = -this.recoil * 0.06;
    p.flash.visible = this.flashT > 0;
    if (p.flash.visible) {
      p.flash.scale.setScalar(0.7 + Math.random() * 0.6);
      p.flash.rotation.z = Math.random() * Math.PI;
    }
    // the status lamp: amber hunting, red on a target, both breathing
    const hot = this.target ? 1 : 0;
    const pulse = 0.55 + Math.sin(performance.now() * 0.006) * 0.2;
    p.lampMat.emissive.setRGB(pulse * (0.35 + hot * 0.65), pulse * (0.28 - hot * 0.2), pulse * 0.05);
    // the sensor dish keeps turning whatever the gun is doing
    p.dish.rotation.y += dt * (this.target ? 5.5 : 1.6);
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
