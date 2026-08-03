/**
 * Reusable perception component for any NPC.
 *
 * Turns the raw world into a small bundle of sensory readings an agent's
 * behaviours act on — nothing here decides *what* to do, only what is *felt*:
 *
 *   - Direction: forward / right unit vectors derived from the agent's yaw, so
 *     "forward is forward" everywhere (yaw 0 → +Z, right → +X, matching
 *     movement, the sprite billboards and every probe below).
 *   - An obstacle RING: `rays` probes fanned over the full 360°, each reporting
 *     how far the agent could walk that way before hitting something. This is
 *     the substrate the steering layer reads (see Steering.contextSteer) and it
 *     is what lets agents wander without scraping walls, thread a doorway, and
 *     find their way back out of a dead end instead of grinding into it.
 *   - Target perception: is some entity sensible right now? Distance, line of
 *     sight, an optional detection range and a forward field-of-view cone
 *     (with a close-range "sixth sense" bubble). Callers can also opt into
 *     `alwaysVisible` — global awareness with no range gate (zombies always
 *     know where the player is; LOS is still reported for those who need it).
 *   - Memory: where a target was last actually perceived, and how long ago, so
 *     behaviours can keep hunting a target that just broke line of sight
 *     rather than forgetting it the instant it steps behind a wall.
 *   - Hearing: the last noise felt, for behaviours that investigate.
 *
 * ---- why the probes are a full ring --------------------------------------
 * The earlier version fanned five whiskers across the FORWARD arc only and
 * collapsed them into a single "steer away" vector. Two things fall out of
 * that which no amount of tuning fixes. An agent in a dead end senses only the
 * wall it is facing, so the escape route — behind it — is literally not in the
 * data. And in a doorway the two jamb whiskers are symmetric: their sideways
 * components cancel and what survives is a push straight BACKWARDS, so the
 * agent is repelled out of the opening it was trying to walk through. Sensing
 * the whole circle, and choosing a direction from it rather than summing
 * repulsions, makes both cases ordinary: the doorway is simply the direction
 * with clearance, and so is the way out of the dead end.
 *
 * Heavy work (the ring raycasts) is throttled on a per-agent stagger so a crowd
 * spreads its cost across frames. Probes are taken in WORLD space and remember
 * the heading they were taken at, so readings stay pinned to the world while
 * the agent turns under them. Direction vectors refresh every call because they
 * are almost free and behaviours read them constantly.
 */
const TWO_PI = Math.PI * 2;

export class Senses {
  constructor(world, opts = {}) {
    this.world = world;
    // `whiskerRange` is the historical name for how far the agent feels.
    this.range = opts.range ?? opts.whiskerRange ?? 3.2;
    // Number of probes around the full circle. More = finer gaps resolved (a
    // doorway needs at least one slot to fall inside it), at a linear cost.
    this.rays = Math.max(6, opts.rays ?? 12);
    this.interval = opts.interval ?? 0.14;   // ring refresh period (s)
    this.probeHeight = opts.probeHeight ?? 0.9;
    this.memorySpan = opts.memorySpan ?? 8;  // seconds a sighting is retained
    this._timer = Math.random() * this.interval; // stagger the crowd

    this.forward = { x: 0, z: 1 };
    this.right = { x: -1, z: 0 };  // forward rotated -90° about Y (see update)

    // Ring readings. `dist[i]` is the clearance along `dirX[i], dirZ[i]`, all
    // in world space; `probeYaw` is the heading they were taken relative to.
    this.dist = new Float32Array(this.rays).fill(this.range);
    this.dirX = new Float32Array(this.rays);
    this.dirZ = new Float32Array(this.rays);
    this.probeYaw = 0;

    this.avoid = { x: 0, z: 0, strength: 0 }; // unit steer-away + 0..1 urgency
    this.clearAhead = 1;                      // 0 (wall in face) .. 1 (open)
    this.contact = Infinity;                  // nearest obstacle, any direction

    this.memory = new Map();   // entity id -> { x, z, age, dist, target }
    this.lastNoise = null;     // { x, z, age, radius }

    this._dirs = [];
    for (let i = 0; i < this.rays; i++) this._dirs.push({ x: 0, y: 0, z: 0, i });
    this._reset(0);
  }

