# Go Back To The Sandbox — 250,000

A complete first-person zombie survival game in the browser, inspired by
Left 4 Dead's invasion mode with a 2003 Half-Life / early-PS1 retro
aesthetic. There is exactly one way to win: **kill 250,000 zombies.**

Boot runs through an animated loading screen (a Hilbert-curve "texture
memory map" walked in step with real asset progress) into a CS-1.6-style
title menu rendered over a live cinematic orbit of the town, with NEW GAME /
RESUME LAST SESSION / SETTINGS and a LAST SESSION stats card. The pause menu
carries the run's stat rings plus a working SAVE RUN button.

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
| 1–5 | Pistol / Shotgun / Assault Rifle / Sniper / Bat |
| Mouse wheel | Cycle weapons (also reveals the weapon menu) |
| R | Reload |
| E | Interact |
| Esc | Pause (releases pointer lock) |
| ` / ~ | Dev console |

The weapon menu is hidden during play; a number key or a mouse-wheel scroll
fades it in at the top of the screen, and it fades back out after a couple of
seconds (or the instant you fire).

## Arsenal

Every weapon is a fully 3D, PBR-textured model with a steampunk / Bioshock
finish — brass, blued gunsteel, cast iron, copper, oiled walnut and cracked
leather — each a novel take on its type with a **working action**. All are
animated with an idle sway, a three-phase fire recoil, extensive part motion
(slides, hammers, bolts, cranes, ratcheting drums), a full reload
choreography, equip/unequip transitions, and **ejected brass** (cases, spent
shells, dropped magazines, en-bloc clips thrown from the real ejection port).
They sit rotated to face mostly forward — muzzle near the crosshair — while
still showing their worked left flank. Each has its own layered synthesised
firing sound and a distinct right-mouse secondary action:

| Slot | Weapon | Action | Secondary (RMB) |
| --- | --- | --- | --- |
| 1 | Regent Autoloader (pistol) | short-recoil auto; slide racks, hammer re-cocks, case + mag eject | **Hair-trigger** — rapid auto fire, less damage per round |
| 2 | Crane Coachgun (shotgun) | modern over-under that **breaks UPWARD** — barrels crane skyward, twin hulls eject over the shoulder, two fresh shells seat, action snaps home | **Both barrels** — twin blast, two shells, big knockback |
| 3 | Foundry Gun (rifle) | Lewis-pattern steam machine gun; flank pan drum ratchets a round per shot, charging handle reciprocates, live pressure valve, drum swap reload | **3-round burst** — tight grouping |
| 4 | Meridian Long Rifle (sniper) | precision **bolt-action** — full lift/draw/eject/close cycle each shot, glowing telescope reticle, rangefinder drum, en-bloc clip reload | **Scope** — telescopic zoom |
| 5 | Ironshod Slugger (melee) | ironclad club; swings alternate forehand / backhand horizontal cuts | **Heavy swing** — charged overhead slam, wider arc, more knockback |

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
- **NPC AI (sensory system):** a shared, modular perception→behaviour stack in
  `src/ai/` any NPC composes. `Senses` turns the world into readings —
  direction-aware obstacle whiskers (so agents wander and escape spawn houses
  without grinding on walls), target perception with detection range, a
  forward field-of-view cone and line of sight. `Steering` blends seek/flee
  with those whiskers (avoidance rides under everything, which is where the
  emergent behaviour comes from). `Behavior` is a priority arbiter with
  anti-flicker hysteresis. Faction **tags** and per-entity **flags** on the
  base `Entity` let targeting and opt-in behaviours attach without touching
  subclasses.
- **Zombies:** Walkers (30 HP, 1 pt), Sprinters (15 HP, fast, 2 pts), Tanks
  (220 HP, 5 pts), each spawned at a slightly randomised size and given an
  individual weaving gait so a horde never marches in stamped straight columns.
  State machine: idle → wandering → alerted → chasing → attacking → dead. They
  have **global awareness of the player** (always know where you are, anywhere
  on the map) but must earn a clear line of sight to attack or beeline vs. A*
  pathfind out of a building. They also detect the **friendly NPC within a
  limited sight range**, but the player always takes priority. Gunshots emit
  noise the idle/wandering ones investigate. Opt-in flag: `cullBlindSeconds`
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
  Wander ▸ Idle behaviours arbitrated by her Senses. She flees any zombie that
  comes hunting and keeps running until it is out of sight, then returns to
  roaming near home. Her flee band is tied to the hunting zombie's own sight
  range (bolt at ~70% of it, safe past 100%), so "flee until out of sight" is
  literally correlated to zombie sight distance.
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
  stats — accuracy, score, secrets, progress, time — live on the **pause screen
  as circular gauges**, not on the HUD.
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
  past 150).
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
- **Terrain:** a real heightfield — the chapel hill climbs 16 m, the park
  drops into a ravine with a pond, steep slopes slow you down.
- **The city:** every district is filled with purpose. Downtown carries a
  real skyline — seven solid high-rises (up to 34 m) with rooftop water
  tanks, masts and blinking aviation beacons, plus the **Meridian Tower**,
  the one skyscraper you can enter: a furnished lobby with a reception
  desk, a dead elevator bank (the call button works; listen), and a
  maintenance room in the back. Eastgate gained a third wave of housing, a
  playground and mailbox rows; the east flats hold working farmland —
  crop-row fields, an orchard planted in ranks, and a windmill that turns
  without wind. Old Town keeps a market morning that never ended, and North
  Ave holds an abandoned checkpoint.
  Intact **parked cars are functional props**: shoot one and its alarm
  blinks and chirps — and every zombie in earshot converges on it instead
  of you.
- **Wrongness (cosmic-horror layer, `src/world/Anomalies.js`):** the town
  whispers rather than screams. Shadows with no owners cast against the
  sun. A cottage whose interior is walled almost a metre inside its
  exterior. A freestanding door in the park grass that opens onto the same
  field. A phone booth that rings — always panned to the wrong side of the
  street — and lets you answer. Displaced ambience: drips over the open
  pond, a train the town has no tracks for, a toll from the visibly
  motionless chapel bell, knocking from inside the inner walls. One
  playground swing keeps moving; its twin hangs dead. Smoke stands over
  the cold factory stack. An opened grave on Chapel Ridge. None of it
  breaks gameplay flow; all of it is slightly off.
- **The scarecrow (`src/world/Scarecrow.js`):** an aware, animated set piece
  on the east farm. Textured from canvas sources — woven burlap sacking, a
  stitched cross-eyed face, tattered flannel plaid, straw wisps — it sways in
  a wind that isn't there. Its head slowly turns to keep you in view, but
  **only while you are not looking at it**: meet its stitched eyes and it goes
  dead still, facing the field; look away and back and it has found you. Get
  close and you can **set its head straight** (it resists, and creaks) or, if
  it faces the field, **touch its shoulder** and watch it turn, slowly, to
  you. A **crow** perches on one arm and scatters with a caw when you
  approach, drifting back once you have gone.
- **Companion Cube:** a findable Easter egg, built to the classic
  reference — pale chamfered corners, magenta seams, a pink heart plate on
  every face — waiting under a faint pulse of light somewhere high-rise
  adjacent. Take it; it stows in the satchel and stays with you.
- **Secrets:** ten of them, found by shooting, interacting, standing,
  looking, or killing exactly the right number. The mannequin is watching.

## Repository layout

```
assets/textures/    generated retro textures + sprites (power-of-two, tileable)
assets/sprites/     provided NPC/zombie sprite sheets (3x4 walk cycles)
lib/three.module.js vendored Three.js r169
scripts/            generate_textures.mjs — regenerates assets/textures/
src/engine/         game loop, input, event bus
src/ai/             sensory system: senses, steering, behaviour arbiter
src/entities/       player, zombies, exploder, spitter, NPC, cockroach, pickups
src/weapons/        weapon configs + firing/ammo/hit resolution
src/rendering/      renderer, texture pipeline, billboards, HUD (console bar +
                    Portrait CRT + HudTextures), 3D weapon view + PBR weapon
                    materials, effects
src/audio/          WebAudio synthesis (all sounds)
src/world/          terrain, buildings, props, vegetation, zones, nav, secrets,
                    anomalies (cosmic-horror layer + dynamic props), companion
                    cube, scarecrow (aware animated set piece), sky
src/systems/        score/win condition, waves, spawning, game state, inventory
src/engine/Shell.js desktop-shell bridge (detects the Electron launcher)
launcher/           Windows desktop launcher (Electron): startup window,
                    harmonograph boot animation, isolated fullscreen game window
tests/              Playwright smoke test (boot, combat, exact win condition)
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
  context; highest wins). Reuse `seek`/`flee`/`avoidObstacles` for movement.
  New behaviours slot into the arbiter without touching the others; new
  factions are just a tag; new opt-in switches are just a flag.
