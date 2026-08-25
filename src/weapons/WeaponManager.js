import * as THREE from '../../lib/three.module.js';
import { WEAPON_CONFIGS } from './WeaponConfigs.js';
import { Weapon } from './Weapon.js';

/**
 * Owns the weapons, switching (number keys / wheel), reload input, the sniper
 * scope, and all hit resolution:
 *
 *  - hitscan rays against zombies (cylinder tests, headshot bonus, pierce),
 *    world geometry (AABBs + terrain march) and shootable secrets
 *  - melee arc swings with knockback
 *
 * Accuracy counts one 'shot' per trigger pull; a pull that hits any zombie
 * counts as a hit (pellets don't inflate the numbers). Melee doesn't count.
 * Gunshots emit 'noise' events that draw the horde.
 *
 * ---------------------------------------------------------------------------
 * THE BAYS ARE HANDED OUT IN THE ORDER THE RUN FINDS THINGS.
 *
 * A weapon's number key used to be written into its config, which meant every
 * run of the game had the same six bays in the same order whether or not
 * anything was in them — and with four of the six now waiting to be found,
 * that is most of the rack reserved for weapons the player may never see. Walk
 * into the arcade and take the Foundry Gun first and it went into bay 3
 * because a table said 3, leaving bay 2 empty for a coachgun four streets
 * back that the player may never go and get.
 *
 * So the rack is a LIST now, not a table: `order` holds weapon indices in the
 * order the run acquired them, the starting loadout first and every find
 * appended, and bay N is simply the Nth thing you own. Find the Foundry Gun
 * before the coachgun and the Foundry Gun is 3 and the coachgun is 4.
 *
 * `order` is the only thing that decides a bay. `weapons` stays in config
 * order forever, because that is the identity every other system indexes by —
 * the view model's rigs, the ammo snapshots, the save file. `index` is a
 * weapons index (which gun is in your hands); a SLOT is an index into `order`.
 * The two are deliberately different types, and every method below says which
 * one it takes.
 * ---------------------------------------------------------------------------
 */
export class WeaponManager {
  constructor(events, world, player, renderer) {
    this.events = events;
    this.world = world;
    this.player = player;
    this.renderer = renderer;
    this.weapons = WEAPON_CONFIGS.map((c) => new Weapon(c));
    // A weapon the run has not found is not in `order`: it cannot be selected
    // by key or wheel, it holds no bay, and its place in the rack reads empty.
    // Found weapons announce themselves and take the next bay along.
    this.order = [];
    this.unlocked = new Set();
    this._setOrder(this._startingOrder());
    this.index = this.order[0] ?? 0;
    this.switchTimer = 0;
    this.scoped = false;
    this._burstLeft = 0; // rifle alt-fire burst counter
    this.zombies = null; // wired by Game

    events.on('weapon:unlock', ({ id }) => {
      if (this.unlocked.has(id)) return;
      const i = this.weapons.findIndex((w) => w.config.id === id);
      if (i < 0) return;
      // The bay it lands in is the bay it was FOUND in — the next one along.
      this._setOrder([...this.order, i]);
      this.weapons[i].mag = this.weapons[i].config.magSize;
      const slot = this.order.length - 1;
      this.switchTo(slot);
      this.events.emit('weapon:menu:poke', { index: slot });
    });

    events.on('pickup', ({ type, amount }) => {
      for (const w of this.weapons) {
        if (w.config.ammoType === type) {
          w.addReserve(amount);
          this.events.emit('ammo:changed', this.current);
        }
      }
    });
  }

  get current() { return this.weapons[this.index]; }

  /** How many bays the rack has. Fixed: one per weapon in the game. */
  get slotCount() { return this.weapons.length; }

  /** Which bay the weapon in your hands is in (-1 if somehow none). */
  get slot() { return this.order.indexOf(this.index); }

  /** The bays the run starts with: the loadout, in config order. */
  _startingOrder() {
    const order = [];
    WEAPON_CONFIGS.forEach((c, i) => { if (!c.locked) order.push(i); });
    return order;
  }

