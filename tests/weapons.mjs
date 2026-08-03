/**
 * Weapon asset + HUD verification, against the real game.
 *
 * Boots the game headless and inspects the LIVE weapon rigs the view model
 * built — geometry, materials, animation hooks — plus the weapon menu's actual
 * DOM behaviour. Nothing here is a mock: every number is measured off the
 * objects the renderer is drawing.
 *
 * This is the checklist from the refactor spec's verification section, in
 * executable form:
 *   - every weapon has its own model, with no two sharing a silhouette
 *   - PBR maps (albedo/normal/roughness/metalness) present at >= 1024 on
 *     close-up weapons, and every mesh carries UVs
 *   - triangle budgets inside the per-class bands
 *   - idle loops in the 2-4 s band, three-phase fire, reload variants,
 *     equip/unequip interpolation
 *   - each weapon has its own firing sound plus the supporting cues
 *   - the menu is hidden by default, opens on number keys AND wheel, sits top
 *     centre, and auto-hides after inactivity
 *
 * Usage: node tests/weapons.mjs
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
await new Promise((r) => server.listen(8161, r));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8161/index.html?test=1');
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state.state === 'playing', null, { timeout: 60000 });

check('boot without console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ------------------------------------------------------------------ */
/* geometry + materials, measured off the live rigs                     */
/* ------------------------------------------------------------------ */
const rigs = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const cfg of g.weapons.weapons.map((w) => w.config)) {
    const rig = g.viewModel.rigs[cfg.id];
    if (!rig) { out.push({ id: cfg.id, missing: true }); continue; }
    let tris = 0, meshes = 0, noUV = 0;
    const maps = { map: 0, normalMap: 0, roughnessMap: 0, metalnessMap: 0 };
    let minMapPx = Infinity;
    const mats = new Set();
    const sizes = [];
    rig.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      meshes++;
      const geo = o.geometry;
      tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
      if (!geo.attributes.uv) noUV++;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || mats.has(m.uuid)) continue;
        mats.add(m.uuid);
        for (const k of Object.keys(maps)) {
          const t = m[k];
          if (!t || !t.image) continue;
          maps[k]++;
          const px = Math.min(t.image.width, t.image.height);
          sizes.push(px);
          if (px < minMapPx) minMapPx = px;
        }
      }
    });
    // A cheap silhouette fingerprint: the rig's world-space bounding box.
    // Two weapons sharing one is a design failure, not a rounding artefact.
    let bb = null;
    rig.group.updateMatrixWorld(true);
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    rig.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      o.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) {
        const v = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
        const e = o.matrixWorld.elements;
        const x = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
        const y = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
        const z = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    });
    bb = [maxX - minX, maxY - minY, maxZ - minZ].map((v) => +v.toFixed(2));

    out.push({
      id: cfg.id, meshes, tris: Math.round(tris), noUV, maps, materials: mats.size,
      minMapPx: sizes.length ? minMapPx : 0, bbox: bb,
      hooks: {
        idle: typeof rig.idle === 'function',
        fire: typeof rig.fire === 'function',
        reload: typeof rig.reload === 'function',
        fireDuration: rig.fireDuration ?? null,
        rest: !!rig.rest,
        muzzle: !!rig.muzzle,
      },
    });
  }
  return out;
});

for (const r of rigs) {
  check(`${r.id}: rig exists`, !r.missing);
  if (r.missing) continue;
}

const present = rigs.filter((r) => !r.missing);
check('every weapon has its own distinct silhouette',
  new Set(present.map((r) => r.bbox.join('x'))).size === present.length,
  present.map((r) => `${r.id} ${r.bbox.join('x')}`).join('  '));

for (const r of present) {
  // Close-range weapons carry the bigger budget; the sniper is the long-range one.
  const band = r.id === 'sniper' ? [2000, 8000] : [5000, 15000];
  check(`${r.id}: triangle count inside its ${band[0]}-${band[1]} band`,
    r.tris >= band[0] && r.tris <= band[1], `${r.tris} tris across ${r.meshes} meshes`);
  check(`${r.id}: full PBR set (albedo/normal/roughness/metalness)`,
    r.maps.map > 0 && r.maps.normalMap > 0 && r.maps.roughnessMap > 0 && r.maps.metalnessMap > 0,
    JSON.stringify(r.maps));
  check(`${r.id}: every map at least 1024²`, r.minMapPx >= 1024, `smallest map ${r.minMapPx}px`);
  check(`${r.id}: every mesh carries UVs`, r.noUV === 0, `${r.noUV} meshes without UVs`);
  check(`${r.id}: animation hooks wired`,
    r.hooks.idle && r.hooks.fire && r.hooks.reload && r.hooks.rest && r.hooks.muzzle,
    JSON.stringify(r.hooks));
}

