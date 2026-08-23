import { DEFAULT_BINDINGS, MAX_SLOTS, normalizeBindings } from '../engine/KeyBindings.js';

/**
 * The single source of truth for player settings — mouse/FOV/audio sliders,
 * invert-Y, and the re-bindable key map — persisted to localStorage and shared
 * by BOTH the title-screen Settings and the in-game (pause) Settings, so a
 * change made in one is immediately reflected in the other and in play.
 *
 * onApply(snapshot) is called whenever anything changes (and once on load);
 * the Game routes that to the camera/audio/input so settings take effect live.
 */
const SETTINGS_KEY = 'gbts.settings.v1';
// `detail` drives the whole visual pass — surface relief and the post chain
// (see rendering/Renderer.setDetail). 1 is the intended look; 0 is the plain,
// cheap frame, which is the escape hatch on weak hardware.
const DEFAULTS = {
  sensitivity: 1.0, fov: 90, invertY: false, detail: 1,
  // TWO levels, not one. The dynamic soundtrack and the effects bus are
  // separate all the way to the speakers (see audio/AudioManager.js), so they
  // get a slider each — a player who wants the score down and the guns loud
  // used to have to choose.
  // The score sits UNDER the game by default. It is scenery that reacts, not
  // the thing you are listening to, and it is easier to find the slider and
  // turn it up than to be told by a soundtrack you did not ask for.
  musicVolume: 0.32, sfxVolume: 0.6,
};

export class SettingsStore {
  constructor(onApply) {
    this.onApply = onApply;
    this.values = { ...DEFAULTS };
    this.bindings = normalizeBindings(DEFAULT_BINDINGS);
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        const { bindings, ...vals } = j;
        // Settings saved before the split carried ONE `volume`. Honour it as
        // the level the player chose for both buses rather than silently
        // resetting them to the defaults on first launch after the update.
        if (vals.volume != null && vals.sfxVolume == null && vals.musicVolume == null) {
          vals.sfxVolume = vals.volume;
          vals.musicVolume = vals.volume;
        }
        delete vals.volume;
        this.values = { ...DEFAULTS, ...vals };
        this.bindings = normalizeBindings(bindings);
      }
    } catch { /* storage disabled */ }
  }

  persist() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...this.values, bindings: this.bindings }));
    } catch { /* storage full/disabled */ }
  }

  get snapshot() {
    const bindings = {};
    for (const [a, list] of Object.entries(this.bindings)) bindings[a] = [...list];
    return { ...this.values, bindings };
  }

  /** The codes on an action, primary first. Always at least one. */
  codesFor(action) { return this.bindings[action] || []; }

  setValue(key, v) {
    this.values[key] = v;
    this.persist();
    this.apply();
  }

  /**
   * Write `code` into one slot of an action (0 = primary, 1 = alternate).
   *
   * A code belongs to exactly one slot in the whole map, so whoever held it
   * before has to give it up. Where possible the two SWAP — the previous
   * occupant of the slot being written moves to the cell the code came from —
   * which is what makes rebinding a primary onto another primary do the
   * obvious thing and leave both actions playable.
   *
   * When there is nothing to swap (filling an EMPTY alternate with a code
   * another action holds) the code is simply taken. If that empties a primary
   * the action's alternate is promoted into it; only an action that had just
   * the one code is left unbound, which the panel then shows as a dash. That
   * is deliberate: the player asked for this code to be here, so putting it
   * here and saying plainly what it cost beats silently refusing.
   */
  setBinding(action, slot, code) {
    const prev = this.bindings[action]?.[slot] ?? null;
    for (const a of Object.keys(this.bindings)) {
      const list = [...this.bindings[a]];
      const at = list.indexOf(code);
      if (at < 0 || (a === action && at === slot)) continue;
      if (prev) list[at] = prev; else list.splice(at, 1);
      this.bindings[a] = list;                       // dense: promotion is free
    }
    const list = [...this.bindings[action]];
    list[Math.min(slot, list.length)] = code;        // filling slot 1 of a 1-code action appends
    this.bindings[action] = list.filter(Boolean).slice(0, MAX_SLOTS);
    this.persist();
    this.apply();
  }

  /**
   * Drop one slot. Refused when it would leave the action with no way to fire
   * at all — an unbound WALK FORWARD you did not ask for is a soft-lock, and
   * unlike the steal above there is no intent here to honour.
   */
  clearBinding(action, slot) {
    const list = [...(this.bindings[action] || [])];
    if (list.length <= 1 || slot >= list.length) return false;
    list.splice(slot, 1);
    this.bindings[action] = list;
    this.persist();
    this.apply();
    return true;
  }

  apply() { this.onApply?.(this.snapshot); }
}
