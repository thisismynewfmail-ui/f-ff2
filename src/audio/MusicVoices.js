/**
 * The instruments the soundtrack is played on.
 *
 * Every voice here is built from oscillators, filters and one shared noise
 * buffer — there is not a single audio file in this game and the score is no
 * exception. A voice is a pure function of (destination, when, …): it builds
 * its own little graph, schedules itself at an ABSOLUTE context time, and
 * stops itself. Nothing is pooled and nothing is reused, because at the note
 * densities a score like this runs at (well under fifty voices a second) the
 * allocation is free and the alternative — a fixed pool — is what makes
 * procedural music click and drop notes.
 *
 * Two rules hold everywhere:
 *
 *  1. NOTHING RAMPS TO ZERO. exponentialRampToValueAtTime cannot reach 0, and
 *     asking it to is what produces the click you hear at the end of a note in
 *     naive WebAudio synths. Every envelope decays to EPS and is then cut.
 *  2. EVERY VOICE HAS AN ATTACK. Even the percussive ones open over a
 *     millisecond or two rather than stepping from silence, because a step IS
 *     a click at 48 kHz.
 *
 * The tail of a note is allowed to run past the end of its bar — the score is
 * scheduled as one continuous stream rather than as a rendered loop, so there
 * is no seam for a release to fall across. That is what makes these tracks
 * loop cleanly: they never actually loop, they just keep playing the same
 * eight bars.
 */

const EPS = 0.0001;

/** A semitone offset from a root frequency. */
export function hz(root, semis) { return root * Math.pow(2, semis / 12); }