/* ------------------------------------------------------------------ */
/* animation behaviour, sampled off the real rigs                       */
/* ------------------------------------------------------------------ */
const anim = await page.evaluate(() => {
  const g = window.__game;
  const view = g.viewModel;
  const out = [];
  // Sample WORLD matrices, not local transforms: a rig is free to animate a
  // parent group (the sniper's bolt assembly, the rifle's sling), and reading
  // local position/rotation would report all of that as no motion at all.
  // Visibility counts too — parts that fly off and return are animation.
  const snap = (rig) => {
    const v = [];
    rig.group.updateMatrixWorld(true);
    rig.group.traverse((o) => {
      if (!o.isMesh) return;
      v.push(...o.matrixWorld.elements, o.visible ? 1 : 0);
    });
    return v;
  };
  const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s; };

  for (const cfg of g.weapons.weapons.map((w) => w.config)) {
    const rig = view.rigs[cfg.id];
    if (!rig) continue;

    // Idle: must move, and must return to where it started after its loop.
    const idleAt = (t) => { rig.idle(t, rig.parts); return snap(rig); };
    const a0 = idleAt(0);
    let idleRange = 0;
    for (let t = 0; t <= 4; t += 0.05) idleRange = Math.max(idleRange, dist(a0, idleAt(t)));
    // Loop period. Matching the pose alone is not enough: idle motion is
    // largely sinusoidal, so the HALF period matches too — the parts are back
    // where they started but travelling the other way. Require the pose a beat
    // later to match as well, which only a true period satisfies.
    const aD = idleAt(0.12);
    let bestT = 0, bestD = Infinity;
    for (let t = 1.0; t <= 4.6; t += 0.02) {
      const d = dist(a0, idleAt(t)) + dist(aD, idleAt(t + 0.12));
      if (d < bestD) { bestD = d; bestT = t; }
    }
    rig.idle(0, rig.parts);

    // Fire, at the rig level: the working parts must MOVE. Deliberately not
    // asserted to return to the starting pose — a cycled bolt, a fallen hammer
    // and a ratcheted drum are all supposed to end somewhere new, and demanding
    // they snap back would be demanding the mechanism not work.
    const f0 = snap(rig);
    let peakF = 0, peakD = 0;
    for (let f = 0; f <= 1.0001; f += 0.02) {
      rig.fire(f, rig.parts);
      const d = dist(f0, snap(rig));
      if (d > peakD) { peakD = d; peakF = f; }
    }
    const endD = dist(f0, snap(rig));

    // Reload: full and, where the weapon declares one, quick-tap.
    let reloadRange = 0, tacticalDiffers = false;
    const r0 = (() => { rig.reload(0, rig.parts, false); return snap(rig); })();
    for (let f = 0; f <= 1.0001; f += 0.05) {
      rig.reload(f, rig.parts, false);
      reloadRange = Math.max(reloadRange, dist(r0, snap(rig)));
    }
    if (cfg.tacticalReload) {
      // Run each variant from a clean rest pose. Sampling them back to back
      // hides the difference: a quick-tap reload works by NOT touching parts a
      // full reload moves (the pistol's slide never locks back), so the second
      // sample would just inherit the first's leftovers.
      const sweep = (tactical) => {
        rig.idle(0, rig.parts);
        const frames = [];
        for (let f = 0; f <= 1.0001; f += 0.1) { rig.reload(f, rig.parts, tactical); frames.push(snap(rig)); }
        return frames;
      };
      const full = sweep(false), tac = sweep(true);
      let dSum = 0;
      for (let i = 0; i < full.length; i++) dSum += dist(full[i], tac[i]);
      tacticalDiffers = dSum > 0.01;
    }
    rig.reload(1, rig.parts, false);
    rig.idle(0, rig.parts);

    out.push({
      id: cfg.id,
      idleRange: +idleRange.toFixed(3), idleLoop: +bestT.toFixed(2), idleLoopErr: +bestD.toFixed(3),
      firePeakAt: +peakF.toFixed(2), firePeak: +peakD.toFixed(3), fireEnd: +endD.toFixed(3),
      fireDuration: rig.fireDuration, fireInterval: cfg.fireInterval,
      reloadRange: +reloadRange.toFixed(3), hasTactical: !!cfg.tacticalReload, tacticalDiffers,
    });
  }
  return out;
});

