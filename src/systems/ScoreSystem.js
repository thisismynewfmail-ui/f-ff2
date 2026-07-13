/**
 * Kill counting, scoring and the single victory condition.
 *
 * THE win condition: exactly 250,000 total zombie kills. Kills only enter
 * through registerKill() (driven by 'zombie:death' events from the real
 * damage pipeline), each kill increments the counter by exactly 1, and the
 * victory event fires at the moment the counter reaches 250,000 — no other
 * trigger exists.
 *
 * Points are separate from kills: Walker = 1, Sprinter = 2, Tank = 5.
 * Accuracy = trigger pulls that hit / trigger pulls fired.
 */
export const WIN_KILLS = 250000;

export class ScoreSystem {
  constructor(events) {
    this.events = events;
    this.kills = 0;
    this.points = 0;
    this.byType = { Walker: 0, Sprinter: 0, Tank: 0 };
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.timePlayed = 0;
    this.victory = false;

    events.on('zombie:death', ({ type, points }) => this.registerKill(type.name, points));
    events.on('shot:fired', () => { this.shotsFired++; });
    events.on('shot:hit', () => { this.shotsHit++; });
  }

  registerKill(typeName, points = 1) {
    if (this.victory) return; // the war is over
    this.kills += 1;
    this.points += points;
    if (this.byType[typeName] === undefined) this.byType[typeName] = 0;
    this.byType[typeName] += 1;
    this.events.emit('kill', { total: this.kills, typeName, points: this.points });
    if (this.kills === WIN_KILLS) {
      this.victory = true;
      this.events.emit('victory', { stats: this.stats() });
    }
  }

  get accuracy() {
    return this.shotsFired === 0 ? 0 : this.shotsHit / this.shotsFired;
  }

  /**
   * Freeze the run-progress counters so a checkpoint can roll them back on
   * death. The survival clock (timePlayed) is deliberately left out — it is a
   * cumulative record across attempts, not a per-run stat to rewind.
   */
  snapshot() {
    return {
      kills: this.kills,
      points: this.points,
      byType: { ...this.byType },
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
    };
  }

  /** Restore counters captured by snapshot() (used by the checkpoint system). */
  restore(snap) {
    if (!snap) return;
    this.kills = snap.kills;
    this.points = snap.points;
    this.byType = { ...snap.byType };
    this.shotsFired = snap.shotsFired;
    this.shotsHit = snap.shotsHit;
  }

  tick(dt) {
    if (!this.victory) this.timePlayed += dt;
  }

  stats() {
    return {
      kills: this.kills,
      points: this.points,
      byType: { ...this.byType },
      accuracy: this.accuracy,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      timePlayed: this.timePlayed,
    };
  }
}
