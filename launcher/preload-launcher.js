'use strict';
/**
 * Preload for the launcher window. Exposes a tiny, audited surface to the
 * launcher UI over contextIsolation — no Node, no ipcRenderer, just verbs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  /** { version, firstRun, platform } — drives the header + first-run copy. */
  info: () => ipcRenderer.invoke('launcher:info'),
  /** Boot the game; resolves when the engine has loaded and is ready to show. */
  launch: () => ipcRenderer.invoke('launcher:launch'),
  /** Reveal the game window and send the launcher to the background. */
  reveal: () => ipcRenderer.send('launcher:reveal'),
  minimize: () => ipcRenderer.send('launcher:minimize'),
  close: () => ipcRenderer.send('launcher:close'),
});
