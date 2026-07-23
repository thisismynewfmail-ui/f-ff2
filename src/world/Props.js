import * as THREE from '../../lib/three.module.js';
import { mergeStatic, scaleBoxUVs } from './Buildings.js';

/**
 * Environmental props: wrecked cars, street furniture, debris, barriers.
 * Each factory returns a THREE.Group positioned by the caller via place();
 * solid props register AABB colliders + nav blocks.
 */
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

  colorMat(hex) {
    const key = 'c' + hex;
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshLambertMaterial({ color: hex }));
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

  // Untextured-by-design props use flat colors (geometry ready for future
  // texturing per the spec).
  wreckedCar(paint = 0x5a3b34) {
    const g = new THREE.Group();
    const body = this.box(4.2, 0.9, 1.9, this.colorMat(paint));
    body.position.y = 0.65;
    const cabin = this.box(2.2, 0.7, 1.7, this.colorMat(0x22262b));
    cabin.position.set(-0.2, 1.4, 0);
    g.add(body, cabin);
    for (const [wx, wz] of [[-1.4, 1], [1.4, 1], [-1.4, -1], [1.4, -1]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 8), this.colorMat(0x14161a));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.3, wz * 0.95);
      g.add(wheel);
    }
    return { group: g, collide: [2.2, 1.0, 1.1] };
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

  busStop() {
    const g = new THREE.Group();
    const roofM = this.mat('roofMetal');
    for (const s of [-1.4, 1.4]) {
      const post = this.box(0.12, 2.4, 0.12, this.colorMat(0x2c3036));
      post.position.set(s, 1.2, 0.5);
      g.add(post);
    }
    const back = this.box(3.2, 1.6, 0.08, this.colorMat(0x3a4148));
    back.position.set(0, 1.2, -0.55);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.6), roofM);
    roof.position.set(0, 2.45, 0);
    const seat = this.box(2.8, 0.08, 0.45, 'wallWood');
    seat.position.set(0, 0.55, -0.3);
    // route information panel on the end post
    const panel = this.box(0.55, 0.75, 0.05, this.colorMat(0x2d4a66));
    panel.position.set(1.4, 1.75, 0.5);
    const routes = this.box(0.4, 0.5, 0.03, this.colorMat(0xd8d2c0));
    routes.position.set(1.4, 1.78, 0.54);
    g.add(back, roof, seat, panel, routes);
    return { group: g, collide: [1.7, 1.2, 0.4] };
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

  well() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 10, 1, true), this.mat('brickGray', { side: THREE.DoubleSide }));
    ring.position.y = 0.45;
    const waterM = this.mat('water');
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 10), waterM);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.5;
    for (const s of [-1, 1]) {
      const post = this.box(0.12, 1.7, 0.12, 'wallWood');
      post.position.set(s * 0.95, 1.2, 0);
      g.add(post);
    }
    const roofBox = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 4), this.mat('roofShingle'));
    roofBox.position.y = 2.4;
    roofBox.rotation.y = Math.PI / 4;
    g.add(ring, water, roofBox);
    return { group: g, collide: [1.2, 0.8, 1.2] };
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
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8), new THREE.MeshBasicMaterial({ color: 0xff7830 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.16;
    g.add(stones, glow);
    return { group: g };
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

  /** Full gas-station forecourt: canopy on pillars + two dead pumps.
   *  Placed axis-aligned at (x, z); registers all colliders itself. */
  gasStation(x, z, parent) {
    const y = this.terrain.heightAt(x, z);
    const g = new THREE.Group();
    for (const [px, pz] of [[-5, -2.5], [5, -2.5], [-5, 2.5], [5, 2.5]]) {
      const pillar = this.box(0.4, 4.5, 0.4, 'wallConcrete');
      pillar.position.set(px, 2.25, pz);
      g.add(pillar);
      this.collision.addBoxCentered(x + px, y + 2.25, z + pz, 0.3, 2.25, 0.3, 'prop');
    }
    const slab = this.box(14, 0.4, 8, 'roofMetal');
    slab.position.y = 4.7;
    g.add(slab);
    this.place(g, x, z);
    parent.add(g);
    for (const px of [-3, 3]) {
      const pump = this.box(0.8, 1.6, 0.5, this.colorMat(0x7a2a24));
      const pg = new THREE.Group();
      pg.add(pump);
      pump.position.y = 0.8;
      this.place(pg, x + px, z - 1, { collide: [0.5, 0.9, 0.4] });
      parent.add(pg);
    }
    return g;
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
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4.5, 10), this.mat('wallMetal'));
    tank.position.y = 11.2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.4, 10), this.mat('roofMetal'));
    cap.position.y = 14.2;
    g.add(tank, cap);
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
    return { group: g, collide: [0.55, 1.25, 0.55] };
  }

  /** Playground swing set. Returns the two swing pivots for animation. */
  swingSet() {
    const g = new THREE.Group();
    const barY = 2.4;
    for (const sx of [-1.7, 1.7]) {
      for (const lean of [-0.5, 0.5]) {
        const leg = this.box(0.1, 2.6, 0.1, 'metalRust');
        leg.position.set(sx, barY / 2, lean);
        leg.rotation.x = lean * 0.42;
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
  parkedCar(paint = 0x39465e) {
    const g = new THREE.Group();
    const body = this.box(4.2, 0.9, 1.9, this.colorMat(paint));
    body.position.y = 0.65;
    const cabin = this.box(2.2, 0.7, 1.7, 'window');
    cabin.position.set(-0.2, 1.4, 0);
    g.add(body, cabin);
    for (const [wx, wz] of [[-1.4, 1], [1.4, 1], [-1.4, -1], [1.4, -1]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 8), this.colorMat(0x14161a));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.3, wz * 0.95);
      g.add(wheel);
    }
    const lights = [];
    for (const sz of [-0.6, 0.6]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xffc861 }));
      lamp.position.set(2.12, 0.75, sz);
      lamp.visible = false; // dark until the alarm trips
      g.add(lamp);
      lights.push(lamp);
    }
    return { group: g, collide: [2.2, 1.0, 1.1], lights };
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

function seeded(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
