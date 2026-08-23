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
 *   roof: 'gable' | 'hip' | 'flat' | 'shed'
 *   ridge: 'x' | 'z'                  gable/hip ridge axis (default: long axis)
 *   roofPitch: number                 rise per half-span; steeper sheds snow
 *   shedTo: 'N'|'S'|'E'|'W'           which way a shed roof drains
 *   dormers: number                   dormer windows on the street-facing slope
 *   chimney: true                     residential detail on gable roofs
 *   porch: true | {depth, width}      covered porch over the door
 *   doorTex: 'doorWood' | 'doorMetal' | 'doorShop'
 *   doorW: number                     opening width (garage bays are wider)
 *   shopfront: true                   display windows + no ground windows on
 *                                     the door side
 *   awning: true                      canvas awnings over door/shopfront
 *   derelict: 0..1                    drives broken + boarded window mix
 *   foundation: false                 suppress the footing plinth
 *   windowPitch: number               spacing between windows within a bay
 *   foundationTex/trimTex/windowTex   from the building's material set
 *                                     (src/world/Materials.js)
 *   partitions: [{axis:'x'|'z', at, from, to, gapAt, gapW, tex}]
 *                                     interior walls with door gaps (local
 *                                     coordinates), colliding like real walls
 *
 * ARTICULATION — the difference between a building and a box. A prism with a
 * good texture on it is still a prism; what stops one reading as a block is
 * relief you can see the shadow of from across a square, and a silhouette
 * that is not a single rectangle. These are opt-in per spec because a garage
 * on a back lane genuinely IS a box and should stay one:
 *   pilasters: true                   corner strips with a moulded capital,
 *                                     standing proud the whole height
 *   parapet: true|number              flat roofs only: a real cornice with a
 *                                     dentil course, a parapet wall over it
 *                                     and a coping on top of that
 *   entrance: 'portico'|'hood'        the door gets emphasis — a pedimented
 *                                     portico on columns, or a bracketed hood
 *   bay: true|{side, at, width, top}  a canted bay window projecting from an
 *                                     elevation (default: the door's), with
 *                                     its own moulded base and lead roof
 *   wing: {side, w, d, h, roof}       a LOWER attached volume, so the massing
 *                                     is two shapes rather than one. Carries
 *                                     its own collider and nav block, which is
 *                                     what keeps collision honest to the model
 */
const WALL_T = 0.32;
export const DOOR_W = 1.5;
const DOOR_H = 2.3;
const TEXEL = 0.5; // uv units per metre
// Footing plinth: proud of the wall face, buried deep enough that a building
// still meets the ground where its pad blends into sloping terrain.
//
// Every band that wraps a facade — this, the water table, the belt courses,
// the window sills — reaches inward only as far as the MIDDLE of the wall it
// sits on. Past that it emerges through the interior floor plate and lays a
// knee-high concrete kerb around the inside of the room, which is what a
// deeper plinth was doing. Outward projection is what makes a footing read;
// inward projection just puts a step in the lounge.
const PLINTH_OUT = 0.09;   // how far it stands proud of the wall
const PLINTH_TOP = 0.26;   // visible height above grade
const PLINTH_DEEP = 1.1;   // depth below grade
const STOREY = 2.7;        // window-row pitch; belt courses land between rows

export class BuildingKit {
  constructor(texLib, collision, nav, terrain) {
    this.texLib = texLib;
    this.collision = collision;
    this.nav = nav;
    this.terrain = terrain;
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
   * Returns { group, lootPoints[], spawnPoints[], doorWorld, porch }.
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
    let porch = null;              // deck rect + post positions, for prop placement
    const windowBatch = new Map(); // texture -> quad list, merged per building

    // ---- foundation ---------------------------------------------------
    // A footing plinth in the building's own foundation material, standing
    // proud of the wall and buried a metre deep, so the building visibly
    // MEETS the ground instead of being set down on it. Built as a ring of
    // four bands (a solid box would push a step up through the floor plate
    // inside); the ring's inner face is flush with the wall's inner face, so
    // it never eats into the room. No collider — it hugs the wall line.
    const foundTex = spec.foundationTex || 'concrete';
    if (spec.foundation !== false) {
      const ph = PLINTH_TOP + PLINTH_DEEP;
      this._facadeBand(group, spec, w, d, PLINTH_TOP - ph / 2, ph, PLINTH_OUT, foundTex);
      // water table: the trim course capping the plinth
      this._trimBand(group, spec, w, d, PLINTH_TOP + 0.06, 0.12, PLINTH_OUT + 0.05);
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
        for (const side of sides) this._windows(group, windowBatch, side, spec, h, rand, derelict, null);
      }
    } else {
      const doorW = spec.doorW ?? DOOR_W;
      for (const side of sides) {
        const hasDoor = spec.door === side.id;
        if (!hasDoor) {
          this._wallSegment(group, spec, rot, side, -side.len / 2, side.len / 2, 0, h, wallTex);
        } else {
          const doorOff = (spec.doorOffset ?? 0) * side.len * 0.5;
          const a = doorOff - doorW / 2, b = doorOff + doorW / 2;
          this._wallSegment(group, spec, rot, side, -side.len / 2, a, 0, h, wallTex);
          this._wallSegment(group, spec, rot, side, b, side.len / 2, 0, h, wallTex);
          this._wallSegment(group, spec, rot, side, a, b, DOOR_H, h - DOOR_H, wallTex, DOOR_H);
          // Door leaf hanging open against the inside wall.
          const doorTex = spec.doorTex || 'doorWood';
          const leaf = new THREE.Mesh(new THREE.PlaneGeometry(doorW * 0.95, DOOR_H * 0.95), this.mat(doorTex, { side: THREE.DoubleSide }));
          const s = side.axis === 'x' ? [a + 0.1, DOOR_H / 2, side.cz - Math.sign(side.cz) * 0.5] : [side.cx - Math.sign(side.cx) * 0.5, DOOR_H / 2, a + 0.1];
          leaf.position.set(s[0], s[1], s[2]);
          leaf.rotation.y = side.axis === 'x' ? Math.PI / 2.3 : 0.2;
          group.add(leaf);
          if (spec.porch) porch = this._porch(group, spec, rot, side, doorOff, h);
          if (spec.awning) {
            this._awning(group, side, doorOff, doorW + 1.0);
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
          this._windows(group, windowBatch, side, spec, h, rand, derelict, hasDoor ? (spec.doorOffset ?? 0) * side.len * 0.5 : null);
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

    // ---- trim -------------------------------------------------------
    // A belt course between storeys and a cornice under the eaves. These are
    // what give a tall wall a horizontal beat: without them a nine-metre
    // facade reads as one flat slab no matter how good its texture is.
    if (spec.trim !== false) {
      for (let y = STOREY + 0.55; y < h - 1.0; y += STOREY) {
        this._trimBand(group, spec, w, d, y, 0.22, 0.1);
      }
      const corniceY = h - (roofKindOf(spec) === 'flat' ? 0.34 : 0.24);
      this._trimBand(group, spec, w, d, corniceY, 0.34, 0.2);
    }

    // ---- roof -------------------------------------------------------
    const roofKind = spec.roof || 'gable';
    const roofTex = spec.roofTex || (roofKind === 'gable' || roofKind === 'hip' ? 'roofShingle' : 'roofTar');
    if (roofKind === 'gable') {
      this._gableRoof(group, spec, w, d, h, roofTex, wallTex);
    } else if (roofKind === 'hip') {
      this._hipRoof(group, spec, w, d, h, roofTex);
    } else if (roofKind === 'shed') {
      this._shedRoof(group, spec, w, d, h, roofTex, wallTex);
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

    // ---- articulation ------------------------------------------------
    // Relief on the walls, a real head on a flat roof, emphasis at the door
    // and a second volume in the massing. All opt-in; see the spec notes.
    if (spec.pilasters) this._pilasters(group, spec, w, d, h);
    if (spec.parapet && (spec.roof || 'gable') === 'flat') this._parapet(group, spec, w, d, h, wallTex);
    if (spec.entrance && spec.door) {
      const side = sides.find((sd) => sd.id === spec.door);
      if (side) this._entrance(group, spec, side, (spec.doorOffset ?? 0) * side.len * 0.5, h);
    }
    if (spec.bay) {
      // A bay belongs on whatever elevation the spec names; it falls back to
      // the door's wall, which is where a front bay goes on a wide frontage
      // and is exactly wrong on a narrow one — hence the option.
      const want = (spec.bay === true ? null : spec.bay.side) || spec.door;
      const side = sides.find((sd) => sd.id === want);
      if (side) this._bayWindow(group, spec, side, h, wallTex);
    }
    if (spec.wing) this._wing(group, spec, rot, w, d, h, wallTex);
    if (spec.rainwater !== false && (spec.roof || 'gable') !== 'flat') {
      this._rainwater(group, spec, w, d, h);
    }

    const doorWorld = spec.door
      ? local2world(spec, rot, spec.door === 'E' ? w / 2 : spec.door === 'W' ? -w / 2 : (spec.doorOffset ?? 0) * w * 0.5,
                    spec.door === 'S' ? d / 2 : spec.door === 'N' ? -d / 2 : (spec.doorOffset ?? 0) * d * 0.5)
      : null;

    // ---- navigation portals -------------------------------------------
    // The walls above sealed every opening on the nav grid (a 1.5 m door and a
    // 1.2 m partition gap are both narrower than one 2 m cell, so the blocks
    // either side always meet in the middle). Declare the openings we just
    // built from the very coordinates we built them from, now that those walls
    // are registered, so pathing can actually route in and out of the building.
    const portals = spec.solid ? [] : this._registerPortals(spec, rot, doorWorld);

    return { group, lootPoints, spawnPoints, doorWorld, portals, porch };
  }

  /**
   * Carve the building's exterior door and every interior partition gap into
   * the nav grid, and hand the list back so NPCs can route through the exact
   * same points (see Citizen's escape chain).
   */
  _registerPortals(spec, rot, doorWorld) {
    const portals = [];
    if (doorWorld) {
      const side = spec.door;
      const n = localDir2world(rot,
        side === 'E' ? 1 : side === 'W' ? -1 : 0,
        side === 'S' ? 1 : side === 'N' ? -1 : 0);
      portals.push(this.nav.addPortal(doorWorld.x, doorWorld.z, n.x, n.z, spec.doorW ?? DOOR_W, 'door'));
    }
    for (const p of spec.partitions ?? []) {
      const gapAt = p.gapAt ?? (p.from + p.to) / 2;
      const [lx, lz] = p.axis === 'x' ? [gapAt, p.at] : [p.at, gapAt];
      const world = local2world(spec, rot, lx, lz);
      // The gap's normal is perpendicular to the wall it sits in: an 'x' axis
      // partition runs along local X, so you pass through it along local Z.
      const n = localDir2world(rot, p.axis === 'x' ? 0 : 1, p.axis === 'x' ? 1 : 0);
      portals.push(this.nav.addPortal(world.x, world.z, n.x, n.z, p.gapW ?? 1.2, 'gap'));
    }
    return portals;
  }

  /**
   * A horizontal band wrapped round all four facades at height `y`: water
   * table, belt course or cornice depending on where it is called from.
   * Four boxes rather than one, so no band ever crosses the interior.
   */
  _trimBand(group, spec, w, d, y, thick, out) {
    this._facadeBand(group, spec, w, d, y, thick, out, spec.trimTex || 'trimStone');
  }

  /**
   * A band wrapped round all four facades at height `y`: the footing plinth,
   * the water table above it, a belt course between storeys, or the cornice.
   *
   * Two rules, both learned the hard way. The band reaches inward only as far
   * as the middle of the wall it sits on — level with the wall's inner face it
   * z-fights and paints the bottom of the interior wall in foundation
   * concrete, and past it, it juts into the room as a kerb. And any band low
   * enough to cross a doorway is broken either side of the opening, because a
   * water table running across a threshold is a lip you appear to step over.
   */
  _facadeBand(group, spec, w, d, y, thick, out, tex) {
    const band = WALL_T / 2 + out;             // wall mid-plane to outside
    const off = (out - WALL_T / 2) / 2;        // ...centred on that span
    const low = y - thick / 2 < DOOR_H;        // does it cross the door head?
    const sides = [
      { id: 'S', bx: 0, bz: d / 2 + off, along: 'x', len: w },
      { id: 'N', bx: 0, bz: -d / 2 - off, along: 'x', len: w },
      { id: 'E', bx: w / 2 + off, bz: 0, along: 'z', len: d },
      { id: 'W', bx: -w / 2 - off, bz: 0, along: 'z', len: d },
    ];
    for (const s of sides) {
      const L = s.len + out * 2;
      const gap = low && spec.door === s.id ? (spec.doorW ?? DOOR_W) / 2 + 0.14 : 0;
      const at = gap ? (spec.doorOffset ?? 0) * s.len * 0.5 : 0;
      const runs = gap
        ? [[-L / 2, at - gap], [at + gap, L / 2]]
        : [[-L / 2, L / 2]];
      for (const [a, b] of runs) {
        if (b - a < 0.05) continue;
        const mid = (a + b) / 2, len = b - a;
        const seg = s.along === 'x' ? this.box(len, thick, band, tex) : this.box(band, thick, len, tex);
        seg.position.set(s.along === 'x' ? mid : s.bx, y, s.along === 'x' ? s.bz : mid);
        group.add(seg);
      }
    }
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
   * Where the interior partitions meet this facade, in the wall's own
   * along-axis coordinate.
   *
   * A partition declared `axis:'x'` runs along local X at z = at, so it lands
   * on the E and W walls (which run along Z) at coordinate `at` — and only if
   * it actually reaches them. This is the whole basis of window alignment: a
   * window centred on one of these coordinates would be a window with an
   * interior wall down the middle of it, which is the single most obvious way
   * a generated building gives itself away from the inside.
   */
  _wallJunctions(spec, side) {
    const cuts = [];
    const half = side.axis === 'x' ? spec.d / 2 : spec.w / 2;   // wall this side sits at
    const reach = side.axis === 'x' ? spec.w / 2 : spec.d / 2;  // wall this side spans
    for (const p of spec.partitions ?? []) {
      // A partition only crosses a facade it runs INTO, so an 'x' partition
      // can only meet the walls that run along Z, and vice versa.
      const meets = side.axis === 'x' ? p.axis === 'z' : p.axis === 'x';
      if (!meets) continue;
      // ...and only if its span actually runs out as far as this wall.
      const near = side.id === 'S' || side.id === 'E' ? half : -half;
      if (near > 0 ? p.to < near - 0.7 : p.from > near + 0.7) continue;
      if (Math.abs(p.at) < reach - 0.4) cuts.push(p.at);
    }
    return cuts;
  }

  /**
   * Windows for one facade, laid out ROOM BY ROOM.
   *
   * The facade is first cut into bays at every point where an interior
   * partition lands on it (see _wallJunctions) and, on the ground floor, at
   * the doorway. Each bay is then glazed on its own: a bay narrower than a
   * window gets none, a wide one gets several evenly spaced. That is what
   * makes the elevation agree with the plan — every window belongs to exactly
   * one room, and no wall inside the building runs through a pane.
   *
   * Rows stack every 2.7 m so tall buildings read as multi-storey; the
   * derelict factor mixes in broken and boarded panes. A shopfront door side
   * swaps its ground row for wide display windows. Quads are batched per
   * texture and merged into one mesh per building.
   *
   * Intact glass comes from the building's material set (`spec.windowTex`):
   * curtains behind a house's sashes, shuttered sashes on a suburban street,
   * dark grid glass in an office, leaded lights in a church. Every opening
   * also gets a real sill and lintel in the trim material — a hole in a wall
   * does not read as a window without them.
   */
  _windows(group, batch, side, spec, h, rand, derelict, doorOff) {
    const out = Math.sign(side.cx + side.cz) * (WALL_T / 2 + 0.03);
    const shopSide = !!spec.shopfront && spec.door === side.id;
    const glass = spec.windowTex || 'window';
    const doorW = spec.doorW ?? DOOR_W;
    const pitch = spec.windowPitch ?? 3.6;
    const rows = [];
    for (let yRow = Math.min(h - 1.1, 1.9); yRow <= h - 1.3; yRow += STOREY) rows.push(yRow);
    if (!rows.length) rows.push(Math.min(h - 1.1, 1.9));
    const junctions = this._wallJunctions(spec, side);
    for (let ri = 0; ri < rows.length; ri++) {
      if (shopSide && ri === 0) continue;
      // Every interior wall landing on this facade blocks out a strip of it,
      // and on the ground floor the doorway blocks out another.
      const blocks = junctions.map((j) => [j - 0.42, j + 0.42]);
      if (ri === 0 && doorOff !== null) blocks.push([doorOff - doorW / 2 - 0.75, doorOff + doorW / 2 + 0.75]);
      for (const [a, b] of this._bays(side.len, blocks)) {
        const len = b - a;
        const n = Math.max(1, Math.floor((len - 0.6) / pitch));
        for (let i = 0; i < n; i++) {
          const at = a + len * (i + 0.5) / n;
          const r = rand();
          const tex = r < derelict * 0.45 ? 'windowBroken' : r < derelict * 0.8 ? 'windowBoarded' : glass;
          this._pushQuad(batch, tex, side, at, rows[ri], out, 1.2, 1.3);
          this._surround(group, spec, side, at, rows[ri], 1.2, 1.3);
        }
      }
    }
    if (shopSide) {
      const doorAt = doorOff ?? 0;
      for (const sgn of [-1, 1]) {
        const at = doorAt + sgn * (doorW / 2 + 2.0);
        if (Math.abs(at) + 1.7 > side.len / 2 - 0.4) continue;
        const tex = rand() < derelict * 0.5 ? 'windowBoarded' : 'windowShop';
        const qw = tex === 'windowShop' ? 3.0 : 1.4;
        this._pushQuad(batch, tex, side, at, 1.35, out, qw, 1.5);
        this._surround(group, spec, side, at, 1.35, qw, 1.5);
      }
    }
  }

  /**
   * Split a wall of length `len` into glazable bays, given the spans that are
   * spoken for (interior walls, the doorway). Corners keep 0.85 m clear — or
   * proportionally less on a wall too short to afford it, which is what lets a
   * garden shed have a window at all — and a bay under 1.8 m has no room for a
   * window with its sill and lintel, so it is dropped rather than squeezed.
   */
  _bays(len, blocks) {
    const margin = Math.min(0.85, len * 0.22);
    const lo = -len / 2 + margin, hi = len / 2 - margin;
    const bays = [];
    let s = lo;
    for (const [a, b] of [...blocks].sort((p, q) => p[0] - q[0])) {
      if (b <= lo || a >= hi) continue;
      if (a - s >= 1.8) bays.push([s, a]);
      s = Math.max(s, b);
    }
    if (hi - s >= 1.8) bays.push([s, hi]);
    return bays;
  }

  /** Sill under an opening and lintel over it, in the building's trim. */
  _surround(group, spec, side, at, yMid, qw, qh) {
    if (spec.trim === false) return;
    const tex = spec.trimTex || 'trimStone';
    const out = Math.sign(side.cx + side.cz);
    const proud = WALL_T / 2 + 0.1;
    for (const [dy, th, over] of [[-qh / 2 - 0.06, 0.12, 0.34], [qh / 2 + 0.06, 0.12, 0.24]]) {
      const len = qw + over;
      const seg = side.axis === 'x'
        ? this.box(len, th, WALL_T * 0.5 + 0.1, tex)
        : this.box(WALL_T * 0.5 + 0.1, th, len, tex);
      const lx = side.axis === 'x' ? at : side.cx + out * (proud - (WALL_T * 0.5 + 0.1) / 2);
      const lz = side.axis === 'x' ? side.cz + out * (proud - (WALL_T * 0.5 + 0.1) / 2) : at;
      seg.position.set(lx, yMid + dy, lz);
      group.add(seg);
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

  /**
   * How far a pitched roof rises over half its span.
   *
   * Climate logic, and it is not decoration: this town gets snow. A shallow
   * roof holds it, a steep one drops it, so anything that has to shrug off a
   * winter — every house on the exposed Eastgate knoll — pitches steeply
   * (`roofPitch` up around 0.45 of the span), while a commercial box downtown
   * that gets swept by somebody stays at the gentler default. The absolute cap
   * keeps a wide building from growing a spire.
   */
  _roofRise(spec, span) {
    return Math.min(spec.roofCap ?? 2.6, span * (spec.roofPitch ?? 0.3));
  }

  _gableRoof(group, spec, w, d, h, roofTex, wallTex) {
    // The ridge runs along the long axis so both slopes shed to the eaves;
    // specs can pin `ridge` explicitly.
    const ridge = spec.ridge ?? (w > d ? 'x' : 'z');
    const rw = ridge === 'x' ? d : w, rd = ridge === 'x' ? w : d;
    const rg = new THREE.Group();
    const rise = this._roofRise(spec, rw);
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
    if (spec.dormers) this._dormers(rg, spec, ridge, rw, rd, h, rise, roofTex, wallTex);
    if (ridge === 'x') rg.rotation.y = Math.PI / 2;
    group.add(rg);
  }

  /**
   * Dormer windows punched through the street-facing slope.
   *
   * The one detail that most separates a house from a shed at fifty metres:
   * it says there is a floor up there under the roof. Only the slope that
   * faces the front door gets them — a dormer over the back garden is
   * somebody else's view — so a building whose door is in a gable end gets
   * none, which is correct.
   *
   * Coordinates are the gable group's own: local +X is the E facade when the
   * ridge runs along Z, and (because the group is later yawed by 90°) the N
   * facade when it runs along X.
   */
  _dormers(rg, spec, ridge, rw, rd, h, rise, roofTex, wallTex) {
    const facing = ridge === 'z'
      ? { E: 1, W: -1 }[spec.door]
      : { N: 1, S: -1 }[spec.door];
    if (!facing) return;                     // door is in a gable end
    const n = Math.min(spec.dormers, Math.floor(rd / 3.2));
    if (n < 1) return;
    const dw = 1.5, dh = 1.25;
    const slope = Math.atan2(rise, rw / 2 + 0.3);
    for (let i = 0; i < n; i++) {
      const along = rd * ((i + 0.5) / n - 0.5);
      const g = new THREE.Group();
      // seat the box astride the slope, a third of the way up from the eaves
      const t = 0.34;
      const x = facing * (rw / 2) * (1 - t);
      const y = h + rise * t;
      const cheek = this.box(0.14, dh, 1.35, wallTex);
      cheek.position.set(0, dh / 2 - 0.15, 0);
      const face = this.box(0.12, dh, dw, wallTex);
      face.position.set(facing * 0.62, dh / 2 - 0.15, 0);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(dw * 0.62, dh * 0.6),
        this.mat(spec.windowTex || 'window', { side: THREE.DoubleSide }));
      glass.position.set(facing * 0.7, dh / 2 - 0.12, 0);
      glass.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(cheek, face, glass);
      for (const s of [-1, 1]) {             // its own little gabled cap
        const cap = this.box(1.5, 0.12, 0.9, roofTex);
        cap.position.set(facing * 0.1, dh + 0.14, s * 0.34);
        cap.rotation.x = s * 0.5;
        g.add(cap);
      }
      g.position.set(x, y, along);
      g.rotation.z = -facing * slope * 0.5;  // sit into the pitch, not on top of it
      rg.add(g);
    }
  }

  /**
   * Four-sided hip roof: a ridge over the middle of the long axis with all
   * four faces sloping to the eaves. Built from the real footprint, so the
   * eaves line follows the walls exactly on every side — which is the whole
   * reason to have it: a hipped house never reads as a box with a lid.
   */
  _hipRoof(group, spec, w, d, h, roofTex) {
    const ridge = spec.ridge ?? (w > d ? 'x' : 'z');
    const ov = 0.45;                                   // eaves overhang
    const L = (ridge === 'x' ? w : d) / 2 + ov;        // half length along the ridge
    const W = (ridge === 'x' ? d : w) / 2 + ov;        // half span across it
    const rise = this._roofRise(spec, W * 2);
    const rl = Math.max(0.4, L - W);                   // half length of the ridge itself
    // Along the ridge is local X, across it local Z; yawed at the end if needed.
    const A = [-L, h, -W], B = [L, h, -W], C = [L, h, W], D = [-L, h, W];
    const P = [-rl, h + rise, 0], Q = [rl, h + rise, 0];
    const geo = new THREE.BufferGeometry();
    const pos = [], uv = [];
    const face = (verts, uvs) => {
      for (const v of verts) pos.push(v[0], v[1], v[2]);
      for (const t of uvs) uv.push(t[0], t[1]);
    };
    const slopeLen = Math.hypot(W, rise);
    // two trapezoids along the ridge...
    face([A, B, Q, A, Q, P],
      [[0, 0], [L * 2 * TEXEL, 0], [(L + rl) * TEXEL, slopeLen * TEXEL],
       [0, 0], [(L + rl) * TEXEL, slopeLen * TEXEL], [(L - rl) * TEXEL, slopeLen * TEXEL]]);
    face([C, D, P, C, P, Q],
      [[0, 0], [L * 2 * TEXEL, 0], [(L + rl) * TEXEL, slopeLen * TEXEL],
       [0, 0], [(L + rl) * TEXEL, slopeLen * TEXEL], [(L - rl) * TEXEL, slopeLen * TEXEL]]);
    // ...and the two hipped ends
    face([D, A, P], [[0, 0], [W * 2 * TEXEL, 0], [W * TEXEL, slopeLen * TEXEL]]);
    face([B, C, Q], [[0, 0], [W * 2 * TEXEL, 0], [W * TEXEL, slopeLen * TEXEL]]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const rg = new THREE.Group();
    rg.add(new THREE.Mesh(geo, this.mat(roofTex, { side: THREE.DoubleSide })));
    // a fascia board closing the eaves so you never see under the edge
    for (const [px, pz, bw, bd] of [[0, -W, L * 2, 0.12], [0, W, L * 2, 0.12],
      [-L, 0, 0.12, W * 2], [L, 0, 0.12, W * 2]]) {
      const fascia = this.box(bw, 0.26, bd, spec.trimTex || 'trimStone');
      fascia.position.set(px, h - 0.05, pz);
      rg.add(fascia);
    }
    if (spec.chimney) {
      const ch = this.box(0.7, rise + 1.6, 0.7, spec.chimneyTex || 'brickRed');
      ch.position.set(rl * 0.6, h + rise * 0.5 + 0.5, 0);
      rg.add(ch);
    }
    if (ridge === 'x') rg.rotation.y = Math.PI / 2;
    group.add(rg);
  }

  /**
   * Single-slope lean-to roof.
   *
   * It drains DOWNHILL AWAY FROM THE DOOR unless a spec says otherwise: a
   * shed roof pitched the other way dumps a winter's snow and every
   * rainstorm straight onto its own threshold, which is why no one builds
   * them that way. `shedTo` names the low side.
   */
  _shedRoof(group, spec, w, d, h, roofTex, wallTex) {
    const low = spec.shedTo ?? { S: 'N', N: 'S', E: 'W', W: 'E' }[spec.door] ?? 'N';
    const alongX = low === 'E' || low === 'W';
    const span = alongX ? w : d;
    const cross = alongX ? d : w;
    const rise = Math.min(spec.roofCap ?? 1.7, span * (spec.roofPitch ?? 0.24));
    const sgn = low === 'S' || low === 'E' ? 1 : -1;   // which way is downhill
    const rg = new THREE.Group();
    const panelD = Math.hypot(span + 0.5, rise);
    const panel = this.box(cross + 0.5, 0.16, panelD, roofTex);
    panel.position.y = h + rise / 2 + 0.05;
    // The panel's HIGH end must be the end the riser wall stands under. Get
    // this sign wrong and the roof slopes one way while the wall that closes
    // it slopes the other, which leaves the whole eaves line open to the sky
    // from inside — a shed with a slot cut round the top of it.
    panel.rotation.x = sgn * Math.atan2(rise, span + 0.5);
    rg.add(panel);
    // Fascia along the low eave. The panel's underside clears the wall head by
    // a few centimetres wherever it crosses it, and at a grazing angle from
    // inside those few centimetres are a hairline of daylight all the way
    // round the building. The board closes it and reads as an eaves board.
    const fascia = this.box(cross + 0.5, 0.34, 0.14, spec.trimTex || 'trimStone');
    fascia.position.set(0, h + 0.1, sgn * (span / 2 + 0.16));
    rg.add(fascia);
    for (const s of [-1, 1]) { // right-triangle side caps
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([
        0, h, sgn * span / 2, 0, h, -sgn * span / 2, 0, h + rise, -sgn * span / 2,
      ], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, span * TEXEL, 0, 0, rise * TEXEL], 2));
      tri.computeVertexNormals();
      const cap = new THREE.Mesh(tri, this.mat(wallTex, { side: THREE.DoubleSide }));
      cap.position.x = s * (cross / 2 - WALL_T / 2);
      rg.add(cap);
    }
    const riser = this.box(cross, rise + 0.2, WALL_T, wallTex);
    riser.position.set(0, h + rise / 2, -sgn * (span / 2 - WALL_T / 2));
    rg.add(riser);
    if (alongX) rg.rotation.y = Math.PI / 2;
    group.add(rg);
  }

  /**
   * A covered porch over the front door: deck, posts, balustrade, a lattice
   * skirt and a shallow roof draining to the front.
   *
   * The deck is a real walkable platform, so you can stand on it and shoot
   * down the street, and the posts are real cover — but nothing is ever
   * placed within the entry lane, because a porch that you cannot walk
   * through is a front door that does not work. Terrain platform + collider
   * are registered in world space; everything drawn is in building-local
   * space, which is why both frames appear here.
   */
  _porch(group, spec, rot, side, doorOff, h) {
    const o = spec.porch === true ? {} : spec.porch;
    const depth = o.depth ?? 2.0;
    const width = Math.min(o.width ?? 4.4, side.len - 1.0);
    const deckY = 0.28;
    const alongX = side.axis === 'x';
    const outSign = Math.sign(side.cx + side.cz);
    // centre of the deck, in building-local coordinates
    const near = alongX ? Math.abs(side.cz) : Math.abs(side.cx);
    const mid = near + depth / 2 - WALL_T / 2;
    const put = (mesh, along, outward, y) => {
      mesh.position.set(alongX ? along : outSign * outward, y, alongX ? outSign * outward : along);
      group.add(mesh);
    };
    const deck = alongX ? this.box(width, 0.16, depth, 'floorWood') : this.box(depth, 0.16, width, 'floorWood');
    put(deck, doorOff, mid, deckY);
    const skirt = alongX ? this.box(width, deckY, 0.14, spec.foundationTex || 'foundLattice')
                         : this.box(0.14, deckY, width, spec.foundationTex || 'foundLattice');
    put(skirt, doorOff, near + depth - WALL_T / 2, deckY / 2);
    // posts and balustrade, kept clear of the doorway itself
    const postAt = width / 2 - 0.18;
    const roofY = Math.min(h - 0.35, DOOR_H + 0.62);
    const posts = [];
    for (const s of [-1, 1]) {
      const post = this.box(0.16, roofY - deckY, 0.16, spec.trimTex || 'trimWoodWhite');
      put(post, doorOff + s * postAt, mid + depth / 2 - 0.3, deckY + (roofY - deckY) / 2);
      posts.push(local2world(spec, rot,
        alongX ? doorOff + s * postAt : outSign * (mid + depth / 2 - 0.3),
        alongX ? outSign * (mid + depth / 2 - 0.3) : doorOff + s * postAt));
      const railLen = postAt - 0.9;
      if (railLen > 0.5) {
        for (const ry of [deckY + 0.45, deckY + 0.9]) {
          const rail = alongX ? this.box(railLen, 0.08, 0.08, spec.trimTex || 'trimWoodWhite')
                              : this.box(0.08, 0.08, railLen, spec.trimTex || 'trimWoodWhite');
          put(rail, doorOff + s * (postAt - railLen / 2 + 0.05), mid + depth / 2 - 0.3, ry);
        }
      }
    }
    const canopy = alongX ? this.box(width + 0.5, 0.14, depth + 0.35, spec.roofTex || 'roofShingle')
                          : this.box(depth + 0.35, 0.14, width + 0.5, spec.roofTex || 'roofShingle');
    put(canopy, doorOff, mid, roofY);
    canopy.rotation[alongX ? 'x' : 'z'] = (alongX ? -outSign : outSign) * 0.13;   // drains to the front edge
    // The deck is real ground you can stand on and shoot down the street
    // from. It is a terrain PLATFORM and nothing else — no collider, no nav
    // block — because anything solid out here is something standing in the
    // doorway, and the 0.36 m step up is well under the automatic step height
    // so you walk onto it without noticing.
    const c = local2world(spec, rot, alongX ? doorOff : outSign * mid, alongX ? outSign * mid : doorOff);
    const hx = alongX ? width / 2 : depth / 2;
    const hz = alongX ? depth / 2 : width / 2;
    const [wx, wz] = rot % 180 === 0 ? [hx, hz] : [hz, hx];
    this.terrain.addPlatform(c.x - wx, c.x + wx, c.z - wz, c.z + wz, spec.y + deckY + 0.08);
    // Published so anything hung on the porch can be placed against the real
    // geometry rather than a guessed offset from the building's centre. A porch
    // swing put down by eye is a porch swing through a post the first time a
    // house is a different width or its door is off-centre.
    return {
      minX: c.x - wx, maxX: c.x + wx, minZ: c.z - wz, maxZ: c.z + wz,
      y: spec.y + deckY + 0.08,
      posts, deckY,
      // door centre on the deck, and the along-wall axis props should slide on
      doorCentre: local2world(spec, rot, alongX ? doorOff : outSign * mid, alongX ? outSign * mid : doorOff),
      along: rot % 180 === 0 ? (alongX ? 'x' : 'z') : (alongX ? 'z' : 'x'),
      postGap: postAt,
      canopyY: spec.y + roofY,
    };
  }

  /* ================= articulation ==================================== */

  /**
   * Corner pilasters: a strip of trim standing proud of each corner for the
   * building's full height, with a moulded base and capital.
   *
   * This is the cheapest thing in the kit that stops a facade reading as a
   * slab, because it puts a hard vertical shadow on every corner — the eye
   * reads the wall as a panel BETWEEN two piers rather than as one flat plane.
   */
  _pilasters(group, spec, w, d, h) {
    // The SHAFT is masonry and only the mouldings are trim. A building's trim
    // texture is a decorative band — a green tile course, a painted timber
    // fillet — and it is right for a 200 mm belt course and badly wrong for a
    // four-metre pier, which it turns into a barber's pole.
    const tex = spec.foundationTex || spec.trimTex || 'trimStone';
    const cap = spec.trimTex || 'trimStone';
    const P = 0.14, WIDTH = 0.52;            // projection, and face width
    const top = h - 0.4;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // two thin slabs meeting at the corner, so it turns the corner the
        // way a real pier does instead of being a post stuck to one face
        const a = this.box(WIDTH, top, P, tex);
        a.position.set(sx * (w / 2 - WIDTH / 2), top / 2, sz * (d / 2 + P / 2 - 0.02));
        const b = this.box(P, top, WIDTH, tex);
        b.position.set(sx * (w / 2 + P / 2 - 0.02), top / 2, sz * (d / 2 - WIDTH / 2));
        group.add(a, b);
        for (const [y, ph, ext] of [[0.5, 0.2, 0.06], [top - 0.16, 0.3, 0.08]]) {
          const ca = this.box(WIDTH + ext * 2, ph, P + ext, cap);
          ca.position.set(sx * (w / 2 - WIDTH / 2), y, sz * (d / 2 + (P + ext) / 2 - 0.02));
          const cb = this.box(P + ext, ph, WIDTH + ext * 2, cap);
          cb.position.set(sx * (w / 2 + (P + ext) / 2 - 0.02), y, sz * (d / 2 - WIDTH / 2));
          group.add(ca, cb);
        }
      }
    }
  }

  /**
   * A flat roof's head: a bracketed cornice with a dentil course under it, a
   * parapet wall standing on that, and a coping capping the parapet.
   *
   * A flat-roofed building's whole silhouette is its top edge. The default
   * slab-and-lip gives that edge one step; this gives it four, which is the
   * difference between a commercial block and a shoebox with a lid on.
   */
  _parapet(group, spec, w, d, h, wallTex) {
    const tex = spec.trimTex || 'trimStone';
    const ph = typeof spec.parapet === 'number' ? spec.parapet : 0.95;
    // dentils: a run of small blocks under the cornice, all the way round
    for (const [len, along, cz, cx] of [[w, 'x', d / 2, 0], [w, 'x', -d / 2, 0],
      [d, 'z', 0, w / 2], [d, 'z', 0, -w / 2]]) {
      const n = Math.max(3, Math.round(len / 0.42));
      for (let i = 0; i < n; i++) {
        const at = (-len / 2) + (i + 0.5) * (len / n);
        const blk = along === 'x' ? this.box(0.2, 0.16, 0.22, tex) : this.box(0.22, 0.16, 0.2, tex);
        blk.position.set(along === 'x' ? at : cx + Math.sign(cx) * 0.1,
          h - 0.02, along === 'x' ? cz + Math.sign(cz) * 0.1 : at);
        group.add(blk);
      }
    }
    this._trimBand(group, spec, w, d, h + 0.16, 0.24, 0.30);   // the cornice itself
    for (const [pw, pd, px, pz] of [
      [w + 0.5, 0.3, 0, d / 2 + 0.1], [w + 0.5, 0.3, 0, -d / 2 - 0.1],
      [0.3, d + 0.5, w / 2 + 0.1, 0], [0.3, d + 0.5, -w / 2 - 0.1, 0],
    ]) {
      const wall = this.box(pw, ph, pd, wallTex);
      wall.position.set(px, h + 0.3 + ph / 2, pz);
      group.add(wall);
      const cope = this.box(pw + 0.18, 0.14, pd + 0.18, tex);
      cope.position.set(px, h + 0.3 + ph + 0.07, pz);
      group.add(cope);
    }
    // and the roof deck itself, sunk inside the parapet where it belongs
    const deck = this.box(w - 0.2, 0.2, d - 0.2, spec.roofTex || 'roofTar');
    deck.position.y = h + 0.2;
    group.add(deck);
  }

  /**
   * Emphasis at the door.
   *
   * 'portico' — two columns on plinths carrying an entablature and a pediment,
   * with a flight of steps up to it. 'hood' — a smaller bracketed canopy for a
   * shop or a house that would look ridiculous with a temple front on it.
   */
  _entrance(group, spec, side, doorOff, h) {
    // Same rule as the pilasters: masonry for anything structural, and the
    // building's decorative trim only on the thin mouldings.
    const stone = spec.foundationTex || 'trimStone';
    const trim = spec.trimTex || 'trimStone';
    const alongX = side.axis === 'x';
    const out = Math.sign(side.cx + side.cz);
    const near = alongX ? Math.abs(side.cz) : Math.abs(side.cx);
    const put = (mesh, along, outward, y) => {
      mesh.position.set(alongX ? along : out * outward, y, alongX ? out * outward : along);
      group.add(mesh);
      return mesh;
    };
    const box2 = (a, thk, hgt, tex) => (alongX ? this.box(a, hgt, thk, tex) : this.box(thk, hgt, a, tex));

    if (spec.entrance === 'hood') {
      const wdt = Math.min(3.0, side.len - 1.2);
      put(box2(wdt, 0.9, 0.16, trim), doorOff, near + 0.45, DOOR_H + 0.56);
      for (const sgn of [-1, 1]) {                       // the two brackets
        const br = alongX ? this.box(0.14, 0.5, 0.55, stone) : this.box(0.55, 0.5, 0.14, stone);
        put(br, doorOff + sgn * (wdt / 2 - 0.2), near + 0.28, DOOR_H + 0.16);
      }
      put(box2(wdt + 0.26, 0.24, 0.14, trim), doorOff, near + 0.5, DOOR_H + 0.70);
      return;
    }

    const wdt = Math.min(3.4, side.len - 1.4);
    const depth = 1.25;
    const capY = DOOR_H + 0.80;
    // The approach, in the same stone the footing is in: a landing at the
    // threshold and two shallow risers stepping down off it.
    //
    // Both dimensions here are load-bearing and neither is styling. The
    // landing starts at the OUTER WALL FACE, never behind it, because a slab
    // that reaches back past the face emerges through the floor plate as a
    // kerb around the inside of the room. And nothing in the flight rises
    // above 0.2 m, because the doorway's own threshold is at grade — a stair
    // climbing to a door you then step down through is a stair to nowhere.
    const face = near + WALL_T / 2;
    const flight = [[wdt + 0.6, depth + 0.5, 0.18], [wdt + 0.9, 0.36, 0.12], [wdt + 1.2, 0.36, 0.06]];
    let reach = face;
    for (const [sw, sd, sh] of flight) {
      put(box2(sw, sd, sh, stone), doorOff, reach + sd / 2, sh / 2);
      reach += sd;
    }
    // two square piers rather than turned columns: a cylinder wraps its whole
    // texture once round its circumference, so at this scale it reads as a
    // smear rather than as stone. A pier tiles honestly.
    for (const sgn of [-1, 1]) {
      const at = doorOff + sgn * (wdt / 2 - 0.26);
      const stand = near + depth - 0.34;
      put(alongX ? this.box(0.54, 0.22, 0.54, trim) : this.box(0.54, 0.22, 0.54, trim), at, stand, 0.5);
      put(alongX ? this.box(0.38, capY - 0.75, 0.38, stone) : this.box(0.38, capY - 0.75, 0.38, stone),
        at, stand, 0.61 + (capY - 0.75) / 2);
      put(alongX ? this.box(0.5, 0.18, 0.5, trim) : this.box(0.5, 0.18, 0.5, trim), at, stand, capY - 0.08);
    }
    // entablature: architrave, frieze, and the cornice that throws the shadow
    put(box2(wdt + 0.44, depth + 0.24, 0.16, stone), doorOff, near + depth / 2 - 0.1, capY + 0.09);
    put(box2(wdt + 0.36, depth + 0.16, 0.22, trim), doorOff, near + depth / 2 - 0.1, capY + 0.28);
    put(box2(wdt + 0.62, depth + 0.38, 0.14, stone), doorOff, near + depth / 2 - 0.1, capY + 0.46);
    // ...and a real triangular pediment on top of it, not a stack of bands
    const pw = wdt + 0.62, ph = pw * 0.24, pd = depth + 0.38;
    const tri = new THREE.Shape([
      new THREE.Vector2(-pw / 2, 0), new THREE.Vector2(pw / 2, 0), new THREE.Vector2(0, ph)]);
    const geo = new THREE.ExtrudeGeometry(tri, { depth: pd, bevelEnabled: false });
    geo.translate(0, 0, -pd / 2);
    if (!alongX) geo.rotateY(Math.PI / 2);
    const ped = new THREE.Mesh(geo, this.mat(stone));
    put(ped, doorOff, near + depth / 2 - 0.1, capY + 0.53);
  }

  /**
   * A canted bay window projecting from the door facade — a splayed box with
   * glass on all three faces, a moulded base and a lead roof. One of these
   * does more for a flat elevation than any amount of texture, because it is
   * the only part of the building that casts a shadow ONTO itself.
   */
  _bayWindow(group, spec, side, h, wallTex) {
    const o = spec.bay === true ? {} : spec.bay;
    const alongX = side.axis === 'x';
    const out = Math.sign(side.cx + side.cz);
    const near = alongX ? Math.abs(side.cz) : Math.abs(side.cx);
    // On the door's own wall it stands off to one side; on any other wall it
    // is centred, because there is nothing to stand clear OF.
    const onDoorWall = spec.door === side.id;
    const doorOff = onDoorWall ? (spec.doorOffset ?? 0) * side.len * 0.5 : 0;
    const at = o.at ?? (onDoorWall ? (doorOff > 0 ? -side.len * 0.26 : side.len * 0.26) : 0);
    const wdt = Math.min(o.width ?? 2.4, side.len * 0.42);
    const proj = 0.62;
    const top = Math.min(o.top ?? (h - 0.7), h - 0.6);
    const put = (mesh, along, outward, y, ry = 0) => {
      mesh.position.set(alongX ? along : out * outward, y, alongX ? out * outward : along);
      mesh.rotation.y = ry;
      group.add(mesh);
      return mesh;
    };
    const tex = spec.trimTex || 'trimStone';
    // the box: a front face and two splayed cheeks
    const front = alongX ? this.box(wdt, top - 0.5, 0.16, wallTex) : this.box(0.16, top - 0.5, wdt, wallTex);
    put(front, at, near + proj, 0.5 + (top - 0.5) / 2);
    for (const sgn of [-1, 1]) {
      const cheek = alongX ? this.box(0.9, top - 0.5, 0.16, wallTex) : this.box(0.16, top - 0.5, 0.9, wallTex);
      cheek.position.set(
        alongX ? at + sgn * (wdt / 2 + 0.24) : out * (near + proj / 2),
        0.5 + (top - 0.5) / 2,
        alongX ? out * (near + proj / 2) : at + sgn * (wdt / 2 + 0.24));
      cheek.rotation.y = (alongX ? -1 : 1) * sgn * out * 0.85;
      group.add(cheek);
    }
    // glazing on the front face, and the base and roof that make it a bay
    const glass = alongX
      ? new THREE.Mesh(new THREE.PlaneGeometry(wdt - 0.3, top - 1.5), this.mat(spec.windowTex || 'window'))
      : new THREE.Mesh(new THREE.PlaneGeometry(wdt - 0.3, top - 1.5), this.mat(spec.windowTex || 'window'));
    put(glass, at, near + proj + 0.09, 0.95 + (top - 1.5) / 2, alongX ? (out > 0 ? 0 : Math.PI) : out * Math.PI / 2);
    // Base and roof are sized to the BAY, a hand's width proud of it either
    // side. They were two metres wider than it, which reached right across the
    // doorway next to them and put a footing course where the threshold is.
    const foundTex = spec.foundationTex || 'foundStone';
    const bw2 = wdt + 1.6;                 // the splay of the cheeks, plus a lip
    const base = alongX ? this.box(bw2, 0.5, proj + 0.3, foundTex)
      : this.box(proj + 0.3, 0.5, bw2, foundTex);
    put(base, at, near + proj / 2 + 0.1, 0.28);
    const roof = alongX ? this.box(bw2 + 0.1, 0.18, proj + 0.42, tex)
      : this.box(proj + 0.42, 0.18, bw2 + 0.1, tex);
    put(roof, at, near + proj / 2 + 0.14, top - 0.06);
    const cope = alongX ? this.box(bw2 + 0.3, 0.12, proj + 0.56, tex)
      : this.box(proj + 0.56, 0.12, bw2 + 0.3, tex);
    put(cope, at, near + proj / 2 + 0.16, top + 0.08);
  }

  /**
   * A lower attached wing.
   *
   * The single most effective thing that can be done about "it looks like a
   * block" is to stop it being ONE block. A wing is a second volume butted
   * against a chosen wall at a lower height, with its own roof — and, because
   * a player can walk into it, its own collider and nav block, sized to the
   * geometry rather than guessed. `side` is a local wall id (N/S/E/W).
   */
  _wing(group, spec, rot, w, d, h, wallTex) {
    const o = spec.wing;
    const tex = o.wall || wallTex;
    const ww = o.w ?? Math.min(w * 0.55, 5.0);
    const wd = o.d ?? 3.2;
    const wh = o.h ?? Math.max(2.6, h * 0.62);
    const at = o.at ?? 0;
    // centre of the wing in the building's local frame, butted to the wall
    const n = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[o.side] || [0, 1];
    const half = n[0] ? w / 2 : d / 2;
    const alongX = !n[0];
    const outDepth = alongX ? wd : ww;
    const lx = n[0] * (half + outDepth / 2 - 0.1) + (n[0] ? 0 : at);
    const lz = n[1] * (half + outDepth / 2 - 0.1) + (n[1] ? 0 : at);
    const bw = alongX ? ww : wd, bd = alongX ? wd : ww;
    const body = this.box(bw, wh, bd, tex);
    body.position.set(lx, wh / 2, lz);
    group.add(body);
    // its own footing, cornice and roof, so it is a building and not a lump
    const found = this.box(bw + 0.18, 0.5, bd + 0.18, spec.foundationTex || 'foundStone');
    found.position.set(lx, 0.16, lz);
    const band = this.box(bw + 0.26, 0.2, bd + 0.26, spec.trimTex || 'trimStone');
    band.position.set(lx, wh - 0.14, lz);
    group.add(found, band);
    if (o.roof === 'flat') {
      const slab = this.box(bw + 0.3, 0.2, bd + 0.3, spec.roofTex || 'roofTar');
      slab.position.set(lx, wh + 0.1, lz);
      group.add(slab);
    } else {
      /**
       * A lean-to, and it drains AWAY from the block it leans on.
       *
       * That sounds obvious and it is the one thing that was wrong: the tilt
       * was signed off the outward normal the wrong way round, so the roof ran
       * downhill INTO the parent wall — the one place on a building water must
       * never be sent. The high end is against the parent and the low end is
       * out over the far wall, and the two side walls are closed by real
       * triangles rather than by a rectangle standing in for one.
       */
      const across = alongX ? bw : bd;         // along the parent's wall
      const rise = Math.min(1.1, outDepth * 0.36);
      const a = Math.atan2(rise, outDepth);
      const slopeLen = Math.hypot(outDepth + 0.5, rise);
      const slope = alongX
        ? this.box(across + 0.4, 0.16, slopeLen, spec.roofTex || 'roofShingle')
        : this.box(slopeLen, 0.16, across + 0.4, spec.roofTex || 'roofShingle');
      slope.position.set(lx, wh + rise / 2 + 0.1, lz);
      if (alongX) slope.rotation.x = n[1] * a; else slope.rotation.z = -n[0] * a;
      group.add(slope);
      // the closing triangles: shape-space +X points at the parent
      const tri = new THREE.Shape([
        new THREE.Vector2(-outDepth / 2, 0),
        new THREE.Vector2(outDepth / 2, 0),
        new THREE.Vector2(outDepth / 2, rise),
      ]);
      const ry = alongX ? (n[1] > 0 ? Math.PI / 2 : -Math.PI / 2) : (n[0] > 0 ? Math.PI : 0);
      for (const sgn of [-1, 1]) {
        const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false });
        geo.translate(0, 0, -0.08);
        geo.rotateY(ry);
        const wall = new THREE.Mesh(geo, this.mat(tex));
        wall.position.set(
          lx + (alongX ? sgn * across / 2 : 0), wh,
          lz + (alongX ? 0 : sgn * across / 2));
        group.add(wall);
      }
    }
    this._collideLocalBox(spec, rot, lx, lz, bw / 2, wh, bd / 2);
  }

  /** Gutter along the eaves and a downpipe at one corner. Small, and the
   *  first thing you miss when it is not there. */
  _rainwater(group, spec, w, d, h) {
    const tex = spec.trimTex || 'trimMetal';
    const ridge = spec.ridge ?? (w > d ? 'x' : 'z');
    const alongX = ridge === 'x';
    for (const sgn of [-1, 1]) {
      const g2 = alongX ? this.box(w + 0.3, 0.14, 0.16, tex) : this.box(0.16, 0.14, d + 0.3, tex);
      g2.position.set(alongX ? 0 : sgn * (w / 2 + 0.14), h + 0.04, alongX ? sgn * (d / 2 + 0.14) : 0);
      group.add(g2);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h - 0.2, 6), this.mat(tex));
    pipe.position.set(w / 2 + 0.09, (h - 0.2) / 2, -(d / 2 + 0.09));
    group.add(pipe);
    const shoe = this.box(0.14, 0.2, 0.22, tex);
    shoe.position.set(w / 2 + 0.09, 0.16, -(d / 2 + 0.16));
    group.add(shoe);
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

function roofKindOf(spec) { return spec.roof || 'gable'; }

/** Rotate a local direction into world space (same 90° steps as local2world). */
export function localDir2world(rot, dx, dz) {
  if (rot === 90) return { x: dz, z: -dx };
  if (rot === 180) return { x: -dx, z: -dz };
  if (rot === 270) return { x: -dz, z: dx };
  return { x: dx, z: dz };
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
