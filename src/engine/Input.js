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

/**
 * Mouse-look spike rejection.
 *
 * A pointer-locked mousemove does not always carry the player's hand. Two
 * things ride the same event and both read as "the mouse was slammed across
 * the desk":
 *
 *  1. ACQUISITION. When pointer lock engages, the browser reports the delta
 *     from wherever the cursor happened to be to the lock origin. That is an
 *     ordinary-looking mousemove of arbitrary size, and the game re-acquires
 *     lock on every click, every unpause and every alt-tab back — which is
 *     exactly why the jolt felt random rather than tied to anything.
 *  2. OUTLIERS. Chromium intermittently reports a movementX/Y computed against
 *     a stale screen coordinate, landing a single event of hundreds or
 *     thousands of pixels in the middle of otherwise normal motion.
 *
 * Neither is the player, and both used to be added straight onto the camera.
 * The guard below drops them without ever eating real input: an event is only
 * refused if it is large in absolute terms AND wildly out of scale with how
 * fast the mouse has genuinely been moving, so a hard flick escalates the
 * baseline and keeps working while an isolated jump does not.
 */
// Browsers coalesce raw mouse reports to roughly one event per frame, so even
// a hard 180° flick lands only a few hundred pixels in a single event.
const MOUSE_EVENT_CEILING = 420;
// ...and how many times the recent average an event must be to count as a jump.
const MOUSE_SPIKE_RATIO = 7;
// Seed/floor for that average, so the ratio test means something from the
// first event rather than dividing into zero.
const MOUSE_BASELINE_FLOOR = 8;
// How long after lock is acquired (or the keyboard handed back) to ignore
// motion entirely, so the acquisition delta never reaches the camera.
const LOCK_SETTLE_MS = 150;
// Final backstop on what one frame may turn the view by: 1430 px is a full
// 180° at default sensitivity, and nobody spins on the spot inside a single
// frame. The per-event guard above is what actually catches spikes; this only
// bounds the damage if one ever slips past it.
const MOUSE_FRAME_CLAMP = 1430;

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this._lockedAt = 0;          // when input last (re)started being trusted
    this._mouseBaseline = MOUSE_BASELINE_FLOOR;
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
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (this._isMouseSpike(dx, dy)) return;
      this.mouseDX = clamp(this.mouseDX + dx, MOUSE_FRAME_CLAMP);
      this.mouseDY = clamp(this.mouseDY + dy, MOUSE_FRAME_CLAMP);
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
      if (this.pointerLocked) this._settleMouse();
      this.onPointerLockChange?.(this.pointerLocked);
    });
  }

  /** Distrust mouse motion for a moment — called whenever the game (re)takes
   *  the pointer, because that is when the browser reports where the cursor
   *  used to be as though the player had moved it there. */
  _settleMouse() {
    this._lockedAt = performance.now();
    this._mouseBaseline = MOUSE_BASELINE_FLOOR;
  }

  /** See the block comment above: is this event the pointer-lock plumbing
   *  rather than the player's hand? */
  _isMouseSpike(dx, dy) {
    if (performance.now() - this._lockedAt < LOCK_SETTLE_MS) return true;
    const mag = Math.max(Math.abs(dx), Math.abs(dy));
    const limit = Math.max(MOUSE_EVENT_CEILING, this._mouseBaseline * MOUSE_SPIKE_RATIO);
    if (mag > limit) return true;
    // The average only ever learns from motion that was accepted, so a
    // rejected jump can never drag the threshold up behind itself.
    this._mouseBaseline = Math.max(
      MOUSE_BASELINE_FLOOR, this._mouseBaseline + (mag - this._mouseBaseline) * 0.25);
    return false;
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
    // Taking input back is the same hazard as acquiring lock: the cursor moved
    // while the overlay had it, and the first delta afterwards says so.
    if (!v) this._settleMouse();
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

/** Symmetric clamp to ±limit. */
function clamp(v, limit) {
  return v > limit ? limit : v < -limit ? -limit : v;
}
