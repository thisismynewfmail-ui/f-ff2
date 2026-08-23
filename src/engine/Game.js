import { EventBus } from './Events.js';
import { Input } from './Input.js';
import { DevConsole } from './DevConsole.js';
import { Renderer } from '../rendering/Renderer.js';
import { TextureLib } from '../rendering/TextureLib.js';
import { World } from '../world/World.js';
import { Sky } from '../world/Sky.js';
import { Player } from '../entities/Player.js';
import { NPC } from '../entities/NPC.js';
import { Cockroach } from '../entities/Cockroach.js';
import { ShopKeeper } from '../entities/ShopKeeper.js';
import { PickupManager } from '../entities/Pickups.js';
import { CitizenSystem } from '../systems/CitizenSystem.js';
import { WeaponManager } from '../weapons/WeaponManager.js';
import { ScoreSystem } from '../systems/ScoreSystem.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { SpawnSystem } from '../systems/SpawnSystem.js';
import { GameState } from '../systems/GameState.js';
import { Inventory } from '../systems/Inventory.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { SettingsStore } from '../systems/SettingsStore.js';
import { TokenSystem } from '../systems/TokenSystem.js';
import { SentrySystem, SENTRY_KINDS } from '../systems/SentrySystem.js';
import { CompanionSystem } from '../systems/CompanionSystem.js';
import { Effects } from '../rendering/Effects.js';
import { WeaponView } from '../rendering/WeaponView.js';
import { HUD } from '../rendering/HUD.js';
import { ShopUI } from '../rendering/ShopUI.js';
import { RadialMenu } from '../rendering/RadialMenu.js';
import { AudioManager } from '../audio/AudioManager.js';
import { Shell } from './Shell.js';
import { Arcade, MACHINE_IDS } from '../rendering/Arcade.js';

/**
 * Framing ladder for the title-screen orbit (see Game._menuCinematic): each
 * rung is an [orbit radius multiplier, extra height] pair, widest first. The
 * camera takes the widest rung that still has a clear line to the player, so a
 * run quit from an alley or a back room climbs and tightens into a shot of the
 * roof they are under rather than swinging the lens through a wall.
 */
const MENU_FRAMINGS = [[1.00, 0], [0.85, 8], [0.62, 18], [0.45, 30]];

/**
 * Wires every system together and runs the frame loop. Owns nothing
 * domain-specific itself: gameplay flows through the event bus and the
 * per-frame update order below.
 */
