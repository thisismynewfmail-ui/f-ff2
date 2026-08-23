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

/**
 * Stretched additive quads laid along a ray — an energy bolt, not a puff.
 * Each one is scaled to the distance the shot actually travelled and rolled
 * to face the camera about its own axis, so it reads as a bar of light from
 * every angle without ever being a billboard.
 */
class BoltPool {
  constructor(scene, texture, count, color) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: texture, color, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, age: 0, life: 0.1, active: false, len: 1 });
    }
    this.cursor = 0;
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  spawn(from, dir, dist) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.active = true; it.age = 0; it.life = 0.11; it.len = dist;
    // sit the quad's centre halfway along the ray and aim its +Y down it
    const cx = from.x + dir.x * dist * 0.5;
    const cy = from.y + dir.y * dist * 0.5;
    const cz = from.z + dir.z * dist * 0.5;
    it.mesh.position.set(cx, cy, cz);
    const d = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    it.mesh.quaternion.setFromUnitVectors(this._up, d);
    it.mesh.visible = true;
  }

  update(dt, camPos) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.active = false; it.mesh.visible = false; continue; }
      it.mesh.scale.set(0.34 * (1 - t * 0.5), it.len, 1);
      it.mat.opacity = 1 - t * t;
      // roll about the bolt's own axis to keep its face toward the camera
      const p = it.mesh.position;
      const look = new THREE.Vector3(camPos.x - p.x, camPos.y - p.y, camPos.z - p.z);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(it.mesh.quaternion);
      const flat = look.projectOnPlane(axis);
      if (flat.lengthSq() > 1e-6) {
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1).applyQuaternion(it.mesh.quaternion), flat.normalize());
        it.mesh.quaternion.premultiply(q);
      }
    }
  }
}

/**
 * How a district barrier is demolished (see Effects._barrierBlow). The wall
 * does not pop once and slide away: the breaching charges go up along its
 * length, the length then keeps detonating and shedding masonry for the whole
 * time it takes to fall, and the last of it lands on the street.
 */
const COLLAPSE = {
  fallback: 3.5,     // seconds, if the event carries no sink duration
  wallH: 6.2,        // ...and how far up the wall the fire climbs, if no height
  spacing: 9,        // metres of wall per opening charge...
  breach: [5, 18],   // ...clamped to this many, so no wall goes up in one puff
  rollEvery: 0.13,   // seconds between the secondary blasts that follow
  stride: 0.618,     // fraction of the length each secondary hops along
  reach: 120,        // metres over which the blast is still felt underfoot
};

