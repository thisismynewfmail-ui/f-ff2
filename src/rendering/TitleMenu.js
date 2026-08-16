import { SettingsPanel } from './SettingsPanel.js';
import { WIN_KILLS } from '../systems/ScoreSystem.js';
import * as Inst from './Instruments.js';

/**
 * The title screen — "GO BACK TO THE SANDBOX", styled after the classic
 * Counter-Strike main menus: a left-hand rail of stencilled menu entries with
 * numbered hover brackets over the LIVE 3D town (the Game orbits its camera
 * around the player while the state machine sits in 'menu' — see
 * Game._menuCinematic), plus a right-hand instrument case.
 *
 * THE SIGN. The title is not type set on a page, it is an object hanging in
 * the town: a bolted steel plate with a hazard strip, a service stencil and
 * four screws, carrying two lines of embossed stamped lettering over one word
 * in gas tube. It is built character by character (_signLine) so it can be
 * ANIMATED as a physical thing rather than as a block of text — the stamped
 * lines drop and settle letter by letter as the plate powers up, the tube word
 * strikes after them the way a cold neon does (flicker, catch, flicker, hold),
 * one tube in it never quite holds, the plate carries a specular sweep and a
 * crawling hazard strip, and the whole sign hangs with a slow sway. The
 * sequence re-arms on every visit to the menu (see refresh).
 *
 * THE CASE. The right-hand column is the same instrument bench the pause
 * screen is: one machined case, bays with their own bezels, and the RUN's
 * quantities each read out on the instrument that quantity would really be
 * built as — kills on an odometer over punched tape, accuracy on a needle,
 * time on a split-flap board, secrets on a lamp row. It used to be a flat card
 * of label/value rows, which meant the first screen of the game and every
 * screen after it disagreed about what this machine looks like. Both are now
 * built from the shared kit in rendering/Instruments.js.
 *
 *   - LAST SESSION: the previous session's stats, served by the dev server's
 *     /api/session endpoint (localStorage on static hosts). When a save
 *     exists and no run is live, a RESUME LAST SESSION entry appears.
 *   - FIELD MANUAL: the control reference, in a bay of its own.
 *
 * SETTINGS (mouse sensitivity, invert Y, FOV, master volume and the re-bindable
 * KEY BINDINGS) live in a shared SettingsStore + SettingsPanel, so the identical
 * form is reused by the in-game pause Settings.
 *
 * The menu is DYNAMIC: entries appear/relabel by state (fresh boot vs a live
 * run parked behind the pause menu's QUIT TO TITLE) — refresh() re-renders,
 * and the HUD calls it every time the menu screen is shown.
 */
export class TitleMenu {
  constructor(el, actions, store) {
    this.el = el;
    this.actions = actions;
    this.store = store;
    this._build();
    this._wire();
  }

