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
   * Home. The one piece of ground in the game that is yours, and the score
   * treats it as a place worth defending rather than as a threat: a slow
   * string chorale over a walking sub, with a music box picking out a lullaby
   * nobody is left to sing. The clock tower's bell tolls on the phrase.  */
  oldtown: {
    name: 'HOLD THE LINE', bpm: 74, root: A1, scale: SCALES.minor, bars: 8,
    prog: [0, 0, 5, 5, 3, 3, 4, 4],
    calm: {
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.046, every: 2, tones: [0, 2, 4] },
        { k: 'pad', voice: 'strings', oct: 0, gain: 0.030, every: 2, tones: [0, 4],
          opts: { bright: 0.7 } },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.125, dur: 1.1,
          pat: 'x.......5.......' },
        { k: 'seq', voice: 'glass', oct: 3, gain: 0.052, notes: [
          [0, 0, 4], [4, 2, 4], [8, 4, 6], [16, 2, 4], [20, 0, 8],
          [32, 4, 4], [36, 5, 4], [40, 4, 6], [48, 2, 8],
          [64, 2, 4], [68, 4, 4], [72, 5, 6], [80, 4, 8],
          [96, 4, 4], [100, 2, 4], [104, 0, 10], [120, -3, 8],
        ] },
        { k: 'perc', gain: 0.055, hat: '....x.......x...', open: '................' },
        { k: 'sparse', voice: 'bell', oct: 2, gain: 0.038, bars: [0, 4], step: 0, dur: 3.6 },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 6, 6, 4, 4],
      drones: [{ semi: 0, gain: 0.05, cutoff: 150, sweep: 0.07 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.050, every: 1, tones: [0, 2, 4],
          opts: { tremolo: 6.5, bright: 1.35 } },
        { k: 'pad', voice: 'choir', oct: 2, gain: 0.026, every: 2, tones: [0, 1] },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.115, dur: 0.5,
          pat: 'x.x.x.x.x.x.x.x.' },
        { k: 'perc', gain: 0.10, kick: 'x.......x.......', snare: '....x.......x...',
          hat: 'x.x.x.x.x.x.x.x.' },
        { k: 'perc', kind: 'heart', gain: 0.13, at: [0, 8], },
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.040, notes: [
          [24, 4, 4], [28, 3, 4], [56, 4, 4], [60, 5, 6],
          [88, 4, 4], [92, 3, 4], [120, 1, 8],
        ], opts: { cut: 1500 } },
      ],
    },
  },

  /* ================= ZONE 1 — EASTGATE RESIDENTIAL =======================
   * Somebody's street. Warmer than anything else in the game — a dorian
   * guitar figure, a whistle over it, wind through the gardens — and the
   * warmth is exactly what makes it sad. This is the track that has to stay
   * out of the way the longest, so it is the quietest of the six.        */
  eastgate: {
    name: 'PORCH LIGHT', bpm: 66, root: G1, scale: SCALES.dorian, bars: 8,
    prog: [0, 0, 3, 3, 5, 5, 6, 4],
    calm: {
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.040, every: 2, tones: [0, 2, 4],
          opts: { bright: 0.85 } },
        { k: 'bass', voice: 'sub', oct: 0, gain: 0.115, dur: 1.4,
          pat: 'x.......o.......' },
        { k: 'arp', voice: 'pluck', oct: 2, gain: 0.042, rate: 2, order: 'updown',
          dur: 0.42, span: 2, opts: { bright: 0.8 } },
        { k: 'seq', voice: 'whistle', oct: 3, gain: 0.036, notes: [
          [8, 4, 8], [24, 2, 6], [40, 5, 8], [56, 4, 6],
          [72, 2, 8], [88, 0, 6], [104, 2, 8], [118, 4, 10],
        ] },
        { k: 'sparse', voice: 'swell', gain: 0.030, bars: [1, 5], step: 0, dur: 6.0,
          opts: { freq: 420, q: 0.6 } },
        { k: 'perc', gain: 0.040, hat: '........x.......' },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 6, 6, 5, 4],
      drones: [{ semi: -12, gain: 0.06, cutoff: 140, sweep: 0.09 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.048, every: 1, tones: [0, 2, 4],
          opts: { tremolo: 7.2, bright: 1.3 } },
        { k: 'bass', voice: 'reese', oct: 0, gain: 0.115, dur: 0.42,
          pat: 'x.x.x.x.x.x.x.x.' },
        { k: 'perc', gain: 0.095, kick: 'x.....x.x.......', snare: '....x.......x...',
          hat: 'x.x.x.x.x.x.x.x.' },
        { k: 'perc', kind: 'heart', gain: 0.13, at: [0, 8] },
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.038, notes: [
          [16, 5, 6], [48, 4, 6], [80, 5, 6], [112, 6, 10],
        ], opts: { cut: 1700 } },
      ],
    },
  },

  /* ================= ZONE 2 — DOWNTOWN ==================================
   * Height, glass, and nothing living in any of it. Phrygian, faster, and
   * built on a pulse rather than a phrase — the first track in the game with
   * a beat you could walk to, because Downtown is the first district that
   * makes you keep moving.                                               */
  downtown: {
    name: 'GLASS AND CONCRETE', bpm: 88, root: C2, scale: SCALES.phrygian, bars: 8,
    prog: [0, 0, 1, 1, 0, 0, 6, 5],
    calm: {
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.038, every: 2, tones: [0, 2, 4],
          opts: { bright: 1.25 } },
        { k: 'bass', voice: 'sub', oct: -1, gain: 0.130, dur: 0.7,
          pat: 'x.....x...x.....' },
        { k: 'perc', gain: 0.075, kick: 'x.......x.......', hat: '..x...x...x...x.',
          open: '............x...' },
        { k: 'seq', voice: 'lead', oct: 1, gain: 0.036, notes: [
          [12, 0, 3], [15, 0, 2], [44, 1, 3], [47, 0, 2],
          [76, 0, 3], [79, -2, 2], [108, 1, 4], [124, 0, 4],
        ], opts: { cut: 1300, wave: 'square' } },
        { k: 'sparse', voice: 'static', gain: 0.026, bars: [3, 7], step: 12, dur: 0.35 },
      ],
    },
    danger: {
      prog: [0, 0, 1, 1, 1, 1, 6, 5],
      drones: [{ semi: 1, gain: 0.045, cutoff: 190, sweep: 0.13 }],
      layers: [
        { k: 'pad', voice: 'strings', oct: 1, gain: 0.044, every: 1, tones: [0, 1, 4],
          opts: { tremolo: 8.4, bright: 1.5 } },
        { k: 'bass', voice: 'reese', oct: -1, gain: 0.125, dur: 0.3,
          pat: 'x.x.x.xxx.x.x.x.' },
        { k: 'perc', gain: 0.105, kick: 'x...x...x...x...', snare: '....x.......x.x.',
          hat: 'xxxxxxxxxxxxxxxx' },
        { k: 'perc', kind: 'heart', gain: 0.12, at: [0, 8] },
        { k: 'seq', voice: 'lead', oct: 2, gain: 0.042, notes: [
          [28, 1, 2], [30, 0, 2], [60, 1, 2], [62, 0, 2],
          [92, 4, 4], [124, 1, 4],
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
