# Go Back To The Sandbox — Desktop Launcher

A native Windows launcher for **Go Back To The Sandbox**, in the spirit of the
Minecraft/Unity launchers: a small, in-theme startup window with a **PLAY**
button that boots the game into its own isolated, fullscreen window.

The game is a self-contained browser game (vendored Three.js, no build step).
This launcher wraps it in [Electron](https://www.electronjs.org/) so it ships as
an ordinary Windows app — **it bundles its own Chromium and Node**, so it never
opens or depends on the user's web browser, and it runs on a **fresh Windows
install with no prerequisites**.

## What it does

- **Launcher window** — frameless, phosphor/ember themed, with the logo, build
  string, a field bulletin, and a big PLAY button.
- **Themed loading animation** — a live **harmonograph** (coupled damped
  oscillators, `x(t)=Σ Aₖ·sin(fₖt+φₖ)·e^(−dₖt)`) plotted in step with real boot
  progress, blooming into a golden-angle phyllotaxis at 100%. First launch shows
  an extended one-time-setup sequence; later launches show a shorter one. The
  parameters are re-rolled every run, so no two boots draw the same figure.
- **Isolated fullscreen game window** — its own Chromium session partition,
  born fullscreen, pointer-lock enabled. After PLAY the launcher window hides
  and the process runs **headless in the background** — only the game window is
  on screen.
- **Saves work everywhere** — an internal `127.0.0.1` server hosts the game and
  its `/api/session` save endpoint, writing to the per-user, always-writable
  `userData` folder (so saving works even under `Program Files`). The game also
  keeps its localStorage copy. Resume the last run from the title screen.
- **Clean quit** — the in-game **EXIT GAME** button (pause menu and title
  screen), the window close box, and Alt-F4 all tear down the game window, the
  internal server, and the launcher together. No orphaned processes.

## Run from source (any OS with Node)

```bash
cd launcher
npm install        # first run also generates build/icon.png
npm start          # opens the launcher
npm run game       # skips the launcher, boots straight into the game
```

`npm start` in development serves the game files straight from the repo root, so
edits to `../src`, `../assets`, etc. show up on the next launch.

## Build the Windows app

On Windows (or any machine with the toolchain), from `launcher/`:

```bash
npm install
npm run dist:win        # NSIS installer + portable .exe (x64)
# or, wine-free (works on Linux too — see below):
npm run dist:portable   # just the single-file portable .exe
```

This produces, in `launcher/dist/`:

- **`Go Back To The Sandbox <version> Setup.exe`** — a per-user installer (no
  admin rights required) that adds Start-menu and desktop shortcuts.
- **`Go Back To The Sandbox <version> portable.exe`** — a single self-contained
  executable that runs with no installation.

Both bundle the game files, Chromium, and Node — nothing else is needed on the
target machine.

### Wine-free packaging

electron-builder normally shells out to `wine rcedit.exe` to embed the app
icon + version info into the Windows executable. To keep the build fast,
reproducible, and buildable on Linux/CI without a working Wine runtime, this
project instead:

- sets `win.signAndEditExecutable: false` (skip electron-builder's Wine step),
  and
- stamps the icon + version into the app exe from `build/afterPack.js` using
  [`resedit`](https://github.com/jet2jet/resedit-js) — a pure-JavaScript PE
  resource editor (see `build/make-icon.mjs`, which emits both `icon.png` and a
  multi-resolution `icon.ico`).

As a result, **`npm run dist:portable` builds the complete portable `.exe` on
Linux with no Wine at all**. The **NSIS installer** additionally runs its stub
under Wine to generate the uninstaller, so `dist:win` (which includes NSIS) is
built on Windows — locally or via CI.

> CI: `.github/workflows/build-windows.yml` builds both the installer and the
> portable exe on a `windows-latest` runner on every push, and attaches them to
> a GitHub Release on `v*` tags.

## Launch via Steam

Steam runs the launcher like any other game:

1. In Steam, **Games ▸ Add a Non-Steam Game to My Library…**, and pick the
   installed **Go Back To The Sandbox** (or browse to the portable `.exe`).
2. Press **Play**. The launcher opens; PLAY boots the game fullscreen.

To make Steam's **Play** boot straight into the game (skipping the launcher
window), set the shortcut's **Launch Options** to:

```
--game
```

(Equivalently, the `SDN_SKIP_LAUNCHER=1` environment variable.) The Steam
overlay and controller config work as they do for any windowed/fullscreen app.

## How it fits together

```
launcher/
  main.js              Electron main: server + launcher window + game window + lifecycle
  preload-launcher.js  Safe bridge for the launcher UI (window.launcher.*)
  preload-game.js      Safe bridge for the game (window.gameShell.* → EXIT GAME)
  gameServer.js        Internal 127.0.0.1 static + /api/session server (writable saveDir)
  ui/                  Launcher window: launcher.html/.css/.js (the harmonograph)
  build/               Icon + generator (make-icon.mjs, pure Node — no image deps)
  package.json         Electron app + electron-builder (nsis + portable) config
```

The game itself is unchanged as a browser game. The only game-side additions are
`src/engine/Shell.js` (detects the desktop shell) and the desktop-only **EXIT
GAME** entries — all guarded so the plain web build behaves exactly as before.
