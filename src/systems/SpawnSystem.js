import { Zombie } from '../entities/Zombie.js';
import { Exploder } from '../entities/Exploder.js';
import { ZOMBIE_TYPES } from '../entities/ZombieTypes.js';
import { makeSpriteMaterial } from '../rendering/Billboard.js';

/**
 * Spawn director. Streams the current wave's budget into the world while
 * keeping the active-zombie count under a performance cap. Spawns happen in
 * unlocked zones only, in a ring around the player, preferring points the
 * player can't see. Also handles corpse cleanup, loot drops and the
 * zombie-zombie separation pass.
 *
 * The concurrent-zombie cap and per-pulse batch size are read from the wave
 * system so the horde swells with "heat" past 250 kills without overflowing.
 */
const TANK_SLOTS = 2;
// Brushing against a live zombie's body costs health, so the player can't just
// barge straight through the horde. The player's own 0.25s post-hit
// invulnerability rate-limits this to one bite per pass-through.
const CONTACT_DAMAGE = 5;

export class SpawnSystem {
  constructor(events, world, texLib, scene, waveSystem) {
    this.events = events;
    this.world = world;
    this.scene = scene;
    this.waves = waveSystem;
    this.zombies = [];
    this.spawnTimer = 1;
    // Opt-in "cull a zombie that can't see the player for N seconds" flag.
    // 0 = off (default). Stamped onto every zombie at spawn; see Game.load
    // for where it is actively switched on, and the `cull` console command.
    this.cullBlindSeconds = 0;

    // One shared material per type; billboards clone it per zombie but the
    // GPU texture is shared (tinted variants are separate small uploads).
    this.materials = {
      walker: makeSpriteMaterial(texLib.get('zombieBasic')),
      sprinter: makeSpriteMaterial(texLib.tinted('zombieBasic', 'sprinter')),
      tank: makeSpriteMaterial(texLib.tinted('zombieBasic', 'tank')),
      exploder: makeSpriteMaterial(texLib.get('npcExploder')),
    };

    events.on('noise', ({ pos, radius }) => {
      for (const z of this.zombies) z.onNoise(pos, radius);
    });
    events.on('zombie:death', ({ pos, loot }) => this._maybeDrop(pos, loot));
  }

  activeSlots() {
    let n = 0;
    for (const z of this.zombies) n += z.config === ZOMBIE_TYPES.tank ? TANK_SLOTS : 1;
    return n;
  }

  pickType() {
    const w = this.waves.typeWeights();
    const r = Math.random();
    let acc = w.tank;
    if (r < acc) return 'tank';
    acc += w.sprinter; if (r < acc) return 'sprinter';
    acc += w.exploder || 0; if (r < acc) return 'exploder';
    return 'walker';
  }

