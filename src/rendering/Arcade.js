/**
 * The arcade cabinets, and the four machines that are actually in them.
 *
 * There is one arcade in this town and it used to be four coloured boxes. Now
 * each cabinet is a MACHINE: its own marquee, its own screen art, its own
 * palette, and a game you can walk up to and play. Walking into a shop in a
 * dead town and finding something that still works is the whole reason the
 * building is there.
 *
 * Everything is drawn on one 320x240 canvas scaled up with nearest-neighbour,
 * so the games look like the rest of the game rather than like a web page that
 * turned up inside it. Each machine renders its own attract frame too, which
 * is what goes on the cabinet's screen out in the world — so a cabinet across
 * the room is recognisably the machine you played, not a lit rectangle.
 *
 * The host decouples it from the Game exactly the way the satchel does:
 *   onOpen()   free the cursor, freeze the world
 *   onClose()  hand the mouse back and carry on
 *   onScore(id, score, best)  a run finished; the world may do as it likes
 *
 * Escape closes the machine and drops the player straight back into the game.
 * It never reaches the pause menu: the handler runs in the capture phase and
 * stops the event dead, because a player leaving Asteroids wants to be back in
 * the street, not looking at a stats panel.
 */
const W = 320, H = 240;

/** Per-machine identity: palette, title, and the flavour under the marquee. */
export const MACHINES = {
  brickfall: {
    title: 'BRICKFALL', sub: 'CLEAR THE COURSE',
    ink: '#7be07b', dim: '#2c5c34', hot: '#e6c24a', body: 0x5e2430, trim: 0xa8474f,
    how: '← → MOVE   SPACE LAUNCH',
  },
  vermin: {
    title: 'VERMIN', sub: 'IT GETS LONGER',
    ink: '#9be86a', dim: '#2a5a26', hot: '#e05a44', body: 0x2e4433, trim: 0x63a04a,
    how: 'ARROWS TURN',
  },
  siege: {
    title: 'SIEGE', sub: 'HOLD THE LINE',
    ink: '#7ea4e8', dim: '#24365e', hot: '#e6c24a', body: 0x39465e, trim: 0x5f80c0,
    how: '← → MOVE   SPACE FIRE',
  },
  rally: {
    title: 'RALLY', sub: 'FIRST TO SEVEN',
    ink: '#e6c24a', dim: '#5c4a18', hot: '#ffe7a0', body: 0x6b4a1e, trim: 0xc08a34,
    how: '↑ ↓ MOVE',
  },
};
export const MACHINE_IDS = Object.keys(MACHINES);

/* ------------------------------------------------------------------ */
/* the four games                                                       */
/* ------------------------------------------------------------------ */
/**
 * Each game is { reset(), update(dt, keys, pressed), draw(ctx), score, over,
 * won }. `keys` is a live Set of held codes; `pressed` is the edge set for
 * this frame. None of them touch anything outside their own state.
 */
