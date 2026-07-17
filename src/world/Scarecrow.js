import * as THREE from '../../lib/three.module.js';
import { mergeStatic } from './Buildings.js';

/**
 * The scarecrow on the east farm — reworked into an aware, dynamic set piece.
 *
 * Textured from canvas-generated sources (burlap sacking, a stitched face,
 * a tattered flannel coat, straw wisps) instead of flat colour. It sways in
 * a wind that isn't there and its straw flutters, but the unease is its head:
 * it slowly turns to keep the player in view — and it only turns while you are
 * NOT looking at it. Meet its stitched eyes and it goes dead still, facing the
 * road exactly as it should. Look away, come back, and it has found you again.
 *
 * Interactive: get close and you can set its head straight (it resists, and
 * creaks), or — if it is already facing the field — tap its shoulder and watch
 * it turn its head, slowly, to you. A crow perches on one outstretched arm and
 * scatters with a caw when you approach, drifting back once you have gone.
 *
 * All of it whispers; none of it breaks stride. The body never moves from its
 * post and the head-turn is never a snap you can catch — only a fact you find.
 */
const NEAR2 = 95 * 95;        // only run the full logic within 95 m of the camera
const OBSERVED_DOT = 0.986;   // gaze cone that counts as "you are looking at it"
const CROW_STARTLE = 6.5;     // m: the crow bolts inside this
const CROW_RETURN = 24;       // m: it drifts back once you are this far

export class Scarecrow {
  constructor(world) {
    this.world = world;
    this.events = world.events;
    const x = 100, z = -193;
    const y = world.terrain.heightAt(x, z);
    this.pos = { x, y, z };
    this.bodyYaw = Math.PI;   // its post faces the road; the head is another matter

    this._headYaw = 0;        // head rotation relative to the body (0 = facing road)
    this._straighten = 0;     // >0: forcing the head back toward the field
    this._forceLook = 0;      // >0: forcing the head toward the player (interaction)
    this._whispered = false;
    this._phase = (x * 0.7 + z * 1.3) % 6.283;

    this._materials();
    this._build();
    this._crowBuild();

    world.collision.addBoxCentered(x, y + 1.15, z, 0.26, 1.15, 0.26, 'prop');

    world.addInteractable({
      x, z, y, radius: 2.3,
      prompt: () => (Math.abs(this._headYaw) > 0.4
        ? 'Set its head straight [E]'
        : 'Touch the scarecrow [E]'),
      onInteract: () => this._interact(),
    });
  }

  /* ---------------- construction ---------------- */

  _materials() {
    this._burlap = canvasMat(burlapCanvas(), { lambert: true });
    this._face = canvasMat(faceCanvas(), { lambert: false, transparent: true });
    this._plaid = canvasMat(plaidCanvas(), { lambert: true });
    this._straw = canvasMat(strawCanvas(), { lambert: false, transparent: true, cutout: true, doubleSide: true });
    this._wood = this.world.kit.mat('bark');
    this._twine = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
    this._felt = new THREE.MeshLambertMaterial({ color: 0x241f1a });
  }

