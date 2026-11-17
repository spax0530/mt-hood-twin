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
    uRuns: { value: 1 },
  };
  hour = 11;
  /** Sun and sky light for physically based materials (lifts), kept in step with the terrain shader. */
  readonly sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  private pmrem: THREE.PMREMGenerator | null = null;
  private scene: THREE.Scene | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;

  constructor(scene: THREE.Scene) {
    this.sky.scale.setScalar(450000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.2;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    scene.add(this.sun, this.sun.target);
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

    this.sun.color.copy(this.uniforms.uSunColor.value);
    this.sun.position.copy(s).multiplyScalar(1000);
    clearTimeout(this.envTimer);
    this.envTimer = window.setTimeout(() => this.bakeReflections(), 120);
  }

  /** Call once the renderer exists so metal and glass can reflect the sky and the snow. */
  attach(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = scene;
    this.bakeReflections();
  }

  private bakeReflections() {
    if (!this.pmrem || !this.scene) return;
    const s = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(50);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) sky.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    sky.material.uniforms.sunPosition.value.copy(this.uniforms.uSun.value);
    s.add(sky);
    // Snow-covered ground below the horizon, lit about as brightly as the terrain shader lights flat snow
    const sunUp = Math.max(this.uniforms.uSun.value.y, 0);
    const snow = this.uniforms.uSunColor.value.clone().multiplyScalar(sunUp).add(this.uniforms.uSkyColor.value).multiplyScalar(0.9);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(49, 32), new THREE.MeshBasicMaterial({ color: snow }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    s.add(ground);
    const next = this.pmrem.fromScene(s, 0, 0.1, 200);
    this.scene.environment = next.texture;
    this.scene.environmentIntensity = 0.8;
    this.envTarget?.dispose();
    this.envTarget = next;
    sky.material.dispose(); ground.geometry.dispose();
  }
}
