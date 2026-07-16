import * as THREE from '../../lib/three.module.js';

/**
 * The town's quiet wrongness, and its moving parts.
 *
 * Everything here whispers rather than screams: set pieces that are only
 * wrong if you stop and think about them, sounds that arrive from directions
 * that make no spatial sense, and the handful of dynamic props (beacons,
 * windmill, playground swing, factory smoke, car alarms) that keep the dead
 * town faintly, unaccountably alive.
 *
 * Set pieces built here:
 *  - two shadows with no owners, cast against the light
 *  - an opened grave on Chapel Ridge, dirt piled the wrong side
 *  - a freestanding door in the Hollow Park grass that opens onto more grass
 *  - the hollow cottage whisper (the inner shell is built by its interior)
 *  - a downtown phone booth that rings — always from the wrong side of the
 *    street — and lets you answer
 *  - car alarms: shooting an intact parked car blinks its lights and pulls
 *    the horde to the noise (a real tactical tool)
 *  - smoke over the cold factory stack; nothing inside is burning
 *  - displaced ambience: drips, a train that has no tracks, a toll from the
 *    silent chapel bell, knocking from inside the hollow cottage
 */
const ALARM_TIME = 13;
const ALARM_NOISE_RADIUS = 60;

export class Anomalies {
  constructor(world) {
    this.w = world;
    this.events = world.events;
    this._whispered = new Set();
    this._soundTimer = 40;
    this._dingIn = -1;
    this._phone = { ringing: false, timer: 25, ringFor: 0, pulse: 0, answered: 0 };

    this._shadows();
    this._openGrave();
    this._fieldDoor();
    this._phoneBooth();
    this._carAlarms();
    this._factorySmoke();

    const hollow = world.built.get('hollowCottage');
    this._hollowPos = hollow ? { x: hollow.spec.x, y: hollow.spec.y, z: hollow.spec.z } : null;

    // The lobby call button works. Something far above acknowledges it,
    // and much later a chime arrives from a direction the shaft isn't in.
    this.events.on('elevator:call', ({ pos }) => { this._dingIn = 16 + Math.random() * 22; this._dingPos = pos; });
  }

  get player() { return this.w.game?.player; }

  _whisperOnce(id, intensity, text) {
    if (this._whispered.has(id)) return;
    this._whispered.add(id);
    this.events.emit('whisper', { intensity });
    if (text) this.events.emit('subtitle', { text });
  }

  /* ---------------- set pieces ---------------- */

  /** Shadows with no owners. The sun is west; these disagree. */
  _shadows() {
    // a tree's shadow on the open Eastgate field — the nearest tree is far away
    this.w._decal('shadowDecal', 121, 28, 4.2, 2.1, 0x1c2026);
    // a long figure-thin shadow across the industrial yard, pointing at the sun
    const mat = new THREE.MeshLambertMaterial({
      map: this.w.texLib.get('shadowDecal'), transparent: true, depthWrite: false, color: 0x14161c,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5.2), mat);
    q.rotation.set(-Math.PI / 2, 0, 0.9);
    q.position.set(18, this.w.terrain.heightAt(18, 173) + 0.09, 173);
    q.renderOrder = 2;
    this.w.group.add(q);
  }

