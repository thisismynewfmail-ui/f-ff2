/**
 * Steering primitives: pure functions that turn sensory readings into a
 * desired direction on the XZ plane. Behaviours compose these; the entity
 * integrates the result against its own speed and collision.
 *
 * There are two ways to get past an obstacle here, and the difference matters:
 *
 *   avoidObstacles()  sums a repulsion vector out of the forward whiskers and
 *                     adds it to the desired direction. Cheap, and fine in the
 *                     open, but it is a SUM: symmetric obstacles cancel. In a
 *                     doorway the two jambs cancel sideways and leave a push
 *                     straight backwards, so the agent is shoved out of the
 *                     very opening it was aiming at. Kept for the light,
 *                     open-air uses that were tuned around it.
 *
 *   contextSteer()    scores every direction on the sensory ring — how much it
 *                     points where we want to go, minus how blocked it is — and
 *                     picks the winner. It CHOOSES rather than sums, so a
 *                     doorway is simply the direction that scores best, a dead
 *                     end resolves to the way back out, and a wall the agent is
 *                     sliding along stops fighting the goal direction. This is
 *                     what navigation-critical movement should use.
 *
 * Layering either over seek/flee/wander is where the emergent behaviour comes
 * from — an agent fleeing a threat automatically rounds corners, a wanderer
 * skirts props, a zombie with no path still slides along a wall toward its
 * target.
 */
const TWO_PI = Math.PI * 2;

export function norm(x, z) {
  const m = Math.hypot(x, z);
  return m > 1e-6 ? { x: x / m, z: z / m } : { x: 0, z: 0 };
}

/** Unit vector from (px,pz) toward (tx,tz). */
export function seek(px, pz, tx, tz) {
  return norm(tx - px, tz - pz);
}

/** Unit vector directly away from (tx,tz). */
export function flee(px, pz, tx, tz) {
  const s = seek(px, pz, tx, tz);
  return { x: -s.x, z: -s.z };
}

/**
 * Blend a desired direction with obstacle avoidance from senses. The stronger
 * (closer) the obstacle, the more the avoidance vector dominates, so agents
 * yield to walls just in time instead of grinding along them.
 */
export function avoidObstacles(dx, dz, senses, weight = 1.7) {
  const a = senses && senses.avoid;
  if (!a || a.strength <= 0) return norm(dx, dz);
  return norm(dx + a.x * a.strength * weight, dz + a.z * a.strength * weight);
}

// Scratch buffers reused across calls (steering is synchronous, one agent at a
// time), sized up to whatever the widest sensory ring in play needs.
let _occ = new Float32Array(0);
let _scores = new Float32Array(0);

/**
 * Context-map steering: choose the best direction on the sensory ring.
 *
 * Each ring slot is scored as
 *     interest (alignment with the desired direction)
 *   + commitment (a nudge toward the current heading, to stop dithering)
 *   - danger (how occupied that slot and its neighbours are)
 * and the winner is refined between its neighbours so the result is smooth
 * rather than quantised to the ring.
 *
 * Danger bleeds into neighbouring slots on purpose: an agent that aimed exactly
 * along the edge of an obstacle would clip it, since it has width and the ray
 * does not.
 *
 * opts:
 *   pad     clearance treated as "already touching" (default: agent-ish 0.55)
 *   danger  weight of the danger term (higher = gives obstacles a wider berth)
 *   commit  weight of the keep-your-heading term (higher = smoother, lazier)
 *   spread  how many slots an obstacle's danger bleeds into
 *   minClear directions with less clearance than this are rejected outright
 */
export function contextSteer(dx, dz, senses, opts = {}) {
  const m = Math.hypot(dx, dz);
  if (m < 1e-6) return { x: 0, z: 0 };
  const ux = dx / m, uz = dz / m;
  if (!senses || !senses.rays) return { x: ux, z: uz };

  const range = senses.range;
  // Nothing at all in the way of where we want to go: take it exactly, so
  // open-ground movement is untouched by the steering layer.
  if (senses.clearanceToward(ux, uz) >= range - 1e-3) return { x: ux, z: uz };

  const n = senses.rays;
  const pad = opts.pad ?? 0.55;
  const dangerW = opts.danger ?? 1.35;
  const commit = opts.commit ?? 0.12;
  const spread = opts.spread ?? 1.35;
  const minClear = opts.minClear ?? 0.45;
  const fx = senses.forward.x, fz = senses.forward.z;

  if (_occ.length < n) { _occ = new Float32Array(n); _scores = new Float32Array(n); }
  const occ = _occ, scores = _scores;
  const span = Math.max(0.001, range - pad);
  for (let i = 0; i < n; i++) {
    const d = senses.dist[i];
    occ[i] = d >= range ? 0 : Math.max(0, Math.min(1, 1 - (d - pad) / span));
  }

  const w = Math.ceil(spread);
  let bestI = -1, bestS = -Infinity;
  let openI = 0, openD = -Infinity;
  for (let j = 0; j < n; j++) {
    if (senses.dist[j] > openD) { openD = senses.dist[j]; openI = j; }
    const cx = senses.dirX[j], cz = senses.dirZ[j];
    let danger = 0;
    for (let k = -w; k <= w; k++) {
      const i = (j + k + n) % n;
      if (occ[i] <= 0) continue;
      const d = occ[i] * Math.max(0, 1 - Math.abs(k) / (spread + 1));
      if (d > danger) danger = d;
    }
    const s = (cx * ux + cz * uz) + commit * (cx * fx + cz * fz) - dangerW * danger;
    scores[j] = s;
    // A direction we would walk straight into is never a candidate, however
    // well it points at the goal.
    if (senses.dist[j] >= minClear && s > bestS) { bestS = s; bestI = j; }
  }

  // Boxed in on every ray: take the most open direction and squeeze out.
  if (bestI < 0) return { x: senses.dirX[openI], z: senses.dirZ[openI] };

  // Refine between neighbours (parabola vertex) so the heading is continuous
  // instead of snapping from slot to slot as the agent moves.
  const s0 = scores[(bestI - 1 + n) % n], s1 = scores[bestI], s2 = scores[(bestI + 1) % n];
  const denom = s0 - 2 * s1 + s2;
  let off = 0;
  if (denom < -1e-6) off = Math.max(-0.5, Math.min(0.5, (s0 - s2) / (2 * denom)));
  const ang = senses.probeYaw + ((bestI + off) / n) * TWO_PI;
  return { x: Math.sin(ang), z: Math.cos(ang) };
}

/**
 * Turn a heading toward a target angle at a capped rate (rad/s), taking the
 * short way around. Most agents in this game snap their facing straight to
 * their movement vector every frame; this is for the rarer case of an agent
 * that should behave like it has real inertia in a turn — heading and desired
 * direction fall out of sync while cornering, so pair this with speed scaled
 * down by how far off-heading the agent still is (see Citizen's flee step),
 * otherwise a sharp turn reads as sliding sideways instead of turning.
 */
export function turnToward(current, target, dt, ratePerSec) {
  let diff = target - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const maxStep = ratePerSec * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Rotate a heading by a small, time-varying angle so a moving agent weaves
 * naturally instead of tracking a dead-straight line — and, across a crowd of
 * different phases/frequencies, so they don't all march in lockstep columns.
 */
export function gaitWobble(x, z, t, phase, freq, amp) {
  const a = Math.sin(t * freq + phase) * amp;
  const cs = Math.cos(a), sn = Math.sin(a);
  return { x: x * cs - z * sn, z: x * sn + z * cs };
}
