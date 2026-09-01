/**
 * ARCADE SPEECH.
 *
 * The horde is not a horde of zombies any more — the sheets are militia
 * fighters — so it cannot go on moaning. It has to TALK. But this town speaks
 * through a blown cabinet speaker and everything else in the mix is made of
 * oscillators, so a recording of a voice would be the only sampled sound in
 * the game and would stick out of it like a photograph glued to a painting.
 *
 * So the voices are synthesised the way arcade voices actually were, on a
 * formant synthesiser: a buzzing glottal source driven through three tuned
 * resonators. That is not an approximation of speech, it IS how a vowel is
 * made — the two low resonances of the vocal tract are what your ear reads as
 * "ah" versus "ee" — and it is why an SP0256 or a TMS5220 could be understood
 * at all through four bits of quantisation. Consonants are the other half:
 * a filtered noise burst for the fricatives, a moment of silence and then a
 * transient for the stops.
 *
 * On top of that goes the cabinet:
 *   - the pitch is QUANTISED to a coarse grid, the way a speech chip's pitch
 *     register was, so a held vowel steps rather than glides;
 *   - the whole voice is band-limited to roughly 300–3600 Hz, which is the
 *     speaker, and it is what makes it sit under gunfire instead of over it;
 *   - a waveshaper adds the fizz of an overdriven amplifier;
 *   - and there is a floor of carrier hiss under every line close enough for
 *     it to be part of the sound rather than part of the bill (see THE RUNGS).
 *
 * The result is deliberately not clean: it is meant to be UNDERSTANDABLE and
 * obviously artificial at the same time, which is exactly the register the
 * rest of this game's audio is in.
 */

/**
 * Formant table. [F1, F2, F3] in Hz, then relative loudness.
 *
 * F1 rides with how open the mouth is and F2 with how far forward the tongue
 * is, which is the whole vowel space; F3 mostly just makes it sound like a
 * person. These are the standard adult-male measurements, dropped slightly
 * because everything in this town is coming through a horn.
 */
const VOWELS = {
  aa: [700, 1090, 2440, 1.0],   // father
  a:  [660, 1700, 2410, 0.95],  // bat
  e:  [530, 1840, 2480, 0.9],   // bet
  i:  [300, 2250, 3000, 0.8],   // beet
  o:  [560, 880, 2410, 0.95],   // bought
  u:  [320, 900, 2240, 0.8],    // boot
  uh: [640, 1190, 2390, 0.9],   // but
  ay: [500, 1900, 2500, 0.9],   // day (glides toward i)
};
/** Voiced consonants: same machinery, tighter formants, quieter. */
const VOICED = {
  l:  [380, 1100, 2600, 0.7],
  r:  [420, 1100, 1700, 0.7],
  m:  [280, 1100, 2400, 0.55],
  n:  [280, 1700, 2600, 0.55],
  w:  [300, 700, 2300, 0.6],
  y:  [300, 2200, 3000, 0.6],
  j:  [320, 2050, 2750, 0.6],   // the ج in ihjum — it was falling through to a schwa
  b:  [300, 900, 2200, 0.6],
  d:  [320, 1700, 2600, 0.6],
  g:  [320, 1300, 2200, 0.6],
  v:  [350, 1400, 2400, 0.5],
  z:  [320, 1600, 2500, 0.5],
};
/** Unvoiced: a band of noise, and where in the spectrum it sits. */
const FRICATIVES = {
  s:  [5200, 3.0, 0.55],
  sh: [2400, 2.0, 0.6],
  f:  [1800, 1.2, 0.4],
  h:  [1100, 0.8, 0.35],
  kh: [1500, 1.4, 0.5],   // the back-of-the-throat one; Arabic needs it
  th: [2600, 2.4, 0.35],
};
/** Stops: a closure, then a burst. [burst Hz, Q, level, closure seconds] */
const STOPS = {
  k: [2200, 1.6, 0.65, 0.045],
  t: [3600, 2.2, 0.6, 0.038],
  p: [1200, 1.0, 0.5, 0.042],
  q: [1500, 1.4, 0.6, 0.05],    // uvular; Arabic again
};

const DUR = { vowel: 0.135, voiced: 0.07, fric: 0.085, stop: 0.03, pause: 0.075 };