  /** One grave on the ridge stands open. The dirt is piled on the downhill
   *  side, as if it was moved from inside. */
  _openGrave() {
    const x = -207, z = -188;
    const y = this.w.terrain.heightAt(x, z);
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.3),
      new THREE.MeshLambertMaterial({ color: 0x08080a }));
    pit.rotation.set(-Math.PI / 2, 0, 0.06);
    pit.position.set(x, y + 0.07, z);
    pit.renderOrder = 2;
    this.w.group.add(pit);
    const mound = this.w.kit.box(1.1, 0.5, 1.9, 'dirt');
    mound.position.set(x + 1.4, y + 0.2, z + 0.2);
    mound.rotation.y = 0.15;
    this.w.group.add(mound);
    const stone = this.w.kit.box(0.7, 1.1, 0.2, 'brickGray');
    stone.position.set(x, y + 0.42, z - 1.35);
    stone.rotation.z = 0.34; // leaning hard, roots gone
    this.w.group.add(stone);
  }

  /** A door standing alone in the park grass. It opens. That's all. */
  _fieldDoor() {
    const x = -172, z = 55;
    const y = this.w.terrain.heightAt(x, z);
    const g = new THREE.Group();
    for (const sx of [-0.62, 0.62]) {
      const post = this.w.kit.box(0.16, 2.35, 0.16, 'wallWood');
      post.position.set(sx, 1.17, 0);
      g.add(post);
    }
    const lintel = this.w.kit.box(1.5, 0.16, 0.16, 'wallWood');
    lintel.position.y = 2.4;
    g.add(lintel);
    this._doorPivot = new THREE.Group();
    this._doorPivot.position.set(-0.52, 0, 0);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.2),
      this.w.kit.mat('doorWood', { side: THREE.DoubleSide }));
    leaf.position.set(0.5, 1.12, 0);
    this._doorPivot.add(leaf);
    g.add(this._doorPivot);
    g.position.set(x, y, z);
    g.rotation.y = 0.45;
    this.w.group.add(g);
    this._doorOpen = false;
    this._doorPos = { x, y, z };
    for (const sx of [-0.62, 0.62]) { // the posts are real enough to lean on
      this.w.collision.addBoxCentered(x + sx * Math.cos(0.45), y + 1.1, z - sx * Math.sin(0.45), 0.14, 1.1, 0.14, 'prop');
    }
    this.w.addInteractable({
      x, z, y, radius: 2.2,
      prompt: () => (this._doorOpen ? 'Close the door [E]' : 'Open the door [E]'),
      onInteract: () => {
        this._doorOpen = !this._doorOpen;
        this.events.emit('anomaly:sound', { kind: 'creak', pos: this._doorPos });
        if (this._doorOpen) {
          this._whisperOnce('fieldDoor', 0.7, 'It opens onto the same field. Somehow that is worse.');
        }
      },
    });
  }

  /** The phone booth outside the library. It rings for you specifically. */
  _phoneBooth() {
    const booth = this.w.phoneBoothPos;
    if (!booth) return;
    this.w.addInteractable({
      x: booth.x, z: booth.z, y: booth.y, radius: 2.4,
      prompt: 'Answer the phone [E]',
      enabled: () => this._phone.ringing,
      onInteract: () => {
        const ph = this._phone;
        ph.ringing = false;
        ph.timer = 150 + Math.random() * 180;
        this.events.emit('phone:answer', {});
        const lines = [
          'Breathing. It matches yours exactly.',
          'A voice counts down from six. The line dies at three.',
          'Static. Under it, your own voice, asking who is there.',
        ];
        this.events.emit('subtitle', { text: lines[ph.answered % lines.length] });
        ph.answered++;
        this.events.emit('whisper', { intensity: 0.9 });
      },
    });
  }

  /** Intact cars whose alarms still have battery. Shoot one to ring the
   *  dinner bell — every zombie in earshot converges on it, not you. */
  _carAlarms() {
    for (const car of this.w.alarmCars ?? []) {
      car.alarm = 0;
      car.chirpT = 0;
      this.w.addShootable({
        x: car.x, y: car.y + 0.8, z: car.z, r: 2.1,
        onHit: () => {
          if (car.alarm <= 0) { car.alarm = ALARM_TIME; car.chirpT = 0; }
          else car.alarm = Math.max(car.alarm, 5);
          // no return value: the car stays shootable forever
        },
      });
    }
  }

  /** Thin smoke stands over the factory stack. The factory has been cold for
   *  years; the smoke does not care about the wind. */
  _factorySmoke() {
    this._smoke = [];
    const sx = -118, sz = 208;
    const top = this.w.terrain.heightAt(sx, sz) + 15.5;
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshLambertMaterial({
        map: this.w.texLib.get('smoke'), transparent: true, depthWrite: false,
        opacity: 0, side: THREE.DoubleSide,
      });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
      q.position.set(sx, top, sz);
      q.renderOrder = 3;
      this.w.group.add(q);
      this._smoke.push({ q, mat, phase: i / 3, baseY: top, x: sx, z: sz });
    }
  }

  /* ---------------- per-frame ---------------- */

  update(dt, time, camPos) {
    const p = this.player;

    // door leaf swings to its target; left alone, the field closes it again
    if (this._doorPivot) {
      if (this._doorOpen && p && Math.hypot(p.position.x - this._doorPos.x, p.position.z - this._doorPos.z) > 18) {
        this._doorOpen = false;
      }
      const target = this._doorOpen ? -1.9 : 0;
      this._doorPivot.rotation.y += (target - this._doorPivot.rotation.y) * Math.min(1, dt * 2.4);
    }

    // playground: one swing keeps a slow arc no wind explains; its twin hangs dead
    const swings = this.w.playgroundSwings;
    if (swings?.length && camPos) {
      const dx = swings[0].parent.position.x - camPos.x, dz = swings[0].parent.position.z - camPos.z;
      if (dx * dx + dz * dz < 14400) {
        swings[0].rotation.x = Math.sin(time * 1.05) * 0.3 * (0.55 + 0.45 * Math.sin(time * 0.037));
        swings[1].rotation.x = 0.03;
      }
    }

    for (const r of this.w.windmillRotors ?? []) r.rotation.z += dt * 0.8;

    for (const b of this.w.beacons ?? []) {
      b.mesh.visible = ((time * 0.5 + b.phase) % 1) < 0.15;
    }

    // factory smoke: rise, spread, fade, repeat — camera-faced quads
    for (const s of this._smoke) {
      const t = (time * 0.08 + s.phase) % 1;
      s.q.position.y = s.baseY + t * 8;
      const sc = 0.8 + t * 2.0;
      s.q.scale.set(sc, sc, sc);
      s.mat.opacity = 0.14 * Math.sin(Math.PI * t);
      if (camPos) s.q.rotation.y = Math.atan2(camPos.x - s.x, camPos.z - s.z);
    }

    // car alarms
    for (const car of this.w.alarmCars ?? []) {
      if (car.alarm <= 0) continue;
      car.alarm -= dt;
      const on = car.alarm > 0;
      for (const l of car.lights) l.visible = on && Math.sin(time * 11) > 0;
      if (!on) continue;
      car.chirpT -= dt;
      if (car.chirpT <= 0) {
        car.chirpT = 1.7;
        const pos = { x: car.x, y: car.y + 0.8, z: car.z };
        this.events.emit('car:alarm', { pos });
        this.events.emit('noise', { pos, radius: ALARM_NOISE_RADIUS });
      }
    }

    if (!p) return;
    const px = p.position.x, pz = p.position.z;

    // phone booth ring cycle
    {
      const ph = this._phone;
      const booth = this.w.phoneBoothPos;
      if (booth) {
        const near = Math.hypot(px - booth.x, pz - booth.z) < 28;
        if (!ph.ringing) {
          if (near) ph.timer -= dt;
          if (ph.timer <= 0) { ph.ringing = true; ph.ringFor = 15; ph.pulse = 0; }
        } else {
          ph.ringFor -= dt;
          ph.pulse -= dt;
          if (ph.pulse <= 0) {
            ph.pulse = 3.0;
            this.events.emit('phone:ring', { pos: booth });
          }
          if (ph.ringFor <= 0 || !near) {
            if (ph.ringFor <= 0) ph.timer = 120 + Math.random() * 150;
            ph.ringing = ph.ringFor > 0 && near;
          }
        }
      }
    }

    // the hollow cottage: stand in the room that is too small, and know it
    if (this._hollowPos && Math.hypot(px - this._hollowPos.x, pz - this._hollowPos.z) < 2.4
        && Math.abs(p.position.y - this._hollowPos.y) < 2.5) {
      this._whisperOnce('hollow', 0.8, 'The room is smaller than the house.');
    }

    // the elevator answers, eventually, from the wrong direction
    if (this._dingIn > 0) {
      this._dingIn -= dt;
      if (this._dingIn <= 0 && this._dingPos) {
        this.events.emit('anomaly:sound', { kind: 'ding', pos: this._dingPos });
      }
    }

    // displaced ambience: rare, regional, always from the wrong side
    this._soundTimer -= dt;
    if (this._soundTimer <= 0) {
      this._soundTimer = 50 + Math.random() * 70;
      this._displacedTick(px, pz);
    }
  }

  _displacedTick(px, pz) {
    if (Math.hypot(px + 150, pz - 85) < 45) {
      // water drips over the open pond — above it, behind you, somewhere
      this.events.emit('anomaly:sound', { kind: 'drip', pos: { x: -150, y: 0, z: 85 } });
    } else if (px > -140 && px < 40 && pz > -235 && pz < -60) {
      // a train crosses downtown; the town has never had tracks
      const a = Math.random() * Math.PI * 2;
      this.events.emit('anomaly:sound', { kind: 'train', pos: { x: px + Math.sin(a) * 55, y: 0, z: pz + Math.cos(a) * 55 } });
    } else if (this.w.bellWorld && Math.hypot(px + 195, pz + 198) < 55) {
      // the chapel bell tolls once. You can see it. It is not moving.
      this.events.emit('anomaly:sound', { kind: 'toll', pos: this.w.bellWorld });
    } else if (this._hollowPos && Math.hypot(px - this._hollowPos.x, pz - this._hollowPos.z) < 30
        && Math.hypot(px - this._hollowPos.x, pz - this._hollowPos.z) > 6) {
      // three knocks from inside the cottage. From inside the INNER walls.
      this.events.emit('anomaly:sound', { kind: 'knock', pos: this._hollowPos });
    } else {
      this._soundTimer = 25; // nothing nearby worth being wrong about; retry sooner
    }
  }
}
