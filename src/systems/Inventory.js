/**
 * Inventory — a themed, mouse-driven overlay for stored items such as keys.
 *
 * Toggled with Tab. Opening frees the mouse cursor for the UI (the host
 * releases pointer lock and freezes the sim through a callback); pressing Tab
 * again — or clicking the ground outside the panel — closes it and hands the
 * mouse straight back to the game. Escape is swallowed and does nothing, the
 * same rule every overlay in the game follows.
 * Quest items arrive through the same 'pickup' events the rest of the game
 * uses, so nothing here reaches into other systems. DROPPABLE items can be
 * clicked in their slot to take them out of the satchel: the item leaves the
 * grid and an 'inventory:drop' event tells the owning system what to do with
 * it — the Companion Cube goes back on the ground, the sentry comes up into
 * the player's hands to be placed (see systems/SentrySystem.js). ACTION_LABEL
 * is what the slot calls that, because "DROP" is a lie on a thing you deploy.
 *
 * Items also come back IN by a second door: 'inventory:store', which is what a
 * system emits when it hands something back rather than the player finding it
 * (packing a deployed sentry up again). It is deliberately not 'pickup' —
 * that event means "this was collected off the ground" and other systems act
 * on it, so re-using it would pay the player twice.
 *
 * The callbacks decouple it from the Game:
 *   canOpen() -> boolean   may the inventory open right now (i.e. in play)
 *   onOpen()               free the cursor / freeze the world
 *   onClose()              recapture the mouse / resume
 */
const SLOTS = 20;
// ammo/health are consumed, not stored. The sentry is deliberately absent:
// its count is owned by SentrySystem and pushed here through 'inventory:sync'
// (see below), because that system also has to answer for the one in your
// hands and the ones standing in the street.
const STORABLE = new Set(['key', 'companionCube']);
// Click to take it back out. The adjutant is here for the same reason the sentry
// is and is owned the same way — CompanionSystem answers for whether she is
// folded up or standing in the street, and states the count through
// 'inventory:sync'.
// Exported because it is a CONTRACT as much as a list: everything a player can
// put out into the world is something a death has to be able to fetch back
// (Game.respawn), and the suite holds the two lists against each other.
export const DROPPABLE = new Set(['companionCube', 'sentry', 'companion']);
const ACTION_LABEL = { companionCube: 'DROP', sentry: 'DEPLOY', companion: 'UNFOLD' };
const ACTION_HINT = {
  companionCube: 'Click to set it down',
  sentry: 'Click to take it in hand',
  companion: 'Click to stand her up',
};

export class Inventory {
  constructor(events, root, callbacks = {}) {
    this.events = events;
    this.callbacks = callbacks;
    this.open = false;
    this.items = new Map(); // label -> { label, count, type }

    this._build(root);
    this._wire();
    this._render();

    const store = ({ type, label }) => {
      if (!STORABLE.has(type)) return;
      const key = label || type;
      const it = this.items.get(key) || { label: key, count: 0, type };
      it.count++;
      this.items.set(key, it);
      this._render();
      this._flash();
    };
    events.on('pickup', store);        // found in the world / bought
    events.on('inventory:store', store); // handed back by a system

    /**
     * A third door, and a different KIND of door: the count is stated, not
     * incremented.
     *
     * Some things are not really "in" the satchel — a sentry can be stowed, in
     * your hands, or bolted to the pavement, and only one system knows which.
     * Letting the satchel keep its own tally of those means the two can
     * disagree the moment a checkpoint rolls the run back, and a slot showing
     * an item you no longer own is worse than no slot at all. So the owning
     * system states the number and this displays it.
     */
    events.on('inventory:sync', ({ type, label, count }) => {
      const key = label || type;
      if (count > 0) this.items.set(key, { label: key, count, type });
      else this.items.delete(key);
      this._render();
    });
  }

