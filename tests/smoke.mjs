/**
 * Browser smoke test. Serves the repo, drives the real game in headless
 * Chromium and verifies:
 *   1. clean boot (no console errors / page errors)
 *   2. game reaches 'playing', player can move, zombies spawn from wave 1
 *   3. shooting pipeline works (fire event -> ammo decrements)
 *   4. THE win condition: victory fires at exactly 250,000 kills — driven
 *      through the same registerKill pipeline 'zombie:death' events use,
 *      asserting no victory at 249,999 and victory + stats screen at 250,000
 *   5. zone unlocks happened at their kill thresholds along the way
 *
 * Usage: node tests/smoke.mjs [--screens]
 * Requires playwright-core (any location via NODE_PATH) and the
 * pre-installed Chromium in PLAYWRIGHT_BROWSERS_PATH.
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
const takeScreens = process.argv.includes('--screens');
const SCREEN_DIR = process.env.SCREEN_DIR || '.';

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    // Mirror the dev server's session API (scripts/serve.mjs) so the game's
    // save/load calls never 404 into the console-error count. No disk here:
    // GET reports "no previous session", POST pretends to accept the save.
    if (path === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'POST' ? '{"ok":true}' : '{"exists":false}');
      return;
    }
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(8137, r));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  // Use the environment's pre-installed Chromium regardless of the
  // playwright-core version's pinned browser build.
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:8137/index.html?test=1');
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });

// 1. clean boot
check('boot without console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

// menu screenshot
if (takeScreens) await page.screenshot({ path: join(SCREEN_DIR, 'shot_menu.png') });

// 2. start playing
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state.state === 'playing');
check('state reaches playing', true);

// Player movement. Wait on the OUTCOME, not on a stopwatch: a software
// renderer under load produces so few frames that a fixed 1.5s hold lands
// within rounding distance of the threshold and the test fails for being on a
// busy machine rather than for the movement being broken.
const before = await page.evaluate(() => ({ ...window.__game.player.position }));
await page.keyboard.down('w');
await page.waitForFunction((b) => {
  const p = window.__game.player.position;
  return Math.hypot(p.x - b.x, p.z - b.z) > 1.2;
}, before, { timeout: 8000 }).catch(() => {});
await page.keyboard.up('w');
const after = await page.evaluate(() => ({ ...window.__game.player.position }));
const moved = Math.hypot(after.x - before.x, after.z - before.z);
check('WASD moves the player', moved > 1, `moved ${moved.toFixed(2)}m`);

// BUILDING & STRUCTURE OVERHAUL: urban-planning ratios, adjacent-texture
// variety, the maintenance gradient, furnished interiors and infrastructure.
const town = await page.evaluate(() => {
  const w = window.__game.world;
  const specs = w.buildingSpecs;
  const c = (re) => specs.filter((s) => re.test(s.name)).length;
  let adjacentSame = 0;
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const a = specs[i], b = specs[j];
      const gap = Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
      if (gap < 6 && a.wall === b.wall) adjacentSame++;
    }
  }
  const avgDer = (pred) => {
    const l = specs.filter(pred);
    return l.reduce((s, x) => s + x.derelict, 0) / l.length;
  };
  return {
    total: specs.length,
    libraries: c(/^library$/),
    churches: c(/church|chapel/),
    gas: c(/^gas/),
    houses: c(/house|cottage|lodge/),
    adjacentSame,
    coreDerelict: avgDer((s) => Math.hypot(s.x, s.z) < 60),
    rimDerelict: avgDer((s) => Math.hypot(s.x, s.z) > 180),
    interiors: w.interiors.populated.length,
    enterable: specs.filter((s) => !s.solid).length,
    lootPoints: w.lootPoints.length,
  };
});
check('exactly one library in town', town.libraries === 1, `${town.libraries}`);
check('at most two churches', town.churches >= 1 && town.churches <= 2, `${town.churches}`);
check('three to five gas stations', town.gas >= 3 && town.gas <= 5, `${town.gas}`);
check('dozens of residential houses', town.houses >= 24, `${town.houses}`);
check('no adjacent buildings share a wall texture', town.adjacentSame === 0, `${town.adjacentSame} clashes`);
check('town core better maintained than the outskirts', town.coreDerelict < town.rimDerelict - 0.1,
  `core ${town.coreDerelict.toFixed(2)} vs rim ${town.rimDerelict.toFixed(2)}`);
check('every enterable building has a furnished interior', town.interiors === town.enterable,
  `${town.interiors}/${town.enterable}`);
check('interior loot points registered', town.lootPoints > 100, `${town.lootPoints}`);

// Zombies spawn once wave 1 starts. The grace period is ~10 s of GAME time,
// which is only ~10 s of wall time on a machine that renders quickly — on a
// software-GL box running at a few frames a second it takes several times
// longer, and everything below was failing for that reason alone. Wait long
// enough for the slow case; a fast machine still sails through in seconds.
await page.waitForFunction(() => window.__game.spawner.zombies.length > 0, null, { timeout: 90000 });
const zc = await page.evaluate(() => window.__game.spawner.zombies.length);
check('wave 1 spawns zombies', zc > 0, `${zc} active`);

// 3. firing decrements ammo and counts shots
const fired = await page.evaluate(() => {
  const g = window.__game;
  const magBefore = g.weapons.current.mag;
  g.weapons.tryFire();
  return { magBefore, magAfter: g.weapons.current.mag, shots: g.score.shotsFired };
});
check('firing consumes ammo + counts the shot', fired.magAfter === fired.magBefore - 1 && fired.shots >= 1,
  `mag ${fired.magBefore}->${fired.magAfter}, shots ${fired.shots}`);

await page.waitForTimeout(1500);
if (takeScreens) await page.screenshot({ path: join(SCREEN_DIR, 'shot_gameplay.png') });

// end-to-end combat AT RANGE: place a walker 25 m out on sloped ground, aim
// the crosshair at its chest and gun it down. The kill must arrive via the
// zombie:death -> ScoreSystem pipeline. (Regression guard for the inverted
// vertical aim bug: point-blank shots hit even with broken pitch; 25 m
// shots only hit when lookDirection matches the camera.)
const combat = await page.evaluate(async () => {
  const g = window.__game;
  const p = g.player;
  const killsBefore = g.score.kills;
  // Eastgate Green (World.EASTGATE_GREEN): the field inside the Wend Loop
  // that the district deliberately keeps clear of planting and building, so
  // this line of sight is a promise the world keeps rather than a coordinate
  // that happens to be empty. It slopes, which is the point.
  p.teleport(158, g.world.groundHeightFor(158, 55, 1e9), 55);
  const z = g.spawner.spawnOne('walker', p) ?? g.spawner.zombies[0];
  z.placeAt(158, 30); // 25 m north, different elevation on the knoll
  const aim = () => {
    const eye = p.eyePosition();
    const dx = z.position.x - eye.x;
    const dy = z.position.y + z.height * 0.55 - eye.y;
    const dz = z.position.z - eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  };
  for (let i = 0; i < 15 && z.state !== 'dead'; i++) {
    aim();
    g.weapons.current.cooldown = 0;
    g.weapons.current.bloom = 0; // isolate aim from recoil bloom
    g.weapons.current.mag = Math.max(1, g.weapons.current.mag);
    g.weapons.tryFire();
    await new Promise(requestAnimationFrame);
  }
  await new Promise(requestAnimationFrame);
  return { dead: z.state === 'dead', kills: g.score.kills, killsBefore, hits: g.score.shotsHit };
});
check('gunfire kills a zombie at 25 m through the event pipeline',
  combat.dead && combat.kills === combat.killsBefore + 1 && combat.hits > 0,
  JSON.stringify(combat));

// dev console: ` opens it, typed "noclip" grants flight through geometry
await page.keyboard.press('Backquote');
const consoleOpen = await page.evaluate(() => document.getElementById('console').style.display !== 'none');
await page.keyboard.type('noclip');
await page.keyboard.press('Enter');
const noclipOn = await page.evaluate(() => window.__game.player.noclip === true);
await page.keyboard.press('Backquote'); // close so game input resumes
const flew = await page.evaluate(async () => {
  const g = window.__game;
  const y0 = g.player.position.y;
  // park the player inside a solid building: with noclip nothing ejects him
  const tower = [...g.world.built.values()].find((b) => b.spec.name === 'clocktower').spec;
  g.player.position.set(tower.x, tower.y + 1, tower.z);
  for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
  const stayedInside = Math.hypot(g.player.position.x - tower.x, g.player.position.z - tower.z) < 1;
  return { stayedInside, y0 };
});
const spaceFly = await page.evaluate(async () => {
  const g = window.__game;
  const y0 = g.player.position.y;
  g.input.keys.add('Space');
  for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
  g.input.keys.delete('Space');
  return g.player.position.y - y0;
});
const noclipOff = await page.evaluate(async () => {
  const g = window.__game;
  // park back inside the solid tower, then switch noclip off: live
  // collision must eject the player out of the walls
  const tower = [...g.world.built.values()].find((b) => b.spec.name === 'clocktower').spec;
  g.player.position.set(tower.x, tower.y + 1, tower.z);
  await new Promise(requestAnimationFrame);
  g.devConsole.execute('noclip');
  for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
  const ejected = Math.hypot(g.player.position.x - tower.x, g.player.position.z - tower.z) > 2;
  return { off: g.player.noclip === false, ejected };
});
check('` opens the dev console', consoleOpen);
check('"noclip" command enables flight', noclipOn);
check('noclip passes through solid geometry', flew.stayedInside);
check('noclip flies upward on Space', spaceFly > 1, `rose ${spaceFly.toFixed(2)}m`);
check('noclip off restores collision', noclipOff.off && noclipOff.ejected, JSON.stringify(noclipOff));

// SPRINT STAMINA. Hold sprint + forward and drive the player directly at a
// fixed step: the meter must actually run out and lock sprint out for a real
// stretch of time. The bug this guards against is the drain and refill branches
// alternating one frame apart at the bottom of the meter — sprint on the frame
// there is any charge, refill on the frame there is none — which pins the meter
// at zero and lets a held sprint key run forever.
const sprint = await page.evaluate(() => {
  const g = window.__game, p = g.player, input = g.input;
  const held = new Set(['sprint', 'forward']);
  const realActionDown = input.isActionDown, realDown = input.isDown, realPressed = input.wasActionPressed;
  input.isActionDown = (a) => held.has(a);
  input.isDown = () => false;
  input.wasActionPressed = () => false;
  p.noclip = false;
  p.teleport(158, g.world.groundHeightFor(158, 55, 1e9), 55); // Eastgate Green
  p.stamina = p.staminaMax;
  p.winded = false;

  const dt = 1 / 60, frames = 60 * 20;
  let sprintFrames = 0, off = 0, longestOff = 0, hitEmpty = false, sawWinded = false, resumed = false;
  for (let i = 0; i < frames; i++) {
    input.mouseDX = 0; input.mouseDY = 0;
    p.update(dt);
    if (p.stamina <= 0) hitEmpty = true;
    if (p.winded) sawWinded = true;
    if (p.sprinting) {
      if (off > 60) resumed = true;   // sprinted again after a real lockout
      longestOff = Math.max(longestOff, off);
      off = 0;
      sprintFrames++;
    } else off++;
  }
  longestOff = Math.max(longestOff, off);

  input.isActionDown = realActionDown;
  input.isDown = realDown;
  input.wasActionPressed = realPressed;
  p.stamina = p.staminaMax;
  p.winded = false;
  return { longestOff: longestOff * dt, frac: sprintFrames / frames, hitEmpty, sawWinded, resumed };
});
check('holding sprint actually empties the meter', sprint.hitEmpty && sprint.sawWinded);
check('an emptied sprint meter locks sprint out', sprint.longestOff > 1.5,
  `longest non-sprint stretch ${sprint.longestOff.toFixed(2)}s`);
check('sprint returns once the meter has recovered', sprint.resumed);
check('a held sprint key cannot sprint forever', sprint.frac < 0.75,
  `sprinted ${(sprint.frac * 100).toFixed(0)}% of a 20 s hold`);

// AI SENSORY SYSTEM. Freeze the frame loop and drive the perception/behaviour
// stack deterministically: directional senses, wall avoidance, the friendly
// NPC's flee/resume, zombie player-vs-friendly targeting priority, and the
// opt-in blind-cull flag.
const ai = await page.evaluate(async () => {
  const g = window.__game;
  const world = g.world, player = g.player, cam = g.renderer.camera;
  g.state.state = 'paused'; // stop frame() from auto-updating; we drive by hand
  const HX = 0, HZ = 48;    // an open hub south of the square
  const groundAt = (x, z) => world.groundHeightFor(x, z, 1e9);
  const mkCtx = () => ({ player, camPos: cam.position, pathBudget: { n: 4 }, time: g.time,
    zombies: g.spawner.zombies, friendlies: g.friendlies });
  const step = (ent, ctx, n, dt = 0.05) => { for (let i = 0; i < n; i++) ent.update(dt, ctx); };
  const out = {};

  // 1. Direction-aware senses: the forward vector tracks yaw exactly.
  const npc = g.npc;
  npc.yaw = Math.PI / 2; npc.senses.update(0.2, npc);
  out.forwardAligned = Math.abs(npc.senses.forward.x - 1) < 0.01 && Math.abs(npc.senses.forward.z) < 0.01;

  // 2. Wall avoidance: with a box dead ahead the avoid vector points backward.
  npc.position.set(HX, groundAt(HX, HZ), HZ); npc.yaw = 0; // facing +Z
  const boxId = world.collision.addBox(HX - 1.5, npc.position.y, HZ + 1.2, HX + 1.5, npc.position.y + 3, HZ + 2.4, 'test');
  npc.senses._timer = 0; npc.senses.update(0.2, npc);
  const av = npc.senses.avoid;
  out.avoidsWall = av.strength > 0 && (av.x * 0 + av.z * 1) < 0; // opposes +Z facing
  world.collision.remove(boxId);
  npc.senses._timer = 0; npc.senses.update(0.2, npc);
  out.clearWhenOpen = npc.senses.avoid.strength === 0;

  // 3. Friendly NPC flees a nearby zombie, then resumes when it is gone.
  // Sideline the live horde so only our test zombie is a threat, then borrow
  // one of them (spawn points near this hub may be in a locked zone).
  const stash = g.spawner.zombies.map((z) => ({ z, x: z.position.x, zz: z.position.z, st: z.state }));
  for (const s of stash) { s.z.position.x = HX; s.z.position.z = HZ + 9000; }
  let threat = g.spawner.zombies.find((z) => z.state !== 'dead') || g.spawner.spawnOne('walker', player);
  threat.state = 'idle'; threat.alive = true;
  threat.position.set(HX + 15, groundAt(HX + 15, HZ), HZ); // 15 m < walker enter band (35 m)
  npc.position.set(HX, groundAt(HX, HZ), HZ); npc._threat = null; npc.brain.current = null;
  step(npc, mkCtx(), 8);
  out.fleeing = npc.brain.state === 'flee';
  const dNear = Math.hypot(npc.position.x - threat.position.x, npc.position.z - threat.position.z);
  step(npc, mkCtx(), 30);
  const dFar = Math.hypot(npc.position.x - threat.position.x, npc.position.z - threat.position.z);
  out.fledAway = dFar > dNear + 1;
  threat.position.z = HZ + 9000; // threat gone → she should settle
  out.resumed = false;
  for (let i = 0; i < 80; i++) { npc.update(0.05, mkCtx()); if (npc.brain.state !== 'flee') { out.resumed = true; break; } }
  out.resumedTo = npc.brain.state;
  for (const s of stash) { s.z.position.x = s.x; s.z.position.z = s.zz; } // restore horde

  // 4. Zombie targeting: player is seen anywhere (no range gate); friendly NPC
  // only within its sight range; player always outranks the friendly.
  const zz = g.spawner.zombies.find((z) => z.state !== 'dead') || threat;
  zz.position.set(HX, groundAt(HX, HZ), HZ); zz.state = 'idle'; zz.victim = null;
  player.teleport(HX, groundAt(HX, HZ - 80), HZ - 80); player.alive = true; // 80 m > sightRange 50
  step(zz, mkCtx(), 6);
  out.chasesPlayerFar = zz.victim === player && (zz.state === 'chasing' || zz.state === 'attacking');
  // player unavailable → the friendly within range becomes the target
  player.alive = false;
  npc.alive = true; npc.mesh.visible = true;
  npc.position.set(HX + 10, groundAt(HX + 10, HZ), HZ);
  zz.state = 'idle'; zz.victim = null; zz.yaw = Math.atan2(npc.position.x - zz.position.x, npc.position.z - zz.position.z);
  step(zz, mkCtx(), 6);
  out.targetsFriendly = zz.victim === npc && (zz.state === 'chasing' || zz.state === 'attacking');
  // friendly beyond sight range → not a target
  npc.position.set(HX + 70, groundAt(HX + 70, HZ), HZ); // 70 m > sightRange 50
  zz.state = 'idle'; zz.victim = null;
  step(zz, mkCtx(), 4);
  out.ignoresFarFriendly = zz.victim === null && zz.state !== 'chasing' && zz.state !== 'attacking';
  player.alive = true;

  // 5. Blind-cull flag (opt-in): a zombie with no clear line to the player for
  // its window is removed without scoring; one without the flag is not.
  player.teleport(0, groundAt(0, 20), 20);
  const spawnAt = (x, z) => { const c = g.spawner.spawnOne('walker', player) || g.spawner.zombies.find((a) => a.state !== 'dead'); c.position.set(x, groundAt(x, z), z); c.state = 'idle'; c._losTimer = 999; c._hasLos = false; c.blindTimer = 0; return c; };
  g.spawner.setCull(0.15);
  const culled = spawnAt(0, 60); culled.flags.cullBlindSeconds = 0.15;
  const kept = spawnAt(3, 60); delete kept.flags.cullBlindSeconds;
  const killsBefore = g.score.kills;
  for (let i = 0; i < 12; i++) { culled.update(0.05, mkCtx()); kept.update(0.05, mkCtx()); }
  out.cullFires = culled.toRemove === true && culled.state === 'dead';
  out.cullNoScore = g.score.kills === killsBefore;
  out.noFlagSurvives = kept.toRemove !== true;

  g.spawner.setCull(30); // restore the shipped default
  g.state.state = 'playing';
  return out;
});
check('senses forward vector is aligned with facing', ai.forwardAligned);
check('whiskers steer away from a wall dead ahead', ai.avoidsWall);
check('no avoidance in open space', ai.clearWhenOpen);
check('friendly NPC flees a nearby zombie', ai.fleeing);
check('fleeing opens distance from the threat', ai.fledAway);
check('friendly NPC resumes when safe', ai.resumed, `-> ${ai.resumedTo}`);
check('zombie sees the player past its sight range', ai.chasesPlayerFar);
check('zombie hunts a friendly when the player is unavailable', ai.targetsFriendly);
check('friendly beyond sight range is not targeted', ai.ignoresFarFriendly);
check('blind-cull flag removes a stuck zombie', ai.cullFires);
check('cull does not count as a kill', ai.cullNoScore);
check('zombie without the flag is not culled', ai.noFlagSurvives);

// FEATURE PASS: barriers at 50/150, kill command, inventory, cockroach,
// day/night sky, and stats moved off the HUD onto pause-screen rings.
const fx = await page.evaluate(async () => {
  const g = window.__game;
  const world = g.world, player = g.player, cam = g.renderer.camera;
  const groundAt = (x, z) => world.groundHeightFor(x, z, 1e9);
  const out = {};

  // 1. Barrier thresholds: zone 1 at 50 kills, zone 2 at 150.
  const zn = world.zones;
  zn.checkUnlocks(49); const z1_49 = zn.isUnlocked(1);
  zn.checkUnlocks(50); const z1_50 = zn.isUnlocked(1);
  zn.checkUnlocks(149); const z2_149 = zn.isUnlocked(2);
  zn.checkUnlocks(150); const z2_150 = zn.isUnlocked(2);
  out.barriers = !z1_49 && z1_50 && !z2_149 && z2_150;

  // 2. Console kill command adds through the real pipeline.
  const k0 = g.score.kills;
  g.devConsole.execute('kill 5');
  out.killCmd = g.score.kills === k0 + 5;

  // 3. Inventory: Tab-toggle, key storage, mouse handling, sim freeze.
  g.state.state = 'playing';
  const invClosed0 = g.inventory.open === false;
  g.events.emit('pickup', { type: 'key', amount: 1, label: 'Rusty key' });
  const keyStored = g.inventory.items.get('Rusty key')?.count === 1;
  g.inventory.openInventory();
  const opened = g.inventory.open && g.inventory.el.style.display !== 'none' && g.input.suppressed === true;
  const t0 = g.time; g.frame(0.05); const frozen = g.time === t0; // world frozen while open
  g.inventory.close();
  const closed = !g.inventory.open && g.input.suppressed === false;
  out.inventory = invClosed0 && keyStored && opened && frozen && closed;

  // 4. Day/night sky.
  g.sky.setPhase(0.25); g.sky.update(0.001, cam.position); const dayOn = g.sky.isDay === true;
  g.sky.setPhase(0.75); g.sky.update(0.001, cam.position); const nightOn = g.sky.isDay === false;
  g.devConsole.execute('time 0'); g.sky.update(0.001, cam.position); const midnight = !g.sky.isDay;
  g.devConsole.execute('time 12'); g.sky.update(0.001, cam.position); const noon = g.sky.isDay;
  out.sky = dayOn && nightOn && midnight && noon && g.sky.clouds.length === 9;

  // 5. Cockroach: exists, flees the player a short distance, day/night modes.
  const roach = g.cockroach;
  out.roachExists = !!roach && !!roach.mesh;
  g.state.state = 'paused'; // drive deterministically
  const rctx = (isDay) => ({ player, camPos: cam.position, time: g.time, isDay });
  roach.position.set(10, groundAt(10, 10), 10);
  player.teleport(11, groundAt(11, 10), 10); player.alive = true; // 1 m away
  roach._scared = false; roach.brain.current = null;
  for (let i = 0; i < 5; i++) roach.update(0.05, rctx(true));
  const scared = roach._scared && roach.brain.state === 'flee';
  const d0 = roach.distanceTo(player);
  for (let i = 0; i < 15; i++) roach.update(0.05, rctx(true));
  const d1 = roach.distanceTo(player);
  out.roachFlees = scared && d1 > d0;
  // day hides indoors, night roams outdoors (player far away = not scared)
  player.teleport(200, groundAt(200, 200), 200);
  roach.position.set(0, groundAt(0, 20), 20); roach._scared = false;
  roach.brain.current = null; roach.update(0.05, rctx(true));
  const dayMode = roach.brain.state;
  roach.brain.current = null; roach.update(0.05, rctx(false));
  const nightMode = roach.brain.state;
  out.roachDayNight = dayMode === 'hide' && nightMode === 'roam';

  // 6. Zombie size variation + per-zombie gait fields.
  player.teleport(0, groundAt(0, 20), 20);
  const za = g.spawner.spawnOne('walker', player) || g.spawner.zombies.find((z) => z.state !== 'dead');
  const zb = g.spawner.spawnOne('walker', player) || g.spawner.zombies.find((z) => z.state !== 'dead' && z !== za);
  out.zombieVary = za.sizeScale >= 0.9 && za.sizeScale <= 1.1 && typeof za.gaitFreq === 'number' && za.gaitPhase !== zb.gaitPhase;

  // 7. Death FX pools exist (graphic + digital death).
  out.deathFx = !!g.effects.spark && !!g.effects.deathLight;

  // 8. Stats are OFF the HUD and rendered as circular gauges on pause.
  out.noHudStats = document.getElementById('hud-tr') === null && document.getElementById('acc') === null;
  g.state.state = 'playing'; g.pause();
  out.pauseBays = document.querySelectorAll('#pause-stats .bay').length >= 7;
  g.hud.showScreen(null);

  // restore for the win-condition test
  g.state.state = 'playing'; player.alive = true;
  return out;
});
check('barriers unlock at 50 and 150 kills', fx.barriers);
check('console "kill" command adds kills', fx.killCmd);
check('inventory: Tab store/open/freeze/close + mouse', fx.inventory);
check('day/night sky toggles day and night', fx.sky);
check('cockroach exists in the world', fx.roachExists);
check('cockroach flees the player a short distance', fx.roachFlees);
check('cockroach hides by day, roams by night', fx.roachDayNight);
check('zombies have varied size + individual gait', fx.zombieVary);
check('graphic death FX pools present', fx.deathFx);
check('run stats are not on the HUD', fx.noHudStats);
check('run stats live on the pause screen instead', fx.pauseBays);

// SPITTER: the CS:GO-styled dual-pistol ranged enemy. Spawn gate at 100 kills,
// a kited ~6–8 ft standoff band, a slightly-slower-than-player walk, a planted
// quarter-second aim pause (it never moves and shoots at once), and a spread
// shot aimed where the player WAS when the pause began — so juking during the
// tell can dodge it. Driven deterministically with the frame loop paused.
const spit = await page.evaluate(async () => {
  const g = window.__game;
  const world = g.world, player = g.player, cam = g.renderer.camera;
  const groundAt = (x, z) => world.groundHeightFor(x, z, 1e9);
  const mkCtx = () => ({ player, camPos: cam.position, pathBudget: { n: 4 }, time: g.time,
    zombies: g.spawner.zombies, friendlies: g.friendlies });
  const out = {};
  g.state.state = 'paused'; // drive by hand

  let fires = 0;
  g.events.on('spitter:fire', () => { fires++; });

  const PX = 158, PZ = 48; // Eastgate Green — kept clear of planting by design
  const setup = (sp, d) => {
    player.teleport(PX, groundAt(PX, PZ), PZ); player.alive = true; player.health = 100;
    player.invulnTime = 0; player.godMode = false;
    sp.placeAt(PX, PZ - d);
    sp.state = 'chasing'; sp.victim = null; sp._aim = -1; sp._firePose = 0;
    sp._losTimer = 0; sp._hasLos = true;
  };

  // 1. Spawn gate: absent below 100 kills, present at/after 100.
  out.gateOff = g.waves.typeWeights().spitter === 0 && g.score.kills < 100;
  while (g.score.kills < 100 && !g.score.victory) g.score.registerKill('Walker', 1);
  out.gateOn = g.waves.typeWeights().spitter > 0;

  // 1b. Spawn share steps UP past the ramp gate (120 kills). Read the weight at
  //     synthetic kill counts and restore, so real progression (and the later
  //     exploder-gate check, which needs < 120) is untouched.
  const kReal = g.score.kills;
  g.score.kills = 110; const shareBelow = g.waves.typeWeights().spitter;
  g.score.kills = 130; const shareAbove = g.waves.typeWeights().spitter;
  g.score.kills = kReal;
  out.rampsUpAfter120 = shareAbove > shareBelow + 0.05;

  // 2. It's a real Spitter, slightly slower than the 5.0 walk, on the 5-row sheet.
  player.teleport(PX, groundAt(PX, PZ), PZ); player.alive = true;
  const sp = g.spawner.spawnOne('spitter', player);
  out.spawned = !!sp && sp.config.name === 'Spitter' && sp.tags.has('spitter') && typeof sp._fire === 'function';
  out.tankyHealth = sp.config.hp === 104 && sp.hp === 104; // 4x a basic body
  out.slowerThanPlayer = sp.config.chaseSpeed < 5.0 && sp.config.chaseSpeed >= 4.0;
  out.rangedSheet = sp.billboard.layout.rows === 5 && sp.billboard.layout.row.front === 1;
  const cfg = sp.config;
  const mid = (cfg.standoffMin + cfg.standoffMax) / 2;

  // 3. Distance-keeping. Too close → it opens back up to the (now much farther)
  //    standoff band and never lets the player sit on top of it; too far → it
  //    closes the gap back toward the band.
  setup(sp, 1.0); sp._cd = 999; // muzzle off so it purely kites here
  for (let i = 0; i < 110; i++) sp.update(0.05, mkCtx());
  const dClose = sp.distanceTo(player);
  out.keepsAwayWhenClose = dClose >= cfg.standoffMin - 0.6;
  out.doesntFleeForever = dClose <= cfg.standoffMax + 3;

  setup(sp, cfg.standoffMax + 6); sp._cd = 999; // start well beyond the band
  const dFar0 = sp.distanceTo(player);
  for (let i = 0; i < 110; i++) sp.update(0.05, mkCtx());
  const dFar1 = sp.distanceTo(player);
  out.closesWhenFar = dFar1 < dFar0 - 1 && dFar1 <= cfg.standoffMax + 1.5;
  out.holdsRangedDistance = cfg.standoffMin >= 4.5; // stays genuinely back, not melee

  // 4. Planted quarter-second aim pause, then a shot — and it does NOT move
  //    while aiming or firing (the walk/turn/shoot states never overlap).
  setup(sp, mid); sp._cd = 0;
  let sawAim = false, aimPos = null, aimMoved = 0, firedHere = false;
  const firesBefore = fires;
  for (let i = 0; i < 40; i++) {
    sp.update(0.05, mkCtx());
    if (sp.state === 'aiming' || sp.state === 'firing') {
      if (!aimPos) aimPos = { x: sp.position.x, z: sp.position.z };
      else aimMoved = Math.max(aimMoved, Math.hypot(sp.position.x - aimPos.x, sp.position.z - aimPos.z));
      if (sp.state === 'aiming') sawAim = true;
    }
    if (fires > firesBefore) { firedHere = true; break; }
  }
  out.pausesToAim = sawAim;
  out.plantedWhileShooting = aimMoved < 0.05;
  out.firesAShot = firedHere;

  // 5. A stationary target near the standoff minimum gets hit; damage flows
  //    through the player pipeline (there the cone is tight enough to connect).
  setup(sp, cfg.standoffMin); sp._cd = 0;
  for (let i = 0; i < 90 && player.health === 100; i++) sp.update(0.05, mkCtx());
  out.hitsStationaryTarget = player.health < 100;

  // 6. Dodge: once the aim locks onto where the player stood, jinking clear of
  //    that sampled point before the shot lands makes it MISS.
  setup(sp, mid); sp._cd = 0;
  const hpBefore = player.health; let dodged = false;
  for (let i = 0; i < 90; i++) {
    if (sp.state === 'aiming' && sp._aimAt) { player.position.x = sp._aimAt.x + 4; player.position.z = sp._aimAt.z + 4; }
    sp.update(0.05, mkCtx());
    if (sp.state === 'firing') { dodged = player.health === hpBefore; break; }
  }
  out.dodgeableByJuking = dodged;

  // tidy up: remove the spitters we spawned so later sections start clean
  for (let i = g.spawner.zombies.length - 1; i >= 0; i--) {
    const z = g.spawner.zombies[i];
    if (z.tags && z.tags.has('spitter')) { g.renderer.scene.remove(z.mesh); z.dispose(); g.spawner.zombies.splice(i, 1); }
  }
  player.teleport(0, groundAt(0, 20), 20); player.alive = true; player.health = 100; player.godMode = false;
  g.state.state = 'playing';
  return out;
});
check('spitter stays out of the spawn table before 100 kills', spit.gateOff);
check('spitter joins the spawn table at 100 kills', spit.gateOn);
check('spitter spawn share steps up after 120 kills', spit.rampsUpAfter120);
check('spawnOne builds a real Spitter', spit.spawned);
check('spitter has 4x health (104 HP)', spit.tankyHealth);
check('spitter walks slightly slower than the player', spit.slowerThanPlayer);
check('spitter uses the 5-row ranged sprite sheet', spit.rangedSheet);
check('spitter holds a genuinely ranged standoff (well back from melee)', spit.holdsRangedDistance);
check('spitter keeps its distance when the player is too close', spit.keepsAwayWhenClose, `${spit.keepsAwayWhenClose}`);
check('spitter does not flee to infinity', spit.doesntFleeForever);
check('spitter closes in when the player is too far', spit.closesWhenFar);
check('spitter pauses to aim before firing', spit.pausesToAim);
check('spitter never moves while aiming or firing', spit.plantedWhileShooting);
check('spitter fires a shot', spit.firesAShot);
check('spitter hits a stationary in-band target', spit.hitsStationaryTarget);
check('spitter shot is dodgeable by juking during the tell', spit.dodgeableByJuking);

// EXPLODER: the Creeper-like suicide bomber. Spawn gate at 120 kills, a paused
// quarter-second fuse that detonates through the real damage pipeline (hurting
// the player AND the surrounding horde), a death explosion ~0.5s into the death
// animation, and sniper-ammo loot ONLY on a player kill. Driven deterministically
// with the frame loop paused.
const exp = await page.evaluate(async () => {
  const g = window.__game;
  const world = g.world, player = g.player, cam = g.renderer.camera;
  const groundAt = (x, z) => world.groundHeightFor(x, z, 1e9);
  const mkCtx = () => ({ player, camPos: cam.position, pathBudget: { n: 4 }, time: g.time,
    zombies: g.spawner.zombies, friendlies: g.friendlies });
  const step = (ent, n, dt = 0.05) => { const c = mkCtx(); for (let i = 0; i < n && !ent.toRemove; i++) ent.update(dt, c); };
  const out = {};
  g.state.state = 'paused'; // drive by hand

  let sniperDrops = 0, booms = 0;
  g.events.on('loot:spawn', (e) => { if (e.type === 'ammo_sniper') sniperDrops++; });
  g.events.on('exploder:explode', () => { booms++; });

  // 1. Spawn gate: no exploders in the table below 120 kills, present at/after.
  out.gateOff = g.waves.typeWeights().exploder === 0;
  while (g.score.kills < 121 && !g.score.victory) g.score.registerKill('Walker', 1);
  out.gateOn = g.waves.typeWeights().exploder > 0;

  // 1b. Exploder share steps UP past 150 kills. Read the weight at synthetic
  //     kill counts and restore, so real progression stays untouched.
  const ekReal = g.score.kills;
  g.score.kills = 140; const eBelow = g.waves.typeWeights().exploder;
  g.score.kills = 170; const eAbove = g.waves.typeWeights().exploder;
  g.score.kills = ekReal;
  out.rampsUpAfter150 = eAbove > eBelow + 0.05;

  // 2. It really is an Exploder, and only slightly faster than the 5.0 walk.
  player.teleport(0, groundAt(0, 20), 20); player.alive = true;
  const ex = g.spawner.spawnOne('exploder', player);
  out.spawned = !!ex && ex.config.name === 'Exploder' && ex.tags.has('exploder') && typeof ex._explode === 'function';
  out.speedSlightlyAboveWalk = ex.config.chaseSpeed > 5.0 && ex.config.chaseSpeed <= 6.0;

  // 2a. Retexture + stature: it stands in the eye-level Walker's height class
  //     (a tall enemy, not the old runt) yet navigates on the shorter humanoid
  //     capsule, and it renders the CS:GO retexture off the standard 3x4 sheet.
  //     Its height is a touch UNDER the Walker's on purpose — this sheet draws
  //     the character filling more of its cell, so a smaller height renders at
  //     the same on-screen stature (heads level, not towering).
  const wk = g.spawner.spawnOne('walker', player);
  out.asTallAsOthers = ex.config.height >= 2.4 && ex.config.height <= wk.config.height
    && ex.config.collisionHeight === 1.75;
  out.capsuleShorterThanSprite = ex.collisionHeight < ex.height;
  out.retexturedSheet = ex.billboard.layout.rows === 4 && ex.billboard.layout.row.front === 0
    && ex.billboard.material.map.image.width === 512 && ex.billboard.material.map.image.height === 1024;
  // Drop the throwaway height reference right away so later sections start clean.
  g.renderer.scene.remove(wk.mesh); wk.dispose();
  g.spawner.zombies.splice(g.spawner.zombies.indexOf(wk), 1);

  // 2b. Flanking: dropped exactly on the player's front sightline, just inside
  // flankRange, it skirts to a side instead of walking straight down the barrel.
  player.teleport(0, groundAt(0, 20), 20); player.yaw = 0; player.alive = true;
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw); // player forward
  const rgtX = Math.cos(player.yaw), rgtZ = -Math.sin(player.yaw);  // player right
  const exf = g.spawner.spawnOne('exploder', player);
  exf.placeAt(player.position.x + fwdX * 2.9, player.position.z + fwdZ * 2.9);
  exf.state = 'chasing'; exf.victim = null; exf._retryCd = 0;
  let maxLateral = 0;
  for (let i = 0; i < 24 && exf.state !== 'fuse' && !exf._exploded; i++) {
    exf.update(0.05, mkCtx());
    const dx = exf.position.x - player.position.x, dz = exf.position.z - player.position.z;
    const lateral = Math.abs(dx * rgtX + dz * rgtZ); // offset along the player's right axis
    if (lateral > maxLateral) maxLateral = lateral;
  }
  out.flanks = maxLateral > 0.4;

  // 3. Fuse → it plants itself, primes, then the attack blast hurts the player
  // AND gibs a neighbouring zombie. It must NOT move while the fuse burns.
  player.teleport(0, groundAt(0, 20), 20);
  player.alive = true; player.health = 100; player.invulnTime = 0; player.godMode = false;
  ex.placeAt(1.2, 20); ex.state = 'idle'; ex.victim = null; ex._retryCd = 0; ex._exploded = false;
  const bystander = g.spawner.spawnOne('walker', player) || g.spawner.zombies.find((z) => z.state !== 'dead' && z !== ex);
  bystander.placeAt(2.4, 20); bystander.state = 'idle'; bystander.hp = bystander.config.hp;
  const hpB = bystander.hp;
  const boomsBefore = booms;
  let enteredFuse = false, fusePos = null;
  for (let i = 0; i < 16 && !ex._exploded; i++) {
    ex.update(0.05, mkCtx());
    if (ex.state === 'fuse') { enteredFuse = true; if (!fusePos) fusePos = { x: ex.position.x, z: ex.position.z }; }
  }
  out.pausedFuse = enteredFuse;
  out.heldStillWhileFusing = fusePos ? Math.hypot(ex.position.x - fusePos.x, ex.position.z - fusePos.z) < 0.05 : false;
  out.exploded = ex._exploded && ex.state === 'dead';
  out.boomFired = booms === boomsBefore + 1;
  out.hurtPlayer = player.health < 100;
  out.gibbedZombie = bystander.state === 'dead' || bystander.hp < hpB;

  // 4. A player kill drops sniper ammo, then it blows up ~0.5s into the death
  // animation (far from the player so its blast harms nobody).
  const ex2 = g.spawner.spawnOne('exploder', player);
  ex2.placeAt(60, 20);
  const dropsBefore = sniperDrops;
  ex2.takeDamage(999); // a bullet — byPlayer defaults true
  out.playerKillDropsAmmo = sniperDrops === dropsBefore + 1;
  const boomsBefore2 = booms;
  step(ex2, 16); // run the death anim past deathExplodeDelay (0.5s)
  out.deathExplodes = ex2._exploded && booms === boomsBefore2 + 1;

  // 5. A self-detonation (attack) drops NO ammo.
  player.teleport(0, groundAt(0, 20), 20);
  player.alive = true; player.health = 100; player.invulnTime = 0;
  const ex3 = g.spawner.spawnOne('exploder', player);
  ex3.placeAt(1.2, 20); ex3.state = 'idle'; ex3.victim = null; ex3._retryCd = 0;
  const dropsBefore2 = sniperDrops;
  for (let i = 0; i < 16 && !ex3._exploded; i++) ex3.update(0.05, mkCtx());
  out.attackDropsNothing = ex3._exploded && sniperDrops === dropsBefore2;

  // tidy up: clear the field so the win-condition run starts clean
  for (const z of g.spawner.zombies) z.toRemove = true;
  player.teleport(0, groundAt(0, 20), 20); player.alive = true; player.health = 100;
  g.state.state = 'playing';
  return out;
});
check('exploder stays out of the spawn table before 120 kills', exp.gateOff);
check('exploder joins the spawn table at 120 kills', exp.gateOn);
check('exploder spawn share steps up after 150 kills', exp.rampsUpAfter150);
check('spawnOne builds a real Exploder', exp.spawned);
check('exploder speed is only slightly above walking', exp.speedSlightlyAboveWalk);
check('exploder stands as tall as the other enemies', exp.asTallAsOthers);
check('exploder navigates on the shorter humanoid capsule', exp.capsuleShorterThanSprite);
check('exploder renders the CS:GO retexture (3x4, 512x1024)', exp.retexturedSheet);
check('exploder skirts to a flank instead of charging head-on', exp.flanks);
check('exploder pauses to prime its fuse', exp.pausedFuse);
check('exploder cannot move while the fuse burns', exp.heldStillWhileFusing);
check('exploder detonates and dies from its attack', exp.exploded);
check('detonation emits one explosion event', exp.boomFired);
check('explosion damages the player', exp.hurtPlayer);
check('explosion damages a neighbouring zombie', exp.gibbedZombie);
check('player kill drops sniper ammo', exp.playerKillDropsAmmo);
check('killed exploder blows up during its death animation', exp.deathExplodes);
check('self-detonation as an attack drops no ammo', exp.attackDropsNothing);

// SAVABLE CITIZEN: the captive tied up inside a random building. Gated at 100
// kills, indoor-only and randomly placed, freed with [E] — which swaps her to
// the release sprite, drops a health kit, and sends her out of the building on
// a rate-limited turn until she is out of the player's line of sight and
// despawns. Driven deterministically with the frame loop paused.
const cit = await page.evaluate(async () => {
  const g = window.__game;
  const world = g.world, player = g.player, cam = g.renderer.camera;
  const groundAt = (x, z) => world.groundHeightFor(x, z, 1e9);
  const mkCtx = () => ({ player, camPos: cam.position, pathBudget: { n: 4 }, time: g.time,
    zombies: g.spawner.zombies, friendlies: g.friendlies });
  const out = {};
  const killsReal = g.score.kills;
  const DT = 0.05;
  g.state.state = 'paused'; // drive by hand
  g.citizens.reset();

  // Is a world point inside a building's footprint? Buildings only ever sit at
  // 90° steps (see local2world), so a rotated footprint just swaps w and d.
  const inFootprint = (spec, x, z) => {
    const rot = ((spec.rot || 0) % 360 + 360) % 360;
    const [hw, hd] = rot === 90 || rot === 270 ? [spec.d / 2, spec.w / 2] : [spec.w / 2, spec.d / 2];
    return Math.abs(x - spec.x) <= hw && Math.abs(z - spec.z) <= hd;
  };
  const interactablesIdle = world.interactables.length; // baseline: nobody live

  // 1. Kill gate: however many ordinary waves roll, no captive appears below
  //    100 kills (wave 2 is the one exemption, covered in section 7).
  g.score.kills = 99;
  let rolledUnder = 0;
  for (let i = 0; i < 300; i++) if (g.citizens._maybeSpawn(7)) rolledUnder++;
  out.gateOff = rolledUnder === 0 && g.citizens.citizen === null && !g.citizens.unlocked;

  // ...and she starts appearing once the run is exactly 100 kills deep.
  g.score.kills = 100;
  let firstSpawn = null;
  for (let i = 0; i < 300 && !firstSpawn; i++) firstSpawn = g.citizens._maybeSpawn(7);
  out.gateOn = !!firstSpawn && g.citizens.unlocked;

  // 2. Indoor-only, and a different building from playthrough to playthrough.
  const seen = new Set();
  let allIndoors = true;
  for (let i = 0; i < 60; i++) {
    g.citizens.reset();
    const s = g.citizens.spawnNow();
    if (!s) { allIndoors = false; break; }
    const sp = s.building.spec;
    seen.add(sp.name);
    if (sp.solid || !sp.door || !inFootprint(sp, s.position.x, s.position.z)) allIndoors = false;
  }
  out.indoorsOnly = allIndoors;
  out.randomBuildings = seen.size;
  g.citizens.reset();
  // 60 spawn/despawn cycles must leave no [E] prompts behind on the world.
  out.noPromptLeak = world.interactables.length === interactablesIdle;

  // 3. Settle on one known building (a partitioned house — an interior wall
  //    between her and the door) so the rescue below is reproducible.
  let c = null;
  for (let i = 0; i < 600 && !c; i++) {
    g.citizens.reset();
    const s = g.citizens.spawnNow();
    if (s && s.building.spec.name === 'npcHouse') c = s;
  }
  out.gotTestHouse = !!c;
  if (!c) { g.score.kills = killsReal; g.state.state = 'playing'; return out; }
  const spec = c.building.spec;
  out.promptAdded = world.interactables.length === interactablesIdle + 1;
  out.startsCaptured = c.state === 'captured' && c.billboard.material.map === g.citizens.texCaptured;

  // 4. Freeing her through the REAL [E] path: the interactable the world hands
  //    the player when they are close enough, not a direct free() call.
  player.teleport(spec.x, groundAt(spec.x, spec.z), spec.z);
  player.alive = true; player.health = 100;
  const it = world.nearestInteractable(c.position.x, c.position.y, c.position.z);
  out.promptIsHers = it === c.interactable && /\[E\]/.test(it.prompt);
  let healthDrops = 0;
  const offLoot = g.events.on('loot:spawn', (e) => { if (e.type === 'health') healthDrops++; });
  it.onInteract();
  offLoot();
  out.freedSwapsSprite = c.state === 'fleeing' && c.billboard.material.map === g.citizens.texReleased;
  out.droppedHealthKit = healthDrops === 1;
  out.promptGoesCold = !c.interactable.enabled();

  // 5. The escape. Force line of sight ON so the despawn rule cannot fire: she
  //    must still navigate out of the house and well clear of the door, turning
  //    at a capped rate the whole way (never snapping to a new heading). Run it
  //    for a full 20 s — four times the 5 s despawn delay — so "watched, so she
  //    stays" is proved well past the point where being unseen would end her.
  const realLos = world.hasLineOfSight.bind(world);
  world.hasLineOfSight = () => true;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let maxYawRate = 0, leftBuilding = false, maxDoorDist = 0, prevYaw = c.yaw;
  for (let i = 0; i < 400 && !c.toRemove; i++) {
    g.citizens.update(DT, mkCtx());
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(c.yaw - prevYaw)) / DT);
    prevYaw = c.yaw;
    maxDoorDist = Math.max(maxDoorDist, Math.hypot(c.position.x - c.doorPoint.x, c.position.z - c.doorPoint.z));
    if (!inFootprint(spec, c.position.x, c.position.z)) leftBuilding = true;
  }
  out.escapedBuilding = leftBuilding;
  out.clearedDoor = maxDoorDist;
  out.turnRateCapped = maxYawRate;
  out.watchedFor = c.fleeTimer;
  out.staysWhileWatched = !c.toRemove && g.citizens.citizen === c && c.fleeTimer > 5;

  // 6. Break line of sight and she is gone — and takes her [E] prompt with her.
  world.hasLineOfSight = () => false;
  g.citizens.update(DT, mkCtx());
  out.despawnsOnceUnseen = c.toRemove && g.citizens.citizen === null;
  out.beatTheSafetyCap = c.fleeTimer < 45; // left via stealth, not the stuck-timer
  out.promptReleased = world.interactables.length === interactablesIdle;

  // 6b. The 5-second grace, isolated: freed with the player unable to see her
  //     from the very first frame, she must STILL stay in the world for a full
  //     5 seconds of running, then leave on the next tick after that.
  let c2 = null;
  for (let i = 0; i < 20 && !c2; i++) { g.citizens.reset(); c2 = g.citizens.spawnNow(); }
  world.hasLineOfSight = () => false; // unseen from the instant she is freed
  c2.interactable.onInteract();
  let goneAt = null, seenAliveAt5 = false;
  for (let i = 0; i < 300 && !c2.toRemove; i++) {
    g.citizens.update(DT, mkCtx());
    if (!c2.toRemove && c2.fleeTimer >= 5 - DT) seenAliveAt5 = true;
    if (c2.toRemove) goneAt = c2.fleeTimer;
  }
  world.hasLineOfSight = realLos;
  out.survivedTheDelay = seenAliveAt5 && goneAt !== null && goneAt >= 5;
  out.wentRightAfterDelay = goneAt !== null && goneAt <= 5 + DT * 2;
  out.goneAt = goneAt;

  // 7. The dev console's `spawn citizen`: on demand, below the kill gate, one
  //    at a time, and listed among the spawnable types.
  g.score.kills = 0;
  g.devConsole.execute('spawn citizen');
  const forced = g.citizens.citizen;
  out.consoleSpawns = !!forced && !g.citizens.unlocked; // bypasses the gate
  out.consoleReportsWhere = /captive spawned in \w+ — tp /.test(g.devConsole.logEl.lastChild.textContent);
  g.devConsole.execute('spawn citizen 5');
  out.consoleNoStacking = g.citizens.citizen === forced && /already/.test(g.devConsole.logEl.lastChild.textContent);
  g.devConsole.execute('spawn banana');
  out.consoleListsCitizen = /^usage: spawn <.*\bcitizen\b.*>/.test(g.devConsole.logEl.lastChild.textContent.replace(/^error: /, ''));

  // 8. Wave 2 ALWAYS delivers a captive, with the run nowhere near the kill
  //    gate — never a dice roll, every single time.
  g.score.kills = 0;
  let waveTwoHits = 0;
  for (let i = 0; i < 50; i++) {
    g.citizens.reset();
    if (g.citizens._maybeSpawn(2)) waveTwoHits++;
  }
  out.waveTwoAlways = waveTwoHits === 50 && !g.citizens.unlocked;

  // ...and waves 1 and 2 are the ONLY exemptions: every other wave is still
  //    gated, so the guarantee is a scripted introduction and not an open door.
  //    (Wave 1 was added to that pair in src/systems/CitizenSystem.js — it
  //    delivers one inside the player's own starting district.)
  let otherWaveHits = 0;
  for (const w of [3, 4, 5, 12, 30]) {
    for (let i = 0; i < 50; i++) {
      g.citizens.reset();
      if (g.citizens._maybeSpawn(w)) otherWaveHits++;
    }
  }
  out.otherWavesStillGated = otherWaveHits === 0;

  // ...driven through the real 'wave:start' event the wave director emits, so
  //    the wiring is covered and not just the method. Wave 1 must land in the
  //    starting district; wave 2 may be anywhere unlocked.
  g.citizens.reset();
  g.events.emit('wave:start', { wave: 1, size: 11 });
  const afterWave1 = g.citizens.citizen;
  out.waveOneViaEvent = !!afterWave1 && afterWave1.building.spec.zone === g.citizens.spawnZone;
  g.citizens.reset();
  g.events.emit('wave:start', { wave: 2, size: 14 });
  out.waveTwoViaEvent = afterWave1 !== null && !!g.citizens.citizen;
  out.waveTwoIsIndoors = !!g.citizens.citizen
    && inFootprint(g.citizens.citizen.building.spec, g.citizens.citizen.position.x, g.citizens.citizen.position.z);

  // tidy up: no captive live, real kill count back, frame loop running again
  g.citizens.reset();
  g.score.kills = killsReal;
  player.teleport(0, groundAt(0, 20), 20); player.alive = true; player.health = 100;
  g.state.state = 'playing';
  return out;
});
check('citizen stays out of the game before 100 kills', cit.gateOff);
check('citizen starts spawning at 100 kills', cit.gateOn);
check('citizen only ever spawns inside an enterable building', cit.indoorsOnly);
check('citizen picks a random building, not a fixed one', cit.randomBuildings > 1,
  `${cit.randomBuildings} distinct buildings over 60 spawns`);
check('citizen leaves no [E] prompts behind after despawning', cit.noPromptLeak);
check('citizen spawns captured on npc_save_captured', cit.gotTestHouse && cit.startsCaptured);
check('citizen registers a live [E] prompt', cit.promptAdded && cit.promptIsHers);
check('freeing with [E] swaps her to npc_save_release', cit.freedSwapsSprite);
check('freeing drops exactly one health kit', cit.droppedHealthKit);
check('freed citizen can no longer be interacted with', cit.promptGoesCold);
check('citizen navigates out of the building', cit.escapedBuilding);
check('citizen runs well clear of the door', cit.clearedDoor > 12, `${cit.clearedDoor.toFixed(1)} m from the door`);
check('citizen turns at a capped rate instead of snapping', cit.turnRateCapped <= 2.05,
  `peak ${cit.turnRateCapped.toFixed(2)} rad/s vs 2.0 cap`);
check('citizen does NOT despawn while the player can see her', cit.staysWhileWatched,
  `still there after ${cit.watchedFor?.toFixed(1)}s watched`);
check('citizen despawns once out of the player\'s line of sight', cit.despawnsOnceUnseen && cit.beatTheSafetyCap);
check('citizen sticks around for a full 5s after the rescue', cit.survivedTheDelay,
  `despawned at ${cit.goneAt?.toFixed(2)}s unseen`);
check('citizen despawns right after the 5s delay once unseen', cit.wentRightAfterDelay);
check('despawned citizen releases her [E] prompt', cit.promptReleased);
check('"spawn citizen" spawns one on demand below the kill gate', cit.consoleSpawns);
check('"spawn citizen" reports which building she landed in', cit.consoleReportsWhere);
check('"spawn citizen" refuses to stack a second captive', cit.consoleNoStacking);
check('citizen is listed among the spawnable types', cit.consoleListsCitizen);
check('wave 2 ALWAYS spawns a citizen, kill gate or not', cit.waveTwoAlways);
check('every wave after the scripted pair stays behind the kill gate', cit.otherWavesStillGated);
check('wave 1 spawns her in the starting district via wave:start', cit.waveOneViaEvent);
check('wave 2 spawns her through the real wave:start event', cit.waveTwoViaEvent);
check('the guaranteed wave-2 citizen is inside a building', cit.waveTwoIsIndoors);

// SPAWN SURGE: on top of "heat" (which barely moves before ~3000 kills), a
// second ramp on the OVERALL spawn rate kicks in past ~400 kills — shorter
// spawn interval, fatter batches, higher concurrent cap. Read the pacing at
// synthetic kill counts (wave held fixed to isolate the kills-driven surge)
// and restore, so real progression is untouched.
const surge = await page.evaluate(() => {
  const g = window.__game;
  const kR = g.score.kills, wR = g.waves.wave;
  // Wave 6: fixed so only the kills-driven terms move, and specifically the
  // last wave before the wave-clock escalation engages — past that the
  // interval is pinned to its floor and no kills-driven term can show up in
  // it, which says nothing about whether the surge works.
  g.waves.wave = 6;
  const at = (k) => {
    g.score.kills = k;
    return { surge: g.waves.surge, intv: g.waves.spawnInterval(), cap: g.waves.activeCap(),
      // batchSize has a random component; measure only its deterministic floor
      batchFloor: 2 + Math.round(g.waves.heat * 3) + Math.round(g.waves.surge * 3) };
  };
  const a400 = at(400), a401 = at(401), a2000 = at(2000);
  g.score.kills = kR; g.waves.wave = wR;
  return { a400, a401, a2000 };
});
check('spawn surge is dormant until ~400 kills', surge.a400.surge === 0 && surge.a401.surge > 0,
  JSON.stringify({ at400: surge.a400.surge, at401: surge.a401.surge }));
check('spawn surge shortens the spawn interval past 400 kills', surge.a2000.intv < surge.a400.intv - 0.05,
  `${surge.a400.intv.toFixed(2)}s -> ${surge.a2000.intv.toFixed(2)}s`);
check('spawn surge raises the concurrent cap and batch size past 400 kills',
  surge.a2000.cap >= surge.a400.cap + 20 && surge.a2000.batchFloor > surge.a400.batchFloor,
  `cap ${surge.a400.cap}->${surge.a2000.cap}, batchFloor ${surge.a400.batchFloor}->${surge.a2000.batchFloor}`);

// 4 + 5. win condition, exact — via the same registerKill pipeline that
// 'zombie:death' events call, in batches to keep the page responsive.
const win = await page.evaluate(async () => {
  const g = window.__game;
  const target = 249999 - g.score.kills;
  for (let done = 0; done < target;) {
    const n = Math.min(5000, target - done);
    for (let i = 0; i < n; i++) g.score.registerKill('Walker', 1);
    done += n;
    await new Promise(requestAnimationFrame);
  }
  const at249999 = { kills: g.score.kills, victory: g.score.victory, state: g.state.state };
  g.score.registerKill('Walker', 1);
  await new Promise(requestAnimationFrame);
  const at250000 = { kills: g.score.kills, victory: g.score.victory, state: g.state.state };
  // over-count attempt must not double-fire or change the count
  g.score.registerKill('Walker', 1);
  const after = { kills: g.score.kills, victory: g.score.victory };
  const zones = [...g.world.zones.unlocked].sort((a, b) => a - b);
  return { at249999, at250000, after, zones };
});
check('no victory at 249,999 kills', win.at249999.kills === 249999 && !win.at249999.victory && win.at249999.state === 'playing',
  JSON.stringify(win.at249999));
check('victory at exactly 250,000 kills', win.at250000.kills === 250000 && win.at250000.victory && win.at250000.state === 'victory',
  JSON.stringify(win.at250000));
check('kill counter freezes after victory', win.after.kills === 250000, `kills=${win.after.kills}`);
check('all 6 zones unlocked by kill thresholds', win.zones.join(',') === '0,1,2,3,4,5', win.zones.join(','));

const victoryVisible = await page.evaluate(() => {
  const el = document.getElementById('screen-victory');
  return el && el.style.display !== 'none' && el.textContent.includes('250,000') === false
    ? 'missing-number' : el.style.display !== 'none';
});
check('victory screen displayed with stats', victoryVisible === true, String(victoryVisible));
if (takeScreens) await page.screenshot({ path: join(SCREEN_DIR, 'shot_victory.png') });

// --- mouse-look spike rejection -----------------------------------------
// The view used to snap at random because every pointer-locked mousemove was
// added straight onto the camera, including the delta pointer lock reports on
// acquisition and Chromium's occasional stale-coordinate outlier. Drive the
// real Input with synthetic events and check what survives.
const look = await page.evaluate(() => {
  const input = window.__game.input;
  const out = {};
  const feed = (moves) => {
    input.mouseDX = 0; input.mouseDY = 0;
    for (const [dx, dy] of moves) {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy }));
    }
    return input.mouseDX;
  };
  input.pointerLocked = true;
  input.suppressed = false;

  // 1. the acquisition delta, however big, never reaches the camera
  input._settleMouse();
  out.duringSettle = feed([[900, 0], [-1400, 260]]);

  // 2. ordinary play passes through untouched
  input._lockedAt = 0; input._mouseBaseline = 8;
  const gentle = [[6, 2], [9, -3], [12, 4], [7, 1], [11, -2]];
  out.gentle = feed(gentle);
  out.gentleWant = gentle.reduce((a, m) => a + m[0], 0);

  // 3. an isolated jump in the middle of ordinary play is dropped, and the
  //    ordinary events around it still land
  input._lockedAt = 0; input._mouseBaseline = 8;
  out.withSpike = feed([[8, 0], [1800, -900], [10, 0]]);

  // 4. a genuine hard flick is NOT eaten: every event of it is accepted, which
  //    is what separates this from a blunt clamp
  input._lockedAt = 0; input._mouseBaseline = 8;
  const flick = [[260, 0], [300, 0], [280, 0]];
  out.flick = feed(flick);
  out.flickWant = flick.reduce((a, m) => a + m[0], 0);

  // 5. one frame can never turn the view by more than the backstop
  input._lockedAt = 0; input._mouseBaseline = 8;
  out.clamped = feed(Array.from({ length: 40 }, () => [400, 0]));
  input.pointerLocked = false;
  input.mouseDX = 0; input.mouseDY = 0;
  return out;
});
check('pointer-lock acquisition delta never moves the view', look.duringSettle === 0,
  `${look.duringSettle}px got through`);
check('ordinary mouse motion passes through untouched', look.gentle === look.gentleWant,
  `${look.gentle} vs ${look.gentleWant}`);
check('an isolated movement spike is rejected', look.withSpike === 18, `${look.withSpike}px`);
check('a genuine hard flick is not eaten as a spike', look.flick === look.flickWant,
  `${look.flick} vs ${look.flickWant}`);
check('one frame cannot turn the view without limit', look.clamped <= 1430, `${look.clamped}px`);

/* ------------------------------------------------------------------ */
/* the pause screen: seven instruments, all of them live                */
/* ------------------------------------------------------------------ */
// Staged against known values so every readout can be checked against the
// number it is supposed to be showing — a panel that animates beautifully and
// reports the wrong health is worse than one that does neither.
const pauseData = await page.evaluate(async () => {
  const g = window.__game;
  g.state.state = 'playing';
  g.player.health = 41; g.player.maxHealth = 100;
  g.score.kills = 1180; g.score.points = 14820;
  g.score.shotsFired = 612; g.score.shotsHit = 389; g.score.timePlayed = 3742;
  g.waves.wave = 12; g.waves.quota = 26; g.waves.killsThisWave = 17; g.waves.state = 'active';
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) g.world.secrets.found.add(id);
  g.hud.showScreen(null);
  g.pause();
  const q = (s) => document.querySelector(s);
  const out = {
    shown: getComputedStyle(q('#screen-pause')).display,
    dockHidden: getComputedStyle(document.getElementById('hud-dock')).display === 'none',
    bays: [...document.querySelectorAll('.bay')].map((b) => b.className.split(' ')[1]),
    // Every bay must carry its own KIND of instrument. Two counters may both
    // use odometer wheels — a count is a count — so the signature is the whole
    // set of parts in the bay, which is what makes each readout its own thing.
    instruments: [...document.querySelectorAll('.bay')].map((b) =>
      [...b.querySelectorAll('.bay-body > *')].map((e) => e.className.split(' ')[0]).join('+')),
    secretsWanted: window.__game.world.secrets.found.size,
    // the rest pose, before arming: every driven instrument sits at zero
    restCell: parseFloat(q('.cell-fill').style.height),
    restTape: parseFloat(q('.tape-run').style.width),
    restTapePx: q('.tape-run').getBoundingClientRect().width,
  };
  // Arm, then read what is actually RUNNING. A style that snapped to its value
  // produces no Animation object at all, which is the difference between a
  // panel that animates and one that merely ends up correct.
  //
  // One frame to get the styles applied and the transitions started, then a
  // WALL-CLOCK beat. Counting frames is the wrong clock for "a moment later":
  // on a slow renderer three frames can outlast the 0.95s needle sweep itself,
  // and this would report a gauge that animated perfectly as not animating.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  const running = (sel) => (q(sel)?.getAnimations() ?? []).map((a) => a.animationName || 'transition');
  out.armed = q('#pause-case').classList.contains('armed');
  out.setCell = parseFloat(q('.cell-fill').style.height);
  out.setTape = parseFloat(q('.tape-run').style.width);
  out.moving = {
    cell: running('.cell-fill'),
    needle: running('.bay-aim .dev-needle'),
    tape: running('.tape-head'),
    bay: running('.bay-vitals'),
    lamp: running('.pause-lamp'),
    punch: running('.tape-punch'),
    button: running('#btn-resume'),
  };
  out.tubesLit = document.querySelectorAll('.vtube.lit').length;
  out.lampsLit = document.querySelectorAll('.sec-lamp.lit').length;
  out.secretsTotal = document.querySelectorAll('.sec-lamp').length;
  // and the readouts, once everything has landed
  await new Promise((r) => setTimeout(r, 1100));
  out.health = q('.bay-vitals .odometer').textContent;
  out.wave = q('.tube-num').textContent;
  out.waveState = q('.tube-mode').textContent;
  // The bank shows the FRACTION cleared; the count under the mode word is the
  // only place the actual numbers appear now that the caption rows are gone.
  out.waveCount = q('.tube-count').textContent;
  out.kills = q('.bay-progress .odometer').textContent;
  out.aim = q('.bay-aim .dev-gauge-cap').textContent.replace(/\s+/g, ' ').trim();
  out.clock = [...document.querySelectorAll('.flap')].map((f) => f.textContent).join('');
  out.score = q('.bay-score .odometer').textContent;
  return out;
});
check('pause opens the instrument case', pauseData.shown === 'flex' && pauseData.dockHidden,
  `display ${pauseData.shown}, dock hidden ${pauseData.dockHidden}`);