  _build() {
    this.el.innerHTML = `
      <div class="title-haze"></div>
      <div class="title-wrap">
        <div class="title-left">
          <h1 class="title-sign">
            <span class="sign-plate">
              <span class="screw tl"></span><span class="screw tr"></span>
              <span class="screw bl"></span><span class="screw br"></span>
              <span class="sign-hazard top"></span>
              <span class="sign-hazard bottom"></span>
              <span class="sign-sweep"></span>
              <span class="sign-serial">SDN&nbsp;·&nbsp;MK&nbsp;II&nbsp;·&nbsp;UNIT&nbsp;07</span>
            </span>
            <span class="sign-kicker">${this._signLine('SANDBOX DEFENSE NETWORK PRESENTS', 0)}</span>
            <span class="sign-stamped">${this._signLine('GO BACK', 0)}</span>
            <span class="sign-stamped">${this._signLine('TO THE', 7)}</span>
            <span class="sign-tubewrap">
              <span class="sign-bloom"></span>
              <span class="sign-tube">${this._signLine('SANDBOX', 0, 4)}</span>
            </span>
          </h1>
          <div class="title-tag">ZOMBIE WAVE SURVIVAL &middot; <b>250,000</b> CONFIRMED KILLS TO TAKE THE TOWN BACK</div>
          <nav class="title-nav">
            <button id="btn-return" class="tm-item" hidden><i>01</i>RETURN TO RUN</button>
            <button id="btn-start" class="tm-item"><i>02</i>NEW GAME</button>
            <button id="btn-continue" class="tm-item" hidden><i>03</i>RESUME LAST SESSION</button>
            <button id="btn-settings" class="tm-item"><i>04</i>SETTINGS</button>
            <button id="btn-exit" class="tm-item" hidden><i>05</i>EXIT GAME</button>
          </nav>
          <div class="title-foot">BUILD 2.5 &middot; THE FOG HOLDS &middot; DO NOT STOP COUNTING<span class="tm-caret">▮</span></div>
        </div>
        <div class="title-right">
          <div class="tm-case" id="last-session-card">
            <span class="screw tl"></span><span class="screw tr"></span>
            <span class="screw bl"></span><span class="screw br"></span>
            <div class="tm-case-head">
              <div class="tm-case-lamp"></div>
              <div class="tm-case-title">LAST SESSION</div>
              <div class="tm-case-src" id="ls-src">ARCHIVE</div>
            </div>
            <div class="tm-bays" id="ls-bays"></div>
            <div class="ls-empty" id="ls-empty" hidden>
              NO PREVIOUS SESSION ON RECORD.<br>THE COUNT STARTS AT ZERO.
            </div>
            <div class="tm-case-foot" id="ls-date"></div>
          </div>
          <div class="tm-case tm-controls">
            <span class="screw tl"></span><span class="screw tr"></span>
            <span class="screw bl"></span><span class="screw br"></span>
            <div class="tm-case-head">
              <div class="tm-case-lamp green"></div>
              <div class="tm-case-title">FIELD MANUAL</div>
              <div class="tm-case-src">ISSUE 2.5</div>
            </div>
            <div class="bay bay-manual">
              <div class="bay-label">CONTROLS</div>
              <div class="bay-body tm-keys">
                <span>WASD</span><b>MOVE</b><span>MOUSE</span><b>LOOK / FIRE</b>
                <span>SHIFT</span><b>SPRINT</b><span>CTRL</span><b>CROUCH</b>
                <span>SPACE</span><b>JUMP</b><span>1–5</span><b>WEAPONS</b>
                <span>R</span><b>RELOAD</b><span>RMB</span><b>SCOPE</b>
                <span>E</span><b>INTERACT</b><span>TAB</span><b>SATCHEL</b>
                <span>ESC</span><b>PAUSE</b><span>~</span><b>CONSOLE</b>
              </div>
            </div>
            <div class="tm-case-foot">REBIND ANY CONTROL IN SETTINGS &middot; KEY BINDINGS</div>
          </div>
        </div>
      </div>
      <div class="tm-settings" hidden></div>
      <div class="tm-confirm" hidden>
        <div class="tm-confirm-panel">
          <div class="tm-card-head">START A NEW GAME?</div>
          <p id="tm-confirm-msg" class="tm-confirm-msg"></p>
          <div class="tm-confirm-actions">
            <button id="btn-confirm-new" class="tm-confirm-yes">NEW GAME</button>
            <button id="btn-confirm-cancel" class="tm-confirm-no">CANCEL</button>
          </div>
        </div>
      </div>`;
    this.settingsEl = this.el.querySelector('.tm-settings');
    this.confirmEl = this.el.querySelector('.tm-confirm');
    this.signEl = this.el.querySelector('.title-sign');
    this._buildBays();

    // The shared settings form, mounted into the overlay. BACK closes it.
    this.panel = new SettingsPanel(this.settingsEl, this.store, {
      footer: [{ label: 'BACK', cls: 'tm-set-back', onClick: () => this._closeSettings() }],
    });
    // Clicking the dim backdrop (outside the panel) also closes it.
    this.settingsEl.addEventListener('mousedown', (e) => {
      if (e.target === this.settingsEl && !this.panel.isCapturing()) this._closeSettings();
    });
  }

  /**
   * One line of the sign, as individual characters.
   *
   * Everything the sign does — the letters dropping in one after another, the
   * tube striking left to right, a single tube that never settles — needs each
   * glyph to be its own element carrying its own index, because a line of text
   * can only be animated as one block. `from` continues the stagger across a
   * line break so the whole sign powers up in one sweep rather than restarting
   * per line; `sick` marks the character (0-based) whose tube is failing.
   */
  _signLine(text, from = 0, sick = -1) {
    return [...text].map((c, i) => {
      const cls = 'ch' + (c === ' ' ? ' sp' : '') + (i === sick ? ' sick' : '');
      return `<span class="${cls}" style="--i:${from + i}">${c === ' ' ? '&nbsp;' : c}</span>`;
    }).join('');
  }

