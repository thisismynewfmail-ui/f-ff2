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
 *  11b. every road, plaza and decal lies ON the ground, sampled inside its
 *      triangles rather than at its vertices
 *  12. no facade band (plinth, water table, belt course) juts into a room or
 *      z-fights the inside of the wall it wraps
 *  13. the pond sits in its basin: never floating over the ground, no dry
 *      bank below the waterline, never flooding a building, and moving
 *  14. Eastgate is a neighbourhood: every front door opens onto a street, no
 *      building stands in a carriageway, and the district has enough moving
 *      parts (swaying planting, wind-bent ground cover, turning props) to
 *      read as a place rather than a diorama
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
  const PLINTH_TOP = 0.26, PLINTH_DEEP = 1.1;   // see Buildings.js
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

  // --- 11b. everything draped on the ground actually lies on it
  //
  // Roads, plazas and decals are built from waypoints and rectangles, and the
  // waypoints are forty to sixty metres apart — so the vertices sit on the
  // terrain while the middle of every long span does whatever it likes. That
  // is what put roads four metres in the air over the ravine and buried them
  // a metre deep through the rises. Vertex checks pass on all of it, so
  // sample INSIDE each triangle: centroid and edge midpoints, interpolated on
  // the mesh, compared with the ground that is actually rendered.
  out.drape = { worstUp: -99, worstDown: 99, upAt: '', downAt: '', tris: 0, meshes: (w.groundMeshes || []).length };
  for (const gm of w.groundMeshes || []) {
    const g = gm.mesh.geometry, p = g.attributes.position, ix = g.index;
    const n = ix ? ix.count : p.count;
    const at = gm.mesh.position;
    for (let i = 0; i < n; i += 3) {
      const k = [0, 1, 2].map((o) => (ix ? ix.getX(i + o) : i + o));
      const V = k.map((q) => [p.getX(q) + at.x, p.getY(q) + at.y, p.getZ(q) + at.z]);
      out.drape.tris++;
      for (const bc of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
        let sx = 0, sy = 0, sz = 0;
        for (let c = 0; c < 3; c++) { sx += V[c][0] * bc[c]; sy += V[c][1] * bc[c]; sz += V[c][2] * bc[c]; }
        const gap = sy - w.terrain.meshHeightAt(sx, sz);
        if (gap > out.drape.worstUp) { out.drape.worstUp = gap; out.drape.upAt = `${gm.kind}@${sx.toFixed(0)},${sz.toFixed(0)}`; }
        if (gap < out.drape.worstDown) { out.drape.worstDown = gap; out.drape.downAt = `${gm.kind}@${sx.toFixed(0)},${sz.toFixed(0)}`; }
      }
    }
  }

  // --- 12a. no facade band shows through the inside of a wall
  //
  // The plinth and the trim courses wrap the OUTSIDE of a wall. Two ways they
  // go wrong, and both were happening: a band whose inner face sits in front
  // of the wall's inner face juts into the room as a kerb, and a band whose
  // inner face is exactly coplanar with it z-fights and paints the bottom of
  // the interior wall in foundation concrete.
  //
  // Vertex tests cannot see either, because the offending surface is in the
  // middle of a box's face rather than at its corners. So ask the question the
  // player asks: standing in the room and looking at a wall, is the first
  // thing you meet the wall — or its footing?
  const THREE = await import('/lib/three.module.js');
  const ray = new THREE.Raycaster();
  out.innerKerb = [];
  for (const s of specs) {
    if (s.solid) continue;
    const built = w.built.get(s.name);
    if (!built) continue;
    const bands = [w.kit.mat(s.foundationTex), w.kit.mat(s.trimTex)];
    for (const [ox, oz] of [[0, 0], [-s.w / 4, 0], [s.w / 4, 0], [0, -s.d / 4], [0, s.d / 4]]) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ray.set(new THREE.Vector3(s.x + ox, s.y + 0.3, s.z + oz), new THREE.Vector3(dx, 0, dz));
        ray.far = 60;
        const hits = ray.intersectObject(built.group, true);
        if (!hits.length) continue;
        // coplanar surfaces come back in arbitrary order, so treat anything
        // within a few centimetres of the first hit as "what you see"
        const near = hits.filter((h) => h.distance <= hits[0].distance + 0.03);
        if (near.some((h) => bands.includes(h.object.material))) {
          out.innerKerb.push(`${s.name} ${dx ? 'x' : 'z'}${dx + dz > 0 ? '+' : '-'}`);
        }
      }
    }
  }
  out.innerKerb = [...new Set(out.innerKerb)];

  // --- 14. Eastgate reads as a neighbourhood -------------------------------
  //
  // The district used to place its houses on a coordinate list and its doors
  // on whatever side the list said, which left a third of them opening onto
  // open grass. A door is a claim about where the street is, so check the
  // claim: walk out from each threshold along its own normal and see whether
  // a carriageway is actually there. (Outbuildings — sheds, the glasshouse —
  // front their own gardens and are exempt; garages open onto the back lane
  // and are not.)
  const FRONTED = new Set(['house', 'store', 'gasShop', 'hall', 'church', 'hollow', 'garage']);
  out.doorsOntoNothing = [];
  for (const s of specs) {
    if (s.zone !== 1 || s.solid || !s.door || !FRONTED.has(s.use)) continue;
    const [nx, nz] = SIDE[s.door];
    const dx = s.x + nx * (s.w / 2), dz = s.z + nz * (s.d / 2);
    let found = false;
    for (let t = 1; t <= 16 && !found; t += 0.5) {
      if (w.surfaceAt(dx + nx * t, dz + nz * t) === 'road') found = true;
    }
    if (!found) out.doorsOntoNothing.push(s.name);
  }
  // ...and no Eastgate building is standing in one. Sampled off the rendered
  // carriageway itself rather than a bounding box, because the bounding box of
  // a curving road is far fatter than the road.
  out.inCarriageway = [];
  for (const gm of w.groundMeshes || []) {
    if (gm.kind !== 'road:road' && gm.kind !== 'road:roadLine') continue;
    const p = gm.mesh.geometry.attributes.position, at = gm.mesh.position;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i) + at.x, z = p.getZ(i) + at.z;
      for (const s of specs) {
        if (s.zone !== 1) continue;
        if (Math.abs(x - s.x) < s.w / 2 - 0.2 && Math.abs(z - s.z) < s.d / 2 - 0.2) {
          out.inCarriageway.push(`${s.name}@${x.toFixed(0)},${z.toFixed(0)}`);
        }
      }
    }
  }
  out.inCarriageway = [...new Set(out.inCarriageway)];
  // --- interior furniture does not interpenetrate ---------------------------
  // Layouts are written in canonical coordinates and rotated per door side, so
  // two pieces that look well apart in the source can end up inside each other
  // once a narrower footprint or a mirrored variant reshapes the frame. Cheap
  // to check, invisible in review, and immediately obvious in game.
  const furn = w.collision.boxes.filter((b) => b.active && b.tag === 'furniture');
  out.furnClash = [];
  for (let i = 0; i < furn.length; i++) {
    for (let j = i + 1; j < furn.length; j++) {
      const a = furn[i], c = furn[j];
      const ox = Math.min(a.maxX, c.maxX) - Math.max(a.minX, c.minX);
      const oy = Math.min(a.maxY, c.maxY) - Math.max(a.minY, c.minY);
      const oz = Math.min(a.maxZ, c.maxZ) - Math.max(a.minZ, c.minZ);
      if (ox > 0.12 && oy > 0.12 && oz > 0.12) {
        const host = specs.find((sp) => Math.abs((a.minX + a.maxX) / 2 - sp.x) < sp.w / 2
          && Math.abs((a.minZ + a.maxZ) / 2 - sp.z) < sp.d / 2);
        out.furnClash.push(`${host ? host.name : '?'}@${((a.minX + a.maxX) / 2).toFixed(0)},${((a.minZ + a.maxZ) / 2).toFixed(0)}`);
      }
    }
  }
  out.furnClash = [...new Set(out.furnClash)];
  out.furnRejects = w.interiors.rejects;

  // Eastgate Green is a promise the district makes: open ground with clear
  // sight lines, which is worth exactly nothing if a later pass plants a tree
  // in the middle of it. Assert it against the declared circle rather than
  // against a coordinate somebody remembers being empty.
  const { EASTGATE_GREEN: GREEN } = await import('/src/world/World.js');
  out.greenIntruders = [];
  for (const s of specs) {
    if (Math.hypot(s.x - GREEN.x, s.z - GREEN.z) < GREEN.r - Math.max(s.w, s.d) / 2) {
      out.greenIntruders.push(s.name);
    }
  }
  for (const b of w.collision.boxes) {
    if (!b.active || (b.tag !== 'tree' && b.tag !== 'fence' && b.tag !== 'prop')) continue;
    const bx = (b.minX + b.maxX) / 2, bz = (b.minZ + b.maxZ) / 2;
    if (Math.hypot(bx - GREEN.x, bz - GREEN.z) < GREEN.r - 2) {
      out.greenIntruders.push(`${b.tag}@${bx.toFixed(0)},${bz.toFixed(0)}`);
    }
  }
  out.greenIntruders = [...new Set(out.greenIntruders)];

  out.eastgateBuildings = specs.filter((s) => s.zone === 1).length;
  out.eastgateFurnished = specs.filter((s) => s.zone === 1 && !s.solid && s.use).length;
  out.eastgatePorches = specs.filter((s) => s.zone === 1 && s.porch).length;
  out.roofKinds = new Set(specs.filter((s) => s.zone === 1).map((s) => s.roof)).size;

  // Everything that moves. Vegetation sways object by object; merged ground
  // cover bends in the vertex shader off one shared clock, so the presence of
  // the `aSway` attribute is what proves the grass is animated at all.
  out.swayers = w.veg.swayers.length;
  out.animProps = (w.animProps || []).length;
  out.windFields = 0;
  w.group.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.aSway) out.windFields++; });

  // The ground is four grasses blended per fragment, so "is the grass right"
  // is three separate questions: are all four actually bound, does the mix
  // really differ between districts (or is it one lawn with extra samplers),
  // and does it CHANGE gradually — a splat map that steps from one weight to
  // another between neighbouring vertices draws a visible line across a field,
  // which is the exact failure the blend exists to avoid.
  {
    const t = w.terrain.mesh;
    const g = t.geometry.attributes.aGrass;
    out.grass = {
      maps: ['grass', 'grassDry', 'grassLush', 'grassWild'].filter((n) => {
        try { return !!w.texLib.get(n); } catch { return false; }
      }).length,
      splat: !!g && !!t.geometry.attributes.aTint,
      cacheKey: typeof t.material.customProgramCacheKey === 'function',
    };
    // no vertex may ask for more grass than exists
    let over = 0, tintLo = 9, tintHi = -9;
    const tint = t.geometry.attributes.aTint;
    for (let i = 0; i < g.count; i++) {
      if (g.getX(i) + g.getY(i) + g.getZ(i) > 1.0001) over++;
      tintLo = Math.min(tintLo, tint.getX(i));
      tintHi = Math.max(tintHi, tint.getX(i));
    }
    out.grass.over = over;
    out.grass.tintRange = +(tintHi - tintLo).toFixed(3);
    // districts must actually differ from each other
    const mix = (x, z) => { const p = w._grassAt(x, z); return [p.dry, p.lush, p.wild]; };
    const d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const town = mix(0, 20), park = mix(-170, 60), ind = mix(-60, 165), ridge = mix(-200, -180);
    out.grass.spread = +Math.min(d(town, park), d(town, ind), d(park, ind), d(ind, ridge)).toFixed(3);
    // and the change between neighbouring lattice cells must be gradual
    let jump = 0;
    const n = 201;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n;
        for (const o of [b, c]) {
          jump = Math.max(jump,
            Math.abs(g.getX(a) - g.getX(o)) + Math.abs(g.getY(a) - g.getY(o)) + Math.abs(g.getZ(a) - g.getZ(o)));
        }
      }
    }
    out.grass.jump = +jump.toFixed(3);
    // standing cover has to follow the ground it stands on
    const kinds = new Set();
    w.group.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.aSway) {
        for (const [k, m] of Object.entries(w.veg.tuftMats)) if (m === o.material) kinds.add(k);
      }
    });
    out.grass.tuftKinds = [...kinds].sort();
  }

  // Surfaces that move without a moving part behind them: the TV static
  // flipbook, the arcade and vending tubes, the campfire. Counting the
  // registry only proves it was declared, so sample every entry's actual
  // state, run the animator, and require each one to have changed — a kind
  // that silently stops matching (a renamed field, a texture that lost its
  // map) shows up here rather than as a screen nobody notices is frozen.
  const mats = w.matAnims || [];
  out.matAnims = mats.length;
  out.matKinds = [...new Set(mats.map((m) => m.kind))].sort();
  const sampleMat = (m) => (m.kind === 'flip'
    ? `${m.map.offset.x},${m.map.offset.y},${m.map.repeat.x}`
    : m.kind === 'ember'
      ? m.nodes.map((n) => n.scale.y.toFixed(4)).join(',') + '|' + (m.light?.intensity ?? 0).toFixed(3)
      : m.mat.color.getHexString());
  // Drive the animator itself rather than waiting on frames: the camera is at
  // the spawn and some of these are culled by distance from it, so stand the
  // probe on each entry in turn. Collect the whole run, not just its ends — a
  // tube on a slow blink can finish a sweep on the colour it started with.
  const seenStates = mats.map(() => new Set());
  for (let i = 0; i < 60; i++) {
    for (const m of mats) {
      w.anomalies.update(0.05, i * 0.05, { x: m.x ?? 0, y: 0, z: m.z ?? 0 });
    }
    mats.forEach((m, k) => seenStates[k].add(sampleMat(m)));
  }
  out.matFrozen = mats
    .map((m, i) => (seenStates[i].size < 2 ? `${m.kind}#${i}` : null))
    .filter(Boolean);

  // The phone booth has a voice but it also has to have a face: while it rings
  // the roof lamp comes up and the handset shakes, and both die the moment it
  // stops. Drive the ring state directly — waiting out the real 25 s cycle in
  // a world test would be waiting on a timer, not testing anything.
  {
    const an = w.anomalies, parts = w.phoneBoothParts, p = window.__game.player;
    const home = { x: p.position.x, y: p.position.y, z: p.position.z };
    const b = w.phoneBoothPos;
    const sample = () => `${parts.lampMat.color.getHexString()}|${parts.hook.rotation.z.toFixed(4)}`;
    // It only rings for somebody who is there to hear it, so stand the player
    // at the booth — from across town the ring cycle correctly gives up.
    p.teleport(b.x + 3, w.groundHeightFor(b.x + 3, b.z, 1e9), b.z);
    an._phone.ringing = false;
    an.update(0.05, 1, { x: b.x, y: 0, z: b.z });
    const quiet = sample();
    let ringing = quiet;
    for (let i = 0; i < 30 && ringing === quiet; i++) {
      an._phone.ringing = true;
      an._phone.ringFor = 9;
      an.update(0.05, 1 + i * 0.05, { x: b.x, y: 0, z: b.z });
      ringing = sample();
    }
    an._phone.ringing = false;
    an._phone.timer = 25;
    p.teleport(home.x, home.y, home.z);
    out.boothRings = ringing !== quiet;
    out.boothStates = `${quiet} -> ${ringing}`;
  }

  // The scarecrow's easter-egg chain spans two places, so both ends have to
  // survive a world rebuild: the bearing it holds must land on open ground with
  // the wreck actually on it, the blaster must be reachable there, and the two
  // things you can shoot off the figure itself must be registered.
  const sc = w.scarecrow;
  const near = (x, z, r) => w.shootables.filter((s) => Math.hypot(s.x - x, s.z - z) < r);
  const crashClear = !w._nearBuilding(sc.crash.x, sc.crash.z, 8);
  const pickup = w.interactables.some((it) =>
    Math.hypot(it.x - sc.crash.x, it.z - sc.crash.z) < 6);
  const onIt = near(sc.pos.x, sc.pos.z, 1.2);
  out.scarecrow = {
    crash: `${sc.crash.x},${sc.crash.z} clear=${crashClear}`,
    pickup, shootables: onIt.length,
    chain: crashClear && pickup && onIt.length >= 2 && !!sc._crashGlow && sc._shards.length >= 3,
  };

  // The hat is a full state machine — shot off, thrown, landed, and back on
  // its head once you are too far away to catch it happening — and every step
  // of it is invisible unless somebody walks the whole loop. Walk it here.
  {
    const hatTarget = onIt.find((s) => s.y > sc.pos.y + 2.2);
    const tick = (n, dx) => {
      for (let i = 0; i < n; i++) sc.update(0.05, i * 0.05, { x: sc.pos.x + dx, y: 0, z: sc.pos.z });
    };
    const startY = sc._hat.position.y;
    hatTarget?.onHit();
    out.hatCameOff = sc._hatOn === false && !!sc._hatFall;
    tick(80, 5);                                   // it falls, it lands
    out.hatLanded = !sc._hatFall && !!sc._hatGround
      && sc._hatGround.position.y < sc.pos.y + 1;
    tick(4, 200);                                  // and you walk away
    out.hatWentBack = sc._hatOn === true && !sc._hatGround
      && Math.abs(sc._hat.position.y - startY) < 1e-6 && hatTarget.active;
    // put the whole thing back the way it was found
    sc._hatBackNotice = false;
    sc._headSnap = false;
    sc._forceLook = 0;
  }

  // And the chain itself, end to end: three touches makes it stop looking at
  // you and hold a bearing, the bearing is the wreck's, and the thing at the
  // far end of it is a weapon you did not have. If any link of that breaks the
  // blaster becomes unobtainable without a console command and nobody notices.
  {
    const p = window.__game.player;
    const home = { x: p.position.x, y: p.position.y, z: p.position.z };
    p.teleport(sc.pos.x + 2, w.groundHeightFor(sc.pos.x + 2, sc.pos.z, 1e9), sc.pos.z);
    for (let i = 0; i < 3; i++) sc._interact();
    out.pointing = sc._pointing;
    for (let i = 0; i < 200; i++) sc.update(0.05, i * 0.05, { x: p.position.x, y: 0, z: p.position.z });
    const want = Math.atan2(sc.crash.x - sc.pos.x, sc.crash.z - sc.pos.z) - sc.bodyYaw;
    const err = Math.abs(((sc._headYaw - want + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    out.bearingErr = +err.toFixed(3);
    const take = w.interactables.find((it) => Math.hypot(it.x - sc.crash.x, it.z - sc.crash.z) < 6);
    take.onInteract();
    out.blasterUnlocked = window.__game.weapons.unlocked.has('blaster');
    out.blasterCounted = window.__game.world.secrets.found.has('alienBlaster');
    p.teleport(home.x, home.y, home.z);
  }

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
      const depth = p.getY(i) - w.terrain.meshHeightAt(x, z);
      out.pond.minDepth = Math.min(out.pond.minDepth, depth);
      out.pond.maxDepth = Math.max(out.pond.maxDepth, depth);
      out.pond.verts++;
      if (specs.some((s) => Math.abs(x - s.x) < s.w / 2 && Math.abs(z - s.z) < s.d / 2)) out.pond.overBuilding++;
    }
  }
  out.pond.sheets = sheets.length;
  out.pond.level = pb.level;
  // The artefact the eye actually picks up is DRY ground lying below the water
  // surface: it makes the lake look like it is standing on a plinth. Walk out
  // past the shoreline on many bearings and take the worst case.
  out.pond.dryBelow = -99;
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const sr = w._shoreRadius(a);
    for (let rr = sr; rr <= sr + 12; rr += 0.4) {
      const x = pb.x + Math.cos(a) * rr, z = pb.z + Math.sin(a) * rr;
      out.pond.dryBelow = Math.max(out.pond.dryBelow, pb.level - w.terrain.meshHeightAt(x, z));
    }
  }
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
check('ground surfaces cover enough of the town', r.drape.meshes >= 60 && r.drape.tris > 5000,
  `${r.drape.meshes} meshes, ${r.drape.tris} triangles`);