check('all seven readouts are present', pauseData.bays.length === 7,
  pauseData.bays.join(' '));
check('and every one of them is a different instrument',
  new Set(pauseData.instruments).size === pauseData.instruments.length,
  pauseData.instruments.join(' '));
check('the readouts show the run that is actually being played',
  pauseData.health === '041' && pauseData.wave === '12' && pauseData.waveState === 'ENGAGED'
  && pauseData.kills === '001180' && /389 \/ 612/.test(pauseData.aim)
  && pauseData.tubesLit === 7 && pauseData.lampsLit === pauseData.secretsWanted
  && pauseData.clock === '010222' && pauseData.waveCount === '17/26',
  `hp ${pauseData.health} wave ${pauseData.wave}/${pauseData.waveState} ${pauseData.waveCount}`
  + ` kills ${pauseData.kills}`
  + ` aim "${pauseData.aim}" tubes ${pauseData.tubesLit}`
  + ` secrets ${pauseData.lampsLit}/${pauseData.secretsTotal} (want ${pauseData.secretsWanted})`
  + ` clock ${pauseData.clock}`);
check('the instruments start at rest and are driven to their values',
  pauseData.restCell === 0 && pauseData.restTape === 0
  && pauseData.armed && Math.abs(pauseData.setCell - 41) < 0.05 && pauseData.setTape > 0,
  `rest ${pauseData.restCell}/${pauseData.restTape} → cell ${pauseData.setCell}%`
  + ` tape ${pauseData.setTape}%, armed ${pauseData.armed}`);
