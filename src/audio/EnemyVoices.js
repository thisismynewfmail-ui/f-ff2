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
/**
 * WHAT EVERY ONE OF THEM SAYS.
 *
 * These two pools are folded into every archetype below, so the takbir and the
 * rest of the common calls come out of a rifleman, a runner, a heavy, a bomber
 * and a pistolero alike — the same man's stock phrases, in five different
 * voices. Each archetype then adds its own lines on top, which is what stops
 * the horde sounding like one script read five times.
 *
 * IDLE is what they say when nobody has found anybody: muttering, invocations,
 * somebody asking where he went. PROWL is what they say once they are coming
 * for you: shorter, louder, and about position rather than about God.
 *
 * The delivery is what keeps this from becoming a nuisance rather than the
 * lines themselves — see the throttling note in AudioManager.enemyLine. A
 * fighter offers a line every eleven to twenty-six seconds and the town lets
 * roughly one of them through every five, so what a player hears is an
 * occasional voice out of a crowd, not a crowd.
 */
const COMMON_IDLE = [
  'aa l l aa h u . aa k b a r',              // Allahu akbar
  'b i s m i l l aa h',                      // bismillah
  'a l h a m d u . l i l l aa h',            // alhamdulillah
  'i n sh aa . aa l l aa h',                 // insha'Allah
  'l aa . h aw l a . w a l aa . q u w w a',  // la hawla wa la quwwa
  's a b r a n , s a b r a n',               // patience
  'y aa l l aa , y aa l l aa',               // move, move
  'm aa . f i . sh ay . h u n aa',           // nothing here
  'i n t a b i h',                           // pay attention
  'a d u w . q a r i b',                     // enemy close
  'ay n a . h u w a',                        // where is he
  'h aa th i h i . a r d u n aa',            // this is our ground
  'a l m aw t u . q a r i b',                // death is near
  'l aa . t a kh a f',                       // do not be afraid
  'n a h n u . k a th i r',                  // we are many
  'a l l ay l u . t a w i l',                // the night is long
];

const COMMON_PROWL = [
  'aa l l aa h u . aa k b a r',
  'y aa l l aa . y aa l l aa',
  'i h j u m . a l aa n',                    // attack, now
  'h u n aa k . a d u w',                    // enemy there
  'a m aa m i',                              // in front of me
  't a q a d d a m',                         // advance
  'l aa . m a f a r r',                      // no escape
  'q a r i b . q a r i b',                   // close, close
  'i h aa t u h u',                          // surround him
  'l aa . t a t r u k h u',                  // do not let him go
  'r aa h u . h u n aa k',                   // I see him there
];

/** Fold the shared calls in under whatever the archetype adds of its own. */
const withCommon = (own) => ({
  ...own,
  idle: [...COMMON_IDLE, ...(own.idle || [])],
  prowl: [...COMMON_PROWL, ...(own.prowl || [])],
});

