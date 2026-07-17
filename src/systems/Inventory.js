/**
 * Inventory — a themed, mouse-driven overlay for stored items such as keys.
 *
 * Toggled with Tab. Opening frees the mouse cursor for the UI (the host
 * releases pointer lock and freezes the sim through a callback); pressing Tab
 * again — or Escape — closes it and hands the mouse straight back to the game.
 * Quest items arrive through the same 'pickup' events the rest of the game
 * uses, so nothing here reaches into other systems. DROPPABLE items (the
 * Companion Cube) can be clicked in their slot to set them back down: the
 * item leaves the satchel and an 'inventory:drop' event tells the owning
 * system to put it back into the world.
 *
 * The callbacks decouple it from the Game:
 *   canOpen() -> boolean   may the inventory open right now (i.e. in play)
 *   onOpen()               free the cursor / freeze the world
 *   onClose()              recapture the mouse / resume
 */
const SLOTS = 20;
const STORABLE = new Set(['key', 'companionCube']); // ammo/health are consumed, not stored
const DROPPABLE = new Set(['companionCube']);       // click-to-drop back into the world

export class Inventory {
  constructor(events, root, callbacks = {}) {
    this.events = events;
    this.callbacks = callbacks;
    this.open = false;
    this.items = new Map(); // label -> { label, count, type }

    this._build(root);
    this._wire();
    this._render();

    events.on('pickup', ({ type, label }) => {
      if (!STORABLE.has(type)) return;
      const key = label || type;
      const it = this.items.get(key) || { label: key, count: 0, type };
      it.count++;
      this.items.set(key, it);
      this._render();
      this._flash();
    });
  }

  _build(root) {
    this.el = document.createElement('div');
    this.el.id = 'inventory';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="inv-panel">
        <div class="inv-title">SATCHEL <span class="inv-hint">TAB / ESC TO CLOSE</span></div>
        <div class="inv-grid"></div>
        <div class="inv-foot">Quest items you carry are kept here. Click the Companion Cube to set it down.</div>
      </div>`;
    root.appendChild(this.el);
    this.gridEl = this.el.querySelector('.inv-grid');

    // Click a droppable item to set it down (delegated — slots re-render).
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
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    }, true);
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
          + ` title="${droppable ? 'Click to set it down' : it.label}">`
          + `<canvas class="inv-icon" width="40" height="40"></canvas>`
          + (it.count > 1 ? `<span class="inv-count">${it.count}</span>` : '')
          + (droppable ? '<span class="inv-drop">DROP</span>' : '')
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
    } else {
      ctx.strokeRect(9, 9, 22, 22);
    }
  }
}
