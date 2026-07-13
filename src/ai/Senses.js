/**
 * Reusable perception component for any NPC.
 *
 * Turns the raw world into a small bundle of sensory readings an agent's
 * behaviours act on — nothing here decides *what* to do, only what is *felt*:
 *
 *   - Direction: forward / right unit vectors derived from the agent's yaw,
 *     so "forward is forward" everywhere (yaw 0 → +Z, matching movement and
 *     the sprite billboards).
 *   - Obstacle whiskers: short rays fanned out around the facing direction
 *     against the collision world, collapsed into a single "steer away from
 *     walls" vector. This is what lets agents wander without bumping walls
 *     and lets zombies feel their way out of a spawn house.
 *   - Target perception: is some entity sensible right now? Distance, line of
 *     sight, an optional detection range and a forward field-of-view cone
 *     (with a close-range "sixth sense" bubble). Callers can also opt into
 *     `alwaysVisible` — global awareness with no range gate (zombies always
 *     know where the player is; LOS is still reported for those who need it).
 *
 * Heavy work (the whisker raycasts) is throttled on a per-agent stagger so a
 * crowd of agents spreads its cost across frames. Direction vectors refresh
 * every call because they are almost free and behaviours read them constantly.
 */
export class Senses {
  constructor(world, opts = {}) {
    this.world = world;
    this.whiskerRange = opts.whiskerRange ?? 3.2;
    // Angles (radians) relative to facing: 0 = dead ahead, ± fan to the sides.
    this.whiskerAngles = opts.whiskerAngles ?? [0, 0.55, -0.55, 1.15, -1.15];
    this.interval = opts.interval ?? 0.14;   // whisker refresh period (s)
    this.probeHeight = opts.probeHeight ?? 0.9;
    this._timer = Math.random() * this.interval; // stagger the crowd

    this.forward = { x: 0, z: 1 };
    this.right = { x: 1, z: 0 };
    this.avoid = { x: 0, z: 0, strength: 0 }; // unit steer-away + 0..1 urgency
    this.clearAhead = 1;                      // 0 (wall in face) .. 1 (open)
  }

  /** Eye height used for line-of-sight rays. */
  eyeY(agent) { return agent.position.y + (agent.height ?? 1.7) * 0.8; }

  /** Refresh facing vectors every frame; refresh obstacle whiskers on cadence. */
  update(dt, agent) {
    const y = agent.yaw;
    this.forward.x = Math.sin(y); this.forward.z = Math.cos(y);
    this.right.x = Math.cos(y); this.right.z = -Math.sin(y);
    this._timer -= dt;
    if (this._timer > 0) return;
    this._timer = this.interval;
    this._probe(agent);
  }

  _probe(agent) {
    const origin = { x: agent.position.x, y: agent.position.y + this.probeHeight, z: agent.position.z };
    // Rays fanned around the facing direction — each whisker is (sin,cos) of
    // yaw+angle, so the fan rotates with the agent and stays aligned to it.
    const dirs = this.whiskerAngles.map((a) => ({ x: Math.sin(agent.yaw + a), y: 0, z: Math.cos(agent.yaw + a), a }));
    const hits = this.world.collision.probe(origin, dirs, this.whiskerRange);
    let ax = 0, az = 0, wsum = 0, ahead = 1;
    for (let i = 0; i < dirs.length; i++) {
      const clear = Math.min(1, hits[i] / this.whiskerRange);
      if (dirs[i].a === 0) ahead = clear;
      if (clear < 0.999) {
        // The closer the wall, the harder we lean away from that whisker.
        const w = (1 - clear) * (1 - clear);
        ax -= dirs[i].x * w; az -= dirs[i].z * w;
        wsum += w;
      }
    }
    this.clearAhead = ahead;
    const m = Math.hypot(ax, az);
    if (m > 1e-4) {
      this.avoid.x = ax / m; this.avoid.z = az / m;
      this.avoid.strength = Math.min(1, wsum);
    } else {
      this.avoid.x = 0; this.avoid.z = 0; this.avoid.strength = 0;
    }
  }

  /** Signed bearing of a world point relative to the agent's facing (rad). */
  bearingTo(agent, x, z) {
    const b = Math.atan2(x - agent.position.x, z - agent.position.z) - agent.yaw;
    return Math.atan2(Math.sin(b), Math.cos(b));
  }

  /** Unobstructed line of sight from the agent's eye to a target's torso. */
  lineOfSight(agent, target) {
    return this.world.hasLineOfSight(
      agent.position.x, this.eyeY(agent), agent.position.z,
      target.position.x, target.position.y + (target.height ?? 1.6) * 0.8, target.position.z,
    );
  }

  /**
   * Evaluate whether `agent` perceives `target` right now.
   * Returns a reading { target, dist, dx, dz, bearing, los } or null.
   *
   * opts:
   *   range         max detection distance (default: unlimited)
   *   fov           detection cone width in radians centred on facing
   *   proximity     targets closer than this ignore the cone (sixth sense)
   *   requireLOS    require unobstructed sight (default true)
   *   alwaysVisible skip range/cone/LOS gates — global awareness
   *   needLOS       with alwaysVisible, still compute the LOS boolean
   */
  perceive(agent, target, opts = {}) {
    if (!target || target.alive === false) return null;
    const dx = target.position.x - agent.position.x;
    const dz = target.position.z - agent.position.z;
    const dist = Math.hypot(dx, dz);
    const bearing = this.bearingTo(agent, target.position.x, target.position.z);

    if (opts.alwaysVisible) {
      const los = opts.needLOS ? this.lineOfSight(agent, target) : true;
      return { target, dist, dx, dz, bearing, los };
    }
    if (dist > (opts.range ?? Infinity)) return null;
    if (opts.fov != null && Math.abs(bearing) > opts.fov / 2 && dist > (opts.proximity ?? 0)) return null;
    const los = this.lineOfSight(agent, target);
    if (opts.requireLOS !== false && !los) return null;
    return { target, dist, dx, dz, bearing, los };
  }

  /** Nearest perceivable target from a list, or null. */
  perceiveNearest(agent, targets, opts = {}) {
    let best = null;
    for (const t of targets) {
      if (opts.filter && !opts.filter(t)) continue;
      const r = this.perceive(agent, t, opts);
      if (r && (!best || r.dist < best.dist)) best = r;
    }
    return best;
  }
}
