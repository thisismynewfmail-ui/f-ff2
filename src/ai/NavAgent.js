import { contextSteer } from './Steering.js';

/**
 * The shared navigation component: everything between "I want to be over
 * there" and "step this way this frame".
 *
 * One of these hangs off any NPC that needs to cross the world rather than
 * just mill about — zombies, the bomber, the shooter, anyone added later. It
 * owns the whole route lifecycle so no entity has to re-implement it:
 *
 *   plan     A* on the world nav grid, throttled by a repath timer and the
 *            per-frame path budget, and invalidated when the goal has moved far
 *            enough that the old route no longer points at it.
 *   follow   walk the waypoint chain, advancing on arrival and string-pulling
 *            through any waypoints already in plain sight so a 2 m grid route
 *            reads as a smooth line rather than a staircase. DOORWAY waypoints
 *            are never skipped and capture on a much tighter radius, because
 *            "close to the doorway" and "in the doorway" are different places
 *            and only one of them gets you through the wall.
 *   escape   when there is no route at all AND the agent is wedged, commit to
 *            walking out through the nearest declared doorway. This is the
 *            reliable way out of a building whose route the grid could not
 *            resolve, and it is what stops a zombie milling about in the house
 *            it spawned in.
 *   unwedge  props are collision boxes but not nav obstacles, so a bench can
 *            sit square across a route the grid thinks is clear. Steering away
 *            and seeking the goal then cancel out and the agent grinds to a
 *            halt. Recovery has to be LATERAL — pressing harder toward the goal
 *            just pins the agent against the box — so on stalled progress we
 *            blend a sideways component in, pick the side the senses say is
 *            clearer, and COMMIT to it for a beat (dropping it the instant the
 *            agent moves would walk it straight back into the same box).
 *
 * Steering the final direction through contextSteer() is part of the job: the
 * route says which way, the sensory ring says which way is actually walkable,
 * and the caller just gets a direction it can multiply by its own speed.
 */
const KNEE = 0.9;             // height the walk-line visibility rays are cast at
const STUCK_WINDOW = 0.6;     // seconds of net movement sampled before judging
const STUCK_EPS = 0.25;       // metres moved below which the agent counts as stuck
const SLIDE_HOLD = 1.4;       // seconds a sidestep stays committed once started
const SLIDE_STEP = 0.7;       // lateral blend added per repeated stuck episode
const SLIDE_MAX = 2.1;        // cap on the lateral blend (vs. a unit goal direction)
const THROUGH = 1.4;          // how far past a doorway the escape aim point sits
const EXIT_HOLD = 6;          // seconds a committed exit point stays the target
const EXIT_COOLDOWN = 8;      // ...and how long before another exit may be chosen
// After this many stuck episodes in a row, the current leg of the route is
// written off as unwalkable. See _trackStuck() / _abandonLeg().
const DISTRUST_AT = 3;        // stuck episodes in a row before a leg is written off
// Progress watchdog: over this long, an agent that has been scraping walls and
// has not got measurably nearer its goal is not following a route, it is
// performing one. See _trackStuck().
const PROGRESS_WINDOW = 6;
const PROGRESS_EPS = 0.5;     // metres of net gain below which it counts as none

export class NavAgent {
  constructor(world, opts = {}) {
    this.world = world;
    this.repathPeriod = opts.repath ?? 1.4;
    this.repathJitter = opts.repathJitter ?? 0.6;
    this.goalDrift = opts.goalDrift ?? 4;      // goal may move this far before a repath
    this.arrive = opts.arrive ?? 1.5;          // capture radius for a grid waypoint
    this.portalArrive = opts.portalArrive ?? 0.85; // ...and for a doorway
    this.doorSeekRange = opts.doorSeek ?? 26;  // how far away a door is still worth making for
    this.lookAhead = opts.lookAhead ?? 3;      // waypoints considered for string-pulling
    this.pathlessScale = opts.pathlessScale ?? 0.75; // speed factor when flying blind
    this.steerOpts = opts.steer ?? undefined;
    this.reset();
  }

  reset() {
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;      // goal the current path was planned to
    this.repathTimer = 0;
    this.failTimer = 0;        // seconds spent with no usable route
    this._exitPortal = null;   // doorway being made for while escaping
    this._exitPoint = null;    // the committed point a step past it
    this._exitHold = 0;        // seconds that choice stays committed
    this._exitCool = 0;        // lockout after passing through one
    this._progressClock = 0;
    this._progressMark = null; // distance to goal at the start of the window
    this._wedgedSince = false; // did the agent scrape anything this window?
    this._lastDt = 0;
    this.mode = 'idle';        // direct | path | escape | blind
    this._stuckClock = 0;
    this._stuckMark = null;
    this._slideLevel = 0;
    this._slideTimer = 0;
    this._slideSide = 0;
  }

