import { WIN_KILLS } from '../systems/ScoreSystem.js';
import { Portrait } from './Portrait.js';
import { hudTextures } from './HudTextures.js';

/**
 * Retro survival-horror HUD, rendered as a DOM overlay.
 *
 * Everything lives in a bottom INSTRUMENT DOCK: the main CONSOLE BAR flanked
 * by two SIDE HUDs (WAVE on the left, CONFIRMED KILLS on the right), kept
 * separate by the dock's gaps and scaled together to fit any window width
 * (see _layoutDock). No readouts sit at the top of the screen.
 *
 * The centrepiece is the CONSOLE BAR, modelled on the reference Fallout-style
 * interface (see the provided images) but housed like the side devices: a
 * near-black scratched gunmetal panel with corner screws, dark bezels and
 * stencil lettering, carrying, left to right —
 *
 *   - the left VACUUM TUBE bank (see _buildTube): VITALS — the old condition
 *     tab reborn as glass and glow; its heater burns steady when healthy,
 *     gutters when hurt, strobes red at critical and surges on damage — and
 *     CHARGE, the loaded magazine as stored glow that visibly re-charges
 *     across a reload and dies to a sputter when the gun runs dry
 *   - a green CRT MESSAGE LOG (the flavour feed: pickups, sightings,
 *     secrets, orders) with a slow phosphor refresh sweep
 *   - mechanical HP and AMMO odometer counters whose wheels tick as they roll
 *   - a red alarm lamp (pulses on damage) and a MAP lamp
 *   - the centre PLAYER PORTRAIT in a green CRT monitor (see Portrait.js —
 *     health-driven head with a well-spaced look-around idle above 50% HP)
 *   - an AIM ON/OFF indicator (lit while the sniper scope is up)
 *   - a WEAPON panel: an illustrated profile of the live weapon (see
 *     _drawGlyph) over a scanning screen with a reload charge bar
 *   - an ARMS panel: the six-slot armoury grid with per-weapon reserves
 *   - the right VACUUM TUBE bank: XMIT, a transmitter tube that blips hot
 *     on every round sent downrange, and WAVE, a smoked trefoil-decal tube
 *     that rages through a wave, blinks through a respite and idles between
 *
 * The two flanking SIDE HUDs are styled as hard-worn FIELD DEVICES modelled
 * on the reference detector photo: a near-black scratched gunmetal housing
 * with corner screws, a cluster of coloured BAR METERS and round INDICATOR
 * LAMPS (icon glyphs on coloured lenses) on the left of each unit, and an
 * ivory ANALOG NEEDLE GAUGE behind glass on the right. The left unit is the
 * WAVE device (needle + red bar = kills banked toward the wave quota, blue
 * bar = respite countdown, teal bar = secrets found, lamps = calm/incoming/
 * combat, plus the zone nameplate and CLEARED x/y readout); the right unit
 * is the CONFIRMED KILLS tally (mechanical odometer, needle + teal bar =
 * progress toward 250,000, red bar = progress through the current 1,000,
 * blue bar = accuracy, lamps = kill blip / 1k-milestone / power). Free-
 * floating over the scene: the fly-in ARMORY names, subtitles, damage
 * vignette, scope overlay and the menu/pause/death/victory screens. Run
 * stats stay on the pause screen as circular gauges (never on the HUD).
 */
export class HUD {
  constructor(events, root, actions) {
    this.events = events;
    this.root = root;
    this.actions = actions;
    this._subtitleTimer = 0;
    this._vignette = 0;
    this._heal = 0;
    this._alarm = 0;        // red lamp glow (fades after damage)
    this._menuTimer = 0;
    this._menuShown = false;
    this._scoped = false;
    this._xmitSurge = 0;    // XMIT tube kick, set on every weapon:fire
    this._vitalsDrop = 0;   // VITALS tube gutter timer (dropouts while hurt)
    this._tex = hudTextures();
    this._build();
    this._wire();
  }

  _el(tag, id, parent, className = '') {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    (parent || this.root).appendChild(e);
    return e;
  }

  _build() {
    this._el('div', 'scanlines');
    this._el('div', 'vignette');
    this._el('div', 'healflash');
    this._el('div', 'crosshair').innerHTML = '<span></span>';

    // Bottom instrument dock: the two status meters ride at the BOTTOM as
    // side HUDs flanking the main console — WAVE on the left, CONFIRMED KILLS
    // on the right. The inner row keeps its authored width; _layoutDock()
    // scales the whole assembly to fit narrow windows so nothing overlaps.
    const dock = this._el('div', 'hud-dock');
    this.dockInner = this._el('div', 'hud-dock-inner', dock);

    // left side HUD: the WAVE field device (bars + lamps + analog gauge)
    this._buildWaveDevice(this.dockInner);

    // main HUD: the full console bar sits in the centre of the dock
    this._buildConsole(this.dockInner);

    // right side HUD: the CONFIRMED KILLS tally device toward 250,000
    this._buildKillDevice(this.dockInner);

    // fit the dock to the window now, and keep it fitted on every resize
    this._layoutDock();
    window.addEventListener('resize', () => this._layoutDock());
    requestAnimationFrame(() => this._layoutDock());

    // top-center: fly-in ARMORY names on weapon switch (detail-on-demand;
    // the persistent grid lives in the console ARMS panel).
    this.weaponMenu = this._el('div', 'weapon-menu');
    this._el('div', null, this.weaponMenu, 'wm-title').textContent = 'ARMORY';
    this.menuSlots = this._el('div', null, this.weaponMenu, 'wm-slots');
    this.slotEls = [];

    this.subtitleEl = this._el('div', 'subtitle');
    this.promptEl = this._el('div', 'prompt');
    this.bannerEl = this._el('div', 'banner');

    // scope overlay
    this.scopeEl = this._el('div', 'scope');
    this.scopeEl.innerHTML = '<div class="scope-h"></div><div class="scope-v"></div>';
    this.scopeEl.style.display = 'none';

    this._buildScreens();
  }

  /** Scale the bottom dock so the two side HUDs + main console always fit the
   *  window width without overlapping (caps at 1:1 on wide-enough screens). */
  _layoutDock() {
    if (!this.dockInner) return;
    const natural = this.dockInner.offsetWidth; // layout width, ignores scale
    if (!natural) return;
    const scale = Math.min(1, (window.innerWidth - 16) / natural);
    this.dockInner.style.setProperty('--dock-scale', scale.toFixed(4));
  }

  /* ==================================================================
     SIDE HUD FIELD DEVICES — the reference-styled detector units: dark
     scratched gunmetal housing, corner screws, coloured bar meters,
     round icon lamps and an ivory analog needle gauge behind glass.
     ================================================================== */

  /** Shared device scaffolding: housing + corner screws + header strip. */
  _device(parent, id) {
    const el = this._el('div', id, parent, 'side-hud');
    el.style.backgroundImage = `url(${this._tex.device})`;
    for (const c of ['tl', 'tr', 'bl', 'br']) this._el('div', null, el, 'screw ' + c);
    const head = this._el('div', null, el, 'dev-head');
    return { el, head };
  }

  /** A coloured horizontal bar meter with a tiny stencil label; returns the fill. */
  _deviceBar(parent, label, colorCls) {
    const row = this._el('div', null, parent, 'dev-bar');
    this._el('div', null, row, 'dev-bar-label').textContent = label;
    const track = this._el('div', null, row, 'dev-bar-track');
    return this._el('div', null, track, 'dev-bar-fill ' + colorCls);
  }

  /** A round indicator lamp (or square chip) with a dark icon glyph on the lens. */
  _lamp(parent, colorCls, glyph, square = false) {
    const el = this._el('div', null, parent, (square ? 'dev-chip ' : 'dev-lamp ') + colorCls);
    const cv = document.createElement('canvas');
    cv.width = 24; cv.height = 24; cv.className = 'dev-glyph';
    this._drawLampGlyph(cv, glyph);
    el.appendChild(cv);
    return el;
  }