check('every moving part is really animating, not snapping',
  ['cell', 'needle', 'tape', 'bay', 'lamp', 'punch', 'button']
    .every((k) => pauseData.moving[k].length > 0),
  Object.entries(pauseData.moving).map(([k, v]) => `${k}:${v.join('+') || 'NONE'}`).join(' '));
check('the odometer rolls up to the score', pauseData.score === '014820', pauseData.score);

// Each action must carry its OWN mechanism, not one shared hover colour: the
// four are compared against each other and against their own resting state.
// Driven by real pointer moves rather than element.focus(), because
// :focus-visible is a heuristic and a scripted focus does not always trip it.
// The bays are readouts, not controls: nothing in them is clickable, so they
// must not twitch under a cursor that is on its way to a button — and the
// panel must say each thing ONCE, on its instrument, with no caption row
// underneath restating it and no stencilled titles top and bottom.
const bayRest = await page.evaluate(() => [...document.querySelectorAll('.bay')].map((b) => {
  const r = b.getBoundingClientRect();
  return { key: r.top.toFixed(1) + '|' + getComputedStyle(b).transform, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}));
const bayMoved = [];
for (const b of bayRest) {
  await page.mouse.move(b.cx, b.cy);
  await page.waitForTimeout(260);
  const now = await page.evaluate(() => [...document.querySelectorAll('.bay')].map((e) => {
    const r = e.getBoundingClientRect();
    return r.top.toFixed(1) + '|' + getComputedStyle(e).transform;
  }));
  now.forEach((v, j) => { if (v !== bayRest[j].key) bayMoved.push(`bay${j}`); });
}
const pauseChrome = await page.evaluate(() => ({
  extra: ['.bay-detail', '.pause-title', '.pause-stamp', '.pause-foot']
    .filter((s) => document.querySelector(s)),
  count: document.querySelector('.tube-count')?.textContent.trim() || '',
}));
await page.mouse.move(4, 4);
check('the pause readouts do not move under the pointer',
  bayRest.length >= 7 && bayMoved.length === 0,
  `${bayRest.length} bays probed, moved: ${[...new Set(bayMoved)].join(' ') || 'none'}`);
check('and the panel carries no caption restating what an instrument shows',
  pauseChrome.extra.length === 0 && /^(\d+\/\d+|CLEAR)$/.test(pauseChrome.count),
  pauseChrome.extra.length ? `still present: ${pauseChrome.extra.join(' ')}`
    : `wave count "${pauseChrome.count}"`);

const readPact = () => window.__game && [...document.querySelectorAll('.pact')].map((b) => {
  const w = b.querySelector('.pact-wipe'), k = b.querySelector('.pact-key');
  const cs = getComputedStyle(b);
  return [cs.color, cs.borderTopColor,
    w ? getComputedStyle(w).transform + '|' + getComputedStyle(w).opacity : '',
    k ? getComputedStyle(k).transform : ''].join('|');
});
await page.mouse.move(4, 4);
await page.waitForTimeout(320);
const pauseBtns = { rest: await page.evaluate(readPact), hover: [], who: [] };
const IDS = ['btn-resume', 'btn-save', 'btn-pause-settings', 'btn-quit'];
for (const id of IDS) {
  await page.hover('#' + id);
  // Wait for the hover transition to START and then FINISH, rather than for a
  // fixed number of milliseconds. getComputedStyle during a transition returns
  // the interpolated value, so on a software renderer running at a few frames
  // a second a timed wait reads the resting colour back and calls the button
  // dead — which is a bug in the test, not in the button.
  await page.waitForFunction((sel) => {
    const b = document.querySelector(sel);
    const t = [b, ...b.querySelectorAll('*')].flatMap((e) => e.getAnimations())
      .filter((a) => a.constructor.name === 'CSSTransition');
    return t.length > 0 && t.every((a) => a.playState === 'finished');
  }, '#' + id, { timeout: 8000 }).catch(() => {});
  pauseBtns.who.push(`${id}->${await page.evaluate(() => [...document.querySelectorAll('.pact:hover')].map((b) => b.id).join(',') || 'NOBODY')}`);
  pauseBtns.hover.push((await page.evaluate(readPact))[IDS.indexOf(id)]);
}
await page.mouse.move(4, 4);
pauseBtns.focused = await page.evaluate(() => {
  document.getElementById('btn-resume').focus();
  for (const code of ['ArrowRight', 'ArrowRight']) {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }
  return document.activeElement.id;
});
check('every action button reacts to being selected',
  pauseBtns.rest.every((r, i) => r !== pauseBtns.hover[i]),
  pauseBtns.rest.map((r, i) => (r === pauseBtns.hover[i] ? 'DEAD' : 'ok')).join(' ')
  + ' | ' + pauseBtns.who.join(' '));
check('and each one reacts in its own way',
  new Set(pauseBtns.hover).size === pauseBtns.hover.length,
  `${new Set(pauseBtns.hover).size} distinct of ${pauseBtns.hover.length}`);
check('the action row can be walked from the keyboard',
  pauseBtns.focused === 'btn-pause-settings', `focus landed on ${pauseBtns.focused}`);
await page.evaluate(() => { window.__game.hud.showScreen(null); window.__game.state.state = 'playing'; });

/* ------------------------------------------------------------------ */
/* the arcade cabinets are machines you can play                        */
/* ------------------------------------------------------------------ */
const arc = await page.evaluate(async () => {
  const g = window.__game;
  g.hud.showScreen(null);
  g.state.state = 'playing';
  g.arcade.close();
  const out = {};
  const prompts = g.world.interactables
    .map((it) => (typeof it.prompt === 'string' ? it.prompt : ''))
    .filter((p) => p.startsWith('Play ') && !p.includes('piano'));
  out.cabinets = prompts.length;
  out.machines = [...new Set(prompts)].sort();

  const frame = () => new Promise((r) => requestAnimationFrame(r));
  // Walking up to one and pressing [E] is what a player does; drive the event
  // the interactable emits rather than reaching into the overlay.
  g.events.emit('arcade:play', { id: 'siege' });
  out.opened = g.arcade.open && getComputedStyle(document.getElementById('arcade')).display === 'flex';
  out.suppressed = g.input.suppressed;

  // The town has to be HELD while the machine is running: the world clock does
  // not advance, so nothing on the street can reach the player at the cabinet.
  const t0 = g.time;
  const hp0 = g.player.health;
  for (let i = 0; i < 6; i++) await frame();
  out.worldHeld = g.time === t0 && g.player.health === hp0;

  // ...and the machine itself is running on its own clock.
  const keys = g.arcade.keys;
  keys.add('Space'); keys.add('ArrowRight');
  const before = g.arcade.game.rows.length;
  for (let i = 0; i < 40; i++) { await frame(); g.arcade.update(0.05); }
  keys.clear();
  out.played = g.arcade.game.rows.length < before || g.arcade.game.score > 0;
  out.scoreShown = document.querySelector('.arc-score b').textContent;

  // Escape does NOT leave the machine — a reflex key must not switch off a run
  // you are in the middle of — and it must not reach the pause handler either.
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  out.escHeld = g.arcade.open;
  out.escPause = getComputedStyle(document.getElementById('screen-pause')).display;
  // A click on the room around the cabinet is the way out, and it is the one
  // that always hands the pointer back: a click is user activation.
  document.getElementById('arcade').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  out.closed = !g.arcade.open && getComputedStyle(document.getElementById('arcade')).display === 'none';
  out.stillPlaying = g.state.state;
  out.pauseShown = getComputedStyle(document.getElementById('screen-pause')).display;
  out.handedBack = !g.input.suppressed;

  // and the world starts moving again
  const t1 = g.time;
  for (let i = 0; i < 4; i++) await frame();
  out.worldResumed = g.time > t1;
  return out;
});
check('every arcade cabinet is a machine you can play', arc.cabinets >= 4 && arc.machines.length === 4,
  `${arc.cabinets} cabinets, ${arc.machines.length} distinct: ${arc.machines.join(', ')}`);
check('walking up to one starts it', arc.opened && arc.suppressed,
  `open ${arc.opened}, game input suppressed ${arc.suppressed}`);
check('the town is held while you play', arc.worldHeld,
  'world clock and health both frozen');
check('and the machine itself runs', arc.played, `score readout ${arc.scoreShown}`);
check('Escape does nothing at a machine you are playing',
  arc.escHeld && arc.escPause === 'none', `still open ${arc.escHeld}, pause ${arc.escPause}`);
check('a click off the cabinet steps away from it, not into the pause menu',
  arc.closed && arc.stillPlaying === 'playing' && arc.pauseShown === 'none' && arc.handedBack,
  `closed ${arc.closed}, state ${arc.stillPlaying}, pause ${arc.pauseShown}, input back ${arc.handedBack}`);
check('and the town starts moving again', arc.worldResumed);

/* ------------------------------------------------------------------ */
/* wave 3 is the Exploder's, and only wave 3                            */
/* ------------------------------------------------------------------ */
// Every other difficulty ramp is keyed to the KILL count, so a player who
// clears waves slowly never feels the horde thicken. Past wave 6 there is a
// ramp on the wave clock too — with kills pinned at zero so only the wave
// number can be doing the work.
const escal = await page.evaluate(() => {
  const g = window.__game;
  const w = g.waves;
  const keep = { wave: w.wave, kills: g.score.kills };
  g.score.kills = 0;                    // silence heat / surge / hordePush / progress
  const at = (n) => {
    w.wave = n;
    return { esc: w.escalation, iv: w.spawnInterval(), cap: w.activeCap() };
  };
  const out = { rows: {} };
  for (const n of [1, 5, 6, 7, 10, 14]) out.rows[n] = at(n);
  w.wave = keep.wave; g.score.kills = keep.kills;
  return out;
});
const r = escal.rows;
check('waves 1-6 are untouched by the wave-clock escalation',
  r[1].esc === 0 && r[5].esc === 0 && r[6].esc === 0 && r[6].cap === r[1].cap,
  `esc ${r[1].esc}/${r[5].esc}/${r[6].esc}, cap ${r[1].cap} -> ${r[6].cap}`);
check('and past wave 6 the horde spawns faster and thicker',
  r[7].esc > 0 && r[7].iv < r[6].iv && r[10].iv < r[7].iv && r[14].iv < r[10].iv
  && r[14].cap > r[6].cap,
  `interval ${r[6].iv.toFixed(2)} -> ${r[7].iv.toFixed(2)} -> ${r[10].iv.toFixed(2)}`
  + ` -> ${r[14].iv.toFixed(2)}, cap ${r[6].cap} -> ${r[14].cap}`);
check('and the ramp itself steepens rather than staying linear',
  (r[7].iv - r[10].iv) < (r[10].iv - r[14].iv),
  `w7->10 drops ${(r[7].iv - r[10].iv).toFixed(2)}, w10->14 drops ${(r[10].iv - r[14].iv).toFixed(2)}`);

const waveMix = await page.evaluate(() => {
  const w = window.__game.waves;
  const keep = { wave: w.wave, kills: window.__game.score.kills };
  const at = (n) => { w.wave = n; return w.typeWeights(); };
  const out = {};
  const three = at(3);
  out.three = three;
  out.onlyBombers = three.exploder === 1
    && !three.walker && !three.sprinter && !three.tank && !three.spitter;
  // ...and the waves either side are an ordinary MIX, untouched. Not "mostly
  // walkers" — by this point in the run the kill gates have opened and the
  // ordinary mix is a real spread; what matters is that it IS a spread.
  const mix = (t) => Object.values(t).filter((v) => v > 0).length > 1 && t.exploder < 1;
  const two = at(2), four = at(4);
  out.two = two; out.four = four;
  out.twoNormal = mix(two);
  out.fourNormal = mix(four);
  // and the roll really produces them
  window.__game.waves.wave = 3;
  const rolled = {};
  for (let i = 0; i < 200; i++) {
    const t = window.__game.spawner.pickType();
    rolled[t] = (rolled[t] || 0) + 1;
  }
  out.rolled = rolled;
  w.wave = keep.wave;
  return out;
});
check('wave 3 spawns nothing but Exploders', waveMix.onlyBombers
  && Object.keys(waveMix.rolled).length === 1 && waveMix.rolled.exploder === 200,
  `weights ${JSON.stringify(waveMix.three)}, 200 rolls → ${JSON.stringify(waveMix.rolled)}`);
check('and the waves either side keep the ordinary progression',
  waveMix.twoNormal && waveMix.fourNormal,
  `wave 2 ${JSON.stringify(waveMix.two)} · wave 4 ${JSON.stringify(waveMix.four)}`);

/* ------------------------------------------------------------------ */
/* pausing and resuming always gives the mouse back                     */
/* ------------------------------------------------------------------ */
// The harness normally runs with pointer lock switched off entirely, which is
// exactly why this shipped broken: the one path that decides whether a player
// can carry on playing was the one path never exercised. So turn the real
// pointer handling back on for this block and make the browser REFUSE the
// first few requests, the way it refuses any re-lock inside its cooldown after
// the user pressed Escape to leave one — which is the situation every single
// resume is in, because Escape is how you paused.
const lockFix = await page.evaluate(async () => {
  const g = window.__game;
  const canvas = document.getElementById('game-canvas');
  const out = {};
  const wasTest = g.testMode;
  g.testMode = false;
  const real = canvas.requestPointerLock.bind(canvas);
  let refuse = 4;
  let asked = 0;
  canvas.requestPointerLock = () => {
    asked++;
    if (refuse-- > 0) return Promise.reject(new Error('refused (cooldown)'));
    return real();
  };
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const esc = () => document.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));

  // pause → resume → pause → resume, the sequence in the report
  g.hud.showScreen(null);
  g.state.state = 'playing';
  g.pause();
  out.paused1 = g.state.state;
  out.wantsNothingWhilePaused = g.input.lockWanted === false;

  // ESCAPE MUST NOT CLOSE THE PAUSE SCREEN. It is what put the screen up, and
  // a stray press of it cannot be allowed to drop the player back into a wave
  // they are not looking at — this screen is left on its buttons, on purpose.
  esc();
  out.escHeldPause = g.state.state;
  // RESUME is the way out, and it has to leave ASKING for the pointer.
  document.getElementById('btn-resume').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.resumed = g.state.state;
  out.wantsPointer = g.input.lockWanted === true;
  const askedAtResume = asked;

  // ...and the refused request must not be the end of it: the pump keeps
  // asking, SILENTLY. There is no prompt any more — the cursor is simply not
  // on screen while the game is being played, granted or not, and the request
  // is redeemed by the player's next keypress or click.
  refuse = 999;
  for (let i = 0; i < 6; i++) { await frame(); await new Promise((r) => setTimeout(r, 300)); }
  out.retried = asked - askedAtResume;
  out.noPrompt = !document.getElementById('lock-hint');
  out.cursorHidden = document.body.classList.contains('in-play');
  out.lockedWhileRefused = document.pointerLockElement === canvas;
  // Let it through. Whether a headless browser actually grants the pointer is
  // its business, so assert the outcome either way: if it lands the request is
  // satisfied and the prompt goes, and if it does not the game is still ASKING
  // rather than sitting there stuck and silent, which is the whole failure.
  refuse = 0;
  const askedBeforeGrant = asked;
  for (let i = 0; i < 4; i++) { await frame(); await new Promise((r) => setTimeout(r, 300)); }
  out.locked = document.pointerLockElement === canvas;
  out.settled = out.locked
    ? g.input.lockWanted === false
    : asked > askedBeforeGrant && g.input.lockWanted === true;

  // Pausing again has to CANCEL the outstanding request. Otherwise the pump
  // reaches around the menu and takes the pointer back under it.
  g.pause();
  out.paused2 = g.state.state;
  out.requestDropped = g.input.lockWanted === false;
  const askedAtPause = asked;
  for (let i = 0; i < 4; i++) { await frame(); await new Promise((r) => setTimeout(r, 300)); }
  out.askedWhilePaused = asked - askedAtPause;
  // ...and the cursor comes BACK the moment the game is not being played, so
  // a player who cannot see it can always reach the menu and find it again.
  await frame(); await frame();
  out.cursorBackWhilePaused = !document.body.classList.contains('in-play');

  // ...and a grant that arrives AFTER the pause has to be handed straight
  // back. releasePointerLock can only exit a lock that already exists, so a
  // request still in flight when the player paused used to land underneath
  // the pause screen and stay there — pointer captured, menu up, nothing
  // outstanding to correct it. Simulate exactly that: take the lock while
  // paused, behind the game's back.
  // Deliberately behind the game's back, so the rejection is the HARNESS's to
  // swallow: a headless browser may refuse a request made without a user
  // gesture, and an unhandled rejection here would surface as a page error and
  // be counted against the game — which is the one thing this probe must not
  // do, since whether it lands at all is explicitly the browser's call below.
  real()?.catch(() => {});
  for (let i = 0; i < 40 && !document.pointerLockElement; i++) {
    await frame(); await new Promise((r) => setTimeout(r, 30));
  }
  out.lateGrantLanded = true;   // whether it landed at all is the browser's call
  // The hand-back is two async hops (the grant's change event, then our exit's
  // own change event), and headless runs those at whatever rate it manages —
  // so wait on the OUTCOME with plenty of room rather than on a frame count
  // that happens to be enough on a fast machine.
  for (let i = 0; i < 80 && (document.pointerLockElement || g.input.pointerLocked); i++) {
    await frame(); await new Promise((r) => setTimeout(r, 30));
  }
  out.lateGrantReturned = !document.pointerLockElement && !g.input.pointerLocked;
  out.stillPaused = g.state.state;

  // ...and RESUME gets back out of it a second time, which is the exact
  // sequence in the report: pause, resume, pause, and then stuck. Escape is
  // tried again first, and must again do nothing.
  esc();
  out.escHeldPause2 = g.state.state;
  document.getElementById('btn-resume').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.resumed2 = g.state.state;

  // The RESUME button is the other way out, and it has to ask for the pointer
  // the same way — it was reported stuck too.
  g.pause();
  // Everything about pointer lock reports back asynchronously — the exit, and
  // any request still in flight from the Escape path above, which the browser
  // is free to grant AFTER the pause. Settle both before clicking, or the
  // button gets tested against an input layer that still believes it holds
  // the pointer, sees nothing to ask for, and looks broken when it is not.
  // Wait on the game's own view of it, not just the document's, and require
  // the quiet to hold for a few frames so a late grant cannot slip in.
  for (let i = 0, calm = 0; i < 60 && calm < 4; i++) {
    if (!document.pointerLockElement && !g.input.pointerLocked) calm++; else calm = 0;
    await frame(); await new Promise((r) => setTimeout(r, 30));
  }
  out.unlockedBeforeClick = !document.pointerLockElement && !g.input.pointerLocked;
  const askedAtClick = asked;
  refuse = 999;
  document.getElementById('btn-resume').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.btnResumed = g.state.state;
  for (let i = 0; i < 3; i++) { await frame(); await new Promise((r) => setTimeout(r, 300)); }
  out.btnAsked = asked - askedAtClick;
  refuse = 0;
  const askedBeforeBtnGrant = asked;
  for (let i = 0; i < 3; i++) { await frame(); await new Promise((r) => setTimeout(r, 300)); }
  out.btnLocked = document.pointerLockElement === canvas;
  out.btnStillAsking = asked > askedBeforeBtnGrant && g.input.lockWanted === true;

  // put everything back the way the rest of the run expects it
  canvas.requestPointerLock = real;
  g.input.releasePointerLock();
  g.testMode = wasTest;
  g.hud.showScreen(null);
  g.state.state = 'playing';
  return out;
});
check('Escape opens the pause screen and never closes it',
  lockFix.escHeldPause === 'paused' && lockFix.escHeldPause2 === 'paused',
  `held ${lockFix.escHeldPause} / ${lockFix.escHeldPause2}`);
