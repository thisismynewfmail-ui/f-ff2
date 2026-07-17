import * as THREE from '../../lib/three.module.js';
import { local2world, mergeStatic } from './Buildings.js';
import { canonXform } from './Interiors.js';

/**
 * The Companion Cube — a findable Easter egg hidden in the Meridian Tower's
 * maintenance room, waiting under a faint pink glow.
 *
 * Built to the classic reference: pale chamfered corner blocks over a grey
 * recessed core, magenta seam lines in the edge grooves, and a circular plate
 * on every face carrying a pink heart. Interact to take it; it stows in the
 * satchel — and clicking it there sets it back down on the ground just ahead
 * of you (see dropAt, wired through the 'inventory:drop' event), where it can
 * be picked up again.
 *
 * Seating: the assembled mesh's lowest geometry (the 45°-rotated chamfer caps
 * on the bottom corners) reaches BELOW the group origin, so placing the
 * origin at floor height used to sink those corners into the floor. The
 * measured rest offset (bounding-box min) now lifts the cube so its lowest
 * point touches the surface exactly — indoors on the floor plate, outdoors on
 * the terrain.
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

/** Assemble the cube per the reference and collapse it to a few meshes. */
function buildCubeMesh() {
  const g = new THREE.Group();
  const S = 0.68; // cube side
  const pale = new THREE.MeshLambertMaterial({ color: 0xd6d8d0 });   // corner blocks
  const grey = new THREE.MeshLambertMaterial({ color: 0x969c9e });   // frame / plates
  const dark = new THREE.MeshLambertMaterial({ color: 0x5a6064 });   // recessed core
  const pink = new THREE.MeshLambertMaterial({ color: 0xd77fa5 });   // seam lines
  // Unlit, so the heart plates read clearly in the windowless room — as if
  // the cube carries its own faint light. It does.
  const heartMat = new THREE.MeshBasicMaterial({ map: heartTexture() });
  const cy = S / 2; // cube rests on the floor

  const core = new THREE.Mesh(new THREE.BoxGeometry(S * 0.94, S * 0.94, S * 0.94), dark);
  core.position.y = cy;
  g.add(core);

  // eight chamfered corner blocks — the outer corner is clipped by a small
  // 45°-rotated cap sunk INTO the block, so each corner reads bevelled
  // without breaking the silhouette
  const cs = S * 0.36;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), pale);
    block.position.set(sx * (S - cs) / 2, cy + sy * (S - cs) / 2, sz * (S - cs) / 2);
    g.add(block);
    const chamfer = new THREE.Mesh(new THREE.BoxGeometry(cs * 0.5, cs * 0.5, cs * 0.5), grey);
    chamfer.position.set(sx * S * 0.5, cy + sy * S * 0.5, sz * S * 0.5);
    chamfer.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    g.add(chamfer);
  }

  // magenta seam lines run the edge grooves between the corner blocks
  const el = S - 2 * cs + 0.02, et = 0.045;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.BoxGeometry(el, et, et), pink);
    ex.position.set(0, cy + su * S * 0.48, sv * S * 0.48);
    const ey = new THREE.Mesh(new THREE.BoxGeometry(et, el, et), pink);
    ey.position.set(su * S * 0.48, cy, sv * S * 0.48);
    const ez = new THREE.Mesh(new THREE.BoxGeometry(et, et, el), pink);
    ez.position.set(su * S * 0.48, cy + sv * S * 0.48, 0);
    g.add(ex, ey, ez);
  }

  // face plates: grey rim ring, heart disc, and four frame tabs to the edges
  const faces = [
    { n: [0, 1, 0], rotC: [0, 0, 0], rotH: [-Math.PI / 2, 0, 0] },
    { n: [1, 0, 0], rotC: [0, 0, Math.PI / 2], rotH: [0, Math.PI / 2, 0] },
    { n: [-1, 0, 0], rotC: [0, 0, Math.PI / 2], rotH: [0, -Math.PI / 2, 0] },
    { n: [0, 0, 1], rotC: [Math.PI / 2, 0, 0], rotH: [0, 0, 0] },
    { n: [0, 0, -1], rotC: [Math.PI / 2, 0, 0], rotH: [0, Math.PI, 0] },
  ];
  for (const f of faces) {
    const [nx, ny, nz] = f.n;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.26, S * 0.26, 0.05, 14), grey);
    rim.position.set(nx * S * 0.485, cy + ny * S * 0.485, nz * S * 0.485);
    rim.rotation.set(...f.rotC);
    g.add(rim);
    // the disc must clear the rim's outer face (0.485S + half its 0.05 height)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(S * 0.215, 14), heartMat);
    disc.position.set(nx * S * 0.535, cy + ny * S * 0.535, nz * S * 0.535);
    disc.rotation.set(...f.rotH);
    g.add(disc);
    // frame tabs from the plate toward each edge midpoint (the face cross)
    for (let t = 0; t < 4; t++) {
      const tab = new THREE.Mesh(new THREE.BoxGeometry(S * 0.13, 0.035, S * 0.2), grey);
      const a = t * Math.PI / 2 + Math.PI / 4;
      // build in +Y face space, then rotate into place with the rim's frame
      const holder = new THREE.Group();
      tab.position.set(Math.cos(a) * S * 0.35, 0, Math.sin(a) * S * 0.35);
      tab.rotation.y = -a;
      holder.add(tab);
      holder.position.copy(rim.position);
      holder.rotation.set(...f.rotC);
      g.add(holder);
    }
  }

  mergeStatic(g);
  return g;
}

/** Draw the heart plate: white disc, ringed edge, saturated pink heart. */
function heartTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2efe4';
  ctx.beginPath();
  ctx.arc(64, 64, 63, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#84898d'; // the plate's turned edge
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 59, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ee7fb1';
  ctx.beginPath();
  ctx.moveTo(64, 104);
  ctx.bezierCurveTo(24, 76, 16, 48, 36, 34);
  ctx.bezierCurveTo(52, 24, 64, 40, 64, 50);
  ctx.bezierCurveTo(64, 40, 76, 24, 92, 34);
  ctx.bezierCurveTo(112, 48, 104, 76, 64, 104);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