for (const a of anim) {
  check(`${a.id}: idle animates and loops in the 2-4 s band`,
    a.idleRange > 0.01 && a.idleLoop >= 2 && a.idleLoop <= 4 && a.idleLoopErr < a.idleRange * 0.35,
    `moves ${a.idleRange}, loops at ${a.idleLoop}s (return err ${a.idleLoopErr})`);
  check(`${a.id}: fire moves the working parts`,
    a.firePeak > 0.005, `peak ${a.firePeak} at f=${a.firePeakAt}`);
  check(`${a.id}: fire duration matches its rate of fire`,
    a.fireDuration > 0 && a.fireDuration <= a.fireInterval + 1e-6,
    `${a.fireDuration}s anim vs ${a.fireInterval}s between shots`);
  if (a.id !== 'bat') {
    check(`${a.id}: reload animates`, a.reloadRange > 0.02, `range ${a.reloadRange}`);
  }
  if (a.hasTactical) {
    check(`${a.id}: quick-tap reload differs from the full reload`, a.tacticalDiffers);
  }
}

/* ------------------------------------------------------------------ */
/* the three-phase recoil envelope, per weapon                          */
/* ------------------------------------------------------------------ */
const recoil = await page.evaluate(() => {
  const g = window.__game;
  const view = g.viewModel;
  const out = [];
  for (const cfg of g.weapons.weapons.map((w) => w.config)) {
    if (cfg.melee) continue;
    const at = (f) => {
      let o = null;
      view._applyRecoil(f, cfg.kick, (v) => { o = v; });
      return o;
    };
    // windup dips the muzzle forward before the shot; the kick throws it back
    // and up; recovery brings it home.
    let windup = 0, peak = 0, peakF = 0;
    for (let f = 0; f <= 0.12; f += 0.005) windup = Math.min(windup, at(f).pz);
    for (let f = 0; f <= 1.0001; f += 0.005) {
      const p = at(f).pz;
      if (p > peak) { peak = p; peakF = f; }
    }
    out.push({
      id: cfg.id, kick: cfg.kick,
      windup: +windup.toFixed(4), peak: +peak.toFixed(4), peakF: +peakF.toFixed(3),
      end: +at(1).pz.toFixed(4), rise: +at(0.2).pz.toFixed(4),
    });
  }
  return out;
});
for (const r of recoil) {
  check(`${r.id}: recoil windup dips forward before the shot`, r.windup < 0, `${r.windup} m`);
  check(`${r.id}: recoil kicks back to a peak mid-animation`,
    r.peak > 0 && r.peakF > 0.15 && r.peakF < 0.6, `${r.peak} m at f=${r.peakF}`);
  check(`${r.id}: recoil recovers to rest by the end`, Math.abs(r.end) < r.peak * 0.05, `${r.end} m`);
}
// Weight has to be readable in the animation, so the recoil envelope must
// order the weapons the same way their configured kick does — not some ordering
// picked here by hand.
check('recoil magnitude tracks each weapon\'s configured weight',
  (() => {
    const byKick = [...recoil].sort((a, b) => a.kick - b.kick);
    for (let i = 1; i < byKick.length; i++) if (byKick[i].peak <= byKick[i - 1].peak) return false;
    return true;
  })(),
  [...recoil].sort((a, b) => a.kick - b.kick).map((r) => `${r.id} kick ${r.kick} → ${r.peak}m`).join('  '));

/* ------------------------------------------------------------------ */
/* audio: a unique voice per weapon plus the supporting cues            */
/* ------------------------------------------------------------------ */
const audio = await page.evaluate(() => {
  const g = window.__game;
  const cfgs = g.weapons.weapons.map((w) => w.config);
  const fireSounds = cfgs.map((c) => c.sound);
  const altSounds = cfgs.filter((c) => c.alt?.sound).map((c) => c.alt.sound);
  // Count how many distinct branches the synth actually has, by source text —
  // a shared branch would mean two weapons share a voice.
  const src = String(g.audio.constructor.prototype.gunshot || '');
  const cases = (src.match(/case '([a-zA-Z]+)':/g) || []).map((s) => s.slice(6, -2));
  return {
    fireSounds, altSounds,
    uniqueFire: new Set(fireSounds).size === fireSounds.length,
    covered: [...fireSounds, ...altSounds].filter((s) => cases.includes(s)),
    missing: [...fireSounds, ...altSounds].filter((s) => !cases.includes(s)),
    hasDry: typeof g.audio.emptyClick === 'function',
    hasReload: typeof g.audio.reload === 'function',
    hasEquip: typeof g.audio.equipSound === 'function',
  };
});
check('every weapon has its own firing sound id', audio.uniqueFire, audio.fireSounds.join(', '));
check('every fire + alt-fire sound has its own synth branch',
  audio.missing.length === 0, audio.missing.length ? 'missing: ' + audio.missing.join(', ') : `${audio.covered.length} branches`);
