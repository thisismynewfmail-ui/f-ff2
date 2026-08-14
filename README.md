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
| WASD / arrows | Move |
| Mouse | Look / primary fire (LMB) |
| RMB | Secondary fire (per weapon — see Arsenal) |
| Shift | Sprint |
| Ctrl / C | Crouch |
| Space | Jump |
| 1–6 | Pistol / Shotgun / Assault Rifle / Sniper / Bat / Alien Blaster (once found) |
| Mouse wheel | Cycle weapons (also reveals the weapon menu) |
| R | Reload |
| E | Interact (talk to the vendor, order the adjutant, pack up a deployed sentry) |
| Tab | Satchel — click a sentry to take it in hand, or the adjutant to unfold her |
| R (sentry in hand) | Swing its arc 25° |
| LMB / RMB (sentry in hand) | Set it down / put it back in the satchel |
| Esc / E | At an arcade cabinet or the vendor's pitch, step away from it |
| Esc | Otherwise: pause / resume |
| ` / ~ | Dev console |

The weapon menu is hidden during play; a number key or a mouse-wheel scroll
fades it in at the top of the screen, and it fades back out after a couple of
seconds (or the instant you fire).

**Every action takes two keys.** Settings gives each row a primary and an
alternate slot, and either one fires the action — Shift *and* the mouse's thumb
button can both be SPRINT, which is how most people who use a thumb button
actually want it. Click a slot, press the key or button; BKSP clears a slot
(refused when it is the action's last one), ESC cancels the capture. A code
lives in exactly one slot, so binding one that is already in use moves it:
where there is something to swap the two exchange places, and where there is
not the code is simply taken and the slot it left shows a dash. Settings saved
before the second slot existed load unchanged, with the action's default
alternate restored unless the player has since put it somewhere else
(`src/engine/KeyBindings.js`, `normalizeBindings`).

**Pausing always gives the mouse back.** Resuming asks the browser for the
pointer, and a browser refuses that request outright for about a second after
the *user* pressed Escape to leave a lock — which is the situation every resume
is in, because Escape is how you paused. Asked once and refused, the game used
to un-pause into a state with no mouse look, no cursor and no key that did
anything about it, since Escape only ever paused by dropping a lock there was
no longer any of. The request is a standing intent now: `src/engine/Input.js`
keeps asking a few times a second until it lands, and retries on the spot
whenever the player presses or clicks anything. Escape closes the pause screen
as well as opening it, and pausing cancels any outstanding request (so the
retry cannot reach around the menu and take the pointer back under it).

**Leaving a menu on Escape is silent, and so is the moment after it.** There is
no "click to take the mouse back" plate any more. It existed because the
recapture genuinely can fail, and the reason it can is worth stating exactly:
**a browser only grants pointer lock to a page holding transient user
activation, and the HTML spec forbids Escape from granting any** — deliberately,
so a page cannot trap you by re-locking on the very key you press to escape it.
Every overlay in this game closes on Escape. So the request made inside that
keypress has nothing behind it, and whether it lands is the browser's call.
(This is why the same menus close *instantly and perfectly* on their button, on
a click off the case, and on [E] — every one of those carries activation.)

What the game does about it: it stops asking the player to fix it, and it stops
waiting on the answer. The prompt is gone; the **system cursor is hidden for the
whole time the game is being played**, granted or not, so the transition has
nothing to show; the standing request rides on **every event that does carry
activation** — pointerdown, keyup, any keydown but Escape — unthrottled, so the
pointer comes back on the first thing the player does; and the click or keypress
that buys it back is **swallowed**, so returning from a menu never costs an
accidental shot.

And — the part that actually removes the wait — **you can look around without
the lock.** While the game wants the pointer and has not been given it, the
camera is driven from ordinary cursor movement instead of from locked deltas,
so mouse look is back the instant the menu closes whatever the browser is
doing about the request.

The one thing an unlocked cursor cannot do is go on forever: it **runs out of
window**. Turn far enough and the pointer walks off the edge of the page, the
look stops dead, and the next click lands in whatever is behind the browser.
So during the gap the view turns **further per pixel** than it does once the
lock lands — a quarter turn costs about 440px of travel instead of a thousand,
which fits inside half a window with room to spare. It is a slightly quick
second, and that is a far better trade than losing the mouse out of the window.

The rest of the handover is invisible: the first sample only establishes an
origin so there is no flick, a cursor that leaves the window and comes back
elsewhere re-origins rather than turning, movement over an OPEN menu is ignored
so the world never turns behind a panel, and when the lock lands
`_settleMouse`'s quiet period covers the switch back to real deltas. Movement
also *asks* on every step (floored at 60ms) — it cannot redeem the request
itself, but a browser that was only waiting out a cooldown takes the first ask
after it lapses, and looking around is the one thing a player does constantly.
Every way out of play — pause, death, the title, an overlay, the dev console —
puts the cursor back, so it can never be lost.

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
| `spawn <type> [n]` | Spawn `n` enemies near you (`walker`/`sprinter`/`tank`/`exploder`/`spitter`), or `citizen` for a captive in a random building — she ignores `n`, skips her 100-kill gate, and the console prints which building to `tp` to — or `sentry`, which stands `n` **ordinary** sentries a foot in front of you (fanned out, since they refuse to stand on each other), already inside their own [E] radius |
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
- **One material, one palette, one bevel.** Every interface in the game — the
  HUD dock, the pause case, the satchel, the arcade cabinet, the title rail,
  the settings panel — is cut from the same army-surplus stock: **olive-drab
  painted steel** chipped back to bare metal, near-black **wells** sunk into
  it for the readouts, and aged **card stock** for anything that is
  documentation rather than instrumentation. Depth is a one-pixel **chisel**,
  never a soft shadow; ink is three voices that never mix (**tan** labels,
  **amber** numerals, **green** live data). The surfaces are procedural
  (`HudTextures.js`) and **tile seamlessly** — periodic noise with the chips
  and scratches wrapped across the seams — so a 60px nameplate and a 1600px
  console bar are visibly the same sheet rather than the same image stretched
  to two different aspect ratios. The bakes are published as CSS custom
  properties at boot, so a panel asks for the material declaratively. The
  geometry is **art deco**: three radii (case / bay / well), a bright
  **keyline** set in from every shoulder, **machined fluting** where a housing
  would be gripped, and — the signature — an **arched, double-moulded portrait
  casting** in a lighter alloy that stands proud of the chassis on a ribbed
  conduit.
- **HUD & stats:** a centred **Fallout-style console bar** — a mounted,
  screw-fixed, radiused olive-steel casting (procedurally textured, the
  same hard-worn housing as the side devices) carrying two banks of glowing
  **VACUUM TUBES** — on the left, VITALS (the condition readout as a heater
  glow: steady when healthy, guttering when hurt, strobing red at critical,
  surging on damage) and CHARGE (the loaded magazine as stored glow, visibly
  re-charging across a reload); on the right, XMIT (blips hot on every shot)
  and WAVE (a smoked trefoil-decal tube that rages during a wave and blinks
  through a respite) — plus a green CRT message log with a phosphor refresh
  sweep, a **counter bank** — every mechanical odometer bolted into one housed
  steel instrument rather than left as loose tiles: **HP** and **TOKENS**
  paired on its top line, **LOADED (in the gun)** and **RESERVE (carried)** on
  a scored line beneath, all of them ticking their wheels as they roll (the
  purse belongs with the ammunition, not with the score — it is a consumable
  you are carrying, and the coin beside it lifts and lights gold as it fills,
  knocks red when the vendor refuses a price) — a centre **player portrait** on a green CRT
  monitor, an AIM ON/OFF indicator (lit while scoped), a WEAPON panel (an
  illustrated two-tone profile of the live weapon over a scanning screen with
  a reload charge line), and a six-slot ARMS armoury grid with per-weapon
  reserves. A weapon the run has not found yet leaves an **empty bay** — the
  bay number and nothing else, in both the ARMS grid and the ARMORY fly-in,
  because a dimmed silhouette of the Alien Blaster in slot 6 would give the
  secret away on the first frame. The portrait is driven by health — a well-spaced
  forward/left/right **look-around idle above 50% HP**, a stern face at ≤50%,
  a drained face at ≤25% (the CRT tints green → amber → red to match). The
  **tube itself is alive** under the pose: a retrace band drifting down the
  screen, scanlines that crawl rather than sit, a slow breath in the phosphor
  glow, and a rare sync tick that snaps the picture sideways and flares as it
  recovers — all faint enough never to obscure the face. The heads are art
  shot against a flat green field, so **the same un-matting the sprite sheets
  get is applied to them** (`unmatteFringe`, shared out of
  `src/rendering/TextureLib.js`): clearing the pixels that read as green leaves
  the tail of the blend standing, and on the tube's dark ground those washed
  texels were the pale outline that used to run round the hair and shoulders.
  The key is read from the border ring rather than a corner pixel, and the
  fill requires green to LEAD the other two channels rather than merely to sit
  near the key — a plain RGB box is wide enough to swallow lit skin, which
  punched holes in the face. Flanking
  it sit two **field-device side HUDs** — the same radiused olive-steel
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
  stats live on the **pause screen**, not on the HUD — seven instruments, and
  no captions restating them. The bays are readouts, not controls, so
  **nothing in them moves under the pointer**; the action row is where the
  pointer means something, and that still responds.
- **The arcade works.** Four cabinets in the Downtown arcade, and each one is
  a MACHINE rather than a coloured box: **BRICKFALL**, **VERMIN**, **SIEGE**
  and **RALLY**, each with its own marquee, its own palette, **printed side
  art** (deco rays off the front corner, the title running up the flank, paint
  kicked off along the kick strip), a body in painted sheet steel, and a screen
  running a **four-frame attract loop of its own game** — stepped in order on a
  slow beat, so a cabinet across the room reads as something PLAYING rather
  than a lit still. Walk up and press [E] and you are playing
  it, on a 320x240 tube in a gunmetal cabinet with its own scanlines. The town
  is HELD while you play — the world clock does not advance, so nothing on the
  street can reach you at the machine — and **Escape or [E] steps away from the
  cabinet straight back into the street**, never into the pause menu, with the
  pointer already back in the game. ([E] is there for a reason: a browser only
  grants pointer lock to a document holding transient user activation, and
  **Escape grants none**, so an Escape exit alone left the mouse loose until
  some later gesture redeemed it. An ordinary key press carries activation.
  Clicking the room around the cabinet is a third exit, and the strongest.)
  **Stepping away does not throw the run away**: each machine keeps its game —
  score, lives, the ball where it was — and comes back PAUSED with the board
  as you left it, playing on when you ask. The **best score on each cabinet
  rides along in the game save**, as does which machines have already paid
  out, so clearing one twice cannot farm the tray. Clearing a machine for the
  first time leaves something in the coin tray.
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
  the lamps light in sequence and the flaps drop. Each instrument says its
  thing ONCE: there is no stencilled title over the case, no stamp, no
  property-of notice under it, and no green caption row beneath each bay
  restating in words the number the instrument is already showing. A red hold
  lamp on a rule is the whole header — the frozen game behind the case is the
  rest of the message. The one figure that was not on an instrument, the
  wave's cleared-of-quota, moved onto the tube bank. Each of the four
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
- **The interact prompt is a footnote, and sits like one.** "Trade with the
  shopkeeper [E]" lives in the **lower right**, small, on the top edge of the
  dock — not on a 13px plate parked just under the crosshair, which is dead
  centre of the part of the screen you are aiming with and big enough to read
  from the next room. A prompt tells you a key is available and then gets out
  of the way of the thing it is telling you about. Its offset is driven off the
  dock's MEASURED height rather than a guessed one, so it stays on the dock's
  edge when the dock scales itself down on a narrow window.
- **Waves:** **kill-driven** escalating hordes. Each wave sets a kill quota and
  clears the moment you hit it, so racking up kills is what advances the wave;
  then a short respite with a supply drop before the next, larger wave. Past
  **250 kills** the horde "heats up" — faster spawns, bigger waves and a higher
  active cap — ramping over the waves that follow without overflowing, and past
  **~400 kills** a second, steeper **surge** on the overall spawn rate kicks in
  (shorter spawn interval, fatter batches, higher concurrent cap) so the field
  thickens tangibly deeper into a run. Those ramps are all keyed to the KILL
  count, which means a careful player who takes their time never feels them, so
  there is one more on the WAVE clock: **past wave 6** the horde starts pressing
  harder whether or not the kills are there — shorter interval, fatter pulses,
  higher cap — and the per-wave ramp itself steepens as it goes, reaching full
  tilt around wave 14. Waves 1–6 are untouched. Sprinter/tank share rises with wave
  number and progress toward 250,000,
  spitters join the table once you clear 100 kills (their share stepping up
  past 120), and exploders once you clear 120 kills (their share stepping up
  past 150). **Wave 3 is the Exploder's wave and nothing else's** — one
  scripted round where the whole field is bombers, so you meet the type
  properly instead of first learning what one is by standing next to it. It is
  the only wave that overrides the mix; wave 4 picks the ordinary progression
  back up exactly where it left off.
- **Loot has a clock on it.** Anything that DROPS during play — shells, medkits,
  supply crates, arcade payouts, the horde's coins — lies on the street for
  **45 seconds**, and spends its **last ten blinking** at an accelerating rate so
  a token you meant to come back for tells you it is going. The ageing runs
  whether or not you are near it, so walking away does not preserve a pile, and
  it clears the road between waves instead of letting a hundred kills' payout
  carpet the district. Two
  things are deliberately exempt: the loot the **world is built with** — every
  drawer, locker and cabinet is filled at load, long before you could reach any
  of it, so on this clock the town would be stripped bare inside a minute — and
  the **quest key**, the one pickup in the game there is no second copy of. The
  pickup cap respects the same line: the town seeds right up to it, so a full
  list now evicts the oldest thing already on the clock rather than the first
  item in the array, which for a run's worth of drops was a drawer's worth of
  ammunition nobody had opened yet.
- **Checkpoints & death:** the run is checkpointed every **tenth wave**. When
  you die, every zombie on the map is cleared and the run rolls back to the last
  checkpoint — kills, score and wave all restored — then that wave respawns from
  scratch (die at wave 45 → back to 40). The district barriers re-seal to match
  the rolled-back kill count, so any sections you'd opened stand again and must
  be re-earned. **The hardware does not roll back.** Dying costs you the wave,
  not the kit you paid tokens for: every sentry folds up — the ones bolted to
  the pavement and the one in your hands — the adjutant folds up, and the
  Companion Cube comes back from wherever you set it down, all of it stowed in
  the satchel and none of it left across town from where you respawn. Whatever
  was already in the satchel is untouched.
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
  Ave holds an abandoned checkpoint. The **clocktower**'s dial is live (its
  hands track the sky's day cycle) and is now set out from the WALL FACE in a
  stone surround rather than pinned at a fixed offset from the building's
  centreline — the tower's belt courses stand ten centimetres proud, one of
  them lands at 11.35 m, and the old dial stood only five, so a stone band ran
  straight across the middle of the clock.
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
  district, and the only Eastgate interior worth fighting a wave inside — with
  a **piano on the stage you can play**: the key bank goes down several times
  over the length of the phrase, softer each time, and the two candlesticks on
  the lid **catch while it plays**, each wick on its own beat and its own lean
  so they never flicker in lockstep), a
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
- **Tokens:** the horde carries coins, and the coins are the only money in
  town. Each one is an eight-frame **spin** rather than a still disc, and the
  three are told apart by mass and by ear as well as by colour — copper is a
  small dull tick, silver rings a fifth above it, the gold has a tail on it.
  The drop table (`src/systems/TokenDrops.js`) is the whole economy:

  | Killed | Coin | Worth | Chance |
  | --- | --- | --- | --- |
  | Walker / Sprinter / Tank | copper | 5 | 15% |
  | Spitter | gold | 10 | 5% |
  | Exploder | silver | 20 | 10% |

  The Exploder's coin is rolled **separately from its ammunition drop**, so a
  bomber that took itself out — which by design leaves no sniper ammo — still
  pays. The purse is a resource, not a score: it rides on the HUD console beside
  the ammunition, it is written into the save and comes back with a resumed
  session, and it **rolls back with a checkpoint** on death, so dying costs you
  the shopping you had not done yet rather than handing you a windfall.
- **The Shopkeeper, and the trading post.** Out on the Eastgate knoll, a short
  walk in from the district gate, there is a break in the trees with a track
  worn up to it and, in the clearing, a **county highway pull-off**: a poured
  concrete pad with a bolted steel shelter over it, **open to the road and open
  to the ground**. Four galvanised stanchions on base plates, cross-braced down
  both flanks and across the back, purlins and a corrugated deck pitched to the
  rear, chain-link where a wall would be, a hanging trade sign and the only
  working lamp on that stretch of road. Nothing is clad — you can see every
  joint in it, and through it to the trees. (It was a shingled timber lean-to
  first, and timber was the wrong material: this town is poured kerbs,
  chain-link and filling-station canopies, and a frontier stall in the middle
  of that read as set dressing from another game.)

  There is no counter across the front — what keeps you out is that the bay is
  OCCUPIED. Jersey barriers and a pallet stack in the front corners, a cable
  drum, a gas-bottle rack, the county's utility cabinet, a hazard drum, a
  folded barricade, a coil of cable and cones pile up around a clear lane down
  the middle, and the machine itself closes that lane. You can walk right up to
  it and see the whole thing, boots to hat, which a plank across the front made
  impossible.

  In the lane stands a **coin-operated upper-torso animatronic** — a fairground
  fortune-teller crossed with a frontier shopkeeper. Lacquered oxblood case on
  cast feet, brass coin throat, delivery tray, pressure dial and a lit marquee;
  above it an **open brass column**, the works it turns on; and rising out of
  that, a half-figure in a waistcoat with a moustache, a pipe, a wide-brim hat
  and lamps for eyes, jointed at the waist, shoulders, elbows, neck and jaw. It
  has no legs and never had any. The column is the difference between a figure
  that is standing IN the machine and one that is standing ON it: the arms hang
  about twelve centimetres below the waist, so bolted straight to the top of a
  solid case both hands were inside it at rest. The stand is the same height it
  always was — its top is just no longer cabinet, and every pose now clears the
  case (measured, not eyeballed: the worst of them by four centimetres).
  **Stand and figure together come to about 1.6 m** — a machine you stand in
  front of, and still shorter than you are.

  It is a machine that noticed you. Its head tracks you the whole time it is
  awake, and it does not have *an* idle: it dozes when the road is empty, wakes
  and straightens up when you come up the track, and while it waits it cycles
  through a set of behaviours — surveying the road, wiping the deck, winding
  the key in its own side, drumming its fingers, nodding off and catching
  itself — picking a different one each time so you never see the same gesture
  twice running. It presents the wares while the shop is open, sweeps a hand to
  the delivery tray on a sale, and shakes its head when it cannot be paid.

  **The horde ignores it entirely.** Not "it is very tough" — invisible: a
  zombie acquires the player first and otherwise the nearest thing on the shared
  friendly roster, and the vendor is never put on that roster, so nothing senses
  it, hunts it, swings at it, and an Exploder detonating at the pitch cannot
  touch it either.
- **The shop.** [E] at the machine opens it: the vendor live on the left,
  turning on its own little stage (a real 3D render of the same rig, not a
  picture of one), the goods on the right in bubbled bays, the till along the
  foot. **Nothing is written across the machine.** There was a line of green
  flavour laid over its stage, opening with a greeting that told you nothing —
  you can see the prices, and you came here on purpose. What the till has to
  say (short, out, locked, sold) now says it on the FOOTER, beside the money,
  in the same stencil as everything else on the plate. It freezes the street
  the way the satchel and the arcade do, and it hands the mouse back on the way
  out — never the pause menu, and never a "click to take the mouse back"
  prompt. There are four ways out and three of them carry **user activation**,
  which is what a browser wants before it will grant pointer lock: the STEP
  BACK button, a click anywhere off the case, and the same [E] you arrived
  with. The fourth is Escape, which by specification grants none — so that one
  exit leans on the silent recapture described under Controls rather than on a
  plate telling the player to go and click something. It sells a
  **Portable Sentry at 100 tokens, six of them**; the **adjutant android at
  500, one only**; **every ammunition type separately at 10** a crate; and
  carries one dead bay at the bottom for whatever has not arrived yet.
- **Portable Sentry:** a tripod auto-pistol that stows in the satchel. Click it
  there and it comes up **into your hands** (the gun goes away — you cannot hold
  a rifle and a tripod at once), and the ground ahead of you shows exactly where
  it would go: a **green 180° wedge** of precisely the radius it will cover,
  draped over the real terrain with a bubble wall standing on its boundary, and
  a ghost of the machine facing the way you are. Green means the click lands,
  red means the ground will not take it. **[R] swings the arc 25° a press** —
  a detent you can count rather than a smooth drag, so two sentries can be set
  at a known angle to each other without a protractor, and the spot stays put
  while the cover turns. Click to set it down; it kicks its legs out, cycles its
  head once, and starts sweeping. It reaches **about sixty feet** — far enough
  to hold a street — over a **180° arc**, and it is a pistol on a stand quite
  literally: the same damage and the same fire rate, read off the pistol's own
  config, so it is never better than the gun in your hand, just a second one
  that never looks away. Nothing targets it: it is off the friendly roster too.
  Press [E] on a deployed one and it folds back into the satchel. Sentries roll
  come home to the satchel when you die rather than being left standing, and
  `spawn sentry` in the console stands one up a foot in front of you — the ordinary machine, not a
  special one, so it packs into the satchel like a bought one.

  **It is built as a mechanism, not as the shape of one.** Every joint that
  bends has the ram that bends it, every rotation has the gear it runs on: three
  two-segment legs on hydraulic rams with footpads that stay flat whatever the
  legs do, a two-stage telescoping mast it stands up on, a **28-tooth yaw ring
  driven by a visible pinion** at the exact ratio the tooth counts imply, a
  receiver that is two rails with the **bolt cycling between them**, a **belt of
  links that walks toward the feed tray one link per shot**, a spent case thrown
  out of the port, a **six-blade iris** that stops down onto a target the way an
  eye does, **louvres that crack open and fins that glow** as the barrel heats
  (past its ceiling it stops firing and cools), and a whip aerial that trails
  whatever the head just did.

  **And it has an inner life.** Left with nothing to shoot it runs its own
  routines — a **self-test** with the lamps in a chase and the tripod shaken
  down, and eventually a **doze** where the barrel sinks and the lamps drop to
  one slow heartbeat until something turns up. Stand in front of one, inside its
  arc, doing nothing, and it will notice you, bring the barrel up **to the
  vertical, hold it, and put it back down**. Every twenty-fifth kill it taps the
  barrel twice, like a gunner notching a stock. Pick one up and set it down
  three times inside twenty seconds and it deploys with a shake of the head.
- **The adjutant — "NEKO", 500 tokens, one only.** A refurbished companion
  android, and the only thing in this town that walks beside you on purpose.
  She stows in the satchel folded into a ball; click her and she unfolds on the
  ground, finds her feet, and stretches. **[E] on her opens the ORDER DIAL** — a
  radial of eight, split down the middle by what the halves mean: **posture** on
  the right (FOLLOW · GUARD · STAY), **rules** on the left (ATTACK · RANGED ·
  MELEE · PASSIVE), and PACK UP at the foot. She holds one from each side at all
  times and both are lit on the dial, so it doubles as the readout for what she
  is currently doing. Every command sits at a fixed compass point, so after the
  second time your hand knows where GUARD is without your eyes going near the
  labels. 1–8 work too, and each well carries its number at the rim the way a
  rotary switch carries its detents.

  **The dial is built as another instrument off the same rack**, not as a menu
  laid over the game: a painted steel case with a keyline and four fixing
  screws, eight wells sunk into the plate rather than eight buttons sitting on
  it, a stepped collar around the bore, and a green CRT in the middle with her
  name on it. It comes up in a fifth of a second — the case swells, the ring
  turns onto its stop, the tube strikes — and an order that lands flashes its
  own well.

  **She carries no gun**, and that is a rule rather than an oversight — there is
  nowhere on her to put one. What she has is folded away until she needs it: a
  **blade in each forearm** that drives down past the fist and locks over
  square, and **two arc emitters** that hinge up off her shoulder blades and
  split open. Her chest core spins up and lights before either fires, so there
  is always a tell. Melee hits harder and needs her to close; the arc **reaches
  22 m — further than the sentry's sixty feet**, which is the division of labour
  between them: the sentry holds a doorway, she covers the street you are
  crossing. It costs a charge cycle for the range. On ATTACK she picks whichever
  the distance asks for, preferring the blades inside six metres. On GUARD the
  leash governs how far she will WALK off her post, not how far she can shoot
  from standing on it — she engages anything inside arc range and stays put.

  **She is shorter than you** (1.42 m against your 1.75 — measured off the
  assembled rig and checked in the suite), and she is built as a machine shaped
  like a person: enamel panels with the seams showing, cable looms at the
  joints, and a county service plate on her back. The catgirl silhouette is all
  mechanism — the **ears are directional microphones** and point at what she is
  listening to, the **tail is her balance mass** and swings against her turns,
  and the bob is a cooling shroud with vents in it.

  **Every state flows into every other, and not one transition is authored.**
  Each state writes a POSE — a plain object of joint targets — and the rig is
  EASED onto it rather than set, so walk into alert into melee into sit is one
  continuous thing whatever order it happens in. The gait runs off distance
  travelled rather than time, so her feet never skate; the arms counter-swing
  their leg and the tail lags the hips by a beat. Idle, she cycles through
  surveying the road, grooming the back of a hand, a full stretch with the ears
  flat back, listening on one bearing with both ears swung round, **chasing her
  own tail**, and dozing off sitting down. She blinks. The one loose strand of
  hair never lies down. Her whole vocabulary is two- and three-note synth
  phrases off one square-wave voice — rising is yes, falling is no, and the low
  warble is the only thing she says that is not an answer to something.

  Like the sentry, **the horde has no idea she exists**: she is off the friendly
  roster, so nothing acquires her, swings at her, or catches her in a blast. A
  companion you spend the run babysitting is not an asset, and the game is
  consistent about which things it lets you lose.
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
                    cockroach, shopkeeper (the vendor animatronic), the
                    adjutant android (Companion.js) and the sentry, the
                    deployable sentry, pickups (ammo, health, keys, coins)
src/weapons/        weapon configs + firing/ammo/hit resolution
src/rendering/      renderer, texture pipeline, billboards, HUD (console bar +
                    Portrait CRT + HudTextures), 3D weapon view + PBR weapon
                    materials, effects, the arcade cabinets and the four
                    machines in them (Arcade.js), the vendor rig + its
                    animation state machine (VendorModel.js), the shop
                    overlay (ShopUI.js), the sentry model (SentryModel.js)
src/audio/          WebAudio synthesis (all sounds)
src/world/          terrain, buildings, props, vegetation, zones, nav, secrets,
                    anomalies (cosmic-horror layer + dynamic props and
                    surfaces), companion cube, scarecrow (aware animated set
                    piece, its easter-egg chain and the crash site), sky
src/systems/        score/win condition, waves, spawning, savable-citizen
                    director, game state, inventory, tokens (currency +
                    the coin drop table), sentries (carrying, placement
                    preview, deployed turrets)
src/engine/Shell.js desktop-shell bridge (detects the Electron launcher)
launcher/           Windows desktop launcher (Electron): startup window,
                    harmonograph boot animation, isolated fullscreen game window
tests/              headless AI tests (ai.mjs), NPC behaviour tests against the
                    real world (npc-behavior.mjs), the vendor/tokens/sentry
                    suite (shop.mjs), Playwright smoke test (boot, combat,
                    exact win condition)
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
- **New shop line:** add an object to `SHOP_STOCK` in
  `src/rendering/ShopUI.js` — a price, how many the machine has, which bay it
  sits in, and a `buy` that emits an ordinary `pickup`. That is the whole
  contract: ammunition reaches the guns and the sentry reaches the satchel
  through the same event everything else in the world is collected by, so the
  till never needs to know which is which. Stock and payment are enforced in
  one place (`Game._buy`), not in the button.
- **New coin / drop rate:** the coin values live in `COINS`
  (`src/systems/TokenSystem.js`) and who drops what, how often, in
  `COIN_DROPS` (`src/systems/TokenDrops.js`), keyed by the archetype's own
  name — a type nobody thought about drops nothing rather than quietly
  inheriting someone else's rate.
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
node tests/shop.mjs
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
rather than into the pause menu. It then walks away from a cabinet mid-run and
comes back to it: the score has to be the score it left, the board has to have
stood still while the cabinet was shut, and the machine has to wait to be asked
before it plays on — and the best score has to survive a trip through
`captureSession`. Key bindings get the same treatment: an action's ALTERNATE
slot is bound to a mouse button and the action has to fire off either slot, the
form has to offer somewhere to put the second key, and a code bound twice has
to end up in exactly one place with nothing left unbound. It plays the reported
pause/resume dead end
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