  /**
   * Set the rack. `order` is the source of truth for what the run owns and
   * which bay each thing is in; `unlocked` is the same fact keyed by id, kept
   * beside it because everything that asks "do I have the coachgun" asks by
   * name rather than by bay.
   */
  _setOrder(order) {
    this.order = order.slice();
    this.unlocked = new Set(this.order.map((i) => this.weapons[i].config.id));
    if (this.index !== undefined && !this.order.includes(this.index)) {
      this.index = this.order[0] ?? 0;
      this.events?.emit('weapon:switch', { weapon: this.current });
    }
  }

  /** Which weapons the run has found, IN THE ORDER IT FOUND THEM. Rides with
   *  a save (see Game) — the order is half the state, because it is what the
   *  number keys are. */
  snapshotUnlocked() { return this.order.map((i) => this.weapons[i].config.id); }

  /**
   * Put the rack back exactly as it was.
   *
   * Deliberately NOT a burst of 'weapon:unlock' events: each of those switches
   * the player onto the weapon and pokes the arms bay, which is right when you
   * pick something up off the floor and absurd when a saved run is being
   * rebuilt behind a loading screen. The magazines come from the ammo snapshot
   * that is restored alongside this.
   *
   * The starting loadout always leads whatever the save says, so a save
   * written by an older build — or a corrupted one — cannot leave the run
   * without a pistol.
   */
  restoreUnlocked(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const byId = new Map(this.weapons.map((w, i) => [w.config.id, i]));
    const order = this._startingOrder();
    for (const id of ids) {
      const i = byId.get(id);
      if (i !== undefined && !order.includes(i)) order.push(i);
    }
    this._setOrder(order);
  }

  /** Back to the pristine loadout — everything found this run is lost again,
   *  and so is the order it was found in. */
  resetUnlocked() {
    this.index = 0;                       // _setOrder re-seats it and announces
    this._setOrder(this._startingOrder());
    this.events.emit('weapon:switch', { weapon: this.current });
  }

  /** Is there anything in this BAY? */
  has(slot) { return this.order[slot] !== undefined; }

  /** Equip whatever is in this BAY. */
  switchTo(slot) {
    const i = this.order[slot];
    if (i === undefined || i === this.index) return;
    this.current.cancelReload();
    this.setScope(false);
    this._burstLeft = 0;
    this.index = i;
    this.switchTimer = 0.3;
    this.events.emit('weapon:switch', { weapon: this.current });
  }

  setScope(on) {
    if (this.scoped === on) return;
    if (on && this.current.config.zoom === null) return;
    this.scoped = on;
    const zoom = on ? this.current.config.zoom : 1;
    this.player.zoomFactor = zoom;
    this.renderer.applyFov(zoom);
    this.events.emit('scope', { on });
  }

