import * as THREE from '../../lib/three.module.js';
import { buildVendorModel, VendorAnimator, HEIGHT as VENDOR_H } from './VendorModel.js';

/**
 * THE SHOP — the vendor's counter, opened with [E] at the trading post.
 *
 * Laid out the way the brief asks and the way a counter actually works: the
 * MACHINE on the left, live and turning on its own little stage, and the GOODS
 * on the right in bubbled bays — a big one for the hardware, one for the
 * ammunition, and a dead one at the bottom for the thing that is not for sale
 * yet. Between them, the till: what you are carrying, in tokens.
 *
 * The left panel is a real 3D render, not a picture of one. It gets its own
 * scene, camera and WebGL context on its own canvas, and it runs the SAME rig
 * and the SAME animator as the machine standing out on the knoll — so the
 * thing you are haggling with is unmistakably the thing you walked up to,
 * down to which idle it happens to be playing. It only draws while the shop is
 * open, so it costs nothing the rest of the run.
 *
 * ESCAPE IS THE WHOLE POINT OF THE PLUMBING. Leaving a shop means going back
 * to the street with the mouse captured — never the pause menu. The handler
 * runs in the capture phase and stops the event dead, exactly the way the
 * arcade cabinets do (see rendering/Arcade.js and the pointer notes in
 * engine/Game.js): the game's own Escape handler and the pause screen never
 * see it, and the host takes the pointer back on the next frame.
 *
 * The catalogue is data (SHOP_STOCK), so adding a line is adding an object.
 * Every entry declares its price, how many the machine has, and what buying it
 * actually does — the effect is an event, never a reach into another system.
 */

/** Ammunition packs, priced per purchase. One line per type, as asked. */
const AMMO_PRICE = 10;
const AMMO_LINES = [
  { id: 'ammo_pistol', name: 'PISTOL AMMO', rounds: 24, blurb: 'Mainspring auto — 9mm brass' },
  { id: 'ammo_shotgun', name: 'SHOTGUN SHELLS', rounds: 8, blurb: 'Coachgun — 12-bore buck' },
  { id: 'ammo_rifle', name: 'RIFLE AMMO', rounds: 30, blurb: 'Foundry gun — boxed rounds' },
  { id: 'ammo_sniper', name: 'SNIPER ROUNDS', rounds: 5, blurb: 'Long rifle — match grade' },
];

/**
 * The stock list. `stock` is what the machine physically has: the sentry is
 * limited to two, the ammunition is not limited at all (Infinity), and the
 * placeholder cannot be bought at any price.
 */
export const SHOP_STOCK = [
  {
    id: 'sentry', name: 'PORTABLE SENTRY', price: 100, stock: 2, bay: 'hardware',
    blurb: 'Tripod auto-pistol. Covers a 180° arc, sixty feet out. Folds into the satchel.',
    buy: (events) => events.emit('pickup', { type: 'sentry', amount: 1, label: 'Portable Sentry' }),
  },
  ...AMMO_LINES.map((a) => ({
    id: a.id, name: a.name, price: AMMO_PRICE, stock: Infinity, bay: 'ammo',
    blurb: a.blurb, rounds: a.rounds,
    buy: (events) => events.emit('pickup', { type: a.id, amount: a.rounds, label: a.name }),
  })),
  {
    id: 'comingSoon', name: 'COMING SOON', price: null, stock: 0, bay: 'soon',
    blurb: 'The bay is wired and the card is printed. Whatever goes in it has not arrived.',
    locked: true,
  },
];

export class ShopUI {
  /**
   * @param root   the HUD element to mount on
   * @param texLib the shared texture library (the model wants its paint)
   * @param cb     { canOpen, onOpen, onClose, onBuy(entry), tokens() }
   */
  constructor(root, texLib, cb = {}) {
    this.cb = cb;
    this.texLib = texLib;
    this.open = false;
    this.selected = SHOP_STOCK[0].id;
    this.sold = new Map();      // id -> how many have gone this run
    this._build(root);
    this._wire();
  }

  /* ---------------- the case ---------------- */