  /** Eye height used for line-of-sight rays. */
  eyeY(agent) { return agent.position.y + (agent.height ?? 1.7) * 0.8; }

  /** Local bearing of ring slot `i` relative to the heading it was probed at. */
  slotAngle(i) {
    const a = (i / this.rays) * TWO_PI;
    return a > Math.PI ? a - TWO_PI : a;
  }

  _reset(yaw) {
    this.probeYaw = yaw;
    for (let i = 0; i < this.rays; i++) {
      const a = yaw + (i / this.rays) * TWO_PI;
      this.dirX[i] = Math.sin(a);
      this.dirZ[i] = Math.cos(a);
      this.dist[i] = this.range;
    }
  }

  /** Refresh facing vectors every frame; refresh the obstacle ring on cadence. */
  update(dt, agent) {
    const y = agent.yaw;
    // Forward matches how every agent here derives its yaw from movement
    // (yaw = atan2(moveX, moveZ)), so yaw 0 faces +Z. Right is forward rotated
    // -90° about Y, which is what "right" means in this right-handed, Y-up
    // world — the same relationship the player's own basis uses (its yaw 0
    // faces -Z with right at +X). Getting this backwards silently mirrors
    // anything that reasons about sides: which way to dodge, which shoulder an
    // obstacle is on, which way to skirt a target.
    this.forward.x = Math.sin(y); this.forward.z = Math.cos(y);
    this.right.x = -this.forward.z; this.right.z = this.forward.x;

    // Age memories and the last noise, dropping them once stale.
    if (this.memory.size) {
      for (const [id, m] of this.memory) {
        m.age += dt;
        if (m.age > this.memorySpan) this.memory.delete(id);
      }
    }
    if (this.lastNoise) {
      this.lastNoise.age += dt;
      if (this.lastNoise.age > this.memorySpan) this.lastNoise = null;
    }

    this._timer -= dt;
    if (this._timer > 0) return;
    this._timer = this.interval;
    this._probe(agent);
  }

  _probe(agent) {
    const yaw = agent.yaw;
    const origin = { x: agent.position.x, y: agent.position.y + this.probeHeight, z: agent.position.z };
    // Rays fanned over the whole circle from the current heading, so slot 0 is
    // always dead ahead and the fan rotates with the agent.
    for (let i = 0; i < this.rays; i++) {
      const a = yaw + (i / this.rays) * TWO_PI;
      const dx = Math.sin(a), dz = Math.cos(a);
      this.dirX[i] = dx; this.dirZ[i] = dz;
      const d = this._dirs[i];
      d.x = dx; d.y = 0; d.z = dz;
    }
    this.probeYaw = yaw;
    const hits = this.world.collision.probe(origin, this._dirs, this.range);

    let ax = 0, az = 0, wsum = 0, nearest = Infinity;
    for (let i = 0; i < this.rays; i++) {
      const hit = hits[i];
      this.dist[i] = hit;
      if (hit < nearest) nearest = hit;
      // The legacy `avoid` vector stays a FORWARD-arc repulsion sum, so
      // behaviours still layering it over a desired direction keep the exact
      // feel they were tuned with. contextSteer() reads `dist` directly.
      const ang = this.slotAngle(i);
      if (Math.abs(ang) > Math.PI / 2) continue;
      const clear = Math.min(1, hit / this.range);
      if (clear < 0.999) {
        const w = (1 - clear) * (1 - clear); // closer wall ⇒ harder lean away
        ax -= this.dirX[i] * w; az -= this.dirZ[i] * w;
        wsum += w;
      }
    }
    this.clearAhead = Math.min(1, this.dist[0] / this.range);
    this.contact = nearest;
    const m = Math.hypot(ax, az);
    if (m > 1e-4) {
      this.avoid.x = ax / m; this.avoid.z = az / m;
      this.avoid.strength = Math.min(1, wsum);
    } else {
      this.avoid.x = 0; this.avoid.z = 0; this.avoid.strength = 0;
    }
  }

