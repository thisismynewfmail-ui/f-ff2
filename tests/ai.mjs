/**
 * Headless tests for the NPC AI stack (no browser, no rendering).
 *
 * Builds a miniature world — a one-room house with a real 1.5 m doorway, made
 * of the same collision boxes and nav blocks the building kit registers — and
 * exercises the pieces navigation actually depends on:
 *
 *   1. doorways survive as portals on the nav grid (and A* can route through
 *      one), where a plain wall-blocked grid seals them shut
 *   2. sensory directions are aligned to the agent's facing
 *   3. context steering threads a doorway instead of being pushed back out
 *   4. context steering finds the way out of a dead end
 *   5. the navigator walks an agent from inside the house to a goal outside
 *   6. a sealed agent still makes for a declared door
 *   7. behaviour arbitration switches promptly and does not flicker
 *
 * Usage: node tests/ai.mjs
 */
import { NavGrid } from '../src/world/NavGrid.js';
import { CollisionWorld } from '../src/world/Collision.js';
import { Senses } from '../src/ai/Senses.js';
import { contextSteer, avoidObstacles } from '../src/ai/Steering.js';
import { NavAgent } from '../src/ai/NavAgent.js';
import { Brain, Behavior } from '../src/ai/Behavior.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

/* ------------------------------------------------------------------ */
/* a one-room house at the origin: 10x10, walls on all four sides,     */
/* a 1.5 m door centred on the +Z wall                                 */
/* ------------------------------------------------------------------ */
const HALF = 5, T = 0.32, DOOR = 1.5, WALL_H = 3;

function buildWorld({ withPortal = true } = {}) {
  const terrain = { heightAt: () => 0, slopeAlong: () => 0 };
  const collision = new CollisionWorld();
  const nav = new NavGrid(terrain);
  nav.bake();

  const wall = (minX, minZ, maxX, maxZ) => {
    collision.addBox(minX, 0, minZ, maxX, WALL_H, maxZ, 'wall');
    nav.blockBox(minX, minZ, maxX, maxZ);
  };
  wall(-HALF, -HALF - T, HALF, -HALF + T);            // N wall (-Z), solid
  wall(-HALF - T, -HALF, -HALF + T, HALF);            // W wall
  wall(HALF - T, -HALF, HALF + T, HALF);              // E wall
  // S wall (+Z) split by the doorway
  wall(-HALF, HALF - T, -DOOR / 2, HALF + T);
  wall(DOOR / 2, HALF - T, HALF, HALF + T);

  if (withPortal) nav.addPortal(0, HALF, 0, 1, DOOR, 'door');

  const world = {
    collision,
    nav,
    terrain,
    groundHeightFor: () => 0,
    hasLineOfSight: (ax, ay, az, bx, by, bz) => !collision.segmentBlocked(ax, ay, az, bx, by, bz),
  };
  return world;
}

const agentAt = (x, z, yaw = 0) => ({
  position: { x, y: 0, z }, yaw, height: 1.7, radius: 0.4, id: 1,
});

/* ------------------------------------------------------------------ */
/* 1. doorways on the nav grid                                          */
/* ------------------------------------------------------------------ */
{
  const sealed = buildWorld({ withPortal: false });
  const open = buildWorld({ withPortal: true });

  const noPath = sealed.nav.findPath(0, 0, 0, 20);
  // The whole point of portals: 2 m cells + per-wall blocking always swallow a
  // 1.5 m door, so without a declared portal the house has no exit at all.
  check('a wall-blocked grid seals the doorway (the bug portals fix)',
    noPath === null || !noPath.some(([, z]) => z > HALF + 1),
    noPath ? `route stopped at z=${Math.max(...noPath.map((w) => w[1])).toFixed(1)}` : 'no path at all');

  const path = open.nav.findPath(0, 0, 0, 20);
  check('A* routes out of the house through a declared portal',
    !!path && path.some(([, z]) => z > HALF + 2),
    path ? `${path.length} waypoints, ends (${path.at(-1)[0].toFixed(1)}, ${path.at(-1)[1].toFixed(1)})` : 'null');

  const portalWp = path && path.find((w) => w[2]);
  check('the route carries an exact doorway waypoint, not a cell centre',
    !!portalWp && Math.abs(portalWp[0] - 0) < 1e-6 && Math.abs(portalWp[1] - HALF) < 1e-6,
    portalWp ? `(${portalWp[0]}, ${portalWp[1]})` : 'none flagged');

  // A door must stay open once declared, whatever is built next door.
  open.nav.blockBox(-2, HALF - 1, 2, HALF + 1);
  check('a later blockBox cannot re-seal a declared doorway',
    !!open.nav.findPath(0, 0, 0, 20)?.some(([, z]) => z > HALF + 2));

  check('a district barrier still seals with force',
    (() => {
      const w = buildWorld();
      w.nav.blockBox(-2, HALF - 1, 2, HALF + 1, true);
      const p = w.nav.findPath(0, 0, 0, 20);
      return !p || !p.some(([, z]) => z > HALF + 2);
    })());

  // Endpoints inside geometry used to make A* give up entirely.
  const fromWall = open.nav.findPath(-HALF + 0.1, 0, 0, 20);
  check('a start point buried in a wall still resolves a route', !!fromWall);
}

