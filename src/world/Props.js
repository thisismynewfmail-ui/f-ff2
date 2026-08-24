import * as THREE from '../../lib/three.module.js';
import { mergeStatic, scaleBoxUVs } from './Buildings.js';

/**
 * Environmental props: wrecked cars, street furniture, debris, barriers.
 * Each factory returns a THREE.Group positioned by the caller via place();
 * solid props register AABB colliders + nav blocks.
 */
/**
 * THE COACHWORK.
 *
 * One entry per body, stated in metres in the car's own frame: origin on the
 * ground at the centre of the car, +X toward the nose, +Z to the left. Every
 * number here is a landmark on a real car, so the shapes can be read off the
 * table without running the game:
 *
 *   hull        the side silhouette from the front bumper round to the tail,
 *               nose first. The underside (sills + wheel arches) is generated
 *               from the axles — see PropKit._hullOutline.
 *   cabin       the greenhouse, lofted narrower than the hull; the difference
 *               is the tumblehome.
 *   screen /
 *   backlight   the two ends of the windscreen and the rear window, as points
 *               on the cabin outline, so the glass always lies in its aperture.
 *   dlo         daylight openings — the side windows, one polygon each, which
 *               is what puts a B-pillar between them.
 *   shuts       door shut lines [x, centreY, height]; handles [x, y].
 *   lamp        [y, height, width, |z|] for the head/tail lamps.
 *   grille      [centreY, height, width as a fraction of W].
 *
 * The wheels are the fixed point of the whole design (axleF/axleR/wheelR), and
 * the bodies are drawn around them rather than the other way round.
 */
const VEHICLE_SPECS = {
  // A three-box saloon. Long bonnet, short boot, four side windows.
  sedan: {
    L: 4.46, W: 1.84, bevel: 0.055, tumble: 0.15, sill: 0.30,
    axleF: 1.36, axleR: -1.26, arch: 0.50, archSquash: 0.92, wheelR: 0.33,
    tyreW: 0.24, track: 0.16,
    hull: [
      [2.20, 0.42], [2.23, 0.66], [2.19, 0.88], [2.02, 0.97],
      [1.40, 1.05], [0.66, 1.12], [-0.90, 1.13], [-1.62, 1.08],
      [-2.04, 1.00], [-2.20, 0.86], [-2.23, 0.62], [-2.20, 0.40],
    ],
    cabin: [[0.66, 1.08], [-0.02, 1.50], [-0.96, 1.52], [-1.50, 1.08]],
    screen: [[0.66, 1.08], [-0.02, 1.50]],
    backlight: [[-0.96, 1.52], [-1.50, 1.08]],
    dlo: [
      [[0.42, 1.15], [-0.06, 1.42], [-0.44, 1.43], [-0.44, 1.15]],
      [[-0.56, 1.43], [-0.92, 1.44], [-1.28, 1.15], [-0.56, 1.15]],
    ],
    shuts: [[0.44, 0.74, 0.66], [-0.52, 0.74, 0.66]],
    handles: [[-0.02, 1.00], [-0.92, 1.00]],
    strip: [0.05, 0.88, 2.12], bumperY: 0.56, bumperH: 0.26,
    lamp: [0.90, 0.20, 0.30, 0.62], grille: [0.80, 0.24, 0.52],
    mirror: [0.58, 1.00], rails: [-0.5, 1.53, 1.0],
  },
  // The same shell with a squarer roof and a wider track: the town's cruiser.
  cruiser: {
    L: 4.62, W: 1.92, bevel: 0.05, tumble: 0.14, sill: 0.31,
    axleF: 1.42, axleR: -1.32, arch: 0.52, archSquash: 0.9, wheelR: 0.35,
    tyreW: 0.26, track: 0.16,
    hull: [
      [2.28, 0.44], [2.31, 0.68], [2.27, 0.90], [2.10, 0.99],
      [1.46, 1.06], [0.70, 1.14], [-0.94, 1.15], [-1.70, 1.10],
      [-2.12, 1.02], [-2.28, 0.88], [-2.31, 0.64], [-2.28, 0.42],
    ],
    cabin: [[0.70, 1.10], [0.06, 1.56], [-1.02, 1.58], [-1.56, 1.10]],
    screen: [[0.70, 1.10], [0.06, 1.56]],
    backlight: [[-1.02, 1.58], [-1.56, 1.10]],
    dlo: [
      [[0.46, 1.17], [0.02, 1.48], [-0.46, 1.49], [-0.46, 1.17]],
      [[-0.58, 1.49], [-0.98, 1.50], [-1.34, 1.17], [-0.58, 1.17]],
    ],
    shuts: [[0.46, 0.76, 0.66], [-0.54, 0.76, 0.66]],
    handles: [[0.00, 1.02], [-0.94, 1.02]],
    strip: [0.05, 0.92, 2.16], bumperY: 0.58, bumperH: 0.28,
    lamp: [0.92, 0.20, 0.30, 0.66], grille: [0.82, 0.26, 0.54],
    mirror: [0.62, 1.02], rails: [-0.48, 1.59, 1.0],
  },
  // Two-box pickup: cab forward, open bed behind, and it rides higher.
  pickup: {
    L: 5.06, W: 1.94, bevel: 0.05, tumble: 0.12, sill: 0.40,
    axleF: 1.62, axleR: -1.44, arch: 0.56, archSquash: 0.9, wheelR: 0.39,
    tyreW: 0.29, track: 0.15,
    // The top drops away behind the cab: the bed is a HOLE in the body, not a
    // panel laid over it, so the sides below have something to stand on.
    hull: [
      [2.50, 0.52], [2.53, 0.78], [2.49, 1.02], [2.30, 1.12],
      [1.72, 1.18], [1.06, 1.24], [0.30, 1.26], [-0.52, 1.26],
      [-0.62, 1.04], [-2.38, 1.04], [-2.50, 0.96], [-2.53, 0.76], [-2.50, 0.50],
    ],
    cabin: [[1.06, 1.20], [0.42, 1.68], [-0.42, 1.70], [-0.52, 1.20]],
    screen: [[1.06, 1.20], [0.42, 1.68]],
    backlight: [[-0.42, 1.70], [-0.52, 1.20]],
    dlo: [[[0.82, 1.27], [0.40, 1.60], [-0.36, 1.61], [-0.36, 1.27]]],
    shuts: [[0.86, 0.90, 0.62], [-0.44, 0.90, 0.62]],
    handles: [[0.18, 1.12]],
    strip: [0.2, 1.02, 2.4], bumperY: 0.66, bumperH: 0.30,
    lamp: [1.02, 0.22, 0.32, 0.66], grille: [0.92, 0.30, 0.56],
    mirror: [0.98, 1.24], rails: null,
    // [fromX, toX, floorY, sideHeight] — the open tray behind the cab
    bed: [-0.62, -2.38, 1.04, 0.30],
  },
  // A high-cube van: near-vertical screen, slab flanks, one long side window.
  van: {
    L: 5.10, W: 2.00, bevel: 0.06, tumble: 0.08, sill: 0.38,
    axleF: 1.64, axleR: -1.50, arch: 0.54, archSquash: 0.86, wheelR: 0.37,
    tyreW: 0.27, track: 0.14,
    hull: [
      [2.52, 0.50], [2.55, 0.76], [2.50, 1.04], [2.30, 1.16],
      [1.90, 1.24], [1.30, 1.28], [-2.42, 1.28], [-2.55, 1.14],
      [-2.55, 0.74], [-2.52, 0.48],
    ],
    cabin: [[1.62, 1.24], [1.06, 2.06], [-2.34, 2.10], [-2.46, 1.24]],
    screen: [[1.62, 1.24], [1.06, 2.06]],
    backlight: null,
    dlo: [
      [[1.24, 1.34], [0.98, 1.94], [0.28, 1.95], [0.28, 1.34]],
      [[0.16, 1.95], [-0.62, 1.96], [-0.62, 1.34], [0.16, 1.34]],
    ],
    shuts: [[1.26, 0.92, 0.60], [0.20, 0.92, 0.60], [-2.34, 1.68, 0.80]],
    handles: [[0.42, 1.14]],
    strip: [-0.2, 1.06, 3.0], bumperY: 0.64, bumperH: 0.30,
    lamp: [1.02, 0.24, 0.32, 0.72], grille: [0.92, 0.26, 0.50],
    mirror: [1.54, 1.32], rails: [-0.6, 2.11, 2.6],
  },
  // A city bus. One long slab on six wheels, and the only body whose glass
  // runs the full length of the flank.
  bus: {
    L: 8.90, W: 2.46, bevel: 0.07, tumble: 0.06, sill: 0.62,
    axleF: 3.10, axleR: -2.60, arch: 0.70, archSquash: 0.8, wheelR: 0.50,
    tyreW: 0.34, track: 0.18,
    hull: [
      [4.42, 0.74], [4.45, 1.02], [4.42, 1.32], [4.26, 1.44],
      [3.90, 1.50], [-4.24, 1.50], [-4.42, 1.36], [-4.45, 1.02], [-4.42, 0.72],
    ],
    cabin: [[4.14, 1.46], [3.86, 2.94], [-4.16, 2.98], [-4.32, 1.46]],
    screen: [[4.14, 1.46], [3.86, 2.94]],
    backlight: [[-4.16, 2.98], [-4.32, 1.46]],
    dlo: [
      [[3.60, 1.62], [3.46, 2.72], [1.10, 2.74], [1.10, 1.62]],
      [[0.94, 2.74], [-1.60, 2.75], [-1.60, 1.62], [0.94, 1.62]],
      [[-1.76, 2.75], [-4.02, 2.78], [-4.10, 1.62], [-1.76, 1.62]],
    ],
    shuts: [[3.66, 1.14, 0.56], [1.02, 2.10, 1.70], [-1.68, 1.14, 0.56]],
    handles: [],
    strip: [0, 1.26, 7.4], bumperY: 0.92, bumperH: 0.34,
    lamp: [1.16, 0.26, 0.34, 0.98], grille: [1.06, 0.24, 0.40],
    mirror: [3.96, 2.32], rails: [0, 3.00, 8.2],
  },
};

export class PropKit {
  constructor(texLib, collision, nav, terrain) {
    this.texLib = texLib;
    this.collision = collision;
    this.nav = nav;
    this.terrain = terrain;
    this.mats = new Map();
  }

  mat(tex, opts = {}) {
    const key = tex + JSON.stringify(opts);
    if (!this.mats.has(key)) {
      const m = new THREE.MeshLambertMaterial({ map: this.texLib.get(tex), ...opts });
      this.mats.set(key, m);
    }
    return this.mats.get(key);
  }

  colorMat(hex, opts = null) {
    const key = 'c' + hex + (opts ? JSON.stringify(opts) : '');
    if (!this.mats.has(key)) {
      this.mats.set(key, new THREE.MeshLambertMaterial({ color: hex, ...(opts || {}) }));
    }
    return this.mats.get(key);
  }

