import * as THREE from '../../lib/three.module.js';

/**
 * THE THING THAT CAME DOWN.
 *
 * Fifteen seconds into wave five, a saucer crosses the sky from the south,
 * passes over the trading post on the Eastgate knoll trailing smoke, loses
 * whatever it was still holding on to somewhere over the north edge of town,
 * and goes into the field at (62, −214) — which is where the WRECK ALREADY IS
 * (see world/Scarecrow.js). Nothing about the world changes when it lands: the
 * crash site was built at load like every other piece of the map. This is the
 * teaser for it, and it is deliberately staged to be missable.
 *
 * WHY THE PATH IS SHAPED LIKE THAT. Three fixed points had to be honoured at
 * once and they do not lie on a straight line:
 *
 *   1. it has to cross the district the player is standing in at wave five —
 *      the plaza and the Eastgate gate — or nobody ever sees it;
 *   2. it has to pass over the vendor's knoll, which is the landmark that
 *      makes the sighting locatable ("it went over the trading post");
 *   3. it has to arrive at the wreck ALONG THE WRECK'S OWN BEARING, because
 *      the scar, the trench and the spoil banks out there were all struck
 *      about that bearing and a craft arriving across them would be arriving
 *      down somebody else's furrow.
 *
 * So it comes in due north over the post, and then it stops flying: it drifts
 * east, drops, and curls back into the ground on the trench line. That is not
 * a compromise between the three, it is what a machine that has lost control
 * actually does, and it is why the last two seconds read as a crash rather
 * than as a landing.
 *
 * The distance fog (160 m) does the rest of the staging for free. It fades in
 * out of the haze to the south, is clearly readable overhead, and is gone into
 * the haze to the north well before it touches down — so what the player gets
 * is a sighting and a bearing, not a cutscene. The bang arrives afterwards,
 * late, by however long sound takes to cross the ground between them.
 */

/** Where it goes in. Must match Scarecrow's CRASH + ENTRY. */
const CRASH = { x: 62, z: -214 };
const ENTRY = 0.62;

/** Waypoints: [x, y (above local ground), z]. See the note above. */
const PATH = [
  [56, 112, 168],     // out of the haze, south of the industrial flats
  [58, 94, 96],
  [62, 54, -19],      // over the trading post — the landmark of the sighting
  [72, 46, -70],
  [88, 30, -126],     // drifting east now, and dropping fast
  [CRASH.x + Math.sin(ENTRY) * 58, 16, CRASH.z + Math.cos(ENTRY) * 58],
  [CRASH.x, 0, CRASH.z],
];
const DURATION = 12.5;     // seconds, entry to impact
const TRAIL_EVERY = 0.055; // seconds between smoke puffs

export class Flyby {
  constructor(world) {
    this.world = world;
    this.events = world.events;
    this.active = false;
    this.t = 0;
    this._trail = 0;
    this._armed = -1;        // >0: seconds until it enters
    this._done = false;
    this.node = null;

    this.curve = new THREE.CatmullRomCurve3(
      PATH.map(([x, y, z]) => new THREE.Vector3(x, world.terrain.heightAt(x, z) + y, z)),
      false, 'catmullrom', 0.5);

    this.events.on('wave:start', ({ wave }) => {
      if (wave === 5 && !this._done) this._armed = 15;
    });
  }

  /* ---------------- the craft ---------------- */