check('no road or plaza floats over the ground', r.drape.worstUp <= 0.35,
  `${r.drape.worstUp.toFixed(2)}m at ${r.drape.upAt}`);
check('no road or plaza cuts into the ground', r.drape.worstDown >= -0.15,
  `${r.drape.worstDown.toFixed(2)}m at ${r.drape.downAt}`);
check('no facade band shows through an interior wall', r.innerKerb.length === 0, r.innerKerb.slice(0, 5).join(', '));
check('no dry ground sits below the waterline', r.pond.dryBelow <= 0.05,
  `${r.pond.dryBelow.toFixed(2)}m of bank under the surface`);
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
check('every Eastgate front door opens onto a street', r.doorsOntoNothing.length === 0,
  r.doorsOntoNothing.slice(0, 6).join(', '));
check('no Eastgate building stands in a carriageway', r.inCarriageway.length === 0,
  r.inCarriageway.slice(0, 5).join(', '));
check('Eastgate is built out as a neighbourhood', r.eastgateBuildings >= 40 && r.eastgateFurnished >= 35,
  `${r.eastgateBuildings} buildings, ${r.eastgateFurnished} enterable`);
check('no two pieces of furniture occupy the same space', r.furnClash.length === 0,
  `${r.furnClash.length} clashes: ` + r.furnClash.slice(0, 8).join(', '));
