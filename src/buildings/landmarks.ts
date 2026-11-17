import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toLocal } from '../geo';
import { surface, type SurfaceKind } from '../render/surface';
import type { SharedUniforms } from '../terrain/material';

interface MeshData { pos: number[]; idx: number[] }
interface Extra { type: string; x: number; y: number; [k: string]: number | string }
export interface LandmarkData {
  id: string;
  name: string;
  osmId: number;
  frame: { x0: number; y1: number; mlon: number; mlat: number };
  baseTop: number;
  materials: { base?: string; siding?: string; roof?: string; trim?: string; sidingColor?: string; roofColor?: string; baseColor?: string };
  roof: MeshData;
  base: MeshData;
  siding: MeshData;
  /** x, y, sill elevation, width, height, outward normal x, y */
  windows: number[][];
  chimneys: { x: number; y: number; w: number; d: number; top: number; bottom: number }[];
  extras: Extra[];
}

const SIDING: Record<string, { kind: SurfaceKind; color: number }> = {
  'clapboard-grey': { kind: 'clapboard', color: 0x8f9695 },
  'clapboard-tan': { kind: 'clapboard', color: 0xb5a58c },
  'board-batten-grey': { kind: 'board-batten', color: 0xa9aeac },
  'board-batten-brown': { kind: 'board-batten', color: 0x6a5140 },
  'metal-grey': { kind: 'metal-roof', color: 0xa7abaa },
};
const ROOF: Record<string, { kind: SurfaceKind; color: number; metalness: number; roughness: number }> = {
  'cedar-shake': { kind: 'shake', color: 0x443d36, metalness: 0, roughness: 0.9 },
  'metal-grey': { kind: 'metal-roof', color: 0x7d8284, metalness: 0.6, roughness: 0.45 },
  'metal-green': { kind: 'metal-roof', color: 0x3f5a4a, metalness: 0.5, roughness: 0.5 },
};
const BASE: Record<string, { kind: SurfaceKind; color: number }> = {
  'rubble-stone': { kind: 'stone', color: 0x77716a },
  concrete: { kind: 'plain', color: 0x8d8d89 },
};

/** Detailed buildings built offline from lidar roof planes (tools/build_landmark.py). */
export async function loadLandmarks(shared: SharedUniforms): Promise<{ group: THREE.Group; osmIds: Set<number> }> {
  const group = new THREE.Group();
  const osmIds = new Set<number>();
  const index = (await (await fetch(`./data/landmarks/index.json?v=${__BUILD__}`)).json()) as { landmarks: { id: string; osmId: number }[] };
  await Promise.all(
    index.landmarks.map(async (e) => {
      try {
        const d = (await (await fetch(`./data/landmarks/${e.id}.json?v=${__BUILD__}`)).json()) as LandmarkData;
        group.add(buildLandmark(d, shared));
        osmIds.add(d.osmId);
      } catch (err) {
        console.warn('Landmark failed to load', e.id, err);
      }
    }),
  );
  return { group, osmIds };
}

