import * as THREE from '../../lib/three.module.js';

/**
 * WebGL scene setup tuned for the retro look:
 *  - fixed ~90° horizontal FOV (vertical FOV derived from aspect)
 *  - renders at reduced internal resolution, upscaled with nearest-neighbour
 *  - distance fog fading into a dark dusk sky
 *  - flat, pleasant lighting (hemisphere + low warm sun), no shadow maps
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
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(Math.floor(w * RENDER_SCALE), Math.floor(h * RENDER_SCALE), false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.applyFov();
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
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    if (this.overlayScene && this.overlayCamera && this.overlayEnabled) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth(); // keep color, draw the weapon on top of everything
      this.renderer.render(this.overlayScene, this.overlayCamera);
      this.renderer.autoClear = true;
    }
  }
}
