import { Game } from './engine/Game.js';
import { LoadingScreen } from './rendering/LoadingScreen.js';
import { TEXTURES, SPRITES } from './rendering/TextureConfig.js';

/**
 * Boot: load assets behind the animated loading screen (a Hilbert-curve
 * "texture memory map" walked in step with real progress — see
 * LoadingScreen.js), then hand over to the title menu, where the frame loop
 * runs a cinematic camera orbit until the player enters the fog.
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

// The real asset manifest feeds the loading screen's ticker readout.
const manifest = [...Object.values(TEXTURES), ...Object.values(SPRITES)];
const loader = new LoadingScreen(loadingEl, manifest);

const game = new Game(canvas, hudRoot, { testMode });

game.load((frac) => loader.setProgress(frac)).then(async () => {
  game.start();
  if (testMode) window.__game = game;
  await loader.finish(); // completion sweep + phyllotaxis burst, then fade
  loader.destroy();
}).catch((err) => {
  loader.fail(err.message);
  console.error(err);
});
