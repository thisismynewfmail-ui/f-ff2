import * as THREE from '../../lib/three.module.js';
import { Sentry, SENTRY_RANGE, SENTRY_ARC } from '../entities/Sentry.js';
import { buildSentryModel } from '../rendering/SentryModel.js';

/**
 * Owns every sentry: the ones folded up in the satchel, the one currently in
 * the player's hands, and the ones standing out in the street.
 *
 * The life of a sentry is a loop, and the loop is the feature:
 *
 *   BUY      the vendor sells one; it lands in the satchel like any other
 *            stored item ('pickup' with type 'sentry').
 *   TAKE     click it in the satchel. The satchel closes and the sentry comes
 *            up into your hands ('sentry:hold' raises the viewmodel).
 *   AIM      while it is held, the world shows where it would go: a ghost of
 *            the machine on the ground ahead of you and, laid over the grass
 *            in front of it, the GREEN WEDGE — a translucent 180° fan of
 *            exactly the radius it will actually cover, so the arc you are
 *            choosing is the arc you get. Red means the ground will not take
 *            it and the click will be refused.
 *   PLACE    click. The ghost becomes a real Sentry facing the way you were.
 *   PACK UP  press [E] on a deployed one and it folds back into the satchel,
 *            ready to be set down somewhere better.
 *
 * The preview is drawn from the same SENTRY_RANGE and SENTRY_ARC constants the
 * turret's own targeting reads, so the two cannot drift apart: if the wedge
 * says it covers that doorway, it covers that doorway.
 */
const PLACE_DIST = 2.2;       // how far ahead of the player the ghost sits
const WALL_H = 0.9;           // how tall the bubble's boundary curtain stands
const GROUND_STEP = 0.4;      // max height change from the player's feet
const REPLACE_CLEARANCE = 1.1; // no two sentries closer together than this
/**
 * How far [R] swings the arc, per press.
 *
 * The arc a sentry covers is normally the way you were facing when you set it
 * down, which is right when you are placing it across a doorway you are
 * standing in and useless when you want it covering the street you just came
 * up. So the reload key trims it: a fixed 25° a press, deliberately not a
 * smooth drag, because a detent you can count is what lets you set two of
 * them at a known angle to each other without a protractor. Fourteen presses
 * and change come back round to where you started.
 */
const ROTATE_STEP = 25 * Math.PI / 180;
// Three placements inside this many seconds and the next one deploys in a mood.
const GRUMBLE_WINDOW = 20;
const GRUMBLE_COUNT = 3;

export class SentrySystem {
  constructor(events, world, texLib, scene, player) {
    this.events = events;
    this.world = world;
    this.texLib = texLib;
    this.scene = scene;
    this.player = player;

    this.stored = 0;          // folded up in the satchel
    this.holding = false;     // one is in the player's hands right now
    this.deployed = [];
    this.spot = null;         // where the held one would land: {x, z, y, yaw, ok}
    this.trim = 0;            // [R] while holding: extra yaw on the arc, in steps
    this._placeTimes = [];    // when the last few were set down (see GRUMBLE_*)

    this._buildPreview();

    // Bought from the vendor, or picked back up off the ground.
    events.on('pickup', ({ type }) => { if (type === 'sentry') { this.stored++; this._syncSatchel(); } });
    // Clicked in the satchel: into the hands, not onto the floor.
    events.on('inventory:drop', ({ type }) => { if (type === 'sentry') this.takeToHand(); });
    events.on('sentry:retrieve', ({ sentry }) => this.retrieve(sentry));
  }

  /**
   * Tell the satchel how many sentries the player actually has.
   *
   * This system is the one that knows — a sentry can be stowed, in your hands
   * or standing in the street, and only the stowed ones belong in a slot — so
   * it STATES the count rather than letting the satchel keep a tally of its
   * own that a checkpoint rollback could leave stale.
   */
  _syncSatchel() {
    this.events.emit('inventory:sync', {
      type: 'sentry', label: 'Portable Sentry', count: this.stored,
    });
  }

  /* ---------------- the placement preview ---------------- */

