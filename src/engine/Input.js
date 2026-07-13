/**
 * Keyboard + mouse input with pointer lock.
 *
 * Exposes edge-triggered presses (wasPressed) and level state (isDown),
 * accumulated mouse deltas per frame, and wheel/weapon-slot events.
 * Falls back gracefully when pointer lock is unavailable (e.g. headless
 * test runs): the game still receives key events.
 */
export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.wheelDelta = 0;
    this.pointerLocked = false;
    this.onPointerLockChange = null;
    this.suppressed = false; // true while the dev console owns the keyboard

    document.addEventListener('keydown', (e) => {
      if (e.repeat || this.suppressed) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
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
      if (e.button < 3) {
        this.mouseDown[e.button] = true;
        this.mousePressed[e.button] = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.mouseDown[e.button] = false;
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
      this.mouseDown = [false, false, false];
      this.mousePressed = [false, false, false];
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasClicked(button) { return this.mousePressed[button]; }
  isMouseDown(button) { return this.mouseDown[button]; }

  /** Consume per-frame deltas; call once at the end of each update. */
  endFrame() {
    this.pressed.clear();
    this.mousePressed = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