// The guard above can only hold by refusing pieces, so watch what it refuses:
// a layout change that starts gutting rooms shows up here long before anyone
// walks into an empty one.
check('few interior pieces are refused for want of room', r.furnRejects.length <= 20,
  `${r.furnRejects.length} refused: ` + r.furnRejects.slice(0, 5).join(' | '));
check('Eastgate Green is genuinely clear ground', r.greenIntruders.length === 0,
  r.greenIntruders.slice(0, 5).join(', '));
check('Eastgate roofs and porches vary', r.roofKinds >= 3 && r.eastgatePorches >= 10,
  `${r.roofKinds} roof kinds, ${r.eastgatePorches} porches`);
check('planting is animated across the town', r.swayers >= 400 && r.windFields >= 20,
  `${r.swayers} swayers, ${r.windFields} wind-bent ground-cover fields`);
check('the district has moving props', r.animProps >= 15, `${r.animProps} animated`);
check('the ground carries all four grasses', r.grass.maps === 4 && r.grass.splat && r.grass.cacheKey,
  `${r.grass.maps} textures, splat ${r.grass.splat}, own program ${r.grass.cacheKey}`);
check('no patch of ground asks for more grass than there is', r.grass.over === 0,
  `${r.grass.over} vertices over weight`);
check('districts really do grow different grass', r.grass.spread > 0.3,
  `closest pair of districts differs by ${r.grass.spread}`);