  pickSpawnPoint(player) {
    const pts = this.world.spawnPoints;
    let fallback = null;
    for (let tries = 0; tries < 24; tries++) {
      const p = pts[(Math.random() * pts.length) | 0];
      if (!this.world.zones.isUnlocked(p.zone)) continue;
      const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
      if (d < 18 || d > 95) continue;
      fallback = p;
      if (d > 26 && d < 70) {
        const y = this.world.groundHeightFor(p.x, p.z, 1e9);
        const visible = this.world.hasLineOfSight(
          player.position.x, player.position.y + 1.5, player.position.z,
          p.x, y + 1.2, p.z,
        );
        if (!visible) return p;
      }
    }
    if (fallback) return fallback;
    // Safety net: the random ring search came up empty (e.g. the player is
    // pinned in a corner of the unlocked map). Deterministically take the
    // nearest unlocked point outside arm's reach, so a wave never silently
    // fails to place a zombie.
    let best = null, bestScore = Infinity;
    for (const p of pts) {
      if (!this.world.zones.isUnlocked(p.zone)) continue;
      const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
      if (d < 12) continue; // never spawn on top of the player
      const score = Math.abs(d - 40); // favour the usual spawn ring
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  spawnOne(typeName, player) {
    const p = this.pickSpawnPoint(player);
    if (!p) return null;
    const Ctor = typeName === 'exploder' ? Exploder : Zombie;
    const z = new Ctor(ZOMBIE_TYPES[typeName], this.materials[typeName], this.world, this.events);
    z.placeAt(p.x + (Math.random() - 0.5) * 2, p.z + (Math.random() - 0.5) * 2);
    if (this.cullBlindSeconds > 0) z.flags.cullBlindSeconds = this.cullBlindSeconds;
    this.zombies.push(z);
    this.scene.add(z.mesh);
    return z;
  }

  /** Toggle the blind-cull flag and (re)stamp it onto every live zombie. */
  setCull(seconds) {
    this.cullBlindSeconds = Math.max(0, Number(seconds) || 0);
    for (const z of this.zombies) {
      if (this.cullBlindSeconds > 0) z.flags.cullBlindSeconds = this.cullBlindSeconds;
      else delete z.flags.cullBlindSeconds;
    }
    return this.cullBlindSeconds;
  }

  update(dt, player) {
    // stream the wave in
    const cap = this.waves.activeCap();
    if (this.waves.wantsSpawn() && player.alive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.activeSlots() < cap) {
        this.spawnTimer = this.waves.spawnInterval();
        const batch = Math.min(this.waves.toSpawn, this.waves.batchSize());
        for (let i = 0; i < batch; i++) {
          if (this.activeSlots() >= cap) break;
          if (this.spawnOne(this.pickType(), player)) this.waves.noteSpawned(1);
        }
      }
    }

    // corpse cleanup. A culled zombie was removed without ever being killed, so
    // refund it to the wave budget — otherwise the kill quota could never be met.
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.toRemove) {
        this.scene.remove(z.mesh);
        z.dispose();
        this.zombies.splice(i, 1);
        this.waves.noteRemoved(1);
        if (z.culled) this.waves.refundSpawn(1);
      }
    }

    // contact damage: running into a live zombie's body hurts. Gated by the
    // player's post-hit invulnerability so one pass-through costs one bite.
    if (player.alive) {
      for (const z of this.zombies) {
        if (z.state === 'dead') continue;
        const dx = z.position.x - player.position.x;
        const dz = z.position.z - player.position.z;
        const reach = z.radius + player.radius + 0.15;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (Math.abs(z.position.y - player.position.y) > 1.8) continue; // same level only
        player.takeDamage(CONTACT_DAMAGE, z.position);
      }
    }

    // separation: keep the horde from stacking into one sprite
    const zs = this.zombies;
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.state === 'dead') continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        const minD = a.radius + b.radius;
        if (d2 > minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        a.position.x -= nx * push; a.position.z -= nz * push;
        b.position.x += nx * push; b.position.z += nz * push;
      }
    }
  }

  _maybeDrop(pos, loot) {
    // Exploders carry an explicit loot decision on their death event: sniper
    // ammo when the player killed them, an explicit `null` (no drop) when they
    // self-detonated or died to another blast. Everything else (loot undefined)
    // rolls the usual random drop.
    if (loot !== undefined) {
      if (loot) this.events.emit('loot:spawn', { x: pos.x, z: pos.z, type: loot, amount: 5 });
      return;
    }
    const r = Math.random();
    if (r < 0.030) {
      const kinds = ['ammo_rifle', 'ammo_shotgun', 'ammo_rifle', 'ammo_sniper'];
      const type = kinds[(Math.random() * kinds.length) | 0];
      const amount = type === 'ammo_sniper' ? 4 : type === 'ammo_shotgun' ? 6 : 20;
      this.events.emit('loot:spawn', { x: pos.x, z: pos.z, type, amount });
    } else if (r < 0.048) {
      this.events.emit('loot:spawn', { x: pos.x, z: pos.z, type: 'health', amount: 25 });
    }
  }

  /** Ambient zombie pressure near the player (drives moan intensity). */
  nearbyCount(player, range = 40) {
    let n = 0;
    for (const z of this.zombies) {
      if (z.state === 'dead') continue;
      if (z.distanceTo(player) < range) n++;
    }
    return n;
  }
}
