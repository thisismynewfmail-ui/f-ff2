import { SettingsPanel } from './SettingsPanel.js';

/**
 * The title screen — "GO BACK TO THE SANDBOX", styled after the classic
 * Counter-Strike main menus: a left-hand rail of stencilled menu entries with
 * numbered hover brackets over the LIVE 3D town (the Game orbits its camera
 * through the plaza while the state machine sits in 'menu' — see
 * Game._menuCinematic), plus a right-hand column of field-report cards:
 *
 *   - LAST SESSION: the previous session's stats, served by the dev server's
 *     /api/session endpoint (localStorage on static hosts) — kills, score,
 *     accuracy, wave, time and secrets, with the save date. When a save
 *     exists and no run is live, a RESUME LAST SESSION entry appears.
 *   - FIELD MANUAL: the control reference.
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
          <div class="title-kicker">SANDBOX DEFENSE NETWORK PRESENTS</div>
          <h1 class="title-logo">GO BACK<br>TO THE<br><em>SANDBOX</em></h1>
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
          <div class="tm-card" id="last-session-card">
            <div class="tm-card-head">LAST SESSION <span id="ls-src">ARCHIVE</span></div>
            <div class="tm-card-body" id="ls-body"></div>
            <div class="tm-card-foot" id="ls-date"></div>
          </div>
          <div class="tm-card tm-controls">
            <div class="tm-card-head">FIELD MANUAL</div>
            <div class="tm-card-body tm-keys">
              <span>WASD</span><b>MOVE</b><span>MOUSE</span><b>LOOK / FIRE</b>
              <span>SHIFT</span><b>SPRINT</b><span>CTRL</span><b>CROUCH</b>
              <span>SPACE</span><b>JUMP</b><span>1–5</span><b>WEAPONS</b>
              <span>R</span><b>RELOAD</b><span>RMB</span><b>SCOPE</b>
              <span>E</span><b>INTERACT</b><span>TAB</span><b>SATCHEL</b>
              <span>ESC</span><b>PAUSE</b><span>~</span><b>CONSOLE</b>
            </div>
            <div class="tm-card-foot">REBIND ANY CONTROL IN SETTINGS &middot; KEY BINDINGS</div>
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

    // The shared settings form, mounted into the overlay. BACK closes it.
    this.panel = new SettingsPanel(this.settingsEl, this.store, {
      footer: [{ label: 'BACK', cls: 'tm-set-back', onClick: () => this._closeSettings() }],
    });
    // Clicking the dim backdrop (outside the panel) also closes it.
    this.settingsEl.addEventListener('mousedown', (e) => {
      if (e.target === this.settingsEl && !this.panel.isCapturing()) this._closeSettings();
    });
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
  }

  _fillLastSession(save, where) {
    const body = this.el.querySelector('#ls-body');
    const date = this.el.querySelector('#ls-date');
    const src = this.el.querySelector('#ls-src');
    if (!save) {
      body.innerHTML = '<div class="ls-empty">NO PREVIOUS SESSION ON RECORD.<br>THE COUNT STARTS AT ZERO.</div>';
      date.textContent = '';
      src.textContent = 'ARCHIVE';
      return;
    }
    src.textContent = where === 'server' ? 'SERVER ARCHIVE' : 'ARCHIVE';
    const t = save.timePlayed || 0;
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60);
    const time = (hh ? hh + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    const row = (k, v, big = false) =>
      `<div class="ls-row${big ? ' big' : ''}"><span>${k}</span><b>${v}</b></div>`;
    body.innerHTML =
      row('CONFIRMED KILLS', (save.kills || 0).toLocaleString('en-US'), true) +
      row('SCORE', (save.points || 0).toLocaleString('en-US')) +
      row('ACCURACY', ((save.accuracy || 0) * 100).toFixed(1) + '%') +
      row('WAVE REACHED', save.wave || 1) +
      row('TIME SURVIVED', time) +
      row('SECRETS', `${save.secretsFound ?? 0} / ${save.secretsTotal ?? '?'}`);
    const d = save.savedAt ? new Date(save.savedAt) : null;
    date.textContent = d && !isNaN(d) ? 'FILED ' + d.toLocaleString() : '';
  }
}
