import { Entity } from './Entity.js';
import { SpriteBillboard } from '../rendering/Billboard.js';
import { Senses } from '../ai/Senses.js';
import { avoidObstacles, gaitWobble } from '../ai/Steering.js';

/**
 * Zombie AI: a small state machine over
 *   idle -> wandering -> alerted -> chasing -> attacking -> dead
 * driven by the shared sensory stack (Senses + steering).
 *
 * Perception model:
 * - The PLAYER is sensed with global awareness — zombies always know where the
 *   player is, anywhere on the map (no range gate). Direct line of sight is
 *   still tracked separately: it decides whether they can attack / beeline vs.
 *   pathfind, and it feeds the optional blind-cull flag below.
 * - FRIENDLY NPCs are sensed the ordinary way: a limited detection range, a
 *   forward field-of-view cone (with a close sixth-sense bubble) and line of
 *   sight. The player always outranks them, so a zombie only hunts a friendly
 *   when there is no live player to chase.
 * - Obstacle whiskers ride under all movement, so zombies feel their way out
 *   of spawn houses and around props instead of grinding on walls.
 *
 * Movement: direct steering when the target is visible, A* on the nav grid
 * otherwise (repaths on a timer, throttled by a global budget). Beyond the
 * activity range zombies idle invisibly and cost nothing.
 *
 * Flags (opt-in, set on `flags` from outside — never default behaviour):
 * - cullBlindSeconds: if > 0, a zombie that cannot get an unobstructed line to
 *   the player for that many seconds is culled (removed without scoring) to
 *   keep a stuck straggler from stalling a wave.
 */
const ACTIVE_RANGE = 115;
const DEATH_TIME = 1.3;
const FRIENDLY_FOV = 3.66;   // ~210° detection cone for non-player targets
const FRIENDLY_PROX = 6;     // ...but anything this close is felt regardless
// Melee "jump" pounce: across each attack wind-up the sprite rises and lunges
// forward on a sine arc, landing exactly as the strike connects. Purely
// cosmetic — the AI, collision and hit test all read `position`, not the mesh.
const JUMP_ARC = 0.18;       // apex height as a fraction of the body height
const JUMP_LUNGE = 0.55;     // forward reach (m) of the pounce at the strike
const EMPTY = [];

export class Zombie extends Entity {
  constructor(config, baseMaterial, world, events) {
    super();
    this.config = config;
    this.world = world;
    this.events = events;
    this.hp = config.hp;
    // Slight per-zombie size variation so a horde never looks stamped from one
    // mould — a shade under to a shade over the type's base height.
    this.sizeScale = 0.9 + Math.random() * 0.2;
    this.height = config.height * config.scale * this.sizeScale;
    this.radius = 0.42 * config.scale * this.sizeScale;
    // Per-zombie gait so movement weaves instead of tracking a straight line.
    this.gaitPhase = Math.random() * Math.PI * 2;
    this.gaitFreq = 1.4 + Math.random() * 1.3;
    this.addTag('zombie');
    this.addTag('hostile');
    this.state = 'idle';
    this.stateTime = Math.random() * 3;
    this.wanderTarget = null;
    this.alertPos = null;
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.attackTimer = 0;
    this.windup = -1;
    this.attackLunge = 0;     // eased forward offset (m) of the current pounce
    this.deathTimer = 0;
    this.toRemove = false;
    this.culled = false;
    this.lastSeenPlayer = 0;
    this.blindTimer = 0;      // time since an unobstructed line to the player
    this.knockVX = 0;
    this.knockVZ = 0;
    this._losTimer = Math.random() * 0.3;
    this._hasLos = false;
    this.victim = null;
    this._victimLos = false;
    this._victimDist = Infinity;

    this.senses = new Senses(world, {
      whiskerRange: 2.2 + this.radius * 2,
      whiskerAngles: [0, 0.55, -0.55, 1.15, -1.15],
      interval: 0.15,
    });

    this.billboard = this._makeBillboard(baseMaterial);
    this.mesh = this.billboard.mesh;
  }

  /**
   * Build this entity's sprite billboard. Split out so archetypes on a
   * differently-laid-out sheet (e.g. the Spitter) can swap in their own layout
   * and aspect without duplicating the rest of the constructor.
   */
  _makeBillboard(baseMaterial) {
    return new SpriteBillboard(baseMaterial, this.height, 0.62);
  }

