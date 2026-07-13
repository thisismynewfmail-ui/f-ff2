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
 * Difficulty escalates on three axes: the wave number, overall progress toward
 * the 250,000-kill goal, and "heat" — an extra ramp that kicks in past 250
 * kills, shortening the spawn interval and swelling the horde without letting
 * it overflow the active cap.
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
// Exploders stay out of the mix until the player has this many kills under
// their belt, then join the spawn table with a modest, slowly-growing share.
export const EXPLODER_KILL_GATE = 120;
// The opening waves stream a small surplus over the quota so the early field
// feels a touch busier — a few bodies still standing when the wave clears.
const EARLY_WAVES = 5;

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

  /** Kills needed to clear wave n — grows with the wave, steepened by heat. */
  waveQuota(n) {
    const base = 8 + n * 3;
    return Math.round(Math.min(320, base * (1 + this.heat * 0.6 + this.progress * 2)));
  }

  /** Seconds between spawn pulses — falls with the wave, progress and heat. */
  spawnInterval() {
    const perWave = 0.08 + this.heat * 0.05;   // waves ramp faster once past the gate
    return Math.max(0.4, 2.1 - this.wave * perWave - this.progress * 0.8 - this.heat * 0.7);
  }

  /** Zombies per spawn pulse — a bigger trickle once the horde heats up. */
  batchSize() {
    return 2 + Math.round(this.heat * 3) + ((Math.random() * 4) | 0);
  }

  /** Concurrent-zombie cap — lifts modestly with heat, never overflowing. */
  activeCap() {
    return Math.round(55 + this.heat * 22);
  }

  typeWeights() {
    const sprinter = Math.min(0.38, 0.04 + this.wave * 0.012 + this.progress * 0.34);
    const tank = Math.min(0.15, Math.max(0, (this.wave - 3) * 0.008 + this.progress * 0.12));
    // Only spawn exploders once past the kill gate; then ramp their share a
    // little with overall progress.
    const exploder = this.score.kills >= EXPLODER_KILL_GATE
      ? Math.min(0.2, 0.07 + this.progress * 0.13) : 0;
    return { walker: Math.max(0, 1 - sprinter - tank - exploder), sprinter, tank, exploder };
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
