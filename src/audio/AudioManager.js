import { MusicDirector, ZONE_TRACKS } from './Music.js';
import { SpeechSynth } from './Speech.js';
import { ENEMY_VOICES, voiceKeyFor } from './EnemyVoices.js';

/**
 * All game audio, synthesized with WebAudio — no sound files.
 *
 * Per-weapon gunshots, reload/empty clicks, surface-aware footsteps, pickup
 * chimes, zombie moans/growls (ambient intensity scales with how many are
 * nearby, positioned in stereo), wave horns, unlock rumbles, cosmic-horror
 * whispers and the victory fanfare.
 *
 * Everything is event-driven; systems never call into audio directly.
 *
 * TWO BUSES, TWO SLIDERS. Effects go through `master` (a bus compressor that
 * gives the guns their punch); the dynamic soundtrack goes through `musicOut`
 * with its own level, its own limiter and its own roll-off (see audio/Music.js).
 * They are separate all the way to the destination, which is what makes the
 * settings screen's SOUNDTRACK and EFFECTS sliders mean two different things
 * rather than two names for the same knob.
 */

/** Reference distance for a shouted voice, in metres: the range at which it
 *  has fallen to half strength. Deliberately short — a street fight is close
 *  work, and the whole point is that ten metres and thirty sound different. */
const VOICE_REF = 7;

/* ============================ THE VOICE GOVERNOR ============================
 *
 * Every sound in this game is BUILT: a gunshot is five or six little graphs of
 * oscillators, filters and gains, made from nothing, played once and thrown
 * away. That is what gives the town its voice, and it is also the one thing
 * that can take the voice away — WebAudio renders the whole live graph inside
 * a real-time callback, so the cost of a sound is not paid when it is fired,
 * it is paid every 128 frames for as long as it is sounding. Nothing in the
 * design stops fifteen fighters, four sentries, a wall coming down and a
 * magazine of rifle fire from all being resident at the same instant, and when
 * the render thread misses its deadline the hardware gets silence: the audio
 * does not get quieter, it CUTS OUT, and the main thread stalls behind it.
 *
 * Three rules keep the graph inside its budget, and none of them changes what
 * anything sounds like when there is room:
 *
 *   AUDIBLE. A layer scheduled below this gain is not a quiet layer, it is an
 *   inaudible one — it costs a full node chain to contribute nothing. The
 *   recipes are full of detail layers at 0.02 that are already scaled by
 *   distance before they get here, so a blast across the map used to build
 *   thirty graphs nobody could hear.
 *
 *   THE CAP. Past VOICE_CAP simultaneous one-shots the mix is already denser
 *   than anyone can pick anything out of, so new layers have to clear a rising
 *   loudness floor to get in. The floors are set so the LEAD of every sound
 *   still fires — a gunshot's body is 0.4-0.6, an explosion's 0.5, a voice's
 *   0.5 — and it is the trailing detail (the brass tick, the third echo, the
 *   ring-off) that stands down. That is the correct thing to lose: the shot is
 *   gameplay, the ring-off is decoration.
 *
 *   THE RACK. Panning is per-sound but it is never automated, so there is no
 *   reason for a hundred sounds to own a hundred panner nodes. They share one
 *   rack of seventeen, cut as they are called for and quantised to a sixteenth
 *   of the stereo field — far finer than anyone localises. That takes a node
 *   off every sound in the game, gives dead centre (which is most of them:
 *   every weapon, every footstep, every chime) no panner at all, and leaves
 *   the render thread a bounded number of them however loud the street gets.
 */
/** Below this a scheduled layer cannot be heard; it is not built. */
const AUDIBLE = 0.0025;
/** One-shot voices past which new layers must earn their slot. */
const VOICE_CAP = 44;
/** ...and the ceiling nothing gets past, however loud. */
const VOICE_MAX = 132;
/** Panner rack resolution: pan is rounded to 1/PAN_STEPS of a side. */
const PAN_STEPS = 8;
/** How much lead the audio clock actually needs. A layer booked further out
 *  than this is not booked yet — see THE DRIP. */
const SCHEDULE_AHEAD = 0.14;
/** Ceiling on layers waiting in the drip queue. */
const DEFER_MAX = 640;
/** Fighters who may be mid-sentence at once. Speech is by far the most
 *  expensive voice in the game (a formant synth is a dozen nodes and four live
 *  sources), and a street where five people talk over each other is a street
 *  where you understand none of them, so the cap costs nothing legible. */
const SPEECH_CAP = 4;

export class AudioManager {
  constructor(events) {
    this.events = events;
    this.ctx = null;
    this.master = null;
    // Two independent levels, both settable before or after the context is
    // unlocked (the settings are loaded and applied before the first gesture).
    this.sfxVolume = 0.5;
    this.musicVolume = 0.5;
    this.music = null;   // MusicDirector, once the context exists
    this._track = null;  // what the score is currently pointed at
    this._musicOn = true;
    this.speech = null;   // SpeechSynth, once the context exists
    // Who has said something lately, so a street full of fighters sounds like
    // a street full of fighters and not like a choir (see enemyLine).
    this._lastLine = 0;
    this._lastByState = new Map();
    this._lineSeq = new Map();
    this._noiseBuf = null;
    // The governor's books: the context-time at which each live one-shot frees
    // its slot, and the same for speech. Times only — no node references — so
    // holding the ledger can never be what keeps a graph alive.
    this._live = [];
    this._speechEnds = [];
    // THE DRIP: [dueTime, build, dueTime, build, ...] — layers whose moment has
    // not come round yet. See _defer.
    this._deferred = [];
    this._panRack = null;
    this.moanIntensity = 0;
    this._moanTimer = 1;
    this._whisperTimer = 30;
    this.listener = { x: 0, z: 0, yaw: 0 };

    const on = events.on.bind(events);
    on('weapon:fire', ({ weapon, sound }) => this.gunshot(sound ?? weapon.config.sound));
    on('melee:swing', ({ hit }) => { this.whoosh(); if (hit) this.thud(); });
    on('weapon:reload:start', ({ weapon, tactical, duration }) =>
      this.reload(duration ?? weapon.config.reloadTime, weapon.config.id, tactical));
    on('weapon:empty', () => this.emptyClick());
    on('weapon:switch', ({ weapon }) => this.equipSound(weapon.config.id));
    on('footstep', ({ surface, sprinting }) => this.footstep(surface, sprinting));
    on('pickup', ({ type }) => (type === 'health' ? this.healthChime()
      : type === 'key' ? this.keyChime()
      : type === 'companionCube' ? this.cubeChime()
      : type?.startsWith('coin_') ? this.coinChime(type)
      : type === 'sentry' ? this.sentryStow()
      : this.ammoChime()));
    on('player:damage', () => this.hurt());
    on('player:heal', () => {});
    on('player:died', () => this.deathSting());
    on('zombie:death', ({ pos, type, voice }) => {
      this.zombieDeath(pos);
      this.enemyLine('die', type, voice, pos, { force: true, gain: 1.15 });
    });
    on('zombie:hit', ({ pos, zombie }) => this.enemyLine('hurt', zombie?.config, zombie?.voice, pos));
    on('zombie:attack', ({ pos, type, voice }) => this.enemyLine('attack', type, voice, pos, { force: true }));
    on('zombie:spot', ({ pos, type, voice }) => this.enemyLine('spot', type, voice, pos, { force: true }));
    // The horde's own chatter — invocations when nobody has found anybody,
    // position calls once they are coming for you. One event, two pools; the
    // fighter decides which by whether he is hunting (see Zombie).
    on('zombie:chatter', ({ pos, type, voice, hunting }) =>
      this.enemyLine(hunting ? 'prowl' : 'idle', type, voice, pos,
        { gain: hunting ? 0.8 : 0.62, maxDist: hunting ? 40 : 32 }));
    // THE BOMBER'S CALL, in two parts.
    //
    // The full takbir goes off when he COMMITS to his run — ten metres out,
    // with a clear line — because that is the moment the warning is still
    // worth something: a second and a bit of shouting while he crosses the
    // last of the ground, which is exactly long enough to turn and put rounds
    // into him or to get behind something. Hanging it on the fuse instead
    // would have been honest and useless; the fuse is a quarter of a second
    // and the line is five times that, so the player would have heard the
    // first syllable and then the blast.
    //
    // The fuse gets the last syllable of it, clipped, higher and louder — the
    // sound of somebody out of breath and out of distance.
    on('exploder:prime', ({ pos, type, voice }) =>
      this.enemyLine('prime', type, voice, pos, { force: true, gain: 1.6, shout: 1, maxDist: 52 }));
    on('exploder:fuse', ({ pos, type, voice }) =>
      this.enemyLine('fuse', type, voice, pos, {
        force: true, gain: 1.9, shout: 1, rate: 2.1, maxDist: 46,
      }));
    on('spitter:aim', ({ pos, type, voice }) => this.enemyLine('aim', type, voice, pos, { force: true }));
    on('exploder:explode', ({ pos }) => this.explosion(pos));
    on('barrier:explode', (b) => this.barrierBlast(b));
    on('spitter:fire', ({ pos }) => this.spitterShot(pos));
    on('sentry:fire', ({ pos, kind }) => this.sentryShot(pos, kind));
    on('sentry:deployed', ({ pos, kind }) => this.sentryDeploy(pos, kind));
    // The Mk II changing its own drum, cutting a mark, and the two machines
    // saying hello to each other.
    on('sentry:reload', ({ pos }) => this.sentryReload(pos));
    on('sentry:tally', ({ pos }) => this.sentryTally(pos));
    on('sentry:handshake', ({ pos }) => this.sentrySalute(pos));
    on('sentry:salute', ({ pos }) => this.sentrySalute(pos));
    on('sentry:wake', ({ pos }) => this.sentryWake(pos));
    // ...and the Mk II's other half: the sixteen beats of its deploy, the
    // heartbeat of the thing in its jar, the plumbing that keeps it alive, and
    // the field-telephone earpiece it talks through.
    on('sentry:deploy:beat', ({ pos, beat }) => this.wardenBeat(pos, beat));
    on('sentry:pulse', ({ pos, rate, strength }) => this.wardenPulse(pos, rate, strength));
    on('sentry:vessel', ({ pos, kind }) => this.wardenVessel(pos, kind));
    on('sentry:voice', ({ pos, phrase }) => this.wardenVoice(pos, phrase));
    // The adjutant's voice. Everything she says goes through one door.
    on('companion:deployed', ({ pos }) => this.companionVoice('wake', pos));
    on('companion:ack', ({ cmd, pos }) => this.companionVoice(cmd === 'passive' ? 'no' : 'ack', pos));
    on('companion:blade', ({ pos }) => this.companionVoice('blade', pos));
    on('companion:arc', ({ from }) => this.companionVoice('arc', from));
    on('companion:recalled', () => this.companionVoice('fold', null));
    on('vendor:greet', ({ pos }) => this.vendorWake(pos));
    on('shop:bought', () => this.tillChime());
    on('tokens:refused', () => this.tillRefuse());
    on('zombie:aggro', ({ pos, type, voice }) => {
      this.growl(pos, type);
      this.enemyLine('chase', type, voice, pos, { force: true });
    });
    on('wave:start', () => this.horn());
    on('zone:unlock', () => this.rumble());
    on('secret:found', () => this.secretChime());
    on('secret:bell', () => this.bell());
    on('whisper', ({ intensity }) => this.whisper(intensity ?? 0.6));
    on('anomaly:sound', ({ kind, pos }) => this.displaced(kind, pos));
    on('phone:ring', ({ pos }) => this.phoneRing(pos));
    on('phone:answer', () => this.phoneVoice());
    on('car:alarm', ({ pos }) => this.carChirp(pos));
    on('elevator:call', ({ pos }) => this.elevatorHum(pos));
    on('pump:try', ({ pos }) => this.pumpCough(pos));
    // The wave-five sighting: one continuous voice, tracked, then the bang.
    on('ufo:enter', () => this.ufoEnter());
    on('ufo:track', ({ pos, vel, k }) => this.ufoTrack(pos, vel, k));
    on('ufo:exit', () => this.ufoExit());
    on('ufo:impact', ({ pos }) => this.ufoImpact(pos));
    on('crow:caw', ({ pos }) => this.crowCaw(pos));
    on('arcade:attract', ({ pos, id }) => this.arcadeAttract(pos, id));
    on('victory', () => this.fanfare());

    /* --- the score reacts to the same events everything else does ------- *
     * The music is not driven by polling wherever it can be helped: a wave
     * landing, a district opening and a death are moments, and a moment is an
     * event. Only the two CONTINUOUS quantities — which district you are
     * standing in and how much health you have left — are read per frame in
     * update(), because those are states, not moments.                     */
    on('wave:start', () => this.music?.setIntensity(1));
    on('wave:end', () => this.music?.setIntensity(0.25));
    on('player:died', () => this.setTrack('death'));
    on('victory', () => this.setTrack('victory'));
    // Each shot dips the score a hair so the crack has room. Free of charge
    // on a melee swing, which has nothing to make room for.
    on('weapon:fire', ({ weapon }) => { if (!weapon?.isMelee) this.music?.duck(); });
    on('exploder:explode', () => this.music?.duck(0.24));
    on('barrier:explode', () => this.music?.duck(0.3));
  }

