import { Entity } from './Entity.js';
import { SpriteBillboard, makeSpriteMaterial } from '../rendering/Billboard.js';
import { Senses } from '../ai/Senses.js';
import { NavAgent } from '../ai/NavAgent.js';
import { turnToward } from '../ai/Steering.js';
import { local2world } from '../world/Buildings.js';

/**
 * The savable citizen — a captive found tied up inside a random building.
 * Spawned by CitizenSystem, which guarantees one on each of the first two
 * waves (wave 1's in the player's own starting district) and then rolls a
 * spawn chance every wave after the kill gate, picking one random enterable
 * building in an unlocked district — so past the opening pair, both whether
 * she appears and where change every playthrough.
 *
 * States:
 *   captured  she stands in place wearing npc_save_captured.png, and an
 *             [E] prompt is live on her.
 *   fleeing   interacting swaps her to npc_save_release.png, drops a health
 *             kit at her feet, and sends her for the door.
 *   gone      at least 5 seconds have passed since the rescue and the player
 *             cannot see her (or a safety timer elapsed); CitizenSystem
 *             despawns her.
 *
 * The flee movement deliberately does NOT use the instant snap-to-heading
 * model every other entity here uses (yaw = atan2(intent), move on intent
 * directly). Fleeing through a doorway on a straight-line/whisker-avoidance
 * intent made her spin toward the exit and immediately drift back off it
 * before the turn had actually gotten her facing it — turn and movement were
 * fighting each other in tight interior spaces. Instead her heading turns
 * toward the desired direction at a capped rate (turnToward) and her speed is
 * scaled by how well she's currently facing that direction, so a sharp turn
 * (e.g. rounding a doorway) visibly slows her and straightens out before she
 * accelerates again — a turning circle instead of a slide.
 */
const TURN_RATE = 2.0;      // rad/s — slow, deliberate turning
const MIN_ALIGN_SPEED = 0.15; // never fully stall while turning
const FLEE_SPEED = 3.5;
// Turning-circle radius at full speed (speed / turnRate) is ~1.75 m. A target
// captured at a radius smaller than that makes a turn-limited agent orbit it
// forever — she swings past, the desired heading flips ~180°, the capped turn
// rate can't correct before she swings past again, and net progress stalls to
// near zero (all turning, no arriving; exactly the "turns and returns to
// straight before the turn helps" symptom). Waypoint/target radii below are
// all kept comfortably above that turning circle so she always settles onto a
// heading and sails through instead of circling the target.
const REACH_WAYPOINT = 1.6;  // the exit point (open ground, waypointIndex only ever advances)
const CAPTURE_RADIUS = 3.0;  // outdoor vanish legs — one-shot, never re-sought
// A doorway opening (partition gap ~1.2 m, exterior door ~1.5 m) is narrower
// than REACH_WAYPOINT, so a Euclidean-distance capture radius that loose can
// "reach" the gap point while she's still flush against the SOLID part of
// the wall a metre or so to the side of it — the radius doesn't know a wall
// is in the way. Doorway waypoints need a radius tight enough that being
// within it basically means standing in the opening itself.
const GAP_RADIUS = 0.9;
const OUTSIDE_MARGIN = 3.5;  // how far past the door threshold counts as "outside"
const VANISH_STEP = 11;      // length of each leg once she's outside and still receding
const VANISH_MAX = 70;       // total outdoor flee distance before she just holds position
// She is only allowed to leave the world 5 seconds after the rescue, and even
// then only while the player cannot see her — so the player always gets a few
// seconds of watching her actually run before she is eligible to vanish, and
// she never blinks out in view. Deliberately a pure time + line-of-sight test:
// no distance-from-the-door term, so once the 5 seconds are up she goes the
// moment she is unseen, whether she made it down the street or is still
// picking her way through the back room.
const DESPAWN_DELAY = 5.0;
const MAX_FLEE_TIME = 45;    // hard safety cap in case she gets stuck somewhere

// Obstacle steering and wedge recovery both come from the shared NavAgent.
// The case it solves for her is a prop that blocks movement but not the route —
// street furniture and interior furniture are collision boxes, not nav-grid
// walls — sitting square between her and a goal that lies straight through it.
// "Steer away from it" and "seek the goal" then cancel and she grinds to a
// halt against it; the recovery has to be LATERAL, because leaning harder into
// the goal only presses her into the box and collision pins her there. She uses
// the navigator purely as a steering + unwedging layer: the route itself stays
// her own explicit waypoint chain below, since the nav grid's 2 m cells are
// coarse next to these buildings' ~1.2 m interior gaps.