  /**
   * The ghost and its wedge, built once and moved around.
   *
   * The wedge is three surfaces: a fan lying on the ground (which is what
   * reads as "this ground is covered"), a curtain standing on its boundary
   * (which gives the volume its bubble without enclosing the camera — see the
   * note on it below), and a bright line along the edge (which is what you
   * actually line a doorway up against). All three are translucent green with
   * no depth WRITING, so they lie over grass, kerbs and bodies without
   * z-fighting any of them.
   */
  _buildPreview() {
    this.preview = new THREE.Group();
    this.preview.visible = false;

    const SEG = 28, RINGS = 8;
    /**
     * The ground fan, as a polar GRID rather than a single flat triangle fan.
     *
     * A flat disc pinned at the mount is only correct on a billiard table. On
     * the knoll this thing is actually deployed on, six metres of radius is
     * easily a metre of fall, so a flat fan is buried in the upslope and hangs
     * in the air over the downslope — which is exactly what it did: the whole
     * preview was invisible because the hill was in front of it. So the fan
     * carries intermediate rings and is re-draped onto the real ground every
     * frame (see _drapeFan), which makes the green lie ON the terrain the way
     * a projection would. The ring count is set against the terrain lattice
     * rather than picked: at this radius eight rings put a drape sample every
     * couple of metres, comfortably inside the ground's own 3.2 m cells, so
     * the sheet follows the slope instead of chording across it.
     *
     * RingGeometry gives that grid for free. Its wedge is authored in the XY
     * plane running counter-clockwise from +X, so the rotation is BAKED into
     * the attribute (rotateX, not mesh.rotation): the drape writes Y directly,
     * and it can only do that if Y is already the vertical axis of the data.
     * With the rotation baked, theta -PI..0 maps to the +Z half — the ground
     * in front of the mount, which is exactly the half a sentry covers.
     */
    const fanGeo = new THREE.RingGeometry(
      0, SENTRY_RANGE, SEG, RINGS, -Math.PI, SENTRY_ARC);
    fanGeo.rotateX(-Math.PI / 2);
    this._fanGeo = fanGeo;
    // Bright enough to READ on grass in daylight, and no brighter. The wedge
    // covers most of a street at this range, so what was a legible tint over
    // six metres becomes a coat of paint over eighteen; the bright EDGE below
    // is what carries the boundary, and the fill only has to say "inside".
    this.fanMat = new THREE.MeshBasicMaterial({
      color: 0x4cff88, transparent: true, opacity: 0.20,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const fan = new THREE.Mesh(fanGeo, this.fanMat);
    fan.renderOrder = 3;
    fan.frustumCulled = false;   // its bounds move every frame
    this.preview.add(fan);

    // --- the wall of the bubble: a curtain standing on the boundary arc.
    //
    // This was a DOME first, and a dome is wrong here for a reason worth
    // writing down: the mount sits about two metres in front of the player and
    // the bubble is six across, so the camera is INSIDE the sphere — looking
    // out through the open half at its own inner surface, which washes the
    // entire screen green and hides the very ground it is describing. A
    // curtain on the boundary has no inside to be caught in: you read the
    // edge of the cover as a wall of light, from either side of it.
    const wallGeo = new THREE.CylinderGeometry(
      SENTRY_RANGE, SENTRY_RANGE, WALL_H, SEG, 1, true, -SENTRY_ARC / 2, SENTRY_ARC);
    this.domeMat = new THREE.MeshBasicMaterial({
      color: 0x4cff88, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const wall = new THREE.Mesh(wallGeo, this.domeMat);
    wall.position.y = WALL_H / 2;
    wall.renderOrder = 3;
    wall.frustumCulled = false;
    this.preview.add(wall);

    // --- the edge: the two limits and the arc between them, so the boundary
    // of the cover is a line you can actually put a doorway on. Draped with
    // the fan, for the same reason.
    const edge = [new THREE.Vector3(0, 0, 0)];
    for (let i = 0; i <= SEG; i++) {
      const a = -SENTRY_ARC / 2 + (i / SEG) * SENTRY_ARC;
      edge.push(new THREE.Vector3(Math.sin(a) * SENTRY_RANGE, 0, Math.cos(a) * SENTRY_RANGE));
    }
    edge.push(new THREE.Vector3(0, 0, 0));
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xc8ffd8, transparent: true, opacity: 0.95, fog: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), this.edgeMat);
    line.renderOrder = 4;
    line.frustumCulled = false;
    this._edgeGeo = line.geometry;
    this.preview.add(line);

    // --- the ghost of the machine itself, so you can see which way it faces
    this.ghost = buildSentryModel(this.texLib);
    this.ghostMats = [];
    this.ghost.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.45;
      o.material.depthWrite = false;
      this.ghostMats.push(o.material);
    });
    // Stand the ghost up in its deployed pose: legs out, knees folded, pads
    // flat, mast up. It is a still frame of the machine, so every joint the
    // real one animates has to be posed here or the preview is a different
    // shape from the thing it is previewing.
    for (const leg of this.ghost.parts.legs) {
      leg.hip.rotation.x = leg.splay;
      leg.knee.rotation.x = leg.fold;
      leg.pad.rotation.x = -(leg.splay + leg.fold);
      leg.ram.position.y = -0.175;
      leg.ram.scale.y = 1.35;
    }
    this.ghost.parts.mastStage.position.y = 0.145;
    this.ghost.parts.body.position.y = 0.26;
    this.preview.add(this.ghost.group);
    this.scene.add(this.preview);
  }