/* ------------------------------------------------------------------ */
/* 2. sensory alignment                                                 */
/* ------------------------------------------------------------------ */
{
  const world = buildWorld();
  const senses = new Senses(world, { range: 3.2, rays: 12, interval: 0 });

  // NPC yaw comes from atan2(moveX, moveZ), so yaw 0 faces +Z. Right is that
  // rotated -90° about Y, i.e. -X — the same handedness the player's basis uses
  // (its yaw 0 faces -Z with right at +X).
  const a = agentAt(0, 0, 0);
  senses.update(0.02, a);
  check('yaw 0 → forward is +Z', Math.abs(senses.forward.z - 1) < 1e-9 && Math.abs(senses.forward.x) < 1e-9);
  check('yaw 0 → right is -X (forward rotated -90° about Y)',
    Math.abs(senses.right.x + 1) < 1e-9 && Math.abs(senses.right.z) < 1e-9);
  check('right stays perpendicular and consistently handed at any yaw', (() => {
    for (const y of [0.3, 1.1, 2.7, -2.0, 5.5]) {
      senses.update(0.02, agentAt(0, 0, y));
      const f = senses.forward, r = senses.right;
      if (Math.abs(f.x * r.x + f.z * r.z) > 1e-9) return false;      // perpendicular
      if (Math.abs(r.x + f.z) > 1e-9 || Math.abs(r.z - f.x) > 1e-9) return false; // -90° about Y
    }
    return true;
  })());

  const b = agentAt(0, 0, Math.PI / 2);
  senses.update(0.02, b);
  check('yaw 90° → forward is +X', Math.abs(senses.forward.x - 1) < 1e-9 && Math.abs(senses.forward.z) < 1e-9);

  // Stand near the solid west wall and face north: the wall must read as being
  // to the agent's LEFT, and the clearance that way must be the short one.
  const c = agentAt(-HALF + 1.2, 0, Math.PI); // facing -Z
  senses.update(0.02, c);
  const leftOfFacing = { x: senses.forward.z, z: -senses.forward.x }; // = -right
  const wallward = senses.clearanceToward(-1, 0);   // toward the west wall
  const openward = senses.clearanceToward(1, 0);    // into the room
  check('a wall to one side reads as near on that side only',
    wallward < 1.4 && openward > 3.0, `wall ${wallward.toFixed(2)}m, open ${openward.toFixed(2)}m`);
  check('the near side is the agent\'s left when facing -Z',
    senses.clearanceToward(leftOfFacing.x, leftOfFacing.z) < 1.4);
  check('slot 0 is dead ahead', Math.abs(senses.dirX[0] - senses.forward.x) < 1e-9);
}

/* ------------------------------------------------------------------ */
/* 3. threading a doorway                                               */
/* ------------------------------------------------------------------ */
{
  const world = buildWorld();
  const senses = new Senses(world, { range: 3.2, rays: 12, interval: 0 });

  // Inside the house, right up against the door wall, facing the opening.
  const a = agentAt(0, HALF - 0.8, 0);
  senses.update(0.02, a);

  const ctx = contextSteer(0, 1, senses);
  check('context steering walks THROUGH a doorway it is facing',
    ctx.z > 0.85, `dir (${ctx.x.toFixed(2)}, ${ctx.z.toFixed(2)})`);

  // The repulsion-sum model this replaced does the opposite here: the two door
  // jambs cancel sideways and what is left pushes the agent back into the room.
  const old = avoidObstacles(0, 1, senses, 1.7);
  check('the old repulsion model pushed back out of it (regression guard)',
    old.z < ctx.z, `old z=${old.z.toFixed(2)} vs new z=${ctx.z.toFixed(2)}`);

  // Offset to one side of the opening: it must slide across to the gap, not
  // stall against the wall in front of it.
  const b = agentAt(1.1, HALF - 0.9, 0);
  senses.update(0.02, b);
  const off = contextSteer(0, 1, senses);
  check('offset from the opening, steering moves toward the gap',
    off.x < -0.05 && off.z > 0, `dir (${off.x.toFixed(2)}, ${off.z.toFixed(2)})`);
}

/* ------------------------------------------------------------------ */
/* 4. dead ends                                                         */
/* ------------------------------------------------------------------ */
{
  const world = buildWorld();
  const senses = new Senses(world, { range: 3.2, rays: 12, interval: 0 });
  // Nose into the solid -Z corner, still wanting to go that way.
  const a = agentAt(0, -HALF + 0.6, Math.PI);
  senses.update(0.02, a);
  const dir = contextSteer(0, -1, senses);
  check('a dead end steers back out instead of into the wall',
    dir.z > -0.4, `dir (${dir.x.toFixed(2)}, ${dir.z.toFixed(2)})`);
  check('the sensory ring sees the open side of a dead end',
    senses.openDirection(0, -1).z > -0.5);
}

