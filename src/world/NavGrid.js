import { MAP_HALF } from './Terrain.js';

/**
 * Coarse navigation grid (2 m cells) used by NPC pathfinding, with explicit
 * doorway portals carved through it.
 *
 * Cells are blocked by building walls, props, barriers and impassably steep
 * ground. A* runs on a windowed sub-grid around start/goal so path queries
 * stay cheap; a per-frame budget in the AI keeps total cost bounded.
 *
 * ---- why portals exist ----------------------------------------------------
 * Every wall segment registers its AABB with blockBox(), which rounds out to
 * whole cells. A doorway is a 1.5 m gap between two wall segments and a
 * partition gap is ~1.2 m — both narrower than one 2 m cell, so the two
 * segments' rounded-out blocks always meet in the middle and seal the opening.
 * The grid alone therefore models every building as a solid block with no way
 * in or out, and A* can only ever answer "no path" for an agent inside one.
 *
 * The fix is to stop inferring doorways from wall geometry and instead let the
 * builder declare them. addPortal() is handed the opening's exact centre,
 * facing normal and width; it carves a short corridor of cells straight
 * through the wall line and stamps them PORTAL, which makes them permanently
 * immune to later blockBox() calls (a neighbouring building or a prop placed
 * afterwards can no longer re-seal a door). Path reconstruction then replaces
 * any portal cell's centre with the portal's own coordinates, so a route
 * through a door aims at the real 1.5 m opening rather than at the middle of
 * the 2 m cell that contains it — the difference between threading a doorway
 * and walking into the jamb beside it.
 */
export const NAV_CELL = 2;
const SIZE = (MAP_HALF * 2) / NAV_CELL; // 320

const BLOCK_STATIC = 1;  // walls, props, barriers
const BLOCK_STEEP = 2;   // terrain too steep to walk
const PORTAL = 4;        // carved doorway — statics may never re-block it
const IMPASSABLE = BLOCK_STATIC | BLOCK_STEEP;
// How far either side of an opening's centre gets carved. Walls here are ~0.32 m
// thick, so this comfortably spans the wall (and both cells when the opening sits
// on a cell boundary) without reaching the cell beyond it. See addPortal().
const CARVE_REACH = 0.7;

