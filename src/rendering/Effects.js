import * as THREE from '../../lib/three.module.js';

/**
 * Visual feedback: pooled particle systems (blood, dust), muzzle light and
 * screen shake. Particles are two THREE.Points clouds with preallocated
 * buffers — spawning recycles the oldest slot, so there is no allocation
 * (and no GC hitching) during combat.
 */
class ParticlePool {
  constructor(scene, texture, count, { size, color, gravity, drag, blending }) {
    this.count = count;
    this.gravity = gravity;
    this.drag = drag;
    this.positions = new Float32Array(count * 3).fill(-9999);
    this.velocities = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // skip culling math
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: texture, size, color, transparent: true, alphaTest: blending ? 0.01 : 0.15,
      depthWrite: false, sizeAttenuation: true, blending: blending ?? THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(pos, n, speed, upBias, lifeSec) {
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const o = idx * 3;
      this.positions[o] = pos.x + (Math.random() - 0.5) * 0.2;
      this.positions[o + 1] = pos.y + (Math.random() - 0.5) * 0.2;
      this.positions[o + 2] = pos.z + (Math.random() - 0.5) * 0.2;
      this.velocities[o] = (Math.random() - 0.5) * speed;
      this.velocities[o + 1] = Math.random() * speed * upBias;
      this.velocities[o + 2] = (Math.random() - 0.5) * speed;
      this.life[idx] = lifeSec * (0.6 + Math.random() * 0.4);
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        this.positions[o + 1] = -9999;
        continue;
      }
      this.velocities[o + 1] -= this.gravity * dt;
      const drag = Math.pow(this.drag, dt);
      this.velocities[o] *= drag;
      this.velocities[o + 2] *= drag;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
    }
    if (dirty) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * A small pool of camera-facing additive quads for one-shot flashes (the
 * exploder fireball core). Each spawn expands from a bright point and fades,
 * reading as the sprite being swallowed by the blast.
 */
class FlashPool {
  constructor(scene, texture, count, color) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: texture, color, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, age: 0, life: 1, size: 1, active: false });
    }
    this.cursor = 0;
  }

  spawn(pos, size, life) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.active = true; it.age = 0; it.life = life; it.size = size;
    it.mesh.position.set(pos.x, pos.y, pos.z);
    it.mesh.visible = true;
  }

  update(dt, camPos) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.active = false; it.mesh.visible = false; continue; }
      const s = it.size * (0.4 + t * 1.4);   // expand
      it.mesh.scale.set(s, s, 1);
      it.mat.opacity = (1 - t) * (1 - t);     // ease-out fade
      it.mesh.rotation.y = Math.atan2(camPos.x - it.mesh.position.x, camPos.z - it.mesh.position.z);
    }
  }
}

