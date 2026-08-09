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
 * Anything that DROPS during play is on a clock: it blinks for its last ten
 * seconds and is gone at forty-five (see LIFETIME).
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
/**
 * How long a DROPPED item lies in the street, and when it starts warning you.
 * A wave pays out faster than anyone can collect it — shells, medkits and coins
 * from a hundred kills would otherwise carry over into every wave after it,
 * turning the road into a carpet of sprites — so anything that falls during
 * play ages out.
 *
 * Two things are deliberately exempt, both via ttl 0: the loot the world is
 * BUILT with (seedInitial fills the drawers and lockers at load, long before
 * the player can reach any of it — on this clock the whole town would be
 * stripped bare inside a minute of the title screen), and the quest key, which
 * is the only pickup in the game you cannot get a second copy of.
 */
const LIFETIME = 45;
const WARN_AT = 35;
const WARN_WINDOW = LIFETIME - WARN_AT;
// Interior furniture (drawers, cabinets, lockers) registers many more loot
// points than the old one-per-building world, so the cap is higher.
const MAX_PICKUPS = 140;
// ...and the town is NOT allowed to seed right up to it. There are getting on
// for three hundred loot points and only this many slots, so a seeding pass
// that filled the list left no room at all for the things that fall during
// play: every coin a zombie dropped shoved the previous one off the end, and
// the street could never hold more than the last kill's payout. Reserving the
// balance for drops costs a few of the emptier drawers and nothing else.
const MAX_SEEDED = 104;

export class PickupManager {
  constructor(events, world, texLib, scene) {
    this.events = events;
    this.world = world;
    this.texLib = texLib;
    this.scene = scene;
    this.items = [];
    events.on('loot:spawn', (p) => this.spawn(p));
  }

  spawn({ x, y, z, type, amount, ttl }) {
    const def = TYPES[type];
    if (!def) return;
    // At the cap, take the oldest thing that was going to expire anyway before
    // touching the world's own loot. The town is seeded to the cap at load, so
    // a plain "drop the first one" rule ate a drawer's worth of ammunition
    // every time a zombie paid out, and the buildings emptied over a run
    // without anyone ever opening them.
    if (this.items.length >= MAX_PICKUPS) {
      const oldest = this.items.findIndex((i) => i.life > 0);
      this._drop(oldest < 0 ? 0 : oldest);
    }
    const size = def.size ?? 0.55;
    const bb = def.spin
      ? new FlipbookBillboard(this.texLib.get(def.tex), size)
      : new ItemBillboard(this.texLib.get(def.tex), size, def.tint);
    const groundY = y ?? this.world.groundHeightFor(x, z, 1e9);
    bb.mesh.position.set(x, groundY + 0.45, z);
    bb.baseY = groundY + 0.45;
    this.scene.add(bb.mesh);
    // ttl 0 means "stays until someone takes it" — see LIFETIME.
    const life = type === 'key' ? 0 : (ttl ?? LIFETIME);
    this.items.push({ bb, x, z, type, amount, label: def.label, age: 0, life });
  }

  /**
   * Seed starting loot at a sample of building loot points. The sample is
   * STRIDED across the whole list rather than taken off the front, so filling
   * only as many as MAX_SEEDED allows still leaves stocked buildings all over
   * town instead of a well-provisioned first district and an empty rest.
   */
  seedInitial() {
    const kinds = ['ammo_shotgun', 'ammo_rifle', 'health', 'ammo_sniper', 'ammo_rifle', 'ammo_shotgun'];
    const points = this.world.lootPoints;
    // two in three, up to the seeding budget — the gaps leave some drawers bare
    const want = Math.min(MAX_SEEDED, Math.round(points.length * 2 / 3));
    const stride = points.length / Math.max(1, want);
    for (let i = 0; i < want; i++) {
      const p = points[Math.min(points.length - 1, Math.floor(i * stride))];
      const type = kinds[i % kinds.length];
      const amount = type === 'health' ? 25 : type === 'ammo_sniper' ? 5 : type === 'ammo_shotgun' ? 8 : 30;
      this.spawn({ x: p.x, z: p.z, type, amount, ttl: 0 });
    }
  }

  update(dt, time, player, camPos) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const m = it.bb.mesh;
      // Age BEFORE the distance cull: a crate dropped across town has to rot on
      // the same clock as the one at your feet, or walking away would preserve
      // it and the pile this timer exists to clear would just move outdoors.
      if (it.life) {
        it.age += dt;
        if (it.age >= it.life) { this._drop(i); continue; }
      }
      const dx = m.position.x - camPos.x, dz = m.position.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 22500) continue; // beyond 150 m: skip anim + collection
      it.bb.update(time, camPos);
      const warnAt = it.life - WARN_WINDOW;
      if (it.life && it.age > warnAt) it.bb.blink((it.age - warnAt) / WARN_WINDOW, time);

      if (!player.alive) continue;
      const pd = Math.hypot(m.position.x - player.position.x, m.position.z - player.position.z);
      if (pd < PICKUP_RADIUS && Math.abs(it.bb.baseY - (player.position.y + 0.45)) < 2.2) {
        // Health only collects when it can actually heal.
        if (it.type === 'health' && !player.heal(it.amount)) continue;
        this.events.emit('pickup', { type: it.type, amount: it.amount, label: it.label });
        this._drop(i);
      }
    }
  }

  /** Take item `i` off the street: out of the scene, off the GPU, out of the list. */
  _drop(i) {
    const it = this.items[i];
    this.scene.remove(it.bb.mesh);
    it.bb.dispose();
    this.items.splice(i, 1);
  }
}