function brickfall(m) {
  const g = {
    score: 0, over: false, won: false, lives: 3,
    px: W / 2, bx: W / 2, by: H - 30, vx: 0, vy: 0, live: false, bricks: [],
  };
  g.reset = () => {
    g.score = 0; g.over = false; g.won = false; g.lives = 3;
    g.px = W / 2; g.live = false; g.bricks = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 10; c++) g.bricks.push({ x: 14 + c * 30, y: 34 + r * 14, r });
    }
  };
  g.update = (dt, keys) => {
    if (g.over) return;
    const sp = 190 * dt;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) g.px -= sp;
    if (keys.has('ArrowRight') || keys.has('KeyD')) g.px += sp;
    g.px = Math.max(24, Math.min(W - 24, g.px));
    if (!g.live) {
      g.bx = g.px; g.by = H - 30;
      if (keys.has('Space')) { g.live = true; g.vx = 95; g.vy = -155; }
      return;
    }
    g.bx += g.vx * dt; g.by += g.vy * dt;
    if (g.bx < 6 || g.bx > W - 6) { g.vx *= -1; g.bx = Math.max(6, Math.min(W - 6, g.bx)); }
    if (g.by < 20) { g.vy *= -1; g.by = 20; }
    // paddle: the bounce angle follows where on the paddle it landed
    if (g.by > H - 26 && g.by < H - 18 && Math.abs(g.bx - g.px) < 26) {
      g.vy = -Math.abs(g.vy);
      g.vx = (g.bx - g.px) / 26 * 165;
      g.by = H - 26;
    }
    if (g.by > H) {
      g.lives--; g.live = false;
      if (g.lives <= 0) g.over = true;
    }
    for (let i = 0; i < g.bricks.length; i++) {
      const b = g.bricks[i];
      if (g.bx > b.x - 15 && g.bx < b.x + 15 && g.by > b.y - 6 && g.by < b.y + 6) {
        g.bricks.splice(i, 1);
        g.vy *= -1;
        g.score += (5 - b.r) * 10;
        if (!g.bricks.length) { g.over = true; g.won = true; }
        break;
      }
    }
  };
  g.draw = (ctx) => {
    for (const b of g.bricks) {
      ctx.fillStyle = b.r % 2 ? m.ink : m.dim;
      ctx.fillRect(b.x - 14, b.y - 5, 28, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(b.x - 14, b.y + 3, 28, 2);
    }
    ctx.fillStyle = m.hot;
    ctx.fillRect(g.px - 24, H - 22, 48, 5);
    ctx.fillRect(g.bx - 3, g.by - 3, 6, 6);
    ctx.fillStyle = m.dim;
    for (let i = 0; i < g.lives; i++) ctx.fillRect(10 + i * 9, H - 10, 6, 3);
  };
  return g;
}

function vermin(m) {
  const CELL = 10, COLS = 30, ROWS = 20, TOP = 24;
  const g = { score: 0, over: false, won: false, body: [], dir: [1, 0], next: [1, 0], food: [10, 10], t: 0 };
  g.reset = () => {
    g.score = 0; g.over = false; g.won = false; g.t = 0;
    g.body = [[6, 10], [5, 10], [4, 10]];
    g.dir = [1, 0]; g.next = [1, 0];
    g.food = [18, 10];
  };
  g.update = (dt, keys, pressed) => {
    if (g.over) return;
    // queued, and never a straight reversal into your own neck
    if (pressed.has('ArrowLeft') && g.dir[0] === 0) g.next = [-1, 0];
    if (pressed.has('ArrowRight') && g.dir[0] === 0) g.next = [1, 0];
    if (pressed.has('ArrowUp') && g.dir[1] === 0) g.next = [0, -1];
    if (pressed.has('ArrowDown') && g.dir[1] === 0) g.next = [0, 1];
    g.t += dt;
    const step = Math.max(0.06, 0.16 - g.body.length * 0.002);
    if (g.t < step) return;
    g.t = 0;
    g.dir = g.next;
    const head = [g.body[0][0] + g.dir[0], g.body[0][1] + g.dir[1]];
    if (head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS
        || g.body.some((s) => s[0] === head[0] && s[1] === head[1])) {
      g.over = true;
      return;
    }
    g.body.unshift(head);
    if (head[0] === g.food[0] && head[1] === g.food[1]) {
      g.score += 25;
      let tries = 0;
      do {
        g.food = [(Math.random() * COLS) | 0, (Math.random() * ROWS) | 0];
      } while (tries++ < 60 && g.body.some((s) => s[0] === g.food[0] && s[1] === g.food[1]));
      if (g.body.length >= COLS * ROWS - 4) { g.over = true; g.won = true; }
    } else {
      g.body.pop();
    }
  };
  g.draw = (ctx) => {
    ctx.fillStyle = m.dim;
    for (let x = 0; x <= COLS; x += 5) ctx.fillRect(x * CELL + 10, TOP, 1, ROWS * CELL);
    for (let y = 0; y <= ROWS; y += 5) ctx.fillRect(10, TOP + y * CELL, COLS * CELL, 1);
    ctx.fillStyle = m.hot;
    ctx.fillRect(10 + g.food[0] * CELL + 2, TOP + g.food[1] * CELL + 2, CELL - 4, CELL - 4);
    g.body.forEach((s, i) => {
      ctx.fillStyle = i ? m.ink : '#ffffff';
      ctx.fillRect(10 + s[0] * CELL + 1, TOP + s[1] * CELL + 1, CELL - 2, CELL - 2);
    });
  };
  return g;
}

