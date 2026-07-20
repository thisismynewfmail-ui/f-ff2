/**
 * Desktop-shell bridge.
 *
 * When the game runs inside the Windows launcher (an Electron shell), the
 * preload publishes `window.gameShell`. This module wraps that bridge so the
 * rest of the game can ask "am I a native desktop app?" and, if so, offer a
 * real EXIT GAME that closes the whole process.
 *
 * In a plain browser `window.gameShell` is absent, so `isDesktop` is false and
 * every method degrades gracefully — the web build shows none of the
 * desktop-only affordances and behaves exactly as before.
 */
const bridge = (typeof window !== 'undefined' && window.gameShell) || null;

export const Shell = {
  /** True only inside the native launcher. */
  isDesktop: !!(bridge && bridge.isDesktop),
  platform: (bridge && bridge.platform) || 'web',

  /** Fully close the game: the window, the internal server and the launcher. */
  quit() {
    if (bridge && typeof bridge.quit === 'function') { bridge.quit(); return; }
    // Browser fallback: close the tab if we were opened by a script; otherwise
    // there is nothing safe to do, so this is a no-op.
    try { window.close(); } catch { /* ignore */ }
  },

  toggleFullscreen() {
    if (bridge && typeof bridge.toggleFullscreen === 'function') { bridge.toggleFullscreen(); return; }
    // Browser fallback: the standard Fullscreen API.
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch { /* unsupported */ }
  },
};
