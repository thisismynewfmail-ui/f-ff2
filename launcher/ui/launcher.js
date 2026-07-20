'use strict';
/*
 * Launcher front-end + the boot progress animation.
 *
 * The animation is a HARMONOGRAPH: the curve a pair of coupled, damped
 * pendulums would trace on paper. Two pendulums drive the pen laterally and two
 * drive it in the other axis, each an exponentially decaying sinusoid, so the
 * plotted point is
 *
 *     x(t) = Σ Aₖ · sin(fₖ·t + φₖ) · e^(−dₖ·t)
 *     y(t) = Σ Bₖ · sin(gₖ·t + ψₖ) · e^(−eₖ·t)
 *
 * With frequency ratios sitting a hair off small integers (2:3, 3:2 …), the
 * figure precesses slowly and never quite repeats — the real, physical reason
 * antique harmonographs are hypnotic. The pen is revealed in step with actual
 * boot progress (server up, engine loaded, world built); at 100% the head
 * detonates into a golden-angle phyllotaxis bloom (r = c·√i, θ = i·137.5°) — the
 * same flourish the in-game loader ends on, so launcher and game rhyme.
 *
 * Parameters are re-rolled every launch, so no two boots draw the same figure.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.507°

const els = {
  play: document.getElementById('play'),
  status: document.getElementById('status'),
  build: document.getElementById('build'),
  firstNote: document.getElementById('firstrun-note'),
  boot: document.getElementById('boot'),
  bootMode: document.getElementById('boot-mode'),
  bootPct: document.getElementById('boot-pct'),
  bootStage: document.getElementById('boot-stage'),
  bootBar: document.getElementById('boot-bar-fill'),
  canvas: document.getElementById('boot-canvas'),
};

document.getElementById('tb-min').addEventListener('click', () => window.launcher.minimize());
document.getElementById('tb-close').addEventListener('click', () => window.launcher.close());

let info = { version: '—', firstRun: false, platform: 'win32' };

(async function init() {
  try {
    info = await window.launcher.info();
  } catch { /* keep defaults */ }
  els.build.textContent = 'BUILD ' + info.version;
  if (info.firstRun) {
    els.firstNote.textContent = '▸ FIRST LAUNCH — ONE-TIME SETUP RUNS AUTOMATICALLY';
  }
})();

els.play.addEventListener('click', startLaunch);

let launching = false;
async function startLaunch() {
  if (launching) return;
  launching = true;
  els.play.disabled = true;
  els.status.textContent = 'LAUNCHING…';

  const boot = new Harmonograph(els, info.firstRun);
  boot.start();

  // Kick the main process; it resolves once the engine window has loaded.
  window.launcher.launch()
    .then(() => boot.engineReady())
    .catch((err) => {
      boot.fail((err && err.message) || 'launch failed');
      els.status.textContent = 'FAILED';
      // Let the user retry.
      setTimeout(() => {
        boot.destroy();
        els.play.disabled = false;
        els.status.textContent = 'READY';
        launching = false;
      }, 2600);
    });

  // When the bloom completes, reveal the game and retire the launcher.
  boot.onComplete = () => window.launcher.reveal();
}

/* --------------------------------------------------------------------------
 * Harmonograph boot animation
 * ------------------------------------------------------------------------ */
