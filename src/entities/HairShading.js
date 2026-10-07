// Runtime shading for the keeper's haircut (player.glb meshes "HairCards" and
// "HairScalp", built by tools/assets/hair). The GLB already carries a usable
// look (alpha-masked cards, KHR_materials_anisotropy sheen); this adds what
// glTF cannot express:
//   - alpha-to-coverage on the cards, so strand edges are soft under MSAA
//     instead of hard alpha-test stair steps;
//   - mip-aware alpha: strand coverage is boosted on distant mip levels so the
//     cards do not thin out and turn see-through at gameplay distance;
//   - a second, warmer, shifted highlight (the TRT lobe of real hair) and a
//     gentle forward-scatter rim, both along the strand tangent;
//   - toned-down sky reflections (hair is a poor mirror).
// Usage: applyHairShading(modelRoot) once after the model is instantiated.
import * as THREE from 'three';

const CARD_RE = /^HairCards/;
const SCALP_RE = /^HairScalp/;

function patchCards(mat) {
  mat.alphaToCoverage = true;
  mat.envMapIntensity = 0.4;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <alphatest_fragment>', /* glsl */`
        #ifdef USE_MAP
        {
          // Mip-aware coverage: distant mips average strands with gaps, so
          // raise alpha as the footprint grows to keep the hair mass solid.
          vec2 tsz = vec2( textureSize( map, 0 ) );
          vec2 dx = dFdx( vMapUv * tsz ), dy = dFdy( vMapUv * tsz );
          float mip = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
          diffuseColor.a *= 1.0 + mip * 0.28;
        }
        #endif
        #include <alphatest_fragment>`)
      .replace('#include <lights_physical_pars_fragment>', /* glsl */`
        #include <lights_physical_pars_fragment>
        // Strand direction (root -> tip) for the current fragment.
        vec3 hairTangent = vec3( 0.0, 1.0, 0.0 );
        // Wraps the physical direct-light term (so shadows still apply) and
        // adds the hair-specific lobes on top of the anisotropic GGX one.
        void RE_Direct_Hair( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          vec3 L = directLight.direction, V = geometryViewDir;
          // secondary (TRT) highlight: shifted toward the root, coloured by the hair
          vec3 T = normalize( hairTangent + geometryNormal * 0.18 );
          float th = dot( T, normalize( L + V ) );
          float trt = pow( sqrt( max( 0.0, 1.0 - th * th ) ), 22.0 ) * smoothstep( -0.15, 0.45, dot( geometryNormal, L ) );
          // light passing through the hair toward the viewer (backlit rim)
          float fwd = pow( saturate( dot( -V, L ) ), 4.0 ) * ( 1.0 - saturate( dot( geometryNormal, V ) ) );
          reflectedLight.directSpecular += directLight.color * material.diffuseColor * ( trt * 0.55 + fwd * 0.35 );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Hair`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        hairTangent = normalize( tbn[ 1 ] );`);
  };
  mat.customProgramCacheKey = () => 'keeper-hair-cards-v2';
  mat.needsUpdate = true;
}

function patchScalp(mat) {
  mat.envMapIntensity = 0.5;
  mat.needsUpdate = true;
}

/** Finds the hair meshes by name and upgrades their materials. Returns the number patched. */
export function applyHairShading(modelRoot) {
  let n = 0; const done = new Set();
  modelRoot.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const isCards = CARD_RE.test(o.name), isScalp = SCALP_RE.test(o.name);
    if (!isCards && !isScalp) return;
    o.castShadow = true; o.receiveShadow = true;
    if (done.has(o.material)) { n++; return; }
    done.add(o.material);
    if (isCards) patchCards(o.material); else patchScalp(o.material);
    n++;
  });
  return n;
}