  _box(w, h, d, mat) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  /** A crossed-quad clump of straw, pivoting at its base for flutter. */
  _strawClump(scale = 1) {
    const g = new THREE.Group();
    for (const rot of [0, Math.PI / 2]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.5 * scale, 0.5 * scale), this._straw);
      q.position.y = 0.22 * scale;
      q.rotation.y = rot;
      g.add(q);
    }
    return g;
  }

  _build() {
    const placed = new THREE.Group();
    placed.position.set(this.pos.x, this.pos.y, this.pos.z);
    placed.rotation.y = this.bodyYaw;
    this.world.group.add(placed);
    this.group = placed;

    // frame: sways as one (coat + cross-post), the head rides on top of it
    const frame = new THREE.Group();
    placed.add(frame);
    this._frame = frame;

    const post = this._box(0.12, 2.3, 0.12, this._wood);
    post.position.y = 1.15;
    const arms = this._box(1.55, 0.1, 0.1, this._wood);
    arms.position.y = 1.68;
    frame.add(post, arms);

    // tattered flannel coat hung on the cross — a torso and a flared, ragged hem
    const torso = this._box(0.8, 0.95, 0.34, this._plaid);
    torso.position.y = 1.28;
    const hem = this._box(0.66, 0.5, 0.3, this._plaid);
    hem.position.set(0.03, 0.72, 0);
    hem.rotation.z = 0.06;
    const belt = this._box(0.84, 0.1, 0.36, this._twine);
    belt.position.y = 1.02;
    frame.add(torso, hem, belt);

    // straw hands at both wrists, a fistful at the collar
    for (const s of [-1, 1]) {
      const hand = this._strawClump(0.9);
      hand.position.set(s * 0.72, 1.62, 0);
      hand.rotation.z = s * 0.5;
      frame.add(hand);
      this._flutter(hand, s * 0.5);
    }
    const collar = this._strawClump(0.8);
    collar.position.set(0, 1.86, 0);
    frame.add(collar);
    this._flutter(collar, 0);

    // ---- head: a cinched burlap sack, stitched face, straw poking out, a
    //      slumped felt hat. Its own group so it can turn on the neck. ----
    const head = new THREE.Group();
    head.position.y = 2.02;
    frame.add(head);
    this._head = head;

    const sack = this._box(0.34, 0.4, 0.32, this._burlap);
    sack.position.y = 0.26;
    const crown = this._box(0.28, 0.16, 0.28, this._burlap); // rounded-ish top
    crown.position.y = 0.5;
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.1, 8), this._twine);
    tie.position.y = 0.06; // the neck cinch
    head.add(sack, crown, tie);
    // a vertical seam of stitches down the sack front
    const seam = this._box(0.02, 0.4, 0.02, this._twine);
    seam.position.set(0.09, 0.26, 0.168);
    head.add(seam);
    // the face, keyed onto the sack front
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.34), this._face);
    face.position.set(0, 0.27, 0.171);
    face.renderOrder = 2;
    head.add(face);
    this._faceQuad = face;
    // straw bursting from the top of the sack, under the hat
    const topStraw = this._strawClump(0.7);
    topStraw.position.y = 0.5;
    head.add(topStraw);
    this._flutter(topStraw, 1.7);

    // slumped, wide-brim felt hat, tipped forward
    const hat = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.05, 12), this._felt);
    const domeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.26, 12), this._felt);
    domeCap.position.y = 0.14;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.06, 12), this._twine);
    band.position.y = 0.05;
    hat.add(brim, domeCap, band);
    hat.position.set(0, 0.62, -0.02);
    hat.rotation.x = -0.22; // tipped down over the brow
    head.add(hat);

    // static parts of the head merge; the whole head still turns as a unit,
    // but the flutter clumps stay live so they must not be merged in
    for (const clump of [topStraw]) head.remove(clump);
    mergeStatic(head);
    head.add(topStraw);
  }

  /** Register a straw clump for per-frame flutter. */
  _flutter(node, base) {
    (this._flutterers ??= []).push({ node, base, phase: (node.position.x * 3 + base) % 6.283 });
    node.rotation.z = base;
  }

  /* ---------------- the crow ---------------- */

  _crowBuild() {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x131310 });
    const sheen = new THREE.MeshLambertMaterial({ color: 0x25262b });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), dark);
    body.scale.set(1, 0.9, 1.5);
    body.position.y = 0.12;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.22), dark);
    tail.position.set(0, 0.12, -0.2);
    const headGrp = new THREE.Group();
    headGrp.position.set(0, 0.24, 0.14);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 6), dark);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5), new THREE.MeshLambertMaterial({ color: 0x6a5a2c }));
    beak.rotation.x = Math.PI / 2;
    beak.position.z = 0.09;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 4), new THREE.MeshBasicMaterial({ color: 0xd0a020 }));
    eye.position.set(0.045, 0.02, 0.05);
    const eye2 = eye.clone(); eye2.position.x = -0.045;
    headGrp.add(skull, beak, eye, eye2);
    const wingL = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.14), sheen);
    wingL.position.set(0.12, 0.13, 0);
    wingL.rotation.set(-Math.PI / 2, 0, 0.3);
    const wingR = wingL.clone();
    wingR.position.x = -0.12; wingR.rotation.z = -0.3;
    g.add(body, tail, headGrp, wingL, wingR);

    // world-space base position: the tip of one outstretched arm
    const c = Math.cos(this.bodyYaw), s = Math.sin(this.bodyYaw);
    const lx = -0.72, lz = 0.0;
    const bx = this.pos.x + lx * c + lz * s;
    const bz = this.pos.z - lx * s + lz * c;
    const by = this.pos.y + 1.66;
    g.position.set(bx, by, bz);
    g.rotation.y = this.bodyYaw + 0.7;
    this.world.group.add(g);
    this._crow = {
      group: g, head: headGrp, wingL, wingR,
      baseX: bx, baseY: by, baseZ: bz, state: 'perched', t: 0, twitch: 1.5, dirx: 0, dirz: 1,
    };
  }

  /* ---------------- interaction ---------------- */

  _interact() {
    if (Math.abs(this._headYaw) > 0.4) {
      // it is looking at you; you turn it back to the field. It resists.
      this._straighten = 2.6;
      this._forceLook = 0;
      this._whispered = false;
      this.events.emit('anomaly:sound', { kind: 'creak', pos: { x: this.pos.x, y: this.pos.y + 2, z: this.pos.z } });
      this.events.emit('whisper', { intensity: 0.5 });
      this.events.emit('subtitle', { text: 'You turn its head back toward the field. It does not want to go.' });
    } else {
      // it faces the field; you tap its shoulder and it turns, slowly, to you
      this._forceLook = 2.4;
      this._straighten = 0;
      this.events.emit('anomaly:sound', { kind: 'creak', pos: { x: this.pos.x, y: this.pos.y + 2, z: this.pos.z } });
      this.events.emit('whisper', { intensity: 0.85 });
      this.events.emit('subtitle', { text: 'You touch its shoulder. Slowly, the head turns to face you.' });
    }
    this._spookCrow();
  }

  _spookCrow() {
    const c = this._crow;
    if (c && c.state === 'perched') this._startleCrow(c);
  }

  _startleCrow(c) {
    c.state = 'flee';
    c.t = 0;
    const p = this.world.game?.player;
    let dx = 0.3, dz = 1;
    if (p) { dx = c.baseX - p.position.x; dz = c.baseZ - p.position.z; }
    const len = Math.hypot(dx, dz) || 1;
    c.dirx = dx / len; c.dirz = dz / len;
    this.events.emit('crow:caw', { pos: { x: c.baseX, y: c.baseY + 0.4, z: c.baseZ } });
    this.events.emit('whisper', { intensity: 0.3 });
  }

  /* ---------------- per-frame ---------------- */

  update(dt, time, camPos) {
    if (!this.group) return;
    const dcx = this.pos.x - (camPos?.x ?? 1e9);
    const dcz = this.pos.z - (camPos?.z ?? 1e9);
    if (dcx * dcx + dcz * dcz > NEAR2) return;

    // the coat and straw stir in a wind that isn't blowing
    this._frame.rotation.z = Math.sin(time * 0.7 + this._phase) * 0.02 + Math.sin(time * 1.9) * 0.006;
    for (const f of this._flutterers) {
      f.node.rotation.z = f.base + Math.sin(time * 3.1 + f.phase) * 0.22;
    }

    const p = this.world.game?.player;
    if (p) {
      const dx = p.position.x - this.pos.x, dz = p.position.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      const target = wrap(Math.atan2(dx, dz) - this.bodyYaw);

      // is the player looking at it? (its head goes still under a direct gaze)
      let observed = false;
      if (dist < 46) {
        const look = p.lookDirection();
        const dot = (look.x * -dx + look.z * -dz) / dist; // toward-the-scarecrow gaze
        observed = dot > OBSERVED_DOT;
      }

      if (this._straighten > 0) {
        this._straighten -= dt;
        this._headYaw = easeAngle(this._headYaw, 0, dt, 2.6);
      } else if (this._forceLook > 0) {
        this._forceLook -= dt;
        this._headYaw = easeAngle(this._headYaw, target, dt, 2.4);
      } else if (!observed) {
        // it only turns while unwatched — the turn is a thing you find, never see
        this._headYaw = easeAngle(this._headYaw, target, dt, dist < 14 ? 1.15 : 0.6);
      }

      this._head.rotation.y = this._headYaw;
      // it cocks its head as you close in, and as it turns further off-axis
      const cock = Math.max(0, 1 - dist / 16) * 0.16 + Math.min(0.12, Math.abs(this._headYaw) * 0.08);
      this._head.rotation.z = cock * Math.sign(this._headYaw || 1);

      // once it has found you, up close, it whispers — once
      const facingYou = Math.abs(wrap(target - this._headYaw)) < 0.22;
      if (!this._whispered && dist < 9 && facingYou && Math.abs(this._headYaw) > 1.0) {
        this._whispered = true;
        this.events.emit('whisper', { intensity: 0.7 });
        this.events.emit('subtitle', { text: 'Its head is on the wrong side now. It is watching you.' });
      }

      this._updateCrow(dt, time, dist);
    }
  }

  _updateCrow(dt, time, dist) {
    const c = this._crow;
    if (!c) return;
    if (c.state === 'perched') {
      c.group.position.y = c.baseY + Math.sin(time * 2) * 0.012;
      c.twitch -= dt;
      if (c.twitch <= 0) { c.twitch = 0.8 + Math.random() * 2.6; c.head.rotation.y = (Math.random() - 0.5) * 1.0; }
      if (dist < CROW_STARTLE) this._startleCrow(c);
    } else if (c.state === 'flee') {
      c.t += dt;
      const k = Math.min(1, c.t / 1.3);
      c.group.position.set(c.baseX + c.dirx * k * 7, c.baseY + k * 6.5, c.baseZ + c.dirz * k * 7);
      const flap = Math.sin(c.t * 26) * 0.9;
      c.wingL.rotation.z = 0.3 + flap;
      c.wingR.rotation.z = -0.3 - flap;
      if (k >= 1) { c.state = 'gone'; c.group.visible = false; }
    } else if (c.state === 'gone' && dist > CROW_RETURN) {
      c.state = 'perched';
      c.group.visible = true;
      c.group.position.set(c.baseX, c.baseY, c.baseZ);
      c.wingL.rotation.z = 0.3; c.wingR.rotation.z = -0.3;
      c.head.rotation.y = 0; c.twitch = 1.2;
    }
  }
}