function siege(m) {
  const g = { score: 0, over: false, won: false, px: W / 2, shots: [], bombs: [], rows: [], dir: 1, drop: 0, fire: 0, lives: 3 };
  g.reset = () => {
    g.score = 0; g.over = false; g.won = false; g.lives = 3;
    g.px = W / 2; g.shots = []; g.bombs = []; g.dir = 1; g.drop = 0; g.fire = 0;
    g.rows = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) g.rows.push({ x: 40 + c * 30, y: 36 + r * 20, r });
  };
  g.update = (dt, keys) => {
    if (g.over) return;
    const sp = 150 * dt;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) g.px -= sp;
    if (keys.has('ArrowRight') || keys.has('KeyD')) g.px += sp;
    g.px = Math.max(14, Math.min(W - 14, g.px));
    g.fire -= dt;
    if (keys.has('Space') && g.fire <= 0) { g.shots.push({ x: g.px, y: H - 30 }); g.fire = 0.34; }
    for (const s of g.shots) s.y -= 260 * dt;
    g.shots = g.shots.filter((s) => s.y > 16);
    // the block marches, and drops a rank every time it meets a wall
    const speed = 16 + (32 - g.rows.length) * 2.4;
    let bump = false;
    for (const a of g.rows) {
      a.x += g.dir * speed * dt;
      if (a.x < 16 || a.x > W - 16) bump = true;
    }
    if (bump) { g.dir *= -1; for (const a of g.rows) a.y += 9; }
    g.drop -= dt;
    if (g.drop <= 0 && g.rows.length) {
      g.drop = 0.7 + Math.random() * 0.9;
      const a = g.rows[(Math.random() * g.rows.length) | 0];
      g.bombs.push({ x: a.x, y: a.y });
    }
    for (const b of g.bombs) b.y += 105 * dt;
    g.bombs = g.bombs.filter((b) => {
      if (b.y > H - 26 && Math.abs(b.x - g.px) < 12) {
        g.lives--;
        if (g.lives <= 0) g.over = true;
        return false;
      }
      return b.y < H;
    });
    for (let i = g.rows.length - 1; i >= 0; i--) {
      const a = g.rows[i];
      if (a.y > H - 34) { g.over = true; return; }
      for (let j = g.shots.length - 1; j >= 0; j--) {
        const s = g.shots[j];
        if (Math.abs(s.x - a.x) < 11 && Math.abs(s.y - a.y) < 8) {
          g.rows.splice(i, 1); g.shots.splice(j, 1);
          g.score += (4 - a.r) * 15;
          break;
        }
      }
    }
    if (!g.rows.length) { g.over = true; g.won = true; }
  };
  g.draw = (ctx) => {
    for (const a of g.rows) {
      ctx.fillStyle = a.r % 2 ? m.ink : m.dim;
      ctx.fillRect(a.x - 9, a.y - 5, 18, 8);
      ctx.fillRect(a.x - 11, a.y - 2, 3, 6);
      ctx.fillRect(a.x + 8, a.y - 2, 3, 6);
    }
    ctx.fillStyle = m.hot;
    for (const s of g.shots) ctx.fillRect(s.x - 1, s.y - 5, 2, 7);
    ctx.fillStyle = '#e05a44';
    for (const b of g.bombs) ctx.fillRect(b.x - 1, b.y, 2, 6);
    ctx.fillStyle = m.hot;
    ctx.fillRect(g.px - 11, H - 24, 22, 5);
    ctx.fillRect(g.px - 2, H - 30, 4, 6);
    ctx.fillStyle = m.dim;
    for (let i = 0; i < g.lives; i++) ctx.fillRect(10 + i * 9, H - 10, 6, 3);
  };
  return g;
}

