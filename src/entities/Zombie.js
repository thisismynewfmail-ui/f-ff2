import { Entity } from './Entity.js';
import { SpriteBillboard } from '../rendering/Billboard.js';
import { Senses } from '../ai/Senses.js';
import { NavAgent } from '../ai/NavAgent.js';
import { contextSteer, gaitWobble } from '../ai/Steering.js';
import { aiFlag } from '../ai/Flags.js';

/**
 * Zombie AI: a small state machine over
 *   idle -> wandering -> alerted -> chasing -> attacking -> dead
 * driven by the shared AI stack (Senses + NavAgent + steering). Everything in
 * here is inherited by the Exploder and the Spitter, which swap out only how
 * they close the last few metres.
 *
 * Perception model:
 * - The PLAYER is sensed with global awareness — zombies always know where the
 *   player is, anywhere on the map (no range gate). Direct line of sight is
 *   still tracked separately: it decides whether they can attack / beeline vs.
 *   pathfind, and it feeds the optional blind-cull flag below.
 * - FRIENDLY NPCs are sensed the ordinary way: a limited detection range, a
 *   forward field-of-view cone (with a close sixth-sense bubble) and line of
 *   sight. The player always outranks them, so a zombie only hunts a friendly
 *   when there is no live player to chase. Losing sight of a friendly does not
 *   erase it: the hunter keeps going to where it last saw the target for a few
 *   seconds before giving up, so ducking behind a wall buys time rather than
 *   instant amnesia.
 * - The sensory ring rides under all movement, so zombies feel their way out of
 *   spawn houses and around props instead of grinding on walls.
 *
 * Movement is delegated wholesale to the shared NavAgent: direct steering when
 * the target is in sight, A* on the nav grid otherwise (repaths on a timer,
 * throttled by a global budget), doorway portals threaded exactly, an exit
 * hunt when the grid has no answer, and lateral recovery when a prop wedges
 * them. Beyond the activity range zombies idle invisibly and cost nothing.
 *
 * Flags (opt-in, stamped on `flags` from outside — never default behaviour;
 * see src/ai/Flags.js):
 * - cullBlindSeconds: a zombie that cannot get an unobstructed line to the
 *   player for that many seconds is culled (removed without scoring) so a
 *   stuck straggler cannot stall a wave.
 * - friendlyRangeMul / noWander / deaf: detection reach, idle behaviour, and
 *   whether noises are heard at all.
 */
