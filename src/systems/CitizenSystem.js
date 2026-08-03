import { Citizen } from '../entities/Citizen.js';

/**
 * Directs the rescuable citizen (see entities/Citizen.js): once the run is
 * past its kill gate, every wave start she has a chance to spawn captured
 * inside one random enterable building in a district the player has already
 * unlocked. Only one is ever live at a time — freeing her (or her escape
 * finishing) clears the slot so a later wave can roll a fresh spawn in a
 * different building. Which wave she shows up on and which building she's in
 * are both random every playthrough.
 */
const SPAWN_CHANCE = 0.4;
/**
 * She does not exist in the early game: no captive can appear until the run
 * has banked this many kills — the same kill-gate shape the Spitter and
 * Exploder use to join the spawn table. Read off ScoreSystem's running total
 * (the counter the zone unlocks key off too), so a checkpoint rollback that
 * rewinds the score re-closes the gate along with it. 100 kills lands just
 * past the 50-kill Eastgate unlock, so by the time she can appear there is
 * more than one district's worth of buildings to hide her in.
 */
export const CITIZEN_KILL_GATE = 100;

export class CitizenSystem {
  constructor(events, world, texLib, scene, score) {
    this.events = events;
    this.world = world;
    this.scene = scene;
    this.score = score;
    this.texCaptured = texLib.get('citizenCaptured');
    this.texReleased = texLib.get('citizenReleased');
    this.citizen = null;
    events.on('wave:start', () => this._maybeSpawn());
  }

  /** Buildings you can actually walk into, in a district already open. The
   *  hollow cottage is excluded — its interior belongs to its own secret. */
  _eligibleBuildings() {
    return this.world.buildingSpecs.filter((b) =>
      !b.solid && b.door && b.use !== 'hollow' && this.world.zones.isUnlocked(b.zone));
  }

  /** Has the run banked enough kills for captives to start appearing? */
  get unlocked() {
    return this.score.kills >= CITIZEN_KILL_GATE;
  }

  /** The per-wave roll: gated on the kill count, then on the spawn chance. */
  _maybeSpawn() {
    if (!this.unlocked) return null;
    if (Math.random() > SPAWN_CHANCE) return null;
    return this.spawnNow();
  }

  /**
   * Put a captive in a random eligible building right now, skipping both the
   * kill gate and the per-wave dice roll (the dev console's `spawn citizen`).
   * Returns the new citizen, or null if one is already live or no building
   * qualifies.
   */
  spawnNow() {
    if (this.citizen) return null;
    const candidates = this._eligibleBuildings();
    if (!candidates.length) return null;
    const spec = candidates[(Math.random() * candidates.length) | 0];
    const built = this.world.built.get(spec.name);
    if (!built) return null;
    this.citizen = new Citizen(this.events, this.world, this.texCaptured, this.texReleased, built);
    this.scene.add(this.citizen.mesh);
    return this.citizen;
  }

  update(dt, ctx) {
    const c = this.citizen;
    if (!c) return;
    c.update(dt, ctx);
    if (c.toRemove) {
      this.scene.remove(c.mesh);
      c.dispose();
      this.citizen = null;
    }
  }

  /** Hard-clear any live citizen — used when a run rolls back to a
   *  checkpoint (respawn/restartRun), matching the zombie-wipe alongside it. */
  reset() {
    if (!this.citizen) return;
    this.citizen._despawn();
    this.scene.remove(this.citizen.mesh);
    this.citizen.dispose();
    this.citizen = null;
  }
}
