import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toLocal } from '../geo';
import type { Terrain } from '../terrain/terrain';

export interface Place { id: string; name: string; lat: number; lon: number; elevM: number; viewDist: number }

/**
 * Orbit (drag), zoom (wheel/pinch), pan (right-drag) and fly (WASD or arrow keys).
 * The camera is kept above the ground and the orbit point rides the terrain.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  private keys = new Set<string>();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement, private terrain: Terrain) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 60000;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLSelectElement)) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  jumpTo(p: Place, fromAzimuthDeg = 200, pitchDeg = 24) {
    const l = toLocal(p.lat, p.lon);
    const y = this.terrain.heightAt(l.x, l.z)?.h ?? p.elevM;
    const a = THREE.MathUtils.degToRad(fromAzimuthDeg), e = THREE.MathUtils.degToRad(pitchDeg);
    this.controls.target.set(l.x, y, l.z);
    this.camera.position.set(
      l.x + Math.sin(a) * Math.cos(e) * p.viewDist,
      y + Math.sin(e) * p.viewDist,
      l.z - Math.cos(a) * Math.cos(e) * p.viewDist,
    );
    this.controls.update();
  }

  /** Compass heading in degrees, clockwise from north. */
  heading(): number {
    this.camera.getWorldDirection(this.fwd);
    return (THREE.MathUtils.radToDeg(Math.atan2(this.fwd.x, -this.fwd.z)) + 360) % 360;
  }

  /** Swing the camera around its focus point so north is straight ahead. */
  faceNorth() {
    const t = this.controls.target, c = this.camera.position;
    const r = Math.hypot(c.x - t.x, c.z - t.z);
    c.set(t.x, c.y, t.z + r);
    this.controls.update();
  }

  update(dt: number) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (f || r) {
      this.camera.getWorldDirection(this.fwd);
      this.fwd.y = 0; this.fwd.normalize();
      this.right.crossVectors(this.fwd, this.camera.up);
      const speed = this.camera.position.distanceTo(this.controls.target) * (k.has('ShiftLeft') ? 2.4 : 0.8) * dt;
      const move = this.fwd.multiplyScalar(f * speed).addScaledVector(this.right, r * speed);
      this.camera.position.add(move);
      this.controls.target.add(move);
      const g = this.terrain.heightAt(this.controls.target.x, this.controls.target.z);
      if (g) {
        const dy = g.h - this.controls.target.y;
        this.controls.target.y += dy; this.camera.position.y += dy;
      }
    }
    this.controls.update();
    const g = this.terrain.heightAt(this.camera.position.x, this.camera.position.z);
    if (g && this.camera.position.y < g.h + 3) this.camera.position.y = g.h + 3;
  }
}
