import * as THREE from '../../lib/three.module.js';

/**
 * PRESENTATION — the frame stops being a WebGL canvas and becomes a signal on
 * a tube.
 *
 * The world used to go straight from the depth test to the canvas at 75% and
 * get stretched up by the browser. Everything here is instead built around one
 * decision: the game is a PS1-era picture being watched on a CRT, and both
 * halves of that sentence are simulated honestly rather than being faked with
 * an overlay.
 *
 * THE CONSOLE. The world renders into a small fixed framebuffer (448 lines,
 * PS1 territory) and is read back with nearest sampling, so the pixels are
 * genuinely chunky rather than a soft image with a grid drawn on it. The graded
 * result is then crushed to a 15-BIT FRAMEBUFFER through an ordered 4x4 Bayer
 * matrix aligned to that low-res pixel grid — the exact trick the hardware
 * used, and the reason a PS1 sky is a shimmer of dithered blue instead of a
 * smooth gradient. It is a distinctive look you cannot get any other way, and
 * it is the opposite of washing the colours out: the palette gets HARDER.
 *
 * THE TUBE. The console's output is then displayed, at the canvas's full
 * native resolution, through a real aperture grille: RGB phosphor stripes,
 * scanlines whose beam FATTENS where the picture is bright (so highlights
 * bloom across the gap the way a real beam does), halation spilling out of the
 * bright areas, chromatic fringing that grows toward the corners, barrel
 * curvature and the tube's own edge falloff. Every one of those darkens the
 * picture, so the stage carries an explicit gain that puts the light back —
 * the frame ends up brighter and punchier than it started, never dimmer.
 *
 * THE SIGNAL IS LIVE. This is not a static filter sitting on top of the game;
 * the tube is wired to what is happening in it (see Signal, and the event
 * wiring in engine/Game.js):
 *
 *   - firing surges the beam: the picture lifts for a frame or two, so a burst
 *     of automatic fire pulses the room
 *   - taking a hit breaks the signal: horizontal tracking tears, the colour
 *     channels split apart, and static crawls over the picture
 *   - bleeding out holds that fault: the lower your health, the noisier the
 *     signal and the redder the rim, so you can read your own condition off
 *     the picture without looking at the HUD
 *   - a new wave punches the vertical hold for a moment, like a channel change
 *
 * There is deliberately NO rolling hum bar. A bright band travelling up the
 * screen is one of the most recognisable CRT artefacts there is, and it was the
 * first thing to go: it sweeps across whatever you are trying to shoot on a
 * cycle that has nothing to do with the game, and a periodic distraction you
 * cannot act on is worse than no effect at all. The scanlines are fixed to the
 * glass. Nothing in this pass crawls.
 *
 * The split between the two is also where the cost went. Everything expensive
 * — the occlusion, the halation, the grade, the 15-bit crush — is CONSOLE
 * work and runs once per console pixel on the small buffer. Only what
 * genuinely belongs to the glass runs per device pixel, because the grille and
 * the scanlines are the one part that has to be drawn at native resolution to
 * stay sharp, and that pass is three fetches and a dozen instructions. Doing
 * it the other way round — one big composite at canvas resolution — costs
 * about twice as much for an identical picture.
 *
 * Bypassable end to end: `level` 0 skips every pass and renders exactly the
 * frame the game drew before any of this existed, and a driver that cannot
 * give us a float target falls back on its own.
 */

/** The console's framebuffer: fixed line count, PS1-ish. */
const SIGNAL_LINES = 448;

/**
 * Bloom threshold / soft knee, in linear light.
 *
 * The threshold sits ABOVE white on purpose. The weapon viewmodel is lit by
 * its own rig and carries a real environment map, so its polished metal throws
 * specular hits that are legitimately several times over-range — and a
 * threshold below 1.0 catches those and turns a highlight on the receiver into
 * a white hole burnt through the middle of the frame, right where you are
 * aiming. Only genuinely emissive things belong in the bloom: the sun and moon,
 * lit windows, muzzle flashes, the odd hot glint. Everything else keeps its
 * light in its own pixels.
 */