  clearPath() {
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;
  }

  get hasPath() { return !!(this.path && this.pathIndex < this.path.length); }
  /** How many stuck episodes in a row — behaviours can escalate off this. */
  get stuckLevel() { return this._slideLevel; }

  /**
   * Produce this frame's steering direction toward `goal`.
   *
   * opts:
   *   direct   caller already has a clear line — skip planning entirely
   *   desired  with `direct`, steer along this vector instead of straight at
   *            the goal. This is how an archetype keeps its own flavour of
   *            approach (the Exploder's flank spiral, the Spitter's kiting)
   *            while still getting obstacle steering and stuck recovery.
   *   budget   shared { n } per-frame path budget (a request costs 1)
   *   senses   the agent's Senses (required for obstacle-aware steering)
   *
   * Returns { x, z, scale, mode } — a unit direction plus the speed factor the
   * caller should apply — or null when there is nowhere to go.
   */
  steer(dt, agent, goal, opts = {}) {
    if (!goal) { this.mode = 'idle'; return null; }
    const senses = opts.senses ?? agent.senses;
    const pos = agent.position;
    this._lastDt = dt;

    let desired;
    if (opts.direct) {
      // A clear line to the target: routing would only get in the way.
      this.clearPath();
      this._exitHold = 0;
      this._exitPoint = null;
      this.failTimer = 0;
      this.mode = 'direct';
      desired = opts.desired
        ? { x: opts.desired.x, z: opts.desired.z }
        : { x: goal.x - pos.x, z: goal.z - pos.z };
    } else {
      desired = this._route(dt, agent, goal, opts);
    }

    this._trackStuck(dt, agent, goal);
    desired = this._slide(desired, senses);

    const dir = contextSteer(desired.x, desired.z, senses, this.steerOpts);
    if (!dir.x && !dir.z) return null;
    return { x: dir.x, z: dir.z, scale: this.mode === 'blind' ? this.pathlessScale : 1, mode: this.mode };
  }

  /* ------------------------------------------------------------------ */
  /* planning + following                                                */
  /* ------------------------------------------------------------------ */

  _route(dt, agent, goal, opts) {
    const pos = agent.position;
    this.repathTimer -= dt;

    // Replan when the route ran out, expired, or the goal walked away from
    // where the route was planned to.
    const drifted = this.pathGoal &&
      Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) > this.goalDrift;
    const budget = opts.budget;
    if ((!this.hasPath || this.repathTimer <= 0 || drifted) && (!budget || budget.n > 0)) {
      if (budget) budget.n--;
      this.repathTimer = this.repathPeriod + Math.random() * this.repathJitter;
      const found = this.world.nav.findPath(pos.x, pos.z, goal.x, goal.z);
      if (found) {
        this.path = found;
        this.pathIndex = 0;
        this.pathGoal = { x: goal.x, z: goal.z };
      } else if (!this.hasPath) {
        this.clearPath();
      }
    }

    if (this.hasPath) {
      const wp = this._advance(agent, goal);
      if (wp) {
        this.failTimer = 0;
        this._exitHold = 0;
        this._exitPoint = null;
        this.mode = 'path';
        return { x: wp.x - pos.x, z: wp.z - pos.z };
      }
    }

