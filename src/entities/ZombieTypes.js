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
    height: 1.75,
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
    height: 1.7,
    scale: 1.0,
    tint: null,          // the sheet is already coloured (green + red charge)
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
};
