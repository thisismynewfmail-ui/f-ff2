/**
 * Minimal event bus for decoupled communication between systems.
 *
 * Systems publish domain events ('zombie:death', 'noise', 'zone:unlock', ...)
 * and never call each other directly for cross-cutting concerns like scoring,
 * audio or loot drops.
 */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
