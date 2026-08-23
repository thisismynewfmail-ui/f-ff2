import * as THREE from '../../lib/three.module.js';
import { local2world, mergeStatic } from './Buildings.js';
import { canonXform } from './Interiors.js';

/**
 * The Friend Box — a findable Easter egg hidden in the Meridian Tower's
 * maintenance room, lit by nothing but whatever reaches the back of the
 * lobby. It casts no light of its own; you find it by looking.
 *
 * Built to the classic reference as a machined shell: chamfered pale corner
 * blocks and edge rails standing proud of a recessed grey body, a magenta
 * seam lying in the notch between every rail and corner, and a steel
 * pressure plate carrying a pink heart on all six faces. Interact to take
 * it; it stows in the satchel — and clicking it there sets it back down on
 * the ground just ahead of you (see dropAt, wired through the
 * 'inventory:drop' event), where it can be picked up again.
 *
 * Seating: the assembled mesh is measured rather than assumed. Its rest
 * offset comes from the bounding box, so however the frame is built, the
 * cube's lowest point touches the surface exactly — indoors on the floor
 * plate, outdoors on the terrain — instead of hovering or sinking into it.
 */
const CUBE_SIZE = 0.68;
const FLOOR_PLATE_TOP = 0.11; // interior floor: 0.1 slab centred at y 0.06
const DROP_GRAVITY = 16;

export class CompanionCube {
  constructor(world) {
    this.world = world;
    this.taken = false;
    this.found = false;       // has the player ever had their hands on it
    this._fallVy = 0;
    this._falling = false;
    const b = world.built.get('meridianTower');
    if (!b) return;
    const s = b.spec;
    const c = canonXform(s.w, s.d, s.door || 'S');
    const [mx, mz] = c.m(-c.cw / 2 + 1.7, -c.cd / 2 + 1.4); // maintenance-room corner
    const p = local2world(s, s.rot || 0, mx, mz);

    this.mesh = buildCubeMesh();
    // How far the lowest geometry hangs below the group origin — the lift
    // needed for the cube to rest ON a surface instead of sinking into it.
    this.restOffset = -new THREE.Box3().setFromObject(this.mesh).min.y;
    this.baseY = s.y + FLOOR_PLATE_TOP; // the surface it stands on
    this.pos = { x: p.x, y: this.baseY + this.restOffset, z: p.z };
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = 0.5;
    world.group.add(this.mesh);

    // 'furniture', not 'prop': it lives inside the tower on purpose, and the
    // placement audit treats a 'prop' inside a building as a mistake.
    this._colliderId = world.collision.addBoxCentered(
      this.pos.x, this.baseY + CUBE_SIZE / 2, this.pos.z, 0.34, 0.34, 0.34, 'furniture');

    this._interactable = world.addInteractable({
      x: this.pos.x, z: this.pos.z, y: this.baseY, radius: 2.0,
      prompt: 'Take the Friend Box [E]',
      enabled: () => !this.taken,
      onInteract: () => this._take(),
    });
  }

  _take() {
    if (this.taken) return;
    this.found = true;
    this._stow();
    this.world.events.emit('pickup', { type: 'companionCube', amount: 1, label: 'Friend Box' });
    this.world.events.emit('subtitle', { text: 'The box is warm. It seems glad you came.' });
    this.world.events.emit('whisper', { intensity: 0.4 });
  }

  /** Off the ground and out of the collision set. */
  _stow() {
    this.taken = true;
    this._falling = false;
    this.world.group.remove(this.mesh);
    this.world.collision.remove(this._colliderId);
  }

  /**
   * Take it back without walking to it — what a death does.
   *
   * Only ever from somewhere the PLAYER put it down: `found` is what separates
   * a cube set down in the street from one still sitting in the dark of the
   * maintenance room, which is nobody's until it has been found once.
   *
   * The count is STATED rather than added to, the way the satchel's other
   * owning systems state theirs (see Inventory's 'inventory:sync'). There is
   * exactly one of this thing in the world, so the only honest number a
   * recall can report is one, whatever the satchel believed a moment ago.
   */
  recall() {
    if (this.taken || !this.found || !this.mesh) return false;
    this._stow();
    this.world.events.emit('inventory:sync', {
      type: 'companionCube', label: 'Friend Box', count: 1,
    });
    return true;
  }

