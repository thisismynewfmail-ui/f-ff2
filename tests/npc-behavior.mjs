/**
 * NPC behaviour tests against the REAL game world.
 *
 * Boots the actual game in headless Chromium, then drives `game.update(dt)`
 * directly at a fixed timestep instead of waiting on frames. Nothing here
 * depends on rendering speed, so a software-GL machine runs the same
 * simulation as a fast one — twenty simulated seconds cost milliseconds.
 *
 * What it asserts, in the real town with real buildings and real doorways:
 *   1. a zombie spawned inside a house gets out of it and closes on the player
 *   2. hunters prioritise the player, and only fall back to a friendly when
 *      there is no live player — and only one inside their detection envelope
 *   3. the friendly's flee band tracks each zombie type's own sight range,
 *      with hysteresis, and she returns to her ordinary behaviour afterwards
 *   4. cullBlindSeconds is opt-in: on, a permanently blind zombie is culled;
 *      off, the same zombie is left alone
 *   5. agents keep making ground rather than grinding on walls
 *
 * Usage: node tests/npc-behavior.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    if (path === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'POST' ? '{"ok":true}' : '{"exists":false}');
      return;
    }
    const data = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(8141, r));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8141/index.html?test=1');
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state.state === 'playing', null, { timeout: 60000 });

/**
 * Test-harness helpers installed in the page: park the wave director so it
 * cannot stream zombies in mid-test, and step the simulation at a fixed dt.
 */
await page.evaluate(() => {
  const g = window.__game;
  window.__h = {
    quiesce() {
      g.waves.state = 'respite';
      g.waves.respiteLeft = 1e9;   // no new waves
      g.waves.toSpawn = 0;
      g.citizens.reset();
      for (const z of g.spawner.zombies) g.renderer.scene.remove(z.mesh);
      g.spawner.zombies.length = 0;
      g.player.alive = true;
      g.player.hp = 1e6;           // never dies mid-test
    },
    /** Advance the real simulation without rendering a single frame. */
    step(seconds, dt = 1 / 30) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) { g.time += dt; g.update(dt); }
    },
    /** Footprint of a building spec, accounting for its 90° rotation steps. */
    footprint(spec) {
      const rot = ((spec.rot || 0) % 360 + 360) % 360;
      const swap = rot === 90 || rot === 270;
      return { x: spec.x, z: spec.z, w: swap ? spec.d : spec.w, d: swap ? spec.w : spec.d };
    },
    inside(spec, x, z, margin = 0) {
      const f = window.__h.footprint(spec);
      return Math.abs(x - f.x) < f.w / 2 + margin && Math.abs(z - f.z) < f.d / 2 + margin;
    },
    place(type, x, z) {
      const zb = g.spawner.spawnOne(type, g.player);
      if (zb) zb.placeAt(x, z);
      return zb;
    },
    movePlayer(x, z) {
      g.player.position.set(x, g.world.groundHeightFor(x, z, 1e9), z);
    },
  };
});

