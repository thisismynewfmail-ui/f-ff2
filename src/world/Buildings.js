import * as THREE from '../../lib/three.module.js';

/**
 * Parametric building construction.
 *
 * Buildings are described by small spec objects (position, footprint, wall
 * material, roof type, door side...) and built from textured boxes. Walls
 * with a doorway are split into real segments so interiors are navigable.
 * Rotations are restricted to 90° steps, which keeps every collider a clean
 * AABB. UVs are scaled to world size (2 m per texture tile) so one shared
 * material per texture tiles correctly on every segment.
 *
 * Spec fields beyond the basics:
 *   roof: 'gable' | 'flat' | 'shed'   ridge: 'x' | 'z' (default: long axis)
 *   chimney: true                     residential detail on gable roofs
 *   doorTex: 'doorWood' | 'doorMetal' | 'doorShop'
 *   shopfront: true                   display windows + no ground windows on
 *                                     the door side
 *   awning: true                      canvas awnings over door/shopfront
 *   derelict: 0..1                    drives broken + boarded window mix
 *   foundation: false                 suppress the concrete skirt
 *   partitions: [{axis:'x'|'z', at, from, to, gapAt, gapW, tex}]
 *                                     interior walls with door gaps (local
 *                                     coordinates), colliding like real walls
 */
const WALL_T = 0.32;
const DOOR_W = 1.5;
const DOOR_H = 2.3;
const TEXEL = 0.5; // uv units per metre

export class BuildingKit {
  constructor(texLib, collision, nav) {
    this.texLib = texLib;
    this.collision = collision;
    this.nav = nav;
    this.materials = new Map();
  }

  mat(texName, opts = {}) {
    const key = texName + JSON.stringify(opts);
    if (!this.materials.has(key)) {
      this.materials.set(key, new THREE.MeshLambertMaterial({ map: this.texLib.get(texName), ...opts }));
    }
    return this.materials.get(key);
  }

