/**
 * Soundtrack audit — the score, RENDERED and measured.
 *
 * Everything about this game's music is a claim you cannot check by reading
 * the data: that it loops without a seam, that it never climbs over a gunshot,
 * that the danger arrangement is the same piece with the lights off rather
 * than a second piece, that a district change lands on a beat. So this boots
 * headless Chromium, hands the REAL MusicDirector an OfflineAudioContext,
 * schedules the real tracks note for note against it and measures the samples
 * that come out.
 *
 * What it holds the score to:
 *
 *   1. every arrangement renders — finite samples, nothing clipped, and it
 *      actually makes a sound
 *   2. no clicks anywhere: every voice opens and closes on a ramp, so no
 *      sample ever jumps by a fraction of full scale in one frame
 *   3. the eight bars really do come round: two consecutive passes of a track
 *      are the same signal to within a thousandth, so nothing in the
 *      arrangement drifts, accumulates or walks out of phase with itself
 *   4. no seam at the loop point — the wrap carries signal and its steepest
 *      sample-to-sample step is no worse than the body of the track's
 *   5. it stays under the guns: almost nothing above 3 kHz survives the
 *      score's own roll-off, which is the band the effects bus owns
 *   6. no district shouts over the district next to it, and no danger
 *      arrangement jumps in level when the mix slides onto it
 *   7. calm and danger really are one piece — same root, tempo and bar grid —
 *      and any two districts that carry a BEAT come back into phase well
 *      inside the cross-fade, so walking through a gate never lands the
 *      player between two of them
 *   8. the two districts written to drive (Eastgate, Downtown) never go dead:
 *      no quarter-second of either is a hole in the arrangement
 *
 * Usage: node tests/music.mjs
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

// A bare page on the repo's own origin: the score is the only thing under
// test, so nothing boots the game, the renderer or a single texture.
const SHELL = '<!doctype html><meta charset="utf-8"><title>score</title>'
  + '<link rel="icon" href="data:,"><body>';

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/__score.html') {
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
await new Promise((r) => server.listen(8164, r));

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
await page.goto('http://localhost:8164/__score.html');

/**
 * Render one arrangement of one track offline and measure it.
 *
 * The director's own transport runs on a wall-clock interval against a LIVE
 * context, which an OfflineAudioContext has no equivalent of — its clock does
 * not move until it renders. So the timer is stopped and the same `_step` the
 * scheduler calls is driven by hand at absolute times, which books exactly the
 * notes the game would book, through exactly the game's own bus (duck gain,
 * 3.2 kHz roll-off, limiter).
 *
 * Options:
 *   loops     how many passes of the eight bars to schedule
 *   drones    include the continuous voices. Off for any repeatability
 *             measurement: a drone is deliberately NOT periodic — its filter
 *             breathes on its own slow LFO forever — so leaving it in would
 *             measure the LFO rather than the arrangement.
 *   highpass  measure what is left above this frequency instead of the whole
 *   compare   [i, j]: envelope-compare pass i against pass j
 *   holePass  which pass to hunt for a quarter-second hole in
 *
 * Every measurement is taken IN the page, off the raw samples: a pass
 * boundary lands on an arbitrary sample, not on a round number of anything,
 * so windowing has to be done where the samples are.
 */