class Harmonograph {
  constructor(els, firstRun) {
    this.els = els;
    this.firstRun = firstRun;
    this.canvas = els.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.W = this.canvas.width;
    this.H = this.canvas.height;

    this.target = 0;      // real progress ceiling
    this.shown = 0;       // eased, displayed progress
    this.drawnU = 0;      // param already committed to the path layer
    this._ready = false;  // engine finished loading?
    this._finishing = false;
    this._burstT = -1;
    this._dead = false;
    this._t0 = 0;
    this.onComplete = null;

    // How far along the pendulum's life we plot (seconds of simulated swing).
    this.TSPAN = 42;
    this._roll();

    // Persistent path layer — strokes are drawn once and kept.
    this.pathCv = document.createElement('canvas');
    this.pathCv.width = this.W; this.pathCv.height = this.H;
    this.pathCtx = this.pathCv.getContext('2d');

    els.boot.hidden = false;
    els.bootMode.textContent = firstRun ? 'FIRST-TIME SETUP' : 'STARTING';

    // Precompute the full pen path once (locality-preserving reveal later).
    this.N = 3600;
    this.pts = new Array(this.N);
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < this.N; i++) {
      const t = (i / (this.N - 1)) * this.TSPAN;
      const p = this._pen(t);
      this.pts[i] = p;
      if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
    }
    // Fit to canvas with padding.
    const pad = 34;
    const sx = (this.W - pad * 2) / Math.max(1e-6, maxx - minx);
    const sy = (this.H - pad * 2) / Math.max(1e-6, maxy - miny);
    const s = Math.min(sx, sy);
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    for (const p of this.pts) {
      p.px = this.W / 2 + (p.x - cx) * s;
      p.py = this.H / 2 + (p.y - cy) * s;
    }
  }

  _roll() {
    // Two near-resonant frequency pairs with tiny detune → slow precession.
    const rnd = (a, b) => a + Math.random() * (b - a);
    const base = rnd(1.9, 2.15);
    const detune = () => rnd(-0.035, 0.035);
    this.osc = {
      // x = lateral pendulum + a faster harmonic
      ax1: rnd(0.7, 1.0), fx1: base + detune(), px1: rnd(0, Math.PI * 2), dx1: rnd(0.012, 0.03),
      ax2: rnd(0.35, 0.6), fx2: base * rnd(1.98, 2.02) + detune(), px2: rnd(0, Math.PI * 2), dx2: rnd(0.02, 0.05),
      // y = rotary pendulum + harmonic
      ay1: rnd(0.7, 1.0), fy1: base * rnd(1.48, 1.52) + detune(), py1: rnd(0, Math.PI * 2), dy1: rnd(0.012, 0.03),
      ay2: rnd(0.35, 0.6), fy2: base * rnd(2.98, 3.02) + detune(), py2: rnd(0, Math.PI * 2), dy2: rnd(0.02, 0.05),
    };
  }

  _pen(t) {
    const o = this.osc;
    const x = o.ax1 * Math.sin(o.fx1 * t + o.px1) * Math.exp(-o.dx1 * t)
            + o.ax2 * Math.sin(o.fx2 * t + o.px2) * Math.exp(-o.dx2 * t);
    const y = o.ay1 * Math.sin(o.fy1 * t + o.py1) * Math.exp(-o.dy1 * t)
            + o.ay2 * Math.sin(o.fy2 * t + o.py2) * Math.exp(-o.dy2 * t);
    return { x, y };
  }

  start() {
    this._t0 = performance.now();
    this._last = this._t0;
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  engineReady() { this._ready = true; }

  fail(msg) {
    this.els.bootStage.textContent = 'FAILED: ' + msg;
    this.els.bootStage.classList.add('boot-fail');
    this._failed = true;
  }

  destroy() {
    this._dead = true;
    cancelAnimationFrame(this._raf);
    this.els.boot.hidden = true;
    this.els.boot.classList.remove('boot-out');
    this.els.bootStage.classList.remove('boot-fail');
    // reset the path layer for a possible retry
    this.pathCtx.clearRect(0, 0, this.W, this.H);
  }

  _stageLabel(v) {
    const first = this.firstRun;
    if (v < (first ? 0.15 : 0.2)) return first ? 'UNPACKING RUNTIME' : 'SPOOLING NETWORK';
    if (v < (first ? 0.32 : 0.45)) return first ? 'VERIFYING GAME FILES' : 'STARTING ENGINE';
    if (v < (first ? 0.52 : 0.7)) return first ? 'COMPILING SHADERS' : 'MAPPING TEXTURE MEMORY';
    if (v < 0.9) return 'BUILDING THE TOWN';
    return 'TEXTURES RESIDENT · HANDOFF';
  }

  _frame(now) {
    if (this._dead) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const elapsed = (now - this._t0) / 1000;

    if (!this._failed) {
      // Pre-ready: ease toward a 0.9 asymptote so the bar always breathes even
      // while we wait on the engine. A minimum on-screen time keeps the figure
      // legible instead of flashing past.
      const minShow = this.firstRun ? 2.6 : 1.7;
      if (this._ready && elapsed >= minShow) this._finishing = true;
      const cap = this._finishing ? 1 : 0.9;
      const tau = this.firstRun ? 1.5 : 1.1;
      const asymptote = this._finishing ? 1 : 0.9 * (1 - Math.exp(-elapsed / tau));
      this.target = Math.min(cap, Math.max(this.target, asymptote));
    }

    const rate = this._finishing ? 3.4 : 1.8;
    this.shown += (this.target - this.shown) * Math.min(1, dt * rate);
    if (this._finishing && this.shown > 0.999) this.shown = 1;

    this._commit();
    this._composite(now);

    const pct = Math.floor(this.shown * 100);
    this.els.bootPct.textContent = pct + '%';
    this.els.bootBar.style.width = pct + '%';
    if (!this._failed) this.els.bootStage.textContent = this._stageLabel(this.shown);

    if (this._finishing && this.shown >= 1 && this._burstT < 0) this._burstT = 0;
    if (this._burstT >= 0) {
      this._burstT += dt;
      if (this._burstT > 0.85 && this.onComplete) {
        const cb = this.onComplete; this.onComplete = null;
        this.els.boot.classList.add('boot-out');
        cb();
      }
    }
  }

  /** Commit newly-revealed pen segments onto the persistent path layer. */
  _commit() {
    const upto = Math.floor(this.shown * (this.N - 1));
    if (upto <= this.drawnU) return;
    const ctx = this.pathCtx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = this.drawnU + 1; i <= upto; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const t = i / this.N;
      // soft afterglow
      ctx.strokeStyle = this._tint(t, 0.10);
      ctx.lineWidth = 5.5;
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      // bright core
      ctx.strokeStyle = this._tint(t, 0.92);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    }
    this.drawnU = upto;
  }

  /** phosphor-green → ember gradient along the pen's life. */
  _tint(t, a) {
    const h = 140 - t * 96;      // green → gold/amber
    const l = 46 + t * 12;
    return `hsla(${h.toFixed(0)}, 70%, ${l.toFixed(0)}%, ${a})`;
  }

  _composite(now) {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    // faint polar reticle
    ctx.strokeStyle = 'rgba(124, 255, 155, 0.05)';
    ctx.lineWidth = 1;
    const cx = W / 2, cy = H / 2;
    for (let r = 40; r < W / 2; r += 46) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * (W / 2 - 20), cy + Math.sin(a) * (H / 2 - 20));
      ctx.stroke();
    }

    ctx.drawImage(this.pathCv, 0, 0);

    // glowing pen head at the current end of the plotted curve
    if (this.drawnU > 0 && this._burstT < 0) {
      const p = this.pts[this.drawnU];
      const pulse = 0.7 + 0.3 * Math.sin(now / 90);
      const g = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, 15);
      g.addColorStop(0, `rgba(255, 246, 216, ${0.95 * pulse})`);
      g.addColorStop(0.4, `rgba(224, 184, 64, ${0.55 * pulse})`);
      g.addColorStop(1, 'rgba(224, 184, 64, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.px, p.py, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath(); ctx.arc(p.px, p.py, 1.8, 0, Math.PI * 2); ctx.fill();
    }

    // completion bloom: golden-angle phyllotaxis burst
    if (this._burstT >= 0) {
      const bt = Math.min(1, this._burstT / 0.8);
      const n = Math.floor(bt * 260);
      for (let i = 0; i < n; i++) {
        const r = 7 * Math.sqrt(i) * (0.4 + bt * 0.6);
        const a = i * GOLDEN_ANGLE;
        const fade = (1 - i / 260) * (1 - bt * 0.5);
        ctx.fillStyle = `rgba(224, 184, 64, ${(0.78 * fade).toFixed(3)})`;
        const s = 2.6 - (i / 260) * 1.5;
        ctx.fillRect(cx + Math.cos(a) * r - s / 2, cy + Math.sin(a) * r - s / 2, s, s);
      }
    }
  }
}
