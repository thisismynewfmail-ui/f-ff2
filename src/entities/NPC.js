import { Entity } from './Entity.js';
import { SpriteBillboard, makeSpriteMaterial } from '../rendering/Billboard.js';
import { Senses } from '../ai/Senses.js';
import { Brain, Behavior } from '../ai/Behavior.js';
import { flee, avoidObstacles } from '../ai/Steering.js';

/**
 * The peaceful survivor by the well in Old Town Square.
 *
 * She runs on the shared sensory/behaviour stack: a set of Senses feeds a
 * Brain that arbitrates between three overlapping behaviours —
 *   Idle    (rest and watch),
 *   Wander  (loop near home, skirting walls and props), and
 *   Flee    (run from any zombie that comes hunting).
 * Flee outranks the rest, so a threat instantly preempts whatever she was
 * doing; when the danger passes she falls straight back to wandering/idling.
 * Obstacle avoidance rides under every behaviour, so she never runs herself
 * into a wall while panicking. She still murmurs a line when the player comes
 * close — but only when she is calm.
 */
const LINES = [
  'They come out of the fog. They never stop coming.',
  'The clocktower keeps the sun\'s own hours now. Nobody winds it.',
  "Don't trust the shadows here. They point the wrong way.",
  'I counted the bells. There was one chime too many.',
  'If you reach the ridge... tell the chapel I kept my promise.',
  'A quarter of a million of them. I did the arithmetic. Kill them all.',
];

// Flee band, expressed as fractions of the hunting zombie's OWN sight range so
// the two are always correlated: she bolts once a zombie is within ~70% of the
// distance at which it could detect her, and keeps running until the nearest
// one is past its full sight range — i.e. genuinely out of sight. The gap
// between the two is deliberate hysteresis: no flip-flopping on the boundary.
const FLEE_ENTER = 0.7;
const FLEE_EXIT = 1.05;
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
    const dir = avoidObstacles(t.x - s.position.x, t.z - s.position.z, s.senses);
    return { x: dir.x, z: dir.z, speed: s.wanderSpeed };
  }
}

class FleeBehavior extends Behavior {
  constructor() { super('flee'); this.minDwell = 0.15; }
  score(ctx) { return ctx.self._threat ? 100 : 0; }
  step(_dt, ctx) {
    const s = ctx.self, th = s._threat;
    if (!th) return null;
    const away = flee(s.position.x, s.position.z, th.position.x, th.position.z);
    // Heavier avoidance weight while fleeing: better to swerve hard than to
    // sprint into a corner with a zombie on her heels.
    const dir = avoidObstacles(away.x, away.z, s.senses, 2.2);
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
    this.fleeSpeed = 3.4;      // clearly quicker than a walker's shamble
    this.lineCooldown = 0;
    this.lineIndex = 0;
    this._threat = null;

    this.senses = new Senses(world, { whiskerRange: 3.0, interval: 0.12 });
    this.brain = new Brain()
      .add(new FleeBehavior())
      .add(new WanderBehavior())
      .add(new IdleBehavior());
  }

  _pickWanderTarget() {
    // Always loop back around home, so after a long flee she trickles home
    // once the coast is clear rather than settling wherever she stopped.
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 5;
    this.wanderTarget = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
  }

  /**
   * Pick the scariest nearby zombie and decide, with hysteresis, whether she
   * is currently in flight. Trigger/clear thresholds scale with that zombie's
   * own sight range, keeping her flee distance tied to zombie sight distance.
   */
  _senseThreat(ctx) {
    const zs = ctx.zombies || EMPTY;
    let nearest = null, nd = Infinity;
    for (const z of zs) {
      if (!z || !z.alive || z.state === 'dead') continue;
      const d = this.distanceTo(z);
      if (d < nd) { nd = d; nearest = z; }
    }
    if (!nearest) { this._threat = null; return; }

    const sight = nearest.config?.sightRange ?? 50;
    if (this._threat) {
      // Already running: keep going until the nearest hunter is out of sight.
      this._threat = nd > sight * FLEE_EXIT ? null : nearest;
    } else if (nd < sight * FLEE_ENTER && this.senses.lineOfSight(this, nearest)) {
      // Calm until a hunter both closes in and actually has a line on her.
      this._threat = nearest;
    }
  }

  update(dt, ctx) {
    const { player, camPos } = ctx;
    this.senses.update(dt, this);
    this._senseThreat(ctx);

    const intent = this.brain.update(dt, { self: this, player, zombies: ctx.zombies });
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
        this.events.emit('subtitle', { text: '"' + LINES[this.lineIndex % LINES.length] + '"' });
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