/** Deterministic PRNG — the score's variation repeats identically every loop. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VoiceKit {
  constructor(ctx) {
    this.ctx = ctx;
    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // Pink-ish noise (Voss-McCartney, 5 rows). White noise reads as a hiss and
    // hiss is the one thing a background score must not have; pink sits under
    // the mix as air.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      d[i] = (b0 + b1 + b2 + b3 + b4 + w * 0.1848) * 0.22;
    }
  }

  get t() { return this.ctx.currentTime; }

  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  /** ADSR-ish envelope on a gain node, absolute-timed and always click-free. */
  _env(g, when, dur, peak, atk = 0.01, rel = 0.12, sustain = 1) {
    const p = Math.max(EPS * 2, peak);
    const a = Math.min(atk, dur * 0.5);
    const r = Math.min(rel, Math.max(0.01, dur - a));
    g.gain.setValueAtTime(EPS, when);
    g.gain.exponentialRampToValueAtTime(p, when + a);
    if (sustain < 1) g.gain.exponentialRampToValueAtTime(Math.max(EPS * 2, p * sustain), when + a + (dur - a - r) * 0.6);
    g.gain.setValueAtTime(Math.max(EPS * 2, p * sustain), when + dur - r);
    g.gain.exponentialRampToValueAtTime(EPS, when + dur);
  }

  _osc(type, freq, when, stop, detuneCents = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (detuneCents) o.detune.setValueAtTime(detuneCents, when);
    o.start(when);
    o.stop(stop);
    return o;
  }

  _noiseSrc(when, stop, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(when + Math.random() * 0.001);
    s.stop(stop);
    return s;
  }

  _lp(freq, q = 0.7, type = 'lowpass') {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  /* ------------------------------------------------------------------ *
   * SUSTAINED VOICES — the harmonic bed. These carry the mood; they are
   * quiet, slow to open, and never sit in the frequency band a gunshot
   * needs (see the filter ceilings).
   * ------------------------------------------------------------------ */

  /**
   * Bowed strings: three saws a few cents apart into a lowpass that opens as
   * the note swells. The detune spread is what turns three oscillators into a
   * section — at 0 cents this is a buzzer, at 20 it is a chorus pedal, at 6
   * it is a string quartet that cannot quite agree.
   */
  strings(dest, freq, when, dur, gain, { bright = 1, tremolo = 0 } = {}) {
    const stop = when + dur + 0.4;
    const g = this._gain(0);
    const f = this._lp(320 * bright, 0.9);
    f.frequency.setValueAtTime(240 * bright, when);
    f.frequency.linearRampToValueAtTime(760 * bright, when + Math.min(1.4, dur * 0.7));
    f.frequency.linearRampToValueAtTime(300 * bright, when + dur);
    for (const c of [-7, 0.5, 8]) this._osc('sawtooth', freq, when, stop, c).connect(f);
    // a sixth-below body oscillator keeps the section from sounding thin
    this._osc('triangle', freq * 0.5, when, stop, 3).connect(f);
    f.connect(g).connect(dest);
    this._env(g, when, dur, gain, Math.min(0.9, dur * 0.35), Math.min(1.1, dur * 0.45), 0.85);
    if (tremolo > 0) {
      const lfo = this._osc('sine', tremolo, when, stop);
      const amt = this._gain(gain * 0.42);
      lfo.connect(amt).connect(g.gain);
    }
    return g;
  }

  /** Choir "ah": triangles under a formant bandpass, with human vibrato. */
  choir(dest, freq, when, dur, gain, { vib = 4.6 } = {}) {
    const stop = when + dur + 0.6;
    const g = this._gain(0);
    const form = this._lp(freq < 200 ? 520 : 780, 1.6, 'bandpass');
    const body = this._lp(1400, 0.6);
    for (const [type, c, lvl] of [['triangle', -5, 1], ['triangle', 6, 0.8], ['sawtooth', 0, 0.28]]) {
      const o = this._osc(type, freq, when, stop, c);
      const lg = this._gain(lvl);
      o.connect(lg).connect(form);
      // vibrato, opening late so the entry is straight and the hold breathes
      const l = this._osc('sine', vib + lvl, when, stop);
      const d = this._gain(0);
      d.gain.setValueAtTime(0, when);
      d.gain.linearRampToValueAtTime(7, when + Math.min(1.2, dur * 0.6));
      l.connect(d).connect(o.detune);
    }
    form.connect(body).connect(g).connect(dest);
    this._env(g, when, dur, gain, Math.min(1.1, dur * 0.4), Math.min(1.3, dur * 0.5), 0.9);
    return g;
  }

  /** Tonewheel organ: sine drawbars, slightly out of tune with each other. */
  organ(dest, freq, when, dur, gain, { drawbars = [1, 0.5, 0.32, 0.16, 0.09] } = {}) {
    const stop = when + dur + 0.3;
    const g = this._gain(0);
    const f = this._lp(2600, 0.5);
    drawbars.forEach((lvl, i) => {
      if (lvl <= 0) return;
      const o = this._osc('sine', freq * (i + 1), when, stop, (i % 2 ? 4 : -3) * (i + 1) * 0.3);
      const lg = this._gain(lvl);
      o.connect(lg).connect(f);
    });
    f.connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.06, Math.min(0.5, dur * 0.4), 0.95);
    return g;
  }

  /** A single held saw with a slow filter sweep — tension, not harmony. */
  drone(dest, freq, when, gain, { cutoff = 200, sweep = 0.06, detune = 11 } = {}) {
    const g = this._gain(0);
    const f = this._lp(cutoff, 3.5);
    const o1 = this._osc('sawtooth', freq, when, when + 1e6, -detune);
    const o2 = this._osc('sawtooth', freq, when, when + 1e6, detune);
    const o3 = this._osc('sine', freq * 0.5, when, when + 1e6);
    o1.connect(f); o2.connect(f); o3.connect(f);
    f.connect(g).connect(dest);
    g.gain.setValueAtTime(EPS, when);
    g.gain.exponentialRampToValueAtTime(Math.max(EPS * 2, gain), when + 3.5);
    // the cutoff breathes forever, so a held drone never becomes furniture
    const lfo = this._osc('sine', sweep, when, when + 1e6);
    const amt = this._gain(cutoff * 0.55);
    lfo.connect(amt).connect(f.frequency);
    return { gain: g, stop: (at) => { o1.stop(at); o2.stop(at); o3.stop(at); lfo.stop(at); } };
  }

  /* ------------------------------------------------------------------ *
   * ARTICULATED VOICES — the things that play notes you notice.
   * ------------------------------------------------------------------ */

  /** Music box / celeste: a struck sine with two inharmonic partials. */
  glass(dest, freq, when, dur, gain) {
    const stop = when + dur + 0.3;
    const g = this._gain(0);
    for (const [mult, lvl, decay] of [[1, 1, 1], [2.01, 0.34, 0.55], [3.98, 0.14, 0.3], [5.42, 0.06, 0.2]]) {
      const o = this._osc('sine', freq * mult, when, stop);
      const pg = this._gain(0);
      o.connect(pg).connect(g);
      this._env(pg, when, dur * decay, gain * lvl, 0.004, dur * decay * 0.9, 0.001);
    }
    g.gain.value = 1;
    g.connect(dest);
    return g;
  }

  /** Plucked string: square through a fast-closing lowpass. */
  pluck(dest, freq, when, dur, gain, { bright = 1 } = {}) {
    const stop = when + dur + 0.2;
    const g = this._gain(0);
    const f = this._lp(freq * 9 * bright, 2.2);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 1.6), when + dur * 0.8);
    this._osc('square', freq, when, stop).connect(f);
    this._osc('triangle', freq * 2, when, stop, 5).connect(f);
    f.connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.005, dur * 0.75, 0.35);
    return g;
  }

  /** Retro lead: a fat detuned saw pair — the arcade in the room. */
  lead(dest, freq, when, dur, gain, { cut = 2400, wave = 'sawtooth' } = {}) {
    const stop = when + dur + 0.2;
    const g = this._gain(0);
    const f = this._lp(cut, 4);
    f.frequency.setValueAtTime(cut, when);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.4), when + dur);
    this._osc(wave, freq, when, stop, -9).connect(f);
    this._osc(wave, freq, when, stop, 9).connect(f);
    f.connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.012, dur * 0.5, 0.7);
    return g;
  }

  /** Whistled/theremin line — one sine, vibrato, breath. */
  whistle(dest, freq, when, dur, gain) {
    const stop = when + dur + 0.2;
    const g = this._gain(0);
    const o = this._osc('sine', freq, when, stop);
    const l = this._osc('sine', 5.2, when, stop);
    const d = this._gain(0);
    d.gain.setValueAtTime(0, when);
    d.gain.linearRampToValueAtTime(14, when + dur * 0.5);
    l.connect(d).connect(o.detune);
    o.connect(g);
    const air = this._noiseSrc(when, stop);
    const af = this._lp(freq * 2, 8, 'bandpass');
    const ag = this._gain(gain * 0.1);
    air.connect(af).connect(ag).connect(g);
    g.connect(dest);
    this._env(g, when, dur, gain, Math.min(0.12, dur * 0.3), Math.min(0.35, dur * 0.5), 0.9);
    return g;
  }

  /** Struck bell — inharmonic partials, long tail. Chapel, clock, warning. */
  bell(dest, freq, when, dur, gain) {
    const stop = when + dur + 0.6;
    const g = this._gain(1);
    g.connect(dest);
    for (const [mult, lvl, dec] of [[0.5, 0.3, 1], [1, 1, 1], [2.76, 0.4, 0.6], [5.4, 0.18, 0.35], [8.9, 0.07, 0.2]]) {
      const o = this._osc('sine', freq * mult, when, stop);
      const pg = this._gain(0);
      o.connect(pg).connect(g);
      this._env(pg, when, dur * dec, gain * lvl, 0.003, dur * dec * 0.95, 0.001);
    }
    return g;
  }

  /** Sub bass: sine with a body harmonic. Sits below everything else. */
  sub(dest, freq, when, dur, gain, { drive = 0.22 } = {}) {
    const stop = when + dur + 0.2;
    const g = this._gain(0);
    const f = this._lp(190, 0.8);
    this._osc('sine', freq, when, stop).connect(f);
    const h = this._gain(drive);
    this._osc('triangle', freq * 2, when, stop, 4).connect(h).connect(f);
    f.connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.014, Math.min(0.2, dur * 0.5), 0.75);
    return g;
  }

  /** Reese bass: two saws beating against each other. The danger bass. */
  reese(dest, freq, when, dur, gain, { cut = 320 } = {}) {
    const stop = when + dur + 0.2;
    const g = this._gain(0);
    const f = this._lp(cut, 6);
    f.frequency.setValueAtTime(cut * 1.6, when);
    f.frequency.exponentialRampToValueAtTime(Math.max(90, cut * 0.6), when + dur);
    this._osc('sawtooth', freq, when, stop, -14).connect(f);
    this._osc('sawtooth', freq, when, stop, 14).connect(f);
    this._osc('sine', freq * 0.5, when, stop).connect(f);
    f.connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.008, Math.min(0.14, dur * 0.4), 0.8);
    return g;
  }

  /* ------------------------------------------------------------------ *
   * PERCUSSION + TEXTURE
   * ------------------------------------------------------------------ */

  kick(dest, when, gain, { from = 132, to = 42, dur = 0.24 } = {}) {
    const g = this._gain(0);
    const o = this._osc('sine', from, when, when + dur + 0.05);
    o.frequency.exponentialRampToValueAtTime(to, when + dur * 0.55);
    o.connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.003, dur * 0.85, 0.4);
    const c = this._noiseSrc(when, when + 0.02);
    const cf = this._lp(1600, 1, 'bandpass');
    const cg = this._gain(0);
    c.connect(cf).connect(cg).connect(dest);
    this._env(cg, when, 0.018, gain * 0.35, 0.001, 0.014, 0.2);
  }

  snare(dest, when, gain, { tone = 190, dur = 0.17, tight = 1 } = {}) {
    const g = this._gain(0);
    const n = this._noiseSrc(when, when + dur + 0.05);
    const f = this._lp(1500 * tight, 0.9, 'bandpass');
    n.connect(f).connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.002, dur * 0.9, 0.15);
    const tg = this._gain(0);
    const o = this._osc('triangle', tone, when, when + dur);
    o.frequency.exponentialRampToValueAtTime(tone * 0.7, when + dur * 0.6);
    o.connect(tg).connect(dest);
    this._env(tg, when, dur * 0.7, gain * 0.5, 0.002, dur * 0.6, 0.2);
  }

  hat(dest, when, gain, { open = false } = {}) {
    const dur = open ? 0.19 : 0.038;
    const g = this._gain(0);
    const n = this._noiseSrc(when, when + dur + 0.03, 1.7);
    const f = this._lp(8200, 0.8, 'highpass');
    n.connect(f).connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.001, dur * 0.9, 0.1);
  }

  /** A struck piece of scrap — industrial ride/clank, deliberately atonal. */
  clank(dest, when, gain, freq = 520) {
    const g = this._gain(1);
    g.connect(dest);
    for (const [mult, lvl] of [[1, 1], [1.61, 0.6], [2.39, 0.35], [4.13, 0.18]]) {
      const o = this._osc('square', freq * mult, when, when + 0.36);
      const pg = this._gain(0);
      const f = this._lp(4200, 1);
      o.connect(f).connect(pg).connect(g);
      this._env(pg, when, 0.3 * (1 / mult), gain * lvl * 0.4, 0.002, 0.26, 0.05);
    }
    const n = this._noiseSrc(when, when + 0.09);
    const nf = this._lp(3000, 2, 'bandpass');
    const ng = this._gain(0);
    n.connect(nf).connect(ng).connect(g);
    this._env(ng, when, 0.08, gain * 0.5, 0.001, 0.07, 0.1);
  }

  /**
   * The heartbeat. Two thumps, the second softer, and the whole thing lives
   * in the danger arrangement only — it is the single most direct thing the
   * score can say about a player who is about to die, so it is used sparingly
   * and it is never in the calm mix.
   */
  heartbeat(dest, when, gain, rate = 1) {
    const gap = 0.19 / rate;
    this.kick(dest, when, gain, { from: 88, to: 34, dur: 0.2 });
    this.kick(dest, when + gap, gain * 0.62, { from: 78, to: 30, dur: 0.24 });
  }

  /** Filtered noise swell — wind, distant traffic, the room the score is in. */
  swell(dest, when, dur, gain, { freq = 480, q = 0.8, type = 'bandpass', rate = 1 } = {}) {
    const g = this._gain(0);
    const n = this._noiseSrc(when, when + dur + 0.1, rate);
    const f = this._lp(freq, q, type);
    f.frequency.setValueAtTime(freq * 0.6, when);
    f.frequency.linearRampToValueAtTime(freq * 1.5, when + dur * 0.5);
    f.frequency.linearRampToValueAtTime(freq * 0.7, when + dur);
    n.connect(f).connect(g).connect(dest);
    this._env(g, when, dur, gain, dur * 0.4, dur * 0.5, 0.9);
  }

  /** A short burst of tape/radio noise — the game's CRT, in the music. */
  static_(dest, when, dur, gain) {
    const g = this._gain(0);
    const n = this._noiseSrc(when, when + dur + 0.05, 2.4);
    const f = this._lp(2600, 1.4, 'bandpass');
    n.connect(f).connect(g).connect(dest);
    this._env(g, when, dur, gain, 0.004, dur * 0.7, 0.5);
  }
}
