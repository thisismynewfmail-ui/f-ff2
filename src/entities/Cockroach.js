import * as THREE from '../../lib/three.module.js';
import { Entity } from './Entity.js';
import { Senses } from '../ai/Senses.js';
import { Brain, Behavior } from '../ai/Behavior.js';
import { seek, flee, avoidObstacles, gaitWobble } from '../ai/Steering.js';

/**
 * The AI-test cockroach.
 *
 * A tiny critter that runs the same sensory/behaviour stack as the other NPCs,
 * proving it generalises well past humanoids:
 *   Flee  ▸ bolt from the player, but only a very short distance, then settle.
 *   Hide  ▸ by day, scuttle into the nearest building (out of the light).
 *   Roam  ▸ by night, head back outdoors and wander in the open.
 *   Wander▸ default fidgety roaming near where it spawned.
 * Obstacle avoidance + a strong erratic gait give it believable skittering.
 *
 * Day vs. night comes from the Sky via ctx.isDay.
 */
const FLEE_ENTER = 3.5;   // player this close → run
const FLEE_EXIT = 6.5;    // ...only until this short distance is opened up
const BUILDING_MARGIN = 1.0;

class FleeBehavior extends Behavior {
  constructor() { super('flee'); this.minDwell = 0.1; }
  score(ctx) { return ctx.self._scared ? 200 : 0; }
  step(_dt, ctx) {
    const s = ctx.self, p = ctx.player.position;
    const away = flee(s.position.x, s.position.z, p.x, p.z);
    const dir = avoidObstacles(away.x, away.z, s.senses, 2.4);
    return { x: dir.x, z: dir.z, speed: s.runSpeed };
  }
}

class HideBehavior extends Behavior {
  constructor() { super('hide'); this.minDwell = 0.4; }
  score(ctx) { return ctx.isDay && !ctx.self._scared ? 10 : 0; }
  enter(ctx) { ctx.self._hideTarget = ctx.self._nearestShelter(); }
  step(_dt, ctx) {
    const s = ctx.self;
    if (s._insideShelter()) { s._fidget(); return null; } // hidden: sit tight
    const t = s._hideTarget || (s._hideTarget = s._nearestShelter());
    if (!t) return null;
    const dir = avoidObstacles(t.x - s.position.x, t.z - s.position.z, s.senses);
    return { x: dir.x, z: dir.z, speed: s.roamSpeed };
  }
}

class RoamOutBehavior extends Behavior {
  constructor() { super('roam'); this.minDwell = 0.4; }
  score(ctx) { return !ctx.isDay && !ctx.self._scared ? 8 : 0; }
  step(_dt, ctx) {
    const s = ctx.self;
    if (s._insideShelter()) {
      // Head for the open air.
      const out = s._nearestOutdoors();
      const dir = avoidObstacles(out.x - s.position.x, out.z - s.position.z, s.senses);
      return { x: dir.x, z: dir.z, speed: s.runSpeed };
    }
    return s._wanderStep(ctx);
  }
}

class WanderBehavior extends Behavior {
  constructor() { super('wander'); this.minDwell = 0.3; }
  score(ctx) { return ctx.self._scared ? 0 : 2; }
  step(_dt, ctx) { return ctx.self._wanderStep(ctx); }
}

export class Cockroach extends Entity {
  constructor(events, world) {
    super();
    this.events = events;
    this.world = world;
    this.height = 0.12;
    this.radius = 0.12;
    this.addTag('critter');
    this.roamSpeed = 1.3;
    this.runSpeed = 3.2;
    this._scared = false;
    this._wanderTarget = null;
    this._hideTarget = null;
    this._bob = Math.random() * Math.PI * 2;
    this.gaitPhase = Math.random() * Math.PI * 2;
    this.gaitFreq = 5 + Math.random() * 4; // fast, jittery

    const s = world.npcSpawn;
    this.home = { x: s.x + 2, z: s.z - 4 }; // spawn at the centre, near the player
    this.position.set(this.home.x, world.groundHeightFor(this.home.x, this.home.z, 1e9), this.home.z);

    this.mesh = this._buildMesh();
    this.mesh.position.copy(this.position);

    this.senses = new Senses(world, { whiskerRange: 1.6, whiskerAngles: [0, 0.7, -0.7, 1.3, -1.3], interval: 0.1 });
    this.brain = new Brain()
      .add(new FleeBehavior())
      .add(new HideBehavior())
      .add(new RoamOutBehavior())
      .add(new WanderBehavior());
  }

