import * as THREE from '../../lib/three.module.js';
import { Companion } from '../entities/Companion.js';

/**
 * Owns the escort: the folded one in the satchel, the one standing in the
 * street, and the bolt of arc she throws when she uses her shoulder pods.
 *
 * The loop is the sentry's loop, deliberately — one item, one contract, learnt
 * once:
 *
 *   BUY     the vendor sells her; she lands in the satchel like anything else
 *           ('pickup' with type 'companion').
 *   DEPLOY  click her in the satchel and she unfolds on the ground in front of
 *           you. There is only ever one of her out.
 *   ORDER   [E] on her opens the dial (rendering/RadialMenu.js).
 *   PACK UP an order on that dial, and she folds back into the satchel.
 *
 * The one thing that is hers alone is the ARC: a bolt between her shoulder
 * emitters and whatever she just hit, drawn here rather than in the entity
 * because it outlives the frame it was fired on and wants the scene.
 */
const DEPLOY_DIST = 1.6;
const ARC_LIFE = 0.16;

export class CompanionSystem {
  constructor(events, world, texLib, scene, player) {
    this.events = events;
    this.world = world;
    this.texLib = texLib;
    this.scene = scene;
    this.player = player;

    this.stored = 0;
    this.unit = null;          // the deployed one, or null
    this._arcs = [];

    events.on('pickup', ({ type }) => {
      if (type !== 'companion') return;
      this.stored++;
      this._syncSatchel();
    });
    events.on('inventory:drop', ({ type }) => { if (type === 'companion') this.deploy(); });
    events.on('companion:arc', (e) => this._drawArc(e));
  }

  /**
   * State the count rather than letting the satchel keep its own tally: she is
   * either folded up, or standing in the street, and only this knows which.
   */
  _syncSatchel() {
    this.events.emit('inventory:sync', {
      type: 'companion', label: 'Escort Unit', count: this.stored,
    });
  }

  /* ---------------- deploy / recall ---------------- */

  /** Set her down in front of the player and let her stand up. */
  deploy() {
    if (this.unit || this.stored <= 0) { this._syncSatchel(); return null; }
    const p = this.player;
    // players face (-sin, -cos); entities face (+sin, +cos)
    const yaw = p.yaw + Math.PI;
    let x = p.position.x + Math.sin(yaw) * DEPLOY_DIST;
    let z = p.position.z + Math.cos(yaw) * DEPLOY_DIST;
    // If there is a wall exactly where she would go, put her at the player's
    // own feet instead — she can walk out of that, and a companion that
    // refuses to deploy because you stood too near a fence is a bad companion.
    const probe = new THREE.Vector3(x, this.world.groundHeightFor(x, z, p.position.y + 1), z);
    this.world.collision.resolveCapsule(probe, 0.30, 1.42);
    if (Math.hypot(probe.x - x, probe.z - z) > 0.1) { x = p.position.x; z = p.position.z; }

    this.stored--;
    this._syncSatchel();
    this.unit = new Companion(this.events, this.world, this.texLib, { x, z, yaw: p.yaw });
    this.scene.add(this.unit.mesh);
    this.events.emit('subtitle', {
      text: 'The escort unfolds, finds her feet, and looks at you for orders. [E] to give them.',
    });
    return this.unit;
  }

  /** Fold her back up — the PACK UP order on the dial. */
  recall() {
    if (!this.unit) return false;
    this.scene.remove(this.unit.mesh);
    this.unit.toRemove = true;
    this.unit.dispose();
    this.unit = null;
    this.stored++;
    this._syncSatchel();
    this.events.emit('companion:recalled', {});
    this.events.emit('subtitle', { text: 'She folds down small and goes back in the satchel.' });
    return true;
  }

  /** Route an order off the dial. Returns false when the dial should close. */
  command(cmd) {
    if (!this.unit) return false;
    if (cmd === 'pickup') { this.recall(); return false; }
    return this.unit.order(cmd);
  }

  /* ---------------- the arc ---------------- */

  /**
   * The bolt, as a stack of short segments jittered off the straight line —
   * which is what makes it read as electricity rather than as a laser. It
   * lives for a sixth of a second and is rebuilt from scratch each time,
   * because at that lifetime nothing is worth pooling.
   */
  _drawArc({ from, to }) {
    const pts = [];
    const N = 9;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // a consistent perpendicular to kick the segments sideways along
    const px = -dz / len, pz = dx / len;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const spread = Math.sin(t * Math.PI) * 0.35;      // pinned at both ends
      const j = (Math.random() - 0.5) * spread;
      const k = (Math.random() - 0.5) * spread;
      pts.push(new THREE.Vector3(
        from.x + dx * t + px * j,
        from.y + dy * t + k,
        from.z + dz * t + pz * j,
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0x9ff0ff, transparent: true, opacity: 0.95, fog: false,
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 5;
    this.scene.add(line);
    this._arcs.push({ line, geo, mat, t: ARC_LIFE });
  }

  /* ---------------- frame ---------------- */

  update(dt, ctx) {
    if (this.unit) this.unit.update(dt, ctx);
    for (let i = this._arcs.length - 1; i >= 0; i--) {
      const a = this._arcs[i];
      a.t -= dt;
      if (a.t <= 0) {
        this.scene.remove(a.line);
        a.geo.dispose(); a.mat.dispose();
        this._arcs.splice(i, 1);
      } else {
        a.mat.opacity = 0.95 * (a.t / ARC_LIFE);
      }
    }
  }

  /** Wipe her — a checkpoint rollback or a new run. */
  reset({ keepStored = false } = {}) {
    if (this.unit) {
      this.scene.remove(this.unit.mesh);
      this.unit.toRemove = true;
      this.unit.dispose();
      this.unit = null;
    }
    for (const a of this._arcs) { this.scene.remove(a.line); a.geo.dispose(); a.mat.dispose(); }
    this._arcs.length = 0;
    if (!keepStored) this.stored = 0;
    this._syncSatchel();
  }

  /** Freeze her for a checkpoint / the save. */
  snapshot() {
    return {
      stored: this.stored,
      out: this.unit ? {
        x: this.unit.position.x, z: this.unit.position.z, yaw: this.unit.yaw,
        posture: this.unit.posture, rules: this.unit.rules,
        post: { ...this.unit.post },
      } : null,
    };
  }

  /** Put her back exactly as she was, orders and all. */
  restore(snap) {
    if (!snap) return;
    this.reset();
    this.stored = Math.max(0, snap.stored | 0);
    this._syncSatchel();
    if (snap.out) {
      const u = new Companion(this.events, this.world, this.texLib, snap.out);
      u.posture = snap.out.posture || 'follow';
      u.rules = snap.out.rules || 'attack';
      u.post = snap.out.post || { x: snap.out.x, z: snap.out.z };
      this.scene.add(u.mesh);
      this.unit = u;
    }
  }
}
