import * as THREE from '../../lib/three.module.js';
import { Zombie } from './Zombie.js';
import { SpriteBillboard } from '../rendering/Billboard.js';
import { SPITTER_LAYOUT } from '../rendering/TextureConfig.js';
import { contextSteer, norm } from '../ai/Steering.js';

/**
 * The Spitter — a CS:GO-styled dual-pistol ranged enemy, built on the Zombie
 * stack so it inherits the whole shared machinery (Senses, obstacle steering,
 * staggered line-of-sight, A* fallback, the spawn/score/hit/death pipelines and
 * the blind-cull flag). Only its movement intent and firing diverge:
 *
 *   kite  ▸ it holds a short standoff band (~6–8 ft) around the player: too
 *           close and it back-pedals, too far and it closes in, and while in the
 *           band it circle-strafes for organic movement. It walks a touch slower
 *           than the player, so a determined player can still run it down.
 *   aim   ▸ once settled in-band with a clear line it PLANTS itself — it does
 *           NOT move and shoot at the same time — and pauses `aimTime`
 *           (a quarter-second) facing the player, showing the raised-pistols
 *           aim pose. That pause is the tell that makes the enemy dodgeable.
 *   fire  ▸ it snaps to the muzzle-flash pose and looses a single hitscan shot
 *           with `spread` degrees of variance, then holds the fire pose a beat.
 *           The shot is aimed where the player WAS when the pause began, so a
 *           player who strafes during the tell slips it; combined with spread,
 *           not every shot connects.
 *
 * The sheet (npc_csgo_midrange_double_pistol_gunholder.png) carries directional
 * walk rows plus a dedicated top row of front-facing aim/fire poses; the Spitter
 * turns to face the player to shoot, so the front poses read correctly.
 */
const DEATH_TIME = 1.3;     // matches the base zombie's death dissolve
const PLAYER_HIT_RADIUS = 0.5; // torso half-width the shot must pass within
const EMPTY = [];

export class Spitter extends Zombie {
  constructor(config, baseMaterial, world, events) {
    super(config, baseMaterial, world, events);
    this.addTag('spitter');
    // Which way it prefers to circle — flipped periodically so it weaves rather
    // than orbiting one way forever.
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this._strafeTimer = 1 + Math.random() * 2;
    this._aim = -1;             // >= 0 while pausing to fire (the windup)
    this._firePose = 0;         // > 0 while the muzzle-flash pose lingers
    this._cd = 0.6 + Math.random() * 0.9; // stagger the first shot across a group
    this._aimAt = null;         // player position sampled when the pause began
  }

  /** The Spitter reads a differently-laid-out sheet (5 rows + pose row). */
  _makeBillboard(baseMaterial) {
    return new SpriteBillboard(baseMaterial, this.height, SPITTER_LAYOUT.aspect, SPITTER_LAYOUT);
  }

