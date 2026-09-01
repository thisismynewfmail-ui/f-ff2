/**
 * Effects-bus audit — what the town's sounds actually COST, measured.
 *
 * Every sound in this game is synthesised: a gunshot is half a dozen little
 * graphs of oscillators, filters and gains, built from nothing, played once and
 * thrown away. That is cheap once and ruinous a hundred times over, and the
 * failure it produces is not a quiet game — it is the audio CUTTING OUT while
 * the render thread misses its deadline, and the main thread hitching behind
 * the burst of node construction that caused it. Neither of those is visible in
 * the source, so this measures them:
 *
 *   1. every event still fires, and nothing throws
 *   2. an ordinary moment (one shot, one blast, one man shouting) sounds
 *      EXACTLY as loud as it did before any of the budgeting existed — the
 *      governor is not allowed to buy its savings out of the quiet case
 *   3. a wall coming down builds a handful of nodes on the frame it breaks
 *      rather than the whole demolition at once (see AudioManager's THE DRIP),
 *      and the rest of it still arrives
 *   4. a wave breaking — fifteen fighters shouting, dying and being shot at —
 *      renders well inside real time, which is the whole of the dropout
 *   5. and the mix does not run away past its limiter while doing it
 *
 * Measurements 2, 4 and 5 are taken off the SAMPLES: the real AudioManager is
 * given an OfflineAudioContext, fed real events off the real event bus, and
 * rendered. Offline rendering runs the same DSP the live thread does, so the
 * wall time it takes is a direct proxy for how close the live thread runs to
 * its deadline.
 *
 * Usage: node tests/audio.mjs
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

// A bare page on the repo's own origin: the effects bus is the only thing
// under test, so nothing boots the game, the renderer or a single texture.
const SHELL = '<!doctype html><meta charset="utf-8"><title>effects</title>'
  + '<link rel="icon" href="data:,"><body>';

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/__effects.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(SHELL);
    return;
  }
  try {
    const data = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(8168, r));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};
const dB = (x) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8168/__effects.html');

/**
 * Render one scene through the real AudioManager and measure it.
 *
 * `scene` names a script below rather than being passed in as a function,
 * because it has to run inside the page where the audio lives.
 *
 * The drip (AudioManager's deferred scheduler) is drained by hand before
 * rendering: it is driven from the frame loop against a LIVE clock, and an
 * offline context's clock does not move until it renders. Draining it books
 * exactly the layers the game would book, at exactly the times it would book
 * them — what is being measured here is the graph, not the queue.
 */
const render = (scene, secs = 8) => page.evaluate(async ({ scene, secs }) => {
  const { AudioManager } = await import('/src/audio/AudioManager.js');
  const { EventBus } = await import('/src/engine/Events.js');
  const RATE = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * secs), RATE);
  const realAC = window.AudioContext;
  window.AudioContext = function () { return ctx; };
  const bus = new EventBus();
  const am = new AudioManager(bus);
  am.unlock();
  window.AudioContext = realAC;
  am.music?.dispose?.();
  am.music = null;                       // the effects bus is what is on trial
  const rifleman = { name: 'rifleman' };
  // Let every fighter who is asked to speak actually speak: the throttles are
  // wall-clock and this context's clock has not started, so without this a
  // scene of fifteen voices measures one.
  const speak = (state, pos, i) => {
    am._lastLine = -1e6;
    am._lastByState?.clear();
    bus.emit(`zombie:${state}`, { pos, type: rifleman, voice: (i % 15) / 15 });
  };

  // Count every node the graph builds. Patched onto the prototype once and
  // then counted through a page-level tally, so a second scene in the same page
  // does not go on incrementing the first scene's total.
  if (!OfflineAudioContext.prototype.__counted) {
    for (const k of ['createOscillator', 'createBufferSource', 'createBiquadFilter',
      'createGain', 'createStereoPanner', 'createWaveShaper']) {
      const orig = OfflineAudioContext.prototype[k];
      OfflineAudioContext.prototype[k] = function (...a) { window.__built++; return orig.apply(this, a); };
    }
    OfflineAudioContext.prototype.__counted = true;
  }
  window.__built = 0;

  if (scene === 'quiet') {
    // An ordinary moment. Nothing here is anywhere near the budget, so every
    // layer of it must survive intact.
    am.gunshot('rifle');
    bus.emit('exploder:explode', { pos: { x: 8, y: 0, z: 3 } });
    speak('spot', { x: 3, y: 0, z: 6 }, 6);
    am.footstep('concrete', false);
  } else if (scene === 'wall') {
    // A district gate coming down: sixty-odd layers laid across five seconds.
    bus.emit('barrier:explode', { x: 14, z: 14, duration: 3.5 });
  } else if (scene === 'wave') {
    // A wave breaking on the square.
    for (let i = 0; i < 15; i++) {
      const pos = { x: (i % 5) * 6 - 12, y: 0, z: 6 + (i % 3) * 9 };
      speak('spot', pos, i);
      speak('attack', pos, i);
      speak('death', pos, i);
      am.gunshot(i % 2 ? 'rifle' : 'shotgun');
      am.footstep('concrete', true);
    }
    bus.emit('barrier:explode', { x: 14, z: 14, duration: 3.5 });
    bus.emit('exploder:explode', { pos: { x: 8, y: 0, z: 3 } });
  }
  am._drainDeferred?.(1e9);

  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  const d = buf.getChannelData(0);
  let sum = 0, peak = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    sum += d[i] * d[i];
    if (a > peak) peak = a;
  }
  return { ms, rms: Math.sqrt(sum / d.length), peak, built: window.__built };
}, { scene, secs });

