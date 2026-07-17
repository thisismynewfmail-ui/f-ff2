import * as THREE from '../../lib/three.module.js';

/**
 * Day/night sky.
 *
 * Drives a slow cycle that colours the sky + fog, swings a sun and a moon
 * across the dome (the scene's single directional light follows whichever is
 * up, warm by day and cool by night), and drifts a handful of chunky clouds
 * overhead.
 *
 * Everything up there is REAL 3D geometry — low-poly, flat-shaded orbs and
 * puff clusters, not sprites — sat at a fixed distance in front of the sky
 * colour and depth-tested against the world. That is the whole point of the
 * rework: rooftops, walls and props now occlude the sun, moon and clouds
 * cleanly as they should, instead of the old sprites bleeding through solid
 * geometry. Distance fog is disabled on the sky bodies so they read as the
 * far backdrop rather than fading into the haze.
 *
 * Exposes `isDay` and `dayFactor` (0 night … 1 full day) for gameplay — the
 * cockroach uses them to decide whether to hide indoors or roam outside.
 */
const CYCLE = 600;         // seconds for a full day+night: ~5 min of day, ~5 of night
const START_PHASE = 0.22;  // begin mid-morning: sun + clouds visible at once
const SKY_DIST = 150;      // how far sun/moon sit from the camera (< camera far)
const CLOUD_ALT = 86;      // cloud altitude
const CLOUD_SPREAD = 130;  // how far clouds wander from the camera on X/Z
const CLOUD_COUNT = 9;     // "not too numerous"

const DAY_SKY = new THREE.Color(0x8fb6e0);
const NIGHT_SKY = new THREE.Color(0x0b1226);
const DUSK = new THREE.Color(0xd9884a);