function rally(m) {
  const g = { score: 0, over: false, won: false, py: H / 2, ey: H / 2, bx: W / 2, by: H / 2, vx: 150, vy: 90, you: 0, them: 0 };
  g.reset = () => {
    g.score = 0; g.over = false; g.won = false; g.you = 0; g.them = 0;
    g.py = H / 2; g.ey = H / 2; g.bx = W / 2; g.by = H / 2; g.vx = 150; g.vy = 90;
  };
  const serve = (toYou) => {
    g.bx = W / 2; g.by = H / 2;
    g.vx = toYou ? -150 : 150;
    g.vy = (Math.random() - 0.5) * 150;
  };
  g.update = (dt, keys) => {
    if (g.over) return;
    const sp = 175 * dt;
    if (keys.has('ArrowUp') || keys.has('KeyW')) g.py -= sp;
    if (keys.has('ArrowDown') || keys.has('KeyS')) g.py += sp;
    g.py = Math.max(46, Math.min(H - 24, g.py));
    // the house paddle is beatable on purpose: it tracks late and tops out
    const want = g.by;
    g.ey += Math.max(-128 * dt, Math.min(128 * dt, want - g.ey));
    g.ey = Math.max(46, Math.min(H - 24, g.ey));
    g.bx += g.vx * dt; g.by += g.vy * dt;
    if (g.by < 28) { g.by = 28; g.vy *= -1; }
    if (g.by > H - 8) { g.by = H - 8; g.vy *= -1; }
    if (g.bx < 24 && Math.abs(g.by - g.py) < 22 && g.vx < 0) {
      g.vx = Math.abs(g.vx) * 1.04; g.vy += (g.by - g.py) * 2.2;
    }
    if (g.bx > W - 24 && Math.abs(g.by - g.ey) < 22 && g.vx > 0) {
      g.vx = -Math.abs(g.vx) * 1.04; g.vy += (g.by - g.ey) * 2.0;
    }
    if (g.bx < 4) { g.them++; serve(false); }
    if (g.bx > W - 4) { g.you++; g.score += 100; serve(true); }
    if (g.you >= 7 || g.them >= 7) { g.over = true; g.won = g.you >= 7; }
  };
  g.draw = (ctx) => {
    ctx.fillStyle = m.dim;
    for (let y = 28; y < H; y += 14) ctx.fillRect(W / 2 - 1, y, 2, 8);
    ctx.fillStyle = m.ink;
    ctx.fillRect(16, g.py - 20, 5, 40);
    ctx.fillRect(W - 21, g.ey - 20, 5, 40);
    ctx.fillStyle = m.hot;
    ctx.fillRect(g.bx - 3, g.by - 3, 6, 6);
    ctx.fillStyle = m.ink;
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(g.you), W / 2 - 40, 52);
    ctx.fillText(String(g.them), W / 2 + 40, 52);
  };
  return g;
}

const BUILDERS = { brickfall, vermin, siege, rally };

