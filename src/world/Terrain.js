import * as THREE from '../../lib/three.module.js';
import { applyRelief } from '../rendering/SurfaceShading.js';

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
// Hard clamp on player/NPC position. The thing you actually walk into is the
// stone rampart at BARRIER (Boundary.js), whose inner face sits ~249; this is
// only the backstop behind it. Playable content stays inside ~245.
export const EDGE_LIMIT = 250;
// Ground-mesh resolution: 2.5 m cells. The mesh is only ever an approximation
// of baseHeight(), and every crease between its cells is somewhere a draped
// surface can disagree with it, so the cell size sets the floor on how well a
// road can be made to sit. See meshHeightAt().
const MESH_SEGS = 200;

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

    // Beyond the rampart (see Boundary.js) the ground lifts into a low berm
    // and stops. It used to ramp up 50 m into the fog, which is what you saw
    // over the top of the map when nothing was standing in front of it; the
    // wall is the world's edge now, so the ground outside only has to fill
    // the gap between the wall's foot and the horizon.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > 254) h += Math.min(8.5, (edge - 254) * 0.22);
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

  /**
   * Build the displaced, grass-textured ground mesh. Call after all pads.
   *
   * `paint(x, z)` — supplied by World, which is the only thing that knows
   * where the districts are — returns `{ dry, lush, wild, tint }` for a world
   * point: three overlay weights (the kept lawn shows through as whatever is
   * left of 1) and a brightness multiplier.
   *
   * The whole 640 m ground is one mesh with one material, so the four grasses
   * cannot be separate draws; they are blended per fragment from a per-vertex
   * weight, which is what makes the boundaries seamless — there is no seam to
   * hide, the weights just interpolate across the lattice like everything else
   * a vertex carries. `tint` is the other half of the job: a single tile
   * repeated 107 times reads as a repeat no matter how well it is drawn, and
   * varying the ground's tone over tens of metres is what breaks that read
   * without costing a texture fetch.
   */
  buildMesh(texLib, paint = null) {
    const segs = MESH_SEGS;
    const geo = new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    // Keep the lattice: it is the ground the player actually SEES, and every
    // surface draped on top has to agree with it rather than with the
    // analytic function it approximates.
    const cell = (MAP_HALF * 2) / segs;
    const grid = new Float32Array((segs + 1) * (segs + 1));
    for (let i = 0; i < pos.count; i++) {
      const h = this.heightAt(pos.getX(i), pos.getZ(i));
      pos.setY(i, h);
      const gi = Math.round((pos.getX(i) + MAP_HALF) / cell);
      const gj = Math.round((pos.getZ(i) + MAP_HALF) / cell);
      grid[gj * (segs + 1) + gi] = h;
    }
    this.grid = { segs, cell, h: grid };
    geo.computeVertexNormals();
    // 6 m per tile: blades come out roughly life-size at that scale, and the
    // repeat lands often enough that no single tile can be picked out.
    const R = (MAP_HALF * 2) / 6;
    const mat = new THREE.MeshLambertMaterial({ map: texLib.tiled('grass', R, R) });
    if (paint) this._splat(geo, mat, texLib, R, paint);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'terrain';
    return this.mesh;
  }

  /** Bake the grass weights onto the geometry and blend them in the shader. */
  _splat(geo, mat, texLib, R, paint) {
    const pos = geo.attributes.position;
    const w = new Float32Array(pos.count * 3);
    const tint = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const p = paint(pos.getX(i), pos.getZ(i));
      // Clamped and normalised here rather than trusted: a paint function that
      // returns weights summing over 1 would brighten the ground wherever it
      // did, which is exactly the kind of fault that reads as a lighting bug.
      let d = Math.max(0, p.dry || 0), l = Math.max(0, p.lush || 0), v = Math.max(0, p.wild || 0);
      const sum = d + l + v;
      if (sum > 1) { d /= sum; l /= sum; v /= sum; }
      w[i * 3] = d; w[i * 3 + 1] = l; w[i * 3 + 2] = v;
      tint[i] = p.tint ?? 1;
    }
    geo.setAttribute('aGrass', new THREE.Float32BufferAttribute(w, 3));
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
    const dry = texLib.tiled('grassDry', R, R);
    const lush = texLib.tiled('grassLush', R, R);
    const wild = texLib.tiled('grassWild', R, R);
    mat.onBeforeCompile = (s) => {
      // An instance hook shadows the prototype one, so the surface-relief
      // extension has to be invited in by hand here (see SurfaceShading.js).
      // All four grasses share the lawn's relief: they are the same blades in
      // four states of thirst, and one fetch on the map's single largest
      // surface is worth far more than four.
      applyRelief(s.uniforms, 'grass');
      s.uniforms.mapDry = { value: dry };
      s.uniforms.mapLush = { value: lush };
      s.uniforms.mapWild = { value: wild };
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aGrass;
          attribute float aTint;
          varying vec3 vGrass;
          varying float vTint;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vGrass = aGrass;
          vTint = aTint;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D mapDry;
          uniform sampler2D mapLush;
          uniform sampler2D mapWild;
          varying vec3 vGrass;
          varying float vTint;`)
        .replace('#include <map_fragment>', `
          vec4 gLawn = texture2D(map, vMapUv);
          vec4 gDry  = texture2D(mapDry, vMapUv);
          vec4 gLush = texture2D(mapLush, vMapUv);
          vec4 gWild = texture2D(mapWild, vMapUv);
          float wLawn = max(0.0, 1.0 - vGrass.x - vGrass.y - vGrass.z);
          vec4 sampledDiffuseColor =
            gLawn * wLawn + gDry * vGrass.x + gLush * vGrass.y + gWild * vGrass.z;
          sampledDiffuseColor.rgb *= vTint;
          diffuseColor *= sampledDiffuseColor;`);
    };
    mat.customProgramCacheKey = () => 'terrain-grass-splat';
  }

  /**
   * Height of the RENDERED ground, by bilinear interpolation over the mesh
   * lattice built in buildMesh().
   *
   * heightAt() is the analytic surface; the mesh is a 3.2 m approximation of
   * it, and the two disagree by tens of centimetres wherever the ground
   * curves. A road drapes onto what you can SEE, so it has to sample this —
   * matching the analytic surface instead is what left roads hanging over,
   * and cutting into, the hillsides they cross.
   *
   * Falls back to the analytic height before the mesh exists.
   */
  meshHeightAt(x, z) {
    const g = this.grid;
    if (!g) return this.heightAt(x, z);
    const n = g.segs + 1;
    const fx = (x + MAP_HALF) / g.cell, fz = (z + MAP_HALF) / g.cell;
    const i = Math.max(0, Math.min(g.segs - 1, Math.floor(fx)));
    const j = Math.max(0, Math.min(g.segs - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const h00 = g.h[j * n + i], h10 = g.h[j * n + i + 1];
    const h01 = g.h[(j + 1) * n + i], h11 = g.h[(j + 1) * n + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /**
   * A ground ribbon (road / path) draped over the terrain between waypoints.
   *
   * The waypoints are only the road's SHAPE, not its resolution. Emitting one
   * cross-section per waypoint puts a flat quad across whatever the ground
   * does in between, and the town's waypoints are forty to sixty metres apart
   * — which on rolling terrain left roads hanging four metres in the air over
   * dips and buried a metre deep through rises. So the centreline is resampled
   * at a fixed step and the ground is queried at every station.
   *
   * Each station is also subdivided ACROSS its width, not just at the two
   * edges: a road crossing a slope sideways is otherwise a chord over the
   * hill, and its crown floats however finely the length is sampled.
   *
   * HOW FINELY, THOUGH, IS SET BY THE JUNCTIONS RATHER THAN BY THE HILLS.
   * Two roads crossing at right angles chord the same curved ground in
   * different directions and at different spacings, so they disagree in the
   * middle of the crossing by however much the ground bends between their
   * samples — and where the terrain is being pulled flat under a building pad
   * it bends fast. At the old 1.0 m along and 1.5 m across, two ribbons over
   * the filling station's pad blend disagreed by nearly two centimetres,
   * which is far more than the millimetre or two a drape stack can be
   * separated by without roads visibly floating. Sampling at 0.8 m in both
   * directions takes that to under four millimetres, which is a step a stack
   * can afford — see World._drapeLevel.
   */
  makeRibbon(points, width, material, lift = 0.06, step = 0.8) {
    // resample the centreline
    const line = [];
    for (let i = 1; i < points.length; i++) {
      const [x0, z0] = points[i - 1], [x1, z1] = points[i];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        line.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
      }
    }
    const across = Math.max(2, Math.round(width / 0.8));  // spans across the width
    const perStation = across + 1;
    const positions = [], uvs = [], indices = [];
    let dist = 0;
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      const prev = line[Math.max(0, i - 1)];
      const next = line[Math.min(line.length - 1, i + 1)];
      const dir = new THREE.Vector2(next[0] - prev[0], next[1] - prev[1]).normalize();
      const nrm = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);
      if (i > 0) dist += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      for (let j = 0; j <= across; j++) {
        const s = (j / across) * 2 - 1;
        const x = p[0] + nrm.x * s, z = p[1] + nrm.y * s;
        positions.push(x, this.meshHeightAt(x, z) + lift, z);
        uvs.push(s * 0.5 + 0.5, dist / width);
      }
      if (i > 0) {
        const b = i * perStation;              // this station's first vertex
        const a = b - perStation;              // the previous station's
        for (let j = 0; j < across; j++) {
          indices.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
        }
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
   * Subdivided to the same fixed step as a ribbon, capped so the big
   * industrial yard does not turn into fifty thousand triangles.
   */
  makePatch(x, z, hx, hz, material, lift = 0.05, step = 1.2) {
    const nx = Math.max(2, Math.min(96, Math.ceil((hx * 2) / step)));
    const nz = Math.max(2, Math.min(96, Math.ceil((hz * 2) / step)));
    const geo = new THREE.PlaneGeometry(hx * 2, hz * 2, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.meshHeightAt(pos.getX(i) + x, pos.getZ(i) + z) + lift);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, 0, z);
    return mesh;
  }

  /**
   * A ground decal (crosswalk, manhole, oil stain) draped over the terrain.
   * A single flat quad floats at its corners on any slope, which is what put
   * crosswalks in the air at the downtown intersections.
   */
  makeDecal(x, z, sizeX, sizeZ, yaw, material, lift = 0.1) {
    const seg = Math.max(1, Math.round(Math.max(sizeX, sizeZ) / 1.5));
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(yaw);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.meshHeightAt(pos.getX(i) + x, pos.getZ(i) + z) + lift);
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
