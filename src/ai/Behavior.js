/**
 * A tiny priority-arbitration brain for behaviour-driven NPCs.
 *
 * Each Behaviour scores itself from the current sensory context every tick;
 * the highest positive score wins and drives the agent. Behaviours overlap
 * freely — flee outranks wander, wander outranks idle — and switching is one
 * comparison over a single scoring pass, so it never stalls or spikes however
 * many behaviours an archetype carries.
 *
 * Three guards keep switching from flickering (which reads as lag/jitter):
 *   - every behaviour is scored exactly once per tick and the incumbent is
 *     compared against that same cached number, never re-scored,
 *   - the incumbent gets a small stickiness bonus, so a rival has to be
 *     meaningfully better rather than a rounding error better, and
 *   - a minimum dwell time before the active behaviour can be replaced by a
 *     merely-higher-scoring rival — with an immediate hand-off the moment the
 *     active behaviour scores 0 (it is no longer applicable), regardless.
 *
 * Behaviours share a blackboard hung off the context, so one can leave a note
 * for another (where a threat was last seen, which exit was chosen) without any
 * of them knowing the others exist.
 *
 * Add behaviours in any order; scores decide precedence. New NPC archetypes
 * reuse this by composing a different behaviour set over the same Senses, and
 * new behaviours slot into an existing set without touching what is there.
 */
export class Behavior {
  constructor(name) {
    this.name = name;
    this.minDwell = 0.15; // seconds this behaviour holds before yielding
    this.cooldown = 0;    // seconds it stays ineligible after exiting
    this._cool = 0;
  }

  /** Fitness for the current context; > 0 = eligible, higher = preferred. */
  score(_ctx) { return 0; }

  enter(_ctx) {}
  exit(_ctx) {}

  /** Produce a movement intent { x, z, speed } or null (stand still). */
  step(_dt, _ctx) { return null; }
}

export class Brain {
  constructor(opts = {}) {
    this.behaviors = [];
    this.current = null;
    this._dwell = 0;
    this._scores = new Map();
    // How much better a rival must be to unseat the incumbent (fraction).
    this.stickiness = opts.stickiness ?? 0.15;
    // Shared scratch space for behaviours to leave notes for each other.
    this.blackboard = {};
  }

  add(b) { this.behaviors.push(b); return this; }

  /** Name of the active behaviour (useful for HUD/debug/tests). */
  get state() { return this.current ? this.current.name : 'none'; }

  /** Last tick's score per behaviour name — for debug overlays and tests. */
  get scores() { return this._scores; }

  /** Drop the active behaviour without running its step (e.g. on a respawn). */
  reset(ctx = null) {
    this.current?.exit(ctx);
    this.current = null;
    this._dwell = 0;
    for (const b of this.behaviors) b._cool = 0;
  }

  update(dt, ctx) {
    this._dwell += dt;
    ctx.blackboard = this.blackboard;

    // One scoring pass. Everything below reads these cached numbers, so no
    // behaviour is ever asked to score itself twice in a tick.
    let best = null, bestScore = 0;
    for (const b of this.behaviors) {
      if (b._cool > 0) { b._cool -= dt; this._scores.set(b.name, 0); continue; }
      const s = b.score(ctx) || 0;
      this._scores.set(b.name, s);
      if (s > bestScore) { bestScore = s; best = b; }
    }

    const incumbent = this.current;
    const incumbentScore = incumbent ? this._scores.get(incumbent.name) ?? 0 : 0;

    if (best && best !== incumbent) {
      // Switch when we've dwelt long enough AND the rival clears the incumbent
      // by more than the stickiness margin — or the incumbent is no longer
      // eligible at all, in which case it can't cling on.
      const dwellOk = !incumbent || this._dwell >= incumbent.minDwell;
      const eligible = incumbentScore > 0;
      const clears = !eligible || bestScore > incumbentScore * (1 + this.stickiness);
      if ((dwellOk && clears) || !eligible) {
        if (incumbent) {
          incumbent.exit(ctx);
          incumbent._cool = incumbent.cooldown;
        }
        this.current = best;
        this._dwell = 0;
        best.enter(ctx);
      }
    } else if (!best && incumbent && incumbentScore <= 0) {
      // Nothing eligible at all: drop the incumbent once it lapses.
      incumbent.exit(ctx);
      incumbent._cool = incumbent.cooldown;
      this.current = null;
    }

    return this.current ? this.current.step(dt, ctx) : null;
  }
}