const RENDER = async (id, variant, opts = {}) => page.evaluate(
  async ({ id, variant, loops, drones, highpass, compare, holePass, rate }) => {
    const { MusicDirector, TRACKS } = await import('/src/audio/Music.js');
    const spec = TRACKS[id];
    if (!spec[variant]) return null;
    const steps = spec.bars * 16;
    const stepDur = 60 / spec.bpm / 4;
    const LEAD = 0.05;                      // the transport's own start offset
    const TAIL = 1.2;                       // room for the last release
    const loopLen = steps * stepDur;
    const ctx = new OfflineAudioContext(1, Math.ceil((LEAD + loopLen * loops + TAIL) * rate), rate);
    let dest = ctx.destination;
    if (highpass) {
      // two poles, so what the measurement calls "above 3 kHz" really is
      const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
      a.type = b.type = 'highpass';
      a.frequency.value = b.frequency.value = highpass;
      a.Q.value = b.Q.value = 0.7;
      a.connect(b).connect(ctx.destination);
      dest = a;
    }
    const dir = new MusicDirector(ctx, dest);
    clearInterval(dir._timer);              // the offline clock does not tick
    dir.play(id, { fade: 0.001 });
    const slot = dir.slots[0];
    // Park the mixer where the game parks it once a fade has settled: this
    // arrangement full up, the other one silent, drums at their nominal level.
    slot.level = 1;
    slot.out.gain.value = 1;
    for (const [key, v] of Object.entries(slot.variants)) {
      v.level = key === variant ? 1 : 0;
      v.gain.gain.value = v.level;
      v.beat.gain.value = 1;
    }
    if (drones) dir._drones(slot, variant, true);
    for (let n = 0; n < steps * loops; n++) dir._step(slot, n % steps, LEAD + n * stepDur);
    const d = (await ctx.startRendering()).getChannelData(0);

    /* ---- measurement ------------------------------------------------- */
    let peak = 0, sum = 0, bad = 0, maxStep = 0;
    for (let i = 0; i < d.length; i++) {
      const s = d[i];
      if (!Number.isFinite(s)) { bad++; continue; }
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sum += s * s;
      if (i) { const j = Math.abs(s - d[i - 1]); if (j > maxStep) maxStep = j; }
    }
    const rms = Math.sqrt(sum / d.length);
    const rmsBetween = (t0, t1) => {
      const a = Math.max(0, Math.round(t0 * rate)), b = Math.min(d.length, Math.round(t1 * rate));
      let s2 = 0;
      for (let i = a; i < b; i++) s2 += d[i] * d[i];
      return Math.sqrt(s2 / Math.max(1, b - a));
    };
    // The steepest sample-to-sample step inside a window — a click at the
    // loop point would show up here and nowhere else.
    const stepNear = (t, half) => {
      const a = Math.max(1, Math.round((t - half) * rate)), b = Math.min(d.length, Math.round((t + half) * rate));
      let m = 0;
      for (let i = a; i < b; i++) { const j = Math.abs(d[i] - d[i - 1]); if (j > m) m = j; }
      return m;
    };
    // One RMS value per `win` seconds, starting at an arbitrary sample.
    const env = (t0, win, n) => {
      const w = Math.round(win * rate), out = [];
      let i = Math.round(t0 * rate);
      for (let k = 0; k < n && i + w <= d.length; k++, i += w) {
        let s2 = 0;
        for (let j = 0; j < w; j++) s2 += d[i + j] * d[i + j];
        out.push(Math.sqrt(s2 / w));
      }
      return out;
    };

    const out = {
      id, variant, loopLen, rate, bad, peak, rms, maxStep,
      wraps: Array.from({ length: loops - 1 }, (_, k) => {
        const t = LEAD + (k + 1) * loopLen;
        return { step: stepNear(t, 0.05), rms: rmsBetween(t - 0.05, t + 0.05) };
      }),
      bodyStep: stepNear(LEAD + loopLen * 0.5, loopLen * 0.4),
    };
    if (compare) {
      const n = Math.floor(loopLen / 0.01);
      const a = env(LEAD + compare[0] * loopLen, 0.01, n);
      const b = env(LEAD + compare[1] * loopLen, 0.01, n);
      const m = Math.min(a.length, b.length);
      let num = 0, da = 0, db = 0, worst = 0;
      for (let i = 0; i < m; i++) {
        num += a[i] * b[i]; da += a[i] * a[i]; db += b[i] * b[i];
        worst = Math.max(worst, Math.abs(a[i] - b[i]));
      }
      out.compare = { corr: num / Math.sqrt(Math.max(1e-12, da * db)), worst, windows: m };
    }
    if (holePass !== undefined) {
      const n = Math.floor(loopLen / 0.25);
      const e = env(LEAD + holePass * loopLen, 0.25, n);
      out.hole = { min: Math.min(...e), mean: e.reduce((x, y) => x + y, 0) / e.length, windows: e.length };
    }
    return out;
  }, {
    id, variant, loops: opts.loops ?? 1, drones: opts.drones ?? true,
    highpass: opts.highpass ?? 0, compare: opts.compare ?? null, holePass: opts.holePass,
    rate: opts.rate ?? 44100,
  });