  /**
   * The LAST SESSION bench: the same bays, in the same case, driven by the same
   * instrument kit as the pause screen (see rendering/Instruments.js).
   *
   * Every quantity is on the instrument the pause panel gives it, so the two
   * screens agree: kills roll up an odometer over the tape running toward
   * 250,000, score rolls its own counter, accuracy sweeps the needle, the
   * survival clock lands on the split-flap board and the secrets light their
   * lamps. WAVE REACHED is the one that gets a different treatment from its
   * pause-screen cousin, deliberately: on the bench the tube bank shows how
   * much of a live wave's quota is down, and a finished session has no quota
   * to be part-way through — so it keeps the bank's stencilled drum and none
   * of its lamps, rather than lighting an instrument to mean something else.
   */
  _buildBays() {
    const bays = this.el.querySelector('#ls-bays');
    const progress = Inst.bay(bays, 'progress', 'CONFIRMED KILLS');
    const kills = Inst.odometer(progress.body, 'pause-odo wide');
    const tape = Inst.tape(progress.body);

    const aim = Inst.bay(bays, 'aim', 'MARKSMANSHIP');
    const gauge = Inst.deviceGauge(aim.body, {
      sub: '% HIT', majors: ['0', '25', '50', '75', '100'], bands: Inst.HIT_BANDS,
    });

    const score = Inst.bay(bays, 'score', 'SCORE');
    const scoreOdo = Inst.odometer(score.body, 'pause-odo');

    const wave = Inst.bay(bays, 'wave', 'WAVE REACHED');
    const waveNum = Inst.el('div', wave.body, 'tube-num');

    const clock = Inst.bay(bays, 'clock', 'MISSION CLOCK');
    const flaps = Inst.flapboard(clock.body, 3).flaps;

    const secrets = Inst.bay(bays, 'secrets', 'SECRETS');
    const secRow = Inst.el('div', secrets.body, 'sec-row');
    const secCount = Inst.el('div', secrets.body, 'sec-count');

    this.bays = {
      root: bays, kills, tape, gauge, scoreOdo, waveNum, flaps,
      secRow, secCount, secLamps: [],
    };
  }

  _wire() {
    const $ = (id) => this.el.querySelector('#' + id);
    $('btn-start').addEventListener('click', () => this._onNewGame());
    $('btn-confirm-new').addEventListener('click', () => {
      this.confirmEl.hidden = true;
      this.actions.onStart();
    });
    $('btn-confirm-cancel').addEventListener('click', () => { this.confirmEl.hidden = true; });
    $('btn-return').addEventListener('click', () => this.actions.onReturnToRun());
    $('btn-continue').addEventListener('click', () => this.actions.onResumeSave());
    $('btn-settings').addEventListener('click', () => this._openSettings());
    // Desktop shell only: a real EXIT GAME on the title screen. In a browser
    // this entry stays hidden (see refresh()), so the web build is unchanged.
    $('btn-exit').addEventListener('click', () => this.actions.onExitGame?.());
  }

  _openSettings() {
    this.panel.sync();
    this.settingsEl.hidden = false;
  }

  _closeSettings() {
    this.panel.cancelCapture();
    this.settingsEl.hidden = true;
  }

  /** NEW GAME: confirm first when there is something to lose — a run already in
   *  progress (which a new game abandons) or a saved session on record (which a
   *  new game will overwrite). A clean first boot starts immediately. */
  _onNewGame() {
    const st = this.actions.menuState?.() ?? {};
    if (!st.runStarted && !st.save) { this.actions.onStart(); return; }
    this.el.querySelector('#tm-confirm-msg').textContent = st.runStarted
      ? 'This abandons your current run and starts over from wave 1. This cannot be undone.'
      : 'This starts a new run. Your last saved session will be overwritten as you play.';
    this.confirmEl.hidden = false;
  }

  /** Re-render the state-dependent parts; called whenever the menu is shown. */
  refresh() {
    const st = this.actions.menuState?.() ?? {};
    const $ = (id) => this.el.querySelector('#' + id);
    $('btn-return').hidden = !st.runStarted;
    $('btn-continue').hidden = !(st.save && !st.runStarted);
    $('btn-exit').hidden = !this.actions.isDesktop;
    $('btn-start').querySelector('i').nextSibling.textContent =
      st.runStarted ? 'NEW GAME (RESTART)' : 'NEW GAME';
    // renumber the visible entries so the rail always reads 01, 02, ...
    let n = 0;
    for (const item of this.el.querySelectorAll('.tm-item')) {
      if (!item.hidden) item.querySelector('i').textContent = String(++n).padStart(2, '0');
    }
    this._closeSettings();
    this.confirmEl.hidden = true;
    this._fillLastSession(st.save, st.saveWhere);
    this._armSign();
  }