/* ------------------------------------------------------------------ */
/* cabinet art                                                          */
/* ------------------------------------------------------------------ */
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** The lit marquee over the screen: title on a coloured field, and a border. */
export function marqueeArt(id) {
  const m = MACHINES[id];
  const c = canvas(128, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0d0a'; ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = m.ink; ctx.globalAlpha = 0.16; ctx.fillRect(0, 0, 128, 32); ctx.globalAlpha = 1;
  ctx.strokeStyle = m.hot; ctx.lineWidth = 2; ctx.strokeRect(3, 3, 122, 26);
  ctx.fillStyle = m.hot;
  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(m.title, 64, 15);
  return c;
}

/**
 * The attract frame the cabinet shows out in the world — a still of the game
 * itself, so a machine across the room is the machine you played.
 *
 * `step` walks the simulation on before the frame is taken, which is what
 * makes screenSheet's four frames a SEQUENCE rather than four unrelated
 * stills: the ball is further along its arc, the snake is longer, the line has
 * lost another block.
 */
export function screenArt(id, step = 0) {
  const m = MACHINES[id];
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
  const g = BUILDERS[id](m);
  g.reset();
  // walk it forward a little so the frame is a game in progress, not a set-up
  const keys = new Set(['Space']);
  for (let i = 0; i < 90 + step; i++) g.update(1 / 30, keys, new Set());
  g.draw(ctx);
  ctx.fillStyle = m.hot;
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(m.title, W / 2, 16);
  ctx.fillStyle = m.ink;
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillText('INSERT COIN', W / 2, H - 6);
  for (let y = 0; y < H; y += 3) {            // the tube's own scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, y, W, 1);
  }
  return c;
}

/** How many frames the cabinet's attract loop runs on. */
export const ATTRACT_FRAMES = 4;
/** Simulation ticks between one attract frame and the next. */
const ATTRACT_STEP = 11;

/**
 * The attract LOOP, as a 2x2 atlas.
 *
 * A cabinet whose screen holds one frozen still is a poster, not a machine.
 * Four frames of the machine's own game, stepped in order on a slow beat, is
 * enough to read as "something is playing over there" from across the room —
 * and it costs one texture and one UV offset per cabinet, because the world's
 * existing flipbook driver (World._animateMat, kind 'flip') already knows how
 * to walk an atlas.
 */
export function screenSheet(id) {
  const sheet = canvas(W * 2, H * 2);
  const ctx = sheet.getContext('2d');
  for (let i = 0; i < ATTRACT_FRAMES; i++) {
    const frame = screenArt(id, i * ATTRACT_STEP);
    ctx.drawImage(frame, (i % 2) * W, Math.floor(i / 2) * H);
  }
  return sheet;
}

/**
 * The printed SIDE ART — the thing that actually makes an arcade cabinet look
 * like an arcade cabinet rather than a coloured box. Deco rays fanning off a
 * corner, the title set sideways up the flank, and the paint scuffed along the
 * bottom edge where a decade of shoes went past it.
 */
export function sideArt(id) {
  const w = 96, h = 160;
  const m = MACHINES[id];
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hexOf(m.body); ctx.fillRect(0, 0, w, h);
  // rays fanning from the top-front corner
  ctx.save();
  ctx.translate(w, 0);
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 2 ? m.hot : m.ink;
    ctx.globalAlpha = 0.5 - i * 0.035;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const a0 = (i / 9) * Math.PI * 0.62 + Math.PI * 0.52;
    const a1 = ((i + 0.62) / 9) * Math.PI * 0.62 + Math.PI * 0.52;
    ctx.lineTo(Math.cos(a0) * 260, Math.sin(a0) * 260);
    ctx.lineTo(Math.cos(a1) * 260, Math.sin(a1) * 260);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // a deco band and the title running up the flank
  ctx.fillStyle = m.trim !== undefined ? hexOf(m.trim) : m.hot;
  ctx.fillRect(6, h * 0.5, w - 12, 3);
  ctx.fillRect(6, h * 0.5 + 6, w - 12, 1);
  ctx.save();
  ctx.translate(w * 0.46, h * 0.78);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = m.hot;
  ctx.font = 'bold 17px "Courier New", monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(m.title, 0, 0);
  ctx.restore();
  // wear: scuffs along the kick strip, grime in the bottom corners
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, h - 14, w, 14);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * w, y = h - Math.random() * Math.random() * 46;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '210,206,190'},${(Math.random() * 0.18).toFixed(3)})`;
    ctx.fillRect(x, y, 1 + Math.random() * 5, 1);
  }
  return c;
}

/** Painted sheet steel for the cabinet body — tiles, and takes the machine's
 *  own colour so the four cabinets are four products, not one repainted. */
export function cabinetSkin(id) {
  const n = 64;
  const m = MACHINES[id];
  const c = canvas(n, n);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hexOf(m.body); ctx.fillRect(0, 0, n, n);
  const img = ctx.getImageData(0, 0, n, n);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // orange-peel in the paint, plus the odd bright fleck of bare metal
    const k = 0.86 + Math.random() * 0.26;
    const fleck = Math.random() > 0.996 ? 46 : 0;
    d[i] = Math.min(255, d[i] * k + fleck);
    d[i + 1] = Math.min(255, d[i + 1] * k + fleck);
    d[i + 2] = Math.min(255, d[i + 2] * k + fleck);
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 14; i++) {              // hairline scratches
    ctx.strokeStyle = `rgba(235,232,220,${(0.04 + Math.random() * 0.07).toFixed(3)})`;
    ctx.beginPath();
    const x = Math.random() * n, y = Math.random() * n, a = Math.random() * Math.PI;
    ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); ctx.stroke();
  }
  return c;
}

function hexOf(v) { return '#' + v.toString(16).padStart(6, '0'); }

/* ------------------------------------------------------------------ */
/* the overlay                                                          */
/* ------------------------------------------------------------------ */
export class Arcade {
  constructor(root, callbacks = {}) {
    this.callbacks = callbacks;
    this.open = false;
    this.id = null;
    this.game = null;
    this.best = {};              // machine id -> best score this run
    this.keys = new Set();
    this.pressed = new Set();
    this._build(root);
    this._wire();
  }

  _build(root) {
    this.el = document.createElement('div');
    this.el.id = 'arcade';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="arc-cab">
        <div class="screw tl"></div><div class="screw tr"></div>
        <div class="screw bl"></div><div class="screw br"></div>
        <div class="arc-marquee"><span class="arc-title"></span><span class="arc-sub"></span></div>
        <div class="arc-bezel">
          <canvas class="arc-screen" width="${W}" height="${H}"></canvas>
          <div class="arc-glass"></div>
          <div class="arc-msg"></div>
        </div>
        <div class="arc-deck">
          <span class="arc-score">SCORE <b>0</b></span>
          <span class="arc-how"></span>
          <span class="arc-best">BEST <b>0</b></span>
        </div>
        <div class="arc-coin">ESC — STEP AWAY FROM THE MACHINE</div>
      </div>`;
    root.appendChild(this.el);
    this.canvas = this.el.querySelector('.arc-screen');
    this.ctx = this.canvas.getContext('2d');
    this.titleEl = this.el.querySelector('.arc-title');
    this.subEl = this.el.querySelector('.arc-sub');
    this.howEl = this.el.querySelector('.arc-how');
    this.scoreEl = this.el.querySelector('.arc-score b');
    this.bestEl = this.el.querySelector('.arc-best b');
    this.msgEl = this.el.querySelector('.arc-msg');
    this.cabEl = this.el.querySelector('.arc-cab');
  }

  _wire() {
    // Capture phase, and the event is stopped dead. Escape at a cabinet means
    // "put the controller down and get back in the street" — it must never
    // reach the pause handler and leave the player looking at a stats panel
    // they did not ask for.
    document.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.pressed.add(e.code);
        if (e.code === 'Space' && this.game?.over) this._start();
      }
    }, true);
    document.addEventListener('keyup', (e) => {
      if (!this.open) return;
      e.stopImmediatePropagation();
      this.keys.delete(e.code);
    }, true);
  }

  /** Open machine `id`. Returns false if it is not a machine. */
  play(id) {
    if (this.open || !MACHINES[id]) return false;
    const m = MACHINES[id];
    this.id = id;
    this.open = true;
    this.game = BUILDERS[id](m);
    this.el.style.display = 'flex';
    this.cabEl.style.setProperty('--ink', m.ink);
    this.cabEl.style.setProperty('--dim', m.dim);
    this.cabEl.style.setProperty('--hot', m.hot);
    this.titleEl.textContent = m.title;
    this.subEl.textContent = m.sub;
    this.howEl.textContent = m.how;
    this.bestEl.textContent = String(this.best[id] || 0);
    this.keys.clear();
    this.pressed.clear();
    this._start();
    this.callbacks.onOpen?.(id);
    return true;
  }

  _start() {
    this.game.reset();
    this.msgEl.textContent = '';
    this.msgEl.classList.remove('on');
    this._ended = false;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.style.display = 'none';
    this.keys.clear();
    this.callbacks.onClose?.();
  }

  /** Called every frame by the host, open or not. */
  update(dt) {
    if (!this.open || !this.game) return;
    const g = this.game;
    const was = g.over;
    g.update(Math.min(0.05, dt), this.keys, this.pressed);
    this.pressed.clear();
    if (g.over && !was) this._finish();
    this.scoreEl.textContent = String(g.score);
    this._draw();
  }

  _finish() {
    const best = Math.max(this.best[this.id] || 0, this.game.score);
    this.best[this.id] = best;
    this.bestEl.textContent = String(best);
    this.msgEl.textContent = this.game.won ? 'CLEARED — SPACE TO PLAY AGAIN' : 'GAME OVER — SPACE TO PLAY AGAIN';
    this.msgEl.classList.add('on');
    this.callbacks.onScore?.(this.id, this.game.score, best, !!this.game.won);
  }

  _draw() {
    const ctx = this.ctx;
    const m = MACHINES[this.id];
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    this.game.draw(ctx);
    ctx.restore();
    // header strip: the machine's own name, always on the tube
    ctx.fillStyle = m.dim;
    ctx.fillRect(0, 0, W, 18);
    ctx.fillStyle = m.hot;
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(m.title, 8, 13);
    ctx.textAlign = 'right';
    ctx.fillText(String(this.game.score).padStart(6, '0'), W - 8, 13);
  }
}