  update(dt, ctx) {
    this.stateTime += dt;

    // ---- dead: collapse + dissolve (same as the base zombie) ----
    if (this.state === 'dead') {
      this.deathTimer += dt;
      this.billboard.deathPose(Math.min(1, this.deathTimer / DEATH_TIME));
      if (this.deathTimer >= DEATH_TIME) this.toRemove = true;
      return;
    }

    // Dormancy, sensory ring, staggered player LOS, blind-cull flag and victim
    // acquisition are all the shared hunter perception on Zombie.
    if (!this._sense(dt, ctx)) return;
    if (this._cd > 0) this._cd -= dt;
    if (this._firePose > 0) this._firePose -= dt;
    const victim = this.victim;

    // ---- firing: the muzzle-flash pose holds a beat (planted, no movement) ----
    if (this.state === 'firing') {
      if (victim) this.yaw = this._faceYaw(victim);
      if (this._firePose <= 0) this._setState(victim ? 'chasing' : 'wandering');
      this._present(dt, ctx, false, 'fire');
      return;
    }

    // ---- aiming: the quarter-second pause, then the shot (planted, no move) ----
    if (this.state === 'aiming') {
      const lost = !victim || victim.alive === false || !this._victimLos ||
        this._victimDist > this.config.disengageRange;
      if (lost) {
        this._aim = -1;
        this._setState(victim ? 'chasing' : 'wandering');
        this._present(dt, ctx, false, 'walk');
        return;
      }
      this.yaw = this._faceYaw(victim);
      this._aim -= dt;
      if (this._aim <= 0) { this._fire(ctx, victim); return; }
      this._present(dt, ctx, false, 'aim');
      return;
    }

    // ---- moving / kiting ----
    let moveX = 0, moveZ = 0, speed = 0, moving = false;

    if (victim) {
      const vdx = victim.position.x - this.position.x;
      const vdz = victim.position.z - this.position.z;
      const vdist = this._victimDist;
      const vLos = this._victimLos;
      const cfg = this.config;
      if (this.state === 'idle' || this.state === 'wandering' || this.state === 'alerted') this._setState('chasing');

      const inBand = vdist >= cfg.standoffMin && vdist <= cfg.standoffMax;

      // Settled in the standoff band, clear line, off cooldown, same level →
      // plant and begin the aim pause. Sample the aim point NOW so a player who
      // jukes during the tell can slip the shot.
      if (inBand && vLos && this._cd <= 0 && Math.abs(victim.position.y - this.position.y) < 1.8) {
        this._setState('aiming');
        this._aim = cfg.aimTime;
        this._aimAt = this._torsoPoint(victim);
        this.yaw = Math.atan2(vdx, vdz);
        this._present(dt, ctx, false, 'aim');
        return;
      }

      // Otherwise reposition to hold the band, circle-strafing for organic
      // motion while it can see the target; when it cannot, the shared
      // navigator routes it back into a firing position (doorways, exit hunt
      // and unwedging included).
      speed = cfg.chaseSpeed;
      this._strafeTimer -= dt;
      if (this._strafeTimer <= 0) { this._strafeTimer = 1.5 + Math.random() * 2.5; this.strafeSign *= -1; }

      const direct = vLos || vdist < 3;
      const step = this.nav.steer(dt, this, this._victimPoint, {
        direct,
        desired: direct ? this._kite(vdx, vdz, vdist) : null,
        budget: ctx.pathBudget,
        senses: this.senses,
      });
      if (step) {
        moveX = step.x; moveZ = step.z; speed *= step.scale; moving = true;
      }
    } else {
      // No victim (player gone, no friendly perceivable): idle / wander gently.
      switch (this.state) {
        case 'chasing': case 'aiming': case 'firing':
          this._aim = -1;
          this._setState('wandering');
          this.wanderTarget = { x: this.position.x + (Math.random() - 0.5) * 8, z: this.position.z + (Math.random() - 0.5) * 8 };
          break;
        case 'wandering': {
          const t = this.wanderTarget;
          const wd = t ? Math.hypot(t.x - this.position.x, t.z - this.position.z) : 0;
          if (!t || wd < 1 || this.stateTime > 12) { this._setState('idle'); break; }
          const steer = contextSteer(t.x - this.position.x, t.z - this.position.z, this.senses);
          moveX = steer.x; moveZ = steer.z; speed = this.config.wanderSpeed; moving = true;
          break;
        }
        default:
          if (this.stateTime > 2 + Math.random() * 3) {
            const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 10;
            this.wanderTarget = { x: this.position.x + Math.cos(a) * r, z: this.position.z + Math.sin(a) * r };
            this._setState('wandering');
          } else if (this.state !== 'idle') {
            this._setState('idle');
          }
      }
    }

    this._move(dt, ctx, moveX, moveZ, speed, moving);
    this._present(dt, ctx, moving, 'walk');
  }

  /**
   * Desired kite direction: a radial term to hold the standoff band (retreat if
   * too close, advance if too far, neutral in-band) blended with a tangential
   * strafe so it circles the player instead of shuffling straight in and out.
   */
  _kite(vdx, vdz, vdist) {
    const cfg = this.config;
    const to = norm(vdx, vdz); // toward the player
    let radial = 0;
    if (vdist < cfg.standoffMin) radial = -1;      // too close → back off
    else if (vdist > cfg.standoffMax) radial = 1;  // too far → close in
    const tanX = -to.z * this.strafeSign, tanZ = to.x * this.strafeSign;
    // Strafe hard when holding the band, less so when it needs to cover ground.
    const strafe = radial === 0 ? cfg.strafe : cfg.strafe * 0.5;
    return norm(to.x * radial + tanX * strafe, to.z * radial + tanZ * strafe);
  }