check('RESUME closes it, twice over',
  lockFix.resumed === 'playing' && lockFix.resumed2 === 'playing',
  `first ${lockFix.resumed}, after a second pause ${lockFix.resumed2}`);
check('resuming asks for the pointer, and keeps asking when refused',
  lockFix.wantsPointer && lockFix.retried >= 2,
  `wanted ${lockFix.wantsPointer}, ${lockFix.retried} retries after the refusal`);
check('a refused request is silent — no prompt, and no cursor on screen',
  lockFix.noPrompt && lockFix.cursorHidden && !lockFix.lockedWhileRefused,
  `prompt gone ${lockFix.noPrompt}, cursor hidden ${lockFix.cursorHidden}`
  + ` (locked ${lockFix.lockedWhileRefused})`);
check('a granted lock settles the request; a denied one keeps it alive',
  lockFix.settled,
  lockFix.locked ? 'pointer granted, request cleared' : 'pointer denied, still asking');
check('pausing cancels an outstanding pointer request, and gives the cursor back',
  lockFix.requestDropped && lockFix.askedWhilePaused === 0 && lockFix.cursorBackWhilePaused,
  `dropped ${lockFix.requestDropped}, ${lockFix.askedWhilePaused} asks while paused,`
  + ` cursor back ${lockFix.cursorBackWhilePaused}`);
