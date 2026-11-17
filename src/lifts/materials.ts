import * as THREE from 'three';
import type { SharedUniforms } from '../terrain/material';

/** Physically based material that also fades into the same distance haze as the terrain. */
export function pbr(shared: SharedUniforms, p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(p);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHazeColor = shared.uHazeColor;
    sh.uniforms.uHaze = shared.uHaze;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHazeColor;\nuniform float uHaze;')
      .replace(
        '#include <tonemapping_fragment>',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, 1.0 - exp(-length(vViewPosition) * uHaze));\n#include <tonemapping_fragment>',
      );
  };
  return m;
}

export interface LiftMaterials {
  galvanized: THREE.MeshStandardMaterial;
  towerPaint: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  cushion: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  pad: THREE.MeshStandardMaterial;
  rope: THREE.MeshStandardMaterial;
}

/** Colors and finishes read from the reference photos (see references/README.md). */
export function makeLiftMaterials(shared: SharedUniforms): LiftMaterials {
  return {
    galvanized: pbr(shared, { color: 0x8f9496, metalness: 0.7, roughness: 0.55 }),
    towerPaint: pbr(shared, { color: 0xa6abae, metalness: 0.0, roughness: 0.5 }),
    darkSteel: pbr(shared, { color: 0x2b2d30, metalness: 0.3, roughness: 0.6 }),
    rubber: pbr(shared, { color: 0x151515, metalness: 0.0, roughness: 0.9 }),
    cushion: pbr(shared, { color: 0x0e0e0f, metalness: 0.0, roughness: 0.85 }),
    plate: pbr(shared, { color: 0xf2f2f0, metalness: 0.0, roughness: 0.6 }),
    pad: pbr(shared, { color: 0xd8a200, metalness: 0.0, roughness: 0.8 }),
    rope: pbr(shared, { color: 0x4a4d50, metalness: 0.8, roughness: 0.6 }),
  };
}

export type MatKey = keyof LiftMaterials;
