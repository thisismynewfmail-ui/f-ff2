/**
 * World-integrity audit. Serves the repo, boots the real game in headless
 * Chromium and interrogates the built town for the structural mistakes that
 * are invisible in a code review and obvious the moment you walk into them:
 *
 *   1. buildings meet the ground (no footing hanging over a slope, no
 *      building sunk into one)
 *   2. no two building footprints overlap
 *   3. nothing is parked in a doorway — every door has a clear approach
 *   4. no two neighbouring buildings share a wall texture, and the town uses
 *      the full material-set library
 *   5. weathering really is spatial: the core is kept up, the rim is not
 *   6. every enterable building is furnished, and interiors carry loot
 *   7. the alley network is walkable end to end
 *   8. spawn points are on open ground inside the map, and every zone has
 *      enough of them to feed a wave
 *   9. the world barrier rings the map with no gap, and the player cannot
 *      walk out through it
 *  10. nothing solid stands inside a building or inside another vehicle
 *  11. a locked district cannot be reached on foot — a flood fill from the
 *      spawn over the nav grid must not get into one
 *  12. the pond sits in its basin: never floating over the ground, never
 *      flooding a building, and actually moving
 *
 * Usage: node tests/world.mjs
 * Requires playwright-core (any location via NODE_PATH) and the pre-installed
 * Chromium in PLAYWRIGHT_BROWSERS_PATH.
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

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:8141/index.html?test=1');
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 40000 });
check('boot without console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const r = await page.evaluate(async () => {
  const w = window.__game.world;
  const specs = w.buildingSpecs;
  const out = {};

  // --- 1. every building meets the ground ---------------------------------
  // Sample the terrain at each footprint corner and mid-edge: the pad should
  // hold the ground within the footing's visible height everywhere the
  // building touches it.
  const PLINTH_TOP = 0.42, PLINTH_DEEP = 1.1;
  out.floating = [];
  out.sunken = [];
  for (const s of specs) {
    const hx = s.w / 2, hz = s.d / 2;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const g = w.terrain.heightAt(s.x + ox * hx, s.z + oz * hz);
      if (g < s.y - PLINTH_DEEP + 0.05) out.floating.push(`${s.name} ${(s.y - g).toFixed(2)}m`);
      else if (g > s.y + PLINTH_TOP + 0.6) out.sunken.push(`${s.name} ${(g - s.y).toFixed(2)}m`);
    }
  }
  out.floating = [...new Set(out.floating)];
  out.sunken = [...new Set(out.sunken)];

  // --- 2. footprints do not overlap ---------------------------------------
  out.overlaps = [];
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const a = specs[i], b = specs[j];
      const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
      const oz = (a.d + b.d) / 2 - Math.abs(a.z - b.z);
      if (ox > 0.05 && oz > 0.05) out.overlaps.push(`${a.name}/${b.name}`);
    }
  }

  // --- 3. doorways are clear ----------------------------------------------
  // A prop or another building standing in the approach fan is the exact
  // fault the market stalls used to have in Old Town Square.
  // "Can the player stand here?" is exactly what resolveCapsule answers: if
  // it shoves the probe sideways, something is occupying the spot.
  const standable = (x, y, z, r = 0.4) => {
    const p = { x, y, z };
    w.collision.resolveCapsule(p, r, 1.7);
    return Math.hypot(p.x - x, p.z - z) < 0.02;
  };
  const SIDE = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  out.blockedDoors = [];
  for (const s of specs) {
    if (!s.door || s.solid) continue;
    const [nx, nz] = SIDE[s.door];
    const dx = s.x + nx * (s.w / 2), dz = s.z + nz * (s.d / 2);
    for (let t = 1.0; t <= 3.0; t += 0.5) {
      if (!standable(dx + nx * t, s.y + 0.1, dz + nz * t)) {
        out.blockedDoors.push(`${s.name}@${t.toFixed(1)}m`);
        break;
      }
    }
  }

  // --- 4/5. materials + weathering ----------------------------------------
  let adjacentSame = 0;
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const a = specs[i], b = specs[j];
      const gap = Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
      if (gap < 6 && a.wall === b.wall) adjacentSame++;
    }
  }
  out.adjacentSame = adjacentSame;
  out.wallTextures = new Set(specs.map((s) => s.wall)).size;
  out.roofTextures = new Set(specs.map((s) => s.roofTex)).size;
  out.doorTextures = new Set(specs.filter((s) => s.door).map((s) => s.doorTex)).size;
  out.foundationTextures = new Set(specs.map((s) => s.foundationTex)).size;
  out.trimTextures = new Set(specs.map((s) => s.trimTex)).size;
  out.matSets = new Set(specs.map((s) => s.mat)).size;
  const avg = (pred, key) => {
    const l = specs.filter(pred);
    return l.reduce((a, x) => a + x[key], 0) / (l.length || 1);
  };
  out.coreWeather = avg((s) => Math.hypot(s.x, s.z) < 60, 'weather');
  out.rimWeather = avg((s) => Math.hypot(s.x, s.z) > 180, 'weather');

  // --- 6. interiors --------------------------------------------------------
  out.enterable = specs.filter((s) => !s.solid).length;
  out.furnished = w.interiors.populated.length;
  out.loot = w.lootPoints.length;
  out.interactables = w.interactables.length;

  // --- 7. the alley network is walkable ------------------------------------
  // Walk the nav grid down each alley slot and along the service lane; every
  // sample has to be an open cell or the flanking route is decorative.
  const nav = w.nav;
  const open = (x, z) => !nav.isBlocked(nav.toCell(x), nav.toCell(z));
  out.alleyBlocked = [];
  for (const ax of [-85.25, -70.75, -34.25, -19.75]) {
    for (let z = -116; z <= -103.3; z += 1.5) if (!open(ax, z)) out.alleyBlocked.push(`slot ${ax}@${z.toFixed(0)}`);
  }
  // x = -45 carries the Hollow Park border wall, which is meant to be there
  // until the district unlocks; the lane runs in two halves either side of it.
  for (let x = -94; x <= -20; x += 2) {
    if (x > -50 && x < -42) continue;   // the wall rounds out to a 2 m nav cell either side
    if (!open(x, -103.3)) out.alleyBlocked.push(`lane@${x}`);
  }

  // --- 8. spawn points -----------------------------------------------------
  const pts = w.spawnPoints;
  out.spawns = pts.length;
  out.spawnsOutside = pts.filter((p) => Math.abs(p.x) > 246 || Math.abs(p.z) > 246).length;
  out.spawnsBlocked = pts.filter((p) => !p.indoor && !open(p.x, p.z)).length;
  out.spawnsPerZone = [0, 1, 2, 3, 4, 5].map((z) => pts.filter((p) => p.zone === z).length);
  out.playerSpawnOpen = open(w.playerSpawn.x, w.playerSpawn.z);

  // --- 9. the world barrier ------------------------------------------------
  // Walk the wall line itself and fire a short ray straight through it at head
  // height at every sample. Radial rays from the origin would miss the wall
  // entirely near the diagonals, so this probes perpendicular to each run.
  const B = 251;
  out.barrierGaps = [];
  out.barrierSamples = 0;
  const probe = (x, z, nx, nz) => {
    out.barrierSamples++;
    const y = w.terrain.heightAt(x, z) + 1.6;
    if (!w.collision.segmentBlocked(x - nx * 6, y, z - nz * 6, x + nx * 8, y, z + nz * 8)) {
      out.barrierGaps.push(`${x.toFixed(0)},${z.toFixed(0)}`);
    }
  };
  for (let t = -B + 6; t <= B - 6; t += 4) {
    probe(t, -B, 0, -1);
    probe(t, B, 0, 1);
    probe(-B, t, -1, 0);
    probe(B, t, 1, 0);
  }
  for (const [cx, cz] of [[-B, -B], [B, -B], [B, B], [-B, B]]) {   // the bastions
    for (let a = 0; a < 360; a += 20) {
      const th = (a * Math.PI) / 180;
      probe(cx + Math.cos(th) * 6.5, cz + Math.sin(th) * 6.5, Math.cos(th), Math.sin(th));
    }
  }
  out.barrierExists = !!w.barrier;
  out.doorwayRejects = w.doorwayRejects.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)} ${p.why}`);

  // --- 10. nothing solid stands inside a building, or inside another vehicle
  // Placement refuses these (see World._overlapsSolid), but check the built
  // world too: a prop registered by some other path would slip past that.
  const props = w.collision.boxes.filter((b) => b.active && b.tag === 'prop');
  out.propInBuilding = [];
  for (const s of specs) {
    for (const b of props) {
      const ox = Math.min(b.maxX, s.x + s.w / 2) - Math.max(b.minX, s.x - s.w / 2);
      const oz = Math.min(b.maxZ, s.z + s.d / 2) - Math.max(b.minZ, s.z - s.d / 2);
      if (ox > 0.3 && oz > 0.3 && b.minY < s.y + s.h) {
        out.propInBuilding.push(`${s.name}<-${((b.minX + b.maxX) / 2).toFixed(0)},${((b.minZ + b.maxZ) / 2).toFixed(0)}`);
      }
    }
  }
  const big = props.filter((b) => (b.maxX - b.minX) > 2.4 || (b.maxZ - b.minZ) > 2.4);
  out.propOverlap = [];
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = big[i], c = big[j];
      const ox = Math.min(a.maxX, c.maxX) - Math.max(a.minX, c.minX);
      const oz = Math.min(a.maxZ, c.maxZ) - Math.max(a.minZ, c.minZ);
      if (ox > 0.2 && oz > 0.2) out.propOverlap.push(`${((a.minX + a.maxX) / 2).toFixed(0)},${((a.minZ + a.maxZ) / 2).toFixed(0)}`);
    }
  }

  // --- 11. a locked district is genuinely unreachable
  // The real question is not "does each wall end where it should" but "can I
  // walk into a district I have not earned". Flood the nav grid from the
  // player's spawn with only Old Town open and see where it gets to. A wall
  // that stops eight metres short of the map edge shows up here as a whole
  // district turning reachable.
  const zones = (await import('/src/world/Zones.js')).ZONES;
  const SIZE = 320;
  const seen = new Uint8Array(SIZE * SIZE);
  const q = [[nav.toCell(w.playerSpawn.x), nav.toCell(w.playerSpawn.z)]];
  seen[q[0][1] * SIZE + q[0][0]] = 1;
  const inRect = (x, z, r, pad) => x >= r.minX + pad && x <= r.maxX - pad && z >= r.minZ + pad && z <= r.maxZ - pad;
  const trespass = new Set();
  while (q.length) {
    const [cx, cz] = q.pop();
    const wx = nav.toWorld(cx), wz = nav.toWorld(cz);
    // 4 m inside a locked rect and outside every open one = a real intrusion
    if (!inRect(wx, wz, zones[0].rect, -2)) {
      for (const zn of zones) {
        if (zn.id === 0 || w.zones.isUnlocked(zn.id)) continue;
        if (inRect(wx, wz, zn.rect, 4)) trespass.add(zn.name);
      }
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
      const k = nz * SIZE + nx;
      if (seen[k] || nav.isBlocked(nx, nz)) continue;
      seen[k] = 1;
      q.push([nx, nz]);
    }
  }
  out.trespass = [...trespass];

  // --- 12. the pond is a lake, not a sheet of glass laid over a hillside
  const pb = w.pondBasin;
  out.pond = { minDepth: 1e9, maxDepth: -1e9, verts: 0, overBuilding: 0, animated: w.waterSurfaces.length };
  const sheets = [];
  w.group.traverse((o) => {
    if (o.isMesh && w.waterSurfaces.some((s) => s.mat === o.material)) sheets.push(o);
  });
  for (const m of sheets) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const depth = p.getY(i) - w.terrain.heightAt(x, z);
      out.pond.minDepth = Math.min(out.pond.minDepth, depth);
      out.pond.maxDepth = Math.max(out.pond.maxDepth, depth);
      out.pond.verts++;
      if (specs.some((s) => Math.abs(x - s.x) < s.w / 2 && Math.abs(z - s.z) < s.d / 2)) out.pond.overBuilding++;
    }
  }
  out.pond.sheets = sheets.length;
  out.pond.level = pb.level;
  return out;
});

check('every building meets the ground', r.floating.length === 0, r.floating.slice(0, 4).join(', '));
check('no building is buried in the terrain', r.sunken.length === 0, r.sunken.slice(0, 4).join(', '));
check('no building footprints overlap', r.overlaps.length === 0, r.overlaps.slice(0, 4).join(', '));
check('every doorway has a clear approach', r.blockedDoors.length === 0, r.blockedDoors.slice(0, 5).join(', '));
check('no adjacent buildings share a wall texture', r.adjacentSame === 0, `${r.adjacentSame} clashes`);
check('walls draw from a wide texture set', r.wallTextures >= 14, `${r.wallTextures} distinct`);
check('roofs draw from a wide texture set', r.roofTextures >= 6, `${r.roofTextures} distinct`);
check('doors draw from a wide texture set', r.doorTextures >= 5, `${r.doorTextures} distinct`);
check('foundations are textured per material set', r.foundationTextures >= 3, `${r.foundationTextures} distinct`);
check('trim is textured per material set', r.trimTextures >= 4, `${r.trimTextures} distinct`);
check('the whole material-set library is in use', r.matSets >= 20, `${r.matSets} sets`);
check('town core is better maintained than the rim', r.rimWeather > r.coreWeather + 0.3,
  `core ${r.coreWeather.toFixed(2)} vs rim ${r.rimWeather.toFixed(2)}`);
check('every enterable building is furnished', r.furnished === r.enterable, `${r.furnished}/${r.enterable}`);
check('interiors carry loot', r.loot > 180, `${r.loot} loot points`);
check('the world offers things to interact with', r.interactables >= 3, `${r.interactables}`);
check('the alley network is walkable end to end', r.alleyBlocked.length === 0, r.alleyBlocked.slice(0, 5).join(', '));
check('spawn points stay inside the map', r.spawnsOutside === 0, `${r.spawnsOutside} outside`);
check('outdoor spawn points are on open ground', r.spawnsBlocked === 0, `${r.spawnsBlocked} blocked`);
check('every district can feed a wave', r.spawnsPerZone.every((n) => n >= 10), r.spawnsPerZone.join('/'));
check('the player spawns on open ground', r.playerSpawnOpen);
check('the world barrier exists', r.barrierExists);
check('no solid prop stands inside a building', r.propInBuilding.length === 0, r.propInBuilding.slice(0, 5).join(' '));
check('no two vehicles occupy the same ground', r.propOverlap.length === 0, r.propOverlap.slice(0, 5).join(' '));
check('locked districts are unreachable on foot', r.trespass.length === 0, r.trespass.join(', '));
check('the pond never floats above its bed', r.pond.minDepth >= -0.01,
  `lowest point ${r.pond.minDepth.toFixed(2)}m over the ground`);
check('the pond has real depth', r.pond.maxDepth > 0.8, `${r.pond.maxDepth.toFixed(2)}m at the deepest`);
check('the pond does not flood any building', r.pond.overBuilding === 0, `${r.pond.overBuilding} vertices`);
check('the water surface is animated', r.pond.animated >= 2 && r.pond.sheets >= 2,
  `${r.pond.sheets} sheets, ${r.pond.animated} drifting`);
check('the world barrier has no gaps', r.barrierGaps.length === 0,
  `${r.barrierGaps.length}/${r.barrierSamples} probes escaped at ${r.barrierGaps.slice(0, 4).join(' ')}`);
check('no prop had to be refused as badly placed', r.doorwayRejects.length === 0,
  r.doorwayRejects.join(' '));

// The barrier is a wall, not a suggestion: walk hard into it and stay inside.
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state.state === 'playing');
const escaped = await page.evaluate(() => {
  const g = window.__game;
  // Diagonals as well as the axes, so the corner bastions get probed too.
  const probes = [[0, -1], [0, 1], [-1, 0], [1, 0], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
  let worst = 0;
  for (const [dx, dz] of probes) {
    const p = { x: dx * 235, y: 0, z: dz * 235 };
    p.y = g.world.terrain.heightAt(p.x, p.z) + 0.1;
    for (let i = 0; i < 400; i++) {   // 100 m of shoving, resolved every step
      p.x += dx * 0.25;
      p.z += dz * 0.25;
      g.world.collision.resolveCapsule(p, 0.4, 1.7);
      g.world.clampToWorld(p);
      p.y = g.world.groundHeightFor(p.x, p.z, p.y) + 0.1;
    }
    // Per-axis, not radial: the map is a square, so the wall on each axis is
    // what has to hold, and a radial figure would flatter the corners.
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.z));
  }
  return worst;
});
check('the player cannot walk past the world edge', escaped <= 249.5, `reached ${escaped.toFixed(1)}m on an axis`);

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall world checks passed');
process.exit(failures ? 1 : 0);