  /** Fire one spread shot at the sampled aim point; resolve the hit vs the
   *  player's CURRENT position so movement during the tell can dodge it. */
  _fire(ctx, victim) {
    const cfg = this.config;
    const gun = this._gunMuzzle();
    const aim = this._aimAt || this._torsoPoint(victim);

    // Base direction toward where the player was when the pause began.
    let dx = aim.x - gun.x, dy = aim.y - gun.y, dz = aim.z - gun.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const dir = this._applySpread(dx / dist, dy / dist, dz / dist, cfg.spread);

    // Hit test: closest approach of the shot ray to the player's live torso.
    const hit = this._hasLos && this._rayHitsPoint(gun, dir, this._torsoPoint(victim), PLAYER_HIT_RADIUS);
    if (hit && typeof victim.takeDamage === 'function') {
      victim.takeDamage(cfg.damage, this.position);
    }

    this.events.emit('spitter:fire', {
      pos: gun, dir, hit, target: new THREE.Vector3(aim.x, aim.y, aim.z),
    });

    this._cd = cfg.fireCooldown;
    this._aim = -1;
    this._firePose = cfg.firePoseTime;
    this._setState('firing');
    this.yaw = this._faceYaw(victim);
    this._present(0, ctx, false, 'fire');
  }

  /** Rotate a unit direction by a random angle within a `spreadDeg` cone. */
  _applySpread(x, y, z, spreadDeg) {
    if (spreadDeg <= 0) return { x, y, z };
    const rad = spreadDeg * Math.PI / 180;
    const theta = rad * Math.sqrt(Math.random());  // cone-uniform
    const phi = Math.random() * Math.PI * 2;
    // Orthonormal basis around the aim direction.
    const w = new THREE.Vector3(x, y, z).normalize();
    const a = Math.abs(w.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(w, a).normalize();
    const up = new THREE.Vector3().crossVectors(right, w);
    const out = w.multiplyScalar(Math.cos(theta))
      .addScaledVector(right, Math.sin(theta) * Math.cos(phi))
      .addScaledVector(up, Math.sin(theta) * Math.sin(phi))
      .normalize();
    return { x: out.x, y: out.y, z: out.z };
  }

  /** True if the ray from `o` along unit `dir` passes within `r` of point `c`. */
  _rayHitsPoint(o, dir, c, r) {
    const ocx = c.x - o.x, ocy = c.y - o.y, ocz = c.z - o.z;
    const t = ocx * dir.x + ocy * dir.y + ocz * dir.z; // projection onto the ray
    if (t < 0 || t > this.config.sightRange) return false;
    const px = o.x + dir.x * t - c.x;
    const py = o.y + dir.y * t - c.y;
    const pz = o.z + dir.z * t - c.z;
    return px * px + py * py + pz * pz <= r * r;
  }

  _gunMuzzle() {
    return new THREE.Vector3(this.position.x, this.position.y + this.height * 0.55, this.position.z);
  }

  _torsoPoint(target) {
    return new THREE.Vector3(
      target.position.x,
      target.position.y + (target.height ?? 1.6) * 0.5,
      target.position.z,
    );
  }

  _faceYaw(target) {
    return Math.atan2(target.position.x - this.position.x, target.position.z - this.position.z);
  }

  /* ---------------- present (movement integration is Zombie._move) ---------------- */

  _present(dt, ctx, moving, pose = 'walk') {
    this.mesh.position.copy(this.position);
    const L = SPITTER_LAYOUT;
    if (pose === 'aim') this.billboard.poseCell(ctx.camPos, L.pose.aim.col, L.pose.aim.row);
    else if (pose === 'fire') this.billboard.poseCell(ctx.camPos, L.pose.fire.col, L.pose.fire.row);
    else this.billboard.update(dt, ctx.camPos, this.yaw, moving, this.config.walkFps * (this.state === 'chasing' ? 1.2 : 1));
  }
}
