import * as THREE from '../../lib/three.module.js';
import { local2world, mergeStatic } from './Buildings.js';
import { canonXform } from './Interiors.js';

/**
 * The Companion Cube — a findable Easter egg hidden in the Meridian Tower's
 * maintenance room, waiting under a faint pink glow.
 *
 * Built to the classic reference: pale corner blocks with clipped tips over a
 * grey recessed core, pale rails down every edge, magenta lines lying in the
 * grooves between them, and a pressure plate carrying a pink heart on all six
 * faces. Interact to take it; it stows in the satchel — and clicking it there
 * sets it back down on the ground just ahead of you (see dropAt, wired
 * through the 'inventory:drop' event), where it can be picked up again.
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

    // a soft pink pulse marks it out in the windowless back room
    this.light = new THREE.PointLight(0xffc2da, 3.6, 7);
    this.light.position.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
    world.group.add(this.light);

    this._colliderId = world.collision.addBoxCentered(
      this.pos.x, this.baseY + CUBE_SIZE / 2, this.pos.z, 0.34, 0.34, 0.34, 'prop');

    this._interactable = world.addInteractable({
      x: this.pos.x, z: this.pos.z, y: this.baseY, radius: 2.0,
      prompt: 'Take the Companion Cube [E]',
      enabled: () => !this.taken,
      onInteract: () => this._take(),
    });
  }

  _take() {
    if (this.taken) return;
    this.taken = true;
    this.world.group.remove(this.mesh);
    this.world.group.remove(this.light);
    this.world.collision.remove(this._colliderId);
    this.world.events.emit('pickup', { type: 'companionCube', amount: 1, label: 'Companion Cube' });
    this.world.events.emit('subtitle', { text: 'The cube is warm. It seems glad you came.' });
    this.world.events.emit('whisper', { intensity: 0.4 });
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
    this.light.position.set(x, this.pos.y + 1.1, z);
    this.world.group.add(this.light);
    this._colliderId = this.world.collision.addBoxCentered(
      x, this.baseY + CUBE_SIZE / 2, z, 0.34, 0.34, 0.34, 'prop');
    Object.assign(this._interactable, { x, y: this.baseY, z });
    this.world.events.emit('subtitle', { text: 'The cube settles by your feet. It will wait.' });
    return true;
  }

  update(dt, time) {
    if (this.taken || !this.light) return;
    if (this._falling) { // the short drop out of the satchel
      this._fallVy += DROP_GRAVITY * dt;
      this.pos.y -= this._fallVy * dt;
      const restY = this.baseY + this.restOffset;
      if (this.pos.y <= restY) { this.pos.y = restY; this._falling = false; }
      this.mesh.position.y = this.pos.y;
      this.light.position.y = this.pos.y + 1.1;
    }
    // a slow, heart-like double pulse
    this.light.intensity = 3.2 + Math.sin(time * 2.4) * 0.4 + Math.sin(time * 4.8) * 0.25;
  }
}

/**
 * Assemble the cube to the reference art and collapse it to a few meshes.
 *
 * The silhouette the reference gives you is not a cube with decals on it. It
 * is a frame: eight pale chamfered corner blocks, twelve pale rails running
 * the edges between them, and a dark recessed core showing through the gaps —
 * with a magenta line lying in every groove where the rails meet the corners.
 * Each of the six faces then carries a grey pressure plate, four tabs
 * bracing it out to the edge rails, and a pink heart in the middle.
 *
 * Building it that way rather than as painted-on detail is what makes it read
 * from any angle at PS1 resolution: the highlights are geometry, so they
 * survive being eight pixels across.
 */