  box(w, h, d, texName) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    return new THREE.Mesh(geo, this.mat(texName));
  }

  /**
   * Build a building from a spec:
   * { x, z, y (pad height), w, d, h, rot (0|90|180|270), wall, roof, roofTex,
   *   floor, door:'N'|'S'|'E'|'W'|null (local side, +Z = S = front),
   *   windows:true, derelict:0..1, solid:false, ... (see header) }
   * `solid: true` makes a non-enterable filler building (single collider).
   * Returns { group, lootPoints[], spawnPoints[], doorWorld }.
   */
  build(spec) {
    const { x, z, y, w, d, h } = spec;
    const rot = ((spec.rot || 0) % 360 + 360) % 360;
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = -rot * Math.PI / 180;
    const wallTex = spec.wall || 'brickRed';
    const derelict = spec.derelict ?? 0.3;
    const rand = mulberry32(Math.floor(x * 31 + z * 17 + w * 7) & 0x7fffffff);

    const lootPoints = [];
    const spawnPoints = [];
    const windowBatch = new Map(); // texture -> quad list, merged per building

    // ---- foundation ---------------------------------------------------
    // A concrete skirt, half-buried, reads as a real footing and doubles as
    // an interior baseboard. One mesh; no collider (it hugs the wall line).
    if (spec.foundation !== false) {
      const skirt = this.box(w + 0.26, 0.5, d + 0.26, 'concrete');
      skirt.position.y = -0.07;
      group.add(skirt);
    }

    // ---- walls ------------------------------------------------------
    // Local sides: S = +Z (front), N = -Z, E = +X, W = -X.
    const sides = [
      { id: 'S', cx: 0, cz: d / 2 - WALL_T / 2, len: w, axis: 'x' },
      { id: 'N', cx: 0, cz: -d / 2 + WALL_T / 2, len: w, axis: 'x' },
      { id: 'E', cx: w / 2 - WALL_T / 2, cz: 0, len: d, axis: 'z' },
      { id: 'W', cx: -w / 2 + WALL_T / 2, cz: 0, len: d, axis: 'z' },
    ];

    if (spec.solid) {
      const body = this.box(w, h, d, wallTex);
      body.position.y = h / 2;
      group.add(body);
      this._collideLocalBox(spec, rot, 0, 0, w / 2, h, d / 2);
      // Solid facades still read as inhabited blocks: give them windows.
      if (spec.windows !== false) {
        for (const side of sides) this._windows(windowBatch, side, spec, h, rand, derelict, null);
      }
    } else {
      for (const side of sides) {
        const hasDoor = spec.door === side.id;
        if (!hasDoor) {
          this._wallSegment(group, spec, rot, side, -side.len / 2, side.len / 2, 0, h, wallTex);
        } else {
          const doorOff = (spec.doorOffset ?? 0) * side.len * 0.5;
          const a = doorOff - DOOR_W / 2, b = doorOff + DOOR_W / 2;
          this._wallSegment(group, spec, rot, side, -side.len / 2, a, 0, h, wallTex);
          this._wallSegment(group, spec, rot, side, b, side.len / 2, 0, h, wallTex);
          this._wallSegment(group, spec, rot, side, a, b, DOOR_H, h - DOOR_H, wallTex, DOOR_H);
          // Door leaf hanging open against the inside wall.
          const doorTex = spec.doorTex || 'doorWood';
          const leaf = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W * 0.95, DOOR_H * 0.95), this.mat(doorTex, { side: THREE.DoubleSide }));
          const s = side.axis === 'x' ? [a + 0.1, DOOR_H / 2, side.cz - Math.sign(side.cz) * 0.5] : [side.cx - Math.sign(side.cx) * 0.5, DOOR_H / 2, a + 0.1];
          leaf.position.set(s[0], s[1], s[2]);
          leaf.rotation.y = side.axis === 'x' ? Math.PI / 2.3 : 0.2;
          group.add(leaf);
          if (spec.awning) {
            this._awning(group, side, doorOff, DOOR_W + 1.0);
            if (spec.shopfront) {
              for (const sgn of [-1, 1]) {
                const at = doorOff + sgn * (DOOR_W / 2 + 2.0);
                if (Math.abs(at) + 1.7 <= side.len / 2 - 0.4) this._awning(group, side, at, 3.3);
              }
            }
          }
        }
        // window quads on the outer face
        if (spec.windows !== false) {
          this._windows(windowBatch, side, spec, h, rand, derelict, hasDoor ? (spec.doorOffset ?? 0) * side.len * 0.5 : null);
        }
      }

      // interior partition walls (room layouts) — collide like real walls
      for (const p of spec.partitions ?? []) {
        const tex = p.tex || spec.innerTex || 'wallPlaster';
        const side = p.axis === 'x'
          ? { id: 'P', cx: 0, cz: p.at, len: 0, axis: 'x' }
          : { id: 'P', cx: p.at, cz: 0, len: 0, axis: 'z' };
        const gw = (p.gapW ?? 1.2) / 2;
        const ga = p.gapAt ?? (p.from + p.to) / 2;
        this._wallSegment(group, spec, rot, side, p.from, ga - gw, 0, h, tex);
        this._wallSegment(group, spec, rot, side, ga + gw, p.to, 0, h, tex);
        this._wallSegment(group, spec, rot, side, ga - gw, ga + gw, DOOR_H, h - DOOR_H, tex, DOOR_H);
      }

      // floor
      const floor = this.box(w - WALL_T, 0.1, d - WALL_T, spec.floor || 'floorWood');
      floor.position.y = 0.06;
      group.add(floor);

      lootPoints.push(local2world(spec, rot, 0, d / 4));
      spawnPoints.push(local2world(spec, rot, 0, -d / 4));
    }

    this._flushWindows(group, windowBatch);

    // ---- roof -------------------------------------------------------
    const roofKind = spec.roof || 'gable';
    const roofTex = spec.roofTex || (roofKind === 'gable' ? 'roofShingle' : 'roofTar');
    if (roofKind === 'gable') {
      this._gableRoof(group, spec, w, d, h, roofTex, wallTex);
    } else if (roofKind === 'shed') {
      this._shedRoof(group, w, d, h, roofTex, wallTex);
    } else {
      const slab = this.box(w + 0.4, 0.25, d + 0.4, roofTex);
      slab.position.y = h + 0.13;
      group.add(slab);
      for (const [px, pz, pw, pd] of [
        [0, d / 2 + 0.1, w + 0.4, 0.2], [0, -d / 2 - 0.1, w + 0.4, 0.2],
        [w / 2 + 0.1, 0, 0.2, d + 0.4], [-w / 2 - 0.1, 0, 0.2, d + 0.4],
      ]) {
        const lip = this.box(pw, 0.5, pd, wallTex);
        lip.position.set(px, h + 0.4, pz);
        group.add(lip);
      }
    }

    const doorWorld = spec.door
      ? local2world(spec, rot, spec.door === 'E' ? w / 2 : spec.door === 'W' ? -w / 2 : (spec.doorOffset ?? 0) * w * 0.5,
                    spec.door === 'S' ? d / 2 : spec.door === 'N' ? -d / 2 : (spec.doorOffset ?? 0) * d * 0.5)
      : null;

    return { group, lootPoints, spawnPoints, doorWorld };
  }

  _wallSegment(group, spec, rot, side, from, to, yBase, height, tex, lift = 0) {
    const len = to - from;
    if (len <= 0.05 || height <= 0.05) return;
    const mid = (from + to) / 2;
    const seg = this.box(side.axis === 'x' ? len : WALL_T, height, side.axis === 'x' ? WALL_T : len, tex);
    const lx = side.axis === 'x' ? mid : side.cx;
    const lz = side.axis === 'x' ? side.cz : mid;
    seg.position.set(lx, lift + height / 2, lz);
    group.add(seg);
    if (lift === 0) {
      // Only ground-level segments collide (lintels are overhead).
      this._collideLocalBox(spec, rot, lx, lz,
        side.axis === 'x' ? len / 2 : WALL_T / 2, height,
        side.axis === 'x' ? WALL_T / 2 : len / 2);
    }
  }

  /**
   * Windows for one facade. Rows stack every 2.7 m so tall buildings read as
   * multi-storey; the derelict factor mixes in broken and boarded panes.
   * A shopfront door side swaps its ground row for wide display windows.
   * Quads are batched per texture and merged into one mesh per building.
   */
  _windows(batch, side, spec, h, rand, derelict, doorOff) {
    const usable = side.len - 2.4;
    const count = Math.max(0, Math.floor(usable / 3.6));
    if (!count) return;
    const out = Math.sign(side.cx + side.cz) * (WALL_T / 2 + 0.03);
    const shopSide = !!spec.shopfront && spec.door === side.id;
    const rows = [];
    for (let yRow = Math.min(h - 1.1, 1.9); yRow <= h - 1.3; yRow += 2.7) rows.push(yRow);
    if (!rows.length) rows.push(Math.min(h - 1.1, 1.9));
    for (let ri = 0; ri < rows.length; ri++) {
      if (shopSide && ri === 0) continue;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count - 0.5;
        const at = t * usable;
        if (ri === 0 && doorOff !== null && Math.abs(at - doorOff) < DOOR_W * 0.5 + 0.9) continue;
        const r = rand();
        const tex = r < derelict * 0.45 ? 'windowBroken' : r < derelict * 0.8 ? 'windowBoarded' : 'window';
        this._pushQuad(batch, tex, side, at, rows[ri], out, 1.2, 1.3);
      }
    }
    if (shopSide) {
      const doorAt = doorOff ?? 0;
      for (const sgn of [-1, 1]) {
        const at = doorAt + sgn * (DOOR_W / 2 + 2.0);
        if (Math.abs(at) + 1.7 > side.len / 2 - 0.4) continue;
        const tex = rand() < derelict * 0.5 ? 'windowBoarded' : 'windowShop';
        this._pushQuad(batch, tex, side, at, 1.35, out, tex === 'windowShop' ? 3.0 : 1.4, 1.5);
      }
    }
  }

  _pushQuad(batch, tex, side, at, yMid, out, qw, qh) {
    if (!batch.has(tex)) batch.set(tex, []);
    const q = side.axis === 'x'
      ? { cx: at, cz: side.cz + out, y: yMid, nx: 0, nz: Math.sign(out), qw, qh }
      : { cx: side.cx + out, cz: at, y: yMid, nx: Math.sign(out), nz: 0, qw, qh };
    batch.get(tex).push(q);
  }

  /** Merge all queued window quads into one mesh per texture. */
  _flushWindows(group, batch) {
    for (const [tex, quads] of batch) {
      const pos = [], uv = [], norm = [], idx = [];
      let base = 0;
      for (const q of quads) {
        const rx = q.nz, rz = -q.nx; // right vector = up × normal
        const hw = q.qw / 2, hh = q.qh / 2;
        pos.push(
          q.cx - rx * hw, q.y - hh, q.cz - rz * hw,
          q.cx + rx * hw, q.y - hh, q.cz + rz * hw,
          q.cx + rx * hw, q.y + hh, q.cz + rz * hw,
          q.cx - rx * hw, q.y + hh, q.cz - rz * hw);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let k = 0; k < 4; k++) norm.push(q.nx, 0, q.nz);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      geo.setIndex(idx);
      group.add(new THREE.Mesh(geo, this.mat(tex)));
    }
  }

  /** Sloped canvas awning centered at `at` along a facade. */
  _awning(group, side, at, width) {
    const out = Math.sign(side.cx + side.cz);
    if (side.axis === 'x') {
      const a = this.box(width, 0.09, 1.15, 'awning');
      a.position.set(at, DOOR_H + 0.42, side.cz + out * 0.62);
      a.rotation.x = out * 0.32;
      group.add(a);
    } else {
      const a = this.box(1.15, 0.09, width, 'awning');
      a.position.set(side.cx + out * 0.62, DOOR_H + 0.42, at);
      a.rotation.z = -out * 0.32;
      group.add(a);
    }
  }

  _gableRoof(group, spec, w, d, h, roofTex, wallTex) {
    // Climate logic: the ridge runs along the long axis so both slopes shed
    // toward the eaves; specs can pin `ridge` explicitly.
    const ridge = spec.ridge ?? (w > d ? 'x' : 'z');
    const rw = ridge === 'x' ? d : w, rd = ridge === 'x' ? w : d;
    const rg = new THREE.Group();
    const rise = Math.min(2.6, rw * 0.3);
    const panelW = Math.hypot(rw / 2 + 0.3, rise);
    for (const s of [-1, 1]) {
      const panel = this.box(panelW, 0.18, rd + 0.6, roofTex);
      panel.position.set(s * (rw / 4 + 0.05), h + rise / 2, 0);
      panel.rotation.z = -s * Math.atan2(rise, rw / 2 + 0.3);
      rg.add(panel);
    }
    // Triangular gable ends.
    for (const s of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([
        -rw / 2, h, 0, rw / 2, h, 0, 0, h + rise, 0,
      ], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, rw * TEXEL, 0, rw * TEXEL / 2, rise * TEXEL], 2));
      tri.computeVertexNormals();
      const cap = new THREE.Mesh(tri, this.mat(wallTex, { side: THREE.DoubleSide }));
      cap.position.z = s * (rd / 2 - WALL_T / 2);
      rg.add(cap);
    }
    if (spec.chimney) {
      const ch = this.box(0.7, rise + 1.8, 0.7, spec.chimneyTex || 'brickRed');
      ch.position.set(rw * 0.1, h + rise * 0.55 + 0.55, rd * 0.26);
      rg.add(ch);
    }
    if (ridge === 'x') rg.rotation.y = Math.PI / 2;
    group.add(rg);
  }

  /** Single-slope lean-to roof, high edge at the back (-Z). */
  _shedRoof(group, w, d, h, roofTex, wallTex) {
    const rise = Math.min(1.7, d * 0.24);
    const panelD = Math.hypot(d + 0.5, rise);
    const panel = this.box(w + 0.5, 0.16, panelD, roofTex);
    panel.position.y = h + rise / 2 + 0.05;
    panel.rotation.x = Math.atan2(rise, d + 0.5);
    group.add(panel);
    for (const s of [-1, 1]) { // right-triangle side caps
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([
        0, h, -d / 2, 0, h, d / 2, 0, h + rise, -d / 2,
      ], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, d * TEXEL, 0, 0, rise * TEXEL], 2));
      tri.computeVertexNormals();
      const cap = new THREE.Mesh(tri, this.mat(wallTex, { side: THREE.DoubleSide }));
      cap.position.x = s * (w / 2 - WALL_T / 2);
      group.add(cap);
    }
    const riser = this.box(w, rise + 0.2, WALL_T, wallTex);
    riser.position.set(0, h + rise / 2, -d / 2 + WALL_T / 2);
    group.add(riser);
  }

  _collideLocalBox(spec, rot, lx, lz, hx, height, hz) {
    // Rotate local center + swap extents; rot is one of 0/90/180/270.
    let wx = lx, wz = lz, ex = hx, ez = hz;
    if (rot === 90) { [wx, wz] = [lz, -lx]; [ex, ez] = [hz, hx]; }
    else if (rot === 180) { wx = -lx; wz = -lz; }
    else if (rot === 270) { [wx, wz] = [-lz, lx]; [ex, ez] = [hz, hx]; }
    const cx = spec.x + wx, cz = spec.z + wz;
    this.collision.addBox(cx - ex, spec.y, cz - ez, cx + ex, spec.y + height, cz + ez, 'wall');
    this.nav.blockBox(cx - ex, cz - ez, cx + ex, cz + ez);
  }
}