export class SpeechSynth {
  constructor(ctx, noiseBuf) {
    this.ctx = ctx;
    this.noise = noiseBuf;
    /**
     * The amplifier curve — one array, shared by every voice in the town,
     * because it is the same amplifier.
     *
     * The NODE, however, is per utterance, and that is not a detail. A single
     * shared waveshaper is a single shared summing point: every line built
     * while another is speaking picks up the other's signal downstream of it,
     * so the near fighter's shout came back out of the distant one's panner at
     * the distant one's position, and the distant one's out of the near one's
     * at full weight. With every line levelled and filtered for its own
     * distance (see AudioManager.enemyLine) that is precisely the thing being
     * built — a voice at a place — being unbuilt one node later. A waveshaper
     * is a lookup table; one per line costs nothing.
     */
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) * 0.92;
    }
    this.curve = curve;
  }

  /**
   * Speak a line.
   *
   * @param dest   where the voice goes (usually a panner into the SFX bus)
   * @param line   phonemes, space-separated. '.' is a beat, ',' a shorter one.
   * @param opts   f0     fundamental in Hz — this is the SPEAKER's identity
   *               gain   0..1
   *               when   offset from now
   *               rate   >1 speaks faster (urgency)
   *               grit   0..1 how far gone the cabinet is
   *               shout  0..1 raises f0 and opens the vowels through the line
   *               quality 2 = the whole machine, 1 and 0 progressively less of
   *                      it — see THE RUNGS below
   * @returns the length of the line in seconds, so a caller can sequence it.
   */
  speak(dest, line, {
    f0 = 118, gain = 0.5, when = 0, rate = 1, grit = 0.5, shout = 0, quality = 2,
  } = {}) {
    const ctx = this.ctx;
    if (!ctx) return 0;
    /* --- THE RUNGS ------------------------------------------------------
     *
     * What a line costs is what it BUILDS, every 128 sample frames, for as long
     * as it is speaking. Distance has already taken the top off the voice by
     * the time the caller hands it over (see AudioManager.enemyLine), so the
     * parts of the machine that only live up there are being computed in order
     * to be filtered straight back out of the mix. What goes, goes in the
     * order of what is least there to hear:
     *
     *   THE OVERSAMPLING, first. It exists to keep the waveshaper's fizz from
     *   aliasing, and there is nothing left up there to alias once the line is
     *   low-passed to under two kilohertz. It is also, by a distance, the most
     *   expensive thing in the chain — a waveshaper at 2x runs its whole block
     *   through two extra resampling passes.
     *
     *   THE CARRIER HISS, with it: a source, a filter and a gain spent on
     *   something already forty decibels under a voice that is itself quiet.
     *
     *   THE CEILING AND THE THIRD FORMANT, last and only at the far rung,
     *   where the air filter is a full octave below both of them and doing
     *   their work for them.
     *
     * Nothing that carries survives being cut. The cabinet's horn and the
     * octave-down buzz under the glottal source are on every rung — they are
     * two of the cheapest nodes here and they are most of why the town sounds
     * like a blown speaker with a person behind it — and near and alone, a
     * fighter still gets the whole machine.
     */
    const q = quality | 0;
    const full = q >= 2;          // the carrier hiss and the oversampled fizz
    const formants = q >= 1 ? 3 : 2;
    const ceiling = q >= 1;       // the cabinet's top end (redundant once far)
    const t0 = ctx.currentTime + when;
    const toks = String(line).trim().split(/\s+/).filter(Boolean);
    // total length first, so the source can be started and stopped exactly
    let total = 0;
    for (const p of toks) total += this._dur(p) / rate;
    total = Math.max(0.05, total) + 0.06;

    /* --- the cabinet: everything ends up here ----------------------- */
    const out = ctx.createGain();
    out.gain.value = gain;
    const band = ctx.createBiquadFilter();     // the speaker's low end
    band.type = 'highpass'; band.frequency.value = 260; band.Q.value = 0.6;
    const crunch = ctx.createWaveShaper();
    crunch.curve = this.curve;
    // Oversampling a waveshaper is two extra resampling passes per block. It
    // is what keeps the fizz from aliasing on a voice you can hear the top of;
    // on one that has already lost its top to distance there is nothing up
    // there left to alias.
    crunch.oversample = full ? '2x' : 'none';
    // The horn stays on every rung. It is one biquad — the cheapest thing in
    // this chain — and it is most of what makes the town sound like it is
    // talking through a cabinet rather than through a synthesiser, which is
    // exactly the wrong thing to spend on a saving this small.
    const horn = ctx.createBiquadFilter();     // the honk of a cone in a box
    horn.type = 'peaking'; horn.frequency.value = 1700; horn.Q.value = 1.1; horn.gain.value = 5;
    let chain = band.connect(horn);
    if (ceiling) {
      const top = ctx.createBiquadFilter();    // ...and its ceiling
      top.type = 'lowpass'; top.frequency.value = 3400 - grit * 900; top.Q.value = 0.8;
      chain = chain.connect(top);
    }
    chain.connect(crunch).connect(out).connect(dest);

    /* --- the glottal source: a buzz, and a coarse one ---------------- */
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    // A square an octave down adds body, and body is the half of a voice that
    // SURVIVES the distance — so this one is never the thing that is dropped.
    const buzz = ctx.createOscillator();
    buzz.type = 'square';
    const buzzG = ctx.createGain();
    buzzG.gain.value = 0.3;
    const glottal = ctx.createGain();
    glottal.gain.value = 0.0001;
    src.connect(glottal);
    buzz.connect(buzzG).connect(glottal);

    // resonators in parallel = one vowel. The third is what makes it sound
    // like a person rather than a vowel; it is the first thing distance takes.
    const fs = [];
    for (let i = 0; i < formants; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = [9, 11, 13][i];
      const g = ctx.createGain();
      g.gain.value = [1.0, 0.62, 0.3][i];
      glottal.connect(f).connect(g).connect(band);
      fs.push(f);
    }

    /* --- the noise channel: fricatives, stop bursts, and the hiss ---- */
    const nz = ctx.createBufferSource();
    nz.buffer = this.noise;
    nz.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 2000;
    nf.Q.value = 2;
    const nG = ctx.createGain();
    nG.gain.value = 0.0001;
    nz.connect(nf).connect(nG).connect(band);
    // Carrier hiss: always there, always just under the words — and at 0.012
    // it is under them by enough that the far rung, which is quieter still and
    // low-passed on the way out, spends a source, a filter and a gain on
    // something no ear resolves. Near voices keep it.
    let hiss = null, hG = null;
    if (full) {
      hiss = ctx.createBufferSource();
      hiss.buffer = this.noise;
      hiss.loop = true;
      const hf = ctx.createBiquadFilter();
      hf.type = 'bandpass'; hf.frequency.value = 2400; hf.Q.value = 0.7;
      hG = ctx.createGain();
      hG.gain.value = 0.012 * grit;
      hiss.connect(hf).connect(hG).connect(band);
    }

    /* --- lay the line out ------------------------------------------- */
    let t = t0;
    // Pitch DECLINATION: every spoken phrase falls across its own length. A
    // line delivered on one note is the single loudest tell that a voice was
    // synthesised, and it costs one ramp to fix.
    const f0End = f0 * (0.86 - shout * 0.05);
    const pitchAt = (u) => {
      const f = (f0 * (1 + shout * 0.22)) * (1 - u) + f0End * u;
      // quantised, the way a speech chip's pitch register was
      return Math.round(f / 3.2) * 3.2;
    };
    src.frequency.setValueAtTime(pitchAt(0), t0);
    buzz.frequency.setValueAtTime(pitchAt(0) * 0.5, t0);

    for (const p of toks) {
      const d = this._dur(p) / rate;
      const u = Math.min(1, (t - t0) / total);
      const f = pitchAt(u) * (1 + Math.sin((t - t0) * 21) * 0.012);
      src.frequency.setValueAtTime(f, t);
      buzz.frequency.setValueAtTime(f * 0.5, t);

      if (p === '.' || p === ',') {
        glottal.gain.setTargetAtTime(0.0001, t, 0.012);
        nG.gain.setTargetAtTime(0.0001, t, 0.012);
      } else if (STOPS[p]) {
        const [bf, bq, bl, cl] = STOPS[p];
        glottal.gain.setTargetAtTime(0.0001, t, 0.006);        // the closure
        nG.gain.setTargetAtTime(0.0001, t, 0.006);
        const at = t + cl / rate;
        nf.frequency.setValueAtTime(bf, at);                   // ...then the burst
        nf.Q.setValueAtTime(bq, at);
        nG.gain.setValueAtTime(bl * (0.7 + shout * 0.5), at);
        nG.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      } else if (FRICATIVES[p]) {
        const [ff, fq, fl] = FRICATIVES[p];
        glottal.gain.setTargetAtTime(0.0001, t, 0.01);
        nf.frequency.setTargetAtTime(ff, t, 0.012);
        nf.Q.setTargetAtTime(fq, t, 0.012);
        nG.gain.setTargetAtTime(fl * (0.7 + shout * 0.4), t, 0.012);
      } else {
        const v = VOWELS[p] || VOICED[p] || VOWELS.uh;
        // Shouting opens the mouth: F1 rises, which is audibly what a raised
        // voice does and is why a shouted vowel is a different vowel.
        const open = 1 + shout * 0.16;
        for (let i = 0; i < fs.length; i++) fs[i].frequency.setTargetAtTime(v[i] * (i === 0 ? open : 1), t, 0.022);
        glottal.gain.setTargetAtTime(v[3] * (0.6 + shout * 0.5), t, 0.016);
        nG.gain.setTargetAtTime(0.0001, t, 0.02);
      }
      t += d;
    }
    // release
    glottal.gain.setTargetAtTime(0.0001, t, 0.02);
    nG.gain.setTargetAtTime(0.0001, t, 0.02);
    hG?.gain.setTargetAtTime(0.0001, t + 0.02, 0.03);
    out.gain.setValueAtTime(gain, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    const stop = t + 0.14;
    src.start(t0); src.stop(stop);
    buzz.start(t0); buzz.stop(stop);
    nz.start(t0); nz.stop(stop);
    if (hiss) { hiss.start(t0); hiss.stop(stop); }
    // Let the line go when it is over. Nothing here was ever disconnected, so
    // a long run left a graph of every sentence the town had ever spoken —
    // silent, since each one's output gain is ramped to nothing, but still
    // resident and still summed every block. Cutting the one edge that reaches
    // the bus makes the whole chain unreachable and it is collected.
    src.onended = () => { try { out.disconnect(); } catch { /* already gone */ } };
    return total;
  }

  _dur(p) {
    if (p === '.') return DUR.pause * 1.6;
    if (p === ',') return DUR.pause;
    if (STOPS[p]) return DUR.stop + STOPS[p][3];
    if (FRICATIVES[p]) return DUR.fric;
    if (VOWELS[p]) return DUR.vowel;
    return DUR.voiced;
  }
}