check('and pausing while unlocked still works', lockFix.paused1 === 'paused' && lockFix.paused2 === 'paused',
  `${lockFix.paused1} / ${lockFix.paused2}`);
check('a lock that lands after the pause is handed straight back',
  lockFix.lateGrantReturned && lockFix.stillPaused === 'paused',
  `returned ${lockFix.lateGrantReturned}, state ${lockFix.stillPaused}`);
check('RESUME gets the pointer back too, refusals and all',
  // The retry pump itself is proven by the Escape path above; what this adds
  // is that the button enters the same pump rather than asking once and
  // shrugging.
  lockFix.unlockedBeforeClick && lockFix.btnResumed === 'playing' && lockFix.btnAsked >= 1
  && (lockFix.btnLocked || lockFix.btnStillAsking),
  `unlocked first ${lockFix.unlockedBeforeClick}, state ${lockFix.btnResumed},`
  + ` ${lockFix.btnAsked} asks, locked ${lockFix.btnLocked}`);

/* you can still LOOK while the browser thinks about it                   */
// How long a browser takes to hand the pointer back after a menu closes on
// Escape is the browser's business — Escape grants no user activation, so the
// request goes out and then it is a matter of waiting. The prompt and the
// cursor were made to go away; this is the last piece, the camera. Staged
// against a browser that refuses point blank and never relents, which is the
// worst case a player can be in.
const freeLook = await page.evaluate(async () => {
  const g = window.__game;
  const canvas = g.renderer.renderer.domElement;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const out = {};
  let locked = false;
  const realGet = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => (locked ? canvas : null) });
  const realReq = canvas.requestPointerLock, realExit = document.exitPointerLock;
  canvas.requestPointerLock = () => { document.dispatchEvent(new Event('pointerlockerror')); };
  document.exitPointerLock = () => { locked = false; document.dispatchEvent(new Event('pointerlockchange')); };
  const wasTest = g.testMode; g.testMode = false;
  document.dispatchEvent(new Event('pointerlockchange'));   // Input: we hold nothing
  await frame();

  g.hud.showScreen(null);
  g.state.state = 'playing';
  const move = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  g.events.emit('shop:open', {});
  await frame(); await frame();
  // ...and moving the mouse over an OPEN menu must not turn the world behind it
  const yawInMenu = g.player.yaw;
  move(400, 300); move(520, 300);
  await frame(); await frame();
  out.menuLookFrozen = g.player.yaw === yawInMenu;

  // Leave the counter the way the game actually leaves one: Escape is inert in
  // every overlay now, so this is [E] — which is also the exit that carries the
  // user activation a re-lock needs. Escape is tried first and must do nothing.
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  await frame();
  out.escInert = g.shop.open;
  document.dispatchEvent(new KeyboardEvent('keydown',
    { code: g.input.codesFor('interact')[0], key: 'e', bubbles: true }));
  await frame(); await frame();
  out.closed = !g.shop.open;
  out.refusedAndAsking = !locked && g.input.lockPending;

  const yaw0 = g.player.yaw, pitch0 = g.player.pitch;
  move(500, 320);                       // the first sample only sets the origin
  await frame();
  out.noFlickOnFirstSample = g.player.yaw === yaw0;
  for (let i = 1; i <= 12; i++) { move(500 + i * 9, 320 + i * 3); await frame(); }
  out.yawMoved = g.player.yaw - yaw0;
  out.pitchMoved = g.player.pitch - pitch0;

  // An unlocked cursor RUNS OUT OF WINDOW, and that is the failure this has to
  // avoid: turn far enough and the pointer walks off the edge of the page, the
  // look stops dead and the next click lands in whatever is behind the browser.
  // A quarter turn has to cost less than half a window of travel.
  const yawQ = g.player.yaw;
  let x = 500, steps = 0;
  move(x, 320); await frame();
  while (Math.abs(g.player.yaw - yawQ) < Math.PI / 2 && steps < 400) {
    x += 6; move(x, 320); await frame(); steps++;
  }
  out.travelForQuarterTurn = x - 500;
  out.travelFitsWindow = (x - 500) < window.innerWidth / 2;
  out.halfWindow = window.innerWidth / 2;
  // a cursor that left the window and came back somewhere else is not a flick
  const before = g.player.yaw;
  move(980, 620); await frame();
  out.reentryIgnored = Math.abs(g.player.yaw - before) < 0.02;

  Object.defineProperty(document, 'pointerLockElement', realGet);
  canvas.requestPointerLock = realReq; document.exitPointerLock = realExit;
  g.testMode = wasTest;
  g.input.releasePointerLock();
  return out;
});
check('the world does not turn under an open menu',
  freeLook.menuLookFrozen && freeLook.escInert && freeLook.closed,
  `frozen ${freeLook.menuLookFrozen}, escape inert ${freeLook.escInert},`
  + ` left on [E] ${freeLook.closed}`);
