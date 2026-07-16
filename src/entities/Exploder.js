import { Zombie } from './Zombie.js';
import { SpriteBillboard } from '../rendering/Billboard.js';
import { EXPLODER_LAYOUT } from '../rendering/TextureConfig.js';
import { avoidObstacles, gaitWobble, norm } from '../ai/Steering.js';

/**
 * The Exploder — a Creeper-like suicide bomber built on top of the Zombie stack.
 *
 * It reuses the whole zombie machinery (Senses, obstacle steering, staggered
 * line-of-sight, A* fallback, the spawn/score/weapon pipelines) and only
 * diverges in how it closes the last few metres and how it dies:
 *
 *   chase ▸ it beelines like a Walker while the target is far,
 *   flank ▸ once inside `flankRange` it stops charging head-on and skirts to a
 *           side, spiralling in so it comes up on the target's flank,
 *   fuse  ▸ inside `triggerRange` (with a clear line) it plants itself — it
 *           CANNOT move while the fuse burns — and after `fuseTime` it detonates,
 *   boom  ▸ a radial blast through the real damage pipeline that hurts the
 *           player, chain-detonates other exploders and can gib nearby zombies.
 *
 * It also explodes when killed: the corpse collapses and, `deathExplodeDelay`
 * into the death animation, goes off. Loot is asymmetric — a player kill drops
 * sniper ammo; a self-detonation (or a chain reaction) drops nothing. A fuse the
 * target escapes ends in a `retryCooldown` lockout before it may try again.
 */
