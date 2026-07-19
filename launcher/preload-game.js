'use strict';
/**
 * Preload for the game window. Publishes window.gameShell so the (otherwise
 * pure-browser) game can detect it is running inside the desktop shell and
 * offer a real EXIT GAME that closes the whole process.
 *
 * In a plain browser this object simply does not exist, so the game hides its
 * desktop-only affordances and behaves exactly as the web build does.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameShell', {
  isDesktop: true,
  platform: process.platform,
  /** Close the game window, the server and the launcher process. */
  quit: () => ipcRenderer.send('game:quit'),
  minimize: () => ipcRenderer.send('game:minimize'),
  toggleFullscreen: () => ipcRenderer.send('game:toggle-fullscreen'),
});
