/**
 * Static + dynamic axis-aligned collision world.
 *
 * All building walls, props and zone barriers register AABBs here. Entities
 * resolve as vertical capsules (circle on XZ with a height range). A uniform
 * hash grid keeps queries cheap.
 */
const CELL = 8;

export class CollisionWorld {
  constructor() {
    this.boxes = [];        // {minX,minY,minZ,maxX,maxY,maxZ, id, tag}
    this.grid = new Map();  // "cx,cz" -> indices into boxes
    this._nextId = 1;
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, tag = '') {
    const box = { minX, minY, minZ, maxX, maxY, maxZ, id: this._nextId++, tag, active: true };
    const idx = this.boxes.length;
    this.boxes.push(box);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = cx + ',' + cz;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(idx);
      }
    }
    return box.id;
  }

  /** Center + half-extent convenience form. */
  addBoxCentered(x, y, z, hx, hy, hz, tag = '') {
    return this.addBox(x - hx, y - hy, z - hz, x + hx, y + hy, z + hz, tag);
  }

  remove(id) {
    const box = this.boxes.find((b) => b.id === id);
    if (box) box.active = false;
  }

  /** Re-activate a box previously turned off with remove() (same id + bounds). */
  restore(id) {
    const box = this.boxes.find((b) => b.id === id);
    if (box) box.active = true;
  }

  _candidates(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const seen = new Set();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const cell = this.grid.get(cx + ',' + cz);
        if (!cell) continue;
        for (const i of cell) {
          if (!seen.has(i)) { seen.add(i); out.push(this.boxes[i]); }
        }
      }
    }
    return out;
  }

  /**
   * Push a capsule (feet at y, radius r, height h) out of all boxes on XZ.
   * Mutates and returns pos {x, y, z}.
   */
  resolveCapsule(pos, r, h) {
    const cand = this._candidates(pos.x - r - 1, pos.z - r - 1, pos.x + r + 1, pos.z + r + 1, this._scratch ??= []);
    for (let pass = 0; pass < 2; pass++) {
      for (const b of cand) {
        if (!b.active) continue;
        if (pos.y + h < b.minY + 0.3 || pos.y + 0.4 > b.maxY) continue; // can step over low / walk under high
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          // Center inside the box: push out along the shallowest axis.
          const pushW = pos.x - b.minX + r, pushE = b.maxX - pos.x + r;
          const pushN = pos.z - b.minZ + r, pushS = b.maxZ - pos.z + r;
          const m = Math.min(pushW, pushE, pushN, pushS);
          if (m === pushW) pos.x = b.minX - r;
          else if (m === pushE) pos.x = b.maxX + r;
          else if (m === pushN) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      }
    }
    return pos;
  }

  /**
   * Raycast against boxes near the segment. Returns nearest hit distance or
   * Infinity. origin/dir are {x,y,z}; dir need not be normalised beyond
   * caller intent. Candidates come from the broadphase grid over the ray's
   * XZ bounds, which keeps the (many) furniture/wall boxes cheap to test.
   */
  raycast(origin, dir, maxDist) {
    let best = Infinity;
    let boxes = this.boxes;
    if (Number.isFinite(maxDist)) {
      const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
      boxes = this._candidates(Math.min(origin.x, ex), Math.min(origin.z, ez),
        Math.max(origin.x, ex), Math.max(origin.z, ez), this._castScratch ??= []);
    }
    for (const b of boxes) {
      if (!b.active) continue;
      const t = raySlab(origin, dir, b, maxDist);
      if (t < best) best = t;
    }
    return best;
  }

  /**
   * Cast several short rays from one origin and return the nearest hit
   * distance per direction (or maxDist if clear). Uses the broadphase grid so
   * whisker probing stays cheap: candidates are gathered once for the whole
   * fan, since all rays share the same small neighbourhood.
   * dir vectors are {x,y,z} of unit length; results are in world units.
   */
  probe(origin, dirs, maxDist) {
    const r = maxDist + 0.5;
    const cand = this._candidates(origin.x - r, origin.z - r, origin.x + r, origin.z + r, this._rayScratch ??= []);
    const out = [];
    for (const d of dirs) {
      let best = maxDist;
      for (const b of cand) {
        if (!b.active) continue;
        const t = raySlab(origin, d, b, maxDist);
        if (t < best) best = t;
      }
      out.push(best);
    }
    return out;
  }

  /** True if a straight segment is blocked by any box. */
  segmentBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    const o = { x: ax, y: ay, z: az };
    const d = { x: dx / len, y: dy / len, z: dz / len };
    return this.raycast(o, d, len) < len;
  }
}

function raySlab(o, d, b, maxDist) {
  let tmin = 0, tmax = maxDist;
  for (const [oc, dc, mn, mx] of [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, b.minY, b.maxY],
    [o.z, d.z, b.minZ, b.maxZ],
  ]) {
    if (Math.abs(dc) < 1e-9) {
      if (oc < mn || oc > mx) return Infinity;
    } else {
      let t1 = (mn - oc) / dc, t2 = (mx - oc) / dc;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}