  /** Dark silhouette glyphs for the device lamps, authored in a 12x12 space. */
  _drawLampGlyph(cv, kind) {
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = ctx.strokeStyle = '#16160f';
    ctx.lineJoin = 'round';
    switch (kind) {
      case 'plus':
        ctx.fillRect(5, 2, 2.4, 8.4); ctx.fillRect(2, 5, 8.4, 2.4);
        break;
      case 'drop':
        ctx.beginPath(); ctx.arc(6, 7.6, 3.1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6, 1); ctx.lineTo(8.7, 6.4); ctx.lineTo(3.3, 6.4);
        ctx.closePath(); ctx.fill();
        break;
      case 'radiation':
        for (let k = 0; k < 3; k++) {
          const a = (-90 + k * 120) * Math.PI / 180, h = 30 * Math.PI / 180;
          ctx.beginPath();
          ctx.arc(6, 6, 5.2, a - h, a + h);
          ctx.arc(6, 6, 2.1, a + h, a - h, true);
          ctx.closePath(); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(6, 6, 1.3, 0, Math.PI * 2); ctx.fill();
        break;
      case 'flame':
        ctx.beginPath(); ctx.arc(6, 7.8, 3.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6, 0.8); ctx.quadraticCurveTo(9.6, 4.8, 9, 7.5);
        ctx.quadraticCurveTo(6, 5.5, 3, 7.5); ctx.quadraticCurveTo(2.4, 4.8, 6, 0.8);
        ctx.closePath(); ctx.fill();
        break;
      case 'skull':
        ctx.beginPath(); ctx.arc(6, 5.2, 3.7, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(4.2, 7.6, 3.6, 2.8);
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(4.6, 5, 1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(7.4, 5, 1, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      case 'cross': // crosshair — kill confirm
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(6, 6, 3.4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillRect(5.4, 0.8, 1.2, 3); ctx.fillRect(5.4, 8.2, 1.2, 3);
        ctx.fillRect(0.8, 5.4, 3, 1.2); ctx.fillRect(8.2, 5.4, 3, 1.2);
        break;
      case 'dot':
      default:
        ctx.beginPath(); ctx.arc(6, 6, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Deterministic 0..1 hash for the aged-paper speckles on the gauge faces. */
  _n01(i, j) {
    let h = i * 374761393 + j * 668265263 + 1013904223;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h >>> 0) % 100000) / 100000;
  }

  /**
   * The analog needle gauge module: an ivory dial card in a dark bezel with a
   * red-tipped needle behind glass and a caption strip below. Returns the
   * caption element and set(ratio) which sweeps the needle 0 → 1.
   */
  _deviceGauge(parent, opts) {
    const mod = this._el('div', null, parent, 'dev-gauge');
    const bezel = this._el('div', null, mod, 'dev-gauge-bezel');
    const face = this._el('div', null, bezel, 'dev-gauge-face');
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 128; cv.className = 'dev-gauge-dial';
    this._drawGaugeFace(cv, opts);
    face.appendChild(cv);
    const needle = this._el('div', null, face, 'dev-needle');
    this._el('div', null, face, 'dev-needle-cap');
    this._el('div', null, face, 'dev-glass');
    const caption = this._el('div', null, mod, 'dev-gauge-cap');
    let last = null;
    return {
      caption,
      set(ratio) {
        const deg = (-55 + Math.max(0, Math.min(1, ratio)) * 110).toFixed(1);
        if (last === deg) return;
        last = deg;
        needle.style.transform = `translateX(-50%) rotate(${deg}deg)`;
      },
    };
  }

  /** Bake the static gauge face: aged ivory card, condition band, tick arc,
   *  scale numbers and unit label. Drawn once at 2x for crisp downscale. */
  _drawGaugeFace(cv, { sub = '', majors = [], bands = [] }) {
    const ctx = cv.getContext('2d');
    ctx.save();
    ctx.scale(2, 2);
    const W = cv.width / 2, H = cv.height / 2;
    // ivory dial card, yellowed toward the rim + foxing speckles
    const age = ctx.createRadialGradient(W / 2, H - 5, 6, W / 2, H - 5, W * 0.72);
    age.addColorStop(0, '#e6ddc1'); age.addColorStop(0.7, '#dcd2ae'); age.addColorStop(1, '#c2b58c');
    ctx.fillStyle = age; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(122,96,54,${(0.03 + this._n01(i, 4) * 0.05).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(this._n01(i, 1) * W, this._n01(i, 2) * H, 1 + this._n01(i, 3) * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#5a5140'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    // needle sweep: -55° to +55° off vertical; the pivot sits at the bottom
    // edge so its cap is half-hidden below the dial window, meter-style
    const px = W / 2, py = H - 2;
    const at = (t) => (-145 + 110 * t) * Math.PI / 180;
    for (const b of bands) { // painted condition band under the ticks
      ctx.beginPath(); ctx.arc(px, py, 48, at(b.from), at(b.to));
      ctx.strokeStyle = b.color; ctx.lineWidth = 4.5; ctx.stroke();
    }
    ctx.strokeStyle = '#2e2a1e';
    ctx.beginPath(); ctx.arc(px, py, 56, at(0), at(1)); ctx.lineWidth = 1.2; ctx.stroke();
    const step = 20 / (majors.length - 1); // minor ticks per major interval
    for (let i = 0; i <= 20; i++) {
      const major = i % step === 0;
      const a = at(i / 20), cos = Math.cos(a), sin = Math.sin(a);
      const r1 = major ? 50.5 : 52.5;
      ctx.beginPath();
      ctx.moveTo(px + cos * r1, py + sin * r1);
      ctx.lineTo(px + cos * 56, py + sin * 56);
      ctx.lineWidth = major ? 1.8 : 1; ctx.stroke();
    }
    ctx.fillStyle = '#33301f'; ctx.font = 'bold 7px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    majors.forEach((m, k) => {
      const a = at(k / (majors.length - 1));
      ctx.fillText(m, px + Math.cos(a) * 42, py + Math.sin(a) * 42);
    });
    if (sub) { ctx.fillStyle = '#4a4430'; ctx.fillText(sub, px, py - 22); }
    ctx.restore();
  }

  /** Left side HUD: the WAVE field device. Same stats as ever — wave number,
   *  zone, CLEARED x/y toward the quota, respite countdown — now read out on
   *  bar meters, state lamps and the analog wave-clearance gauge. */
  _buildWaveDevice(parent) {
    const { el, head } = this._device(parent, 'hud-tl');
    // green plus chip: supplies inbound (lit through each wave-end respite)
    this.supplyChip = this._lamp(head, 'chip-green', 'plus', true);
    const title = this._el('div', null, head, 'dev-title');
    title.innerHTML = 'WAVE <span id="wave">—</span>';
    this.waveEl = title.querySelector('#wave');
    this.respiteEl = this._el('div', 'respite', head);
    const main = this._el('div', null, el, 'dev-main');
    const cluster = this._el('div', null, main, 'dev-cluster');
    this.waveBars = {
      clr: this._deviceBar(cluster, 'CLR', 'fill-red'),   // kills banked toward the quota
      rsp: this._deviceBar(cluster, 'RSP', 'fill-blue'),  // respite countdown draining
      sec: this._deviceBar(cluster, 'SEC', 'fill-teal'),  // secrets found
    };
    const lamps = this._el('div', null, cluster, 'dev-lamps');
    this.waveLamps = {
      calm: this._lamp(lamps, 'lamp-blue', 'drop'),           // pre-fight grace
      incoming: this._lamp(lamps, 'lamp-amber', 'radiation'), // respite — they are coming
      combat: this._lamp(lamps, 'lamp-orange', 'flame'),      // wave active — hold the line
    };
    this.waveGauge = this._deviceGauge(main, {
      sub: '% CLEAR',
      majors: ['0', '20', '40', '60', '80', '100'],
      bands: [
        { from: 0, to: 0.35, color: '#a83428' },
        { from: 0.35, to: 0.7, color: '#c1922f' },
        { from: 0.7, to: 1, color: '#4f8f3a' },
      ],
    });
    this.waveGauge.caption.innerHTML =
      'CLEARED <span id="wave-cleared">0</span> / <span id="wave-quota">0</span>';
    this.waveClearedEl = this.waveGauge.caption.querySelector('#wave-cleared');
    this.waveQuotaEl = this.waveGauge.caption.querySelector('#wave-quota');
    this.zoneEl = this._el('div', 'zone', el, 'dev-plate');
  }

  /** Right side HUD: the CONFIRMED KILLS tally device. The mechanical odometer
   *  carries the count, the needle + teal bar the victory progress, and the
   *  finer meters the current-thousand progress and accuracy. */
  _buildKillDevice(parent) {
    const { el, head } = this._device(parent, 'hud-tc');
    this._el('div', null, head, 'dev-title').textContent = 'CONFIRMED KILLS';
    const main = this._el('div', null, el, 'dev-main');
    const cluster = this._el('div', null, main, 'dev-cluster');
    this.killsOdo = this._el('div', 'kills', cluster, 'odometer kills');
    this.killsOdo.style.backgroundImage = `url(${this._tex.inset})`;
    this.killBars = {
      k: this._deviceBar(cluster, '1K', 'fill-red'),      // through the current 1,000
      acc: this._deviceBar(cluster, 'ACC', 'fill-blue'),  // running accuracy
      tot: this._deviceBar(cluster, 'TOT', 'fill-teal'),  // toward 250,000
    };
    const lamps = this._el('div', null, cluster, 'dev-lamps');
    this.killLamps = {
      hit: this._lamp(lamps, 'lamp-green', 'cross'),   // blips on each confirmed kill
      mile: this._lamp(lamps, 'lamp-amber', 'skull'),  // flashes crossing each 1,000
      pwr: this._lamp(lamps, 'lamp-blue', 'dot'),      // unit power, slow pulse
    };
    this.killGauge = this._deviceGauge(main, {
      sub: 'KILLS ×1000',
      majors: ['0', '50', '100', '150', '200', '250'],
      bands: [{ from: 0.94, to: 1, color: '#b98f2c' }],
    });
    this.killGoalEl = this.killGauge.caption;
    this.killGoalEl.id = 'kill-goal';
    this.killGoalEl.textContent = '/ ' + WIN_KILLS.toLocaleString('en-US');
    this.remainEl = this._el('div', null, el, 'dev-plate');
    this.remainEl.textContent = 'REMAINING ' + WIN_KILLS.toLocaleString('en-US');
  }

  /* ==================================================================
     CONSOLE VACUUM TUBES — the glowing analog heart of the mid console.
     Each tube is a baked-canvas glass envelope (dome, anode plate, mica
     spacers, getter flash, socket collar) layered over per-frame DOM glow:
     an inner heater HEAT core behind the glass, an outer HALO bleed and a
     POOL of warm light cast down onto the panel — the reference photos'
     look: a dark plate with fire in its slot, washing the chassis red.
     Envelope kinds: 'st' coke-bottle, 'gt' straight glass with a sealed
     tip nub, 'mini' pencil tube; 'smoked' wraps the glass in near-black
     coating so the glow only smoulders through (the trefoil-decal tube).
     ================================================================== */

  /** Build one tube: baked art + glow layers + stencil label. Returns refs
   *  plus set(v), which drives all three glow layers from one 0..1 level. */
  _buildTube(parent, { kind, w, h, label, smoked = false, decal = null, etch = '' }) {
    const root = this._el('div', null, parent, 'tube' + (smoked ? ' smoked' : ''));
    const stack = this._el('div', null, root, 'tube-stack');
    stack.style.width = w + 'px'; stack.style.height = h + 'px';
    const pool = this._el('div', null, stack, 'tube-pool');
    const heat = this._el('div', null, stack, 'tube-heat');
    const cv = document.createElement('canvas');
    cv.width = w * 2; cv.height = h * 2; cv.className = 'tube-art';
    this._drawTubeArt(cv, kind, { w, h, smoked, decal, etch });
    stack.appendChild(cv);
    const halo = this._el('div', null, stack, 'tube-halo');
    this._el('div', null, root, 'tube-label').textContent = label;
    return {
      el: root, heat, halo, pool, _v: -1,
      set(v) {
        v = Math.max(0, Math.min(1, v));
        if (Math.abs(v - this._v) < 0.008) return; // write styles only on real change
        this._v = v;
        heat.style.opacity = v.toFixed(3);
        halo.style.opacity = (v * 0.8).toFixed(3);
        pool.style.opacity = (v * 0.65).toFixed(3);
      },
    };
  }

  /** Bake one tube's static art at 2x: socket collar, glass envelope,
   *  electrode stack, getter silvering, decal/etch and the glass glare. */
  _drawTubeArt(cv, kind, { w, h, smoked, decal, etch }) {
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    const baseH = Math.max(8, h * 0.1); // socket collar height
    const gTop = kind === 'gt' ? 6 : 3; // glass starts below the tip nub
    const gBot = h - baseH;
    const cx = w / 2;

    // envelope path, reused for fill / clip / outline
    const glass = () => {
      ctx.beginPath();
      if (kind === 'st') { // coke-bottle: dome, neck, shoulder flare, body
        const neckW = w * 0.3, bodyW = w * 0.46;
        ctx.moveTo(cx - bodyW, gBot);
        ctx.lineTo(cx - bodyW, gTop + h * 0.42);
        ctx.bezierCurveTo(cx - bodyW, gTop + h * 0.24, cx - neckW, gTop + h * 0.2, cx - neckW, gTop + h * 0.12);
        ctx.quadraticCurveTo(cx - neckW, gTop, cx, gTop);
        ctx.quadraticCurveTo(cx + neckW, gTop, cx + neckW, gTop + h * 0.12);
        ctx.bezierCurveTo(cx + neckW, gTop + h * 0.2, cx + bodyW, gTop + h * 0.24, cx + bodyW, gTop + h * 0.42);
        ctx.lineTo(cx + bodyW, gBot);
      } else { // straight-sided GT / mini pencil, domed top
        const bw = w * 0.44, domeH = kind === 'mini' ? h * 0.1 : h * 0.14;
        ctx.moveTo(cx - bw, gBot);
        ctx.lineTo(cx - bw, gTop + domeH);
        ctx.quadraticCurveTo(cx - bw, gTop, cx, gTop);
        ctx.quadraticCurveTo(cx + bw, gTop, cx + bw, gTop + domeH);
        ctx.lineTo(cx + bw, gBot);
      }
      ctx.closePath();
    };

    if (kind === 'gt') { // sealed exhaust tip on the crown
      ctx.fillStyle = 'rgba(190,205,215,0.30)';
      ctx.beginPath(); ctx.ellipse(cx, 3.4, 2.1, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(235,245,250,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
    }

    glass();
    ctx.fillStyle = 'rgba(185,205,215,0.10)'; // the faint body of the glass
    ctx.fill();

    // ---- internals, clipped to the envelope ----
    ctx.save(); glass(); ctx.clip();
    ctx.strokeStyle = 'rgba(214,170,120,0.75)'; ctx.lineWidth = 0.7;
    for (const dx of [-w * 0.16, -w * 0.05, w * 0.07, w * 0.17]) { // stem wires
      ctx.beginPath(); ctx.moveTo(cx + dx, gBot - 1); ctx.lineTo(cx + dx * 0.5, h * 0.62); ctx.stroke();
    }
    // anode plate: dark box, side wings, a hot slot down the middle where
    // the heater glow (the DOM layer behind this canvas) burns through
    const pw = w * 0.4, pTop = gTop + (gBot - gTop) * 0.28, pBot = gTop + (gBot - gTop) * 0.62;
    ctx.fillStyle = '#25262a'; ctx.fillRect(cx - pw / 2, pTop, pw, pBot - pTop);
    ctx.fillStyle = '#191a1d';
    ctx.fillRect(cx - pw / 2 - 2, pTop + 3, 2, pBot - pTop - 6);
    ctx.fillRect(cx + pw / 2, pTop + 3, 2, pBot - pTop - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(cx - pw / 2, pTop, 1.2, pBot - pTop);
    ctx.clearRect(cx - 1.1, pTop + 2, 2.2, pBot - pTop - 4); // heater slot
    // mica spacer discs above and below the plate
    ctx.fillStyle = 'rgba(206,199,178,0.85)';
    ctx.beginPath(); ctx.ellipse(cx, pTop - 1.5, w * 0.3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, pBot + 1.5, w * 0.28, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,200,0.5)'; ctx.lineWidth = 0.6; // dome supports
    ctx.beginPath(); ctx.moveTo(cx - 3, pTop - 2); ctx.lineTo(cx - 2, gTop + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 3, pTop - 2); ctx.lineTo(cx + 2, gTop + 4); ctx.stroke();
    // getter flash: the mirror silvering inside the dome
    const gg = ctx.createRadialGradient(cx, gTop + 2, 1, cx, gTop + 2, h * 0.16);
    gg.addColorStop(0, 'rgba(150,165,178,0.6)');
    gg.addColorStop(0.7, 'rgba(110,125,138,0.25)');
    gg.addColorStop(1, 'rgba(110,125,138,0)');
    ctx.fillStyle = gg; ctx.fillRect(cx - w / 2, gTop, w, h * 0.18);
    if (smoked) { // near-black coating with one gloss streak
      ctx.fillStyle = 'rgba(14,15,16,0.62)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(cx - w * 0.3, gTop, w * 0.12, gBot - gTop);
    }
    if (decal === 'trefoil') { // the reference tube's red radiation mark
      const dy = gTop + (gBot - gTop) * 0.3, r = Math.min(6, w * 0.16);
      ctx.fillStyle = 'rgba(196,60,32,0.9)';
      for (let k = 0; k < 3; k++) {
        const a = (-90 + k * 120) * Math.PI / 180, hh = 28 * Math.PI / 180;
        ctx.beginPath();
        ctx.arc(cx, dy, r, a - hh, a + hh); ctx.arc(cx, dy, r * 0.4, a + hh, a - hh, true);
        ctx.closePath(); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, dy, r * 0.24, 0, Math.PI * 2); ctx.fill();
    }
    if (etch) { // etched type code on the upper glass
      ctx.fillStyle = 'rgba(238,232,214,0.30)';
      ctx.font = 'bold 5px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(etch, cx, gTop + (gBot - gTop) * 0.2);
    }
    ctx.restore();

    glass(); // outline + curved glare streaks on the glass
    ctx.strokeStyle = 'rgba(228,240,246,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.34, gTop + h * 0.16);
    ctx.quadraticCurveTo(cx - w * 0.4, h * 0.45, cx - w * 0.33, gBot - h * 0.12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.36, gTop + h * 0.2);
    ctx.quadraticCurveTo(cx + w * 0.4, h * 0.38, cx + w * 0.36, h * 0.52);
    ctx.stroke();

    // socket collar: bakelite ring with a brass retaining band
    ctx.fillStyle = '#15150f';
    ctx.beginPath(); ctx.roundRect(cx - w * 0.48, gBot - 1, w * 0.96, baseH + 1, 2); ctx.fill();
    ctx.fillStyle = '#7a6234'; ctx.fillRect(cx - w * 0.48, gBot + 1.4, w * 0.96, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(cx - w * 0.48, gBot - 1, w * 0.96, 1);
  }

  /** The bottom console bar and all of its instruments. */
  _buildConsole(parent) {
    const bar = this._el('div', 'console-bar', parent);
    bar.style.backgroundImage = `url(${this._tex.bar})`;

    // same corner fixing screws as the side-HUD field devices
    for (const c of ['tl', 'tr', 'bl', 'br']) this._el('div', null, bar, 'screw ' + c);

    // --- left tube bank: VITALS + CHARGE. VITALS replaces the old CLEAN
    // text tab — the same condition readout, now carried entirely by glass
    // and glow (see update for the drive logic). Its dome rides above the
    // panel edge the way the tab used to break the console silhouette. ---
    const rackL = this._el('div', 'cons-tubes-l', bar, 'cons-tubes');
    this.tubeVitals = this._buildTube(rackL, { kind: 'st', w: 40, h: 98, label: 'VITALS', etch: 'V-300' });
    this.tubeCharge = this._buildTube(rackL, { kind: 'gt', w: 32, h: 86, label: 'CHARGE', etch: 'C-807' });

    // --- message log (green CRT) ---
    const logWrap = this._el('div', 'cons-log-wrap', bar);
    logWrap.style.backgroundImage = `url(${this._tex.inset})`;
    this.logEl = this._el('div', 'cons-log', logWrap);

    // --- HP + AMMO odometer meters ---
    const meters = this._el('div', 'cons-meters', bar);
    const hpBox = this._el('div', null, meters, 'cons-meter');
    this._el('div', null, hpBox, 'cons-meter-label').textContent = 'HP';
    this.hpOdo = this._el('div', null, hpBox, 'odometer');
    this.hpOdo.style.backgroundImage = `url(${this._tex.inset})`;
    // AMMO split into two meters: LOADED (in the gun) and RESERVE (carried)
    const ammoBox = this._el('div', null, meters, 'cons-meter cons-ammo');
    this._el('div', null, ammoBox, 'cons-meter-label').textContent = 'AMMO';
    const ammoRow = this._el('div', null, ammoBox, 'cons-ammo-row');
    const loadedCol = this._el('div', null, ammoRow, 'cons-ammo-col');
    this.ammoOdo = this._el('div', null, loadedCol, 'odometer small');
    this.ammoOdo.style.backgroundImage = `url(${this._tex.inset})`;
    this._el('div', null, loadedCol, 'cons-ammo-sub').textContent = 'LOADED';
    const resCol = this._el('div', null, ammoRow, 'cons-ammo-col');
    this.resOdo = this._el('div', null, resCol, 'odometer small');
    this.resOdo.style.backgroundImage = `url(${this._tex.inset})`;
    this._el('div', null, resCol, 'cons-ammo-sub').textContent = 'RESERVE';

    // --- alarm lamp + MAP lamp ---
    const lamps = this._el('div', 'cons-lamps', bar);
    this.alarmLamp = this._el('div', null, lamps, 'cons-lamp alarm');
    this.mapLamp = this._el('div', null, lamps, 'cons-lamp map');
    this.mapLamp.textContent = 'MAP';

    // --- centre portrait monitor ---
    const mon = this._el('div', 'cons-monitor', bar);
    this._el('div', null, mon, 'cons-mon-cable');
    const screen = this._el('div', null, mon, 'cons-mon-screen');
    this.portraitCanvas = document.createElement('canvas');
    this.portraitCanvas.width = 116; this.portraitCanvas.height = 132;
    this.portraitCanvas.className = 'cons-portrait';
    screen.appendChild(this.portraitCanvas);
    this.portrait = new Portrait(this.portraitCanvas);

    // --- AIM indicator ---
    const aim = this._el('div', 'cons-aim', bar);
    this._el('div', null, aim, 'cons-aim-label').textContent = 'AIM';
    this.aimLamp = this._el('div', null, aim, 'cons-aim-lamp');
    this.aimState = this._el('div', null, aim, 'cons-aim-state');
    this.aimState.textContent = 'OFF';

    // --- WEAPON panel ---
    const wp = this._el('div', 'cons-weapon', bar);
    this._el('div', null, wp, 'cons-panel-label').textContent = 'WEAPON';
    const wpScreen = this._el('div', null, wp, 'cons-weapon-screen');
    wpScreen.style.backgroundImage = `url(${this._tex.inset})`;
    this.weaponIcon = document.createElement('canvas');
    this.weaponIcon.width = 128; this.weaponIcon.height = 44;
    this.weaponIcon.className = 'cons-weapon-icon';
    wpScreen.appendChild(this.weaponIcon);
    // amber charge line along the screen's foot: fills across a reload
    this.weaponCharge = this._el('div', null, wpScreen, 'cons-weapon-charge');
    this.weaponMode = this._el('div', null, wp, 'cons-weapon-mode');

    // --- ARMS panel (6-slot armoury grid) ---
    const arms = this._el('div', 'cons-arms', bar);
    this._el('div', null, arms, 'cons-panel-label').textContent = 'ARMS';
    this.armsGrid = this._el('div', null, arms, 'cons-arms-grid');
    this.armsSlots = []; // filled on first update

    // --- right tube bank: XMIT (blips per shot) + WAVE (fight state) ---
    const rackR = this._el('div', 'cons-tubes-r', bar, 'cons-tubes');
    this.tubeXmit = this._buildTube(rackR, { kind: 'mini', w: 25, h: 78, label: 'XMIT', etch: '6L6' });
    this.tubeWave = this._buildTube(rackR, {
      kind: 'gt', w: 32, h: 86, label: 'WAVE', smoked: true, decal: 'trefoil', etch: 'R-42',
    });
  }

  _buildScreens() {
    this.menuEl = this._screen('menu', `
      <h1>F-FPS</h1>
      <h2>THE FOG TOOK THE TOWN. TAKE IT BACK.</h2>
      <p class="story">Kill <b>250,000</b> of them. That is the number. The survivor by the well
      did the arithmetic, and the town opens itself, street by street, to those who keep count.</p>
      <div class="controls">
        <span>WASD — MOVE</span><span>MOUSE — LOOK / FIRE</span><span>SHIFT — SPRINT</span>
        <span>CTRL — CROUCH</span><span>SPACE — JUMP</span><span>1-5 — WEAPONS</span>
        <span>R — RELOAD</span><span>RMB — SCOPE (SNIPER)</span><span>E — INTERACT</span><span>TAB — SATCHEL</span><span>ESC — PAUSE</span>
      </div>
      <button id="btn-start">ENTER THE FOG</button>`);
    this.pauseEl = this._screen('pause', `
      <h1>PAUSED</h1>
      <div id="pause-stats" class="statrings"></div>
      <button id="btn-resume">RESUME</button>`);
    this.deadEl = this._screen('dead', `
      <h1 class="blood">YOU DIED</h1>
      <p class="story">The fog closes in over you. But the count survives. It always survives.</p>
      <div id="dead-stats" class="statgrid"></div>
      <button id="btn-respawn">CRAWL BACK OUT</button>`);
    this.victoryEl = this._screen('victory', `
      <h1 class="gold">250,000</h1>
      <h2>THE TOWN IS SILENT. YOU COUNTED EVERY ONE.</h2>
      <div id="victory-stats" class="statgrid"></div>
      <p class="story">The fog lifts. The clock on the tower finally moves.</p>`);
  }

  _screen(id, html) {
    const s = this._el('div', 'screen-' + id, null, 'screen');
    s.innerHTML = html;
    s.style.display = 'none';
    return s;
  }

  showScreen(which) {
    for (const s of [this.menuEl, this.pauseEl, this.deadEl, this.victoryEl]) s.style.display = 'none';
    if (which) {
      const el = { menu: this.menuEl, pause: this.pauseEl, dead: this.deadEl, victory: this.victoryEl }[which];
      el.style.display = 'flex';
    }
  }

  _wire() {
    document.getElementById('btn-start').addEventListener('click', () => this.actions.onStart());
    document.getElementById('btn-resume').addEventListener('click', () => this.actions.onResume());
    document.getElementById('btn-respawn').addEventListener('click', () => this.actions.onRespawn());

    const on = this.events.on.bind(this.events);
    on('subtitle', ({ text }) => { this.subtitle(text); this.logMsg(text); });
    on('player:damage', ({ amount }) => {
      this._vignette = Math.min(1, this._vignette + amount / 40 + 0.25);
      this._alarm = 1;
    });
    on('player:heal', () => { this._heal = 0.5; });
    on('pickup', ({ label, amount, type }) => {
      this.logMsg(type === 'key' ? `You pick up the ${label}.` : `You gather ${amount} ${label}.`, 'good');
    });
    on('secret:found', ({ label, count, total }) => {
      this.logMsg(`SECRET (${count}/${total}) — ${label}.`, 'gold');
    });
    on('zone:unlock', ({ zone }) => {
      this.subtitle(`The way into ${zone.name} is clear.`);
      this.logMsg(`The way into ${zone.name} is clear.`, 'gold');
    });
    on('wave:start', ({ wave }) => { this.banner('WAVE ' + wave); this.logMsg(`Wave ${wave}. They are coming.`, 'warn'); });
    on('wave:end', () => this.logMsg('Wave clear. Supplies inbound.', 'good'));
    on('scope', ({ on: scoped }) => {
      this._scoped = scoped;
      this.scopeEl.style.display = scoped ? 'block' : 'none';
    });
    on('victory', ({ stats }) => {
      this._fillStats(document.getElementById('victory-stats'), stats);
      this.showScreen('victory');
    });

    on('weapon:menu:poke', () => this.showWeaponMenu());
    on('weapon:switch', () => this.showWeaponMenu());
    on('weapon:fire', () => { this.hideWeaponMenu(); this._xmitSurge = 1; });
    on('weapon:reload:start', () => this.hideWeaponMenu());
  }

  showWeaponMenu() {
    this._menuTimer = 2.5;
    if (!this._menuShown) {
      this._menuShown = true;
      this.weaponMenu.style.transition = 'opacity 0.15s ease-in-out, transform 0.15s ease-in-out';
      this.weaponMenu.classList.add('show');
    }
  }

  hideWeaponMenu() {
    this._menuTimer = 0;
    if (this._menuShown) {
      this._menuShown = false;
      this.weaponMenu.style.transition = 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out';
      this.weaponMenu.classList.remove('show');
    }
  }

  /** Prepend a line to the green CRT message log; keep the last few. Each line
   *  stretches to share the CRT height (see .log-line) so the feed fills the
   *  box top-to-bottom; the text rides in a span so it can ellipsize. */
  logMsg(text, cls = '') {
    if (!this.logEl) return;
    const line = document.createElement('div');
    line.className = 'log-line ' + cls;
    const span = document.createElement('span');
    span.textContent = '• ' + text;
    line.appendChild(span);
    this.logEl.insertBefore(line, this.logEl.firstChild);
    while (this.logEl.children.length > 6) this.logEl.lastChild.remove();
    requestAnimationFrame(() => line.classList.add('in'));
  }

  /**
   * Illustrated weapon side-profiles — used by the WEAPON panel (big), the
   * ARMS grid (small) and the fly-in ARMORY. Layered two-tone art: dark
   * gunsteel + walnut furniture + the caller's brass tone (highlights and
   * shadows derived from it), matching the real 3D models in
   * WeaponModels.js — the Regent Autoloader, the Crane Coachgun's twin
   * hammers, the Foundry Gun's flank pan drum, the Meridian Long Rifle's
   * brass telescope and the Ironshod Slugger's banded, studded barrel.
   */
  _drawGlyph(canvas, id, color = '#d8b552') {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / 64, H / 34); // author in a 64x34 space, muzzle to the right
    ctx.translate(-32, -17);
    const shade = (hex, f) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = (sh) => Math.max(0, Math.min(255, (((n >> sh) & 255) * f) | 0));
      return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
    };
    const brass = color, brassHi = shade(color, 1.35), brassSh = shade(color, 0.62);
    const steel = '#4c4a42', steelHi = '#6b685c', steelSh = '#38362f';
    const wood = '#6f4a27', dark = '#22201a';
    ctx.lineJoin = 'round';
    const poly = (pts, fill) => {
      ctx.fillStyle = fill; ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath(); ctx.fill();
    };
    const rect = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
    const dot = (x, y, r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    const guard = (x, y) => { // trigger guard loop
      ctx.strokeStyle = steelHi; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 4.2, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
    };
    switch (id) {
      case 'pistol': // Regent Autoloader: brass slide, steel frame, walnut grip
        rect(6, 9, 44, 7, brass);
        rect(6, 9, 44, 1.4, brassHi);                                  // slide top light
        rect(50, 11, 6, 4, steel);                                     // barrel bushing
        rect(46, 6.6, 2, 2.4, brassSh);                                // front sight
        rect(8, 6.6, 2.4, 2.4, steel);                                 // rear sight
        for (let x = 9; x < 19; x += 2.5) rect(x, 10, 1.1, 5, dark);   // slide serrations
        rect(30, 10.4, 9, 4.2, dark);                                  // ejection port
        rect(8, 16, 38, 4, steel);                                     // frame rail
        poly([[6, 9], [2, 5.6], [3.6, 11.5], [6, 12.5]], steel);       // hammer spur
        guard(25, 21.5);
        rect(24.4, 18, 1.4, 4.6, dark);                                // trigger
        poly([[8, 20], [20, 20], [15, 33], [3, 33]], wood);            // grip
        poly([[3, 30.6], [14.9, 30.6], [14.4, 33], [3, 33]], brassSh); // butt cap
        dot(11, 25, 1.1, brassHi);                                     // grip screw
        break;
      case 'shotgun': // Crane Coachgun: over-under bores, twin hammers, walnut stock
        rect(24, 10.5, 33, 4.4, steel);                                // upper bore
        rect(24, 15.7, 33, 4.4, steelSh);                              // under bore
        rect(24, 14.9, 33, 0.9, dark);                                 // rib shadow
        rect(53, 9.6, 4, 11.4, brass);                                 // muzzle band
        dot(55, 8.4, 1, brassHi);                                      // bead sight
        rect(26, 20.4, 12, 3, wood);                                   // forend
        rect(15, 9.6, 10, 11.6, brass);                                // receiver / hinge block
        rect(15, 9.6, 10, 1.2, brassHi);
        rect(19.6, 11.6, 0.9, 8, brassSh);                             // engraving line
        poly([[16, 9.6], [12.4, 3.4], [14.4, 2.6], [18.4, 8.4]], steel);   // rear hammer
        poly([[20, 9.6], [17.2, 4.6], [19, 3.8], [22.2, 8.6]], steelHi);   // fore hammer
        guard(21, 24);
        poly([[15, 10], [15, 21.6], [4.4, 25.6], [2, 13.4]], wood);    // stock
        poly([[0.8, 13], [3.2, 12.4], [5.2, 25.8], [2.2, 26.4]], brassSh); // buttplate
        break;
      case 'rifle': // Foundry Gun: shrouded barrel, flank pan drum, valve stems
        rect(28, 11, 24, 9, steelSh);                                  // barrel shroud
        for (let x = 31; x < 50; x += 4.6) dot(x + 1.2, 15.5, 1.5, dark); // vent holes
        rect(52, 13, 8, 4.4, steel);                                   // exposed muzzle
        rect(58, 9.4, 1.6, 4, steel);                                  // front sight
        rect(16, 10, 14, 10.6, steel);                                 // receiver
        rect(18, 6.4, 2, 4, brass);                                    // valve stems
        rect(22.4, 5.2, 2, 5.2, brassSh);
        dot(24, 15, 8, brassSh);                                       // pan drum: rim
        dot(24, 15, 6.6, brass);                                       //   face
        dot(24, 15, 1.8, dark);                                        //   hub
        for (let k = 0; k < 6; k++) {                                  //   rivet ring
          dot(24 + Math.cos(k * 1.047) * 4.6, 15 + Math.sin(k * 1.047) * 4.6, 0.7, brassSh);
        }
        guard(33, 24);
        poly([[31, 20.6], [37, 20.6], [34.4, 29], [28.6, 29]], wood);  // grip
        poly([[16, 11], [16, 20.6], [3.4, 24.6], [1.6, 14]], wood);    // stock
        poly([[0.6, 13.4], [3, 12.8], [4.6, 25.2], [1.6, 25.8]], brassSh); // buttplate
        break;
      case 'sniper': // Meridian Long Rifle: long bore, brass telescope, bolt ball
        rect(24, 15.6, 38, 3.4, steel);                                // barrel
        for (const x of [30, 37, 44]) rect(x, 14.8, 1.8, 5, brassSh);  // cooling rings
        rect(60, 15, 2.6, 4.4, brassHi);                               // muzzle crown
        rect(20, 7.4, 26, 4.2, brass);                                 // telescope tube
        rect(20, 7.4, 26, 1, brassHi);
        poly([[46, 6.4], [52, 5.2], [52, 13.4], [46, 12.4]], brass);   // objective bell
        rect(16.6, 6.8, 3.4, 5.4, brassSh);                            // eyepiece
        dot(16.2, 9.5, 1, '#9fe8a0');                                  // reticle glow
        rect(26, 11.6, 1.8, 4.4, steel);                               // scope mounts
        rect(41, 11.6, 1.8, 4.4, steel);
        rect(12, 14.6, 14, 6.8, steel);                                // receiver
        ctx.strokeStyle = steelHi; ctx.lineWidth = 1.3;                // bolt arm
        ctx.beginPath(); ctx.moveTo(28, 18); ctx.quadraticCurveTo(31, 20, 32.4, 23); ctx.stroke();
        dot(32.6, 23.6, 2, brassHi);                                   // bolt ball knob
        guard(23, 25);
        rect(26, 19, 16, 3, wood);                                     // forend
        poly([[12, 14.6], [12, 21.4], [1.6, 25.6], [0.4, 16.4]], wood);    // stock
        poly([[0, 15.8], [2.2, 15.2], [3.6, 26], [0.8, 26.4]], brassSh);   // buttplate
        break;
      case 'bat': // Ironshod Slugger: tapered walnut, brass bands, iron studs
        poly([[2, 16.6], [36, 11], [53, 8.8], [57.4, 10.6], [58.6, 16], [58.6, 18],
          [57.4, 21.4], [53, 23.2], [36, 21], [2, 19.4]], wood);
        poly([[36, 11], [53, 8.8], [53.6, 9.6], [36, 11.9]], '#8a6136'); // top light
        rect(43, 8.9, 2.6, 14.4, brass);                               // fore band
        rect(49.4, 8.6, 2.6, 14.9, brassSh);                           // end band
        for (const [sx, sy] of [[40, 13.4], [41, 19], [47, 11.4], [47, 20.6], [54.4, 13], [54.6, 18.6]]) {
          dot(sx, sy, 1.05, dark); dot(sx - 0.35, sy - 0.35, 0.4, steelHi); // studs + glint
        }
        for (let x = 5; x < 15; x += 2.6) rect(x, 16.2 + (x - 5) * 0.08, 1, 3.4, '#503617'); // grip wrap
        dot(2.4, 18, 2.4, brassSh);                                    // pommel knob
        ctx.strokeStyle = brassSh; ctx.lineWidth = 1;                  // lanyard ring
        ctx.beginPath(); ctx.arc(0.9, 21.4, 1.7, 0, Math.PI * 2); ctx.stroke();
        break;
      default:
        rect(10, 13, 44, 8, brass);
    }
    ctx.restore();
  }

  subtitle(text) {
    this.subtitleEl.textContent = text;
    this._subtitleTimer = 4.5;
  }

  banner(text) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
  }

  /** Fixed-width mechanical counter digits (HP/ammo meters, the kill tally).
   *  Wheels that actually rolled get a settle-tick animation (.digit.tick). */
  _odoDigits(el, value, digits) {
    const max = Math.pow(10, digits) - 1;
    const s = String(Math.max(0, Math.min(max, value | 0))).padStart(digits, '0');
    if (el._last === s) return;
    const prev = el._last;
    el._last = s;
    el.innerHTML = [...s].map((d) => `<span class="digit">${d}</span>`).join('');
    if (prev && prev.length === s.length) {
      for (let i = 0; i < s.length; i++) if (prev[i] !== s[i]) el.children[i].classList.add('tick');
    }
  }

  /** Three fixed digits for the mechanical HP/ammo odometers. */
  _odometer(el, value, infinite = false) {
    if (infinite) { el.innerHTML = '<span class="digit inf">&#8734;</span>'; return; }
    this._odoDigits(el, value, 3);
  }

  _fillStats(el, stats) {
    const t = stats.timePlayed;
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60);
    const time = (hh ? hh + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    el.innerHTML = `
      <span>TIME SURVIVED</span><b>${time}</b>
      <span>KILLS</span><b>${stats.kills.toLocaleString('en-US')}</b>
      <span>ACCURACY</span><b>${(stats.accuracy * 100).toFixed(1)}%</b>
      <span>SCORE</span><b>${stats.points.toLocaleString('en-US')}</b>
      <span>WALKERS</span><b>${(stats.byType.Walker || 0).toLocaleString('en-US')}</b>
      <span>SPRINTERS</span><b>${(stats.byType.Sprinter || 0).toLocaleString('en-US')}</b>
      <span>TANKS</span><b>${(stats.byType.Tank || 0).toLocaleString('en-US')}</b>`;
  }

  _ring(label, ratio, num, sub, cls = '') {
    const C = 2 * Math.PI * 44;
    const off = C * (1 - Math.max(0, Math.min(1, ratio)));
    return `<div class="ring"><div class="ring-wrap">
        <svg viewBox="0 0 104 104">
          <circle class="track" cx="52" cy="52" r="44"></circle>
          <circle class="arc ${cls}" cx="52" cy="52" r="44"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
        </svg>
        <div class="ring-val"><div class="ring-num">${num}</div><div class="ring-sub">${sub}</div></div>
      </div><div class="ring-label">${label}</div></div>`;
  }

  fillPauseStats(stats, secrets) {
    const el = document.getElementById('pause-stats');
    const t = stats.timePlayed;
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60);
    const time = (hh ? hh + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    const secRatio = secrets.total ? secrets.found / secrets.total : 0;
    el.innerHTML =
      this._ring('ACCURACY', stats.accuracy, `${(stats.accuracy * 100).toFixed(0)}%`, `${stats.shotsHit}/${stats.shotsFired}`, 'blue') +
      this._ring('PROGRESS', stats.kills / WIN_KILLS, stats.kills.toLocaleString('en-US'), `/ ${(WIN_KILLS / 1000) | 0}k`, 'green') +
      this._ring('SECRETS', secRatio, `${secrets.found}/${secrets.total}`, 'FOUND') +
      this._ring('SCORE', 1, stats.points.toLocaleString('en-US'), 'POINTS', 'green') +
      this._ring('SURVIVED', 1, time, 'TIME', 'blue');
  }

  fillDeadStats(stats) {
    this._fillStats(document.getElementById('dead-stats'), stats);
  }

  /** Per-frame refresh with a plain data snapshot. */
  update(dt, d) {
    const now = performance.now();
    const hpFrac = d.health / d.maxHealth;
    const cur = d.weapons.find((w) => w.active);

    // --- console: VITALS tube (the condition readout) + HP odometer ---
    // Healthy: a steady heater with a slow breath. Hurt: the glow gutters —
    // random brief dropouts, more frequent the worse it gets. Critical: a
    // harsh red strobe. Fresh damage surges the heater white-hot (_alarm).
    this.tubeVitals.el.classList.toggle('red', hpFrac <= 0.25);
    let vit = 0.34 + hpFrac * 0.5;
    vit *= 1 - 0.05 * (0.5 + 0.5 * Math.sin(now / 430));
    if (hpFrac <= 0.5 && Math.random() < dt * (hpFrac <= 0.25 ? 9 : 3)) {
      this._vitalsDrop = 0.05 + Math.random() * 0.12;
    }
    this._vitalsDrop = Math.max(0, this._vitalsDrop - dt);
    if (this._vitalsDrop > 0) vit *= hpFrac <= 0.25 ? 0.2 : 0.45;
    this.tubeVitals.set(Math.min(1, vit + this._alarm * 0.55));
    this._odometer(this.hpOdo, Math.ceil(d.health));
    this.hpOdo.classList.toggle('low', hpFrac < 0.5);
    this.hpOdo.classList.toggle('crit', hpFrac < 0.25);
    this.portrait.setHealth(hpFrac);
    this.portrait.update(dt);

    // --- console: AMMO odometers — LOADED (in gun) + RESERVE (carried) ---
    if (cur.mag === Infinity) {
      this.ammoOdo.innerHTML = '<span class="digit melee">—</span>'; this.ammoOdo._last = 'melee';
      this.resOdo.innerHTML = '<span class="digit melee">—</span>'; this.resOdo._last = 'melee';
    } else {
      this._odometer(this.ammoOdo, cur.mag);
      this.ammoOdo.classList.toggle('empty', cur.mag === 0 && !cur.reloading);
      if (cur.reserve === Infinity) {
        this.resOdo.innerHTML = '<span class="digit inf">&#8734;</span>'; this.resOdo._last = 'inf';
      } else {
        this._odometer(this.resOdo, cur.reserve);
      }
      this.resOdo.classList.toggle('empty', cur.reserve === 0 && cur.mag === 0);
    }

    // --- console: CHARGE tube — the loaded magazine as stored glow. A
    // reload visibly re-charges it (reloadFrac ramp + crackle); a gun run
    // fully dry leaves it dark with the odd dying sputter. ---
    let chg;
    if (cur.mag === Infinity) {
      chg = 0.3 + 0.05 * Math.sin(now / 520);                          // melee: idle warmth
    } else if (cur.reloading) {
      chg = 0.12 + 0.8 * cur.reloadFrac + 0.08 * Math.sin(now / 40);   // charging ramp
    } else if (cur.mag === 0 && cur.reserve === 0) {
      chg = Math.random() < 0.01 ? 0.3 : 0.05;                          // dead sputter
    } else {
      chg = 0.14 + 0.72 * (cur.mag / cur.magSize);
    }
    this.tubeCharge.set(chg);

    // --- console: XMIT tube — kicks to full on every weapon:fire, then
    // cools; automatic fire holds it glowing like a working transmitter. ---
    this._xmitSurge = Math.max(0, this._xmitSurge - dt * 3.4);
    this.tubeXmit.set(0.2 + 0.03 * Math.sin(now / 300) + this._xmitSurge * 0.8);

    // --- console: alarm lamp + AIM indicator ---
    this._alarm = Math.max(0, this._alarm - dt * 2);
    this.alarmLamp.style.opacity = (0.35 + this._alarm * 0.65).toFixed(2);
    this.alarmLamp.classList.toggle('lit', this._alarm > 0.05 || hpFrac < 0.25);
    this.aimLamp.classList.toggle('on', this._scoped);
    this.aimState.textContent = this._scoped ? 'ON' : 'OFF';

    // --- console: WEAPON panel (icon + fire mode) ---
    if (this._weaponShown !== cur.id) {
      this._weaponShown = cur.id;
      this._drawGlyph(this.weaponIcon, cur.id, '#e2c26a');
      this.weaponMode.textContent = cur.reloading ? 'RELOAD' : cur.fireMode;
    } else {
      const mode = cur.reloading ? 'RELOAD'
        : (cur.mag === 0 && cur.reserve === 0 && cur.id !== 'bat') ? 'EMPTY' : cur.fireMode;
      if (this.weaponMode.textContent !== mode) this.weaponMode.textContent = mode;
    }
    this.weaponMode.classList.toggle('warn', cur.reloading);
    this.weaponMode.classList.toggle('empty', cur.mag === 0 && cur.reserve === 0 && cur.id !== 'bat');
    // reload charge line under the silhouette (mirrors the CHARGE tube ramp)
    this.weaponCharge.style.width = cur.reloading ? (cur.reloadFrac * 100).toFixed(1) + '%' : '0%';

    // --- console: ARMS grid (persistent 6-slot armoury) ---
    if (!this.armsSlots.length) {
      d.weapons.forEach((w) => {
        const slot = this._el('div', null, this.armsGrid, 'arms-slot');
        const key = this._el('div', null, slot, 'arms-key'); key.textContent = w.slot;
        const cv = document.createElement('canvas'); cv.width = 44; cv.height = 22; cv.className = 'arms-icon';
        this._drawGlyph(cv, w.id, '#b9a24a'); slot.appendChild(cv);
        const rsv = this._el('div', null, slot, 'arms-rsv');
        this.armsSlots.push({ slot, rsv });
      });
      // pad to a 6th decorative empty bay to match the reference grid
      const empty = this._el('div', null, this.armsGrid, 'arms-slot empty');
      empty.innerHTML = '<div class="arms-key">6</div>';
    }
    d.weapons.forEach((w, i) => {
      const s = this.armsSlots[i];
      s.slot.classList.toggle('active', w.active);
      s.slot.classList.toggle('dry', w.mag === 0 && w.reserve === 0 && w.id !== 'bat');
      const rsv = w.mag === Infinity ? '∞' : w.reserve === Infinity ? '∞' : w.reserve;
      const mag = w.mag === Infinity ? '·' : w.mag;
      s.rsv.textContent = `${mag}·${rsv}`;
    });

    // --- right side HUD: CONFIRMED KILLS tally device ---
    this._odoDigits(this.killsOdo, d.kills, 6);
    const killRatio = Math.min(1, d.kills / WIN_KILLS);
    this.killGauge.set(killRatio);
    this.killBars.tot.style.width = (killRatio * 100).toFixed(3) + '%';
    this.killBars.k.style.width = (((d.kills % 1000) / 1000) * 100).toFixed(1) + '%';
    this.killBars.acc.style.width = (Math.max(0, Math.min(1, d.accuracy)) * 100).toFixed(1) + '%';
    if (this._lastKills === undefined) this._lastKills = d.kills;
    if (d.kills > this._lastKills) {
      this._killBlip = 0.35;
      if (((d.kills / 1000) | 0) > ((this._lastKills / 1000) | 0)) this._milestone = 3;
    }
    this._lastKills = d.kills;
    this._killBlip = Math.max(0, (this._killBlip || 0) - dt);
    this._milestone = Math.max(0, (this._milestone || 0) - dt);
    this.killLamps.hit.classList.toggle('lit', this._killBlip > 0);
    this.killLamps.mile.classList.toggle('lit', this._milestone > 0 && Math.sin(now / 90) > -0.2);
    this.killLamps.pwr.classList.add('lit');
    this.killLamps.pwr.style.opacity = (0.78 + 0.22 * Math.sin(now / 640)).toFixed(2);
    this.remainEl.textContent = 'REMAINING ' + Math.max(0, WIN_KILLS - d.kills).toLocaleString('en-US');

    // --- left side HUD: WAVE field device ---
    this.waveEl.textContent = d.wave.n === 0 ? '—' : String(d.wave.n).padStart(2, '0');
    this.zoneEl.textContent = d.zoneName.toUpperCase();
    const active = d.wave.state === 'active';
    const respite = d.wave.state === 'respite';
    const quota = d.wave.quota || 0;
    const cleared = Math.min(d.wave.killsThisWave || 0, quota);
    this.waveClearedEl.textContent = active ? cleared : d.wave.n === 0 ? 0 : quota;
    this.waveQuotaEl.textContent = quota;
    // needle + red bar carry the same wave-clearance value the old bar did
    const waveRatio = active && quota ? Math.min(1, cleared / quota) : respite ? 1 : 0;
    this.waveGauge.set(waveRatio);
    this.waveBars.clr.style.width = (waveRatio * 100).toFixed(1) + '%';
    this.waveBars.clr.classList.toggle('done', !active);
    // blue bar drains with the respite clock (10 s standard breather)
    const respFrac = respite ? Math.max(0, Math.min(1, d.wave.respiteLeft / 10)) : 0;
    this.waveBars.rsp.style.width = (respFrac * 100).toFixed(1) + '%';
    const secFrac = d.secrets && d.secrets.total ? d.secrets.found / d.secrets.total : 0;
    this.waveBars.sec.style.width = (secFrac * 100).toFixed(1) + '%';
    // state lamps: calm (pre-fight grace) / incoming (respite, blinking) / combat
    this.waveLamps.calm.classList.toggle('lit', respite && d.wave.n === 0);
    this.waveLamps.incoming.classList.toggle('lit', respite && Math.sin(now / 160) > -0.25);
    this.waveLamps.combat.classList.toggle('lit', active);
    // WAVE tube: rages with an erratic beat during combat, hard-blinks in
    // step with the incoming lamp through a respite, idles on a slow breath
    this.tubeWave.set(active
      ? 0.52 + 0.2 * Math.sin(now / 90) * Math.sin(now / 37) + 0.14 * Math.sin(now / 210)
      : respite ? (Math.sin(now / 160) > -0.25 ? 0.7 : 0.12)
        : 0.16 + 0.08 * Math.sin(now / 800));
    this.supplyChip.classList.toggle('lit', respite && d.wave.n > 0);
    this.respiteEl.textContent = respite
      ? (d.wave.n === 0 ? 'THEY ARE COMING · ' : 'RESPITE · ') + Math.ceil(d.wave.respiteLeft) + 's'
      : 'HOLD THE LINE';

    // --- fly-in ARMORY names (built once) ---
    if (!this.slotEls.length) {
      for (const w of d.weapons) {
        const slot = this._el('div', null, this.menuSlots, 'wm-slot');
        const cv = document.createElement('canvas'); cv.width = 64; cv.height = 34;
        cv.className = 'wm-glyph'; this._drawGlyph(cv, w.id, '#e0b840');
        const key = this._el('div', null, slot, 'wm-key'); key.textContent = w.slot;
        slot.appendChild(cv);
        this._el('div', null, slot, 'wm-name').textContent = w.flavor || w.name;
        this._el('div', null, slot, 'wm-ammo');
        this.slotEls.push(slot);
      }
    }
    d.weapons.forEach((w, i) => {
      const slot = this.slotEls[i];
      slot.classList.toggle('active', w.active);
      slot.classList.toggle('dry', w.mag === 0 && w.reserve === 0 && w.id !== 'bat');
      const ammo = slot.querySelector('.wm-ammo');
      ammo.textContent = w.mag === Infinity ? 'MELEE'
        : `${w.mag} / ${w.reserve === Infinity ? '∞' : w.reserve}`;
    });
    if (this._menuTimer > 0) {
      this._menuTimer -= dt;
      if (this._menuTimer <= 0) this.hideWeaponMenu();
    }

    // --- prompt ---
    if (d.prompt) {
      this.promptEl.textContent = typeof d.prompt === 'function' ? d.prompt() : d.prompt;
      this.promptEl.style.display = 'block';
    } else {
      this.promptEl.style.display = 'none';
    }

    // --- subtitle fade ---
    if (this._subtitleTimer > 0) {
      this._subtitleTimer -= dt;
      this.subtitleEl.style.opacity = Math.min(1, this._subtitleTimer / 0.6);
    } else {
      this.subtitleEl.style.opacity = 0;
    }

    // --- damage vignette + heal flash ---
    this._vignette = Math.max(0, this._vignette - dt * 1.4);
    const lowHp = hpFrac < 0.3 ? (0.3 - hpFrac) * 1.6 * (0.7 + 0.3 * Math.sin(performance.now() / 220)) : 0;
    document.getElementById('vignette').style.opacity = Math.min(1, this._vignette + lowHp);
    this._heal = Math.max(0, this._heal - dt);
    document.getElementById('healflash').style.opacity = this._heal;
  }
}
