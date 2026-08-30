import * as THREE from '../../lib/three.module.js';
import { installSurfaceShading, setDetail } from './SurfaceShading.js';
import { PostFX } from './PostFX.js';

/**
 * WebGL scene setup tuned for the retro look:
 *  - fixed ~90° horizontal FOV (vertical FOV derived from aspect)
 *  - renders at reduced internal resolution
 *  - distance fog fading into a dark dusk sky
 *  - flat, pleasant lighting (hemisphere + low warm sun), no shadow maps
 *
 * On top of that base it owns the two pieces of the visual pass that have to
 * exist before anything else is built:
 *
 *  - the SURFACE SHADING extension (rendering/SurfaceShading.js), installed
 *    into the Lambert shader here because it has to be in place before the
 *    first material in the game compiles;
 *  - the PRESENTATION chain (rendering/PostFX.js), which the frame is drawn
 *    through instead of straight to the canvas.
 *
 * Those two change what the canvas IS, which is why sizing lives here.
 * Unposted, the canvas is the old reduced-resolution buffer stretched up by
 * the browser. Posted, the canvas is the TUBE and runs at full native
 * resolution, with the small PS1-sized framebuffer living inside PostFX — the
 * console's pixels have to stay chunky while the scanlines and the phosphor
 * grille over them stay razor sharp, and one buffer cannot do both.
 *
 * Both halves are governed by one `detail` level, so the whole thing is one
 * switch.
 *
 * Contains no gameplay logic; systems hand it a scene graph to draw.
 */
export const HORIZONTAL_FOV = 90;
export const FOG_FAR = 160;
const RENDER_SCALE = 0.75;

/* ========================= THE GAME FITS THE MACHINE =======================
 *
 * The tube is the one pass in this renderer that runs per DEVICE pixel, and on
 * a high-density screen that is four times the work of the same picture on a
 * 1080p panel — for a grille whose stripes are three pixels wide either way.
 * On a machine with the fill rate to spare that is exactly the right trade and
 * nothing here touches it. On a machine without it, it is the difference
 * between a game and a slideshow, and a slideshow is not a look.
 *
 * So the output scale is watched rather than fixed. Frame times are sampled,
 * and if the frame budget is being missed for long enough that it is load
 * rather than a hiccup, the tube steps down one rung; when the headroom comes
 * back it steps up again. It never goes below one device pixel per CSS pixel —
 * that is the floor the picture was designed at — and it never changes the
 * framing, the console's own resolution, the grade or the post chain, so the
 * game looks like itself the whole way down. Nothing here is visible to
 * gameplay: the simulation, the camera and the FOV are untouched.
 */
