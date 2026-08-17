import { BINDING_ROWS, MAX_SLOTS, codeLabel } from '../engine/KeyBindings.js';

/**
 * The reusable Settings form — sliders (sensitivity / FOV / volume), invert-Y,
 * and a KEY BINDINGS list — mounted into a host element. One instance backs the
 * title-screen Settings and another backs the in-game (pause) Settings; both
 * read and write the same shared SettingsStore.
 *
 * Rebinding: every action has TWO chips, a primary and an alternate, and either
 * fires it — Shift and the mouse's thumb button can both be SPRINT. Click a
 * chip to arm capture ("PRESS A KEY…"); the next key or mouse button becomes
 * that slot's binding. BACKSPACE clears the slot (refused if it is the action's
 * last one). Pressing ESCAPE while armed CANCELS the capture and keeps the old
 * key — it never closes the menu. Capture runs on the capture phase and
 * swallows the event so the armed key can't leak into the game (or trigger the
 * host's own ESC handling).
 *
 * `footer` is a list of { label, cls, onClick } buttons the host supplies
 * (e.g. BACK on the title, APPLY + RETURN TO GAME in the pause menu).
 */
export class SettingsPanel {
  constructor(host, store, { footer = [] } = {}) {
    this.store = store;
    this.host = host;
    this._capture = null; // { action, slot, btn } while armed
    this._syncers = [];
    this._build(footer);
    this.sync(); // seed labels/values so the form reads correctly before first open
  }

  _el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    (parent || this.host).appendChild(e);
    return e;
  }

  _build(footer) {
    const panel = this._el('div', 'tm-settings-panel');
    this._el('div', 'tm-card-head', panel).textContent = 'SETTINGS';

    this._slider(panel, 'MOUSE SENSITIVITY', 'sensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2) + 'x');
    this._slider(panel, 'FIELD OF VIEW', 'fov', 70, 110, 1, (v) => v + '°');
    this._slider(panel, 'MASTER VOLUME', 'volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    this._slider(panel, 'SURFACE DETAIL', 'detail', 0, 1, 0.05,
      (v) => (v <= 0 ? 'OFF' : Math.round(v * 100) + '%'));
    this._check(panel, 'INVERT MOUSE Y', 'invertY');

    this._el('div', 'tm-set-sub', panel).textContent = 'KEY BINDINGS';
    const hint = this._el('div', 'tm-set-hint', panel);
    hint.textContent =
      'TWO KEYS PER ACTION — EITHER FIRES IT · CLICK A SLOT, THEN PRESS THE KEY OR MOUSE BUTTON'
      + ' · BKSP CLEARS · ESC CANCELS';
    const binds = this._el('div', 'tm-binds', panel);
    this.bindBtns = {};
    for (const [action, label] of BINDING_ROWS) {
      const row = this._el('div', 'tm-bind-row', binds);
      this._el('span', null, row, label);
      const slots = this._el('div', 'tm-bind-slots', row);
      this.bindBtns[action] = [];
      for (let slot = 0; slot < MAX_SLOTS; slot++) {
        const btn = this._el('button', 'tm-bind-key' + (slot ? ' alt' : ''), slots);
        btn.type = 'button';
        btn.dataset.action = action;
        btn.dataset.slot = String(slot);
        btn.addEventListener('click', () => this._arm(action, slot, btn));
        this.bindBtns[action].push(btn);
        this._syncers.push(() => {
          if (this._capture && this._capture.action === action && this._capture.slot === slot) return;
          const code = this.store.bindings[action]?.[slot];
          const text = code ? codeLabel(code) : '+';
          btn.textContent = text;
          btn.classList.toggle('long', text.length > 5);
          // An empty alternate is an invitation, not a fault; an empty PRIMARY
          // means the code was taken by something else and the action is dead
          // until it is given one, so only that one is flagged.
          btn.classList.toggle('empty', !code);
          btn.classList.toggle('unbound', !code && slot === 0);
        });
      }
    }

    const actions = this._el('div', 'tm-set-actions', panel);
    for (const b of footer) {
      const btn = this._el('button', b.cls || '', actions, b.label);
      btn.type = 'button';
      btn.addEventListener('click', (e) => b.onClick(e, btn));
    }
  }

  _slider(parent, label, key, min, max, step, fmt) {
    const row = this._el('label', 'tm-set-row', parent);
    this._el('span', null, row, label);
    const input = this._el('input', null, row);
    input.type = 'range'; input.min = min; input.max = max; input.step = step;
    const val = this._el('b', null, row);
    const show = () => { val.textContent = fmt(this.store.values[key]); };
    input.addEventListener('input', () => { this.store.setValue(key, parseFloat(input.value)); show(); });
    this._syncers.push(() => { input.value = this.store.values[key]; show(); });
  }

  _check(parent, label, key) {
    const row = this._el('label', 'tm-set-row tm-set-check', parent);
    this._el('span', null, row, label);
    const input = this._el('input', null, row);
    input.type = 'checkbox';
    this._el('b', null, row);
    input.addEventListener('input', () => this.store.setValue(key, input.checked));
    this._syncers.push(() => { input.checked = this.store.values[key]; });
  }

  /** Pull all displayed values from the store; call whenever the panel opens. */
  sync() { for (const s of this._syncers) s(); }

  isCapturing() { return !!this._capture; }

  _arm(action, slot, btn) {
    this.cancelCapture();
    this._capture = { action, slot, btn };
    btn.classList.add('capturing');
    btn.textContent = 'PRESS A KEY…';
    // Capture phase + swallow, so the armed input never reaches the game input
    // layer or the host's ESC handler.
    this._onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { this.cancelCapture(); return; }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        // Clearing a slot has to be reachable from the same armed state that
        // sets one, because there is nowhere else to put it: every key press
        // while armed is a binding by definition.
        const { action: a, slot: s } = this._capture;
        this._teardown();
        this.store.clearBinding(a, s);
        this.sync();
        return;
      }
      this._commit(e.code);
    };
    this._onMouse = (e) => {
      // Left-click is UI interaction (re-arm another row, hit a footer button),
      // never a binding — cancel and let the click act. Any OTHER button (right,
      // middle, MOUSE4/MOUSE5) is captured as the new binding, even with the
      // cursor still resting on the armed chip.
      if (e.button === 0) { this.cancelCapture(); return; }
      e.preventDefault(); e.stopPropagation();
      this._commit('Mouse' + e.button);
    };
    document.addEventListener('keydown', this._onKey, true);
    document.addEventListener('mousedown', this._onMouse, true);
  }

  _commit(code) {
    const { action, slot } = this._capture;
    this._teardown();
    this.store.setBinding(action, slot, code);
    this.sync();
  }

  /** Abort an armed capture, restoring the previous key label. */
  cancelCapture() {
    if (!this._capture) return;
    this._teardown();
    this.sync();
  }

  _teardown() {
    if (this._capture) this._capture.btn.classList.remove('capturing');
    this._capture = null;
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    if (this._onMouse) document.removeEventListener('mousedown', this._onMouse, true);
    this._onKey = this._onMouse = null;
  }
}
