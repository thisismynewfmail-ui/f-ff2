import * as THREE from '../../lib/three.module.js';
import { buildWeaponModel } from '../weapons/WeaponModels.js';
import { WEAPON_CONFIGS } from '../weapons/WeaponConfigs.js';
import { buildSentryModel } from './SentryModel.js';
import { buildSentryTwoModel, poseTwoFolded } from './SentryTwoModel.js';

/**
 * First-person 3D weapon viewmodel.
 *
 * Owns a private overlay scene + camera (drawn on top of the world by the
 * Renderer with the depth buffer cleared, so the weapon never clips through
 * geometry and is untouched by fog). Builds a 3D rig for every weapon and
 * drives all of its animation procedurally:
 *
 *   - gait bob synced to the player's stride + look-sway lag + idle breathing
 *   - a three-phase fire recoil (windup → kickback → recovery) scaled by the
 *     weapon's weight, plus the rig's own part motion (slides, bolts, rotors)
 *   - full reload choreography (mag drops, break-open, bolt cycle); a rig can
 *     supply its own whole-weapon reload pose (the shotgun pulls in and down
 *     so its upward barrel break stays in frame)
 *   - ejected brass: a pooled debris system throws casings / spent shells /
 *     dropped magazines from a rig-declared port, timed by the rig (a pistol
 *     ejects on every shot, the coachgun throws both shells when it breaks
 *     open, the sniper ejects when the bolt comes back mid-cycle)
 *   - melee swings with real anticipation: horizontal cuts that alternate
 *     forehand / backhand (head sweeping right-to-left first), and a charged
 *     overhead slam
 *   - equip raise / unequip lower with smooth interpolation on weapon switch
 *   - a 3D muzzle flash (additive sprite + cone + point light) at the barrel
 *   - hides entirely while the sniper scope is up or the game isn't playing
 *
 * Interface mirrors the old sprite ViewModel: update(dt, player, weaponMgr).
 */
/**
 * How much of the sky the weapon's metals reflect: a floor that never goes out
 * (a lens and a bright receiver both keep a little life at night) plus the part
 * that rises and falls with the daylight.
 */
const ENV_BASE = 0.10;
const ENV_DAY = 0.42;

/** Where a carried deployable sits in the first-person frame at rest. */
const HELD_REST = { pos: new THREE.Vector3(0.11, -0.15, -0.46), rot: [0.30, 0.55, 0.05] };

export class WeaponView {
  constructor(events, renderer, texLib) {
    this.events = events;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, renderer.camera.aspect, 0.01, 12);
    this.camera.position.set(0, 0, 0);

    this.root = new THREE.Group();     // toggled with game state / scope
    this.scene.add(this.root);

    this._lighting();
    this._environment();

    // Build every weapon rig once; show one at a time.
    this.rigs = {};
    for (const cfg of WEAPON_CONFIGS) {
      const rig = buildWeaponModel(cfg.id);
      rig.group.visible = false;
      this.root.add(rig.group);
      this.rigs[cfg.id] = rig;
    }
    this.currentId = null;

    this._buildFlash(texLib);
    this._buildDebris();
    this._buildHeldItem(texLib);

    // animation state
    this.t = 0;
    this.equip = 1;          // 1 = lowered/away, 0 = in position
    this.swapTo = null;
    this.fireT = -1;         // <0 = not firing
    this.fireDur = 0.2;
    this.isMelee = false;
    this.alt = false;
    this.swingSide = 1;      // alternating melee cut: +1 = right-to-left
    this.swayX = 0; this.swayY = 0;
    this._lastYaw = 0; this._lastPitch = 0;
    this.scoped = false;
    this.playing = false;    // set from 'state:change'; see _syncVisible
    this.reloadEnv = 0;
    this._reloadF = 0;       // previous frame's reload fraction (eject timing)
    this._ejectTimers = [];  // scheduled debris throws