check('the grass changes gradually, never on a line', r.grass.jump < 0.16,
  `worst neighbouring step ${r.grass.jump}`);
check('the ground tone varies over the map', r.grass.tintRange > 0.12,
  `tint spans ${r.grass.tintRange}`);
check('standing cover matches the ground it stands on', r.grass.tuftKinds.length >= 2,
  `tuft kinds in use: ${r.grass.tuftKinds.join(', ')}`);
check('screens, tubes and the fire animate in place', r.matAnims >= 4 && r.matKinds.length >= 3,
  `${r.matAnims} animated surfaces: ${r.matKinds.join(', ')}`);
check('no animated surface is stuck', r.matFrozen.length === 0,
  `frozen: ${r.matFrozen.join(', ')}`);
check('the phone booth lights up while it rings', r.boothRings, r.boothStates);
check('the scarecrow points somewhere real', r.scarecrow.chain,
  `crash ${r.scarecrow.crash} — blaster pickup ${r.scarecrow.pickup}, ${r.scarecrow.shootables} shootable parts`);
check('its hat comes off, lands, and finds its way back',
  r.hatCameOff && r.hatLanded && r.hatWentBack,
  `off ${r.hatCameOff}, landed ${r.hatLanded}, back on ${r.hatWentBack}`);
check('three touches make it point at the wreck', r.pointing && r.bearingErr < 0.1,
  `pointing ${r.pointing}, bearing off by ${r.bearingErr} rad`);
check('and the wreck hands over a weapon you could not otherwise have',
  r.blasterUnlocked && r.blasterCounted,
  `unlocked ${r.blasterUnlocked}, counted as a secret ${r.blasterCounted}`);

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
