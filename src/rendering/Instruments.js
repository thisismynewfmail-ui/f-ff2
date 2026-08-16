/**
 * The instrument kit: the physical readouts the panels are built from.
 *
 * These used to be private methods on HUD, which meant the pause bench was the
 * only screen that could be built out of instruments — the title screen's
 * LAST SESSION card had to restate the same six quantities as a list of
 * label/value rows, in a completely different visual language, on the same
 * chassis. One kit, used by both, is what makes the two screens read as the
 * same machine: a kill count is an odometer wherever you meet it, an accuracy
 * is a needle, a time is a split-flap board.
 *
 * Every builder here returns plain DOM plus the handful of nodes a caller has
 * to drive; the CSS for all of it lives in the pause-panel section of
 * styles.css and is shared verbatim.
 */

/** Cheap, stable value noise — used to speckle the gauge dials identically. */
function n01(i, j) {
  let h = i * 374761393 + j * 668265263 + 1013904223;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h >>> 0) % 100000) / 100000;
}

export function el(tag, parent, className = '', id = '') {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
}

/** A titled instrument bay with its own bezel. `area` names its grid slot. */
export function bay(parent, area, label) {
  const e = el('div', parent, 'bay bay-' + area);
  el('div', e, 'bay-label').textContent = label;
  return { el: e, body: el('div', e, 'bay-body') };
}

/* ---------------- the needle gauge ---------------- */

/**
 * An analogue meter: aged ivory dial baked to a canvas, a condition band under
 * the ticks, and a needle that sweeps to its value.
 */
export function deviceGauge(parent, opts) {
  const mod = el('div', parent, 'dev-gauge');
  const bezel = el('div', mod, 'dev-gauge-bezel');
  const face = el('div', bezel, 'dev-gauge-face');
  const cv = document.createElement('canvas');
  cv.width = 192; cv.height = 128; cv.className = 'dev-gauge-dial';
  drawGaugeFace(cv, opts);
  face.appendChild(cv);
  const needle = el('div', face, 'dev-needle');
  el('div', face, 'dev-needle-cap');
  el('div', face, 'dev-glass');
  const caption = el('div', mod, 'dev-gauge-cap');
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
export function drawGaugeFace(cv, { sub = '', majors = [], bands = [] }) {
  const ctx = cv.getContext('2d');
  ctx.save();
  ctx.scale(2, 2);
  const W = cv.width / 2, H = cv.height / 2;
  // Aged dial card, yellowed toward the rim + foxing speckles. Kept well
  // below paper-white: on a chassis this dark a bright dial is the first
  // thing the eye goes to, and the dial is not the readout that matters.
  const age = ctx.createRadialGradient(W / 2, H - 5, 6, W / 2, H - 5, W * 0.72);
  age.addColorStop(0, '#cdc3a0'); age.addColorStop(0.7, '#bcb18d'); age.addColorStop(1, '#9d9370');
  ctx.fillStyle = age; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(122,96,54,${(0.03 + n01(i, 4) * 0.05).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(n01(i, 1) * W, n01(i, 2) * H, 1 + n01(i, 3) * 5, 0, Math.PI * 2);
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

/** The standard band set for a percentage that is bad low and good high. */
export const HIT_BANDS = [
  { from: 0, to: 0.3, color: '#a83428' },
  { from: 0.3, to: 0.65, color: '#c1922f' },
  { from: 0.65, to: 1, color: '#4f8f3a' },
];

/* ---------------- the odometer ---------------- */

export function odometer(parent, cls = '') {
  return el('div', parent, ('odometer ' + cls).trim());
}

/** Set an odometer's digits, ticking only the wheels that actually changed. */
export function odoDigits(e, value, digits) {
  const max = Math.pow(10, digits) - 1;
  const s = String(Math.max(0, Math.min(max, value | 0))).padStart(digits, '0');
  if (e._last === s) return;
  const prev = e._last;
  e._last = s;
  e.innerHTML = [...s].map((d) => `<span class="digit">${d}</span>`).join('');
  if (prev && prev.length === s.length) {
    for (let i = 0; i < s.length; i++) if (prev[i] !== s[i]) e.children[i].classList.add('tick');
  }
}

/** Spin an odometer up to its value over ~0.7 s, the way a counter settles. */
export function rollOdometer(e, value, digits) {
  clearInterval(e._roll);
  const target = Math.max(0, value | 0);
  const t0 = performance.now();
  e._roll = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / 700);
    // ease out hard: most of the count happens early, then it creeps home
    odoDigits(e, Math.round(target * (1 - Math.pow(1 - k, 3))), digits);
    if (k >= 1) clearInterval(e._roll);
  }, 40);
}

/* ---------------- punched tape, lamps, split-flap ---------------- */

/** Punched paper tape: a run bar under a crawling perforation, with the honest
 *  figure stencilled at the right-hand end. */
export function tape(parent) {
  const e = el('div', parent, 'tape');
  el('div', e, 'tape-sprockets');
  const run = el('div', e, 'tape-run');
  const punch = el('div', e, 'tape-punch');
  const pct = el('div', e, 'tape-pct');
  el('div', e, 'tape-head');
  return { el: e, run, punch, pct };
}

/** A row of `total` lamps, rebuilt only when the count itself changes. */
export function lampRow(row, lamps, total) {
  if (lamps.length === total) return lamps;
  row.innerHTML = '';
  const out = [];
  for (let i = 0; i < total; i++) {
    const l = el('div', row, 'sec-lamp');
    l.style.setProperty('--i', String(i));
    out.push(l);
  }
  return out;
}

/** A split-flap board of `pairs` two-digit groups, colon-separated. */
export function flapboard(parent, pairs = 3) {
  const board = el('div', parent, 'flapboard');
  const flaps = [];
  for (let i = 0; i < pairs; i++) {
    if (i) el('div', board, 'flap-colon').textContent = ':';
    const pair = el('div', board, 'flap-pair');
    flaps.push(el('div', pair, 'flap'), el('div', pair, 'flap'));
  }
  return { el: board, flaps };
}

/** Land a split-flap board: each card flips to its digit on a stagger. */
export function runFlaps(flaps, parts) {
  const digits = parts.flatMap((n) => String(Math.min(99, n)).padStart(2, '0').split(''));
  flaps.forEach((f, i) => {
    clearTimeout(f._flip);
    f._flip = setTimeout(() => {
      f.textContent = digits[i] ?? '0';
      f.classList.remove('flip');
      void f.offsetWidth;
      f.classList.add('flip');
    }, 120 + i * 70);
  });
}

/** Split seconds into the [hh, mm, ss] a flap board wants. */
export function hms(t) {
  const s = Math.max(0, t | 0);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)];
}
