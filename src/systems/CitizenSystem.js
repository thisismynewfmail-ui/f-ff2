import { Citizen } from '../entities/Citizen.js';

/**
 * Directs the rescuable citizen (see entities/Citizen.js): on every wave
 * start she has a chance to spawn captured inside one random enterable
 * building in a district the player has already unlocked. Only one is ever
 * live at a time — freeing her (or her escape finishing) clears the slot so a
 * later wave can roll a fresh spawn in a different building. Which wave she
 * shows up on and which building she's in are both random every playthrough.
 */
const SPAWN_CHANCE = 0.4;

export class CitizenSystem {
  constructor(events, world, texLib, scene) {
    this.events = events;
    this.world = world;
    this.scene = scene;
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

  _maybeSpawn() {
    if (this.citizen) return;
    if (Math.random() > SPAWN_CHANCE) return;
    const candidates = this._eligibleBuildings();
    if (!candidates.length) return;
    const spec = candidates[(Math.random() * candidates.length) | 0];
    const built = this.world.built.get(spec.name);
    if (!built) return;
    this.citizen = new Citizen(this.events, this.world, this.texCaptured, this.texReleased, built);
    this.scene.add(this.citizen.mesh);
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