  /** Must be called from a user gesture (start button). */
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    /**
     * 'balanced', not the default 'interactive'.
     *
     * The hint picks the size of the buffer the render thread has to fill
     * before the deadline. 'interactive' asks for the smallest one the device
     * will give, which is the right answer for a metronome and the wrong one
     * for this: a town's worth of synthesised voices is a heavy render, and a
     * heavy render into a tiny buffer is exactly the shape of a dropout — one
     * overrun and the hardware is handed silence. 'balanced' roughly doubles
     * the deadline for something on the order of ten milliseconds of extra
     * latency, which is a quarter of a frame and below the threshold at which
     * a gunshot stops feeling like it belongs to the trigger pull.
     */
    try { this.ctx = new AC({ latencyHint: 'balanced' }); } catch { this.ctx = new AC(); }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.sfxVolume;
    // A bus compressor gives every gunshot its punch and keeps the loudest
    // weapon from swamping the mix — the shots are level-matched into it.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // The soundtrack's own path to the speakers: its own level, its own
    // limiter (inside MusicDirector), and deliberately NOT through the bus
    // compressor above — music that ducked every time a rifle went off would
    // pump, and the effects bus is tuned for transients, not for a pad.
    this.musicOut = this.ctx.createGain();
    this.musicOut.gain.value = this.musicVolume;
    this.musicOut.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.speech = new SpeechSynth(this.ctx, this._noiseBuf);
    // The shared panner rack is cut lazily, on the first sound that needs each
    // rung, and re-cut if the bus is ever swapped — see _bus.
    this._panRack = null;
    this._rackFor = null;
    try {
      this.music = new MusicDirector(this.ctx, this.musicOut);
      if (this._musicOn && this._track) this.music.play(this._track, { fade: 1.2 });
    } catch { this.music = null; }   // no score is survivable; a crash is not
  }

  /**
   * Point the soundtrack at a track by id (see audio/MusicTracks.js).
   *
   * Safe to call before the context exists — the request is remembered and
   * honoured the moment the player's first gesture unlocks audio, which is how
   * the title screen has music the instant it is allowed to.
   */
  setTrack(id) {
    if (this._track === id) return;
    this._track = id;
    this.music?.play(id);
  }

  /** Settings hook: EFFECTS level 0..1, applied live once unlocked. */
  setSfxVolume(v) {
    this.sfxVolume = clamp01(v, 0.5);
    if (this.master) this.master.gain.value = this.sfxVolume;
  }

  /** Settings hook: SOUNDTRACK level 0..1, applied live once unlocked. */
  setMusicVolume(v) {
    this.musicVolume = clamp01(v, 0.5);
    if (this.musicOut) {
      const t = this.ctx.currentTime;
      this.musicOut.gain.cancelScheduledValues(t);
      this.musicOut.gain.setValueAtTime(this.musicOut.gain.value, t);
      this.musicOut.gain.linearRampToValueAtTime(this.musicVolume, t + 0.08);
    }
  }

  /** Back-compat alias: one knob for both buses (dev console, old saves). */
  setVolume(v) { this.setSfxVolume(v); this.setMusicVolume(v); }

  get t() { return this.ctx.currentTime; }

  /* ================================ THE DRIP ================================
   *
   * A wall coming down is not one sound, it is sixty-six of them laid end to
   * end across five seconds: the breach, the charges walking its length, the
   * bed underneath, masonry coming off it the whole way, and the impact when
   * it lands. Every one of those used to be BUILT on the single frame the wall
   * broke — two hundred-odd nodes constructed back to back while the renderer
   * waited its turn — and then most of them sat in the graph doing nothing for
   * seconds before their scheduled moment arrived. That is the hitch the
   * player hears as "the sound lagged the game when it started": not the sound
   * playing, the sound being made.
   *
   * Nothing about the timing needs it to happen then. Every layer is booked at
   * an ABSOLUTE time on the audio clock, so a layer due in three seconds is
   * identical whether its nodes were created now or two hundred milliseconds
   * before it speaks — and the audio clock is the one clock in this program a
   * dropped frame cannot move. So anything further out than the scheduler's
   * lead is put on a queue and built a frame or two ahead of when it is due.
   *
   * The demolition becomes a handful of nodes on the frame of the blast and a
   * steady trickle after it, the reload choreography stops arriving as a lump,
   * and — because the governor now judges each layer at the moment it is
   * actually built — a wall that comes down in the middle of a firefight lays
   * down only the parts of itself the mix still has room for.
   */

  /**
   * Is there a frame loop to feed the drip?
   *
   * An OFFLINE context has no frames: it renders the whole timeline in one go
   * and then it is over. Queueing there would silently drop every layer past
   * the first 140 ms — the bolt cycle off the end of a sniper shot, the wall
   * landing at the end of a demolition — so offline, everything is booked
   * where it stands. The audio comes out identical either way; only WHEN the
   * nodes are made differs, and offline there is no main thread to spare.
   */
  get _dripping() { return typeof this.ctx?.startRendering !== 'function'; }

  /** Put a layer on the drip. `build(when)` is called with a fresh offset once
   *  its moment is close enough to hand to the scheduler. */
  _defer(at, build) {
    const q = this._deferred;
    if (q.length >= DEFER_MAX * 2) return;
    q.push(at, build);
  }

  /** Build everything on the drip that is now within the scheduler's lead. */
  _drainDeferred(now) {
    const q = this._deferred;
    if (!q.length) return;
    let n = 0;
    for (let i = 0; i < q.length; i += 2) {
      const at = q[i];
      if (at - now <= SCHEDULE_AHEAD) { q[i + 1](Math.max(0, at - now)); continue; }
      q[n++] = at;
      q[n++] = q[i + 1];
    }
    q.length = n;
  }

  /**
   * How many one-shot voices are still sounding, sweeping the finished ones out
   * of the ledger on the way past. The ledger holds numbers, not nodes, so this
   * is a walk over a small array of doubles — cheaper than the single node
   * allocation it is deciding about.
   */
  _voiceLoad(now) {
    const live = this._live;
    let n = 0;
    for (let i = 0; i < live.length; i++) if (live[i] > now) live[n++] = live[i];
    live.length = n;
    return n;
  }

  /**
   * Ask the governor for a slot (see THE VOICE GOVERNOR above).
   *
   * @param gain    the layer's peak level, already scaled by distance
   * @param endsAt  context time at which it stops sounding
   * @returns whether it is worth building
   */
  _claim(gain, endsAt, now) {
    if (!(gain > AUDIBLE)) return false;
    const n = this._voiceLoad(now);
    if (n >= VOICE_CAP) {
      if (n >= VOICE_MAX) return false;
      // A rising floor rather than a wall: the lead of every sound still
      // fires, the trailing detail stands down until the mix has room again.
      const floor = n >= VOICE_CAP * 2 ? 0.20 : n >= VOICE_CAP * 1.5 ? 0.08 : 0.03;
      if (gain < floor) return false;
    }
    this._live.push(endsAt);
    return true;
  }

  /**
   * The node a sound at this pan should feed: a rung of the shared panner rack,
   * or the bus itself for anything close enough to centre that a panner would
   * only be a node doing nothing. See THE VOICE GOVERNOR.
   */
  _bus(pan) {
    if (!this.ctx) return this.master;
    // A rung belongs to the bus it was cut for. Point the manager at a
    // different bus — which is what rendering the mix offline does — and the
    // old rack's nodes belong to a context this one cannot legally connect to,
    // so the rack goes with it.
    if (this._rackFor !== this.master) {
      this._rackFor = this.master;
      this._panRack = new Array(PAN_STEPS * 2 + 1).fill(null);
      this._panRack[PAN_STEPS] = this.master;
    }
    const rack = this._panRack;
    const i = PAN_STEPS + Math.max(-PAN_STEPS, Math.min(PAN_STEPS,
      Math.round((pan || 0) * PAN_STEPS)));
    let p = rack[i];
    if (!p) {
      p = this.ctx.createStereoPanner();
      p.pan.value = (i - PAN_STEPS) / PAN_STEPS;
      p.connect(this.master);
      rack[i] = p;
    }
    return p;
  }

  _noise(dur, filterType, freq, q, gain, when = 0, pan = 0, freqEnd = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (when > SCHEDULE_AHEAD && this._dripping) {   // not yet — see THE DRIP
      this._defer(now + when, (w) => this._noise(dur, filterType, freq, q, gain, w, pan, freqEnd));
      return;
    }
    const t0 = now + when;
    if (!this._claim(gain, t0 + dur + 0.05, now)) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this._bus(pan));
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  _tone(type, freq, dur, gain, when = 0, pan = 0, freqEnd = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (when > SCHEDULE_AHEAD && this._dripping) {   // not yet — see THE DRIP
      this._defer(now + when, (w) => this._tone(type, freq, dur, gain, w, pan, freqEnd));
      return;
    }
    const t0 = now + when;
    if (!this._claim(gain, t0 + dur + 0.05, now)) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this._bus(pan));
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /**
   * Stereo pan + attenuation for a world position.
   *
   * THE SIGN HERE IS THE WHOLE THING, and it was backwards: every positional
   * sound in the game came out of the opposite ear. A car alarm on your right
   * pulled you left, a zombie growling off your left shoulder read as being on
   * your right, and because it was consistently wrong across every source
   * there was nothing to compare it against — it just made the town feel
   * subtly untrustworthy to move around in.
   *
   * The derivation, so it cannot drift again. The camera looks down local −Z,
   * so at yaw `y` the player's forward is (−sin y, −cos y) and their RIGHT is
   * (cos y, −sin y). For an offset d = (dx, dz) at distance r:
   *
   *     ang      = atan2(dx, dz) − y
   *     sin(ang) = (dx·cos y − dz·sin y) / r  =  (d · right) / r
   *
   * So sin(ang) is ALREADY "how far to the right of the listener this is",
   * which is exactly what a StereoPanner wants as a positive value. The
   * leading minus was flipping it.
   */
  _spatial(pos, maxDist = 60) {
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist) return null;
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    return { pan: Math.max(-1, Math.min(1, Math.sin(ang) * 0.8)), vol: 1 - dist / maxDist, dist };
  }

  /* ---------------- weapons ---------------- */

  // A "punch": a low body tone with a fast downward pitch sweep. This is what
  // gives every gunshot its weight and thump before the noise crack.
  _punch(freq, freqEnd, dur, gain, when = 0, pan = 0, type = 'sine') {
    this._tone(type, freq, dur, gain, when, pan, freqEnd);
  }
  // A brass-mechanism tick — the steampunk action cycling after a shot.
  _brassTick(when = 0, gain = 0.09, pan = 0) {
    this._noise(0.02, 'highpass', 3200, 1, gain, when, pan);
    this._tone('square', 2600, 0.02, gain * 0.5, when + 0.005, pan, 1800);
  }

  /**
   * Per-weapon gunshots, matched to the second-generation models. Every
   * weapon has its own layered recipe (body punch + crack + a mechanism
   * voice unique to its action + tail) — no shared asset with pitch
   * variation — and the recipes are level-matched into the bus compressor
   * so no weapon rides louder than the rest.
   */
  gunshot(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'pistol': // mainspring machine pistol: blunt blowback slap, a heavy
        // bolt running its rails, and the coil mainspring singing as it rebounds
        this._punch(260, 62, 0.085, 0.57, 0, 0, 'square');
        this._noise(0.055, 'bandpass', 2400, 1.2, 0.52);
        this._noise(0.07, 'lowpass', 1500, 1, 0.42);               // body of the report
        this._tone('triangle', 1800, 0.03, 0.13, 0.03, -0.06, 900); // bolt hits the stop
        this._tone('sine', 3100, 0.11, 0.07, 0.05, 0.09, 2100);     // spring ring-off
        this._brassTick(0.075, 0.09);
        break;
      case 'pistolAuto': // hair-trigger: clipped so the spring ring can't smear
        this._punch(240, 76, 0.05, 0.42, 0, 0, 'square');
        this._noise(0.042, 'bandpass', 2600, 1.4, 0.42);
        this._tone('triangle', 1700, 0.02, 0.09, 0.022, -0.05, 1000);
        break;
      case 'shotgun': // coachgun: tight modern 12-bore slam + hammer clack
        this._punch(170, 34, 0.16, 0.36, 0, 0, 'sine');
        this._punch(72, 26, 0.3, 0.28, 0, 0, 'sine');
        this._noise(0.16, 'lowpass', 1400, 0.9, 0.35);             // sharp crack
        this._noise(0.08, 'bandpass', 3200, 1.2, 0.12);            // muzzle sizzle
        this._noise(0.34, 'lowpass', 480, 0.6, 0.1, 0.06);         // short tail
        this._tone('square', 1500, 0.02, 0.05, 0.002, 0.05, 900);  // hammer clack
        this._tone('sine', 2400, 0.05, 0.025, 0.05, 0.08, 1700);   // bore ring
        break;
      case 'shotgunDouble': // both barrels: stacked slams, the biggest voice
        this._punch(170, 30, 0.2, 0.4, 0, 0, 'sine');
        this._punch(140, 28, 0.22, 0.3, 0.02, 0, 'sine');
        this._punch(58, 22, 0.42, 0.27, 0, 0, 'sine');
        this._noise(0.2, 'lowpass', 1300, 0.9, 0.37);
        this._noise(0.5, 'lowpass', 420, 0.5, 0.12, 0.1);
        this._tone('square', 1500, 0.02, 0.05, 0.002, 0.05, 900);
        break;
      case 'rifle': // foundry gun: industrial hammer-crack + steam exhaust
        this._punch(210, 68, 0.05, 0.6, 0, 0, 'square');
        this._noise(0.05, 'bandpass', 1900, 1.4, 0.62);
        this._noise(0.05, 'highpass', 5600, 0.8, 0.14, 0.015);     // steam spit
        this._tone('square', 1300, 0.025, 0.14, 0.01, -0.08, 2200); // link rattle
        break;
      case 'rifleBurst': // burst: tighter hammer, hotter steam
        this._punch(230, 80, 0.045, 0.62, 0, 0, 'square');
        this._noise(0.045, 'bandpass', 2200, 1.5, 0.65);
        this._noise(0.04, 'highpass', 6000, 0.8, 0.12, 0.012);
        break;
      case 'sniper': // meridian long rifle: colossal crack, then the whole
        // bolt cycle plays out — lift, draw, case ping, return, lock
        this._punch(160, 34, 0.24, 0.32, 0, 0, 'sawtooth');
        this._punch(58, 24, 0.36, 0.21, 0, 0, 'sine');
        this._noise(0.12, 'lowpass', 4200, 1, 0.3);
        this._noise(0.6, 'lowpass', 680, 0.6, 0.12, 0.16);         // valley echo 1
        this._noise(0.8, 'lowpass', 440, 0.6, 0.07, 0.4);          // valley echo 2
        this._tone('square', 1400, 0.02, 0.05, 0.24, 0.1, 900);    // bolt lifts
        this._noise(0.07, 'bandpass', 1100, 1.5, 0.07, 0.36, 0.12);// draw back
        this._tone('sine', 3400, 0.09, 0.04, 0.5, 0.2, 2400);      // spent case pings
        this._noise(0.06, 'bandpass', 1200, 1.5, 0.07, 0.72, 0.1); // bolt returns
        this._tone('square', 1100, 0.025, 0.07, 0.94, 0.06, 700);  // locks
        break;
      case 'batCharge': // sprung heavy swing: spring creak, whip, iron slam
        this._tone('triangle', 240, 0.18, 0.2, 0, 0, 90);          // spring compress creak
        this._noise(0.3, 'bandpass', 700, 1.4, 0.36, 0.1, 0, 1900); // whip
        this._tone('sine', 66, 0.14, 0.5, 0.32, 0, 38);            // iron slam
        this._noise(0.07, 'lowpass', 420, 1, 0.5, 0.33);           // clank
        break;
      case 'blaster': // the artefact: no powder, no mechanism. A rising whine
        // collapsing into a short bright discharge, and a tail that rings.
        this._tone('sawtooth', 340, 0.05, 0.22, 0, 0, 1750);
        this._tone('square', 1750, 0.09, 0.16, 0.03, 0, 420);
        this._tone('sine', 2600, 0.16, 0.09, 0.03, 0, 900);
        this._noise(0.09, 'bandpass', 3400, 3.5, 0.16, 0.02);
        this._tone('sine', 118, 0.2, 0.16, 0, 0, 62);        // the body of it
        break;
      case 'blasterCharged': // overcharge: four cells at once, and it hurts it
        this._tone('sawtooth', 220, 0.13, 0.3, 0, 0, 1400);
        this._tone('square', 1400, 0.2, 0.22, 0.08, 0, 260);
        this._tone('sine', 2100, 0.34, 0.12, 0.08, 0, 620);
        this._noise(0.22, 'bandpass', 2600, 2.6, 0.2, 0.05);
        this._tone('sine', 84, 0.4, 0.24, 0, 0, 44);
        break;
      case 'bat': break; // primary swing carried by whoosh()/thud()
    }
  }

  whoosh() { this._noise(0.16, 'bandpass', 500, 1.6, 0.39, 0, 0, 1500); }
  thud() { this._noise(0.1, 'lowpass', 300, 1, 0.77); this._tone('sine', 90, 0.1, 0.56, 0, 0, 50); }
  click(freq = 1800, gain = 0.08, when = 0) { this._noise(0.025, 'highpass', freq, 1, gain, when); }

  /** Dry hammer-on-empty-chamber click. */
  emptyClick() {
    this._noise(0.02, 'highpass', 2600, 1, 0.12);
    this._tone('square', 900, 0.02, 0.08, 0.01, 0, 500);
  }

  /** Holster the old weapon, draw and seat the new one — the seat voice is
   *  per-weapon so a heavy gun arrives heavier. */
  equipSound(id) {
    this._noise(0.03, 'bandpass', 1000, 2, 0.1, 0);         // leather/holster (unequip)
    this._tone('square', 1600, 0.03, 0.07, 0.05, 0, 2400);  // draw
    this._brassTick(0.1, 0.09);
    switch (id) {
      case 'pistol': this._tone('triangle', 1500, 0.05, 0.09, 0.12, 0.06, 820);
        this._tone('sine', 2900, 0.06, 0.035, 0.15, 0.08, 2000); break;            // bolt seats, spring rings
      case 'shotgun': this._tone('sine', 110, 0.06, 0.16, 0.12, 0, 62); break;      // heavy seat
      case 'rifle': this._noise(0.06, 'highpass', 5200, 0.8, 0.06, 0.12); break;    // steam sigh
      case 'sniper': this._tone('sine', 120, 0.05, 0.13, 0.12, 0, 70);
        this._noise(0.04, 'bandpass', 1200, 1.5, 0.08, 0.16); break;                // breech settle
      case 'bat': this._noise(0.05, 'bandpass', 600, 1.5, 0.12, 0.1); break;        // leather creak
    }
  }

  /**
   * Reload choreography: an immediate release/eject, mid-cycle mechanism,
   * and a seating "complete" thunk near the end. Shaped per weapon action;
   * the quick-tap (tactical) variant drops the chamber-release phase.
   */
  reload(time, id, tactical = false) {
    if (!this.ctx) return;
    if (id === 'shotgun') {
      // the upward crane: latch aside, action creaks open, both hulls ping
      // away, two fresh shells chunk home, the barrels slam shut
      this._tone('square', 1600, 0.025, 0.1, time * 0.02, 0, 1000);   // latch aside
      this._noise(0.12, 'bandpass', 700, 1.8, 0.1, time * 0.15, 0, 1400); // hinge creak up
      for (const [w, pan] of [[0.3, 0.12], [0.34, 0.2]]) {            // hulls eject, ping + flutter
        this._tone('sine', 2900, 0.08, 0.06, time * w, pan, 2100);
        this._noise(0.05, 'bandpass', 1900, 1.6, 0.07, time * w + 0.02, pan);
      }
      this._noise(0.035, 'bandpass', 1000, 1.8, 0.13, time * 0.44);   // shell one seats
      this._tone('sine', 190, 0.05, 0.1, time * 0.46, 0, 120);
      this._noise(0.035, 'bandpass', 950, 1.8, 0.13, time * 0.57);    // shell two seats
      this._tone('sine', 180, 0.05, 0.1, time * 0.59, 0, 115);
      this._noise(0.1, 'bandpass', 750, 1.6, 0.09, time * 0.68, 0, 500); // hinge swings down
      this._tone('sine', 130, 0.07, 0.24, time * 0.84, 0, 70);        // barrels slam home
      this._tone('square', 1700, 0.02, 0.09, time * 0.86, 0, 1100);   // latch snaps
      this._brassTick(time * 0.9, 0.08);
    } else if (id === 'sniper') {
      // bolt open, spent clip pings away, fresh clip pressed in with five
      // seat clicks, bolt slams home
      this._tone('square', 1400, 0.02, 0.08, time * 0.02, 0.08, 900); // bolt lifts
      this._noise(0.07, 'bandpass', 1100, 1.5, 0.1, time * 0.08, 0.1);
      if (!tactical) this._tone('sine', 3600, 0.12, 0.06, time * 0.18, 0.18, 2500); // clip ping
      for (let i = 0; i < 5; i++) this.click(2000, 0.05, time * (0.34 + i * 0.085)); // seat ticks
      this._tone('sine', 200, 0.04, 0.1, time * 0.76, 0, 130);       // clip bottoms out
      this._noise(0.06, 'bandpass', 1200, 1.5, 0.1, time * 0.86);    // bolt forward
      this._tone('square', 1100, 0.025, 0.1, time * 0.93, 0, 700);   // locks
      this._tone('sine', 140, 0.05, 0.13, time * 0.94, 0, 80);
    } else {
      // magazine weapons: release, insert, (chamber on a full reload only)
      this.click(1300, 0.1);
      this._noise(0.03, 'bandpass', 900, 2, 0.12, time * 0.45);
      this._tone('square', 1100, 0.03, 0.14, time * 0.86, 0, 600); // mag seats
      if (!tactical) this._brassTick(time * 0.94, 0.1);            // slide drops
    }
  }

  /* ---------------- movement / pickups ---------------- */

  footstep(surface, sprinting) {
    if (!this.ctx) return;
    const g = sprinting ? 0.11 : 0.07;
    switch (surface) {
      case 'concrete': case 'road': this._noise(0.05, 'lowpass', 1500, 1, g); break;
      case 'wood': this._noise(0.06, 'lowpass', 800, 1.5, g * 1.2); this._tone('sine', 130, 0.05, g * 0.5); break;
      case 'water': this._noise(0.12, 'bandpass', 1100, 1, g * 1.3); break;
      case 'dirt': this._noise(0.06, 'lowpass', 700, 1, g); break;
      default: this._noise(0.07, 'lowpass', 520, 1, g * 0.9); // grass
    }
  }

  ammoChime() { this._tone('square', 660, 0.07, 0.12); this._tone('square', 990, 0.09, 0.12, 0.06); }
  healthChime() { this._tone('triangle', 440, 0.1, 0.16); this._tone('triangle', 554, 0.1, 0.16, 0.08); this._tone('triangle', 660, 0.16, 0.16, 0.16); }
  keyChime() { this._tone('square', 880, 0.06, 0.13); this._tone('square', 1174, 0.06, 0.13, 0.07); this._tone('square', 1568, 0.12, 0.13, 0.14); }
  secretChime() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this._tone('triangle', n, 0.14, 0.14, i * 0.09));
  }

  /* ---------------- player / zombies ---------------- */

  hurt() { this._noise(0.14, 'lowpass', 600, 1, 0.4); this._tone('sawtooth', 160, 0.12, 0.2, 0, 0, 80); }
  deathSting() { this._tone('sawtooth', 220, 1.2, 0.3, 0, 0, 55); this._noise(1.0, 'lowpass', 400, 1, 0.25); }

  /**
   * The breath under the words.
   *
   * Not a growl any more — these are people — but a fighter breaking into a
   * run makes a NOISE before he makes a word, and that noise is what tells you
   * something changed without you having to parse a line. It is pitched off
   * the archetype so the heavy's is a fifth below the rifleman's, the same way
   * their voices are.
   */
  growl(pos, type = null) {
    const s = this._spatial(pos, 50);
    if (!s) return;
    const key = voiceKeyFor(type?.name);
    const base = { tank: 62, sprinter: 118, exploder: 104, spitter: 96 }[key] ?? 88;
    const f = base * (0.9 + Math.random() * 0.25);
    this._tone('sawtooth', f, 0.26, 0.10 * s.vol, 0, s.pan, f * 0.7);
    this._noise(0.3, 'bandpass', 620, 1.6, 0.09 * s.vol, 0, s.pan, 260);
  }

  /* ---------------- the horde's voice ---------------- */

  /**
   * Say one of an archetype's lines for a state.
   *
   * Everything that keeps this from becoming noise lives here rather than at
   * the twenty call sites that emit these events:
   *
   *   RANGE. Nothing carries past `maxDist`, and level falls off inside it.
   *   THROTTLE. A global floor between any two lines, plus a longer per-state
   *     floor, so a wave landing produces two or three voices rather than
   *     forty. `force` shortens the global floor for the lines that carry
   *     information (a bomber priming, a death) but never removes it.
   *   IDENTITY. `voice` is a 0..1 value fixed to the individual when it
   *     spawned; it picks the fundamental inside the archetype's band AND
   *     picks which of the lines for that state he happens to use, so the same
   *     fighter always sounds like himself and says his own things.
   */
  enemyLine(state, type, voice = 0.5, pos = null, opts = {}) {
    if (!this.ctx || !this.speech) return;
    const cfg = ENEMY_VOICES[voiceKeyFor(type?.name)];
    const lines = cfg?.lines?.[state];
    if (!lines || !lines.length) return;
    const s = pos ? this._spatial(pos, opts.maxDist ?? 42) : { vol: 1, pan: 0 };
    if (!s) return;
    const now = this.t;
    const floor = opts.force ? 0.22 : 0.5;
    if (now - this._lastLine < floor) return;
    // How long the WHOLE TOWN waits before it will say this kind of thing
    // again. The chatter floors are the long ones on purpose: fifteen fighters
    // each offering a line every twenty seconds is a line on offer roughly
    // every second, and a street where somebody is always talking is a street
    // nobody is listening to.
    // A pack of eight in melee on a cornered player was producing an attack
    // grunt a second — a wall of voice under the gunfire rather than a scrum
    // you can hear individuals in. A grunt and a half a second is a scrum.
    const stateFloor = {
      idle: 6.0, prowl: 4.5, hurt: 1.3, chase: 1.1, spot: 1.0, attack: 1.5,
    }[state] ?? 0.35;
    if (now - (this._lastByState.get(state) ?? -99) < stateFloor) return;

    /* --- HOW MANY PEOPLE MAY BE TALKING -----------------------------------
     *
     * A formant synthesiser is the most expensive thing in this mix by a wide
     * margin — a dozen filters and four live sources per sentence, against
     * three nodes for a gunshot layer — and a wave lands fifteen fighters on
     * the same street. Without a ceiling the render thread went over its
     * deadline and the whole town went silent for a beat, which is the exact
     * failure the shouting was there to prevent.
     *
     * Four at once, and the fifth simply does not speak. Nothing legible is
     * lost: five simultaneous voices through one blown cabinet speaker is not
     * five lines, it is a noise. The state floors above already stagger the
     * chatter, so in practice this only bites when a wave breaks — which is
     * precisely when the mix cannot afford another sentence.
     *
     * Checked BEFORE the throttle is stamped, so a fighter who is turned away
     * because the street is full has not also used up the town's window for
     * that kind of line — the next one along says it instead.
     */
    const speaking = this._speechLoad(now);
    if (speaking >= SPEECH_CAP) return;

    this._lastLine = now;
    this._lastByState.set(state, now);

    const v = Math.max(0, Math.min(1, voice));
    const [lo, hi] = cfg.f0;
    const f0 = lo + (hi - lo) * v;
    // WHICH line, out of that state's pool. The individual's voice value picks
    // where in the pool he starts, and a per-state counter walks it on — so two
    // fighters speaking at the same moment say different things AND the same
    // fighter does not repeat himself every time he opens his mouth, which a
    // straight hash of the voice value did.
    const seqKey = state + ':' + (type?.name ?? '?');
    const n = ((this._lineSeq.get(seqKey) ?? 0) + 1) % 1e6;
    this._lineSeq.set(seqKey, n);
    const line = lines[(Math.floor(v * 997) + n) % lines.length];
    /**
     * WHERE IT IS COMING FROM.
     *
     * The line used to be panned and then levelled off a straight ramp to the
     * cutoff — `0.35 + vol * 0.65`, which over forty metres is nine decibels,
     * near enough no fall at all. A bomber calling his run from across the
     * district arrived at the same weight as one at arm's length, and a voice
     * that does not get quieter with distance is a voice with no distance: the
     * pan said "to your left" and nothing said "a long way to your left".
     *
     * Three things carry that instead, and all three are how a shout actually
     * reaches you across open ground:
     *
     *   LEVEL falls on an inverse law rather than a line — halved by the time
     *   he is seven metres out and down twenty decibels at the far edge of the
     *   range — so the difference between ten metres and thirty is something
     *   you hear rather than something you infer.
     *
     *   AIR takes the top off it. Distance is a low-pass filter: the further a
     *   voice travels the less of its consonants survive, which is why you can
     *   tell somebody is shouting from the far end of a street even when you
     *   cannot make out the words. Without this a quiet voice is just a quiet
     *   voice — turned down, not moved away.
     *
     *   And it ARRIVES LATE, by the time sound takes to cover the ground. It
     *   is a tenth of a second at forty metres and nobody consciously hears
     *   it, but it is the difference between a shout that happened over there
     *   and one dubbed onto the scene.
     *
     * The pan is unchanged and still does the left/right work.
     */
    const dist = s.dist ?? 0;
    // 1/(1+d/ref) is the textbook point source; the exponent past it is the
    // ground and the buildings taking their cut, which is what makes the far
    // end of the street sound like the far end of the street.
    const roll = Math.pow(VOICE_REF / (VOICE_REF + dist), 1.25);
    const gain = 0.52 * (opts.gain ?? 1) * (0.04 + roll * 0.96);
    if (gain <= AUDIBLE) return;

    /* --- HOW MUCH OF THE SYNTHESISER TO BUILD ------------------------------
     *
     * Distance has already taken the top off the voice by the time it reaches
     * the listener, so the parts of the machine that only live up there — the
     * waveshaper's oversampling, the carrier hiss, and at the far rung the
     * cabinet's ceiling and the third formant — are being computed in order to
     * be filtered straight back out again. The rung drops them as the voice
     * goes away and as the street fills up; what carries (the horn, the body
     * under the glottal source) is on every rung. See Speech.speak.
     *
     * The one case that always gets the whole machine is the one that carries
     * information: a fighter inside a dozen metres with nobody talking over
     * him. That is the bomber's call, the shout behind you, the line the
     * player is meant to act on.
     */
    const quality = (dist < 12 && speaking === 0) ? 2 : (dist < 32 && speaking < 3) ? 1 : 0;

    // Distance's own low-pass. Above the synthesiser's own ceiling it is a
    // filter that filters nothing, so a fighter at arm's length skips it and
    // the line goes straight onto the shared panner rack.
    const cut = 700 + 4300 * Math.pow(roll, 0.7);
    const bus = this._bus(s.pan);
    let dest = bus, air = null;
    if (cut < 3600) {
      air = this.ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = cut;
      air.Q.value = 0.7;
      air.connect(bus);
      dest = air;
    }
    const delay = dist / 343;
    const len = this.speech.speak(dest, line, {
      f0,
      gain,
      when: delay,
      rate: cfg.rate * (0.94 + v * 0.12) * (opts.rate ?? 1),
      grit: cfg.grit,
      shout: opts.shout ?? ({ spot: 0.6, chase: 0.6, attack: 0.6, prowl: 0.42, idle: 0.08 }[state] ?? 0.15),
      quality,
    });
    this._speechEnds.push(now + delay + len + 0.2);
    // ...and take the chain down behind it. Speech disconnects its own end
    // (see Speech.speak); the air filter is this method's, it is made fresh
    // for every line that needs one, and a run is thousands of lines long.
    if (air) setTimeout(() => { try { air.disconnect(); } catch { /* gone */ } },
      (delay + len + 0.4) * 1000);
  }

  /** Lines still being spoken, sweeping the finished ones out. See enemyLine. */
  _speechLoad(now) {
    const ends = this._speechEnds;
    let n = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > now) ends[n++] = ends[i];
    ends.length = n;
    return n;
  }

  gurgle(pos) {
    const s = this._spatial(pos, 45);
    if (!s) return;
    this._noise(0.3, 'bandpass', 500, 3, 0.14 * s.vol, 0, s.pan, 150);
    this._tone('sawtooth', 120, 0.28, 0.1 * s.vol, 0.03, s.pan, 45);
  }

  /**
   * Graphic, thematically-tuned death: a wet flesh burst + a low body thud +
   * a sharp bone crack, then a fast descending bit-crushed square arpeggio and
   * a ring-mod shimmer — the "digital" tail that matches the glitch dissolve.
   */
  zombieDeath(pos) {
    const s = this._spatial(pos, 55);
    if (!s) return;
    const v = s.vol, pan = s.pan;
    this._noise(0.18, 'bandpass', 700, 1.5, 0.24 * v, 0, pan, 170);   // wet burst
    this._tone('sine', 92, 0.24, 0.28 * v, 0, pan, 38);               // body thud
    this._noise(0.05, 'highpass', 2700, 1, 0.15 * v, 0.02, pan);      // bone crack
    const steps = [1200, 820, 560, 380, 240];                        // digital glitch
    steps.forEach((f, i) => this._tone('square', f, 0.05, 0.09 * v, 0.05 + i * 0.03, pan, f * 0.6));
    this._noise(0.22, 'bandpass', 3000, 8, 0.05 * v, 0.06, pan, 1100); // ring-mod shimmer
  }

  /**
   * Exploder detonation: a deep two-layer body boom with a downward pitch
   * sweep, a sharp initial crack and a lingering low rumble tail — carried far
   * (80 m) and spatialised so a blast across the street still reads.
   */
  explosion(pos) {
    const s = this._spatial(pos, 80);
    if (!s) return;
    const v = s.vol, pan = s.pan;
    this._tone('sine', 120, 0.5, 0.55 * v, 0, pan, 30);       // body boom
    this._tone('sine', 62, 0.75, 0.42 * v, 0, pan, 22);       // sub layer
    this._noise(0.12, 'lowpass', 2200, 0.8, 0.5 * v, 0, pan, 300); // crack
    this._noise(0.6, 'lowpass', 700, 0.6, 0.3 * v, 0.05, pan, 120); // rumble tail
    this._noise(0.35, 'highpass', 3000, 1, 0.16 * v, 0.02, pan);    // debris crackle
  }

  /**
   * A border wall blown down — the biggest sound in the game, and the only one
   * the entire town is meant to hear.
   *
   * Two things it does not do. It does not fall off a cliff: `_spatial` returns
   * null past its range, so a "carried 120 m" blast was a whisper at 119 m and
   * SILENT at 121 m, with nothing in between — for an event this size the
   * fall-off is done here instead, with a floor, so a district gate coming down
   * is audible from anywhere on the map, just flatter and less directional the
   * further off it is. And it does not stack: Zones.unlock opens every segment
   * of a district at once, and firing the whole sequence per segment was one
   * sound played five times over itself. The first blast of a salvo is the
   * demolition; the rest fold in behind it, offset down the street and dropping
   * in level, so a district's walls read as one rolling barrage.
   */
  barrierBlast(b) {
    if (!this.ctx) return;
    const dx = b.x - this.listener.x, dz = b.z - this.listener.z;
    const near = Math.max(0, 1 - Math.hypot(dx, dz) / 300);
    const v = 0.36 + 0.64 * near * near;
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    const pan = Math.max(-1, Math.min(1, Math.sin(ang) * 0.8 * near));

    const now = this.t;
    if (!this._salvo || now - this._salvo.at > 0.9) this._salvo = { at: now, n: 0 };
    const i = this._salvo.n++;
    this._detonation(v / (1 + i * 0.85), pan, i * 0.21, b.duration || 3.5, i === 0);
  }

  /**
   * The demolition itself, scheduled end to end on the audio clock so it plays
   * out over the whole time the wall takes to fall: the breach, the charges
   * walking down its length, a rumble bed held under the collapse, masonry
   * raining off it the whole way down, and the ground impact when it lands.
   *
   * `full` is false for the trailing segments of a salvo — they contribute the
   * breach and the walking charges (which is what gives the barrage its width)
   * without laying down a second and third copy of the bed and the impact.
   */
  _detonation(v, pan, at = 0, dur = 3.5, full = true) {
    // 1. the breach: the charge, then the shockwave off the face of the wall
    this._noise(0.09, 'highpass', 4200, 1, 0.34 * v, at, pan);
    this._noise(0.22, 'lowpass', 2800, 0.8, 0.78 * v, at, pan, 260);
    // 2. the charges walking down the length — each a body tone over a sub
    //    layer, both sweeping down as the wall gives
    for (const [w, g] of [[0, 0.85], [0.11, 0.72], [0.24, 0.6], [0.41, 0.46]]) {
      this._tone('sine', 160, 0.6, g * v, at + w, pan, 32);
      this._tone('sine', 70, 0.95, g * 0.85 * v, at + w, pan, 19);
    }
    if (!full) return;
    // 3. the bed: the wall coming apart for as long as it takes to go down
    this._noise(dur, 'lowpass', 520, 0.6, 0.44 * v, at + 0.06, pan, 90);
    this._noise(dur * 0.8, 'bandpass', 1500, 1.2, 0.18 * v, at + 0.2, pan, 600);
    for (let i = 0; i < 5; i++) {
      const w = at + 0.35 + i * dur * 0.15;
      this._noise(0.5, 'highpass', 3000, 1, 0.2 * v * (1 - i * 0.13), w, pan * 0.8);
      this._tone('sine', 120 - i * 8, 0.5, 0.3 * v * (1 - i * 0.15), w + 0.05, pan, 30);
    }
    // 4. it lands: tonnes of marble on the street, a sub drop under it, and the
    //    long settle of a heap of rubble finding its own shape
    const land = at + dur * 0.86;
    this._tone('sine', 52, 1.5, 0.8 * v, land, pan, 16);
    this._noise(0.5, 'lowpass', 900, 0.7, 0.6 * v, land, pan, 120);
    this._noise(1.8, 'lowpass', 380, 0.6, 0.34 * v, land + 0.1, pan, 70);
    this._noise(1.1, 'highpass', 2600, 1, 0.16 * v, land + 0.05, pan);
  }

  /**
   * The Spitter's dual-pistol shot: two quick snappy cracks a hair apart (both
   * pistols), spatialised and attenuated by distance so a shot across the street
   * reads quieter and off to the side.
   */
  spitterShot(pos) {
    const s = this._spatial(pos, 60);
    if (!s) return;
    const v = s.vol, pan = s.pan;
    this._punch(320, 80, 0.05, 0.32 * v, 0, pan, 'triangle');       // first barrel body
    this._noise(0.045, 'bandpass', 3400, 1.2, 0.34 * v, 0, pan);    // ...its crack
    this._punch(300, 76, 0.05, 0.26 * v, 0.035, pan, 'triangle');   // second barrel body
    this._noise(0.04, 'bandpass', 3600, 1.2, 0.26 * v, 0.035, pan); // ...its crack
    this._tone('sine', 4800, 0.05, 0.03 * v, 0.05, pan, 3200);      // bright nickel ring
  }

  /**
   * The room the horde is in.
   *
   * Deliberately WORDLESS: the words are the fighters' own (see enemyLine),
   * and a second stream of speech under them would only make both harder to
   * pick out. What is left is what a crowd sounds like from a street away —
   * movement, cloth, a sling swinging, the low unpitched wash of people
   * nearby — laid on a slow filter sweep so it never sits still.
   */
  moan(pan, vol) {
    this._noise(1.3, 'bandpass', 300 + Math.random() * 220, 1.4, 0.055 * vol, 0, pan, 180);
    this._noise(0.5, 'highpass', 2400 + Math.random() * 900, 0.7, 0.02 * vol, 0.25 + Math.random() * 0.4, pan);
    this._tone('triangle', 58 + Math.random() * 26, 1.0, 0.035 * vol, 0.1, pan, 44);
  }

  whisper(intensity = 0.6) {
    if (!this.ctx) return;
    const pan = Math.random() * 2 - 1; // from a direction that makes no sense
    for (let i = 0; i < 4; i++) {
      this._noise(0.12 + Math.random() * 0.12, 'bandpass', 1400 + Math.random() * 1600, 6,
        0.05 * intensity, i * 0.16 + Math.random() * 0.05, pan);
    }
  }

  /* ---------------- anomalies ---------------- */

  /**
   * Displaced ambience: real positions, wrong acoustics. Each sound is
   * spatialised from its source and then panned to the OPPOSITE side, so the
   * town's soundscape quietly disagrees with its geometry. Nothing here is
   * loud; the wrongness is the point.
   */
  displaced(kind, pos) {
    if (!this.ctx) return;
    const s = this._spatial(pos, 95);
    if (!s) return;
    const pan = -s.pan;
    const v = s.vol;
    switch (kind) {
      case 'drip': // water over the open pond, dripping from nothing
        for (let i = 0; i < 3; i++) {
          this._tone('sine', 2100 - i * 320, 0.05, 0.08 * v, i * 0.7 + Math.random() * 0.2, pan, 900);
        }
        break;
      case 'train': // a long freight crossing; the town has no tracks
        this._tone('sawtooth', 233, 1.9, 0.05 * v, 0, pan, 221);
        this._tone('sawtooth', 311, 1.9, 0.05 * v, 0, pan, 296);
        this._noise(2.0, 'lowpass', 480, 0.6, 0.045 * v, 0, pan);
        break;
      case 'toll': // the chapel bell, visibly motionless, tolls once
        for (const [f, g, w] of [[392, 0.11, 0], [784, 0.035, 0], [388, 0.06, 1.1]]) {
          this._tone('sine', f, 2.3, g * v, w, pan);
        }
        break;
      case 'knock': // three knocks from inside the inner walls
        for (let i = 0; i < 3; i++) {
          this._noise(0.06, 'lowpass', 300, 1, 0.2 * v, i * 0.42, pan);
          this._tone('sine', 82, 0.1, 0.16 * v, i * 0.42, pan, 55);
        }
        break;
      case 'ding': // the elevator arrives. There is no elevator.
        this._tone('sine', 1568, 0.5, 0.09 * v, 0, pan);
        this._tone('sine', 1046, 0.7, 0.07 * v, 0.03, pan);
        break;
      case 'creak': // door hinges (honest direction, more or less)
        this._noise(0.7, 'bandpass', 700, 8, 0.1, 0, pan, 300);
        break;
      case 'piano': // an upright, struck once. Hammer thud, a minor chord, and
        // a tail that outlasts the room it is standing in.
        this._noise(0.05, 'lowpass', 900, 1, 0.09 * v, 0, pan);
        for (const [f, gn] of [[220, 0.075], [261.6, 0.06], [329.6, 0.05], [440, 0.035], [523.3, 0.02]]) {
          this._tone('triangle', f, 3.4, gn * v, 0, pan, f * 0.985);
          this._tone('sine', f * 2, 1.6, gn * 0.3 * v, 0.01, pan);
        }
        break;
      case 'chime': // wind chimes on a still afternoon. Five tubes, one scale,
        // struck in an order that is not random and is not a tune either.
        for (const [i, f] of [1245, 1661, 1108, 1864, 1396].entries()) {
          this._tone('sine', f, 1.4, 0.05 * v, i * 0.19 + Math.random() * 0.05, pan);
          this._tone('sine', f * 2.76, 0.5, 0.012 * v, i * 0.19, pan);
        }
        break;
    }
  }

  /**
   * The forecourt pump, tried.
   *
   * A solenoid clacking over, a vane motor spinning up against nothing and
   * dying back, the mechanical totaliser ticking up its eleven cents, and the
   * dry hiss of a line with no fuel in it. Honestly spatialised — this one is
   * a machine in the world, not one of the town's wrongnesses.
   */
  pumpCough(pos) {
    const s = this._spatial(pos, 40);
    if (!s) return;
    const v = s.vol, pan = s.pan;
    this._noise(0.04, 'bandpass', 900, 3, 0.20 * v, 0, pan);          // the solenoid
    this._tone('square', 260, 0.03, 0.10 * v, 0.01, pan, 150);
    // the motor: up, then straight back down again
    this._tone('sawtooth', 48, 0.5, 0.09 * v, 0.08, pan, 128);
    this._tone('sawtooth', 128, 0.9, 0.07 * v, 0.58, pan, 41);
    this._noise(1.3, 'bandpass', 380, 1.4, 0.05 * v, 0.08, pan, 190);
    // the totaliser wheels, eleven cents of nothing
    for (let i = 0; i < 11; i++) {
      this._noise(0.012, 'highpass', 4200, 1, 0.055 * v, 0.22 + i * 0.055, pan);
    }
    // ...and the dry line
    this._noise(0.7, 'highpass', 5200, 0.7, 0.045 * v, 0.5, pan);
  }

  /* ---------------- the thing that came down ---------------- */

  /**
   * THE SAUCER'S VOICE, and it is the only sound in the game that is a LIVE
   * voice rather than a scheduled one.
   *
   * Everything else here is fire-and-forget: a gunshot is a graph built,
   * played and thrown away inside a fifth of a second. This thing is in the
   * sky for twelve seconds and it crosses the whole town while it is up there,
   * so it has to be a standing set of oscillators whose pitch, level and pan
   * are driven every frame from where it actually is — which is the only way
   * to get the two things that sell a flyover:
   *
   *   DOPPLER. Approaching, the pitch is bent up; going away, down. The shift
   *   is computed from the real closing speed against a real speed of sound,
   *   so the drop happens exactly as it passes over the vendor's knoll and not
   *   at some point that felt about right.
   *
   *   DISTANCE. Level falls off with range, and — the part that actually
   *   reads — the air eats the top end long before it eats the bottom, so far
   *   away it is a low hum and overhead it is a shriek with a hum under it.
   *
   * The voice itself is three layers: a detuned pair beating against each
   * other (the drive), a sub an octave and a half down (the mass of it), and
   * a band of moving noise (the air it is dragging). The drive is what
   * flutters as the craft loses it.
   */
  ufoEnter() {
    if (!this.ctx || this._ufo) return;
    const t = this.t;
    const out = this.ctx.createGain();
    out.gain.value = 0;
    const pan = this.ctx.createStereoPanner();
    const air = this.ctx.createBiquadFilter();     // distance eats the top end
    air.type = 'lowpass';
    air.frequency.value = 800;
    air.Q.value = 0.4;
    out.connect(air).connect(pan).connect(this.master);

    const osc = [];
    for (const [type, det, lvl] of [['sawtooth', -9, 0.5], ['sawtooth', 11, 0.5], ['square', 3, 0.18]]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(220, t);
      o.detune.setValueAtTime(det, t);
      const g = this.ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(out);
      o.start(t);
      osc.push(o);
    }
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(74, t);
    const subG = this.ctx.createGain();
    subG.gain.value = 0.9;
    sub.connect(subG).connect(out);
    sub.start(t);
    // the air it drags: a band of noise that rides the same pitch
    const nz = this.ctx.createBufferSource();
    nz.buffer = this._noiseBuf;
    nz.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.setValueAtTime(900, t);
    nf.Q.value = 1.1;
    const nG = this.ctx.createGain();
    nG.gain.value = 0.35;
    nz.connect(nf).connect(nG).connect(out);
    nz.start(t);
    out.gain.linearRampToValueAtTime(0.0001, t);
    this._ufo = { out, pan, air, osc, sub, nz, nf, lastDist: null };
  }

  /**
   * Drive the voice from the craft's position and velocity.
   *
   * `k` is how far through the flight it is, which is used for one thing only:
   * the drive is stable at the start and audibly failing by the end, so the
   * pitch develops a wobble that gets worse the closer it gets to the ground.
   */
  ufoTrack(pos, vel, k = 0) {
    const u = this._ufo;
    if (!u || !this.ctx) return;
    const t = this.t;
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const dy = pos.y - 1.6;
    const dist = Math.max(4, Math.hypot(dx, dy, dz));
    // closing speed along the line to the listener, positive = approaching
    const closing = -((vel.x * dx) + (vel.y * dy) + (vel.z * dz)) / dist;
    const doppler = Math.max(0.72, Math.min(1.5, 343 / (343 - Math.max(-160, Math.min(160, closing)))));
    // the drive tearing itself apart as it comes down
    const flutter = 1 + Math.sin(t * (7 + k * 26)) * (0.006 + k * 0.05);
    const base = 214 * doppler * flutter;
    for (const o of u.osc) o.frequency.setTargetAtTime(base, t, 0.03);
    u.sub.frequency.setTargetAtTime(base * 0.34, t, 0.05);
    u.nf.frequency.setTargetAtTime(base * 4.2, t, 0.04);
    // level and air absorption: a hum at four hundred metres, a shriek at forty
    const near = Math.max(0, 1 - dist / 420);
    u.out.gain.setTargetAtTime(0.34 * near * near, t, 0.06);
    u.air.frequency.setTargetAtTime(420 + 5200 * Math.pow(near, 2.2), t, 0.08);
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    u.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, Math.sin(ang) * 0.85)), t, 0.05);
  }

  /** It has gone in. Cut the drive — the bang is a separate sound. */
  ufoExit() {
    const u = this._ufo;
    if (!u || !this.ctx) return;
    this._ufo = null;
    const t = this.t;
    u.out.gain.cancelScheduledValues(t);
    u.out.gain.setValueAtTime(Math.max(0.0001, u.out.gain.value), t);
    u.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    for (const o of u.osc) o.stop(t + 0.2);
    u.sub.stop(t + 0.2);
    u.nz.stop(t + 0.2);
  }

  /**
   * The impact, and it arrives LATE.
   *
   * From the plaza the wreck is two hundred metres off, so the light is over
   * the treeline before the sound is anywhere near you — and putting the boom
   * on the same frame as the flash is the single most common way a distant
   * explosion is got wrong. The delay here is the real one: the range divided
   * by the speed of sound, scheduled on the audio clock so it is exact.
   *
   * What arrives is not a crack. Distance has already taken the top off it, so
   * it is a low double thump with a long rumble under it, a slap of ground
   * shock a beat behind that, and then the town's own echo of the whole thing
   * a beat behind THAT.
   */
  ufoImpact(pos) {
    if (!this.ctx) return;
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 700) return;
    const delay = dist / 343;                       // the real thing
    const v = Math.max(0.12, 1 - dist / 640);
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    const pan = Math.max(-1, Math.min(1, Math.sin(ang) * 0.7));
    // the body of it: two thumps, the second bigger, both already dull
    this._tone('sine', 74, 0.9, 0.36 * v, delay, pan, 26);
    this._noise(1.1, 'lowpass', 190, 0.7, 0.30 * v, delay, pan, 70);
    this._tone('sine', 58, 1.6, 0.44 * v, delay + 0.13, pan, 20);
    this._noise(2.6, 'lowpass', 140, 0.6, 0.34 * v, delay + 0.13, pan, 48);
    // ground shock, which travels faster than the air and hits first
    this._tone('sine', 33, 0.7, 0.22 * v, Math.max(0, delay - 0.22), pan, 19);
    // the long tail, and the town answering it
    this._noise(4.5, 'lowpass', 120, 0.5, 0.16 * v, delay + 0.5, pan, 42);
    this._noise(1.8, 'bandpass', 260, 1.2, 0.09 * v, delay + 0.95, -pan, 120);
    // ...and something metal, a long way off, that did not stop when it landed
    this._tone('triangle', 168, 0.5, 0.05 * v, delay + 1.5, -pan, 132);
    this._tone('triangle', 121, 0.8, 0.04 * v, delay + 2.1, pan, 96);
  }

  /** The booth phone rings — panned to the wrong side of the street. */
  /**
   * THE ONE SOUND IN THE GAME THAT IS SUPPOSED TO COME FROM THE WRONG SIDE.
   *
   * The booth rings from across the street and it rings out of the WRONG EAR,
   * on purpose, which is the whole point of it — see the wrongness layer in
   * Anomalies.js. That is what the explicit negation below is.
   *
   * It is also, incidentally, how you could have caught the bug in _spatial:
   * while the global pan was inverted these two minus signs cancelled, and the
   * only object in the town that was meant to sound wrong was the only one
   * that sounded right.
   */
  phoneRing(pos) {
    if (!this.ctx) return;
    const s = this._spatial(pos, 70);
    if (!s) return;
    const pan = -s.pan;                      // deliberate. Do not "fix" this.
    for (const w of [0, 0.55]) {
      for (let i = 0; i < 8; i++) {
        this._tone('square', i % 2 ? 440 : 480, 0.05, 0.05 * s.vol, w + i * 0.05, pan);
      }
    }
  }

  /** What answers when you pick up: slow breathing under the static. */
  phoneVoice() {
    for (let i = 0; i < 3; i++) {
      this._noise(0.55, 'bandpass', 380 + i * 60, 4, 0.1, i * 0.95, 0, 280);
    }
    this.whisper(0.9);
  }

  /** Car alarm chirp — honest stereo: this one is a tool, not a trick. */
  carChirp(pos) {
    const s = this._spatial(pos, 90);
    if (!s) return;
    this._tone('square', 880, 0.16, 0.11 * s.vol, 0, s.pan, 620);
    this._tone('square', 1244, 0.16, 0.09 * s.vol, 0.18, s.pan, 900);
  }

  /** The call button clunks; far overhead, machinery shifts its weight. */
  elevatorHum(pos) {
    const s = this._spatial(pos, 40);
    if (!s) return;
    this.click(1400, 0.07);
    this._tone('sine', 55, 2.6, 0.12 * s.vol, 0.1, s.pan, 46);
    this._noise(2.2, 'bandpass', 180, 3, 0.05 * s.vol, 0.3, s.pan);
  }

  /** The scarecrow's crow bolting: two rasped caws, honestly panned — you can
   *  see it go, so this one plays true, not mirrored. */
  crowCaw(pos) {
    const s = this._spatial(pos, 75);
    if (!s) return;
    for (const w of [0, 0.2]) {
      this._noise(0.13, 'bandpass', 900, 6, 0.13 * s.vol, w, s.pan, 1350);
      this._tone('sawtooth', 430, 0.13, 0.05 * s.vol, w, s.pan, 300);
    }
  }

  /** Taking the Friend Box: a warm rising chord, almost grateful. */
  cubeChime() {
    const seq = [[392, 0], [494, 0.09], [587, 0.18], [784, 0.3]];
    for (const [f, w] of seq) this._tone('triangle', f, 0.3, 0.12, w);
    this._tone('sine', 1568, 0.8, 0.05, 0.42);
  }

  /* ---------------- tokens, the vendor and the sentry ---------------- */

  /**
   * A coin going into the purse. The three are told apart by ear as well as
   * by eye: copper is a small dull tick, silver rings a fifth above it, and
   * the gold is the one with a tail on it — so you know what you picked up
   * without looking down at your feet in the middle of a wave.
   */
  coinChime(type) {
    const base = type === 'coin_gold' ? 1046 : type === 'coin_silver' ? 880 : 660;
    this._tone('triangle', base, 0.05, 0.11);
    this._tone('triangle', base * 1.5, 0.09, 0.09, 0.035);
    if (type === 'coin_gold') this._tone('sine', base * 3, 0.35, 0.035, 0.07);
    this._noise(0.03, 'bandpass', 5200, 3, 0.05);   // the metal-on-metal edge
  }

  /** The till: a purchase landing, and the machine refusing one. */
  tillChime() {
    this._tone('square', 784, 0.05, 0.1);
    this._tone('square', 1046, 0.07, 0.1, 0.05);
    this._noise(0.09, 'bandpass', 2600, 2, 0.07, 0.03);   // the drawer
    this._tone('sine', 1568, 0.5, 0.045, 0.1);            // the bell on top of it
  }

  tillRefuse() {
    this._tone('square', 220, 0.09, 0.12);
    this._tone('square', 196, 0.16, 0.12, 0.08);
    this._noise(0.06, 'lowpass', 900, 1, 0.09, 0.02);
  }

  /** The animatronic coming awake behind the counter: a motor and a relay. */
  vendorWake(pos) {
    const s = this._spatial(pos, 24);
    if (!s) return;
    this._tone('sawtooth', 62, 0.5, 0.07 * s.vol, 0, s.pan, 96);      // the drive motor
    this._noise(0.07, 'bandpass', 1400, 3, 0.09 * s.vol, 0.02, s.pan); // the relay
    this._tone('square', 330, 0.05, 0.05 * s.vol, 0.24, s.pan);        // its bell tapping once
  }

  /**
   * The sentry setting itself up: legs locking out and a bell on the end of it.
   *
   * That is the whole Mk I. The Mk II only gets the THUMP of being set down
   * here; its deploy is scored beat by beat in wardenBeat() below.
   */
  sentryDeploy(pos, kind) {
    const s = this._spatial(pos, kind === 'sentryTwo' ? 40 : 30);
    if (!s) return;
    if (kind === 'sentryTwo') {
      // Only the weight of the case landing. Everything after this — sixteen
      // separate events over two seconds — is wardenBeat(), because a machine
      // whose whole deploy is one cue cannot have sixteen beats.
      this._punch(120, 52, 0.10, 0.16 * s.vol, 0, s.pan, 'sine');
      this._noise(0.10, 'lowpass', 420, 1, 0.10 * s.vol, 0, s.pan);
      return;
    }
    this._noise(0.12, 'bandpass', 900, 2, 0.14 * s.vol, 0, s.pan);
    this._tone('square', 180, 0.07, 0.08 * s.vol, 0.14, s.pan, 260);
    this._tone('square', 520, 0.05, 0.06 * s.vol, 0.3, s.pan);
  }

  /**
   * One pull. The Mk I is one thin crack; the Mk II is TWO barrels going off
   * together, which is not the same sound twice — it is one heavier report
   * with a slight flam on it, because two locks never quite fall as one.
   */
  sentryShot(pos, kind) {
    const s = this._spatial(pos, kind === 'sentryTwo' ? 70 : 50);
    if (!s) return;
    if (kind === 'sentryTwo') {
      this._punch(230, 62, 0.06, 0.28 * s.vol, 0, s.pan, 'triangle');
      this._punch(215, 58, 0.055, 0.22 * s.vol, 0.012, s.pan, 'triangle');  // the flam
      this._noise(0.05, 'bandpass', 2600, 1.2, 0.26 * s.vol, 0, s.pan);
      this._tone('sine', 4200, 0.05, 0.02 * s.vol, 0.05, s.pan, 2800);
      return;
    }
    // Deliberately thinner and drier than the player's pistol: the same
    // cartridge, but coming out of a little machine across the street.
    this._punch(300, 84, 0.045, 0.24 * s.vol, 0, s.pan, 'triangle');
    this._noise(0.035, 'bandpass', 3800, 1.4, 0.22 * s.vol, 0, s.pan);
    this._tone('sine', 5200, 0.04, 0.02 * s.vol, 0.04, s.pan, 3600);
  }

  /** The Mk II changing a drum: the old one off, the new one seated, bolt home. */
  sentryReload(pos) {
    const s = this._spatial(pos, 34);
    if (!s) return;
    this._tone('square', 260, 0.05, 0.06 * s.vol, 0, s.pan, 170);        // catch released
    this._noise(0.08, 'bandpass', 700, 2, 0.10 * s.vol, 0.55, s.pan);    // drum lifted clear
    this._punch(190, 70, 0.05, 0.16 * s.vol, 1.15, s.pan, 'square');     // the new one seated
    this._tone('square', 480, 0.05, 0.06 * s.vol, 1.55, s.pan);          // bolt home
  }

  /**
   * The Mk II cutting another mark into its own data plate.
   *
   * Three short scratches, because that is what the arm does — a stroke is a
   * rasp and not a beep, so it is filtered noise rather than a tone, and it is
   * quiet: this is a machine talking to itself, not announcing anything.
   */
  sentryTally(pos) {
    const s = this._spatial(pos, 18);
    if (!s) return;
    this._tone('sawtooth', 140, 0.20, 0.030 * s.vol, 0, s.pan, 300);      // the arm reaching back
    for (let i = 0; i < 3; i++) {
      this._noise(0.045, 'bandpass', 2900 + i * 260, 6, 0.055 * s.vol, 0.30 + i * 0.13, s.pan, 1700);
    }
    this._tone('sawtooth', 300, 0.18, 0.028 * s.vol, 0.78, s.pan, 130);   // and coming home
  }

  /* ------------- THE WARDEN: sixteen beats and a heartbeat ------------- */

  /**
   * ONE BEAT OF THE MK II'S DEPLOY.
   *
   * The Mk I's deploy is one sound. This is SIXTEEN, one per named beat in
   * SentryTwo's BEATS table, and the whole reason the sequence is worth
   * watching is that every visible motion has a noise arriving with it — you
   * can shut your eyes and still follow what it is doing.
   *
   * They are written to a deliberate arc. The first eleven are DRY: metal,
   * pneumatics, screw threads, a spade in dirt — a piece of county equipment
   * doing county equipment things, and nothing about it suggests anything is
   * inside. Then the doors go (beat 11) on a seal breaking, and the last five
   * are WET: a pump priming, fluid moving, six contacts seating on something
   * soft, and a heartbeat. That turn is the entire reveal, and it is carried
   * by the sound before it is carried by anything on screen.
   */
  wardenBeat(pos, beat) {
    const s = this._spatial(pos, 42);
    if (!s) return;
    const v = s.vol, pan = s.pan;
    switch (beat) {
      case 'latch':      // four over-centre latches, snapping in a scatter
        for (let i = 0; i < 4; i++) {
          this._noise(0.018, 'bandpass', 3000 + i * 340, 6, 0.10 * v, i * 0.019, pan + (i % 2 ? 0.1 : -0.1));
        }
        this._noise(0.13, 'highpass', 4200, 0.7, 0.07 * v, 0.03, pan);      // the pressure going
        break;
      case 'clamp':      // two heavier hooks letting go and swinging out
        this._tone('square', 300, 0.035, 0.07 * v, 0, pan - 0.18, 190);
        this._tone('square', 275, 0.035, 0.07 * v, 0.055, pan + 0.18, 175);
        this._noise(0.10, 'bandpass', 900, 3, 0.05 * v, 0.06, pan);
        break;
      case 'splay':      // the quadrupod opening: a gear train under load
        this._tone('sawtooth', 58, 0.30, 0.075 * v, 0, pan, 128);
        this._noise(0.30, 'bandpass', 640, 2.2, 0.11 * v, 0, pan, 1150);
        for (let i = 0; i < 5; i++) {                                        // the ratchet
          this._noise(0.012, 'highpass', 2700, 2, 0.045 * v, 0.04 + i * 0.045, pan);
        }
        break;
      case 'knee':       // four knees hitting their stops, not quite together
        for (let i = 0; i < 4; i++) {
          this._punch(190 - i * 8, 64, 0.045, 0.10 * v, i * 0.036, pan + (i - 1.5) * 0.12, 'triangle');
        }
        break;
      case 'jack':       // screw threads: a tick per turn, slowing as they load
        for (let i = 0; i < 9; i++) {
          this._noise(0.014, 'bandpass', 2100, 5, 0.05 * v, i * (0.017 + i * 0.0026), pan);
        }
        this._tone('sawtooth', 96, 0.28, 0.05 * v, 0.02, pan, 62);           // taking the weight
        break;
      case 'level':      // two jacks arguing, and the hull creaking about it
        this._noise(0.09, 'highpass', 3400, 1, 0.05 * v, 0, pan - 0.3);
        this._noise(0.09, 'highpass', 3100, 1, 0.05 * v, 0.07, pan + 0.3);
        this._tone('sawtooth', 150, 0.20, 0.035 * v, 0.05, pan, 108);
        break;
      case 'spade':      // THE THUMP: the loudest single event in the sequence
        this._punch(140, 40, 0.11, 0.30 * v, 0, pan, 'triangle');
        this._punch(58, 26, 0.26, 0.20 * v, 0, pan, 'sine');
        this._noise(0.14, 'lowpass', 340, 1, 0.19 * v, 0, pan);              // earth
        this._noise(0.06, 'bandpass', 1700, 3, 0.07 * v, 0.01, pan);         // steel on grit
        this._tone('sine', 780, 0.16, 0.030 * v, 0.02, pan, 420);            // the blade ringing
        break;
      case 'rise':       // the twin posts standing the deck up, and locking
        this._tone('sawtooth', 74, 0.26, 0.085 * v, 0, pan, 190);
        this._noise(0.24, 'lowpass', 800, 1.4, 0.07 * v, 0, pan, 1500);
        this._tone('square', 420, 0.03, 0.06 * v, 0.24, pan - 0.15);         // collar
        this._tone('square', 396, 0.03, 0.06 * v, 0.27, pan + 0.15);         // collar
        break;
      case 'battery':    // the whole gun running out on its rails and slamming
        this._noise(0.16, 'bandpass', 520, 1.6, 0.13 * v, 0, pan, 1500);
        this._punch(210, 70, 0.06, 0.19 * v, 0.15, pan, 'square');
        this._tone('sine', 1500, 0.09, 0.030 * v, 0.16, pan, 900);
        break;
      case 'wings':      // two shield plates, and the ready rack dropping
        this._noise(0.09, 'bandpass', 1500, 2, 0.055 * v, 0, pan - 0.2);
        this._noise(0.09, 'bandpass', 1350, 2, 0.055 * v, 0.05, pan + 0.2);
        this._punch(160, 62, 0.05, 0.10 * v, 0.11, pan, 'triangle');         // the rack
        break;
      case 'shutter':    // THE DOORS, and the first thing on it that is not dry
        this._tone('square', 240, 0.04, 0.08 * v, 0, pan, 150);              // bolt
        this._tone('square', 228, 0.04, 0.08 * v, 0.035, pan, 142);          // bolt
        this._noise(0.34, 'highpass', 2600, 0.6, 0.10 * v, 0.07, pan, 900);  // the seal letting go
        this._tone('sawtooth', 132, 0.42, 0.055 * v, 0.10, pan, 74);         // dry hinges
        this._noise(0.30, 'lowpass', 240, 1.6, 0.055 * v, 0.16, pan);        // and something wet
        break;
      case 'perfuse':    // the pump priming, and then the first beat
        for (let i = 0; i < 3; i++) {                                        // three strokes
          this._noise(0.09, 'lowpass', 300 + i * 60, 2.2, 0.09 * v, i * 0.10, pan);
          this._tone('sine', 120 + i * 14, 0.09, 0.05 * v, i * 0.10, pan, 74);
        }
        this._noise(0.22, 'bandpass', 420, 1.1, 0.055 * v, 0.14, pan, 1250); // fluid climbing
        this.wardenPulse(pos, 1.0, 1.35, 0.34);                              // and there it is
        break;
      case 'cortex':     // six contacts seating on something that is not metal
        for (let i = 0; i < 6; i++) {
          this._tone('square', 2400 + i * 190, 0.012, 0.030 * v, i * 0.014, pan);
        }
        this._tone('sawtooth', 300, 0.22, 0.045 * v, 0.06, pan, 1500);       // the rail coming up
        this._noise(0.10, 'highpass', 5200, 1.4, 0.035 * v, 0.10, pan, 2600); // the needle, on paper
        break;
      case 'range':      // the bar telescoping, and two caps flipping off
        for (let i = 0; i < 7; i++) {
          this._noise(0.010, 'bandpass', 3300, 6, 0.032 * v, i * 0.020, pan);
        }
        this._tone('square', 1300, 0.02, 0.035 * v, 0.16, pan - 0.25);
        this._tone('square', 1180, 0.02, 0.035 * v, 0.19, pan + 0.25);
        break;
      case 'charge':     // drawn, and let go
        this._noise(0.07, 'bandpass', 1250, 2.4, 0.11 * v, 0, pan, 700);
        this._punch(250, 92, 0.045, 0.15 * v, 0.075, pan, 'square');
        break;
      case 'ready':      // lamps run, and the chimney cowl starts turning.
        // The two-note "on station" is NOT played here: the entity emits it as
        // a sentry:voice of its own on the same beat, and playing it from both
        // ends is how you get a machine that stutters its own name.
        this._noise(0.05, 'bandpass', 1800, 4, 0.035 * v, 0, pan);
        this._noise(0.55, 'bandpass', 520, 1.1, 0.028 * v, 0.10, pan, 760);
        break;
      default: break;
    }
  }

  /**
   * ONE HEARTBEAT, THROUGH THE HULL OF A GUN.
   *
   * The single most important sound on this machine, and the one it would be
   * easiest to get wrong by making it loud. It is not a jump scare and it is
   * not a soundtrack cue — it is a thing you notice standing near a turret and
   * then cannot stop noticing, so it is quiet, it is almost entirely below
   * 200 Hz, and it dies at sixteen metres.
   *
   * Lub and dub, a fifth of a second apart, each a sine dropping fast, with a
   * skin of low-passed noise over them for the muffle of a steel drum and a
   * jar of fluid in the way. `rate` is the live rate in Hz, which tightens the
   * gap between the two thumps the faster it goes — a racing heart is not just
   * a faster heart, it is a TIGHTER one, and that is the tell that tells a
   * player something is frightened long before they work out what.
   */
  wardenPulse(pos, rate = 1, strength = 1, when = 0) {
    const s = this._spatial(pos, 16);
    if (!s) return;
    const v = s.vol * s.vol * strength, pan = s.pan;      // squared: falls away fast
    if (v < 0.02) return;
    const gap = Math.max(0.10, 0.20 - (rate - 1) * 0.035);
    this._tone('sine', 74, 0.13, 0.115 * v, when, pan, 40);
    this._noise(0.09, 'lowpass', 210, 1.2, 0.055 * v, when, pan);
    this._tone('sine', 62, 0.11, 0.065 * v, when + gap, pan, 36);
    this._noise(0.07, 'lowpass', 180, 1.2, 0.030 * v, when + gap, pan);
  }

  /**
   * The plumbing, the glass, and the thing behind it.
   *
   * All of these are close-range only: the perfusion plant is a bottle and a
   * piston on the side of a machine, and if you can hear it you are standing
   * near enough to read the plate.
   */
  wardenVessel(pos, kind) {
    const s = this._spatial(pos, kind === 'startle' ? 22 : 11);
    if (!s) return;
    const v = s.vol, pan = s.pan;
    switch (kind) {
      case 'prime':      // the circuit filling for the first time
        this._noise(0.5, 'bandpass', 380, 1.0, 0.06 * v, 0, pan, 1100);
        this._tone('sine', 96, 0.35, 0.045 * v, 0.05, pan, 58);
        break;
      case 'tap':        // two knuckles on a bottle you do not trust
        for (let i = 0; i < 2; i++) {
          this._tone('sine', 1760, 0.10, 0.055 * v, i * 0.17, pan, 1180);
          this._noise(0.012, 'highpass', 5000, 3, 0.030 * v, i * 0.17, pan);
        }
        this._noise(0.26, 'lowpass', 260, 2.0, 0.040 * v, 0.18, pan);        // the level settling
        break;
      case 'turn':       // it is moving in there, against the pins
        this._noise(0.85, 'lowpass', 240, 1.8, 0.075 * v, 0, pan, 120);
        this._tone('sine', 44, 0.9, 0.055 * v, 0, pan, 33);
        this._tone('sawtooth', 1900, 0.30, 0.016 * v, 0.12, pan, 2450);      // glass, complaining
        break;
      case 'startle':    // a surge through the whole circuit, all at once
        this._noise(0.20, 'lowpass', 420, 1.4, 0.11 * v, 0, pan, 130);
        this._tone('sine', 88, 0.22, 0.085 * v, 0, pan, 44);
        this._noise(0.09, 'highpass', 3600, 1, 0.05 * v, 0.02, pan);
        break;
      default: break;
    }
  }

  /**
   * THE TALKBACK — a field telephone's earpiece, wired backwards.
   *
   * The Mk II has no voice and was never given one. Everything it says is two
   * notes through a horn speaker, bracketed by the click of a carrier opening
   * and closing, and the vocabulary is deliberately tiny so a player learns it
   * without being taught.
   *
   * Except for 'dream'. That one is not two notes: it is a pair of detuned
   * saws dragged through a bandpass along a vowel path — the shape of a word
   * without any of the consonants, arriving out of a machine that cannot make
   * words. It is the quietest thing in this file and the only one anybody will
   * remember.
   */
  wardenVoice(pos, phrase) {
    const s = this._spatial(pos, phrase === 'dream' ? 15 : 26);
    if (!s || !this.ctx) return;
    const v = s.vol, pan = s.pan;
    const click = (when, gain = 0.035) => this._noise(0.010, 'highpass', 2800, 2, gain * v, when, pan);
    const say = (f, when, dur = 0.06, gain = 0.055) => this._tone('square', f, dur, gain * v, when, pan);
    switch (phrase) {
      case 'station':    // on station, and nothing more to add
        click(0);
        say(523, 0.03); say(784, 0.11, 0.10);
        click(0.24, 0.025);
        break;
      case 'ack':
        click(0); say(784, 0.02, 0.05); say(988, 0.08, 0.07); click(0.18, 0.02);
        break;
      case 'greet':      // two of them, on the same corner, in lamps and tones
        click(0); say(659, 0.02, 0.05); say(880, 0.08, 0.05); say(659, 0.15, 0.08);
        click(0.26, 0.02);
        break;
      /**
       * QUERY — what it says when it stops and looks at you.
       *
       * One note, held far too long, and it WAVERS: two oscillators a couple
       * of cents apart so the tone beats against itself and never quite
       * settles. And then the carrier stays open for another half-second with
       * nothing on it, which is the part that does the work — the machine
       * opened its mouth, made one sound, and then just left the line up.
       */
      case 'query':
        click(0);
        this._tone('square', 392, 0.62, 0.040 * v, 0.03, pan);
        this._tone('square', 394.6, 0.62, 0.032 * v, 0.03, pan);
        this._noise(0.55, 'bandpass', 1500, 0.8, 0.014 * v, 0.14, pan, 900);  // an open line
        click(0.78, 0.03);
        break;
      case 'grief':      // two notes down, through something soft
        click(0);
        this._tone('triangle', 330, 0.16, 0.045 * v, 0.03, pan);
        this._tone('triangle', 247, 0.26, 0.045 * v, 0.16, pan, 208);
        this._noise(0.20, 'lowpass', 620, 1.2, 0.020 * v, 0.16, pan);
        click(0.44, 0.02);
        break;
      case 'warn':
        this._tone('sawtooth', 138, 0.30, 0.045 * v, 0, pan, 104);
        this._tone('square', 277, 0.10, 0.030 * v, 0.06, pan);
        break;
      /**
       * DREAM — the sound the machine is not supposed to be able to make.
       *
       * Two saws a whisker apart, run through a narrow bandpass that walks a
       * vowel path (open, closed, open) over about half a second, with a
       * breath of noise under it. No note, no interval, no acknowledgement:
       * just the shape of somebody saying something, arriving through a
       * speaker that was only ever meant to beep.
       */
      case 'dream': {
        const g = 0.030 * v;
        this._tone('sawtooth', 128, 0.52, g, 0, pan, 108);
        this._tone('sawtooth', 131.5, 0.52, g * 0.8, 0.01, pan, 111);
        this._noise(0.44, 'bandpass', 700, 4.5, 0.055 * v, 0.02, pan, 1450);  // vowel, opening
        this._noise(0.26, 'bandpass', 1450, 5.5, 0.038 * v, 0.24, pan, 480);  // ...and closing
        this._noise(0.30, 'lowpass', 340, 0.8, 0.022 * v, 0, pan);            // the breath under it
        click(0.56, 0.018);
        break;
      }
      default: break;
    }
  }

  /** It folding itself back into the satchel. */
  sentryStow() {
    this._noise(0.1, 'lowpass', 1100, 1, 0.1);
    this._tone('square', 260, 0.06, 0.07, 0.06, 0, 180);
  }

  /* ---------------- the arcade ---------------- */

  /**
   * The machine's own voice, while you are stood at it.
   *
   * Everything else in this file is trying to sound like a real object in a
   * real room. These deliberately are not: hard square and triangle waves,
   * no noise layer, no tail, all of it under 120 ms. That is what a cabinet
   * of this vintage had to work with — one voice and a divider — and the
   * contrast with the rest of the game's audio is the point. Each machine
   * gets a different base pitch so you can tell from the next room which one
   * someone is playing.
   */
  arcadeBeep(kind, id = 'brickfall') {
    if (!this.ctx) return;
    const base = { brickfall: 1, vermin: 1.19, siege: 0.84, rally: 1.33 }[id] ?? 1;
    const b = (type, f, dur, gain, when = 0, fEnd = null) =>
      this._tone(type, f * base, dur, gain, when, 0, fEnd && fEnd * base);
    switch (kind) {
      case 'wall':   b('square', 392, 0.035, 0.07); break;
      case 'bounce': b('square', 587, 0.05, 0.1); break;
      case 'launch': b('square', 330, 0.09, 0.09, 0, 660); break;
      case 'shoot':  b('square', 880, 0.06, 0.08, 0, 330); break;
      case 'march':  b('triangle', 147, 0.07, 0.11); break;
      case 'break':  b('square', 784, 0.045, 0.11); b('square', 1046, 0.04, 0.07, 0.03); break;
      case 'pip':    b('square', 659, 0.05, 0.11); b('square', 988, 0.06, 0.09, 0.045); break;
      case 'score':  b('square', 523, 0.07, 0.12); b('square', 784, 0.09, 0.12, 0.06); break;
      case 'lose':   b('triangle', 262, 0.14, 0.12, 0, 131); break;
      case 'over':   for (const [f, w] of [[392, 0], [311, 0.1], [233, 0.2], [175, 0.32]]) b('triangle', f, 0.16, 0.13, w); break;
      case 'win':    for (const [f, w] of [[523, 0], [659, 0.07], [784, 0.14], [1046, 0.22]]) b('square', f, 0.13, 0.12, w); break;
      default: break;
    }
  }

  /**
   * A cabinet running its attract loop, heard from across the room.
   *
   * Fired by the same beat that steps the screen's four frames, so the noise
   * a machine makes and the picture it is showing are the same clock — an
   * arcade where the sound and the screens are on separate timers reads as a
   * room full of loops rather than a room full of machines. Very quiet, and
   * cut off at ten metres, so it colours the arcade and nothing else.
   */
  arcadeAttract(pos, id = 'brickfall') {
    const sp = this._spatial(pos, 10);
    if (!sp || !this.ctx) return;
    const base = { brickfall: 1, vermin: 1.19, siege: 0.84, rally: 1.33 }[id] ?? 1;
    const gain = 0.035 * sp.vol * sp.vol;   // squared: falls away fast
    this._tone('square', 523 * base, 0.04, gain, 0, sp.pan);
    this._tone('square', 784 * base, 0.05, gain * 0.7, 0.05, sp.pan);
  }

  /* ---------------- world events ---------------- */

  // "New wave" announcement: a concise, warm bell chime-jingle (a rising
  // G–C–E–G arpeggio resolving up an octave) with a soft shimmer tail —
  // appealing and clearly readable over combat, not an alarm blare.
  horn() {
    if (!this.ctx) return;
    const bell = (f, when, gain = 0.16, dur = 0.55) => {
      this._tone('sine', f, dur, gain, when);            // pure body
      this._tone('triangle', f * 2, dur * 0.5, gain * 0.35, when); // bright partial
      this._tone('sine', f * 3, dur * 0.3, gain * 0.12, when);     // sparkle
    };
    const seq = [[392, 0], [523, 0.11], [659, 0.22], [784, 0.34]]; // G4 C5 E5 G5
    for (const [f, w] of seq) bell(f, w);
    bell(1046, 0.5, 0.14, 0.8);                          // resolve up to C6
    this._noise(0.5, 'highpass', 6500, 0.7, 0.03, 0.52); // airy shimmer tail
  }

  rumble() {
    this._noise(2.4, 'lowpass', 130, 0.7, 0.5);
    this._tone('sine', 45, 2.2, 0.32, 0, 0, 28);
  }

  bell() {
    for (const [f, g, w] of [[660, 0.3, 0], [1320, 0.12, 0], [660 * 0.99, 0.2, 0.8], [495, 0.1, 0]]) {
      this._tone('sine', f, 2.6, g, w);
    }
    this._noise(0.04, 'highpass', 2400, 1, 0.2);
  }

  fanfare() {
    if (!this.ctx) return;
    const seq = [523, 659, 784, 1046, 784, 1046, 1318, 1568];
    seq.forEach((n, i) => {
      this._tone('square', n, 0.22, 0.14, i * 0.16);
      this._tone('triangle', n / 2, 0.22, 0.1, i * 0.16);
    });
    this._tone('triangle', 2093, 1.2, 0.12, seq.length * 0.16);
  }

  /* ---------------- the sentry and the adjutant ---------------- */

  /**
   * The sentry noticing you and putting its barrel up.
   *
   * A servo running up and stopping, then two soft courtesy beeps. It is
   * pointedly NOT a fanfare: this thing is a gun on a stand acknowledging a
   * person, and the joke only lands if it stays deadpan about it.
   */
  sentrySalute(pos) {
    const s = this._spatial(pos, 26);
    if (!s) return;
    this._tone('sawtooth', 90, 0.34, 0.05 * s.vol, 0, s.pan, 260);     // the elevation servo
    this._noise(0.04, 'bandpass', 1800, 3, 0.05 * s.vol, 0.3, s.pan);  // it hitting the stop
    this._tone('square', 880, 0.05, 0.05 * s.vol, 0.40, s.pan);
    this._tone('square', 1320, 0.07, 0.05 * s.vol, 0.50, s.pan);
  }

  /** ...and waking back up out of a doze, which is the same servo, hurried. */
  sentryWake(pos) {
    const s = this._spatial(pos, 26);
    if (!s) return;
    this._tone('sawtooth', 300, 0.16, 0.06 * s.vol, 0, s.pan, 90);
    this._noise(0.05, 'highpass', 2400, 1, 0.06 * s.vol, 0.02, s.pan);
  }

  /**
   * THE ADJUTANT'S VOICE.
   *
   * She does not speak — she was refurbished out of a machine that never
   * could — so everything she says is a two- or three-note synth phrase off
   * the same square-wave voice. The vocabulary is deliberately tiny and
   * consistent, so a player learns it without being taught: rising means yes,
   * falling means no, the fast triple is her acknowledging an order, and the
   * low warble is the one thing she does that is not an answer to anything.
   */
  companionVoice(kind, pos) {
    const s = pos ? this._spatial(pos, 30) : { vol: 1, pan: 0 };
    if (!s) return;
    const v = 0.085 * s.vol, pan = s.pan;
    const say = (f, w, d = 0.06, type = 'square') => this._tone(type, f, d, v, w, pan);
    switch (kind) {
      case 'wake':        // unfolding: a power rail coming up, then hello
        this._tone('sawtooth', 70, 0.55, 0.05 * s.vol, 0, pan, 320);
        this._noise(0.08, 'bandpass', 900, 2, 0.05 * s.vol, 0.3, pan);
        say(523, 0.5); say(659, 0.58); say(880, 0.66, 0.12);
        break;
      case 'ack':         // an order landing: three quick rising blips
        say(784, 0); say(988, 0.06); say(1175, 0.12, 0.08);
        break;
      case 'no':          // told to stand down: two falling
        say(587, 0); say(440, 0.07, 0.10);
        break;
      case 'alert':       // she has seen something
        say(1175, 0, 0.04); say(1175, 0.07, 0.04); say(1568, 0.15, 0.07);
        break;
      case 'blade':       // the forearm blades locking out
        this._noise(0.05, 'bandpass', 3200, 4, 0.10 * s.vol, 0, pan);
        this._tone('triangle', 2400, 0.10, 0.06 * s.vol, 0.02, pan, 1600);
        break;
      case 'arc':         // the pods discharging
        this._noise(0.13, 'highpass', 2600, 0.8, 0.13 * s.vol, 0, pan);
        this._tone('sawtooth', 1400, 0.11, 0.07 * s.vol, 0, pan, 220);
        this._tone('sine', 90, 0.20, 0.08 * s.vol, 0.02, pan, 50);
        break;
      case 'purr':        // the low warble. She does this when she is content.
        for (let i = 0; i < 5; i++) {
          this._tone('triangle', 108 + Math.sin(i) * 8, 0.13, 0.045 * s.vol, i * 0.11, pan);
        }
        break;
      case 'fold':        // packing back up: the rail going down
        say(880, 0); say(659, 0.07); say(440, 0.14, 0.12);
        this._tone('sawtooth', 300, 0.4, 0.045 * s.vol, 0.16, pan, 60);
        break;
    }
  }

  /* ---------------- ambient loop ---------------- */

  /**
   * Called each frame with the local horde pressure (0..~20) and, when the
   * game is being played, the state the score reads: which district the player
   * is standing in and how close to dead they are.
   */
  update(dt, player, nearbyZombies, scene = null) {
    if (!this.ctx) return;
    // Layers whose moment has come round (see THE DRIP). First thing in the
    // frame, so a sound booked for three seconds' time is built with the
    // scheduler's full lead in hand rather than against the deadline.
    this._drainDeferred(this.ctx.currentTime);
    this.listener.x = player.position.x;
    this.listener.z = player.position.z;
    this.listener.yaw = player.yaw;

    if (this.music) {
      if (scene) {
        // The district decides the piece; the health decides which version of
        // it. Both are continuous, so both are pushed every frame and smoothed
        // inside the director rather than switched here.
        if (scene.zoneId != null) this.setTrack(ZONE_TRACKS[scene.zoneId] ?? ZONE_TRACKS[0]);
        this.music.setHealth(scene.healthFrac);
        // Horde pressure lifts the drums a little on top of the wave state, so
        // a quiet street and a street with nine of them on it do not sound the
        // same even inside one wave.
        if (scene.waveActive != null) {
          this.music.setIntensity((scene.waveActive ? 0.62 : 0.2)
            + Math.min(0.38, nearbyZombies / 14));
        }
      }
      this.music.update(dt);
    }

    // Ambient horde presence. This used to be a moan; it is now the sound of
    // a street with people on it — someone muttering, a door somewhere, boots
    // on gravel — and it thickens as the local pressure rises. The lines
    // themselves come from whoever is actually standing near you (the horde
    // emits 'zombie:chatter'); this is the ROOM they are standing in.
    this.moanIntensity = Math.min(1, nearbyZombies / 12);
    this._moanTimer -= dt;
    if (this._moanTimer <= 0) {
      this._moanTimer = 5.5 - this.moanIntensity * 4.4 + Math.random() * 2;
      if (nearbyZombies > 0) this.moan(Math.random() * 1.6 - 0.8, 0.35 + this.moanIntensity * 0.65);
    }

    // Rare ambient whispers keep the town wrong.
    this._whisperTimer -= dt;
    if (this._whisperTimer <= 0) {
      this._whisperTimer = 70 + Math.random() * 90;
      this.whisper(0.35);
    }
  }
}

/** 0..1 with a fallback, for settings values that may arrive as anything. */
function clamp01(v, fallback) {
  const n = +v;
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}
