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
import { PickupManager } from '../entities/Pickups.js';
import { WeaponManager } from '../weapons/WeaponManager.js';
import { ScoreSystem } from '../systems/ScoreSystem.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { SpawnSystem } from '../systems/SpawnSystem.js';
import { GameState } from '../systems/GameState.js';
import { Inventory } from '../systems/Inventory.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { Effects } from '../rendering/Effects.js';
import { WeaponView } from '../rendering/WeaponView.js';
import { HUD } from '../rendering/HUD.js';
import { AudioManager } from '../audio/AudioManager.js';
import { Shell } from './Shell.js';

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
    this.pickups = new PickupManager(this.events, this.world, this.texLib, this.renderer.scene);
    this.pickups.seedInitial();
    this.npc = new NPC(this.events, this.world, this.texLib.get('npcPeaceful'));
    this.renderer.scene.add(this.npc.mesh);
    // Friendlies zombies may fall back to hunting, and the roster the NPCs
    // sense threats from — one list, so new NPC archetypes just slot in.
    this.friendlies = [this.npc];
    // The AI-test cockroach: wanders, hides indoors by day, roams out at
    // night, and skitters away from the player.
    this.cockroach = new Cockroach(this.events, this.world);
    this.renderer.scene.add(this.cockroach.mesh);
    this.effects = new Effects(this.events, this.renderer.scene, this.texLib, this.player);
    this.viewModel = new WeaponView(this.events, this.renderer, this.texLib);
    this.audio = new AudioManager(this.events);
    this.hud = new HUD(this.events, this.hudRoot, {
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
      canOpen: () => this.state.is('playing') && !this.devConsole.open,
      onOpen: () => {
        this.input.setSuppressed(true);
        if (!this.testMode) this.input.releasePointerLock();
      },
      onClose: () => {
        this.input.setSuppressed(false);
        if (!this.testMode && this.state.is('playing')) this.input.requestPointerLock();
      },
    });

    this._wire();
    this.state.to('menu');
    this.hud.showScreen('menu');
    return this;
  }

  _wire() {
    // Losing pointer lock while playing = pause (unless the satchel took it).
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state.is('playing') && !this.testMode && !this.inventory.open) this.pause();
    };
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.testMode && !this.devConsole.open) {
        if (this.state.is('playing')) this.pause();
        else if (this.state.is('paused')) this.startPlaying();
      }
    });

    // Checkpoint every tenth wave: snapshot the run so a death rolls back to it.
    this.events.on('wave:start', ({ wave }) => {
      if (wave % 10 === 0) this.checkpoint = { wave, score: this.score.snapshot() };
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

    // Clicking the Companion Cube in the satchel sets it back down on the
    // ground just ahead of the player (see CompanionCube.dropAt).
    this.events.on('inventory:drop', ({ type }) => {
      if (type !== 'companionCube') return;
      const p = this.player;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      this.world.companionCube.dropAt(
        p.position.x + fx * 1.5, p.position.z + fz * 1.5, p.position.y);
      this.inventory.close();
    });
  }

  startPlaying() {
    if (!this.state.to('playing')) return;
    this.runStarted = true;
    this.hud.showScreen(null);
    this.audio.unlock();
    if (!this.testMode) this.input.requestPointerLock();
  }

  /** NEW GAME from the title. A live run parked behind the menu can only be
   *  discarded by a full reboot — the world is built once per page load. */
  newGame() {
    if (this.runStarted) { location.reload(); return; }
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
      const wave = Math.max(1, s.wave | 0);
      this.world.zones.syncTo(this.score.kills);
      this.waves.restartAtWave(wave);
      this.checkpoint = { wave, score: this.score.snapshot() };
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
      wave,
      secretsFound: this.world.secrets.found.size,
      secretsTotal: this.world.secrets.total,
      health: Math.round(this.player.health),
    };
  }

  saveSession() { return this.saves.save(this.captureSession()); }

  /** Back to the title screen; the run stays live behind it (RETURN TO RUN),
   *  and is auto-saved so the LAST SESSION card is always current. */
  quitToTitle() {
    if (!this.state.to('menu')) return;
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

  /** Live settings from the title menu (persisted there in localStorage). */
  applySettings(s) {
    this.player.sensitivity = s.sensitivity;
    this.player.invertY = !!s.invertY;
    this.renderer.setBaseFov(s.fov);
    this.audio.setVolume(s.volume);
  }

  pause() {
    if (!this.state.to('paused')) return;
    this.hud.fillPauseStats(this.score.stats(), {
      found: this.world.secrets.found.size,
      total: this.world.secrets.total,
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      wave: {
        n: this.waves.wave,
        quota: this.waves.quota,
        cleared: Math.min(this.waves.killsThisWave, this.waves.quota),
        state: this.waves.state,
      },
    });
    this.hud.showScreen('pause');
  }

  respawn() {
    if (!this.state.to('playing')) return;
    // Roll the run back to the last checkpoint (every tenth wave). Every zombie
    // on the map dies, the stats and wave restore to the checkpoint, and that
    // wave respawns from scratch — e.g. dying at wave 45 drops you back to 40.
    const cp = this.checkpoint;
    for (const z of this.spawner.zombies) z.toRemove = true;
    this.score.restore(cp.score);
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
    // The satchel freezes the world while it's open (mouse is on the UI).
    if (this.state.is('menu')) {
      this._menuCinematic(dt);
    } else if (this.state.is('playing') && !this.inventory.open) {
      this.time += dt;
      this.update(dt);
    }
    // No first-person weapon floating over the title cinematic.
    this.renderer.overlayEnabled = !this.state.is('menu');
    this.renderer.render();
    this.input.endFrame();
  }

  /**
   * The title-screen backdrop: a slow cinematic orbit of the plaza through
   * the LIVE town — the same scene, sky and ambient systems the run uses
   * (day cycle rolling, clouds drifting, the clocktower keeping time, the
   * windmill turning), with the combat sim itself left untouched.
   */
  _menuCinematic(dt) {
    this._menuT += dt;
    const t = this._menuT;
    const cam = this.renderer.camera;
    const ang = t * 0.045;
    const r = 38 + Math.sin(t * 0.021) * 6;
    cam.position.set(Math.cos(ang) * r, 14.5 + Math.sin(t * 0.037) * 2.5, Math.sin(ang) * r);
    cam.lookAt(0, 3.5, 0);
    this.sky.update(dt, cam.position);
    this.world.updateAmbient(dt, this.time + t, cam.position);
  }

  update(dt) {
    const cam = this.renderer.camera;
    this.score.tick(dt);

    if (this.player.alive) {
      this.player.update(dt);
      this.weapons.update(dt, this.input);
    }

    // interaction
    const it = this.world.nearestInteractable(this.player.position.x, this.player.position.y, this.player.position.z);
    this._prompt = it ? it.prompt : null;
    if (it && this.input.wasPressed('KeyE')) it.onInteract();

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
    this.pickups.update(dt, this.time, this.player, cam.position);
    this.world.update(dt, this.time, cam.position);
    this.sky.update(dt, cam.position);
    this.effects.update(dt, cam.position);
    this.audio.update(dt, this.player, this.spawner.nearbyCount(this.player));

    // camera + first-person layer
    this.player.applyCamera(cam, this.effects.shakeOffset());
    this.viewModel.update(dt, this.player, this.weapons);

    // HUD snapshot
    this.hud.update(dt, {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      weapons: this.weapons.hudState(),
      kills: this.score.kills,
      points: this.score.points,
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
}