  /**
   * Set the cube back down from the satchel: it reappears at (x, z), falls a
   * short arc, and settles resting on the ground there. `refY` anchors the
   * ground query to the dropper's elevation so an upstairs drop lands on that
   * floor, not the roof or the street below.
   */
  dropAt(x, z, refY = 1e9) {
    if (!this.taken || !this.mesh) return false;
    this.taken = false;
    this.baseY = this.world.groundHeightFor(x, z, refY + 0.5);
    this.pos = { x, y: this.baseY + this.restOffset + 0.9, z }; // a hand-height drop
    this._falling = true;
    this._fallVy = 0;
    this.mesh.position.set(x, this.pos.y, z);
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    this.world.group.add(this.mesh);
    this._colliderId = this.world.collision.addBoxCentered(
      x, this.baseY + CUBE_SIZE / 2, z, 0.34, 0.34, 0.34, 'furniture');
    Object.assign(this._interactable, { x, y: this.baseY, z });
    this.world.events.emit('subtitle', { text: 'The box settles by your feet. It will wait.' });
    return true;
  }

  update(dt) {
    if (this.taken || !this.mesh || !this._falling) return;
    // the short drop out of the satchel
    this._fallVy += DROP_GRAVITY * dt;
    this.pos.y -= this._fallVy * dt;
    const restY = this.baseY + this.restOffset;
    if (this.pos.y <= restY) { this.pos.y = restY; this._falling = false; }
    this.mesh.position.y = this.pos.y;
  }
}

/**
 * Assemble the cube to the reference art and collapse it to a few meshes.
 *
 * The reference is not a cube with decals on it, and it is not a cube with
 * detail sitting flush on its faces either — it is a machined shell. A dark
 * body is recessed on all six sides, and a pale frame stands PROUD of it:
 * eight corner blocks with their outer tips clipped off, and twelve rails
 * running the edges between them. The gap where a rail stops short of a
 * corner block is a real notch cut through the frame, and a magenta line
 * lies in every one of them. Each face then carries a steel pressure plate
 * sunk into the recess, four tabs bracing it out to the rails, and a pink
 * heart in the middle.
 *
 * The relief is the whole point. Every highlight and shadow on this thing is
 * geometry standing at a different depth, which is what lets it read from any
 * angle at PS1 resolution — a painted-on version goes flat the moment the
 * face turns away from the light.
 *
 * Nothing pokes out past the cube's own faces: the frame defines the
 * silhouette, so the collision box and the 0.68 side agree with what you see.
 */
