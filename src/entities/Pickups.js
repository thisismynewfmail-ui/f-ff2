import * as THREE from '../../lib/three.module.js';
import { ItemBillboard, FlipbookBillboard } from '../rendering/Billboard.js';
import { COINS } from '../systems/TokenSystem.js';

/**
 * World pickups: ammunition (a distinct sprite per weapon type), health packs,
 * quest keys and the coins the horde drops. Billboarded sprites that bob,
 * chime on collection, and apply their payload through events so no system
 * references another directly.
 *
 * Spawn sources: initial world loot, zombie drops, wave-respite supply
 * drops, coin drops and secret caches — all via the 'loot:spawn' event.
 *
 * The four ammunition types used to share one white box tinted four ways.
 * They now carry their own art — see assets/textures/ammo_*.png — because a
 * tint is a legend and a silhouette is a picture: you should know a case of
 * sniper rounds from a box of shells by its shape across the street. Coins
 * are `spin: true`, which swaps the still billboard for a flipbook.
 */
const TYPES = {
  ammo_pistol: { tex: 'ammoPistol', tint: null, label: 'Pistol ammo' },
  ammo_shotgun: { tex: 'ammoShotgun', tint: null, label: 'Shotgun shells' },
  ammo_rifle: { tex: 'ammoRifle', tint: null, label: 'Rifle ammo' },
  ammo_sniper: { tex: 'ammoSniper', tint: null, label: 'Sniper rounds' },
  health: { tex: 'healthPack', tint: null, label: 'Health pack' },
  key: { tex: 'key', tint: null, label: 'Rusty key' },
  // the currency, defined once in TokenSystem so the coin's value, its sprite
  // and its drop roll can never disagree about which coin is which
  ...Object.fromEntries(Object.entries(COINS).map(([type, c]) => [
    type, { tex: c.tex, tint: null, label: c.label, spin: true, size: c.size },
  ])),
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
    const size = def.size ?? 0.55;
    const bb = def.spin
      ? new FlipbookBillboard(this.texLib.get(def.tex), size)
      : new ItemBillboard(this.texLib.get(def.tex), size, def.tint);
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