  /**
   * Re-run the sign's power-up.
   *
   * The animations are declarative (see the `.title-sign.lit` rules), so the
   * whole sequence is driven by putting the class back on — but it has to come
   * OFF and be reflowed first, or the browser coalesces the two style changes
   * and nothing plays at all. That is the same reset the pause bench's `armed`
   * needs, for the same reason.
   */
  _armSign() {
    // The field manual is armed here too: its bay rests hidden like every
    // other bay in the kit, and unlike the session bench it has no data pass
    // to switch it on.
    for (const s of [this.signEl, this.el.querySelector('.tm-controls')]) {
      if (!s) continue;
      const cls = s === this.signEl ? 'lit' : 'armed';
      s.classList.remove(cls);
      void s.offsetWidth;
      s.classList.add(cls);
    }
  }

  _fillLastSession(save, where) {
    const b = this.bays;
    const date = this.el.querySelector('#ls-date');
    const src = this.el.querySelector('#ls-src');
    const empty = this.el.querySelector('#ls-empty');
    const card = this.el.querySelector('#last-session-card');

    // A first boot has nothing to read out. Instruments parked at zero are a
    // record of a run that scored nothing, which is not the same statement as
    // "there has never been a run" — so the bench comes out of the case and
    // the case says so in as many words.
    card.classList.remove('armed');
    b.root.hidden = !save;
    empty.hidden = !!save;
    if (!save) {
      date.textContent = '';
      src.textContent = 'NO RECORD';
      return;
    }
    src.textContent = where === 'server' ? 'SERVER ARCHIVE' : 'LOCAL ARCHIVE';
    const d = save.savedAt ? new Date(save.savedAt) : null;
    date.textContent = d && !isNaN(d) ? 'FILED ' + d.toLocaleString() : '';

    const kills = save.kills || 0;
    const frac = Math.max(0, Math.min(1, kills / WIN_KILLS));
    const acc = save.accuracy || 0;

    // Park every instrument at rest, then arm across two frames so the rest
    // pose has been through a full style/layout/paint cycle before the real
    // values land on top of it — one frame can still be coalesced with the
    // change before it, and a coalesced transition never runs. (Same dance as
    // HUD.fillPauseStats, and the same generation counter, because the arm
    // schedules a second frame that must not land after a later refresh.)
    const gen = (this._armGen = (this._armGen || 0) + 1);
    b.kills._last = null;
    Inst.odoDigits(b.kills, 0, 6);
    b.scoreOdo._last = null;
    Inst.odoDigits(b.scoreOdo, 0, 6);
    b.tape.run.style.width = '0%';
    b.tape.pct.textContent = (frac * 100).toFixed(3) + '%';
    b.gauge.set(0);
    b.gauge.caption.innerHTML =
      `<span>${(save.shotsHit || 0).toLocaleString('en-US')}</span>`
      + ` / ${(save.shotsFired || 0).toLocaleString('en-US')} ROUNDS`;
    b.waveNum.textContent = String(Math.max(1, save.wave || 1)).padStart(2, '0');
    for (const f of b.flaps) { f.textContent = '0'; f.classList.remove('flip'); }
    const found = save.secretsFound ?? 0, total = save.secretsTotal ?? 15;
    b.secLamps = Inst.lampRow(b.secRow, b.secLamps, total);
    for (const l of b.secLamps) l.classList.remove('lit');
    b.secCount.innerHTML = `<b>${found}</b> / ${total}`;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (gen !== this._armGen) return;
      card.classList.add('armed');
      Inst.rollOdometer(b.kills, kills, 6);
      Inst.rollOdometer(b.scoreOdo, save.points || 0, 6);
      // A hundred kills out of a quarter of a million is a third of a pixel of
      // tape, so the run keeps a visible minimum head and the honest figure is
      // stencilled beside it — exactly as on the pause bench.
      b.tape.run.style.width = Math.max(frac * 100, frac > 0 ? 3.5 : 0).toFixed(2) + '%';
      b.gauge.set(acc);
      b.secLamps.forEach((l, i) => l.classList.toggle('lit', i < found));
      Inst.runFlaps(b.flaps, Inst.hms(save.timePlayed || 0));
    }));
  }
}
