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
const HAT_RETURN = 70;        // m: too far to read the post — so the hat goes back on
const CRASH_NEAR = 150;       // m: the wreck animates inside this (the plume
                              //    has to be alive from the scarecrow's post)
/** Where it is looking, once it decides to show you. Nothing else is there. */
const CRASH = { x: 62, z: -214 };

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

    this._interactions = 0;   // how many times you have laid a hand on it
    this._pointing = false;   // it has shown you where to go
    this._canSpin = 0;        // >0: the tin can is spinning off a bullet
    this._hatFall = null;     // the hat, mid-air
    this._hatGround = null;   // the hat, lying in the dirt where you shot it
    this._headSnap = false;   // one-frame head snap (no ease, no creak)
    this._materials();
    this._build();
    this._rags();
    this._crowBuild();
    this._crashSite();
    this._shootables();

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

    // Two glowing motes sat exactly over the stitched eyes. They are dark at
    // range and in daylight, and they are never bright — you only ever catch
    // them close up, and only for as long as you are close.
    this._eyes = [];
    for (const ex of [-0.055, 0.058]) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x7ad6ff, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.022, 8), mat);
      dot.position.set(ex, 0.305, 0.176);
      dot.renderOrder = 3;
      head.add(dot);
      this._eyes.push(mat);
    }

    // Static parts of the head merge; anything that still has to move — the
    // flutter clump, the face (its eyes light) and the hat (it comes off) —
    // is lifted out of the merge and put back after.
    const live = [topStraw, face, hat, ...this._eyes.map((m, i) => head.children.find((c) => c.material === m))];
    for (const n of live) if (n) head.remove(n);
    mergeStatic(head);
    for (const n of live) if (n) head.add(n);
    this._hat = hat;
    this._hatOn = true;
  }

  /**
   * The rags and the tin can.
   *
   * A scarecrow is not a mannequin — it is a thing hung with whatever moved in
   * the wind and made a noise. The ribbons flutter on their own phases and the
   * can turns on its string, which gives the silhouette something restless at
   * the edges while the body itself stands dead still. That contrast is the
   * whole effect: the rags move, the figure does not.
   */
  _rags() {
    const frame = this._frame;
    const ragMat = this._plaid;
    for (const [sx, len, phase] of [[-0.58, 0.44, 0.3], [-0.34, 0.3, 1.9], [0.36, 0.36, 3.4], [0.62, 0.5, 5.1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, 1.63, 0.04);
      const rag = this._box(0.09, len, 0.012, ragMat);
      rag.position.y = -len / 2;
      pivot.add(rag);
      const tail = this._box(0.06, len * 0.4, 0.012, ragMat);
      tail.position.set(0.02, -len - len * 0.2, 0.005);
      pivot.add(tail);
      frame.add(pivot);
      (this._ribbons ??= []).push({ node: pivot, phase });
    }
    // a tin can on a string — the actual bird-scarer, and the only part of the
    // whole assembly that was ever meant to move
    const hang = new THREE.Group();
    hang.position.set(0.78, 1.6, 0.06);
    const string = this._box(0.006, 0.2, 0.006, this._twine);
    string.position.y = -0.1;
    hang.add(string);
    const spin = new THREE.Group();
    spin.position.y = -0.24;
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 8),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a2 }));
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.05, 8),
      new THREE.MeshLambertMaterial({ color: 0x8a4a30 }));
    spin.add(can, label);
    hang.add(spin);
    frame.add(hang);
    this._can = { hang, spin };
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

  /* ---------------- the thing it is looking at ---------------- */

  /**
   * A crash site out in the flats, and the weapon in it.
   *
   * This is the far end of the only easter-egg chain in the game that spans
   * two places: put your hand on the scarecrow three times and it stops
   * looking at YOU and looks at something else — a fixed bearing, held, with
   * nothing on it as far as you can see. Walk it and you find this.
   *
   * It has to read as an IMPACT from four hundred metres away and as a wreck
   * from four, which is two different jobs. At range it is the shape on the
   * ground: a burnt scar with a trench ploughed into the near end of it, spoil
   * thrown up either side, and a thread of smoke still coming off it a year
   * later. Up close it is the hull — gone in edge-first, buckled along the
   * rim, one strut snapped off and thrown clear, and a tear down the flank
   * with something lit still running behind it.
   *
   * Nothing marks it on the map. Nothing tells you it is there. The scarecrow
   * told you, and only if you kept touching it.
   */
  _crashSite() {
    const w = this.world;
    const { x, z } = CRASH;
    const y = w.terrain.heightAt(x, z);
    this.crash = { x, y, z };
    const ENTRY = 0.62;                       // the bearing it came in on
    const ex = Math.sin(ENTRY), ez = Math.cos(ENTRY);
    const alloy = new THREE.MeshLambertMaterial({ color: 0x8d979d });
    const alloyBurnt = new THREE.MeshLambertMaterial({ color: 0x5d5f5c });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x4e575d });
    const dark = new THREE.MeshBasicMaterial({ color: 0x090d10 });
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ENTRY;                     // the whole site lies along the entry
    w.group.add(g);

    // ---- the scar. Opaque burnt ground, not a translucent smear over grass:
    //      a stain you can see through is a stain nobody notices from the air.
    //      The quads overlap each other heavily, so they go on the town's
    //      ground stack like any other draped surface rather than all sitting
    //      at one height: a dozen coplanar quads shimmer exactly the way the
    //      junctions did. See World._drapeLevel.
    const burn = (sx, sz, sizeX, sizeZ, yaw, shade) => {
      const mat = new THREE.MeshLambertMaterial({
        map: w.texLib.tiled('dirt', Math.max(1, sizeX / 3), Math.max(1, sizeZ / 3)),
        color: shade,
      });
      return w.dropDecal('decal:crashScar', x + sx, z + sz, sizeX, sizeZ, yaw, mat);
    };
    // The burn is built as a drift of overlapping quads at odd angles rather
    // than one big rectangle. A rectangle of scorched earth is a rectangle no
    // matter how well it is textured, and it is the first thing that gives a
    // set piece away from the air; a ragged union of eight of them is a burn.
    // Nine metres out the edge stops being opaque and hands over to a couple
    // of alpha stains, so the scar fades into the grass instead of ending.
    const along = (t, o = 0) => [ex * t + ez * o, ez * t - ex * o];
    for (const [t, o, sx1, sz1, turn, shade] of [
      [0, 0, 11, 10, 0.5, 0x6e6050], [-1.5, 1.2, 8.5, 7.5, -0.3, 0x554a3c],
      [3.5, -1.6, 10, 9, 0.9, 0x7a6b58], [4, 2.4, 9, 8, -0.7, 0x7a6b58],
      [8.5, 0.8, 8.5, 7, 0.2, 0x877661], [9.5, -2.2, 7, 6, 1.1, 0x877661],
      [14, 1.6, 6.5, 5.5, -0.4, 0x93816a], [19, -1.2, 5, 4.5, 0.7, 0x9e8b72],
    ]) {
      const [dx, dz] = along(t, o);
      burn(dx, dz, sx1, sz1, ENTRY + turn, shade);
    }
    // and the trench, running back up the bearing it came in on — cut in four
    // narrowing lengths so it shallows out and frays instead of ending on a
    // straight line drawn across the field
    for (const [t, o, wide, len, turn, shade] of [
      [1.5, 0, 4.8, 6, 0, 0x453c33], [7, 0.4, 4.0, 7, 0.05, 0x54493d],
      [13, 0.2, 3.0, 7, -0.06, 0x635646], [19, -0.4, 1.9, 6, 0.09, 0x736450],
    ]) {
      burn(...along(t, o), wide, len, ENTRY + turn, shade);
    }
    // the ragged outer edge, where it is scorch rather than bare earth
    for (const [t, o, size] of [[-4, -5, 13], [6, 6, 12], [16, -5, 11], [24, 4, 9]]) {
      const [dx, dz] = along(t, o);
      w._decal('oilStain', x + dx, z + dz, size, ENTRY + t, 0x5c5140);
    }
    for (const [t, o, size] of [[17, 1, 5.5], [25, -1.5, 4], [32, 1, 2.6]]) {
      const [dx, dz] = along(t, o);
      w._decal('rubble', x + dx, z + dz, size, ENTRY, 0x6a6152);
    }

    // spoil banks: the earth the hull pushed out either side of the trench
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const t = 2.4 + i * 4.4;
        const bank = w.kit.box(1.5 - i * 0.16, 0.5 - i * 0.07, 4.4, 'dirt');
        bank.position.set(side * (2.3 + i * 0.14), 0.12 - i * 0.02, t);
        bank.rotation.set(0, side * 0.06, side * 0.12);
        g.add(bank);
      }
    }
    // and the lip of earth heaped up where it finally stopped
    const berm = w.kit.box(6.4, 0.7, 1.8, 'dirt');
    berm.position.set(0, 0.14, -2.9);
    berm.rotation.z = 0.06;
    g.add(berm);

    // ---- the hull: a lens that went in edge-first and stopped half buried
    const hull = new THREE.Group();
    hull.rotation.set(0.62, 0.3, -0.28);
    hull.position.set(0, 0.35, 0);
    const disc = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 10), alloy);
    disc.scale.set(1, 0.24, 1);
    hull.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.46, 0.14, 6, 22), trimMat);
    rim.rotation.x = Math.PI / 2;
    hull.add(rim);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), alloyBurnt);
    dome.position.y = 0.36;
    hull.add(dome);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2.4), dark);
    canopy.position.y = 0.5;
    hull.add(canopy);
    // concentric seams across the upper face, so 5 m of hull is not 5 m of
    // one flat grey — they are what the buckling reads against
    for (const [sr, sy] of [[2.05, 0.16], [1.6, 0.25], [1.15, 0.32]]) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(sr, 0.035, 5, 20), trimMat);
      seam.rotation.x = Math.PI / 2;
      seam.position.y = sy;
      hull.add(seam);
    }
    // dark ports let into the rim at regular intervals
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 8), dark);
      port.position.set(Math.sin(a) * 2.3, 0.12, Math.cos(a) * 2.3);
      hull.add(port);
    }
    // buckled plating: a ring of panels, three of them sprung out of line
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sprung = i === 2 || i === 3 || i === 7;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.09, 0.75),
        sprung ? alloyBurnt : alloy);
      plate.position.set(Math.sin(a) * 1.85, 0.2 + (sprung ? 0.14 : 0), Math.cos(a) * 1.85);
      plate.rotation.set(sprung ? -0.5 : 0.06, -a, sprung ? 0.35 : 0);
      hull.add(plate);
    }
    // the tear down one flank, the ribs behind it, and what is still lit inside
    const tear = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 0.5), dark);
    tear.position.set(1.5, 0.06, 1.4);
    tear.rotation.y = -0.7;
    hull.add(tear);
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), trimMat);
      rib.position.set(1.1 + i * 0.22, 0.06, 1.05 + i * 0.2);
      rib.rotation.z = 0.3 - i * 0.1;
      hull.add(rib);
    }
    this._core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x7ad6ff }));
    this._core.position.set(1.45, 0.02, 1.32);
    hull.add(this._core);
    // three struts: two folded under it, one snapped off and thrown clear
    for (let i = 0; i < 2; i++) {
      const a = 2.1 + i * 2.1;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 1.3, 6), trimMat);
      strut.position.set(Math.sin(a) * 1.5, -0.5, Math.cos(a) * 1.5);
      strut.rotation.set(0.7, a, 0.4);
      hull.add(strut);
    }
    g.add(hull);
    const snapped = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 1.4, 6), trimMat);
    snapped.position.set(-3.6, 0.1, 2.4);
    snapped.rotation.set(Math.PI / 2, 0, 0.9);
    g.add(snapped);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 8), alloyBurnt);
    foot.position.set(-4.2, 0.07, 2.9);
    foot.rotation.z = 0.2;
    g.add(foot);

    // panels thrown clear, still holding their shape, thinning up the approach
    for (const [px, pz, ry, sc] of [
      [3.4, 2.0, 0.9, 1.1], [-3.0, 3.2, -0.4, 0.85], [4.9, -1.4, 2.2, 0.7],
      [-4.1, -2.0, 1.4, 0.75], [2.2, 7.5, 0.3, 0.6], [-2.6, 9.8, 2.6, 0.5],
      [1.4, 14.2, 1.1, 0.4], [-1.9, 18.5, 0.2, 0.3],
    ]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2 * sc, 0.07, 0.85 * sc),
        sc > 0.7 ? alloy : alloyBurnt);
      panel.position.set(px, 0.05, pz);
      panel.rotation.set(0.1, ry, 0.18);
      g.add(panel);
    }

    // it is still drawing power from somewhere
    this._crashGlow = new THREE.PointLight(0x54b4ff, 5, 15);
    this._crashGlow.position.set(x + 1.3, y + 0.7, z + 1.3);
    w.group.add(this._crashGlow);
    const shardMat = new THREE.MeshBasicMaterial({
      color: 0x7ad6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._shards = [];
    for (const [sx, sz] of [[2.4, -1.5], [-1.8, 2.6], [3.9, 3.2], [-3.4, -0.8]]) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), shardMat);
      shard.position.set(sx, 0.32, sz);
      g.add(shard);
      this._shards.push(shard);
    }

    // A thread of smoke off the tear. This is the part that carries: it is the
    // only thing about the site tall enough to see over the grass from the
    // post the scarecrow is standing on, which is what makes the bearing it
    // holds into a direction you can actually walk.
    this._crashSmoke = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshLambertMaterial({
        map: w.texLib.get('smoke'), transparent: true, depthWrite: false,
        opacity: 0, side: THREE.DoubleSide,
      });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat);
      q.position.set(x + 1.3, y + 1, z + 1.3);
      q.renderOrder = 3;
      w.group.add(q);
      this._crashSmoke.push({ q, mat, phase: i / 3 });
    }

    w.collision.addBoxCentered(x, y + 0.6, z, 2.3, 0.6, 2.3, 'prop');
    w.nav.blockBox(x - 2.3, z - 2.3, x + 2.3, z + 2.3);

    // the weapon, lying where it was thrown clear of the tear
    const bg = new THREE.Group();
    const bx = x + 3.0, bz = z - 2.6;
    this._blasterY = w.terrain.heightAt(bx, bz) + 0.16;
    bg.position.set(bx, this._blasterY, bz);
    bg.rotation.set(0, 1.2, 0.25);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 7), alloy);
    body.scale.set(1.4, 0.8, 2.4);
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8),
      new THREE.MeshBasicMaterial({ color: 0x7ad6ff }));
    cell.rotation.x = Math.PI / 2;
    cell.position.set(0, -0.09, 0.03);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.09), alloy);
    grip.position.set(0, -0.13, -0.15);
    grip.rotation.x = 0.3;
    bg.add(body, cell, grip);
    w.group.add(bg);
    this._blasterNode = bg;
    this._blasterCell = cell;

    this._blasterTaken = false;
    this._blasterPrompt = w.addInteractable({
      x: bx, z: bz, y: w.terrain.heightAt(bx, bz), radius: 2.2,
      prompt: 'Take it [E]',
      enabled: () => !this._blasterTaken,
      onInteract: () => this._takeBlaster(),
    });
  }

  _takeBlaster() {
    if (this._blasterTaken) return;
    this._blasterTaken = true;
    this._blasterNode.visible = false;
    this.world.removeInteractable(this._blasterPrompt);
    this.events.emit('weapon:unlock', { id: 'blaster' });
    this.events.emit('whisper', { intensity: 1 });
    this.events.emit('subtitle', {
      text: 'It is warm, and it is lighter than it should be. The cell fills itself while you hold it.',
    });
    this.world.secrets?.discover('alienBlaster', 'Not from around here');
  }

  /* ---------------- shooting it ---------------- */

  /** Body-local (x,z) offset to a world position. */
  _local(lx, lz) {
    const c = Math.cos(this.bodyYaw), s = Math.sin(this.bodyYaw);
    return { x: this.pos.x + lx * c + lz * s, z: this.pos.z - lx * s + lz * c };
  }

  /**
   * Two things on it will take a bullet, and neither of them is the scarecrow.
   *
   * The tin can is the joke everyone reaches for first — you shoot a can off a
   * string because it is there, it rings, it spins, the crow goes up. Nothing
   * comes of it and nothing is supposed to.
   *
   * The hat is the other one. Knock it off and the head does the thing it has
   * spent the whole game refusing to do in front of you: it moves while you are
   * watching, in one step, with no creak. Then walk away far enough that you
   * cannot make out the post any more, come back, and it is wearing the hat.
   */
  _shootables() {
    const w = this.world;
    const hatPos = this._local(0, -0.02);
    this._hatShootable = w.addShootable({
      x: hatPos.x, y: this.pos.y + 2.66, z: hatPos.z, r: 0.42,
      onHit: () => this._knockHat(),
    });
    const canPos = this._local(0.78, 0.06);
    this._canRings = 0;
    w.addShootable({
      x: canPos.x, y: this.pos.y + 1.36, z: canPos.z, r: 0.28,
      onHit: () => {
        this._canSpin = 13 + Math.random() * 7;
        this._canRings++;
        this.events.emit('anomaly:sound', { kind: 'chime', pos: { x: canPos.x, y: this.pos.y + 1.36, z: canPos.z } });
        this.events.emit('noise', { x: canPos.x, z: canPos.z, radius: 26 });
        this._spookCrow();
        if (this._canRings === 3) {
          this.events.emit('subtitle', { text: 'Three for three. The can keeps turning after it should have stopped.' });
        }
        return false;   // it stays on its string; ring it as often as you like
      },
    });
  }

  /** The hat comes off, and the head stops pretending. */
  _knockHat() {
    if (!this._hatOn) return false;
    this._hatOn = false;
    const hat = this._hat;
    const wp = new THREE.Vector3();
    hat.getWorldPosition(wp);
    this._head.remove(hat);
    this.world.group.add(hat);
    hat.position.copy(wp);
    hat.rotation.set(-0.22, this.bodyYaw + this._headYaw, 0);

    const p = this.world.game?.player;
    let dx = 0.4, dz = 1;
    if (p) { dx = this.pos.x - p.position.x; dz = this.pos.z - p.position.z; }
    const len = Math.hypot(dx, dz) || 1;
    this._hatFall = {
      node: hat, vx: (dx / len) * 2.4, vz: (dz / len) * 2.4, vy: 1.7,
      spin: 7 + Math.random() * 5,
    };
    this._headSnap = true;      // no ease, no creak: it is simply facing you now
    this._straighten = 0;
    this._forceLook = 3.5;
    this.events.emit('anomaly:sound', { kind: 'creak', pos: { x: this.pos.x, y: this.pos.y + 2, z: this.pos.z } });
    this.events.emit('whisper', { intensity: 0.9 });
    this.events.emit('subtitle', { text: 'The hat comes off. The head is already facing you, and you did not see it move.' });
    this._spookCrow();
    return true;                // consumed: no hat left to shoot
  }

  _fallHat(dt) {
    const f = this._hatFall;
    const n = f.node;
    f.vy -= 11 * dt;
    f.vx *= 1 - Math.min(0.9, dt * 1.6);
    f.vz *= 1 - Math.min(0.9, dt * 1.6);
    n.position.x += f.vx * dt;
    n.position.z += f.vz * dt;
    n.position.y += f.vy * dt;
    n.rotation.z += f.spin * dt;
    n.rotation.x += f.spin * 0.35 * dt;
    const gy = this.world.terrain.heightAt(n.position.x, n.position.z) + 0.04;
    if (n.position.y <= gy) {
      n.position.y = gy;
      n.rotation.set(0.05, n.rotation.y, 0.04);   // settled brim-down in the dirt
      this._hatFall = null;
      this._hatGround = n;
    }
  }

  /** Far enough away that you cannot make out the post — so it is wearing it again. */
  _restoreHat() {
    const hat = this._hatGround;
    this.world.group.remove(hat);
    hat.position.set(0, 0.62, -0.02);
    hat.rotation.set(-0.22, 0, 0);
    this._head.add(hat);
    this._hatGround = null;
    this._hatOn = true;
    this._hatBackNotice = true;
    this._hatShootable.active = true;
  }

  /* ---------------- interaction ---------------- */

  _interact() {
    this._interactions++;
    // Third time you lay a hand on it, it stops being about you.
    if (this._interactions >= 3 && !this._pointing) {
      this._pointing = true;
      this._straighten = 0;
      this._forceLook = 0;
      this.events.emit('anomaly:sound', { kind: 'creak', pos: { x: this.pos.x, y: this.pos.y + 2, z: this.pos.z } });
      this.events.emit('whisper', { intensity: 1 });
      this.events.emit('subtitle', {
        text: 'Its head turns past you, and stops. It is looking at something out in the flats.',
      });
      this._spookCrow();
      return;
    }
    if (this._pointing) {
      // it has said its piece; the head does not come back for you
      this.events.emit('anomaly:sound', { kind: 'creak', pos: { x: this.pos.x, y: this.pos.y + 2, z: this.pos.z } });
      this.events.emit('subtitle', {
        text: this._blasterTaken
          ? 'It has nothing else for you. The head does not move.'
          : 'You push at its head. It does not give. It is still looking out at the flats.',
      });
      this._spookCrow();
      return;
    }
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
    const cx = camPos?.x ?? 1e9, cz = camPos?.z ?? 1e9;
    const dcx = this.pos.x - cx, dcz = this.pos.z - cz;
    const camDist2 = dcx * dcx + dcz * dcz;

    // The hat lives outside the near gate: it has to be able to fall while you
    // are shooting from range, and it has to be able to go back on while you
    // are too far away to catch it happening.
    if (this._hatFall) this._fallHat(dt);
    else if (this._hatGround && camDist2 > HAT_RETURN * HAT_RETURN) this._restoreHat();

    // So does the wreck — it is 40 m off the post and it keeps its own hours.
    const wx = this.crash.x - cx, wz = this.crash.z - cz;
    if (wx * wx + wz * wz < CRASH_NEAR * CRASH_NEAR) this._updateCrash(dt, time, cx, cz);

    if (camDist2 > NEAR2) return;

    // the coat and straw stir in a wind that isn't blowing
    this._frame.rotation.z = Math.sin(time * 0.7 + this._phase) * 0.02 + Math.sin(time * 1.9) * 0.006;
    for (const f of this._flutterers) {
      f.node.rotation.z = f.base + Math.sin(time * 3.1 + f.phase) * 0.22;
    }
    // the rags: each on its own phase, so the silhouette never repeats itself
    for (const r of this._ribbons) {
      r.node.rotation.z = Math.sin(time * 2.3 + r.phase) * 0.30 + Math.sin(time * 0.71 + r.phase) * 0.14;
      r.node.rotation.x = Math.sin(time * 1.7 + r.phase * 1.6) * 0.18;
    }
    // the tin can turns on its string — idling, or spinning hard if you hit it
    if (this._canSpin > 0) {
      this._can.spin.rotation.y += this._canSpin * dt;
      this._canSpin = Math.max(0, this._canSpin - dt * 4.5);
    } else {
      this._can.spin.rotation.y += dt * (0.5 + Math.sin(time * 0.6) * 0.45);
    }
    this._can.hang.rotation.z = Math.sin(time * 1.6 + 0.9) * 0.13;

    const p = this.world.game?.player;
    if (p) {
      const dx = p.position.x - this.pos.x, dz = p.position.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      let target = wrap(Math.atan2(dx, dz) - this.bodyYaw);

      // is the player looking at it? (its head goes still under a direct gaze)
      let observed = false;
      if (dist < 46) {
        const look = p.lookDirection();
        const dot = (look.x * -dx + look.z * -dz) / dist; // toward-the-scarecrow gaze
        observed = dot > OBSERVED_DOT;
      }

      if (this._pointing) {
        // it is done with you: the head holds a bearing on the flats and stays
        // there, watched or not, and nothing you do turns it back
        const bearing = wrap(Math.atan2(CRASH.x - this.pos.x, CRASH.z - this.pos.z) - this.bodyYaw);
        this._headYaw = easeAngle(this._headYaw, bearing, dt, 1.1);
      } else if (this._headSnap) {
        // one frame, no ease: the hat came off and it is looking at you
        this._headSnap = false;
        this._headYaw = target;
      } else if (this._straighten > 0) {
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
      // and the sack settles on the neck as it breathes, which it does not do
      this._head.position.y = 2.02 + Math.sin(time * 0.9 + this._phase) * 0.006;

      // The motes over the stitched eyes. Never bright, never visible at range:
      // you only ever get them within a few metres, and only while it has its
      // face turned to yours. Bare-headed it stops being coy about them.
      const facing = Math.max(0, 1 - Math.abs(wrap(target - this._headYaw)) / 0.9);
      const near = Math.max(0, 1 - dist / 7.5);
      const cap = this._hatOn ? 0.34 : 0.62;
      const lit = near * facing * cap * (0.72 + Math.sin(time * 2.6 + this._phase) * 0.28);
      for (const m of this._eyes) m.opacity = lit;

      // once it has found you, up close, it whispers — once
      const facingYou = Math.abs(wrap(target - this._headYaw)) < 0.22;
      if (!this._whispered && dist < 9 && facingYou && Math.abs(this._headYaw) > 1.0) {
        this._whispered = true;
        this.events.emit('whisper', { intensity: 0.7 });
        this.events.emit('subtitle', { text: 'Its head is on the wrong side now. It is watching you.' });
      }
      // and it lets you notice the hat is back on, exactly once
      if (this._hatBackNotice && dist < 18) {
        this._hatBackNotice = false;
        this.events.emit('whisper', { intensity: 0.6 });
        this.events.emit('subtitle', { text: 'It is wearing its hat again. It is not the way you left it.' });
      }

      this._updateCrow(dt, time, p);
    }
  }

  /**
   * The wreck. It has no moving parts and it is not supposed to look alive —
   * it looks *powered*, which is worse. The shards drift and the light under
   * the torn flank breathes on a period nothing organic would pick.
   */
  _updateCrash(dt, time, cx, cz) {
    for (let i = 0; i < this._shards.length; i++) {
      const s = this._shards[i];
      s.rotation.y += dt * (0.5 + i * 0.22);
      s.rotation.x += dt * 0.31;
      s.position.y = 0.28 + Math.sin(time * (0.8 + i * 0.17) + i * 2.1) * 0.09;
    }
    this._shards[0].material.opacity = 0.55 + Math.sin(time * 1.3) * 0.3;
    this._crashGlow.intensity = 4.2 + Math.sin(time * 0.9) * 1.5 + Math.sin(time * 5.3) * 0.5;
    this._core.scale.setScalar(0.9 + Math.sin(time * 1.7) * 0.12);
    // the thread of smoke: rise, spread, fade, repeat
    for (const s of this._crashSmoke) {
      const t = (time * 0.055 + s.phase) % 1;
      s.q.position.y = this.crash.y + 1 + t * 7;
      const sc = 0.5 + t * 1.7;
      s.q.scale.set(sc, sc, sc);
      s.mat.opacity = 0.16 * Math.sin(Math.PI * t);
      s.q.rotation.y = Math.atan2(cx - this.crash.x, cz - this.crash.z);
    }
    if (!this._blasterTaken) {
      this._blasterNode.position.y = this._blasterY + Math.sin(time * 1.4) * 0.02;
      this._blasterNode.rotation.y = 1.2 + Math.sin(time * 0.5) * 0.05;
      this._blasterCell.material.color.setHSL(0.55, 1, 0.55 + Math.sin(time * 3.1) * 0.18);
    }
  }

  _updateCrow(dt, time, p) {
    const c = this._crow;
    if (!c) return;
    const dist = Math.hypot(p.position.x - c.baseX, p.position.z - c.baseZ);
    if (c.state === 'perched') {
      c.group.position.y = c.baseY + Math.sin(time * 2) * 0.012;
      // it shifts its weight and preens; the head snaps between fixed points
      c.group.rotation.z = Math.sin(time * 1.3) * 0.03;
      c.wingL.rotation.z = 0.3 + Math.sin(time * 0.9) * 0.05;
      c.wingR.rotation.z = -0.3 - Math.sin(time * 0.9 + 1.1) * 0.05;
      c.twitch -= dt;
      if (c.twitch <= 0) {
        c.twitch = 0.8 + Math.random() * 2.6;
        c.head.rotation.y = (Math.random() - 0.5) * 1.0;
        c.head.rotation.x = Math.random() < 0.3 ? 0.5 : 0;   // a peck at the arm
      }
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
      c.head.rotation.set(0, 0, 0); c.twitch = 1.2;
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
