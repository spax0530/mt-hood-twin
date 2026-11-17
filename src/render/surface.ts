import * as THREE from 'three';
import type { SharedUniforms } from '../terrain/material';

export type SurfaceKind = 'plain' | 'clapboard' | 'board-batten' | 'stone' | 'shake' | 'metal-roof';
const KIND: Record<SurfaceKind, number> = { plain: 0, clapboard: 1, 'board-batten': 2, stone: 3, shake: 4, 'metal-roof': 5 };

export interface SurfaceOptions extends THREE.MeshStandardMaterialParameters {
  kind?: SurfaceKind;
  /** 0 = never snow-covered, 1 = snow settles on it like a roof. */
  snow?: number;
}

/**
 * Physically based material with a procedural surface pattern laid out in real meters
 * (board courses, stonework, shingle rows), optional settled snow, and the scene's distance haze.
 * Patterns follow each surface's own orientation, so they need no texture coordinates.
 */
export function surface(shared: SharedUniforms, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const { kind = 'plain', snow = 0, ...params } = o;
  const m = new THREE.MeshStandardMaterial({ flatShading: true, ...params });
  m.customProgramCacheKey = () => `surface-${kind}-${snow > 0 ? 1 : 0}`;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHazeColor = shared.uHazeColor;
    sh.uniforms.uHaze = shared.uHaze;
    sh.uniforms.uSnowAmt = { value: snow };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vWPos;
uniform vec3 uHazeColor;
uniform float uHaze;
uniform float uSnowAmt;
float sH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sH(i), sH(i + vec2(1, 0)), f.x), mix(sH(i + vec2(0, 1)), sH(i + vec2(1, 1)), f.x), f.y); }
float sF(vec2 p) { return 0.5 * sN(p) + 0.3 * sN(p * 2.1) + 0.2 * sN(p * 4.3); }
float sSnow = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 gN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
  if (gN.y < 0.0) gN = -gN;
  vec3 tng = normalize(cross(vec3(0.0, 1.0, 0.0), gN) + vec3(1e-4, 0.0, 0.0));
  float U = dot(vWPos, tng);
  float V = vWPos.y;
  float S = dot(vWPos, cross(gN, tng)); // distance along the slope
  float shade = 1.0;
  vec3 tint = vec3(1.0);
  #if SURFACE_KIND == 1
    float b = V / 0.16; float f = fract(b);
    shade = mix(0.62, 1.0, smoothstep(0.0, 0.16, 1.0 - f)) * (0.95 + 0.1 * sH(vec2(floor(b), floor(U / 3.4 + sH(vec2(floor(b), 3.0)) * 3.0))));
    shade *= 0.93 + 0.1 * sF(vec2(U * 0.7, V * 6.0));
  #elif SURFACE_KIND == 2
    float b = U / 0.3; float f = abs(fract(b) - 0.5);
    shade = mix(1.0, 0.7, smoothstep(0.43, 0.45, f) - smoothstep(0.47, 0.5, f) * 0.6) * (0.94 + 0.1 * sH(vec2(floor(b), 1.0)));
  #elif SURFACE_KIND == 3
    vec2 q = vec2(U, V) / 0.5; vec2 ip = floor(q), fp = fract(q); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j)); vec2 o = vec2(sH(ip + g), sH(ip + g + 17.3)) * 0.8 + 0.1;
      float d = length(g + o - fp); if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) d2 = d;
    }
    float mortar = smoothstep(0.02, 0.11, d2 - d1);
    float r = sH(id);
    tint = mix(vec3(0.82, 0.84, 0.9), vec3(1.08, 1.0, 0.9), sH(id + 5.1)) * (0.62 + 0.55 * r);
    shade = mix(0.32, 1.0, mortar) * (0.85 + 0.25 * sN(vec2(U, V) * 9.0));
  #elif SURFACE_KIND == 4
    float row = S / 0.2; float r = floor(row); float fu = U / 0.15 + sH(vec2(r, 7.0)) * 9.0; float c = floor(fu);
    float butt = smoothstep(0.0, 0.14, fract(row)); float joint = smoothstep(0.0, 0.08, fract(fu));
    shade = (0.55 + 0.45 * butt) * (0.75 + 0.25 * joint) * (0.72 + 0.5 * sH(vec2(r, c)));
    tint = mix(vec3(1.0, 0.93, 0.84), vec3(0.9, 0.93, 0.98), sH(vec2(c, r) + 2.7));
  #elif SURFACE_KIND == 5
    float f = abs(fract(U / 0.4) - 0.5);
    shade = mix(0.72, 1.0, smoothstep(0.0, 0.035, 0.5 - f));
  #endif
  diffuseColor.rgb *= shade * tint;
  if (uSnowAmt > 0.0) {
    // Snow stays on gentle pitches and slides off steep ones, clinging in a few patches
    float hold = gN.y + (sF(vWPos.xz * 0.22) - 0.5) * 0.34 + (sN(vWPos.xz * 1.9) - 0.5) * 0.06;
    sSnow = uSnowAmt * smoothstep(0.735, 0.775, hold);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.93, 0.97), sSnow);
  }
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, sSnow);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - sSnow;')
      .replace(
        '#include <tonemapping_fragment>',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, 1.0 - exp(-length(vViewPosition) * uHaze));\n#include <tonemapping_fragment>',
      );
    sh.fragmentShader = `#define SURFACE_KIND ${KIND[kind]}\n` + sh.fragmentShader;
  };
  return m;
}