  _build(root) {
    this.el = document.createElement('div');
    this.el.id = 'shop';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="shop-case">
        <div class="screw tl"></div><div class="screw tr"></div>
        <div class="screw bl"></div><div class="screw br"></div>
        <div class="shop-head">
          <span class="shop-title">TRADING POST</span>
          <span class="shop-sub">EASTGATE — COIN OPERATED</span>
        </div>
        <div class="shop-body">
          <div class="shop-stage">
            <canvas class="shop-vendor" width="300" height="420"></canvas>
            <div class="shop-stage-glass"></div>
            <div class="shop-plate">THE PROPRIETOR</div>
            <div class="shop-say"></div>
          </div>
          <div class="shop-bays"></div>
        </div>
        <div class="shop-foot">
          <span class="shop-till">TOKENS <b>0</b></span>
          <span class="shop-hint">CLICK TO BUY</span>
          <button type="button" class="shop-close">STEP BACK &nbsp;[ESC]</button>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.baysEl = this.el.querySelector('.shop-bays');
    this.tillEl = this.el.querySelector('.shop-till b');
    this.sayEl = this.el.querySelector('.shop-say');
    this.canvas = this.el.querySelector('.shop-vendor');
    this.closeBtn = this.el.querySelector('.shop-close');

    // Three bubbled bays, in the order a customer reads them.
    this.bays = {};
    for (const [key, title, note] of [
      ['hardware', 'HARDWARE', 'THE ONLY THING WORTH THE WALK'],
      ['ammo', 'AMMUNITION', 'PER CRATE — ALL TYPES STOCKED'],
      ['soon', 'RESERVED', 'NOT FOR SALE'],
    ]) {
      const bay = document.createElement('div');
      bay.className = 'shop-bay bay-' + key;
      bay.innerHTML = `<div class="bay-head"><span class="bay-title">${title}</span>`
        + `<span class="bay-note">${note}</span></div><div class="bay-items"></div>`;
      this.baysEl.appendChild(bay);
      this.bays[key] = bay.querySelector('.bay-items');
    }
    this._renderStock();
  }

  /* ---------------- the live model ---------------- */

