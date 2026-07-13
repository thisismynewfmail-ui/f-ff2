import * as THREE from '../../lib/three.module.js';

/**
 * Heightfield terrain for the whole town.
 *
 * The height function is analytic (rolling hills + landmark features) plus a
 * list of rectangular "pads" that flatten ground under buildings and plazas,
 * and walkable "platforms" (interior upper floors, the sewer room) that
 * override ground height for entities standing on them.
 *
 * Landmarks:
 *  - Chapel Ridge: a 16 m hill in the north-west (vertical combat)
 *  - Hollow Park ravine: a 7 m depression in the west
 *  - graded, gently rolling downtown in the north
 *  - low flat industrial ground in the south
 *  - the map edge rises steeply into fog on every side
 */
export const MAP_HALF = 320; // world spans [-320, 320] on X and Z
export const EDGE_LIMIT = 250; // invisible wall; playable content stays inside ~245

export class Terrain {
  constructor() {
    this.pads = [];       // {x, z, hx, hz, y, blend}
    this.platforms = [];  // {minX, maxX, minZ, maxZ, y}
    this.ramps = [];      // {x, z, hx, hz, axis, y0, y1}
    this.mesh = null;
  }

  baseHeight(x, z) {
    let h = 2.2 * Math.sin(x * 0.011) * Math.cos(z * 0.013)
          + 1.5 * Math.sin(x * 0.023 + 1.7) * Math.sin(z * 0.017 + 0.4)
          + 0.6 * Math.sin(x * 0.05 + 0.3) * Math.cos(z * 0.043 + 2.1);

    // Chapel Ridge (NW): the tallest point in town.
    h += 16 * gauss(x, z, -195, -195, 90, 80);
    // Eastgate knoll: rolling residential hill.
    h += 5 * gauss(x, z, 165, 20, 80, 70);
    // Hollow Park ravine (W).
    h -= 7 * gauss(x, z, -150, 85, 62, 42);
    // Pond at the bottom of the ravine dips a little deeper.
    h -= 2.2 * gauss(x, z, -150, 85, 24, 18);
    // Downtown (N) was graded nearly level when it was built.
    h = lerp(h, 0.6, 0.78 * boxMask(x, z, -115, 115, -250, -60, 30));
    // Industrial flats (S).
    h = lerp(h, -0.8, 0.85 * boxMask(x, z, -150, 170, 110, 290, 40));

    // The world rises into the fog at the edges.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > 252) h += (edge - 252) * (edge - 252) * 0.012;
    return h;
  }

  /** Terrain height with building/plaza pads applied (what the mesh shows). */
  heightAt(x, z) {
    let h = this.baseHeight(x, z);
    for (const p of this.pads) {
      const dx = Math.max(0, Math.abs(x - p.x) - p.hx);
      const dz = Math.max(0, Math.abs(z - p.z) - p.hz);
      const d = Math.hypot(dx, dz);
      if (d < p.blend) h = lerp(p.y, h, smooth(d / p.blend));
    }
    return h;
  }

  /**
   * Walkable ground height for an entity currently at elevation `y`.
   * Platforms/ramps only count when the entity is high enough to stand on
   * them (steps up to 1.1 m), so floors above your head don't teleport you.
   */
  groundHeightFor(x, z, y = 1e9) {
    const candidates = [this.heightAt(x, z)];
    for (const p of this.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) candidates.push(p.y);
    }
    for (const r of this.ramps) {
      if (Math.abs(x - r.x) <= r.hx && Math.abs(z - r.z) <= r.hz) {
        const t = r.axis === 'x'
          ? (x - (r.x - r.hx)) / (2 * r.hx)
          : (z - (r.z - r.hz)) / (2 * r.hz);
        candidates.push(lerp(r.y0, r.y1, clamp01(t)));
      }
    }
    let best = -Infinity;
    for (const c of candidates) if (c <= y + 1.1 && c > best) best = c;
    if (best === -Infinity) best = Math.min(...candidates);
    return best;
  }

  /** Uphill steepness (rise per metre) along a movement direction. */
  slopeAlong(x, z, dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return 0;
    const step = 0.6;
    const h0 = this.heightAt(x, z);
    const h1 = this.heightAt(x + (dx / len) * step, z + (dz / len) * step);
    return (h1 - h0) / step;
  }

  addPad(x, z, hx, hz, y, blend = 6) {
    this.pads.push({ x, z, hx, hz, y, blend });
    return y;
  }

  /** Flatten a pad at the terrain's own height; returns the pad height. */
  padAtGrade(x, z, hx, hz, blend = 6) {
    const y = this.baseHeight(x, z);
    return this.addPad(x, z, hx, hz, y, blend);
  }

  addPlatform(minX, maxX, minZ, maxZ, y) {
    this.platforms.push({ minX, maxX, minZ, maxZ, y });
  }

  addRamp(x, z, hx, hz, axis, y0, y1) {
    this.ramps.push({ x, z, hx, hz, axis, y0, y1 });
  }

  /** Build the displaced, grass-textured ground mesh. Call after all pads. */
  buildMesh(texLib) {
    const segs = 200;
    const geo = new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const tex = texLib.tiled('grass', 160, 160);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    this.mesh.name = 'terrain';
    return this.mesh;
  }

  /**
   * A ground ribbon (road / path) draped over the terrain between waypoints.
   * Returns a mesh slightly above ground to avoid z-fighting.
   */
  makeRibbon(points, width, material, lift = 0.06) {
    const positions = [];
    const uvs = [];
    const indices = [];
    let dist = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dir = new THREE.Vector2(next[0] - prev[0], next[1] - prev[1]).normalize();
      const nrm = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);
      if (i > 0) dist += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      for (const s of [-1, 1]) {
        const x = p[0] + nrm.x * s, z = p[1] + nrm.y * s;
        positions.push(x, this.heightAt(x, z) + lift, z);
        uvs.push(s * 0.5 + 0.5, dist / width);
      }
      if (i > 0) {
        const b = i * 2;
        indices.push(b - 2, b - 1, b, b - 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }

  /**
   * A rectangular ground patch (plaza, parking lot) draped over terrain.
   */
  makePatch(x, z, hx, hz, material, lift = 0.05) {
    const nx = Math.max(2, Math.ceil(hx / 3)), nz = Math.max(2, Math.ceil(hz / 3));
    const geo = new THREE.PlaneGeometry(hx * 2, hz * 2, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i) + x, pos.getZ(i) + z) + lift);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, 0, z);
    return mesh;
  }
}

function gauss(x, z, cx, cz, sx, sz) {
  const dx = (x - cx) / sx, dz = (z - cz) / sz;
  return Math.exp(-(dx * dx + dz * dz));
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
/** 1 inside the box, falling to 0 across `margin` outside it. */
function boxMask(x, z, minX, maxX, minZ, maxZ, margin) {
  const dx = Math.max(minX - x, x - maxX, 0);
  const dz = Math.max(minZ - z, z - maxZ, 0);
  return 1 - smooth(Math.hypot(dx, dz) / margin);
}