  update(dt, input) {
    for (const w of this.weapons) w.update(dt);
    if (this.switchTimer > 0) this.switchTimer -= dt;

    // switching (number keys + wheel). Poke the weapon menu into view on any
    // slot input, even when the selection doesn't change.
    for (let s = 0; s < this.slotCount; s++) {
      if (input.wasPressed('Digit' + (s + 1)) && this.has(s)) {
        this.switchTo(s);
        this.events.emit('weapon:menu:poke', { index: s });
      }
    }
    // The wheel walks the RACK, which only holds things the run owns — so
    // there is nothing to step over any more, and the wheel never stalls on
    // a bay that is waiting for a weapon out in the town.
    if (input.wheelDelta !== 0 && this.order.length) {
      const step = input.wheelDelta > 0 ? 1 : -1;
      const next = (this.slot + step + this.order.length) % this.order.length;
      this.switchTo(next);
      this.events.emit('weapon:menu:poke', { index: next });
    }

    // reload (full, or the faster quick-tap variant when the mag isn't dry)
    if (input.wasActionPressed('reload') && this.current.startReload()) {
      const w = this.current;
      this.events.emit('weapon:reload:start', { weapon: w, tactical: w.tactical, duration: w.reloadDuration });
    }

    const cfg = this.current.config;
    const scopeWeapon = cfg.zoom !== null && cfg.zoom !== undefined;

    // right mouse = telescopic scope on the sniper, secondary fire otherwise
    this.setScope(scopeWeapon && input.isMouseDown(2) && this.switchTimer <= 0);

    if (this.switchTimer > 0) { this._burstLeft = 0; return; }

    // primary fire (LMB)
    const wantPrimary = cfg.auto ? input.isMouseDown(0) : input.wasClicked(0);
    if (wantPrimary) { this.tryFire(false); this._burstLeft = 0; }

    // secondary fire (RMB) — mode set per weapon
    if (!scopeWeapon && cfg.alt) {
      const mode = cfg.alt.mode;
      if (mode === 'auto') {
        if (input.isMouseDown(2)) this.tryFire(true);
      } else if (mode === 'burst') {
        if (input.wasClicked(2) && this._burstLeft <= 0 && this.current.cooldown <= 0) this._burstLeft = cfg.alt.count;
      } else if (input.wasClicked(2)) {
        this.tryFire(true); // double / charge — one action per click
      }
    }

    // feed an in-flight burst, tight spacing until the last round
    if (this._burstLeft > 0 && this.current.cooldown <= 0) {
      const interval = this._burstLeft > 1 ? (cfg.alt.burstSpacing ?? 0.06) : cfg.alt.fireInterval;
      if (this.tryFire(true, { interval })) this._burstLeft--;
      else this._burstLeft = 0;
    }
  }

  /**
   * Fire the current weapon. `alt` selects the secondary-fire profile;
   * `opts.interval` overrides the resulting cooldown (used for burst spacing).
   * Returns true if a shot actually went off.
   */
  tryFire(alt = false, opts = {}) {
    const w = this.current;
    if (w.reloading || this.switchTimer > 0 || w.cooldown > 0) return false;
    const a = alt ? w.config.alt : null;
    const shells = a?.shells ?? 1;
    if (!w.isMelee && w.mag < shells) {
      this.events.emit('weapon:empty', { weapon: w });
      if (w.startReload()) this.events.emit('weapon:reload:start', { weapon: w, tactical: w.tactical, duration: w.reloadDuration });
      return false;
    }
    const interval = opts.interval ?? a?.fireInterval ?? w.config.fireInterval;
    const spread = w.fire(this.scoped, { interval, ammo: shells, spread: a?.spread });
    // effective combat parameters for this shot
    const eff = {
      damage: w.config.damage * (a?.damageMul ?? 1),
      pellets: a?.pellets ?? w.config.pellets ?? 1,
      pierce: w.config.pierce ?? 1,
      range: w.config.range,
      knockback: (w.config.knockback ?? 0) * (a?.knockbackMul ?? 1),
      arc: (w.config.arc ?? 0) * (a?.arcMul ?? 1),
      bolt: !!w.config.energy,
    };
    if (a?.pierce) eff.pierce = a.pierce;
    if (w.isMelee) this._swing(w, eff);
    else this._shoot(w, spread, eff);
    const noise = a?.noise ?? w.config.noise;
    this.events.emit('weapon:fire', { weapon: w, scoped: this.scoped, alt, sound: a?.sound ?? w.config.sound });
    if (noise > 0) this.events.emit('noise', { pos: this.player.position.clone(), radius: noise });
    return true;
  }

