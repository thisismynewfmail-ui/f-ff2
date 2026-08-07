import * as THREE from '../../lib/three.module.js';

/**
 * Fourteen hand-placed secrets. Discovery methods vary by design:
 *  - shootable  (#1 cracked wall, #3 chapel bell)
 *  - interact   (#2 library bookshelf, #4 key + locked basement,
 *                #11 the treehouse, #12 the shelter under the shed)
 *  - kill count (#5 the alley remembers, at exactly 666 kills)
 *  - stand/wait (#7 the odd manhole)
 *  - proximity  (#6 ceiling chair, #8 campsite, #9 wrong shadow,
 *                #13 the three houses that are one house)
 *  - gaze       (#10 the mannequin that watches back, #14 the gnome)
 *
 * Atmospheric ones only whisper; loot ones emit 'loot:spawn' events.
 * All emit 'secret:found' exactly once.
 */
export class Secrets {
  constructor(world) {
    this.world = world;
    this.events = world.events;
    this.found = new Set();
    this.total = 14;
    this.game = null;
    this.hasBasementKey = false;
    this._manholeTimer = 0;
    this._gazeTimer = 0;
    this._sewerReturn = null;
    this._basementReturn = null;

    this._crackedWall();
    this._libraryShelf();
    this._chapelBell();
    this._keyAndBasement();
    this._alleyAt666();
    this._ceilingChair();
    this._oddManhole();
    this._campsite();
    this._wrongShadow();
    this._mannequin();
    this._treehouse();
    this._shelter();
    this._sameHouse();
    this._gnome();
  }

  attach(game) { this.game = game; }

  discover(id, label) {
    if (this.found.has(id)) return false;
    this.found.add(id);
    this.events.emit('secret:found', { id, label, count: this.found.size, total: this.total });
    return true;
  }

  /* ---------------- helpers ---------------- */

  _loot(x, y, z, entries) {
    for (const [type, amount, dx, dz] of entries) {
      this.events.emit('loot:spawn', { x: x + dx, y, z: z + dz, type, amount });
    }
  }

  /** Small underground room with a ladder-out interactable. */
  _undergroundRoom(x, z, y, half, exitPos, label) {
    const w = this.world;
    const g = new THREE.Group();
    const mk = (tex, sx, sy, sz, px, py, pz) => {
      const m = w.kit.box(sx, sy, sz, tex);
      m.position.set(px, py, pz);
      g.add(m);
    };
    mk('concrete', half * 2, 0.3, half * 2, 0, -0.15, 0);                 // floor
    mk('wallConcrete', half * 2, 3, 0.3, 0, 1.5, -half);                  // walls
    mk('wallConcrete', half * 2, 3, 0.3, 0, 1.5, half);
    mk('wallConcrete', 0.3, 3, half * 2, -half, 1.5, 0);
    mk('wallConcrete', 0.3, 3, half * 2, half, 1.5, 0);
    mk('concrete', half * 2, 0.3, half * 2, 0, 3.1, 0);                   // ceiling
    const ladder = w.kit.box(0.5, 2.8, 0.15, 'metalRust');
    ladder.position.set(half - 0.6, 1.4, -half + 0.25);
    g.add(ladder);
    g.position.set(x, y, z);
    w.group.add(g);
    const light = new THREE.PointLight(0x88a06a, 14, 14);
    light.position.set(x, y + 2.4, z);
    w.group.add(light);
    w.terrain.addPlatform(x - half, x + half, z - half, z + half, y);
    for (const [hx, hz, px, pz] of [
      [half, 0.2, 0, -half], [half, 0.2, 0, half], [0.2, half, -half, 0], [0.2, half, half, 0],
    ]) {
      w.collision.addBoxCentered(x + px, y + 1.5, z + pz, hx, 1.5, hz, 'wall');
    }
    w.addInteractable({
      x: x + half - 0.6, z: z - half + 0.6, y, radius: 1.8,
      prompt: 'Climb the ladder [E]',
      onInteract: () => this._teleport(exitPos.x, exitPos.z),
      enabled: () => true,
    });
    return { x, y, z };
  }

  _teleport(x, z, y = null) {
    const p = this.game?.player;
    if (!p) return;
    p.teleport(x, y ?? this.world.groundHeightFor(x, z, 1e9), z);
  }

  /* ---------------- the ten ---------------- */