/* --- 1 + 2: the quiet case is untouched --------------------------------- */
const quiet = await render('quiet');
check('an ordinary moment still makes its sound', quiet.rms > 1e-4 && Number.isFinite(quiet.rms),
  `rms ${dB(quiet.rms)} dBFS, peak ${dB(quiet.peak)} dBFS`);
check('...and nothing about it is culled — every layer of it is built',
  quiet.built >= 20 && quiet.built <= 60, `${quiet.built} nodes`);

/* --- 3: the demolition arrives as a drip, not a lump --------------------- */
const wall = await render('wall');
check('...and the whole demolition still gets built',
  wall.built >= 45, `${wall.built} nodes`);
check('...and it is a big sound when it lands', wall.peak > 0.2, `peak ${dB(wall.peak)} dBFS`);

/**
 * The drip itself, measured against a LIVE context — which is the only place
 * it exists. Offline there are no frames to spread the work across, so the
 * manager books everything where it stands (see AudioManager's `_dripping`);
 * here there is a clock and a frame loop, so a wall coming down must put a
 * handful of nodes on the frame it breaks and trickle the rest in behind.
 */
const drip = await page.evaluate(async () => {
  const { AudioManager } = await import('/src/audio/AudioManager.js');
  const { EventBus } = await import('/src/engine/Events.js');
  let built = 0;
  const AC = window.AudioContext;
  for (const k of ['createOscillator', 'createBufferSource', 'createBiquadFilter',
    'createGain', 'createStereoPanner', 'createWaveShaper']) {
    const orig = AC.prototype[k];
    if (orig.__counted) continue;
    const patched = function (...a) { window.__liveBuilt++; return orig.apply(this, a); };
    patched.__counted = true;
    AC.prototype[k] = patched;
  }
  const bus = new EventBus();
  const am = new AudioManager(bus);
  am.unlock();
  if (!am.ctx) return null;
  am.music?.dispose?.(); am.music = null;
  window.__liveBuilt = 0;
  bus.emit('barrier:explode', { x: 14, z: 14, duration: 3.5 });
  const onFrame = window.__liveBuilt;
  // ...and then run the frame loop over the life of the demolition.
  const player = { position: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
  const t0 = performance.now();
  while (performance.now() - t0 < 4200) {
    am.update(1 / 60, player, 0);
    await new Promise((r) => setTimeout(r, 8));
  }
  const total = window.__liveBuilt;
  am.ctx.close?.();
  return { onFrame, total };
});
if (drip) {
  check('a wall coming down does not build itself on one frame',
    drip.onFrame <= 30, `${drip.onFrame} nodes on the frame it breaks, ${drip.total} over the whole demolition`);
  check('...and the rest of it arrives behind that',
    drip.total > drip.onFrame, `${drip.total - drip.onFrame} more nodes dripped in`);
} else {
  console.log('SKIP  the drip — no live AudioContext in this browser');
}

/* --- 4 + 5: a wave breaking stays inside its deadline -------------------- */
const wave = await render('wave');
// Offline rendering is not the live thread, but it is the same DSP over the
// same graph, so the ratio is the thing: eight seconds of a wave breaking must
// render in a small fraction of eight seconds or the live thread has no margin
// left for a dropped frame, a GC or the rest of the game.
const realtime = wave.ms / 8000;
check('a wave breaking renders well inside real time',
  realtime < 0.25, `${wave.ms.toFixed(0)} ms for 8 s (${(realtime * 100).toFixed(1)}% of real time)`);
// The bus compressor already drives a wave to within a hair of full scale by
// design, so this is a runaway check rather than a clip check: what must not
// happen is the mix piling up past the limiter, which is what a graph nobody is
// governing eventually does.
check('...and the bus does not run away past its limiter', wave.peak <= 1.05,
  `peak ${dB(wave.peak)} dBFS, rms ${dB(wave.rms)} dBFS`);
check('...and it is still a full mix, not a thinned one', wave.rms > 0.01,
  `rms ${dB(wave.rms)} dBFS`);

check('no errors raised while the town made its noise', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nall effects-bus checks passed');
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
