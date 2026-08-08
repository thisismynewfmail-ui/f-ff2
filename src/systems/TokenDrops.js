/**
 * What each kind of enemy leaves in the dirt.
 *
 * A pure table, kept out of the spawn director so the drop economy can be read
 * (and tested) in one place. Keyed by the type NAME on ZombieTypes, so a new
 * archetype either declares its coin here or drops none — a type nobody
 * thought about cannot quietly inherit somebody else's rate.
 *
 *   Standard horde   copper, worth 5, on 15% of kills
 *   Spitter          gold,   worth 10, on 5%
 *   Exploder         silver, worth 20, on 10% — and unlike its ammunition
 *                    drop, the coin does NOT care who set it off: it pays out
 *                    whether the player shot it, it detonated on its own, or
 *                    another blast took it with it. A bomber that blows itself
 *                    up on your position is still a bomber you dealt with.
 *
 * The coin values themselves live in TokenSystem.COINS; this only says which
 * coin and how often.
 */
export const COIN_DROPS = {
  Walker: { type: 'coin_copper', chance: 0.15 },
  Sprinter: { type: 'coin_copper', chance: 0.15 },
  Tank: { type: 'coin_copper', chance: 0.15 },
  Spitter: { type: 'coin_gold', chance: 0.05 },
  Exploder: { type: 'coin_silver', chance: 0.10 },
};

/**
 * Roll the coin for one death. Returns the pickup type to drop, or null.
 * `rand` is injectable so the table can be exercised deterministically.
 */
export function rollCoin(typeName, rand = Math.random) {
  const d = COIN_DROPS[typeName];
  if (!d) return null;
  return rand() < d.chance ? d.type : null;
}
