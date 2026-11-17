import * as THREE from 'three';
import { CameraRig, type Place } from './camera/controls';
import { initialQuality, QUALITY, SUMMIT } from './config';
import { Environment } from './environment/environment';
import { Terrain } from './terrain/terrain';
import { Hud } from './ui/hud';
import { Labels, type LabelItem } from './ui/labels';
import { loadMapData } from './data';
import { RunPainter } from './resorts/runs';
import { buildBuildings } from './buildings/buildings';
import { loadLandmarks } from './buildings/landmarks';
import { toLocal } from './geo';
import { LiftSystem, type LiftRecord } from './lifts/lift';

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.42;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1_000_000);
const env = new Environment(scene);
env.attach(renderer, scene);

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

const { places } = (await (await fetch(`./data/places.json?v=${__BUILD__}`)).json()) as { places: Place[] };
const hud = new Hud(places, initialQuality, env.hour, {
  onJump: (p) => rig.jumpTo(p),
  onQuality: (name) => { quality = QUALITY[name]; terrain.setQuality(quality); resize(); },
  onHour: (h) => env.setHour(h),
  onNorth: () => rig.faceNorth(),
  onToggle: (what, on) => {
    if (what === 'runs') env.uniforms.uRuns.value = on ? 1 : 0;
    if (what === 'labels' && labels) labels.enabled = on;
    if (what === 'buildings') { if (buildings) buildings.visible = on; if (landmarks) landmarks.visible = on; }
    if (what === 'lifts' && lifts) lifts.group.visible = on;
  },
});
const startId = new URLSearchParams(location.search).get('at') ?? 'mountain';
const start = places.find((p) => p.id === startId) ?? places[0];
rig.jumpTo(start);
(document.getElementById('jump') as HTMLSelectElement).value = start.id;

// Resorts, runs, lifts and buildings (Phase 2 data)
let labels: Labels | null = null;
let buildings: THREE.Mesh | null = null;
let landmarks: THREE.Group | null = null;
let lifts: LiftSystem | null = null;
try {
  const doc = (await (await fetch(`./data/lifts.json?v=${__BUILD__}`)).json()) as { lifts: LiftRecord[] };
  lifts = new LiftSystem(doc.lifts, env.uniforms);
  scene.add(lifts.group);
} catch (e) {
  console.warn('Lift data failed to load', e);
}
const map = await loadMapData();
const resorts = (await (await fetch(`./data/resorts.json?v=${__BUILD__}`)).json().catch(() => ({ resorts: [] }))) as {
  resorts: { name: string; lat: number; lon: number }[];
};
if (map) {
  const painter = new RunPainter(map.runs);
  terrain.overlay = (z, x, y) => painter.paint(z, x, y);
  terrain.reload();
  // Landmark buildings get a detailed model; everything else keeps the generic lidar shell
  let detailed = new Set<number>();
  try {
    const lm = await loadLandmarks(env.uniforms);
    detailed = lm.osmIds;
    landmarks = lm.group;
    scene.add(landmarks);
  } catch (e) {
    console.warn('Landmark models failed to load', e);
  }
  buildings = buildBuildings(map.buildings.filter((b) => !detailed.has(b.id)), env.uniforms);
  scene.add(buildings);

  const items: LabelItem[] = [];
  const at = (lon: number, lat: number) => toLocal(lat, lon);
  for (const r of resorts.resorts) items.push({ text: r.name, kind: 'resort', ...at(r.lon, r.lat) });
  for (const b of map.buildings) if (b.tags.name) items.push({ text: b.tags.name, kind: 'place', ...at(b.c[0], b.c[1]) });
  for (const l of map.lifts) {
    if (!l.tags.name || l.tags.aerialway === 'station') continue;
    const m = Math.floor(l.p.length / 4) * 2;
    items.push({ text: l.tags.name, kind: 'lift', ...at(l.p[m], l.p[m + 1]) });
  }
  // One label per named run, on its longest piece
  const longest = new Map<string, { len: number; item: LabelItem }>();
  for (const r of map.runs) {
    if (!r.n || r.t !== 'downhill') continue;
    const m = Math.floor(r.p.length / 4) * 2;
    const sub = r.d === 'novice' ? 'easy' : r.d === 'extreme' || r.d === 'freeride' ? 'expert' : r.d ?? '';
    const prev = longest.get(r.n);
    if (!prev || r.p.length > prev.len) longest.set(r.n, { len: r.p.length, item: { text: r.n, kind: 'run', sub, ...at(r.p[m], r.p[m + 1]) } });
  }
  for (const v of longest.values()) items.push(v.item);
  labels = new Labels(document.getElementById('labels')!, items, terrain);
}

const timeScale = Number(new URLSearchParams(location.search).get('speed') ?? 1) || 1;
const clock = new THREE.Clock();
let frame = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  rig.update(dt);
  terrain.update(camera.position);
  lifts?.update(dt * timeScale);
  renderer.render(scene, camera);
  hud.setHeading(rig.heading());

  if (frame % 3 === 0) labels?.update(camera, innerWidth, innerHeight);
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
Object.assign(window, { hood: { terrain, camera, rig, env, map, lifts, scene, renderer } });