// Chatter: how far a voice carries, and how long a fighter goes between
// offering one. Long on purpose — the throttle downstream is what decides how
// many are heard, but a short timer here would have every one of them queued.
const CHATTER_RANGE = 30;
const CHATTER_GAP = 11;
const CHATTER_SPREAD = 15;
const ACTIVE_RANGE = 115;
const DEATH_TIME = 1.3;
const FRIENDLY_FOV = 3.66;   // ~210° detection cone for non-player targets
const FRIENDLY_PROX = 6;     // ...but anything this close is felt regardless
const FRIENDLY_MEMORY = 6;   // seconds a lost friendly is still hunted for
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
    // Navigation-capsule height. Defaults to the visual height, but a type may
    // set `collisionHeight` to keep an over-tall sprite (e.g. the eye-level
    // Walker) navigating like a normal humanoid so it doesn't snag its head on
    // overhead geometry. Only the capsule uses this; the billboard and the
    // weapon hit test still use the full visual `height`.
    this.collisionHeight = (config.collisionHeight ?? config.height) * config.scale * this.sizeScale;
    this.radius = 0.42 * config.scale * this.sizeScale;
    // Per-zombie gait so movement weaves instead of tracking a straight line.
    this.gaitPhase = Math.random() * Math.PI * 2;
    this.gaitFreq = 1.4 + Math.random() * 1.3;
    // ...and a per-zombie VOICE, fixed for its whole life. It picks this
    // individual's fundamental inside its archetype's band and which of that
    // archetype's lines he uses for each state (see audio/EnemyVoices.js), so
    // one fighter always sounds like himself and eight of them do not sound
    // like the same man shouted eight times.
    this.voice = Math.random();
    // Spread wide, so a wave landing does not have twenty men all reaching for
    // a line inside the same second.
    this._idleTalk = 3 + Math.random() * 14;
    this.addTag('zombie');
    this.addTag('hostile');
    this.state = 'idle';
    this.stateTime = Math.random() * 3;
    this.wanderTarget = null;
    this.alertPos = null;
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
    this.playerDist = Infinity;
    this._losTimer = Math.random() * 0.3;
    this._hasLos = false;
    this.victim = null;
    this._victimLos = false;
    this._victimDist = Infinity;
    // Where the hunter is actually walking to: the victim's live position while
    // it can sense it, the remembered one while it cannot.
    this._victimPoint = { x: 0, z: 0 };

    this.senses = new Senses(world, {
      range: 2.2 + this.radius * 2,
      rays: 12,
      interval: 0.15,
      memorySpan: FRIENDLY_MEMORY,
    });
    this.nav = new NavAgent(world, {
      // Wider berth than the default: a shambling body is not a point, and a
      // horde funnelling through one doorway needs the room.
      steer: { pad: this.radius + 0.2, minClear: this.radius + 0.1 },
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
    this.nav.reset();
    this.senses.clearMemory();
  }

  onNoise(pos, radius) {
    if (aiFlag(this, 'deaf')) return;
    if (this.state === 'dead' || this.state === 'chasing' || this.state === 'attacking') return;
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    if (d > radius) return;
    this.senses.hear(pos.x, pos.z, radius);
    this.alertPos = { x: pos.x + (Math.random() - 0.5) * 6, z: pos.z + (Math.random() - 0.5) * 6 };
    this.nav.clearPath();
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
      voice: this.voice,
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
    if (s === 'chasing') {
      this.events.emit('zombie:aggro', {
        pos: this.position.clone(), type: this.config, voice: this.voice,
      });
    } else if (s === 'alerted') {
      // Heard something, has not found it yet: the position call.
      this.events.emit('zombie:spot', {
        pos: this.position.clone(), type: this.config, voice: this.voice,
      });
    }
  }

  /**
   * Shared per-frame perception for every hunter built on this class.
   * Handles dormancy, the sensory ring, the staggered player line-of-sight and
   * its blind timer, the opt-in blind cull, and victim acquisition.
   *
   * Returns false when the caller should stop updating this frame — the agent
   * is dormant (too far to matter) or has just been culled.
   */
  _sense(dt, ctx) {
    const player = ctx.player;
    const pdx = player.position.x - this.position.x;
    const pdz = player.position.z - this.position.z;
    const pdist = Math.hypot(pdx, pdz);
    this.playerDist = pdist;

    // Dormant when far away: no AI, no rendering.
    if (pdist > ACTIVE_RANGE) { this.mesh.visible = false; return false; }

    /**
     * CHATTER.
     *
     * Every fighter close enough to be heard offers a line every eleven to
     * twenty-six seconds, whatever he is doing — muttering an invocation when
     * nobody has found anybody, calling position once he is coming for you.
     *
     * It used to be gated on `idle`/`wandering`, which in a wave-survival game
     * is a state the horde is in for about a second: they spawn, they sense the
     * player, and they are hunting for the rest of their lives. So the horde
     * only ever spoke on the two events that fire regardless — being shot and
     * dying — and a street with fifteen men crossing it was silent.
     *
     * This only decides WHO offers a line. How many of those actually reach the
     * player is the audio layer's problem, and it throttles hard: roughly one
     * voice out of the whole town every five seconds (AudioManager.enemyLine).
     */
    this._idleTalk -= dt;
    if (this._idleTalk <= 0) {
      this._idleTalk = CHATTER_GAP + Math.random() * CHATTER_SPREAD;
      if (pdist < CHATTER_RANGE && this.state !== 'dead') {
        this.events.emit('zombie:chatter', {
          pos: this.position.clone(), type: this.config, voice: this.voice,
          hunting: this.state !== 'idle' && this.state !== 'wandering',
        });
      }
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

    const cullS = aiFlag(this, 'cullBlindSeconds');
    if (cullS > 0 && player.alive && this.blindTimer > cullS) { this._cull(); return false; }

    this._acquireVictim(ctx);
    return true;
  }

  /**
   * Decide who to chase this frame. Player first (global awareness, always
   * known); otherwise the nearest friendly the zombie can actually perceive;
   * failing that, the place a friendly was last seen, until that memory fades.
   */
  _acquireVictim(ctx) {
    const player = ctx.player;
    if (player && player.alive) {
      this.victim = player;
      this._victimLos = this._hasLos;
      this._victimDist = this.playerDist;
      this._victimPoint.x = player.position.x;
      this._victimPoint.z = player.position.z;
      return;
    }
    const f = this.senses.perceiveNearest(this, ctx.friendlies || EMPTY, {
      range: this.config.sightRange * aiFlag(this, 'friendlyRangeMul'),
      fov: FRIENDLY_FOV,
      proximity: FRIENDLY_PROX,
      requireLOS: true,
    });
    if (f) {
      this.victim = f.target;
      this._victimLos = f.los;
      this._victimDist = f.dist;
      this._victimPoint.x = f.target.position.x;
      this._victimPoint.z = f.target.position.z;
      return;
    }
    // Nothing in sight. If it was hunting something a moment ago, go to where
    // that was — a friendly who slips behind a wall is followed, not forgotten.
    const mem = this.senses.recall(this.victim);
    if (mem && this.victim && this.victim.alive !== false && mem.age < FRIENDLY_MEMORY) {
      this._victimLos = false;
      this._victimDist = this.distanceTo(this.victim);
      this._victimPoint.x = mem.x;
      this._victimPoint.z = mem.z;
      // Arrived at the last known spot and it's still not there: give up.
      if (Math.hypot(mem.x - this.position.x, mem.z - this.position.z) > 1.5) return;
    }
    this.victim = null;
    this._victimLos = false;
    this._victimDist = Infinity;
  }

  update(dt, ctx) {
    const { camPos } = ctx;
    this.stateTime += dt;

    if (this.state === 'dead') {
      this.deathTimer += dt;
      this.billboard.deathPose(Math.min(1, this.deathTimer / DEATH_TIME));
      if (this.deathTimer >= DEATH_TIME) this.toRemove = true;
      return;
    }

    if (!this._sense(dt, ctx)) return;
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
          const before = this.windup;
          this.windup -= dt;
          // The shout goes with the START of the wind-up, not the landing: it
          // is the half-second of warning the player gets to step back.
          if (before >= this.config.attackWindup - 1e-6) {
            this.events.emit('zombie:attack', {
              pos: this.position.clone(), type: this.config, voice: this.voice,
            });
          }
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
          // The navigator owns the whole "how do I get there" problem: beeline
          // on a clear line, A* through doorways otherwise, exit hunt when the
          // grid has nothing, lateral recovery when a prop pins them.
          speed = this.config.chaseSpeed;
          const step = this.nav.steer(dt, this, this._victimPoint, {
            direct: vLos || vdist < 3,
            budget: ctx.pathBudget,
            senses: this.senses,
          });
          if (step) {
            moveX = step.x; moveZ = step.z; speed *= step.scale; moving = true;
          }
        }
      }
    } else {
      // No victim (player gone, no friendly perceivable): idle / wander /
      // investigate a noise — all steered by the sensory ring so they never
      // stick to a wall.
      switch (this.state) {
        case 'chasing':
        case 'attacking':
          this.nav.clearPath();
          this._setState('wandering');
          this.wanderTarget = { x: this.position.x + (Math.random() - 0.5) * 8, z: this.position.z + (Math.random() - 0.5) * 8 };
          break;
        case 'idle':
          if (!aiFlag(this, 'noWander') && this.stateTime > 2 + Math.random() * 3) {
            const a = Math.random() * Math.PI * 2;
            const r = 5 + Math.random() * 12;
            this.wanderTarget = { x: this.position.x + Math.cos(a) * r, z: this.position.z + Math.sin(a) * r };
            this._setState('wandering');
          }
          break;
        case 'wandering': {
          const t = this.wanderTarget;
          const wd = t ? Math.hypot(t.x - this.position.x, t.z - this.position.z) : 0;
          if (!t || wd < 1 || this.stateTime > 12) { this._setState('idle'); break; }
          const steer = contextSteer(t.x - this.position.x, t.z - this.position.z, this.senses);
          moveX = steer.x; moveZ = steer.z;
          speed = this.config.wanderSpeed;
          moving = true;
          break;
        }
        case 'alerted': {
          const t = this.alertPos;
          const ad = Math.hypot(t.x - this.position.x, t.z - this.position.z);
          if (ad < 2.5 || this.stateTime > 16) { this._setState('wandering'); this.wanderTarget = { x: this.position.x + 4, z: this.position.z + 4 }; break; }
          const step = this.nav.steer(dt, this, t, { budget: ctx.pathBudget, senses: this.senses });
          if (step) {
            moveX = step.x; moveZ = step.z;
            speed = Math.min(this.config.chaseSpeed, this.config.wanderSpeed * 2.2) * step.scale;
            moving = true;
          }
          break;
        }
      }
    }

    this._move(dt, ctx, moveX, moveZ, speed, moving);

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

  /**
   * Integrate a steering direction: weave the gait, ease up on slopes, apply
   * knockback, then resolve the capsule and settle onto the ground. Shared by
   * every subclass so movement feels identical across the horde.
   */
  _move(dt, ctx, moveX, moveZ, speed, moving) {
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
    this.world.collision.resolveCapsule(this.position, this.radius, this.collisionHeight);
    this.position.y = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.5);
  }

  dispose() {
    this.billboard.dispose();
  }
}
