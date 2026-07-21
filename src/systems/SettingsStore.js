import { DEFAULT_BINDINGS } from '../engine/KeyBindings.js';

/**
 * The single source of truth for player settings — mouse/FOV/volume sliders,
 * invert-Y, and the re-bindable key map — persisted to localStorage and shared
 * by BOTH the title-screen Settings and the in-game (pause) Settings, so a
 * change made in one is immediately reflected in the other and in play.
 *
 * onApply(snapshot) is called whenever anything changes (and once on load);
 * the Game routes that to the camera/audio/input so settings take effect live.
 */
const SETTINGS_KEY = 'gbts.settings.v1';
const DEFAULTS = { sensitivity: 1.0, fov: 90, volume: 0.5, invertY: false };

export class SettingsStore {
  constructor(onApply) {
    this.onApply = onApply;
    this.values = { ...DEFAULTS };
    this.bindings = { ...DEFAULT_BINDINGS };
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        const { bindings, ...vals } = j;
        this.values = { ...DEFAULTS, ...vals };
        this.bindings = { ...DEFAULT_BINDINGS, ...(bindings || {}) };
      }
    } catch { /* storage disabled */ }
  }

  persist() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...this.values, bindings: this.bindings }));
    } catch { /* storage full/disabled */ }
  }

  get snapshot() { return { ...this.values, bindings: { ...this.bindings } }; }

  setValue(key, v) {
    this.values[key] = v;
    this.persist();
    this.apply();
  }

  /**
   * Rebind an action. If the chosen code is already held by another action the
   * two SWAP — this action takes the new code and the other inherits this
   * action's old one, so nothing is ever left unbound (which would strand the
   * player unable to move in some direction).
   */
  setBinding(action, code) {
    const prev = this.bindings[action];
    for (const a of Object.keys(this.bindings)) {
      if (a !== action && this.bindings[a] === code) this.bindings[a] = prev;
    }
    this.bindings[action] = code;
    this.persist();
    this.apply();
  }

  apply() { this.onApply?.(this.snapshot); }
}
