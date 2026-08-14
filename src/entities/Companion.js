import { Entity } from './Entity.js';
import { Senses } from '../ai/Senses.js';
import { NavAgent } from '../ai/NavAgent.js';
import { turnToward } from '../ai/Steering.js';
import { buildAndroidModel, CompanionAnimator, ANDROID_HEIGHT } from '../rendering/AndroidModel.js';

/**
 * THE ADJUTANT — the android companion, once she is standing in the world.
 *
 * She is the only thing in this game that takes ORDERS. Everything else either
 * hunts you, ignores you, or sits where it was put; she is told what to do and
 * then gets on with it, which is why her state is split in two:
 *
 *   POSTURE   where she should BE:      follow · stay · guard
 *   RULES     what she may DO about it: passive · melee · ranged · attack
 *
 * The two are independent on purpose. "Stay here and shoot anything that comes"
 * and "walk with me and keep your hands to yourself" are both things a player
 * wants, and neither is expressible if the two are welded into one list of
 * modes. Eight buttons on the dial, two axes of meaning.
 *
 * ── WHAT SHE FIGHTS WITH ──────────────────────────────────────────────────
 * No gun. She was not built with one and there is nowhere to put one. What she
 * has is folded into her:
 *
 *   BLADES  one in each forearm, for anything that got close. They snap out
 *           along the arm and lock over square before the first swing.
 *   ARC     two emitters that hinge up off her shoulder blades. Her chest core
 *           spins up to charge them, which is a visible tell about half a
 *           second before anything is discharged.
 *
 * Melee hits harder and needs her to close; the arc reaches but costs her a
 * charge cycle between shots. Told to ATTACK she picks whichever the range
 * asks for, which is what most players will leave her on.
 *
 * ── WHAT THE HORDE THINKS OF HER ──────────────────────────────────────────
 * Nothing. She is not on the shared `friendlies` roster, so no zombie ever
 * acquires her, walks into her or swings at her — exactly like the sentry, and
 * for the same reason. A companion the horde could kill is a companion you
 * spend the run babysitting, and this one is meant to be an asset you deploy
 * and then stop thinking about. She is hardware, not a person, and the game is
 * consistent about which of those it lets you lose.
 */

const WALK_SPEED = 3.1;
const RUN_SPEED = 4.6;
const TURN_RATE = 5.0;
const MIN_ALIGN_SPEED = 0.25;

const FOLLOW_NEAR = 2.1;      // she stops closing inside this
const FOLLOW_FAR = 3.4;       // ...and starts running outside this
const FOLLOW_SPRINT = 9.0;    // badly behind: run flat out
const TELEPORT_LOST = 34;     // hopelessly behind (through a wall): catch up

const GUARD_LEASH = 9.0;      // how far from her post GUARD will chase
const SIGHT = 26.0;           // how far she looks for something to fight
const MELEE_REACH = 1.9;
const MELEE_DAMAGE = 26;
const MELEE_INTERVAL = 0.9;
// Her arc reaches further than the sentry's pistol does (60 ft), which is the
// point of her: the sentry holds a doorway, she covers the street you are
// crossing. SIGHT has to stay ahead of it or she would be unable to acquire
// anything at the range she can actually shoot it.
const ARC_RANGE = 22.0;
const ARC_DAMAGE = 17;
const ARC_INTERVAL = 1.4;
const ARC_CHARGE = 0.62;      // of the interval, spent spinning up
// Inside this she would rather use the blades. Deliberately an ABSOLUTE
// distance and not a fraction of ARC_RANGE: tying the two together means every
// extension of her reach quietly turns her into a melee unit that runs at
// things from further away.
const MELEE_PREFER = 6.0;

export const POSTURES = ['follow', 'stay', 'guard'];
export const RULES = ['passive', 'melee', 'ranged', 'attack'];

