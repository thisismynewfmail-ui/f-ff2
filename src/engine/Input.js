import { DEFAULT_BINDINGS } from './KeyBindings.js';

/**
 * Keyboard + mouse input with pointer lock.
 *
 * Exposes edge-triggered presses (wasPressed) and level state (isDown),
 * accumulated mouse deltas per frame, and wheel/weapon-slot events. Gameplay
 * reads movement/actions through the re-bindable action layer (isActionDown /
 * wasActionPressed), so a key or extra mouse button set in Settings takes
 * effect immediately. Falls back gracefully when pointer lock is unavailable
 * (e.g. headless test runs): the game still receives key events.
 */
const ALWAYS_PREVENT = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab']);

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    // Five slots so the back/forward thumb buttons (MOUSE4 / MOUSE5) can be
    // bound as well as the usual three.
    this.mouseDown = [false, false, false, false, false];
    this.mousePressed = [false, false, false, false, false];
    this.wheelDelta = 0;
    this.pointerLocked = false;
    this.onPointerLockChange = null;
    this.suppressed = false; // true while the dev console owns the keyboard
    // Live action → code map (rebindable in Settings). Seeded with the defaults
    // so movement works before any saved settings are applied.
    this.bindings = { ...DEFAULT_BINDINGS };
    this._boundCodes = new Set(Object.values(this.bindings));

    document.addEventListener('keydown', (e) => {
      if (e.repeat || this.suppressed) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (ALWAYS_PREVENT.has(e.code) || this._boundCodes.has(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || this.suppressed) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.suppressed) return;
      if (e.button >= 3) e.preventDefault(); // stop thumb-button back/forward nav
      if (e.button < this.mouseDown.length) {
        this.mouseDown[e.button] = true;
        this.mousePressed[e.button] = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button < this.mouseDown.length) this.mouseDown[e.button] = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.element;
      this.onPointerLockChange?.(this.pointerLocked);
    });
  }

  async requestPointerLock() {
    try {
      await this.element.requestPointerLock();
    } catch {
      // Headless / denied: continue without mouse look.
    }
  }

  releasePointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Hand the keyboard/mouse to (or take it back from) an overlay UI. */
  setSuppressed(v) {
    this.suppressed = v;
    if (v) {
      this.keys.clear();
      this.pressed.clear();
      this.mouseDown = [false, false, false, false, false];
      this.mousePressed = [false, false, false, false, false];
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
  }

  /** Replace the action → code map (from Settings). Unknown actions are ignored;
   *  missing ones keep their default so the player is never left unable to move. */
  setBindings(bindings) {
    if (!bindings) return;
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this._boundCodes = new Set(Object.values(this.bindings));
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasClicked(button) { return this.mousePressed[button]; }
  isMouseDown(button) { return this.mouseDown[button]; }

  /** Level state of a bound action (its code may be a key or a mouse button). */
  isActionDown(action) {
    const code = this.bindings[action];
    if (!code) return false;
    if (code.startsWith('Mouse')) return !!this.mouseDown[+code.slice(5)];
    return this.keys.has(code);
  }

  /** Edge-triggered press of a bound action this frame. */
  wasActionPressed(action) {
    const code = this.bindings[action];
    if (!code) return false;
    if (code.startsWith('Mouse')) return !!this.mousePressed[+code.slice(5)];
    return this.pressed.has(code);
  }

  /** Consume per-frame deltas; call once at the end of each update. */
  endFrame() {
    this.pressed.clear();
    this.mousePressed = [false, false, false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
