import * as THREE from '../../lib/three.module.js';
import { SHEET_LAYOUT } from './TextureConfig.js';

/**
 * Camera-facing sprite entity rendering (Doom-style cylindrical billboards).
 *
 * Each billboard is a plane with its pivot at the feet that yaws toward the
 * camera every frame. Sprite sheets are the 3x4 walk-cycle layout: the row
 * is chosen from the angle between the entity's facing and the camera
 * (front / left / right / back), and the column animates the walk cycle.
 *
 * Every billboard owns its 4-vertex geometry (UVs update per frame) and a
 * cloned material (per-entity fade/tint) but shares the GPU texture.
 */
export class SpriteBillboard {
  constructor(baseMaterial, height, aspect = 2 / 3) {
    this.height = height;
    this.width = height * aspect;
    const geo = new THREE.PlaneGeometry(this.width, this.height);
    geo.translate(0, this.height / 2, 0); // pivot at the feet
    this.material = baseMaterial.clone();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = true;
    // Generous bounds: the plane spins, so use a sphere around it.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), height);
    this._col = -1;
    this._row = -1;
    this.walkTime = 0;
    this.setCell(1, SHEET_LAYOUT.row.front);
  }

  setCell(col, row) {
    if (col === this._col && row === this._row) return;
    this._col = col;
    this._row = row;
    const { cols, rows } = SHEET_LAYOUT;
    const u0 = col / cols, u1 = (col + 1) / cols;
    // Row 0 is the top of the image; three.js v runs bottom-up.
    const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows;
    const uv = this.mesh.geometry.attributes.uv;
    // PlaneGeometry vertex order: TL, TR, BL, BR
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  }

  /**
   * Update orientation + sheet cell.
   * @param entityYaw which way the entity is facing (0 = +Z)
   * @param moving whether to run the walk cycle
   */
  update(dt, camPos, entityYaw, moving, walkFps = 6) {
    const m = this.mesh;
    const toCamYaw = Math.atan2(camPos.x - m.position.x, camPos.z - m.position.z);
    m.rotation.y = toCamYaw; // plane +Z normal turns to the camera

    let rel = entityYaw - toCamYaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const R = SHEET_LAYOUT.row;
    let row;
    const a = Math.abs(rel);
    if (a < Math.PI / 4) row = R.front;        // facing the viewer
    else if (a > 3 * Math.PI / 4) row = R.back;
    else row = rel > 0 ? R.right : R.left;

    let col = 1; // standing frame
    if (moving) {
      this.walkTime += dt * walkFps;
      const seq = SHEET_LAYOUT.walkFrames;
      col = seq[Math.floor(this.walkTime) % seq.length];
    }
    this.setCell(col, row);
  }

  /**
   * Graphic death dissolve (t: 0..1). Three layered reads:
   *  - collapse: tip backward with a squash-and-stretch impact pop,
   *  - digital glitch (front-loaded): positional jitter + a hot colour flash
   *    + a fast scanline opacity flicker, decaying over the first half,
   *  - dissolve: fade to nothing across the whole span.
   */
  deathPose(t) {
    const m = this.mesh, mat = this.material;
    mat.transparent = true;
    if (this._deathBase === undefined) this._deathBase = { x: m.position.x, y: m.position.y };
    const b = this._deathBase;

    // collapse
    m.rotation.x = Math.min(Math.PI * 0.5, t * t * Math.PI * 0.6);
    const pop = 1 + Math.sin(Math.min(1, t * 3) * Math.PI) * 0.3;
    m.scale.set(pop, Math.max(0.25, 1 - t * 0.4), 1);

    // digital glitch, strongest at the instant of death
    const glitch = Math.max(0, 1 - t * 2); // 1 -> 0 by t = 0.5
    m.position.x = b.x + (Math.random() - 0.5) * 0.22 * glitch;
    m.position.y = b.y + (Math.random() - 0.5) * 0.12 * glitch;
    const flick = 1 - (Math.random() < 0.3 ? 0.55 : 0) * glitch;

    // hot flash (white -> red) cooling as it dissolves
    mat.color.setRGB(1, 1 - t * 0.6, 1 - t * 0.85);

    const fade = 1 - Math.max(0, (t - 0.1) / 0.9);
    mat.opacity = Math.max(0, fade * flick);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Shared base material for a sprite-sheet texture. */
export function makeSpriteMaterial(texture) {
  return new THREE.MeshLambertMaterial({
    map: texture,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
}

/**
 * Simple full-facing billboard for pickups/effects (whole texture, always
 * turns to the camera, bobs gently).
 */
export class ItemBillboard {
  constructor(texture, size, tintColor = null) {
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.3,
      ...(tintColor ? { color: tintColor } : {}),
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    this.baseY = 0;
    this.phase = Math.random() * Math.PI * 2;
  }

  update(time, camPos) {
    const m = this.mesh;
    m.position.y = this.baseY + Math.sin(time * 2.2 + this.phase) * 0.12;
    m.rotation.y = Math.atan2(camPos.x - m.position.x, camPos.z - m.position.z);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