/* ------------------------------------------------------------------ */
/* 1. the whole score renders                                          */
const { IDS, DISTRICTS } = await page.evaluate(async () => {
  const { TRACKS, ZONE_TRACKS } = await import('/src/audio/Music.js');
  return { IDS: Object.keys(TRACKS), DISTRICTS: [...ZONE_TRACKS] };
});

const survey = {};
for (const id of IDS) {
  for (const variant of ['calm', 'danger']) survey[id + '/' + variant] = await RENDER(id, variant);
}
const all = Object.values(survey).filter(Boolean);
const worstOf = (key) => all.reduce((a, b) => (a[key] > b[key] ? a : b));

check('every arrangement in the score renders', all.length === IDS.length * 2,
  `${all.length} of ${IDS.length * 2}`);
check('no arrangement produces a bad sample',
  all.every((r) => r.bad === 0),
  all.filter((r) => r.bad).map((r) => `${r.id}/${r.variant} ${r.bad}`).join(', '));
check('every arrangement actually makes a sound',
  all.every((r) => r.rms > 0.004),
  (() => { const q = all.reduce((a, b) => (a.rms < b.rms ? a : b)); return `quietest ${q.id}/${q.variant} ${dB(q.rms)} dB`; })());
check('nothing in the score clips',
  all.every((r) => r.peak < 0.95), `loudest peak ${(() => { const w = worstOf('peak'); return `${w.id}/${w.variant} ${dB(w.peak)} dB`; })()}`);

/* 2. no clicks: every voice opens and closes on a ramp                  */
check('no voice steps from silence — no clicks anywhere in the score',
  all.every((r) => r.maxStep < 0.06),
  `steepest ${(() => { const w = worstOf('maxStep'); return `${w.id}/${w.variant} ${w.maxStep.toFixed(4)}`; })()}`);

/* 3. levels                                                             */
const beat = ['oldtown', 'eastgate', 'downtown'].map((id) => survey[id + '/calm']);
const spread = Math.max(...beat.map((r) => r.rms)) / Math.min(...beat.map((r) => r.rms));
check('the three driving districts sit within 2 dB of each other',
  spread < Math.pow(10, 2 / 20), beat.map((r) => `${r.id} ${dB(r.rms)}`).join(', '));
check('no reworked district is louder than the square it answers to',
  survey['eastgate/calm'].rms <= survey['oldtown/calm'].rms
  && survey['downtown/calm'].rms <= survey['oldtown/calm'].rms,
  `oldtown ${dB(survey['oldtown/calm'].rms)}, eastgate ${dB(survey['eastgate/calm'].rms)},`
  + ` downtown ${dB(survey['downtown/calm'].rms)}`);
check('the danger arrangement never jumps in level when the mix slides onto it',
  DISTRICTS.every((id) => Math.abs(20 * Math.log10(survey[id + '/danger'].rms / survey[id + '/calm'].rms)) < 4.5),
  DISTRICTS.map((id) => `${id} ${(20 * Math.log10(survey[id + '/danger'].rms / survey[id + '/calm'].rms)).toFixed(1)}`).join(', '));

/* 4. the band above 3 kHz belongs to the effects bus                    */
for (const id of ['eastgate', 'downtown']) {
  const hi = await RENDER(id, 'calm', { highpass: 3000 });
  check(`${id} leaves the band above 3 kHz to the guns`,
    hi.rms / survey[id + '/calm'].rms < 0.06, `${dB(hi.rms / survey[id + '/calm'].rms)} dB of the whole`);
}

/* 5. THE LOOP.
 *
 * Three passes of the same eight bars with the drones out, and pass 2 held
 * against pass 3.
 *
 * Rendered at 44 kHz rather than 44.1, which is the one number here that
 * needs explaining. WebAudio recomputes a biquad's coefficients once per
 * 128-sample render quantum, so where a note falls INSIDE that grid changes
 * how a resonant filter opens on it — by a fraction of a millisecond, which
 * nobody can hear and a sample-by-sample comparison can see clearly. At
 * 44.1 kHz eight bars of Downtown is 641454.54 samples, so every pass lands
 * somewhere different in that grid and the measurement reports the renderer
 * rather than the music. At 44 kHz eight bars of either track is a whole
 * number of quanta, every pass lands identically, and what is left to measure
 * is the arrangement: nothing in it drifts, accumulates or walks out of phase
 * with itself, so the eight bars come round exactly as they went out, forever.
 */
