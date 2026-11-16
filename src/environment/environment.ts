import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { SharedUniforms } from '../terrain/material';

/** Winter sky, sun and atmospheric haze. Owns the lighting uniforms the terrain reads. */
export class Environment {
  readonly sky = new Sky();
  readonly uniforms: SharedUniforms = {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSkyColor: { value: new THREE.Color() },
    uHazeColor: { value: new THREE.Color() },
    uHaze: { value: 1 / 60000 },
  };
  hour = 11;

  constructor(scene: THREE.Scene) {
    this.sky.scale.setScalar(450000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.2;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    this.setHour(this.hour);
  }

  /**
   * Mid-winter sun path at 45.4 N: rises in the southeast, peaks about 22 degrees
   * above the southern horizon, sets in the southwest.
   */
  setHour(hour: number) {
    this.hour = hour;
    const t = THREE.MathUtils.clamp((hour - 7.6) / 9.0, 0, 1); // sunrise ~7:35, sunset ~16:35
    const elev = THREE.MathUtils.degToRad(Math.max(1.5, 22 * Math.sin(Math.PI * t)));
    const azim = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(122, 238, t)); // clockwise from north
    const s = this.uniforms.uSun.value;
    s.set(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev));
    this.sky.material.uniforms.sunPosition.value.copy(s);

    const low = 1 - Math.sin(elev) / Math.sin(THREE.MathUtils.degToRad(22)); // 0 at noon, 1 at horizon
    this.uniforms.uSunColor.value.setRGB(3.4, 3.4 - 1.5 * low, 3.3 - 2.6 * low).multiplyScalar(1 - 0.35 * low);
    this.uniforms.uSkyColor.value.setRGB(0.42, 0.55, 0.85).multiplyScalar(0.75 - 0.3 * low);
    this.uniforms.uHazeColor.value.setRGB(0.62 + 0.2 * low, 0.72, 0.86 - 0.2 * low).multiplyScalar(0.9 - 0.25 * low);
  }
}