function buildCubeMesh() {
  const g = new THREE.Group();
  const S = CUBE_SIZE;      // cube side
  const h = S / 2;          // half side: where the outer surfaces sit
  const P = S * 0.055;      // how far the pale frame stands proud of the body
  const C = S * 0.285;      // corner block: a cube of this side
  const B = C * 0.15;       // chamfer machined off each corner block's outer edges
  const T = S * 0.165;      // edge rail cross-section
  const G = S * 0.021;      // notch between a corner block and an edge rail
  const cy = S / 2;         // the cube rests on the floor, so centre it a half-side up

  const pale = new THREE.MeshLambertMaterial({ color: 0xf2f0e7 });  // corner blocks + rails
  const body = new THREE.MeshLambertMaterial({ color: 0x868d92 });  // the recessed body
  const steel = new THREE.MeshLambertMaterial({ color: 0x9aa1a6 }); // pressure plates + tabs
  const seam = new THREE.MeshLambertMaterial({ color: 0xa8447a });  // the magenta groove lines
  // A trace of emissive is a floor under the hearts, not a glow: the cube
  // throws no light of its own, and the room it waits in has little, so
  // without this the plates crush to black. It still shades with the world,
  // so it never lifts into a flat white sticker either.
  const heartMat = new THREE.MeshLambertMaterial({ map: heartTexture(), emissive: 0x1a1d20 });

  // --- the recessed body every other part is bolted to
  const core = new THREE.Mesh(new THREE.BoxGeometry(S - 2 * P, S - 2 * P, S - 2 * P), body);
  core.position.y = cy;
  g.add(core);

  // --- eight corner blocks, chamfered down every edge that shows
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const block = new THREE.Mesh(clippedCornerGeometry(C, B, sx, sy, sz), pale);
    block.position.set(sx * (h - C / 2), cy + sy * (h - C / 2), sz * (h - C / 2));
    g.add(block);
  }

  // --- twelve edge rails, flush with the corner blocks but only a third as
  // thick, so face-on they read as a bar down each side rather than a border.
  // Chamfered to the same width, so the frame is machined out of one piece.
  //
  // Each rail stops short of the corner blocks, and the notch left over is
  // filled by the magenta seam — cut to the identical profile, so the line
  // lies IN the frame and wraps the cube edge instead of sitting on top of it.
  const rl = S - 2 * C - 2 * G;   // clear span, leaving a notch at either end
  const ro = h - T / 2;           // rail centre: its outer faces land on the surface
  const so = h - C;               // along the edge: where the corner block ends
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    for (let axis = 0; axis < 3; axis++) {
      // (u, v) are the two axes across the bar, taken in cyclic order after it
      const at = (w, u, v) => [[w, u, v], [v, w, u], [u, v, w]][axis];
      const rail = new THREE.Mesh(beveledBarGeometry(rl, T, B, axis, su, sv), pale);
      rail.position.set(...at(0, su * ro, sv * ro));
      rail.position.y += cy;
      g.add(rail);
      for (const sw of [-1, 1]) {
        const line = new THREE.Mesh(beveledBarGeometry(G, T, B, axis, su, sv), seam);
        line.position.set(...at(sw * (so - G / 2), su * ro, sv * ro));
        line.position.y += cy;
        g.add(line);
      }
    }
  }

  // --- the pressure plate on ALL SIX faces: a steel disc seated in the
  // recess with four tabs bracing it out to the rails, and the heart on top.
  // The reference carries one on every face, including the one it stands on.
  const pr = S * 0.28;            // plate radius, kept just clear of the corner blocks
  const seat = h - P;             // the recessed surface the plate sits in
  const faces = [
    { n: [0, 1, 0], rotC: [0, 0, 0], rotH: [-Math.PI / 2, 0, 0] },
    { n: [0, -1, 0], rotC: [0, 0, Math.PI], rotH: [Math.PI / 2, 0, 0] },
    { n: [1, 0, 0], rotC: [0, 0, -Math.PI / 2], rotH: [0, Math.PI / 2, 0] },
    { n: [-1, 0, 0], rotC: [0, 0, Math.PI / 2], rotH: [0, -Math.PI / 2, 0] },
    { n: [0, 0, 1], rotC: [Math.PI / 2, 0, 0], rotH: [0, 0, 0] },
    { n: [0, 0, -1], rotC: [-Math.PI / 2, 0, 0], rotH: [0, Math.PI, 0] },
  ];
  for (const f of faces) {
    const [nx, ny, nz] = f.n;
    // The plate stands almost out of the recess but stays under the frame,
    // so the pale blocks always shoulder above it.
    const top = h - P * 0.2, deep = P * 1.1;
    const at = (d) => [nx * d, cy + ny * d, nz * d];

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr * 1.06, deep, 20), steel);
    plate.position.set(...at(top - deep / 2));
    plate.rotation.set(...f.rotC);
    g.add(plate);

    // the heart disc, a hair clear of the plate's outer face
    const disc = new THREE.Mesh(new THREE.CircleGeometry(pr * 0.97, 24), heartMat);
    disc.position.set(...at(top + 0.0015));
    disc.rotation.set(...f.rotH);
    g.add(disc);

    // four tabs bridging the plate out to the edge rails (the face cross)
    const holder = new THREE.Group();
    holder.position.set(...at(seat));
    holder.rotation.set(...f.rotC);
    for (let t = 0; t < 4; t++) {
      const a = t * Math.PI / 2;
      const tab = new THREE.Mesh(new THREE.BoxGeometry(S * 0.16, P * 0.75, S * 0.135), steel);
      tab.position.set(Math.cos(a) * S * 0.33, P * 0.375, Math.sin(a) * S * 0.33);
      tab.rotation.y = -a;
      holder.add(tab);
    }
    g.add(holder);
  }

  mergeStatic(g);
  return g;
}

/**
 * One frame bar: a length of pale rail running along a cube edge, chamfered
 * `r` wide down the three corners of its cross-section that show. The fourth
 * points into the body and is left square — nothing ever sees it.
 *
 * `axis` picks the direction the bar runs (0 = x, 1 = y, 2 = z) and (su, sv)
 * which quadrant of the other two axes — taken in cyclic order after it — its
 * outer corner faces. Same construction as the corner blocks: written for one
 * quadrant and mirrored, re-ordering the triangles when the mirror is odd so
 * back-face culling does not turn the bar inside out.
 */
function beveledBarGeometry(len, t, r, axis, su, sv) {
  const a = t / 2, l = len / 2;
  // the cross-section, counter-clockwise, with its outer corner at (+a, +a)
  const sec = [[-a, -a], [a - r, -a], [a, -a + r], [a, a - r], [a - r, a], [-a + r, a], [-a, a - r]]
    .map(([u, v]) => [su * u, sv * v]);
  const put = (w, [u, v]) => [[w, u, v], [v, w, u], [u, v, w]][axis];
  const tris = [];
  const fan = (pts) => { for (let i = 1; i < pts.length - 1; i++) tris.push(pts[0], pts[i], pts[i + 1]); };

  fan(sec.map((p) => put(l, p)));                        // the two ends, which
  fan(sec.slice().reverse().map((p) => put(-l, p)));     // butt onto neighbours
  for (let i = 0; i < sec.length; i++) {                 // and the faces between
    const p = sec[i], q = sec[(i + 1) % sec.length];
    fan([put(-l, p), put(-l, q), put(l, q), put(l, p)]);
  }
  return bakeFlat(tris, su * sv < 0);
}

