import { VoiceKit, hz, rng } from './MusicVoices.js';
import { TRACKS, ZONE_TRACKS } from './MusicTracks.js';

/**
 * THE DYNAMIC SOUNDTRACK.
 *
 * A look-ahead scheduler and a two-layer vertical mixer. It does three jobs:
 *
 *  1. PLAYS THE RIGHT PIECE. The district you are standing in has a track; so
 *     do the title screen, dying and winning. Changing track is a real
 *     cross-fade — both pieces keep playing and keep being scheduled for the
 *     length of the fade — so walking through a district gate never cuts the
 *     music off mid-phrase.
 *
 *  2. PLAYS THE RIGHT VERSION OF IT. Every track exists as a `calm` and a
 *     `danger` arrangement built on the same root, tempo and bar grid (see
 *     MusicTracks.js). Below 25% health the mix slides to `danger`; patch
 *     yourself back up past 32% and it slides back. The hysteresis is the
 *     point — a score that flickers between two arrangements while you sit on
 *     exactly a quarter health is worse than either of them.
 *
 *  3. STAYS OUT OF THE WAY. The whole score runs about 14 dB under the
 *     effects bus, everything above 3 kHz is rolled off so it never competes
 *     with a gunshot's crack, and each shot ducks the music by a hair (see
 *     `duck`) — enough that the mix breathes around the shooting rather than
 *     fighting it.
 *
 * SCHEDULING. Notes are scheduled against the AudioContext clock, never
 * against frames: `pump()` runs on a short interval, works out which 16th-note
 * steps fall inside the next LOOKAHEAD seconds and books them at absolute
 * times. A dropped frame, a long GC or a background tab throttling the timer
 * therefore cannot make the music stutter; it can only make the scheduler run
 * late, which is caught by the resync below.
 *
 * WHY THE LOOPS ARE CLEAN. They are not loops. Nothing is rendered and butted
 * against itself: the step counter simply wraps and the same eight bars are
 * scheduled again, so a pad's release and a bell's tail cross the wrap the way
 * they would in a room. There is no join to hear.
 */

const LOOKAHEAD = 0.42;      // seconds of music booked in advance
const TICK_MS = 40;          // how often we top that up
const RESYNC = 0.9;          // a scheduler this far behind gives up and re-zeros
const XFADE = 2.2;           // seconds, track -> track
const VFADE = 1.15;          // seconds, calm <-> danger
// Where the lights go out. Pitched high on purpose: a quarter health is a
// player who is already dead in most fights, and a score that only warns them
// then is a score that never warns them. Forty-five per cent is the point at
// which the next mistake is the last one, and the gap up to the exit threshold
// is what stops a player parked on the line getting a strobing arrangement.
const LOW_ENTER = 0.45;      // health fraction that turns the lights off...
const LOW_EXIT = 0.53;       // ...and the one that turns them back on
const AUDIBLE = 0.002;       // below this a variant stops being scheduled

/** Scale degree (any integer, negative or past the octave) -> semitones. */
function degree(scale, d) {
  const n = scale.length;
  const oct = Math.floor(d / n);
  return scale[((d % n) + n) % n] + 12 * oct;
}

/** Parse a 16-step pattern into [{ step, ch, hold }]. '-' extends its note. */
function parsePattern(pat) {
  const out = [];
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '.') continue;
    if (ch === '-') { if (out.length) out[out.length - 1].hold++; continue; }
    out.push({ step: i, ch, hold: 0 });
  }
  return out;
}

const PAT_DEGREE = { x: 0, 3: 2, 5: 4, 7: 6 };

export class MusicDirector {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dest  the music bus (its own volume slider lives there)
   */
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.kit = new VoiceKit(ctx);
    this.enabled = true;