/* ------------------------------------------------------------------ */
/* 5. the navigator walks an agent out of the house                     */
/* ------------------------------------------------------------------ */
function walkOut(world, opts = {}) {
  const agent = agentAt(opts.x ?? 0, opts.z ?? -2, 0);
  agent.senses = new Senses(world, { range: 2.6, rays: 12, interval: 0.15 });
  const nav = new NavAgent(world, { steer: { pad: 0.6, minClear: 0.5 } });
  const goal = { x: opts.goalX ?? 0, z: opts.goalZ ?? 24 };
  const dt = 1 / 60;
  const budget = { n: 99 };
  let escapedAt = -1;
  for (let i = 0; i < 60 * 25; i++) {
    agent.senses.update(dt, agent);
    const step = nav.steer(dt, agent, goal, { budget, senses: agent.senses });
    if (step) {
      agent.position.x += step.x * 2.4 * step.scale * dt;
      agent.position.z += step.z * 2.4 * step.scale * dt;
      agent.yaw = Math.atan2(step.x, step.z);
    }
    world.collision.resolveCapsule(agent.position, 0.4, 1.7);
    if (escapedAt < 0 && agent.position.z > HALF + 1.5) escapedAt = i * dt;
    if (Math.hypot(goal.x - agent.position.x, goal.z - agent.position.z) < 2) break;
  }
  return { agent, escapedAt, nav };
}

{
  const world = buildWorld();
  for (const start of [{ x: 0, z: -2 }, { x: -3.5, z: -3.5 }, { x: 3.6, z: 2 }]) {
    const { agent, escapedAt } = walkOut(world, start);
    check(`an agent at (${start.x}, ${start.z}) gets out of the house and to its goal`,
      escapedAt >= 0 && agent.position.z > 20,
      `out at ${escapedAt.toFixed(1)}s, ended z=${agent.position.z.toFixed(1)}`);
  }
}

/* ------------------------------------------------------------------ */
/* 6. no route at all: make for a declared door anyway                  */
/* ------------------------------------------------------------------ */
{
  // Portal declared for the escape hunt, but the grid deliberately left sealed
  // so findPath cannot help — this is the "the route resolver has no answer"
  // fallback, which is what actually gets a spawned-in zombie out of a house.
  const world = buildWorld({ withPortal: false });
  world.nav.portals.push({ x: 0, z: HALF, nx: 0, nz: 1, width: DOOR, tag: 'door' });
  const { agent, escapedAt } = walkOut(world);
  check('with no route at all, the agent still finds the declared door',
    escapedAt >= 0, `left the house at ${escapedAt.toFixed(1)}s, z=${agent.position.z.toFixed(1)}`);
}

/* ------------------------------------------------------------------ */
/* 7. behaviour arbitration                                             */
/* ------------------------------------------------------------------ */
{
  const log = [];
  class Scored extends Behavior {
    constructor(name, fn) { super(name); this.fn = fn; this.minDwell = 0.1; }
    score(ctx) { return this.fn(ctx); }
    enter() { log.push(this.name); }
    step() { return { x: 0, z: 1, speed: 1 }; }
  }
  const brain = new Brain()
    .add(new Scored('flee', (c) => (c.danger ? 100 : 0)))
    .add(new Scored('wander', () => 2))
    .add(new Scored('idle', (c) => (c.tired ? 3 : 0)));

  const ctx = { danger: false, tired: false };
  for (let i = 0; i < 10; i++) brain.update(1 / 60, ctx);
  check('the default behaviour takes over', brain.state === 'wander');

  ctx.danger = true;
  brain.update(1 / 60, ctx);
  check('a threat preempts immediately, without waiting out the dwell',
    brain.state === 'flee');

  ctx.danger = false;
  for (let i = 0; i < 20; i++) brain.update(1 / 60, ctx);
  check('the threat passing returns it to what it was doing', brain.state === 'wander');

  ctx.tired = true;
  for (let i = 0; i < 20; i++) brain.update(1 / 60, ctx);
  check('a higher-scoring rival still wins', brain.state === 'idle');

  // Two behaviours a hair apart must not swap every frame.
  const flicker = new Brain();
  let bias = 0;
  flicker.add(new Scored('a', () => 5 + bias)).add(new Scored('b', () => 5.2));
  const before = log.length;
  for (let i = 0; i < 200; i++) { bias = (i % 2) ? 0.3 : -0.3; flicker.update(1 / 60, {}); }
  check('near-tied behaviours do not thrash', log.length - before <= 2,
    `${log.length - before} switches over 200 ticks`);

  check('scores are exposed for debugging', brain.scores.get('idle') === 3);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall AI checks passed');
process.exit(failures ? 1 : 0);
