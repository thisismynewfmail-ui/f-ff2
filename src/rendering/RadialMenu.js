/**
 * THE ORDER DIAL — the instrument you give the adjutant her instructions on.
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
 * ── IT IS A PIECE OF THE RIG, NOT A MENU ──────────────────────────────────
 * Built from the same stock as everything else on the console (styles.css):
 * a painted steel case with a keyline and four fixing screws, eight WELLS cut
 * into it rather than eight buttons laid on it, a stepped collar around the
 * bore, and a green CRT in the middle carrying her name and her standing
 * orders. The stencil is deliberately SMALL — an order dial is read by shape
 * and compass point, and lettering sized to shout at you is lettering that
 * spills over the web between two wells and turns the ring into a wall of
 * text. Each well carries its keyboard index at the rim, the way a rotary
 * switch carries its detent numbers, because 1–8 drive the same orders.
 *
 * Nothing here animates anything but transform and opacity: the case and the
 * ring come up together in a fifth of a second, the CRT a beat behind them,
 * and picking an order flashes that one well. No blurs, no filters, no shadow
 * animation — this thing goes up in the middle of a fight.
 *
 * The interact key that opened it closes it, and so does a click on the ground
 * outside the dial — same contract as the shop and the arcade, and the same
 * reason for preferring the key you arrived on: Escape carries no user
 * activation and so cannot hand the mouse back (see engine/Input.js). Escape
 * itself is swallowed here and does nothing at all.
 */

const R_OUT = 100;      // outer edge of the wells
const R_IN = 41;        // the bore the CRT sits in
const R_LABEL = 70;     // where the stencil sits in the ring
// ...and the detent number, hard against the rim. The gap between the two
// radii is what keeps "7" and "RANGED" from reading as one word on the wells
// that lie flat either side of the dial.
const R_KEY = 95;
const SEG = 8;
// The web of steel left between two wells. Held to a constant WIDTH rather
// than a constant angle, so the gaps do not fan out toward the rim.
const WEB = 2.6;

/** What the tip line says when nothing is under the cursor. */
const HINT = 'CLICK AN ORDER · KEYS 1–8 · CLICK OUTSIDE TO STEP BACK';

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

/** The centre bearing of a well, with 0 at twelve o'clock. */
const bearing = (i) => -Math.PI / 2 + (i / SEG) * Math.PI * 2;

/** A point on the dial, as SVG path coordinates. */
const at = (r, a) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;

/** One well: an annular wedge with square-cut ends. */
function wedgePath(i) {
  const half = Math.PI / SEG;
  const c = bearing(i);
  const gi = WEB / R_IN, go = WEB / R_OUT;   // same web width at both radii
  return `M ${at(R_IN, c - half + gi)} L ${at(R_OUT, c - half + go)}`
    + ` A ${R_OUT} ${R_OUT} 0 0 1 ${at(R_OUT, c + half - go)}`
    + ` L ${at(R_IN, c + half - gi)}`
    + ` A ${R_IN} ${R_IN} 0 0 0 ${at(R_IN, c - half + gi)} Z`;
}

