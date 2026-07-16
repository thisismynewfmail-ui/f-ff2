/**
 * Zombie type definitions.
 *
 * Adding a new type = adding a config object here (stats + sprite tint).
 * No core system changes needed: the spawn director picks types by weight
 * and the Zombie class reads everything from its config.
 */
export const ZOMBIE_TYPES = {
  walker: {
    name: 'Walker',
    hp: 30,
    points: 1,
    damage: 10,          // melee hit (separate from the flat 5 contact damage)
    reach: 1.7,
    wanderSpeed: 0.8,
    chaseSpeed: 2.1,
    sightRange: 50,
    // Sized so the enemy stands eye-to-eye with the player. The base sheet is a
    // big-turban character whose eyes sit at ~0.59 of the sprite cell, and the
    // billboard maps the whole cell onto `height` from the feet up — so the eyes
    // land at 0.59 * height. The player's standing eye is at 1.62 m
    // (Player EYE_STAND), which needs height ≈ 1.62 / 0.59 ≈ 2.75 for their
    // gazes to meet. (The width scales with height, so the sprite stays in
    // proportion.)
    height: 2.75,
    // `height` above is the VISUAL/hittable size only. The navigation capsule
    // uses this humanoid height instead, so the tall sprite doesn't snag its
    // head on awnings, eaves and door lintels the old 1.75 m walker cleared —
    // otherwise the horde gets stuck near buildings and never reaches the
    // player. See Zombie.collisionHeight.
    collisionHeight: 1.75,
    scale: 1.0,
    tint: null,          // uses the sheet as-is
    walkFps: 5,
    attackWindup: 0.5,
    attackCooldown: 1.2,
    knockbackResist: 0,
  },
  sprinter: {
    name: 'Sprinter',
    hp: 15,
    points: 2,
    damage: 6,
    reach: 1.6,
    wanderSpeed: 1.6,
    chaseSpeed: 5.4,
    sightRange: 60,
    height: 1.68,
    scale: 0.95,
    tint: 'sprinter',    // feverish red
    walkFps: 11,
    attackWindup: 0.3,
    attackCooldown: 0.9,
    knockbackResist: 0,
  },
  tank: {
    name: 'Tank',
    hp: 220,
    points: 5,
    damage: 26,
    reach: 2.2,
    wanderSpeed: 0.7,
    chaseSpeed: 1.4,
    sightRange: 55,
    height: 2.35,
    scale: 1.45,
    tint: 'tank',        // sickly green bulk
    walkFps: 4,
    attackWindup: 0.7,
    attackCooldown: 1.6,
    knockbackResist: 0.85,
  },
  // The Exploder: a Creeper-like suicide bomber (see src/entities/Exploder.js).
  // It chases like a Walker, skirts to a flank when it closes in, then pauses to
  // prime a short fuse and detonates. It also blows up when killed. The fields
  // below the standard block are Exploder-only tunables the class reads.
  exploder: {
    name: 'Exploder',
    hp: 30,
    points: 3,
    damage: 0,           // the explosion — not a melee — deals the damage
    reach: 1.5,          // unused by the class; kept sane for shared helpers
    wanderSpeed: 1.0,
    chaseSpeed: 5.4,     // only SLIGHTLY faster than the player's 5.0 walk
    sightRange: 60,
    // As tall as the other enemies: stands shoulder-to-shoulder with the
    // eye-level Walker rather than as a runt. This sheet draws the character
    // filling more of its cell than the Walker's (its head reaches higher in the
    // frame), so a slightly SMALLER height than the Walker's 2.75 renders at the
    // same on-screen stature — heads level with the horde, not towering over it.
    height: 2.55,
    // Like the tall Walker, the visual sprite is over-tall, so navigate on a
    // normal humanoid capsule — otherwise the bomber snags its head on awnings
    // and door lintels and never reaches the player. (See Zombie.collisionHeight.)
    collisionHeight: 1.75,
    scale: 1.0,
    tint: null,          // the sheet is already coloured (green vest + red charges)
    walkFps: 7,
    attackWindup: 0.25,  // unused by the class; the real fuse is fuseTime
    attackCooldown: 1.0,
    knockbackResist: 0.1,
    // --- Exploder-only ---
    flankRange: 3.0,       // within this it stops beelining and skirts to a side
    triggerRange: 1.5,     // ~2 ft: within this (with LOS) it commits to the blast
    fuseTime: 0.25,        // quarter-second wind-up before an attack detonation
    deathExplodeDelay: 0.5,// half-second into the death anim it blows up too
    retryCooldown: 1.0,    // lockout after a fuse the target escaped
    explodeRadius: 4.0,    // blast reach (metres)
    explodeDamage: 80,     // damage at the centre, linear falloff to the edge
    explodeKnockback: 6,   // shove imparted to caught zombies
  },
  // The Spitter: a CS:GO-styled dual-pistol ranged enemy (see
  // src/entities/Spitter.js). It kites to hold a short standoff band, moves a
  // touch slower than the player, and — crucially — never moves and shoots at
  // once: it plants itself, pauses a quarter-second to aim, then fires a spread
  // shot. The fields below the standard block are Spitter-only tunables.
  spitter: {
    name: 'Spitter',
    hp: 104,                // a tanky ranged threat — 4x a basic walker-ish body
    points: 3,
    damage: 8,             // per shot that lands
    reach: 1.6,            // unused by the class; kept sane for shared helpers
    wanderSpeed: 1.0,
    chaseSpeed: 4.4,       // SLIGHTLY slower than the player's 5.0 walk
    sightRange: 60,
    height: 1.72,
    scale: 1.0,
    tint: null,            // the sheet is already coloured
    walkFps: 6,
    attackWindup: 0.25,    // unused by the class; the real pause is aimTime
    attackCooldown: 1.2,   // unused by the class; the real gap is fireCooldown
    knockbackResist: 0,
    // --- Spitter-only ---
    standoffMin: 5.0,      // ~16 ft: closer than this and it back-pedals away
    standoffMax: 8.0,      // ~26 ft: farther than this and it closes the gap
    disengageRange: 12.0,  // abandon an aim only if the target slips well past
    aimTime: 0.25,         // quarter-second pause (windup) before the shot
    firePoseTime: 0.14,    // how long the muzzle-flash pose lingers after a shot
    fireCooldown: 1.15,    // gap between shots
    // Spread in degrees. Tuned for the standoff range: near the min it lands
    // tightly, out toward the max it opens up so a distant shot is dodgeable.
    spread: 5.5,
    strafe: 0.7,           // sideways weight for organic circling between shots
  },
};
