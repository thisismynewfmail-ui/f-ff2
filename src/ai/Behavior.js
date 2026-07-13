/**
 * A tiny priority-arbitration brain for behaviour-driven NPCs.
 *
 * Each Behaviour scores itself from the current sensory context every tick;
 * the highest positive score wins and drives the agent. Behaviours overlap
 * freely — flee outranks wander, wander outranks idle — and switching is just
 * a comparison, so it never stalls or spikes.
 *
 * Two guards keep switching from flickering (which would read as lag/jitter):
 *   - a minimum dwell time before the active behaviour can be replaced by a
 *     merely-higher-scoring rival, and
 *   - an immediate hand-off the moment the active behaviour scores 0 (it is no
 *     longer applicable), regardless of dwell.
 *
 * Add behaviours in any order; scores decide precedence. New NPC archetypes
 * reuse this by composing a different behaviour set over the same Senses.
 */
export class Behavior {
  constructor(name) {
    this.name = name;
    this.minDwell = 0.15; // seconds this behaviour holds before yielding
  }

  /** Fitness for the current context; > 0 = eligible, higher = preferred. */
  score(_ctx) { return 0; }

  enter(_ctx) {}
  exit(_ctx) {}

  /** Produce a movement intent { x, z, speed } or null (stand still). */
  step(_dt, _ctx) { return null; }
}

export class Brain {
  constructor() {
    this.behaviors = [];
    this.current = null;
    this._dwell = 0;
  }

  add(b) { this.behaviors.push(b); return this; }

  /** Name of the active behaviour (useful for HUD/debug/tests). */
  get state() { return this.current ? this.current.name : 'none'; }

  update(dt, ctx) {
    this._dwell += dt;

    let best = null, bestScore = 0;
    for (const b of this.behaviors) {
      const s = b.score(ctx);
      if (s > bestScore) { bestScore = s; best = b; }
    }

    if (best && best !== this.current) {
      // Switch when we've dwelt long enough, or the incumbent is no longer
      // eligible (it can't cling on if it scores 0).
      const dwellOk = !this.current || this._dwell >= this.current.minDwell;
      const incumbentEligible = this.current && this.current.score(ctx) > 0;
      if (dwellOk || !incumbentEligible) {
        this.current?.exit(ctx);
        this.current = best;
        this._dwell = 0;
        best.enter(ctx);
      }
    } else if (!best && this.current && this.current.score(ctx) <= 0) {
      // Nothing eligible at all: drop the incumbent once it lapses.
      this.current.exit(ctx);
      this.current = null;
    }

    return this.current ? this.current.step(dt, ctx) : null;
  }
}