check('and you can look around in the gap before the pointer comes back',
  freeLook.refusedAndAsking && Math.abs(freeLook.yawMoved) > 0.05 && Math.abs(freeLook.pitchMoved) > 0.01,
  `still refused ${freeLook.refusedAndAsking}, yaw ${freeLook.yawMoved.toFixed(3)},`
  + ` pitch ${freeLook.pitchMoved.toFixed(3)}`);
check('...without a flick on the first sample or on re-entering the window',
  freeLook.noFlickOnFirstSample && freeLook.reentryIgnored,
  `first sample ${freeLook.noFlickOnFirstSample}, re-entry ${freeLook.reentryIgnored}`);
check('...and without running the cursor off the edge of the page to do it',
  freeLook.travelFitsWindow,
  `${freeLook.travelForQuarterTurn}px of travel for a quarter turn,`
  + ` half a window is ${Math.round(freeLook.halfWindow)}px`);

/* ------------------------------------------------------------------ */
/* one material family: every interface is cut from the same plate      */
/* ------------------------------------------------------------------ */
// The whole UI paints itself from four procedural bakes published as CSS
// tokens at boot (installHudTextures). If that install is ever dropped, or a
// new panel is written that forgets the material, nothing throws — the panels
// just quietly go back to being flat rectangles. So assert it: the tokens hold
// real image data, and every top-level surface actually resolves one.
const material = await page.evaluate(async () => {
  const g = window.__game;
  g.hud.showScreen(null); g.state.state = 'playing';
  const root = getComputedStyle(document.documentElement);
  const out = { tokens: {}, panels: {} };
  for (const t of ['--tex-steel', '--tex-bar', '--tex-plate', '--tex-recess', '--tex-paper']) {
    out.tokens[t] = /^url\("?data:image\/png/.test(root.getPropertyValue(t).trim());
  }
  // Open every overlay in turn so its panels are laid out and measurable.
  g.inventory.toggle();
  g.arcade.play('brickfall');
  const probe = (label, sel) => {
    const el = document.querySelector(sel);
    out.panels[label] = el ? /data:image\/png/.test(getComputedStyle(el).backgroundImage) : 'MISSING';
  };
  probe('side device', '.side-hud');
  probe('console bar', '#console-bar');
  probe('nameplate', '.dev-plate');
  probe('log well', '#cons-log-wrap');
  probe('satchel', '.inv-panel');
  probe('satchel slot', '.inv-slot');
  probe('cabinet', '.arc-cab');
  g.arcade.close();
  g.inventory.toggle();
  g.pause();
  probe('pause case', '#pause-case');
  probe('pause bay', '.bay');
  g.hud.showScreen(null); g.state.state = 'playing';
  return out;
});
check('the panel materials are baked and published as CSS tokens',
  Object.values(material.tokens).every(Boolean),
  Object.entries(material.tokens).map(([k, v]) => `${k}:${v ? 'ok' : 'EMPTY'}`).join(' '));
check('and every interface surface is cut from them',
  Object.values(material.panels).every((v) => v === true),
  Object.entries(material.panels).map(([k, v]) => `${k}:${v === true ? 'ok' : v}`).join(' '));

/* the cabinets out in the world are machines, not coloured boxes           */
// Two separate claims: the bodies and flanks carry real artwork, and the
// screens are RUNNING — four frames of the machine's own attract loop stepped
// in order. A cabinet showing one frozen still is a poster.
const cabs = await page.evaluate(async () => {
  const g = window.__game;
  const out = { bodies: 0, textured: 0, art: 0, mirrored: 0, ids: new Set() };
  const cabRoots = [];
  g.world.group.traverse((o) => { if (o.userData && o.userData.cab) cabRoots.push(o); });
  for (const root of cabRoots) {
    out.ids.add(root.userData.cab);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || !m.map) return;
      if (o.geometry.type === 'BoxGeometry') { out.bodies++; out.textured++; }
      else if (o.geometry.type === 'PlaneGeometry') {
        out.art++;
        // A negative-determinant world transform is a MIRROR, and a mirrored
        // plane prints its title backwards. Yaw alone turns a flank to face
        // out; a scale flip on top of it was the bug.
        o.updateWorldMatrix(true, false);
        if (o.matrixWorld.determinant() < 0) out.mirrored++;
      }
    });
  }
  out.cabinets = cabRoots.length;
  out.ids = [...out.ids];

  // The attract loop. Stand next to a cabinet first: the surface animations
  // are distance-culled, so a screen 200 m away is CORRECTLY frozen and
  // sampling it from the town square proves nothing.
  const sheets = (g.world.matAnims || []).filter((a) => a.kind === 'flip' && a.steady);
  if (sheets[0]) g.player.position.set(sheets[0].x, g.player.position.y, sheets[0].z + 2);
  out.sheets = sheets.length;
  const seen = new Set();
  const one = sheets[0];
  if (one) {
    for (let i = 0; i < 90; i++) {
      seen.add(one.map.offset.x.toFixed(2) + ',' + one.map.offset.y.toFixed(2));
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  out.cells = [...seen];
  return out;
});
check('no cabinet flank is printed backwards',
  cabs.mirrored === 0 && cabs.art > 0,
  `${cabs.mirrored} of ${cabs.art} art planes have a mirrored world transform`);