for (const id of ['eastgate', 'downtown']) {
  for (const variant of ['calm', 'danger']) {
    const r = await RENDER(id, variant,
      { loops: 3, drones: false, compare: [1, 2], holePass: 1, rate: 44000 });
    // The residual is the score's own doing and is meant to be there: every
    // noise voice starts up to a millisecond late on purpose (VoiceKit
    // _noiseSrc), so sixteen hats a bar cannot phase-lock into a comb. That
    // shows up as a hair on one or two windows and as nothing at all in the
    // correlation, so the tolerance is stated against the track's own level
    // rather than as an absolute.
    check(`${id}/${variant}: the eight bars come round exactly as they went out`,
      r.compare.corr > 0.9995 && r.compare.worst < r.rms * 0.25,
      `envelope correlation ${r.compare.corr.toFixed(5)} over ${r.compare.windows} windows,`
      + ` worst 10 ms window ${dB(r.compare.worst / r.rms)} dB under the track`);
    check(`${id}/${variant}: the loop point carries signal, and no click`,
      r.wraps.every((x) => x.rms > r.rms * 0.4 && x.step <= r.bodyStep * 1.05),
      r.wraps.map((x) => `${dB(x.rms / r.rms)} dB of mean, step ${x.step.toFixed(4)}`).join(' | ')
      + ` (body ${r.bodyStep.toFixed(4)})`);
    if (variant !== 'calm') continue;
    // ...and with the drones out and a whole pass to look at, is there a
    // quarter-second anywhere in it where the arrangement stops?
    check(`${id} never leaves a hole in the arrangement`,
      r.hole.min > r.hole.mean * 0.4,
      `quietest of ${r.hole.windows} quarter-seconds is ${dB(r.hole.min / r.hole.mean)} dB under the mean`);
  }
}

/* 6. one piece, two arrangements — and two districts one cross-fade apart */
const grid = await page.evaluate(async () => {
  const { TRACKS, ZONE_TRACKS } = await import('/src/audio/Music.js');
  const mismatched = [];
  for (const [id, t] of Object.entries(TRACKS)) {
    if (!t.danger || !t.calm) continue;
    // calm and danger share the transport; only the ARRANGEMENT may differ.
    if (t.danger.bpm || t.danger.root || t.danger.scale || t.danger.bars) mismatched.push(id);
  }
  // Grid alignment only matters where there is a grid to hear: a district
  // whose calm arrangement has no percussion has no beat to land between.
  const hasBeat = (id) => (TRACKS[id].calm.layers || []).some((l) => l.k === 'perc' && l.kind !== 'heart');
  const pairs = [];
  const beats = ZONE_TRACKS.filter(hasBeat);
  for (let i = 0; i < beats.length; i++) {
    for (let j = i + 1; j < beats.length; j++) {
      const sa = 60 / TRACKS[beats[i]].bpm / 4, sb = 60 / TRACKS[beats[j]].bpm / 4;
      let n = 1;
      while (n < 5000) {
        const m = (n * sa) % sb;
        if (m < 1e-6 || sb - m < 1e-6) break;
        n++;
      }
      pairs.push({ a: beats[i], b: beats[j], t: n * sa });
    }
  }
  return { mismatched, pairs, beats, quiet: ZONE_TRACKS.filter((id) => !hasBeat(id)) };
});
check('no danger arrangement moves the tempo, root, scale or bar grid',
  grid.mismatched.length === 0, grid.mismatched.join(', '));
check('every district that carries a beat shares a grid with the others',
  grid.pairs.every((p) => p.t <= 2.2),
  `${grid.beats.join('/')} — worst ${grid.pairs.reduce((a, b) => (a.t > b.t ? a : b)).t.toFixed(2)}s`
  + ` (no beat to align: ${grid.quiet.join(', ')})`);

check('no errors raised while the score played', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nall soundtrack checks passed');
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
