/**
 * Top-level game state machine:
 *   loading -> menu -> playing <-> paused
 *                      playing -> dead -> playing (respawn)
 *                      playing -> victory (terminal)
 */
const TRANSITIONS = {
  loading: ['menu'],
  menu: ['playing'],
  playing: ['paused', 'dead', 'victory'],
  paused: ['playing', 'menu'],
  dead: ['playing'],
  victory: [],
};

export class GameState {
  constructor(events) {
    this.events = events;
    this.state = 'loading';
  }

  is(s) { return this.state === s; }

  to(next) {
    if (!TRANSITIONS[this.state].includes(next)) return false;
    const prev = this.state;
    this.state = next;
    this.events.emit('state:change', { prev, next });
    return true;
  }
}