/** Output-scale rungs, best first. Multipliers on the posted pixel ratio. */
const SCALE_RUNGS = [1, 0.82, 0.68, 0.55];
/** Frame time we are trying to stay under, and the one we climb back at. */
const BUDGET_MS = 20.5;      // ~48 fps: past here the game is visibly costing
const HEADROOM_MS = 13.0;    // ~77 fps: comfortably paying for another rung
/** Frames of evidence before either move, so a single hitch changes nothing. */
const ADAPT_WINDOW = 45;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    // Before any material exists: teach MeshLambertMaterial about relief maps.
    installSurfaceShading();
    this.postfx = new PostFX(this.renderer);
    this.detail = 1;

    this.scene = new THREE.Scene();
    // Fog and sky share one color so distant geometry melts into the haze
    // instead of silhouetting against it. The Sky system drives both colours
    // (and the lights below) each frame over the day/night cycle.
    const sky = new THREE.Color(0x35414f);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 40, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 210);
    this.baseZoom = 1;
    this.hFov = HORIZONTAL_FOV; // adjustable via settings (setBaseFov)

    // Optional first-person weapon overlay: its own scene + camera, drawn on
    // top of the world with the depth buffer cleared so the viewmodel never
    // clips through geometry and is untouched by the world's distance fog.
    // overlayEnabled lets the game hide it (e.g. behind the title cinematic).
    this.overlayScene = null;
    this.overlayCamera = null;
    this.overlayEnabled = true;

    // Lighting: a hemisphere fill, a directional "sun/moon", and ambient.
    // Exposed so the Sky system can animate colour and intensity through the
    // day; defaults here are the daytime values (in case Sky is absent).
    this.hemiLight = new THREE.HemisphereLight(0xb4c2d8, 0x4a483a, 1.15);
    this.scene.add(this.hemiLight);
    this.sunLight = new THREE.DirectionalLight(0xe8c890, 1.25);
    this.sunLight.position.set(-0.4, 0.55, 0.25).multiplyScalar(100);
    this.scene.add(this.sunLight);
    this.sunDirection = this.sunLight.position.clone().normalize();
    this.ambLight = new THREE.AmbientLight(0x49525f, 0.8);
    this.scene.add(this.ambLight);
    // How much daylight there is, 0 (night) … 1 (full day). Written by the Sky
    // each frame and read by anything that has to keep step with it — the
    // first-person weapon rig lights and reflects itself off this rather than
    // carrying its own private idea of what time it is (see WeaponView).
    this.daylight = 1;

    // Output-scale governor — see THE GAME FITS THE MACHINE.
    this._rung = 0;
    this._samples = new Float32Array(ADAPT_WINDOW);
    this._nSamples = 0;
    this._holdOff = 0;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * One frame's worth of evidence about whether this machine can afford the
   * picture it is being asked to draw. Called from the frame loop with the
   * frame's own wall time; moves the output scale at most one rung at a time
   * and never inside the hold-off after a move (a resize reallocates the post
   * chain's targets, which is itself a hitch).
   */
  adapt(frameMs) {
    if (!this.postfx?.enabled) return;      // unposted is already the cheap path
    if (this._holdOff > 0) { this._holdOff--; return; }
    if (!(frameMs > 0) || frameMs > 500) return;   // a load stall is not a frame
    this._samples[this._nSamples++] = frameMs;
    if (this._nSamples < ADAPT_WINDOW) return;
    this._nSamples = 0;
    // The MEDIAN, not the mean: one 200 ms frame while a wave streams in must
    // not be able to argue the whole picture down a rung on its own.
    const sorted = Array.from(this._samples).sort((a, b) => a - b);
    const med = sorted[ADAPT_WINDOW >> 1];
    let rung = this._rung;
    if (med > BUDGET_MS && rung < SCALE_RUNGS.length - 1) rung++;
    else if (med < HEADROOM_MS && rung > 0) rung--;
    if (rung === this._rung) return;
    this._rung = rung;
    this._holdOff = ADAPT_WINDOW * 2;
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const posted = !!this.postfx?.enabled;
    // Posted, the canvas is the tube and it is drawn at TRUE DEVICE PIXELS.
    // That is not a quality nicety, it is the difference between a phosphor
    // grille and a rainbow of moire: the stripes are three pixels wide, so on
    // a HiDPI screen — or any browser zoom that lands on a fraction — a canvas
    // measured in CSS pixels gets resampled on its way to the glass and the
    // grille beats against the display's own grid. Capped at 2x, past which
    // the stripes are finer than anyone can see and it is only cost.
    // Unposted: the old reduced buffer at ratio 1, exactly as it always was.
    // ...and never below one device pixel per CSS pixel, whatever the governor
    // thinks: that is the resolution the picture was drawn for.
    const ratio = posted
      ? Math.max(1, Math.min(2, window.devicePixelRatio || 1) * SCALE_RUNGS[this._rung ?? 0])
      : 1;
    const bw = posted ? w : Math.floor(w * RENDER_SCALE);
    const bh = posted ? h : Math.floor(h * RENDER_SCALE);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(bw, bh, false);
    // The console framebuffer is sized from the DRAWING buffer, not the CSS
    // box, and is capped by line count either way — so raising the ratio
    // sharpens the tube without making the world any more expensive to draw.
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.postfx?.setSize(buf.x, buf.y);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.applyFov();
  }

  /**
   * Settings hook: how much of the visual pass to run, 0..1.
   *
   * One number drives both halves — surface relief and the post chain — so
   * 0 gives back the plain, cheap frame the game drew before any of this
   * existed, live, with no reload and no recompile.
   */
  setDetail(v) {
    this.detail = Math.max(0, Math.min(1, Number(v) || 0));
    setDetail(this.detail);
    this.postfx?.setLevel(this.detail);
    this.resize(); // the canvas means something different on either side of 0
  }

  /** Advance the live tube signal (see PostFX.Signal). */
  updateSignal(dt, healthFrac) {
    this.postfx?.update(dt, healthFrac);
  }

  /** Kick the tube: 'surge' | 'damage' | 'glitch'. */
  pulse(kind, amount) {
    this.postfx?.pulse(kind, amount);
  }

  /** Keep the horizontal FOV fixed regardless of aspect; zoom scales it. */
  applyFov(zoomFactor = this.baseZoom) {
    this.baseZoom = zoomFactor;
    const hRad = (this.hFov * Math.PI / 180) / zoomFactor;
    const vRad = 2 * Math.atan(Math.tan(hRad / 2) / this.camera.aspect);
    this.camera.fov = vRad * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** Settings hook: change the base horizontal FOV (default 90°). */
  setBaseFov(deg) {
    this.hFov = Math.max(60, Math.min(120, Number(deg) || HORIZONTAL_FOV));
    this.applyFov();
  }

  /** Register the weapon overlay (WeaponView provides scene + camera). */
  setOverlay(scene, camera) {
    this.overlayScene = scene;
    this.overlayCamera = camera;
  }

  render() {
    const overlay = this.overlayEnabled ? this.overlayScene : null;
    const overlayCam = this.overlayEnabled ? this.overlayCamera : null;
    if (this.postfx?.enabled) {
      this.postfx.render(this.scene, this.camera, overlay, overlayCam);
      return;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    if (overlay && overlayCam) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth(); // keep color, draw the weapon on top of everything
      this.renderer.render(overlay, overlayCam);
      this.renderer.autoClear = true;
    }
  }
}