export class Effects {
  constructor(events, scene, texLib, player) {
    this.events = events;
    this.player = player;
    this.blood = new ParticlePool(scene, texLib.get('blood'), 520,
      { size: 0.22, color: 0xffffff, gravity: 12, drag: 0.2 });
    // Dust/smoke. Every pool below is sized for the biggest thing that uses it,
    // which is a border wall being demolished: a dozen breaching charges go up
    // in ONE frame and the chain behind them runs for three and a half seconds,
    // so a pool with room for less than a salvo spends that frame recycling its
    // own particles and the near half of the wall never gets its explosion.
    this.dust = new ParticlePool(scene, texLib.get('smoke'), 700,
      { size: 0.5, color: 0xbbb6a8, gravity: -0.4, drag: 0.12 });
    // Masonry: the white-marble arcade itself, blown off the wall in chunks
    // that arc out and fall (real gravity, little drag — these are lumps of
    // stone, not smoke).
    this.rubble = new ParticlePool(scene, texLib.get('rubble'), 700,
      { size: 0.44, color: 0xdcd6c6, gravity: 13, drag: 0.5 });
    // ...and the column it all goes up in. Deliberately its own pool rather
    // than more of `dust`: a demolition is read from across the district by its
    // PLUME, which means particles metres across that climb slowly and hang for
    // seconds — nothing the pool that puffs under a boot ought to be doing.
    this.plume = new ParticlePool(scene, texLib.get('smoke'), 480,
      { size: 2.9, color: 0x8e8a7e, gravity: -0.9, drag: 0.25 });
    // Additive "digital" sparks for the death glitch — bright teal motes that
    // burst up and wink out, reading as the sprite breaking into data.
    this.spark = new ParticlePool(scene, texLib.get('muzzleFlash'), 220,
      { size: 0.34, color: 0x7df3d0, gravity: 3, drag: 0.05, blending: THREE.AdditiveBlending });
    // Exploder blast: a rising orange fireball (negative gravity → lofts up),
    // a billowing smoke column and a short-lived flash core.
    this.fire = new ParticlePool(scene, texLib.get('smoke'), 900,
      { size: 0.7, color: 0xffb050, gravity: -3.5, drag: 0.1, blending: THREE.AdditiveBlending });
    // Deep enough to hold a whole district's blast cores at once: unlocking a
    // zone opens every one of its segments in the same frame, and six slots
    // meant nearly all of them were recycled out of existence before they had
    // drawn a single frame.
    this.flash = new FlashPool(scene, texLib.get('muzzleFlash'), 40, 0xffa838);
    // Energy bolts get their own pool: unlike a muzzle flash these are drawn
    // ALONG the ray, stretched from the muzzle to whatever stopped them, so
    // you watch the shot cross the street instead of inferring it.
    this.bolts = new BoltPool(scene, texLib.get('muzzleFlash'), 10, 0x63c8ff);
    this.boltLight = new THREE.PointLight(0x54b4ff, 0, 16);
    scene.add(this.boltLight);

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
    // ...and a wide one of its own for a barrier demolition, which lights a
    // whole street rather than a body's worth of pavement — and, having its own
    // lamp, never has its glow cut short by an exploder going off mid-collapse.
    this.collapseLight = new THREE.PointLight(0xffb464, 0, 90);
    scene.add(this.collapseLight);
    // Border walls currently coming down, stepped in update() so the demolition
    // rolls along their length instead of landing on one frame.
    this._collapses = [];

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
    /* --- the wave-five sighting (see world/Flyby.js) ------------------- *
     * A trail, not a fireball: smoke off the gash the whole way across the
     * sky, sparks once it has properly begun to come apart, and — at the far
     * end, two hundred metres off in the haze — a flash and a column that the
     * player mostly hears rather than sees.                               */
    events.on('ufo:trail', ({ pos, k }) => {
      // The PLUME pool, not the boot-dust one: this trail has to read from a
      // hundred metres below and across a district, which is the job that pool
      // was sized for. Dust rides on top of it as the wisps coming off it.
      this.plume.spawn({ x: pos.x, y: pos.y - 0.4, z: pos.z }, 2, 1.4, 0.4, 3.2 + k * 2.2);
      this.dust.spawn({ x: pos.x, y: pos.y - 0.2, z: pos.z }, 3, 2.2, 0.5, 2.4 + k * 1.2);
      if (k > 0.3) this.fire.spawn(pos, 2, 2.4, 0.4, 0.6 + k * 0.5);
      if (k > 0.5) this.spark.spawn(pos, 3, 5.0, 0.3, 0.7);
    });
    events.on('ufo:impact', ({ pos }) => {
      const core = { x: pos.x, y: pos.y + 2, z: pos.z };
      this.flash.spawn(core, 9, 0.7);
      this.fire.spawn(core, 60, 14, 1.6, 1.3);
      this.plume.spawn({ x: pos.x, y: pos.y + 1, z: pos.z }, 40, 6, 1.5, 5.5);
      this.dust.spawn({ x: pos.x, y: pos.y + 0.6, z: pos.z }, 40, 8, 1.0, 2.6);
      this.rubble.spawn({ x: pos.x, y: pos.y + 1, z: pos.z }, 30, 12, 1.2, 2.2);
      this.collapseLight.position.set(pos.x, pos.y + 4, pos.z);
      this.collapseLight.intensity = 60;
      // Shake it only for somebody standing near enough for the ground to
      // carry it. From the plaza this is a light on the horizon and a noise.
      const d = Math.hypot(pos.x - this.player.position.x, pos.z - this.player.position.z);
      this.addShake(Math.max(0, 0.11 * (1 - d / 120)));
    });
    events.on('barrier:explode', (b) => this._barrierBlow(b));
    events.on('spitter:fire', ({ pos }) => {
      // A quick additive muzzle pop + a brief glow at the Spitter's guns.
      this.flash.spawn({ x: pos.x, y: pos.y, z: pos.z }, 0.85, 0.12);
      this.npcMuzzleLight.position.set(pos.x, pos.y, pos.z);
      this.npcMuzzleLight.intensity = 9;
    });
    events.on('impact', ({ pos }) => this.dust.spawn(pos, 4, 1.4, 1.4, 0.5));
    events.on('weapon:bolt', ({ from, dir, dist }) => {
      this.bolts.spawn(from, dir, Math.max(1.5, dist));
      this.boltLight.position.set(from.x + dir.x * 1.5, from.y + dir.y * 1.5, from.z + dir.z * 1.5);
      this.boltLight.intensity = 12;
      // a cold spark where it lands, in the bolt's own colour
      this.spark.spawn(
        { x: from.x + dir.x * dist, y: from.y + dir.y * dist, z: from.z + dir.z * dist },
        10, 3.4, 0.8, 0.4);
    });
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

  /**
   * Hold the shake AT a level rather than kicking it up by one.
   *
   * The decay is a flat rate, so topping the shake up every frame cannot park
   * it anywhere in between: any top-up below the decay rate falls to nothing and
   * any top-up above it pins the screen at the clamp. Something that rumbles for
   * seconds on end — a wall coming down — needs a floor instead, which it can
   * then lower as the thing settles.
   */
  holdShake(amount) {
    this.shake = Math.max(this.shake, Math.min(0.14, amount));
  }

  /** How hard something at (x, z) lands on the player: 1 underfoot, 0 at `reach`. */
  _proximity(x, z, reach = COLLAPSE.reach) {
    const d = Math.hypot(x - this.player.position.x, z - this.player.position.z);
    return Math.max(0, 1 - d / reach);
  }

  /**
   * A district's border wall is blown down (see Zones.unlock).
   *
   * This is a demolition, not a puff: the breaching charges go up along the
   * whole length in one salvo, the wall then keeps detonating and shedding
   * masonry for as long as it takes to sink, and the last of it slams into the
   * street. The rolling part is stepped in _stepCollapses rather than spawned
   * here, because a wall that is blown apart on frame one and then slides
   * silently into the ground for three and a half seconds reads as a wall that
   * sank — the point is that it is coming apart the whole way down.
   */
  _barrierBlow(b) {
    const c = {
      minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ,
      y: b.y, wallH: b.height || COLLAPSE.wallH,
      dur: b.duration || COLLAPSE.fallback,
      t: 0, next: 0, roll: 0,
    };
    this._collapses.push(c);
    // The charges themselves: the biggest blasts of the event, one every ~9 m
    // end to end. The count comes off the LENGTH rather than being a fixed
    // handful, because these walls run from forty metres to two hundred — five
    // charges spread over the long ones put a blast every forty metres, which
    // from the street is a wall coming down somewhere else.
    const [lo, hi] = COLLAPSE.breach;
    const len = Math.hypot(c.maxX - c.minX, c.maxZ - c.minZ);
    const n = Math.max(lo, Math.min(hi, Math.round(len / COLLAPSE.spacing)));
    for (let i = 0; i < n; i++) this._blastAt(c, i / (n - 1), 1);
    this.addShake(0.05 + this._proximity((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) * 0.14);
  }

  /**
   * Where along a wall (0..1) the player is standing — its nearest point to
   * them, which is the stretch of it they are most likely to be looking at.
   */
  _nearestU(c) {
    const dx = c.maxX - c.minX, dz = c.maxZ - c.minZ;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return 0.5;
    const u = ((this.player.position.x - c.minX) * dx
      + (this.player.position.z - c.minZ) * dz) / len2;
    return Math.max(0, Math.min(1, u));
  }

  /**
   * One detonation `u` (0..1) of the way along a collapsing wall: an expanding
   * flash core, a fireball climbing the arcade, marble blown off it in chunks,
   * and the dust of the wall grinding down at its foot. `power` scales the lot,
   * so the opening charges are an event and the secondaries that follow are the
   * wall tearing itself apart behind them.
   */
  _blastAt(c, u, power) {
    // Walk the wall's CENTRELINE, then step the charge off its near face.
    // Interpolating along the corners of the segment box instead would put the
    // blast inside two metres of solid marble, which then hides most of its own
    // fireball — the wall would flash from the inside and shed a little debris
    // out of the ends. Stepping onto the side the player is watching from puts
    // the explosion in the open where it belongs.
    const p = this.player.position;
    const thinX = c.maxX - c.minX < c.maxZ - c.minZ;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const face = (thinX ? c.maxX - c.minX : c.maxZ - c.minZ) / 2 + 1;
    let x, z;
    if (thinX) {                                   // wall runs along Z
      x = cx + (p.x >= cx ? face : -face);
      z = c.minZ + (c.maxZ - c.minZ) * u;
    } else {                                       // wall runs along X
      x = c.minX + (c.maxX - c.minX) * u;
      z = cz + (p.z >= cz ? face : -face);
    }
    const y = c.y + 0.9 + Math.random() * c.wallH * power;
    // Spend the small particles on what can actually be resolved: at two hundred
    // metres a blast is a flash and a column of smoke, and filling the buffers
    // with fire and gravel nobody can make out only recycles the particles of
    // the blast going off in front of the player.
    const near = Math.max(0.25, this._proximity(x, z, 200));
    const n = (k) => Math.max(2, Math.round(k * power * near));
    this.flash.spawn({ x, y, z }, (2.8 + Math.random() * 2.4) * (0.5 + power * 0.5), 0.46);
    this.flash.spawn({ x, y: y + 1.6 * power, z }, (1.4 + Math.random()) * power, 0.3);
    this.fire.spawn({ x, y, z }, n(30), 9.5 * power, 1.6, 0.7);
    this.rubble.spawn({ x, y: c.y + c.wallH * 0.5, z }, n(22), 11 * power, 1.0, 1.6);
    this.dust.spawn({ x, y: c.y + 0.6, z }, n(20), 5.5, 1.4, 1.6);        // debris at the foot
    // ...and the column the whole thing goes up in — the read that DOES carry
    // across a district, so it is never thinned by distance.
    this.plume.spawn({ x, y: c.y + c.wallH * 0.5, z },
      Math.max(4, Math.round(12 * power)), 4.2 * power, 1.5, 2.8);
    // One lamp for the whole collapse, and the brightest blast of the moment
    // holds it — otherwise a salvo hands it to whichever charge happened to be
    // spawned last, which is the far end of the wall as often as the near one.
    const glow = 55 * power * (0.35 + 0.65 * near);
    if (glow >= this.collapseLight.intensity) {
      this.collapseLight.position.set(x, y + 1.5, z);
      this.collapseLight.intensity = glow;
    }
    this.addShake(this._proximity(x, z) * 0.03 * power);
  }

  /**
   * Run the collapses in flight: secondary detonations hopping along each wall
   * (thinning and weakening as the last of it goes down), a held rumble
   * underfoot for as long as it is falling, and a curtain of dust punched out
   * along the whole length when the wall finally lands.
   */
  _stepCollapses(dt) {
    for (let i = this._collapses.length - 1; i >= 0; i--) {
      const c = this._collapses[i];
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      while (c.t >= c.next && k < 1) {
        c.roll += 1;
        // Every other secondary walks the length of the wall; the ones in
        // between go up in the stretch nearest the player. A two-hundred-metre
        // barrier detonating uniformly puts most of its own demolition outside
        // the field of view, and what the player gets to watch is a rumble and
        // two distant puffs.
        const u = c.roll % 2
          ? (c.roll * COLLAPSE.stride) % 1
          : Math.max(0, Math.min(1, this._nearestU(c) + (Math.random() - 0.5) * 0.4));
        this._blastAt(c, u, 0.3 + 0.45 * (1 - k));
        c.next += COLLAPSE.rollEvery * (1 + k * 1.8); // the chain thins as it falls
      }
      // the ground never stops moving while a wall is on its way down, easing
      // off as the last of it settles
      this.holdShake(0.085 * (1 - k * 0.55)
        * this._proximity((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2));
      if (c.t < c.dur) continue;
      // ...and then tonnes of marble hit the street.
      for (let j = 0; j <= 8; j++) {
        const u = j / 8;
        const x = c.minX + (c.maxX - c.minX) * u;
        const z = c.minZ + (c.maxZ - c.minZ) * u;
        this.dust.spawn({ x, y: c.y + 0.35, z }, 16, 4.6, 0.5, 2.6);
        this.plume.spawn({ x, y: c.y + 0.9, z }, 10, 3.4, 0.9, 3.2);
        this.rubble.spawn({ x, y: c.y + 0.8, z }, 8, 5.5, 0.4, 1.2);
      }
      this.addShake(0.04 + this._proximity((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) * 0.1);
      this._collapses.splice(i, 1);
    }
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
    this._stepCollapses(dt);
    this.blood.update(dt);
    this.dust.update(dt);
    this.rubble.update(dt);
    this.plume.update(dt);
    this.spark.update(dt);
    this.fire.update(dt);
    if (camPos) { this.flash.update(dt, camPos); this.bolts.update(dt, camPos); }
    this.boltLight.intensity = Math.max(0, this.boltLight.intensity - dt * 120);
    this.shake = Math.max(0, this.shake - dt * 0.35);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 220);
    this.npcMuzzleLight.intensity = Math.max(0, this.npcMuzzleLight.intensity - dt * 90);
    this.deathLight.intensity = Math.max(0, this.deathLight.intensity - dt * 42);
    this.explosionLight.intensity = Math.max(0, this.explosionLight.intensity - dt * 60);
    this.collapseLight.intensity = Math.max(0, this.collapseLight.intensity - dt * 70);
  }
}
