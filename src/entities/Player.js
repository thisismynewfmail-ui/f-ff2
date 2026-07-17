import * as THREE from '../../lib/three.module.js';
import { Entity } from './Entity.js';

/**
 * First-person player controller.
 *
 * WASD movement, mouse look, sprint (Shift), crouch (Ctrl/C), jump (Space),
 * head bob scaled by gait, capsule collision against the world, slope
 * slowdown on steep climbs, footstep events tagged with the surface type.
 * Gameplay only — the camera object is written in applyCamera().
 */
const MOUSE_SENS = 0.0022;
const WALK_SPEED = 5.0;
const SPRINT_SPEED = 8.2;
const CROUCH_SPEED = 2.6;
const JUMP_VELOCITY = 6.8;
const GRAVITY = 20;
const EYE_STAND = 1.62;
const EYE_CROUCH = 0.95;

export class Player extends Entity {
  constructor(events, world, input) {
    super();
    this.events = events;
    this.world = world;
    this.input = input;
    this.radius = 0.38;
    this.height = 1.75;
    this.maxHealth = 100;
    this.health = 100;
    this.pitch = 0;
    this.vy = 0;
    this.grounded = true;
    this.crouching = false;
    this.sprinting = false;
    this.eyeHeight = EYE_STAND;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this._lastStepAt = 0;
    this.speedXZ = 0;
    this.zoomFactor = 1; // written by the weapon system (sniper scope)
    this.invulnTime = 0;
    // settings (title menu): look-speed multiplier + inverted vertical look
    this.sensitivity = 1;
    this.invertY = false;
    // dev-console cheats
    this.noclip = false;
    this.godMode = false;
    this.speedMult = 1;

    const s = world.playerSpawn;
    this.teleport(s.x, world.groundHeightFor(s.x, s.z, 1e9), s.z);
    this.yaw = 0; // face the square, the well and the survivor
  }

  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.vy = 0;
    this.grounded = true;
  }

  /** Forward vector matching the camera exactly (YXZ order, -Z forward). */
  lookDirection() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );
  }

  eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  update(dt) {
    const input = this.input;

    // --- look
    const sens = MOUSE_SENS * this.sensitivity / Math.sqrt(this.zoomFactor);
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));

    if (this.noclip) {
      this._flyUpdate(dt, input);
      return;
    }

    // --- gait
    this.crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
    const wantSprint = input.isDown('ShiftLeft') && !this.crouching;
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    // --- move intent (camera-relative)
    let mx = 0, mz = 0;
    if (input.isDown('KeyW')) mz += 1;
    if (input.isDown('KeyS')) mz -= 1;
    if (input.isDown('KeyA')) mx += 1;
    if (input.isDown('KeyD')) mx -= 1;
    const moving = mx !== 0 || mz !== 0;
    this.sprinting = wantSprint && mz > 0;

    let speed = (this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED) * this.speedMult;
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const rightX = -fwdZ, rightZ = fwdX;
    let dx = (fwdX * mz - rightX * mx);
    let dz = (fwdZ * mz - rightZ * mx);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;

    if (moving) {
      // Steep climbs cost speed; water is knee-deep.
      const slope = this.world.terrain.slopeAlong(this.position.x, this.position.z, dx, dz);
      if (slope > 0.3) speed /= 1 + (slope - 0.3) * 2.2;
      if (this.world.surfaceAt(this.position.x, this.position.z) === 'water') speed *= 0.55;
      this.position.x += dx * speed * dt;
      this.position.z += dz * speed * dt;
    }
    this.speedXZ = moving ? speed : 0;

    // --- vertical
    const groundY = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y);
    if (this.grounded && input.wasPressed('Space')) {
      this.vy = JUMP_VELOCITY * (this.crouching ? 0.6 : 1);
      this.grounded = false;
    }
    this.vy -= GRAVITY * dt;
    this.vy = Math.max(-30, this.vy);
    this.position.y += this.vy * dt;
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.vy = 0;
      this.grounded = true;
    } else if (this.position.y > groundY + 0.02) {
      this.grounded = false;
    }

    // --- collision
    this.world.collision.resolveCapsule(this.position, this.radius, this.height);
    this.world.clampToWorld(this.position);

    // --- head bob + footsteps
    if (moving && this.grounded) {
      const freq = this.sprinting ? 11 : this.crouching ? 5 : 8;
      const targetAmp = this.sprinting ? 0.075 : this.crouching ? 0.02 : 0.045;
      this.bobAmp += (targetAmp - this.bobAmp) * Math.min(1, dt * 8);
      const prev = this.bobPhase;
      this.bobPhase += dt * freq;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        this.events.emit('footstep', {
          surface: this.world.surfaceAt(this.position.x, this.position.z),
          sprinting: this.sprinting,
        });
      }
    } else {
      this.bobAmp += (0 - this.bobAmp) * Math.min(1, dt * 6);
    }

    if (this.invulnTime > 0) this.invulnTime -= dt;
  }

  /** Noclip: free flight, no gravity, no collision — through everything. */
  _flyUpdate(dt, input) {
    const look = this.lookDirection();
    const rightX = -look.z, rightZ = look.x; // horizontal right vector
    let vx = 0, vy = 0, vz = 0;
    if (input.isDown('KeyW')) { vx += look.x; vy += look.y; vz += look.z; }
    if (input.isDown('KeyS')) { vx -= look.x; vy -= look.y; vz -= look.z; }
    if (input.isDown('KeyA')) { vx -= rightX; vz -= rightZ; }
    if (input.isDown('KeyD')) { vx += rightX; vz += rightZ; }
    if (input.isDown('Space')) vy += 1;
    if (input.isDown('ControlLeft') || input.isDown('KeyC')) vy -= 1;
    const len = Math.hypot(vx, vy, vz);
    if (len > 1e-5) {
      const speed = (input.isDown('ShiftLeft') ? 42 : 16) * this.speedMult;
      this.position.x += (vx / len) * speed * dt;
      this.position.y += (vy / len) * speed * dt;
      this.position.z += (vz / len) * speed * dt;
    }
    this.world.clampToWorld(this.position);
    this.position.y = Math.min(140, Math.max(-30, this.position.y));
    this.vy = 0;
    this.grounded = false;
    this.crouching = false;
    this.sprinting = false;
    this.speedXZ = 0;
    this.bobAmp += (0 - this.bobAmp) * Math.min(1, dt * 6);
    if (this.invulnTime > 0) this.invulnTime -= dt;
  }

  applyCamera(camera, shakeOffset) {
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.6;
    camera.position.set(
      this.position.x + bobX * Math.cos(this.yaw) + (shakeOffset?.x ?? 0),
      this.position.y + this.eyeHeight + bobY + (shakeOffset?.y ?? 0),
      this.position.z - bobX * Math.sin(this.yaw) + (shakeOffset?.z ?? 0),
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw + (shakeOffset?.yaw ?? 0), shakeOffset?.roll ?? 0);
  }

  takeDamage(amount, fromPos = null) {
    if (!this.alive || this.invulnTime > 0 || this.godMode) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnTime = 0.25;
    this.events.emit('player:damage', { amount, health: this.health, fromPos });
    if (this.health <= 0 && this.alive) {
      this.alive = false;
      this.events.emit('player:died', {});
    }
  }

  heal(amount) {
    if (this.health >= this.maxHealth) return false;
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.events.emit('player:heal', { amount, health: this.health });
    return true;
  }

  respawn() {
    const s = this.world.playerSpawn;
    this.health = this.maxHealth;
    this.alive = true;
    this.teleport(s.x, this.world.groundHeightFor(s.x, s.z, 1e9), s.z);
  }
}