function buildLandmark(d: LandmarkData, shared: SharedUniforms): THREE.Group {
  const g = new THREE.Group();
  g.name = d.id;
  const { x0, y1, mlon, mlat } = d.frame;
  const P = (x: number, y: number, z: number) => {
    const l = toLocal(y1 - y / mlat, x0 + x / mlon);
    return new THREE.Vector3(l.x, z, l.z);
  };
  const toGeo = (m: MeshData) => {
    const pos = new Float32Array(m.pos.length);
    for (let i = 0; i < m.pos.length; i += 3) {
      const v = P(m.pos[i], m.pos[i + 1], m.pos[i + 2]);
      pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(m.idx);
    geo.computeVertexNormals();
    return geo;
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, mat);
    g.add(mesh);
    return mesh;
  };
  const mt = d.materials;
  const roofSpec = ROOF[mt.roof ?? 'metal-grey'] ?? ROOF['metal-grey'];
  const sideSpec = SIDING[mt.siding ?? 'board-batten-grey'] ?? SIDING['board-batten-grey'];
  const baseSpec = BASE[mt.base ?? 'concrete'] ?? BASE.concrete;
  const col = (hex: string | undefined, fallback: number) => (hex ? new THREE.Color(hex) : new THREE.Color(fallback));

  const roofMat = surface(shared, { kind: roofSpec.kind, color: col(mt.roofColor, roofSpec.color), metalness: roofSpec.metalness, roughness: roofSpec.roughness, snow: 1, side: THREE.DoubleSide });
  const sidingMat = surface(shared, { kind: sideSpec.kind, color: col(mt.sidingColor, sideSpec.color), roughness: 0.8, side: THREE.DoubleSide });
  const baseMat = surface(shared, { kind: baseSpec.kind, color: col(mt.baseColor, baseSpec.color), roughness: 0.92, side: THREE.DoubleSide });
  const trimMat = surface(shared, { color: col(mt.trim, 0xb9bcb8), roughness: 0.7 });
  const glassMat = surface(shared, { color: 0x10161d, roughness: 0.06, metalness: 0.0, envMapIntensity: 2.2 });

  add(toGeo(d.roof), roofMat);
  if (d.base.idx.length) add(toGeo(d.base), baseMat);
  if (d.siding.idx.length) add(toGeo(d.siding), sidingMat);

  // Windows: trim frame, muntin bars and glass, set slightly proud of the wall
  const trim: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const boxAt = (list: THREE.BufferGeometry[], w: number, h: number, t: number, at: THREE.Vector3, yaw: number, ox: number, oy: number, oz: number) => {
    const geo = new THREE.BoxGeometry(w, h, t).toNonIndexed();
    geo.deleteAttribute('uv');
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const off = new THREE.Vector3(ox, oy, oz).applyQuaternion(q);
    geo.applyMatrix4(m4.compose(at.clone().add(off), q, one));
    list.push(geo);
  };
  for (const [x, y, sill, w, h, nx, ny] of d.windows) {
    const a = P(x, y, sill), b = P(x + nx, y + ny, sill);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z); // local +Z faces outward
    const f = 0.09; // frame width
    boxAt(glass, w - f, h - f, 0.02, a, yaw, 0, h / 2, 0.035);
    boxAt(trim, w + f, f, 0.1, a, yaw, 0, h + f / 2 - f / 2, 0.03);
    boxAt(trim, w + f * 2, f * 1.3, 0.14, a, yaw, 0, -f * 0.2, 0.04); // sill
    boxAt(trim, f, h, 0.1, a, yaw, -w / 2, h / 2, 0.03);
    boxAt(trim, f, h, 0.1, a, yaw, w / 2, h / 2, 0.03);
    const cols = w > 1.0 ? 2 : 1;
    for (let c = 1; c <= cols; c++) boxAt(trim, 0.035, h, 0.05, a, yaw, -w / 2 + (w * c) / (cols + 1), h / 2, 0.045);
    for (let r = 1; r <= 2; r++) boxAt(trim, w, 0.035, 0.05, a, yaw, 0, (h * r) / 3, 0.045);
  }
  if (trim.length) add(mergeGeometries(trim, false)!, trimMat);
  if (glass.length) add(mergeGeometries(glass, false)!, glassMat);

  // Chimneys found in the lidar: stone stacks at their measured position and height
  const stone: THREE.BufferGeometry[] = [];
  for (const c of d.chimneys) {
    const geo = new THREE.BoxGeometry(c.w, c.top - c.bottom, c.d).toNonIndexed();
    geo.deleteAttribute('uv');
    const at = P(c.x, c.y, (c.top + c.bottom) / 2);
    geo.applyMatrix4(m4.makeTranslation(at.x, at.y, at.z));
    stone.push(geo);
  }
  for (const e of d.extras) {
    if (e.type === 'hex-chimney') {
      const top = e.top as number, bottom = e.bottom as number, r = e.radius as number;
      const geo = new THREE.CylinderGeometry(r * 0.94, r, top - bottom, 6).toNonIndexed();
      geo.deleteAttribute('uv');
      const at = P(e.x, e.y, (top + bottom) / 2);
      geo.applyMatrix4(m4.makeTranslation(at.x, at.y, at.z));
      stone.push(geo);
    } else if (e.type === 'weathervane') {
      const base = e.base as number, h = e.height as number;
      const bronze = surface(shared, { color: 0x4a3f2c, metalness: 0.8, roughness: 0.5 });
      const at = P(e.x, e.y, base);
      const post = new THREE.CylinderGeometry(0.04, 0.05, h, 8); post.translate(at.x, at.y + h / 2, at.z);
      const arm = new THREE.BoxGeometry(1.5, 0.05, 0.05); arm.translate(at.x, at.y + h * 0.55, at.z);
      const goose = new THREE.SphereGeometry(0.42, 12, 8); goose.scale(1.5, 0.55, 0.12); goose.translate(at.x, at.y + h, at.z);
      for (const part of [post, arm, goose]) add(part, bronze);
    }
  }
  if (stone.length) add(mergeGeometries(stone, false)!, baseMat);
  return g;
}