export class Game {
  constructor(canvas, hudRoot, { testMode = false } = {}) {
    this.testMode = testMode;
    this.events = new EventBus();
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas);
    this.texLib = new TextureLib();
    this.state = new GameState(this.events);
    this.hudRoot = hudRoot;
    this.time = 0;
    this._raf = 0;
    this._lastT = performance.now();
    this.runStarted = false; // has THIS session's run been entered at least once
    this._menuT = Math.random() * 400; // cinematic orbit clock (random start angle)
    this._menuFrame = 0;               // eased rung of the orbit framing ladder
    // x-ray cheat (dev console): draw every NPC sprite through walls. `xray` is
    // the desired state; `_xrayActive` is the last-applied state, so exactly one
    // restore pass runs the frame after it is switched off (see applyXray).
    this.xray = false;
    this._xrayActive = false;
  }

  async load(onProgress) {
    // Previous-session stats for the title screen (server API, then
    // localStorage) — fetched alongside the textures.
    this.saves = new SaveSystem();
    const savesReady = this.saves.load();

    await this.texLib.loadAll(onProgress);
    await savesReady;

    this.world = new World(this.events, this.texLib, this.renderer.scene).build();
    this.sky = new Sky(this.renderer, this.texLib);
    this.player = new Player(this.events, this.world, this.input);
    this.world.attach(this);
    this.score = new ScoreSystem(this.events);
    // Tokens: the vendor's currency. Separate from score on purpose — one is
    // a record, the other is a resource you spend (see systems/TokenSystem.js).
    this.tokens = new TokenSystem(this.events);
    this.waves = new WaveSystem(this.events, this.score);
    // Checkpoint: the run-state to roll back to on death. Refreshed every tenth
    // wave (see _wire); the initial one is the pristine start (wave 0, no kills).
    this.checkpoint = { wave: 0, score: this.score.snapshot() };
    this.spawner = new SpawnSystem(this.events, this.world, this.texLib, this.renderer.scene, this.waves);
    // Actively add the blind-cull flag (a tag/flag, not baked-in behaviour):
    // any zombie that can't get an unobstructed line to the player for 30s is
    // removed, so a straggler stuck behind geometry never stalls a wave.
    this.spawner.setCull(30);
    this.weapons = new WeaponManager(this.events, this.world, this.player, this.renderer);
    this.weapons.zombies = this.spawner.zombies;
    // The pristine checkpoint now also carries the starting ammo loadout, so the
    // first death restores full magazines rather than an empty gun. The same
    // pristine snapshot is reused to refill the guns on a NEW GAME restart.
    this._pristineAmmo = this.weapons.snapshotAmmo();
    this.checkpoint.weapons = this._pristineAmmo;
    // ...and the purse rolls back with it: dying costs you the shopping you
    // had not done yet rather than handing you a windfall.
    this.checkpoint.tokens = this.tokens.snapshot();
    this.pickups = new PickupManager(this.events, this.world, this.texLib, this.renderer.scene);
    this.pickups.seedInitial();
    // The deployable sentries: the ones in the satchel, the one in the hands
    // and the ones standing in the street. Given the live zombie list every
    // frame from the same shared AI context the horde is stepped with.
    this.sentries = new SentrySystem(
      this.events, this.world, this.texLib, this.renderer.scene, this.player);
    // The adjutant: folded in the satchel, or standing in the street taking
    // orders. Owned the same way the sentries are, for the same reasons.
    this.companions = new CompanionSystem(
      this.events, this.world, this.texLib, this.renderer.scene, this.player);
    this.npc = new NPC(this.events, this.world, this.texLib.get('npcPeaceful'));
    this.renderer.scene.add(this.npc.mesh);
    // Friendlies zombies may fall back to hunting, and the roster the NPCs
    // sense threats from — one list, so new NPC archetypes just slot in.
    //
    // The shopkeeper is deliberately NOT on it. This roster is exactly what
    // makes something huntable: a zombie with no player to chase looks for the
    // nearest thing on here, and an Exploder's blast is dealt to the player,
    // the horde and this list. Leaving the vendor off it is what makes the
    // horde ignore it entirely — not toughness, invisibility.
    this.friendlies = [this.npc];
    // The vendor, at the counter of the trading post out on the Eastgate knoll.
    const post = this.world.tradingPost.counterSpot();
    this.shopkeeper = new ShopKeeper(this.events, this.world, this.texLib, post);
    this.renderer.scene.add(this.shopkeeper.mesh);
    // The AI-test cockroach: wanders, hides indoors by day, roams out at
    // night, and skitters away from the player.
    this.cockroach = new Cockroach(this.events, this.world);
    this.renderer.scene.add(this.cockroach.mesh);
    // The savable citizen: guaranteed on wave 1 (in the player's own starting
    // district) and again on wave 2, then — once the run is 100 kills deep —
    // a chance every wave to appear captured inside a random unlocked
    // building. Free her with [E] for a health-kit drop. Takes the score so it
    // can read that kill gate.
    this.citizens = new CitizenSystem(this.events, this.world, this.texLib, this.renderer.scene, this.score);
    this.effects = new Effects(this.events, this.renderer.scene, this.texLib, this.player);
    this.viewModel = new WeaponView(this.events, this.renderer, this.texLib);
    this.audio = new AudioManager(this.events);
    // Shared settings (sliders + key bindings), persisted and applied live to
    // the camera, audio and input. Backs BOTH the title and pause Settings.
    this.settings = new SettingsStore((s) => this.applySettings(s));
    this.hud = new HUD(this.events, this.hudRoot, {
      settingsStore: this.settings,
      onStart: () => this.newGame(),
      onResume: () => this.startPlaying(),
      onRespawn: () => this.respawn(),
      onReturnToRun: () => this.startPlaying(),
      onResumeSave: () => this.resumeSession(),
      onSave: () => this.saveSession(),
      onQuitToTitle: () => this.quitToTitle(),
      onExitGame: () => this.exitGame(),
      applySettings: (s) => this.applySettings(s),
      isDesktop: Shell.isDesktop,
      // What the title menu needs to lay out its rail + last-session card.
      menuState: () => ({
        runStarted: this.runStarted,
        save: this.saves.data,
        saveWhere: this.saves.serverOk ? 'server' : 'local',
      }),
    });

    this.devConsole = new DevConsole(this, this.hudRoot);

    // Inventory (Tab): frees the mouse for the UI and freezes the sim while
    // open; hands the mouse back to the game on close.
    this.inventory = new Inventory(this.events, this.hudRoot, {
      // ...but not over the vendor's counter: Tab there would put a second
      // overlay on top of the first, and only one of them can own the mouse.
      canOpen: () => this.state.is('playing') && !this.devConsole.open
        && !this.shop?.open && !this.radial?.open,
      onOpen: () => {
        this.input.setSuppressed(true);
        if (!this.testMode) this.input.releasePointerLock();
      },
      onClose: () => {
        this.input.setSuppressed(false);
        this._reclaimPointer();
      },
    });

    // The arcade cabinets. Playing one freezes the world exactly the way the
    // satchel does — no update, so nothing on the street can reach the player
    // while they are at the machine — and Escape (handled inside Arcade, in
    // the capture phase) puts them straight back in the street rather than in
    // front of the pause menu.
    this.arcade = new Arcade(this.hudRoot, {
      onOpen: () => {
        this.input.setSuppressed(true);
        if (!this.testMode) this.input.releasePointerLock();
      },
      onClose: () => {
        this.input.setSuppressed(false);
        this._reclaimPointer();
      },
      onBeep: (kind, id) => this.audio.arcadeBeep(kind, id),
      onScore: (id, score, best, won) => this._arcadeScore(id, score, best, won),
      // Same reason as the counter's: Escape carries no user activation, so
      // the cabinet needs one exit that does (see Arcade._wire).
      interactCodes: () => this.input.codesFor('interact'),
    });
    this.events.on('arcade:play', ({ id }) => {
      if (this.state.is('playing') && !this.inventory.open) this.arcade.play(id);
    });

    /**
     * The vendor's counter. It freezes the world exactly the way the satchel
     * and the arcade do — the mouse is on the UI, so nothing in the street may
     * reach the player while they are shopping — and Escape (handled inside
     * ShopUI, in the capture phase) puts them straight back in the street with
     * the pointer, never in front of the pause menu.
     */
    this.shop = new ShopUI(this.hudRoot, this.texLib, {
      canOpen: () => this.state.is('playing') && !this.devConsole.open
        && !this.inventory.open && !this.radial?.open,
      onOpen: () => {
        this.input.setSuppressed(true);
        if (!this.testMode) this.input.releasePointerLock();
        this.events.emit('shop:opened', {});
      },
      onClose: () => {
        this.input.setSuppressed(false);
        this._reclaimPointer();
        this.events.emit('shop:closed', {});
      },
      tokens: () => this.tokens.tokens,
      onBuy: (entry) => this._buy(entry),
      // The live bindings for [E] — both slots — so whichever key opened the
      // counter also closes it, and does it with an activation the browser
      // will accept a pointer-lock request under (see ShopUI._wire and
      // _reclaimPointer).
      interactCodes: () => this.input.codesFor('interact'),
    });
    this.events.on('shop:open', () => this.shop.openShop());

    /**
     * The adjutant's order dial. Same contract as the counter and the cabinets:
     * it freezes the street while it is up, and Escape or [E] puts the player
     * straight back with the pointer rather than in front of the pause menu.
     */
    this.radial = new RadialMenu(this.hudRoot, {
      canOpen: () => this.state.is('playing') && !this.devConsole.open
        && !this.inventory.open && !this.shop.open && !this.arcade.open,
      onOpen: () => {
        this.input.setSuppressed(true);
        if (!this.testMode) this.input.releasePointerLock();
      },
      onClose: () => {
        this.input.setSuppressed(false);
        this._reclaimPointer();
      },
      onCommand: (cmd) => this.companions.command(cmd),
      interactCodes: () => this.input.codesFor('interact'),
    });
    this.events.on('companion:orders', ({ companion }) => this.radial.openOn(companion));

    this._wire();
    this._startAutosave();
    // Push the loaded settings (sliders + key bindings) live now that every
    // consumer (player, renderer, audio, input) exists.
    this.settings.apply();
    this.state.to('menu');
    this.audio.setTrack('menu');
    this.hud.showScreen('menu');
    // Browsers will not start an AudioContext without a gesture, so the title
    // screen is silent until the player touches something — any something.
    // Waiting for NEW GAME meant the menu's own theme was never heard by
    // anyone who did not first quit back to it mid-run.
    if (!this.testMode) {
      const wake = () => this.audio.unlock();
      for (const ev of ['pointerdown', 'keydown']) {
        window.addEventListener(ev, wake, { once: true, capture: true });
      }
    }
    return this;
  }

  /**
   * Take the pointer back after an overlay (the arcade, the satchel) closes.
   *
   * Escape is the one key that must never be holding the pointer request, and
   * it is why no overlay closes on it. Chromium grants a lock asked for inside
   * an Escape keydown and then the SAME keypress takes it straight back off you
   * a beat later — by which time the overlay is closed, so the game reads that
   * unlock as the player walking away and pauses. That is the "Escape at a
   * cabinet drops me on the pause screen with a loose cursor" report, and it
   * never showed up in the suite because test mode skips pointer lock whole.
   * The overlays now leave on [E] or on a click outside, both of which carry
   * the activation a re-lock needs; this is still the belt and braces.
   *
   * So the request waits for the next frame, out from under the keypress, and
   * an unlock arriving in the moments after an overlay closed is treated as
   * the tail of that keypress rather than as the player leaving: the pump is
   * re-armed instead of the game pausing. Escape in ORDINARY play is nowhere
   * near this window, so it still pauses exactly as before.
   *
   * ...but the deferred ask CANNOT be the only one, and that is what left a
   * player leaving the vendor's counter looking at a loose cursor and a "click
   * to take the mouse back" prompt. Chromium only grants a lock while the
   * document holds TRANSIENT USER ACTIVATION, and **Escape does not grant
   * activation**. A frame later there is no gesture on the stack at all, so
   * every deferred request is refused until the player clicks — which is
   * exactly the prompt, and exactly what they should not have to do. (The
   * arcade got away with it only by accident: playing a cabinet means pressing
   * keys, and each of those IS an activation.)
   *
   * So the ask happens TWICE: once synchronously, while whatever closed the
   * overlay is still on the stack and its activation is still live, and again
   * on the next frame in case that one was the grant-then-revoke above. The
   * immediate one is what actually lands, and the guards described above are
   * what make it safe to make.
   */
  _reclaimPointer() {
    this._overlayClosedAt = performance.now();
    if (this.testMode || !this.state.is('playing')) return;
    const ask = () => {
      if (this.state.is('playing') && !this.inventory.open && !this.arcade.open
        && !this.shop.open && !this.radial.open) {
        // Urgent: the browser may refuse for the first second or so after an
        // Escape, and the player is standing in the street the whole time.
        this.input.requestPointerLock({ urgent: true });
      }
    };
    ask();
    requestAnimationFrame(ask);
  }

  /**
   * Take the vendor's price and hand over the goods.
   *
   * The purchase is one transaction in one place, and EVERY rule about it is
   * enforced here rather than in the button that usually starts it: the bay
   * must be sellable, the machine must still have one, and the purse must
   * cover it — checked in that order, and the goods issued only if all three
   * held. A rule that lives in the UI instead is a rule any other caller walks
   * straight past, which is exactly how a two-of-a-kind item ends up in the
   * satchel four times.
   *
   * What the goods ARE is the entry's own business (see SHOP_STOCK): it emits
   * an ordinary 'pickup', which is how ammunition reaches the guns and how the
   * sentry reaches the satchel, so nothing here needs to know which is which.
   * Returns true if the sale happened.
   */
  _buy(entry) {
    if (!entry || entry.locked) return false;
    if (this.shop.remaining(entry) <= 0) return false;
    if (!this.tokens.spend(entry.price)) return false;
    entry.buy?.(this.events);
    this.shop.noteSold(entry);
    this.events.emit('shop:bought', { id: entry.id, price: entry.price });
    this.shop.pokeVendor('sale');
    return true;
  }

  _wire() {
    // Losing pointer lock while playing = pause (unless the satchel took it).
    this.input.onPointerLockChange = (locked) => {
      if (locked || !this.state.is('playing') || this.testMode) return;
      if (this.inventory.open || this.arcade.open || this.shop.open || this.radial.open) return;
      // An unlock that arrives while we are still ASKING for the pointer is
      // not the player leaving — it is the tail of an exit we requested
      // ourselves before they resumed (exitPointerLock reports back a frame or
      // two later). Pausing on it would bounce them straight out of the game
      // they just came back to.
      if (this.input.lockWanted) return;
      // ...nor is one that lands in the wake of an overlay closing: see
      // _reclaimPointer. Ask again rather than pausing.
      if (performance.now() - (this._overlayClosedAt ?? -Infinity) < POINTER_REGRAB_MS) {
        this.input.requestPointerLock({ urgent: true });
        return;
      }
      // ...nor is one that belongs to an Escape the PAGE received. The browser
      // eats that keydown whenever it is holding the pointer — that keypress
      // IS how you leave a lock — so an Escape that arrived here proves the
      // pointer was already free when it was pressed, and everything after it
      // is our own plumbing: the overlay closing, the re-grab, and however
      // many times the browser hands the lock over and takes it back again
      // before it settles. An Escape MEANT as "pause" never reaches the page,
      // so this cannot swallow one.
      //
      // The flag clears itself once a lock has SURVIVED a second, which is
      // what stops it latching on forever: by then the player is back at the
      // controls, the next Escape is theirs, and it pauses.
      if (this.input.escapeGrab) {
        this.input.requestPointerLock({ urgent: true });
        return;
      }
      this.pause();
    };
    /**
     * Escape toggles the pause screen. In a real run this used to be gated on
     * test mode, which meant the ONLY thing that ever closed the pause screen
     * was the RESUME button — and the only thing that opened it was the
     * browser dropping pointer lock. Between those two, a resume that failed
     * to retake the pointer left the player in the game with a loose cursor
     * and no key that did anything about it.
     *
     * While the pointer is locked the browser eats the Escape keydown itself
     * (that IS how it leaves the lock), so the pause on the way in still comes
     * from onPointerLockChange below; this handles the way back out, and the
     * case where the game is running without a lock at all.
     */
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || this.devConsole.open || this.inventory.open) return;
      // The arcade and the shop already swallowed it in the capture phase;
      // belt and braces, so leaving either can never reach the pause screen.
      if (this.arcade.open || this.shop.open || this.radial.open) return;
      // The pause settings overlay eats Escape first (HUD._wire) to close
      // itself; if it is open, this must not also fire.
      if (this.hud.pauseSettingsEl && !this.hud.pauseSettingsEl.hidden) return;
      // ESCAPE PAUSES. IT DOES NOT RESUME. The pause screen is the one thing
      // here that must be left on purpose — you leave it with RESUME, or with
      // one of the other buttons on it — so a stray press of the key that put
      // it up cannot drop the player back into a wave they were not looking at.
      if (this.state.is('playing')) this.pause();
    });

    // Checkpoint every tenth wave: snapshot the run so a death rolls back to it.
    // The snapshot captures the AMMO loadout too, so a respawn hands the player
    // back the magazines/reserves they held at the checkpoint (not a dry gun).
    this.events.on('wave:start', ({ wave }) => {
      if (wave % 10 === 0) {
        this.checkpoint = {
          wave, score: this.score.snapshot(), weapons: this.weapons.snapshotAmmo(),
          tokens: this.tokens.snapshot(),
        };
      }
    });

    this.events.on('player:died', () => {
      if (!this.state.to('dead')) return;
      this.hud.fillDeadStats(this.score.stats());
      this.hud.showScreen('dead');
      this.input.releasePointerLock();
    });
    this.events.on('victory', () => {
      this.state.to('victory');
      this.input.releasePointerLock();
    });
    this.events.on('supplies:drop', () => this._dropSupplies());

    // Taking a sentry out of the satchel puts it in the player's hands, so
    // the satchel gets out of the way — the placement preview is in the
    // WORLD, and you cannot aim it through an open inventory panel.
    this.events.on('sentry:hold', ({ on }) => { if (on) this.inventory.close(); });

    // Clicking the Friend Box in the satchel sets it back down on the
    // ground just ahead of the player (see CompanionCube.dropAt).
    this.events.on('inventory:drop', ({ type }) => {
      if (type !== 'companionCube') return;
      const p = this.player;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      this.world.companionCube.dropAt(
        p.position.x + fx * 1.5, p.position.z + fz * 1.5, p.position.y);
      this.inventory.close();
    });

    // --- the tube is wired to the game ------------------------------------
    // The picture is not a filter sitting on top of play, it is a signal that
    // play interferes with (see rendering/PostFX.js). Muzzle blast and blasts
    // surge the beam; getting hit tears the tracking and splits the guns; a
    // wave landing punches the vertical hold. Everything decays back to a
    // clean picture on its own, so nothing here can leave the screen broken.
    this.events.on('weapon:fire', ({ weapon }) => {
      if (!weapon?.isMelee) this.renderer.pulse('surge', 0.35 + (weapon?.config?.kick ?? 1) * 0.05);
    });
    this.events.on('player:damage', ({ amount }) => {
      this.renderer.pulse('damage', Math.min(1, 0.3 + amount * 0.035));
    });
    this.events.on('wave:start', () => this.renderer.pulse('glitch', 0.75));
    this.events.on('zone:unlock', () => this.renderer.pulse('glitch', 0.9));
    this.events.on('sentry:fire', () => this.renderer.pulse('surge', 0.16));
  }

  startPlaying() {
    if (!this.state.to('playing')) return;
    this.runStarted = true;
    this.hud.showScreen(null);
    this.audio.unlock();
    if (!this.testMode) this.input.requestPointerLock();
  }

  /** NEW GAME from the title. On a fresh boot this simply enters the fog; once a
   *  run has begun it resets the run in place (see restartRun) — either way the
   *  player is dropped straight into the game. */
  newGame() {
    if (this.runStarted) { this.restartRun(); return; }
    this.startPlaying();
  }

  /** Reset the live run to a pristine wave-1 state IN PLACE and enter the fog.
   *  This mirrors respawn()'s reset (clear the map, restore counters, re-seal
   *  the districts, restart the waves, respawn the player) but rolls all the
   *  way back to zero. Doing it in place — instead of reloading the page —
   *  keeps the click that chose NEW GAME as a live user gesture, so pointer
   *  lock engages and the player starts playing immediately (a page reload
   *  would drop the gesture and strand them on the title screen). */
  restartRun() {
    for (const z of this.spawner.zombies) z.toRemove = true;
    this.citizens.reset();
    this.score.restore({ kills: 0, points: 0, byType: { Walker: 0, Sprinter: 0, Tank: 0 }, shotsFired: 0, shotsHit: 0 });
    this.score.timePlayed = 0;
    this.score.victory = false;
    this.world.zones.syncTo(0);
    this.waves.restartAtWave(1);
    // Refill the guns to the starting loadout and bank it as the new checkpoint.
    // The pristine loadout is a PISTOL loadout: anything found out in the town
    // — the coachgun in the blue house, the blaster at the crash site — goes
    // back where it was found, so a new run really is a new run.
    this.weapons.resetUnlocked();
    this.weapons.restoreAmmo(this._pristineAmmo);
    this.world.resetGunCache();
    // ...and the sighting has not happened yet either.
    this.world.flyby?.reset();
    // An empty purse, no hardware in the field, and the vendor's shelves full
    // again — a new run starts where the first one did.
    this.tokens.restore({ tokens: 0, earned: 0, spent: 0 });
    this.sentries.reset();
    this.companions.reset();
    this.shop.resetStock();
    // The cabinets go back to attract too: high scores and half-finished runs
    // belong to the run that set them.
    this.arcade.resetRun();
    this._arcadePaid = null;
    this.checkpoint = {
      wave: 0, score: this.score.snapshot(), weapons: this.weapons.snapshotAmmo(),
      tokens: this.tokens.snapshot(),
    };
    this.player.respawn();
    this.startPlaying();
  }

  /** RESUME LAST SESSION: restore the saved run's counters, wave and gates,
   *  then enter the fog. Only offered before this session's run begins. */
  resumeSession() {
    const s = this.saves.data;
    if (s && !this.runStarted) {
      this.score.restore({
        kills: s.kills | 0,
        points: s.points | 0,
        byType: { ...(s.byType || {}) },
        shotsFired: s.shotsFired | 0,
        shotsHit: s.shotsHit | 0,
      });
      this.score.timePlayed = s.timePlayed || 0;
      // The purse comes back with the run. Coins are a resource the player
      // earned and did not spend, so a resumed session that forgot them would
      // be quietly taking money off the table.
      this.tokens.restore(s.tokens ?? { tokens: 0, earned: 0, spent: 0 });
      // ...and so do the cabinet high scores, along with which machines have
      // already paid out, so a resumed session cannot farm the coin tray by
      // clearing BRICKFALL a second time.
      this.arcade.restore(s.arcade);
      // ...and the weapons the run had FOUND. A saved session that came back
      // without the coachgun the player walked into Eastgate to get would be
      // taking it off them for the crime of saving.
      this.weapons.restoreUnlocked(s.weaponsFound);
      // ...and the case it came out of stays empty, so a resumed run does not
      // find a second one lying in the blue house.
      if (s.weaponsFound?.includes('shotgun')) this.world.emptyGunCache();
      this.sentries.restore(s.sentries);
      this.companions.restore(s.companion);
      this._arcadePaid = new Set((s.arcade?.paid || []).filter((id) => MACHINE_IDS.includes(id)));
      const wave = Math.max(1, s.wave | 0);
      this.world.zones.syncTo(this.score.kills);
      this.waves.restartAtWave(wave);
      this.checkpoint = {
        wave, score: this.score.snapshot(), weapons: this.weapons.snapshotAmmo(),
        tokens: this.tokens.snapshot(),
      };
    }
    this.startPlaying();
  }

  /** Snapshot the live run for persistence (see SaveSystem / scripts/serve.mjs). */
  captureSession() {
    const st = this.score.stats();
    // Saving mid-wave resumes THAT wave; saving in a respite resumes the next.
    const wave = Math.max(1, this.waves.state === 'respite' ? this.waves.wave + 1 : this.waves.wave);
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      kills: st.kills, points: st.points, byType: st.byType,
      shotsFired: st.shotsFired, shotsHit: st.shotsHit, accuracy: st.accuracy,
      timePlayed: st.timePlayed,
      // The purse rides along with the run, so a saved session comes back with
      // what it had banked (see TokenSystem.snapshot / resumeSession).
      tokens: this.tokens.snapshot(),
      // So do the cabinet high scores. A score nobody can see again the next
      // time they sit down is not a high score, it is a number that was on
      // screen once. `paid` is which machines have already dropped something
      // in the tray, so the reward stays a first-clear reward.
      arcade: { ...this.arcade.snapshot(), paid: [...(this._arcadePaid || [])] },
      // The hardware you bought rides with the run: the sentries you have not
      // used up, and the adjutant — folded or standing, with her orders.
      sentries: this.sentries.snapshot(),
      companion: this.companions.snapshot(),
      wave,
      // Which weapons this run has found (the coachgun, the blaster).
      weaponsFound: this.weapons.snapshotUnlocked(),
      secretsFound: this.world.secrets.found.size,
      secretsTotal: this.world.secrets.total,
      health: Math.round(this.player.health),
    };
  }

  saveSession() { return this.saves.save(this.captureSession()); }

  /** Persist the live run every few minutes, so progress survives a crash or a
   *  forgotten quit. Only fires while a run is actually in progress; disabled
   *  under the test harness. */
  _startAutosave(intervalMs = 4 * 60 * 1000) {
    if (this.testMode) return;
    if (this._autosaveTimer) clearInterval(this._autosaveTimer);
    this._autosaveTimer = setInterval(() => {
      if (this.runStarted && (this.state.is('playing') || this.state.is('paused'))) {
        this.saveSession();
        this.events.emit('subtitle', { text: 'Run auto-saved.' });
      }
    }, intervalMs);
  }

  /** Back to the title screen; the run stays live behind it (RETURN TO RUN).
   *  The run is saved on the way out so the LAST SESSION card — and any later
   *  RESUME — always reflect where the player left off. */
  quitToTitle() {
    if (!this.state.to('menu')) return;
    this.audio.setTrack('menu');
    this.saveSession();
    this.input.releasePointerLock();
    this.hud.showScreen('menu');
  }

  /** Desktop shell EXIT GAME: persist the live run, then close the process
   *  (game window + internal server + launcher). No-op fallback in a browser. */
  async exitGame() {
    try { await this.saveSession(); } catch { /* best-effort save */ }
    Shell.quit();
  }

  /** Apply a settings snapshot live (from the SettingsStore) — camera feel,
   *  audio level and the re-bindable key/mouse map. */
  applySettings(s) {
    this.player.sensitivity = s.sensitivity;
    this.player.invertY = !!s.invertY;
    this.renderer.setBaseFov(s.fov);
    this.renderer.setDetail(s.detail ?? 1);
    // The HUD's own CSS scanline pass stands down while the renderer is
    // drawing real ones (see styles.css #hud.tube).
    this.hudRoot.classList.toggle('tube', this.renderer.detail > 0);
    // Two independent levels: the score and everything else (see AudioManager).
    this.audio.setMusicVolume(s.musicVolume);
    this.audio.setSfxVolume(s.sfxVolume);
    this.input.setBindings(s.bindings);
  }

  /**
   * A machine paid out. The first clear on each cabinet leaves something in
   * the coin tray — a working arcade in a dead town ought to be worth the
   * detour, not just a curiosity you look at once.
   */
  _arcadeScore(id, score, best, won) {
    if (!won || this._arcadePaid?.has(id)) return;
    (this._arcadePaid ??= new Set()).add(id);
    const p = this.player.position;
    const drop = [['health', 25], ['ammo_rifle', 60], ['ammo_shotgun', 12], ['ammo_sniper', 8]];
    const [type, amount] = drop[[...this._arcadePaid].length - 1] ?? drop[0];
    this.events.emit('loot:spawn', {
      x: p.x + (Math.random() - 0.5), y: p.y + 0.5, z: p.z + (Math.random() - 0.5), type, amount,
    });
    this.events.emit('subtitle', { text: 'Something drops into the coin tray. It was never a coin machine.' });
  }

  pause() {
    if (!this.state.to('paused')) return;
    // Give the pointer back, and — the part that matters — stop WANTING it.
    // A resume whose lock request was refused leaves a standing request behind
    // it (see Input.requestPointerLock); pausing again on top of that would
    // otherwise have the retry pump grab the pointer back underneath the menu.
    this.input.releasePointerLock();
    // Show the case FIRST, then write the readouts into it. The instruments
    // animate from a rest pose, and a transition cannot run on an element that
    // was display:none when its "before" value was set — fill it while hidden
    // and every needle, cell and tape snaps straight to its value instead.
    this.hud.showScreen('pause');
    this.hud.fillPauseStats(this.score.stats(), {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      wave: {
        n: this.waves.wave,
        quota: this.waves.quota,
        cleared: Math.min(this.waves.killsThisWave, this.waves.quota),
        state: this.waves.state,
      },
    });
  }

  respawn() {
    if (!this.state.to('playing')) return;
    // Roll the run back to the last checkpoint (every tenth wave). Every zombie
    // on the map dies, the stats and wave restore to the checkpoint, and that
    // wave respawns from scratch — e.g. dying at wave 45 drops you back to 40.
    const cp = this.checkpoint;
    for (const z of this.spawner.zombies) z.toRemove = true;
    this.citizens.reset();
    this.score.restore(cp.score);
    // Reapply the ammo the player held at the checkpoint — dying no longer means
    // crawling back out with the empty magazines you died on.
    this.weapons.restoreAmmo(cp.weapons);
    // ...and the purse with it: the tokens they had banked at the checkpoint.
    this.tokens.restore(cp.tokens);
    /**
     * THE HARDWARE COMES HOME, ALL OF IT, INTO THE SATCHEL.
     *
     * Dying costs the player the wave they were on. It does not cost them kit
     * they paid tokens for, and it must not leave that kit where they died —
     * a respawn puts them back at the spawn point, and a rollback used to put
     * their sentries back wherever the CHECKPOINT had them, which is a
     * different place again and usually a long walk from either.
     *
     * So: every sentry folds up (the ones bolted down and the one in their
     * hands), the adjutant folds up, and the cube comes back from wherever it
     * was set down — all of it stowed, none of it destroyed, and whatever was
     * already in the satchel left exactly where it was. The one thing that
     * cannot come back is the cube nobody has found yet: it is not the
     * player's until they have found it once.
     *
     * These ARE the satchel's droppables (Inventory's DROPPABLE), which is the
     * invariant to keep: anything the satchel can put out into the world is
     * something this has to be able to fetch back. `recallAll` covers every
     * kind of sentry there is, so a new mark of machine is already handled
     * here the day it is added.
     */
    const recovered = this.sentries.recallAll()
      + (this.companions.recall({ quiet: true }) ? 1 : 0)
      + (this.world.companionCube?.recall() ? 1 : 0);
    if (recovered > 0) {
      this.events.emit('subtitle', { text: 'Everything you had out in the field is back in the satchel.' });
    }
    // Re-seal the districts that the rolled-back kill count no longer clears, so
    // the section walls stand again (and reopen as the player re-earns them).
    this.world.zones.syncTo(cp.score.kills);
    this.waves.restartAtWave(Math.max(1, cp.wave));
    this.player.respawn();
    this.hud.showScreen(null);
    if (!this.testMode) this.input.requestPointerLock();
  }

  _dropSupplies() {
    const p = this.player.position;
    const n = 3 + ((Math.random() * 3) | 0);
    const kinds = ['ammo_rifle', 'ammo_shotgun', 'ammo_sniper', 'health', 'ammo_rifle'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 9;
      const type = kinds[(Math.random() * kinds.length) | 0];
      const amount = type === 'health' ? 25 : type === 'ammo_sniper' ? 5 : type === 'ammo_shotgun' ? 8 : 30;
      this.events.emit('loot:spawn', { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, type, amount });
    }
  }

  start() {
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._lastT) / 1000);
      this._lastT = now;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  frame(dt) {
    // The satchel, the arcade and the vendor's counter all freeze the world
    // while they are open (the mouse is on the UI).
    if (this.state.is('menu')) {
      this._menuCinematic(dt);
    } else if (this.state.is('playing') && !this.inventory.open && !this.arcade.open
      && !this.shop.open && !this.radial.open) {
      this.time += dt;
      this.update(dt);
    }
    // The machine and the vendor run on their own clocks while the town holds
    // its breath — a shop whose proprietor stood still would be a photograph.
    this.arcade.update(dt);
    this.shop.update(dt);
    // No first-person weapon floating over the title cinematic.
    this.renderer.overlayEnabled = !this.state.is('menu');
    this.renderer.render();
    // Keep asking for the pointer if a resume did not get it first time (see
    // Input.requestPointerLock). Silently: the player is not told to go and
    // click something, because getting the pointer back is not their job.
    this.input.pump();
    // ...and while the game is being played the pointer is the game's, granted
    // or not, so the system cursor stays out of sight (see HUD.setPlayCursor).
    this.hud.setPlayCursor(this.state.is('playing')
      && !this.inventory.open && !this.arcade.open && !this.shop.open
      && !this.radial.open && !this.devConsole.open);
    this.input.endFrame();
  }

  /**
   * The title-screen backdrop: a slow cinematic orbit through the LIVE town —
   * the same scene, sky and ambient systems the run uses (day cycle rolling,
   * clouds drifting, the clocktower keeping time, the windmill turning), with
   * the combat sim itself left untouched.
   *
   * The orbit is held on THE PLAYER, not on the middle of the map. It used to
   * be nailed to the world origin, which is not where anybody ever is: the
   * spawn itself stands twenty metres up the square, and quitting to the title
   * mid-run (RETURN TO TITLE, which leaves the run live behind the menu) showed
   * you Old Town no matter whether you had walked out to Chapel Ridge or the
   * industrial flats. Now the camera swings around wherever the player actually
   * stands, with that spot dead centre of frame — so the title screen is always
   * a shot of where you are, and picking RESUME drops you into the place you
   * were just looking at.
   */
  _menuCinematic(dt) {
    this._menuT += dt;
    const t = this._menuT;
    const cam = this.renderer.camera;
    const f = this.player.position;
    const ang = t * 0.045;
    const baseR = 38 + Math.sin(t * 0.021) * 6;
    const baseY = 14.5 + Math.sin(t * 0.037) * 2.5;
    // What the shot is centred on: the ground the player is standing on, a
    // little above their boots so the framing carries some of the street.
    const tx = f.x, ty = f.y + 2.2, tz = f.z;

    // Take the widest framing that still has a clear line to that spot, then
    // EASE onto it — the ladder is sampled continuously, so when a wall or a
    // rooftop comes between the lens and the player the shot climbs and tightens
    // over a beat instead of snapping the moment a chimney clips the line.
    let want = MENU_FRAMINGS.length - 1;
    for (let i = 0; i < MENU_FRAMINGS.length; i++) {
      const p = this._menuEye(f, ang, baseR, baseY, i);
      if (this.world.hasLineOfSight(p.x, p.y, p.z, tx, ty, tz)) { want = i; break; }
    }
    this._menuFrame += (want - this._menuFrame) * Math.min(1, dt * 1.6);
    const eye = this._menuEye(f, ang, baseR, baseY, this._menuFrame);

    cam.position.set(eye.x, eye.y, eye.z);
    cam.lookAt(tx, ty, tz);
    this.sky.update(dt, cam.position);
    this.world.updateAmbient(dt, this.time + t, cam.position);
  }

  /**
   * Camera position for one (fractional) rung of the title-orbit framing
   * ladder — see MENU_FRAMINGS and _menuCinematic.
   */
  _menuEye(f, ang, baseR, baseY, rung) {
    const last = MENU_FRAMINGS.length - 1;
    const lo = Math.max(0, Math.min(last, Math.floor(rung)));
    const hi = Math.min(last, lo + 1);
    const k = Math.max(0, Math.min(1, rung - lo));
    const rMul = MENU_FRAMINGS[lo][0] + (MENU_FRAMINGS[hi][0] - MENU_FRAMINGS[lo][0]) * k;
    const lift = MENU_FRAMINGS[lo][1] + (MENU_FRAMINGS[hi][1] - MENU_FRAMINGS[lo][1]) * k;
    const r = baseR * rMul;
    const x = f.x + Math.cos(ang) * r;
    const z = f.z + Math.sin(ang) * r;
    // ...and never let the lens dip into the ground it is swinging over: the
    // orbit is a fixed radius, but the town underneath it is a heightfield.
    const y = Math.max(f.y + baseY + lift, this.world.groundHeightFor(x, z, 1e9) + 5);
    return { x, y, z };
  }

  update(dt) {
    const cam = this.renderer.camera;
    this.score.tick(dt);

    if (this.player.alive) {
      this.player.update(dt);
      // A sentry in the hands stows the gun: the click that places it must
      // never also be a trigger pull (see SentrySystem / WeaponView).
      if (!this.sentries.holding) this.weapons.update(dt, this.input);
    }

    // interaction
    const it = this.world.nearestInteractable(this.player.position.x, this.player.position.y, this.player.position.z);
    // Name the machine that is actually in the hands: with two marks of
    // sentry in the satchel, "the sentry" stops being an identification.
    this._prompt = this.sentries.holding
      ? `Click to place the ${SENTRY_KINDS[this.sentries.holding].label} · right-click to put it away`
      : it ? it.prompt : null;
    if (it && !this.sentries.holding && this.input.wasActionPressed('interact')) it.onInteract();

    // AI + simulation. One shared sensory context: the player, the zombie
    // horde and the friendly roster, so every agent perceives the same world.
    const pathBudget = { n: 4 };
    const ctx = {
      player: this.player,
      camPos: cam.position,
      pathBudget,
      time: this.time,
      zombies: this.spawner.zombies,
      friendlies: this.friendlies,
      isDay: this.sky.isDay,
      dayFactor: this.sky.dayFactor,
    };
    for (const z of this.spawner.zombies) z.update(dt, ctx);
    this.spawner.update(dt, this.player);
    this.waves.update(dt, this.player.alive);
    this.npc.update(dt, ctx);
    this.cockroach.update(dt, ctx);
    this.citizens.update(dt, ctx);
    this.shopkeeper.update(dt, ctx);
    // The sentries shoot from the same zombie list the horde is stepped with,
    // and the held one reads the mouse for its placement click.
    this.sentries.update(dt, ctx, this.input, this.radial?.open || this.shop?.open);
    // ...and the adjutant walks, fights and takes her orders off the same list.
    this.companions.update(dt, ctx);

    // x-ray cheat: run this AFTER the spawner (so any zombies streamed in this
    // frame already exist and get caught) and after the NPCs move.
    this.applyXray();
    this.pickups.update(dt, this.time, this.player, cam.position);
    this.world.update(dt, this.time, cam.position);
    this.sky.update(dt, cam.position);
    this.effects.update(dt, cam.position);
    // The soundtrack reads the two things that change continuously: where the
    // player is standing (which district's track plays) and how close to dead
    // they are (which arrangement of it plays). See audio/Music.js.
    this.audio.update(dt, this.player, this.spawner.nearbyCount(this.player), {
      zoneId: this.world.zones.zoneAt(this.player.position.x, this.player.position.z).id,
      healthFrac: this.player.health / this.player.maxHealth,
      waveActive: this.waves.state === 'active',
    });
    // How hurt you are is readable off the picture itself: the signal gets
    // noisier and the hum bar climbs as health falls.
    this.renderer.updateSignal(dt, this.player.health / this.player.maxHealth);

    // camera + first-person layer
    this.player.applyCamera(cam, this.effects.shakeOffset());
    this.viewModel.update(dt, this.player, this.weapons);

    // HUD snapshot
    this.hud.update(dt, {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      stamina: this.player.staminaFrac,
      sprinting: this.player.sprinting,
      winded: this.player.winded,
      weapons: this.weapons.hudState(),
      kills: this.score.kills,
      points: this.score.points,
      tokens: this.tokens.tokens,
      accuracy: this.score.accuracy,
      wave: {
        n: this.waves.wave, state: this.waves.state, respiteLeft: this.waves.respiteLeft,
        quota: this.waves.quota, killsThisWave: this.waves.killsThisWave,
      },
      zoneName: this.world.zones.zoneAt(this.player.position.x, this.player.position.z).name,
      secrets: { found: this.world.secrets.found.size, total: this.world.secrets.total },
      prompt: this._prompt,
    });
  }

  /** Every NPC mesh the x-ray cheat reveals: the whole zombie horde plus the
   *  friendly/critter roster. Read live each call so streamed-in zombies and a
   *  freshly-spawned citizen are always covered. */
  *_npcMeshes() {
    for (const z of this.spawner.zombies) if (z.mesh) yield z.mesh;
    if (this.npc?.mesh) yield this.npc.mesh;
    if (this.cockroach?.mesh) yield this.cockroach.mesh;
    if (this.citizens?.citizen?.mesh) yield this.citizens.citizen.mesh;
    if (this.shopkeeper?.mesh) yield this.shopkeeper.mesh;
  }

  /**
   * Push the x-ray state onto every NPC mesh. While the cheat is ON this runs
   * every frame so newly-spawned NPCs inherit it; the frame after it is turned
   * OFF, `_xrayActive` is still true so one final pass restores everything,
   * then it goes quiet. Also callable directly (the console command does) so
   * the toggle takes effect on the same frame with no visible lag.
   */
  applyXray() {
    if (!this.xray && !this._xrayActive) return;
    for (const mesh of this._npcMeshes()) setSeeThrough(mesh, this.xray);
    this._xrayActive = this.xray;
  }
}