  // #1 A wall that is more cracked than the others (warehouse annex).
  _crackedWall() {
    const w = this.world;
    const wb = w.built.get('warehouseB').spec;
    const ax = wb.x + wb.w / 2 + 2.5, az = wb.z + 2;
    const y = w.terrain.heightAt(ax, az);
    const g = new THREE.Group();
    const mk = (tex, sx, sy, sz, px, py, pz) => {
      const m = w.kit.box(sx, sy, sz, tex);
      m.position.set(px, py, pz);
      g.add(m);
    };
    mk('wallConcrete', 5, 3.2, 0.3, 0, 1.6, -2.5);
    mk('wallConcrete', 5, 3.2, 0.3, 0, 1.6, 2.5);
    mk('wallConcrete', 0.3, 3.2, 5, -2.5, 1.6, 0);
    mk('roofMetal', 5.6, 0.25, 5.6, 0, 3.3, 0);
    g.position.set(ax, y, az);
    w.group.add(g);
    for (const [hx, hz, px, pz] of [[2.5, 0.2, 0, -2.5], [2.5, 0.2, 0, 2.5], [0.2, 2.5, -2.5, 0]]) {
      w.collision.addBoxCentered(ax + px, y + 1.6, az + pz, hx, 1.6, hz, 'wall');
      w.nav.blockBox(ax + px - hx, az + pz - hz, ax + px + hx, az + pz + hz);
    }
    // The sealed face: cracked bricks among concrete panels.
    const panel = w.kit.box(0.35, 3.2, 5, 'brickCracked');
    panel.position.set(ax + 2.5, y + 1.6, az);
    w.group.add(panel);
    const colliderId = w.collision.addBoxCentered(ax + 2.5, y + 1.6, az, 0.25, 1.6, 2.5, 'wall');
    w.nav.blockBox(ax + 2.3, az - 2.5, ax + 2.7, az + 2.5);
    let hp = 5;
    w.addShootable({
      x: ax + 2.5, y: y + 1.6, z: az, r: 2.2,
      onHit: () => {
        if (--hp > 0) return;
        w.group.remove(panel);
        w.collision.remove(colliderId);
        w.nav.unblockBox(ax + 2.3, az - 2.5, ax + 2.7, az + 2.5);
        this._loot(ax, y + 0.6, az, [['ammo_rifle', 90, 0, -1], ['ammo_shotgun', 16, 1, 0.5], ['ammo_sniper', 10, -1, 0.5], ['health', 25, 0, 1.5]]);
        this.discover('crackedWall', 'The wall was hollow');
        this.events.emit('secret:rubble', { x: ax + 2.5, y: y + 1.6, z: az });
        return true; // consumed — stop registering hits
      },
    });
  }

  // #2 A bookshelf that slides aside (library back room).
  _libraryShelf() {
    const w = this.world;
    const lib = w.built.get('library').spec;
    // Partition splits off the north 3 m of the library interior.
    const pz = lib.z - lib.d / 2 + 3;
    const gapX = lib.x + lib.w / 2 - 2.4;
    const leftW = gapX - 0.8 - (lib.x - lib.w / 2 + 0.3);
    const part = w.kit.box(leftW, lib.h - 1, 0.25, 'wallPlaster');
    part.position.set(lib.x - lib.w / 2 + 0.3 + leftW / 2, lib.y + (lib.h - 1) / 2, pz);
    w.group.add(part);
    w.collision.addBoxCentered(part.position.x, lib.y + (lib.h - 1) / 2, pz, leftW / 2, (lib.h - 1) / 2, 0.15, 'wall');
    // Bookshelf covers the gap.
    const shelf = new THREE.Group();
    const body = w.kit.box(1.9, 2.3, 0.45, 'wallWood');
    body.position.y = 1.15;
    shelf.add(body);
    for (let r = 0; r < 3; r++) {
      const row = w.kit.box(1.7, 0.28, 0.1, 'crate');
      row.position.set(0, 0.5 + r * 0.62, 0.24);
      shelf.add(row);
    }
    shelf.position.set(gapX, lib.y, pz);
    w.group.add(shelf);
    const shelfCollider = w.collision.addBoxCentered(gapX, lib.y + 1.15, pz, 0.95, 1.15, 0.3, 'wall');
    this._shelfAnim = null;
    w.addInteractable({
      x: gapX, z: pz, y: lib.y, radius: 2.4,
      prompt: 'Pull the bookshelf [E]',
      enabled: () => !this.found.has('libraryShelf'),
      onInteract: () => {
        this._shelfAnim = { node: shelf, from: gapX, t: 0 };
        w.collision.remove(shelfCollider);
        this._loot(lib.x + lib.w / 2 - 1.6, lib.y + 0.6, lib.z - lib.d / 2 + 1.4, [['health', 25, 0, 0], ['ammo_rifle', 60, -0.9, 0.2]]);
        this.discover('libraryShelf', 'A reading room no one indexed');
      },
    });
  }