  box(w, h, d, tex) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    return new THREE.Mesh(geo, typeof tex === 'string' ? this.mat(tex) : tex);
  }

  /** Drop a group on the terrain at (x, z); registers collider if solid.
   *  `nav: false` keeps the collider but leaves the nav grid open — used for
   *  interior furniture so room-scale pathing stays possible (steering
   *  handles the local avoidance). */
  place(group, x, z, { collide = null, yaw = 0, lift = 0, nav = true } = {}) {
    const y = this.terrain.heightAt(x, z) + lift;
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    if (collide) {
      const [hx, hy, hz] = collide;
      this.collision.addBoxCentered(x, y + hy, z, hx, hy, hz, 'prop');
      if (nav) this.nav.blockBox(x - hx, z - hz, x + hx, z + hz);
    }
    return group;
  }

  /* ---- vehicles -------------------------------------------------------
   * EVERY CAR IN TOWN IS LOFTED FROM A SIDE PROFILE.
   *
   * The old coachwork was an assembly of boxes: a slab bonnet, a slab boot, a
   * cabin of four square pillars with panes hung between them, and thin strips
   * stuck on the flanks where the wheel arches should have been. Every one of
   * those parts was in the right PLACE, which is why it read as a car in a
   * floor plan and as a stack of crates from the pavement — a real car has
   * almost no flat surface on it and not one square corner.
   *
   * So the body is now drawn the way a car is drawn: as its silhouette. A
   * closed outline in the X/Y plane — bumper, nose, bonnet, beltline, boot,
   * tail, and a bottom edge that ARCHES OVER EACH WHEEL — is extruded across
   * the car's width with a bevel on it, which rounds every edge of that
   * silhouette in one operation. The greenhouse is a second, narrower loft
   * sitting on the beltline (that inset is the tumblehome, and it is most of
   * why a car looks like a car from three-quarter view), and the glass is
   * inset panels in it rather than panes floating between pillars.
   *
   * On top of that go the things the eye actually uses to identify a car at
   * fifty metres and which the box version had none of: shut lines down the
   * doors, handles, a recessed grille with lamps set into the nose, wrapped
   * bumpers, mirrors on the A-pillar, drip rails, a plate, an exhaust.
   *
   * Each finished body is still merged down to one mesh per material, so all
   * of this costs the same to draw as the crates did.
   */

  /**
   * @param {object} o
   *  paint    body colour
   *  kind     'sedan' | 'pickup' | 'van' | 'bus' | 'cruiser'
   *  wrecked  strip the glass, drop a wheel, crush the roof, burn the paint
   *  lit      build working headlamps and return them (car alarms)
   */
  _vehicle({ paint = 0x39465e, kind = 'sedan', wrecked = false, lit = false } = {}) {
    const V = VEHICLE_SPECS[kind] || VEHICLE_SPECS.sedan;
    const g = new THREE.Group();
    const hl = V.L / 2, hw = V.W / 2;
    const body = this.colorMat(wrecked ? mixHex(paint, 0x2a2622, 0.5) : paint);
    const shade = this.colorMat(mixHex(wrecked ? mixHex(paint, 0x2a2622, 0.5) : paint, 0x000000, 0.32));
    const dark = this.colorMat(0x14161a);
    const tyre = this.colorMat(0x101216);
    const chrome = this.colorMat(wrecked ? 0x6d7176 : 0xa8aeb2);
    const rim = this.colorMat(wrecked ? 0x54585c : 0x8e969c);
    const glass = this.colorMat(wrecked ? 0x0b0e11 : 0x2b3d47, { side: THREE.DoubleSide });
    const lampMat = this.colorMat(wrecked ? 0x2a2c2e : 0xe6e2cc);
    const tailMat = this.colorMat(wrecked ? 0x3a1a18 : 0x9c2a20);

    /* --- the two lofts ------------------------------------------------- */
    const loft = (pts, width, mat, bevel = 0.05) => {
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const depth = Math.max(0.02, width - bevel * 2);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
        bevelSegments: 2, steps: 1, curveSegments: 4,
      });
      geo.translate(0, 0, -depth / 2);
      return new THREE.Mesh(geo, mat);
    };

    g.add(loft(this._hullOutline(V), V.W, body, V.bevel));
    const cabW = V.W - V.tumble * 2;
    // The greenhouse and its glass live in one group, so a wreck's roof can be
    // stoved in WITH the windows in it. Crushing the shell and leaving the
    // panes where they were is how you get a car with its windscreen hanging
    // in the air above the bonnet.
    const cabG = new THREE.Group();
    g.add(cabG);
    if (V.cabin.length) cabG.add(loft(V.cabin, cabW, body, V.bevel * 0.8));

    /* --- glass: inset panels in the greenhouse, not panes between sticks */
    /**
     * A pane spanning two points of the cabin outline: `len` along the a→b
     * direction, `width` across the car, standing in the aperture and pushed
     * `inset` metres along its own outward normal so it never z-fights the
     * pillar it is glazed into.
     */
    const panel = (a, b, width, mat, inset = 0) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 0.01;
      const geo = new THREE.PlaneGeometry(len, width);
      geo.rotateX(-Math.PI / 2);                 // lay it flat: length in X, width in Z
      const q = new THREE.Mesh(geo, mat);
      q.rotation.z = Math.atan2(dy, dx);         // ...then stand it up on the rake
      q.position.set(
        (a[0] + b[0]) / 2 - (dy / len) * inset,
        (a[1] + b[1]) / 2 + (dx / len) * inset, 0);
      return q;
    };
    if (V.screen) cabG.add(panel(V.screen[0], V.screen[1], cabW - 0.10, glass, -0.02));
    if (V.backlight && !wrecked) {
      cabG.add(panel(V.backlight[0], V.backlight[1], cabW - 0.14, glass, 0.02));
    }
    // Side glass: the daylight openings, cut as flat polygons and laid on each
    // flank of the greenhouse. Both sides use the SAME polygon, unmirrored —
    // a car's near and off side windows are the same shape seen from opposite
    // sides, and turning one round would put the windscreen at the back.
    for (const dlo of (wrecked ? V.dlo.slice(0, 1) : V.dlo)) {
      const sh = new THREE.Shape(dlo.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ShapeGeometry(sh);
      for (const s of [-1, 1]) {
        const q = new THREE.Mesh(geo, glass);
        q.position.z = s * (cabW / 2 + 0.01);
        cabG.add(q);
      }
    }

    if (wrecked && kind !== 'bus') {
      // stoved in and pushed off square, glass and all
      cabG.scale.set(1, 0.78, 0.97);
      cabG.rotation.z = 0.07;
      cabG.position.y = -0.05;
    }

    /* --- shut lines and handles: the cheapest thing that says "doors" --- */
    for (const s of [-1, 1]) {
      for (const [dx, y0, h] of V.shuts) {
        const cut = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.02), dark);
        cut.position.set(dx, y0, s * (hw + 0.005));
        g.add(cut);
      }
      for (const [dx, y] of V.handles) {
        const hd = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.055, 0.05), chrome);
        hd.position.set(dx, y, s * (hw + 0.02));
        g.add(hd);
      }
      // Rubbing strip down the flank. Its height and length come from the
      // spec rather than from the car's length, because the band of flank it
      // can live on is bounded by the wheel arches under it and the beltline
      // over it — a strip sized off L ends up hanging in the air over a wheel.
      const strip = new THREE.Mesh(new THREE.BoxGeometry(V.strip[2], 0.07, 0.03), shade);
      strip.position.set(V.strip[0], V.strip[1], s * (hw + 0.012));
      g.add(strip);
    }

    /* --- ends: bumpers, grille, lamps, plate --------------------------- */
    const bumper = (x, sign) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.20, V.bumperH, V.W - 0.06), chrome);
      b.position.set(x, V.bumperY, 0);
      g.add(b);
      // the wrap round each corner, which is what stops a bumper reading as a
      // plank held up in front of the car
      for (const s of [-1, 1]) {
        const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.34, V.bumperH * 0.92, 0.16), chrome);
        wrap.position.set(x - sign * 0.16, V.bumperY, s * (hw - 0.07));
        wrap.rotation.y = -sign * s * 0.42;
        g.add(wrap);
      }
    };
    bumper(hl - 0.06, 1);
    if (!wrecked) bumper(-hl + 0.06, -1);
    else {                                   // hanging off at one corner
      const loose = new THREE.Mesh(new THREE.BoxGeometry(0.2, V.bumperH, V.W * 0.6), chrome);
      loose.position.set(-hl + 0.02, V.bumperY - 0.24, 0.28);
      loose.rotation.set(0, 0.2, 0.46);
      g.add(loose);
    }
    // grille, recessed into the nose rather than stuck onto it
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.09, V.grille[1], V.W * V.grille[2]), dark);
    grille.position.set(hl - 0.05, V.grille[0], 0);
    g.add(grille);
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, V.W * V.grille[2] - 0.04), chrome);
      bar.position.set(hl - 0.02, V.grille[0] - V.grille[1] / 2 + (i + 0.5) * (V.grille[1] / 3), 0);
      g.add(bar);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.46), this.colorMat(0xcac6b4));
    plate.position.set(hl - 0.01, V.bumperY + V.bumperH / 2 + 0.11, 0);
    g.add(plate);
    const plateR = plate.clone();
    plateR.position.set(-hl + 0.01, V.bumperY + V.bumperH / 2 + 0.11, 0);
    g.add(plateR);

    const lights = [];
    for (const s of [-1, 1]) {
      // headlamp: a dark socket with the lens set into it
      const socket = new THREE.Mesh(new THREE.BoxGeometry(0.12, V.lamp[1] + 0.06, V.lamp[2] + 0.06), dark);
      socket.position.set(hl - 0.07, V.lamp[0], s * V.lamp[3]);
      g.add(socket);
      if (lit) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, V.lamp[1], V.lamp[2]),
          new THREE.MeshBasicMaterial({ color: 0xffc861 }));
        lamp.position.set(hl - 0.02, V.lamp[0], s * V.lamp[3]);
        lamp.visible = false;              // dark until the alarm trips
        lights.push(lamp);                 // added after the merge
      } else {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, V.lamp[1], V.lamp[2]), lampMat);
        lamp.position.set(hl - 0.02, V.lamp[0], s * V.lamp[3]);
        g.add(lamp);
      }
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.07, V.lamp[1] * 0.9, V.lamp[2] * 0.8), tailMat);
      tl.position.set(-hl + 0.02, V.lamp[0] + 0.06, s * V.lamp[3]);
      g.add(tl);
      // mirror, on its stalk off the A-pillar foot where a mirror lives
      if (V.mirror) {
        const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.09), shade);
        stalk.position.set(V.mirror[0], V.mirror[1], s * (hw + 0.03));
        const shell = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.11, 0.06), body);
        shell.position.set(V.mirror[0] - 0.02, V.mirror[1] + 0.02, s * (hw + 0.10));
        g.add(stalk, shell);
      }
    }
    // wipers parked at the base of the screen, and the drip rails on the roof
    if (V.screen && !wrecked) {
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.022, 0.022), dark);
        w.position.set(V.screen[0][0] - 0.10, V.screen[0][1] + 0.02, s * cabW * 0.22);
        w.rotation.z = 0.14;
        g.add(w);
      }
    }
    if (V.rails) {
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(V.rails[2], 0.035, 0.045), shade);
        rail.position.set(V.rails[0], V.rails[1], s * (cabW / 2 - 0.02));
        g.add(rail);
      }
    }
    // exhaust, low at one corner
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 6), chrome);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-hl + 0.08, V.bumperY - V.bumperH * 0.5 - 0.03, -hw * 0.55);
    g.add(pipe);

    /* --- the load bed, for the one body that has one ------------------- */
    if (V.bed) {
      // The tray: a ribbed floor sunk into the hull, walled by two side panels
      // and closed by a tailgate and the back of the cab. You can see into it,
      // which is the entire point of a pickup.
      const [x0, x1, by, bh] = V.bed;
      const bx = (x0 + x1) / 2, blen = Math.abs(x0 - x1);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(blen, 0.05, V.W - 0.16), dark);
      floor.position.set(bx, by + 0.03, 0);
      g.add(floor);
      for (let i = 0; i < 5; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(blen - 0.1, 0.03, 0.05), shade);
        rib.position.set(bx, by + 0.06, (i - 2) * ((V.W - 0.3) / 4.6));
        g.add(rib);
      }
      for (const sz of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(blen, bh, 0.10), body);
        side.position.set(bx, by + bh / 2, sz * (hw - 0.05));
        g.add(side);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(blen, 0.05, 0.16), shade);
        cap.position.set(bx, by + bh, sz * (hw - 0.05));
        g.add(cap);
      }
      const gate = new THREE.Mesh(new THREE.BoxGeometry(0.09, bh, V.W - 0.1), body);
      gate.position.set(x1 - 0.05, by + bh / 2, 0);
      g.add(gate);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, bh + 0.12, V.W - 0.14), body);
      head.position.set(x0 + 0.04, by + (bh + 0.12) / 2, 0);
      g.add(head);
    }

    /* --- wheels: tyre, rim, hub, and a wreck sitting on one drum ------- */
    let drop = wrecked ? 1 : -1;
    for (const ax of [V.axleF, V.axleR]) {
      for (const s of [-1, 1]) {
        const missing = wrecked && ax === V.axleF && s === 1;
        const zz = s * (hw - V.track);
        if (missing) {
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 8), rim);
          drum.rotation.x = Math.PI / 2;
          drum.position.set(ax, 0.18, zz);
          g.add(drum);
          drop = 1;
          continue;
        }
        const t = new THREE.Mesh(new THREE.CylinderGeometry(V.wheelR, V.wheelR, V.tyreW, 14), tyre);
        t.rotation.x = Math.PI / 2;
        t.position.set(ax, V.wheelR, zz);
        g.add(t);
        const r = new THREE.Mesh(
          new THREE.CylinderGeometry(V.wheelR * 0.62, V.wheelR * 0.62, V.tyreW + 0.02, 10), rim);
        r.rotation.x = Math.PI / 2;
        r.position.set(ax, V.wheelR, zz);
        g.add(r);
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(V.wheelR * 0.24, V.wheelR * 0.24, V.tyreW + 0.05, 8), chrome);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(ax, V.wheelR, zz);
        g.add(hub);
      }
    }
    if (wrecked) g.rotation.z = 0.03 * drop;   // settled onto the flat corner

    if (kind === 'cruiser') {                  // light bar and door flashes
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.09, cabW * 0.86), dark);
      bar.position.set(V.rails[0], V.rails[1] + 0.14, 0);
      g.add(bar);
      for (const [ox, c] of [[-0.26, 0xb03028], [0.26, 0x2a58b0]]) {
        const dome = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, cabW * 0.42), this.colorMat(c));
        dome.position.set(V.rails[0] + ox, V.rails[1] + 0.23, 0);
        g.add(dome);
      }
      for (const s of [-1, 1]) {
        const flash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.02), this.colorMat(0xdcdcd4));
        flash.position.set(-0.1, V.strip[1] + 0.08, s * (hw + 0.03));
        g.add(flash);
      }
    }

    mergeStatic(g);
    for (const l of lights) g.add(l);        // animated, so kept out of the merge
    return { group: g, collide: [hl, 1.0, hw], lights, kind };
  }

  /**
   * The lower body's silhouette, with the wheel arches cut into its underside.
   *
   * The arches are the whole reason this is generated rather than written out:
   * each one is a real semicircle struck about its own axle, so the body sits
   * OVER the wheels instead of beside them, and moving an axle moves the arch
   * that covers it.
   */
  _hullOutline(V) {
    const pts = [...V.hull];                 // nose, beltline and tail, front to rear
    const sill = V.sill;
    const arch = (cx, r) => {
      const out = [];
      for (let i = 0; i <= 8; i++) {         // 180° -> 0°, i.e. rear lip over the top
        const a = Math.PI * (1 - i / 8);
        out.push([cx + Math.cos(a) * r, sill + Math.sin(a) * r * V.archSquash]);
      }
      return out;
    };
    // Underside, running from the rear bumper forward. Each arch already
    // BEGINS and ENDS on the sill line, so it is butted straight onto the
    // straight sections either side of it — a two-centimetre lead-in point
    // there is shorter than the bevel that gets applied to this outline, and
    // an edge shorter than its own bevel is where an extrusion goes to NaN.
    pts.push([-V.L / 2 + 0.12, sill]);
    pts.push(...arch(V.axleR, V.arch));
    pts.push(...arch(V.axleF, V.arch));
    pts.push([V.L / 2 - 0.12, sill]);
    return pts;
  }

  wreckedCar(paint = 0x5a3b34, kind = 'sedan') {
    return this._vehicle({ paint, kind, wrecked: true });
  }

  /** Delivery van / box truck — taller cover than a car, blocks a lane. */
  van(paint = 0x6b6f60, wrecked = false) {
    return this._vehicle({ paint, kind: 'van', wrecked });
  }

  /** Pickup with an open bed. */
  pickup(paint = 0x694f28, wrecked = false) {
    return this._vehicle({ paint, kind: 'pickup', wrecked });
  }

  /** City bus abandoned across a street — the biggest piece of hard cover. */
  bus(paint = 0x2f6a52) {
    const v = this._vehicle({ paint, kind: 'bus', wrecked: true });
    v.collide = [4.2, 1.4, 1.2];
    return v;
  }

  lamppost() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6), this.colorMat(0x2c3036));
    pole.position.y = 2.3;
    const arm = this.box(1.1, 0.12, 0.12, this.colorMat(0x2c3036));
    arm.position.set(0.5, 4.5, 0);
    const head = this.box(0.5, 0.22, 0.3, new THREE.MeshBasicMaterial({ color: 0xffdf9a }));
    head.position.set(0.95, 4.4, 0);
    g.add(pole, arm, head);
    return { group: g, collide: [0.16, 2.3, 0.16] };
  }

  trafficLight() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 6), this.colorMat(0x23262b));
    pole.position.y = 1.8;
    const housing = this.box(0.34, 0.95, 0.3, this.colorMat(0x1a1d21));
    housing.position.y = 3.2;
    g.add(pole, housing);
    let i = 0;
    for (const c of [0x571f1f, 0x574a1f, 0x1f5724]) { // dead lights
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), this.colorMat(c));
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(0, 3.5 - i * 0.28, 0.16);
      g.add(lamp); i++;
    }
    return { group: g, collide: [0.14, 1.8, 0.14] };
  }

  hydrant() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.75, 8), this.colorMat(0x8c2a22));
    body.position.y = 0.38;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), this.colorMat(0x7a241e));
    cap.position.y = 0.8;
    g.add(body, cap);
    return { group: g, collide: [0.25, 0.5, 0.25] };
  }

  bench() {
    const g = new THREE.Group();
    const seat = this.box(1.8, 0.08, 0.5, 'wallWood');
    seat.position.y = 0.45;
    const back = this.box(1.8, 0.5, 0.08, 'wallWood');
    back.position.set(0, 0.75, -0.22);
    for (const s of [-0.75, 0.75]) {
      const leg = this.box(0.08, 0.45, 0.5, this.colorMat(0x2c3036));
      leg.position.set(s, 0.22, 0);
      g.add(leg);
    }
    g.add(seat, back);
    return { group: g, collide: [0.95, 0.5, 0.35] };
  }

  dumpster() {
    const g = new THREE.Group();
    const body = this.box(2.2, 1.25, 1.3, 'metalRust');
    body.position.y = 0.72;
    const lid = this.box(2.2, 0.1, 1.3, this.colorMat(0x2e4433));
    lid.position.set(0, 1.38, -0.15);
    lid.rotation.x = -0.25;
    g.add(body, lid);
    return { group: g, collide: [1.1, 0.9, 0.7] };
  }

  barrel() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.0, 10), this.mat('metalRust'));
    b.position.y = 0.5;
    g.add(b);
    return { group: g, collide: [0.4, 0.6, 0.4] };
  }

  crateStack(n = 2) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const c = this.box(1.1, 1.1, 1.1, 'crate');
      c.position.set((i % 2) * 0.3 - 0.15, 0.56 + i * 0.02 + (i > 0 ? 1.1 * Math.floor(i / 2) : 0), (i % 2) * -0.4);
      if (i % 2) c.rotation.y = 0.4;
      g.add(c);
    }
    return { group: g, collide: [0.9, 1.0, 0.9] };
  }

  /* ---- mosque-style zone borders --------------------------------------
   * Tall white-marble walls with arcaded niches, dense gold-tipped merlon
   * rows, onion-dome features, corner turrets, and (for gates) a pointed
   * portal arch sealed by a golden screen, flanked by minarets. Built from
   * segment endpoints so every module roots to the terrain under it; the
   * whole group is merged so a border costs a handful of draw calls.
   * Callers register the movement collider (needs a removal id).         */

  /** Gold onion dome with drum, tip spike and crescent finial. */
  _onionDome(parent, x, y, z, r = 1) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.95, r * 0.8, 8), this.mat('marbleWhite'));
    drum.position.set(x, y + r * 0.4, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), this.mat('goldMetal'));
    dome.scale.y = 1.15;
    dome.position.set(x, y + r * 1.3, z);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.2, r * 0.85, 6), this.mat('goldMetal'));
    tip.position.set(x, y + r * 2.55, z);
    const crescent = new THREE.Mesh(new THREE.TorusGeometry(r * 0.22, r * 0.05, 5, 8, Math.PI * 1.4), this.mat('goldMetal'));
    crescent.position.set(x, y + r * 3.05, z);
    crescent.rotation.z = Math.PI * 0.55;
    parent.add(drum, dome, tip, crescent);
  }

  /** Square wall turret capping a border segment's ends. */
  _wallTurret(parent, h) {
    const shaft = this.box(1.6, h + 3, 2.3, 'marbleWhite');
    shaft.position.y = (h + 3) / 2 - 3; // rooted 3 m into the ground
    const band = this.box(1.8, 0.32, 2.5, 'goldMetal');
    band.position.y = h - 0.45;
    parent.add(shaft, band);
    this._onionDome(parent, 0, h, 0, 0.62);
  }

  /** Gate minaret: pedestal, tiered white shaft, gold balcony, dome. */
  _minaret(parent) {
    const pedestal = this.box(2.6, 5, 2.6, 'marbleWhite');
    pedestal.position.y = -0.5; // rooted 3 m, 2 m visible plinth
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 12.5, 8), this.mat('marbleWhite'));
    shaft.position.y = 8.0;
    const balcony = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.0, 0.6, 8), this.mat('goldMetal'));
    balcony.position.y = 11.6;
    const parapet = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.55, 8), this.mat('marbleWhite'));
    parapet.position.y = 12.15;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 3.0, 8), this.mat('marbleWhite'));
    upper.position.y = 13.9;
    parent.add(pedestal, shaft, balcony, parapet, upper);
    this._onionDome(parent, 0, 15.3, 0, 0.78);
  }

  /** One wall module: plinth, arcaded body, cornice, merlons + a feature. */
  _mosqueModule(m, mlen, H, rng, feature) {
    const plinth = this.box(mlen + 0.02, 3.2, 2.1, 'marbleWhite');
    plinth.position.y = -1.3; // roots the module into sloped ground
    const body = this.box(mlen + 0.02, H, 1.5, 'marbleWhite');
    body.position.y = H / 2;
    const cornice = this.box(mlen + 0.06, 0.45, 1.9, 'marbleWhite');
    cornice.position.y = H + 0.22;
    const trim = this.box(mlen + 0.1, 0.16, 1.95, 'goldMetal');
    trim.position.y = H - 0.14;
    const band = this.box(mlen + 0.06, 0.14, 1.6, 'goldMetal'); // dado course
    band.position.y = 0.42;
    m.add(plinth, body, cornice, trim, band);
    // pointed-arch niches on both faces
    const arches = Math.max(1, Math.floor(mlen / 2.1));
    for (let a = 0; a < arches; a++) {
      const ax = ((a + 0.5) / arches - 0.5) * (mlen - 1.2);
      for (const s of [-1, 1]) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.9), this.mat('archNiche'));
        q.position.set(ax, 2.4, s * 0.78);
        if (s < 0) q.rotation.y = Math.PI;
        m.add(q);
      }
    }
    // dense row of pointed merlons along the parapet
    const crenels = Math.max(2, Math.round(mlen / 1.1));
    for (let c = 0; c < crenels; c++) {
      const cx = ((c + 0.5) / crenels - 0.5) * mlen;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.0, 4), this.mat('marbleWhite'));
      spike.position.set(cx, H + 0.9, 0);
      spike.rotation.y = Math.PI / 4;
      m.add(spike);
    }
    if (feature === 'dome') {
      this._onionDome(m, 0, H + 0.42, 0, 0.9);
    } else if (feature === 'spire') {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2.3, 4), this.mat('marbleWhite'));
      sp.position.y = H + 1.55;
      sp.rotation.y = Math.PI / 4;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), this.mat('goldMetal'));
      ball.position.y = H + 2.85;
      m.add(sp, ball);
    }
  }

  /** Terrain-following, seamless row of wall modules. Modules always tile
   *  the full length — a border never has a hole in it; a portal overlays
   *  the wall instead. Features go 'plain' near plainT so nothing pokes
   *  through a gate's pediment. */
  _mosqueRun(g, x1, z1, x2, z2, plainT = null, plainHalf = 0) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const baseY = this.terrain.heightAt((x1 + x2) / 2, (z1 + z2) / 2);
    const rng = seeded(x1 * 13 + z1 * 7 + x2 * 3 + z2 * 17);
    const n = Math.max(1, Math.round(len / 6));
    const mlen = len / n;
    const H = 6.0;
    const features = ['spire', 'plain', 'dome', 'plain'];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * mlen - len / 2;
      const f = (t + len / 2) / len;
      const wy = this.terrain.heightAt(x1 + (x2 - x1) * f, z1 + (z2 - z1) * f);
      const m = new THREE.Group();
      m.position.set(t, wy - baseY, 0);
      g.add(m);
      const pick = features[Math.floor(rng() * features.length)];
      const plain = plainT !== null && Math.abs(t - plainT) < plainHalf;
      this._mosqueModule(m, mlen, H, rng, plain ? 'plain' : pick);
    }
    // corner turrets root the ends
    for (const s of [-1, 1]) {
      const f = s < 0 ? 0.01 : 0.99;
      const wy = this.terrain.heightAt(x1 + (x2 - x1) * f, z1 + (z2 - z1) * f);
      const tw = new THREE.Group();
      tw.position.set(s * (len / 2 - 0.7), wy - baseY, 0);
      this._wallTurret(tw, H + 0.9);
      g.add(tw);
    }
    return { len, baseY, H };
  }

  /** Solid border wall for a zone frontier. len along X before yaw. */
  mosqueWall(x1, z1, x2, z2) {
    const g = new THREE.Group();
    this._mosqueRun(g, x1, z1, x2, z2);
    mergeStatic(g);
    return { group: g };
  }

  /**
   * Gate segment: the wall runs unbroken and a grand sealed portal overlays
   * it — piers, stepped pointed arch over a solid tympanum, golden lattice
   * screen through the full wall depth, domed pediment, and two flanking
   * minarets. No opening anywhere: the border reads as a gate but stands
   * shut until the district unlocks and the whole thing sinks. portalT
   * positions the portal along the segment (0..1) to line up with its road.
   */
  mosqueGate(x1, z1, x2, z2, portalT = 0.5) {
    const g = new THREE.Group();
    const len = Math.hypot(x2 - x1, z2 - z1);
    const pT = (portalT - 0.5) * len;
    const { baseY } = this._mosqueRun(g, x1, z1, x2, z2, pT, 8);
    const wyP = this.terrain.heightAt(x1 + (x2 - x1) * portalT, z1 + (z2 - z1) * portalT);
    const portal = new THREE.Group();
    portal.position.set(pT, wyP - baseY, 0);
    g.add(portal);
    // piers, rooted deep
    for (const s of [-1, 1]) {
      const pier = this.box(1.4, 12.2, 2.6, 'marbleWhite');
      pier.position.set(s * 3.2, 3.6, 0); // -2.5 .. 9.7
      const cap = this.box(1.55, 0.32, 2.75, 'goldMetal');
      cap.position.set(s * 3.2, 9.0, 0);
      portal.add(pier, cap);
      for (const q of [-1, 1]) { // arch faces on the piers
        const niche = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.8), this.mat('archNiche'));
        niche.position.set(s * 3.2, 2.3, q * 1.31);
        if (q < 0) niche.rotation.y = Math.PI;
        portal.add(niche);
      }
    }
    // golden screen seals the archway through the full wall depth
    const screen = this.box(5.0, 5.75, 1.9, 'goldScreen');
    screen.position.y = 2.87;
    portal.add(screen);
    // solid tympanum backing the arch head — no sky through the gate
    const tympanum = this.box(5.0, 2.35, 1.7, 'marbleWhite');
    tympanum.position.y = 6.88;
    const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.86, 8), this.mat('goldMetal'));
    medallion.rotation.x = Math.PI / 2;
    medallion.position.y = 6.88;
    portal.add(tympanum, medallion);
    // stepped pointed-arch relief over the tympanum
    const opening = 5.0; // between pier inner faces
    for (let step = 0; step < 3; step++) {
      const y = 5.75 + step * 0.75;
      const gap = Math.max(0, opening - (step + 1) * 1.9);
      const reach = (opening - gap) / 2;
      if (gap < 0.3) {
        const lintel = this.box(opening + 0.2, 0.75, 2.6, 'marbleWhite');
        lintel.position.set(0, y + 0.37, 0);
        portal.add(lintel);
      } else {
        for (const s of [-1, 1]) {
          const corbel = this.box(reach, 0.75, 2.6, 'marbleWhite');
          corbel.position.set(s * (opening / 2 - reach / 2), y + 0.37, 0);
          portal.add(corbel);
        }
      }
    }
    // pediment, gold trim, merlon row, side domes and the crowning dome
    const pediment = this.box(8.6, 1.5, 2.7, 'marbleWhite');
    pediment.position.y = 10.15;
    const trim = this.box(8.7, 0.2, 2.8, 'goldMetal');
    trim.position.y = 10.98;
    portal.add(pediment, trim);
    for (const s of [-2.4, -1.2, 1.2, 2.4]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.9, 4), this.mat('marbleWhite'));
      spike.position.set(s, 11.4, 0);
      spike.rotation.y = Math.PI / 4;
      portal.add(spike);
    }
    this._onionDome(portal, 0, 10.9, 0, 1.45);
    for (const s of [-1, 1]) this._onionDome(portal, s * 3.5, 10.9, 0, 0.62);
    // flanking minarets (the unbroken wall passes behind their pedestals)
    for (const s of [-1, 1]) {
      const f = Math.min(0.99, Math.max(0.01, portalT + (s * 6.6) / len));
      const wy = this.terrain.heightAt(x1 + (x2 - x1) * f, z1 + (z2 - z1) * f);
      const mn = new THREE.Group();
      mn.position.set(pT + s * 6.6, wy - baseY, 0);
      this._minaret(mn);
      g.add(mn);
    }
    mergeStatic(g);
    return { group: g };
  }

  /**
   * A bus shelter, built as a bus shelter.
   *
   * What was here before was a grey slab on two sticks with a second slab for
   * a bench — the shape of a bus stop described from memory. A real shelter is
   * a GLAZED BOX with one side open to the kerb: a welded tube frame with
   * glass in it, a cantilevered roof with a drip edge and a fall on it, a
   * perch seat rather than a plank (nobody is meant to be comfortable), a
   * back-lit poster panel at the closed end, a timetable case at reading
   * height, and the flag on its own pole out at the kerb — which is the part
   * that actually says "bus" from down the street, and the part that was
   * missing entirely.
   *
   * The open side is +Z, so the caller points that at the road.
   */
  busStop() {
    const g = new THREE.Group();
    const HW = 1.75, HD = 0.72, H = 2.42;      // half-width, half-depth, eaves
    const frame = this.colorMat(0x39414a);     // the powder-coated tube
    const trim = this.colorMat(0x6f7780);
    const glassM = this.mat('window', { transparent: true, opacity: 0.42, side: THREE.DoubleSide });
    const kerb = this.mat('sidewalk');

    // --- the pad it stands on, and the kerb face at the road edge
    const pad = this.box(HW * 2 + 0.5, 0.09, HD * 2 + 0.45, kerb);
    pad.position.set(0, 0.045, -0.05);
    g.add(pad);

    // --- frame: four uprights, a header all the way round, and a foot rail
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, H, 0.09), frame);
        post.position.set(sx * HW, H / 2, sz * HD);
        g.add(post);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), trim);
        foot.position.set(sx * HW, 0.11, sz * HD);
        g.add(foot);
      }
    }
    const rail = (w, d, y, x = 0, z = 0) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), frame);
      r.position.set(x, y, z);
      g.add(r);
      return r;
    };
    rail(HW * 2 + 0.09, 0.09, H - 0.05, 0, -HD);     // header, back
    rail(HW * 2 + 0.09, 0.09, H - 0.05, 0, HD);      // header, kerb side
    for (const sx of [-1, 1]) rail(0.09, HD * 2, H - 0.05, sx * HW);
    rail(HW * 2 + 0.09, 0.09, 0.22, 0, -HD);         // kick rail along the back

    // --- glazing: the back wall in two panes, and one pane in each end. The
    //     kerb side is deliberately empty — that is the way in.
    const glass = (w, h, x, y, z, ry = 0) => {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassM);
      q.position.set(x, y, z);
      q.rotation.y = ry;
      q.renderOrder = 1;
      g.add(q);
      // The gasket the pane is held in — FOUR EDGE STRIPS, not a backing slab.
      // A slab behind a 42%-opaque pane is what you actually see, so the glass
      // read as a painted panel: the frame has to be a frame.
      for (const [gw, gh, gx, gy] of [
        [w + 0.08, 0.05, 0, h / 2], [w + 0.08, 0.05, 0, -h / 2],
        [0.05, h + 0.08, w / 2, 0], [0.05, h + 0.08, -w / 2, 0],
      ]) {
        const gk = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.05), trim);
        gk.position.set(x + Math.cos(ry) * gx, y + gy, z - Math.sin(ry) * gx);
        gk.rotation.y = ry;
        g.add(gk);
      }
    };
    for (const sx of [-1, 1]) {
      glass(HW - 0.22, H - 0.5, sx * (HW / 2 + 0.05), H / 2 + 0.08, -HD + 0.05);
      glass(HD * 2 - 0.24, H - 0.5, sx * (HW - 0.05), H / 2 + 0.08, 0, Math.PI / 2);
    }

    // --- roof: a shallow single fall to the back, with a drip edge and the
    //     gutter stub the water actually leaves by
    const roof = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 0.42, 0.09, HD * 2 + 0.5), this.mat('roofMetal'));
    roof.position.set(0, H + 0.13, 0.02);
    roof.rotation.x = -0.05;
    g.add(roof);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 0.42, 0.11, 0.06), trim);
    lip.position.set(0, H + 0.11, HD + 0.25);
    g.add(lip);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 6), trim);
    spout.position.set(-HW - 0.1, H - 0.14, -HD - 0.14);
    g.add(spout);

    // --- the perch: a slatted bench on two cantilever brackets
    for (let i = 0; i < 3; i++) {
      const slat = this.box(HW * 1.75, 0.05, 0.11, 'wallWood');
      slat.position.set(0, 0.6, -HD + 0.18 + i * 0.15);
      g.add(slat);
    }
    for (const sx of [-1, 1]) {
      const brk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.42), frame);
      brk.position.set(sx * HW * 0.72, 0.37, -HD + 0.3);
      g.add(brk);
    }

    // --- the closed end's poster panel, and the timetable case beside the way in
    const posterBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, HD * 1.5), this.colorMat(0x232a30));
    posterBox.position.set(-HW + 0.02, 1.28, 0);
    g.add(posterBox);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(HD * 1.32, 1.32), this.mat('posterNotice'));
    poster.position.set(-HW + 0.08, 1.28, 0);
    poster.rotation.y = -Math.PI / 2;
    g.add(poster);
    const caseBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.07), this.colorMat(0x1d3346));
    caseBox.position.set(HW - 0.42, 1.62, -HD + 0.1);
    g.add(caseBox);
    const times = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.54), this.colorMat(0xd8d2c0));
    times.position.set(HW - 0.42, 1.62, -HD + 0.145);
    g.add(times);

    // --- the flag: a pole out at the kerb with the route disc on it. This is
    //     what identifies the thing from fifty metres, so it stands clear of
    //     the shelter rather than being bolted to it.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.1, 8), this.colorMat(0x2c3036));
    pole.position.set(HW + 0.55, 1.55, HD + 0.05);
    g.add(pole);
    const flagPlate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.5), this.colorMat(0xd8d2c0));
    flagPlate.position.set(HW + 0.58, 2.72, HD + 0.05);
    g.add(flagPlate);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.5), this.colorMat(0x2d4a66));
    band.position.set(HW + 0.6, 2.9, HD + 0.05);
    g.add(band);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), this.colorMat(0xb8321f));
    disc.rotation.z = Math.PI / 2;
    disc.position.set(HW + 0.62, 2.62, HD + 0.05);
    g.add(disc);

    mergeStatic(g);
    // Collider on the SHELTER only: the pad is a step you walk over, and the
    // flag pole is a stick you walk past.
    return { group: g, collide: [HW + 0.05, 1.2, HD + 0.05] };
  }

  signPost(color = 0x6b7280) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), this.colorMat(0x2c3036));
    pole.position.y = 1.3;
    const sign = this.box(0.7, 0.7, 0.04, this.colorMat(color));
    sign.position.y = 2.4;
    g.add(pole, sign);
    return { group: g };
  }

  utilityPole() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 7.5, 6), this.mat('bark'));
    pole.position.y = 3.75;
    const cross = this.box(2.4, 0.15, 0.15, 'bark');
    cross.position.y = 6.9;
    g.add(pole, cross);
    return { group: g, collide: [0.2, 3.7, 0.2] };
  }

  mailbox() {
    const g = new THREE.Group();
    const post = this.box(0.08, 1.1, 0.08, 'wallWood');
    post.position.y = 0.55;
    const boxm = this.box(0.5, 0.3, 0.3, this.colorMat(0x39465e));
    boxm.position.y = 1.2;
    g.add(post, boxm);
    return { group: g };
  }

  /**
   * The well, and the water in it.
   *
   * A disc of water texture sitting perfectly still at the bottom of a shaft
   * reads as a painted lid — the one surface in the town where nothing moving
   * is most obviously wrong, because a well is a hole with water in it and
   * water in a hole is never flat. So it moves three ways at once, none of
   * them expensive: the sheet crawls (registered by World as a uvDrift), the
   * sheet itself rises and falls a few millimetres on a slow swell, and the
   * drips off the bucket rope land in it — expanding rings that fade as they
   * spread, on their own beats so no two ever leave together.
   *
   * Returns its moving parts so World can register them.
   */
  well() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 10, 1, true), this.mat('brickGray', { side: THREE.DoubleSide }));
    ring.position.y = 0.45;
    // The well's own water material, NOT the pond's: this one crawls at its
    // own rate, and a shared material would drag every pond in the map with it.
    this._wellWaterMat ??= new THREE.MeshLambertMaterial({
      map: this.texLib.tiled ? this.texLib.tiled('water', 1.6, 1.6) : this.texLib.get('water'),
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 20), this._wellWaterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.5;
    // The drip rings. Flat annuli lying on the water, additive-free and
    // depth-write-free so they never fight the sheet they float on.
    const rings = [];
    const ripples = new THREE.Group();
    ripples.position.y = 0.505;
    ripples.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xcfe4ee, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const r = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.95, 18), mat);
      r.renderOrder = 2;
      r.position.set((i - 1) * 0.22, (i % 2 ? 1 : -1) * 0.18, 0);
      ripples.add(r);
      rings.push({ mesh: r, mat, phase: i * 1.37 });
    }
    for (const s of [-1, 1]) {
      const post = this.box(0.12, 1.7, 0.12, 'wallWood');
      post.position.set(s * 0.95, 1.2, 0);
      g.add(post);
    }
    // the windlass and the bucket on its rope — what puts the drips in
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.75, 8), this.mat('bark'));
    axle.rotation.z = Math.PI / 2;
    axle.position.y = 1.66;
    const crank = this.box(0.06, 0.34, 0.06, this.colorMat(0x2c3036));
    crank.position.set(1.05, 1.5, 0);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 5), this.colorMat(0x6b5a3c));
    rope.position.set(0, 1.32, 0);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.26, 9), this.mat('wallWood'));
    bucket.position.set(0, 0.9, 0);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 4, 10), this.colorMat(0x5b5148));
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(0, 0.99, 0);
    const bucketNode = new THREE.Group();
    bucketNode.add(rope, bucket, hoop);
    const roofBox = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 4), this.mat('roofShingle'));
    roofBox.position.y = 2.4;
    roofBox.rotation.y = Math.PI / 4;
    g.add(ring, water, ripples, axle, crank, bucketNode, roofBox);
    return {
      group: g, collide: [1.2, 0.8, 1.2],
      water: { sheet: water, mat: this._wellWaterMat, rings, bucket: bucketNode, baseY: 0.5 },
    };
  }

  tent(color = 0x4a4f3a) {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.02, 1.6, 1.7, 3, 1);
    const body = new THREE.Mesh(geo, this.colorMat(color));
    body.position.y = 0.85;
    body.rotation.y = Math.PI;
    g.add(body);
    return { group: g, collide: [1.2, 0.9, 1.2] };
  }

  /**
   * A campfire that is still going.
   *
   * The fire is two nested additive cones — an orange body and a hotter core —
   * over the flat ground glow that was here before. Nothing about the shape is
   * clever; what sells it is that the two cones flex on different beats and
   * the light flexes with them, so the shadows in the ring of trees never sit
   * still. Returns its moving parts for World to register.
   */
  campfire() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const log = this.box(0.9, 0.12, 0.12, 'bark');
      log.rotation.y = (i / 5) * Math.PI;
      log.position.y = 0.1 + (i % 2) * 0.08;
      g.add(log);
    }
    const stones = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 5, 9), this.mat('rock'));
    stones.rotation.x = Math.PI / 2;
    stones.position.y = 0.08;
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7830 });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.16;
    g.add(stones, glow);
    // Three tiers on five and four sides rather than one smooth cone: at these
    // segment counts the silhouette is a ragged spike, and because each tier
    // turns at its own rate the ragged edge never repeats. A single smooth cone
    // reads as a traffic cone lit from inside; this reads as a fire.
    const flames = [];
    for (const [r, h, seg, color, op] of [
      [0.46, 0.42, 6, 0xff5614, 0.5],    // the fat, dull base sitting on the logs
      [0.31, 0.98, 5, 0xff8c28, 0.55],   // the body, tallest
      [0.15, 0.6, 4, 0xffe08a, 0.8],     // the bright core inside it
    ]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: op, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
      cone.position.y = 0.14 + h / 2;
      cone.renderOrder = 3;
      g.add(cone);
      flames.push(cone);
    }
    const light = new THREE.PointLight(0xff8a3a, 9, 13);
    light.position.y = 0.8;
    g.add(light);
    return { group: g, flames, light, glowMat };
  }

  /** Sagging utility wire strung between two world points (visual only). */
  wireRun(parent, x1, y1, z1, x2, y2, z2, sag = 0.9) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t - Math.sin(Math.PI * t) * sag,
        z1 + (z2 - z1) * t));
    }
    this._wireMat ??= new THREE.LineBasicMaterial({ color: 0x14161a });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this._wireMat);
    parent.add(line);
    return line;
  }

  /**
   * A FILLING STATION, built as a filling station.
   *
   * What stood here was a slab on four posts with two red boxes under it. The
   * boxes were the pumps. Nothing about either said petrol, and the slab said
   * nothing at all — a canopy is not a lid, it is a deck with a lit fascia and
   * a soffit full of downlights, which is exactly the part you see first
   * because it is the part at eye level from the road.
   *
   * So: a poured forecourt with lane arrows on it, a canopy with a branded
   * fascia band and six lamps in its soffit, two kerbed islands each carrying
   * a real double-sided pump — hose, nozzle in its boot, a lit price head, a
   * keypad, a topper — a price totem out at the kerb, an air line on its reel,
   * and a paved walk out to the shop the site was planned with.
   *
   * Placed axis-aligned at (x, z); registers all its own colliders. Returns
   * the moving and lit parts so World can put them on the clock:
   *   `tubes`   materials for the canopy soffit and the pump heads (strike,
   *             hold and drop out — the forecourt's power is not good)
   *   `reel`    the air-line reel, which turns
   *   `pumps`   world positions, so one of them can be made interactive
   */
  gasStation(x, z, parent) {
    const y = this.terrain.heightAt(x, z);
    const g = new THREE.Group();
    const out = { group: g, tubes: [], pumps: [], reel: null };
    const brand = this.colorMat(0xb8452a);        // the company's red
    const cream = this.colorMat(0xd9d3c0);
    const steel = this.colorMat(0x8e9298);
    const dark = this.colorMat(0x1e2226);
    const rubber = this.colorMat(0x15171b);

    /* --- the forecourt slab, and the lanes painted on it ---------------- */
    const apron = this.box(15.6, 0.12, 9.6, 'concrete');
    apron.position.y = 0.06;
    g.add(apron);
    for (const lz of [-2.4, 2.4]) {                // lane guide lines
      const line = this.box(13.0, 0.02, 0.14, cream);
      line.position.set(0, 0.13, lz);
      g.add(line);
    }

    /* --- the canopy: deck, branded fascia, soffit, downlights ----------- */
    const COL = [[-5.6, -3.0], [5.6, -3.0], [-5.6, 3.0], [5.6, 3.0]];
    for (const [px, pz] of COL) {
      const shaft = this.box(0.44, 4.7, 0.44, 'wallConcrete');
      shaft.position.set(px, 2.35, pz);
      const collar = this.box(0.66, 0.5, 0.66, cream);
      collar.position.set(px, 0.35, pz);
      const cap = this.box(0.58, 0.16, 0.58, steel);
      cap.position.set(px, 4.62, pz);
      g.add(shaft, collar, cap);
      this.collision.addBoxCentered(x + px, y + 2.35, z + pz, 0.33, 2.35, 0.33, 'prop');
    }
    const CW = 14.4, CD = 8.2, CY = 4.98;
    const deck = this.box(CW, 0.34, CD, 'roofMetal');
    deck.position.y = CY;
    g.add(deck);
    // the fascia band — the lit hoop that reads as "petrol station" from a
    // street away, in brand red over a cream stripe
    for (const [w, d, px, pz] of [[CW + 0.24, 0.16, 0, -CD / 2], [CW + 0.24, 0.16, 0, CD / 2],
      [0.16, CD + 0.24, -CW / 2, 0], [0.16, CD + 0.24, CW / 2, 0]]) {
      const band = this.box(w, 0.62, d, brand);
      band.position.set(px, CY + 0.14, pz);
      g.add(band);
      const stripe = this.box(w + 0.02, 0.14, d + 0.02, cream);
      stripe.position.set(px, CY - 0.06, pz);
      g.add(stripe);
    }
    const soffit = this.box(CW - 0.4, 0.06, CD - 0.4, cream);
    soffit.position.y = CY - 0.19;
    g.add(soffit);
    // six downlights in the soffit, on a supply that is not what it was
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
    out.tubes.push({ mat: lampMat, r: 1, g: 0.94, b: 0.78, hi: 0.95, lo: 0.14, duty: 0.9, rate: 0.7 });
    for (const lx of [-4.6, 0, 4.6]) {
      for (const lz of [-2.0, 2.0]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.5), lampMat);
        lamp.position.set(lx, CY - 0.23, lz);
        g.add(lamp);
      }
    }

    /* --- the pumps, on kerbed islands ---------------------------------- */
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffb43c });
    out.tubes.push({ mat: headMat, r: 1, g: 0.70, b: 0.24, hi: 0.9, lo: 0.2, duty: 0.84, rate: 1.1 });
    for (const px of [-3.2, 3.2]) {
      const island = this.box(3.2, 0.2, 1.5, 'concrete');
      island.position.set(px, 0.22, -0.4);
      const kerb = this.box(3.3, 0.1, 1.6, cream);
      kerb.position.set(px, 0.32, -0.4);
      g.add(island, kerb);
      g.add(this._gasPump(px, 0.32, -0.4, brand, cream, dark, steel, rubber, headMat));
      // the bollards that stop somebody reversing into it
      for (const bx of [-1.4, 1.4]) {
        const bol = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8), this.colorMat(0xc8a22a));
        bol.position.set(px + bx, 0.75, -0.4);
        g.add(bol);
      }
      this.collision.addBoxCentered(x + px, y + 0.9, z - 0.4, 0.7, 0.9, 0.45, 'prop');
      out.pumps.push({ x: x + px, z: z - 0.4, y });
    }

    /* --- the air line, on a reel that still turns ---------------------- */
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.5, 8), steel);
    post.position.set(-6.6, 0.75, 3.4);
    g.add(post);
    const reel = new THREE.Group();
    reel.position.set(-6.6, 1.5, 3.4);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), brand);
    drum.rotation.z = Math.PI / 2;
    reel.add(drum);
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 12), steel);
      cheek.rotation.z = Math.PI / 2;
      cheek.position.x = s * 0.11;
      reel.add(cheek);
      const spoke = this.box(0.03, 0.62, 0.03, steel);
      spoke.position.x = s * 0.13;
      reel.add(spoke);
    }
    g.add(reel);
    out.reel = reel;

    /* --- the price totem out at the kerb ------------------------------- */
    const totem = new THREE.Group();
    totem.position.set(-6.9, 0, -4.2);
    for (const s of [-1, 1]) {
      const leg = this.box(0.16, 3.4, 0.16, steel);
      leg.position.set(s * 0.42, 1.7, 0);
      totem.add(leg);
    }
    const boardBack = this.box(1.5, 1.9, 0.18, brand);
    boardBack.position.y = 4.1;
    totem.add(boardBack);
    const boardFace = this.box(1.24, 1.0, 0.22, dark);
    boardFace.position.y = 3.86;
    totem.add(boardFace);
    const digitsMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });
    out.tubes.push({ mat: digitsMat, r: 1, g: 0.82, b: 0.29, hi: 0.92, lo: 0.1, duty: 0.72, rate: 1.6 });
    for (let i = 0; i < 4; i++) {                  // the price, still displayed
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.26), digitsMat);
      d.position.set(-0.48 + i * 0.32, 3.86, 0);
      totem.add(d);
    }
    const crown = this.box(1.6, 0.5, 0.24, cream);
    crown.position.y = 4.86;
    totem.add(crown);
    g.add(totem);
    this.collision.addBoxCentered(x - 6.9, y + 1.6, z - 4.2, 0.5, 1.6, 0.2, 'prop');

    /* --- the pay window, on the wall of the shop the site already has ---
     * There is a kiosk here: it is the `gasShop` building the district was
     * planned with (gasEast, gasShop — see World._planBuildings), and it is
     * enterable. What the forecourt was missing was the LINK to it, so the
     * apron runs a paved walk out to the shop side of the site instead of
     * stopping at the canopy drip line, and the night hatch and its bell are
     * on the end of that walk where somebody would actually queue.
     */
    const walk = this.box(2.4, 0.1, 5.2, 'sidewalk');
    walk.position.set(6.4, 0.11, 3.4);
    g.add(walk);
    const stand = new THREE.Group();
    stand.position.set(6.4, 0, 5.4);
    const boardPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 8), steel);
    boardPost.position.y = 0.7;
    const boardFace2 = this.box(0.9, 0.66, 0.08, cream);
    boardFace2.position.y = 1.5;
    const boardEdge = this.box(0.98, 0.1, 0.12, brand);
    boardEdge.position.y = 1.85;
    stand.add(boardPost, boardFace2, boardEdge);
    g.add(stand);

    this.place(g, x, z);
    parent.add(g);
    return out;
  }

  /**
   * One double-sided pump: plinth, body, lit head with its price and volume
   * windows, a keypad, a nozzle in its boot on each side with the hose looping
   * back into the body, and the brand topper. Sized off a real one — 1.9 m to
   * the top of the topper, which is what puts the head at eye level.
   */
  _gasPump(px, py, pz, brand, cream, dark, steel, rubber, headMat) {
    const p = new THREE.Group();
    p.position.set(px, py, pz);
    const plinth = this.box(0.78, 0.14, 0.56, dark);
    plinth.position.y = 0.07;
    const body = this.box(0.66, 1.16, 0.44, cream);
    body.position.y = 0.72;
    const skirt = this.box(0.68, 0.30, 0.46, brand);
    skirt.position.y = 0.29;
    const head = this.box(0.74, 0.46, 0.50, brand);
    head.position.y = 1.53;
    const brow = this.box(0.78, 0.08, 0.54, cream);
    brow.position.y = 1.78;
    p.add(plinth, body, skirt, head, brow);
    for (const s of [-1, 1]) {
      // the lit face: a recessed window with the litres and the money in it
      const bezel = this.box(0.60, 0.34, 0.04, dark);
      bezel.position.set(0, 1.53, s * 0.26);
      p.add(bezel);
      const readout = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.03), headMat);
      readout.position.set(0, 1.60, s * 0.285);
      p.add(readout);
      const price = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.03), headMat);
      price.position.set(-0.1, 1.45, s * 0.285);
      p.add(price);
      // keypad and card slot, on the body under the window
      const pad = this.box(0.26, 0.20, 0.03, dark);
      pad.position.set(0.16, 1.16, s * 0.235);
      p.add(pad);
      const slot = this.box(0.18, 0.03, 0.03, steel);
      slot.position.set(-0.16, 1.18, s * 0.235);
      p.add(slot);
      /**
       * The nozzle in its boot, and the hose looping back to the body.
       *
       * Both of these used to hang off the pump's LEFT END — the narrow face,
       * 0.66 m wide with two whole nozzle assemblies and two hoses crowded
       * onto it, so the two sets ran through each other — and the hose's tail
       * was routed to x = −0.02, which is dead centre of the body it is
       * supposed to be plugged into, so it disappeared into the enamel.
       *
       * A pump serves the two lanes either side of its island, so a nozzle
       * belongs on each of the two WIDE faces, one per customer, and that is
       * where they are now: boot on the face at z = ±0.25, hose looping from
       * the head down to it, every control point held at |z| >= 0.25 so no
       * part of the run can re-enter the 0.44 m-deep body.
       */
      const face = s * 0.25;
      const boot = this.box(0.16, 0.32, 0.10, dark);
      boot.position.set(-0.20, 1.02, face);
      p.add(boot);
      const grip = this.box(0.11, 0.26, 0.09, brand);
      grip.position.set(-0.20, 1.07, face + s * 0.04);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.20, 6), steel);
      spout.position.set(-0.20, 0.89, face + s * 0.04);
      p.add(grip, spout);
      const hose = new THREE.Mesh(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.22, 1.26, face),          // off the head
          new THREE.Vector3(0.28, 1.12, face + s * 0.06),
          new THREE.Vector3(0.20, 0.82, face + s * 0.09),
          new THREE.Vector3(-0.04, 0.70, face + s * 0.08),
          new THREE.Vector3(-0.20, 0.88, face + s * 0.05),  // up into the boot
        ]), 14, 0.026, 5, false), rubber);
      p.add(hose);
    }
    // the topper: the one lit thing above head height on the island
    const topper = this.box(0.9, 0.26, 0.22, cream);
    topper.position.y = 1.95;
    const topBand = this.box(0.92, 0.09, 0.24, brand);
    topper.add(topBand);
    topBand.position.y = -0.02;
    p.add(topper);
    return p;
  }

  /* ---- natural clutter -------------------------------------------------
   * The small things that make open ground read as GROUND rather than as a
   * green plane with trees standing on it: rocks that have worked their way
   * up through the turf, a trunk somebody felled and never took away, the
   * stump it came off, and the deadwood that piles up in the lee of a hedge.
   * Each one is merged to a single mesh per material — there are a lot of
   * them, and they are scenery.                                          */

  /** A boulder: a lumpy mass of two or three overlapping blocks, never a cube. */
  boulder(scale = 1, seed = 1) {
    const g = new THREE.Group();
    const rng = seeded(seed * 31 + 7);
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const w = (0.7 + rng() * 0.6) * scale;
      const h = (0.42 + rng() * 0.4) * scale;
      const d = (0.6 + rng() * 0.6) * scale;
      const blk = this.box(w, h, d, 'rock');
      blk.position.set((rng() - 0.5) * 0.5 * scale, h * 0.42 - 0.12 * scale, (rng() - 0.5) * 0.5 * scale);
      blk.rotation.set((rng() - 0.5) * 0.28, rng() * Math.PI, (rng() - 0.5) * 0.28);
      g.add(blk);
    }
    mergeStatic(g);
    return { group: g, collide: [0.55 * scale, 0.32 * scale, 0.5 * scale] };
  }

  /** A felled trunk lying in the grass, with a couple of broken limbs on it. */
  fallenLog(len = 3.2, seed = 1) {
    const g = new THREE.Group();
    const rng = seeded(seed * 17 + 3);
    const r = 0.22 + rng() * 0.1;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 7), this.mat('bark'));
    trunk.rotation.z = Math.PI / 2;
    trunk.rotation.y = (rng() - 0.5) * 0.2;
    trunk.position.y = r * 0.85;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const bl = 0.5 + rng() * 0.7;
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, bl, 5), this.mat('bark'));
      limb.position.set((rng() - 0.5) * len * 0.8, r * 0.9, (rng() - 0.5) * 0.9);
      limb.rotation.set(Math.PI / 2 - 0.3 + rng() * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.8);
      g.add(limb);
    }
    mergeStatic(g);
    return { group: g, collide: [len / 2, r, r * 1.4] };
  }

  /** The stump it came off — sawn flat, with the roots showing. */
  stump(scale = 1, seed = 1) {
    const g = new THREE.Group();
    const rng = seeded(seed * 13 + 11);
    const h = (0.34 + rng() * 0.22) * scale;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.30 * scale, 0.42 * scale, h, 8), this.mat('bark'));
    body.position.y = h / 2;
    g.add(body);
    const cut = new THREE.Mesh(new THREE.CylinderGeometry(0.30 * scale, 0.30 * scale, 0.05, 8),
      this.colorMat(0x8a6f4a));
    cut.position.y = h + 0.01;
    g.add(cut);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng();
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.6 * scale, 5), this.mat('bark'));
      root.position.set(Math.sin(a) * 0.34 * scale, 0.09, Math.cos(a) * 0.34 * scale);
      root.rotation.set(Math.PI / 2 - 0.45, -a, 0);
      g.add(root);
    }
    mergeStatic(g);
    return { group: g, collide: [0.42 * scale, h / 2, 0.42 * scale] };
  }

  /** A pile of storm deadwood — branches heaped where the wind left them. */
  deadwood(seed = 1) {
    const g = new THREE.Group();
    const rng = seeded(seed * 29 + 5);
    for (let i = 0; i < 6; i++) {
      const bl = 0.9 + rng() * 1.3;
      const br = 0.04 + rng() * 0.05;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(br * 0.7, br, bl, 5), this.mat('bark'));
      b.position.set((rng() - 0.5) * 1.1, 0.08 + rng() * 0.22, (rng() - 0.5) * 1.1);
      b.rotation.set(Math.PI / 2 - 0.25 + rng() * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
      g.add(b);
    }
    mergeStatic(g);
    return { group: g };
  }

  /** Rusting water tower on four legs — a navigation landmark. */
  waterTower() {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      const leg = this.box(0.25, 9, 0.25, 'metalRust');
      leg.position.set(lx, 4.5, lz);
      leg.rotation.y = Math.PI / 4;
      g.add(leg);
    }
    for (const [r, yy] of [[1.8, 3], [1.8, 6.5]]) { // cross braces
      for (const a of [0, Math.PI / 2]) {
        const brace = this.box(r * 2 + 0.4, 0.12, 0.12, 'metalRust');
        brace.position.y = yy;
        brace.rotation.y = a;
        g.add(brace);
      }
    }
    // Painted, not galvanised: a water tower is the classic town landmark, and
    // it can only do that job if you can pick it out of the skyline from the
    // far side of the map. The band round its waist is what makes it read as
    // a tower rather than as another grey drum.
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4.5, 10), this.colorMat(0x2f8fa0));
    tank.position.y = 11.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.06, 3.06, 1.5, 10), this.colorMat(0xe4e0d2));
    band.position.y = 11.2;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(3.09, 3.09, 0.3, 10), this.colorMat(0xb0392e));
    stripe.position.y = 12.4;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.4, 10), this.colorMat(0xb0392e));
    cap.position.y = 14.2;
    g.add(tank, band, stripe, cap);
    return { group: g, collide: [2.2, 7.2, 2.2] };
  }

  /** Horizontal fuel-storage tank on concrete saddles. */
  fuelTank() {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 6, 10), this.mat('metalRust'));
    tank.rotation.z = Math.PI / 2;
    tank.position.y = 1.9;
    g.add(tank);
    for (const s of [-1.9, 1.9]) {
      const saddle = this.box(0.6, 0.9, 2.4, 'wallConcrete');
      saddle.position.set(s, 0.45, 0);
      g.add(saddle);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6), this.mat('metalRust'));
    pipe.position.set(2.6, 1.1, 0.6);
    g.add(pipe);
    return { group: g, collide: [3.1, 1.7, 1.5] };
  }

  /** Brick factory smokestack — the tallest thing on the south skyline. */
  smokestack(h = 16) {
    const g = new THREE.Group();
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, h, 8), this.mat('brickGray'));
    stack.position.y = h / 2;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.6, 8), this.mat('brickRed'));
    collar.position.y = h - 0.5;
    g.add(stack, collar);
    return { group: g, collide: [1.2, h / 2, 1.2] };
  }

  hayBale() {
    const g = new THREE.Group();
    const bale = this.box(1.6, 1.0, 1.0, this.colorMat(0xa08a44));
    bale.position.y = 0.5;
    g.add(bale);
    return { group: g, collide: [0.8, 0.6, 0.5] };
  }

  /** Market stall: wood counter under a sloped canvas canopy. */
  marketStall(canopy = 0x7a3b30) {
    const g = new THREE.Group();
    const counter = this.box(2.6, 0.95, 1.1, 'wallWood');
    counter.position.y = 0.5;
    g.add(counter);
    for (const [sx, sz] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]]) {
      const post = this.box(0.09, 2.3, 0.09, 'wallWood');
      post.position.set(sx, 1.15, sz);
      g.add(post);
    }
    const roof = this.box(3.0, 0.08, 1.8, this.colorMat(canopy));
    roof.position.y = 2.35;
    roof.rotation.x = 0.14;
    g.add(roof);
    const produce = this.box(0.6, 0.4, 0.45, 'crate');
    produce.position.set(-0.6, 1.18, 0);
    g.add(produce);
    return { group: g, collide: [1.4, 0.8, 0.7] };
  }

  /** Curbside phone booth — the phone inside still has a dial tone. */
  phoneBooth() {
    const g = new THREE.Group();
    const back = this.box(1.05, 2.5, 0.1, this.colorMat(0x6e2c26));
    back.position.set(0, 1.25, -0.48);
    const roof = this.box(1.15, 0.16, 1.15, this.colorMat(0x561f1b));
    roof.position.y = 2.55;
    const base = this.box(1.05, 0.2, 1.05, 'concrete');
    base.position.y = 0.1;
    g.add(back, roof, base);
    for (const sx of [-0.48, 0.48]) {
      const post = this.box(0.1, 2.5, 0.1, this.colorMat(0x6e2c26));
      post.position.set(sx, 1.25, 0.42);
      g.add(post);
      const pane = this.box(0.08, 1.3, 0.9, 'window');
      pane.position.set(sx, 1.45, -0.02);
      g.add(pane);
    }
    const phone = this.box(0.3, 0.45, 0.12, this.colorMat(0x1a1d21));
    phone.position.set(0, 1.5, -0.38);
    g.add(phone);
    // The handset hangs on its cradle; the roof lamp is dead until the thing
    // rings, and Anomalies drives both (it is the one that knows when it does).
    const hook = new THREE.Group();
    hook.position.set(-0.19, 1.55, -0.32);
    const handset = this.box(0.09, 0.26, 0.09, this.colorMat(0x101215));
    handset.position.y = -0.13;
    hook.add(handset);
    g.add(hook);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x1a1a18 });
    const lamp = this.box(0.6, 0.05, 0.5, lampMat);
    lamp.position.y = 2.44;
    g.add(lamp);
    return { group: g, collide: [0.55, 1.25, 0.55], hook, lampMat };
  }

  /** Playground swing set. Returns the two swing pivots for animation. */
  swingSet() {
    const g = new THREE.Group();
    const barY = 2.4;
    for (const sx of [-1.7, 1.7]) {
      for (const lean of [-0.5, 0.5]) {
        const leg = this.box(0.1, 2.6, 0.1, 'metalRust');
        leg.position.set(sx, barY / 2, lean);
        // NEGATIVE: rotating a leg about X swings its TOP toward +Z, so
        // `lean * angle` splayed the frame at the head and stood it on a point.
        // An A-frame is wide where it meets the ground.
        leg.rotation.x = -lean * 0.42;
        g.add(leg);
      }
    }
    const bar = this.box(3.6, 0.1, 0.1, 'metalRust');
    bar.position.y = barY;
    g.add(bar);
    const swings = [];
    for (const sx of [-0.85, 0.85]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, barY, 0);
      for (const cx of [-0.25, 0.25]) {
        const chain = this.box(0.03, 1.7, 0.03, this.colorMat(0x3a4148));
        chain.position.set(cx, -0.85, 0);
        pivot.add(chain);
      }
      const seat = this.box(0.6, 0.06, 0.24, 'wallWood');
      seat.position.y = -1.72;
      pivot.add(seat);
      g.add(pivot);
      swings.push(pivot);
    }
    return { group: g, collide: [1.9, 1.3, 0.6], swings };
  }

  /** Playground slide: ladder up, sheet-metal chute down. */
  slide() {
    const g = new THREE.Group();
    const deck = this.box(0.8, 0.08, 0.8, 'roofMetal');
    deck.position.set(0, 1.5, 0);
    g.add(deck);
    for (const [sx, sz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
      const leg = this.box(0.08, 1.5, 0.08, 'metalRust');
      leg.position.set(sx, 0.75, sz);
      g.add(leg);
    }
    for (let i = 0; i < 4; i++) {
      const rung = this.box(0.6, 0.05, 0.05, 'metalRust');
      rung.position.set(0, 0.3 + i * 0.38, -0.42);
      g.add(rung);
    }
    const chute = this.box(0.7, 0.06, 2.3, 'roofMetal');
    chute.position.set(0, 0.82, 1.4);
    chute.rotation.x = 0.6;
    g.add(chute);
    return { group: g, collide: [0.5, 0.9, 1.2] };
  }

  /** Farm windmill on a lattice tower. Returns the rotor for animation. */
  windmill() {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-1.0, -1.0], [1.0, -1.0], [-1.0, 1.0], [1.0, 1.0]]) {
      const leg = this.box(0.14, 7.5, 0.14, 'metalRust');
      leg.position.set(lx * 0.7, 3.75, lz * 0.7);
      // Splay the legs so the tower is WIDE at the base and tapers to a narrow
      // top under the head — a stable lattice frame. (The signs were inverted,
      // which made the tower balance on a point and read as upside-down.)
      leg.rotation.z = lx * 0.09;
      leg.rotation.x = -lz * 0.09;
      g.add(leg);
    }
    for (const yy of [2.5, 5]) {
      for (const a of [0, Math.PI / 2]) {
        const brace = this.box(1.6, 0.08, 0.08, 'metalRust');
        brace.position.y = yy;
        brace.rotation.y = a;
        g.add(brace);
      }
    }
    const head = this.box(0.5, 0.5, 0.9, 'wallMetal');
    head.position.set(0, 7.7, 0);
    g.add(head);
    const rotor = new THREE.Group();
    rotor.position.set(0, 7.7, 0.55);
    for (let i = 0; i < 6; i++) {
      const blade = this.box(0.28, 2.0, 0.04, 'roofMetal');
      blade.position.y = 1.05;
      const arm = new THREE.Group();
      arm.rotation.z = (i / 6) * Math.PI * 2;
      arm.add(blade);
      rotor.add(arm);
    }
    const tail = this.box(0.06, 0.8, 1.4, 'roofMetal');
    tail.position.set(0, 7.7, -1.2);
    g.add(rotor, tail);
    return { group: g, collide: [0.9, 3.8, 0.9], rotor };
  }

  /** Rowboat pulled up on a shore. */
  rowboat() {
    const g = new THREE.Group();
    const hull = this.box(1.1, 0.45, 3.0, 'wallWood');
    hull.position.y = 0.25;
    const bow = this.box(0.7, 0.4, 0.6, 'wallWood');
    bow.position.set(0, 0.28, 1.6);
    bow.rotation.y = Math.PI / 4;
    const bench = this.box(1.0, 0.08, 0.3, 'floorWood');
    bench.position.set(0, 0.42, -0.3);
    g.add(hull, bow, bench);
    return { group: g, collide: [0.6, 0.4, 1.6] };
  }

  /**
   * Intact parked car — someone locked it and never came back. Headlights are
   * real (normally dark) so its alarm can blink them; shooting it sets the
   * alarm off, and the noise pulls the horde. Returns the light meshes.
   */
  parkedCar(paint = 0x39465e, kind = 'sedan') {
    return this._vehicle({ paint, kind, lit: true });
  }

  /** Concrete jersey barrier — abandoned checkpoint furniture. */
  jerseyBarrier() {
    const g = new THREE.Group();
    const base = this.box(2.2, 0.5, 0.7, 'barricade');
    base.position.y = 0.25;
    const top = this.box(2.2, 0.6, 0.36, 'wallConcrete');
    top.position.y = 0.8;
    g.add(base, top);
    return { group: g, collide: [1.1, 0.6, 0.4] };
  }

  /**
   * Rooftop crown for a tower: parapet lip, water tank or antenna mast, vents.
   * Returns the aviation beacon mesh so the world can blink it.
   */
  roofCrown(w, d, kind = 'tank') {
    const g = new THREE.Group();
    for (const [px, pz, pw, pd] of [
      [0, d / 2 - 0.15, w, 0.3], [0, -d / 2 + 0.15, w, 0.3],
      [w / 2 - 0.15, 0, 0.3, d], [-w / 2 + 0.15, 0, 0.3, d],
    ]) {
      const lip = this.box(pw, 0.7, pd, 'wallConcrete');
      lip.position.set(px, 0.35, pz);
      g.add(lip);
    }
    const box1 = this.box(1.2, 0.9, 1.0, 'wallMetal'); // rooftop plant
    box1.position.set(-w / 4, 0.45, -d / 5);
    g.add(box1);
    let beaconY = 3.4;
    if (kind === 'tank') {
      for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
        const leg = this.box(0.12, 1.6, 0.12, 'metalRust');
        leg.position.set(w / 5 + lx * 0.8, 0.8, lz * 0.8);
        g.add(leg);
      }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 9), this.mat('wallWood'));
      tank.position.set(w / 5, 2.4, 0);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 9), this.mat('roofMetal'));
      cap.position.set(w / 5, 3.6, 0);
      g.add(tank, cap);
      beaconY = 4.3;
    } else {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 5.4, 6), this.mat('metalRust'));
      mast.position.set(w / 5, 2.7, 0);
      g.add(mast);
      for (const yy of [1.8, 3.4]) {
        const spar = this.box(1.1, 0.06, 0.06, 'metalRust');
        spar.position.set(w / 5, yy, 0);
        g.add(spar);
      }
      beaconY = 5.5;
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xd8302a }));
    beacon.position.set(w / 5, beaconY, 0);
    g.add(beacon);
    return { group: g, beacon };
  }

  picnicTable() {
    const g = new THREE.Group();
    const top = this.box(1.8, 0.08, 0.8, 'wallWood');
    top.position.y = 0.72;
    g.add(top);
    for (const s of [-0.75, 0.75]) {
      const seat = this.box(1.8, 0.07, 0.3, 'wallWood');
      seat.position.set(0, 0.45, s);
      const leg = this.box(0.1, 0.72, 1.5, 'wallWood');
      leg.position.set(s, 0.36, 0);
      g.add(seat, leg);
    }
    return { group: g, collide: [0.95, 0.5, 0.85] };
  }

  /* ---- urban street furniture ---------------------------------------- */

  /**
   * Zig-zag fire escape bolted to an alley wall: landings, ladders between
   * them, and the counterweighted bottom flight still hanging down. Purely
   * scenic above the first landing — but it is what makes an alley read as an
   * alley the instant you turn into one.
   */
  fireEscape(floors = 3, storey = 2.8) {
    const g = new THREE.Group();
    const steel = this.mat('metalRust');
    for (let f = 0; f < floors; f++) {
      const y = 2.6 + f * storey;
      const deck = this.box(2.6, 0.08, 1.15, 'metalRust');
      deck.position.set(0, y, 0.55);
      g.add(deck);
      for (const sx of [-1.25, 1.25]) {   // stringers back to the wall
        const rail = this.box(0.06, 0.95, 0.06, 'metalRust');
        rail.position.set(sx, y + 0.5, 1.05);
        g.add(rail);
      }
      const front = this.box(2.6, 0.06, 0.06, 'metalRust');
      front.position.set(0, y + 0.95, 1.1);
      const mid = this.box(2.6, 0.06, 0.06, 'metalRust');
      mid.position.set(0, y + 0.5, 1.1);
      g.add(front, mid);
      for (const sz of [0.1, 1.05]) {     // balusters
        for (let i = -2; i <= 2; i++) {
          const bar = this.box(0.04, 0.95, 0.04, 'metalRust');
          bar.position.set(i * 0.6, y + 0.5, sz);
          g.add(bar);
        }
      }
      // the flight up to the next landing, alternating sides
      if (f < floors - 1) {
        const side = f % 2 ? -1 : 1;
        const flight = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, storey * 1.15), steel);
        flight.position.set(side * 0.85, y + storey / 2, 0.55);
        flight.rotation.x = -Math.atan2(storey, storey * 1.05);
        g.add(flight);
        for (let s = 0; s < 7; s++) {
          const step = this.box(0.9, 0.05, 0.16, 'metalRust');
          const t = (s + 0.5) / 7;
          step.position.set(side * 0.85, y + 0.1 + t * storey, 0.05 + t * 1.0);
          g.add(step);
        }
      }
      // brackets carrying the landing back into the wall
      for (const sx of [-1.1, 1.1]) {
        const brace = this.box(0.08, 0.08, 1.1, 'metalRust');
        brace.position.set(sx, y - 0.35, 0.5);
        brace.rotation.x = -0.5;
        g.add(brace);
      }
    }
    // drop ladder, lowered years ago and never raised
    const ladder = new THREE.Group();
    for (const sx of [-0.28, 0.28]) {
      const rail = this.box(0.05, 2.6, 0.05, 'metalRust');
      rail.position.set(sx, 1.3, 0);
      ladder.add(rail);
    }
    for (let r = 0; r < 7; r++) {
      const rung = this.box(0.6, 0.04, 0.04, 'metalRust');
      rung.position.set(0, 0.2 + r * 0.36, 0);
      ladder.add(rung);
    }
    ladder.position.set(1.1, 0, 0.9);
    ladder.rotation.x = 0.12;
    g.add(ladder);
    // No collider: everything here is overhead, and the wall it is bolted to
    // already blocks the ground it stands against.
    return { group: g, collide: null };
  }

  /**
   * The founder on his plinth: the downtown square's wayfinding landmark.
   * Weathered bronze, one arm raised — and, since nothing in this town is
   * quite right, he is looking at the ground rather than the horizon.
   */
  statue() {
    const g = new THREE.Group();
    const step = this.box(3.2, 0.35, 3.2, 'wallStone');
    step.position.y = 0.17;
    const plinth = this.box(2.0, 2.2, 2.0, 'marbleWhite');
    plinth.position.y = 1.45;
    const cap = this.box(2.25, 0.22, 2.25, 'trimStone');
    cap.position.y = 2.66;
    const plaque = this.box(1.1, 0.6, 0.05, 'goldMetal');
    plaque.position.set(0, 1.5, 1.02);
    g.add(step, plinth, cap, plaque);
    const bronze = this.colorMat(0x4d6151);
    const legs = this.box(0.62, 1.1, 0.44, bronze);
    legs.position.y = 3.32;
    const coat = this.box(0.78, 1.0, 0.5, bronze);
    coat.position.y = 4.32;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), bronze);
    head.position.set(0, 5.0, 0.1);
    const armUp = this.box(0.18, 0.95, 0.18, bronze);
    armUp.position.set(0.5, 4.75, 0);
    armUp.rotation.z = -0.5;
    const armDown = this.box(0.18, 0.85, 0.18, bronze);
    armDown.position.set(-0.48, 4.2, 0.06);
    armDown.rotation.z = 0.2;
    g.add(legs, coat, head, armUp, armDown);
    return { group: g, collide: [1.2, 1.4, 1.2] };
  }

  /** Street planter: a concrete tub with something still alive in it. */
  planter(veg) {
    const g = new THREE.Group();
    const tub = this.box(1.3, 0.6, 1.3, 'wallConcrete');
    tub.position.y = 0.3;
    const soil = this.box(1.1, 0.06, 1.1, 'dirt');
    soil.position.y = 0.6;
    g.add(tub, soil);
    if (veg) { veg.position.y = 0.62; g.add(veg); }
    return { group: g, collide: [0.68, 0.35, 0.68] };
  }

  /**
   * Wire litter bin, at every corner it should be at.
   *
   * It used to carry a "sack" of refuse on top, and at this scale a box wider
   * than the bin's own mouth in near-black is not refuse — it is a black cube
   * balanced on a bin. The bin reads better empty.
   */
  trashCan() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.85, 8), this.mat('metalRust'));
    body.position.y = 0.43;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 5, 10), this.mat('metalRust'));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.86;
    g.add(body, rim);
    return { group: g, collide: [0.3, 0.45, 0.3] };
  }

  /** Corner newsstand: a kiosk with the last edition still racked. */
  newsstand() {
    const g = new THREE.Group();
    const body = this.box(2.2, 2.1, 1.2, 'wallMetal');
    body.position.y = 1.05;
    const shutter = this.box(1.8, 1.0, 0.06, 'doorGarage');
    shutter.position.set(0, 1.45, 0.62);
    const counter = this.box(2.3, 0.1, 0.55, 'wallWood');
    counter.position.set(0, 0.92, 0.82);
    const roof = this.box(2.6, 0.12, 1.7, 'roofMetal');
    roof.position.set(0, 2.2, 0.16);
    g.add(body, shutter, counter, roof);
    for (let i = 0; i < 4; i++) {   // papers gone soft in the weather
      const stack = this.box(0.38, 0.07, 0.44, this.colorMat(0xb8b2a0));
      stack.position.set(-0.75 + i * 0.5, 0.99, 0.82);
      g.add(stack);
    }
    return { group: g, collide: [1.2, 1.05, 0.85] };
  }

  /** Cast bollard guarding a kerb line. */
  bollard() {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.9, 8), this.mat('metalRust'));
    post.position.y = 0.45;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 5), this.mat('metalRust'));
    cap.position.y = 0.92;
    g.add(post, cap);
    return { group: g, collide: [0.16, 0.5, 0.16] };
  }

  /** Alley service pipework climbing a wall, with a dripping elbow. */
  wallPipes(h = 6) {
    const g = new THREE.Group();
    for (const [sx, r] of [[-0.35, 0.09], [0, 0.13], [0.32, 0.07]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), this.mat('metalRust'));
      pipe.position.set(sx, h / 2, 0);
      g.add(pipe);
      for (let y = 1.2; y < h; y += 2.2) {
        const clamp = this.box(r * 3, 0.12, 0.2, 'metalRust');
        clamp.position.set(sx, y, 0.08);
        g.add(clamp);
      }
    }
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 6), this.mat('metalRust'));
    elbow.rotation.z = Math.PI / 2;
    elbow.position.set(0.45, 1.6, 0);
    g.add(elbow);
    return { group: g, collide: null };   // flush to the wall behind it
  }

  /* ---- park furniture --------------------------------------------------
   * The park's job is to be the one place in town that still moves. These
   * are the moving parts: a carousel that turns, a flag that ripples, a rope
   * swing that swings. All of them hand their animated node back to the
   * caller, which registers it for the per-frame pass in Anomalies.        */

  /**
   * Children's carousel — a roundabout with painted horses on poles. Returns
   * `deck`, the group that turns. Nobody is pushing it.
   */
  carousel() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.4, 12), this.mat('wallConcrete'));
    base.position.y = 0.2;
    g.add(base);
    const deck = new THREE.Group();
    deck.position.y = 0.4;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.18, 12), this.mat('floorWood'));
    floor.position.y = 0.09;
    deck.add(floor);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3.0, 8), this.mat('metalRust'));
    column.position.y = 1.6;
    deck.add(column);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.2, 12), this.colorMat(0x8a3a34));
    canopy.position.y = 3.5;
    deck.add(canopy);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), this.mat('goldMetal'));
    finial.position.y = 4.2;
    deck.add(finial);
    const horseCols = [0xc8c2b0, 0x8a6a4a, 0x6a7a8a, 0xb08a5a];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * 2.2, pz = Math.sin(a) * 2.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.9, 6), this.mat('goldMetal'));
      pole.position.set(px, 1.6, pz);
      deck.add(pole);
      if (i % 2) continue;                 // half the horses are long gone
      const horse = new THREE.Group();
      const barrel = this.box(1.0, 0.42, 0.3, this.colorMat(horseCols[i % 4]));
      barrel.position.y = 1.1;
      const neck = this.box(0.3, 0.5, 0.26, this.colorMat(horseCols[i % 4]));
      neck.position.set(0.42, 1.42, 0);
      neck.rotation.z = -0.35;
      const head = this.box(0.42, 0.22, 0.22, this.colorMat(horseCols[i % 4]));
      head.position.set(0.66, 1.68, 0);
      horse.add(barrel, neck, head);
      for (const [lx, lz] of [[-0.3, 0.12], [-0.3, -0.12], [0.3, 0.12], [0.3, -0.12]]) {
        const leg = this.box(0.12, 0.55, 0.12, this.colorMat(horseCols[i % 4]));
        leg.position.set(lx, 0.66, lz);
        horse.add(leg);
      }
      horse.position.set(px, 0, pz);
      horse.rotation.y = -a + Math.PI / 2;
      deck.add(horse);
    }
    g.add(deck);
    return { group: g, collide: [3.3, 1.6, 3.3], deck };
  }

  /**
   * Flagpole. The flag is a chain of short strips whose yaw is driven with a
   * travelling phase, which is the cheapest convincing ripple there is.
   * Returns `strips` for the animator.
   */
  flagpole(h = 7, color = 0x8a2a24) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.35, 8), this.mat('wallConcrete'));
    base.position.y = 0.17;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 6), this.colorMat(0xb4b8ba));
    pole.position.y = h / 2;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.mat('goldMetal'));
    ball.position.y = h + 0.1;
    g.add(base, pole, ball);
    const strips = [];
    const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    let parent = g;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.x = i === 0 ? 0.09 : 0.46;
      if (i === 0) seg.position.y = h - 1.4;
      // The cloth lies in the pole's XY plane so its width runs along the
      // chain: each segment then yaws about the pole's axis and the wave
      // travels out along the flag instead of flapping it edge-on.
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.3), mat);
      cloth.position.set(0.23, 0, 0);
      seg.add(cloth);
      parent.add(seg);
      strips.push(seg);
      parent = seg;
    }
    return { group: g, collide: [0.5, 0.4, 0.5], strips };
  }

  /** Rope swing on a bough. Returns the pivot so it can be given a push. */
  ropeSwing() {
    const g = new THREE.Group();
    const bough = this.box(2.6, 0.16, 0.16, 'bark');
    bough.position.y = 3.4;
    g.add(bough);
    const pivot = new THREE.Group();
    pivot.position.set(0.3, 3.4, 0);
    for (const s of [-0.16, 0.16]) {
      const rope = this.box(0.035, 2.2, 0.035, this.colorMat(0x8a7a58));
      rope.position.set(s, -1.1, 0);
      pivot.add(rope);
    }
    const seat = this.box(0.5, 0.07, 0.24, 'wallWood');
    seat.position.y = -2.2;
    pivot.add(seat);
    g.add(pivot);
    return { group: g, collide: null, pivot };
  }

  /** Timber jetty running out over the water. */
  jetty(len = 5) {
    const g = new THREE.Group();
    const deck = this.box(1.5, 0.12, len, 'floorWood');
    deck.position.set(0, 0.6, len / 2 - 0.4);
    g.add(deck);
    for (let t = 0.4; t < len; t += 1.5) {
      for (const s of [-0.6, 0.6]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 6), this.mat('bark'));
        pile.position.set(s, 0.0, t);
        g.add(pile);
        const post = this.box(0.08, 0.85, 0.08, 'wallWood');
        post.position.set(s, 1.05, t);
        g.add(post);
      }
    }
    for (const s of [-0.6, 0.6]) {
      const rail = this.box(0.06, 0.06, len - 0.6, 'wallWood');
      rail.position.set(s, 1.45, len / 2 - 0.4);
      g.add(rail);
    }
    return { group: g, collide: [0.85, 0.35, len / 2] };
  }

  /** Park noticeboard under a little pitched hood. */
  noticeBoard() {
    const g = new THREE.Group();
    for (const s of [-0.85, 0.85]) {
      const post = this.box(0.12, 2.0, 0.12, 'wallWood');
      post.position.set(s, 1.0, 0);
      g.add(post);
    }
    const board = this.box(1.9, 1.2, 0.08, 'wallWood');
    board.position.set(0, 1.5, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), this.mat('posterNotice', { transparent: true }));
    face.position.set(0, 1.5, 0.05);
    const hood = this.box(2.1, 0.1, 0.4, 'roofShingle');
    hood.position.set(0, 2.2, 0.1);
    hood.rotation.x = 0.24;
    g.add(board, face, hood);
    return { group: g, collide: [1.0, 1.0, 0.2] };
  }

  /** Cast drinking fountain. Dry, obviously. */
  drinkingFountain() {
    const g = new THREE.Group();
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.95, 8), this.mat('wallStone'));
    column.position.y = 0.48;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.14, 10), this.mat('wallStone'));
    bowl.position.y = 1.0;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 5), this.colorMat(0x8a8a80));
    spout.position.set(0, 1.08, -0.14);
    spout.rotation.x = 0.8;
    g.add(column, bowl, spout);
    return { group: g, collide: [0.28, 0.55, 0.28] };
  }

  /** Plank footbridge with handrails, spanning a dip. */
  footbridge(len = 8) {
    const g = new THREE.Group();
    const deck = this.box(len, 0.16, 1.8, 'floorWood');
    deck.position.y = 0.5;
    g.add(deck);
    for (const s of [-0.85, 0.85]) {
      const rail = this.box(len, 0.08, 0.08, 'wallWood');
      rail.position.set(0, 1.5, s);
      g.add(rail);
      for (let t = -len / 2 + 0.4; t <= len / 2; t += 1.6) {
        const post = this.box(0.1, 1.0, 0.1, 'wallWood');
        post.position.set(t, 1.0, s);
        g.add(post);
      }
    }
    for (let t = -len / 2 + 0.5; t < len / 2; t += 1.0) {
      const beam = this.box(0.14, 0.5, 1.9, 'bark');
      beam.position.set(t, 0.2, 0);
      g.add(beam);
    }
    return { group: g, collide: [len / 2, 0.35, 0.95] };
  }

  /* ---- residential: the things a street of houses is actually made of ----
   *
   * Everything below exists because a suburb is not a commercial district
   * with smaller buildings — it is a place people lived in the open air.
   * Front gardens, back gardens, boundary fences, and the objects that stop
   * halfway through what they were doing when the town emptied.
   *
   * A dozen of these MOVE. That is deliberate and load-bearing: in a town
   * where the only motion is the horde, a turning weather vane at the end of
   * a still street is the cheapest unease in the game, and a swing that keeps
   * its arc is worse. Movers return their moving part so World can register
   * it (see World._animate).
   */

  /**
   * Picket fence run: a real garden boundary rather than a farm rail. The
   * pickets are one texture-mapped ribbon, so a forty-metre run is two
   * triangles per metre instead of a mesh per board.
   */
  picketFence(x1, z1, x2, z2, parent, { h = 1.05, gate = null } = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(-(z2 - z1), x2 - x1);
    const g = new THREE.Group();
    const mkPanel = (from, to) => {
      const L = to - from;
      if (L < 0.2) return;
      const geo = new THREE.PlaneGeometry(L, h);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L * 0.55, uv.getY(i));
      uv.needsUpdate = true;
      const panel = new THREE.Mesh(geo, this.mat('picketFence', { side: THREE.DoubleSide, alphaTest: 0.5 }));
      panel.position.set(-len / 2 + (from + to) / 2, h / 2, 0);
      g.add(panel);
    };
    if (gate === null) mkPanel(0, len);
    else { mkPanel(0, gate - 0.55); mkPanel(gate + 0.55, len); }
    for (let t = 0; t <= len + 0.01; t += 2.4) {
      const post = this.box(0.11, h + 0.16, 0.11, 'wallWood');
      post.position.set(-len / 2 + Math.min(t, len), (h + 0.16) / 2, 0);
      g.add(post);
    }
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    this.place(g, mx, mz, { yaw });
    parent.add(g);
    const y = this.terrain.heightAt(mx, mz);
    const pad = 0.26;
    this.collision.addBox(Math.min(x1, x2) - pad, y - 0.5, Math.min(z1, z2) - pad,
      Math.max(x1, x2) + pad, y + h, Math.max(z1, z2) + pad, 'fence');
    return g;
  }

  /** Garden gate, hung on one post. Returns the leaf pivot: it swings. */
  gardenGate() {
    const g = new THREE.Group();
    for (const s of [-0.62, 0.62]) {
      const post = this.box(0.13, 1.35, 0.13, 'wallWood');
      post.position.set(s, 0.67, 0);
      g.add(post);
    }
    const pivot = new THREE.Group();
    pivot.position.set(-0.58, 0, 0);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.95),
      this.mat('picketFence', { side: THREE.DoubleSide, alphaTest: 0.5 }));
    leaf.position.set(0.55, 0.55, 0);
    pivot.add(leaf);
    g.add(pivot);
    return { group: g, pivot };
  }

  /**
   * Washing line between two posts, still hung. The sheets move — and they
   * move whichever way the wind in the grass is not.
   */
  clothesLine(len = 5) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = this.box(0.11, 2.0, 0.11, 'wallWood');
      post.position.set(s * len / 2, 1.0, 0);
      const arm = this.box(0.7, 0.08, 0.08, 'wallWood');
      arm.position.set(s * len / 2, 1.92, 0);
      g.add(post, arm);
    }
    for (const oz of [-0.22, 0.22]) {
      const line = this.box(len, 0.02, 0.02, this.colorMat(0x9a9384));
      line.position.set(0, 1.86, oz);
      g.add(line);
    }
    const sheets = [];
    const cols = [0xcfcabb, 0x8fa2ae, 0xc0b294, 0xb8bfae, 0xa89a8c];
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(-len / 2 + 0.8 + i * (len - 1.6) / 4, 1.86, (i % 2 ? 0.22 : -0.22));
      const hgt = 0.75 + (i % 3) * 0.28;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.72, hgt), this.colorMat(cols[i]));
      cloth.material.side = THREE.DoubleSide;
      cloth.position.y = -hgt / 2;
      pivot.add(cloth);
      g.add(pivot);
      sheets.push(pivot);
    }
    return { group: g, collide: [len / 2, 1.0, 0.2], sheets };
  }

  /** Wind chime on a hook. Returns the pivot; also worth listening to. */
  windChime() {
    const g = new THREE.Group();
    const hook = this.box(0.05, 0.3, 0.05, this.colorMat(0x6b6257));
    hook.position.y = 0.85;
    g.add(hook);
    const pivot = new THREE.Group();
    pivot.position.y = 0.72;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 8), this.mat('bark'));
    disc.position.y = -0.06;
    pivot.add(disc);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.22 + i * 0.05, 5),
        this.colorMat(0xa89a6e));
      tube.position.set(Math.cos(a) * 0.1, -0.2 - i * 0.025, Math.sin(a) * 0.1);
      pivot.add(tube);
    }
    g.add(pivot);
    return { group: g, pivot };
  }

  /** Weather vane on a post. It turns. The air does not. */
  weatherVane(postH = 1.9) {
    const g = new THREE.Group();
    const post = this.box(0.09, postH, 0.09, 'metalRust');
    post.position.y = postH / 2;
    g.add(post);
    for (const [a, ox, oz] of [[0, 0.18, 0], [Math.PI / 2, 0, 0.18]]) {
      const bar = this.box(0.36, 0.03, 0.03, 'metalRust');
      bar.position.set(ox - 0.18, postH - 0.06, oz - (a ? 0.18 : 0));
      bar.rotation.y = a;
      g.add(bar);
    }
    const rotor = new THREE.Group();
    rotor.position.y = postH + 0.12;
    const body = this.box(0.34, 0.2, 0.03, 'metalRust');
    body.position.x = 0.05;
    const tail = this.box(0.22, 0.24, 0.02, 'metalRust');
    tail.position.set(-0.18, 0.04, 0);
    const head = this.box(0.1, 0.12, 0.03, 'metalRust');
    head.position.set(0.24, 0.11, 0);
    rotor.add(body, tail, head);
    g.add(rotor);
    return { group: g, rotor, collide: [0.1, postH / 2, 0.1] };
  }

  /** Garden pinwheel on a cane. Spins in perfectly still air. */
  pinwheel() {
    const g = new THREE.Group();
    const cane = this.box(0.025, 0.95, 0.025, 'bark');
    cane.position.y = 0.48;
    g.add(cane);
    const rotor = new THREE.Group();
    rotor.position.y = 0.95;
    const cols = [0xc25a4a, 0x4a7ac2, 0xd0b44a, 0x5aa85e];
    for (let i = 0; i < 4; i++) {
      const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13),
        this.colorMat(cols[i]));
      vane.material.side = THREE.DoubleSide;
      const a = (i / 4) * Math.PI * 2;
      vane.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.01);
      vane.rotation.z = a;
      rotor.add(vane);
    }
    g.add(rotor);
    return { group: g, rotor };
  }

  /** Tyre on a rope. Hang it under a bough; it keeps an arc. */
  tireSwing(drop = 2.4) {
    const g = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = drop;
    const rope = this.box(0.04, drop - 0.4, 0.04, this.colorMat(0x8a7c62));
    rope.position.y = -(drop - 0.4) / 2;
    pivot.add(rope);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.11, 5, 10), this.colorMat(0x22201f));
    tyre.position.y = -drop + 0.44;
    tyre.rotation.x = Math.PI / 2;
    pivot.add(tyre);
    g.add(pivot);
    return { group: g, pivot };
  }

  /**
   * Porch swing: a bench hung from the porch beam on two chains. The pivot
   * sits just under a porch canopy (~2.5 m over the deck), so the seat lands
   * at sitting height rather than swinging round somebody's head.
   */
  /**
   * A porch swing. `hang(h)` re-hangs it under a canopy h metres up, keeping
   * the seat at sitting height and stretching the chains to suit — the caller
   * knows where the real canopy is (see BuildingKit._porch) and this must not
   * guess, or the chains run up through the roof they hang from.
   */
  porchSwing() {
    const g = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = PORCH_SWING_HANG;
    const chains = [];
    for (const s of [-0.62, 0.62]) {
      const chain = this.box(0.03, 1.8, 0.03, this.colorMat(0x3a4148));
      chain.position.set(s, -0.9, 0);
      pivot.add(chain);
      chains.push(chain);
      const eye = this.box(0.07, 0.06, 0.07, this.colorMat(0x5a6068));
      eye.position.set(s, 0.03, 0);
      pivot.add(eye);
    }
    const W = PORCH_SWING_HALF * 2;
    const seat = this.box(W, 0.08, 0.5, 'wallWood');
    const back = this.box(W, 0.45, 0.07, 'wallWood');
    const arms = [];
    for (const s of [-1, 1]) {
      const arm = this.box(0.07, 0.07, 0.48, 'wallWood');
      arm.position.set(s * (PORCH_SWING_HALF - 0.05), -1.62, 0);
      pivot.add(arm);
      arms.push(arm);
    }
    pivot.add(seat, back);
    g.add(pivot);
    const seatDrop = 1.85;
    seat.position.y = -seatDrop;
    back.position.set(0, -seatDrop + 0.24, -0.22);
    return {
      group: g, pivot,
      hang(canopyH) {
        const h = Math.max(1.9, canopyH - 0.14);
        pivot.position.y = h;
        const drop = h - 0.5;               // seat lands half a metre off the deck
        for (const c of chains) { c.scale.y = (drop - 0.14) / 1.8; c.position.y = -(drop - 0.14) / 2; }
        seat.position.y = -drop;
        back.position.y = -drop + 0.24;
        for (const a of arms) a.position.y = -drop + 0.23;
      },
    };
  }

  /** Lawn sprinkler. The head turns. Nothing comes out of it. */
  sprinkler() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.09, 8), this.colorMat(0x3c5a3a));
    base.position.y = 0.05;
    g.add(base);
    const rotor = new THREE.Group();
    rotor.position.y = 0.12;
    const arm = this.box(0.42, 0.035, 0.035, this.colorMat(0x8a8d84));
    arm.position.y = 0.05;
    const jet = this.box(0.06, 0.06, 0.06, this.colorMat(0x6b7280));
    jet.position.set(0.21, 0.07, 0);
    rotor.add(arm, jet);
    g.add(rotor);
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 4, 9), this.colorMat(0x2c4a2c));
    hose.position.set(-0.42, 0.04, 0.2);
    hose.rotation.x = Math.PI / 2;
    g.add(hose);
    return { group: g, rotor };
  }

  /**
   * A bicycle dropped on a lawn, laid over on its side. The front wheel is
   * still turning.
   *
   * Built as a real diamond frame — chainstay, seat tube, down tube, top tube,
   * seat stay and fork all running between the four points a bicycle actually
   * has (two axles, the bottom bracket and the head) — rather than as a bar
   * with two rings near it. That is the difference between reading as a bike
   * and reading as scrap: the triangles are the silhouette.
   */
  bicycle(paint = 0x7a3b30) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    // laid on its side in the grass, resting on bars and pedals
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.12;
    const steel = this.colorMat(0x9aa0a2);
    const dark = this.colorMat(0x1e1c1a);

    // the four points the frame is strung between
    const REAR = [-0.52, 0.32], FRONT = [0.52, 0.32];
    const BB = [0, 0.26], SEAT = [-0.20, 0.66], HEAD = [0.34, 0.62];
    const tube = (a, b, thick = 0.045, mat = this.colorMat(paint)) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = this.box(Math.hypot(dx, dy), thick, thick, mat);
      t.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
      t.rotation.z = Math.atan2(dy, dx);
      body.add(t);
    };
    tube(BB, REAR, 0.035);      // chainstay
    tube(SEAT, REAR, 0.035);    // seat stay
    tube(BB, SEAT);             // seat tube
    tube(BB, HEAD);             // down tube
    tube(SEAT, HEAD);           // top tube
    tube(HEAD, FRONT, 0.04, steel);  // fork

    const mkWheel = (at) => {
      const w = new THREE.Group();
      w.add(new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.028, 4, 14), dark));
      for (let i = 0; i < 3; i++) {   // spokes stay INSIDE the rim
        const spoke = this.box(0.58, 0.012, 0.012, steel);
        spoke.rotation.z = (i / 3) * Math.PI;
        w.add(spoke);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 6), steel);
      hub.rotation.x = Math.PI / 2;
      w.add(hub);
      w.position.set(at[0], at[1], 0);
      body.add(w);
      return w;
    };
    const front = mkWheel(FRONT);
    mkWheel(REAR);

    const saddle = this.box(0.24, 0.05, 0.12, dark);
    saddle.position.set(-0.23, 0.72, 0);
    const post = this.box(0.03, 0.1, 0.03, steel);
    post.position.set(-0.21, 0.69, 0);
    const stem = this.box(0.11, 0.035, 0.035, steel);
    stem.position.set(0.365, 0.655, 0);
    const bars = this.box(0.04, 0.04, 0.44, steel);
    bars.position.set(0.41, 0.66, 0);
    body.add(saddle, post, stem, bars);
    for (const sz of [-0.09, 0.09]) {   // cranks and pedals at the bottom bracket
      const crank = this.box(0.03, 0.19, 0.03, steel);
      crank.position.set(BB[0], BB[1] + (sz > 0 ? 0.08 : -0.08), sz);
      const pedal = this.box(0.09, 0.02, 0.05, dark);
      pedal.position.set(BB[0], BB[1] + (sz > 0 ? 0.17 : -0.17), sz);
      body.add(crank, pedal);
    }
    const chain = this.box(0.5, 0.02, 0.02, dark);
    chain.position.set(-0.26, 0.28, 0.055);
    body.add(chain);

    g.add(body);
    return { group: g, rotor: front };
  }

  /** Roof dish, aimed at something. It creeps round over minutes. */
  satelliteDish() {
    const g = new THREE.Group();
    const mast = this.box(0.07, 0.5, 0.07, 'metalRust');
    mast.position.y = 0.25;
    g.add(mast);
    const rotor = new THREE.Group();
    rotor.position.y = 0.5;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2.6),
      this.mat('wallMetal', { side: THREE.DoubleSide }));
    dish.rotation.x = -1.05;
    dish.position.y = 0.1;
    const arm = this.box(0.34, 0.03, 0.03, this.colorMat(0x8a8d84));
    arm.position.set(0.1, 0.34, 0);
    arm.rotation.z = -0.5;
    rotor.add(dish, arm);
    g.add(rotor);
    return { group: g, rotor };
  }

  /** Driveway basketball hoop. The net still moves when nothing hits it. */
  basketballHoop() {
    const g = new THREE.Group();
    const post = this.box(0.13, 3.0, 0.13, 'metalRust');
    post.position.y = 1.5;
    g.add(post);
    const board = this.box(1.5, 0.95, 0.07, 'wallWood');
    board.position.set(0, 2.95, 0.3);
    const paint = this.box(0.6, 0.44, 0.02, this.colorMat(0xc4402e));
    paint.position.set(0, 2.8, 0.35);
    g.add(board, paint);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.025, 4, 10), this.colorMat(0xc4622e));
    hoop.position.set(0, 2.62, 0.56);
    hoop.rotation.x = Math.PI / 2;
    g.add(hoop);
    const net = new THREE.Group();
    net.position.set(0, 2.6, 0.56);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const strand = this.box(0.015, 0.34, 0.015, this.colorMat(0xd8d4c6));
      strand.position.set(Math.cos(a) * 0.19, -0.18, Math.sin(a) * 0.19);
      strand.rotation.z = -Math.cos(a) * 0.22;
      strand.rotation.x = Math.sin(a) * 0.22;
      net.add(strand);
    }
    g.add(net);
    return { group: g, collide: [0.24, 1.1, 0.24], pivot: net };
  }

  /** Kennel with a chain. The chain is not attached to anything now. */
  doghouse() {
    const g = new THREE.Group();
    const body = this.box(0.95, 0.7, 1.15, 'wallWood');
    body.position.y = 0.35;
    g.add(body);
    const hole = this.box(0.42, 0.5, 0.06, this.colorMat(0x100e0c));
    hole.position.set(0, 0.3, 0.58);
    g.add(hole);
    for (const s of [-1, 1]) {
      const panel = this.box(0.72, 0.11, 1.3, 'roofShingleBrown');
      panel.position.set(s * 0.26, 0.87, 0);
      panel.rotation.z = -s * 0.62;
      g.add(panel);
    }
    const chain = this.box(1.5, 0.03, 0.03, this.colorMat(0x4a4a48));
    chain.position.set(0.9, 0.03, 0.5);
    chain.rotation.y = 0.6;
    g.add(chain);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.07, 8), this.colorMat(0x7a4438));
    bowl.position.set(-0.75, 0.04, 0.5);
    g.add(bowl);
    return { group: g, collide: [0.5, 0.5, 0.6] };
  }

  /** Kettle barbecue, lid off, ashes cold. */
  bbqGrill() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = this.box(0.05, 0.72, 0.05, this.colorMat(0x3a3d40));
      leg.position.set(Math.cos(a) * 0.24, 0.36, Math.sin(a) * 0.24);
      leg.rotation.z = -Math.cos(a) * 0.16;
      leg.rotation.x = Math.sin(a) * 0.16;
      g.add(leg);
    }
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      this.mat('metalRust', { side: THREE.DoubleSide }));
    bowl.position.y = 0.8;
    const grate = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 10), this.colorMat(0x2c2e30));
    grate.position.y = 0.79;
    g.add(bowl, grate);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      this.mat('metalRust', { side: THREE.DoubleSide }));
    lid.position.set(0.55, 0.16, 0.2);
    lid.rotation.z = 1.9;
    g.add(lid);
    return { group: g, collide: [0.34, 0.45, 0.34] };
  }

  /**
   * A child's paddling pool, still full. Returns the water plane so the
   * surface can be given something to do — nobody has touched this water in
   * a year and it will not hold still.
   */
  paddlingPool() {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.1, 0.34, 14, 1, true),
      this.mat('tarpBlue', { side: THREE.DoubleSide }));
    wall.position.y = 0.17;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.03, 14), this.mat('tarpBlue'));
    floor.position.y = 0.02;
    g.add(wall, floor);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.06, 16),
      new THREE.MeshLambertMaterial({ map: this.texLib.tiled('water', 1.4, 1.4), transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.23;
    g.add(water);
    return { group: g, collide: [1.15, 0.2, 1.15], water };
  }

  /** A garden gnome. Eleven inches of painted concrete, watching the path. */
  gardenGnome() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.24, 7), this.colorMat(0x2f5f8a));
    body.position.y = 0.12;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 5), this.colorMat(0xd8b49a));
    head.position.y = 0.29;
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 6), this.colorMat(0xe4e0d6));
    beard.position.set(0, 0.24, 0.045);
    beard.rotation.x = Math.PI;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 7), this.colorMat(0xb03a2e));
    hat.position.y = 0.42;
    g.add(body, head, beard, hat);
    return { group: g };
  }

  /** Birdhouse on a pole. Whatever is in there is not a bird. */
  birdhouse() {
    const g = new THREE.Group();
    const pole = this.box(0.07, 1.85, 0.07, 'wallWood');
    pole.position.y = 0.92;
    g.add(pole);
    const box = this.box(0.32, 0.34, 0.28, 'wallWood');
    box.position.y = 2.0;
    g.add(box);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.055, 8), this.colorMat(0x0a0908));
    hole.position.set(0, 2.04, 0.142);
    g.add(hole);
    for (const s of [-1, 1]) {
      const panel = this.box(0.26, 0.05, 0.36, 'roofShakeWood');
      panel.position.set(s * 0.09, 2.24, 0);
      panel.rotation.z = -s * 0.66;
      g.add(panel);
    }
    return { group: g, collide: [0.09, 0.9, 0.09] };
  }

  /** Sandpit with a bucket and a spade left in it. */
  sandbox() {
    const g = new THREE.Group();
    for (const [ox, oz, w, d] of [[0, -0.95, 2.0, 0.14], [0, 0.95, 2.0, 0.14], [-0.95, 0, 0.14, 2.0], [0.95, 0, 0.14, 2.0]]) {
      const board = this.box(w, 0.2, d, 'wallWood');
      board.position.set(ox, 0.1, oz);
      g.add(board);
    }
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), this.mat('dirt'));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = 0.15;
    g.add(sand);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.16, 8), this.colorMat(0xc4552e));
    bucket.position.set(0.4, 0.23, -0.3);
    bucket.rotation.z = 1.4;
    const spade = this.box(0.28, 0.02, 0.06, this.colorMat(0x3a6ab0));
    spade.position.set(-0.35, 0.17, 0.35);
    spade.rotation.y = 0.7;
    g.add(bucket, spade);
    return { group: g, collide: [1.0, 0.12, 1.0] };
  }

  /** Wheelbarrow, tipped forward where it was set down. */
  wheelbarrow() {
    const g = new THREE.Group();
    const tray = this.box(0.62, 0.3, 0.85, 'metalRust');
    tray.position.set(0, 0.42, 0);
    tray.rotation.x = -0.18;
    g.add(tray);
    for (const s of [-1, 1]) {
      const handle = this.box(0.05, 0.05, 1.35, 'wallWood');
      handle.position.set(s * 0.26, 0.4, -0.5);
      handle.rotation.x = 0.2;
      const leg = this.box(0.05, 0.3, 0.05, 'metalRust');
      leg.position.set(s * 0.26, 0.15, -0.42);
      g.add(handle, leg);
    }
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 9), this.colorMat(0x24211e));
    wheel.position.set(0, 0.19, 0.56);
    wheel.rotation.z = Math.PI / 2;
    g.add(wheel);
    return { group: g, collide: [0.4, 0.3, 0.7] };
  }

  /** Push mower, abandoned mid-stripe. */
  lawnMower() {
    const g = new THREE.Group();
    const deck = this.box(0.62, 0.2, 0.5, this.colorMat(0x2f6a52));
    deck.position.y = 0.24;
    const engine = this.box(0.3, 0.24, 0.28, this.colorMat(0x4a4d50));
    engine.position.y = 0.45;
    g.add(deck, engine);
    for (const [ox, oz] of [[-0.28, -0.22], [0.28, -0.22], [-0.28, 0.22], [0.28, 0.22]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 8), this.colorMat(0x24211e));
      w.position.set(ox, 0.11, oz);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
    for (const s of [-1, 1]) {
      const bar = this.box(0.04, 0.04, 0.95, this.colorMat(0x8a8d84));
      bar.position.set(s * 0.26, 0.62, -0.42);
      bar.rotation.x = 0.75;
      g.add(bar);
    }
    return { group: g, collide: [0.36, 0.3, 0.34] };
  }

  /** Something under a tarpaulin. It is the right size and the wrong shape. */
  tarpPile(w = 1.8, h = 1.0, d = 1.3) {
    const g = new THREE.Group();
    const lump = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 5), this.mat('tarpBlue'));
    lump.scale.set(w, h * 1.5, d);
    lump.position.y = h * 0.18;
    g.add(lump);
    for (const [ox, oz] of [[-w * 0.42, -d * 0.42], [w * 0.42, d * 0.42]]) {
      const brick = this.box(0.24, 0.12, 0.16, 'brickGray');
      brick.position.set(ox, 0.06, oz);
      g.add(brick);
    }
    return { group: g, collide: [w * 0.45, h * 0.45, d * 0.45] };
  }

  /**
   * A treehouse: a plank deck lashed into a bough with a nailed ladder. The
   * deck is returned so the caller can make it real ground — it is meant to
   * be climbed, and what is up there is worth the climb.
   */
  treehouse(deckY = 3.2) {
    const g = new THREE.Group();
    const deck = this.box(2.6, 0.16, 2.4, 'floorWood');
    deck.position.y = deckY;
    g.add(deck);
    for (const [ox, oz] of [[-1.15, -1.05], [1.15, -1.05], [-1.15, 1.05], [1.15, 1.05]]) {
      const brace = this.box(0.12, deckY, 0.12, 'bark');
      brace.position.set(ox, deckY / 2, oz);
      brace.rotation.z = -Math.sign(ox) * 0.06;
      g.add(brace);
    }
    for (const [ox, oz, w, d] of [[0, -1.16, 2.6, 0.1], [-1.28, 0, 0.1, 2.4], [1.28, 0, 0.1, 2.4]]) {
      const rail = this.box(w, 0.85, d, 'wallWood');
      rail.position.set(ox, deckY + 0.5, oz);
      g.add(rail);
    }
    const roof = this.box(2.7, 0.1, 2.5, 'roofShakeWood');
    roof.position.y = deckY + 1.7;
    roof.rotation.x = 0.1;
    g.add(roof);
    for (const s of [-1, 1]) {
      const post = this.box(0.1, 1.2, 0.1, 'wallWood');
      post.position.set(s * 1.2, deckY + 1.1, -1.1);
      g.add(post);
    }
    for (let i = 0; i < Math.floor(deckY / 0.42); i++) {   // the nailed ladder
      const rung = this.box(0.5, 0.05, 0.05, 'wallWood');
      rung.position.set(0, 0.35 + i * 0.42, 1.32);
      g.add(rung);
    }
    return { group: g, deck: { hx: 1.3, hz: 1.2, y: deckY + 0.16 }, ladder: { z: 1.5 } };
  }

  /** Fence run between two points; registers thin collider. */
  fenceRun(x1, z1, x2, z2, parent) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(-(z2 - z1), x2 - x1);
    const g = new THREE.Group();
    const rail = this.box(len, 0.1, 0.06, 'wallWood');
    rail.position.y = 1.0;
    const rail2 = this.box(len, 0.1, 0.06, 'wallWood');
    rail2.position.y = 0.55;
    g.add(rail, rail2);
    for (let t = 0; t <= len; t += 2.2) {
      const post = this.box(0.12, 1.2, 0.12, 'wallWood');
      post.position.set(-len / 2 + t, 0.6, 0);
      g.add(post);
    }
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    this.place(g, mx, mz, { yaw });
    parent.add(g);
    // Fences are hop-proof visual boundaries only along their line.
    const pad = 0.3;
    this.collision.addBox(Math.min(x1, x2) - pad, this.terrain.heightAt(mx, mz) - 0.5, Math.min(z1, z2) - pad,
      Math.max(x1, x2) + pad, this.terrain.heightAt(mx, mz) + 1.1, Math.max(z1, z2) + pad, 'fence');
    return g;
  }
}

/** How high above a porch deck the swing's hanger sits — under the canopy
 *  (see BuildingKit._porch: the roof underside lands around 2.49 m up). */
export const PORCH_SWING_HANG = 2.35;
/** Half the seat width. Anything placing one has to know how wide it is to
 *  keep it out of the porch posts — see World's porch-swing placement. */
export const PORCH_SWING_HALF = 0.75;

/** Blend two packed 0xRRGGBB colours; used to soot a wreck's paint down. */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t);
}

function seeded(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