check('boot without console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ------------------------------------------------------------------ */
/* 0. the world declares its doorways                                   */
/* ------------------------------------------------------------------ */
const portals = await page.evaluate(() => {
  const nav = window.__game.world.nav;
  return { total: nav.portals.length, doors: nav.portals.filter((p) => p.tag === 'door').length };
});
check('every building registers its openings as nav portals',
  portals.doors > 40 && portals.total > portals.doors,
  `${portals.doors} doors + ${portals.total - portals.doors} interior gaps`);

/* ------------------------------------------------------------------ */
/* 1. escaping a spawn house                                            */
/* ------------------------------------------------------------------ */
const escapeRun = await page.evaluate(() => {
  const g = window.__game, h = window.__h;
  // A shambling walker moves at ~2 m/s and some of these routes run 50 m round
  // the outside of a building, so give it time to actually walk one.
  const ESCAPE_WINDOW = 40;
  const results = [];
  // Enterable buildings with interior partitions are the hard case: the route
  // out has to pass a partition gap AND the front door.
  const candidates = g.world.buildingSpecs
    .filter((s) => !s.solid && s.door && g.world.built.get(s.name)?.spawnPoints?.length)
    .sort((a, b) => (b.partitions?.length ?? 0) - (a.partitions?.length ?? 0))
    .slice(0, 10);

  // A building whose door opens straight onto another building's wall cannot be
  // walked out of by anything, and that is a level-geometry fact rather than an
  // AI one. Detect it honestly — clear physical line from the threshold out to
  // open air — and report how many there are instead of quietly averaging them
  // into the result.
  const blocked = [];
  const specs = candidates.filter((spec) => {
    const built = g.world.built.get(spec.name);
    const door = built.doorWorld;
    const p = (built.portals ?? []).find((q) => q.tag === 'door');
    if (!door || !p) return false;
    const y = g.world.groundHeightFor(door.x, door.z, 1e9) + 1.0;
    // A fan, not a single ray: a lamp post or a bench beside the path is
    // something to walk around, whereas a wall across the whole threshold is
    // not. Blocked only when every way out of the doorway is closed.
    const clear = [0, 0.6, -0.6].some((a) => {
      const nx = p.nx * Math.cos(a) - p.nz * Math.sin(a);
      const nz = p.nx * Math.sin(a) + p.nz * Math.cos(a);
      return !g.world.collision.segmentBlocked(
        door.x + nx * 0.5, y, door.z + nz * 0.5,
        door.x + nx * 3.5, y, door.z + nz * 3.5);
    });
    if (!clear) blocked.push(spec.name);
    return clear;
  });

  for (const spec of specs) {
    for (const behind of [false, true]) {
      h.quiesce();
      const built = g.world.built.get(spec.name);
      const sp = built.spawnPoints[0];
      const f = h.footprint(spec);
      const door = built.doorWorld ?? { x: f.x, z: f.z + f.d / 2 };
      // Stand the player ~30 m out: once in front of the door, once round the
      // BACK of the building so getting to them needs a real route rather than
      // a beeline. The spot has to be open ground the grid can actually route
      // to — asking for somewhere unreachable tests nothing but the test.
      let ux = door.x - f.x, uz = door.z - f.z;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l; uz /= l;
      const s = behind ? -1 : 1;
      let spot = null;
      for (const dist of [30, 26, 34, 22, 38]) {
        for (const rot of [0, 0.6, -0.6, 1.2, -1.2]) {
          const dx = ux * Math.cos(rot) - uz * Math.sin(rot);
          const dz = ux * Math.sin(rot) + uz * Math.cos(rot);
          const c = g.world.nav.nearestOpen(f.x + dx * s * dist, f.z + dz * s * dist, 8);
          if (c && g.world.nav.findPath(sp.x, sp.z, c.x, c.z)) { spot = c; break; }
        }
        if (spot) break;
      }
      if (!spot) continue;
      h.movePlayer(spot.x, spot.z);
      const zb = h.place('walker', sp.x, sp.z);
      if (!zb) continue;
      zb.flags.cullBlindSeconds = 0;  // the cull would end the test early
      const gap = () => Math.hypot(g.player.position.x - zb.position.x, g.player.position.z - zb.position.z);
      const start = gap();
      let outAt = -1;
      // Closest approach, not final distance: once a zombie reaches the player
      // it starts hitting them, and the knockback on those hits shoves the
      // (deliberately unkillable) test player away again.
      let closest = start;
      for (let t = 0; t < ESCAPE_WINDOW; t += 0.5) {
        h.step(0.5);
        if (outAt < 0 && !h.inside(spec, zb.position.x, zb.position.z, 0.6)) outAt = t;
        closest = Math.min(closest, gap());
      }
      results.push({
        name: spec.name + (behind ? ' (player behind)' : ''),
        partitions: spec.partitions?.length ?? 0,
        outAt, closest, start,
      });
    }
  }
  return { results, blocked, considered: candidates.length };
});
const escapes = escapeRun.results;
check('the town\'s doorways open onto walkable ground',
  escapeRun.blocked.length <= 1,
  escapeRun.blocked.length
    ? `${escapeRun.blocked.join(', ')} — door blocked by neighbouring geometry, excluded (a level-layout issue: a zombie shut in one is what the cullBlindSeconds flag exists to clear)`
    : `all ${escapeRun.considered} checked`);

const escaped = escapes.filter((r) => r.outAt >= 0);
check('zombies spawned inside houses get out of them',
  escaped.length === escapes.length,
  `${escaped.length}/${escapes.length} escaped; slowest ${Math.max(...escapes.map((r) => r.outAt)).toFixed(1)}s` +
  (escaped.length < escapes.length ? ` — stuck in ${escapes.filter((r) => r.outAt < 0).map((r) => r.name).join(', ')}` : ''));
check('...including houses with interior partition walls to get through',
  escapes.some((r) => r.partitions > 0) && escapes.filter((r) => r.partitions > 0).every((r) => r.outAt >= 0),
  `${escapes.filter((r) => r.partitions > 0).length} partitioned houses tested`);
check('...and then close the distance on the player',
  escapes.every((r) => r.closest < 12),
  `from ~${Math.round(escapes[0].start)} m out, closed to ${escapes.map((r) => r.closest.toFixed(0)).join('/')} m`);

/* ------------------------------------------------------------------ */
/* 2. target priority                                                   */
/* ------------------------------------------------------------------ */
const priority = await page.evaluate(() => {
  const g = window.__game, h = window.__h;
  h.quiesce();
  const p = g.world.npcSpawn;
  h.movePlayer(p.x + 6, p.z + 6);
  g.npc.position.set(p.x, g.world.groundHeightFor(p.x, p.z, 1e9), p.z);
  g.npc.alive = true;
  const zb = h.place('walker', p.x + 3, p.z - 3);
  h.step(0.6);
  const withPlayer = zb.victim === g.player;

  // Player gone: now, and only now, the friendly becomes a target.
  g.player.alive = false;
  h.step(0.6);
  const withoutPlayer = zb.victim === g.npc;

  // ...and only while she is inside the detection envelope. Put her far away.
  g.npc.position.x = p.x + 400;
  zb.senses.clearMemory();
  zb.victim = null;
  h.step(0.6);
  const outOfRange = zb.victim === null;

  g.player.alive = true;
  g.npc.position.set(p.x, g.world.groundHeightFor(p.x, p.z, 1e9), p.z);
  return { withPlayer, withoutPlayer, outOfRange };
});
check('zombies prioritise the player over a friendly standing closer', priority.withPlayer);
check('with no live player they fall back to a friendly in range', priority.withoutPlayer);
check('a friendly beyond the detection range is not a target', priority.outOfRange);

/* ------------------------------------------------------------------ */
/* 3. the friendly's flee band vs zombie sight distance                 */
/* ------------------------------------------------------------------ */
const flee = await page.evaluate(() => {
  const g = window.__game, h = window.__h;
  // Open ground away from town so nothing blocks line of sight.
  const HX = 0, HZ = -150;

  // Walk a zombie of `type` in from far away and report the distance at which
  // she starts running, and (once running) the distance at which she stops.
  const band = (type) => {
    h.quiesce();
    g.npc.home.x = HX; g.npc.home.z = HZ;
    g.npc.position.set(HX, g.world.groundHeightFor(HX, HZ, 1e9), HZ);
    g.npc._threat = null;
    g.npc.brain.reset(null);
    h.movePlayer(HX + 300, HZ);
    const zb = h.place(type, HX, HZ + 400);
    zb.flags.cullBlindSeconds = 0;
    const R = zb.config.sightRange;

    let enterAt = -1;
    for (let d = R * 1.4; d > 2 && enterAt < 0; d -= 1) {
      zb.position.set(HX, g.world.groundHeightFor(HX, HZ + d, 1e9), HZ + d);
      zb.yaw = Math.PI;                       // facing her
      g.npc.position.set(HX, g.npc.position.y, HZ);
      h.step(0.25);
      if (g.npc._threat) enterAt = d;
    }
    const fleeing = g.npc.brain.state;

    let exitAt = -1;
    for (let d = enterAt; d < R * 1.6 && exitAt < 0; d += 1) {
      zb.position.set(HX, g.world.groundHeightFor(HX, HZ + d, 1e9), HZ + d);
      zb.yaw = Math.PI;
      g.npc.position.set(HX, g.npc.position.y, HZ);
      h.step(0.25);
      if (!g.npc._threat) exitAt = d;
    }
    return { type, sight: R, enterAt, exitAt, fleeing };
  };

  const walker = band('walker');
  const sprinter = band('sprinter');

  // Behind a wall: same distance, but no line of sight, so no panic.
  h.quiesce();
  const spec = g.world.buildingSpecs.find((s) => s.solid) ?? g.world.buildingSpecs[0];
  const f = h.footprint(spec);
  g.npc.position.set(f.x, g.world.groundHeightFor(f.x, f.z - f.d / 2 - 3, 1e9), f.z - f.d / 2 - 3);
  g.npc._threat = null;
  h.movePlayer(f.x + 250, f.z);
  const blocked = h.place('walker', f.x, f.z + f.d / 2 + 3);
  blocked.yaw = Math.PI;
  h.step(1.0);
  const throughWall = g.npc._threat;

  // ...and once the threat is gone she goes back to ordinary behaviour.
  h.quiesce();
  g.npc.home.x = HX; g.npc.home.z = HZ;
  g.npc.position.set(HX, g.world.groundHeightFor(HX, HZ, 1e9), HZ);
  g.npc._threat = null;
  h.step(3);
  const calmState = g.npc.brain.state;

  return { walker, sprinter, throughWall: !!throughWall, calmState };
});
check('she bolts at ~70% of the approaching zombie\'s OWN sight range',
  Math.abs(flee.walker.enterAt - flee.walker.sight * 0.7) <= 2.5,
  `walker sees ${flee.walker.sight}m, she ran at ${flee.walker.enterAt}m`);
check('a longer-sighted zombie makes her run from further out',
  flee.sprinter.enterAt > flee.walker.enterAt &&
  Math.abs(flee.sprinter.enterAt - flee.sprinter.sight * 0.7) <= 2.5,
  `sprinter sees ${flee.sprinter.sight}m, she ran at ${flee.sprinter.enterAt}m`);
check('she keeps running past where she started (hysteresis, no flip-flop)',
  flee.walker.exitAt > flee.walker.enterAt + 5,
  `ran at ${flee.walker.enterAt}m, settled at ${flee.walker.exitAt}m`);
check('the flee behaviour is what actually takes over', flee.walker.fleeing === 'flee', flee.walker.fleeing);
check('a zombie that cannot see her (wall between) is not a threat', flee.throughWall === false);
check('with the coast clear she returns to idling/wandering',
  flee.calmState === 'wander' || flee.calmState === 'idle' || flee.calmState === 'regroup',
  flee.calmState);

/* ------------------------------------------------------------------ */
/* 3b. the specialist hunters keep their own behaviour                  */
/* ------------------------------------------------------------------ */
const specialists = await page.evaluate(() => {
  const g = window.__game, h = window.__h;
  const p = g.world.npcSpawn;

  // Both need open ground with a clear line between them — their whole point is
  // what they do once they can SEE the player, so put them somewhere they can.
  const facing = (radius) => {
    const py = g.world.groundHeightFor(p.x, p.z, 1e9);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = p.x + Math.cos(a) * radius, z = p.z + Math.sin(a) * radius;
      if (g.world.nav.isBlockedAt(x, z)) continue;
      if (g.world.hasLineOfSight(p.x, py + 1.5, p.z, x, g.world.groundHeightFor(x, z, 1e9) + 1.2, z)) return { x, z };
    }
    return { x: p.x + radius, z: p.z };
  };

  // Exploder: closes, then plants itself and burns a fuse before detonating.
  h.quiesce();
  h.movePlayer(p.x, p.z);
  let boom = null;
  const off = g.events.on('exploder:explode', (e) => { boom = e; });
  const exAt = facing(9);
  const ex = h.place('exploder', exAt.x, exAt.z);
  const exStates = new Set();
  for (let t = 0; t < 40 && !boom; t++) { h.step(0.25); exStates.add(ex.state); }
  if (typeof off === 'function') off();

  // Spitter: holds a standoff band, plants to aim, then fires.
  h.quiesce();
  h.movePlayer(p.x, p.z);
  let shot = null;
  const off2 = g.events.on('spitter:fire', (e) => { shot = e; });
  const spAt = facing(8);
  const sp = h.place('spitter', spAt.x, spAt.z);
  const spStates = new Set();
  for (let t = 0; t < 60 && !shot; t++) { h.step(0.25); spStates.add(sp.state); }
  if (typeof off2 === 'function') off2();

  return {
    exploded: !!boom, exStates: [...exStates],
    fired: !!shot, spStates: [...spStates],
    spDist: Math.hypot(sp.position.x - g.player.position.x, sp.position.z - g.player.position.z),
    spBand: [sp.config.standoffMin, sp.config.standoffMax],
  };
});
check('the Exploder still charges, plants a fuse and detonates',
  specialists.exploded && specialists.exStates.includes('fuse'),
  specialists.exStates.join('→'));