function buildCubeMesh() {
  const g = new THREE.Group();
  const S = 0.68; // cube side
  const pale = new THREE.MeshLambertMaterial({ color: 0xdcded6 });   // corner blocks + rails
  const grey = new THREE.MeshLambertMaterial({ color: 0x8e9498 });   // plates, tabs, chamfers
  const dark = new THREE.MeshLambertMaterial({ color: 0x4c5256 });   // recessed core
  const pink = new THREE.MeshLambertMaterial({ color: 0xc85c8e });   // seam lines
  // Unlit, so the heart plates read clearly in the windowless room — as if
  // the cube carries its own faint light. It does.
  const heartMat = new THREE.MeshBasicMaterial({ map: heartTexture() });
  const cy = S / 2; // cube rests on the floor

  const core = new THREE.Mesh(new THREE.BoxGeometry(S * 0.9, S * 0.9, S * 0.9), dark);
  core.position.y = cy;
  g.add(core);

  // --- eight chamfered corner blocks. The outer corner is clipped by a small
  // 45°-rotated cap sunk INTO the block, so each corner reads bevelled
  // without breaking the silhouette.
  const cs = S * 0.34;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), pale);
    block.position.set(sx * (S - cs) / 2, cy + sy * (S - cs) / 2, sz * (S - cs) / 2);
    g.add(block);
    // the clipped corner tip, flush with the block's outer faces rather than
    // rotated out past them — a 45° cap would poke a grey wing out of every
    // corner and wreck the silhouette at any distance
    const tip = cs * 0.46;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(tip, tip, tip), grey);
    cap.position.set(sx * (S - tip) / 2, cy + sy * (S - tip) / 2, sz * (S - tip) / 2);
    g.add(cap);
  }

  // --- twelve edge rails between the corner blocks, set very slightly in from
  // the corner blocks' faces so a groove reads along every edge.
  const rl = S - 2 * cs;          // clear span between two corner blocks
  const rt = S * 0.3;             // rail cross-section
  const off = S / 2 - rt / 2 - 0.004;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.BoxGeometry(rl, rt, rt), pale);
    ex.position.set(0, cy + su * off, sv * off);
    const ey = new THREE.Mesh(new THREE.BoxGeometry(rt, rl, rt), pale);
    ey.position.set(su * off, cy, sv * off);
    const ez = new THREE.Mesh(new THREE.BoxGeometry(rt, rt, rl), pale);
    ez.position.set(su * off, cy + sv * off, 0);
    g.add(ex, ey, ez);
  }

  // --- the magenta line lying in each edge groove, just proud of the rails
  const et = S * 0.045, eo = S * 0.5 + 0.002;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.BoxGeometry(rl + et, et, et), pink);
    ex.position.set(0, cy + su * eo, sv * eo);
    const ey = new THREE.Mesh(new THREE.BoxGeometry(et, rl + et, et), pink);
    ey.position.set(su * eo, cy, sv * eo);
    const ez = new THREE.Mesh(new THREE.BoxGeometry(et, et, rl + et), pink);
    ez.position.set(su * eo, cy + sv * eo, 0);
    g.add(ex, ey, ez);
  }

  // --- face plates on ALL SIX faces: grey pressure plate, heart, four tabs
  // bracing out to the edge rails. The reference carries a heart on every
  // face, including the one it is standing on.
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
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.275, S * 0.29, 0.055, 16), grey);
    plate.position.set(nx * S * 0.48, cy + ny * S * 0.48, nz * S * 0.48);
    plate.rotation.set(...f.rotC);
    g.add(plate);
    // the disc has to clear the plate's OUTER face: the plate is centred at
    // 0.48S and is 0.055 thick, so anything below 0.53S is buried inside it
    const disc = new THREE.Mesh(new THREE.CircleGeometry(S * 0.225, 16), heartMat);
    disc.position.set(nx * S * 0.534, cy + ny * S * 0.534, nz * S * 0.534);
    disc.rotation.set(...f.rotH);
    g.add(disc);
    // four tabs from the plate out to the edge midpoints (the face cross)
    const holder = new THREE.Group();
    holder.position.copy(plate.position);
    holder.rotation.set(...f.rotC);
    for (let t = 0; t < 4; t++) {
      const a = t * Math.PI / 2;
      const tab = new THREE.Mesh(new THREE.BoxGeometry(S * 0.15, 0.04, S * 0.22), grey);
      tab.position.set(Math.cos(a) * S * 0.36, -0.008, Math.sin(a) * S * 0.36);
      tab.rotation.y = -a;
      holder.add(tab);
    }
    g.add(holder);
  }

  mergeStatic(g);
  return g;
}

/** Draw the heart plate: pale disc, turned edge, saturated pink heart. */
function heartTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#eceadf';
  ctx.beginPath();
  ctx.arc(64, 64, 63, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7d8286'; // the plate's turned edge
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e97cad';
  ctx.beginPath();
  ctx.moveTo(64, 103);
  ctx.bezierCurveTo(22, 74, 15, 45, 36, 31);
  ctx.bezierCurveTo(52, 21, 64, 38, 64, 49);
  ctx.bezierCurveTo(64, 38, 76, 21, 92, 31);
  ctx.bezierCurveTo(113, 45, 106, 74, 64, 103);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
