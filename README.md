# Go Back To The Sandbox — 250,000

A complete first-person zombie survival game in the browser, inspired by
Left 4 Dead's invasion mode with a 2003 Half-Life / early-PS1 retro
aesthetic. There is exactly one way to win: **kill 250,000 zombies.**

Boot runs through an animated loading screen (a Hilbert-curve "texture
memory map" walked in step with real asset progress) into a CS-1.6-style
title menu rendered over a live cinematic orbit of the town, with NEW GAME /
RESUME LAST SESSION / SETTINGS and a LAST SESSION stats card. The pause menu
carries the run's readouts as a full instrument panel, plus a working SAVE RUN
button.

Built on a vendored Three.js (no build step, no network dependencies): all
surface textures are generated pixel art, all audio is synthesized with
WebAudio, and all entities are billboarded sprites over standard textured
polygon geometry.

## Running

Use the bundled dev server (zero dependencies, Node only):

```
node scripts/serve.mjs        # http://localhost:8000/  (or: node scripts/serve.mjs 9000)
```

It serves the repo with `Cache-Control: no-store`, so **every reload re-fetches
from disk** — edit a texture in `assets/`, reload, and the change shows up
immediately.

The dev server also persists sessions: `GET/POST /api/session` stores the
last saved run in `save/last_session.json` (gitignored), which feeds the
title screen's LAST SESSION card and its RESUME LAST SESSION entry. On a
plain static host the game falls back to localStorage for the same feature.

Any static file server also works (`python3 -m http.server 8000`), but note the
catch: those servers let the browser cache images and JS modules
heuristically, so an edited texture can keep showing the **stale cached copy**
even after you restart the server. The loader cache-busts image URLs to work
around this (`src/rendering/assetUrl.js`), but if the browser also cached the
old JavaScript you may need one hard reload (Ctrl/Cmd-Shift-R) the first time —
or just use `scripts/serve.mjs`, which sidesteps caching entirely.

(ES modules require http://, so opening index.html from disk won't work.)

### Windows desktop app (launcher)

For a native, no-browser experience there is a **Windows launcher** in
[`launcher/`](launcher/) — a Minecraft/Unity-style startup window with a PLAY
button that boots the game into its own **isolated, fullscreen** window. It
wraps the game in Electron, so it bundles its own Chromium and Node and runs on
a **fresh Windows install with no prerequisites**; it never touches the user's
browser. Loading is covered by an in-theme **harmonograph** animation (coupled
damped oscillators), saves land in the per-user data folder, and the in-game
**EXIT GAME** button closes every process cleanly. It can be launched directly
or added to Steam as a non-Steam game (`--game` boots straight into play).

```
cd launcher
npm install && npm start     # run from source
npm run dist:win             # build the Windows installer + portable .exe
```

See [`launcher/README.md`](launcher/README.md) for the full build and Steam
setup. The browser build above is unaffected — the only game-side additions
(`src/engine/Shell.js` and the desktop-only EXIT GAME entries) are inert without
the desktop shell.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look / primary fire (LMB) |
| RMB | Secondary fire (per weapon — see Arsenal) |
| Shift | Sprint |
| Ctrl / C | Crouch |
| Space | Jump |
| 1–6 | Pistol / Shotgun / Assault Rifle / Sniper / Bat / Alien Blaster (once found) |
| Mouse wheel | Cycle weapons (also reveals the weapon menu) |
| R | Reload |
| E | Interact |
| Esc | Pause / resume — or, at an arcade cabinet, step away from the machine |
| ` / ~ | Dev console |

The weapon menu is hidden during play; a number key or a mouse-wheel scroll
fades it in at the top of the screen, and it fades back out after a couple of
seconds (or the instant you fire).

**Pausing always gives the mouse back.** Resuming asks the browser for the
pointer, and a browser refuses that request outright for about a second after
the *user* pressed Escape to leave a lock — which is the situation every resume
is in, because Escape is how you paused. Asked once and refused, the game used
to un-pause into a state with no mouse look, no cursor and no key that did
anything about it, since Escape only ever paused by dropping a lock there was
no longer any of. The request is a standing intent now: `src/engine/Input.js`
keeps asking a few times a second until it lands, and retries on the spot
whenever the player presses or clicks anything. Escape closes the pause screen
as well as opening it, pausing cancels any outstanding request (so the retry
cannot reach around the menu and take the pointer back under it), and while a
request is outstanding the game says so on screen rather than looking hung.

**Mouse look filters the pointer-lock plumbing out of your aim.** A locked
mousemove does not always carry your hand: the browser reports the cursor's
old position as a movement delta every time lock is acquired (which happens on
every click, unpause and alt-tab back), and Chromium intermittently reports a
delta computed against a stale screen coordinate. Both used to be added
straight onto the camera, which is what made the view snap at random as though
the mouse had been slammed across the desk. `src/engine/Input.js` now ignores
motion for a moment after taking the pointer and refuses any single event that
is both large and wildly out of scale with how fast the mouse has genuinely
been moving — so a hard flick escalates the threshold and keeps working while
an isolated jump never reaches your aim.

## Arsenal

Every weapon is a fully 3D, PBR-textured model with a steampunk / Bioshock
finish — brass, blued gunsteel, cast iron, copper, oiled walnut, cracked
leather, and on the machine pistol matte phosphate under chipped caution
banding — each a novel take on its type with a **working action**. The one
exception is deliberate: the alien blaster is seamless polished alloy with no
fastener anywhere on it, because nobody in this town made it. All are
animated with an idle sway, a three-phase fire recoil, extensive part motion
(slides, hammers, bolts, cranes, ratcheting drums), a full reload
choreography, equip/unequip transitions, and **ejected brass** (cases, spent
shells, dropped magazines, en-bloc clips thrown from the real ejection port).
They sit rotated to face mostly forward — muzzle near the crosshair — while
still showing their worked left flank. Each has its own layered synthesised
firing sound and a distinct right-mouse secondary action:

| Slot | Weapon | Action | Secondary (RMB) |
| --- | --- | --- | --- |
| 1 | Mainspring Auto (pistol) | industrial blowback machine pistol built to reference art — exposed coil mainspring wound round the barrel visibly compresses and rebounds as the bolt cycles, the open-flanked magazine empties round by round as you shoot, case + mag eject | **Hair-trigger** — rapid auto fire, less damage per round |
| 2 | Crane Coachgun (shotgun) | modern over-under that **breaks UPWARD** — barrels crane skyward, twin hulls eject over the shoulder, two fresh shells seat, action snaps home | **Both barrels** — twin blast, two shells, big knockback |
| 3 | Foundry Gun (rifle) | Lewis-pattern steam machine gun; flank pan drum ratchets a round per shot, charging handle reciprocates, live pressure valve, drum swap reload | **3-round burst** — tight grouping |
| 4 | Meridian Long Rifle (sniper) | precision **bolt-action** — full lift/draw/eject/close cycle each shot, glowing telescope reticle, rangefinder drum, en-bloc clip reload | **Scope** — telescopic zoom |
| 5 | Ironshod Slugger (melee) | ironclad club; swings alternate forehand / backhand horizontal cuts | **Heavy swing** — charged overhead slam, wider arc, more knockback |
| 6 | Alien Blaster (**locked**) | recovered artefact — blue energy bolts that punch through two bodies, no reserve and no reload; the cell refills itself, faster the emptier it is, and the emitter vanes spin up while it does. Not on the wheel until you find it — see the scarecrow | **Overcharge** — four cells at once, heavier bolt, deeper pierce |

## Dev console

Press `` ` `` (backtick / tilde) to drop the developer console. It owns the
keyboard while open and the game keeps running behind it. Commands:

| Command | Effect |
| --- | --- |
| `noclip` | Fly through all geometry — WASD to move, Space up, Ctrl down, Shift for fast |
| `god` | Toggle invulnerability |
| `heal [n]` | Restore health (default: full) |
| `give` | Fill every weapon's magazine and reserve |
| `tp <x> <z>` | Teleport to map coordinates (spawn is `0 20`) |
| `speed <mult>` | Movement speed multiplier (0.1–10) |
| `spawn <type> [n]` | Spawn `n` enemies near you (`walker`/`sprinter`/`tank`/`exploder`/`spitter`), or `citizen` for a captive in a random building — she ignores `n`, skips her 100-kill gate, and the console prints which building to `tp` to |
| `pos` | Print current position |
| `help` / `clear` | List commands / clear the log |

There is deliberately no command that touches the kill counter — the
250,000 win condition has no shortcuts, console included.

## The game

- **Win condition:** exactly 250,000 total kills, tracked by
  `src/systems/ScoreSystem.js`. Kills enter only through the real damage
  pipeline; the victory screen (time survived, accuracy, kills by type)
  fires the moment the counter reaches 250,000 — verified by an automated
  test at 249,999 vs 250,000.
- **NPC AI (sensory system + navigation):** a shared, modular
  perception→steering→behaviour stack in `src/ai/` any NPC composes.
  - `Senses` turns the world into readings: a facing basis (yaw 0 is +Z,
    right is that rotated −90° about Y, so forward really is forward and sides
    really are sides), a **360° obstacle ring** of probes reporting how far the
    agent could walk each way, target perception with detection range, a forward
    field-of-view cone and line of sight, **memory** of where a target was last
    actually seen, and hearing. Heavy work is throttled on a per-agent stagger.
  - `Steering` turns those readings into a direction. `contextSteer()` scores
    every direction on the ring — how much it points where you want to go, minus
    how blocked it is — and picks the winner. It **chooses** rather than summing
    repulsions, which is what lets an agent thread a doorway instead of being
    pushed back out of it, and resolve a dead end into the way back out.
  - `NavAgent` owns the whole route lifecycle: budgeted, throttled A*; waypoint
    following with string-pulling; doorways threaded exactly and only ticked off
    once the agent is genuinely through them; a committed walk-out through the
    nearest door when the grid has no answer; and lateral unwedging when a prop
    (a collision box the nav grid does not model) pins an agent against it.
  - `Behavior`/`Brain` is a priority arbiter: one scoring pass per tick,
    incumbent stickiness and a minimum dwell so switching never flickers, plus a
    shared blackboard behaviours can leave notes on.
  - **Doorways are declared, not inferred.** The nav grid's 2 m cells are wider
    than a 1.5 m door, so blocking each wall segment used to seal every opening
    and A* could never route in or out of a building. Buildings now register
    each door and interior partition gap as a **nav portal** (`NavGrid.addPortal`),
    carved through the wall line, pinned open against anything built later, and
    snapped to the real opening in reconstructed paths.
  - Faction **tags** and per-entity **flags** on the base `Entity` let targeting
    and opt-in behaviours attach without touching subclasses; the flag registry
    lives in `src/ai/Flags.js` and every flag defaults to inert.
- **Zombies:** Walkers (30 HP, 1 pt), Sprinters (15 HP, fast, 2 pts), Tanks
  (220 HP, 5 pts), each spawned at a slightly randomised size and given an
  individual weaving gait so a horde never marches in stamped straight columns.
  State machine: idle → wandering → alerted → chasing → attacking → dead. They
  have **global awareness of the player** (always know where you are, anywhere
  on the map) but must earn a clear line of sight to attack or beeline vs.
  pathfind their way to you — out of the house they spawned in, through its
  interior doorways and front door, and around the block. They also detect the
  **friendly NPC within a limited sight range** (with a forward cone and a close
  sixth-sense bubble), but the player always takes priority; losing sight of a
  friendly sends them to where it was last seen rather than erasing it. Gunshots
  emit noise the idle/wandering ones investigate. Opt-in flag: `cullBlindSeconds`
  (set to 30 by the game, `cull` in the dev console) removes any zombie that
  can't get an unobstructed line to the player for that long, so a straggler
  stuck behind geometry never stalls a wave. Deaths are graphic: a wide gib
  burst, an additive "digital" spark pop and a glitch-dissolve on the sprite,
  with a matching wet-crunch-plus-bitcrush death sound.
- **Exploder:** a Creeper-like suicide bomber built on the zombie stack, wearing
  a **CS:GO-styled retexture** — a masked, turban'd bomber in a green vest
  strapped with red charges — and standing **as tall as the other enemies**
  (heads level with the eye-level horde, navigating on a normal humanoid capsule
  so it doesn't snag on overhead geometry). Its sheet is the usual directional walk rows with the
  front-facing **aim/fire frames on the top row**, which it shows you as it primes.
  It chases like a Walker, but once it closes inside a few metres it **stops
  charging head-on and skirts to a flank**, spiralling up on your side; inside
  its trigger ring it **plants itself and cannot move while a quarter-second
  fuse burns**, flashing hot, then detonates. If you back out of range the fuse
  aborts and it takes a **1-second cooldown** before trying again. It **also
  explodes ~half a second into its death animation** when killed. The blast runs
  through the real damage pipeline — it hurts **you**, **chain-detonates other
  exploders** and can gib the surrounding horde — with a fireball, smoke plume,
  light pop, screen shake, a death sound *and* an explosion boom. It drops
  **sniper ammo, but only when the player kills it** (not when it self-detonates
  as an attack), moves only **slightly faster than your walk**, and starts
  appearing once you pass **120 kills** — with its **spawn share stepping up
  past 150 kills**.
- **Spitter:** a CS:GO-styled **dual-pistol ranged enemy** built on the zombie
  stack. Instead of closing to melee it **kites to hold a ranged standoff band
  (~16–26 ft back)** — back-pedalling when you crowd it, closing when you back off, and
  **circle-strafing** in between for organic movement — while walking a touch
  **slower than you**, so you can still run it down. Crucially it **never moves
  and shoots at once**: it plants itself, **pauses a quarter-second to aim**
  (raised-pistols pose), then fires. Each shot carries a few degrees of **spread**
  and is aimed where you *were* when the pause began, so **juking during the tell
  can dodge it** and not every shot lands. It reads a dedicated sheet with the
  usual directional walk rows plus a top row of front-facing **aim/fire poses**
  (it turns to face you to shoot), fires with its own **twin-pistol report** and a
  muzzle flash, takes the normal hit/blood/gib feedback, and starts appearing once
  you pass **100 kills** — with its **spawn share stepping up past 120 kills**.
- **Friendly NPC:** the survivor by the well runs the same stack — Flee ▸
  Regroup ▸ Wander ▸ Idle behaviours arbitrated by her Senses. She flees any
  zombie that has actually noticed her, runs from the group of them rather than
  just the nearest (so two converging zombies push her out sideways instead of
  between them) and picks the most open heading so she does not sprint into a
  dead end. When the danger passes she makes her own way back to the square —
  routed through the navigator, so she can find her way out of a building — and
  settles into roaming and idling again. Her flee band is tied to the hunting
  zombie's **own** sight range, read off that zombie's config: she bolts at ~70%
  of the range that type detects friendlies at (35 m for a Walker, 42 m for a
  Sprinter), and keeps running until the nearest one is past 105% of it. Losing
  line of sight also ends the flight, so ducking round a corner is a real escape
  rather than a 50-metre sprint — but a zombie facing away still counts, because
  it is still coming. "Flee until out of sight" is literally correlated to
  zombie sight distance.
- **Savable citizen:** a captive woman tied up **inside a building**, and the
  one NPC you rescue rather than fight. **Wave 1 always has one, inside the
  district you spawn in** — a short walk rather than a search — and **wave 2
  always has one** anywhere unlocked: a scripted introduction to the mechanic,
  long before any kill gate. After that she **starts appearing once you pass
  100 kills**, with a **chance to show up on any wave**. She is always in a
  *random* enterable building in a district you have already unlocked, so past
  those opening two, both whether she appears and where she is hiding differ
  every playthrough (only one is ever out at a time — leave wave 1's tied up
  and wave 2 adds nobody). Walk up and an
  **[E] prompt** offers to free her: interacting swaps her from the captured
  sprite to the released one, **drops a health kit** at her feet, and sends her
  running for the street. She routes herself through the building's interior
  doorways and out its door, then keeps receding outdoors. **Five seconds after
  the rescue she despawns — but only while you cannot see her**, so you always
  get a few seconds of watching her run, and she never blinks out in view; keep
  her in sight and she just keeps going. Unlike every other entity here she does
  **not** snap to a new heading: she turns at a **capped rate** and her speed
  scales with how well she is facing where she wants to go, so rounding a
  doorway visibly slows her and straightens her out before she accelerates —
  a turning circle instead of a slide (a straight-line intent made her spin
  toward the exit and drift straight back off it in tight interiors). If a prop
  wedges her — a bench square between her and where she wants to go — she
  **sidesteps around it** rather than pressing into it, committing to one side
  for a beat so she rounds it instead of ping-ponging off it.
- **Cockroach:** an AI-test critter on the same stack. It skitters and wanders,
  **hides inside buildings by day**, **roams outdoors at night**, and **darts
  away from the player** — but only a very short distance before settling.
- **Sky & day/night:** a slow cycle colours the sky and fog, swings a sun and
  moon across the dome (the light warms by day and cools to moonlight at
  night), and drifts a handful of clouds overhead. The sun, moon and clouds are
  real low-poly, flat-shaded **3D geometry** (not sprites), depth-tested so the
  town's rooftops and walls correctly occlude them instead of bleeding through.
  `time <0-24>` in the dev console jumps the clock; the cockroach reads
  day/night from it.
- **Inventory (Tab):** a themed satchel for quest items such as keys. Opening
  frees the mouse for the UI and freezes the world; Tab (or Esc) closes it and
  hands the mouse straight back to the game.
- **HUD & stats:** a centred **Fallout-style console bar** — a mounted,
  screw-fixed, near-black scratched gunmetal panel (procedurally textured, the
  same hard-worn housing as the side devices) carrying two banks of glowing
  **VACUUM TUBES** — on the left, VITALS (the condition readout as a heater
  glow: steady when healthy, guttering when hurt, strobing red at critical,
  surging on damage) and CHARGE (the loaded magazine as stored glow, visibly
  re-charging across a reload); on the right, XMIT (blips hot on every shot)
  and WAVE (a smoked trefoil-decal tube that rages during a wave and blinks
  through a respite) — plus a green CRT message log with a phosphor refresh
  sweep, a mechanical HP odometer, **two separate ammo odometers — LOADED (in
  the gun) and RESERVE (carried)** whose wheels tick as they roll, a damage
  alarm lamp and a MAP lamp, a centre **player portrait** on a green CRT
  monitor, an AIM ON/OFF indicator (lit while scoped), a WEAPON panel (an
  illustrated two-tone profile of the live weapon over a scanning screen with
  a reload charge line), and a six-slot ARMS armoury grid with per-weapon
  reserves. The portrait is driven by health — a well-spaced
  forward/left/right **look-around idle above 50% HP**, a stern face at ≤50%,
  a drained face at ≤25% (the CRT tints green → amber → red to match). Flanking
  it sit two **field-device side HUDs** — scratched near-black gunmetal
  housings with corner screws, coloured **bar meters**, round **icon lamps**
  and an aged-ivory **analog needle gauge** behind glass. The left unit is the
  **WAVE** device: the needle and red bar sweep with kills banked toward the
  wave's quota (CLEARED x/y under the dial), the blue bar drains with the
  respite countdown, the teal bar tracks secrets found, the lamps flag
  calm / incoming (blinking through each respite) / combat, a green supply
  chip lights while supplies are inbound, and the zone rides an etched
  nameplate. The right unit is the **CONFIRMED KILLS** tally: a six-digit
  mechanical odometer, the needle and teal bar sweeping toward 250,000, a red
  bar through the current 1,000, a blue accuracy bar, lamps that blip on each
  kill and flash at every 1,000-kill milestone, and a REMAINING nameplate. Run
  stats live on the **pause screen**, not on the HUD.
- **The arcade works.** Four cabinets in the Downtown arcade, and each one is
  a MACHINE rather than a coloured box: **BRICKFALL**, **VERMIN**, **SIEGE**
  and **RALLY**, each with its own marquee, its own palette, and a screen
  showing a real frame of its own game so a cabinet across the room is
  recognisably the one you played. Walk up and press [E] and you are playing
  it, on a 320x240 tube in a gunmetal cabinet with its own scanlines. The town
  is HELD while you play — the world clock does not advance, so nothing on the
  street can reach you at the machine — and **Escape steps away from the
  cabinet straight back into the street**, never into the pause menu. Clearing
  a machine for the first time leaves something in the coin tray.
- **The pause screen is the same case, opened on the bench.** Seven readouts
  and seven DIFFERENT instruments, because a panel of identical rings makes
  you read every one of them from scratch every time — health is a **graduated
  fluid cell** with a red band at the quarter mark, the wave is a **bank of
  vacuum tubes** lighting as the quota clears (and idling in a slow chase
  through each respite), accuracy is the same **ivory needle gauge** the dock
  carries, kills run on **punched paper tape** under a mechanical odometer,
  secrets are **one lamp per secret**, score is an odometer that rolls up to
  the number, and time is a **split-flap board**. It powers on rather than
  appearing: the case flashes up, the bays come in one by one, the needle
  sweeps and overshoots, the cell fills, the tape's read head seeks the count,
  the lamps light in sequence and the flaps drop. Hovering an instrument lifts
  it and gives up a second readout it otherwise keeps back. Each of the four
  actions has its own mechanism — RESUME wipes green across, SAVE RUN runs
  punched tape over its face, SETTINGS turns a driver slot, QUIT lifts hazard
  stripes — and the row can be walked with the arrow keys.
- **The NOTICE readout:** messages the world sends you — a district opening,
  a secret giving something up, a thing you touched answering back — arrive on
  their own instrument in the **top-right corner**, deliberately out of the
  sight line rather than captioned across the middle of the screen. It is
  built from the console bar's own parts (scratched gunmetal chassis, corner
  screws, a stencil TRANSMISSION header with a live lamp, a green CRT inset
  behind scanlines and a phosphor sweep) so a message reads as a device on the
  rig doing something. Nothing about it just appears: the tube **strikes** —
  a bright line that opens out to full height — the text **teletypes** in
  under a blinking block cursor, the carrier bars run, and an amber
  **depletion bar** drains for the full **ten seconds** the message holds,
  going red for the last quarter. When the time is up the tube **collapses
  back to a line and dies**. A second message replaces the first and restrikes:
  this is one readout, not a stack. Every message also lands in the console
  bar's permanent CRT log, so nothing is lost if you were looking elsewhere.
- **Waves:** **kill-driven** escalating hordes. Each wave sets a kill quota and
  clears the moment you hit it, so racking up kills is what advances the wave;
  then a short respite with a supply drop before the next, larger wave. Past
  **250 kills** the horde "heats up" — faster spawns, bigger waves and a higher
  active cap — ramping over the waves that follow without overflowing, and past
  **~400 kills** a second, steeper **surge** on the overall spawn rate kicks in
  (shorter spawn interval, fatter batches, higher concurrent cap) so the field
  thickens tangibly deeper into a run. Sprinter/tank share rises with wave
  number and progress toward 250,000,
  spitters join the table once you clear 100 kills (their share stepping up
  past 120), and exploders once you clear 120 kills (their share stepping up
  past 150). **Wave 3 is the Exploder's wave and nothing else's** — one
  scripted round where the whole field is bombers, so you meet the type
  properly instead of first learning what one is by standing next to it. It is
  the only wave that overrides the mix; wave 4 picks the ordinary progression
  back up exactly where it left off.
- **Checkpoints & death:** the run is checkpointed every **tenth wave**. When
  you die, every zombie on the map is cleared and the run rolls back to the last
  checkpoint — kills, score and wave all restored — then that wave respawns from
  scratch (die at wave 45 → back to 40). The district barriers re-seal to match
  the rolled-back kill count, so any sections you'd opened stand again and must
  be re-earned.
- **Progression:** six districts unlock at kill milestones — Old Town
  (start), Eastgate Residential (50), Downtown (150), Hollow Park
  (2,500), Southside Industrial (4,500), Chapel Ridge (7,000). Barricades
  rumble and sink into the ground when a district opens; the world tells
  you, not a popup.
- **The ground is four grasses, not one.** A district mown for a century does
  not look like the ravine in Hollow Park, and neither looks like the flats
  past the last kerb — so the terrain carries a **kept lawn**, a **parched**
  one, **deep park growth** and **unmown meadow**, blended per fragment from a
  weight baked onto every vertex. The tiles themselves are drawn rather than
  noise-filled: a soil layer with the field thinning over it, then a few
  thousand short tapered strokes at unbiased angles, with clover, dead straw
  and seed heads per variant. Because the whole 640 m ground is one mesh, the
  boundaries have no seam to hide — the weights simply interpolate. Districts
  are composited as **soft rectangles** and the point they are read at is
  pushed around by a low-frequency wobble, so a planning rectangle never gets
  drawn on the ground in colour: the change happens somewhere in a field. Each
  vertex also carries a tone multiplier on a longer wavelength again, which is
  what stops one tile repeated a hundred times reading as one tile repeated a
  hundred times. The standing tufts follow the same regions, so a clump of
  parched straw never turns up in the middle of a park lawn.
- **Terrain:** a real heightfield — the chapel hill climbs 16 m, the park
  drops into a ravine, steep slopes slow you down. Roads, plazas and ground
  decals are **draped**: the waypoints are a road's shape, not its resolution,
  so every centreline is resampled at a metre and subdivided across its width,
  and it samples `meshHeightAt` — the *rendered* ground — rather than the
  analytic height function the ground mesh only approximates. The **pond** is a real
  basin: a terrain pad sunk into the ravine floor, with the water built as a
  sheet clipped to it — a quad is emitted only where all four corners are
  genuinely below the water line, so the shoreline follows the ground exactly
  and can never float. Its level is taken from the ground that *surrounds* the
  basin rather than from its own floor, which is the property that stops the
  surface reading as standing proud of the bank it meets. Two sheets drift
  across each other at different scales to give it movement.
- **The world barrier (`src/world/Boundary.js`):** the map is ringed by a
  terrain-following **stone rampart** — battered plinth, buttresses, a
  crenellated parapet, octagonal corner bastions, and a **bricked-up
  gatehouse** wherever a road runs out at it. This is *not* a district
  barrier: it never sinks and never opens, and it is deliberately the
  opposite of the white-marble district walls in every register (dark
  granite, mossed to the string course) because it reads as geography
  rather than as architecture.
- **Facade material sets (`src/world/Materials.js`):** no building is given a
  bare wall texture. It is given a **set** — wall, roof, door, window,
  foundation and trim chosen together, the way a real building's materials
  were. Brick gets a stone plinth and a stone belt course; clapboard gets
  painted timber trim and rubble footings; a curtain-walled tower gets steel
  channel and poured concrete. Twenty-five sets, and two passes guarantee **no
  two neighbours share one** — the second runs on the *resolved* wall texture,
  because weathering collapses distinct sets onto shared worn twins. Three of
  the sets are **residential only** (painted clapboard, split cedar shakes,
  dark clinker brick, with block skirting or porch lattice under them instead
  of a civic stone plinth), so a street of houses can never be dressed out of
  the commercial library.
- **Spatial weathering:** every set names a weathered twin of its wall and
  roof — moss to the sill line, paint flaking off grey timber, render blown
  off the brick, water staining under every joint — and they swap in as a
  squared distance falloff bites toward the map rim. The commercial core reads
  kept-up and the outskirts read abandoned with nothing hand-placed.
- **The city:** every district is filled with purpose. Downtown carries a
  real skyline — seven solid high-rises (up to 34 m) with rooftop water
  tanks, masts and blinking aviation beacons, plus the **Meridian Tower**,
  the one skyscraper you can enter: a furnished lobby with a reception
  desk, a dead elevator bank (the call button works; listen), and a
  maintenance room in the back. The east flats hold working farmland —
  crop-row fields, an orchard planted in ranks, and a windmill that turns
  without wind. Old Town keeps a market morning that never ended, and North
  Ave holds an abandoned checkpoint.
  The **z=-120 street wall** carries five enterable shops and a firehouse,
  with four **service alleys** between them feeding a lane behind the row —
  the flanking routes that make the grid worth learning. **Founders Square**
  breaks up the block grid with a bronze landmark visible from three streets,
  and the industrial water tower is painted so it can do the same job from the
  other end of town.
  Intact **parked cars are functional props**: shoot one and its alarm
  blinks and chirps — and every zombie in earshot converges on it instead
  of you. Cars, vans, pickups and buses are all built by one coachbuilder
  (`PropKit._vehicle`) — sills, wheel arches, raked screens, bumpers, grilles
  and lamps — and merged down to a handful of draw calls each.
  The **firehouse siren** and the **record-shop turntable** send the same
  noise signal a car alarm does: start one and leave down the alley behind it,
  and the block clears itself.
- **Eastgate Residential** is the town's neighbourhood, and it is planned as
  one rather than scattered. Two loops hang off Main St East with a **back
  lane** (Beckon Row), a **cul-de-sac** (Quarrow Close), two connectors and a
  west lane between them, and every lot exists because a street runs past it:
  **the door is always on the wall that street can see**, four to eight metres
  back behind a garden. Rows are paired across their gardens, so the ground
  between streets is private — fences, hedges, washing lines, sheds, and
  garages that open onto the back lane. Roofs are hipped or gabled with their
  **ridge parallel to the road they front** and pitched steeply (this knoll is
  the most exposed ground in town, and its roofs are built to drop a winter
  rather than hold it); dormers look out over the street, porches sit on the
  approach, and windows are laid out **bay by bay between the interior walls**,
  so no pane ever has a partition down the middle of it and every room has its
  own light. Beyond the houses: a **community hall** (the one clear span in the
  district, and the only Eastgate interior worth fighting a wave inside), a
  church with its graveyard, a corner shop, a filling station at the gate, a
  glasshouse still growing, a playground, and **Eastgate Green** — the open
  field inside the Wend Loop that nothing is ever planted on, kept clear so
  there is one place with sight lines the whole way across.
- **Nature runs through the streets, not beside them.** Trees force up through
  the pavement at the junctions and break the slabs around them; ivy climbs the
  north faces, which are the walls that never dry out; clipped hedges and
  picket runs mark the property lines; flower beds still bloom either side of
  every garden path; and the lots nobody ever built on have gone to **dense dry
  weed**, which is the best cover on the block. **All of it moves.** Trees,
  bushes, hedges, flowers and wall creepers sway object-by-object on the CPU
  with a standing lean downwind, and the merged ground cover — thousands of
  grass and weed blades in one draw call, where per-object rotation is off the
  table — bends in a **vertex-shader patch driven by one shared clock**, so the
  whole map leans together the way a field does, for one float a frame.
- **Hollow Park** is the one place in town that still moves: a **carousel**
  that turns (push it and it runs faster), a **flag** that ripples, a **rope
  swing** that keeps its arc, reeds along the pond margin, a jetty and a
  footbridge. Nothing is driving any of it. Its spawn points sit deliberately
  **behind cover** — each one gets a screen of undergrowth planted between it
  and the open ground you would approach from, so the first you know of a
  thing is the movement, not the spawn.
- **Wrongness (cosmic-horror layer, `src/world/Anomalies.js`):** the town
  whispers rather than screams. Shadows with no owners cast against the
  sun. A cottage whose interior is walled almost a metre inside its
  exterior. A freestanding door in the park grass that opens onto the same
  field. A phone booth that rings — always panned to the wrong side of the
  street — and lets you answer. Displaced ambience: drips over the open
  pond, a train the town has no tracks for, a toll from the visibly
  motionless chapel bell, knocking from inside the inner walls. One
  playground swing keeps moving; its twin hangs dead. Smoke stands over
  the cold factory stack. An opened grave on Chapel Ridge. In Eastgate: an
  upstairs television that plays whenever you are too far away to see into the
  room, in a town with no power; a front garden where every plant leans at the
  house; a row of mailboxes whose flags are all up; wind chimes that start
  again in your hand; a parish roll in one handwriting ending in your name.
  None of it breaks gameplay flow; all of it is slightly off.
- **Things that move because nobody is moving them.** A weather vane turning
  in still air, a pinwheel spinning, a lawn sprinkler sweeping with no water in
  it, a bicycle wheel still going round where it was dropped, washing on a line
  drifting the way the grass is not, a porch swing keeping its arc, a garden
  gate on the swing, a roof dish creeping round over minutes, and a paddling
  pool nobody has touched in a year whose surface will not hold still. Every
  one is registered in a single distance-culled registry and costs nothing
  until you are within ninety metres of it.
- **Surfaces that move with no moving part behind them.** Every dead
  television in town plays real static — a sixteen-frame flipbook baked into
  `tv_static.png` and stepped at twelve frames a second, roll band and all,
  with one frame in sixteen that is not static and is on screen for a twelfth
  of a second at a time. Arcade cabinets run their attract loops off three
  screen tubes handed out round-robin, each striking and dropping out on its
  own beat so a row of seven never blinks as one machine; their marquees are
  lit off the same tube, so a cabinet dying takes its own sign with it.
  Vending machines hold a fluorescent on its last few hundred hours. The
  campfire at the dead camp is still burning — three tiers on five and four
  sides, each flexing and turning on its own beat, with the light flexing
  with them. The phone booth's roof lamp comes up and its handset shakes
  while it rings, and both die the instant it stops, whether or not you
  answered. All of it lives in one material registry
  (`World._animateMat`) driven from `Anomalies.update`.
- **The scarecrow (`src/world/Scarecrow.js`):** an aware, animated set piece
  on the east farm. Textured from canvas sources — woven burlap sacking, a
  stitched cross-eyed face, tattered flannel plaid, straw wisps — it sways in
  a wind that isn't there, hung with rags that flutter on their own phases and
  a tin can turning on a string. Its head slowly turns to keep you in view, but
  **only while you are not looking at it**: meet its stitched eyes and it goes
  dead still, facing the field; look away and back and it has found you. Close
  in and two faint motes come up over the stitched eyes — never bright, never
  visible at range, and only while it has its face turned to yours. Get
  close and you can **set its head straight** (it resists, and creaks) or, if
  it faces the field, **touch its shoulder** and watch it turn, slowly, to
  you. A **crow** perches on one arm and scatters with a caw when you
  approach, drifting back once you have gone.
  - **Shoot the tin can** and it rings and spins off the hit. Nothing comes of
    it and nothing is supposed to.
  - **Shoot its hat off** and the head does the one thing it has spent the
    whole game refusing to do in front of you: it moves while you are
    watching, in a single step, with no creak. The hat lands in the dirt where
    you shot it. Walk far enough away that you cannot read the post any more,
    come back, and it is wearing the hat.
  - **Lay a hand on it three times** and it stops being about you. The head
    turns past you and holds, on a fixed bearing, at nothing you can see. Walk
    the bearing and there is a **crash site** out in the flats — a burnt scar
    with a trench ploughed into the near end of it, spoil thrown up either
    side, a thread of smoke still coming off it a year later, and a hull that
    went in edge-first with a tear down one flank and something lit still
    running behind it. Thrown clear of the tear is the **alien blaster**
    (weapon slot 6): blue energy bolts, no reserve and no reload, a cell that
    refills itself faster the emptier it gets. Nothing marks the site on the
    map. The scarecrow told you, and only if you kept touching it.
- **Companion Cube:** a findable Easter egg, built to the classic
  reference — pale chamfered corners, magenta seams, a pink heart plate on
  every face — waiting in a back room somewhere high-rise adjacent, throwing
  no light of its own. Take it; it stows in the satchel and stays with you.
- **Secrets:** fifteen of them, found by shooting, interacting, standing,
  looking, or killing exactly the right number. The mannequin is watching.
  Eastgate holds four: a **treehouse** you cannot see the deck of from the
  street, a **fallout shelter** under a garden shed stocked by somebody who
  knew, **three houses on the same kerb that are one house** (same paint, same
  plan, same fallen chair, same pinwheel in the same place — and you can only
  ever see two of them at once), and a **garden gnome** that is never in the
  garden you left it in and is always facing you when you find it again.

## Repository layout

```
assets/textures/    generated retro textures + sprites (power-of-two, tileable)
assets/sprites/     provided NPC/zombie sprite sheets (3x4 walk cycles)
lib/three.module.js vendored Three.js r169
scripts/            generate_textures.mjs — regenerates assets/textures/
src/engine/         game loop, input, event bus
src/ai/             NPC AI: senses (360° ring + memory), context steering,
                    shared navigator, behaviour arbiter, opt-in flag registry
src/entities/       player, zombies, exploder, spitter, NPC, savable citizen,
                    cockroach, pickups
src/weapons/        weapon configs + firing/ammo/hit resolution
src/rendering/      renderer, texture pipeline, billboards, HUD (console bar +
                    Portrait CRT + HudTextures), 3D weapon view + PBR weapon
                    materials, effects, the arcade cabinets and the four
                    machines in them (Arcade.js)
src/audio/          WebAudio synthesis (all sounds)
src/world/          terrain, buildings, props, vegetation, zones, nav, secrets,
                    anomalies (cosmic-horror layer + dynamic props and
                    surfaces), companion cube, scarecrow (aware animated set
                    piece, its easter-egg chain and the crash site), sky
src/systems/        score/win condition, waves, spawning, savable-citizen
                    director, game state, inventory
src/engine/Shell.js desktop-shell bridge (detects the Electron launcher)
launcher/           Windows desktop launcher (Electron): startup window,
                    harmonograph boot animation, isolated fullscreen game window
tests/              headless AI tests (ai.mjs), NPC behaviour tests against the
                    real world (npc-behavior.mjs), Playwright smoke test
                    (boot, combat, exact win condition)
```

## Extensibility

- **New weapon:** add a config object (stats + `alt` secondary fire) to
  `src/weapons/WeaponConfigs.js` and a 3D model rig to
  `src/weapons/WeaponModels.js` (built from primitives + the shared PBR
  materials in `WeaponMaterials.js`). WeaponView, the HUD menu and audio pick
  it up from the config.
- **New zombie type:** add a config to `src/entities/ZombieTypes.js`
  (stats + tint); the spawn director and HUD pick it up. For a distinct
  behaviour (like the Exploder or Spitter) subclass `Zombie` and register the
  class in the spawn director's constructor map — it inherits the shared Senses,
  steering, LOS, pathfinding and score/hit/death pipelines and only overrides
  what differs. A subclass on a differently-laid-out sprite sheet overrides
  `_makeBillboard` and declares its layout in `TextureConfig.js`.
- **New NPC / behaviour:** give the entity a `Senses` from `src/ai/` and a
  `Brain` composed of `Behavior`s (each scores itself from the sensory
  context; highest wins). Use `contextSteer` for movement, and add a `NavAgent`
  if it needs to cross the world rather than just mill about — that one line
  buys pathfinding, doorway traversal, exit hunting and stuck recovery. New
  behaviours slot into the arbiter without touching the others; new factions are
  just a tag; new opt-in switches are just a flag declared in `src/ai/Flags.js`.
  Anything built out of these pieces inherits the senses automatically: the
  Exploder's flank spiral and the Spitter's kiting are each one vector handed to
  the shared navigator, and they get obstacle steering and unwedging for free.
- **Reskin:** every texture path lives in
  `src/rendering/TextureConfig.js`; replace a PNG on disk (e.g. the brick
  wall) and every wall in the game changes. The loader cache-busts each asset
  URL per page load (`src/rendering/assetUrl.js`), so an edited PNG shows up on
  the next reload instead of being served stale from the browser cache. Any
  power-of-two size works — swap the 128×128 `grass.png` for a 512×512 one and
  it tiles seamlessly with no code changes. New white-background sprite sheets
  dropped into `assets/sprites/` are keyed automatically: an edge flood fill
  clears the backdrop while preserving interior whites, then the antialiased
  fringe it leaves is un-matted — the art these sheets are drawn on is white, so
  every silhouette texel is part white, and solving that blend back to the art's
  own colour is what keeps sprites from wearing a light halo.
- **Regenerate textures:** `node scripts/generate_textures.mjs`.

## Performance

Pooled particles (no GC spikes), shared materials with per-mesh UV frames,
distance-dormant AI, camera far plane at the fog wall for culling, merged
grass-tuft geometry, and a windowed A* with a per-frame path budget. Sensory
probing is throttled and staggered per agent, so a horde spreads its perception
cost across frames instead of spiking on one.
Renders at 0.75 internal scale with nearest-neighbour upscaling — chunky
and fast.

## Tests

```
node tests/ai.mjs                     # no browser needed

npm install playwright-core           # anywhere; NODE_PATH it if needed
node tests/world.mjs
node tests/npc-behavior.mjs
node tests/weapons.mjs
node tests/smoke.mjs [--screens]
```

`ai.mjs` builds a one-room house with a real 1.5 m doorway out of the same
collision boxes and nav blocks the building kit registers, and checks the
navigation primitives directly: that a declared doorway survives on the nav grid
where a wall-blocked one seals shut, that sensory directions line up with the
agent's facing, that steering threads a doorway and escapes a dead end, that the
navigator walks an agent out of the house, and that behaviour arbitration
switches promptly without thrashing.

`npc-behavior.mjs` boots the real game and drives `game.update(dt)` directly at
a fixed timestep instead of waiting on frames, so it runs the same simulation on
a software-rendered machine as on a fast one. It asserts the behaviour that
matters in the actual town: zombies spawned inside houses get out (through
interior partition gaps and the front door) and close on the player from either
side of the building, hunters prioritise the player and only fall back to a
friendly inside their detection envelope, the friendly's flee band tracks each
zombie type's own sight range with hysteresis and returns to ordinary behaviour
afterwards, the Exploder still fuses and the Spitter still kites and aims, and
`cullBlindSeconds` culls a permanently blind zombie when set and leaves it alone
when not.

`world.mjs` audits the built town for the structural mistakes that are
invisible in a code review and obvious the moment you walk into them: buildings
that hang over a slope or sink into one, footprints that overlap, anything
parked in a doorway or standing inside a building, two vehicles on the same
ground, neighbours sharing a wall texture, weathering that isn't actually
spatial, unfurnished interiors, alleys too narrow to path down, spawn points on
blocked ground, roads floating over or cutting into the ground (sampled inside
each triangle, since the vertices sit on the terrain by construction and only
the middle of a long span misbehaves), a pond floating over its own bed, and
gaps in the world barrier
— including walking the player hard into the wall from eight directions to
confirm it holds. It also **floods the nav grid from the spawn** and asserts
that no locked district is reachable on foot, which is the check that catches a
border wall stopping short of the map edge. Eastgate gets its own group: every
front door in the district has to have a **carriageway actually out in front of
it** (walk out from each threshold along its own normal and look), no building
may stand in one (sampled off the rendered road surface, because the bounding
box of a curving road is far fatter than the road), and the planting and props
have to be animated rather than merely present. The ground's own grass gets a
group: all four textures bound, no patch asking for more grass than exists,
districts that genuinely differ from one another, and — the one that matters —
a bound on how much the blend may change between neighbouring lattice cells,
which is what turns "there is a hard line across that field" from something
somebody has to notice into something the suite refuses. Anything that moves without a
moving part behind it is checked by driving the animator and watching the
material, not by counting registry entries — a screen that quietly stops
playing looks exactly like one that was never registered. The scarecrow's
easter-egg chain is walked end to end in the same pass: its hat is shot off,
dropped, landed and left until it goes back on by itself, and three touches
have to leave its head holding the bearing to a wreck that is really out there
with a weapon in it. It is what found the market
stall parked in a doorway, the house standing on top of the filling station,
the chapel's bell tower built over its own front door, the eight-metre slot you
could walk through from Eastgate into Downtown without earning it, and the
third of Eastgate's front doors that used to open onto open grass.

`smoke.mjs` drives the real game headless: boot without errors, movement, town
structure, wave spawning, ammo consumption, an end-to-end gunfire kill, zone
unlocks, and the exact-250,000 victory (no win at 249,999; stats screen at
250,000). It walks up to an arcade cabinet and plays it, which is three
claims at once: the town is HELD while the machine runs (world clock and
health both frozen, so nothing on the street can reach a player at a cabinet),
the machine itself is running, and Escape steps away from it into the STREET
rather than into the pause menu. It plays the reported pause/resume dead end
back at the game with the
harness's pointer-lock bypass switched OFF and the browser made to refuse the
first few requests — the one path that decides whether a player can carry on
playing was also the one path the suite never exercised, which is exactly how
it shipped broken. It also stages a run against known numbers and opens the
pause screen on it: every readout has to show the value it is supposed to be
showing, every bay has to be a different instrument, and every moving part has
to be a **running Animation** rather than a style that snapped to its end —
a panel that ends up correct without ever moving looks identical in a
screenshot and is not what was asked for. The four actions are hovered one at
a time and compared against each other, so a shared hover colour cannot pass
for four mechanisms. Its wave-spawn step waits on wall-clock time, so it needs a machine
that renders faster than software GL.
