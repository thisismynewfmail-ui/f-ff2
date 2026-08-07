import * as THREE from '../../lib/three.module.js';

/**
 * Trees, bushes, hedges, flower beds, grass, weeds and wall creepers.
 *
 * Static geometry only — foliage is built from crossed quads (classic retro
 * technique), never camera-facing billboards.
 *
 * Two animation paths, because the two kinds of planting have completely
 * different costs:
 *
 *  - **Objects** (trees, bushes, hedge sections, flower clumps, wall vines)
 *    sway on the CPU. Each registered swayer's pivot sits at its attachment
 *    point, so a small rotation reads as wind bend, and only swayers near the
 *    camera are ticked.
 *
 *  - **Ground cover** (grass tufts, weeds) is merged into one mesh per field —
 *    thousands of quads, one draw call — so per-object rotation is off the
 *    table. Instead the merged material carries a tiny vertex-shader patch:
 *    a `aSway` attribute is 0 along the ground edge and 1 at the blade tips,
 *    and the tips are pushed along a shared wind vector by a travelling wave
 *    sampled from world position. One uniform drives every field in the town,
 *    so the whole map bends together the way a field actually does, and the
 *    cost is one float per frame.
 *
 * WIND is a real direction, not a shimmer: `WIND` below is the vector the
 * grass leans along, and everything that sways is phase-offset from world
 * position so no two plants beat in time with each other.
 */

/** Prevailing wind: out of the west, quartering south. Length = lean strength. */
const WIND = new THREE.Vector2(0.132, 0.082);

export class Vegetation {
  constructor(texLib, collision, nav, terrain) {
    this.texLib = texLib;
    this.collision = collision;
    this.nav = nav;
    this.terrain = terrain;
    this.swayers = []; // {node, phase, amp, speed, axis}
    this.leavesMat = this._cutout('leaves');
    this.bushMat = this._cutout('bush');
    this.tuftMat = this._windCutout('grassTuft');
    this.weedMat = this._windCutout('weeds');
    this.hedgeMat = this._cutout('hedge');
    this.flowerMat = this._cutout('flowers');
    this.vineMat = this._cutout('vine');
    this.ivyMat = this._cutout('ivy');
    this.barkMat = new THREE.MeshLambertMaterial({ map: texLib.get('bark') });
  }

