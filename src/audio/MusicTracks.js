/**
 * THE SCORE.
 *
 * Nine pieces of music, written as data: one for the title screen, one for
 * each of the six districts, one for dying and one for the end of the run.
 * Every one of them exists TWICE — a `calm` arrangement and a `danger`
 * arrangement — and the two are deliberately built on the same root, the same
 * tempo and the same bar grid so the director can cross-fade between them mid
 * phrase without a smear, a pitch bend or a dropped beat. That is the whole
 * trick behind "the music changes when you are about to die and changes back
 * when you patch yourself up": it is not a different song, it is the same song
 * with the lights turned off.
 *
 * What makes them tracks rather than loops: they are never rendered and cut.
 * The director schedules them as one continuous stream, so a pad's release and
 * a bell's tail run straight across the bar-8 boundary into bar 1 the way they
 * would in a room. There is no seam because there is no join.
 *
 * ---------------------------------------------------------------------------
 * ARRANGEMENT FORMAT
 *
 *   scale     semitone offsets of the mode, one octave
 *   prog      one scale degree per bar — the root of that bar's chord
 *   layers    what plays, in kinds the arranger understands:
 *
 *     pad     a held chord, re-struck every `every` bars
 *     bass    a 16-step pattern per bar, in the bar's chord
 *     arp     the bar's chord, walked at `rate` steps
 *     seq     a written melody: [stepInLoop, scaleDegree, lengthInSteps]
 *     perc    16-step drum patterns (kick / snare / hat / open / clank)
 *     sparse  one-shot atmosphere on chosen bars
 *
 *   drones    continuous voices started with the arrangement and faded with it
 *
 * Step characters, shared by `bass` and `perc`:
 *   .  rest      x  chord root      3 / 5 / 7  chord third / fifth / seventh
 *   o  root an octave up            l  root an octave down
 *   -  hold (extends the note before it by one step)
 * ---------------------------------------------------------------------------
 */