/**
 * Draw an object (and its descendants) on top of the world regardless of what
 * stands between it and the camera — the "see through walls" primitive behind
 * the x-ray cheat. Turning it on disables depth testing (so walls no longer
 * occlude the sprite) and lifts the render order far above any world geometry
 * (max in-world is 3), so the sprite is drawn last and wins every pixel.
 * Originals are stashed in userData and restored on the way back, so a mesh
 * that started with its own render order (e.g. a decal) is left exactly as it
 * was. Idempotent: re-applying the same state is a cheap no-op-ish reassign.
 */
const XRAY_RENDER_ORDER = 4000;
// How long after an overlay closes an unlock still counts as the tail of the
// keypress that closed it rather than the player leaving. Long enough to cover
// Chromium's grant-then-revoke on Escape, short enough that a player who
// closes the satchel and immediately alt-tabs still gets their pause screen.
const POINTER_REGRAB_MS = 700;
function setSeeThrough(root, on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (on) {
        if (m.userData.xrayDepthTest === undefined) m.userData.xrayDepthTest = m.depthTest;
        m.depthTest = false;
      } else if (m.userData.xrayDepthTest !== undefined) {
        m.depthTest = m.userData.xrayDepthTest;
        delete m.userData.xrayDepthTest;
      }
    }
    if (on) {
      if (o.userData.xrayRenderOrder === undefined) o.userData.xrayRenderOrder = o.renderOrder;
      o.renderOrder = XRAY_RENDER_ORDER;
    } else if (o.userData.xrayRenderOrder !== undefined) {
      o.renderOrder = o.userData.xrayRenderOrder;
      delete o.userData.xrayRenderOrder;
    }
  });
}
