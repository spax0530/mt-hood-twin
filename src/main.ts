import * as THREE from 'three';
import { CameraRig, type Place } from './camera/controls';
import { initialQuality, QUALITY, SUMMIT } from './config';
import { Environment } from './environment/environment';
import { Terrain } from './terrain/terrain';
import { Hud } from './ui/hud';

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.42;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 2, 1_000_000);
const env = new Environment(scene);

let quality = QUALITY[initialQuality];
const terrain = new Terrain(env.uniforms, quality, renderer.capabilities.getMaxAnisotropy());
scene.add(terrain.group);
const rig = new CameraRig(camera, renderer.domElement, terrain);

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const { places } = (await (await fetch('./data/places.json')).json()) as { places: Place[] };
const hud = new Hud(places, initialQuality, env.hour, {
  onJump: (p) => rig.jumpTo(p),
  onQuality: (name) => { quality = QUALITY[name]; terrain.setQuality(quality); resize(); },
  onHour: (h) => env.setHour(h),
  onNorth: () => rig.faceNorth(),
});
const startId = new URLSearchParams(location.search).get('at') ?? 'mountain';
const start = places.find((p) => p.id === startId) ?? places[0];
rig.jumpTo(start);
(document.getElementById('jump') as HTMLSelectElement).value = start.id;

const clock = new THREE.Clock();
let frame = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  rig.update(dt);
  terrain.update(camera.position);
  renderer.render(scene, camera);
  hud.setHeading(rig.heading());

  if (frame++ % 10 === 0) {
    const g = terrain.heightAt(camera.position.x, camera.position.z);
    hud.setReadout(camera.position.y, g ? g.h : null);
    hud.setDetail(terrain.heightAt(rig.controls.target.x, rig.controls.target.z), terrain.lidarDown);
    hud.setSummit(terrain.maxHeightNear(SUMMIT.lat, SUMMIT.lon, 300));
    hud.setStatus(
      terrain.demError
        ? `Could not load elevation data: ${terrain.demError}`
        : terrain.pending
          ? `Loading terrain (${terrain.pending})`
          : terrain.imageryOk === false
            ? 'Aerial imagery unavailable, using estimated forest cover'
            : '',
    );
  }
});

// Handy for debugging and automated checks
Object.assign(window, { hood: { terrain, camera, rig, env } });