  _cutout(tex) {
    return new THREE.MeshLambertMaterial({
      map: this.texLib.get(tex),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
  }

  /**
   * A cutout material whose vertices bend downwind, driven by one shared
   * clock. `aSway` (0 at the root, 1 at the tip) is supplied by whichever
   * field builder uses it; geometry is authored in world space, so the phase
   * can be read straight off the vertex position and neighbouring tufts fall
   * naturally out of step.
   */
  _windCutout(tex) {
    const mat = this._cutout(tex);
    this._wind ??= { value: 0 };
    this._windVec ??= { value: WIND };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindT = this._wind;
      shader.uniforms.uWind = this._windVec;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uWindT;
          uniform vec2 uWind;
          attribute float aSway;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float phase = position.x * 0.55 + position.z * 0.83;
          float gust = sin(uWindT * 1.35 + phase) * 0.62
                     + sin(uWindT * 2.7 + phase * 1.7) * 0.26
                     + sin(uWindT * 0.31 + phase * 0.2) * 0.42;
          float bend = aSway * (0.62 + 0.38 * gust);
          transformed.x += uWind.x * bend;
          transformed.z += uWind.y * bend;
          transformed.y -= aSway * abs(bend) * 0.22;`);
    };
    // Two materials compiled from the same source would otherwise share a
    // program and only one patch would take: keep them distinct.
    mat.customProgramCacheKey = () => 'wind:' + tex;
    return mat;
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
    // A canopy bends downwind and springs back; the two frequencies stop it
    // reading as a metronome, and the lean is biased along the wind so a whole
    // treeline leans the same way.
    this.swayers.push({ node: canopy, phase: x * 0.7 + z * 1.3, amp: 0.042, speed: 0.9, axis: 'z', lean: 0.014 });
    this.collision.addBoxCentered(x, y + 1, z, 0.3 * scale, 1.4, 0.3 * scale, 'tree');
    this.nav.blockBox(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
    return g;
  }

  bush(parent, x, z, scale = 1) {
    const y = this.terrain.heightAt(x, z);
    const b = this._cross(this.bushMat, 1.5 * scale, 1.2 * scale);
    b.position.set(x, y - 0.05, z);
    parent.add(b);
    this.swayers.push({ node: b, phase: x * 1.1 + z, amp: 0.028, speed: 1.4, axis: 'z', lean: 0.01 });
    return b;
  }

  /**
   * A clipped hedge run between two points: the boundary marker a garden
   * fence line wants behind it. Built as overlapping crossed clumps so the run
   * reads as one mass rather than as a row of separate bushes, each clump
   * swaying on its own phase. Solid to bodies (chest-high cover), invisible to
   * the nav grid so a horde still flows round the block.
   */
  hedge(parent, x1, z1, x2, z2, { height = 1.35, spacing = 1.1, collide = true } = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const s = 0.9 + ((x * 7 + z * 3) % 10) / 40;
      const clump = this._cross(this.hedgeMat, spacing * 1.7, height * s);
      clump.position.set(x, this.terrain.heightAt(x, z) - 0.06, z);
      clump.rotation.y = ((x * 13 + z * 5) % 7) * 0.09;
      parent.add(clump);
      this.swayers.push({ node: clump, phase: x * 0.9 + z * 1.4, amp: 0.012, speed: 1.7, axis: 'z', lean: 0.006 });
    }
    if (collide) {
      const pad = 0.55;
      const y = this.terrain.heightAt((x1 + x2) / 2, (z1 + z2) / 2);
      this.collision.addBox(Math.min(x1, x2) - pad, y - 0.4, Math.min(z1, z2) - pad,
        Math.max(x1, x2) + pad, y + height * 0.85, Math.max(z1, z2) + pad, 'fence');
    }
  }

  /** A clump of garden flowers still in bloom, months past anyone watering it. */
  flowers(parent, x, z, scale = 1) {
    const y = this.terrain.heightAt(x, z);
    const f = this._cross(this.flowerMat, 1.15 * scale, 0.95 * scale);
    f.position.set(x, y - 0.04, z);
    f.rotation.y = ((x * 11 + z * 7) % 6) * 0.26;
    parent.add(f);
    this.swayers.push({ node: f, phase: x * 1.7 + z * 0.6, amp: 0.05, speed: 2.1, axis: 'z', lean: 0.018 });
    return f;
  }

  /**
   * Many ground-cover blades merged into a single wind-animated mesh (one
   * draw call). `points`: array of [x, z]. `mat` selects grass or weeds.
   */
  _coverField(parent, points, mat, W, H) {
    const pos = [];
    const uv = [];
    const idx = [];
    const sway = [];
    let base = 0;
    for (const [x, z] of points) {
      const y = this.terrain.heightAt(x, z) - 0.03;
      const rot = (x * 13 + z * 7) % 3;
      for (const a of [rot, rot + Math.PI / 2]) {
        const dx = Math.cos(a) * W / 2, dz = Math.sin(a) * W / 2;
        pos.push(x - dx, y, z - dz, x + dx, y, z + dz, x + dx, y + H, z + dz, x - dx, y + H, z - dz);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        sway.push(0, 0, 1, 1);          // rooted at the bottom edge, free at the tips
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    // Blades leave their authored box as they bend; without the padding the
    // field can be culled while part of it is still on screen.
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 1.5;
    parent.add(mesh);
    return mesh;
  }

  /** Grass tufts, merged and wind-animated. points: array of [x, z]. */
  tuftField(parent, points) {
    return this._coverField(parent, points, this.tuftMat, 0.9, 0.7);
  }

  /**
   * Tall dry weeds, merged and wind-animated. What comes up through a crack in
   * a pavement nobody sweeps — taller, paler and more ragged than lawn grass,
   * so an abandoned lot reads differently from a verge.
   */
  weedField(parent, points) {
    return this._coverField(parent, points, this.weedMat, 1.0, 1.15);
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
    this.swayers.push({ node: q, phase: x + z, amp: 0.01, speed: 1.1, axis: 'x' });
    return q;
  }

  /**
   * A mat of ivy climbing a wall. Denser and wider than a vine strip: this is
   * what accumulates on the north face of a house that has not been cut back
   * in years, and it is the one piece of planting that grows ON the building
   * rather than beside it.
   */
  ivy(parent, x, y, z, yaw, w = 2.2, h = 3.4) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.ivyMat);
    q.position.set(x, y + h / 2, z);
    q.rotation.y = yaw;
    parent.add(q);
    this.swayers.push({ node: q, phase: x * 1.3 + z, amp: 0.007, speed: 0.85, axis: 'x' });
    return q;
  }

  update(time, cameraPos) {
    // One clock drives every merged ground-cover field in the town.
    if (this._wind) this._wind.value = time;
    for (const s of this.swayers) {
      const n = s.node;
      const dx = n.position.x + (n.parent?.position.x || 0) - cameraPos.x;
      const dz = n.position.z + (n.parent?.position.z || 0) - cameraPos.z;
      if (dx * dx + dz * dz > 6400) continue; // only animate within 80 m
      const angle = Math.sin(time * s.speed + s.phase) * s.amp
                  + Math.sin(time * s.speed * 2.7 + s.phase) * s.amp * 0.3
                  + (s.lean ?? 0);           // the standing lean the wind holds
      if (s.axis === 'x') n.rotation.x = angle;
      else n.rotation.z = angle;
    }
  }
}
