import * as THREE from '../../lib/three.module.js';
import { Sentry, SENTRY_RANGE, SENTRY_ARC } from '../entities/Sentry.js';
import { SentryTwo, TWO_RANGE, TWO_ARC } from '../entities/SentryTwo.js';
import { buildSentryModel } from '../rendering/SentryModel.js';
import { buildSentryTwoModel } from '../rendering/SentryTwoModel.js';

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
/**
 * THE TWO MACHINES THIS SYSTEM OWNS.
 *
 * Everything below is written against this table rather than against the Mk I,
 * because the loop — buy, take, aim, place, pack up — is IDENTICAL for both and
 * only the numbers differ. A third deployable would be another row here and no
 * new code anywhere else: the satchel slot, the ghost, the wedge, the save and
 * the death-recall all read the row.
 *
 * `range` and `arc` are the entity's OWN constants, so the green wedge a player
 * lines a doorway up with is drawn from the same numbers the turret's targeting
 * reads. The two cannot drift apart.
 */
export const SENTRY_KINDS = {
  sentry: {
    label: 'Portable Sentry',
    Class: Sentry,
    build: buildSentryModel,
    range: SENTRY_RANGE,
    arc: SENTRY_ARC,
    clearRadius: 0.30,
    bodyH: 0.62,
    spacing: 1.1,
    hint: 'Sentry in hand. Click to set it down; [R] swings its arc 25° a press.',
    stowLine: 'The sentry folds its legs and goes back in the satchel.',
    // how the ghost stands: the deployed pose, frozen
    pose: (parts) => {
      for (const leg of parts.legs) {
        leg.hip.rotation.x = leg.splay;
        leg.knee.rotation.x = leg.fold;
        leg.pad.rotation.x = -(leg.splay + leg.fold);
        leg.ram.position.y = -0.175;
        leg.ram.scale.y = 1.35;
      }
      parts.mastStage.position.y = 0.145;
      parts.body.position.y = 0.26;
    },
  },
  sentryTwo: {
    label: 'Sentry Mk II',
    Class: SentryTwo,
    build: buildSentryTwoModel,
    range: TWO_RANGE,
    arc: TWO_ARC,
    clearRadius: 0.36,
    bodyH: 0.90,
    // A bigger machine needs a bigger berth, and two of these overlapping
    // would be two guns in the same hole rather than a crossfire.
    spacing: 1.7,
    hint: 'Mk II in hand — 240° of cover, twice the reach. Click to set it down; [R] swings its arc.',
    stowLine: 'The Mk II pulls its spade, folds its legs and goes back in the satchel.',
    pose: (parts) => {
      for (const leg of parts.legs) {
        leg.hip.rotation.x = leg.splay;
        leg.knee.rotation.x = leg.fold;
        leg.pad.rotation.x = -(leg.splay + leg.fold);
        leg.ram.position.y = -0.154;
        leg.ram.scale.y = 1.35;
        leg.jack.position.y = -0.158;
      }
      parts.spade.rotation.x = 0.90;
      parts.mastStage.position.y = 0.195;
      parts.body.position.y = parts.deckY;
      parts.rf.bar.scale.x = 1;
      // The ghost is the machine as it will STAND, so it is shown with its
      // latches off, its dogs over, and the jar primed — the thing you are
      // about to have, not the thing in your bag.
      for (const l of parts.latches) l.rotation.x = -1.5;
      for (const d of parts.lockDogs) d.rotation.x = 0;
      // The frost is hidden by the MESH rather than by the shared material:
      // the ghost's materials are all cloned when it is built, so writing to
      // the rig's material here would touch a material nothing is using and
      // leave a white cylinder standing where the jar should be.
      parts.frost.visible = false;
      for (const b of parts.bubbles) b.mesh.visible = false;
    },
  },
};
/** The satchel type of every deployable this system answers for. */
export const SENTRY_TYPES = Object.keys(SENTRY_KINDS);