    // duck bus -> gentle limiter -> the music volume node the settings drive
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;
    const soft = ctx.createDynamicsCompressor();
    soft.threshold.value = -22;
    soft.knee.value = 20;
    soft.ratio.value = 3;
    soft.attack.value = 0.02;
    soft.release.value = 0.35;
    // Everything above ~3.2 kHz is the effects bus's to own. Rolling the score
    // off here is what lets it sit at a listenable level without ever masking
    // the crack of a rifle or the tell before an exploder goes off.
    const tilt = ctx.createBiquadFilter();
    tilt.type = 'lowpass';
    tilt.frequency.value = 3200;
    tilt.Q.value = 0.4;
    this.bus = ctx.createGain();
    this.bus.connect(this.duckGain).connect(tilt).connect(soft).connect(dest);

    this.slots = [];          // live tracks (2 while cross-fading)
    this.current = null;      // id of the track being faded IN
    this.danger = 0;          // smoothed 0..1
    this.dangerTarget = 0;
    this.intensity = 0.5;     // smoothed 0..1 (wave pressure -> drum level)
    this.intensityTarget = 0.5;
    this._duckAt = -1;
    this._timer = setInterval(() => this.pump(), TICK_MS);
  }

  /* ---------------- transport ---------------- */

  /** Cross-fade to a track by id. Re-selecting the live track does nothing. */
  play(id, { fade = XFADE, restart = false } = {}) {
    if (!TRACKS[id]) return;
    if (this.current === id && !restart) return;
    this.current = id;
    for (const s of this.slots) s.fade = -1 / Math.max(0.05, fade);
    const spec = TRACKS[id];
    const slot = {
      id, spec,
      out: this.ctx.createGain(),
      level: 0,
      fade: 1 / Math.max(0.05, fade),
      step: 0,
      next: this.ctx.currentTime + 0.08,
      stepDur: 60 / spec.bpm / 4,
      loop: spec.bars * 16,
      variants: {},
    };
    slot.out.gain.value = 0;
    slot.out.connect(this.bus);
    for (const key of ['calm', 'danger']) {
      const arr = spec[key];
      if (!arr) continue;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(slot.out);
      // Percussion has its own sub-bus so the wave pressure can lift the drums
      // without touching the harmony under them (see setIntensity).
      const beat = this.ctx.createGain();
      beat.gain.value = 1;
      beat.connect(gain);
      slot.variants[key] = { arr, gain, beat, drones: null, level: 0 };
    }
    this.slots.push(slot);
    // Two tracks is a cross-fade; three is a pile-up. If the player runs
    // through two gates inside one fade, the oldest is dropped outright.
    while (this.slots.length > 2) this._kill(this.slots.shift());
  }

  /** Where the score is pointed: a zone id, or a named track. */
  playZone(zoneId) { this.play(ZONE_TRACKS[zoneId] ?? ZONE_TRACKS[0]); }

  stop({ fade = 1.2 } = {}) {
    this.current = null;
    for (const s of this.slots) s.fade = -1 / Math.max(0.05, fade);
  }

  dispose() {
    clearInterval(this._timer);
    for (const s of this.slots) this._kill(s);
    this.slots.length = 0;
  }

  /* ---------------- the two live parameters ---------------- */

  /**
   * Drive the calm/danger mix off the player's health, with hysteresis so a
   * player parked on the threshold does not get a strobing arrangement.
   */
  setHealth(frac) {
    if (!Number.isFinite(frac)) return;
    if (this.dangerTarget > 0.5) { if (frac >= LOW_EXIT) this.dangerTarget = 0; }
    else if (frac < LOW_ENTER) this.dangerTarget = 1;
  }

  /** 0..1: how much of a fight is on. Lifts the drums, nothing else. */
  setIntensity(v) { this.intensityTarget = Math.max(0, Math.min(1, v)); }

  /** Force the mix (dev console / the death and title screens). */
  setDanger(v) { this.dangerTarget = Math.max(0, Math.min(1, v)); }

  /** A shot was fired: dip the score for a beat so the crack has the room. */
  duck(amount = 0.16) {
    const t = this.ctx.currentTime;
    if (t - this._duckAt < 0.13) return;   // rate-limited: no pumping on full auto
    this._duckAt = t;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(Math.max(0.55, 1 - amount), t + 0.02);
    g.linearRampToValueAtTime(1, t + 0.30);
  }

  /* ---------------- per-frame smoothing ---------------- */

  update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    const now = this.ctx.currentTime;
    // variant mix (equal power, so the two arrangements sum to a steady level)
    this.danger += (this.dangerTarget - this.danger) * Math.min(1, d / VFADE * 2.4);
    this.intensity += (this.intensityTarget - this.intensity) * Math.min(1, d * 0.8);
    const cal = Math.cos(this.danger * Math.PI / 2);
    const dan = Math.sin(this.danger * Math.PI / 2);
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      s.level = Math.max(0, Math.min(1, s.level + s.fade * d));
      s.out.gain.setTargetAtTime(s.level * s.level * (2 - s.level * s.level), now, 0.03);
      if (s.fade < 0 && s.level <= 0.0005) { this._kill(s); this.slots.splice(i, 1); continue; }
      const beat = 0.42 + 0.58 * this.intensity;
      for (const [key, v] of Object.entries(s.variants)) {
        v.level = key === 'danger' ? dan : cal;
        v.gain.gain.setTargetAtTime(v.level, now, 0.03);
        v.beat.gain.setTargetAtTime(beat, now, 0.06);
        this._drones(s, key, v.level * s.level > AUDIBLE);
      }
    }
  }

  /* ---------------- scheduler ---------------- */

  pump() {
    if (!this.ctx || !this.enabled || this.ctx.state === 'suspended') return;
    try { this._pump(); } catch (e) {
      // A score is a luxury; the game is not. If the scheduler ever throws it
      // takes itself off the air rather than throwing once per tick forever.
      this.enabled = false;
      clearInterval(this._timer);
      console.warn('soundtrack disabled:', e && e.message);
    }
  }

  _pump() {
    const now = this.ctx.currentTime;
    const until = now + LOOKAHEAD;
    for (const s of this.slots) {
      // A tab that was in the background wakes up with its next step minutes
      // in the past. Booking all of them would empty the pattern into one
      // frame, so the transport simply re-zeros on the current time instead.
      if (s.next < now - RESYNC) s.next = now + 0.05;
      let guard = 512;
      while (s.next < until && guard-- > 0) {
        this._step(s, s.step, s.next);
        s.step = (s.step + 1) % s.loop;
        s.next += s.stepDur;
      }
    }
  }

  _step(slot, step, when) {
    for (const [key, v] of Object.entries(slot.variants)) {
      if (v.level * slot.level <= AUDIBLE) continue;   // silent: don't build it
      const arr = v.arr;
      for (const layer of arr.layers || []) this._layer(slot, arr, layer, v, step, when);
    }
  }

  _layer(slot, arr, layer, v, step, when) {
    const spec = slot.spec;
    const bar = (step / 16) | 0;
    const b16 = step % 16;
    const prog = arr.prog || spec.prog;
    const root = prog[bar % prog.length];
    const sd = slot.stepDur;
    const dest = layer.k === 'perc' && layer.kind !== 'heart' ? v.beat : v.gain;
    const scale = spec.scale;
    const f = (deg, oct) => hz(spec.root, degree(scale, deg) + 12 * (oct || 0));

    switch (layer.k) {
      case 'pad': {
        const every = layer.every || 1;
        if (b16 !== 0 || bar % every !== 0) return;
        const dur = every * 16 * sd * 0.98;
        for (const t of layer.tones) {
          this.kit[layer.voice](dest, f(root + t, layer.oct), when, dur, layer.gain, layer.opts);
        }
        return;
      }
      case 'bass': {
        layer._p ??= parsePattern(layer.pat);
        for (const n of layer._p) {
          if (n.step !== b16) continue;
          const oct = n.ch === 'o' ? 1 : n.ch === 'l' ? -1 : 0;
          const deg = root + (PAT_DEGREE[n.ch] ?? 0) + oct * scale.length;
          const dur = n.hold ? (n.hold + 1) * sd * 0.96 : layer.dur;
          this.kit[layer.voice](dest, f(deg, layer.oct), when, dur, layer.gain, layer.opts);
        }
        return;
      }
      case 'arp': {
        const rate = layer.rate || 2;
        if (step % rate !== 0) return;
        const span = layer.span || 1;
        const tones = [];
        for (let o = 0; o < span; o++) for (const t of [0, 2, 4]) tones.push(root + t + o * scale.length);
        const i = (step / rate) | 0;
        const n = tones.length;
        const idx = layer.order === 'down' ? n - 1 - (i % n)
          : layer.order === 'updown' ? (i % (2 * n - 2) < n ? i % (2 * n - 2) : 2 * n - 2 - (i % (2 * n - 2)))
            : i % n;
        this.kit[layer.voice](dest, f(tones[idx], layer.oct), when, layer.dur, layer.gain, layer.opts);
        return;
      }
      case 'seq': {
        for (const [at, deg, len] of layer.notes) {
          if (at !== step) continue;
          this.kit[layer.voice](dest, f(deg, layer.oct), when, len * sd * 0.94, layer.gain, layer.opts);
        }
        return;
      }
      case 'perc': {
        if (layer.kind === 'heart') {
          // The pulse rides the danger mix itself: the closer to death, the
          // faster and harder the two thumps land.
          if (!layer.at.includes(b16)) return;
          const push = 0.7 + 0.5 * this.danger;
          this.kit.heartbeat(v.gain, when, layer.gain * push, push);
          return;
        }
        const r = rng(step * 2654435761 + (layer.gain * 1e5 | 0));
        const hit = (pat, fn) => {
          if (!pat) return;
          const ch = pat[b16 % pat.length];
          if (ch === '.' || ch === undefined || ch === '-') return;
          fn(r());
        };
        hit(layer.kick, () => this.kit.kick(dest, when, layer.gain));
        hit(layer.snare, (j) => this.kit.snare(dest, when, layer.gain * (0.85 + j * 0.3)));
        hit(layer.hat, (j) => this.kit.hat(dest, when, layer.gain * (0.30 + j * 0.22)));
        hit(layer.open, () => this.kit.hat(dest, when, layer.gain * 0.4, { open: true }));
        hit(layer.clank, (j) => this.kit.clank(dest, when, layer.gain * 0.7, 380 + j * 340));
        return;
      }
      case 'sparse': {
        if (b16 !== (layer.step ?? 0) || !layer.bars.includes(bar)) return;
        const g = layer.gain;
        if (layer.voice === 'static') this.kit.static_(dest, when, layer.dur, g);
        else if (layer.voice === 'swell') this.kit.swell(dest, when, layer.dur, g, layer.opts);
        else this.kit[layer.voice](dest, f(root, layer.oct), when, layer.dur, g);
        return;
      }
      default:
    }
  }

  /** Start or stop a variant's continuous voices as it becomes (in)audible. */
  _drones(slot, key, on) {
    const v = slot.variants[key];
    const specs = v.arr.drones;
    if (!specs || !specs.length) return;
    if (on && !v.drones) {
      const when = this.ctx.currentTime + 0.02;
      v.drones = specs.map((d) => this.kit.drone(
        v.gain, hz(slot.spec.root, d.semi), when, d.gain,
        { cutoff: d.cutoff, sweep: d.sweep }));
    } else if (!on && v.drones) {
      const at = this.ctx.currentTime + 0.05;
      for (const d of v.drones) { d.gain.gain.cancelScheduledValues(at); d.stop(at); }
      v.drones = null;
    }
  }

  _kill(slot) {
    for (const key of Object.keys(slot.variants)) this._drones(slot, key, false);
    const at = this.ctx.currentTime + 0.1;
    try { slot.out.gain.cancelScheduledValues(at); slot.out.gain.setValueAtTime(0, at); } catch { /* closed */ }
    setTimeout(() => { try { slot.out.disconnect(); } catch { /* gone */ } }, 400);
  }
}

export { ZONE_TRACKS, TRACKS };
