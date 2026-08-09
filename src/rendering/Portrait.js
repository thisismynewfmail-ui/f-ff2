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
 *
 * On top of the pose, the TUBE itself is alive. A monitor feed that holds
 * perfectly still reads as a photograph pasted behind glass, so the tube gets
 * the four artefacts a real one has, all of them deliberately faint: a retrace
 * band drifting down the screen, scanlines that crawl rather than sit, a slow
 * breath in the phosphor glow, and — rarely — a sync tick that snaps the
 * picture sideways for a frame or two and brightens as it recovers. None of it
 * is allowed to obscure the face; it is there to make the face look LIVE.
 */
import { assetUrl } from './assetUrl.js';
import { unmatteFringe } from './TextureLib.js';

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
    // the tube's own life (see _render): retrace drift and the next sync tick
    this._roll = Math.random();
    this._syncIn = 6 + Math.random() * 8;
    this._syncFor = 0;

    for (const [name, url] of Object.entries(SRC)) {
      const img = new Image();
      img.onload = () => { this.keyed[name] = keyGreen(img); this._loaded++; if (this._loaded >= 5) this.ready = true; };
      img.onerror = () => { this._loaded++; if (this._loaded >= 5) this.ready = true; };
      // Cache-bust so an edited portrait PNG is re-fetched on reload.
      img.src = assetUrl(url);
    }
  }

  setHealth(frac) { this._hpFrac = frac; }

  /** Advance the idle glance timer (only meaningful above 50% HP). */
  update(dt) {
    this._t += dt;
    // the retrace band drifts down the tube once every ~6.5s, forever
    this._roll = (this._roll + dt / 6.5) % 1;
    // ...and every so often the picture loses sync for a couple of frames
    if (this._syncFor > 0) this._syncFor -= dt;
    else if ((this._syncIn -= dt) <= 0) {
      this._syncFor = 0.09 + Math.random() * 0.08;
      this._syncIn = 7 + Math.random() * 11;
    }
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
    const t = this._t;
    // The tube breathes: the phosphor glow swells and settles on two beats
    // that do not divide into each other, so it never looks like a loop.
    const breath = 1 + 0.05 * Math.sin(t * 1.7) + 0.03 * Math.sin(t * 0.63 + 1.2);
    // A sync tick throws the picture sideways and floods the gun for an
    // instant. `slip` is 1 at the start of the tick and eases out.
    const slip = this._syncFor > 0 ? this._syncFor / 0.17 : 0;

    // CRT background — a dark green tube with a soft central glow
    const glow = this._hpFrac <= 0.25 ? '#3a1414' : this._hpFrac <= 0.5 ? '#3a3410' : '#14361c';
    const base = this._hpFrac <= 0.25 ? '#160707' : '#08160c';
    const g = c.createRadialGradient(W / 2, H * 0.46, H * 0.1 * breath, W / 2, H * 0.5, H * 0.8);
    g.addColorStop(0, glow); g.addColorStop(1, base);
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    const head = this.keyed[this._headName()];
    if (head) {
      // draw the keyed head centred, head-and-shoulders crop
      const scale = (W / head.width) * 1.18;
      const dw = head.width * scale, dh = head.height * scale;
      // a hair of horizontal wander, plus the sync tick when one is running
      const wander = Math.sin(t * 0.83) * 0.5 + Math.sin(t * 0.31 + 2.1) * 0.35;
      const dx = (W - dw) / 2 + wander + slip * 3.5;
      const dy = H - dh + H * 0.06;
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

    // Scanlines that CRAWL. One pixel of phase drift is the difference
    // between a tube that is scanning and a texture of stripes.
    const phase = Math.floor(t * 5) % 3;
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = -3 + phase; y < H; y += 3) if (y >= 0) c.fillRect(0, y, W, 1);

    // The retrace band: a soft bright seam sliding down the picture. Kept
    // under 5% so it reads as the tube working, not as a wipe.
    const by = (this._roll * (H + 26)) - 13;
    const band = c.createLinearGradient(0, by - 9, 0, by + 9);
    band.addColorStop(0, 'rgba(150,255,180,0)');
    band.addColorStop(0.5, 'rgba(150,255,180,0.045)');
    band.addColorStop(1, 'rgba(150,255,180,0)');
    c.fillStyle = band; c.fillRect(0, by - 9, W, 18);
    c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(0, by + 8, W, 1);

    // flicker (now on the breath) + the sync tick's flash + vignette
    c.fillStyle = `rgba(120,255,160,${(0.018 + 0.012 * Math.sin(t * 9) + slip * 0.05).toFixed(4)})`;
    c.fillRect(0, 0, W, H);
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }
}

/**
 * Return an offscreen canvas with the green screen keyed out — and, crucially,
 * with the MATTE it leaves behind undone.
 *
 * The portraits are art shot against a flat green field, so every texel along
 * the silhouette is a blend of the art and that green: c = a·K + (1−a)·S.
 * Clearing the pixels that read as "green enough" removes the field and leaves
 * the tail of that blend standing — texels with real coverage but a colour
 * washed toward the key. On the tube's dark ground those washed texels are
 * brighter than everything around them, which is the pale outline that used to
 * run all the way round the hair and shoulders. Softening their alpha does not
 * help: a half-transparent green-lit texel is still a green-lit texel.
 *
 * So it is solved the same way the sprite sheets solve their white matte —
 * unmatteFringe recovers each rim texel's true colour and coverage from the
 * core art behind it — and the two now share that code rather than each
 * carrying its own half of the fix.
 *
 * The key colour is read from the border ring rather than from one corner: a
 * single pixel is one JPEG artefact away from being wrong, and a wrong key is
 * a portrait that keeps its background.
 */
function keyGreen(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 512; c.height = img.naturalHeight || 512;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let data;
  try { data = ctx.getImageData(0, 0, c.width, c.height); } catch { return c; }
  const d = data.data;
  const w = c.width, h = c.height;

  // --- the key: the median border pixel, which is the field by definition
  const rs = [], gs = [], bs = [];
  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  };
  for (let x = 0; x < w; x += 4) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += 4) { sample(0, y); sample(w - 1, y); }
  const mid = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const key = [mid(rs), mid(gs), mid(bs)];

  /**
   * Flood the field from the border. Two conditions, and both earn their keep:
   *
   * GREEN DOMINANCE, not proximity in RGB. A plain "within N of the key on
   * every channel" box is wide enough to swallow lit skin — (200,180,150) sits
   * inside it — so the fill leaks through the silhouette and eats holes in the
   * face. Requiring green to LEAD the other two by a clear margin cannot: skin
   * and hair are red-dominant whatever their brightness.
   *
   * And a flood rather than a global test, so a green in the ART — an eye, a
   * print on a shirt — is never cleared just for being green.
   */
  const near = (i) => d[i + 1] - Math.max(d[i], d[i + 2]) >= 30
    && Math.abs(d[i] - key[0]) < 60
    && Math.abs(d[i + 1] - key[1]) < 60 && Math.abs(d[i + 2] - key[2]) < 60;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (seen[p]) continue;
    seen[p] = 1;
    if (!near(p * 4)) continue;
    d[p * 4 + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  // Four layers rather than three: these are soft-edged 512px renders, so the
  // blend into the field runs a texel wider than a pixel-art sheet's does.
  unmatteFringe(d, w, h, key, 4);
  ctx.putImageData(data, 0, 0);
  return c;
}
