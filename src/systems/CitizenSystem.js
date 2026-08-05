import { Citizen } from '../entities/Citizen.js';

/**
 * Directs the rescuable citizen (see entities/Citizen.js): the first two waves
 * always produce one, and after that — once the run is past its kill gate —
 * every wave start has a chance to spawn her captured inside one random
 * enterable building in a district the player has already unlocked. Only one
 * is ever live at a time — freeing her (or her escape finishing) clears the
 * slot so a later wave can roll a fresh spawn in a different building. Which
 * wave she shows up on and which building she's in are both random every
 * playthrough, the two guaranteed opening rescues aside.
 */
const SPAWN_CHANCE = 0.4;
/**
 * Wave 1 ALWAYS produces a captive, and always inside the district the player
 * spawns in. The rescue is the one mechanic here you cannot stumble into by
 * shooting things, so the run opens with one within sight of where the player
 * is standing rather than somewhere across the map — a short walk, not a
 * search. Which building in that district still varies every playthrough.
 */
export const HOME_WAVE = 1;
/**
 * Wave 2 ALWAYS produces one too, kill gate or not, and this one may be
 * anywhere unlocked. Together with HOME_WAVE it is the scripted introduction
 * to the whole rescue mechanic — the player meets one, learns what the [E]
 * prompt and the health kit are for, and only much later (past
 * CITIZEN_KILL_GATE) do captives start turning up on their own. Wave 1 asks
 * for 11 kills, so both necessarily fire far below the gate; that is the
 * point, and they are the ONLY spawns allowed to skip it.
 */
export const GUARANTEED_WAVE = 2;
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
    events.on('wave:start', ({ wave }) => this._maybeSpawn(wave));
  }

  /** Buildings you can actually walk into, in a district already open — or in
   *  one named district when `zoneId` is given. The hollow cottage is excluded
   *  — its interior belongs to its own secret. */
  _eligibleBuildings(zoneId = null) {
    return this.world.buildingSpecs.filter((b) =>
      !b.solid && b.door && b.use !== 'hollow' && this.world.zones.isUnlocked(b.zone)
      && (zoneId === null || b.zone === zoneId));
  }

  /**
   * The district the player starts the run in, read off the world's own spawn
   * point rather than hard-coded — move the spawn and wave 1's captive moves
   * with it instead of being stranded a district away.
   */
  get spawnZone() {
    const s = this.world.playerSpawn;
    return this.world.zones.zoneAt(s.x, s.z).id;
  }

  /** Has the run banked enough kills for captives to start appearing? */
  get unlocked() {
    return this.score.kills >= CITIZEN_KILL_GATE;
  }

  /**
   * The per-wave roll: waves 1 and 2 are guaranteed rescues that ignore both
   * the kill gate and the dice — wave 1's held in the player's own starting
   * district, wave 2's anywhere unlocked. Every other wave must clear the kill
   * gate and then win the spawn chance.
   *
   * The one-at-a-time rule still applies across the two: leave wave 1's
   * captive tied up and wave 2 has nothing to add, which is the right
   * outcome — there is already someone waiting to be freed.
   */
  _maybeSpawn(wave) {
    if (wave === HOME_WAVE) return this.spawnNow(this.spawnZone);
    if (wave === GUARANTEED_WAVE) return this.spawnNow();
    if (!this.unlocked) return null;
    if (Math.random() > SPAWN_CHANCE) return null;
    return this.spawnNow();
  }

  /**
   * Put a captive in a random eligible building right now, skipping both the
   * kill gate and the per-wave dice roll (the dev console's `spawn citizen`).
   * `zoneId` confines her to one district. Returns the new citizen, or null if
   * one is already live or no building qualifies.
   */
  spawnNow(zoneId = null) {
    if (this.citizen) return null;
    // A district is a preference, not a promise: if that one has nothing
    // enterable, widen to the whole unlocked map rather than drop a
    // guaranteed spawn on the floor.
    let candidates = this._eligibleBuildings(zoneId);
    if (!candidates.length && zoneId !== null) candidates = this._eligibleBuildings();
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
