/**
 * Weapon definitions — pure data.
 *
 * Each weapon carries a themed identity (`flavor`), primary stats, and an
 * `alt` block describing its right-mouse secondary fire. Damage, fire rate,
 * magazine, spread, sounds and the alt-fire behaviour are all read from the
 * config; the 3D model + animation rig lives in WeaponModels.js keyed by id.
 *
 * spread is in degrees (cone half-angle-ish), range in metres, noise is the
 * radius in which zombies hear the shot.
 *
 * alt.mode:
 *   'auto'   — hold RMB to fire rapidly (pistol hair-trigger), damageMul<1
 *   'double' — click RMB to fire multiple chambers at once (shotgun), shells>1
 *   'burst'  — click RMB for a fixed N-round burst (rifle)
 *   'charge' — click RMB for a heavy wind-up melee swing (bat)
 *  (the sniper has no alt block: its RMB is the telescopic scope, via `zoom`.)
 */
export const WEAPON_CONFIGS = [
  {
    id: 'pistol',
    name: 'PISTOL',
    flavor: 'REGENT AUTOLOADER',
    fireMode: 'SEMI',
    tacticalReload: 0.72, // quick-tap when the mag isn't empty
    slot: 1,
    melee: false,
    damage: 12,
    pellets: 1,
    pierce: 1,
    magSize: 12,
    reserveStart: Infinity, // sidearm: unlimited reserve, limited magazine
    fireInterval: 0.26,
    auto: false,
    reloadTime: 1.1,
    spread: 1.1,
    bloomPerShot: 0.5,
    range: 70,
    noise: 38,
    kick: 1.0,
    zoom: null,
    sound: 'pistol',
    ammoType: 'ammo_pistol',
    altLabel: 'HAIR-TRIGGER',
    alt: { mode: 'auto', fireInterval: 0.10, damageMul: 0.6, spread: 2.6, sound: 'pistolAuto', noise: 34 },
  },
  {
    id: 'shotgun',
    name: 'SHOTGUN',
    flavor: 'CRANE COACHGUN',
    fireMode: 'BREAK',
    slot: 2,
    melee: false,
    damage: 10,
    pellets: 9,
    pierce: 1,
    magSize: 8,        // tube-fed: eight shells before it needs a reload
    reserveStart: 40,
    fireInterval: 0.42, // second trigger comes fast
    auto: false,
    reloadTime: 1.9,
    spread: 5.5,
    bloomPerShot: 0,
    range: 30,
    noise: 55,
    kick: 2.4,
    knockback: 5.0,
    zoom: null,
    sound: 'shotgun',
    ammoType: 'ammo_shotgun',
    altLabel: 'BOTH BARRELS',
    alt: { mode: 'double', shells: 2, pellets: 18, fireInterval: 0.62, spread: 8.0, kickMul: 1.6, knockbackMul: 1.7, sound: 'shotgunDouble', noise: 70 },
  },
  {
    id: 'rifle',
    name: 'ASSAULT RIFLE',
    flavor: 'FOUNDRY GUN',
    fireMode: 'AUTO',
    tacticalReload: 0.75,
    slot: 3,
    melee: false,
    damage: 10,
    pellets: 1,
    pierce: 1,
    magSize: 60,        // doubled from the standard 30-round box
    reserveStart: 120,
    fireInterval: 0.095,
    auto: true,
    reloadTime: 1.9,
    spread: 1.6,
    bloomPerShot: 0.35, // recoil bloom builds while holding the trigger
    bloomMax: 3.5,
    range: 85,
    noise: 48,
    kick: 0.8,
    zoom: null,
    sound: 'rifle',
    ammoType: 'ammo_rifle',
    altLabel: '3-RND BURST',
    alt: { mode: 'burst', count: 3, burstSpacing: 0.06, fireInterval: 0.5, spread: 0.7, damageMul: 1.15, sound: 'rifleBurst', noise: 50 },
  },
  {
    id: 'sniper',
    name: 'SNIPER RIFLE',
    flavor: 'MERIDIAN LONG RIFLE',
    fireMode: 'BOLT',
    slot: 4,
    melee: false,
    damage: 5000, // one-shots every enemy (the toughest, the Tank, has 220 HP)
    pellets: 1,
    pierce: 3, // punches through a line of them
    magSize: 5,
    reserveStart: 15,
    fireInterval: 1.35,
    auto: false,
    reloadTime: 2.6,
    spread: 4.0,      // from the hip
    spreadScoped: 0.12,
    bloomPerShot: 0,
    range: 240,
    noise: 60,
    kick: 3.2,
    zoom: 3.6,        // right-click scope (this weapon's secondary action)
    sound: 'sniper',
    ammoType: 'ammo_sniper',
    altLabel: 'SCOPE',
  },
  {
    id: 'bat',
    name: 'BASEBALL BAT',
    flavor: 'IRONSHOD SLUGGER',
    fireMode: 'MELEE',
    slot: 5,
    melee: true,
    damage: 34,
    range: 2.4,
    arc: 70,          // degrees
    fireInterval: 0.55,
    auto: false,
    knockback: 6.5,
    noise: 0,         // silent
    kick: 0,
    zoom: null,
    sound: 'bat',
    altLabel: 'HEAVY SWING',
    alt: { mode: 'charge', damageMul: 2.1, knockbackMul: 1.7, arcMul: 1.25, fireInterval: 0.95, sound: 'batCharge' },
  },
];