const BLOOM_THRESHOLD = 1.15;
const BLOOM_KNEE = 0.65;

/** Grade — see the class comment for why each is what it is. */
const EXPOSURE = 1.14;
const CONTRAST = 1.20;     // exponent about middle grey
const SATURATION = 1.28;
const SHOULDER = 0.76;     // identity below this, soft rolloff above
const BLOOM = 0.26;
const AO_STRENGTH = 0.50;
const AO_RADIUS = 0.42;    // metres
const SPLIT = 0.14;
const SHADOW_TINT = new THREE.Vector3(0.84, 0.94, 1.16);
const HIGHLIGHT_TINT = new THREE.Vector3(1.12, 1.03, 0.88);

/** Tube — scanline depth, phosphor mask depth, barrel curvature, fringing. */
const SCAN_DEPTH = 0.40;
const MASK_DEPTH = 0.26;
const CURVATURE = 0.055;
const CHROMA = 0.7;        // in console pixels, at the frame edge
const VIGNETTE = 0.26;
const COLOR_BITS = 5;      // per channel: the PS1's 15-bit framebuffer
const DITHER = 1.0;
/** Black level: a tube's glass never goes truly black, and neither does this. */
const LIFT = 0.030;
/**
 * Gain that puts back exactly what the grille and the scanlines take out.
 * A scanline averages half its depth over a beam period and the grille dims
 * two stripes in three, so the mean loss is known in closed form rather than
 * eyeballed — which is what lets the tube be this heavy without the picture
 * ending up dimmer than it started.
 */
const TUBE_GAIN = 1 / ((1 - SCAN_DEPTH * 0.5) * (1 - MASK_DEPTH * 0.667));

/**
 * The live state of the signal. Everything decays back to a clean picture, so
 * a fault is always something that just happened rather than a mode the game
 * gets stuck in.
 */
class Signal {
  constructor() {
    this.surge = 0;   // beam flare — firing, explosions
    this.damage = 0;  // tracking tear + channel split — taking a hit
    this.glitch = 0;  // vertical hold punch — a wave landing, a zone opening
    this.hurt = 0;    // standing noise floor — how badly you are hurt
    this.time = 0;
  }

  /** A momentary fault. Kinds are additive so a burst stacks up. */
  pulse(kind, amount = 1) {
    if (kind === 'surge') this.surge = Math.min(1.6, this.surge + amount);
    else if (kind === 'damage') this.damage = Math.min(1.4, this.damage + amount);
    else if (kind === 'glitch') this.glitch = Math.min(1.2, this.glitch + amount);
  }

