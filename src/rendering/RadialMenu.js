/**
 * THE ORDER DIAL — the radial menu you give the escort her instructions on.
 *
 * A radial rather than a list, and for a reason beyond looking good: an order
 * given to something standing in front of you should cost one gesture, not a
 * read. Every command sits at a fixed compass point, so after the second time
 * you use it your hand knows that GUARD is up-right and PACK UP is straight
 * down without your eyes going anywhere near the labels.
 *
 * The layout is not arbitrary either. The dial is split down the middle by
 * what the two halves MEAN:
 *
 *        FOLLOW              the right side is POSTURE — where she should be
 *   ATTACK    GUARD
 *  RANGED       STAY         the left side is RULES — what she may do about it
 *   MELEE    PASSIVE
 *        PACK UP             and the bottom is the way out of the whole thing
 *
 * She is holding one from each side at all times, and both are lit on the dial,
 * so it doubles as the readout for what she is currently doing — which is why
 * the hub carries her state in words as well.
 *
 * It is built from the same plate the rest of the interface is cut from
 * (scratched gunmetal, amber stencil, a green CRT hub) so it reads as another
 * instrument on the rig rather than as a menu from a different game.
 *
 * ESCAPE and the interact key both close it, and both hand the mouse straight
 * back — same contract as the shop and the arcade, same reasons, and the same
 * caveat about Escape carrying no user activation (see engine/Input.js).
 */

const R_OUT = 96;
const R_IN = 38;
const SEG = 8;

/**
 * The eight orders, clockwise from twelve. `kind` is which half of her state
 * the command belongs to, which is what lets the dial light the two she is
 * currently holding.
 */
export const ORDERS = [
  { cmd: 'follow', label: 'FOLLOW', kind: 'posture', hint: 'Walk with me' },
  { cmd: 'guard', label: 'GUARD', kind: 'posture', hint: 'Hold here, but chase what comes' },
  { cmd: 'stay', label: 'STAY', kind: 'posture', hint: 'Do not leave this spot' },
  { cmd: 'passive', label: 'PASSIVE', kind: 'rules', hint: 'Do not fight at all' },
  { cmd: 'pickup', label: 'PACK UP', kind: 'exit', hint: 'Fold her back into the satchel' },
  { cmd: 'melee', label: 'MELEE', kind: 'rules', hint: 'Blades only — she will close' },
  { cmd: 'ranged', label: 'RANGED', kind: 'rules', hint: 'Arc only — she will hold off' },
  { cmd: 'attack', label: 'ATTACK', kind: 'rules', hint: 'Whatever the range asks for' },
];

/** An annular wedge, as an SVG path. */
function wedgePath(i) {
  const half = Math.PI / SEG;
  // -90° puts index 0 at twelve o'clock; a small gap keeps the wedges apart
  const gap = 0.045;
  const a0 = -Math.PI / 2 + (i * 2 - 1) * half + gap;
  const a1 = -Math.PI / 2 + (i * 2 + 1) * half - gap;
  const p = (r, a) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  return `M ${p(R_IN, a0)} L ${p(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${p(R_OUT, a1)}`
    + ` L ${p(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${p(R_IN, a0)} Z`;
}

