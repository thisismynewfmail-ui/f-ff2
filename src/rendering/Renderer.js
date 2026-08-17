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

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    // Posted: the canvas is the tube, at native resolution. Unposted: the old
    // reduced buffer, upscaled by the browser exactly as it always was.
    const posted = !!this.postfx?.enabled;
    const bw = posted ? w : Math.floor(w * RENDER_SCALE);
    const bh = posted ? h : Math.floor(h * RENDER_SCALE);
    this.renderer.setSize(bw, bh, false);
    this.postfx?.setSize(bw, bh);
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