  _buildMesh() {
    const g = new THREE.Group();
    const shell = new THREE.MeshLambertMaterial({ color: 0x2a1a10 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), shell);
    body.scale.set(0.7, 0.42, 1.25); // flattened, elongated along +Z
    body.position.y = 0.06;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshLambertMaterial({ color: 0x1a1008 }));
    head.position.set(0, 0.06, 0.14);
    g.add(head);
    const antMat = new THREE.MeshBasicMaterial({ color: 0x110a06 });
    for (const sx of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.18, 3), antMat);
      a.position.set(sx * 0.04, 0.08, 0.22);
      a.rotation.set(Math.PI / 2.4, 0, sx * 0.5);
      g.add(a);
    }
    return g;
  }

  /* ---- shelter / outdoor helpers (via building footprints) ---- */

  _enterableBuildings() {
    return this.world.buildingSpecs.filter((b) => !b.solid);
  }

  _inFootprint(x, z, b, margin = 0) {
    return Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin;
  }

  _insideShelter() {
    for (const b of this._enterableBuildings()) if (this._inFootprint(this.position.x, this.position.z, b)) return true;
    return false;
  }

  _nearestShelter() {
    let best = null, bd = Infinity;
    for (const b of this._enterableBuildings()) {
      const d = Math.hypot(b.x - this.position.x, b.z - this.position.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return null;
    // aim a little off-centre so several roaches don't stack on one spot
    return { x: best.x + (Math.random() - 0.5) * best.w * 0.4, z: best.z + (Math.random() - 0.5) * best.d * 0.4 };
  }

  _nearestOutdoors() {
    // Push straight out of whichever footprint we're in.
    for (const b of this._enterableBuildings()) {
      if (!this._inFootprint(this.position.x, this.position.z, b, BUILDING_MARGIN)) continue;
      const dx = this.position.x - b.x, dz = this.position.z - b.z;
      if (Math.abs(dx) / b.w > Math.abs(dz) / b.d) {
        return { x: b.x + Math.sign(dx || 1) * (b.w / 2 + 4), z: this.position.z };
      }
      return { x: this.position.x, z: b.z + Math.sign(dz || 1) * (b.d / 2 + 4) };
    }
    return { x: this.position.x, z: this.position.z };
  }

  _fidget() {
    if (Math.random() < 0.02) this._wanderTarget = null;
  }

  _wanderStep(ctx) {
    const t = this._wanderTarget;
    if (!t || Math.hypot(t.x - this.position.x, t.z - this.position.z) < 0.4) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
      // At night prefer to wander outdoors; by day stay loose near home.
      const cx = this.home.x, cz = this.home.z;
      this._wanderTarget = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
      return null;
    }
    const dir = avoidObstacles(t.x - this.position.x, t.z - this.position.z, this.senses);
    return { x: dir.x, z: dir.z, speed: this.roamSpeed };
  }

  update(dt, ctx) {
    this.senses.update(dt, this);

    // fear: player inside the trigger bubble → run; hold until a short gap opens
    const pd = this.distanceTo(ctx.player);
    if (this._scared) this._scared = pd < FLEE_EXIT;
    else this._scared = ctx.player.alive && pd < FLEE_ENTER;

    const intent = this.brain.update(dt, { self: this, player: ctx.player, isDay: !!ctx.isDay });
    let moving = false;
    if (intent && intent.speed > 0) {
      const w = gaitWobble(intent.x, intent.z, ctx.time || 0, this.gaitPhase, this.gaitFreq, 0.35 * (1 - this.senses.avoid.strength));
      this.position.x += w.x * intent.speed * dt;
      this.position.z += w.z * intent.speed * dt;
      this.yaw = Math.atan2(w.x, w.z);
      moving = true;
    }

    this.world.collision.resolveCapsule(this.position, this.radius, this.height);
    this.world.clampToWorld(this.position);
    const groundY = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.5);
    this._bob += dt * (moving ? 22 : 4);
    this.position.y = groundY;
    this.mesh.position.set(this.position.x, groundY + (moving ? Math.abs(Math.sin(this._bob)) * 0.03 : 0), this.position.z);
    this.mesh.rotation.y = this.yaw;
  }

  /** State label for debug/tests. */
  get state() { return this.brain.state; }
}
