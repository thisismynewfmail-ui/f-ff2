import * as THREE from '../../lib/three.module.js';
import { ItemBillboard } from '../rendering/Billboard.js';

/**
 * World pickups: ammo boxes (per weapon type), health packs and quest keys.
 * Billboarded sprites that bob, chime on collection, and apply their payload
 * through events so no system references another directly.
 *
 * Spawn sources: initial world loot, zombie drops, wave-respite supply
 * drops and secret caches — all via the 'loot:spawn' event.
 */
const TYPES = {
  ammo_pistol: { tex: 'ammoBox', tint: 0xd8d8a0, label: 'Pistol ammo' },
  ammo_shotgun: { tex: 'ammoBox', tint: 0xe09858, label: 'Shotgun shells' },
  ammo_rifle: { tex: 'ammoBox', tint: 0x9fc06a, label: 'Rifle ammo' },
  ammo_sniper: { tex: 'ammoBox', tint: 0x88b8d8, label: 'Sniper rounds' },
  health: { tex: 'healthPack', tint: null, label: 'Health pack' },
  key: { tex: 'key', tint: null, label: 'Rusty key' },
};
const PICKUP_RADIUS = 1.3;
// Interior furniture (drawers, cabinets, lockers) registers many more loot
// points than the old one-per-building world, so the cap is higher.
const MAX_PICKUPS = 140;

export class PickupManager {
  constructor(events, world, texLib, scene) {
    this.events = events;
    this.world = world;
    this.texLib = texLib;
    this.scene = scene;
    this.items = [];
    events.on('loot:spawn', (p) => this.spawn(p));
  }

  spawn({ x, y, z, type, amount }) {
    const def = TYPES[type];
    if (!def) return;
    if (this.items.length >= MAX_PICKUPS) {
      const oldest = this.items.shift();
      this.scene.remove(oldest.bb.mesh);
      oldest.bb.dispose();
    }
    const bb = new ItemBillboard(this.texLib.get(def.tex), 0.55, def.tint);
    const groundY = y ?? this.world.groundHeightFor(x, z, 1e9);
    bb.mesh.position.set(x, groundY + 0.45, z);
    bb.baseY = groundY + 0.45;
    this.scene.add(bb.mesh);
    this.items.push({ bb, x, z, type, amount, label: def.label });
  }

  /** Seed starting loot at a sample of building loot points. */
  seedInitial() {
    const kinds = ['ammo_shotgun', 'ammo_rifle', 'health', 'ammo_sniper', 'ammo_rifle', 'ammo_shotgun'];
    let i = 0;
    for (const p of this.world.lootPoints) {
      if (i % 3 === 2) { i++; continue; } // leave some buildings empty
      const type = kinds[i % kinds.length];
      const amount = type === 'health' ? 25 : type === 'ammo_sniper' ? 5 : type === 'ammo_shotgun' ? 8 : 30;
      this.spawn({ x: p.x, z: p.z, type, amount });
      i++;
    }
  }

  update(dt, time, player, camPos) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const m = it.bb.mesh;
      const dx = m.position.x - camPos.x, dz = m.position.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 22500) continue; // beyond 150 m: skip anim + collection
      it.bb.update(time, camPos);

      if (!player.alive) continue;
      const pd = Math.hypot(m.position.x - player.position.x, m.position.z - player.position.z);
      if (pd < PICKUP_RADIUS && Math.abs(it.bb.baseY - (player.position.y + 0.45)) < 2.2) {
        // Health only collects when it can actually heal.
        if (it.type === 'health' && !player.heal(it.amount)) continue;
        this.events.emit('pickup', { type: it.type, amount: it.amount, label: it.label });
        this.scene.remove(m);
        it.bb.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