export class NavGrid {
  constructor(terrain) {
    this.terrain = terrain;
    this.blocked = new Uint8Array(SIZE * SIZE);
    this.height = new Float32Array(SIZE * SIZE);
    /** @type {{x:number,z:number,nx:number,nz:number,width:number,tag:string}[]} */
    this.portals = [];
    // cell -> index into portals (-1 = none), used to snap path waypoints onto
    // the real opening instead of the containing cell's centre.
    this.portalOf = new Int32Array(SIZE * SIZE).fill(-1);
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
          this.blocked[this.index(cx, cz)] |= BLOCK_STEEP; // too steep
        }
      }
    }
  }

  /**
   * Mark a rectangle impassable. Carved portal cells are skipped so a wall,
   * prop or barrier registered later can never seal a declared doorway;
   * `force` overrides that for things that genuinely close a route off
   * (district barriers), which are removed again by unblockBox().
   */
  blockBox(minX, minZ, maxX, maxZ, force = false) {
    for (let cx = this.toCell(minX); cx <= this.toCell(maxX); cx++) {
      for (let cz = this.toCell(minZ); cz <= this.toCell(maxZ); cz++) {
        const i = this.index(cx, cz);
        if (!force && (this.blocked[i] & PORTAL)) continue;
        this.blocked[i] |= BLOCK_STATIC;
      }
    }
  }

  unblockBox(minX, minZ, maxX, maxZ) {
    for (let cx = this.toCell(minX); cx <= this.toCell(maxX); cx++) {
      for (let cz = this.toCell(minZ); cz <= this.toCell(maxZ); cz++) {
        this.blocked[this.index(cx, cz)] &= ~BLOCK_STATIC;
      }
    }
  }

  /**
   * Declare a traversable opening in a wall: `(x, z)` is the centre of the gap,
   * `(nx, nz)` the unit normal pointing out through it, `width` the clear span.
   *
   * Carves a corridor of cells running from a little inside to a little outside
   * the wall line, spanning the opening, and stamps them PORTAL so nothing can
   * block them again. Call it AFTER the wall segments either side have been
   * registered — they are what closes the gap in the first place.
   */
  addPortal(x, z, nx, nz, width = 1.5, tag = 'door') {
    const len = Math.hypot(nx, nz) || 1;
    const ux = nx / len, uz = nz / len;
    const tx = -uz, tz = ux;             // tangent along the wall
    const p = { x, z, nx: ux, nz: uz, width, tag };
    const pi = this.portals.length;
    this.portals.push(p);

    // Carve only as far along the normal as it takes to cover the WALL — the
    // cell the opening is cut into, plus the second one when the opening
    // straddles a cell boundary. Reaching further is actively wrong at this
    // resolution: clearing a cell claims all 4 m² of it is walkable, so a carve
    // that spilled into the next cell along could open one that holds a
    // completely different wall, and A* would happily route through the hole
    // that isn't there. The floor either side of a doorway is ordinary open
    // ground and needs no help from us.
    const half = Math.max(0.3, width / 2 - 0.25);
    for (const s of [-CARVE_REACH, -CARVE_REACH / 2, 0, CARVE_REACH / 2, CARVE_REACH]) {
      for (const t of [-half, 0, half]) {
        const i = this.index(this.toCell(x + ux * s + tx * t), this.toCell(z + uz * s + tz * t));
        this.blocked[i] &= ~IMPASSABLE;
        this.blocked[i] |= PORTAL;
        if (this.portalOf[i] < 0) this.portalOf[i] = pi;
      }
    }

    // The approach either side. These are ordinary floor and pavement, so they
    // are not carved — but they ARE pinned open, so a tree, a bench or a
    // neighbouring building registered later cannot land its rounded-out 2 m
    // block on the one cell you have to stand in to use the door. Anything
    // already solid here is left alone: a door that genuinely opens onto a wall
    // stays shut rather than being wished open.
    for (const s of [-NAV_CELL, -NAV_CELL / 2, NAV_CELL / 2, NAV_CELL]) {
      for (const t of [-half, 0, half]) {
        const i = this.index(this.toCell(x + ux * s + tx * t), this.toCell(z + uz * s + tz * t));
        if (this.blocked[i] & IMPASSABLE) continue;
        this.blocked[i] |= PORTAL;
      }
    }
    return p;
  }

  isBlocked(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) return true;
    return (this.blocked[this.index(cx, cz)] & IMPASSABLE) !== 0;
  }

  /** True if the cell containing this world point is impassable. */
  isBlockedAt(x, z) { return this.isBlocked(this.toCell(x), this.toCell(z)); }

  /**
   * Nearest walkable cell to a world point, searched in growing rings.
   *
   * Both ends of a path routinely land on a blocked cell — an agent standing
   * against an interior wall, or a player backed into a corner — and without
   * this A* would simply report "no path" for the most common case there is.
   * Returns the cell centre, or null if nothing is open within `maxCells`.
   */
  nearestOpen(x, z, maxCells = 5) {
    const cx = this.toCell(x), cz = this.toCell(z);
    if (!this.isBlocked(cx, cz)) return { x, z, cx, cz };
    for (let r = 1; r <= maxCells; r++) {
      let best = null, bestD = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
          const nx = cx + dx, nz = cz + dz;
          if (this.isBlocked(nx, nz)) continue;
          const wx = this.toWorld(nx), wz = this.toWorld(nz);
          const d = (wx - x) * (wx - x) + (wz - z) * (wz - z);
          if (d < bestD) { bestD = d; best = { x: wx, z: wz, cx: nx, cz: nz }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Closest declared doorway to a world point, within `maxDist`. Agents use
   * this to make for an exit when they have no path at all — the reliable way
   * out of a building whose route the grid could not resolve. Pass `tag` to
   * restrict the search (e.g. 'door' for a way OUT rather than the interior
   * gap that happens to be nearer), and `exclude` to pass over the one that
   * has just been tried and did not help.
   */
  nearestPortal(x, z, maxDist = 30, tag = null, exclude = null) {
    let best = null, bestD = maxDist * maxDist;
    for (const p of this.portals) {
      if (tag && p.tag !== tag) continue;
      if (exclude && p === exclude) continue;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /**
   * A* from world (sx,sz) to (gx,gz). Returns an array of waypoints
   * `[x, z, portal]` (excluding the start) or null, where `portal` is the
   * doorway record for a waypoint that IS a doorway (and undefined otherwise) —
   * followers need its normal to tell whether they are through it yet.
   *
   * Blocked endpoints snap to the nearest walkable cell, and the search window
   * is centred so a goal far away yields a partial route toward it instead of
   * silently failing.
   */
  findPath(sx, sz, gx, gz, maxWindow = 90) {
    const start = this.nearestOpen(sx, sz);
    const goal = this.nearestOpen(gx, gz);
    if (!start || !goal) return null;
    const scx = start.cx, scz = start.cz;
    let gcx = goal.cx, gcz = goal.cz;

    // Keep both endpoints inside a window no larger than maxWindow. When the
    // goal is too far, walk it back along the straight line until it fits so
    // the agent still gets a partial route pointing the right way.
    const fit = (a, b) => {
      const span = Math.abs(b - a) + 25;
      if (span <= maxWindow) return b;
      const room = maxWindow - 25;
      return a + Math.sign(b - a) * room;
    };
    gcx = Math.max(0, Math.min(SIZE - 1, fit(scx, gcx)));
    gcz = Math.max(0, Math.min(SIZE - 1, fit(scz, gcz)));

    const minX = Math.max(0, Math.min(scx, gcx) - 12);
    const minZ = Math.max(0, Math.min(scz, gcz) - 12);
    const maxX = Math.min(SIZE - 1, Math.max(scx, gcx) + 12);
    const maxZ = Math.min(SIZE - 1, Math.max(scz, gcz) + 12);
    const w = maxX - minX + 1;
    const h = maxZ - minZ + 1;

    const local = (cx, cz) => (cz - minZ) * w + (cx - minX);
    const inWin = (cx, cz) => cx >= minX && cx <= maxX && cz >= minZ && cz <= maxZ;
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
    let lastPortal = -1;
    while (node >= 0 && from[node] >= 0) {
      const cx = (node % w) + minX, cz = Math.floor(node / w) + minZ;
      const i = this.index(cx, cz);
      const pi = this.portalOf[i];
      if (pi >= 0 && (this.blocked[i] & PORTAL)) {
        // Aim at the opening itself, not the middle of the cell containing it,
        // and emit one waypoint per doorway however many of its cells the route
        // happens to cross.
        if (pi !== lastPortal) {
          const p = this.portals[pi];
          path.push([p.x, p.z, p]);
          lastPortal = pi;
        }
      } else {
        lastPortal = -1;
        path.push([this.toWorld(cx), this.toWorld(cz)]);
      }
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
