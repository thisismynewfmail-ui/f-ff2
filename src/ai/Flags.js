/**
 * Opt-in AI flags.
 *
 * Tags say what an entity IS ('zombie', 'friendly', 'citizen', 'critter') and
 * are what senses and targeting filter on. Flags say what an entity's AI is
 * ALLOWED or ASKED to do differently, per individual, without subclassing it.
 *
 * The rule that makes this useful is that NOTHING here is default behaviour.
 * Every flag reads as "off" until something outside the entity actively stamps
 * it on (see SpawnSystem.setCull, wired to the dev console), so the shared AI
 * stack can grow switches like these without any of them quietly changing how
 * a plain NPC behaves. Reading an unset flag returns the registry default,
 * which is always the inert value.
 *
 * Adding one is: a line in AI_FLAGS describing it, and a read via aiFlag()
 * wherever it applies.
 */
export const AI_FLAGS = {
  /**
   * Cull a hunter that has had no unobstructed line to the player for this many
   * seconds. Removal is scored as horde hygiene, not a kill: the wave director
   * refunds the slot, so one straggler wedged behind geometry can never stall a
   * round. 0 = never cull. The game actively sets 30 at startup.
   */
  cullBlindSeconds: 0,

  /** Scale a hunter's detection range for non-player targets. 1 = as configured. */
  friendlyRangeMul: 1,

  /** Hold position instead of wandering when there is nothing to hunt. */
  noWander: false,

  /** Ignore noise events entirely — no investigating gunfire. */
  deaf: false,
};

/** Read an opt-in flag, falling back to its inert registry default. */
export function aiFlag(entity, name) {
  const v = entity && entity.flags ? entity.flags[name] : undefined;
  return v === undefined ? AI_FLAGS[name] : v;
}

/** Stamp a flag onto an entity (or clear it back to the default with null). */
export function setAiFlag(entity, name, value) {
  if (!entity || !entity.flags) return;
  if (value === null || value === undefined) delete entity.flags[name];
  else entity.flags[name] = value;
}
