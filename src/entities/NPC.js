import { Entity } from './Entity.js';
import { SpriteBillboard, makeSpriteMaterial } from '../rendering/Billboard.js';
import { Senses } from '../ai/Senses.js';
import { NavAgent } from '../ai/NavAgent.js';
import { Brain, Behavior } from '../ai/Behavior.js';
import { flee, contextSteer } from '../ai/Steering.js';

/**
 * The peaceful survivor by the well in Old Town Square.
 *
 * She runs on the shared AI stack: a set of Senses feeds a Brain that
 * arbitrates between four overlapping behaviours —
 *   Idle    (rest and watch),
 *   Wander  (loop near home, skirting walls and props),
 *   Regroup (make her way back to the square after a long run), and
 *   Flee    (run from any zombie that has actually noticed her).
 * Flee outranks the rest, so a threat instantly preempts whatever she was
 * doing; when the danger passes she falls back through Regroup to
 * wandering/idling on her own. Obstacle steering rides under every behaviour,
 * so she never runs herself into a wall while panicking, and Regroup routes her
 * through the shared navigator so she can find her way home from inside a
 * building. She still murmurs a line when the player comes close — but only
 * when she is calm.
 */
const LINES = [
  'They come out of the fog. They never stop coming.',
  'The clocktower keeps the sun\'s own hours now. Nobody winds it.',
  "Don't trust the shadows here. They point the wrong way.",
  'I counted the bells. There was one chime too many.',
  'If you reach the ridge... tell the chapel I kept my promise.',
  'A quarter of a million of them. I did the arithmetic. Kill them all.',
];

// ---- flee band, tied to zombie sight distance ------------------------------
// Her panic distance is not a number of her own: it is a fraction of the range
// at which THAT zombie could detect her, read straight off its own config, so
// the two can never drift apart. A Walker sees 50 m and she bolts at 35; a
// Sprinter sees 60 and she bolts at 42.
//
// A zombie with a wall between them is not something to run from — see _seenBy
// for why line of sight is the right second gate and the hunter's facing cone
// is not.
//
// The gap between the two thresholds is deliberate hysteresis: she bolts at
// 70% of that range and keeps running until the nearest hunter is past 105% of
// it — genuinely out of sight — so nothing flip-flops on the boundary. Losing
// the hunter's line of sight also ends the flight, which is what makes ducking
// round a corner a real escape rather than a 50-metre sprint.
const FLEE_ENTER = 0.7;
const FLEE_EXIT = 1.05;
const REGROUP_DIST = 14;   // metres from home past which she heads back
// Line of sight is a raycast, and a horde is large. Only this many of the
// closest candidates are ever tested per frame — anything further away is not
// what she should be reacting to anyway.
const LOS_CHECKS = 4;
const EMPTY = [];

class IdleBehavior extends Behavior {
  constructor() { super('idle'); this.minDwell = 0.2; }
  score(ctx) { return !ctx.self._threat && ctx.self.restLeft > 0 ? 3 : 0; }
  step(dt, ctx) { ctx.self.restLeft -= dt; return null; }
}

class WanderBehavior extends Behavior {
  constructor() { super('wander'); this.minDwell = 0.2; }
  score(ctx) { return ctx.self._threat ? 0 : 2; }
  enter(ctx) { ctx.self._pickWanderTarget(); }
  step(_dt, ctx) {
    const s = ctx.self, t = s.wanderTarget;
    if (!t) { s._pickWanderTarget(); return null; }
    const d = Math.hypot(t.x - s.position.x, t.z - s.position.z);
    if (d < 0.5) { s.wanderTarget = null; s.restLeft = 2 + Math.random() * 4; return null; }
    const dir = contextSteer(t.x - s.position.x, t.z - s.position.z, s.senses);
    return { x: dir.x, z: dir.z, speed: s.wanderSpeed };
  }
}

/**
 * The other half of "flee, then return to what you were doing". A long flight
 * can leave her the far side of a block; without this she would settle down
 * wherever she stopped and wander there forever. Routed through the navigator
 * rather than steered straight home, because "straight home" may well be
 * through a building she has to walk out of first.
 */
class RegroupBehavior extends Behavior {
  constructor() { super('regroup'); this.minDwell = 0.5; }
  score(ctx) {
    const s = ctx.self;
    if (s._threat) return 0;
    return Math.hypot(s.home.x - s.position.x, s.home.z - s.position.z) > REGROUP_DIST ? 6 : 0;
  }
  enter(ctx) { ctx.self.nav.clearPath(); }
  step(dt, ctx) {
    const s = ctx.self;
    const step = s.nav.steer(dt, s, s.home, { budget: ctx.pathBudget, senses: s.senses });
    if (!step) return null;
    return { x: step.x, z: step.z, speed: s.jogSpeed * step.scale };
  }
}

class FleeBehavior extends Behavior {
  constructor() { super('flee'); this.minDwell = 0.15; }
  score(ctx) { return ctx.self._threat ? 100 : 0; }
  enter(ctx) { ctx.self.nav.clearPath(); }
  step(_dt, ctx) {
    const s = ctx.self, th = s._threat;
    if (!th) return null;
    // Run from the threats as a group, not just the closest one, so two
    // converging zombies push her out sideways instead of straight between
    // them — and pick the most open heading near that escape direction so she
    // doesn't sprint into a dead end with a zombie on her heels.
    const away = s._escapeVector();
    const open = s.senses.openDirection(away.x, away.z);
    const dir = contextSteer(away.x + open.x * 0.6, away.z + open.z * 0.6, s.senses, { danger: 1.6 });
    return { x: dir.x, z: dir.z, speed: s.fleeSpeed };
  }
}

