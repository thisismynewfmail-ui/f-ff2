import * as THREE from '../../lib/three.module.js';

/**
 * Trees, bushes, grass tufts and wall vines.
 *
 * Static geometry only — foliage is built from crossed quads (classic retro
 * technique), never camera-facing billboards. Canopies and bushes sway on
 * the CPU: each registered swayer's pivot sits at its attachment point, so a
 * small rotation reads as wind bend. Only swayers near the camera animate.
 */
export class Vegetation {
  constructor(texLib, collision, nav, terrain) {
    this.texLib = texLib;
    this.collision = collision;
    this.nav = nav;
    this.terrain = terrain;
    this.swayers = []; // {node, phase, amp, speed, base}
    this.leavesMat = this._cutout('leaves');
    this.bushMat = this._cutout('bush');
    this.tuftMat = this._cutout('grassTuft');
    this.vineMat = this._cutout('vine');
    this.barkMat = new THREE.MeshLambertMaterial({ map: texLib.get('bark') });
  }

  _cutout(tex) {
    return new THREE.MeshLambertMaterial({
      map: this.texLib.get(tex),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
  }

  /** Crossed pair of quads with pivot at the bottom center. */
  _cross(mat, w, h) {
    const g = new THREE.Group();
    for (const rot of [0, Math.PI / 2]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      q.position.y = h / 2;
      q.rotation.y = rot;
      g.add(q);
    }
    return g;
  }

  tree(parent, x, z, scale = 1) {
    const y = this.terrain.heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y - 0.1, z);
    const trunkH = 2.6 * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.26 * scale, trunkH, 6), this.barkMat);
    trunk.position.y = trunkH / 2;
    g.add(trunk);
    // The leaves texture is transparent across its lower ~17%, so the opaque
    // canopy mass begins well above the quad's base. Seat the canopy low enough
    // that that mass swallows the top of the trunk instead of floating above it
    // with a see-through gap. (Quad grows up from its pivot; the leaf mass base
    // sits at position.y + ~0.17 * canopyH.)
    const canopy = this._cross(this.leavesMat, 3.6 * scale, 3.9 * scale);
    canopy.position.y = trunkH * 0.60;
    g.add(canopy);
    parent.add(g);
    this.swayers.push({ node: canopy, phase: x * 0.7 + z * 1.3, amp: 0.035, speed: 0.9, axis: 'z' });
    this.collision.addBoxCentered(x, y + 1, z, 0.3 * scale, 1.4, 0.3 * scale, 'tree');
    this.nav.blockBox(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
    return g;
  }

  bush(parent, x, z, scale = 1) {
    const y = this.terrain.heightAt(x, z);
    const b = this._cross(this.bushMat, 1.5 * scale, 1.2 * scale);
    b.position.set(x, y - 0.05, z);
    parent.add(b);
    this.swayers.push({ node: b, phase: x * 1.1 + z, amp: 0.02, speed: 1.4, axis: 'z' });
    return b;
  }

  /**
   * Many grass tufts merged into a single static mesh (one draw call).
   * points: array of [x, z].
   */
  tuftField(parent, points) {
    const pos = [];
    const uv = [];
    const idx = [];
    const W = 0.9, H = 0.7;
    let base = 0;
    for (const [x, z] of points) {
      const y = this.terrain.heightAt(x, z) - 0.03;
      const rot = (x * 13 + z * 7) % 3;
      for (const a of [rot, rot + Math.PI / 2]) {
        const dx = Math.cos(a) * W / 2, dz = Math.sin(a) * W / 2;
        pos.push(x - dx, y, z - dz, x + dx, y, z + dz, x + dx, y + H, z + dz, x - dx, y + H, z - dz);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.tuftMat);
    parent.add(mesh);
    return mesh;
  }

  tuft(parent, x, z) {
    const y = this.terrain.heightAt(x, z);
    const t = this._cross(this.tuftMat, 0.9, 0.7);
    t.position.set(x, y - 0.03, z);
    t.rotation.y = (x * 13 + z * 7) % 3;
    parent.add(t);
    return t;
  }

  /** Vine strip on a wall face. yaw = wall outward normal direction. */
  vine(parent, x, y, z, yaw, h = 3) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1.2, h), this.vineMat);
    q.position.set(x, y + h / 2, z);
    q.rotation.y = yaw;
    parent.add(q);
    this.swayers.push({ node: q, phase: x + z, amp: 0.008, speed: 1.1, axis: 'y' });
    return q;
  }

  update(time, cameraPos) {
    for (const s of this.swayers) {
      const n = s.node;
      const dx = n.position.x + (n.parent?.position.x || 0) - cameraPos.x;
      const dz = n.position.z + (n.parent?.position.z || 0) - cameraPos.z;
      if (dx * dx + dz * dz > 6400) continue; // only animate within 80 m
      const angle = Math.sin(time * s.speed + s.phase) * s.amp + Math.sin(time * s.speed * 2.7 + s.phase) * s.amp * 0.3;
      if (s.axis === 'z') n.rotation.z = angle; else n.rotation.y += 0; // vines shimmer via x
      if (s.axis === 'y') n.rotation.x = angle;
    }
  }
}