  update(dt, healthFrac = 1) {
    this.time += dt;
    // Beam flare is nearly instantaneous; a tear rings out; the hold settles.
    this.surge *= Math.exp(-dt * 11);
    this.damage *= Math.exp(-dt * 2.6);
    this.glitch *= Math.exp(-dt * 4.2);
    // The noise floor tracks health, but eases so a heal calms the picture
    // down instead of snapping it clean.
    const want = Math.max(0, 1 - Math.max(0, Math.min(1, healthFrac)) / 0.55);
    this.hurt += (want - this.hurt) * Math.min(1, dt * 2.5);
  }
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.available = false;
    this.level = 1;
    this.signal = new Signal();
    this._w = 1; this._h = 1;      // console framebuffer
    this._ow = 1; this._oh = 1;    // tube (canvas) size
    try {
      this._build();
      this.available = true;
    } catch (e) {
      // Software/restricted WebGL: the game still runs, just unposted.
      console.warn('PostFX unavailable, rendering direct:', e && e.message);
      this.available = false;
    }
  }

  get enabled() { return this.available && this.level > 0; }

  /** The console framebuffer size for a given canvas size. */
  static signalSize(w, h) {
    const lines = Math.max(160, Math.min(SIGNAL_LINES, Math.floor(h)));
    return { w: Math.max(160, Math.round(lines * (w / h))), h: lines };
  }

  _build() {
    const gl = this.renderer.getContext();
    // Half float keeps specular glints and flashes above 1.0 alive until the
    // grade can roll them off; without it they clip in the scene buffer and
    // there is nothing left for the bloom to find.
    const float = !!(gl.getExtension('EXT_color_buffer_float')
      || gl.getExtension('EXT_color_buffer_half_float'));
    const type = float ? THREE.HalfFloatType : THREE.UnsignedByteType;

    // NEAREST on the scene target is the whole point: the tube stage reads
    // console pixels, not a resampled image, so a pixel stays a pixel.
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneRT.depthTexture.format = THREE.DepthFormat;
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;

    const soft = () => new THREE.WebGLRenderTarget(1, 1, {
      type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.halfA = soft(); this.halfB = soft();
    this.quartA = soft(); this.quartB = soft();

    // The console's finished framebuffer: 8-bit, because by the time it lands
    // here it has already been crushed to 15-bit colour and encoded to video
    // levels. Nearest, because the tube reads console pixels.
    this.signalRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.brightMat = shaderMat(BRIGHT_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThresh: { value: new THREE.Vector2(BLOOM_THRESHOLD, BLOOM_KNEE) },
    });
    this.blurMat = shaderMat(BLUR_FRAG, {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2() },
    });
    // The console: everything expensive — occlusion, halation, the grade, the
    // 15-bit crush — runs ONCE PER CONSOLE PIXEL, on the small buffer.
    this.signalMat = shaderMat(SIGNAL_FRAG, {
      tScene: { value: null },
      tBloomNear: { value: null },
      tBloomFar: { value: null },
      tDepth: { value: null },
      uSrcSize: { value: new THREE.Vector2(1, 1) },
      uSrcTexel: { value: new THREE.Vector2() },
      uCam: { value: new THREE.Vector2(0.1, 210) },
      // x exposure, y contrast, z saturation, w bloom
      uGrade: { value: new THREE.Vector4(EXPOSURE, CONTRAST, SATURATION, BLOOM) },
      // x shoulder knee, y (unused here), z split-tone, w (unused here)
      uTone: { value: new THREE.Vector4(SHOULDER, 0, SPLIT, 0) },
      // x colour levels per channel, y dither amount, z black level
      uPs1: { value: new THREE.Vector3((1 << COLOR_BITS) - 1, DITHER, LIFT) },
      // x strength, y projected radius in pixels at 1 m
      uAo: { value: new THREE.Vector2(AO_STRENGTH, 100) },
      // x surge, y damage, z glitch, w standing noise
      uSignal: { value: new THREE.Vector4() },
      uShadowTint: { value: SHADOW_TINT.clone() },
      uHighlightTint: { value: HIGHLIGHT_TINT.clone() },
    });
    // The tube: only what genuinely belongs to the glass runs at the canvas's
    // full resolution, because the grille and the scanlines are the one part
    // that HAS to be drawn per device pixel to stay sharp. A dozen instructions
    // and three fetches — cheap enough to run at any window size.
    this.tubeMat = shaderMat(TUBE_FRAG, {
      tSignal: { value: null },
      uSrcSize: { value: new THREE.Vector2(1, 1) },
      uSrcTexel: { value: new THREE.Vector2() },
      uOutSize: { value: new THREE.Vector2(1, 1) },
      // x scanline depth, y mask depth, z curvature, w chromatic fringing
      uCrt: { value: new THREE.Vector4(SCAN_DEPTH, MASK_DEPTH, CURVATURE, CHROMA) },
      // x vignette, y tube gain
      uTube: { value: new THREE.Vector2(VIGNETTE, TUBE_GAIN) },
      uSignal: { value: new THREE.Vector4() },
      uTime: { value: 0 },
    });
  }

  /**
   * `w`/`h` is the canvas — the tube. The console framebuffer underneath it is
   * sized independently, which is what makes the pixels chunky and the grille
   * crisp at the same time.
   */
  setSize(w, h) {
    if (!this.available) return;
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this._ow && h === this._oh) return;
    this._ow = w; this._oh = h;
    const s = PostFX.signalSize(w, h);
    this._w = s.w; this._h = s.h;
    this.sceneRT.setSize(s.w, s.h);
    this.signalRT.setSize(s.w, s.h);
    this.halfA.setSize(s.w >> 1 || 1, s.h >> 1 || 1);
    this.halfB.setSize(s.w >> 1 || 1, s.h >> 1 || 1);
    this.quartA.setSize(s.w >> 2 || 1, s.h >> 2 || 1);
    this.quartB.setSize(s.w >> 2 || 1, s.h >> 2 || 1);
  }

  /** 0 disables the chain entirely; values between scale it toward neutral. */
  setLevel(v) {
    this.level = Math.max(0, Math.min(1, Number(v) || 0));
    if (!this.available) return;
    const k = this.level;
    const lerp = (a, b) => a + (b - a) * k;
    const u = this.signalMat.uniforms;
    u.uGrade.value.set(lerp(1, EXPOSURE), lerp(1, CONTRAST), lerp(1, SATURATION), BLOOM * k);
    u.uTone.value.set(lerp(1, SHOULDER), 0, SPLIT * k, 0);
    u.uPs1.value.set(lerp(255, (1 << COLOR_BITS) - 1), DITHER * k, LIFT * k);
    u.uAo.value.x = AO_STRENGTH * k;
    const t = this.tubeMat.uniforms;
    t.uCrt.value.set(SCAN_DEPTH * k, MASK_DEPTH * k, CURVATURE * k, CHROMA * k);
    t.uTube.value.set(VIGNETTE * k, lerp(1, TUBE_GAIN));
  }

  /** Advance the live signal. Called once a frame by the game. */
  update(dt, healthFrac) {
    this.signal.update(dt, healthFrac);
    if (!this.available) return;
    const s = this.signal;
    this.signalMat.uniforms.uSignal.value.set(s.surge, s.damage, s.glitch, s.hurt);
    this.tubeMat.uniforms.uSignal.value.set(s.surge, s.damage, s.glitch, s.hurt);
    this.tubeMat.uniforms.uTime.value = s.time;
  }

  /** Kick the signal: 'surge' | 'damage' | 'glitch'. */
  pulse(kind, amount) { this.signal.pulse(kind, amount); }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  _blur(src, mid, dst, w, h) {
    const u = this.blurMat.uniforms;
    u.tSrc.value = src.texture;
    u.uDir.value.set(1 / w, 0);
    this._pass(this.blurMat, mid);
    u.tSrc.value = mid.texture;
    u.uDir.value.set(0, 1 / h);
    this._pass(this.blurMat, dst);
  }

  /**
   * Draw the world (and the first-person overlay on top of it) through the
   * chain. Mirrors Renderer.render's own sequencing so the viewmodel is graded,
   * dithered and scanned with the scene rather than pasted onto it afterwards.
   */
  render(scene, camera, overlayScene, overlayCamera) {
    const r = this.renderer;
    const w = this._w, h = this._h;

    r.setRenderTarget(this.sceneRT);
    r.autoClear = true;
    r.render(scene, camera);
    if (overlayScene && overlayCamera) {
      r.autoClear = false;
      r.clearDepth();
      r.render(overlayScene, overlayCamera);
      r.autoClear = true;
    }

    // Bright pass into half res, blurred there and again at quarter res: two
    // scales so a flash gets both a tight core and a wide, soft halation.
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    this.brightMat.uniforms.tSrc.value = this.sceneRT.texture;
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this._pass(this.brightMat, this.halfA);
    this._blur(this.halfA, this.halfB, this.halfA, hw, hh);
    this._blur(this.halfA, this.quartB, this.quartA, qw, qh);

    // The console finishes its frame, on its own small buffer.
    const u = this.signalMat.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloomNear.value = this.halfA.texture;
    u.tBloomFar.value = this.quartA.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uSrcSize.value.set(w, h);
    u.uSrcTexel.value.set(1 / w, 1 / h);
    u.uCam.value.set(camera.near, camera.far);
    // Screen radius of a 1 m sphere at 1 m, so the AO kernel keeps a constant
    // WORLD size as the FOV changes (zoom, the sniper scope, the FOV slider).
    u.uAo.value.y = AO_RADIUS * (h * 0.5) / Math.tan(camera.fov * Math.PI / 360);
    this._pass(this.signalMat, this.signalRT);

    // ...and the tube displays it.
    const t = this.tubeMat.uniforms;
    t.tSignal.value = this.signalRT.texture;
    t.uSrcSize.value.set(w, h);
    t.uSrcTexel.value.set(1 / w, 1 / h);
    t.uOutSize.value.set(this._ow, this._oh);
    this.quad.material = this.tubeMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    if (!this.available) return;
    for (const rt of [this.sceneRT, this.signalRT, this.halfA, this.halfB, this.quartA, this.quartB]) {
      rt.dispose();
    }
    for (const m of [this.brightMat, this.blurMat, this.signalMat, this.tubeMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}

function shaderMat(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: QUAD_VERT, fragmentShader,
    depthTest: false, depthWrite: false,
  });
}

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uThresh;
varying vec2 vUv;
void main() {
	// 4-tap box while halving: cheap, and it stops a one-pixel highlight from
	// flickering in and out of the bloom as the camera moves.
	vec3 c = texture2D( tSrc, vUv + vec2( -uTexel.x, -uTexel.y ) ).rgb
		+ texture2D( tSrc, vUv + vec2( uTexel.x, -uTexel.y ) ).rgb
		+ texture2D( tSrc, vUv + vec2( -uTexel.x, uTexel.y ) ).rgb
		+ texture2D( tSrc, vUv + vec2( uTexel.x, uTexel.y ) ).rgb;
	c *= 0.25;
	float l = max( c.r, max( c.g, c.b ) );
	// Soft knee, squared: nothing pops into the bloom, it eases in.
	float w = clamp( ( l - uThresh.x ) / max( uThresh.y, 1e-4 ), 0.0, 1.0 );
	gl_FragColor = vec4( c * w * w, 1.0 );
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
	// 9-tap gaussian folded into 5 bilinear fetches.
	vec3 c = texture2D( tSrc, vUv ).rgb * 0.2270270;
	vec2 o1 = uDir * 1.3846154;
	vec2 o2 = uDir * 3.2307692;
	c += ( texture2D( tSrc, vUv + o1 ).rgb + texture2D( tSrc, vUv - o1 ).rgb ) * 0.3162162;
	c += ( texture2D( tSrc, vUv + o2 ).rgb + texture2D( tSrc, vUv - o2 ).rgb ) * 0.0702703;
	gl_FragColor = vec4( c, 1.0 );
}`;

const SIGNAL_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloomNear;
uniform sampler2D tBloomFar;
uniform sampler2D tDepth;
uniform vec2 uSrcSize;
uniform vec2 uSrcTexel;
uniform vec2 uCam;
uniform vec2 uAo;
uniform vec3 uPs1;
uniform vec4 uGrade;
uniform vec4 uTone;
uniform vec4 uSignal;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
varying vec2 vUv;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

/** Window depth to distance from the eye, in metres. */
float gbViewZ( vec2 uv ) {
	float d = texture2D( tDepth, uv ).x * 2.0 - 1.0;
	return ( 2.0 * uCam.x * uCam.y ) / ( uCam.y + uCam.x - d * ( uCam.y - uCam.x ) );
}

/**
 * One occlusion tap. A neighbour NEARER than us by a centimetre or two is the
 * other wall of a crease and occludes; a neighbour nearer by half a metre is
 * a silhouette edge in front of open space and must not, or every object in
 * the scene wears a dark outline. That upper rejection is the whole trick.
 */
float gbOcc( vec2 uv, vec2 off, float centre ) {
	float delta = centre - gbViewZ( uv + off );
	return smoothstep( 0.015, 0.14, delta ) * ( 1.0 - smoothstep( 0.5, 0.95, delta ) );
}

float gbAmbientOcclusion( vec2 uv ) {
	if ( uAo.x <= 0.0 ) return 1.0;
	float centre = gbViewZ( uv );
	if ( centre >= uCam.y * 0.98 ) return 1.0;             // sky
	// Constant world-space radius, clamped so a surface right against the
	// lens does not sample half the screen.
	float px = clamp( uAo.y / centre, 1.5, 22.0 );
	vec2 r = px * uSrcTexel;
	vec2 d = r * 0.7071;
	float occ = gbOcc( uv, vec2( r.x, 0.0 ), centre ) + gbOcc( uv, vec2( -r.x, 0.0 ), centre )
		+ gbOcc( uv, vec2( 0.0, r.y ), centre ) + gbOcc( uv, vec2( 0.0, -r.y ), centre )
		+ gbOcc( uv, vec2( d.x, d.y ), centre ) + gbOcc( uv, vec2( -d.x, d.y ), centre )
		+ gbOcc( uv, vec2( d.x, -d.y ), centre ) + gbOcc( uv, vec2( -d.x, -d.y ), centre );
	return 1.0 - ( occ * 0.125 ) * uAo.x;
}

/**
 * Ordered 4x4 Bayer threshold, 0..15/16 — the PS1's own dither pattern, built
 * from the recursive definition rather than a lookup table (the 2x2 base
 * matrix is [[0,2],[3,1]]/4, and each level adds a quarter-weight copy of
 * itself at half the frequency).
 */
float gbBayer2( vec2 a ) {
	a = floor( a );
	return fract( a.x * 0.5 + a.y * a.y * 0.75 );
}
float gbBayer( vec2 a ) {
	return gbBayer2( a * 0.5 ) * 0.25 + gbBayer2( a );
}

void main() {
	vec2 uv = vUv;
	float surge = uSignal.x;

	vec3 col = texture2D( tScene, uv ).rgb;

	// Halation: light spilling sideways inside the glass. Two scales, so a
	// flash gets both a tight core and a wide soft glow — but gently. This is
	// the glass scattering a little of what passes through it, not a glow pass.
	col += ( texture2D( tBloomNear, uv ).rgb * 0.6 + texture2D( tBloomFar, uv ).rgb * 0.4 )
		* ( uGrade.w * ( 1.0 + surge * 0.45 ) );

	col *= gbAmbientOcclusion( uv );
	col *= uGrade.x * ( 1.0 + surge * 0.20 );

	// ------------------------------------------------------------- the grade
	// Contrast about middle grey, on luminance alone: the ratio between the
	// channels is preserved exactly, so the picture gets punchier without a
	// single hue moving. Doing this per channel is what desaturates a grade
	// into grey mush.
	float l = max( dot( col, LUMA ), 1e-4 );
	col *= ( pow( l / 0.18, uGrade.y ) * 0.18 ) / l;
	col = mix( vec3( dot( col, LUMA ) ), col, uGrade.z );

	// Highlight shoulder. Exactly the identity below the knee — midtones are
	// never touched — and asymptotic to white above it, so bright surfaces
	// roll off like film instead of clipping to a flat white plate.
	float knee = uTone.x;
	vec3 over = max( col - knee, 0.0 );
	col = min( col, vec3( knee ) ) + ( 1.0 - knee ) * ( over / ( over + ( 1.0 - knee ) ) );

	// Split tone: cool into the shadows, warm into the highlights, which is
	// what gives a lit street a lit side and a shaded one.
	float lg = dot( col, LUMA );
	col *= mix( vec3( 1.0 ), uShadowTint, ( 1.0 - smoothstep( 0.0, 0.5, lg ) ) * uTone.z );
	col *= mix( vec3( 1.0 ), uHighlightTint, smoothstep( 0.35, 1.0, lg ) * uTone.z );

	// THE WOUND. Getting hit, and staying hurt, bleeds the colour out of the
	// picture and pushes what is left red — but weighted to the EDGES of the
	// frame and nowhere near the middle. That is the whole design of it: the
	// centre of the screen is where you aim, and a damage effect that fogs the
	// thing you are shooting at is a punishment on top of a punishment. Out at
	// the rim, where you only read motion and light, it can be as loud as it
	// likes, and it is the first thing you notice.
	float wound = min( 1.0, uSignal.y * 0.95 + uSignal.w * 0.8 );
	if ( wound > 0.001 ) {
		vec2 c = uv * 2.0 - 1.0;
		float rim = smoothstep( 0.12, 1.45, dot( c, c ) );
		col = mix( col, vec3( dot( col, LUMA ) ) * vec3( 1.25, 0.28, 0.24 ), wound * rim * 0.9 );
	}

	// --------------------------------------------- the console's framebuffer
	// Encode to video levels, then crush to 15 bits through an ordered matrix
	// locked to the CONSOLE pixel grid, which is what makes the dither read as
	// chunky PS1 stipple rather than fine film grain.
	col = sRGBTransferOETF( vec4( max( col, 0.0 ), 1.0 ) ).rgb;
	// Black level. A tube's glass is never truly black, and a night street you
	// cannot see zombies coming down is not a style, it is a bug — so the very
	// bottom of the range is lifted and NOTHING else is touched. Midtones stay
	// exactly where the grade put them.
	col += uPs1.z * ( 1.0 - smoothstep( 0.0, 0.22, dot( col, LUMA ) ) );
	float levels = max( uPs1.x, 1.0 );
	float thresh = ( gbBayer( uv * uSrcSize ) - 0.5 ) * uPs1.y;
	col = floor( col * levels + 0.5 + thresh ) / levels;

	gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}`;