export const SCALES = {
  minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:   [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  pent:     [0, 3, 5, 7, 10],
  major:    [0, 2, 4, 5, 7, 9, 11],
};

/* Roots, low. Everything is voiced up from here by whole octaves so a track's
 * identity survives being transposed for a variant. */
const A1 = 55.00, C2 = 65.41, D1 = 36.71, D2 = 73.42, E1 = 41.20, G1 = 49.00, F1 = 43.65;

export const TRACKS = {
  /* ================= TITLE ================================================
   * A dial being turned in an empty room. Nothing hurries; the organ holds,
   * the music box remembers half a phrase, and every eight bars a burst of
   * carrier noise reminds you what you are listening through.            */
  menu: {
    name: 'CARRIER', bpm: 58, root: D2, scale: SCALES.minor, bars: 8,
    prog: [0, 0, 5, 5, 3, 3, 4, 4],
    calm: {
      layers: [
        { k: 'pad', voice: 'organ', oct: 0, gain: 0.052, every: 2, tones: [0, 2, 4],
          opts: { drawbars: [1, 0.42, 0.26, 0.1, 0.05] } },
        { k: 'pad', voice: 'strings', oct: -1, gain: 0.030, every: 4, tones: [0, 4] },
        { k: 'bass', voice: 'sub', oct: -1, gain: 0.115, dur: 3.2,
          pat: 'x...............' },
        { k: 'seq', voice: 'glass', oct: 3, gain: 0.058, notes: [
          [4, 4, 6], [12, 2, 4], [20, 0, 8], [36, 4, 4], [40, 5, 6], [52, 4, 4],
          [68, 2, 6], [76, 0, 4], [84, -1, 10], [104, 2, 4], [112, 4, 8], [120, 2, 6],
        ] },
        { k: 'sparse', voice: 'static', gain: 0.030, bars: [0, 5], step: 14, dur: 0.5 },
        { k: 'sparse', voice: 'swell', gain: 0.026, bars: [2, 6], step: 0, dur: 5.0,
          opts: { freq: 300, q: 0.7 } },
      ],
    },
    danger: {
      drones: [{ semi: -12, gain: 0.055, cutoff: 130, sweep: 0.05 }],
      layers: [
        { k: 'pad', voice: 'choir', oct: 0, gain: 0.048, every: 2, tones: [0, 2, 4] },
        { k: 'bass', voice: 'reese', oct: -1, gain: 0.10, dur: 1.5, pat: 'x.......x.......' },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.05, bars: [0, 4], step: 0, dur: 3.4 },
      ],
    },
  },

  /* ================= ZONE 0 — OLD TOWN SQUARE ============================
   * HOME, AND WHAT IS COMING FOR IT.
   *
   * This is the track the player hears first, hears longest, and hears every
   * time a run restarts, and the first pass got it exactly wrong: a slow
   * string chorale over a walking sub reads as a town somebody has already
   * lost. Nobody is mourning this square yet — they are standing in the middle
   * of it with a pistol, watching a horde come up four roads at once.
   *
   * So it is a MARCH. A driving sixteenth-note bass under a four-on-the-floor
   * kick, a hammered minor ostinato on the lead, and a horn call that answers
   * it every other bar — the tempo is up by half, the drums are in the CALM
   * arrangement rather than being held back for the danger one, and the
   * harmony sits on the tonic for four bars before it moves, which is what
   * makes the movement feel like something arriving rather than something
   * being remembered.
   *
   * What keeps it in the game's world rather than turning it into an action
   * film: it is still the same handful of retro voices everything else here is
   * played on, it is still in A minor, and it still gets out of the way — the
   * ostinato sits in the mid-band under the guns and the low end is a pulse
   * rather than a wall.                                                    */
  oldtown: {
    name: 'HOLD THE LINE', bpm: 132, root: A1, scale: SCALES.minor, bars: 8,
    prog: [0, 0, 0, 0, 5, 5, 6, 4],
    calm: {
      drones: [{ semi: 0, gain: 0.030, cutoff: 150, sweep: 0.08 }],
      layers: [
        // the engine: sixteenths on the tonic, opening onto the chord tones
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.105, dur: 0.16,
          pat: 'xxx.xx.xx.x.xx.5', opts: { cut: 300 } },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.115, dur: 0.30,
          pat: 'x...x...x...x...' },
        // the beat, in the CALM mix. A wave-survival square is not a quiet
        // place and the drums are not a reward for nearly dying.
        { k: 'perc', gain: 0.100, kick: 'x...x...x...x...', snare: '....x.......x...',
          hat: 'x.xxx.xxx.xxx.xx', open: '..............x.' },
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.040, every: 2, tones: [0, 2, 4],
          opts: { bright: 1.25 } },
        // the hammered ostinato — the thing you will actually remember
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.048, notes: [
          [0, 0, 2], [2, 0, 2], [4, 2, 2], [6, 0, 2], [8, 4, 2], [10, 2, 2], [12, 0, 4],
          [16, 0, 2], [18, 0, 2], [20, 2, 2], [22, 4, 2], [24, 5, 2], [26, 4, 2], [28, 2, 4],
          [32, 0, 2], [34, 0, 2], [36, 2, 2], [38, 0, 2], [40, 4, 2], [42, 2, 2], [44, 0, 4],
          [48, 0, 2], [50, 2, 2], [52, 4, 2], [54, 5, 2], [56, 6, 4], [60, 4, 4],
          [64, 4, 2], [66, 4, 2], [68, 5, 2], [70, 4, 2], [72, 2, 4], [76, 0, 4],
          [80, 4, 2], [82, 5, 2], [84, 6, 2], [86, 5, 2], [88, 4, 4], [92, 2, 4],
          [96, 6, 2], [98, 5, 2], [100, 4, 2], [102, 2, 2], [104, 0, 6],
          [112, 4, 2], [114, 2, 2], [116, 0, 2], [118, -1, 2], [120, 0, 8],
        ], opts: { cut: 2100, wave: 'square' } },
        // ...and the horn answering it off the back of every other bar
        { k: 'seq', voice: 'lead', oct: 1, gain: 0.036, notes: [
          [12, 0, 4], [28, 4, 4], [44, 0, 4], [60, 2, 4],
          [76, 4, 4], [92, 5, 4], [108, 6, 4], [124, 4, 4],
        ], opts: { cut: 900 } },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.030, bars: [0, 4], step: 0, dur: 2.4 },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 6, 6, 4, 4],
      drones: [{ semi: 0, gain: 0.052, cutoff: 170, sweep: 0.09 },
        { semi: 1, gain: 0.024, cutoff: 240, sweep: 0.16 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.050, every: 1, tones: [0, 2, 4],
          opts: { tremolo: 7.5, bright: 1.45 } },
        { k: 'pad', voice: 'choir', oct: 2, gain: 0.026, tones: [0, 1], every: 2 },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.120, dur: 0.16,
          pat: 'xxxxxxxxxxxxxxxx', opts: { cut: 380 } },
        { k: 'perc', gain: 0.108, kick: 'x..xx...x..xx...', snare: '....x.......x.x.',
          hat: 'xxxxxxxxxxxxxxxx' },
        { k: 'perc', kind: 'heart', gain: 0.13, at: [0, 8] },
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.046, notes: [
          [0, 1, 2], [2, 0, 2], [4, 1, 2], [6, 0, 4], [12, 4, 4],
          [32, 1, 2], [34, 0, 2], [36, 1, 2], [38, 0, 4], [44, 5, 4],
          [64, 6, 2], [66, 5, 2], [68, 4, 4], [76, 1, 4],
          [96, 4, 2], [98, 5, 2], [100, 6, 4], [108, 1, 4], [120, 0, 8],
        ], opts: { cut: 1700 } },
      ],
    },
  },

  /* ================= ZONE 1 — EASTGATE RESIDENTIAL =======================
   * SOMEBODY'S STREET, AND SOMETHING IN IT.
   *
   * The first pass was a lullaby: sixty-six to the minute, a whistle over a
   * held sub, and the warmth of the dorian mode doing all the work. It read
   * beautifully standing still on an empty pavement and it read like nothing
   * at all with four fighters coming through the gardens — which is the state
   * the player is actually in for most of the time they spend here.
   *
   * So the tempo is up to a hundred and ten and the motion has moved into the
   * middle of the arrangement: a running eight-note figure on the plucked
   * voice that never quite settles on the tonic, a bass that lands off the
   * beat as often as on it, and a kit that drives from the hats rather than
   * from the kick — a street being moved through, not a street being mourned.
   *
   * The dorian sixth is still what makes it Eastgate, and the eerie half of
   * the brief lives in what is AROUND the figure: a drone under everything, a
   * whistle answering across the gardens on nobody's beat, and a glass tone
   * that arrives late in the phrase where a resolution should be. It is a warm
   * mode played by something that is not warm.
   *
   * Level-wise it is still the quietest of the six. It has to be: this is the
   * track the player hears longest, and energy here is carried by MOVEMENT —
   * the number of events per bar — rather than by gain, so it can drive
   * without ever climbing over a gunshot or a voice line.
   *
   * Tempo is deliberately 5:6 against Old Town's 132 and Downtown's 132, so a
   * district change lands the two grids back in phase every six beats — well
   * inside the two-and-a-bit seconds the director takes to cross-fade.     */
  eastgate: {
    name: 'PORCH LIGHT', bpm: 110, root: G1, scale: SCALES.dorian, bars: 8,
    prog: [0, 0, 3, 3, 5, 5, 6, 4],
    calm: {
      drones: [{ semi: 0, gain: 0.026, cutoff: 130, sweep: 0.05 }],
      layers: [
        // the pulse: on the one, then off it twice — a walk, not a march
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.134, dur: 0.26,
          pat: 'x..x..x...x.x...' },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.060, dur: 0.18,
          pat: '....5.......3..5', opts: { cut: 300 } },
        // the kit, driven from the hats. Kick on the one and the off-beat of
        // three, so the bar leans forward instead of stamping.
        { k: 'perc', gain: 0.096, kick: 'x.....x...x.....', snare: '....x.......x...',
          hat: 'x.xx..x.x.xx..x.', open: '..............x.' },
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.043, every: 2, tones: [0, 2, 4],
          opts: { bright: 0.95 } },
        // THE FIGURE. Eight notes to the bar, never twice the same way round,
        // and it leans on the dorian sixth every other phrase.
        { k: 'seq', voice: 'pluck', oct: 1, gain: 0.053, notes: [
          [0, 0, 2], [4, 0, 2], [6, 2, 2], [8, 3, 2], [12, 2, 2],
          [16, 0, 2], [20, 0, 2], [22, 4, 2], [24, 3, 2], [28, 2, 2],
          [32, 3, 2], [36, 3, 2], [38, 5, 2], [40, 4, 2], [44, 3, 2],
          [48, 3, 2], [52, 2, 2], [54, 0, 2], [56, 2, 4],
          [64, 4, 2], [68, 4, 2], [70, 6, 2], [72, 5, 2], [76, 4, 2],
          [80, 4, 2], [84, 2, 2], [86, 4, 2], [88, 5, 4],
          [96, 6, 2], [100, 5, 2], [102, 4, 2], [104, 2, 4],
          [112, 4, 2], [116, 2, 2], [118, 0, 2], [120, 2, 6],
        ], opts: { bright: 0.9 } },
        // the call across the gardens: still the old whistle, now answering
        // the figure rather than singing over it
        { k: 'seq', voice: 'whistle', oct: 3, gain: 0.038, notes: [
          [10, 4, 6], [26, 5, 6], [58, 2, 6], [74, 4, 8], [106, 5, 6], [120, 4, 8],
        ] },
        // ...and the tone that arrives where a resolution should be
        { k: 'sparse', voice: 'glass', oct: 2, gain: 0.036, bars: [3, 7], step: 12, dur: 2.6 },
        { k: 'sparse', voice: 'swell', gain: 0.031, bars: [1, 5], step: 0, dur: 5.0,
          opts: { freq: 420, q: 0.6 } },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 6, 6, 5, 4],
      drones: [{ semi: -12, gain: 0.058, cutoff: 140, sweep: 0.09 },
        { semi: 1, gain: 0.020, cutoff: 220, sweep: 0.15 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.046, every: 1, tones: [0, 2, 4],
          opts: { tremolo: 7.2, bright: 1.35 } },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.112, dur: 0.16,
          pat: 'x.x.xx.xx.x.xx.x', opts: { cut: 320 } },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.100, dur: 0.30,
          pat: 'x...x...x...x...' },
        { k: 'perc', gain: 0.098, kick: 'x..x..x.x..x..x.', snare: '....x.......x.x.',
          hat: 'xxxxxxxxxxxxxxxx' },
        { k: 'perc', kind: 'heart', gain: 0.13, at: [0, 8] },
        // the figure, cornered: the same shape with the sixth flattened out of
        // it and the phrase ends bitten off
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.040, notes: [
          [0, 0, 2], [2, 1, 2], [4, 0, 4], [12, 4, 4],
          [32, 1, 2], [34, 0, 2], [36, 1, 4], [44, 5, 4],
          [64, 6, 2], [66, 5, 2], [68, 4, 4], [76, 1, 4],
          [96, 5, 2], [98, 4, 2], [100, 1, 4], [112, 0, 8],
        ], opts: { cut: 1700 } },
      ],
    },
  },

  /* ================= ZONE 2 — DOWNTOWN ==================================
   * HEIGHT, GLASS, AND NOTHING LIVING IN ANY OF IT.
   *
   * Downtown is the district that makes you keep moving, and the first pass
   * only half admitted it: eighty-eight to the minute with the kick on the one
   * and the three is a walk through an office park. This is a canyon with
   * nothing alive in it and something coming down it behind you.
   *
   * So the pulse is four to the floor at a hundred and thirty-two, with a
   * filtered bass answering it on the OFF beat — the oldest trick there is for
   * making a straight beat feel like it is being chased — and the backbeat is
   * a piece of METAL rather than a snare, because everything in this district
   * is a hard surface and the reverb of it is the district's own voice.
   *
   * The eerie half is in the mode, not in the mix. Phrygian's flat second is a
   * note that never sounds like it belongs, so the hook is built on the two
   * notes either side of it and keeps falling back to the one it cannot leave;
   * over the top, a glass tone answers each phrase from a long way up and
   * never resolves anything. Nothing here is trying to be frightening. It is
   * simply a place with a beat, and the beat does not stop.
   *
   * Kept out of the player's way by RANGE rather than by level: the pulse and
   * the bass live under 200 Hz, the hook sits in a narrow band around 500, and
   * the top two octaves — where gunfire, voices and the horde live — are given
   * over to a hat and one glass note a bar.                                */
  downtown: {
    name: 'GLASS AND CONCRETE', bpm: 132, root: C2, scale: SCALES.phrygian, bars: 8,
    prog: [0, 0, 1, 1, 0, 0, 6, 5],
    calm: {
      drones: [{ semi: 0, gain: 0.024, cutoff: 120, sweep: 0.05 }],
      layers: [
        { k: 'bass', voice: 'sub', oct: -1, gain: 0.148, dur: 0.24,
          pat: 'x...x...x...x...' },
        // the off-beat answer: this is the layer that makes it move
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.070, dur: 0.14,
          pat: '..x...x...x...xx', opts: { cut: 340 } },
        // four to the floor, a hat on every off-beat, and a piece of the
        // building on two and four
        { k: 'perc', gain: 0.098, kick: 'x...x...x...x...',
          hat: 'x.x.x.x.x.x.x.x.', open: '..............x.',
          clank: '....x.......x...' },
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.041, every: 2, tones: [0, 2, 4],
          opts: { bright: 1.25 } },
        // THE HOOK: two notes either side of the flat second, falling back
        // onto a tonic it cannot get away from
        { k: 'seq', voice: 'lead', oct: 1, gain: 0.046, notes: [
          [0, 0, 2], [2, 1, 2], [4, 0, 4], [10, 4, 2], [12, 3, 2], [14, 1, 2],
          [16, 0, 2], [18, 1, 2], [20, 0, 4], [26, 5, 2], [28, 4, 2], [30, 3, 2],
          [32, 0, 2], [34, 1, 2], [36, 0, 4], [42, 4, 2], [44, 3, 2], [46, 1, 2],
          [48, 0, 2], [50, 1, 2], [52, 3, 2], [54, 4, 4], [60, 1, 4],
          [64, 4, 2], [66, 5, 2], [68, 4, 4], [74, 1, 2], [76, 0, 4],
          [80, 4, 2], [82, 5, 2], [84, 6, 4], [90, 5, 2], [92, 4, 4],
          [96, 6, 2], [98, 5, 2], [100, 4, 2], [102, 1, 2], [104, 0, 6],
          [112, 5, 2], [114, 4, 2], [116, 1, 2], [118, 0, 2], [120, 0, 8],
        ], opts: { cut: 1300, wave: 'square' } },
        // ...and the answer from thirty floors up, resolving nothing
        { k: 'seq', voice: 'glass', oct: 3, gain: 0.041, notes: [
          [24, 6, 8], [56, 5, 8], [88, 1, 10], [118, 0, 10],
        ] },
        { k: 'sparse', voice: 'static', gain: 0.029, bars: [3, 7], step: 12, dur: 0.35 },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 1, 1, 6, 5],
      drones: [{ semi: 1, gain: 0.045, cutoff: 190, sweep: 0.13 },
        { semi: 0, gain: 0.028, cutoff: 150, sweep: 0.07 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.042, every: 1, tones: [0, 1, 4],
          opts: { tremolo: 8.4, bright: 1.5 } },
        { k: 'bass', voice: 'reese', oct: -1, gain: 0.122, dur: 0.14,
          pat: 'x.x.xxx.x.x.x.xx' },
        { k: 'perc', gain: 0.104, kick: 'x..xx...x...x.x.', snare: '....x.......x.x.',
          hat: 'xxxxxxxxxxxxxxxx', clank: '....x.......x...' },
        { k: 'perc', kind: 'heart', gain: 0.12, at: [0, 8] },
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.042, notes: [
          [0, 1, 2], [2, 0, 2], [4, 1, 4], [12, 4, 4],
          [32, 1, 2], [34, 0, 2], [36, 1, 4], [44, 5, 4],
          [64, 5, 2], [66, 4, 2], [68, 1, 4], [76, 0, 4],
          [96, 6, 2], [98, 5, 2], [100, 4, 4], [112, 1, 4], [120, 0, 8],
        ], opts: { cut: 2200 } },
      ],
    },
  },

  /* ================= ZONE 3 — HOLLOW PARK ===============================
   * Open ground under old trees. Almost no rhythm at all: a choir, a whistle
   * a long way off, and bells that arrive on nothing in particular. The most
   * exposed the score ever gets, for the most exposed ground on the map.  */
  park: {
    name: 'HOLLOW', bpm: 60, root: E1, scale: SCALES.minor, bars: 8,
    prog: [0, 0, 6, 6, 4, 4, 3, 3],
    calm: {
      drones: [{ semi: 0, gain: 0.030, cutoff: 110, sweep: 0.04 }],
      layers: [
        { k: 'pad', voice: 'choir', oct: 2, gain: 0.040, every: 2, tones: [0, 2, 4] },
        { k: 'pad', voice: 'strings', oct: 0, gain: 0.028, every: 4, tones: [0, 4],
          opts: { bright: 0.6 } },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.100, dur: 3.4, pat: 'x...............' },
        { k: 'seq', voice: 'whistle', oct: 3, gain: 0.040, notes: [
          [10, 4, 10], [34, 2, 8], [66, 5, 10], [98, 4, 8], [116, 2, 12],
        ] },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.034, bars: [2, 6], step: 8, dur: 4.2 },
        { k: 'sparse', voice: 'swell', gain: 0.032, bars: [0, 4], step: 0, dur: 7.0,
          opts: { freq: 260, q: 0.5 } },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 6, 6, 5, 5],
      drones: [{ semi: 0, gain: 0.055, cutoff: 165, sweep: 0.06 },
        { semi: 6, gain: 0.028, cutoff: 210, sweep: 0.11 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.046, every: 1, tones: [0, 2, 4],
          opts: { tremolo: 5.8, bright: 1.2 } },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.100, dur: 0.9, pat: 'x...x...x...x...' },
        { k: 'perc', kind: 'heart', gain: 0.14, at: [0, 8] },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.052, bars: [0, 2, 4, 6], step: 0, dur: 3.0 },
        { k: 'perc', gain: 0.07, snare: '............x...', hat: '....x.......x...' },
      ],
    },
  },

  /* ================= ZONE 4 — SOUTHSIDE INDUSTRIAL ======================
   * A plant that never got shut down properly. The percussion is not a drum
   * kit, it is the building: struck scrap on the off-beats over a pumping
   * sub. Pentatonic, so nothing in it ever resolves.                     */
  industrial: {
    name: 'FOUNDRY', bpm: 96, root: D1, scale: SCALES.pent, bars: 8,
    prog: [0, 0, 0, 0, 3, 3, 2, 2],
    calm: {
      drones: [{ semi: 0, gain: 0.042, cutoff: 125, sweep: 0.16 }],
      layers: [
        { k: 'bass', voice: 'sub', oct: 1, gain: 0.130, dur: 0.42,
          pat: 'x...x...x...x.x.' },
        { k: 'perc', gain: 0.070, clank: '....x.......x...', hat: '..x...x...x...x.' },
        { k: 'perc', gain: 0.085, kick: 'x.......x.......' },
        { k: 'pad', voice: 'strings', oct: 2, gain: 0.026, every: 4, tones: [0, 3],
          opts: { bright: 1.4 } },
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.030, notes: [
          [56, 2, 4], [60, 1, 4], [120, 3, 6],
        ], opts: { cut: 1100, wave: 'square' } },
        { k: 'sparse', voice: 'static', gain: 0.030, bars: [1, 5], step: 6, dur: 0.6 },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 3, 3, 2, 2],
      drones: [{ semi: 0, gain: 0.052, cutoff: 175, sweep: 0.22 },
        { semi: 1, gain: 0.024, cutoff: 240, sweep: 0.3 }],
      layers: [
        { k: 'bass', voice: 'reese', oct: 1, gain: 0.125, dur: 0.26,
          pat: 'x.x.x.x.x.x.xxx.' },
        { k: 'perc', gain: 0.100, kick: 'x...x...x...x...', snare: '....x.......x...',
          clank: '..x...x...x...x.', hat: 'xxxxxxxxxxxxxxxx' },
        { k: 'perc', kind: 'heart', gain: 0.12, at: [0, 8] },
        { k: 'pad', voice: 'strings', oct: 2, gain: 0.038, every: 1, tones: [0, 1, 3],
          opts: { tremolo: 9, bright: 1.6 } },
        { k: 'seq', voice: 'lead', oct: 3, gain: 0.036, notes: [
          [24, 3, 2], [26, 2, 2], [88, 3, 2], [90, 4, 4], [124, 0, 4],
        ], opts: { cut: 2600 } },
      ],
    },
  },

  /* ================= ZONE 5 — CHAPEL RIDGE =============================
   * The last district, and the only one the town built to be looked up at.
   * Harmonic minor on an organ, a choir behind it, and a bell on the downbeat
   * of every phrase. No drums anywhere in the calm arrangement — the bell IS
   * the pulse.                                                            */
  chapel: {
    name: 'RIDGE', bpm: 54, root: A1, scale: SCALES.harmonic, bars: 8,
    prog: [0, 0, 3, 3, 4, 4, 0, 0],
    calm: {
      layers: [
        { k: 'pad', voice: 'organ', oct: 1, gain: 0.050, every: 2, tones: [0, 2, 4],
          opts: { drawbars: [1, 0.5, 0.3, 0.18, 0.1, 0.05] } },
        { k: 'pad', voice: 'choir', oct: 2, gain: 0.038, every: 4, tones: [0, 4] },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.115, dur: 3.6, pat: 'x...............' },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.048, bars: [0, 2, 4, 6], step: 0, dur: 4.4 },
        { k: 'seq', voice: 'glass', oct: 3, gain: 0.040, notes: [
          [16, 6, 6], [24, 4, 6], [48, 4, 6], [56, 2, 8],
          [80, 6, 6], [88, 7, 8], [112, 4, 6], [120, 0, 10],
        ] },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 4, 4, 1, 0],
      drones: [{ semi: 0, gain: 0.050, cutoff: 140, sweep: 0.05 },
        { semi: 6, gain: 0.030, cutoff: 200, sweep: 0.08 }],
      layers: [
        { k: 'pad', voice: 'organ', oct: 1, gain: 0.052, every: 1, tones: [0, 1, 4],
          opts: { drawbars: [1, 0.6, 0.42, 0.3, 0.2, 0.14] } },
        { k: 'pad', voice: 'choir', oct: 2, gain: 0.036, every: 2, tones: [0, 2, 6] },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.110, dur: 0.8, pat: 'x...x...x...x...' },
        { k: 'sparse', voice: 'bell', oct: 1, gain: 0.070, bars: [0, 1, 2, 3, 4, 5, 6, 7], step: 0, dur: 3.0 },
        { k: 'perc', kind: 'heart', gain: 0.13, at: [0, 8] },
      ],
    },
  },

  /* ================= DEATH ==============================================
   * Four bars, and they are not going anywhere. A tolled bell, a sub that
   * arrives late, and a choir that is only just there. Short on purpose: the
   * player is looking at their own numbers and does not need a symphony.  */
  death: {
    name: 'TALLY', bpm: 48, root: A1, scale: SCALES.phrygian, bars: 4,
    prog: [0, 0, 1, 0],
    calm: {
      drones: [{ semi: -12, gain: 0.055, cutoff: 100, sweep: 0.03 }],
      layers: [
        { k: 'pad', voice: 'choir', oct: 1, gain: 0.044, every: 2, tones: [0, 2] },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.120, dur: 4.4, pat: 'x...............' },
        { k: 'sparse', voice: 'bell', oct: 1, gain: 0.060, bars: [0, 2], step: 0, dur: 5.0 },
        { k: 'sparse', voice: 'static', gain: 0.034, bars: [1, 3], step: 10, dur: 0.7 },
      ],
    },
    danger: {
      drones: [{ semi: -12, gain: 0.06, cutoff: 90, sweep: 0.03 },
        { semi: 1, gain: 0.026, cutoff: 160, sweep: 0.07 }],
      layers: [
        { k: 'pad', voice: 'choir', oct: 1, gain: 0.046, every: 1, tones: [0, 1] },
        { k: 'sparse', voice: 'bell', oct: 1, gain: 0.062, bars: [0, 1, 2, 3], step: 0, dur: 4.0 },
      ],
    },
  },

  /* ================= VICTORY ============================================
   * Two hundred and fifty thousand. The only major-key music in the game, and
   * it is still played on the same organ in the same empty town.          */
  victory: {
    name: 'THE COUNT', bpm: 72, root: C2, scale: SCALES.major, bars: 8,
    prog: [0, 3, 4, 0, 5, 3, 4, 0],
    calm: {
      layers: [
        { k: 'pad', voice: 'organ', oct: 0, gain: 0.050, every: 1, tones: [0, 2, 4] },
        { k: 'pad', voice: 'choir', oct: 1, gain: 0.038, every: 2, tones: [0, 4] },
        { k: 'bass', voice: 'sub', oct: -1, gain: 0.120, dur: 1.4, pat: 'x.......5.......' },
        { k: 'arp', voice: 'glass', oct: 3, gain: 0.044, rate: 2, order: 'up', dur: 0.4, span: 2 },
        { k: 'perc', gain: 0.055, hat: '....x.......x...', kick: 'x.......x.......' },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.045, bars: [0, 4], step: 0, dur: 4.0 },
      ],
    },
    danger: {
      layers: [
        { k: 'pad', voice: 'organ', oct: 0, gain: 0.048, every: 1, tones: [0, 2, 4] },
        { k: 'bass', voice: 'sub', oct: -1, gain: 0.11, dur: 1.4, pat: 'x.......5.......' },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.05, bars: [0, 2, 4, 6], step: 0, dur: 3.4 },
      ],
    },
  },
};

/** Which track a district plays. Index is the zone id (see world/Zones.js). */
export const ZONE_TRACKS = ['oldtown', 'eastgate', 'downtown', 'park', 'industrial', 'chapel'];