/**
 * One corner block: a cube of side `c` machined down by a chamfer `b` wide —
 * the three outer edges bevelled and the tip they meet at clipped by a facet
 * across all three. That is what the reference's corners actually are, and
 * it is why they catch a different shade from every direction instead of
 * reading as a plain box with a slice off the end.
 *
 * Built in the +++ octant with the tip pointing at (+,+,+), then mirrored into
 * whichever corner (sx, sy, sz) names. Mirroring an odd number of axes reverses
 * triangle winding, which would turn the block inside out under back-face
 * culling, so the triangles are re-ordered whenever that happens.
 *
 * Only the x/y pairing is written out; the other two are the same points cycled
 * through the axes. A cyclic axis swap is a rotation, so the winding survives it.
 */
function clippedCornerGeometry(c, b, sx, sy, sz) {
  const p = c - b;          // where an edge bevel meets the outer face beside it
  const q = c - 1.4 * b;    // where the tip facet cuts across an edge bevel
  const tris = [];
  const fan = (pts) => { for (let i = 1; i < pts.length - 1; i++) tris.push(pts[0], pts[i], pts[i + 1]); };
  const spin = (pts, n) => { let o = pts; for (let i = 0; i < n; i++) o = o.map(([x, y, z]) => [z, x, y]); return o; };

  fan([[0, 0, 0], [0, 0, c], [0, c, c], [0, c, 0]]);  // the three inner faces,
  fan([[0, 0, 0], [c, 0, 0], [c, 0, c], [0, 0, c]]);  // buried in the body and
  fan([[0, 0, 0], [0, c, 0], [c, c, 0], [c, 0, 0]]);  // never seen
  for (let i = 0; i < 3; i++) {
    // an outer face — a square that two edge bevels and the tip facet trim
    fan(spin([[c, 0, 0], [c, p, 0], [c, p, q], [c, q, p], [c, 0, p]], i));
    // the bevel down the edge this face shares with the next one round
    fan(spin([[c, p, 0], [p, c, 0], [p, c, q], [c, p, q]], i));
  }
  fan([[c, p, q], [p, c, q], [q, c, p], [q, p, c], [p, q, c], [c, q, p]]); // the tip

  const m = tris.map(([x, y, z]) => [(x - c / 2) * sx, (y - c / 2) * sy, (z - c / 2) * sz]);
  return bakeFlat(m, sx * sy * sz < 0);
}

/**
 * Turn a flat list of triangle corners into geometry, reversing the winding
 * first when the caller mirrored an odd number of axes to get there.
 *
 * Normals are left to computeVertexNormals: the list is non-indexed, so it
 * derives one flat normal per triangle — exactly the hard-edged shading these
 * machined facets want, and no vertex is shared across a chamfer.
 */
function bakeFlat(tris, flipped) {
  if (flipped) for (let i = 0; i < tris.length; i += 3) { const t = tris[i]; tris[i] = tris[i + 1]; tris[i + 1] = t; }
  const pos = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) pos.set(tris[i], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Draw the pressure plate: a steel rim turned down to a lighter shoulder, a
 * pale disc inset in it, and the pink heart printed on that. The heart is
 * deliberately small against the disc — the reference reads as a badge with
 * room around it, not a heart crammed to the rim.
 */
function heartTexture() {
  const R = 128, c = document.createElement('canvas');
  c.width = c.height = R * 2;
  const ctx = c.getContext('2d');
  const ring = (r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(R, R, r, 0, Math.PI * 2); ctx.fill(); };
  ring(R, '#5f666b');            // the rim's shadowed outer edge
  ring(R * 0.95, '#98a0a5');     // the machined face of the rim
  ring(R * 0.72, '#c8cbc5');     // the step down into the disc
  ring(R * 0.68, '#ece9df');     // the pale disc the heart is printed on

  const hw = R * 0.43, hh = R * 0.39, cx = R, cyc = R + R * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx, cyc + hh * 0.98);
  ctx.bezierCurveTo(cx - hw * 1.06, cyc + hh * 0.10, cx - hw * 1.00, cyc - hh * 0.78, cx - hw * 0.42, cyc - hh * 0.78);
  ctx.bezierCurveTo(cx - hw * 0.13, cyc - hh * 0.78, cx, cyc - hh * 0.42, cx, cyc - hh * 0.20);
  ctx.bezierCurveTo(cx, cyc - hh * 0.42, cx + hw * 0.13, cyc - hh * 0.78, cx + hw * 0.42, cyc - hh * 0.78);
  ctx.bezierCurveTo(cx + hw * 1.00, cyc - hh * 0.78, cx + hw * 1.06, cyc + hh * 0.10, cx, cyc + hh * 0.98);
  ctx.fillStyle = '#f7a8cb';
  ctx.fill();
  ctx.strokeStyle = '#e79cbb'; // a printed edge, so the heart holds its shape
  ctx.lineWidth = R * 0.03;
  ctx.stroke();

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
