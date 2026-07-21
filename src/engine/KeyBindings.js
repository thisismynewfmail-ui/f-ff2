/**
 * Re-bindable action map shared by the input layer and the settings UI.
 *
 * A "code" is either a KeyboardEvent.code (e.g. 'ShiftLeft', 'KeyL') or a
 * mouse button written as `Mouse<button>` where <button> is the raw
 * MouseEvent.button (0 LMB, 1 MMB, 2 RMB, 3 back, 4 forward). codeLabel()
 * turns either kind into the short stencil label the HUD/menu shows — mouse
 * buttons follow the usual gaming numbering (MOUSE1 = LMB … MOUSE5 = forward).
 */
export const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  crouch: 'ControlLeft',
  reload: 'KeyR',
  interact: 'KeyE',
};

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
