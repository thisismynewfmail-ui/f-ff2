import * as THREE from '../../lib/three.module.js';
import { reliefFor, reliefNamed } from './Relief.js';

/**
 * SURFACE SHADING — the light half of the relief work.
 *
 * Relief.js bakes a depth map for every texture; this is what hands it to the
 * lighting. It extends the Lambert shading model the whole town is built on
 * with three things it has never had:
 *
 *   1. PERTURBED NORMALS. Every texel gets its own surface normal, so the sun
 *      shades WITHIN a face instead of only across faces. This is the effect
 *      in the reference: the same flat quad, the same art, suddenly with
 *      mortar you can feel and clapboard that laps.
 *
 *   2. CAVITY. Crevices darken and raised faces lift — but symmetrically
 *      around the texture's own local average, so a wall keeps EXACTLY the
 *      brightness it had. Depth is bought with contrast, never by dimming;
 *      an "ambient occlusion" that just multiplies everything down is how
 *      detail passes turn a bright town into mud, and this one cannot.
 *
 *   3. SPECULAR AND SKY SHEEN. Lambert has no highlight at all, which is the
 *      real reason metal, glass, tile and wet asphalt all read as the same
 *      dead matte cardboard here. Added back as a Blinn lobe from the scene's
 *      own sun/moon and point lights (so a muzzle flash genuinely flares off
 *      brickwork), plus a Fresnel-weighted sample of the hemisphere light
 *      standing in for a sky reflection. Fresnel weighting is what keeps this
 *      from washing anything out: the sheen lands at grazing angles, along
 *      edges and up glass, and stays off the faces you are looking straight
 *      at.
 *
 * ------------------------------------------------------------ how it hooks in
 *
 * The game builds a few hundred Lambert materials across two dozen files, so
 * the extension is installed at the SHADER LIBRARY rather than threaded
 * through every call site: ShaderLib.lambert is patched once, before the first
 * material compiles, and every MeshLambertMaterial in the game picks it up.
 * Nothing else is touched — MeshBasicMaterial (sky, HUD, flashes) and the
 * weapons' MeshStandardMaterial rigs are left exactly as they were.
 *
 * Per-material values ride in on uniforms through a Material.prototype
 * onBeforeCompile hook. Because the injected GLSL is identical for every
 * material and only the uniforms differ, the program cache still collapses
 * them all onto one compiled program — no shader permutation explosion, and
 * the existing customProgramCacheKey contract is unaffected.
 *
 * Two materials in the game write their OWN onBeforeCompile (the terrain grass
 * splat and the wind-swayed planting). An instance hook shadows the prototype,
 * so those two call `applyRelief` themselves — see world/Terrain.js and
 * world/Vegetation.js.
 *
 * Everything is behind one shared uniform, `gbDetail`: setDetail(0) restores
 * the original look exactly, at any time, with no recompile.
 */

/** How far the self-shadow march walks, as a fraction of one texture tile. */
const SHADOW_REACH = 0.055;

/** Shared master level (0 = off, 1 = full). One object, every material. */
export const DETAIL = { value: 1 };

/** Distance in metres over which relief and sheen fade out. */
const FADE_NEAR = 70;
const FADE_FAR = 195;

let installed = false;

/** Global detail level, 0..1. Applies live to everything already compiled. */
export function setDetail(v) {
  DETAIL.value = Math.max(0, Math.min(1, Number(v) || 0));
}

/**
 * Give one material's uniform set the relief for a texture.
 *
 * `source` may be a THREE.Texture (its diffuse map — the usual case, resolved
 * through the image it was baked from so texture clones with their own repeat
 * still match) or a logical texture name from TextureConfig.
 */
export function applyRelief(uniforms, source) {
  if (!uniforms || !uniforms.gbRelief) return false;
  const entry = typeof source === 'string' ? reliefNamed(source) : reliefFor(source);
  uniforms.gbDetail = DETAIL; // shared, so the master level stays live
  if (!entry) return false;
  const p = entry.profile;
  uniforms.gbReliefMap.value = entry.map;
  uniforms.gbRelief.value.set(1, p.cavity, p.gloss, p.shine);
  uniforms.gbSheen.value.set(p.env, p.fresnel, FADE_NEAR, FADE_FAR);
  uniforms.gbCarve.value.set(p.shadow, SHADOW_REACH);
  return true;
}

/**
 * Patch ShaderLib.lambert and install the per-material uniform hook.
 *
 * Must run before the first Lambert material compiles — the Renderer calls it
 * from its constructor, which is the first thing the game builds.
 */