  _shoot(w, spreadDeg, eff) {
    const origin = this.player.eyePosition();
    const baseDir = this.player.lookDirection();
    let anyHit = false;

    for (let p = 0; p < eff.pellets; p++) {
      const dir = coneSpread(baseDir, spreadDeg);
      // An energy weapon's shot is a thing you watch cross the street: the
      // resolution is still hitscan, but the bolt is drawn along the ray it
      // actually took, out to whatever it actually stopped on.
      if (eff.bolt) {
        const stop = Math.min(eff.range,
          this.world.collision.raycast(origin, dir, eff.range),
          this._terrainRay(origin, dir, eff.range));
        this.events.emit('weapon:bolt', {
          from: { x: origin.x, y: origin.y, z: origin.z },
          dir: { x: dir.x, y: dir.y, z: dir.z },
          dist: Math.min(stop, eff.range),
        });
      }
      const hit = this._resolveRay(origin, dir, eff);
      if (hit) anyHit = true;
    }
    this.events.emit('shot:fired', {});
    if (anyHit) this.events.emit('shot:hit', {});
    this.events.emit('ammo:changed', w);
  }

  _resolveRay(origin, dir, cfg) {
    // cfg here is the effective per-shot params (range/pierce/damage/knockback).
    // World geometry distance caps the ray.
    let worldDist = this.world.collision.raycast(origin, dir, cfg.range);
    const terrainDist = this._terrainRay(origin, dir, Math.min(cfg.range, worldDist));
    worldDist = Math.min(worldDist, terrainDist);

    // Secret targets.
    const shootable = this.world.raycastShootables(origin, dir, worldDist);

    // Zombie cylinder hits along the ray, nearest first. The closest
    // approach to a vertical cylinder axis happens in the XZ plane, so
    // project onto the ray's *normalized* XZ direction (a pitched ray has
    // |dirXZ| < 1 and the raw dot product lands short of the target).
    const hits = [];
    const dxz2 = dir.x * dir.x + dir.z * dir.z;
    if (dxz2 > 1e-8) {
      for (const z of this.zombies) {
        if (z.state === 'dead') continue;
        const hitR = 0.42 * z.config.scale + 0.08;
        const ox = z.position.x - origin.x, oz = z.position.z - origin.z;
        const t = (ox * dir.x + oz * dir.z) / dxz2; // 3D ray parameter = distance (dir is unit)
        if (t < 0 || t > worldDist) continue;
        const px = origin.x + dir.x * t - z.position.x;
        const pz = origin.z + dir.z * t - z.position.z;
        if (px * px + pz * pz > hitR * hitR) continue;
        const hitY = origin.y + dir.y * t;
        if (hitY < z.position.y - 0.1 || hitY > z.position.y + z.height + 0.1) continue;
        hits.push({ z, t, hitY });
      }
    }
    hits.sort((a, b) => a.t - b.t);

    if (shootable && (!hits.length || shootable.dist < hits[0].t)) {
      if (shootable.target.onHit()) shootable.target.active = false;
      this.events.emit('impact', { pos: rayPoint(origin, dir, shootable.dist) });
      return false;
    }

    let pierced = 0;
    for (const h of hits) {
      if (pierced >= cfg.pierce) break;
      const headshot = h.hitY > h.z.position.y + h.z.height * 0.72;
      const dmg = cfg.damage * (headshot ? 1.5 : 1) * (pierced > 0 ? 0.6 : 1);
      h.z.takeDamage(dmg, { x: dir.x, z: dir.z }, cfg.knockback ?? 0);
      pierced++;
    }
    if (!pierced && worldDist < cfg.range) {
      this.events.emit('impact', { pos: rayPoint(origin, dir, worldDist) });
    }
    return pierced > 0;
  }

