import { WIN_KILLS } from './ScoreSystem.js';

/**
 * Horde waves — driven by KILLS.
 *
 * Each wave sets a kill quota. The spawn director streams that many zombies
 * into the world (replacing any that get culled), and the wave is cleared the
 * moment the player has killed the quota — so racking up kills is exactly what
 * advances the wave. When a wave clears there is a short respite with a supply
 * drop, then the next (larger) wave begins.
 *
 * Difficulty escalates on four axes: the wave number, overall progress toward
 * the 250,000-kill goal, "heat" — an extra ramp that kicks in past 250 kills —
 * and, past wave 6, an escalation keyed to the WAVE rather than the kill count,
 * so the horde thickens even for a player who is taking their time. All of them
 * shorten the spawn interval and swell the horde without letting it overflow
 * the active cap.
 *
 * Checkpoints: every tenth wave the run is snapshotted (see the checkpoint
 * wiring in Game). On death the run rolls back to the last checkpoint and that
 * wave is respawned from scratch via restartAtWave().
 */
const RESPITE_TIME = 10;
const CHECKPOINT_RESPITE = 3;   // brief breather when a checkpoint respawns a wave
// The kill count past which the horde starts ramping up harder.
export const HEAT_GATE = 250;
const HEAT_SPAN = 3000;         // kills over which heat climbs 0 → 1 past the gate
// A second, steeper ramp on the OVERALL spawn rate that kicks in here — where
// heat has barely moved — and climbs over SURGE_SPAN kills, thickening the horde.
export const SURGE_GATE = 400;
const SURGE_SPAN = 1600;        // kills over which the surge climbs 0 → 1 past the gate
// Exploders stay out of the mix until the player has this many kills under
// their belt, then join the spawn table with a modest, slowly-growing share.
export const EXPLODER_KILL_GATE = 120;
// ...and past this kill count the Exploder's spawn share steps up, so blast
// pressure ramps alongside the Spitter's.
export const EXPLODER_RAMP_GATE = 150;
// One scripted wave of nothing but bombers. It lands early and deliberately
// early: the kill gates above mean a player would otherwise meet their first
// Exploder somewhere in a crowd, which is a bad way to learn what one is.
// Wave 4 resumes the ordinary progression untouched.
export const EXPLODER_WAVE = 3;
// Past this many kills the STANDARD horde (the plain walkers) thickens: bigger
// spawn pulses and a higher concurrent cap, so the ordinary NPC pressure ramps
// up well before the later heat/surge gates ever engage.
export const HORDE_PUSH_GATE = 100;
const HORDE_PUSH_SPAN = 1200;   // kills over which the push climbs 0 → 1 past the gate
// The Spitter (ranged dual-pistol enemy) only starts spawning once the player
// has made this many kills, then joins the table with a small, growing share.
export const SPITTER_KILL_GATE = 100;
// ...and past this kill count the Spitter's spawn share steps up markedly, so
// ranged pressure ramps once the player is established.
export const SPITTER_RAMP_GATE = 120;
// The opening waves stream a small surplus over the quota so the early field
// feels a touch busier — a few bodies still standing when the wave clears.
const EARLY_WAVES = 5;
// Every ramp above is keyed to the KILL count, which means a careful player who
// takes their time never feels the horde thicken — the waves keep arriving at
// roughly the opening tempo. So there is one ramp on the WAVE clock too: past
// wave 6 the horde starts pressing harder whether or not the kills are there,
// and the per-wave ramp itself steepens as it goes.
export const ESCALATION_WAVE = 6;
const ESCALATION_SPAN = 8;      // waves over which the escalation climbs 0 → 1

export class WaveSystem {
  constructor(events, score) {
    this.events = events;
    this.score = score;
    this.wave = 0;
    this.state = 'respite';
    this.respiteLeft = 5;   // short grace period at game start
    this.quota = 0;         // kills required to clear the current wave
    this.killsThisWave = 0; // kills banked toward that quota
    this.toSpawn = 0;       // zombies the director still owes this wave
    this.aliveFromWave = 0; // wave zombies currently on the field
    this.suppliesDropped = true; // no drop before wave 1

    // Kills advance the wave: every registered kill (real or console) banks
    // toward the active wave's quota. Only counts while a wave is running.
    events.on('kill', () => { if (this.state === 'active') this.killsThisWave++; });
  }