- **Reskin:** every texture path lives in
  `src/rendering/TextureConfig.js`; replace a PNG on disk (e.g. the brick
  wall) and every wall in the game changes. The loader cache-busts each asset
  URL per page load (`src/rendering/assetUrl.js`), so an edited PNG shows up on
  the next reload instead of being served stale from the browser cache. Any
  power-of-two size works — swap the 128×128 `grass.png` for a 512×512 one and
  it tiles seamlessly with no code changes. New white-background sprite sheets
  dropped into `assets/sprites/` are keyed automatically (edge flood fill
  preserves interior whites).
- **Regenerate textures:** `node scripts/generate_textures.mjs`.

## Performance

Pooled particles (no GC spikes), shared materials with per-mesh UV frames,
distance-dormant AI, camera far plane at the fog wall for culling, merged
grass-tuft geometry, and a windowed A* with a per-frame path budget.
Renders at 0.75 internal scale with nearest-neighbour upscaling — chunky
and fast.

## Tests

```
npm install playwright-core   # anywhere; NODE_PATH it if needed
node tests/smoke.mjs [--screens]
```

Drives the real game headless: boot without errors, movement, wave
spawning, ammo consumption, an end-to-end gunfire kill, zone unlocks, and
the exact-250,000 victory (no win at 249,999; stats screen at 250,000).