  /**
   * Clearance along an arbitrary world direction, interpolated between the two
   * ring slots either side of it. Steering and stuck-recovery both ask this
   * rather than re-raycasting.
   */
  clearanceToward(dx, dz) {
    const m = Math.hypot(dx, dz);
    if (m < 1e-6) return this.range;
    let a = Math.atan2(dx / m, dz / m) - this.probeYaw;
    a = ((a % TWO_PI) + TWO_PI) % TWO_PI;
    const f = (a / TWO_PI) * this.rays;
    const i0 = Math.floor(f) % this.rays;
    const i1 = (i0 + 1) % this.rays;
    const t = f - Math.floor(f);
    return this.dist[i0] * (1 - t) + this.dist[i1] * t;
  }

  /**
   * The most open direction available, optionally biased toward a preferred
   * heading. Used to break out of a wedge and to pick a flight direction that
   * is not a dead end.
   */
  openDirection(preferX = 0, preferZ = 0) {
    const pm = Math.hypot(preferX, preferZ);
    const px = pm > 1e-6 ? preferX / pm : 0, pz = pm > 1e-6 ? preferZ / pm : 0;
    let best = -Infinity, bx = this.forward.x, bz = this.forward.z;
    for (let i = 0; i < this.rays; i++) {
      const align = pm > 1e-6 ? (this.dirX[i] * px + this.dirZ[i] * pz) : 0;
      const s = this.dist[i] / this.range + align * 0.75;
      if (s > best) { best = s; bx = this.dirX[i]; bz = this.dirZ[i]; }
    }
    return { x: bx, z: bz };
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

  /** Unobstructed line of sight from the agent's eye to a bare world point. */
  lineOfSightTo(agent, x, y, z) {
    return this.world.hasLineOfSight(agent.position.x, this.eyeY(agent), agent.position.z, x, y, z);
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
   *   remember      record the sighting in memory when it lands
   */
  perceive(agent, target, opts = {}) {
    if (!target || target.alive === false) return null;
    const dx = target.position.x - agent.position.x;
    const dz = target.position.z - agent.position.z;
    const dist = Math.hypot(dx, dz);
    const bearing = this.bearingTo(agent, target.position.x, target.position.z);

    if (opts.alwaysVisible) {
      const los = opts.needLOS ? this.lineOfSight(agent, target) : true;
      const r = { target, dist, dx, dz, bearing, los };
      if (opts.remember !== false && los) this.mark(target, dist);
      return r;
    }
    if (dist > (opts.range ?? Infinity)) return null;
    if (opts.fov != null && Math.abs(bearing) > opts.fov / 2 && dist > (opts.proximity ?? 0)) return null;
    const los = this.lineOfSight(agent, target);
    if (opts.requireLOS !== false && !los) return null;
    if (opts.remember !== false && los) this.mark(target, dist);
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

  /** Record where a target was last actually sensed. */
  mark(target, dist = 0) {
    if (!target) return;
    this.memory.set(target.id, {
      target, x: target.position.x, z: target.position.z, y: target.position.y, age: 0, dist,
    });
  }

  /** Last known position of a target, or null once the memory has decayed. */
  recall(target) {
    return target ? this.memory.get(target.id) ?? null : null;
  }

  /** Feed a noise event in; behaviours read it back off `lastNoise`. */
  hear(x, z, radius = 0) {
    this.lastNoise = { x, z, radius, age: 0 };
  }

  /** Wipe transient state (used when an agent is recycled or teleported). */
  clearMemory() {
    this.memory.clear();
    this.lastNoise = null;
  }
}