  get progress() { return Math.min(1, this.score.kills / WIN_KILLS); }

  /** 0 below the gate, ramping to 1 over HEAT_SPAN kills past it. */
  get heat() { return Math.min(1, Math.max(0, (this.score.kills - HEAT_GATE) / HEAT_SPAN)); }

  /**
   * A second, harder ramp on the OVERALL spawn rate that kicks in past
   * SURGE_GATE (~400 kills), where heat has barely moved. It shortens the spawn
   * interval, fattens each batch and lifts the concurrent cap on top of heat, so
   * the horde tangibly thickens once the player is deep into a run. 0 below the
   * gate, climbing to 1 over SURGE_SPAN kills past it.
   */
  get surge() { return Math.min(1, Math.max(0, (this.score.kills - SURGE_GATE) / SURGE_SPAN)); }

  /**
   * Standard-horde push: 0 below HORDE_PUSH_GATE (~100 kills), ramping to 1 over
   * HORDE_PUSH_SPAN kills past it. It fattens each spawn pulse and lifts the
   * concurrent cap so noticeably more ordinary walkers press the player once
   * they are established — well ahead of the later heat/surge gates.
   */
  get hordePush() { return Math.min(1, Math.max(0, (this.score.kills - HORDE_PUSH_GATE) / HORDE_PUSH_SPAN)); }

  /**
   * Wave-clock escalation: 0 through wave 6, climbing to 1 by wave 14. Unlike
   * heat / surge / hordePush this does not care how many kills are banked, so
   * a player who is clearing waves slowly still feels the pressure build. It
   * shortens the interval, fattens the pulse, steepens the per-wave ramp and
   * lifts the cap to leave the extra bodies somewhere to stand.
   */
  get escalation() { return Math.min(1, Math.max(0, (this.wave - ESCALATION_WAVE) / ESCALATION_SPAN)); }

  /** Kills needed to clear wave n — grows with the wave, steepened by heat. */
  waveQuota(n) {
    const base = 8 + n * 3;
    return Math.round(Math.min(320, base * (1 + this.heat * 0.6 + this.progress * 2)));
  }

  /** Seconds between spawn pulses — falls with the wave, progress, heat and the
   *  post-400-kill surge (which drops the floor so pulses can come faster). */
  spawnInterval() {
    // Past wave 6 each further wave shaves a little more off than the one
    // before it, so the ramp itself ramps.
    const perWave = 0.08 + this.heat * 0.05 + this.escalation * 0.02;
    const floor = 0.3 - this.escalation * 0.04;
    return Math.max(floor, 2.1 - this.wave * perWave - this.progress * 0.8
      - this.heat * 0.7 - this.surge * 0.6 - this.escalation * 0.3);
  }

  /** Zombies per spawn pulse — a bigger trickle once the standard horde push
   *  engages past ~100 kills, bigger again as the horde heats up, and bigger
   *  still once the surge kicks in past ~400 kills. */
  batchSize() {
    return 2 + Math.round(this.hordePush * 3) + Math.round(this.heat * 3)
      + Math.round(this.surge * 3) + Math.round(this.escalation * 2)
      + ((Math.random() * 4) | 0);
  }

  /** Concurrent-zombie cap — lifts with the post-100-kill horde push, again with
   *  heat, and again with the post-400-kill surge, so the thicker spawn stream
   *  always has room to stay on the field. */
  activeCap() {
    return Math.round(55 + this.hordePush * 15 + this.heat * 22 + this.surge * 22
      + this.escalation * 14);
  }