export class Companion extends Entity {
  constructor(events, world, texLib, { x, z, yaw = 0 }) {
    super();
    this.events = events;
    this.world = world;
    this.addTag('companion');
    // Deliberately NOT 'friendly' — see the class note. Nothing hunts her.

    this.height = ANDROID_HEIGHT;
    this.radius = 0.30;
    const y = world.groundHeightFor(x, z, 1e9);
    this.position.set(x, y, z);
    this.yaw = yaw;

    this.rig = buildAndroidModel(texLib);
    this.mesh = this.rig.group;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = yaw;
    this.anim = new CompanionAnimator(this.rig);
    this.anim.setState('unfold');

    this.posture = 'follow';
    this.rules = 'attack';
    this.post = { x, z };          // where STAY/GUARD hold
    this.state = 'unfold';
    this.stateT = 0;
    this.target = null;
    this.attackCd = 0;
    this.arcCd = 0;
    this.ackT = 0;
    this.toRemove = false;
    this.kills = 0;

    this.senses = new Senses(world, { range: 2.6, rays: 12, interval: 0.14 });
    this.nav = new NavAgent(world, { steer: { pad: this.radius + 0.18 } });

    this.interactable = world.addInteractable({
      x, z, y, radius: 2.2,
      prompt: 'Give the adjutant an order [E]',
      enabled: () => !this.toRemove && this.state !== 'unfold',
      onInteract: () => this.events.emit('companion:orders', { companion: this }),
    });
    this.events.emit('companion:deployed', { pos: this.position.clone() });
  }

  /* ---------------- orders ---------------- */

  /**
   * Take an order off the dial. Posture and rules are set through the same
   * door because the dial does not distinguish, and a nod is played for both —
   * an order with no acknowledgement is an order you are not sure landed.
   */
  order(cmd) {
    if (POSTURES.includes(cmd)) {
      this.posture = cmd;
      if (cmd !== 'follow') this.post = { x: this.position.x, z: this.position.z };
    } else if (RULES.includes(cmd)) {
      this.rules = cmd;
      if (cmd === 'passive') this.target = null;
    } else {
      return false;
    }
    this.ackT = 0.65;
    this.events.emit('companion:ack', { cmd, pos: this.position.clone() });
    return true;
  }

  /** A one-line report of what she has been told, for the dial's centre. */
  describe() {
    const post = { follow: 'FOLLOWING', stay: 'HOLDING', guard: 'GUARDING' }[this.posture];
    const rule = { passive: 'STAND DOWN', melee: 'BLADES', ranged: 'ARC', attack: 'FREE' }[this.rules];
    return `${post} · ${rule}`;
  }

  /* ---------------- targeting ---------------- */

  /** May she fight at all, and with what? */
  _canMelee() { return this.rules === 'melee' || this.rules === 'attack'; }
  _canArc() { return this.rules === 'ranged' || this.rules === 'attack'; }

  /**
   * The nearest zombie she is allowed to go for. GUARD keeps her on a leash
   * from her post; STAY will engage but never leaves the spot; FOLLOW hunts
   * around the player rather than around herself, so she never wanders off
   * after something behind you.
   */
  _acquire(ctx) {
    if (this.rules === 'passive') return null;
    const anchor = this.posture === 'follow' && ctx.player?.alive ? ctx.player.position : this.position;
    // GUARD's leash is about how far she will WALK off her post, so it must not
    // also decide how far she can shoot from standing on it: when the arc is
    // available she engages out to its full reach and simply never leaves.
    const leash = this.posture === 'guard'
      ? (this._canArc() ? Math.max(GUARD_LEASH, ARC_RANGE) : GUARD_LEASH)
      : SIGHT;
    let best = null, bestD = Infinity;
    for (const z of ctx.zombies ?? []) {
      if (z.state === 'dead') continue;
      const dFromAnchor = Math.hypot(z.position.x - anchor.x, z.position.z - anchor.z);
      if (dFromAnchor > leash) continue;
      const d = Math.hypot(z.position.x - this.position.x, z.position.z - this.position.z);
      if (d > SIGHT || d >= bestD) continue;
      if (!this.world.hasLineOfSight(
        this.position.x, this.position.y + 1.0, this.position.z,
        z.position.x, z.position.y + z.height * 0.5, z.position.z)) continue;
      best = z; bestD = d;
    }
    return best;
  }

  /* ---------------- the frame ---------------- */