check('every cabinet body and flank carries real artwork, not a flat colour',
  cabs.cabinets >= 4 && cabs.ids.length === 4 && cabs.textured >= cabs.cabinets
  && cabs.art >= cabs.cabinets * 3,
  `${cabs.cabinets} cabinets (${cabs.ids.join(' ')}), ${cabs.textured} textured bodies, ${cabs.art} art planes`);
check('and their screens run a four-frame attract loop',
  cabs.sheets >= 4 && cabs.cells.length === 4,
  `${cabs.sheets} sheets, cells visited: ${cabs.cells.join(' ')}`);

/* the machines make a noise, and only while you are at them                */
// The beep hook defaults to a no-op so the attract frames bake silently; the
// risk is that it stays a no-op. Play a machine for real and count what comes
// out of it, then check the cabinet's attract loop is on the same clock as its
// picture rather than a timer of its own.
const arcSound = await page.evaluate(async () => {
  const g = window.__game;
  g.hud.showScreen(null); g.state.state = 'playing';
  g.arcade.close();
  const beeps = [];
  const attract = [];
  const realBeep = g.audio.arcadeBeep.bind(g.audio);
  g.audio.arcadeBeep = (kind, id) => { beeps.push(kind + ':' + id); };
  const offAttract = g.events.on('arcade:attract', (e) => attract.push(e.id));
  const frame = () => new Promise((r) => requestAnimationFrame(r));

  // baking the attract art must stay silent — it runs the same update()
  const { screenSheet } = await import('/src/rendering/Arcade.js');
  screenSheet('brickfall');
  const quietAfterBake = beeps.length === 0;

  g.arcade.play('rally');
  for (let i = 0; i < 240 && beeps.length < 3; i++) { g.arcade.update(1 / 30); await frame(); }
  const played = beeps.length;
  g.arcade.close();
  const afterClose = beeps.length;
  for (let i = 0; i < 60; i++) { g.arcade.update(1 / 30); await frame(); }

  // and the cabinets out in the world, heard from beside one
  const sheets = (g.world.matAnims || []).filter((a) => a.kind === 'flip' && a.steady);
  if (sheets[0]) g.player.position.set(sheets[0].x, g.player.position.y, sheets[0].z + 2);
  attract.length = 0;
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 40));
  g.audio.arcadeBeep = realBeep;
  if (typeof offAttract === 'function') offAttract();
  return {
    quietAfterBake, played, silentAfterClose: beeps.length === afterClose,
    kinds: [...new Set(beeps)].slice(0, 6),
    attract: [...new Set(attract)], attractCount: attract.length,
    sheets: sheets.length,
  };
});
check('a machine you are playing makes its own noise',
  arcSound.played >= 3 && arcSound.kinds.every((k) => k.endsWith(':rally')),
  `${arcSound.played} beeps: ${arcSound.kinds.join(' ')}`);
check('and baking the attract art stays silent, and so does a closed machine',
  arcSound.quietAfterBake && arcSound.silentAfterClose,
  `bake quiet ${arcSound.quietAfterBake}, closed quiet ${arcSound.silentAfterClose}`);
check('a cabinet across the room bleeps on the same beat its screen steps',
  arcSound.attractCount > 0 && arcSound.attract.length > 0,
  `${arcSound.attractCount} bleeps from ${arcSound.attract.join('/') || 'nothing'}`);

/* Escape at a cabinet returns you to the STREET, pointer and all           */
// The check above proves this in test mode, where pointer lock is skipped
// whole — which is precisely why it missed the real bug. Chromium grants a
// lock requested inside an Escape keydown and then the same keypress revokes
// it; the revoke lands after the arcade has closed, and the game used to read
// it as the player walking away and pause. Reproduce that exact sequence.
const arcEsc = await page.evaluate(async () => {
  const g = window.__game;
  const canvas = document.getElementById('game-canvas');
  // This check runs late in a long suite, with the world live between blocks —
  // top the player back up so a stray zombie cannot turn a pointer-lock test
  // into a death test.
  g.player.health = g.player.maxHealth;
  g.hud.showScreen(null); g.state.state = 'playing';
  g.arcade.close();
  const wasTest = g.testMode;
  g.testMode = false;                       // the whole point: the real path
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const settle = async (n = 10) => { for (let i = 0; i < n; i++) { await frame(); await new Promise((r) => setTimeout(r, 50)); } };

  const realGet = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
  const realReq = canvas.requestPointerLock.bind(canvas);
  const realExit = document.exitPointerLock.bind(document);
  let locked = false, escaping = false, slowRevoke = false;
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => (locked ? canvas : null) });
  const change = () => document.dispatchEvent(new Event('pointerlockchange'));
  canvas.requestPointerLock = () => {
    locked = true;
    const revoke = escaping;                // granted, then taken back by the ESC
    const after = slowRevoke ? 600 : 20;    // ...promptly, or long after the fact
    setTimeout(() => { change(); if (revoke) setTimeout(() => { locked = false; change(); }, after); }, 0);
    return Promise.resolve();
  };
  document.exitPointerLock = () => { locked = false; setTimeout(change, 0); };

  g.input.requestPointerLock();
  await settle(4);
  const out = { startLocked: g.input.pointerLocked };
  g.arcade.play('brickfall');
  await settle(6);
  out.openedUnlocked = g.arcade.open && !g.input.pointerLocked && g.state.state === 'playing';

  const pauseShown = () => getComputedStyle(document.getElementById('screen-pause')).display;

  // ESCAPE AT A CABINET closes nothing — but the browser still drops the
  // pointer lock on it, because that is what Escape IS to a locked page, and
  // the game must not read that drop as the player walking away. The machine
  // stays up and the street stays unpaused behind it.
  escaping = true;
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  setTimeout(() => { escaping = false; }, 120);
  await settle(12);
  out.escHeld = { open: g.arcade.open, state: g.state.state, pause: pauseShown() };

  // Leaving is a click on the room around the cabinet, and THAT is where the
  // hazard lives: the exit asks for the pointer back, and the browser is
  // entitled to grant it and then take it away again LATE because of the
  // Escape a moment ago. A guard built on "was the lock held only briefly"
  // passes a quick revoke and fails this one, which is the case a loaded
  // machine actually produces.
  slowRevoke = true; escaping = true;
  document.getElementById('arcade').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  setTimeout(() => { escaping = false; slowRevoke = false; }, 700);
  await settle(24);
  out.closed = !g.arcade.open;
  out.state = g.state.state;
  out.locked = g.input.pointerLocked;
  out.pauseShown = pauseShown();

  // put the real plumbing back
  Object.defineProperty(document, 'pointerLockElement', realGet);
  canvas.requestPointerLock = realReq; document.exitPointerLock = realExit;
  g.testMode = wasTest;
  g.hud.showScreen(null); g.state.state = 'playing';
  g.input.releasePointerLock();
  return out;
});
check('Escape at a cabinet keeps the machine and does not pause the street',
  arcEsc.startLocked && arcEsc.openedUnlocked && arcEsc.escHeld.open
  && arcEsc.escHeld.state === 'playing' && arcEsc.escHeld.pause === 'none',
  `still open ${arcEsc.escHeld.open}, state ${arcEsc.escHeld.state}, pause ${arcEsc.escHeld.pause}`);
check('a click off it goes back to the street, even when the browser takes its time refusing',
  arcEsc.closed && arcEsc.state === 'playing' && arcEsc.pauseShown === 'none',
  `closed ${arcEsc.closed}, state ${arcEsc.state}, pause ${arcEsc.pauseShown}`);
check('and the pointer comes back with you',
  arcEsc.locked, `late-revoke ${arcEsc.locked}`);

/* a run you walked away from is still there when you come back            */
// Stepping away from a cabinet used to throw the game away: play() built a new
// machine every time, so a good run ended the moment a zombie walked past the
// arcade door. Now the run is HELD, frozen, and re-entered paused — and the
// best score rides along in the save.
const arcHold = await page.evaluate(async () => {
  const g = window.__game;
  const settle = (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); t(); });
  const key = (code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
  g.state.state = 'playing';
  g.arcade.resetRun();
  g.arcade.play('brickfall');
  key('Space');                                    // launch the ball
  for (let i = 0; i < 40; i++) { g.arcade.update(1 / 30); }
  g.arcade.game.score = 340;                       // a run worth keeping
  const mid = { score: g.arcade.game.score, bx: g.arcade.game.bx, by: g.arcade.game.by };
  // Walking away is a click on the room around the cabinet — Escape does not
  // close a machine any more, and a run must survive being walked away from
  // however the player does it.
  document.getElementById('arcade').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await settle(3);
  const away = { closed: !g.arcade.open, paused: g.arcade.paused };
  // The world runs on while the cabinet is shut, and the machine must not.
  for (let i = 0; i < 30; i++) g.arcade.update(1 / 30);
  const still = g.arcade.games.brickfall.score === mid.score
    && g.arcade.games.brickfall.bx === mid.bx && g.arcade.games.brickfall.by === mid.by;
  g.arcade.play('brickfall');
  await settle(2);
  const back = { score: g.arcade.game.score, paused: g.arcade.paused, msg: g.arcade.msgEl.textContent };
  // ...and it does not move until asked
  for (let i = 0; i < 20; i++) g.arcade.update(1 / 30);
  const frozen = g.arcade.game.bx === mid.bx && g.arcade.game.by === mid.by;
  key('Space');
  for (let i = 0; i < 20; i++) g.arcade.update(1 / 30);
  const running = !g.arcade.paused && (g.arcade.game.bx !== mid.bx || g.arcade.game.by !== mid.by);
  // the best score is in the save, and a NEW run wipes the board
  g.arcade.best.vermin = 970;
  const saved = g.captureSession().arcade;
  g.arcade.resetRun();
  const wiped = !g.arcade.games.brickfall && !g.arcade.best.vermin;
  g.arcade.restore(saved);
  const restored = g.arcade.best.vermin;
  g.arcade.close();
  g.arcade.resetRun();
  return { mid, away, still, back, frozen, running, saved, wiped, restored };
});
check('a machine you walked away from keeps the run you left on it',
  arcHold.away.closed && arcHold.away.paused && arcHold.still
  && arcHold.back.score === arcHold.mid.score && arcHold.back.paused,
  `closed ${arcHold.away.closed}, frozen while shut ${arcHold.still},`
  + ` back at ${arcHold.back.score} (left ${arcHold.mid.score}), paused ${arcHold.back.paused}`);
check('and it stays paused until you ask it to play on',
  arcHold.frozen && arcHold.running && /PAUSED/.test(arcHold.back.msg),
  `held still ${arcHold.frozen}, resumed ${arcHold.running}, "${arcHold.back.msg}"`);
check('the cabinet high scores are written into the game save',
  arcHold.saved?.best?.vermin === 970 && arcHold.wiped && arcHold.restored === 970,
  `saved ${JSON.stringify(arcHold.saved?.best)}, wiped ${arcHold.wiped}, restored ${arcHold.restored}`);

/* two keys per action, and either one fires it                            */
// A player with a thumb button wants SPRINT on the thumb AND on Shift; the
// action layer has to honour both slots, and the settings form has to offer
// somewhere to put the second one.
const binds = await page.evaluate(() => {
  const g = window.__game;
  const before = [...g.input.codesFor('sprint')];
  g.settings.setBinding('sprint', 1, 'Mouse3');
  g.settings.apply();
  const out = { slots: [...g.input.codesFor('sprint')] };
  const held = (fn) => { const was = g.input.keys, wasM = g.input.mouseDown; fn(); const v = g.input.isActionDown('sprint'); g.input.keys = was; g.input.mouseDown = wasM; return v; };
  out.byPrimary = held(() => { g.input.keys = new Set(['ShiftLeft']); g.input.mouseDown = [false, false, false, false, false]; });
  // 'Mouse3' is MouseEvent.button 3 — the thumb button, labelled MOUSE4.
  out.byAlt = held(() => { g.input.keys = new Set(); g.input.mouseDown = [false, false, false, true, false]; });
  out.byNeither = held(() => { g.input.keys = new Set(['KeyZ']); g.input.mouseDown = [false, false, false, false, false]; });
  // both slots are on the form, and both are labelled
  const row = document.querySelector('#screen-pause-settings .tm-bind-row');
  out.chips = row ? [...row.querySelectorAll('.tm-bind-key')].map((b) => b.textContent) : [];
  // a code belongs to exactly one cell: taking it moves it
  g.settings.setBinding('reload', 1, 'ShiftLeft');
  out.stolen = [...g.input.codesFor('sprint')];
  out.thief = [...g.input.codesFor('reload')];
  // and an action can never be left with nothing
  out.clearedLast = g.settings.clearBinding('jump', 0);
  g.settings.bindings.sprint = before;
  g.settings.bindings.reload = ['KeyR'];
  g.settings.apply();
  return out;
});
check('every action takes two keys, and either one fires it',
  binds.slots.join() === 'ShiftLeft,Mouse3' && binds.byPrimary && binds.byAlt && !binds.byNeither,
  `${binds.slots.join(' + ')} — primary ${binds.byPrimary}, alternate ${binds.byAlt},`
  + ` neither ${binds.byNeither}`);