    // No route. Make for a doorway if one is in reach — this is the case of an
    // agent shut inside a building — otherwise press on toward the goal and let
    // the sensory ring feel the way there.
    this.failTimer += dt;
    const exit = this._escapePoint(agent);
    if (exit) {
      this.mode = 'escape';
      return { x: exit.x - pos.x, z: exit.z - pos.z };
    }
    this.mode = 'blind';
    return { x: goal.x - pos.x, z: goal.z - pos.z };
  }

  /**
   * Advance along the waypoint chain and return the point to walk at, or null
   * once the chain is spent.
   *
   * Two rules do the work. Arrival radii are per-waypoint: a doorway is a
   * ~1.2-1.5 m hole in a wall, and a radius loose enough for open ground would
   * count the agent as "arrived" while it is still flush against the solid wall
   * a metre to the side of the opening. And a waypoint already in plain sight
   * can be skipped — grid routes are staircases around corners, and walking
   * every step of one looks like indecision — except a doorway, which must be
   * passed through rather than approximated.
   */
  _advance(agent, goal) {
    const pos = agent.position;
    const path = this.path;
    for (let guard = 0; guard < 8 && this.pathIndex < path.length; guard++) {
      const [wx, wz, portal] = path[this.pathIndex];
      const r = portal ? this.portalArrive : this.arrive;
      const near = Math.hypot(wx - pos.x, wz - pos.z) < r;
      if (near && (!portal || this._throughPortal(pos, portal, path[this.pathIndex + 1]))) {
        this.pathIndex++;
        continue;
      }

      // String-pulling: take the furthest waypoint we can already walk at
      // directly, stopping at the first doorway.
      let best = this.pathIndex;
      if (!portal) {
        for (let k = 1; k <= this.lookAhead && this.pathIndex + k < path.length; k++) {
          const [nx, nz, np] = path[this.pathIndex + k];
          if (!this._walkable(pos, nx, nz)) break;
          best = this.pathIndex + k;
          if (np) break; // stop AT the doorway, never past it
        }
      }
      this.pathIndex = best;
      const [bx, bz] = path[best];
      return { x: bx, z: bz };
    }
    // Chain spent: the goal itself is the last leg.
    this.clearPath();
    return goal ? { x: goal.x, z: goal.z } : null;
  }

  /**
   * Has the agent actually got through this doorway, or is it merely standing
   * next to it? Being within a doorway's capture radius is not the same as
   * being through it — the radius is a circle and the wall is a plane, so most
   * of that circle is still on the near side. Tick the waypoint off only once
   * the agent is on the SAME SIDE of the opening as whatever comes next.
   *
   * Skipping this is what leaves an agent scraping along the inside of a wall:
   * it reaches the door, counts it as done, aims at the waypoint beyond — and
   * that waypoint is on the far side of a wall it never actually walked
   * through, so it slides along the wall toward it forever.
   */
  _throughPortal(pos, p, next) {
    if (!next) return true;
    const here = (pos.x - p.x) * p.nx + (pos.z - p.z) * p.nz;
    const there = (next[0] - p.x) * p.nx + (next[1] - p.z) * p.nz;
    if (Math.abs(there) < 0.2) return true; // the next leg is the opening itself
    return here * there > 0;
  }

  _walkable(pos, x, z) {
    return !this.world.collision.segmentBlocked(pos.x, pos.y + KNEE, pos.z, x, pos.y + KNEE, z);
  }

  /**
   * The last resort: get OUT.
   *
   * This is not a way of getting closer to the goal — it is what an agent does
   * when it has no route at all and is wedged, which in this world means it is
   * shut inside a building whose exit the grid could not resolve. It picks the
   * nearest declared doorway (preferring an exterior door over an interior
   * gap), aims a step past it on the side the agent is NOT on, and COMMITS to
   * that point until it gets there.
   *
   * The commitment is the whole trick. Recomputing "which side am I not on?"
   * every frame paces the threshold forever: step through, and the side you
   * came from becomes the side to aim at. Committing to one point means the
   * agent goes through once, and a short per-doorway cooldown afterwards stops
   * it turning straight back round. Deciding by "which side is nearer the
   * goal" instead has the same failure in a different costume — a goal on the
   * far side of the building keeps pulling the agent back indoors — which is
   * why the goal is not consulted here at all.
   */
  _escapePoint(agent) {
    const pos = agent.position;
    const nav = this.world.nav;
    if (!nav.nearestPortal) return null;

    this._exitHold -= this._lastDt;
    if (this._exitCool > 0) this._exitCool -= this._lastDt;

    // Committed: keep walking at the chosen point until we are through it.
    if (this._exitHold > 0 && this._exitPoint) {
      if (Math.hypot(this._exitPoint.x - pos.x, this._exitPoint.z - pos.z) > 1.0) return this._exitPoint;
      this._exitHold = 0;
      this._exitPoint = null;
      this._exitCool = EXIT_COOLDOWN;   // this one is spent; try another next
      this.repathTimer = 0;             // re-route from this side of the wall
      return null;
    }
    // Only for an agent that is both routeless and actually stuck. A blind
    // agent still making ground is better off pressing toward its goal.
    if (this.failTimer < 1 || this._slideLevel < 1) return null;

    // Skip the doorway just used: if walking out of it did not help, the next
    // nearest one is the thing left to try. This is what lets an agent work its
    // way out of a run of connected rooms instead of pacing one of them.
    const skip = this._exitCool > 0 ? this._exitPortal : null;
    const p = nav.nearestPortal(pos.x, pos.z, this.doorSeekRange, 'door', skip)
      ?? nav.nearestPortal(pos.x, pos.z, this.doorSeekRange, null, skip);
    if (!p) return null;
    const side = (pos.x - p.x) * p.nx + (pos.z - p.z) * p.nz >= 0 ? -1 : 1;
    this._exitPortal = p;
    this._exitPoint = { x: p.x + p.nx * side * THROUGH, z: p.z + p.nz * side * THROUGH };
    this._exitHold = EXIT_HOLD;
    return this._exitPoint;
  }

  /* ------------------------------------------------------------------ */
  /* stuck recovery                                                      */
  /* ------------------------------------------------------------------ */

  _trackStuck(dt, agent, goal) {
    const pos = agent.position;
    if (!this._stuckMark) this._stuckMark = { x: pos.x, z: pos.z };
    this._stuckClock += dt;
    if (this._stuckClock >= STUCK_WINDOW) {
      const moved = Math.hypot(pos.x - this._stuckMark.x, pos.z - this._stuckMark.z);
      if (moved < STUCK_EPS) {
        // Wedged again: slide harder, re-arm the commitment, and re-pick the
        // side against whatever the senses can see from here.
        this._slideLevel++;
        this._slideTimer = SLIDE_HOLD;
        this._slideSide = 0;
        // A route that isn't getting us anywhere is worth replanning early...
        if (this._slideLevel >= 2) this.repathTimer = 0;
        // ...and if replanning keeps handing back a route we still cannot walk,
        // the grid is wrong about this spot. Its 2 m cells cannot represent, say,
        // a doorway that opens onto a neighbouring building's wall a metre away —
        // both live in the same cell, and the cell has to be open for the door to
        // work at all. Stop trusting it for a while and fall through to the
        // sensory fallbacks, which can feel what the grid cannot see.
        this._wedgedSince = true;
        if (this._slideLevel >= DISTRUST_AT) this._abandonLeg();
      } else if (this._slideTimer <= 0) {
        this._slideLevel = 0; // moving freely with no sidestep running — done
      }
      this._stuckMark.x = pos.x; this._stuckMark.z = pos.z;
      this._stuckClock = 0;
    }
    if (this._slideTimer > 0) this._slideTimer -= dt;

    // The slower watchdog. The wedge test above measures NET MOVEMENT, which an
    // agent shuffling left and right across a blocked doorway passes with room
    // to spare — it is moving, it is simply moving nowhere. So also ask, over a
    // much longer window, whether any ground was actually gained on the goal.
    // Both halves are needed: an agent walking the long way around a warehouse
    // legitimately gains nothing for several seconds, but it does so without
    // touching a thing, and an agent grinding a wall is the one worth catching.
    if (!goal) return;
    this._progressClock += dt;
    if (this._progressClock >= PROGRESS_WINDOW) {
      const d = Math.hypot(goal.x - pos.x, goal.z - pos.z);
      if (this._progressMark !== null && this._wedgedSince && this._progressMark - d < PROGRESS_EPS) {
        this._abandonLeg();
      }
      this._progressMark = d;
      this._progressClock = 0;
      this._wedgedSince = false;
    }
  }

  /**
   * The agent has proved it cannot walk the leg it is on. Give up on THAT LEG
   * rather than on the whole route: aim at the next waypoint instead, which
   * usually means approaching from a different angle and clearing whatever the
   * grid could not see. Only when the route runs out does it fall back to
   * replanning and, failing that, to the exit hunt — throwing a working route
   * away wholesale just because one leg is awkward makes an agent that was
   * merely taking the long way round start wandering blind instead.
   */
  _abandonLeg() {
    this._slideLevel = 0;
    this._progressMark = null;
    this._wedgedSince = false;
    this._exitCool = 0;                 // free to try a different doorway
    if (this.path && this.pathIndex < this.path.length - 1) this.pathIndex++;
    else { this.clearPath(); this.repathTimer = 0; }
  }

  _slide(desired, senses) {
    if (this._slideTimer <= 0 || this._slideLevel <= 0) return desired;
    const len = Math.hypot(desired.x, desired.z);
    if (!len) return desired;
    const ux = desired.x / len, uz = desired.z / len;
    const perpX = -uz, perpZ = ux;
    if (!this._slideSide) {
      // Commit to whichever side has more room, measured on the sensory ring.
      const left = senses ? senses.clearanceToward(perpX, perpZ) : 0;
      const right = senses ? senses.clearanceToward(-perpX, -perpZ) : 0;
      this._slideSide = left >= right ? 1 : -1;
    }
    const amount = Math.min(SLIDE_MAX, this._slideLevel * SLIDE_STEP) * this._slideSide;
    return { x: ux + perpX * amount, z: uz + perpZ * amount };
  }
}
