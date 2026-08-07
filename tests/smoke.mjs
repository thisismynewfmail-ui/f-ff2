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

// player movement (a long hold: software-rendered CI frames are slow)
const before = await page.evaluate(() => ({ ...window.__game.player.position }));
await page.keyboard.down('w');
await page.waitForTimeout(1500);
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
  out.pauseRings = document.querySelectorAll('#pause-stats .ring').length >= 3;
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
check('pause screen shows circular stat gauges', fx.pauseRings);

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

  // ...and wave 2 is the ONLY exemption: every other wave is still gated, so
  //    the guarantee is a scripted introduction and not an open door.
  let otherWaveHits = 0;
  for (const w of [1, 3, 4, 5, 12, 30]) {
    for (let i = 0; i < 50; i++) {
      g.citizens.reset();
      if (g.citizens._maybeSpawn(w)) otherWaveHits++;
    }
  }
  out.otherWavesStillGated = otherWaveHits === 0;

  // ...driven through the real 'wave:start' event the wave director emits, so
  //    the wiring is covered and not just the method.
  g.citizens.reset();
  g.events.emit('wave:start', { wave: 1, size: 11 });
  const afterWave1 = g.citizens.citizen;
  g.events.emit('wave:start', { wave: 2, size: 14 });
  out.waveTwoViaEvent = afterWave1 === null && !!g.citizens.citizen;
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
check('every other wave stays behind the kill gate', cit.otherWavesStillGated);
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
  g.waves.wave = 20; // fixed so only the kills-driven terms move
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

check('no console errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