  update(dt, ctx) {
    if (this.toRemove) return;
    this.stateT += dt;
    this.senses.update(dt, this);
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.arcCd > 0) this.arcCd -= dt;
    if (this.ackT > 0) this.ackT -= dt;

    // Coming out of the fold is uninterruptible — it is the one moment she is
    // not answering for herself.
    if (this.state === 'unfold') {
      if (this.stateT >= 2.4) { this.state = 'idle'; this.stateT = 0; }
      this._present(dt, ctx, 0);
      return;
    }

    const player = ctx.player;
    this.target = this._acquire(ctx);
    const tDist = this.target
      ? Math.hypot(this.target.position.x - this.position.x, this.target.position.z - this.position.z)
      : Infinity;

    /* ---- decide where she wants to be, and what she wants to do ---- */
    let goal = null;
    let want = 'idle';

    if (this.target) {
      const meleeWanted = this._canMelee() && (this.rules === 'melee' || tDist < MELEE_PREFER);
      if (meleeWanted) {
        // close, unless STAY has her pinned to a spot
        if (tDist > MELEE_REACH * 0.8 && this.posture !== 'stay') goal = this.target.position;
        want = tDist <= MELEE_REACH ? 'melee' : 'alert';
      } else if (this._canArc()) {
        if (tDist > ARC_RANGE && this.posture !== 'stay') goal = this.target.position;
        want = tDist <= ARC_RANGE ? 'ranged' : 'alert';
      } else {
        want = 'alert';
      }
    }

    if (!goal) {
      if (this.posture === 'follow' && player?.alive) {
        const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
        // She loses the player entirely often enough — through a building, down
        // a hill — that a hard catch-up is the difference between a companion
        // and a thing you keep going back for.
        if (d > TELEPORT_LOST) this._catchUp(player);
        else if (d > FOLLOW_NEAR) goal = player.position;
      } else if (this.posture !== 'follow') {
        const d = Math.hypot(this.post.x - this.position.x, this.post.z - this.position.z);
        if (d > 0.9) goal = this.post;
      }
    }

    /* ---- move ---- */
    let speed = 0;
    if (goal && want !== 'melee' && want !== 'ranged') {
      const gx = goal.x, gz = goal.z;
      const dist = Math.hypot(gx - this.position.x, gz - this.position.z);
      const dir = this.nav.steer(dt, this, { x: gx, z: gz }, { senses: this.senses });
      if (dir) {
        const desiredYaw = Math.atan2(dir.x, dir.z);
        this.yaw = turnToward(this.yaw, desiredYaw, dt, TURN_RATE);
        const align = Math.max(MIN_ALIGN_SPEED, Math.cos(desiredYaw - this.yaw));
        const flat = dist > FOLLOW_SPRINT || (this.target && want === 'alert');
        speed = (flat ? RUN_SPEED : dist > FOLLOW_FAR ? RUN_SPEED * 0.8 : WALK_SPEED)
          * align * (dir.scale ?? 1);
        this.position.x += Math.sin(this.yaw) * speed * dt;
        this.position.z += Math.cos(this.yaw) * speed * dt;
        want = speed > WALK_SPEED * 1.15 ? 'run' : 'walk';
      }
    } else if (this.target) {
      // standing and fighting: face what she is fighting
      const t = this.target.position;
      this.yaw = turnToward(this.yaw, Math.atan2(t.x - this.position.x, t.z - this.position.z), dt, TURN_RATE * 1.6);
    } else if (this.posture === 'stay') {
      want = 'sit';
    } else if (player?.alive) {
      // idling beside the player: turn to face roughly the way they are
      const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      if (d < FOLLOW_NEAR * 1.6) {
        const toP = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
        this.yaw = turnToward(this.yaw, toP, dt, TURN_RATE * 0.35);
      }
    }

