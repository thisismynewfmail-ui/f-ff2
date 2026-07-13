/**
 * The player portrait for the console HUD — the pip-boy-style face in the
 * centre CRT monitor.
 *
 * Loads the five provided head images from player_imgs/, chroma-keys the
 * bright green field to transparency at load time, and renders the current
 * head to a canvas over a green CRT background (scanlines + glow + vignette),
 * matching the reference HUD's monitor look.
 *
 * Health drives which head shows:
 *   HP > 50%   — the "looking around" set (forward / left / right), idled with
 *                well-spaced glances so the face isn't in constant motion
 *   25% < ≤50% — the stern below-50 head, static (no side variants exist)
 *   ≤ 25%      — the drained below-25 head, static
 *
 * Only the >50% band animates, exactly because the lower-health heads have no
 * left/right variants.
 */
const SRC = {
  forward: 'player_imgs/fullhealth_looking_forwards_default.png',
  left: 'player_imgs/fullhealth_looking_left.png',
  right: 'player_imgs/fullhealth_looking_right.png',
  hurt: 'player_imgs/fullhealth_looking_below_50_health.png',
  critical: 'player_imgs/fullhealth_looking_below25_health.png',
};

export class Portrait {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyed = {};        // name -> keyed offscreen canvas
    this.ready = false;
    this._loaded = 0;

    // idle look-around state (only used above 50% HP)
    this.pose = 'forward';
    this._glanceTimer = 2.2 + Math.random() * 1.5;
    this._glanceHold = 0;

    this._t = 0;
    this._hpFrac = 1;

    for (const [name, url] of Object.entries(SRC)) {
      const img = new Image();
      img.onload = () => { this.keyed[name] = keyGreen(img); this._loaded++; if (this._loaded >= 5) this.ready = true; };
      img.onerror = () => { this._loaded++; if (this._loaded >= 5) this.ready = true; };
      img.src = url;
    }
  }

  setHealth(frac) { this._hpFrac = frac; }

  /** Advance the idle glance timer (only meaningful above 50% HP). */
  update(dt) {
    this._t += dt;
    if (this._hpFrac > 0.5) {
      if (this._glanceHold > 0) {
        this._glanceHold -= dt;
        if (this._glanceHold <= 0) { this.pose = 'forward'; this._glanceTimer = 2.4 + Math.random() * 2.2; }
      } else {
        this._glanceTimer -= dt;
        if (this._glanceTimer <= 0) {
          const r = Math.random();
          this.pose = r < 0.5 ? 'left' : 'right';   // occasional glance
          this._glanceHold = 0.7 + Math.random() * 0.6;
        }
      }
    } else {
      this.pose = 'forward';
      this._glanceHold = 0; this._glanceTimer = 2.4;
    }
    this._render();
  }

  _headName() {
    if (this._hpFrac <= 0.25) return 'critical';
    if (this._hpFrac <= 0.5) return 'hurt';
    return this.pose; // forward / left / right
  }

  _render() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    // CRT background — a dark green tube with a soft central glow
    const glow = this._hpFrac <= 0.25 ? '#3a1414' : this._hpFrac <= 0.5 ? '#3a3410' : '#14361c';
    const base = this._hpFrac <= 0.25 ? '#160707' : '#08160c';
    const g = c.createRadialGradient(W / 2, H * 0.46, H * 0.1, W / 2, H * 0.5, H * 0.8);
    g.addColorStop(0, glow); g.addColorStop(1, base);
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    const head = this.keyed[this._headName()];
    if (head) {
      // draw the keyed head centred, head-and-shoulders crop
      const scale = (W / head.width) * 1.18;
      const dw = head.width * scale, dh = head.height * scale;
      const dx = (W - dw) / 2, dy = H - dh + H * 0.06;
      c.imageSmoothingEnabled = true;
      c.globalAlpha = 0.98;
      c.drawImage(head, dx, dy, dw, dh);
      c.globalAlpha = 1;
      // faint monochrome wash so it reads as a monitor feed without hiding
      // the face — green normally, amber when hurt, red when critical
      c.globalCompositeOperation = 'overlay';
      c.fillStyle = this._hpFrac <= 0.25 ? 'rgba(170,50,36,0.22)'
        : this._hpFrac <= 0.5 ? 'rgba(150,150,40,0.16)' : 'rgba(80,200,120,0.15)';
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    } else {
      c.fillStyle = '#2a6a3c'; c.font = `${Math.round(H * 0.2)}px monospace`;
      c.textAlign = 'center'; c.fillText('◌', W / 2, H * 0.58);
    }

    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    // flicker + vignette
    c.fillStyle = `rgba(120,255,160,${0.02 + 0.015 * Math.sin(this._t * 9)})`;
    c.fillRect(0, 0, W, H);
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }
}

/** Return an offscreen canvas with the bright-green field keyed transparent. */
function keyGreen(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 512; c.height = img.naturalHeight || 512;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  let data;
  try { data = ctx.getImageData(0, 0, c.width, c.height); } catch { return c; }
  const d = data.data;
  // sample the top-left corner as the key colour
  const kr = d[0], kg = d[1], kb = d[2];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // green-dominant field close to the sampled key → transparent, with a
    // soft edge so hair strands don't fringe
    const greenish = g > r * 1.12 && g > b * 1.12 && g > 70;
    const near = Math.abs(r - kr) < 70 && Math.abs(g - kg) < 80 && Math.abs(b - kb) < 70;
    if (greenish && near) {
      d[i + 3] = 0;
    } else if (greenish) {
      d[i + 3] = Math.min(d[i + 3], 150); // soft fringe
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}
