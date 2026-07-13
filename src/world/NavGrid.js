import { MAP_HALF } from './Terrain.js';

/**
 * Coarse navigation grid (2 m cells) used by zombie pathfinding.
 *
 * Cells are blocked by building walls, props, barriers and impassably steep
 * ground. A* runs on a windowed sub-grid around start/goal so path queries
 * stay cheap; a per-frame budget in the AI keeps total cost bounded.
 */
export const NAV_CELL = 2;
const SIZE = (MAP_HALF * 2) / NAV_CELL; // 320

export class NavGrid {
  constructor(terrain) {
    this.terrain = terrain;
    this.blocked = new Uint8Array(SIZE * SIZE);
    this.height = new Float32Array(SIZE * SIZE);
  }

  index(cx, cz) { return cz * SIZE + cx; }
  toCell(x) { return Math.max(0, Math.min(SIZE - 1, Math.floor((x + MAP_HALF) / NAV_CELL))); }
  toWorld(c) { return c * NAV_CELL - MAP_HALF + NAV_CELL / 2; }

  /** Sample terrain heights + steepness once the world is built. */
  bake() {
    for (let cz = 0; cz < SIZE; cz++) {
      for (let cx = 0; cx < SIZE; cx++) {
        const x = this.toWorld(cx), z = this.toWorld(cz);
        const h = this.terrain.heightAt(x, z);
        this.height[this.index(cx, cz)] = h;
        const hx = this.terrain.heightAt(x + NAV_CELL, z);
        const hz = this.terrain.heightAt(x, z + NAV_CELL);
        if (Math.abs(hx - h) > 2.2 || Math.abs(hz - h) > 2.2) {
          this.blocked[this.index(cx, cz)] |= 2; // too steep
        }
      }
    }
  }

  blockBox(minX, minZ, maxX, maxZ) {
    for (let cx = this.toCell(minX); cx <= this.toCell(maxX); cx++) {
      for (let cz = this.toCell(minZ); cz <= this.toCell(maxZ); cz++) {
        this.blocked[this.index(cx, cz)] |= 1;
      }
    }
  }

  unblockBox(minX, minZ, maxX, maxZ) {
    for (let cx = this.toCell(minX); cx <= this.toCell(maxX); cx++) {
      for (let cz = this.toCell(minZ); cz <= this.toCell(maxZ); cz++) {
        this.blocked[this.index(cx, cz)] &= ~1;
      }
    }
  }

  isBlocked(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) return true;
    return this.blocked[this.index(cx, cz)] !== 0;
  }

  /**
   * A* from world (sx,sz) to (gx,gz). Returns an array of world waypoints
   * (excluding start) or null. Search is limited to a window around the
   * endpoints, so very long paths get a partial-toward-goal result.
   */
  findPath(sx, sz, gx, gz, maxWindow = 90) {
    const scx = this.toCell(sx), scz = this.toCell(sz);
    const gcx = this.toCell(gx), gcz = this.toCell(gz);
    const minX = Math.max(0, Math.min(scx, gcx) - 12);
    const minZ = Math.max(0, Math.min(scz, gcz) - 12);
    const maxX = Math.min(SIZE - 1, Math.max(scx, gcx) + 12);
    const maxZ = Math.min(SIZE - 1, Math.max(scz, gcz) + 12);
    const w = Math.min(maxX - minX + 1, maxWindow);
    const h = Math.min(maxZ - minZ + 1, maxWindow);

    const local = (cx, cz) => (cz - minZ) * w + (cx - minX);
    const inWin = (cx, cz) => cx >= minX && cx < minX + w && cz >= minZ && cz < minZ + h;
    if (!inWin(gcx, gcz) || !inWin(scx, scz)) return null;

    const g = new Float32Array(w * h).fill(Infinity);
    const from = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);
    const open = new MinHeap();
    g[local(scx, scz)] = 0;
    open.push(local(scx, scz), Math.hypot(gcx - scx, gcz - scz));

    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let goalNode = -1;
    let iterations = 0;
    while (open.size && iterations++ < 6000) {
      const cur = open.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ccx = (cur % w) + minX, ccz = Math.floor(cur / w) + minZ;
      if (ccx === gcx && ccz === gcz) { goalNode = cur; break; }
      for (const [dx, dz, cost] of DIRS) {
        const nx = ccx + dx, nz = ccz + dz;
        if (!inWin(nx, nz) || this.isBlocked(nx, nz)) continue;
        if (dx && dz && (this.isBlocked(ccx + dx, ccz) || this.isBlocked(ccx, ccz + dz))) continue; // no corner cutting
        const dh = Math.abs(this.height[this.index(nx, nz)] - this.height[this.index(ccx, ccz)]);
        if (dh > 1.6) continue;
        const n = local(nx, nz);
        const ng = g[cur] + cost + dh * 0.5;
        if (ng < g[n]) {
          g[n] = ng;
          from[n] = cur;
          open.push(n, ng + Math.hypot(gcx - nx, gcz - nz));
        }
      }
    }
    if (goalNode < 0) return null;

    const path = [];
    let node = goalNode;
    while (node >= 0 && from[node] >= 0) {
      const cx = (node % w) + minX, cz = Math.floor(node / w) + minZ;
      path.push([this.toWorld(cx), this.toWorld(cz)]);
      node = from[node];
    }
    path.reverse();
    return path.length ? path : null;
  }
}

class MinHeap {
  constructor() { this.keys = []; this.pris = []; }
  get size() { return this.keys.length; }
  push(k, p) {
    this.keys.push(k); this.pris.push(p);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pris[parent] <= this.pris[i]) break;
      this._swap(i, parent); i = parent;
    }
  }
  pop() {
    const top = this.keys[0];
    const lastK = this.keys.pop(), lastP = this.pris.pop();
    if (this.keys.length) {
      this.keys[0] = lastK; this.pris[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.pris[l] < this.pris[m]) m = l;
        if (r < this.keys.length && this.pris[r] < this.pris[m]) m = r;
        if (m === i) break;
        this._swap(i, m); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.pris[a], this.pris[b]] = [this.pris[b], this.pris[a]];
  }
}