check('and the settings form offers both slots',
  binds.chips.length === 2 && binds.chips.every((c) => c && c !== '—'),
  `chips ${JSON.stringify(binds.chips)}`);
check('a key can only be in one place, and no action is left unbound',
  !binds.stolen.includes('ShiftLeft') && binds.thief.includes('ShiftLeft') && !binds.clearedLast,
  `sprint ${binds.stolen.join('+')}, reload ${binds.thief.join('+')},`
  + ` cleared jump's last key ${binds.clearedLast}`);

/* a weapon you have not found leaves an EMPTY bay, not a preview          */
// The Alien Blaster is a secret. A dimmed silhouette of it sitting in slot 6
// from the first frame of a run tells the player there is a sixth weapon and
// roughly what it looks like, which is exactly the thing a secret must not
// do — so a locked bay shows the bay number and nothing else, in both the
// persistent ARMS grid and the ARMORY fly-in.
const bays = await page.evaluate(async () => {
  const g = window.__game;
  g.hud.showScreen(null); g.state.state = 'playing';
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const read = () => {
    const arms = [...document.querySelectorAll('.arms-slot')];
    const rack = [...document.querySelectorAll('.wm-slot')];
    const vis = (el) => !!el && getComputedStyle(el).visibility !== 'hidden';
    const words = (el) => (el ? el.textContent.trim().replace(/\u00a0/g, '') : '');
    return {
      armsGlyph: arms.map((s) => vis(s.querySelector('.arms-icon'))),
      armsText: arms.map((s) => words(s.querySelector('.arms-rsv'))),
      rackGlyph: rack.map((s) => vis(s.querySelector('.wm-glyph'))),
      rackText: rack.map((s) => words(s.querySelector('.wm-name')) + words(s.querySelector('.wm-ammo'))),
      locked: g.weapons.hudState().map((w) => !!w.locked),
    };
  };
  g.hud.showWeaponMenu?.();
  await frame(); await frame();
  const before = read();
  g.events.emit('weapon:unlock', { id: 'blaster' });
  for (let i = 0; i < 4; i++) await frame();
  const after = read();
  return { before, after };
});
const lockedIdx = bays.before.locked.indexOf(true);
check('an unfound weapon leaves a blank bay in both racks',
  lockedIdx >= 0
  && !bays.before.armsGlyph[lockedIdx] && bays.before.armsText[lockedIdx] === ''
  && !bays.before.rackGlyph[lockedIdx] && bays.before.rackText[lockedIdx] === '',
  `slot ${lockedIdx + 1}: arms glyph ${bays.before.armsGlyph[lockedIdx]}`
  + ` "${bays.before.armsText[lockedIdx]}", rack glyph ${bays.before.rackGlyph[lockedIdx]}`
  + ` "${bays.before.rackText[lockedIdx]}"`);
check('and finding it fills the bay in',
  lockedIdx >= 0 && !bays.after.locked[lockedIdx]
  && bays.after.armsGlyph[lockedIdx] && bays.after.armsText[lockedIdx] !== ''
  && bays.after.rackGlyph[lockedIdx] && bays.after.rackText[lockedIdx] !== '',
  `arms "${bays.after.armsText[lockedIdx]}", rack "${bays.after.rackText[lockedIdx]}"`);
check('and no OTHER bay was blank to begin with',
  bays.before.armsGlyph.filter((v) => !v).length === 1,
  `${bays.before.armsGlyph.filter((v) => !v).length} blank of ${bays.before.armsGlyph.length}`);

/* the dock always fits the window, however wide its contents get         */
// The dock is scaled to fit by measuring its own natural width. Measured once
// during construction that number is the width of a HALF-BUILT dock, and the
// assembled thing then hangs off both edges of the screen — which is exactly
// what happened. A ResizeObserver re-fits it whenever the contents move, so
// this checks the fit AFTER forcing the width up.
const dockFit = await page.evaluate(async () => {
  const g = window.__game;
  const inner = document.getElementById('hud-dock-inner');
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const measure = () => {
    const r = inner.getBoundingClientRect();
    return { left: r.left, right: r.right, natural: inner.offsetWidth };
  };
  await frame();
  const rest = measure();
  // Widen the row without touching the window: a fourth device bolted into
  // the dock is the same event as a panel growing, and it is the case the
  // one-shot measurement got wrong.
  const filler = document.createElement('div');
  filler.style.cssText = 'width:300px;flex:0 0 300px;';
  inner.appendChild(filler);
  await frame(); await new Promise((r) => setTimeout(r, 80)); await frame();
  const grown = measure();
  filler.remove();
  await frame(); await new Promise((r) => setTimeout(r, 80)); await frame();
  const back = measure();
  return { rest, grown, back, view: window.innerWidth, g: !!g };
});
const fits = (m, view) => m.left >= -1 && m.right <= view + 1;
check('the instrument dock fits the window',
  fits(dockFit.rest, dockFit.view),
  `${dockFit.rest.left.toFixed(0)}..${dockFit.rest.right.toFixed(0)} in ${dockFit.view}`);
check('and re-fits itself when its contents grow',
  dockFit.grown.natural > dockFit.rest.natural && fits(dockFit.grown, dockFit.view)
  && Math.abs(dockFit.back.right - dockFit.rest.right) < 2,
  `natural ${dockFit.rest.natural} -> ${dockFit.grown.natural},`
  + ` ${dockFit.grown.left.toFixed(0)}..${dockFit.grown.right.toFixed(0)} in ${dockFit.view},`
  + ` back to ${dockFit.back.right.toFixed(0)}`);

/* every instrument stays INSIDE the chassis it is bolted to               */
// The counter bank was three stacked label-and-wheels blocks in a case with a
// hard 132px height, so it hung out of the panel top and bottom with its
// digits sitting on the camouflage. That is invisible in a code review and
// obvious the moment you look at the HUD, which is exactly what this suite is
// for: every direct child of the console has to fit the box it is in, and none
// of them may overflow its own.
// One instrument is SUPPOSED to stand proud: the portrait tube is pulled up out
// of the bar on a negative top margin so it breaks the top line, cable and all.
// So a riser earns its exemption by declaring that margin, and only at the top
// edge -- nothing, riser or not, may hang below the case, which is where the
// digits went.
const chassis = await page.evaluate(() => {
  const bar = document.getElementById('console-bar');
  const b = bar.getBoundingClientRect();
  const cs = getComputedStyle(bar);
  const padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
  const out = { bar: { top: b.top + padT, bottom: b.bottom - padB }, over: [], spill: [], risers: [] };
  for (const el of bar.children) {
    if (el.classList.contains('screw')) continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    const ecs = getComputedStyle(el);
    const riser = parseFloat(ecs.marginTop) < -1;
    if (riser) out.risers.push(el.id || el.className);
    // proud of the chassis...
    if ((r.top < out.bar.top - 1.5 && !riser) || r.bottom > out.bar.bottom + 1.5) {
      out.over.push(`${el.id || el.className}:${r.top.toFixed(0)}..${r.bottom.toFixed(0)}`);
    }
    // ...or overflowing its own box, which is the same bug one level down --
    // but only where the overflow would actually be SEEN. A screen that
    // declares overflow:hidden has said its content is meant to run past the
    // glass and be cut off there (the CRT log scrolls its oldest lines off the
    // top by design); the counter bank makes no such claim, so the spill that
    // put its digits on the camouflage still lands here.
    if (ecs.overflow === 'visible'
      && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) {
      out.spill.push(`${el.id || el.className}:${el.scrollWidth}x${el.scrollHeight}`
        + ` in ${el.clientWidth}x${el.clientHeight}`);
    }
  }
  out.lamp = !!document.querySelector('.cons-lamp');
  const bank = document.getElementById('cons-meters');
  out.rows = [...bank.querySelectorAll('.cons-meter')].map((r) => +r.getBoundingClientRect().width.toFixed(1));
  return out;
});
check('every instrument sits inside the console chassis',
  chassis.over.length === 0 && chassis.risers.join() === 'cons-monitor',
  chassis.over.join(' ') || `all within the case, riser: ${chassis.risers.join() || 'none'}`);
check('...and none of them overflows its own housing',
  chassis.spill.length === 0, chassis.spill.join(' ') || 'nothing spilling');
check('the counter bank reads as one instrument, not loose tiles',
  chassis.rows.length === 2 && new Set(chassis.rows).size === 1 && !chassis.lamp,
  `${chassis.rows.length} rows at ${[...new Set(chassis.rows)].join('/')}px,`
  + ` alarm lamp ${chassis.lamp}`);

/* dropped loot ages off the street, and warns before it goes            */
// Three separate things have to hold at once: the item is still collectable
// well past the warning, it BLINKS through the last stretch rather than fading
// to a half-there ghost, and it is gone on time. The clock is driven by hand at
// a fixed dt so the result cannot depend on frame rate, and it is fed a running
// time — the blink is a function of the world clock, and a probe that passes a
// frozen one will report a sprite that never blinks.
const decay = await page.evaluate(() => {
  const g = window.__game;
  g.hud.showScreen(null); g.state.state = 'playing';
  const p = g.player.position;
  // Track the two items THIS check drops, by identity: the run has been killing
  // things for several minutes by now, so the street already has other people's
  // drops on it at unknown ages.
  const already = new Set(g.pickups.items);
  const seededBefore = g.pickups.items.filter((i) => i.life === 0).length;
  g.events.emit('loot:spawn', { x: p.x + 3, z: p.z, type: 'ammo_rifle', amount: 30 });
  g.events.emit('loot:spawn', { x: p.x + 4, z: p.z, type: 'coin_copper', amount: 1 });
  const mine = g.pickups.items.filter((i) => !already.has(i));
  const dropped = () => mine.filter((i) => g.pickups.items.includes(i));
  let clock = 0;
  const step = (secs) => {
    for (let i = 0; i < Math.round(secs / 0.05); i++) {
      clock += 0.05;
      g.pickups.update(0.05, clock, g.player, g.renderer.camera.position);
    }
  };
  const out = { spawned: mine.length, onTheClock: mine.every((i) => i.life === 45) };
  step(30);
  out.at30 = dropped().length;
  out.steadyAt30 = dropped().every((i) => i.bb.mesh.material.opacity === 1);
  const seen = new Set();
  for (let i = 0; i < 120; i++) { step(0.05); dropped().forEach((it) => seen.add(+it.bb.mesh.material.opacity.toFixed(2))); }
  out.blink = [...seen].sort();
  out.at36 = dropped().length;
  step(10);
  out.at46 = dropped().length;
  // ...and the world's own loot is NOT on the clock: it is placed at load, so
  // this timer would strip every drawer in town before the player reached one.
  // The count has to be exactly level, not merely non-zero — the town seeds to
  // the pickup cap, so a full list that evicts by position rather than by age
  // destroys a piece of building loot on every single drop.
  const seededAfter = g.pickups.items.filter((i) => i.life === 0).length;
  out.seededSurvives = seededBefore > 0 && seededAfter === seededBefore;
  out.seeded = `${seededAfter}/${seededBefore}`;

  // ...and the street can hold a wave's payout at once. This is the other half
  // of the same budget: seed the list to its cap and every coin a zombie drops
  // shoves the previous one off the end, so the ground never holds more than
  // the last kill paid.
  const room = new Set(g.pickups.items);
  for (let i = 0; i < 20; i++) {
    g.events.emit('loot:spawn', { x: p.x + 3 + i * 0.4, z: p.z + 2, type: 'coin_copper', amount: 1 });
  }
  out.wave = g.pickups.items.filter((i) => !room.has(i)).length;
  return out;
});
check('dropped loot is still there long after it lands',
  decay.spawned === 2 && decay.onTheClock && decay.at30 === 2 && decay.steadyAt30 && decay.at36 === 2,
  `${decay.spawned} dropped on a 45s clock (${decay.onTheClock}),`
  + ` ${decay.at30} at 30s (steady ${decay.steadyAt30}), ${decay.at36} at 36s`);
check('...blinks through its last seconds rather than ghosting',
  decay.blink.length === 2 && decay.blink[1] === 1 && decay.blink[0] < 0.3,
  `opacity took ${decay.blink.join(' / ')}`);
check('...and is gone at forty-five, while the world\'s own loot stays',
  decay.at46 === 0 && decay.seededSurvives,
  `${decay.at46} left at 46s, world loot ${decay.seeded} still standing`);
check('...and the street still has room for a whole wave\'s payout',
  decay.wave === 20, `${decay.wave} of 20 coins survived being dropped together`);

/* the portrait keeps looking around, and keeps reporting the wound      */
// Two separate things share one canvas and each has broken independently: the
// idle glance (which must keep running while nothing is happening) and the
// head swap on damage. Hash the pixels rather than trusting the state, and do
// the damage half at full health first so a changed frame cannot be the idle.
const face = await page.evaluate(async () => {
  const g = window.__game;
  g.hud.showScreen(null); g.state.state = 'playing';
  const cv = g.hud.portraitCanvas;
  const ctx = cv.getContext('2d');
  const hash = () => {
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 17) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  // Drive the portrait directly on a fixed dt so the sampling does not depend
  // on how many frames a software renderer manages to produce.
  const step = (secs, frac) => {
    g.hud.portrait.setHealth(frac);
    for (let i = 0; i < Math.round(secs / 0.05); i++) g.hud.portrait.update(0.05);
  };
  const out = { idle: new Set(), states: {}, poses: new Set() };
  // 24 seconds of standing still at full health: the glance cycle has to move
  for (let i = 0; i < 48; i++) { step(0.5, 1); out.idle.add(hash()); out.poses.add(g.hud.portrait.pose); }
  out.idleFrames = out.idle.size;
  out.poses = [...out.poses];
  // ...and separately, the TUBE has to be alive while the pose is pinned: a
  // face that only moves when the glance timer fires is a slideshow.
  const still = new Set();
  g.hud.portrait.pose = 'forward';
  for (let i = 0; i < 14; i++) {
    g.hud.portrait.setHealth(1);
    g.hud.portrait.update(0.05);
    g.hud.portrait.pose = 'forward';       // hold it, so only the tube can move
    still.add(hash());
  }
  out.stillFrames = still.size;
  for (const [name, frac] of [['healthy', 1], ['hurt', 0.4], ['critical', 0.15]]) {
    step(0.4, frac);
    out.states[name] = hash();
  }
  return { idleFrames: out.idleFrames, poses: out.poses, stillFrames: out.stillFrames, states: out.states };
});
check('the portrait keeps glancing around while nothing happens',
  face.idleFrames > 1 && face.poses.length > 1,
  `${face.idleFrames} distinct frames over 24s of idle, poses ${face.poses.join('/')}`);
check('and the tube is alive even when the pose is not',
  face.stillFrames > 3,
  `${face.stillFrames} distinct frames from one held pose`);
check('and the face changes as the wound gets worse',
  new Set(Object.values(face.states)).size === 3,
  Object.entries(face.states).map(([k, v]) => `${k}:${v.toString(16)}`).join(' '));

check('no console errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