/* ---------------- angle helpers ---------------- */

function wrap(a) { return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }
function easeAngle(cur, target, dt, rate) { return cur + wrap(target - cur) * Math.min(1, dt * rate); }

/* ---------------- canvas textures ---------------- */

function retro(t, repeat = false) {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function canvasMat(canvas, { lambert = true, transparent = false, cutout = false, doubleSide = false } = {}) {
  const map = retro(new THREE.CanvasTexture(canvas));
  const opts = { map, transparent };
  if (cutout) { opts.alphaTest = 0.5; opts.transparent = false; }
  if (doubleSide) opts.side = THREE.DoubleSide;
  return lambert ? new THREE.MeshLambertMaterial(opts) : new THREE.MeshBasicMaterial(opts);
}

/** Woven tan burlap with a darker warp/weft and speckle. */
function burlapCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c3ab7c';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(120,98,60,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 64; i += 3) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(64, i); ctx.stroke();
  }
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 64, y = Math.random() * 64;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(90,72,42,0.35)' : 'rgba(214,196,150,0.35)';
    ctx.fillRect(x, y, 1, 1);
  }
  return c;
}

/** The stitched face: cross-stitch eyes, a crooked stitched grin. */
function faceCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = '#241c15';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  const X = (cx, cy, r) => {
    ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke();
  };
  X(22, 25, 7);
  X(43, 24, 7);
  // a slightly lopsided stitched mouth
  ctx.beginPath();
  ctx.moveTo(18, 45);
  ctx.quadraticCurveTo(32, 52, 47, 43);
  ctx.stroke();
  ctx.lineWidth = 1.8;
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const mx = 18 + t * 29;
    const my = 45 + Math.sin(Math.PI * t) * 6 - (t * 2);
    ctx.beginPath(); ctx.moveTo(mx, my - 4); ctx.lineTo(mx, my + 4); ctx.stroke();
  }
  return c;
}

/** Tattered dark flannel tartan. */
function plaidCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a2c2a';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(63,74,51,0.55)';
  for (const o of [0, 32]) { ctx.fillRect(o, 0, 14, 64); ctx.fillRect(0, o, 64, 14); }
  ctx.strokeStyle = 'rgba(185,166,125,0.6)';
  ctx.lineWidth = 2;
  for (const o of [8, 40]) {
    ctx.beginPath(); ctx.moveTo(o, 0); ctx.lineTo(o, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, o); ctx.lineTo(64, o); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(20,16,14,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 64; i += 4) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke();
  }
  return c;
}

/** Wisps of straw on a transparent field (cutout). */
function strawCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = 6 + Math.random() * 52;
    const top = 4 + Math.random() * 14;
    const spread = (Math.random() - 0.5) * 14;
    const shade = 128 + Math.floor(Math.random() * 54); // muted wheat, not neon
    ctx.strokeStyle = `rgb(${shade + 22},${shade - 8},${Math.floor(shade * 0.42)})`;
    ctx.beginPath();
    ctx.moveTo(x, 62);
    ctx.quadraticCurveTo(x + spread * 0.5, 32, x + spread, top);
    ctx.stroke();
  }
  return c;
}
