/**
 * Session persistence — the bridge between runs.
 *
 * Primary store: the dev server's /api/session endpoints (see
 * scripts/serve.mjs), which keep save/last_session.json on disk so the title
 * screen can show the previous session's stats and offer to RESUME it.
 * Fallback store: localStorage, for static hosting (or the test server) where
 * the API does not exist. Saves are written to BOTH when possible; loads
 * prefer whichever copy is newer.
 *
 * The payload is a plain snapshot assembled by Game.captureSession():
 *   { version, savedAt, kills, points, byType, shotsFired, shotsHit,
 *     accuracy, timePlayed, wave, secretsFound, secretsTotal, health }
 */
const LS_KEY = 'gbts.session.v1';

export class SaveSystem {
  constructor() {
    this.data = null;      // last known save (null = no previous session)
    this.serverOk = false; // did the /api/session endpoint respond?
  }

  /** Load the previous session from the server, falling back to localStorage. */
  async load() {
    let server = null;
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json && json.exists !== false && typeof json.kills === 'number') server = json;
        this.serverOk = true;
      }
    } catch { /* static hosting / offline: localStorage only */ }

    let local = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const json = JSON.parse(raw);
        if (json && typeof json.kills === 'number') local = json;
      }
    } catch { /* storage disabled: server only */ }

    const at = (s) => (s && Date.parse(s.savedAt)) || 0;
    this.data = at(server) >= at(local) ? server || local : local;
    return this.data;
  }

  /** Persist a session snapshot; returns where it landed ('server'/'local'/null). */
  async save(payload) {
    this.data = payload;
    let where = null;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
      where = 'local';
    } catch { /* storage full/disabled */ }
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) where = 'server';
    } catch { /* no API — the localStorage copy stands */ }
    return where;
  }
}
