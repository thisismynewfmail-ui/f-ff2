/**
 * WHAT THE HORDE SAYS.
 *
 * The enemies were re-skinned from shamblers to militia fighters, and a
 * fighter who moans is a shambler with a new coat of paint. So every archetype
 * gets a voice: its own pitch range, its own delivery, and its own lines for
 * every state it can be in — idle, spotting you, closing, swinging, taking a
 * round, and dying.
 *
 * The lines are written as phoneme strings for the formant synthesiser in
 * audio/Speech.js (space-separated; '.' is a beat). They are short calls of
 * the kind actually shouted in a firefight — a warning, an order, a position —
 * and the takbir, which is the one an approaching bomber says, because that is
 * the line that call belongs to and putting anything else there would be a
 * joke at the expense of the moment rather than a piece of characterisation.
 *
 * Three rules hold across the table:
 *
 *  1. EVERY ARCHETYPE IS RECOGNISABLE BY EAR ALONE. The heavy is a fifth
 *     below the rifleman, the runner is a fourth above him and delivers
 *     everything at 1.3× speed, and the bomber's pitch climbs through his
 *     one line. You should know what is coming at you with your back turned.
 *  2. EVERY INDIVIDUAL IS RECOGNISABLE TOO. Each enemy carries a `voice`
 *     value fixed when it spawns, which shifts its fundamental inside its
 *     archetype's band — so the same fighter always sounds like himself, and
 *     eight of them do not sound like one man shouting eight times.
 *  3. NOBODY TALKS OVER ANYBODY. Lines are rate-limited per state and per
 *     town (see AudioManager.enemyLine): a wave landing does not produce
 *     forty voices in one second, it produces two or three, which is what a
 *     street full of people actually sounds like.
 */

/**
 * Phoneme keys, for reading the table below:
 *   vowels  aa(father) a(bat) e(bet) i(beet) o(bought) u(boot) uh(but) ay(day)
 *   voiced  l r m n w y b d g v z
 *   fricat. s sh f h kh th        stops  k t p q
 *   pauses  .  (beat)   ,  (short beat)
 */
export const ENEMY_VOICES = {
  /* --- the rifleman: the body of the horde ------------------------------ */
  walker: {
    f0: [104, 132], rate: 1.0, grit: 0.55,
    lines: {
      // muttering to himself on the street, before anyone has seen anyone
      idle: [
        'aa . y n . uh',            // low mutter
        'm . h uh . n aa',
        'l aa . sh ay',             // "la shay" — nothing
      ],
      // he has seen you: a position call, loud
      spot: [
        'aa d u w . h u n aa k',    // "aduw hunak" — enemy, over there
        'sh u f . h aa th aa',      // "shuf hatha" — look at this
        'aa n aa . aa r aa h u',    // "ana arahu" — I see him
      ],
      // closing
      chase: [
        'y aa l l aa',              // "yalla" — move
        'i h j u m',                // "ihjum" — attack
        'aa m aa m i',              // "amami" — in front of me
      ],
      attack: ['kh u th', 'h aa', 'i th b aa h'],
      hurt: ['aa kh', 'uh h', 'y aa'],
      die: ['aa . aa aa', 'l aa . aa', 'uh . aa'],
    },
  },

  /* --- the runner: everything the same, faster and higher --------------- */
  sprinter: {
    f0: [138, 172], rate: 1.32, grit: 0.6,
    lines: {
      idle: ['h uh . h uh', 'aa . h'],
      spot: ['h u n aa k . h u n aa k', 'y aa l l aa . y aa l l aa'],
      chase: ['aa s r aa', 'i h j u m . aa l aa n', 'y aa l l aa'],
      attack: ['h aa', 'kh uh', 'h aa . h aa'],
      hurt: ['aa kh kh', 'i i'],
      die: ['aa i i', 'h aa . aa'],
    },
  },

  /* --- the heavy: a fifth down, and he takes his time ------------------- */
  tank: {
    f0: [72, 92], rate: 0.82, grit: 0.7,
    lines: {
      idle: ['m . m aa', 'h uh . aa'],
      spot: ['aa n aa . h u n aa', 'q i f . m aa k aa n aa k'],   // "qif" — halt
      chase: ['t aa q a d d a m', 'l aa . m a f a r r'],          // no escape
      attack: ['h aa', 'kh u th . h aa th aa'],
      hurt: ['uh r r', 'aa r r'],
      die: ['aa aa . uh', 'm aa . aa'],
    },
  },

  /* --- the bomber -------------------------------------------------------
   * One line, and it is the one that call actually belongs to. It goes off
   * when he COMMITS — ten metres out with a clear line — not when the fuse
   * lights, because the fuse is a quarter of a second and the line is over a
   * second: hung there, the player would hear one syllable and then the blast.
   * Called on the run in, it is a second of warning while he crosses the last
   * of the ground, which is the only reliable tell a bomber gives. The `fuse`
   * variant is what is left of it at contact, clipped and shouted.          */
  exploder: {
    f0: [126, 150], rate: 1.15, grit: 0.5,
    lines: {
      idle: ['h uh . m', 'aa . h uh'],
      spot: ['aa l l aa h u . aa k b a r', 'h u n aa k'],
      chase: ['aa l l aa h u . aa k b a r', 'aa q t a r i b'],
      // THE call, on the run in
      prime: ['aa l l aa h u . aa k b a r'],
      // ...and what is left of it when he is on top of you
      fuse: ['aa k b a r', 'aa l l aa h'],
      attack: ['aa l l aa h u . aa k b a r'],
      hurt: ['aa kh'],
      die: ['aa l l aa h'],
    },
  },

  /* --- the pistolero: calls his shots ----------------------------------- */
  spitter: {
    f0: [116, 144], rate: 1.1, grit: 0.55,
    lines: {
      idle: ['h uh', 'aa . m'],
      spot: ['aa d u w', 'r aa h u . h u n aa k'],
      chase: ['i th b a t', 'l aa . t a t a h a r r a k'],       // hold / don't move
      // called as he plants his feet, which is the tell that a shot is coming
      aim: ['i t l aa q', 'th a b i t . aa l aa n'],             // "itlaq" — fire
      attack: ['i t l aa q'],
      hurt: ['aa kh', 'uh h'],
      die: ['aa . aa', 'l aa'],
    },
  },
};

/** The archetype key for a ZOMBIE_TYPES config name. */
export function voiceKeyFor(typeName) {
  switch (typeName) {
    case 'Sprinter': return 'sprinter';
    case 'Tank': return 'tank';
    case 'Exploder': return 'exploder';
    case 'Spitter': return 'spitter';
    default: return 'walker';
  }
}