export class Sky {
  constructor(renderer, _texLib) {
    this.scene = renderer.scene;
    this.fog = renderer.scene.fog;
    this.bg = renderer.scene.background;
    this.hemi = renderer.hemiLight;
    this.sun = renderer.sunLight;
    this.amb = renderer.ambLight;
    this.phase = START_PHASE;
    this._el = 1;

    // Sky bodies live in their own group that rides with the camera, so the
    // dome is effectively at infinity no matter where the player walks.
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Sun + moon: unlit low-poly orbs (self-luminous) each with a soft additive
    // halo. Depth-tested so the town occludes them at the horizon.
    this.sunMesh = this._orb(0xfff1c0, 12);
    this.sunGlow = this._glow(0xffdf8a, 24);
    this.moonMesh = this._orb(0xd2dbff, 8);
    this.moonGlow = this._glow(0x9fb0e0, 15);

    // Clouds: chunky flat-shaded puff clusters. One shared Lambert material, so
    // the same sun/moon light that lights the town also warms the clouds at
    // dawn and cools them at night — they are genuinely part of the lit scene.
    this.cloudMat = new THREE.MeshLambertMaterial({
      color: 0xeef2f6, emissive: 0x232833, flatShading: true, fog: false,
    });
    this.clouds = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = this._makeCloud();
      c.userData = {
        ox: (Math.random() - 0.5) * CLOUD_SPREAD * 2,
        oz: (Math.random() - 0.5) * CLOUD_SPREAD * 2,
        y: CLOUD_ALT + (Math.random() - 0.5) * 22,
        speed: 1.6 + Math.random() * 2.0,
      };
      this.group.add(c);
      this.clouds.push(c);
    }
  }

  /** A self-luminous low-poly orb (sun/moon body). */
  _orb(color, radius) {
    const mat = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), mat);
    this.group.add(m);
    return m;
  }

  /** A soft additive halo sphere around an orb. */
  _glow(color, radius) {
    const mat = new THREE.MeshBasicMaterial({
      color, fog: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), mat);
    this.group.add(m);
    return m;
  }

  /** A cloud: a small cluster of flattened, chunky low-poly puffs. */
  _makeCloud() {
    const g = new THREE.Group();
    const puffs = 4 + ((Math.random() * 3) | 0); // 4–6 lumps
    for (let i = 0; i < puffs; i++) {
      const r = 7 + Math.random() * 7;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), this.cloudMat);
      puff.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 16);
      puff.scale.y = 0.66; // squashed so clouds read flat, not spherical
      g.add(puff);
    }
    g.scale.setScalar(0.8 + Math.random() * 0.8);
    return g;
  }

  get isDay() { return this._el > 0; }
  get dayFactor() { return Math.max(0, Math.min(1, (this._el + 0.1) / 0.35)); }

  /** Jump straight to a time of day (0..1, 0 = sunrise, 0.25 = noon). */
  setPhase(p) { this.phase = ((p % 1) + 1) % 1; }

  update(dt, camPos) {
    this.phase = (this.phase + dt / CYCLE) % 1;
    const ang = this.phase * Math.PI * 2;          // 0 sunrise → noon → sunset → midnight
    const el = Math.sin(ang);                       // sun elevation, -1..1
    this._el = el;
    const day = this.dayFactor;

    // sun / moon directions (rise east, set west); the dome rides with the camera
    const cosEl = Math.cos(ang);
    const sunDir = new THREE.Vector3(cosEl, el, 0.35).normalize();
    const moonDir = sunDir.clone().negate();
    this._placeBody(this.sunMesh, this.sunGlow, sunDir, camPos);
    this._placeBody(this.moonMesh, this.moonGlow, moonDir, camPos);

    // fade the orbs in/out around the horizon
    const sunUp = Math.max(0, el + 0.12);
    const moonUp = Math.max(0, -el + 0.18);
    this.sunMesh.material.opacity = Math.min(1, sunUp * 3);
    this.sunGlow.material.opacity = Math.min(0.5, sunUp * 1.1);
    this.moonMesh.material.opacity = Math.min(1, moonUp * 3) * 0.95;
    this.moonGlow.material.opacity = Math.min(0.32, moonUp * 0.9);

    // sky + fog colour: night → day, with a warm band while the sun is low
    const horizon = Math.max(0, 1 - Math.abs(el) / 0.28);
    const sky = NIGHT_SKY.clone().lerp(DAY_SKY, day);
    sky.lerp(DUSK, horizon * 0.4 * Math.max(day, 0.25));
    this.bg.copy(sky);
    this.fog.color.copy(sky);

    // the directional light is the sun by day, a dim cool moon by night — and
    // it is the same light that shades the clouds, so they track the sky.
    if (el >= 0) {
      this.sun.position.copy(sunDir).multiplyScalar(100);
      this.sun.color.setRGB(0.95, 0.82 + horizon * 0.1, 0.62 - horizon * 0.15);
      this.sun.intensity = 0.35 + day * 1.0;
    } else {
      this.sun.position.copy(moonDir).multiplyScalar(100);
      this.sun.color.setRGB(0.6, 0.68, 0.9);
      this.sun.intensity = 0.28;
    }
    this.hemi.intensity = 0.4 + day * 0.85;
    this.amb.intensity = 0.32 + day * 0.55;

    // Clouds are mostly seen from below (their shadowed underside), so lift a
    // day-driven emissive floor: bright and puffy by day, dim by night, with a
    // warm push while the sun rides the horizon. Keeps them reading as sky, not
    // as dark rocks, while still catching the directional light on top.
    const ce = 0.2 + day * 0.55;
    const warm = horizon * 0.25 * Math.max(day, 0.2);
    this.cloudMat.emissive.setRGB(
      Math.min(1, ce * 0.86 + warm * 0.5),
      Math.min(1, ce * 0.9 + warm * 0.25),
      Math.min(1, ce),
    );

    // drift clouds; keep them centred on the player so the field is never bare
    for (const c of this.clouds) {
      const u = c.userData;
      u.ox += u.speed * dt;
      if (u.ox > CLOUD_SPREAD) u.ox -= CLOUD_SPREAD * 2;
      c.position.set(camPos.x + u.ox, u.y, camPos.z + u.oz);
    }
  }

  _placeBody(mesh, glow, dir, camPos) {
    mesh.position.copy(camPos).addScaledVector(dir, SKY_DIST);
    glow.position.copy(mesh.position);
  }
}
