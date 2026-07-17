/**
 * Boot / loading screen — "MAPPING TEXTURE MEMORY".
 *
 * The centrepiece is a mathematically honest novelty: a HILBERT SPACE-FILLING
 * CURVE (order 6 — 4,096 cells) walked in step with real loading progress.
 * Each texture that finishes loading advances the walk; the curve visits every
 * cell of the 64x64 "memory page" exactly once while preserving locality
 * (neighbouring indices are neighbouring cells), which is exactly how real
 * GPU texture swizzles/mip layouts use these curves — so the picture IS the
 * metaphor: texture bytes being laid into memory, address by address.
 *
 * The walk is drawn incrementally onto a persistent backing canvas (only new
 * segments are drawn each frame), tinted along a phosphor→ember gradient by
 * address, with a glowing read head and the live cell's block "committed"
 * behind the line. On completion the head detonates into a golden-angle
 * phyllotaxis burst (r = c·√i, θ = i·137.5°) and the screen hands over to the
 * title menu.
 *
 * API: setProgress(0..1), setStage(text), tickAsset(name), finish() -> Promise,
 * fail(message), destroy().
 */
const ORDER = 64;             // cells per side — 4,096 total
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.507°

export class LoadingScreen {
  constructor(root, manifest = []) {
    this.root = root;
    this.manifest = manifest;
    this.target = 0;          // real load progress
    this.shown = 0;           // eased, displayed progress
    this.drawnIdx = 0;        // last Hilbert index committed to the backing canvas
    this._dead = false;
    this._finishing = null;
    this._burstT = -1;
    this._tickerLines = [];
    this._assetIdx = 0;

    // precompute the full walk once: index -> cell (x, y)
    this.points = new Array(ORDER * ORDER);
    for (let d = 0; d < this.points.length; d++) this.points[d] = d2xy(ORDER, d);

    this._build();
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _build() {
    this.root.innerHTML = `
      <div class="boot-frame">
        <div class="boot-kicker">SANDBOX DEFENSE NETWORK <span>//</span> BOOT SEQUENCE 2.5</div>
        <div class="boot-title">GO BACK TO THE <em>SANDBOX</em></div>
        <div class="boot-canvas-wrap">
          <canvas class="boot-canvas" width="512" height="512"></canvas>
          <div class="boot-corner tl"></div><div class="boot-corner tr"></div>
          <div class="boot-corner bl"></div><div class="boot-corner br"></div>
        </div>
        <div class="boot-readout">
          <span class="boot-pct">0%</span>
          <span class="boot-stage">LOADING TEXTURES</span>
        </div>
        <div class="boot-caption">HILBERT WALK · ORDER 6 · 4096 CELLS — TEXTURE BYTES MAPPED TO A LOCALITY-PRESERVING CURVE</div>
        <div class="boot-ticker"></div>
      </div>`;
    this.canvas = this.root.querySelector('.boot-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pctEl = this.root.querySelector('.boot-pct');
    this.stageEl = this.root.querySelector('.boot-stage');
    this.tickerEl = this.root.querySelector('.boot-ticker');

    // persistent path layer — segments are drawn once and kept
    this.pathCv = document.createElement('canvas');
    this.pathCv.width = this.canvas.width;
    this.pathCv.height = this.canvas.height;
    this.pathCtx = this.pathCv.getContext('2d');
  }

  /** Real progress from the asset loader (0..1). */
  setProgress(frac) {
    this.target = Math.max(this.target, Math.min(1, frac));
    // one manifest line per asset-sized step of progress
    const idx = Math.floor(this.target * this.manifest.length);
    while (this._assetIdx < idx && this._assetIdx < this.manifest.length) {
      this.tickAsset(this.manifest[this._assetIdx++]);
    }
  }

  setStage(text) { if (!this._dead) this.stageEl.textContent = text; }

  /** Append a manifest line to the ticker: [address] name ▸ OK. */
  tickAsset(name) {
    if (this._dead) return;
    const addr = ((this._tickerLines.length + 1) * 0x9e37) & 0xffff; // golden-ratio hash
    this._tickerLines.push(
      `<div><b>0x${addr.toString(16).padStart(4, '0').toUpperCase()}</b> ${name} <i>▸ OK</i></div>`);
    while (this._tickerLines.length > 4) this._tickerLines.shift();
    this.tickerEl.innerHTML = this._tickerLines.join('');
  }

  /** Sweep to 100%, fire the phyllotaxis burst, fade out. */
  finish() {
    this.target = 1;
    this.setStage('TEXTURES RESIDENT · HANDOFF');
    this._finishing = {};
    return new Promise((resolve) => { this._finishing.resolve = resolve; });
  }

  fail(message) {
    this.setStage('FAILED: ' + message);
    this.stageEl.classList.add('boot-fail');
  }

  destroy() {
    this._dead = true;
    cancelAnimationFrame(this._raf);
    this.root.remove();
  }

  /* ---------------- drawing ---------------- */

  _frame(now) {
    if (this._dead) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;

    // ease the displayed progress toward the real one (faster when finishing)
    const rate = this._finishing ? 2.6 : 1.4;
    this.shown += (this.target - this.shown) * Math.min(1, dt * rate * 3);
    if (this._finishing && this.shown > 0.999) this.shown = 1;

    this._commitSegments();
    this._composite(now);

    this.pctEl.textContent = Math.floor(this.shown * 100) + '%';

    if (this._finishing && this.shown >= 1 && this._burstT < 0) this._burstT = 0;
    if (this._burstT >= 0) {
      this._burstT += dt;
      if (this._burstT > 0.95 && this._finishing.resolve) {
        this._finishing.resolve();
        this._finishing.resolve = null;
        this.root.classList.add('boot-out'); // CSS fade; caller destroys after
      }
    }
  }

  /** Draw any newly-visited cells + connecting segments onto the path layer. */
  _commitSegments() {
    const upto = Math.floor(this.shown * (this.points.length - 1));
    if (upto <= this.drawnIdx) return;
    const ctx = this.pathCtx;
    const pad = 22, span = this.canvas.width - pad * 2;
    const step = span / ORDER;
    const at = (i) => {
      const [x, y] = this.points[i];
      return [pad + (x + 0.5) * step, pad + (y + 0.5) * step];
    };
    for (let i = this.drawnIdx + 1; i <= upto; i++) {
      const t = i / this.points.length;
      const [x, y] = at(i);
      // committed memory block behind the line
      ctx.fillStyle = this._tint(t, 0.16);
      ctx.fillRect(x - step / 2 + 0.5, y - step / 2 + 0.5, step - 1, step - 1);
      // the walk itself
      const [px, py] = at(i - 1);
      ctx.strokeStyle = this._tint(t, 0.95);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    this.drawnIdx = upto;
  }

  /** Phosphor→ember gradient along the walk (address 0 → 4095). */
  _tint(t, a) {
    const h = 130 - t * 85;             // green ... gold-orange
    const l = 34 + t * 22;
    return `hsla(${h.toFixed(0)}, 62%, ${l.toFixed(0)}%, ${a})`;
  }

  _composite(now) {
    const ctx = this.ctx, W = this.canvas.width;
    ctx.clearRect(0, 0, W, W);

    // faint address grid under everything
    ctx.strokeStyle = 'rgba(120, 140, 110, 0.05)';
    ctx.lineWidth = 1;
    const pad = 22, span = W - pad * 2, cell8 = span / 8;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(pad + i * cell8, pad); ctx.lineTo(pad + i * cell8, W - pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, pad + i * cell8); ctx.lineTo(W - pad, pad + i * cell8); ctx.stroke();
    }

    ctx.drawImage(this.pathCv, 0, 0);

    // the read head: current end of the walk, glowing
    const step = span / ORDER;
    const [hx, hy] = this.points[this.drawnIdx];
    const x = pad + (hx + 0.5) * step, y = pad + (hy + 0.5) * step;
    const pulse = 0.7 + 0.3 * Math.sin(now / 90);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 13);
    g.addColorStop(0, `rgba(255, 244, 200, ${0.95 * pulse})`);
    g.addColorStop(0.35, `rgba(224, 184, 64, ${0.6 * pulse})`);
    g.addColorStop(1, 'rgba(224, 184, 64, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 14, y - 14, 28, 28);
    ctx.fillStyle = '#fff6d8';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);

    // completion: the head detonates into a golden-angle phyllotaxis burst
    if (this._burstT >= 0) {
      const bt = Math.min(1, this._burstT / 0.8);
      const n = Math.floor(bt * 240);
      const cx = W / 2, cy = W / 2;
      for (let i = 0; i < n; i++) {
        const r = 6.5 * Math.sqrt(i) * (0.4 + bt * 0.6);
        const a = i * GOLDEN_ANGLE;
        const fade = (1 - i / 240) * (1 - bt * 0.55);
        ctx.fillStyle = `rgba(224, 184, 64, ${(0.75 * fade).toFixed(3)})`;
        const s = 2.4 - (i / 240) * 1.4;
        ctx.fillRect(cx + Math.cos(a) * r - s / 2, cy + Math.sin(a) * r - s / 2, s, s);
      }
    }
  }
}

/** Hilbert curve: distance along the walk -> (x, y) on an n×n grid. */
function d2xy(n, d) {
  let rx, ry, t = d, x = 0, y = 0;
  for (let s = 1; s < n; s *= 2) {
    rx = 1 & (t >> 1);
    ry = 1 & (t ^ rx);
    if (ry === 0) {           // rotate the quadrant
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return [x, y];
}