export function local2world(spec, rot, lx, lz) {
  let wx = lx, wz = lz;
  if (rot === 90) { wx = lz; wz = -lx; }
  else if (rot === 180) { wx = -lx; wz = -lz; }
  else if (rot === 270) { wx = -lz; wz = lx; }
  return { x: spec.x + wx, y: spec.y, z: spec.z + wz };
}

/** Scale a BoxGeometry's per-face UVs to world metres (2 m per tile). */
export function scaleBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (4 verts each).
  const scales = [
    [d * TEXEL, h * TEXEL], [d * TEXEL, h * TEXEL],
    [w * TEXEL, d * TEXEL], [w * TEXEL, d * TEXEL],
    [w * TEXEL, h * TEXEL], [w * TEXEL, h * TEXEL],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * scales[f][0], uv.getY(i) * scales[f][1]);
    }
  }
  uv.needsUpdate = true;
}

/**
 * Collapse a fully-positioned static group into one mesh per material.
 *
 * Every descendant mesh's transform (relative to `root`) is baked into a
 * merged non-indexed BufferGeometry, then the original children are dropped.
 * Materials are compared by reference — the kit/prop material caches make
 * that reliable. Call only on groups with no animated parts.
 */
export function mergeStatic(root) {
  const buckets = new Map(); // material -> { pos, norm, uv, renderOrder }
  const mat4 = new THREE.Matrix4();
  const nrm3 = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    // transform relative to root
    mat4.identity();
    const chain = [];
    for (let cur = o; cur && cur !== root; cur = cur.parent) chain.push(cur);
    for (let i = chain.length - 1; i >= 0; i--) {
      chain[i].updateMatrix();
      mat4.multiply(chain[i].matrix);
    }
    nrm3.getNormalMatrix(mat4);
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(mat4);
    if (!buckets.has(o.material)) buckets.set(o.material, { pos: [], norm: [], uv: [], renderOrder: o.renderOrder });
    const b = buckets.get(o.material);
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      b.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      b.norm.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      b.uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    geo.dispose();
  });
  root.clear();
  for (const [material, b] of buckets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = b.renderOrder;
    root.add(mesh);
  }
  return root;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