export class Citizen extends Entity {
  constructor(events, world, texCaptured, texReleased, built) {
    super();
    this.events = events;
    this.world = world;
    this.texReleased = texReleased;
    this.height = 1.6;
    this.radius = 0.34;
    this.addTag('friendly');
    this.addTag('citizen');

    this.building = built;
    const spec = built.spec;
    const sp = built.spawnPoints[0];
    const y = world.groundHeightFor(sp.x, sp.z, 1e9);
    this.position.set(sp.x, y, sp.z);

    // Every opening in this building was declared to the nav grid as a portal
    // when it was built (BuildingKit._registerPortals), each carrying the exact
    // centre and outward normal of the gap it was cut from. Read her escape
    // geometry straight off those rather than recomputing it from the spec —
    // one definition of where the doors are, shared with pathfinding.
    const doorPortal = (built.portals ?? []).find((p) => p.tag === 'door');
    const door = built.doorWorld ?? { x: spec.x, z: spec.z + spec.d / 2 };
    if (doorPortal) {
      this.outDir = { x: doorPortal.nx, z: doorPortal.nz };
    } else {
      // No declared door (shouldn't happen for an enterable building): fall back
      // to the vector from the building's centre to its door.
      const nx = door.x - spec.x, nz = door.z - spec.z;
      const nlen = Math.hypot(nx, nz) || 1;
      this.outDir = { x: nx / nlen, z: nz / nlen };
    }
    this.doorPoint = { x: door.x, z: door.z };
    this.exitPoint = { x: door.x + this.outDir.x * OUTSIDE_MARGIN, z: door.z + this.outDir.z * OUTSIDE_MARGIN };

    // Interior partition walls (housePartitions/lobbyPartitions/etc.) hang
    // their doorway gap off-centre — a straight line from her spawn to the
    // exit runs broadside into the solid part of that wall, and reactive
    // steering alone can't discover an opening off to one side that is not on
    // the way. The gaps are declared portals too, in partition order, so route
    // her through each one explicitly instead of guessing.
    const rot = ((spec.rot || 0) % 360 + 360) % 360;
    const gapPortals = (built.portals ?? []).filter((p) => p.tag === 'gap');
    this.gapWaypoints = gapPortals.length
      ? gapPortals.map((p) => ({ x: p.x, z: p.z }))
      : (spec.partitions ?? []).map((p) => {
        const gapAt = p.gapAt ?? (p.from + p.to) / 2;
        const [lx, lz] = p.axis === 'x' ? [gapAt, p.at] : [p.at, gapAt];
        return local2world(spec, rot, lx, lz);
      });

    this.yaw = Math.atan2(this.outDir.x, this.outDir.z);

    this.billboard = new SpriteBillboard(makeSpriteMaterial(texCaptured), this.height, 0.6);
    this.mesh = this.billboard.mesh;
    this.mesh.position.copy(this.position);

    this.state = 'captured';
    this.waypoints = [];
    this.waypointIndex = 0;
    this.phase = 'toExit'; // 'toExit' (waypoint chain to the door) -> 'outside' (receding legs)
    this.vanishTarget = null;
    this.fleeDist = 0;
    this.fleeTimer = 0;
    this.toRemove = false;

    this.senses = new Senses(world, { range: 2.4, rays: 12, interval: 0.13 });
    // Steering + wedge recovery only: her route is the waypoint chain below,
    // never the nav grid, so the navigator is always driven in `direct` mode
    // with the leg she is currently walking as its desired direction.
    this.nav = new NavAgent(world, { steer: { pad: this.radius + 0.15 } });

    this.interactable = world.addInteractable({
      x: this.position.x, y, z: this.position.z, radius: 1.9,
      prompt: 'Free the captive [E]',
      enabled: () => this.state === 'captured',
      onInteract: () => this.free(),
    });
  }

  free() {
    if (this.state !== 'captured') return;
    this.state = 'fleeing';
    this.billboard.material.map = this.texReleased;
    this.billboard.material.needsUpdate = true;
    this.events.emit('loot:spawn', { x: this.position.x, z: this.position.z, type: 'health', amount: 30 });
    this.events.emit('subtitle', { text: 'She grabs the kit and bolts for the door.' });
    // Explicit waypoint chain rather than A* on the shared nav grid: its 2 m
    // cells are coarse next to a ~1.2-1.5 m doorway gap and next to these
    // buildings' small footprints, and occasionally resolve a route that
    // steps outside the building envelope entirely before finding the real
    // door. The building was built from these exact coordinates (each
    // partition's gap, the door itself), so route through them directly —
    // every partition gap in order, then the door, then outside. Gaps and
    // the door get the tight GAP_RADIUS (they're narrow openings in a wall);
    // the exit point is open ground well clear of any wall, so the looser
    // REACH_WAYPOINT is fine there.
    this.waypoints = [
      ...this.gapWaypoints.map((w) => ({ x: w.x, z: w.z, radius: GAP_RADIUS })),
      { x: this.doorPoint.x, z: this.doorPoint.z, radius: GAP_RADIUS },
      { x: this.exitPoint.x, z: this.exitPoint.z, radius: REACH_WAYPOINT },
    ];
    this.waypointIndex = 0;
  }

