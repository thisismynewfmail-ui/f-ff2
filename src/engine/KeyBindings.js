/**
 * Re-bindable action map shared by the input layer and the settings UI.
 *
 * A "code" is either a KeyboardEvent.code (e.g. 'ShiftLeft', 'KeyL') or a
 * mouse button written as `Mouse<button>` where <button> is the raw
 * MouseEvent.button (0 LMB, 1 MMB, 2 RMB, 3 back, 4 forward). codeLabel()
 * turns either kind into the short stencil label the HUD/menu shows — mouse
 * buttons follow the usual gaming numbering (MOUSE1 = LMB … MOUSE5 = forward).
 *
 * Every action holds a LIST of codes, not one: index 0 is the primary and
 * index 1 the alternate, and either fires the action. That is what lets a
 * player put SPRINT on both Shift and the mouse's thumb button, which is how
 * most people who use a thumb button actually want it — the thumb for the
 * hand that is already there, the key for when it isn't. The list is kept
 * DENSE (no holes): clearing the primary of an action that has an alternate
 * promotes the alternate, so slot 0 is always the one that is set.
 */
export const MAX_SLOTS = 2;

export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  reload: ['KeyR'],
  interact: ['KeyE'],
};

/**
 * Coerce a stored/incoming binding map into the canonical shape: every known
 * action present, every value a dense array of at most MAX_SLOTS codes.
 *
 * It accepts bare strings because that is what settings saved before the
 * alternate slot existed contain, and a player's saved keys surviving an
 * update is worth the four lines it costs.
 */
export function normalizeBindings(raw) {
  // Codes the player has already claimed, so the migration below never hands
  // an action an alternate that is somebody else's primary.
  const taken = new Set();
  for (const v of Object.values(raw || {})) {
    if (typeof v === 'string') taken.add(v);
    else if (Array.isArray(v)) for (const c of v) taken.add(c);
  }

  const out = {};
  for (const action of Object.keys(DEFAULT_BINDINGS)) {
    const v = raw?.[action];
    let list = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
      .filter((c) => typeof c === 'string' && c);
    if (typeof v === 'string') {
      // Settings written before the alternate slot existed. Keep the key the
      // player chose and restore the action's default alternate, so nobody
      // loses C-to-crouch or the arrow keys just by updating.
      const alt = DEFAULT_BINDINGS[action][1];
      if (alt && alt !== v && !taken.has(alt)) { list.push(alt); taken.add(alt); }
    }
    // Never hand back an action with nothing on it — a player who cannot walk
    // forward because a settings file was truncated has no way to fix it from
    // inside the game.
    if (!list.length) list = DEFAULT_BINDINGS[action];
    out[action] = list.slice(0, MAX_SLOTS);
  }
  return out;
}

// Ordered [action, label] rows for the key-bindings panel.
export const BINDING_ROWS = [
  ['forward', 'MOVE FORWARD'],
  ['back', 'MOVE BACK'],
  ['left', 'MOVE LEFT'],
  ['right', 'MOVE RIGHT'],
  ['sprint', 'SPRINT'],
  ['jump', 'JUMP'],
  ['crouch', 'CROUCH'],
  ['reload', 'RELOAD'],
  ['interact', 'INTERACT'],
];

const MOUSE_LABELS = { 0: 'MOUSE1', 1: 'MOUSE3', 2: 'MOUSE2', 3: 'MOUSE4', 4: 'MOUSE5' };
const KEY_LABELS = {
  Space: 'SPACE', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', Escape: 'ESC',
  ShiftLeft: 'SHIFT', ShiftRight: 'RSHIFT',
  ControlLeft: 'CTRL', ControlRight: 'RCTRL',
  AltLeft: 'ALT', AltRight: 'RALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  CapsLock: 'CAPS', Minus: '-', Equal: '=', Backquote: '~',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};

/** Short, human display label for a binding code (keyboard or mouse). */
export function codeLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) {
    const b = +code.slice(5);
    return MOUSE_LABELS[b] || 'MOUSE' + (b + 1);
  }
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM' + code.slice(6);
  return code.toUpperCase();
}

/** Turn a raw pointer button into its binding code. */
export function mouseCode(button) { return 'Mouse' + button; }