  /**
   * The vendor's stage: its own renderer on its own canvas.
   *
   * Built lazily on first open, because a second WebGL context is not free and
   * a run that never finds the shop should never pay for one. If the browser
   * refuses the context (software rendering, too many contexts), the stage
   * quietly stays empty and the rest of the shop still works — a shop you
   * cannot buy from because the portrait failed would be a much worse bug
   * than a shop with a blank frame in it.
   */
  _ensureStage() {
    if (this.stage !== undefined) return this.stage;
    this.stage = null;
    try {
      const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(this.canvas.width, this.canvas.height, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, this.canvas.width / this.canvas.height, 0.05, 12);
      // Framed on the WHOLE machine, with air over the hat.
      //
      // The frame is portrait and the lens is long, so the distance is what
      // decides whether the hat survives: the visible height at range d is
      // 2·d·tan(fov/2), which has to clear VENDOR_H with margin or the top of
      // the figure is cropped off — which is exactly what a close, narrow set-
      // up did. Backed off to 2.5 m at 42°, the frame is ~1.9 m tall, so the
      // machine sits in it with headroom and its feet still on the bottom edge.
      camera.position.set(0.12, VENDOR_H * 0.72, 2.5);
      camera.lookAt(0, VENDOR_H * 0.50, 0);
      // Counter lighting: a warm key from the kiosk lamp above and to the
      // left, a cold fill off the street, and enough ambient that the enamel
      // never crushes to black.
      scene.add(new THREE.HemisphereLight(0xd8e2f0, 0x2a2418, 1.0));
      const key = new THREE.DirectionalLight(0xffd9a0, 2.1);
      key.position.set(-0.8, 1.6, 1.1);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88a4d0, 0.9);
      rim.position.set(1.2, 0.7, -0.9);
      scene.add(rim);
      scene.add(new THREE.AmbientLight(0x5a5646, 0.9));
      const lamp = new THREE.PointLight(0xffc078, 3.0, 3.2, 2);
      lamp.position.set(0, VENDOR_H + 0.45, 0.5);
      scene.add(lamp);

      const rig = buildVendorModel(this.texLib);
      scene.add(rig.group);
      const anim = new VendorAnimator(rig);
      anim.setState('deal');
      this.stage = { renderer, scene, camera, rig, anim, t: 0 };
    } catch {
      this.stage = null;   // no second context available; the bays still work
    }
    return this.stage;
  }

  /* ---------------- stock ---------------- */

  /**
   * How many of this line the machine still has.
   *
   * Public, because the STOCK RULE has to live wherever the money changes
   * hands rather than in the button that usually starts it: the till (see
   * Game._buy) asks this before it takes payment, so a sale that comes from
   * anywhere else — a shortcut key, a console command, a later feature —
   * cannot walk past a sold-out bay and be charged for it anyway.
   */
  remaining(entry) {
    if (entry.locked) return 0;
    if (entry.stock === Infinity) return Infinity;
    return Math.max(0, entry.stock - (this.sold.get(entry.id) ?? 0));
  }

  /** Book a sale against the stock. Called by the till, once, on success. */
  noteSold(entry) {
    if (!entry || entry.stock === Infinity) return;
    this.sold.set(entry.id, (this.sold.get(entry.id) ?? 0) + 1);
    if (this.open) this._renderStock();
  }

  _renderStock() {
    for (const key of Object.keys(this.bays)) this.bays[key].innerHTML = '';
    for (const e of SHOP_STOCK) {
      const left = this.remaining(e);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'shop-item' + (e.locked ? ' locked' : '') + (left === 0 && !e.locked ? ' out' : '');
      row.dataset.id = e.id;
      const price = e.locked ? '—' : String(e.price);
      const stock = e.locked ? 'SOON' : left === Infinity ? 'IN STOCK' : left > 0 ? `${left} LEFT` : 'SOLD OUT';
      row.innerHTML = `
        <canvas class="shop-icon" width="52" height="52"></canvas>
        <span class="shop-item-text">
          <span class="shop-item-name">${e.name}</span>
          <span class="shop-item-blurb">${e.blurb}</span>
        </span>
        <span class="shop-item-buy">
          <span class="shop-price">${price}</span>
          <span class="shop-stock">${stock}</span>
        </span>`;
      this.bays[e.bay].appendChild(row);
      this._drawIcon(row.querySelector('.shop-icon'), e);
    }
    this._syncAfford();
  }

  /** Grey out what the purse cannot reach, so the price is honest on sight. */
  _syncAfford() {
    const tokens = this.cb.tokens?.() ?? 0;
    for (const row of this.el.querySelectorAll('.shop-item')) {
      const e = SHOP_STOCK.find((s) => s.id === row.dataset.id);
      if (!e || e.locked) continue;
      row.classList.toggle('poor', tokens < e.price);
    }
    if (this.tillEl) this.tillEl.textContent = String(tokens);
  }

  /**
   * The item icons, drawn rather than sprited: the shop is a UI, so its art is
   * UI art — line-drawn on the same amber/tan ink as every other readout.
   */
  _drawIcon(cv, entry) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 52, 52);
    ctx.lineWidth = 2;
    if (entry.id === 'sentry') {
      ctx.strokeStyle = '#8f9a6a';
      ctx.beginPath();
      ctx.moveTo(26, 30); ctx.lineTo(14, 45); ctx.moveTo(26, 30); ctx.lineTo(38, 45); ctx.moveTo(26, 30); ctx.lineTo(26, 44);
      ctx.stroke();
      ctx.fillStyle = '#6d7a4c'; ctx.fillRect(19, 21, 15, 10);
      ctx.fillStyle = '#e0b840'; ctx.fillRect(17, 18, 19, 3);
      ctx.fillStyle = '#8f9a6a'; ctx.fillRect(20, 9, 13, 9);
      ctx.fillStyle = '#3a3d42'; ctx.fillRect(32, 11, 15, 4);
      ctx.fillStyle = '#ffd24a'; ctx.fillRect(21, 5, 4, 4);
      return;
    }
    if (entry.id === 'comingSoon') {
      ctx.strokeStyle = '#7a7458';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(8, 8, 36, 36);
      ctx.setLineDash([]);
      ctx.fillStyle = '#7a7458';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 26, 27);
      return;
    }
    // ammunition: the same silhouettes as the world pickups, in line art
    const brass = '#c8a04a', bright = '#e8c878', dark = '#3a3d42';
    if (entry.id === 'ammo_shotgun') {
      for (let i = 0; i < 3; i++) {
        const x = 12 + i * 10;
        ctx.fillStyle = '#a83a30'; ctx.fillRect(x, 10, 7, 22);
        ctx.fillStyle = brass; ctx.fillRect(x, 30, 7, 10);
      }
    } else if (entry.id === 'ammo_rifle') {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(18, 16); ctx.lineTo(30, 16); ctx.lineTo(36, 44); ctx.lineTo(24, 44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5b6068'; ctx.fillRect(17, 12, 14, 4);
      ctx.fillStyle = brass; ctx.fillRect(22, 4, 5, 9);
      ctx.fillStyle = bright; ctx.fillRect(22, 2, 5, 3);
    } else if (entry.id === 'ammo_sniper') {
      for (let i = 0; i < 3; i++) {
        const x = 12 + i * 10;
        ctx.fillStyle = brass; ctx.fillRect(x, 18, 6, 24);
        ctx.fillStyle = '#9a8464';
        ctx.beginPath();
        ctx.moveTo(x, 18); ctx.lineTo(x + 3, 6); ctx.lineTo(x + 6, 18);
        ctx.closePath(); ctx.fill();
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const x = 9 + i * 9;
        ctx.fillStyle = brass; ctx.fillRect(x, 22, 6, 16);
        ctx.fillStyle = '#cfd2cc';
        ctx.beginPath();
        ctx.moveTo(x, 22); ctx.lineTo(x + 3, 13); ctx.lineTo(x + 6, 22);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#8a8470'; ctx.fillRect(7, 38, 38, 6);
    }
  }

  /* ---------------- input ---------------- */

  _wire() {
    this.baysEl.addEventListener('click', (e) => {
      const row = e.target.closest('.shop-item');
      if (!row) return;
      this._tryBuy(row.dataset.id);
    });
    // Two CLICK ways out, and they are not decoration.
    //
    // A browser only hands the pointer back to a page that asks for it while
    // it holds user activation, and a click is the cleanest activation there
    // is — so leaving by the button or by clicking off the case recaptures the
    // mouse instantly and without fail. Escape (below) cannot promise that on
    // its own, because Escape grants no activation at all.
    this.closeBtn.addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });

    // Capture phase, and stopped dead: leaving the counter must put the player
    // back in the street with the mouse, never in front of the pause screen.
    document.addEventListener('keydown', (e) => {
      // `repeat` matters here: the counter is OPENED by holding a key down for
      // one frame, and an auto-repeat of that same key half a second later
      // would otherwise close it again under the player's finger.
      if (!this.open || e.repeat) return;
      // Escape, and the interact key that opened it. The second is here for a
      // real reason rather than for symmetry: an ORDINARY key press carries
      // user activation where Escape does not, so leaving with the same key
      // you arrived with is the exit that always gets the mouse back on the
      // spot.
      //
      // Tab is deliberately NOT one of them. The satchel owns Tab, it listens
      // in the capture phase too, and it is registered first — so closing on
      // Tab here meant the one keypress opened the satchel AND shut the shop,
      // leaving the player in an inventory they never asked for. The satchel
      // simply declines to open at the counter instead (see Game.load).
      if (e.code === 'Escape' || e.code === this.cb.interactCode?.()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        return;
      }
      // Number keys buy the nth line, for a player who would rather not aim a
      // cursor at a menu in the middle of a wave.
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const entry = SHOP_STOCK[+n[1] - 1];
        if (entry) this._tryBuy(entry.id);
      }
    }, true);
  }

  /**
   * A line was clicked. The refusals here are only about what to SAY — the
   * till itself re-checks every one of them, so this cannot sell anything the
   * transaction would not have allowed anyway.
   */
  _tryBuy(id) {
    const entry = SHOP_STOCK.find((s) => s.id === id);
    if (!entry) return;
    if (entry.locked) { this._say('That bay is not stocked. Come back when it is.'); return; }
    if (this.remaining(entry) <= 0) { this._say('That was the last one. There are no more.'); return; }
    const ok = this.cb.onBuy?.(entry);
    if (!ok) { this._say('Tokens, friend. You are short.'); this._syncAfford(); return; }
    this._say(entry.id === 'sentry'
      ? 'It comes folded. Mind where you set it down.'
      : 'Loaded and counted. Try not to need it.');
    this._renderStock();
  }

  _say(text) {
    this.sayEl.textContent = text;
    this.sayEl.classList.remove('on');
    void this.sayEl.offsetWidth;      // restart the fade
    this.sayEl.classList.add('on');
  }

  /* ---------------- lifecycle ---------------- */

  openShop() {
    if (this.open) return false;
    if (this.cb.canOpen && !this.cb.canOpen()) return false;
    this.open = true;
    this.el.style.display = 'flex';
    this._ensureStage();
    this._renderStock();
    this._say('Tokens on the counter. Everything is priced.');
    this.cb.onOpen?.();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.style.display = 'none';
    this.cb.onClose?.();
  }

  /** Called every frame by the host, open or not — the stage only draws when
   *  it is being looked at. */
  update(dt) {
    if (!this.open) return;
    this._syncAfford();
    const s = this.stage;
    if (!s) return;
    s.t += dt;
    // The machine looks at the customer: dead ahead, with a slow drift so it
    // is not a mannequin staring down the lens.
    s.anim.update(dt, { yaw: Math.sin(s.t * 0.5) * 0.16, pitch: -0.06 + Math.sin(s.t * 0.31) * 0.03 });
    s.renderer.render(s.scene, s.camera);
  }

  /** Tell the shop a purchase landed, so the vendor on the stage reacts. */
  pokeVendor(kind) {
    this.stage?.anim.poke(kind);
  }

  /** New run: the machine restocks. */
  resetStock() {
    this.sold.clear();
    if (this.open) this._renderStock();
  }
}