/** Where a well's stencil (or its detent number) sits. */
function textAt(i, r, dy = 0) {
  const a = bearing(i);
  return { x: (Math.cos(a) * r).toFixed(1), y: (Math.sin(a) * r + dy).toFixed(1) };
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
    this._hover = null;
    this._ping = null;
    this._pinged = null;
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
      const p = textAt(i, R_LABEL, 2.4);
      return `<text class="rad-label" data-cmd="${o.cmd}" x="${p.x}" y="${p.y}">${o.label}</text>`;
    }).join('');
    const keys = ORDERS.map((o, i) => {
      const p = textAt(i, R_KEY, 2);
      return `<text class="rad-key" data-cmd="${o.cmd}" x="${p.x}" y="${p.y}">${i + 1}</text>`;
    }).join('');

    // The collars: a black rebate with a bright hairline set inside it, around
    // the rim and around the bore. Same stepped edge every window in the
    // chassis carries, which is most of why this reads as machined.
    this.el.innerHTML = `
      <div class="rad-dial">
        <div class="rad-plate-row"><span class="rad-plate">ADJUTANT ORDER DIAL</span></div>
        <div class="rad-case">
          <div class="screw rad-screw s1"></div><div class="screw rad-screw s2"></div>
          <div class="screw rad-screw s3"></div><div class="screw rad-screw s4"></div>
        </div>
        <svg viewBox="-110 -110 220 220" class="rad-svg" aria-hidden="true">
          <circle class="rad-rebate" cx="0" cy="0" r="${R_OUT + 2.5}"/>
          <circle class="rad-keyline" cx="0" cy="0" r="${R_OUT + 5}"/>
          <g class="rad-wedges">${wedges}</g>
          <circle class="rad-rebate" cx="0" cy="0" r="${R_IN - 2.5}"/>
          <circle class="rad-keyline" cx="0" cy="0" r="${R_IN - 5}"/>
          <g class="rad-labels">${labels}${keys}</g>
        </svg>
        <div class="rad-hub">
          <b class="rad-hub-name">NEKO</b>
          <div class="rad-hub-rule"></div>
          <span class="rad-hub-state">—</span>
        </div>
        <div class="rad-tip-row">
          <span class="rad-tip"><b></b><span></span></span>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.stateEl = this.el.querySelector('.rad-hub-state');
    this.tipCmdEl = this.el.querySelector('.rad-tip b');
    this.tipEl = this.el.querySelector('.rad-tip span');
    this.marks = [...this.el.querySelectorAll('[data-cmd]')];
  }

  /** Light one order across all three of the things that draw it. */
  _paint(cmd, cls, on) {
    for (const el of this.marks) {
      if (el.dataset.cmd === cmd) el.classList.toggle(cls, on);
    }
  }

  _wire() {
    // Hover: light the well and say what the order does, so nothing is a guess.
    this.el.addEventListener('mousemove', (e) => {
      const cmd = e.target.closest?.('[data-cmd]')?.dataset.cmd;
      if (cmd === this._hover) return;
      if (this._hover) this._paint(this._hover, 'hot', false);
      this._hover = cmd;
      const o = ORDERS.find((x) => x.cmd === cmd);
      this.tipCmdEl.textContent = o ? o.label : '';
      this.tipEl.textContent = o ? o.hint : HINT;
      if (cmd) this._paint(cmd, 'hot', true);
    });

    this.el.addEventListener('click', (e) => {
      const w = e.target.closest?.('[data-cmd]');
      if (w) { this._pick(w.dataset.cmd); return; }
      // a click on the ground around the dial is a way out, like the shop's
      if (e.target === this.el) this.close();
    });

    // The interact key that opened it is the way back out, because an ordinary
    // key press carries user activation where Escape does not, so leaving the
    // way you arrived is the exit that always gets the mouse back on the spot.
    // Clicking off the dial does the same.
    //
    // ESCAPE IS DELIBERATELY INERT HERE — swallowed, not acted on. It is the
    // key a player hits by reflex to mean "not that", and having it close an
    // instrument you opened on purpose is how an order gets abandoned halfway.
    // It is still stopped dead in the capture phase so it can never reach the
    // pause screen either. (Tab is left alone: the satchel owns Tab.)
    document.addEventListener('keydown', (e) => {
      if (!this.open || e.repeat) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (this.cb.interactCodes?.().includes(e.code)) {
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
    this._flash(cmd);
    const stay = this.cb.onCommand?.(cmd);
    // PACK UP takes her away, so the dial has nothing left to point at; the
    // rest are settings, and leaving the dial up lets you give two orders
    // without walking up to her twice.
    if (stay === false || cmd === 'pickup') this.close();
    else this.refresh();
  }

  /**
   * The well lights, hard, for a sixth of a second. A class on and a class off
   * — the fade back out is the wedge's own fill transition, so a pick costs a
   * repaint of one path and no animation bookkeeping at all.
   */
  _flash(cmd) {
    this._unflash();
    this._pinged = cmd;
    this._paint(cmd, 'ping', true);
    this._ping = setTimeout(() => this._unflash(), 150);
  }

  /**
   * Put the flash out. Closing has to do this as well as the timer does:
   * PACK UP flashes and then shuts the dial inside the same tick, and a class
   * left on a wedge would still be lit the next time she is asked for orders.
   */
  _unflash() {
    clearTimeout(this._ping);
    if (this._pinged) this._paint(this._pinged, 'ping', false);
    this._pinged = null;
  }

  /** Light the two orders she is currently holding, and say them in the hub. */
  refresh() {
    const c = this.subject;
    if (!c) return;
    this.stateEl.textContent = c.describe();
    for (const el of this.marks) {
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
    if (this._hover) this._paint(this._hover, 'hot', false);
    this._hover = null;
    this.tipCmdEl.textContent = '';
    this.tipEl.textContent = HINT;
    this.refresh();
    // it comes up as an instrument being spun up, not as a box appearing
    this.el.classList.remove('armed');
    void this.el.offsetWidth;
    this.el.classList.add('armed');
    this.cb.onOpen?.();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this._unflash();
    this.el.classList.remove('armed');
    this.el.style.display = 'none';
    this.subject = null;
    this.cb.onClose?.();
  }
}