  /**
   * Lay the fan (and its edge) on the actual ground under the preview.
   *
   * Each vertex keeps its polar (x, z) in the preview's own frame and only
   * its HEIGHT is rewritten: the local point is rotated into the world, the
   * ground is sampled there, and the result is taken back to a local offset
   * from the mount. The ground query is anchored to the mount's own elevation
   * so a fan that reaches a rooftop or a cellar does not leap onto it.
   *
   * The height taken is the HIGHEST ground in the vertex's NEIGHBOURHOOD, not
   * the ground directly under it, and that is the whole trick. Three surfaces
   * disagree here: the analytic terrain, the bilinear reading of the rendered
   * lattice, and the actual TRIANGLES that lattice is drawn as. A fan pinned
   * to any one of them is under the other two across half of every cell — and
   * at the grazing angle you look along a floor at, "under by two centimetres"
   * means invisible. So each vertex clears the worst ground within half a
   * terrain cell of itself, which puts the whole sheet above the triangles it
   * lies over while still following the slope.
   */
  _drapeFan(px, py, pz, yaw) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const terrain = this.world.terrain;
    const lift = 0.09;
    const probe = 1.7;   // a little over half the terrain lattice's 3.2 m cell
    const ground = (wx, wz) => Math.max(
      this.world.groundHeightFor(wx, wz, py + 1.2),
      terrain.meshHeightAt ? terrain.meshHeightAt(wx, wz) : -Infinity,
    );
    for (const geo of [this._fanGeo, this._edgeGeo]) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i), lz = p.getZ(i);
        const wx = px + lx * cos + lz * sin;
        const wz = pz - lx * sin + lz * cos;
        const h = Math.max(
          ground(wx, wz),
          ground(wx + probe, wz), ground(wx - probe, wz),
          ground(wx, wz + probe), ground(wx, wz - probe),
        );
        p.setY(i, h - py + lift);
      }
      p.needsUpdate = true;
    }
  }

  /* ---------------- carrying ---------------- */

  /** Take one out of the satchel and into the hands. */
  takeToHand() {
    if (this.holding || this.stored <= 0) { this._syncSatchel(); return false; }
    this.stored--;
    this._syncSatchel();
    this.holding = true;
    this.trim = 0;
    this.events.emit('sentry:hold', { on: true });
    this.events.emit('subtitle', {
      text: 'Sentry in hand. Click to set it down; [R] swings its arc 25° a press.',
    });
    return true;
  }

  /** Swing the arc of the held one, one detent per press. */
  rotate(dir = 1) {
    if (!this.holding) return false;
    this.trim = (this.trim + dir * ROTATE_STEP) % (Math.PI * 2);
    const deg = Math.round((this.trim * 180 / Math.PI + 360) % 360);
    this.events.emit('sentry:rotate', { trim: this.trim, degrees: deg });
    return true;
  }

  /** Put the held one back in the satchel without deploying it. */
  stow() {
    if (!this.holding) return false;
    this.holding = false;
    this.stored++;
    this._syncSatchel();
    this.preview.visible = false;
    this.events.emit('sentry:hold', { on: false });
    return true;
  }

  /** Fold a deployed sentry back up — the [E] on a placed one. */
  retrieve(sentry) {
    const i = this.deployed.indexOf(sentry);
    if (i < 0) return false;
    this.deployed.splice(i, 1);
    sentry.toRemove = true;
    this.scene.remove(sentry.mesh);
    sentry.dispose();
    this.stored++;
    this._syncSatchel();
    this.events.emit('subtitle', { text: 'The sentry folds its legs and goes back in the satchel.' });
    return true;
  }

  /* ---------------- placement ---------------- */

  /**
   * Where the held sentry would land, and whether it may. The spot is a fixed
   * distance ahead of the player along their look direction — near enough to
   * place it against a doorway you are standing in, far enough that it is not
   * under your own feet.
   *
   * It is refused when the ground there is a step the player could not walk
   * up, when something solid already occupies it, or when it would stand on
   * top of another sentry. Refusals turn the whole preview red rather than
   * simply doing nothing on the click, so the reason is on screen.
   */
  _resolveSpot() {
    const p = this.player;
    // TWO YAW CONVENTIONS MEET HERE, and getting it wrong is invisible in the
    // maths and obvious on screen. The PLAYER faces (-sin yaw, -cos yaw) —
    // yaw 0 looks down -Z — while every ENTITY and every model in the game
    // faces (+sin yaw, +cos yaw). Handing the player's yaw straight to a
    // sentry therefore builds a turret, and a preview wedge, aimed at exactly
    // what is BEHIND you. So the placed facing is the player's, turned round.
    // The SPOT is always straight ahead; only the ARC is trimmed by [R], so
    // turning the cover round never moves the machine out from under the
    // ghost you were lining up.
    const facing = p.yaw + Math.PI;
    const yaw = facing + this.trim;
    const x = p.position.x + Math.sin(facing) * PLACE_DIST;
    const z = p.position.z + Math.cos(facing) * PLACE_DIST;
    const y = this.world.groundHeightFor(x, z, p.position.y + 1.0);
    let ok = Math.abs(y - p.position.y) <= GROUND_STEP;
    if (ok) {
      // Solid geometry: probe the capsule the sentry's own body would occupy.
      const probe = new THREE.Vector3(x, y, z);
      this.world.collision.resolveCapsule(probe, 0.3, 0.62);
      if (Math.hypot(probe.x - x, probe.z - z) > 0.06) ok = false;
    }
    if (ok) {
      for (const s of this.deployed) {
        if (Math.hypot(s.position.x - x, s.position.z - z) < REPLACE_CLEARANCE) { ok = false; break; }
      }
    }
    return { x, y, z, yaw, ok };
  }

  /** Commit the held sentry to the ground. */
  place() {
    if (!this.holding || !this.spot?.ok) {
      if (this.holding) this.events.emit('subtitle', { text: 'No footing for it there.' });
      return null;
    }
    const { x, z, yaw } = this.spot;
    const s = this._stand(x, z, yaw);
    this.holding = false;
    this.trim = 0;
    this.preview.visible = false;
    this.events.emit('sentry:hold', { on: false });
    return s;
  }

  /**
   * Stand one up at a point, and note that it happened.
   *
   * The note is the easter egg: three of these inside twenty seconds and the
   * next machine comes up in a mood about it (see Sentry's `grumble`). Being
   * picked up and put down repeatedly is exactly the sort of thing a player
   * does while fiddling with cover, so it is a thing they will find.
   */
  _stand(x, z, yaw) {
    const now = performance.now() / 1000;
    this._placeTimes = this._placeTimes.filter((t) => now - t < GRUMBLE_WINDOW);
    this._placeTimes.push(now);
    const grumpy = this._placeTimes.length >= GRUMBLE_COUNT;
    if (grumpy) this._placeTimes.length = 0;
    const s = new Sentry(this.events, this.world, this.texLib, { x, z, yaw, grumpy });
    this.scene.add(s.mesh);
    this.deployed.push(s);
    return s;
  }

  /**
   * Put one on the ground in front of somebody, ready to be picked up.
   *
   * This is what the console's `spawn sentry` uses. It is the ORDINARY sentry
   * — the same class, deployed the same way, carrying the same [E] prompt — so
   * a spawned one packs into the satchel and redeploys exactly like a bought
   * one. A foot in front of the player is deliberately close enough that it
   * lands inside the interact radius: you spawn it and it is already yours to
   * pick up.
   */
  spawnAhead(player, dist = 0.3048) {
    const yaw = player.yaw + Math.PI;          // players face -sin/-cos; entities +
    const x = player.position.x + Math.sin(yaw) * dist;
    const z = player.position.z + Math.cos(yaw) * dist;
    return this._stand(x, z, yaw);
  }

  /* ---------------- frame ---------------- */

  /**
   * Called from the game loop with the shared AI context (the sentries need
   * the live zombie list) and the input (the held one is placed on a click).
   * `blocked` is true while something else owns the mouse — the shop, the
   * satchel — so a click on a shop button never also drops a turret.
   */
  update(dt, ctx, input, blocked = false) {
    for (const s of this.deployed) s.update(dt, ctx);

    if (!this.holding || !this.player.alive) {
      this.preview.visible = false;
      return;
    }
    this.spot = this._resolveSpot();
    const { x, y, z, yaw, ok } = this.spot;
    this.preview.visible = true;
    this.preview.position.set(x, y, z);
    this.preview.rotation.y = yaw;
    this._drapeFan(x, y, z, yaw);
    // green means it will go there; red means the click will be refused
    const tint = ok ? 0x4cff88 : 0xff5040;
    this.fanMat.color.setHex(tint);
    this.domeMat.color.setHex(tint);
    this.edgeMat.color.setHex(ok ? 0x8dffb4 : 0xff9080);
    for (const m of this.ghostMats) m.opacity = ok ? 0.45 : 0.25;
    // a slow breath on the bubble, so it reads as a projection rather than
    // as a piece of level geometry somebody left switched on
    const b = 0.9 + Math.sin(performance.now() * 0.003) * 0.1;
    this.fanMat.opacity = 0.20 * b;
    this.domeMat.opacity = 0.22 * b;

    if (blocked || !input) return;
    // [R] trims the arc. It is read through the ACTION rather than the raw key
    // so a player who rebound reload gets it on whatever they rebound it to —
    // and the weapon manager is told to stand down while a sentry is in hand,
    // so the same press cannot also try to reload a gun that is not out.
    if (input.wasActionPressed('reload')) this.rotate(1);
    if (input.wasClicked(0)) this.place();
    else if (input.wasClicked(2)) this.stow();   // right-click: put it away again
  }

  /** Wipe every deployed sentry — a checkpoint rollback or a new run. */
  reset({ keepStored = false } = {}) {
    for (const s of this.deployed) {
      this.scene.remove(s.mesh);
      s.dispose();
    }
    this.deployed.length = 0;
    if (this.holding) {
      this.holding = false;
      this.events.emit('sentry:hold', { on: false });
    }
    this.preview.visible = false;
    if (!keepStored) this.stored = 0;
    this._syncSatchel();
  }

  /**
   * Fold EVERY sentry back into the satchel — the ones bolted to the pavement
   * and the one in the player's hands — without losing a single one of them.
   *
   * This is what dying does. A death costs the player the wave they were on;
   * it does not cost them hardware they paid tokens for, and it must not leave
   * it standing on the far side of town from a respawn point. Returns how many
   * came home, so the caller can say so.
   */
  recallAll() {
    const back = this.deployed.length + (this.holding ? 1 : 0);
    this.reset({ keepStored: true });
    this.stored += back;
    this._syncSatchel();
    return back;
  }

  /** Freeze the hardware for a checkpoint / the save. */
  snapshot() {
    return {
      stored: this.stored + (this.holding ? 1 : 0),
      deployed: this.deployed.map((s) => ({ x: s.position.x, z: s.position.z, yaw: s.yaw })),
    };
  }

  /** Put back what snapshot() froze, standing the turrets up where they were. */
  restore(snap) {
    if (!snap) return;
    this.reset();
    this.stored = Math.max(0, snap.stored | 0);
    this._syncSatchel();
    for (const d of snap.deployed ?? []) {
      const s = new Sentry(this.events, this.world, this.texLib, { x: d.x, z: d.z, yaw: d.yaw });
      this.scene.add(s.mesh);
      this.deployed.push(s);
    }
  }
}