export class NPC extends Entity {
  constructor(events, world, texture) {
    super();
    this.events = events;
    this.world = world;
    this.height = 1.65;
    this.hp = 60;
    this.addTag('friendly');
    this.billboard = new SpriteBillboard(makeSpriteMaterial(texture), this.height, 0.62);
    this.mesh = this.billboard.mesh;
    const s = world.npcSpawn;
    this.home = { x: s.x, z: s.z };
    this.position.set(s.x, world.groundHeightFor(s.x, s.z, 1e9), s.z);

    this.wanderTarget = null;
    this.restLeft = 2;
    this.wanderSpeed = 1.1;
    this.jogSpeed = 2.2;       // heading home: quicker than a stroll, not a sprint
    this.fleeSpeed = 3.4;      // clearly quicker than a walker's shamble
    this.lineCooldown = 0;
    this.lineIndex = 0;
    this._threat = null;
    this._threats = [];        // every hunter currently aware of her

    this.senses = new Senses(world, { range: 3.0, rays: 12, interval: 0.12 });
    this.nav = new NavAgent(world, { steer: { pad: this.radius + 0.15 } });
    this.brain = new Brain()
      .add(new FleeBehavior())
      .add(new RegroupBehavior())
      .add(new WanderBehavior())
      .add(new IdleBehavior());
  }

  /** State label for debug/tests. */
  get state() { return this.brain.state; }

  _pickWanderTarget() {
    // Always loop back around home, so after a long flee she trickles home
    // once the coast is clear rather than settling wherever she stopped.
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 5;
    this.wanderTarget = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
  }

  /**
   * Is this zombie a threat to her right now? Range is the caller's job (it
   * comes from the hunter's own sight range, see the flee band above); the only
   * other gate here is a clear line between the two of them.
   *
   * Deliberately NOT the hunter's forward cone, even though the cone is part of
   * how a zombie picks a friendly target. A shambling zombie's facing changes
   * constantly and arbitrarily, so gating her panic on it makes her flicker in
   * and out of flight for a reason she could not possibly perceive — and a
   * zombie facing away is still walking toward her. A wall between them is a
   * different matter: that genuinely means it has not seen her, and it is what
   * makes ducking round a corner a real escape rather than a 50-metre sprint.
   */
  _seenBy(z) {
    return this.senses.lineOfSight(this, z);
  }

  /**
   * Pick the scariest hunter and decide, with hysteresis, whether she is
   * currently in flight. Both thresholds scale with that zombie's own sight
   * range, keeping her flee distance tied to zombie sight distance.
   *
   * The cheap distance gate runs over the whole horde; the line-of-sight test
   * is a raycast, so only the few nearest candidates ever pay for one.
   */
  _senseThreat(ctx) {
    const zs = ctx.zombies || EMPTY;
    const band = this._threat ? FLEE_EXIT : FLEE_ENTER;
    const near = this._scratch ??= [];
    near.length = 0;
    for (const z of zs) {
      if (!z || !z.alive || z.state === 'dead') continue;
      const d = this.distanceTo(z);
      if (d > (z.config?.sightRange ?? 50) * band) continue;
      near.push({ z, d });
    }
    near.sort((a, b) => a.d - b.d);

    this._threats.length = 0;
    let nearest = null;
    for (let i = 0; i < near.length && i < LOS_CHECKS; i++) {
      if (!this._seenBy(near[i].z)) continue;
      this._threats.push(near[i].z);
      if (!nearest) nearest = near[i].z;
    }
    // Fleeing ends the moment nothing that can see her is inside the exit ring;
    // starting requires one inside the (tighter) enter ring.
    this._threat = nearest;
  }

  /** Combined "get away from all of them" direction, weighted by closeness. */
  _escapeVector() {
    let ax = 0, az = 0;
    for (const z of this._threats) {
      const a = flee(this.position.x, this.position.z, z.position.x, z.position.z);
      const d = Math.max(1, this.distanceTo(z));
      ax += a.x / d; az += a.z / d;
    }
    if (!ax && !az && this._threat) {
      return flee(this.position.x, this.position.z, this._threat.position.x, this._threat.position.z);
    }
    const m = Math.hypot(ax, az);
    return m > 1e-6 ? { x: ax / m, z: az / m } : { x: 0, z: 0 };
  }

  update(dt, ctx) {
    const { player, camPos } = ctx;
    this.senses.update(dt, this);
    this._senseThreat(ctx);

    const intent = this.brain.update(dt, {
      self: this, player, zombies: ctx.zombies, pathBudget: ctx.pathBudget,
    });
    let moving = false;
    if (intent && intent.speed > 0) {
      this.position.x += intent.x * intent.speed * dt;
      this.position.z += intent.z * intent.speed * dt;
      this.yaw = Math.atan2(intent.x, intent.z);
      moving = true;
    }

    this.world.collision.resolveCapsule(this.position, this.radius, this.height);
    this.position.y = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.5);
    this.mesh.position.copy(this.position);

    // Face the player and speak when approached — but never mid-flight.
    this.lineCooldown -= dt;
    if (!this._threat) {
      const pd = this.distanceTo(player);
      if (pd < 3.5 && this.lineCooldown <= 0) {
        this.lineCooldown = 14;
        this.restLeft = Math.max(this.restLeft, 4);
        this.yaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
        // No quotation marks: the readout prints what was said, it does not
        // report it. The panel is already a voice coming out of a speaker.
        this.events.emit('subtitle', { text: LINES[this.lineIndex % LINES.length] });
        this.lineIndex++;
        moving = false;
      }
    }

    this.billboard.update(dt, camPos, this.yaw, moving, 4);
  }

  /** Zombies can hurt her when the player is not the target of the horde. */
  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      this.mesh.visible = false;
      this.events.emit('npc:died', { pos: this.position.clone() });
    }
  }
}