  _terrainRay(origin, dir, maxDist) {
    if (dir.y >= -0.02) return Infinity; // flat/up shots rarely clip terrain within range
    for (let t = 2; t < maxDist; t += 2) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < this.world.terrain.heightAt(x, z)) {
        // refine one step back
        for (let f = t - 2; f <= t; f += 0.4) {
          const fy = origin.y + dir.y * f;
          if (fy < this.world.terrain.heightAt(origin.x + dir.x * f, origin.z + dir.z * f)) return f;
        }
        return t;
      }
    }
    return Infinity;
  }

  _swing(w, eff) {
    const origin = this.player.position;
    const dir = this.player.lookDirection();
    const yaw = Math.atan2(dir.x, dir.z);
    const arcRad = (eff.arc * Math.PI / 180) / 2;
    let hitAny = false;
    for (const z of this.zombies) {
      if (z.state === 'dead') continue;
      const dx = z.position.x - origin.x, dz = z.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > eff.range + z.radius) continue;
      if (Math.abs(z.position.y - origin.y) > 2) continue;
      let da = Math.atan2(dx, dz) - yaw;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > arcRad) continue;
      z.takeDamage(eff.damage, { x: dx / (d || 1), z: dz / (d || 1) }, eff.knockback);
      hitAny = true;
    }
    this.events.emit('melee:swing', { hit: hitAny });
  }

  /**
   * Freeze every weapon's ammo (magazine + reserve) so the checkpoint system can
   * roll it back on death — the player respawns with exactly the ammo they had
   * when the checkpoint was taken, not with whatever they had burned through.
   */
  snapshotAmmo() {
    return this.weapons.map((w) => ({ mag: w.mag, reserve: w.reserve }));
  }

  /** Reapply an ammo snapshot captured by snapshotAmmo() (used on respawn). Any
   *  in-flight reload/scope is cancelled so the restored state is clean. */
  restoreAmmo(snap) {
    if (!snap) return;
    this.setScope(false);
    snap.forEach((s, i) => {
      const w = this.weapons[i];
      if (!w || w.isMelee) return;
      w.cancelReload();
      w.mag = s.mag;
      w.reserve = s.reserve;
    });
    this.events.emit('ammo:changed', this.current);
  }

  /** HUD snapshot for the ammo counter + weapon menu. */
  /**
   * The rack, BAY BY BAY — not weapon by weapon.
   *
   * One entry per bay, always `slotCount` of them so the grid keeps its shape,
   * in the order the run found things. A bay past the end of the rack is a
   * bay the run has not filled yet: it carries no id, which is what tells the
   * HUD to draw it blank rather than as a dimmed preview of a weapon that is
   * still lying in a case somewhere.
   */
  hudState() {
    const out = [];
    for (let s = 0; s < this.slotCount; s++) {
      const i = this.order[s];
      if (i === undefined) {
        out.push({ id: null, slot: s + 1, locked: true, active: false, mag: 0, reserve: 0 });
        continue;
      }
      const w = this.weapons[i];
      out.push({
        id: w.config.id,
        name: w.config.name,
        flavor: w.config.flavor,
        altLabel: w.config.altLabel,
        fireMode: w.config.fireMode ?? (w.config.melee ? 'MELEE' : w.config.auto ? 'AUTO' : 'SINGLE'),
        slot: s + 1,
        active: i === this.index,
        mag: w.mag,
        reserve: w.reserve,
        magSize: w.config.magSize,
        reloading: w.reloading,
        reloadFrac: w.reloading ? 1 - w.reloadLeft / w.config.reloadTime : 0,
        // an energy cell shows its refill on the same line a reload uses
        energy: w.isEnergy,
        chargeFrac: w.chargeFrac,
        locked: false,
      });
    }
    return out;
  }
}

function coneSpread(dir, degrees) {
  if (degrees <= 0) return dir.clone();
  const rad = degrees * Math.PI / 180;
  const u = Math.random(), v = Math.random();
  const theta = rad * Math.sqrt(u);
  const phi = v * Math.PI * 2;
  // Build an orthonormal basis around dir.
  const w = dir.clone().normalize();
  const a = Math.abs(w.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(w, a).normalize();
  const up = new THREE.Vector3().crossVectors(right, w);
  return w.multiplyScalar(Math.cos(theta))
    .addScaledVector(right, Math.sin(theta) * Math.cos(phi))
    .addScaledVector(up, Math.sin(theta) * Math.sin(phi))
    .normalize();
}

function rayPoint(origin, dir, t) {
  return new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
}