  /**
   * Desired direction toward the current flee goal: each waypoint in order
   * (partition gaps, the door, the point just outside it) -> receding further
   * outdoors once clear of the building.
   *
   * Phase/index advances are one-shot rather than a distance check re-run
   * against the same fixed point every frame. Re-testing "am I still farther
   * than X from that exact point" forever is what causes the orbiting bug
   * above — once she's inside a leg's capture radius, that target is retired
   * for good and never re-sought, so there is nothing left for her to swing
   * back around toward.
   */
  _fleeGoal() {
    const pos = this.position;
    if (this.phase === 'toExit') {
      if (this.waypointIndex < this.waypoints.length) {
        const w = this.waypoints[this.waypointIndex];
        if (Math.hypot(w.x - pos.x, w.z - pos.z) < w.radius) {
          this.waypointIndex++;
          return this._fleeGoal();
        }
        return w;
      }
      this.phase = 'outside'; // clear of the doorway — never seek a "toExit" point again
    }

    // phase === 'outside': keep receding along the door's outward direction,
    // picking a fresh leg each time the current one is captured.
    if (!this.vanishTarget || Math.hypot(this.vanishTarget.x - pos.x, this.vanishTarget.z - pos.z) < CAPTURE_RADIUS) {
      if (this.fleeDist < VANISH_MAX) {
        const jitter = (Math.random() - 0.5) * 0.6;
        const dx = this.outDir.x + jitter, dz = this.outDir.z - jitter;
        const l = Math.hypot(dx, dz) || 1;
        this.vanishTarget = { x: pos.x + (dx / l) * VANISH_STEP, z: pos.z + (dz / l) * VANISH_STEP };
        this.fleeDist += VANISH_STEP;
      } else {
        this.vanishTarget = null;
      }
    }
    return this.vanishTarget;
  }

  _despawn() {
    if (this.state === 'gone') return;
    this.state = 'gone';
    this.alive = false;
    this.toRemove = true;
    this.mesh.visible = false;
  }

  update(dt, ctx) {
    if (this.state === 'gone') return;
    this.senses.update(dt, this);
    let moving = false;

    if (this.state === 'fleeing') {
      this.fleeTimer += dt;

      // The navigator supplies obstacle steering and the lateral unwedge; the
      // leg to walk is always hers. `direct` keeps it out of the routing path
      // entirely — the waypoint chain IS the route.
      const goal = this._fleeGoal();
      const dir = goal && this.nav.steer(dt, this, goal, {
        direct: true,
        desired: { x: goal.x - this.position.x, z: goal.z - this.position.z },
        senses: this.senses,
      });
      if (dir) {
        const desiredYaw = Math.atan2(dir.x, dir.z);
        this.yaw = turnToward(this.yaw, desiredYaw, dt, TURN_RATE);
        const align = Math.max(MIN_ALIGN_SPEED, Math.cos(desiredYaw - this.yaw));
        const speed = FLEE_SPEED * align;
        this.position.x += Math.sin(this.yaw) * speed * dt;
        this.position.z += Math.cos(this.yaw) * speed * dt;
        moving = true;
      }
      this.world.collision.resolveCapsule(this.position, this.radius, this.height);
      this.position.y = this.world.groundHeightFor(this.position.x, this.position.z, this.position.y + 0.5);

      if (this.fleeTimer > DESPAWN_DELAY) {
        const player = ctx.player;
        const visible = player && player.alive && this.world.hasLineOfSight(
          player.position.x, player.position.y + 1.5, player.position.z,
          this.position.x, this.position.y + 1.2, this.position.z);
        if (!visible || this.fleeTimer > MAX_FLEE_TIME) {
          this._despawn();
          return;
        }
      }
    }

    this.mesh.position.copy(this.position);
    this.billboard.update(dt, ctx.camPos, this.yaw, moving, 5);
  }

  dispose() {
    this.world.removeInteractable(this.interactable);
    this.billboard.dispose();
  }
}