export class Effects {
  constructor(events, scene, texLib, player) {
    this.events = events;
    this.player = player;
    this.blood = new ParticlePool(scene, texLib.get('blood'), 520,
      { size: 0.22, color: 0xffffff, gravity: 12, drag: 0.2 });
    this.dust = new ParticlePool(scene, texLib.get('smoke'), 96,
      { size: 0.5, color: 0xbbb6a8, gravity: -0.4, drag: 0.12 });
    // Additive "digital" sparks for the death glitch — bright teal motes that
    // burst up and wink out, reading as the sprite breaking into data.
    this.spark = new ParticlePool(scene, texLib.get('muzzleFlash'), 220,
      { size: 0.34, color: 0x7df3d0, gravity: 3, drag: 0.05, blending: THREE.AdditiveBlending });
    // Exploder blast: a rising orange fireball (negative gravity → lofts up),
    // a billowing smoke column and a short-lived flash core.
    this.fire = new ParticlePool(scene, texLib.get('smoke'), 240,
      { size: 0.7, color: 0xffb050, gravity: -3.5, drag: 0.1, blending: THREE.AdditiveBlending });
    this.flash = new FlashPool(scene, texLib.get('muzzleFlash'), 6, 0xffa838);

    this.shake = 0;
    this.muzzleLight = new THREE.PointLight(0xffc860, 0, 14);
    scene.add(this.muzzleLight);
    // A small, short-lived muzzle glow for NPC gunfire (the Spitter's pistols).
    this.npcMuzzleLight = new THREE.PointLight(0xffd070, 0, 9);
    scene.add(this.npcMuzzleLight);
    // A short red pop of light at each death, sold alongside the gib burst.
    this.deathLight = new THREE.PointLight(0xff3524, 0, 9);
    scene.add(this.deathLight);
    // A bigger, warmer flash for exploder detonations.
    this.explosionLight = new THREE.PointLight(0xffa030, 0, 22);
    scene.add(this.explosionLight);

    events.on('zombie:hit', ({ pos }) => {
      this.blood.spawn({ x: pos.x, y: pos.y + 1.1, z: pos.z }, 7, 3.2, 0.9, 0.7);
    });
    events.on('zombie:death', ({ pos }) => {
      // Much more graphic: a wide, fast gib burst + a digital spark pop + a
      // flash of red light + a kick of screen shake.
      this.blood.spawn({ x: pos.x, y: pos.y + 1.0, z: pos.z }, 30, 7.0, 1.4, 1.0);
      this.blood.spawn({ x: pos.x, y: pos.y + 0.5, z: pos.z }, 12, 3.0, 0.4, 1.3);
      this.dust.spawn({ x: pos.x, y: pos.y + 0.4, z: pos.z }, 6, 2.0, 1.3, 0.6);
      this.spark.spawn({ x: pos.x, y: pos.y + 1.1, z: pos.z }, 22, 5.5, 1.3, 0.55);
      this.deathLight.position.set(pos.x, pos.y + 1.1, pos.z);
      this.deathLight.intensity = 14;
      this.addShake(0.03);
    });
    events.on('exploder:explode', ({ pos, radius }) => {
      // A proper fireball: an expanding flash core, a lofting fire burst, a
      // billowing smoke plume, a warm light pop and screen shake that scales
      // with how close the player is standing to the blast.
      const core = { x: pos.x, y: pos.y + 0.9, z: pos.z };
      this.flash.spawn(core, (radius || 3) * 1.15, 0.42);
      this.fire.spawn({ x: pos.x, y: pos.y + 0.8, z: pos.z }, 40, 9.0, 1.5, 0.6);
      this.dust.spawn({ x: pos.x, y: pos.y + 0.5, z: pos.z }, 24, 4.5, 1.2, 1.2);
      this.blood.spawn({ x: pos.x, y: pos.y + 0.7, z: pos.z }, 14, 6.5, 1.1, 0.7); // gib debris
      this.explosionLight.position.set(pos.x, pos.y + 1.0, pos.z);
      this.explosionLight.intensity = 30;
      const d = Math.hypot(pos.x - this.player.position.x, pos.z - this.player.position.z);
      this.addShake(Math.max(0, 0.14 * (1 - d / 16)));
    });
    events.on('barrier:explode', (b) => {
      // The border wall is blown down: a CHAIN of blasts marched along its
      // length — each a lofting fireball, a billowing dust/rubble plume and an
      // expanding flash core — plus a big warm light pop and heavy screen shake
      // that scales with how close the player is standing. Reads as the whole
      // barrier detonating and collapsing, not merely sinking.
      const len = b.length || 12;
      const n = Math.max(3, Math.min(9, Math.round(len / 6)));
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const x = b.minX + (b.maxX - b.minX) * t;
        const z = b.minZ + (b.maxZ - b.minZ) * t;
        const y = b.y + 1.2 + Math.random() * 2.4;
        this.flash.spawn({ x, y, z }, 3.4 + Math.random() * 1.4, 0.5);
        this.fire.spawn({ x, y, z }, 34, 9.5, 1.6, 0.7);
        this.dust.spawn({ x, y: b.y + 0.6, z }, 26, 5.5, 1.4, 1.5);   // rubble/dust plume
        this.dust.spawn({ x, y: b.y + 2.4, z }, 14, 3.0, 0.7, 2.0);   // lingering smoke
      }
      this.explosionLight.position.set(b.x, b.y + 2.4, b.z);
      this.explosionLight.intensity = 40;
      const d = Math.hypot(b.x - this.player.position.x, b.z - this.player.position.z);
      this.addShake(Math.max(0.05, 0.14 * (1 - d / 90)));
    });
    events.on('spitter:fire', ({ pos }) => {
      // A quick additive muzzle pop + a brief glow at the Spitter's guns.
      this.flash.spawn({ x: pos.x, y: pos.y, z: pos.z }, 0.85, 0.12);
      this.npcMuzzleLight.position.set(pos.x, pos.y, pos.z);
      this.npcMuzzleLight.intensity = 9;
    });
    events.on('impact', ({ pos }) => this.dust.spawn(pos, 4, 1.4, 1.4, 0.5));
    events.on('secret:rubble', (pos) => this.dust.spawn(pos, 30, 3, 1.2, 1.2));
    events.on('weapon:fire', ({ weapon }) => {
      this.addShake(weapon.config.kick * 0.012);
      if (!weapon.isMelee) this.flashMuzzle();
    });
    events.on('player:damage', ({ amount }) => this.addShake(Math.min(0.09, amount * 0.004)));
    events.on('zone:unlock', () => this.addShake(0.08));
    events.on('secret:bell', () => this.addShake(0.03));
  }

  addShake(amount) {
    this.shake = Math.min(0.14, this.shake + amount);
  }

  flashMuzzle() {
    const eye = this.player.eyePosition();
    const dir = this.player.lookDirection();
    this.muzzleLight.position.set(eye.x + dir.x * 1.2, eye.y + dir.y * 1.2 - 0.2, eye.z + dir.z * 1.2);
    this.muzzleLight.intensity = 18;
  }

  /** Camera-space jitter consumed by Player.applyCamera. */
  shakeOffset() {
    if (this.shake <= 0.0005) return null;
    const s = this.shake;
    return {
      x: (Math.random() - 0.5) * s * 1.6,
      y: (Math.random() - 0.5) * s * 1.6,
      z: 0,
      yaw: (Math.random() - 0.5) * s * 0.35,
      roll: (Math.random() - 0.5) * s * 0.3,
    };
  }

  update(dt, camPos) {
    this.blood.update(dt);
    this.dust.update(dt);
    this.spark.update(dt);
    this.fire.update(dt);
    if (camPos) this.flash.update(dt, camPos);
    this.shake = Math.max(0, this.shake - dt * 0.35);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 220);
    this.npcMuzzleLight.intensity = Math.max(0, this.npcMuzzleLight.intensity - dt * 90);
    this.deathLight.intensity = Math.max(0, this.deathLight.intensity - dt * 42);
    this.explosionLight.intensity = Math.max(0, this.explosionLight.intensity - dt * 60);
  }
}