  placeAt(x, z) {
    const y = this.world.groundHeightFor(x, z, 1e9);
    this.position.set(x, y, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.mesh.position.copy(this.position);
  }

  onNoise(pos, radius) {
    if (this.state === 'dead' || this.state === 'chasing' || this.state === 'attacking') return;
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    if (d > radius) return;
    this.alertPos = { x: pos.x + (Math.random() - 0.5) * 6, z: pos.z + (Math.random() - 0.5) * 6 };
    this._setState('alerted');
  }

  takeDamage(amount, dir = null, knockback = 0) {
    if (this.state === 'dead') return false;
    this.hp -= amount;
    if (knockback > 0 && dir) {
      const k = knockback * (1 - this.config.knockbackResist);
      this.knockVX += dir.x * k;
      this.knockVZ += dir.z * k;
    }
    this.events.emit('zombie:hit', { pos: this.position.clone(), zombie: this });
    if (this.hp <= 0) {
      this._die();
      return true;
    }
    // Getting shot tells you where the shooter is.
    if (this.state === 'idle' || this.state === 'wandering' || this.state === 'alerted') {
      this._setState('chasing');
    }
    return false;
  }

  _die() {
    this.state = 'dead';
    this.deathTimer = 0;
    this.events.emit('zombie:death', {
      type: this.config,
      pos: this.position.clone(),
      points: this.config.points,
    });
  }

  /**
   * Remove without scoring — horde hygiene, not a kill. Frees the wave budget
   * so a zombie that can never reach the player stops stalling the round.
   * Only ever triggered by the opt-in cullBlindSeconds flag.
   */
  _cull() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.toRemove = true;
    this.culled = true; // removed without scoring — the spawn director refunds it
    this.events.emit('zombie:culled', { pos: this.position.clone(), type: this.config });
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s === 'chasing') this.events.emit('zombie:aggro', { pos: this.position.clone() });
  }

  /**
   * Decide who to chase this frame. Player first (global awareness, always
   * known); otherwise the nearest friendly the zombie can actually perceive.
   */
  _acquireVictim(ctx) {
    const player = ctx.player;
    if (player && player.alive) {
      this.victim = player;
      this._victimLos = this._hasLos;
      this._victimDist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      return;
    }
    const f = this.senses.perceiveNearest(this, ctx.friendlies || EMPTY, {
      range: this.config.sightRange,
      fov: FRIENDLY_FOV,
      proximity: FRIENDLY_PROX,
      requireLOS: true,
    });
    this.victim = f ? f.target : null;
    this._victimLos = f ? f.los : false;
    this._victimDist = f ? f.dist : Infinity;
  }

  update(dt, ctx) {
    const { player, camPos, pathBudget } = ctx;
    this.stateTime += dt;

    if (this.state === 'dead') {
      this.deathTimer += dt;
      this.billboard.deathPose(Math.min(1, this.deathTimer / DEATH_TIME));
      if (this.deathTimer >= DEATH_TIME) this.toRemove = true;
      return;
    }

    const pdx = player.position.x - this.position.x;
    const pdz = player.position.z - this.position.z;
    const pdist = Math.hypot(pdx, pdz);

    // Dormant when far away: no AI, no rendering.
    if (pdist > ACTIVE_RANGE) {
      this.mesh.visible = false;
      return;
    }
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
    // Close-range awareness regardless of walls' shadows.
    if (player.alive && pdist < 4) this._hasLos = true;
    if (this._hasLos) this.blindTimer = 0; else this.blindTimer += dt;

    const cullS = this.flags.cullBlindSeconds;
    if (cullS > 0 && player.alive && this.blindTimer > cullS) { this._cull(); return; }

    this._acquireVictim(ctx);
    const victim = this.victim;

    let moveX = 0, moveZ = 0, speed = 0, moving = false;

    if (victim) {
      const vpos = victim.position;
      const vdx = vpos.x - this.position.x, vdz = vpos.z - this.position.z;
      const vdist = this._victimDist;
      const vLos = this._victimLos;
      if (this.state === 'idle' || this.state === 'wandering' || this.state === 'alerted') this._setState('chasing');

      if (this.state === 'attacking') {
        this.yaw = Math.atan2(vdx, vdz);
        if (this.windup > 0) {
          this.windup -= dt;
          if (this.windup <= 0) {
            if (victim.alive && vdist < this.config.reach + 0.4 && Math.abs(vpos.y - this.position.y) < 1.8) {
              victim.takeDamage(this.config.damage, this.position);
            }
            this.attackTimer = this.config.attackCooldown;
          }
        } else {
          this.attackTimer -= dt;
          if (this.attackTimer <= 0) {
            if (vdist < this.config.reach && vLos) this.windup = this.config.attackWindup;
            else this._setState('chasing');
          }
        }
      } else { // chasing
        if (vdist < this.config.reach && vLos && Math.abs(vpos.y - this.position.y) < 1.6) {
          this._setState('attacking');
          this.windup = this.config.attackWindup;
        } else {
          speed = this.config.chaseSpeed;
          moving = true;
          let desX, desZ;
          if (vLos || vdist < 3) {
            desX = vdx; desZ = vdz;
            this.path = null;
          } else {
            // No clear line: pathfind out of the building / around the block.
            this.repathTimer -= dt;
            if ((!this.path || this.repathTimer <= 0) && pathBudget.n > 0) {
              pathBudget.n--;
              this.repathTimer = 1.4 + Math.random() * 0.6;
              this.path = this.world.nav.findPath(this.position.x, this.position.z, vpos.x, vpos.z);
              this.pathIndex = 0;
            }
            if (this.path && this.pathIndex < this.path.length) {
              const [wx, wz] = this.path[this.pathIndex];
              const wd = Math.hypot(wx - this.position.x, wz - this.position.z);
              if (wd < 1.2) { this.pathIndex++; desX = vdx; desZ = vdz; }
              else { desX = wx - this.position.x; desZ = wz - this.position.z; }
            } else {
              desX = vdx; desZ = vdz; // no path: shamble + wall-slide hopefully
              speed *= 0.75;
            }
          }
          const steer = avoidObstacles(desX, desZ, this.senses);
          moveX = steer.x; moveZ = steer.z;
        }
      }
    } else {
      // No victim (player gone, no friendly perceivable): idle / wander /
      // investigate a noise — all with obstacle avoidance so they never stick.
      switch (this.state) {
        case 'chasing':
        case 'attacking':
          this._setState('wandering');
          this.wanderTarget = { x: this.position.x + (Math.random() - 0.5) * 8, z: this.position.z + (Math.random() - 0.5) * 8 };
          break;
        case 'idle':
          if (this.stateTime > 2 + Math.random() * 3) {
            const a = Math.random() * Math.PI * 2;
            const r = 5 + Math.random() * 12;
            this.wanderTarget = { x: this.position.x + Math.cos(a) * r, z: this.position.z + Math.sin(a) * r };
            this._setState('wandering');
          }
          break;
        case 'wandering': {
          const t = this.wanderTarget;
          const wd = Math.hypot(t.x - this.position.x, t.z - this.position.z);
          if (wd < 1 || this.stateTime > 12) { this._setState('idle'); break; }
          const steer = avoidObstacles(t.x - this.position.x, t.z - this.position.z, this.senses);
          moveX = steer.x; moveZ = steer.z;
          speed = this.config.wanderSpeed;
          moving = true;
          break;
        }
        case 'alerted': {
          const t = this.alertPos;
          const ad = Math.hypot(t.x - this.position.x, t.z - this.position.z);
          if (ad < 2.5 || this.stateTime > 16) { this._setState('wandering'); this.wanderTarget = { x: this.position.x + 4, z: this.position.z + 4 }; break; }
          const steer = avoidObstacles(t.x - this.position.x, t.z - this.position.z, this.senses);
          moveX = steer.x; moveZ = steer.z;
          speed = Math.min(this.config.chaseSpeed, this.config.wanderSpeed * 2.2);
          moving = true;
          break;
        }
      }
    }

    // --- integrate movement
    if (moving && speed > 0) {
      // Weave the heading a little (damped when hugging a wall so avoidance
      // still wins), so the horde doesn't converge into straight columns.
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
    // knockback decay
    if (Math.abs(this.knockVX) + Math.abs(this.knockVZ) > 0.01) {
      this.position.x += this.knockVX * dt;
      this.position.z += this.knockVZ * dt;
      this.knockVX *= Math.pow(0.005, dt);
      this.knockVZ *= Math.pow(0.005, dt);
    }
    this.world.collision.resolveCapsule(this.position, this.radius, this.height);
    this.position.y = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.5);

    // --- present: melee attackers pounce on every strike (see JUMP_ARC above).
    // The wind-up drives a sine arc that rises and lunges forward, peaking mid
    // leap and landing (hop back to 0) at the instant the hit lands; the forward
    // lunge then eases back out during the cooldown instead of snapping.
    const attacking = this.state === 'attacking';
    const leaping = attacking && this.windup > 0;
    const p = leaping ? 1 - Math.max(0, this.windup) / this.config.attackWindup : 0;
    const arc = Math.sin(Math.PI * p);          // 0 at take-off/land, 1 at the apex
    const hop = JUMP_ARC * this.height * arc;
    this.attackLunge += ((leaping ? JUMP_LUNGE * p : 0) - this.attackLunge) * Math.min(1, dt * 14);
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    this.mesh.position.set(
      this.position.x + fwdX * this.attackLunge,
      this.position.y + hop,
      this.position.z + fwdZ * this.attackLunge,
    );
    this.mesh.scale.set(1 - 0.06 * arc, 1 + 0.12 * arc, 1); // subtle stretch at the apex
    const fps = this.config.walkFps * (leaping ? 2.2 : this.state === 'chasing' ? 1.4 : 1);
    this.billboard.update(dt, camPos, this.yaw, leaping || moving, fps);
  }

  dispose() {
    this.billboard.dispose();
  }
}