  // #3 Ring the chapel bell with a bullet.
  _chapelBell() {
    const w = this.world;
    const b = w.bellWorld;
    w.addShootable({
      x: b.x, y: b.y, z: b.z, r: b.r,
      onHit: () => {
        if (!this.discover('chapelBell', 'The bell still answers')) return;
        this.events.emit('secret:bell', {});
        const door = w.built.get('chapel').doorWorld;
        this._loot(door.x, door.y + 0.6, door.z + 2, [['health', 25, -1, 0], ['health', 25, 0, 0.8], ['health', 25, 1, 0]]);
        return true;
      },
    });
  }

  // #4 A rusty key behind the gas-station dumpster opens a house basement.
  _keyAndBasement() {
    const w = this.world;
    this.events.emit('loot:spawn', { x: 41.5, y: w.terrain.heightAt(41.5, 116.5) + 0.5, z: 116.5, type: 'key', amount: 1 });
    this.events.on('pickup', ({ type }) => {
      if (type === 'key') {
        this.hasBasementKey = true;
        this.events.emit('subtitle', { text: 'A rusty key. Something in Eastgate is still locked.' });
      }
    });
    const house = w.built.get('house13');
    const hs = house.spec;
    // The hatch sits in the yard behind the boarded-up house; the room lies
    // beneath the foundations.
    const hatch = { x: hs.x + hs.w / 2 + 2, z: hs.z + 1 };
    const room = this._undergroundRoom(hs.x, hs.z, hs.y - 6, 3, hatch, 'basement');
    const hatchLid = w.kit.box(1.4, 0.18, 1.4, 'doorMetal');
    hatchLid.position.set(hatch.x, w.terrain.heightAt(hatch.x, hatch.z) + 0.1, hatch.z);
    w.group.add(hatchLid);
    w.addInteractable({
      x: hatch.x, z: hatch.z, y: hs.y, radius: 1.8,
      prompt: () => (this.hasBasementKey ? 'Unlock the hatch [E]' : 'A locked hatch. It needs a key.'),
      enabled: () => true,
      onInteract: () => {
        if (!this.hasBasementKey) return;
        if (this.discover('basement', 'The caches of the departed')) {
          this._loot(room.x, room.y + 0.5, room.z, [['ammo_sniper', 15, 0, -1], ['ammo_sniper', 10, 1, 0], ['ammo_shotgun', 24, -1, 0], ['health', 25, 0, 1]]);
        }
        this._teleport(room.x - 1, room.z, room.y);
      },
    });
  }

  // #5 At exactly 666 kills, the alley behind the tavern remembers.
  _alleyAt666() {
    const w = this.world;
    this.events.on('kill', ({ total }) => {
      if (total !== 666 || this.found.has('alley666')) return;
      const x = -18, z = -30;
      const y = w.terrain.heightAt(x, z);
      const glow = new THREE.PointLight(0x992222, 20, 18);
      glow.position.set(x, y + 1.6, z);
      w.group.add(glow);
      w._decal('shadowDecal', x, z, 4.5, 0, 0x660000);
      this._loot(x, y + 0.5, z, [['ammo_rifle', 90, 0.8, 0], ['ammo_shotgun', 16, -0.8, 0.4], ['health', 25, 0, -0.9]]);
      this.events.emit('whisper', { intensity: 1 });
      this.events.emit('subtitle', { text: 'Six hundred and sixty-six. The alley behind the tavern remembers.' });
      this.discover('alley666', 'The alley remembers');
    });
  }

