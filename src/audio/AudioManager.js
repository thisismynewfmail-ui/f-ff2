/**
 * All game audio, synthesized with WebAudio — no sound files.
 *
 * Per-weapon gunshots, reload/empty clicks, surface-aware footsteps, pickup
 * chimes, zombie moans/growls (ambient intensity scales with how many are
 * nearby, positioned in stereo), wave horns, unlock rumbles, cosmic-horror
 * whispers and the victory fanfare.
 *
 * Everything is event-driven; systems never call into audio directly.
 */
export class AudioManager {
  constructor(events) {
    this.events = events;
    this.ctx = null;
    this.master = null;
    this.volume = 0.5; // master gain; settable before/after unlock (settings)
    this._noiseBuf = null;
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
      : this.ammoChime()));
    on('player:damage', () => this.hurt());
    on('player:heal', () => {});
    on('player:died', () => this.deathSting());
    on('zombie:death', ({ pos }) => this.zombieDeath(pos));
    on('exploder:explode', ({ pos }) => this.explosion(pos));
    on('spitter:fire', ({ pos }) => this.spitterShot(pos));
    on('zombie:aggro', ({ pos }) => this.growl(pos));
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
    on('crow:caw', ({ pos }) => this.crowCaw(pos));
    on('victory', () => this.fanfare());
  }

  /** Must be called from a user gesture (start button). */
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
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
    const len = this.ctx.sampleRate * 1.5;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Settings hook: master volume 0..1, applied live once unlocked. */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0.5));
    if (this.master) this.master.gain.value = this.volume;
  }

  get t() { return this.ctx.currentTime; }

  _noise(dur, filterType, freq, q, gain, when = 0, pan = 0, freqEnd = null) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, this.t + when);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, this.t + when + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t + when);
    g.gain.exponentialRampToValueAtTime(0.001, this.t + when + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(this.t + when);
    src.stop(this.t + when + dur + 0.05);
  }

  _tone(type, freq, dur, gain, when = 0, pan = 0, freqEnd = null) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.t + when);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), this.t + when + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t + when);
    g.gain.exponentialRampToValueAtTime(0.001, this.t + when + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    o.start(this.t + when);
    o.stop(this.t + when + dur + 0.05);
  }

  /** Stereo pan + attenuation for a world position. */
  _spatial(pos, maxDist = 60) {
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist) return null;
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    return { pan: Math.max(-1, Math.min(1, -Math.sin(ang) * 0.8)), vol: 1 - dist / maxDist };
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
      case 'pistol': // nickel target automatic: bright snap + singing slide ping
        this._punch(340, 78, 0.07, 0.42, 0, 0, 'triangle');
        this._noise(0.05, 'bandpass', 3400, 1.1, 0.4);
        this._noise(0.06, 'lowpass', 2200, 1, 0.3);
        this._tone('sine', 5200, 0.07, 0.05, 0.045, 0.08, 3600); // nickel ring
        this._brassTick(0.055, 0.07);
        break;
      case 'pistolAuto': // hair-trigger: clipped snap so rapid fire stays clean
        this._punch(300, 95, 0.045, 0.3, 0, 0, 'triangle');
        this._noise(0.04, 'bandpass', 3600, 1.3, 0.32);
        this._tone('sine', 4800, 0.04, 0.03, 0.03, 0.06, 3400);
        break;
      case 'shotgun': // coachgun: tight modern 12-bore slam + hammer clack
        this._punch(170, 34, 0.16, 0.6, 0, 0, 'sine');
        this._punch(72, 26, 0.3, 0.46, 0, 0, 'sine');
        this._noise(0.16, 'lowpass', 1400, 0.9, 0.58);             // sharp crack
        this._noise(0.08, 'bandpass', 3200, 1.2, 0.2);             // muzzle sizzle
        this._noise(0.34, 'lowpass', 480, 0.6, 0.16, 0.06);        // short tail
        this._tone('square', 1500, 0.02, 0.08, 0.002, 0.05, 900);  // hammer clack
        this._tone('sine', 2400, 0.05, 0.04, 0.05, 0.08, 1700);    // bore ring
        break;
      case 'shotgunDouble': // both barrels: stacked slams, the biggest voice
        this._punch(170, 30, 0.2, 0.66, 0, 0, 'sine');
        this._punch(140, 28, 0.22, 0.5, 0.02, 0, 'sine');
        this._punch(58, 22, 0.42, 0.44, 0, 0, 'sine');
        this._noise(0.2, 'lowpass', 1300, 0.9, 0.62);
        this._noise(0.5, 'lowpass', 420, 0.5, 0.2, 0.1);
        this._tone('square', 1500, 0.02, 0.08, 0.002, 0.05, 900);
        break;
      case 'rifle': // foundry gun: industrial hammer-crack + steam exhaust
        this._punch(210, 68, 0.05, 0.38, 0, 0, 'square');
        this._noise(0.05, 'bandpass', 1900, 1.4, 0.4);
        this._noise(0.05, 'highpass', 5600, 0.8, 0.09, 0.015);     // steam spit
        this._tone('square', 1300, 0.025, 0.09, 0.01, -0.08, 2200); // link rattle
        break;
      case 'rifleBurst': // burst: tighter hammer, hotter steam
        this._punch(230, 80, 0.045, 0.4, 0, 0, 'square');
        this._noise(0.045, 'bandpass', 2200, 1.5, 0.42);
        this._noise(0.04, 'highpass', 6000, 0.8, 0.08, 0.012);
        break;
      case 'sniper': // meridian long rifle: colossal crack, then the whole
        // bolt cycle plays out — lift, draw, case ping, return, lock
        this._punch(160, 34, 0.24, 0.64, 0, 0, 'sawtooth');
        this._punch(58, 24, 0.36, 0.42, 0, 0, 'sine');
        this._noise(0.12, 'lowpass', 4200, 1, 0.58);
        this._noise(0.6, 'lowpass', 680, 0.6, 0.2, 0.16);          // valley echo 1
        this._noise(0.8, 'lowpass', 440, 0.6, 0.12, 0.4);          // valley echo 2
        this._tone('square', 1400, 0.02, 0.07, 0.24, 0.1, 900);    // bolt lifts
        this._noise(0.07, 'bandpass', 1100, 1.5, 0.09, 0.36, 0.12);// draw back
        this._tone('sine', 3400, 0.09, 0.05, 0.5, 0.2, 2400);      // spent case pings
        this._noise(0.06, 'bandpass', 1200, 1.5, 0.09, 0.72, 0.1); // bolt returns
        this._tone('square', 1100, 0.025, 0.09, 0.94, 0.06, 700);  // locks
        break;
      case 'batCharge': // sprung heavy swing: spring creak, whip, iron slam
        this._tone('triangle', 240, 0.18, 0.14, 0, 0, 90);         // spring compress creak
        this._noise(0.3, 'bandpass', 700, 1.4, 0.26, 0.1, 0, 1900); // whip
        this._tone('sine', 66, 0.14, 0.36, 0.32, 0, 38);           // iron slam
        this._noise(0.07, 'lowpass', 420, 1, 0.36, 0.33);          // clank
        break;
      case 'bat': break; // primary swing carried by whoosh()/thud()
    }
  }

  whoosh() { this._noise(0.16, 'bandpass', 500, 1.6, 0.28, 0, 0, 1500); }
  thud() { this._noise(0.1, 'lowpass', 300, 1, 0.55); this._tone('sine', 90, 0.1, 0.4, 0, 0, 50); }
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
      case 'pistol': this._tone('sine', 3800, 0.05, 0.04, 0.12, 0.06, 2800); break; // nickel ring
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

  growl(pos) {
    const s = this._spatial(pos, 50);
    if (!s) return;
    this._tone('sawtooth', 90 + Math.random() * 40, 0.5, 0.16 * s.vol, 0, s.pan, 60);
    this._noise(0.4, 'bandpass', 300, 2, 0.12 * s.vol, 0, s.pan);
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

  moan(pan, vol) {
    const f = 65 + Math.random() * 55;
    this._tone('sawtooth', f, 1.4, 0.09 * vol, 0, pan, f * (0.8 + Math.random() * 0.5));
    this._noise(1.1, 'bandpass', 260 + Math.random() * 160, 3, 0.05 * vol, 0.1, pan);
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
    }
  }

  /** The booth phone rings — panned to the wrong side of the street. */
  phoneRing(pos) {
    if (!this.ctx) return;
    const s = this._spatial(pos, 70);
    if (!s) return;
    const pan = -s.pan;
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

  /** Taking the Companion Cube: a warm rising chord, almost grateful. */
  cubeChime() {
    const seq = [[392, 0], [494, 0.09], [587, 0.18], [784, 0.3]];
    for (const [f, w] of seq) this._tone('triangle', f, 0.3, 0.12, w);
    this._tone('sine', 1568, 0.8, 0.05, 0.42);
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

  /* ---------------- ambient loop ---------------- */

  /** Called each frame with the local horde pressure (0..~20). */
  update(dt, player, nearbyZombies) {
    if (!this.ctx) return;
    this.listener.x = player.position.x;
    this.listener.z = player.position.z;
    this.listener.yaw = player.yaw;

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