    renderer.setOverlay(this.scene, this.camera);
    this._wire();
  }

  /**
   * The viewmodel's light rig.
   *
   * The overlay is its own scene, so it needs its own lights — but they are
   * NOT independent of the world's. They are driven every frame from the same
   * sun, hemisphere and ambient the town is lit by (see _syncLighting), which
   * is the whole point: the gun in your hands is in the same place you are.
   * Left static, it read as a studio product shot pasted over the game, lit
   * from the same angle at midnight as at noon.
   *
   * What is set here is only the rig's SHAPE — which light does what, and
   * where the ones that do not follow the sun sit. Every colour and intensity
   * below is a placeholder overwritten on the first frame.
   */
  _lighting() {
    const hemi = new THREE.HemisphereLight(0xe0e8f5, 0x3a3428, 1.3);
    this.scene.add(hemi);
    // The key IS the sun (or the moon): _syncLighting swings it to wherever
    // the sky has put it, transformed into the overlay's own view space.
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    key.position.set(-0.5, 0.9, 0.7); this.scene.add(key);
    // A fixed cool rim off the far shoulder, carrying the sky's colour.
    const rim = new THREE.DirectionalLight(0xa0b6d8, 1.4);
    rim.position.set(0.8, 0.3, -0.6); this.scene.add(rim);
    // Fill from below-right: the bounce off the player's own body and the
    // ground. This is also the allowance that keeps the weapon READABLE when
    // the sun is behind you or it is the middle of the night — it is the one
    // light with a floor under it, because a gun you cannot see is a HUD you
    // cannot read, and that is worse than a lighting inconsistency.
    const fill = new THREE.PointLight(0xffd8a0, 4, 5, 2);
    fill.position.set(0.5, -0.3, 0.6); this.scene.add(fill);
    const amb = new THREE.AmbientLight(0x606a7a, 0.55);
    this.scene.add(amb);
    this.lights = { hemi, key, rim, fill, amb };
    this._sunDir = new THREE.Vector3();
    this._qInv = new THREE.Quaternion();
    this._warmFill = new THREE.Color(0xffd8a0);
  }

  /**
   * Put the viewmodel under the world's sky.
   *
   * The world's sun/moon direction is in WORLD space and the overlay scene is
   * drawn by a camera fixed at the origin, so the direction is rotated by the
   * inverse of the world camera's orientation to land in the overlay's space.
   * That is what makes the highlight travel across the receiver as you turn on
   * the spot, instead of being painted on.
   *
   * Every intensity is a multiple of the world's own, so the rig cannot drift
   * out of step with the town again: change the day/night curve in Sky.js and
   * the weapon follows.
   */
  _syncLighting() {
    const L = this.lights;
    if (!L) return;
    const r = this.renderer;
    const sun = r.sunLight, hemi = r.hemiLight, amb = r.ambLight;
    if (!sun || !hemi || !amb) return;
    const day = Math.max(0, Math.min(1, r.daylight ?? 1));

    // The key light, swung to wherever the sky put the sun.
    this._qInv.copy(r.camera.quaternion).invert();
    this._sunDir.copy(sun.position).normalize().applyQuaternion(this._qInv);
    L.key.position.copy(this._sunDir).multiplyScalar(6);
    L.key.color.copy(sun.color);
    // Every multiplier below is chosen so that at FULL DAYLIGHT the rig lands
    // back on the brightness it was originally authored at. What changes is not
    // how bright the weapon is at noon — that was right — but that it now falls
    // away with the sun instead of staying at noon all night. Cutting the
    // daylight diffuse as well would only trade one wrong reading for another.
    L.key.intensity = sun.intensity * 1.78;

    L.hemi.color.copy(hemi.color);
    L.hemi.groundColor.copy(hemi.groundColor);
    L.hemi.intensity = hemi.intensity * 1.04;

    L.rim.color.copy(hemi.color);
    L.rim.intensity = hemi.intensity * 0.80;

    L.amb.color.copy(amb.color);
    L.amb.intensity = amb.intensity * 0.62 + 0.08;

    // The readability floor, and the only light that has one.
    L.fill.color.copy(amb.color).lerp(this._warmFill, day * 0.6);
    L.fill.intensity = 0.45 + amb.intensity * 3.2;

    // Reflections fall with the light. A polished receiver mirroring a bright
    // sky at midnight is the single most obvious way the old rig gave itself
    // away, and it is also most of what read as "too shiny" by day.
    this.scene.environmentIntensity = ENV_BASE + day * ENV_DAY;
  }

  /** Procedural environment so the metals get real reflections. */
  _environment() {
    try {
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      const ctx = c.getContext('2d');
      const grd = ctx.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, '#bcc6d6'); grd.addColorStop(0.45, '#8b96a8');
      grd.addColorStop(0.5, '#5f6672'); grd.addColorStop(1, '#2a2e36');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 64);
      // A soft warm patch overhead, not a lamp. The hard bright ellipse this
      // replaces was a mirror-sharp highlight on every metal part of every
      // weapon, and the brightest thing in the frame at any hour.
      const lamp = ctx.createRadialGradient(40, 18, 2, 40, 18, 26);
      lamp.addColorStop(0, 'rgba(255,247,230,0.55)');
      lamp.addColorStop(1, 'rgba(255,247,230,0)');
      ctx.fillStyle = lamp;
      ctx.beginPath(); ctx.ellipse(40, 18, 26, 15, 0, 0, Math.PI * 2); ctx.fill();
      const eq = new THREE.CanvasTexture(c);
      eq.mapping = THREE.EquirectangularReflectionMapping;
      eq.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(this.renderer.renderer);
      this.scene.environment = pmrem.fromEquirectangular(eq).texture;
      this.scene.environmentIntensity = ENV_BASE + ENV_DAY;
      pmrem.dispose(); eq.dispose();
    } catch (e) {
      // software / restricted WebGL: fall back to lights alone
    }
  }

  _buildFlash(texLib) {
    this.flash = new THREE.Group();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({
        map: texLib?.get('muzzleFlash'), color: 0xffd27a,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.flashSprite = plane;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.16, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    cone.rotation.x = -Math.PI / 2; cone.position.z = -0.08;
    this.flashCone = cone;
    this.flash.add(plane, cone);
    this.flashLight = new THREE.PointLight(0xffc860, 0, 3, 2);
    this.flash.add(this.flashLight);
    this.flash.visible = false;
    this.flashT = 0;
    this.root.add(this.flash);
  }

  /**
   * Pooled ejected-brass debris. Kinds:
   *   casing — small brass pistol/rifle case, spins fast
   *   shell  — fat red 12-bore hull with a brass head
   *   mag    — dropped box magazine, tumbles slowly
   *   clip   — spent sniper en-bloc clip, pings away
   */
  _buildDebris() {
    const geo = {
      casing: new THREE.CylinderGeometry(0.0065, 0.0065, 0.028, 6),
      shell: new THREE.CylinderGeometry(0.0095, 0.0095, 0.052, 8),
      mag: new THREE.BoxGeometry(0.04, 0.14, 0.044),
      clip: new THREE.BoxGeometry(0.02, 0.05, 0.03),
    };
    const brass = new THREE.MeshStandardMaterial({ color: 0xc09040, metalness: 0.9, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23252a, metalness: 0.8, roughness: 0.5 });
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x8c2f24, metalness: 0.1, roughness: 0.6 });
    this._debrisSpec = {
      casing: { geo: geo.casing, mat: brass, grav: 2.6, spin: 26, life: 0.9 },
      shell: { geo: geo.shell, mat: hullMat, grav: 2.4, spin: 14, life: 1.1, head: geo.casing },
      mag: { geo: geo.mag, mat: dark, grav: 3.0, spin: 5, life: 1.0 },
      clip: { geo: geo.clip, mat: brass, grav: 2.6, spin: 18, life: 0.9 },
    };
    this._debris = []; // { mesh, vel, rotVel, life }
    this._debrisPool = [];
  }

  /** Throw a piece of brass from `port` (an Object3D on the rig). `dir` is in
   *  the weapon group's local space; it inherits a bit of randomness. */
  _eject(rig, kind = 'casing', portName = 'eject', dir = [1, 0.7, 0.2], speed = 0.9) {
    const spec = this._debrisSpec[kind];
    const port = rig.anchors?.[portName] ?? rig.muzzle;
    if (!spec || !port) return;
    let d = this._debrisPool.pop();
    if (!d) {
      d = { mesh: new THREE.Mesh(spec.geo, spec.mat), vel: new THREE.Vector3(), rotVel: new THREE.Vector3() };
      this.root.add(d.mesh);
    }
    d.mesh.geometry = spec.geo; d.mesh.material = spec.mat;
    d.mesh.visible = this.root.visible;
    port.getWorldPosition(d.mesh.position);
    d.mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    const v = new THREE.Vector3(dir[0], dir[1], dir[2])
      .add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.25, (Math.random() - 0.5) * 0.3))
      .normalize().multiplyScalar(speed * (0.85 + Math.random() * 0.35));
    v.applyQuaternion(rig.group.getWorldQuaternion(new THREE.Quaternion()));
    d.vel.copy(v);
    d.rotVel.set((Math.random() - 0.5) * spec.spin, (Math.random() - 0.5) * spec.spin, (Math.random() - 0.5) * spec.spin);
    d.life = spec.life;
    d.grav = spec.grav;
    this._debris.push(d);
  }

  _updateDebris(dt) {
    for (const e of this._ejectTimers) e.t -= dt;
    for (let i = this._ejectTimers.length - 1; i >= 0; i--) {
      const e = this._ejectTimers[i];
      if (e.t <= 0) { e.fn(); this._ejectTimers.splice(i, 1); }
    }
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const d = this._debris[i];
      d.life -= dt;
      if (d.life <= 0 || d.mesh.position.y < -0.9) {
        d.mesh.visible = false;
        this._debris.splice(i, 1);
        this._debrisPool.push(d);
        continue;
      }
      d.vel.y -= d.grav * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.rotVel.x * dt;
      d.mesh.rotation.y += d.rotVel.y * dt;
      d.mesh.rotation.z += d.rotVel.z * dt;
    }
  }

  /**
   * The two-handed carry pose for a deployable.
   *
   * A sentry taken out of the satchel is a real object in the player's hands,
   * not an abstract "placement mode", so it is built here on the same overlay
   * the guns live on: cradled low and centred, tipped back so you are looking
   * at the top of the machine the way you would if you were carrying one.
   * The gun is put away while it is up (see _syncVisible), because you cannot
   * hold a rifle and a tripod at once.
   */
  _buildHeldItem(texLib) {
    this.held = new THREE.Group();
    this.held.visible = false;
    this.holdingItem = false;
    this.heldRaise = 1;                  // 1 = down/away, 0 = up in frame
    /**
     * ONE CARRY MODEL PER DEPLOYABLE, and only the one in your hands is drawn.
     *
     * Both are built here rather than swapped in on demand: they are small,
     * they are built once, and a machine that had to be assembled at the
     * moment you took it out of the bag would hitch on the frame that matters
     * most — the one where you are looking at it.
     */
    this.heldRigs = {};
    /**
     * `shrink` and `drop` are per machine, and both are about the FRAME rather
     * than about the machine: the Mk II is half again the Mk I's size in the
     * world, and carrying that ratio into a 52° lens half a metre from the eye
     * fills the top of the screen with turret. It is scaled to sit in the hands
     * the way the Mk I does — plainly the bigger, wider, twin-barrelled thing,
     * without being the whole view — and dropped to put its bulk on the same
     * line, since a folded Mk II balances higher than a folded Mk I.
     */
    const carry = (kind, rig, shrink, drop, fold) => {
      // The model already carries its world scale, so the carry copy scales it
      // DOWN from that rather than setting an absolute size — resize the
      // machine and the thing in your hands is still the same object.
      rig.group.scale.multiplyScalar(shrink);
      rig.group.position.set(0, drop, 0);
      rig.group.visible = false;
      fold(rig.parts);
      this.held.add(rig.group);
      this.heldRigs[kind] = rig;
    };
    // Folded for carrying: legs in, knees tucked, mast down — exactly how it
    // comes out of the bag. The legs only kick out once it is standing on the
    // ground, and every joint the deployed one animates is posed here, or the
    // thing in your hands is a different shape from the thing you put down.
    carry('sentry', buildSentryModel(texLib), 0.26, -0.10, (parts) => {
      for (const leg of parts.legs) {
        // Knees folded back up against the thighs — the shape a tripod packs
        // into, and the pose the deploy animation starts from.
        leg.hip.rotation.x = 0.06;
        leg.knee.rotation.x = leg.foldStow;
        leg.pad.rotation.x = -(0.06 + leg.foldStow);
        leg.ram.position.y = -0.14;
        leg.ram.scale.y = 1;
      }
      parts.mastStage.position.y = 0.09;
      parts.body.position.y = 0.10;
    });
    /**
     * The Mk II folds tighter still: legs in, jacks screwed up, spade drawn
     * right up its guide, the gun pulled back off battery, the rangefinder
     * telescoped down to a stub — and, the part that matters, THE DOORS SHUT.
     * What is in the front of this machine is not something the player is
     * shown while they are carrying it; they find it when they set it down and
     * watch it open itself.
     *
     * The pose is the rig's own, imported rather than transcribed, so the
     * thing in your hands and the thing the deploy animation starts from are
     * the same shape by construction.
     */
    carry('sentryTwo', buildSentryTwoModel(texLib), 0.140, -0.160, poseTwoFolded);
    this.heldRig = this.heldRigs.sentry;
    this.heldRigs.sentry.group.visible = true;
    // Rest pose, and it has to be INSIDE the frustum: the overlay camera is a
    // 52° lens, so at half a metre out the frame is only about 0.24 m tall
    // from the middle — park it much below that and the whole carry animation
    // plays off the bottom of the screen where nobody can see it.
    this.held.position.copy(HELD_REST.pos);
    this.held.rotation.set(...HELD_REST.rot);
    this.root.add(this.held);
  }

  /** One place decides whether the overlay draws, and what is on it. */
  _syncVisible() {
    this.root.visible = this.playing && !this.scoped;
    this.held.visible = this.holdingItem;
  }

  _wire() {
    this.events.on('state:change', ({ next }) => {
      this.playing = next === 'playing';
      this._syncVisible();
    });
    this.events.on('weapon:switch', ({ weapon }) => { this.swapTo = weapon.config.id; });
    this.events.on('weapon:fire', ({ weapon, alt }) => this._onFire(weapon, alt));
    this.events.on('weapon:reload:start', () => { this._reloadF = 0; });
    this.events.on('scope', ({ on }) => {
      this.scoped = on;
      this._syncVisible();
    });
    // A deployable came up into the hands (or went back in the bag). WHICH
    // one matters: the carry model has to be the machine you are about to put
    // down, or the preview on the ground and the thing in your hands are two
    // different products.
    this.events.on('sentry:hold', ({ on, kind }) => {
      this.holdingItem = !!on;
      if (on && kind && this.heldRigs[kind]) {
        for (const [k, rig] of Object.entries(this.heldRigs)) rig.group.visible = k === kind;
        this.heldRig = this.heldRigs[kind];
      }
      this._syncVisible();
    });
  }

  _onFire(weapon, alt) {
    this.fireT = 0;
    this.alt = !!alt;
    const rig = this.rigs[weapon.config.id];
    this.fireDur = rig ? rig.fireDuration : 0.2;
    this.isMelee = weapon.isMelee;
    if (rig) rig._both = !!alt; // shotgun double-blast fires both hammers
    if (weapon.isMelee) {
      // alternate forehand/backhand on the primary; charged is the overhead slam
      this.swingSide = alt ? 0 : -this.swingSide || 1;
      if (rig) rig._side = this.swingSide;
    }
    // rig-declared brass ejection, delayed to the moment the action opens
    const ej = rig?.eject?.onFire;
    if (ej && (!alt || ej.onAlt !== false)) {
      const n = (alt && weapon.config.alt?.shells) || ej.count || 1;
      for (let i = 0; i < n; i++) {
        this._ejectTimers.push({
          t: (ej.delay ?? 0.02) * this.fireDur + i * 0.03,
          fn: () => this._eject(rig, ej.kind ?? 'casing', ej.port, ej.dir, ej.speed),
        });
      }
    }
    if (!weapon.isMelee) {
      // muzzle flash
      const heavy = weapon.config.kick;
      this.flashT = 0.055;
      this._flashScale = (0.7 + heavy * 0.18) * (alt && weapon.config.id === 'shotgun' ? 1.5 : 1);
      this.flashLight.intensity = 4 + heavy * 1.5;
    }
  }

  _setVisible(id) {
    if (this.currentId === id) return;
    if (this.currentId && this.rigs[this.currentId]) this.rigs[this.currentId].group.visible = false;
    this.currentId = id;
    if (this.rigs[id]) this.rigs[id].group.visible = true;
  }

  update(dt, player, weaponManager) {
    this.t += dt;
    // Before anything is posed: put the rig under the world's current sky.
    // Game.update runs Sky and applyCamera ahead of this, so both the lights
    // and the camera orientation this reads are already this frame's.
    this._syncLighting();

    // keep viewmodel aspect matched to the world camera
    if (this.camera.aspect !== this.renderer.camera.aspect) {
      this.camera.aspect = this.renderer.camera.aspect;
      this.camera.updateProjectionMatrix();
    }

    // --- a deployable in the hands stows the gun entirely ---
    if (this.holdingItem) {
      this._updateHeld(dt, player);
      if (this.rigs[this.currentId]) this.rigs[this.currentId].group.visible = false;
      this._heldStowed = true;
      this.equip = 1;            // so the gun RAISES again when the hands are free
      this.flash.visible = false;
      this._updateDebris(dt);
      return;
    }
    if (this._heldStowed) {
      this._heldStowed = false;
      if (this.rigs[this.currentId]) this.rigs[this.currentId].group.visible = true;
      this.heldRaise = 1;
    }

    const weapon = weaponManager.current;
    const id = weapon.config.id;

    // --- equip / unequip on switch ---
    if (this.currentId === null) { this._setVisible(id); this.equip = 1; }
    if (this.swapTo && this.swapTo !== this.currentId) {
      // lower the old weapon away, swap at the bottom, raise the new one
      this.equip = Math.min(1, this.equip + dt * 9);
      if (this.equip >= 0.999) this._setVisible(this.swapTo);
      if (this.currentId === this.swapTo) this.swapTo = null;
    } else {
      this._setVisible(id);
      this.equip = Math.max(0, this.equip - dt * 6);
    }

    const rig = this.rigs[this.currentId];
    if (!rig) return;
    const grp = rig.group;
    const rest = rig.rest;

    // --- accumulate offsets from rest ---
    let px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0;

    // idle breathing
    py += Math.sin(this.t * 1.6) * 0.004;
    rz += Math.sin(this.t * 1.1) * 0.012;
    px += Math.cos(this.t * 0.9) * 0.003;

    // gait bob
    const bx = Math.cos(player.bobPhase) * player.bobAmp * 0.6;
    const by = Math.abs(Math.sin(player.bobPhase)) * player.bobAmp * 0.8;
    px += bx; py -= by;

    // look-sway lag
    let dYaw = player.yaw - this._lastYaw;
    let dPitch = player.pitch - this._lastPitch;
    this._lastYaw = player.yaw; this._lastPitch = player.pitch;
    // unwrap
    if (dYaw > Math.PI) dYaw -= Math.PI * 2; else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.swayX += (THREE.MathUtils.clamp(dYaw * 3, -0.12, 0.12) - this.swayX) * Math.min(1, dt * 12);
    this.swayY += (THREE.MathUtils.clamp(dPitch * 3, -0.12, 0.12) - this.swayY) * Math.min(1, dt * 12);
    px += this.swayX; py += this.swayY;
    ry += this.swayX * 0.6; rx += -this.swayY * 0.6;

    // --- live weapon state → rig (chambered shells, gauges) ---
    rig.sync?.(weapon);

    // --- part-level idle ---
    rig.idle(this.t, rig.parts);

    // --- fire recoil / swing ---
    if (this.fireT >= 0) {
      this.fireT += dt;
      const f = Math.min(1, this.fireT / this.fireDur);
      if (this.isMelee) this._applySwing(f, this.alt, this.swingSide, (o) => { px += o.px; py += o.py; pz += o.pz; rx += o.rx; ry += o.ry; rz += o.rz; });
      else this._applyRecoil(f, weapon.config.kick, (o) => { px += o.px; py += o.py; pz += o.pz; rx += o.rx; rz += o.rz; });
      rig.fire(f, rig.parts);
      if (f >= 1) this.fireT = -1;
    }

    // --- reload ---
    if (weapon.reloading) {
      const f = 1 - weapon.reloadLeft / weapon.reloadDuration;
      const env = f < 0.15 ? f / 0.15 : f > 0.8 ? (1 - f) / 0.2 : 1;
      if (rig.reloadPose) {
        const o = rig.reloadPose(env, f);
        px += o.px ?? 0; py += o.py ?? 0; pz += o.pz ?? 0;
        rx += o.rx ?? 0; ry += o.ry ?? 0; rz += o.rz ?? 0;
      } else {
        py -= env * 0.07; rx -= env * 0.18; rz += env * 0.14; pz += env * 0.05;
      }
      rig.reload(f, rig.parts, weapon.tactical);
      // rig-declared brass thrown at fixed points of the reload (break-open
      // shell ejection, dropped mags, spent clips)
      for (const e of rig.eject?.onReload ?? []) {
        if (this._reloadF < e.at && f >= e.at && !(weapon.tactical && e.fullOnly)) {
          for (let i = 0; i < (e.count ?? 1); i++) {
            this._ejectTimers.push({ t: i * 0.04, fn: () => this._eject(rig, e.kind, e.port, e.dir, e.speed) });
          }
        }
      }
      this._reloadF = f;
    } else if (rig.parts.mag) {
      rig.parts.mag.visible = true; // ensure restored
    }

    // --- equip transform ---
    const e = this.equip * this.equip;
    py -= e * 0.4; rx += e * 0.7; rz += e * 0.35; pz += e * 0.1;

    // --- compose ---
    grp.position.set(rest.position[0] + px, rest.position[1] + py, rest.position[2] + pz);
    grp.rotation.set(rest.rotation[0] + rx, rest.rotation[1] + ry, rest.rotation[2] + rz);
    grp.scale.setScalar(rest.scale ?? 1);

    // --- muzzle flash + flying brass ---
    this._updateFlash(dt, rig);
    this._updateDebris(dt);
  }

  /**
   * Carry animation for the held deployable: it comes up out of the bag, then
   * rides the player's stride. Heavier and slower than a weapon — it is an
   * armful of steel, so the bob is bigger, the sway lags further behind the
   * look, and it tips gently as if it were being kept level.
   */
  _updateHeld(dt, player) {
    this.heldRaise = Math.max(0, this.heldRaise - dt * 4.5);
    const e = this.heldRaise * this.heldRaise;
    const bx = Math.cos(player.bobPhase) * player.bobAmp * 0.9;
    const by = Math.abs(Math.sin(player.bobPhase)) * player.bobAmp * 1.2;

    let dYaw = player.yaw - this._lastYaw;
    let dPitch = player.pitch - this._lastPitch;
    this._lastYaw = player.yaw; this._lastPitch = player.pitch;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2; else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.swayX += (THREE.MathUtils.clamp(dYaw * 4, -0.16, 0.16) - this.swayX) * Math.min(1, dt * 7);
    this.swayY += (THREE.MathUtils.clamp(dPitch * 4, -0.16, 0.16) - this.swayY) * Math.min(1, dt * 7);

    const r = HELD_REST;
    this.held.position.set(
      r.pos.x + bx + this.swayX,
      r.pos.y - by + this.swayY - e * 0.34 + Math.sin(this.t * 1.3) * 0.006,
      r.pos.z + e * 0.12,
    );
    this.held.rotation.set(
      r.rot[0] + e * 0.55 - this.swayY * 0.7,
      r.rot[1] + this.swayX * 0.8 + Math.sin(this.t * 0.8) * 0.02,
      r.rot[2] + e * 0.3 + Math.sin(this.t * 1.05) * 0.015,
    );
    // It is not asleep in your hands: the pinion creeps, the optic breathes,
    // and the lamps idle amber. A folded machine that was completely inert
    // would read as a prop rather than as the thing you are about to switch on.
    const p = this.heldRig.parts;
    p.pinion.rotation.y += dt * 0.9;
    const breath = 0.42 + Math.sin(this.t * 2.1) * 0.14;
    // WHAT BREATHES DEPENDS ON WHICH MACHINE IS IN YOUR HANDS. The Mk I sees
    // through an iris of six blades; the Mk II has no iris at all — it has a
    // coincidence rangefinder, and what idles on it is the toe-in of the two
    // prism heads and the drum turning over. Same beat, different instrument,
    // so this asks the rig what it has rather than assuming.
    if (p.iris) for (const b of p.iris) b.blade.position.x = b.home * (0.35 + breath * 0.9);
    if (p.rf) {
      p.rf.headL.rotation.y = breath * 0.20;
      p.rf.headR.rotation.y = -breath * 0.20;
      p.drum.rotation.y += dt * 0.35;
    }
    p.lensMat.emissive.setRGB(0.03, 0.16, 0.11);
    p.lampMat.emissive.setRGB(0.42, 0.3, 0.05);
    for (const l of p.lamps) l.material.emissive.setRGB(0.34, 0.25, 0.04);
  }

  /** Three-phase recoil: windup, kickback, recovery. */
  _applyRecoil(f, kick, add) {
    const ks = 0.4 + kick * 0.32;
    // windup anticipation (short forward dip)
    const w = f < 0.12 ? Math.sin((f / 0.12) * Math.PI) : 0;
    // kick envelope: ramp to a peak, then ease back
    let e;
    if (f < 0.12) e = 0;
    else if (f < 0.3) e = (f - 0.12) / 0.18;
    else e = Math.max(0, 1 - (f - 0.3) / 0.7);
    e = e * e * (3 - 2 * e); // smootherstep
    add({
      px: 0,
      py: e * 0.05 * ks - w * 0.01,
      pz: e * 0.11 * ks - w * 0.025,   // +Z = back toward the player
      rx: e * 0.22 * ks - w * 0.04,    // muzzle climb (windup dips it first)
      rz: e * 0.05 * ks,
    });
  }

  /**
   * Melee swing with real anticipation. Primary swings are horizontal cuts
   * that alternate: side=+1 sweeps the head right-to-left (the natural
   * forehand for a bat held on the right), side=-1 is the backhand return.
   * Charged (alt) is an overhead slam: wind high over the shoulder, chop
   * down through centre, heavy follow-through.
   */
  _applySwing(f, charged, side, add) {
    const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }; // smoothstep
    if (charged) {
      const wind = ss(f / 0.34);                       // haul it up over the shoulder
      const chop = f < 0.34 ? 0 : ss((f - 0.34) / 0.26); // the drop
      const rec = f < 0.62 ? 0 : ss((f - 0.62) / 0.38);  // shoulder the recovery
      const drive = chop * (1 - rec);
      add({
        px: wind * 0.06 * (1 - chop) - drive * 0.02,
        py: wind * 0.24 * (1 - chop) - drive * 0.34,
        pz: wind * 0.10 * (1 - chop) + drive * 0.06 - drive * 0.22,
        rx: wind * 0.9 * (1 - chop) - drive * 1.75,    // up past vertical, then through the floor
        ry: -wind * 0.2 * (1 - chop) + drive * 0.15,
        rz: wind * 0.25 * (1 - chop) - drive * 0.2,
      });
      return;
    }
    // horizontal cut: windup pulls the head back toward the swinging side,
    // the strike whips across the view, the follow-through eases home
    const wind = ss(f / 0.22) * (1 - ss((f - 0.22) / 0.2));
    const strike = f < 0.22 ? 0 : ss((f - 0.22) / 0.3);
    const rec = f < 0.55 ? 0 : ss((f - 0.55) / 0.45);
    const sweep = strike * (1 - rec);                  // 0 → peak → home
    const cross = strike - rec * strike;               // travel across the screen
    add({
      px: side * (wind * 0.10 - cross * 0.42),
      py: -wind * 0.03 + sweep * 0.05,
      pz: wind * 0.08 + sweep * 0.10,
      rx: -sweep * 0.35,
      ry: side * (wind * 0.25 - cross * 0.9),          // yaw the head through the arc
      rz: side * (-wind * 0.45 + cross * 1.35),        // roll: head arcs over, grip under
    });
  }

  _updateFlash(dt, rig) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      rig.muzzle.getWorldPosition(this.flash.position);
      rig.muzzle.getWorldQuaternion(this.flash.quaternion);
      const sc = this._flashScale * (0.7 + Math.random() * 0.5);
      this.flashSprite.scale.setScalar(sc);
      this.flashSprite.rotation.z = Math.random() * Math.PI;
      this.flashCone.scale.setScalar(sc);
      this.flash.visible = this.root.visible;
      this.flashLight.intensity *= 0.6;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}
