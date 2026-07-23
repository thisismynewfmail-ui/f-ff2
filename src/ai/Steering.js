/**
 * Steering primitives: pure functions that turn sensory readings into a
 * desired direction on the XZ plane. Behaviours compose these; the entity
 * integrates the result against its own speed and collision.
 *
 * The important one is avoidObstacles(): it blends any desired direction with
 * the "steer away from walls" vector the Senses whiskers produce. Layering
 * avoidance over seek/flee/wander is where the emergent behaviour comes from —
 * an agent fleeing a threat automatically rounds corners, a wanderer skirts
 * props, a zombie with no path still slides along a wall toward its target.
 */

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