const ACTIVE_RANGE = 115;   // matches the base zombie's dormancy radius
const BOOM_LINGER = 0.35;   // corpse hangs a beat after the blast, then is culled
const ABORT_FACTOR = 1.6;   // target this far past triggerRange aborts the fuse
// The CS:GO sheet draws the bomber's feet flush to the very bottom edge of each
// cell — no ground margin like the other sheets carry — so the billboard's foot
// pivot sits a touch into the ground. Lift the sprite by this fraction of its
// height (purely visual: the AI/collision/blast all read `position`, not the
// mesh) to seat the feet ON the ground instead of clipping into it.
const FOOT_LIFT = 0.015;
const EMPTY = [];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Exploder extends Zombie {
  constructor(config, baseMaterial, world, events) {
    super(config, baseMaterial, world, events);
    this.addTag('exploder');
    // Which way it prefers to skirt — committed at spawn so it never dithers
    // left/right on the boundary.
    this.flankSign = Math.random() < 0.5 ? -1 : 1;
    this._fuse = -1;            // >= 0 while a fuse is burning (the NPC is paused)
    this._retryCd = 0;         // lockout after a fuse the target got out of
    this._exploded = false;    // guards against a second detonation
    this.killedByPlayer = false;
    this._boomAt = 0;          // deathTimer at which the spent corpse is removed
    // Remember the resting sprite tint so the priming flash can be undone.
    this._baseColor = this.billboard.material.color.clone();
  }

  /** The Exploder's CS:GO sheet is addressed by per-row bands (see
   *  EXPLODER_LAYOUT) so a turning bomber never shows the row above's boots. */
  _makeBillboard(baseMaterial) {
    return new SpriteBillboard(baseMaterial, this.height, EXPLODER_LAYOUT.aspect, EXPLODER_LAYOUT);
  }

  /** A primed fuse must never be knocked back into 'alerted' by a stray noise. */
  onNoise(pos, radius) {
    if (this.state === 'fuse') return;
    super.onNoise(pos, radius);
  }

  /**
   * Damage handler. `byPlayer` distinguishes a bullet/bat hit (which earns the
   * sniper-ammo drop) from blast damage dealt by another exploder (which does
   * not). Weapon code calls the 3-arg form, so `byPlayer` defaults to true.
   */
  takeDamage(amount, dir = null, knockback = 0, byPlayer = true) {
    if (this.state === 'dead') return false;
    this.hp -= amount;
    if (knockback > 0 && dir) {
      const k = knockback * (1 - this.config.knockbackResist);
      this.knockVX += dir.x * k;
      this.knockVZ += dir.z * k;
    }
    this.events.emit('zombie:hit', { pos: this.position.clone(), zombie: this });
    if (this.hp <= 0) {
      this.killedByPlayer = byPlayer;
      this._enterDeath(byPlayer);
      return true;
    }
    if (this.state === 'idle' || this.state === 'wandering' || this.state === 'alerted') {
      this._setState('chasing');
    }
    return false;
  }

  /** Begin the death sequence (the blast itself fires later, from update). */
  _enterDeath(byPlayer) {
    this._resetPrimeLook();
    this.state = 'dead';
    this.deathTimer = 0;
    this._fuse = -1;
    // Sniper ammo ONLY when the player scored the kill; a self/chain detonation
    // carries an explicit `null` so the spawn director drops nothing.
    this.events.emit('zombie:death', {
      type: this.config,
      pos: this.position.clone(),
      points: this.config.points,
      loot: byPlayer ? 'ammo_sniper' : null,
    });
  }

  update(dt, ctx) {
    this.stateTime += dt;

    // ---- dead: collapse, detonate near the end of the anim, then linger ----
    if (this.state === 'dead') {
      this.deathTimer += dt;
      if (!this._exploded) {
        this.billboard.deathPose(Math.min(1, this.deathTimer / this.config.deathExplodeDelay));
        if (this.deathTimer >= this.config.deathExplodeDelay) {
          this._explode(ctx);
          this._boomAt = this.deathTimer + BOOM_LINGER;
        }
      } else if (this.deathTimer >= this._boomAt) {
        this.toRemove = true;
      }
      return;
    }

    const player = ctx.player;
    const pdx = player.position.x - this.position.x;
    const pdz = player.position.z - this.position.z;
    const pdist = Math.hypot(pdx, pdz);

    // Dormant when far away: no AI, no rendering.
    if (pdist > ACTIVE_RANGE) { this.mesh.visible = false; return; }
    this.mesh.visible = true;

    this.senses.update(dt, this);

    // Staggered line-of-sight to the player + the blind timer for the cull flag.
    this._losTimer -= dt;
    if (this._losTimer <= 0) {
      this._losTimer = 0.25 + Math.random() * 0.15;
      this._hasLos = player.alive && this.senses.lineOfSight(this, player);
      if (this._hasLos) this.lastSeenPlayer = 0;
    }
    this.lastSeenPlayer += dt;
    if (player.alive && pdist < 4) this._hasLos = true;
    if (this._hasLos) this.blindTimer = 0; else this.blindTimer += dt;

    const cullS = this.flags.cullBlindSeconds;
    if (cullS > 0 && player.alive && this.blindTimer > cullS) { this._cull(); return; }

    if (this._retryCd > 0) this._retryCd -= dt;

    this._acquireVictim(ctx);
    const victim = this.victim;

    // ---- fuse: frozen in place while the quarter-second timer runs down ----
    if (this.state === 'fuse') {
      const held = this._tickFuse(dt, ctx, victim);
      if (held === 'boom') return;                       // detonated + died
      if (victim) this.yaw = Math.atan2(victim.position.x - this.position.x, victim.position.z - this.position.z);
      this._present(dt, ctx, false);                     // stationary pose
      if (this.state === 'fuse') this._primeLook();      // pulse only while priming
      return;
    }

    let moveX = 0, moveZ = 0, speed = 0, moving = false;

    if (victim) {
      const vdx = victim.position.x - this.position.x;
      const vdz = victim.position.z - this.position.z;
      const vdist = this._victimDist;
      const vLos = this._victimLos;
      if (this.state === 'idle' || this.state === 'wandering' || this.state === 'alerted') this._setState('chasing');

      // Close enough, seen, off cooldown, on the same level → light the fuse.
      if (vdist <= this.config.triggerRange && vLos && this._retryCd <= 0 &&
          Math.abs(victim.position.y - this.position.y) < 1.8) {
        this._setState('fuse');
        this._fuse = this.config.fuseTime;
        this.yaw = Math.atan2(vdx, vdz);
        this._present(dt, ctx, false);
        this._primeLook();
        return;
      }

      // Otherwise close the distance — head-on far out, skirting once inside
      // flankRange — with A* as a fallback when the line is blocked.
      speed = this.config.chaseSpeed;
      moving = true;
      let desX, desZ;
      if (vLos || vdist < 3) {
        const app = this._approach(victim, vdx, vdz, vdist, victim === player);
        desX = app.x; desZ = app.z;
        this.path = null;
      } else {
        this.repathTimer -= dt;
        if ((!this.path || this.repathTimer <= 0) && ctx.pathBudget.n > 0) {
          ctx.pathBudget.n--;
          this.repathTimer = 1.4 + Math.random() * 0.6;
          this.path = this.world.nav.findPath(this.position.x, this.position.z, victim.position.x, victim.position.z);
          this.pathIndex = 0;
        }
        if (this.path && this.pathIndex < this.path.length) {
          const [wx, wz] = this.path[this.pathIndex];
          const wd = Math.hypot(wx - this.position.x, wz - this.position.z);
          if (wd < 1.2) { this.pathIndex++; desX = vdx; desZ = vdz; }
          else { desX = wx - this.position.x; desZ = wz - this.position.z; }
        } else {
          desX = vdx; desZ = vdz; speed *= 0.75;
        }
      }
      const steer = avoidObstacles(desX, desZ, this.senses);
      moveX = steer.x; moveZ = steer.z;
    } else {
      // No victim (player dead, no friendly in range): idle / wander gently.
      switch (this.state) {
        case 'chasing': case 'attacking': case 'fuse':
          this._resetPrimeLook();
          this._setState('wandering');
          this.wanderTarget = { x: this.position.x + (Math.random() - 0.5) * 8, z: this.position.z + (Math.random() - 0.5) * 8 };
          break;
        case 'wandering': {
          const t = this.wanderTarget;
          const wd = t ? Math.hypot(t.x - this.position.x, t.z - this.position.z) : 0;
          if (!t || wd < 1 || this.stateTime > 12) { this._setState('idle'); break; }
          const steer = avoidObstacles(t.x - this.position.x, t.z - this.position.z, this.senses);
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
    this._present(dt, ctx, moving);
  }

  /**
   * Approach direction. Far out it's a straight beeline; inside `flankRange` it
   * blends an inward pull with a sideways "skirt" so it spirals in and comes up
   * on a flank. For the player the skirt uses the player's own right vector, so
   * it deliberately swings toward a side rather than walking into their sights.
   */
  _approach(victim, vdx, vdz, vdist, isPlayer) {
    const cfg = this.config;
    if (vdist >= cfg.flankRange) return { x: vdx, z: vdz };
    const to = norm(vdx, vdz);
    let tanX, tanZ;
    if (isPlayer) {
      // Player right vector (yaw 0 faces -Z; right is +X), chosen side per NPC.
      tanX = Math.cos(victim.yaw) * this.flankSign;
      tanZ = -Math.sin(victim.yaw) * this.flankSign;
    } else {
      tanX = -to.z * this.flankSign;
      tanZ = to.x * this.flankSign;
    }
    // Closer ⇒ skirt harder, but always keep enough inward pull to spiral in
    // and eventually cross the trigger ring rather than orbit forever.
    const t = clamp01((vdist - cfg.triggerRange) / (cfg.flankRange - cfg.triggerRange));
    const inward = 0.45 + 0.35 * t;   // 0.45 point-blank → 0.80 at the band edge
    const skirt = 1.0 - 0.35 * t;     // 1.00 point-blank → 0.65 at the band edge
    return norm(to.x * inward + tanX * skirt, to.z * inward + tanZ * skirt);
  }

  /**
   * Advance the burning fuse. Returns 'boom' if it detonated (and died), 'abort'
   * if the target slipped away (→ chase again after a cooldown), else 'hold'.
   */
  _tickFuse(dt, ctx, victim) {
    const cfg = this.config;
    const lost = !victim || victim.alive === false ||
      this._victimDist > cfg.triggerRange * ABORT_FACTOR || !this._victimLos;
    if (lost) {
      this._setState('chasing');
      this._fuse = -1;
      this._retryCd = cfg.retryCooldown;
      this._resetPrimeLook();
      return 'abort';
    }
    this._fuse -= dt;
    if (this._fuse <= 0) {
      this._explode(ctx);            // immediate attack blast
      this._enterDeath(false);       // scores + death sound; no ammo (its own doing)
      this._boomAt = this.deathTimer + BOOM_LINGER;
      return 'boom';
    }
    return 'hold';
  }

  /**
   * Detonate: swap the sprite for the blast, announce it (FX + sound) and push
   * radial damage through the ordinary takeDamage pipeline so it hurts the
   * player, chain-triggers other exploders and can gib nearby zombies.
   */
  _explode(ctx) {
    if (this._exploded) return;
    this._exploded = true;
    this._resetPrimeLook();
    this.billboard.mesh.visible = false;   // the sprite is replaced by the explosion
    this.events.emit('exploder:explode', { pos: this.position.clone(), radius: this.config.explodeRadius });

    this._blast(ctx.player, false);
    for (const z of ctx.zombies || EMPTY) if (z !== this) this._blast(z, true);
    for (const f of ctx.friendlies || EMPTY) this._blast(f, false);
  }

  _blast(target, isZombie) {
    if (!target || target.alive === false || target.state === 'dead') return;
    const cfg = this.config;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d >= cfg.explodeRadius) return;
    const dmg = cfg.explodeDamage * (1 - d / cfg.explodeRadius); // linear falloff
    if (dmg <= 0) return;
    if (isZombie) {
      target.takeDamage(dmg, norm(dx, dz), cfg.explodeKnockback, false); // false: not a player kill
    } else {
      target.takeDamage(dmg, this.position); // player / friendly signatures
    }
  }

  /* ---------------- shared integrate + present (mirrors Zombie) ---------------- */

  _move(dt, ctx, moveX, moveZ, speed, moving) {
    if (moving && speed > 0) {
      const amp = 0.16 * (1 - this.senses.avoid.strength);
      const w = gaitWobble(moveX, moveZ, ctx.time || 0, this.gaitPhase, this.gaitFreq, amp);
      moveX = w.x; moveZ = w.z;
      const slope = this.world.terrain.slopeAlong(this.position.x, this.position.z, moveX, moveZ);
      let s = speed;
      if (slope > 0.35) s /= 1 + (slope - 0.35) * 2;
      this.position.x += moveX * s * dt;
      this.position.z += moveZ * s * dt;
      this.yaw = Math.atan2(moveX, moveZ);
    }
    if (Math.abs(this.knockVX) + Math.abs(this.knockVZ) > 0.01) {
      this.position.x += this.knockVX * dt;
      this.position.z += this.knockVZ * dt;
      this.knockVX *= Math.pow(0.005, dt);
      this.knockVZ *= Math.pow(0.005, dt);
    }
    this.world.collision.resolveCapsule(this.position, this.radius, this.collisionHeight);
    this.position.y = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.5);
  }

  _present(dt, ctx, moving) {
    this.mesh.position.copy(this.position);
    this.mesh.position.y += this.height * FOOT_LIFT; // seat the feet on the ground (see FOOT_LIFT)
    this.billboard.update(dt, ctx.camPos, this.yaw, moving, this.config.walkFps * (this.state === 'chasing' ? 1.4 : 1));
  }

  /* ---------------- priming flash (Creeper-style tell) ---------------- */

  _primeLook() {
    const t = 1 - Math.max(0, this._fuse) / this.config.fuseTime; // 0 → 1 over the fuse
    const flash = 0.5 + 0.5 * Math.sin(t * Math.PI * 14);         // rapid blink
    const k = 1 + 0.14 * t + 0.05 * flash;                        // swell + jitter
    this.billboard.mesh.scale.set(k, k, 1);
    const c = this.billboard.material.color;
    c.copy(this._baseColor);
    c.r = Math.min(1, c.r + 0.6 * t + 0.3 * flash);               // flare to hot orange-white
    c.g = Math.min(1, c.g + 0.3 * t + 0.15 * flash);
  }

  _resetPrimeLook() {
    this.billboard.mesh.scale.set(1, 1, 1);
    this.billboard.material.color.copy(this._baseColor);
  }
}