    this.world.collision.resolveCapsule(this.position, this.radius, this.height);
    this.position.y = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.6);

    /* ---- fight ---- */
    if (want === 'melee') this._melee(dt);
    if (want === 'ranged') this._arc(dt);

    // An acknowledgement overrides whatever she was doing, briefly, so an
    // order always LOOKS like it landed.
    if (this.ackT > 0 && want !== 'melee' && want !== 'ranged') want = 'ack';

    this.state = want;
    this._present(dt, ctx, speed);
  }

  /**
   * The catch-up. Not a teleport in front of the player's face: she is put
   * BEHIND them, out of the sight line, so the fix is invisible from the
   * player's side and she simply turns out to have been there all along.
   */
  _catchUp(player) {
    const back = player.yaw;          // players face (-sin, -cos), so +yaw is behind
    const x = player.position.x + Math.sin(back) * 2.0;
    const z = player.position.z + Math.cos(back) * 2.0;
    this.position.set(x, this.world.groundHeightFor(x, z, player.position.y + 1.0), z);
    this.nav.reset?.();
  }

  _melee(dt) {
    this.anim.wantBlades = true;
    this.anim.wantPods = false;
    if (this.attackCd > 0 || !this.target) return;
    this.attackCd = MELEE_INTERVAL;
    // The blades have to actually be out before they cut anything — the
    // extend is the tell, so it has to cost something.
    if (this.anim.bladeOut < 0.75) { this.attackCd = 0.18; return; }
    const t = this.target;
    const dx = t.position.x - this.position.x, dz = t.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const wasAlive = t.state !== 'dead';
    t.takeDamage(MELEE_DAMAGE, { x: dx / d, z: dz / d }, 0);
    if (wasAlive && t.state === 'dead') this.kills++;
    this.events.emit('companion:blade', { pos: this.position.clone() });
  }

  _arc(dt) {
    this.anim.wantPods = true;
    this.anim.wantBlades = false;
    if (this.arcCd > 0 || !this.target) return;
    if (this.anim.podOut < 0.7) { this.arcCd = 0.15; return; }
    this.arcCd = ARC_INTERVAL;
    // The charge is spent BEFORE the bolt, which is what the core is showing.
    this.anim.charge = 1;
    const t = this.target;
    const dx = t.position.x - this.position.x, dz = t.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const wasAlive = t.state !== 'dead';
    t.takeDamage(ARC_DAMAGE, { x: dx / d, z: dz / d }, 0);
    if (wasAlive && t.state === 'dead') this.kills++;
    this.events.emit('companion:arc', {
      from: { x: this.position.x, y: this.position.y + 1.15, z: this.position.z },
      to: { x: t.position.x, y: t.position.y + t.height * 0.5, z: t.position.z },
    });
  }

  /* ---------------- present ---------------- */

  _present(dt, ctx, speed) {
    // Retract whatever this frame did not ask for, so she puts her hardware
    // away the moment the fight is over rather than walking around armed.
    if (this.state !== 'melee') this.anim.wantBlades = false;
    if (this.state !== 'ranged') this.anim.wantPods = false;

    // Where she is looking, in her own frame: at what she is fighting, else at
    // the player when they are near, else wherever the idle wants.
    let lookYaw = 0, lookPitch = 0;
    const look = this.target?.position
      || (ctx.player?.alive && Math.hypot(ctx.player.position.x - this.position.x,
        ctx.player.position.z - this.position.z) < 6 ? ctx.player.position : null);
    if (look) {
      let rel = Math.atan2(look.x - this.position.x, look.z - this.position.z) - this.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      lookYaw = Math.max(-1.1, Math.min(1.1, rel));
      const dy = (look.y + 1.0) - (this.position.y + 1.25);
      const flat = Math.hypot(look.x - this.position.x, look.z - this.position.z) || 1;
      lookPitch = Math.max(-0.5, Math.min(0.5, -Math.atan2(dy, flat)));
    }

    this.anim.setState(this.state === 'idle' && this.anim.state === 'idle' ? 'idle' : this.state);
    this.anim.update(dt, {
      speed,
      lookYaw,
      lookPitch,
      mood: this.rules === 'passive' ? 0.5 : this.target ? -0.6 : 0,
    });

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    if (this.interactable) {
      this.interactable.x = this.position.x;
      this.interactable.z = this.position.z;
      this.interactable.y = this.position.y;
    }
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
