import { DEFAULT_BINDINGS, normalizeBindings } from './KeyBindings.js';

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
// How often an outstanding pointer-lock request is retried.
const LOCK_RETRY_MS = 260;
// ...and how often while a grab is URGENT — the moment after an overlay closes,
// when the player expects to be back in the game and instead has a cursor. The
// browser may refuse for up to a second or so after an Escape (Chromium arms a
// cooldown when the user leaves a lock, and Escape grants no fresh activation
// of its own), so the only thing that helps is asking again the instant it is
// allowed rather than four times a second.
const LOCK_URGENT_RETRY_MS = 100;
// How long the faster cadence lasts. Generous, because the window it covers is
// a player standing in the street with no mouse look: every overlay in this
// game closes on Escape, Escape grants no user activation, and a browser that
// has decided to wait for one will wait as long as it likes.
const LOCK_URGENT_MS = 8000;
// How long a lock must survive before it counts as the player being back at
// the controls rather than the browser handing one over mid-refusal.
const LOCK_SETTLED_MS = 1000;
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
    this.lockWanted = false;     // the game wants the pointer (see requestPointerLock)
    this.lockReleased = true;    // ...and has explicitly given it up since
    this._lastLockTry = 0;
    this._urgentUntil = 0;       // retry hard until this timestamp (see LOCK_URGENT_MS)
    // True from an Escape the PAGE received until a lock has SURVIVED long
    // enough to count as the player being back at the controls. The browser
    // eats the Escape keydown whenever it is holding the pointer — that
    // keypress is how you leave a lock — so an Escape that reaches the page is
    // proof the pointer was already free, which makes everything that follows
    // it our own plumbing rather than the player asking to pause. Game leans
    // on this; see onPointerLockChange there.
    this.escapeGrab = false;
    this._settledTimer = null;
    this.onPointerLockChange = null;
    this.suppressed = false; // true while the dev console owns the keyboard
    // Live action → codes map (rebindable in Settings). Each action holds one
    // or two codes and either fires it. Seeded with the defaults so movement
    // works before any saved settings are applied.
    this.bindings = normalizeBindings(DEFAULT_BINDINGS);
    this._boundCodes = new Set(Object.values(this.bindings).flat());

    /**
     * Note every Escape the page actually receives — capture phase, and first,
     * because the overlays stop Escape dead in their own capture handlers and
     * this has to see it anyway.
     *
     * The reason this is worth recording: the browser EATS the Escape keydown
     * when it is holding the pointer, since that keypress is how you leave a
     * lock. So an Escape that reaches the page is proof the pointer was
     * already free — which makes any unlock that follows it our own plumbing
     * (an overlay closing and grabbing the pointer back), not the player
     * asking to pause. Game leans on exactly that; see onPointerLockChange.
     */
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.escapeGrab = true;
    }, true);

    /**
     * The one-shot grab, hung on every event that carries USER ACTIVATION.
     *
     * This is the whole recapture story, so it is worth being exact about why
     * it exists. A browser only grants pointer lock to a document holding
     * transient activation, and the HTML spec excludes Escape from the keys
     * that grant it — deliberately, so a page cannot trap you by re-locking on
     * the very key you press to get out. Every overlay in this game closes on
     * Escape. So the request made inside that keypress, and every one the pump
     * makes afterwards from a timer, has nothing behind it and is refused.
     *
     * There is no way around that and there should not be. What there is: the
     * player's NEXT gesture — the first step they take, the first shot they
     * fire, the first click anywhere — and that one does carry activation. So
     * the grab rides on all of them, unthrottled, and the pointer comes back
     * on the first thing the player does rather than on a plate asking them to
     * do something specific.
     */
    const grab = () => { if (this.lockPending) this._tryLock(true); };
    // pointerdown fires ahead of mousedown and is the earliest of the lot
    document.addEventListener('pointerdown', grab, true);
    document.addEventListener('keyup', grab, true);

    document.addEventListener('keydown', (e) => {
      // Any gesture is a chance to get an outstanding lock back — except
      // Escape, which grants no activation and would only burn a retry.
      if (!e.repeat && e.code !== 'Escape') grab();
      if (e.repeat || this.suppressed) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (ALWAYS_PREVENT.has(e.code) || this._boundCodes.has(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      // Movement is not activation, so this one stays THROTTLED: it cannot
      // redeem an outstanding request on its own, and asking sixty times a
      // second turns one refusal into a console full of them. It is here
      // because a browser that was only waiting out its own cooldown will
      // take this one, and a player with a loose cursor moves it first.
      if (this.lockPending) this._tryLock();
      if (!this.pointerLocked || this.suppressed) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (this._isMouseSpike(dx, dy)) return;
      this.mouseDX = clamp(this.mouseDX + dx, MOUSE_FRAME_CLAMP);
      this.mouseDY = clamp(this.mouseDY + dy, MOUSE_FRAME_CLAMP);
    });
    document.addEventListener('mousedown', (e) => {
      // A click is the strongest gesture there is; never throttle this one.
      const redeeming = this.lockPending;
      this._tryLock(true);
      if (this.suppressed) return;
      if (e.button >= 3) e.preventDefault(); // stop thumb-button back/forward nav
      // ...and if that click was what BOUGHT the pointer back, it is spent.
      // Passing it through as well means the player's first act on returning
      // from a menu is an accidental shot, which is a real cost in a wave.
      if (redeeming) return;
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
      // A grant that lands AFTER we gave the pointer up is the tail of a
      // request that was already in flight when the player paused. The browser
      // owes us nothing here — releasePointerLock ran while the lock did not
      // yet exist, so there was nothing for it to exit — and if this is left
      // alone the pause screen ends up sitting there with the pointer still
      // captured under it and no outstanding intent to correct it. Hand it
      // straight back; the second change event reports the real state.
      if (this.pointerLocked && this.lockReleased) { document.exitPointerLock(); return; }
      if (this.pointerLocked) {
        this.lockWanted = false;
        this._settleMouse();
        // Clear the Escape-grab on a lock that KEEPS, not on one that merely
        // arrives. Measuring the lock's length after the fact instead means
        // guessing a threshold, and a browser that dawdles over its refusal
        // walks straight through any threshold you pick.
        clearTimeout(this._settledTimer);
        this._settledTimer = setTimeout(() => {
          if (this.pointerLocked) this.escapeGrab = false;
        }, LOCK_SETTLED_MS);
      }
      this.onPointerLockChange?.(this.pointerLocked);
    });
    // A refused request is reported here on older engines. Nothing to do but
    // note the time so the pump backs off a beat before asking again.
    document.addEventListener('pointerlockerror', () => {
      this._lastLockTry = performance.now();
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

  /**
   * Ask for the pointer, and keep asking until it is given.
   *
   * A single requestPointerLock() is not enough and never was. The browser
   * refuses one outright for about a second after the USER pressed Escape to
   * leave a lock — which is precisely the situation a resume is always in,
   * because Escape is how you paused. Ask once, land inside that window, and
   * the request is dropped on the floor: the game un-pauses into a state with
   * no mouse look, no cursor, and — since Escape only ever paused by dropping
   * a lock there is no longer any of — no way back out either. That is the
   * dead end this exists to make impossible.
   *
   * So the request becomes a standing intent instead of an event. `pump()`
   * retries it a few times a second while the game wants the pointer and does
   * not have it, and the input handlers retry it on the spot whenever the
   * player does anything, since a real gesture is what the stricter engines
   * want. It stops the moment the lock lands or the game gives up wanting it.
   */
  requestPointerLock({ urgent = false } = {}) {
    // Already holding it: the request is satisfied on arrival. Leaving the
    // intent standing here would be worse than useless — Game treats a live
    // intent as "an unlock event is our own doing, ignore it", so a resume
    // that never actually lost the pointer would go on to swallow the next
    // Escape the player pressed.
    if (this.pointerLocked) { this.lockWanted = false; return; }
    this.lockWanted = true;
    this.lockReleased = false;
    if (urgent) this._urgentUntil = performance.now() + LOCK_URGENT_MS;
    this._tryLock();
  }

  releasePointerLock() {
    this.lockWanted = false;
    this.lockReleased = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** True while the game wants the pointer and the browser has not given it —
   *  what the HUD's "click to look" hint is driven from. */
  get lockPending() { return this.lockWanted && !this.pointerLocked; }


  _tryLock(force = false) {
    if (!this.lockWanted || this.pointerLocked || !this.element) return;
    const now = performance.now();
    // Throttled: a refused request logs in the console, and asking sixty times
    // a second turns one refusal into a wall of them. An urgent grab asks much
    // more often, because there the cost of waiting is the player sitting in
    // the game unable to look around.
    const gap = now < this._urgentUntil ? LOCK_URGENT_RETRY_MS : LOCK_RETRY_MS;
    if (!force && now - this._lastLockTry < gap) return;
    this._lastLockTry = now;
    try {
      const p = this.element.requestPointerLock();
      // Older engines return undefined and report failure through
      // 'pointerlockerror'; newer ones reject. Neither is an error here — the
      // pump will come back around.
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* headless / denied: the pump will try again */ }
  }

  /** Call once a frame. Only does anything while a lock is outstanding. */
  pump() {
    if (this.lockPending) this._tryLock();
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

  /** Replace the action → codes map (from Settings). Unknown actions are ignored;
   *  missing ones keep their default so the player is never left unable to move. */
  setBindings(bindings) {
    if (!bindings) return;
    this.bindings = normalizeBindings(bindings);
    this._boundCodes = new Set(Object.values(this.bindings).flat());
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasClicked(button) { return this.mousePressed[button]; }
  isMouseDown(button) { return this.mouseDown[button]; }

  /** The codes bound to an action, primary first. */
  codesFor(action) { return this.bindings[action] || []; }

  /** Level state of a bound action — EITHER of its codes, key or mouse button. */
  isActionDown(action) {
    for (const code of this.codesFor(action)) {
      if (code.startsWith('Mouse') ? this.mouseDown[+code.slice(5)] : this.keys.has(code)) return true;
    }
    return false;
  }

  /** Edge-triggered press of a bound action this frame, on either of its codes. */
  wasActionPressed(action) {
    for (const code of this.codesFor(action)) {
      if (code.startsWith('Mouse') ? this.mousePressed[+code.slice(5)] : this.pressed.has(code)) return true;
    }
    return false;
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