check('the Spitter still kites, plants to aim and fires',
  specialists.fired && specialists.spStates.includes('aiming'),
  specialists.spStates.join('→'));
check('...and holds its standoff band rather than closing to melee',
  specialists.spDist > specialists.spBand[0] - 2,
  `${specialists.spDist.toFixed(1)} m vs band ${specialists.spBand.join('-')} m`);

/* ------------------------------------------------------------------ */
/* 4. the blind-cull flag is opt-in                                     */
/* ------------------------------------------------------------------ */
const cull = await page.evaluate(() => {
  const g = window.__game, h = window.__h;
  // Deep inside a solid block, with the player far away: it can never get a
  // line to the player, which is exactly the straggler the flag exists for.
  const run = (seconds, flagOn) => {
    h.quiesce();
    const p = g.world.npcSpawn;
    h.movePlayer(p.x + 60, p.z + 60);
    const zb = h.place('walker', p.x, p.z);
    if (flagOn) zb.flags.cullBlindSeconds = 5; else delete zb.flags.cullBlindSeconds;
    // Hold the exact condition the flag is defined against — no unobstructed
    // line to the player — rather than hoping some geometry keeps holding it.
    const los = g.world.hasLineOfSight;
    g.world.hasLineOfSight = () => false;
    try { h.step(seconds); } finally { g.world.hasLineOfSight = los; }
    return { culled: zb.culled === true, dead: zb.state === 'dead', blind: zb.blindTimer };
  };
  const on = run(8, true);
  const off = run(8, false);
  const dflt = window.__game.spawner.cullBlindSeconds;
  return { on, off, dflt };
});
check('with the flag set, a permanently blind zombie is culled',
  cull.on.culled && cull.on.dead, `blindTimer ${cull.on.blind.toFixed(1)}s`);