const TUBE_FRAG = /* glsl */`
uniform sampler2D tSignal;
uniform vec2 uSrcSize;
uniform vec2 uSrcTexel;
uniform vec2 uOutSize;
uniform vec2 uTube;
uniform vec4 uCrt;
uniform vec4 uSignal;
uniform float uTime;
varying vec2 vUv;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

float gbHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

void main() {
	float surge = uSignal.x, damage = uSignal.y, glitch = uSignal.z, hurt = uSignal.w;
	float fault = max( damage, glitch );

	// ---------------------------------------------------------- tube glass
	// Barrel curvature: the picture is painted on the inside of a curved
	// screen, so it bows out toward the corners. Normalised by the corner's
	// own stretch, so the frame stays FULL — a curvature that pushed the
	// corners off the texture would trade picture for black border, and this
	// is a look, not a crop.
	vec2 c = vUv * 2.0 - 1.0;
	float r2 = dot( c, c );
	vec2 uvTube = ( c * ( 1.0 + uCrt.z * r2 ) / ( 1.0 + uCrt.z * 2.0 ) ) * 0.5 + 0.5;
	vec2 uv = uvTube;

	// ------------------------------------------------------- signal faults
	// Horizontal tracking tear: whole bands of scanlines slip sideways, the
	// way a knocked head does on tape. Bands are quantised in time so the tear
	// holds for a couple of frames instead of buzzing, and the displacement is
	// deliberately small — a fault has to be legible AS a fault while you are
	// still playing through it, which means it may not cost you the picture.
	if ( fault > 0.001 ) {
		float band = floor( uv.y * 54.0 - uTime * 7.0 );
		float j = gbHash( vec2( band, floor( uTime * 18.0 ) ) );
		uv.x += ( j - 0.5 ) * step( 0.62, j ) * ( damage * 0.016 + glitch * 0.026 );
		// ...and the vertical hold takes a punch when a wave lands.
		uv.y += glitch * 0.010 * sin( uTime * 37.0 );
	}

	// The bezel is cut from the CURVATURE alone, never from a tear: a torn
	// band must slide the picture, not eat a bite out of the tube's edge.
	vec2 in0 = smoothstep( vec2( -0.004 ), vec2( 0.008 ), uvTube );
	vec2 in1 = smoothstep( vec2( -0.004 ), vec2( 0.008 ), 1.0 - uvTube );
	float onTube = in0.x * in0.y * in1.x * in1.y;
	uv = clamp( uv, vec2( 0.0 ), vec2( 1.0 ) );

	// ------------------------------------------------- convergence / colour
	// The three guns never land on quite the same spot, and the error grows
	// with the deflection angle — so the fringing is nothing in the middle of
	// the picture and obvious in the corners. A hit knocks them further apart,
	// but only by about a pixel: past that the picture stops being a picture.
	vec2 split = normalize( c + vec2( 1e-5 ) ) * uSrcTexel
		* ( uCrt.w * ( 0.25 + r2 ) + damage * 0.9 + glitch * 1.1 );
	vec3 col = vec3(
		texture2D( tSignal, uv + split ).r,
		texture2D( tSignal, uv ).g,
		texture2D( tSignal, uv - split ).b );

	// ---------------------------------------------------------- the picture
	// Scanlines. One beam per CONSOLE line — the tube is drawing the signal it
	// was given, so the beam pitch follows the framebuffer rather than the
	// window, and the lines stay locked to the pixels instead of crawling
	// through them. Floored at two device pixels so a small window still shows
	// scanlines rather than a grey wash.
	float pitch = max( 2.0, uOutSize.y / uSrcSize.y );
	float beam = 0.5 + 0.5 * cos( gl_FragCoord.y * 6.2831853 / pitch );
	float bright = dot( col, LUMA );
	// Where the picture is bright the beam FATTENS and floods the gap, which
	// is why a CRT highlight blooms instead of merely getting lighter.
	float scan = 1.0 - uCrt.x * ( 1.0 - beam ) * ( 1.0 - smoothstep( 0.35, 1.0, bright ) );

	// Aperture grille: three phosphor stripes to a triad, at tube resolution.
	float phase = mod( floor( gl_FragCoord.x ), 3.0 );
	vec3 mask = vec3( 1.0 - uCrt.y );
	mask += uCrt.y * vec3(
		step( phase, 0.5 ),
		step( 0.5, phase ) * step( phase, 1.5 ),
		step( 1.5, phase ) );

	col *= scan * mask * uTube.y * ( 1.0 + surge * 0.25 );

	// Static. Locked to the console grid so it reads as snow rather than fizz,
	// and zero-mean so a noisy signal is never a BRIGHTER one — noise that
	// lifts the picture is how a damage effect ends up blinding you.
	float noise = hurt * 0.07 + damage * 0.09 + glitch * 0.08;
	if ( noise > 0.001 ) {
		float n = gbHash( floor( uv * uSrcSize ) + floor( uTime * 24.0 ) * 7.13 );
		col += ( n - 0.5 ) * noise;
	}

	// Tube edge. The falloff starts well outside the action — the middle of
	// the frame, where the crosshair and everything you are shooting at live,
	// is left completely alone — and the last few pixels round off into the
	// bezel, so the picture ends at a tube instead of at a rectangle.
	col *= 1.0 - uTube.x * smoothstep( 0.9, 2.1, r2 );
	vec2 bezel = abs( c ) - vec2( 0.988, 0.978 );
	float corner = length( max( bezel, vec2( 0.0 ) ) );
	col *= ( 1.0 - smoothstep( 0.0, 0.016, corner ) ) * onTube;

	gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}`;