export const ENEMY_VOICES = {
  /* --- the rifleman: the body of the horde ------------------------------ */
  walker: {
    f0: [104, 132], rate: 1.0, grit: 0.55,
    lines: withCommon({
      // muttering to himself on the street, before anyone has seen anyone
      idle: [
        'm . h uh . n aa',
        'l aa . sh ay',                      // "la shay" — nothing
        'k a m . m i n . w a q t',           // how much longer
        'i s m a . th aa l i k',             // listen to that
      ],
      // ...and once he is coming for you
      prowl: [
        'i h j u m',
        'h u w a . h u n aa',                // he is here
        'a l aa n . a l aa n',               // now, now
      ],
      // he has seen you: a position call, loud
      spot: [
        'a d u w . h u n aa k',              // "aduw hunak" — enemy, over there
        'sh u f . h aa th aa',               // "shuf hatha" — look at this
        'a n aa . a r aa h u',               // "ana arahu" — I see him
      ],
      // closing
      chase: [
        'y aa l l aa',                       // "yalla" — move
        'i h j u m',                         // "ihjum" — attack
        'a m aa m i',                        // "amami" — in front of me
      ],
      attack: ['kh u th', 'h aa', 'i th b aa h'],
      hurt: ['aa kh', 'uh h', 'y aa'],
      die: ['aa . aa aa', 'l aa . aa', 'uh . aa'],
    }),
  },

  /* --- the runner: everything the same, faster and higher --------------- */
  sprinter: {
    f0: [138, 172], rate: 1.32, grit: 0.6,
    lines: withCommon({
      idle: ['h uh . h uh', 'l aa . i n t i th aa r', 'm a t aa'],  // no waiting / when
      prowl: ['a s r a . a s r a', 'l a h i q h u', 'y aa l l aa'],  // faster / catch him
      spot: ['h u n aa k . h u n aa k', 'y aa l l aa . y aa l l aa'],
      chase: ['a s r a', 'i h j u m . a l aa n', 'y aa l l aa'],
      attack: ['h aa', 'kh uh', 'h aa . h aa'],
      hurt: ['aa kh kh', 'i i'],
      die: ['aa i i', 'h aa . aa'],
    }),
  },

  /* --- the heavy: a fifth down, and he takes his time ------------------- */
  tank: {
    f0: [72, 92], rate: 0.82, grit: 0.7,
    lines: withCommon({
      idle: ['m . m aa', 'a n aa . l aa . a kh aa f', 'a l s a b r u . j a m i l'],
      prowl: ['t a q a d d a m', 'l aa . m a f a r r', 'a n aa . q aa d i m'],  // I am coming
      spot: ['a n aa . h u n aa', 'q i f . m a k aa n a k'],   // "qif" — halt
      chase: ['t a q a d d a m', 'l aa . m a f a r r'],
      attack: ['h aa', 'kh u th . h aa th aa'],
      hurt: ['uh r r', 'aa r r'],
      die: ['aa aa . uh', 'm aa . aa'],
    }),
  },

  /* --- the bomber -------------------------------------------------------
   * The takbir is in his idle and prowl pools like everybody else's — but the
   * one that matters is `prime`, which goes off when he COMMITS at ten metres
   * rather than when the fuse lights. The fuse is a quarter of a second and
   * the line is over a second: hung there, the player would hear one syllable
   * and then the blast. Called on the run in, it is a second of warning while
   * he crosses the last of the ground, which is the only reliable tell a
   * bomber gives. The `fuse` variant is what is left of it at contact.     */
  exploder: {
    f0: [126, 150], rate: 1.15, grit: 0.5,
    lines: withCommon({
      idle: ['h uh . m', 'q a r i b a n . i n sh aa . aa l l aa h', 'a n a . j aa h i z'],
      prowl: ['a q t a r i b', 'i b t a i d u', 'aa l l aa h u . aa k b a r'],  // stand back
      spot: ['aa l l aa h u . aa k b a r', 'h u n aa k'],
      chase: ['aa l l aa h u . aa k b a r', 'a q t a r i b'],
      // THE call, on the run in
      prime: ['aa l l aa h u . aa k b a r'],
      // ...and what is left of it when he is on top of you
      fuse: ['aa k b a r', 'aa l l aa h'],
      attack: ['aa l l aa h u . aa k b a r'],
      hurt: ['aa kh'],
      die: ['aa l l aa h'],
    }),
  },

  /* --- the pistolero: calls his shots ----------------------------------- */
  spitter: {
    f0: [116, 144], rate: 1.1, grit: 0.55,
    lines: withCommon({
      idle: ['h uh', 'a n aa . j aa h i z', 'th a kh i r a . k aa f i y a'],  // ready / enough ammo
      prowl: ['th a b i t', 'l aa . t a q t a r i b', 'r aa h u'],           // hold / do not close
      spot: ['a d u w', 'r aa h u . h u n aa k'],
      chase: ['i th b a t', 'l aa . t a t a h a r r a k'],       // hold / don't move
      // called as he plants his feet, which is the tell that a shot is coming
      aim: ['i t l aa q', 'th a b i t . a l aa n'],             // "itlaq" — fire
      attack: ['i t l aa q'],
      hurt: ['aa kh', 'uh h'],
      die: ['aa . aa', 'l aa'],
    }),
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
