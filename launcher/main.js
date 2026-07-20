'use strict';
/**
 * Desktop launcher — Electron main process.
 *
 * Lifecycle, end to end:
 *
 *   1. A small, frameless, in-theme LAUNCHER window opens (Minecraft/Unity
 *      style): logo, build string, news, and a PLAY button.
 *
 *   2. On PLAY the launcher runs its harmonograph progress animation while the
 *      main process (a) starts the internal game server headlessly and (b)
 *      creates the isolated, fullscreen GAME window — its own Chromium, its own
 *      session partition, never the user's default browser. The game window is
 *      born hidden and only revealed once its first frame is painted, so there
 *      is never a flash of an empty window.
 *
 *   3. Hand-off: the launcher window hides. From here only the game window is
 *      on screen; the launcher process keeps running headless in the background
 *      to host the server and own the game's lifetime.
 *
 *   4. Quitting — the in-game EXIT GAME button, the window close box, or
 *      Alt-F4 — tears down the game window, the server and the launcher process
 *      together. No orphans.
 *
 * Flags: `--game` / `--play` (or SDN_SKIP_LAUNCHER=1) boots straight into the
 * game, skipping the launcher window — handy as a Steam "Play" target.
 */
const { app, BrowserWindow, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer } = require('./gameServer');

// ---- single instance: a second launch just focuses the running game --------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const isPackaged = app.isPackaged;
// Game files: repo root in dev, the bundled resources/game folder when packaged.
const GAME_ROOT = isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(__dirname, '..');
const SKIP_LAUNCHER =
  process.argv.includes('--game') ||
  process.argv.includes('--play') ||
  process.env.SDN_SKIP_LAUNCHER === '1';

let launcherWin = null;
let gameWin = null;
let server = null;
let quitting = false;

/** Where per-user, always-writable data lives (saves, first-run marker). */
function userSaveDir() {
  return path.join(app.getPath('userData'), 'save');
}
function firstRunMarker() {
  return path.join(app.getPath('userData'), '.installed');
}
function isFirstRun() {
  try { return !fs.existsSync(firstRunMarker()); } catch { return true; }
}
function markInstalled() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(firstRunMarker(), new Date().toISOString());
  } catch { /* non-fatal: worst case we show the first-run sequence again */ }
}

/** Start the internal game server once; reused across relaunches. */
async function ensureServer() {
  if (server) return server;
  server = await startServer({ root: GAME_ROOT, saveDir: userSaveDir() });
  return server;
}

function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    width: 940,
    height: 600,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#0a0d0a',
    title: 'Go Back To The Sandbox',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload-launcher.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  launcherWin.loadFile(path.join(__dirname, 'ui', 'launcher.html'));
  launcherWin.once('ready-to-show', () => launcherWin.show());
  launcherWin.on('closed', () => { launcherWin = null; });

  // External links (e.g. a "docs" link in the news panel) open in the real
  // browser, never inside the launcher chrome.
  launcherWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Create the isolated, fullscreen game window and point it at the local server.
 * Returns once the page has finished its first load (the game's own boot
 * screen is then visible), so the launcher can sweep its bar to 100%.
 */
async function createGameWindow() {
  const srv = await ensureServer();

  gameWin = new BrowserWindow({
    show: false,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    title: 'Go Back To The Sandbox',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload-game.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // A dedicated, persisted partition: isolated from any other Chromium on
      // the machine, but its own localStorage survives app updates.
      partition: 'persist:sandbox-game',
    },
  });

  // Grant only what the game needs from its own origin: pointer lock (mouse
  // look) and fullscreen. Everything else is denied.
  const ses = gameWin.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'pointerLock' || permission === 'fullscreen');
  });
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler((_wc, permission) =>
      permission === 'pointerLock' || permission === 'fullscreen');
  }

  // The game defaults to fullscreen (the window is born fullscreen). Pressing
  // Esc only releases pointer lock — it pauses the game and never drops native
  // fullscreen — so no re-assert is needed here. Leaving fullscreen is honoured
  // when the player asks for it via the shell's toggle (game:toggle-fullscreen).

  gameWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  gameWin.on('closed', () => {
    gameWin = null;
    // The game is the app: when its window goes, everything goes.
    if (!quitting) app.quit();
  });

  await new Promise((resolve, reject) => {
    gameWin.webContents.once('did-finish-load', resolve);
    gameWin.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`Game failed to load (${code}): ${desc}`)));
    gameWin.loadURL(srv.url);
  });

  return gameWin;
}

/** Reveal the game and retire the launcher to the background. */
function handOffToGame() {
  if (gameWin && !gameWin.isDestroyed()) {
    gameWin.show();
    gameWin.focus();
  }
  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.hide();
  markInstalled();
}

function iconPath() {
  const png = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(png) ? png : undefined;
}

// ---- IPC: the launcher UI drives the flow ----------------------------------

ipcMain.handle('launcher:info', () => ({
  version: app.getVersion(),
  firstRun: isFirstRun(),
  platform: process.platform,
}));

// Kick off the game. Resolves when the engine has loaded; the renderer then
// plays its completion sweep and calls launcher:reveal.
ipcMain.handle('launcher:launch', async () => {
  await createGameWindow();
  return { ok: true };
});

ipcMain.on('launcher:reveal', () => handOffToGame());

ipcMain.on('launcher:minimize', () => launcherWin && launcherWin.minimize());
ipcMain.on('launcher:close', () => app.quit());

// ---- IPC: the in-game shell bridge -----------------------------------------

ipcMain.on('game:quit', () => app.quit());
ipcMain.on('game:minimize', () => gameWin && gameWin.minimize());
ipcMain.on('game:toggle-fullscreen', () => {
  if (gameWin && !gameWin.isDestroyed()) gameWin.setFullScreen(!gameWin.isFullScreen());
});

// ---- app lifecycle ---------------------------------------------------------

app.on('second-instance', () => {
  const w = gameWin || launcherWin;
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // no File/Edit/View chrome anywhere

  // Harden the game partition: block any stray network request that does not
  // target our own loopback server. The game is fully offline/self-contained,
  // so this can only ever catch something unexpected.
  const gameSession = session.fromPartition('persist:sandbox-game');
  gameSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith('http://127.0.0.1:') ||
      u.startsWith('http://localhost:') ||
      u.startsWith('devtools:') ||
      u.startsWith('blob:') ||
      u.startsWith('data:');
    cb({ cancel: !ok });
  });

  if (SKIP_LAUNCHER) {
    try {
      await createGameWindow();
      handOffToGame();
    } catch (err) {
      console.error(err);
      app.quit();
    }
  } else {
    createLauncherWindow();
  }
});

app.on('before-quit', async () => {
  quitting = true;
  if (server) { try { await server.close(); } catch { /* ignore */ } server = null; }
});

app.on('window-all-closed', () => {
  // The launcher hides (not closes) on hand-off, so this only fires on a real
  // teardown. Quit on every platform — this app is the game.
  app.quit();
});