  typeWeights() {
    // Wave 3 is the Exploder's wave and nothing else's — one scripted round
    // where the whole field is bombers, so the player meets the type properly
    // instead of first learning what one is by standing next to it. Wave 4
    // picks the ordinary progression back up exactly where it left off, and
    // this is the only wave that overrides the mix.
    if (this.wave === EXPLODER_WAVE) {
      return { walker: 0, sprinter: 0, tank: 0, exploder: 1, spitter: 0 };
    }
    const sprinter = Math.min(0.38, 0.04 + this.wave * 0.012 + this.progress * 0.34);
    const tank = Math.min(0.15, Math.max(0, (this.wave - 3) * 0.008 + this.progress * 0.12));
    // Only spawn exploders once past the kill gate at a modest share, then step
    // their spawn rate up once the player is past EXPLODER_RAMP_GATE kills.
    let exploder = 0;
    if (this.score.kills >= EXPLODER_KILL_GATE) {
      const base = this.score.kills >= EXPLODER_RAMP_GATE ? 0.16 : 0.07;
      exploder = Math.min(0.24, base + this.progress * 0.13);
    }
    // Spitters join once past their (earlier) kill gate at a modest share, then
    // their spawn rate steps up once the player is past SPITTER_RAMP_GATE kills.
    let spitter = 0;
    if (this.score.kills >= SPITTER_KILL_GATE) {
      const base = this.score.kills >= SPITTER_RAMP_GATE ? 0.15 : 0.06;
      spitter = Math.min(0.22, base + this.progress * 0.12);
    }
    return {
      walker: Math.max(0, 1 - sprinter - tank - exploder - spitter),
      sprinter, tank, exploder, spitter,
    };
  }

  /** True while the director still owes this wave zombies. */
  wantsSpawn() { return this.state === 'active' && this.toSpawn > 0; }

  /** Called by the spawn director when it spawns wave zombies. */
  noteSpawned(n = 1) { this.toSpawn -= n; this.aliveFromWave += n; }
  noteRemoved(n = 1) { this.aliveFromWave = Math.max(0, this.aliveFromWave - n); }
  /** A culled zombie was never killed — owe one more so the quota stays reachable. */
  refundSpawn(n = 1) { if (this.state === 'active') this.toSpawn += n; }

  /** Begin the next wave: set its quota, hand the director a fresh budget. */
  _beginWave() {
    this.wave++;
    this.quota = this.waveQuota(this.wave);
    this.killsThisWave = 0;
    // Opening waves stream 2–4 more bodies than the quota strictly needs, so a
    // few zombies are still standing when the wave clears. The quota (kills to
    // advance) is unchanged — only the surplus on the field grows.
    const surplus = this.wave <= EARLY_WAVES ? 2 + ((Math.random() * 3) | 0) : 0;
    this.toSpawn = this.quota + surplus;
    this.aliveFromWave = 0;
    this.state = 'active';
    this.events.emit('wave:start', { wave: this.wave, size: this.quota });
  }

  /**
   * Drop straight into the given wave after a short respite — used by the
   * checkpoint system so a rolled-back run respawns that wave from scratch.
   */
  restartAtWave(n) {
    this.wave = Math.max(0, n - 1);   // the respite tick brings it up to n
    this.state = 'respite';
    this.respiteLeft = CHECKPOINT_RESPITE;
    this.suppliesDropped = true;      // no supply drop on a checkpoint restart
    this.quota = 0;
    this.killsThisWave = 0;
    this.toSpawn = 0;
    this.aliveFromWave = 0;
  }

  update(dt, playerAlive) {
    if (!playerAlive) return;
    if (this.state === 'respite') {
      this.respiteLeft -= dt;
      if (!this.suppliesDropped && this.respiteLeft < RESPITE_TIME - 1.5) {
        this.suppliesDropped = true;
        this.events.emit('supplies:drop', { wave: this.wave });
      }
      if (this.respiteLeft <= 0) this._beginWave();
    } else if (this.killsThisWave >= this.quota) {
      // Quota met → the wave is cleared. Any stragglers roll into the respite
      // and on into the next wave; the kill count is what gates progression.
      this.state = 'respite';
      this.respiteLeft = RESPITE_TIME;
      this.suppliesDropped = false;
      this.events.emit('wave:end', { wave: this.wave });
    }
  }
}