/** Where a wedge's label sits. */
function labelAt(i) {
  const a = -Math.PI / 2 + (i / SEG) * Math.PI * 2;
  const r = (R_OUT + R_IN) / 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export class RadialMenu {
  /**
   * @param root the HUD element to mount on
   * @param cb   { canOpen, onOpen, onClose, onCommand(cmd), interactCodes() }
   */
  constructor(root, cb = {}) {
    this.cb = cb;
    this.open = false;
    this.subject = null;
    this._build(root);
    this._wire();
  }

  _build(root) {
    this.el = document.createElement('div');
    this.el.id = 'radial';
    this.el.style.display = 'none';

    const wedges = ORDERS.map((o, i) =>
      `<path class="rad-wedge rad-${o.kind}" data-cmd="${o.cmd}" d="${wedgePath(i)}"/>`).join('');
    const labels = ORDERS.map((o, i) => {
      const { x, y } = labelAt(i);
      return `<text class="rad-label" data-cmd="${o.cmd}" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">`
        + `${o.label}</text>`;
    }).join('');

    this.el.innerHTML = `
      <div class="rad-dial">
        <svg viewBox="-110 -110 220 220" class="rad-svg">
          <circle class="rad-plate" cx="0" cy="0" r="${R_OUT + 8}"/>
          <g class="rad-wedges">${wedges}</g>
          <circle class="rad-hub-ring" cx="0" cy="0" r="${R_IN - 2}"/>
          <g class="rad-labels">${labels}</g>
        </svg>
        <div class="rad-hub">
          <b class="rad-hub-title">ESCORT</b>
          <span class="rad-hub-state">—</span>
        </div>
        <div class="rad-tip">—</div>
        <div class="rad-foot">CLICK AN ORDER &nbsp;·&nbsp; [ESC] TO STEP BACK</div>
      </div>`;
    root.appendChild(this.el);
    this.stateEl = this.el.querySelector('.rad-hub-state');
    this.tipEl = this.el.querySelector('.rad-tip');
    this.dialEl = this.el.querySelector('.rad-dial');
  }

  _wire() {
    // Hover: light the wedge and say what it does, so nothing is a guess.
    this.el.addEventListener('mousemove', (e) => {
      const w = e.target.closest?.('[data-cmd]');
      const cmd = w?.dataset.cmd;
      if (cmd === this._hover) return;
      this._hover = cmd;
      const o = ORDERS.find((x) => x.cmd === cmd);
      this.tipEl.textContent = o ? o.hint : '—';
      for (const el of this.el.querySelectorAll('[data-cmd]')) {
        el.classList.toggle('hot', el.dataset.cmd === cmd);
      }
    });

    this.el.addEventListener('click', (e) => {
      const w = e.target.closest?.('[data-cmd]');
      if (w) { this._pick(w.dataset.cmd); return; }
      // a click on the ground around the dial is a way out, like the shop's
      if (e.target === this.el) this.close();
    });

    // Escape, and the interact key that opened it — the second because an
    // ordinary key press carries user activation where Escape does not, so
    // leaving the way you arrived is the exit that always gets the mouse back
    // on the spot. Capture phase, stopped dead, so the pause screen never sees
    // it. (Tab is left alone: the satchel owns Tab.)
    document.addEventListener('keydown', (e) => {
      if (!this.open || e.repeat) return;
      if (e.code === 'Escape' || this.cb.interactCodes?.().includes(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        return;
      }
      // 1–8 pick an order, for a player who would rather not aim a cursor
      const n = /^Digit([1-8])$/.exec(e.code);
      if (n) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._pick(ORDERS[+n[1] - 1].cmd);
      }
    }, true);
  }

  _pick(cmd) {
    if (!cmd) return;
    const stay = this.cb.onCommand?.(cmd);
    // PACK UP takes her away, so the dial has nothing left to point at; the
    // rest are settings, and leaving the dial up lets you give two orders
    // without walking up to her twice.
    if (stay === false || cmd === 'pickup') this.close();
    else this.refresh();
  }

  /** Light the two orders she is currently holding, and say them in the hub. */
  refresh() {
    const c = this.subject;
    if (!c) return;
    this.stateEl.textContent = c.describe();
    for (const el of this.el.querySelectorAll('[data-cmd]')) {
      const cmd = el.dataset.cmd;
      el.classList.toggle('on', cmd === c.posture || cmd === c.rules);
    }
  }

  openOn(companion) {
    if (this.open) return false;
    if (this.cb.canOpen && !this.cb.canOpen()) return false;
    this.subject = companion;
    this.open = true;
    this.el.style.display = 'flex';
    this._hover = null;
    this.tipEl.textContent = '—';
    this.refresh();
    // it comes up as a dial being spun up, not as a box appearing
    this.dialEl.classList.remove('armed');
    void this.dialEl.offsetWidth;
    this.dialEl.classList.add('armed');
    this.cb.onOpen?.();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.style.display = 'none';
    this.subject = null;
    this.cb.onClose?.();
  }
}
