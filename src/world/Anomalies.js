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
    this._litWindow();
    this._leaningGarden();
    this._raisedFlags();

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
    this.w._decal('shadowDecal', 18, 173, 1.1, 0.9, 0x14161c, 5.2);
  }

  /** One grave on the ridge stands open. The dirt is piled on the downhill
   *  side, as if it was moved from inside. */
  _openGrave() {
    const x = -207, z = -188;
    const y = this.w.terrain.heightAt(x, z);
    this.w.dropDecal('decal:grave', x, z, 1.3, 2.3, 0.06,
      new THREE.MeshLambertMaterial({ color: 0x08080a }));
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

  /**
   * One upstairs window in Eastgate has a television on behind it.
   *
   * There has been no power in this town for a year. The set flickers at the
   * rate a set flickers, it throws light onto the ground below it, and the
   * moment you get close enough to see into the room it stops — which is the
   * only part of it you can ever prove.
   */
  _litWindow() {
    const b = this.w.built.get('house11') ?? this.w.built.get('house09');
    if (!b) return;
    const s = b.spec;
    const x = s.x + s.w * 0.22, y = s.y + s.h - 1.1, z = s.z + s.d / 2 + 0.09;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.25),
      new THREE.MeshBasicMaterial({ map: this.w.texLib.get('tvStatic'), transparent: true, opacity: 0.9 }));
    pane.position.set(x, y, z);
    this.w.group.add(pane);
    const glow = new THREE.PointLight(0x6f86a8, 0, 11);
    glow.position.set(x, y, z + 1.2);
    this.w.group.add(glow);
    this._tv = { pane, glow, x, y, z, mat: pane.material };
  }

  /**
   * A front garden where every plant leans the same way, and it is not the
   * way the wind goes. They lean at the house.
   */
  _leaningGarden() {
    const b = this.w.built.get('house28');
    if (!b) return;
    const s = b.spec;
    for (let i = 0; i < 7; i++) {
      const a = -1.1 + i * 0.36;
      const x = s.x + Math.sin(a) * 5.2, z = s.z + s.d / 2 + 3.4 + Math.cos(a) * 1.4;
      const bush = this.w.veg.bush(this.w.group, x, z, 0.85);
      // Cancel the wind sway this bush was registered with and hold it over
      // at a fixed angle, aimed at the front door.
      const sw = this.w.veg.swayers[this.w.veg.swayers.length - 1];
      if (sw && sw.node === bush) { sw.amp = 0.004; sw.lean = -0.34 + i * 0.02; }
      bush.rotation.y = Math.atan2(s.x - x, s.z - z);
    }
  }

  /** Every mailbox on Beckon Row has its flag up. Nobody has posted anything
   *  in a year, and they were not all up yesterday. */
  _raisedFlags() {
    this._flagPosts = [];
    for (const s of this.w.buildingSpecs) {
      if (s.zone !== 1 || s.use !== 'house' || Math.abs(s.z + 44) > 4) continue;
      const flag = this.w.kit.box(0.05, 0.34, 0.16, 'trimMetal');
      flag.position.set(s.x + s.w * 0.28, s.y + 1.15, s.z + s.d / 2 + 4.4);
      this.w.group.add(flag);
      this._flagPosts.push(flag);
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
      this._doorPivot.updateMatrixWorld(true);   // see World.settle
    }

    // playground: one swing keeps a slow arc no wind explains; its twin hangs dead
    const swings = this.w.playgroundSwings;
    if (swings?.length && camPos) {
      const dx = swings[0].parent.position.x - camPos.x, dz = swings[0].parent.position.z - camPos.z;
      if (dx * dx + dz * dz < 14400) {
        swings[0].rotation.x = Math.sin(time * 1.05) * 0.3 * (0.55 + 0.45 * Math.sin(time * 0.037));
        swings[1].rotation.x = 0.03;
        swings[0].updateMatrixWorld(true);
        swings[1].updateMatrixWorld(true);
      }
    }

    for (const r of this.w.windmillRotors ?? []) {
      r.rotation.z += dt * 0.8;
      r.updateMatrixWorld(true);               // see World.settle
    }

    // The park's moving parts. Distance-culled against the camera, because
    // there is no reason to ripple a flag on the far side of the map — but
    // note that nothing here is driven by wind, weight or a hand. It simply
    // keeps going.
    if (camPos) {
      const near = (o, r) => {
        const p = o.parent ? o.parent.position : o.position;
        const dx = p.x - camPos.x, dz = p.z - camPos.z;
        return dx * dx + dz * dz < r * r;
      };
      for (const s of this.w.spinners ?? []) {
        if (near(s.node, 130)) s.node.rotation.y += dt * s.speed;
      }
      for (const f of this.w.flags ?? []) {
        if (!f.strips.length || !near(f.strips[0], 150)) continue;
        // a travelling phase down the chain reads as a wave running out of
        // the cloth; each segment inherits the one before it
        for (let i = 0; i < f.strips.length; i++) {
          f.strips[i].rotation.y = Math.sin(time * 2.1 - i * 0.8) * (0.12 + i * 0.05);
        }
      }
      for (const p of this.w.ropeSwings ?? []) {
        if (near(p, 110)) p.rotation.x = Math.sin(time * 0.82) * 0.26 * (0.6 + 0.4 * Math.sin(time * 0.041));
      }
    }

    // Open water. Two sheets drift across each other at different scales and
    // in different directions; where the two patterns cross you get a slow
    // moiré that reads as a surface moving, which a single scrolling texture
    // never does. Cheap enough to leave running everywhere.
    for (const s of [...(this.w.waterSurfaces ?? []), ...(this.w.uvDrifts ?? [])]) {
      const map = s.mat.map;
      if (!map) continue;
      map.offset.x = (map.offset.x + s.u * dt) % 1;
      map.offset.y = (map.offset.y + s.v * dt) % 1;
    }

    for (const b of this.w.beacons ?? []) {
      b.mesh.visible = ((time * 0.5 + b.phase) % 1) < 0.15;
    }

    // Every small moving prop in the town, on one pass. Culled hard against
    // the camera: a weather vane forty metres behind you costs nothing, and a
    // hundred of them costs nothing either.
    if (camPos) {
      // The town's world matrices are settled once and then left alone (see
      // World.settle), so anything this pass moves has to carry its own. The
      // in-range set is collected here and refreshed after the pass — one
      // matrix each, for the handful of props inside the gate, rather than
      // nine thousand for a town that is standing still.
      const stirred = this._stirred ??= [];
      stirred.length = 0;
      for (const a of this.w.animProps ?? []) {
        const dx = a.x - camPos.x, dz = a.z - camPos.z;
        if (dx * dx + dz * dz > 8100) continue;   // 90 m
        if (a.node) stirred.push(a.node);
        if (a.kind === 'spin') {
          a.node.rotation[a.axis] += dt * a.speed;
        } else if (a.kind === 'press') {
          // one-shot: something was pushed, and it settles back
          if (!(a.impulse > 0)) continue;
          a.impulse = Math.max(0, a.impulse - dt * a.speed);
          a.node.rotation[a.axis] = a.impulse * a.amp;
        } else if (a.kind === 'keys') {
          // A struck chord rather than one dip: the key bank goes down several
          // times, softer each time, over the whole length of the note — and
          // the candles catch while it plays, which nobody did.
          if (!(a.t > 0)) {
            if (a.lit) { for (const f of a.flames) f.material.opacity = 0; a.lit = false; }
            continue;
          }
          a.t = Math.max(0, a.t - dt);
          const fade = a.t / a.dur;                       // 1 → 0 over the phrase
          const hit = Math.max(0, Math.sin((a.dur - a.t) * a.beat));
          a.node.rotation[a.axis] = hit * hit * a.amp * fade;
          if (a.flames) {
            a.lit = true;
            const up = Math.min(1, (a.dur - a.t) * 3);    // they take a moment to catch
            const strength = up * Math.min(1, fade * 1.8);
            a.flames.forEach((f, i) => {
              // Each wick burns on its OWN beat. Two flames flickering in
              // lockstep read as one animation played twice, which is the
              // giveaway that they are decoration rather than fire — so the
              // phase, and the rates, differ per candle.
              const ph = i * 2.4;
              const flick = 0.62 + Math.sin(time * (16.1 + i * 2.7) + ph) * 0.2
                + Math.sin(time * (5.3 + i * 1.1) + ph * 1.7) * 0.18;
              f.material.opacity = strength * flick;
              f.scale.set(0.86 + flick * 0.2, 0.78 + flick * 0.45, 0.86 + flick * 0.2);
              // ...and it leans, the way a flame does off a draught nobody
              // can find in a sealed hall.
              f.rotation.z = Math.sin(time * (2.1 + i * 0.4) + ph) * 0.13 * flick;
              f.rotation.x = Math.cos(time * (1.7 + i * 0.3) + ph) * 0.09 * flick;
            });
          }
        } else if (a.kind === 'pickupGlow') {
          /**
           * Something worth walking over to, made of embers.
           *
           * Each one runs its own clock from the lining to the top of its own
           * rise and starts again, and because every clock has a different
           * rate and a different phase the cloud never repeats and never
           * pulses: what you see is a warm thing on a dark floor rather than
           * a marker blinking at you. Two things shape a run — the spark
           * curls INWARD as it climbs, so the column narrows into a wisp
           * instead of standing up like a cylinder, and it dies well before
           * the top of its own arc, so the cloud has no ceiling either.
           *
           * The brightness is written into the vertex colours rather than the
           * material, which is the only way one additive Points cloud can
           * have two dozen independent fades in one draw call.
           *
           * The lamp — the one real light here — breathes on a slow beat with
           * a faster one riding it so it never settles into a sine. Nothing
           * is quick: a pickup marker that moves at combat speed reads as a
           * hazard.
           */
          const beat = 0.62 + Math.sin(time * 1.35 + a.phase) * 0.26
            + Math.sin(time * 3.1 + a.phase * 1.7) * 0.12;
          // `fade` is written by the case as it packs itself away (see
          // World._updateWeaponCases): the light leaves WITH the thing it was
          // lighting rather than being switched off under it.
          const fade = a.fade ?? 1;
          if (a.lamp) a.lamp.intensity = (0.62 + beat * 0.72) * fade;
          if (fade <= 0) continue;
          const [sx, sz] = a.spread;
          for (let i = 0; i < a.seeds.length; i++) {
            const m = a.seeds[i];
            const k = (time * m.speed + m.phase) % 1;
            const o = i * 3;
            const pull = 1 - k * 0.62;            // curls in as it goes up
            const drift = m.curl * k * 0.16;
            a.pos[o] = m.ax * sx * pull + Math.sin(drift) * 0.09;
            a.pos[o + 1] = 0.01 + k * m.rise;
            a.pos[o + 2] = m.az * sz * pull + Math.cos(drift) * 0.09 - 0.09;
            // in over the first tenth of the run, out over the last two thirds
            const f = Math.min(1, k * 9) * (1 - k) ** 1.6 * m.warm * (0.55 + beat * 0.45) * fade;
            a.col[o] = f;
            a.col[o + 1] = f * 0.72;
            a.col[o + 2] = f * 0.34;
          }
          a.embers.geometry.attributes.position.needsUpdate = true;
          a.embers.geometry.attributes.color.needsUpdate = true;
        } else if (a.kind === 'wellwater') {
          // The sheet swells on a slow beat, and the drips off the rope land
          // in it: each ring grows from nothing to the shaft wall and fades as
          // it goes, on its own phase so no two ever leave together. The
          // bucket sways over it on a third, slower beat again.
          a.node.position.y = a.baseY + Math.sin(time * a.speed) * a.amp
            + Math.sin(time * a.speed * 2.7 + 1.1) * a.amp * 0.45;
          for (const r of a.rings) {
            const k = ((time * 0.42 + r.phase) % 2.6) / 2.6;   // 0 -> 1 per drip
            const grow = 0.14 + k * 0.86;
            r.mesh.scale.set(grow, grow, 1);
            // opens fast, dies slowly, and is gone well before it wraps
            r.mat.opacity = Math.max(0, Math.min(1, k * 6)) * (1 - k) * (1 - k) * 0.55;
          }
          if (a.bucket) {
            a.bucket.rotation.z = Math.sin(time * 0.37 + a.phase) * 0.05;
            a.bucket.rotation.x = Math.cos(time * 0.29 + a.phase) * 0.035;
          }
        } else if (a.kind === 'swing') {
          a.node.rotation[a.axis] = Math.sin(time * a.speed + a.phase) * a.amp
            * (0.6 + 0.4 * Math.sin(time * 0.043 + a.phase));   // the arc breathes, never stops
        } else {
          a.node.rotation[a.axis] = Math.sin(time * a.speed + a.phase) * a.amp
            + Math.sin(time * a.speed * 2.3 + a.phase * 1.7) * a.amp * 0.4;
        }
      }
      for (let i = 0; i < stirred.length; i++) stirred[i].updateMatrixWorld(true);
    }

    // Surfaces that move without anything moving them. Materials are shared,
    // so this is a handful of entries driving every screen in the town.
    for (const a of this.w.matAnims ?? []) {
      if (a.x !== undefined && camPos) {
        const dx = a.x - camPos.x, dz = a.z - camPos.z;
        if (dx * dx + dz * dz > 14400) continue;   // 120 m
      }
      if (a.kind === 'flip') {
        // A flipbook of static frames. Cells step in order rather than at
        // random: a dead set rolls, and a roll you can follow for a second or
        // two before it breaks up is far more like a television than noise.
        //
        // `steady` turns that off: an arcade cabinet's attract loop is a real
        // machine running its own game, so it steps one frame at a fixed beat.
        // A dropped cell there reads as the loop stuttering, not as reception.
        a.t -= dt;
        if (a.t > 0) continue;
        a.t = a.steady ? a.rate : a.rate * (0.7 + Math.random() * 0.6);
        a.frame = (a.frame + (!a.steady && Math.random() < 0.14 ? 2 : 1)) % (a.cols * a.rows);
        a.map.offset.set(
          (a.frame % a.cols) / a.cols,
          1 - (Math.floor(a.frame / a.cols) + 1) / a.rows,
        );
        // A cabinet's attract noise comes off the SAME beat that steps its
        // picture, so the machine you can hear is the machine you can see
        // doing it. Every other frame, or four cabinets in one room turn into
        // a wall of bleeping.
        if (a.sound && (a.frame & 1) === 0) {
          this.w.events.emit('arcade:attract', { pos: { x: a.x, z: a.z }, id: a.sound });
        }
      } else if (a.kind === 'tube') {
        // Strike, hold, drop out. The hold is not steady either — mains hum
        // rides on top of it at a rate you register without being able to see.
        a.t -= dt;
        if (a.t <= 0) {
          a.t = 0.09 + Math.random() * a.rate;
          a.lit = Math.random() < a.duty;
        }
        const k = a.lit ? a.hi * (0.84 + Math.sin(time * 27 + a.phase) * 0.16) : a.lo;
        a.mat.color.setRGB(a.r * k, a.g * k, a.b * k);
      } else if (a.kind === 'ember') {
        // Two beats, deliberately not harmonics of each other, so the fire
        // never settles into a loop you can hear the seam in.
        // Two beats, deliberately not harmonics of each other, so the fire
        // never settles into a loop you can hear the seam in. It flexes AROUND
        // its built size rather than shrinking from it — a flame that spends
        // most of its time at three-quarter height is a pilot light.
        const f = Math.sin(time * 6.3 + a.phase) * 0.62 + Math.sin(time * 17.1) * 0.38;
        for (let i = 0; i < a.nodes.length; i++) {
          const n = a.nodes[i];
          // each tier on its own beat, and each turning at its own rate, so the
          // ragged silhouette the low segment counts give never comes round twice
          const b = f + Math.sin(time * (9.1 + i * 4.3) + i * 2.1) * 0.3;
          n.scale.set(0.94 + b * 0.09, 0.95 + b * (0.2 - i * 0.05), 0.94 + b * 0.09);
          n.rotation.y += dt * [1.4, -2.1, 3.3][i % 3];
        }
        const heat = 0.5 + f * 0.35;                       // 0..1-ish
        a.mat.color.setRGB(1, 0.3 + heat * 0.32, 0.06 + heat * 0.16);
        if (a.light) a.light.intensity = 8 + heat * 5;
      }
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
      // While it rings, the roof lamp comes up and the handset shakes on its
      // cradle. Both die the instant it stops, whether or not you answered.
      const parts = this.w.phoneBoothParts;
      if (parts) {
        const k = ph.ringing ? 0.5 + 0.5 * Math.max(0, Math.sin(time * 9)) : 0;
        parts.lampMat.color.setRGB(0.1 + k * 0.85, 0.1 + k * 0.78, 0.09 + k * 0.5);
        parts.hook.rotation.z = ph.ringing ? Math.sin(time * 33) * 0.14 * k : 0;
      }
    }

    // The lit window. It plays while you are too far away to see into the
    // room, and stops the moment you are not — never while you are watching
    // it go out, which is what makes it impossible to be sure about.
    if (this._tv) {
      const t = this._tv;
      const d = Math.hypot(px - t.x, pz - t.z);
      const on = d > 16 && d < 90;
      t.pane.visible = on;
      t.mat.opacity = on ? 0.55 + 0.45 * Math.abs(Math.sin(time * 7.3) * Math.sin(time * 2.1)) : 0;
      t.glow.intensity = on ? 3.5 + 2.5 * Math.sin(time * 6.1) : 0;
      if (d < 24) this._whisperOnce('litWindow', 0.7, 'The set was on. There has been no power here since before you came.');
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