const PLACE_DIST = 2.2;       // how far ahead of the player the ghost sits
const WALL_H = 0.9;           // how tall the bubble's boundary curtain stands
const GROUND_STEP = 0.4;      // max height change from the player's feet
// No two machines closer together than this — the berth is per kind now and
// lives in SENTRY_KINDS.spacing above, since a Mk II needs more room than a
// Mk I and a pair of them needs more still.
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

    // How many of each are folded up in the satchel. One tally per kind, and
    // `stored` below keeps reading as the Mk I's for everything that only ever
    // knew about one machine.
    this.count = { sentry: 0, sentryTwo: 0 };
    this.holding = null;      // the KIND in the player's hands, or null
    this.deployed = [];       // both kinds, in the order they were set down
    this.spot = null;         // where the held one would land: {x, z, y, yaw, ok}
    this.trim = 0;            // [R] while holding: extra yaw on the arc, in steps
    this._placeTimes = [];    // when the last few were set down (see GRUMBLE_*)

    this.previews = {};
    for (const kind of SENTRY_TYPES) this.previews[kind] = this._buildPreview(kind);

    // Bought from the vendor, or picked back up off the ground.
    events.on('pickup', ({ type }) => {
      if (!SENTRY_KINDS[type]) return;
      this.count[type]++;
      this._syncSatchel();
    });
    // Clicked in the satchel: into the hands, not onto the floor.
    events.on('inventory:drop', ({ type }) => { if (SENTRY_KINDS[type]) this.takeToHand(type); });
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
    for (const kind of SENTRY_TYPES) {
      this.events.emit('inventory:sync', {
        type: kind, label: SENTRY_KINDS[kind].label, count: this.count[kind],
      });
    }
  }

  /** The Mk I's tally, for everything written before there were two of them. */
  get stored() { return this.count.sentry; }

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
  _buildPreview(kind) {
    const K = SENTRY_KINDS[kind];
    const preview = new THREE.Group();
    preview.visible = false;

    // The wider, longer wedge wants more segments to stay smooth and more
    // rings to stay draped: the Mk II's fan is twice the radius over a third
    // more arc, and a segment count that reads as a curve at six metres reads
    // as a polygon at eighteen.
    const SEG = Math.round(28 * (K.arc / SENTRY_ARC) * (K.range > SENTRY_RANGE ? 1.5 : 1));
    const RINGS = K.range > SENTRY_RANGE ? 12 : 8;
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
      0, K.range, SEG, RINGS, -Math.PI - (K.arc - SENTRY_ARC) / 2, K.arc);
    fanGeo.rotateX(-Math.PI / 2);
    // Bright enough to READ on grass in daylight, and no brighter. The wedge
    // covers most of a street at this range, so what was a legible tint over
    // six metres becomes a coat of paint over eighteen; the bright EDGE below
    // is what carries the boundary, and the fill only has to say "inside".
    const fanMat = new THREE.MeshBasicMaterial({
      color: 0x4cff88, transparent: true, opacity: 0.20,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.renderOrder = 3;
    fan.frustumCulled = false;   // its bounds move every frame
    preview.add(fan);

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
      K.range, K.range, WALL_H, SEG, 1, true, -K.arc / 2, K.arc);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0x4cff88, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const wall = new THREE.Mesh(wallGeo, domeMat);
    wall.position.y = WALL_H / 2;
    wall.renderOrder = 3;
    wall.frustumCulled = false;
    preview.add(wall);

    // --- the edge: the two limits and the arc between them, so the boundary
    // of the cover is a line you can actually put a doorway on. Draped with
    // the fan, for the same reason.
    const edge = [new THREE.Vector3(0, 0, 0)];
    for (let i = 0; i <= SEG; i++) {
      const a = -K.arc / 2 + (i / SEG) * K.arc;
      edge.push(new THREE.Vector3(Math.sin(a) * K.range, 0, Math.cos(a) * K.range));
    }
    edge.push(new THREE.Vector3(0, 0, 0));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xc8ffd8, transparent: true, opacity: 0.95, fog: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), edgeMat);
    line.renderOrder = 4;
    line.frustumCulled = false;
    preview.add(line);

    // --- the ghost of the machine itself, so you can see which way it faces
    const ghost = K.build(this.texLib);
    const ghostMats = [];
    ghost.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.45;
      o.material.depthWrite = false;
      ghostMats.push(o.material);
    });
    // Stand the ghost up in its deployed pose: legs out, knees folded, pads
    // flat, mast up. It is a still frame of the machine, so every joint the
    // real one animates has to be posed here or the preview is a different
    // shape from the thing it is previewing.
    K.pose(ghost.parts);
    preview.add(ghost.group);
    this.scene.add(preview);
    return { group: preview, fanGeo, edgeGeo: line.geometry, fanMat, domeMat, edgeMat, ghostMats };
  }

  /** The preview belonging to whatever is in the player's hands. */
  get preview() { return this.previews[this.holding]?.group ?? null; }

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
  _drapeFan(view, px, py, pz, yaw) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const terrain = this.world.terrain;
    const lift = 0.09;
    const probe = 1.7;   // a little over half the terrain lattice's 3.2 m cell
    const ground = (wx, wz) => Math.max(
      this.world.groundHeightFor(wx, wz, py + 1.2),
      terrain.meshHeightAt ? terrain.meshHeightAt(wx, wz) : -Infinity,
    );
    for (const geo of [view.fanGeo, view.edgeGeo]) {
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

  /** Take one of `kind` out of the satchel and into the hands. */
  takeToHand(kind = 'sentry') {
    const K = SENTRY_KINDS[kind];
    if (!K || this.holding || this.count[kind] <= 0) { this._syncSatchel(); return false; }
    this.count[kind]--;
    this._syncSatchel();
    this.holding = kind;
    this.trim = 0;
    // The viewmodel needs to know WHICH machine came up: the thing in your
    // hands is the thing you are about to put down, or it is a lie.
    this.events.emit('sentry:hold', { on: true, kind });
    this.events.emit('subtitle', { text: K.hint });
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
    const kind = this.holding;
    if (this.preview) this.preview.visible = false;
    this.holding = null;
    this.count[kind]++;
    this._syncSatchel();
    this.events.emit('sentry:hold', { on: false, kind });
    return true;
  }

  /**
   * Fold a deployed machine back up — the [E] on a placed one.
   *
   * The kind comes off the ENTITY rather than off the caller, so packing up a
   * Mk II can only ever credit a Mk II: the prompt, the interactable and the
   * satchel slot are all the same object's business.
   */
  retrieve(sentry) {
    const i = this.deployed.indexOf(sentry);
    if (i < 0) return false;
    const kind = sentry.kind || 'sentry';
    this.deployed.splice(i, 1);
    sentry.toRemove = true;
    this.scene.remove(sentry.mesh);
    sentry.dispose();
    this.count[kind]++;
    this._syncSatchel();
    this.events.emit('subtitle', { text: SENTRY_KINDS[kind].stowLine });
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
    const K = SENTRY_KINDS[this.holding] ?? SENTRY_KINDS.sentry;
    let ok = Math.abs(y - p.position.y) <= GROUND_STEP;
    if (ok) {
      // Solid geometry: probe the capsule this machine's own body occupies —
      // the Mk II is wider and taller, and a spot the Mk I fits is not
      // automatically a spot the Mk II fits.
      const probe = new THREE.Vector3(x, y, z);
      this.world.collision.resolveCapsule(probe, K.clearRadius, K.bodyH);
      if (Math.hypot(probe.x - x, probe.z - z) > 0.06) ok = false;
    }
    if (ok) {
      // ...and it may not stand on top of another machine of either kind. The
      // berth is the larger of the two involved, so a Mk II never lands in a
      // Mk I's lap just because the Mk I was placed first.
      for (const s of this.deployed) {
        const gap = Math.max(K.spacing, SENTRY_KINDS[s.kind || 'sentry'].spacing);
        if (Math.hypot(s.position.x - x, s.position.z - z) < gap) { ok = false; break; }
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
    const kind = this.holding;
    const { x, z, yaw } = this.spot;
    if (this.preview) this.preview.visible = false;
    this.holding = null;
    this.trim = 0;
    const s = this._stand(x, z, yaw, kind);
    this.events.emit('sentry:hold', { on: false, kind });
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
  _stand(x, z, yaw, kind = 'sentry') {
    const now = performance.now() / 1000;
    this._placeTimes = this._placeTimes.filter((t) => now - t < GRUMBLE_WINDOW);
    this._placeTimes.push(now);
    const grumpy = this._placeTimes.length >= GRUMBLE_COUNT;
    if (grumpy) this._placeTimes.length = 0;
    const K = SENTRY_KINDS[kind] ?? SENTRY_KINDS.sentry;
    const s = new K.Class(this.events, this.world, this.texLib, { x, z, yaw, grumpy });
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
  spawnAhead(player, dist = 0.3048, kind = 'sentry') {
    const yaw = player.yaw + Math.PI;          // players face -sin/-cos; entities +
    const x = player.position.x + Math.sin(yaw) * dist;
    const z = player.position.z + Math.cos(yaw) * dist;
    return this._stand(x, z, yaw, kind);
  }

  /* ---------------- frame ---------------- */

  /**
   * Called from the game loop with the shared AI context (the sentries need
   * the live zombie list) and the input (the held one is placed on a click).
   * `blocked` is true while something else owns the mouse — the shop, the
   * satchel — so a click on a shop button never also drops a turret.
   */
  update(dt, ctx, input, blocked = false) {
    // Both kinds are stepped with the same context, and the context carries
    // the deployed list so a Mk II coming up beside a Mk I can find it (see
    // SentryTwo's handshake).
    const shared = ctx ? { ...ctx, sentries: this.deployed } : { sentries: this.deployed };
    for (const s of this.deployed) s.update(dt, shared);

    // Only the held kind's preview is ever visible; the other is parked.
    for (const kind of SENTRY_TYPES) {
      if (kind !== this.holding) this.previews[kind].group.visible = false;
    }
    if (!this.holding || !this.player.alive) {
      if (this.preview) this.preview.visible = false;
      return;
    }
    const view = this.previews[this.holding];
    this.spot = this._resolveSpot();
    const { x, y, z, yaw, ok } = this.spot;
    view.group.visible = true;
    view.group.position.set(x, y, z);
    view.group.rotation.y = yaw;
    this._drapeFan(view, x, y, z, yaw);
    // green means it will go there; red means the click will be refused
    const tint = ok ? 0x4cff88 : 0xff5040;
    view.fanMat.color.setHex(tint);
    view.domeMat.color.setHex(tint);
    view.edgeMat.color.setHex(ok ? 0x8dffb4 : 0xff9080);
    for (const m of view.ghostMats) m.opacity = ok ? 0.45 : 0.25;
    // a slow breath on the bubble, so it reads as a projection rather than
    // as a piece of level geometry somebody left switched on
    const b = 0.9 + Math.sin(performance.now() * 0.003) * 0.1;
    view.fanMat.opacity = 0.20 * b;
    view.domeMat.opacity = 0.22 * b;

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
      this.holding = null;
      this.events.emit('sentry:hold', { on: false });
    }
    for (const kind of SENTRY_TYPES) {
      this.previews[kind].group.visible = false;
      if (!keepStored) this.count[kind] = 0;
    }
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
    const home = { sentry: 0, sentryTwo: 0 };
    for (const s of this.deployed) home[s.kind || 'sentry']++;
    if (this.holding) home[this.holding]++;
    const back = home.sentry + home.sentryTwo;
    this.reset({ keepStored: true });
    for (const kind of SENTRY_TYPES) this.count[kind] += home[kind];
    this._syncSatchel();
    return back;
  }

  /**
   * Freeze the hardware for a checkpoint / the save.
   *
   * `stored` is still written as the Mk I's count so a save made by this build
   * can be read by anything that only knew about one machine; `counts` carries
   * the whole truth, and `kind` rides on each deployed one.
   */
  snapshot() {
    const counts = { ...this.count };
    if (this.holding) counts[this.holding]++;    // in the hands is still owned
    return {
      stored: counts.sentry,
      counts,
      deployed: this.deployed.map((s) => ({
        x: s.position.x, z: s.position.z, yaw: s.yaw, kind: s.kind || 'sentry',
      })),
    };
  }

  /**
   * Put back what snapshot() froze, standing the machines up where they were.
   *
   * An older save has no `counts` and no `kind` on its deployed entries, and
   * reads back as what it was: Mk Is, and none of the new machine.
   */
  restore(snap) {
    if (!snap) return;
    this.reset();
    const counts = snap.counts ?? { sentry: snap.stored | 0, sentryTwo: 0 };
    for (const kind of SENTRY_TYPES) this.count[kind] = Math.max(0, counts[kind] | 0);
    this._syncSatchel();
    for (const d of snap.deployed ?? []) {
      const K = SENTRY_KINDS[d.kind] ?? SENTRY_KINDS.sentry;
      const s = new K.Class(this.events, this.world, this.texLib, { x: d.x, z: d.z, yaw: d.yaw });
      this.scene.add(s.mesh);
      this.deployed.push(s);
    }
  }
}