export function installSurfaceShading() {
  if (installed) return;
  installed = true;

  const lib = THREE.ShaderLib.lambert;
  Object.assign(lib.uniforms, {
    gbReliefMap: { value: null },
    // x: relief on/off (depth itself is baked per profile), y: cavity depth,
    // z: specular intensity, w: specular exponent
    gbRelief: { value: new THREE.Vector4(0, 0, 0, 16) },
    // x: sky-sheen amount, y: how much of it is grazing-angle only,
    // z/w: the distance band the whole effect fades out across
    gbSheen: { value: new THREE.Vector4(0, 0, FADE_NEAR, FADE_FAR) },
    // x: self-shadow strength, y: how far the march reaches, in tile UV
    gbCarve: { value: new THREE.Vector2(0, SHADOW_REACH) },
    gbDetail: DETAIL,
  });

  lib.fragmentShader = lib.fragmentShader
    .replace('#include <common>', DECLARATIONS)
    .replace('#include <color_fragment>', CAVITY)
    .replace('#include <normal_fragment_maps>', PERTURB)
    .replace(OUTGOING, SPECULAR + OUTGOING_WITH_SPEC);

  const base = THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
    if (shader.uniforms && shader.uniforms.gbRelief) applyRelief(shader.uniforms, this.map);
    return base.call(this, shader, renderer);
  };
}

// --------------------------------------------------------------- the GLSL

const DECLARATIONS = /* glsl */`#include <common>
uniform sampler2D gbReliefMap;
uniform vec4 gbRelief;
uniform vec4 gbSheen;
uniform vec2 gbCarve;
uniform float gbDetail;

// The most a highlight may ever add, in linear light.
#define GB_SPEC_CEIL 0.42

// Tangent frame from screen-space derivatives — the same construction
// three.js uses for un-tangented normal maps, inlined here because the stock
// one is only compiled in when a material carries a real normalMap.
mat3 gbTangentFrame( vec3 eyePos, vec3 surfNormal, vec2 uv ) {
	vec3 q0 = dFdx( eyePos.xyz );
	vec3 q1 = dFdy( eyePos.xyz );
	vec2 st0 = dFdx( uv.st );
	vec2 st1 = dFdy( uv.st );
	vec3 q1perp = cross( q1, surfNormal );
	vec3 q0perp = cross( surfNormal, q0 );
	vec3 T = q1perp * st0.x + q0perp * st1.x;
	vec3 B = q1perp * st0.y + q0perp * st1.y;
	float det = max( dot( T, T ), dot( B, B ) );
	float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
	return mat3( T * scale, B * scale, surfNormal );
}`;

const CAVITY = /* glsl */`#include <color_fragment>
	// One fetch feeds the whole extension: normal in rg, cavity in b, gloss
	// mask in a. Faded out with distance so far geometry keeps the clean
	// silhouette it had — texel-sized relief past the fog line is aliasing,
	// not detail.
	float gbFade = gbDetail * ( 1.0 - smoothstep( gbSheen.z, gbSheen.w, length( vViewPosition ) ) );
	vec4 gbSurf = vec4( 0.5, 0.5, 0.5, 1.0 );
	#ifdef USE_MAP
		if ( gbRelief.x > 0.0 && gbFade > 0.0 ) {
			gbSurf = texture2D( gbReliefMap, vMapUv );
			// Symmetric about the texture's own local mean: crevices lose
			// exactly what the raised face gains, so the wall's overall
			// brightness is untouched and nothing muddies.
			diffuseColor.rgb *= 1.0 + ( gbSurf.b - 0.5 ) * 2.0 * gbRelief.y * gbFade;
		}
	#endif`;

const PERTURB = /* glsl */`#include <normal_fragment_maps>
	#ifdef USE_MAP
		if ( gbRelief.x > 0.0 && gbFade > 0.0 ) {
			vec2 gbNxy = gbSurf.rg * 2.0 - 1.0;
			// z is not stored — it is whatever is left of a unit vector.
			float gbNz = sqrt( max( 1.0 - dot( gbNxy, gbNxy ), 0.0 ) );
			vec3 gbMapN = vec3( gbNxy * gbRelief.x * gbFade, max( gbNz, 0.02 ) );
			normal = normalize( gbTangentFrame( - vViewPosition, normal, vMapUv ) * gbMapN );
		}
	#endif`;