  // #6 An apartment where everything is fine except the chair on the ceiling.
  _ceilingChair() {
    const w = this.world;
    const apt = w.built.get('apartmentB').spec;
    const g = new THREE.Group();
    const seat = w.kit.box(0.5, 0.08, 0.5, 'wallWood');
    const back = w.kit.box(0.5, 0.55, 0.08, 'wallWood');
    back.position.set(0, -0.3, -0.21);
    seat.position.y = 0;
    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      const leg = w.kit.box(0.06, 0.45, 0.06, 'wallWood');
      leg.position.set(lx, 0.26, lz);
      g.add(leg);
    }
    g.add(seat, back);
    g.position.set(apt.x + 1.5, apt.y + apt.h - 0.6, apt.z - 1);
    w.group.add(g);
    this._chairPos = { x: apt.x + 1.5, z: apt.z - 1, y: apt.y };
  }

  // #7 One manhole is greener than the rest. Stand on it.
  _oddManhole() {
    const w = this.world;
    this._sewer = this._undergroundRoom(-20, -95, w.terrain.heightAt(-20, -95) - 8, 3.5, { x: -17, z: -92 }, 'sewer');
    this._sewerLootDone = false;
  }

  // #8 A ring of trees hides someone's last camp.
  _campsite() { /* proximity handled in update() */ }

  // #9 The lamppost shadow points at the sun.
  _wrongShadow() { /* proximity handled in update() */ }

  // #10 The mannequin in the shop window watches you.
  _mannequin() {
    const w = this.world;
    const shop = w.built.get('mannequinShop').spec;
    const tex = w.texLib.tinted('npcPeaceful', 'gray');
    // Front-facing cell of the sheet, static.
    tex.repeat.set(1 / 3, 1 / 4);
    tex.offset.set(1 / 3, 3 / 4);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    this.mannequin = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.6), mat);
    // Just inside the west wall (behind the window glass).
    this.mannequin.position.set(shop.x - shop.w / 2 + 0.7, shop.y + 0.9, shop.z);
    this.mannequin.rotation.y = -Math.PI / 2;
    w.group.add(this.mannequin);
  }

  /* ---------------- Eastgate ---------------- */

  // #11 The treehouse in the back garden off Quarrow Close. Somebody's whole
  // world, three metres up, and the only thing in it that is not a toy is a
  // cache. The climb is the puzzle: you cannot see the deck from the street.
  _treehouse() {
    const w = this.world;
    const x = 178, z = 92;
    w.veg.tree(w.group, x - 0.2, z + 0.4, 1.7);
    const th = w.props.treehouse(3.2);
    w.props.place(th.group, x, z);
    w.group.add(th.group);
    const y = w.terrain.heightAt(x, z);
    const d = th.deck;
    w.terrain.addPlatform(x - d.hx, x + d.hx, z - d.hz, z + d.hz, y + d.y);
    w.collision.addBox(x - d.hx, y + d.y - 0.12, z - d.hz, x + d.hx, y + d.y, z + d.hz, 'wall');
    this._treehousePos = { x, y: y + d.y, z };
    w.addInteractable({
      x, z: z + th.ladder.z, y, radius: 2.0,
      prompt: () => (this.found.has('treehouse') ? 'Climb down [E]' : 'Climb the ladder [E]'),
      onInteract: () => {
        const p = this.game?.player;
        if (!p) return;
        if (p.position.y > y + d.y - 1) { this._teleport(x, z + th.ladder.z + 1.4, y); return; }
        this._teleport(x, z, y + d.y + 0.1);
        if (this.discover('treehouse', 'Nobody built this for you')) {
          this._loot(x, y + d.y + 0.4, z, [['ammo_shotgun', 24, 0.5, 0.4], ['ammo_rifle', 60, -0.5, 0.2], ['health', 25, 0, -0.5]]);
          this.events.emit('subtitle', { text: 'Crayon on the planks: a map of the street, and one house scribbled out.' });
        }
      },
    });
  }

  // #12 The fallout shelter under the garden shed. A hatch in the floor,
  // stocked the way somebody stocks a thing they expect to need, and dated.
  _shelter() {
    const w = this.world;
    const shed = w.built.get('shed03');
    if (!shed) return;
    const s = shed.spec;
    const hatch = { x: s.x + 2.6, z: s.z + 0.4 };
    const room = this._undergroundRoom(s.x + 2.6, s.z - 4.4, s.y - 6, 3.2, hatch, 'shelter');
    const lid = w.kit.box(1.4, 0.18, 1.4, 'doorMetal');
    lid.position.set(hatch.x, w.terrain.heightAt(hatch.x, hatch.z) + 0.1, hatch.z);
    lid.rotation.y = 0.2;
    w.group.add(lid);
    w.addInteractable({
      x: hatch.x, z: hatch.z, y: s.y, radius: 1.8,
      prompt: 'Lift the hatch [E]',
      onInteract: () => {
        if (this.discover('shelter', 'They were expecting something')) {
          this._loot(room.x, room.y + 0.5, room.z, [
            ['health', 25, -1, -0.6], ['health', 25, 0, -1.2], ['ammo_shotgun', 24, 1, 0],
            ['ammo_rifle', 90, -1, 0.9], ['ammo_sniper', 10, 1, 1.0],
          ]);
          this.events.emit('subtitle', { text: 'Tinned food, water, a wall calendar. Every day of next month is already crossed off.' });
          this.events.emit('whisper', { intensity: 0.7 });
        }
        this._teleport(room.x - 1.2, room.z, room.y);
      },
    });
  }

  // #13 Three houses on the Wend Loop's west kerb are the same house — same
  // paint, same plan, same fallen chair, same pinwheel in the same place in
  // the garden. You can only ever see two of them at once. Stand in the third.
  _sameHouse() {
    const w = this.world;
    this._twinRooms = ['house20', 'house21', 'house22']
      .map((n) => w.built.get(n)?.spec)
      .filter(Boolean)
      .map((s) => ({ x: s.x, y: s.y, z: s.z }));
    this._twinsSeen = new Set();
  }

  // #14 A garden gnome. It is never in the garden you left it in.
  _gnome() {
    const w = this.world;
    this._gnomeSpots = [[71.5, 27], [116, 96], [121, -8], [151.5, -66], [186, 74]]
      .filter(([x, z]) => !w._nearBuilding(x, z, 0.9));
    if (!this._gnomeSpots.length) return;
    const g = w.props.gardenGnome();
    w.props.place(g.group, this._gnomeSpots[0][0], this._gnomeSpots[0][1], { yaw: 0.4 });
    w.group.add(g.group);
    this._gnomeNode = g.group;
    this._gnomeAt = 0;
    this._gnomeSeen = new Set([0]);
  }

  /** Is a world point behind the player, or far enough away not to be watched? */
  _unobserved(p, x, z) {
    const dx = x - p.position.x, dz = z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 55) return true;
    const look = p.lookDirection();
    return (look.x * dx + look.z * dz) / (dist || 1) < 0.1;
  }

  /* ---------------- per-frame ---------------- */

  update(dt) {
    const p = this.game?.player;
    if (!p) return;
    const px = p.position.x, pz = p.position.z;

    if (this._shelfAnim) {
      const a = this._shelfAnim;
      a.t += dt / 1.4;
      a.node.position.x = a.from - Math.min(1, a.t) * 2.0;
      if (a.t >= 1) this._shelfAnim = null;
    }

    // #7 odd manhole
    {
      const onManhole = Math.hypot(px - -20, pz - -95) < 1.2 && p.position.y > this._sewer.y + 4;
      if (onManhole) {
        this._manholeTimer += dt;
        if (this._manholeTimer > 0.6 && this._manholeTimer < 0.7) {
          this.events.emit('subtitle', { text: 'The ground here sounds hollow...' });
        }
        if (this._manholeTimer >= 2.5) {
          this._manholeTimer = 0;
          if (this.discover('sewer', 'Under the city') && !this._sewerLootDone) {
            this._sewerLootDone = true;
            this._loot(this._sewer.x, this._sewer.y + 0.5, this._sewer.z, [['ammo_rifle', 120, 1, 0], ['ammo_shotgun', 24, -1, 0.5], ['health', 25, 0, -1], ['ammo_sniper', 10, 0, 1.2]]);
          }
          this._teleport(this._sewer.x, this._sewer.z, this._sewer.y);
        }
      } else {
        this._manholeTimer = 0;
      }
    }

    // #8 campsite
    if (!this.found.has('campsite') && Math.hypot(px + 200, pz + 40) < 7) {
      this._loot(-200, this.world.terrain.heightAt(-200, -40) + 0.5, -40, [['ammo_rifle', 120, 0.5, 1], ['ammo_sniper', 15, -0.5, 1.4], ['health', 25, 1.2, 0.2]]);
      this.discover('campsite', "Someone's last camp");
    }

    // #9 wrong shadow
    if (!this.found.has('wrongShadow') && Math.hypot(px - 23.5, pz + 2.2) < 2.2) {
      this.events.emit('whisper', { intensity: 0.6 });
      this.discover('wrongShadow', 'The shadow disagrees with the sun');
    }

    // #6 ceiling chair
    if (!this.found.has('ceilingChair') && this._chairPos &&
        Math.hypot(px - this._chairPos.x, pz - this._chairPos.z) < 3 &&
        Math.abs(p.position.y - this._chairPos.y) < 2.5) {
      this.events.emit('whisper', { intensity: 0.8 });
      this.discover('ceilingChair', 'Nothing is wrong with this room');
    }

    // #13 the three houses that are one house — stand inside all three
    if (this._twinRooms && !this.found.has('sameHouse')) {
      for (let i = 0; i < this._twinRooms.length; i++) {
        const r = this._twinRooms[i];
        if (Math.hypot(px - r.x, pz - r.z) < 3.2 && Math.abs(p.position.y - r.y) < 2.5) {
          if (!this._twinsSeen.has(i)) {
            this._twinsSeen.add(i);
            if (this._twinsSeen.size === 2) {
              this.events.emit('subtitle', { text: 'You have stood in this room before. Twenty metres north of here.' });
            }
          }
        }
      }
      if (this._twinsSeen.size >= this._twinRooms.length) {
        this.events.emit('whisper', { intensity: 1 });
        this.events.emit('subtitle', { text: 'Three front doors. One house. The chair fell over the same way in all of them.' });
        this.discover('sameHouse', 'Three doors, one room');
      }
    }

    // #14 the gnome moves gardens, but only while nobody is looking at it
    if (this._gnomeNode && this._gnomeSpots) {
      const [gx, gz] = this._gnomeSpots[this._gnomeAt];
      const near = Math.hypot(px - gx, pz - gz);
      if (near < 26) this._gnomeSeen.add(this._gnomeAt);
      if (near > 34 && this._unobserved(p, gx, gz)) {
        // pick the garden furthest from where you are now: it is always the
        // one you have just walked away from that it turns up in front of
        let best = this._gnomeAt, bestD = -1;
        for (let i = 0; i < this._gnomeSpots.length; i++) {
          if (i === this._gnomeAt) continue;
          const d = Math.hypot(px - this._gnomeSpots[i][0], pz - this._gnomeSpots[i][1]);
          if (d > bestD && d < 150) { bestD = d; best = i; }
        }
        if (best !== this._gnomeAt) {
          this._gnomeAt = best;
          const [nx, nz] = this._gnomeSpots[best];
          this._gnomeNode.position.set(nx, this.world.terrain.heightAt(nx, nz), nz);
          this._gnomeNode.rotation.y = Math.atan2(px - nx, pz - nz);   // and it is facing you
        }
      }
      if (!this.found.has('gnome') && this._gnomeSeen.size >= this._gnomeSpots.length) {
        this.events.emit('whisper', { intensity: 0.85 });
        this.events.emit('subtitle', { text: 'Every garden in Eastgate. The same gnome. It has been turning to watch you go.' });
        this._loot(gx, this.world.terrain.heightAt(gx, gz) + 0.5, gz,
          [['health', 25, 0.6, 0], ['ammo_sniper', 15, -0.6, 0.4]]);
        this.discover('gnome', 'It was never the same garden');
      }
    }

    // #10 mannequin gaze
    if (this.mannequin && !this.found.has('mannequin')) {
      const m = this.mannequin.position;
      const dx = m.x - px, dy = m.y - (p.position.y + p.eyeHeight), dz = m.z - pz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 28) {
        const look = p.lookDirection();
        const dot = (look.x * dx + look.y * dy + look.z * dz) / dist;
        if (dot > 0.995) {
          this._gazeTimer += dt;
        } else if (this._gazeTimer >= 4) {
          // Looked long enough, then looked away: it is gone.
          this.world.group.remove(this.mannequin);
          this.mannequin = null;
          this.events.emit('whisper', { intensity: 1 });
          this.discover('mannequin', 'It was never for sale');
        } else if (dot < 0.9) {
          this._gazeTimer = 0;
        }
      }
    }
  }
}