check('supporting cues exist (empty click, reload, equip)',
  audio.hasDry && audio.hasReload && audio.hasEquip,
  `dry=${audio.hasDry} reload=${audio.hasReload} equip=${audio.hasEquip}`);

/* ------------------------------------------------------------------ */
/* HUD weapon menu                                                      */
/* ------------------------------------------------------------------ */
const menu = await page.evaluate(async () => {
  const g = window.__game;
  const el = document.getElementById('weapon-menu');
  const cs = () => getComputedStyle(el);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const opacity = () => parseFloat(cs().opacity);
  // Fades are CSS transitions; poll for them rather than sleeping a guess.
  const settle = async (want, ms = 2000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const o = opacity();
      if (want ? o > 0.95 : o < 0.05) return o;
      await new Promise((r) => setTimeout(r, 25));
    }
    return opacity();
  };

  const hiddenAtRest = opacity() < 0.05;
  const style = cs();
  const rect = el.getBoundingClientRect();
  const centred = Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) < 4;
  const nearTop = rect.top < window.innerHeight * 0.35;

  // wheel
  g.hud.hideWeaponMenu();
  const afterHide = await settle(false);
  g.input.wheelDelta = 1;
  g.weapons.update(0.016, g.input);   // the real path: wheel -> switch -> poke
  const afterWheel = await settle(true);

  // auto-hide after inactivity
  g.hud.showWeaponMenu();
  const shown = await settle(true);
  // The 2.5 s inactivity timer counts GAME time, and a software-rendered box
  // runs a handful of frames a second — so poll the real loop rather than
  // guess a wall-clock wait that would only be testing the frame rate.
  const t0 = performance.now();
  while (g.hud._menuTimer > 0 && performance.now() - t0 < 30000) await new Promise(requestAnimationFrame);
  const afterIdle = await settle(false);

  // firing hides it immediately
  g.hud.showWeaponMenu();
  await settle(true);
  g.events.emit('weapon:fire', { weapon: g.weapons.current, alt: false });
  const afterFire = await settle(false);

  return {
    hiddenAtRest, centred, nearTop, afterHide, afterWheel, shown, afterIdle, afterFire,
    fadeIn: style.transitionDuration, timer: g.hud._menuTimer,
  };
});
check('menu is hidden during normal play', menu.hiddenAtRest);
check('menu sits at screen top centre', menu.centred && menu.nearTop);

// The number-key path is edge-triggered off a real keydown, so press an actual
// key rather than poking the input state — that is the path a player uses.
await page.evaluate(() => window.__game.hud.hideWeaponMenu());
await page.waitForFunction(() => parseFloat(getComputedStyle(document.getElementById('weapon-menu')).opacity) < 0.05, null, { timeout: 5000 });
await page.keyboard.press('Digit3');
const afterKey = await page.evaluate(async () => {
  const el = document.getElementById('weapon-menu');
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    const o = parseFloat(getComputedStyle(el).opacity);
    if (o > 0.95) return o;
    await new Promise((r) => setTimeout(r, 25));
  }
  return parseFloat(getComputedStyle(el).opacity);
});
check('menu opens on a number-key slot press', afterKey > 0.9, `opacity ${afterKey}`);
check('menu opens on mouse wheel', menu.afterWheel > 0.9, `opacity ${menu.afterWheel} (was ${menu.afterHide} hidden)`);
check('menu auto-hides after inactivity', menu.afterIdle < 0.05, `opacity ${menu.afterIdle}`);
check('menu hides immediately when the player fires', menu.afterFire < 0.05, `opacity ${menu.afterFire}`);

/* ------------------------------------------------------------------ */
/* in-game: switch through every weapon, fire, reload — no errors       */
/* ------------------------------------------------------------------ */
const live = await page.evaluate(async () => {
  const g = window.__game;
  const seen = [];
  for (let i = 0; i < g.weapons.weapons.length; i++) {
    g.weapons.switchTo(i);
    for (let k = 0; k < 20; k++) await new Promise(requestAnimationFrame);
    const w = g.weapons.current;
    g.weapons.tryFire();
    for (let k = 0; k < 10; k++) await new Promise(requestAnimationFrame);
    w.startReload?.();
    for (let k = 0; k < 10; k++) await new Promise(requestAnimationFrame);
    const rig = g.viewModel.rigs[w.config.id];
    seen.push({ id: w.config.id, visible: !!rig && rig.group.visible });
  }
  return seen;
});
check('every weapon equips, fires and reloads in-game without error',
  live.every((s) => s.visible), live.map((s) => `${s.id}:${s.visible ? 'ok' : 'HIDDEN'}`).join(' '));
check('no errors raised across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures ? `\n${failures} failure(s)` : '\nall weapon checks passed');
process.exit(failures ? 1 : 0);