const SPECULAR = /* glsl */`	vec3 gbSpec = vec3( 0.0 );
	#ifdef USE_MAP
	// SELF-SHADOWING. The height field does not just tilt the normal, it gets
	// in its own way: march the surface toward the sun and if anything along
	// the way stands higher than the ray, this texel is in the shadow of its
	// own relief. That is what puts a hard little shadow in the top of every
	// mortar course at a low sun and takes it away again at noon — the single
	// most convincing thing a flat wall can do.
	#if NUM_DIR_LIGHTS > 0
	if ( gbCarve.x > 0.0 && gbFade > 0.0 && gbRelief.x > 0.0 ) {
		IncidentLight gbSunLight;
		getDirectionalLightInfo( directionalLights[ 0 ], gbSunLight );
		mat3 gbSunTbn = gbTangentFrame( - vViewPosition, nonPerturbedNormal, vMapUv );
		vec3 gbLt = vec3( dot( gbSunLight.direction, gbSunTbn[ 0 ] ),
			dot( gbSunLight.direction, gbSunTbn[ 1 ] ),
			dot( gbSunLight.direction, gbSunTbn[ 2 ] ) );
		if ( gbLt.z > 0.05 ) {
			float gbH0 = gbSurf.b - 0.5;
			vec2 gbStep = ( gbLt.xy / gbLt.z ) * gbCarve.y * 0.25;
			float gbOccl = 0.0;
			for ( int i = 1; i <= 4; i ++ ) {
				float gbT = float( i );
				float gbRay = gbH0 + gbT * gbCarve.y * 0.25;   // the ray climbing away
				float gbHit = texture2D( gbReliefMap, vMapUv + gbStep * gbT ).b - 0.5;
				gbOccl = max( gbOccl, ( gbHit - gbRay ) * ( 1.0 - gbT * 0.2 ) );
			}
			float gbShade = 1.0 - saturate( gbOccl * 14.0 ) * gbCarve.x * gbFade;
			// Shadow the DIRECT light only: ambient still reaches into a
			// crevice, which is what keeps this from going to black mud.
			reflectedLight.directDiffuse *= gbShade;
		}
	}
	#endif
	if ( gbFade > 0.0 && ( gbRelief.z > 0.0 || gbSheen.x > 0.0 ) ) {
		vec3 gbV = normalize( vViewPosition );
		float gbGloss = gbRelief.z * gbSurf.a;
		float gbShine = gbRelief.w;
		// Blinn normalisation keeps the lobe's total energy roughly fixed as it
		// tightens, so a sharp highlight is not quieter than a broad one. The
		// textbook divisor is 8*PI; this is a good deal gentler than that,
		// because a physical BRDF would be taking energy OUT of the diffuse to
		// pay for the highlight and this one cannot — the diffuse is the art.
		// Adding a full metal lobe on top of full Lambert diffuse is what
		// turned every metal surface into a flare.
		float gbNorm = ( gbShine + 8.0 ) / 64.0;
		IncidentLight gbLight;
		#if NUM_DIR_LIGHTS > 0
			// The sun and the moon. This is the highlight that travels across
			// a metal roof as the day cycle turns.
			for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
				getDirectionalLightInfo( directionalLights[ i ], gbLight );
				float gbNL = saturate( dot( normal, gbLight.direction ) );
				float gbNH = saturate( dot( normal, normalize( gbLight.direction + gbV ) ) );
				gbSpec += gbLight.color * ( pow( gbNH, gbShine ) * gbNorm * gbNL * gbGloss );
			}
		#endif
		#if NUM_POINT_LIGHTS > 0
			// Muzzle flashes, the exploder's blast, the bolt: every point
			// light in the game now throws a real glint off wet asphalt and
			// sheet metal instead of just a flat wash of colour.
			for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
				getPointLightInfo( pointLights[ i ], geometryPosition, gbLight );
				float gbNL = saturate( dot( normal, gbLight.direction ) );
				float gbNH = saturate( dot( normal, normalize( gbLight.direction + gbV ) ) );
				gbSpec += gbLight.color * ( pow( gbNH, gbShine ) * gbNorm * gbNL * gbGloss );
			}
		#endif
		#if NUM_HEMI_LIGHTS > 0
		{
			// Sky reflection, cheap: the hemisphere light already holds the
			// sky colour over the ground colour and is driven across the day
			// by world/Sky.js, so sampling it along the reflected view vector
			// is a free, always-correct environment probe.
			vec3 gbRefl = reflect( - gbV, normal );
			vec3 gbEnv = vec3( 0.0 );
			for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
				gbEnv += mix( hemisphereLights[ i ].groundColor, hemisphereLights[ i ].skyColor,
					0.5 * dot( gbRefl, hemisphereLights[ i ].direction ) + 0.5 );
			}
			// Fresnel: strong along grazing edges, almost nothing head-on.
			// That is what makes this read as a surface catching the sky
			// rather than as the whole scene being lifted toward white.
			float gbF = mix( 0.14, pow( 1.0 - saturate( dot( normal, gbV ) ), 4.0 ), gbSheen.y );
			gbSpec += gbEnv * ( gbSheen.x * gbF * mix( 0.35, 1.0, gbSurf.a ) );
		}
		#endif
		// A HARD CEILING on the highlight, as a soft shoulder so it rolls
		// rather than plateauing. This is the guarantee, not the tuning: no
		// combination of profile, light intensity and grazing angle can put a
		// blown white hole on a metal surface, whatever anyone sets the gloss
		// to later. Specular is a sheen on top of the art here, and half a stop
		// is as much as a sheen ever needs.
		gbSpec = gbSpec / ( 1.0 + gbSpec / GB_SPEC_CEIL );
		gbSpec *= gbFade;
	}
	#endif
`;

const OUTGOING = '\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';
const OUTGOING_WITH_SPEC = '\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance + gbSpec;';