  _build() {
    const g = new THREE.Group();
    const alloy = new THREE.MeshLambertMaterial({ color: 0x9aa4aa });
    const trim = new THREE.MeshLambertMaterial({ color: 0x545d63 });
    const burnt = new THREE.MeshLambertMaterial({ color: 0x3a3c3a });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0a0e12 });
    // It is the SAME craft as the wreck, so it is built to the same drawing:
    // a 5 m lens with a rim, a dome, a dark canopy and a ring of ports.
    const disc = new THREE.Mesh(new THREE.SphereGeometry(2.5, 18, 9), alloy);
    disc.scale.set(1, 0.24, 1);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.46, 0.14, 6, 20), trim);
    rim.rotation.x = Math.PI / 2;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), alloy);
    dome.position.y = 0.36;
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), dark);
    canopy.position.y = 0.5;
    g.add(disc, rim, dome, canopy);
    for (const [sr, sy] of [[2.05, 0.16], [1.6, 0.25]]) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(sr, 0.035, 5, 18), trim);
      seam.rotation.x = Math.PI / 2;
      seam.position.y = sy;
      g.add(seam);
    }
    // the damage it is already carrying — this is the flank the tear is on
    const gash = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.44), burnt);
    gash.position.set(1.5, 0.04, 1.35);
    gash.rotation.y = -0.7;
    g.add(gash);

    // The one thing that moves: a lit ring under the rim, spun and pulsed.
    // It is what makes the shape READ at four hundred metres in daylight —
    // an unlit grey lens against a pale sky is a smudge.
    // `fog: false` on purpose, and it is the whole reason the sighting works.
    // The town's distance fog is the SKY COLOUR, so anything more than about a
    // hundred metres up is being painted the colour of the thing behind it —
    // a grey lens against a pale sky, fading as it climbs. The lit ring is
    // exempt from that, so what you actually see first is a light moving, and
    // the shape resolves out of the haze underneath it as it comes on.
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x8fe4ff, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    // BELOW the lens, not inside it: the hull is a squashed sphere spanning
    // ±0.6, so a ring at −0.16 was buried in the very geometry it was there to
    // outline and the craft read as a grey pebble.
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.6, 24), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.66;
    ring.renderOrder = 3;
    g.add(ring);
    this.ring = ring;
    // ...and the glow the ring throws on the underside of its own hull
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x4fb8e0, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 18), this.glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = -0.5;
    glow.renderOrder = 2;
    g.add(glow);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 6), dark);
      port.position.set(Math.sin(a) * 2.3, 0.1, Math.cos(a) * 2.3);
      g.add(port);
    }
    this.light = new THREE.PointLight(0x7ad6ff, 0, 34);
    g.add(this.light);
    // Half again the size of the wreck's five metres. It is the same craft —
    // but the wreck is something you walk up to and this is something a
    // hundred metres over your head, and at that range the honest size is a
    // fifty-pixel smudge nobody looks twice at.
    g.scale.setScalar(1.4);
    this.node = g;
    this.world.group.add(g);
  }

  /* ---------------- the flight ---------------- */

  update(dt) {
    if (this._armed > 0) {
      this._armed -= dt;
      if (this._armed <= 0) this._start();
      return;
    }
    if (!this.active) return;
    this.t += dt;
    const k = Math.min(1, this.t / DURATION);
    // Nearly linear, with a lean on the end: it is already falling when it
    // comes into view and it is going fastest at the moment it stops flying.
    // A heavier ease-in was tried and it spent most of the twelve seconds out
    // past the fog wall, which is twelve seconds of nothing to look at.
    const s = k * (0.72 + 0.28 * k);
    const p = this.curve.getPointAt(Math.min(0.999, s));
    const ahead = this.curve.getPointAt(Math.min(0.9999, s + 0.004));
    const vel = ahead.clone().sub(p).multiplyScalar(1 / Math.max(1e-3, dt));

    const n = this.node;
    n.position.copy(p);
    // Attitude: it is banked over, nose down along its own track, and yawing
    // slowly the whole way in. A saucer that stays level is a saucer flying.
    const heading = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    const pitch = Math.atan2(p.y - ahead.y, Math.hypot(ahead.x - p.x, ahead.z - p.z));
    n.rotation.set(0, 0, 0);
    n.rotateY(heading);
    n.rotateX(-pitch * 0.8);
    n.rotateZ(0.35 + Math.sin(this.t * 1.7) * 0.22 + k * 0.9);
    this.ring.rotation.z += dt * (3.2 + k * 9);
    // the drive failing: the ring gutters harder the closer it gets
    const gutter = 0.35 + 0.65 * Math.abs(Math.sin(this.t * (3 + k * 14)));
    this.ringMat.opacity = (0.9 - k * 0.4) * gutter;
    this.glowMat.opacity = (0.5 - k * 0.25) * gutter;
    this.light.intensity = (10 - k * 6) * gutter;

    // Trail: smoke off the gash, and sparks once it is properly coming apart.
    this._trail -= dt;
    if (this._trail <= 0) {
      this._trail = TRAIL_EVERY;
      this.events.emit('ufo:trail', { pos: { x: p.x, y: p.y, z: p.z }, k });
    }
    this.events.emit('ufo:track', {
      pos: { x: p.x, y: p.y, z: p.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      k,
    });

    if (k >= 1) this._impact(p);
  }

  _start() {
    this._armed = -1;
    this.active = true;
    this._done = true;
    this.t = 0;
    if (!this.node) this._build();
    this.node.visible = true;
    this.events.emit('ufo:enter', {});
  }

  _impact(p) {
    this.active = false;
    this.node.visible = false;
    const pos = { x: CRASH.x, y: this.world.terrain.heightAt(CRASH.x, CRASH.z), z: CRASH.z };
    this.events.emit('ufo:exit', {});
    this.events.emit('ufo:impact', { pos });
    void p;
  }

  /** A new run has not seen it yet. */
  reset() {
    this._done = false;
    this._armed = -1;
    this.active = false;
    if (this.node) this.node.visible = false;
  }
}