  _build(root) {
    this.el = document.createElement('div');
    this.el.id = 'inventory';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="inv-panel">
        <div class="inv-title">SATCHEL <span class="inv-hint">TAB OR CLICK OUTSIDE TO CLOSE</span></div>
        <div class="inv-grid"></div>
        <div class="inv-foot">What you carry is kept here. Click a sentry to take it in hand, or the Companion Cube to set it down.</div>
      </div>`;
    root.appendChild(this.el);
    this.gridEl = this.el.querySelector('.inv-grid');

    // Click a droppable item to take it back out (delegated — slots re-render).
    // The count is decremented optimistically; an owning system that answers
    // 'inventory:drop' with an 'inventory:sync' has the last word either way,
    // so a refused action puts the slot straight back.
    this.gridEl.addEventListener('click', (e) => {
      const slot = e.target.closest('.inv-slot.droppable');
      if (!slot) return;
      const it = this.items.get(slot.dataset.label);
      if (!it) return;
      it.count--;
      if (it.count <= 0) this.items.delete(it.label);
      this._render();
      this.events.emit('inventory:drop', { type: it.type, label: it.label });
    });
  }

  _wire() {
    // Capture-phase so the toggle wins regardless of who else listens, and the
    // Tab default (focus traversal) never fires.
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggle();
      } else if (this.open && e.code === 'Escape') {
        // Swallowed, not obeyed — the same rule every overlay here follows.
        // Tab shuts the satchel (it is what opened it) and so does a click on
        // the ground outside the panel; Escape does nothing but stay off the
        // pause screen.
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // ...and clicking outside the panel puts it away, the way the counter and
    // the order dial do.
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
  }

  toggle() {
    if (this.open) this.close();
    else this.openInventory();
  }

  openInventory() {
    if (this.open) return;
    if (this.callbacks.canOpen && !this.callbacks.canOpen()) return; // only in play
    this.open = true;
    this.el.style.display = 'flex';
    this._render();
    this.callbacks.onOpen?.();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.style.display = 'none';
    this.callbacks.onClose?.();
  }

  _flash() {
    // brief highlight so a pickup is noticed even with the satchel closed
    this.el.classList.remove('inv-ping');
    void this.el.offsetWidth;
    this.el.classList.add('inv-ping');
  }

  _render() {
    const list = [...this.items.values()];
    let html = '';
    for (let i = 0; i < SLOTS; i++) {
      const it = list[i];
      if (it) {
        const droppable = DROPPABLE.has(it.type);
        html += `<div class="inv-slot filled${droppable ? ' droppable' : ''}" data-label="${it.label}"`
          + ` title="${droppable ? (ACTION_HINT[it.type] ?? 'Click to take it out') : it.label}">`
          + `<canvas class="inv-icon" width="40" height="40"></canvas>`
          + (it.count > 1 ? `<span class="inv-count">${it.count}</span>` : '')
          + (droppable ? `<span class="inv-drop">${ACTION_LABEL[it.type] ?? 'DROP'}</span>` : '')
          + `<span class="inv-name">${it.label}</span></div>`;
      } else {
        html += '<div class="inv-slot"></div>';
      }
    }
    this.gridEl.innerHTML = html;
    // draw icons for filled slots
    const canvases = this.gridEl.querySelectorAll('.inv-icon');
    let ci = 0;
    for (const it of list) {
      const cv = canvases[ci++];
      if (cv) this._drawIcon(cv, it.type);
    }
  }

  _drawIcon(canvas, type) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 40, 40);
    ctx.fillStyle = '#e0b840'; ctx.strokeStyle = '#e0b840'; ctx.lineWidth = 3;
    if (type === 'key') {
      ctx.beginPath(); ctx.arc(13, 14, 7, 0, Math.PI * 2); ctx.stroke(); // bow
      ctx.beginPath(); ctx.arc(13, 14, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(17, 12.5, 18, 3);   // shaft
      ctx.fillRect(31, 15, 3, 6);      // teeth
      ctx.fillRect(27, 15, 3, 4);
    } else if (type === 'companionCube') {
      ctx.fillStyle = '#b9bdb7';
      ctx.fillRect(7, 7, 26, 26);      // pale shell
      ctx.fillStyle = '#7d8286';
      ctx.fillRect(12, 12, 16, 16);    // recessed face
      ctx.fillStyle = '#efa3c0';       // the heart
      ctx.beginPath();
      ctx.moveTo(20, 26);
      ctx.bezierCurveTo(13, 21, 12, 16, 16, 14);
      ctx.bezierCurveTo(18.5, 13, 20, 15.5, 20, 17);
      ctx.bezierCurveTo(20, 15.5, 21.5, 13, 24, 14);
      ctx.bezierCurveTo(28, 16, 27, 21, 20, 26);
      ctx.fill();
    } else if (type === 'sentry') {
      // the machine in miniature: splayed legs, drum body, gun head, barrel
      ctx.strokeStyle = '#8f9a6a'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(20, 22); ctx.lineTo(11, 34);
      ctx.moveTo(20, 22); ctx.lineTo(29, 34);
      ctx.moveTo(20, 22); ctx.lineTo(20, 33);
      ctx.stroke();
      ctx.fillStyle = '#6d7a4c';
      ctx.fillRect(14, 15, 12, 8);      // the body drum
      ctx.fillStyle = '#a8842c';
      ctx.fillRect(13, 13, 14, 2.5);    // the yaw ring
      ctx.fillStyle = '#8f9a6a';
      ctx.fillRect(15, 6, 10, 7);       // the head
      ctx.fillStyle = '#3a3d42';
      ctx.fillRect(24, 8, 12, 3);       // the barrel, pointing off to the right
      ctx.fillStyle = '#e0b840';
      ctx.fillRect(16, 3, 3, 3);        // the status lamp
    } else if (type === 'companion') {
      // her, folded: knees up, tail round, two ears over the top of it all
      ctx.fillStyle = '#3c3a46';
      ctx.beginPath();                       // the tail, curled round the ball
      ctx.arc(20, 24, 12, 0.2, Math.PI * 1.5);
      ctx.lineWidth = 3.5; ctx.strokeStyle = '#3c3a46'; ctx.stroke();
      ctx.fillStyle = '#dcd6c8';
      ctx.beginPath(); ctx.arc(20, 24, 9, 0, Math.PI * 2); ctx.fill();   // the body
      ctx.fillStyle = '#7a3f5a';
      ctx.fillRect(13, 26, 14, 3);           // the plum panel across it
      ctx.fillStyle = '#dcd6c8';
      ctx.beginPath(); ctx.arc(20, 14, 6.5, 0, Math.PI * 2); ctx.fill(); // the head
      ctx.fillStyle = '#1b2028';
      ctx.fillRect(15, 12.5, 10, 3);         // the visor
      ctx.fillStyle = '#7ce8d0';
      ctx.fillRect(16, 13, 3, 2); ctx.fillRect(21, 13, 3, 2);
      ctx.fillStyle = '#3c3a46';             // the ears
      ctx.beginPath(); ctx.moveTo(14, 10); ctx.lineTo(16, 3); ctx.lineTo(19, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(26, 10); ctx.lineTo(24, 3); ctx.lineTo(21, 9); ctx.fill();
      ctx.fillStyle = '#0d5f52';             // her core, still lit
      ctx.beginPath(); ctx.arc(20, 23, 2.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeRect(9, 9, 22, 22);
    }
  }
}
