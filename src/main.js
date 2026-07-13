import { Game } from './engine/Game.js';

/**
 * Boot: load assets behind the loading bar, then hand over to the menu.
 *
 * `?test=1` enables the test harness: the game starts without pointer lock
 * and exposes window.__game so automated checks (see tests/) can drive the
 * real systems — including verifying that victory fires at exactly 250,000
 * kills through the same pipeline gameplay uses.
 */
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const canvas = document.getElementById('game-canvas');
const hudRoot = document.getElementById('hud');
const loadingEl = document.getElementById('loading');
const loadingFill = document.getElementById('loading-fill');
const loadingLabel = document.getElementById('loading-label');

const game = new Game(canvas, hudRoot, { testMode });

game.load((frac) => {
  loadingFill.style.width = (frac * 100).toFixed(0) + '%';
  loadingLabel.textContent = 'LOADING TEXTURES… ' + Math.round(frac * 100) + '%';
}).then(() => {
  loadingEl.remove();
  game.start();
  if (testMode) window.__game = game;
}).catch((err) => {
  loadingLabel.textContent = 'FAILED TO LOAD: ' + err.message;
  loadingLabel.style.color = '#b03030';
  console.error(err);
});