check('without it, the same zombie is left alone (not default behaviour)',
  !cull.off.culled && !cull.off.dead, `blindTimer ${cull.off.blind.toFixed(1)}s`);
check('the game actively adds the 30s cull flag at startup', cull.dflt === 30, `${cull.dflt}s`);

/* ------------------------------------------------------------------ */
/* 5. movement actually makes ground                                    */
/* ------------------------------------------------------------------ */
const roaming = await page.evaluate(() => {
  const g = window.__game, h = window.__h;
  h.quiesce();
  const p = g.world.npcSpawn;
  g.npc.home.x = p.x; g.npc.home.z = p.z;   // the flee test walks her home marker about
  h.movePlayer(p.x + 120, p.z + 120);       // far enough that nothing is fleeing
  g.npc.position.set(p.x, g.world.groundHeightFor(p.x, p.z, 1e9), p.z);
  g.npc._threat = null;
  g.npc.brain.reset(null);

  const track = (e, ticks = 60) => {
    let dist = 0;
    let px = e.position.x, pz = e.position.z;
    for (let i = 0; i < ticks; i++) {
      h.step(0.25);
      dist += Math.hypot(e.position.x - px, e.position.z - pz);
      px = e.position.x; pz = e.position.z;
    }
    return dist;
  };
  const npcDist = track(g.npc);
  const homeGap = Math.hypot(g.npc.position.x - g.npc.home.x, g.npc.position.z - g.npc.home.z);

  // The cockroach legitimately sits still once it has holed up indoors by day,
  // so prove its behaviours still fire by scaring it: the player walking onto
  // it must flip it into 'flee' and it must actually bolt.
  const r = g.cockroach;
  h.movePlayer(r.position.x + 1.2, r.position.z);
  h.step(0.4);
  const roachState = r.state;
  const roachDist = track(r, 12);

  return { npcDist, roachDist, homeGap, npcState: g.npc.brain.state, roachState };
});
check('the friendly wanders instead of grinding on a wall',
  roaming.npcDist > 4, `${roaming.npcDist.toFixed(1)}m over 15s`);
check('she stays around home while wandering', roaming.homeGap < 30, `${roaming.homeGap.toFixed(1)}m from home`);
check('the cockroach still switches behaviour on sensory input',
  roaming.roachState === 'flee' && roaming.roachDist > 1.5,
  `state '${roaming.roachState}', bolted ${roaming.roachDist.toFixed(1)}m`);

check('no errors raised across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures ? `\n${failures} failure(s)` : '\nall NPC behaviour checks passed');
process.exit(failures ? 1 : 0);
