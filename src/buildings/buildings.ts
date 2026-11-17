import * as THREE from 'three';
import type { Building } from '../data';
import { toLocal } from '../geo';
import type { SharedUniforms } from '../terrain/material';

const SINK = 2.5; // walls continue this far below ground so sloped sites show no gap

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 color;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vColor = color; vN = normal; vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uHazeColor; uniform float uHaze;
varying vec3 vColor; varying vec3 vN; varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  if (dot(n, cameraPosition - vWorld) < 0.0) n = -n;
  // Snow settles on anything flatter than roughly 40 degrees; steeper roofs shed it.
  float snow = smoothstep(0.62, 0.80, n.y);
  vec3 albedo = mix(vColor, vec3(0.90, 0.93, 0.97), snow);
  vec3 col = albedo * (uSunColor * max(dot(n, uSun), 0.0) + uSkyColor * (0.45 + 0.55 * max(n.y, 0.0)));
  float d = distance(vWorld, cameraPosition);
  col = mix(col, uHazeColor, 1.0 - exp(-d * uHaze));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WALLS: [number, number, number][] = [
  [0.16, 0.10, 0.07], [0.20, 0.14, 0.10], [0.12, 0.09, 0.07], [0.23, 0.21, 0.19],
  [0.17, 0.19, 0.20], [0.24, 0.17, 0.11], [0.14, 0.16, 0.13], [0.27, 0.25, 0.22],
];
const ROOF: [number, number, number] = [0.10, 0.10, 0.11];

class Builder {
  pos: number[] = [];
  col: number[] = [];
  nor: number[] = [];
  /** Flat triangle: the normal comes from its own plane. */
  tri(a: number[], b: number[], c: number[], color: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    this.triN(a, b, c, [nx, ny, nz], [nx, ny, nz], [nx, ny, nz], color);
  }
  /** Smooth triangle with a normal per corner. */
  triN(a: number[], b: number[], c: number[], na: number[], nb: number[], nc: number[], color: number[]) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nor.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2]);
  }
  quad(a: number[], b: number[], c: number[], d: number[], color: number[]) {
    this.tri(a, b, c, color); this.tri(a, c, d, color);
  }
}

function inPoly(x: number, z: number, p: number[][]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
const polyArea = (p: number[][]) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
};

/** Smallest rectangle around a footprint, aligned to one of its walls. */
function boundingRect(p: number[][]) {
  let best: { area: number; ux: number; uz: number; u0: number; u1: number; v0: number; v1: number } | null = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of p) {
      const u = q[0] * ux + q[1] * uz, v = -q[0] * uz + q[1] * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  return best;
}

function heights(b: Building): { eave: number; ridge: number } {
  const kind = b.tags.building;
  let ridge = 0, eave = 0;
  if (b.h && b.h[2] >= 2) {
    ridge = Math.min(35, Math.max(2.5, b.h[2]));
    eave = b.h[0] >= 1.5 ? Math.min(b.h[0], ridge) : ridge * 0.6;
    eave = Math.max(2.2, Math.min(eave, ridge));
  } else {
    const levels = Number(b.tags['building:levels']);
    const tagH = parseFloat(b.tags.height ?? '');
    ridge = tagH > 0 ? tagH : levels > 0 ? levels * 3 + 1.5 : kind === 'shed' || kind === 'roof' || kind === 'garage' ? 3 : 5.5;
    eave = Math.max(2.2, ridge * 0.62);
  }
  return { eave, ridge };
}

function addSimple(B: Builder, b: Building, p: number[][], wall: number[]) {
  const g = b.g!;
  let { eave, ridge } = heights(b);
  // Lidar over a small building often catches overhanging trees; keep heights plausible for the footprint
  const cap = Math.max(6, 1.25 * Math.sqrt(Math.abs(polyArea(p))));
  if (ridge > cap) { eave *= cap / ridge; ridge = cap; eave = Math.max(2.2, eave); }
  const lo = g - SINK;
  const rect = boundingRect(p);
  const fill = rect ? Math.abs(polyArea(p)) / rect.area : 0;
  if (rect && fill > 0.8 && ridge - eave > 0.5) {
    // Gabled roof: ridge along the long side
    let { ux, uz, u0, u1, v0, v1 } = rect;
    let vx = -uz, vz = ux;
    if (v1 - v0 > u1 - u0) { [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; }
    const at = (u: number, v: number, y: number) => [u * ux + v * vx, y, u * uz + v * vz];
    const span = v1 - v0, vm = (v0 + v1) / 2;
    const top = g + eave + Math.min(ridge - eave, span * 0.9);
    const ey = g + eave;
    const c = [at(u0, v0, 0), at(u1, v0, 0), at(u1, v1, 0), at(u0, v1, 0)];
    for (let i = 0; i < 4; i++) {
      const a = c[i], d = c[(i + 1) % 4];
      B.quad([a[0], lo, a[2]], [d[0], lo, d[2]], [d[0], ey, d[2]], [a[0], ey, a[2]], wall);
    }
    B.tri(at(u0, v0, ey), at(u0, v1, ey), at(u0, vm, top), wall);
    B.tri(at(u1, v0, ey), at(u1, v1, ey), at(u1, vm, top), wall);
    const o = 0.4, drop = (o * (top - ey)) / (span / 2);
    B.quad(at(u0 - o, v0 - o, ey - drop), at(u1 + o, v0 - o, ey - drop), at(u1 + o, vm, top), at(u0 - o, vm, top), ROOF);
    B.quad(at(u1 + o, v1 + o, ey - drop), at(u0 - o, v1 + o, ey - drop), at(u0 - o, vm, top), at(u1 + o, vm, top), ROOF);
    return;
  }
  // Irregular footprint: straight walls and a flat, snow-covered roof
  const y = g + Math.max(eave, (eave + ridge) / 2);
  for (let i = 0; i < p.length; i++) {
    const a = p[i], d = p[(i + 1) % p.length];
    B.quad([a[0], lo, a[1]], [d[0], lo, d[1]], [d[0], y, d[1]], [a[0], y, a[1]], wall);
  }
  const tris = THREE.ShapeUtils.triangulateShape(p.map((q) => new THREE.Vector2(q[0], q[1])), []);
  for (const t of tris) B.tri([p[t[0]][0], y, p[t[0]][1]], [p[t[1]][0], y, p[t[1]][1]], [p[t[2]][0], y, p[t[2]][1]], ROOF);
}

/** Large or complex buildings: the roof is the lidar surface itself, cut to the footprint. */
function addFromLidar(B: Builder, b: Building, p: number[][], wall: number[]) {
  const G = b.grid!;
  const { nx, ny } = G;
  const N = nx * ny;
  const X = new Float32Array(N), Z = new Float32Array(N), raw = new Float32Array(N);
  const inside = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const l = toLocal(G.y1 - j * G.dy, G.x0 + i * G.dx);
    X[k] = l.x; Z[k] = l.z; raw[k] = G.h[k] / 10;
    inside[k] = inPoly(l.x, l.z, p) ? 1 : 0;
  }
  // 3 x 3 median inside the footprint removes lidar speckle but keeps ridges and eaves sharp
  const R = new Float32Array(raw);
  const win: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!inside[k]) continue;
    win.length = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && inside[jj * nx + ii]) win.push(raw[jj * nx + ii]);
    }
    win.sort((a, c) => a - c);
    R[k] = win[win.length >> 1];
  }
  // Points outside the walls read ground level; carry the roof height outward so the edge stays crisp
  const known = new Uint8Array(inside);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(known);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (known[k]) continue;
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || !known[jj * nx + ii]) continue;
        s += R[jj * nx + ii]; n++;
      }
      if (n) { R[k] = s / n; next[k] = 1; }
    }
    known.set(next);
  }
  const floor = 2.2; // a roof is never lower than this above the lowest ground
  for (let k = 0; k < N; k++) R[k] = Math.max(R[k], floor);
  const V = (k: number) => [X[k], G.base + R[k], Z[k]];
  const at = (i: number, j: number) => R[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  const Nrm = (k: number) => {
    const i = k % nx, j = (k / nx) | 0;
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * G.step), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * G.step);
    const l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  };
  // Roof: every grid cell that touches the footprint, so the snow overhangs the walls slightly
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, bq = a + 1, c = a + nx, d = c + 1;
    if (!(inside[a] || inside[bq] || inside[c] || inside[d])) continue;
    B.triN(V(a), V(c), V(bq), Nrm(a), Nrm(c), Nrm(bq), ROOF);
    B.triN(V(bq), V(c), V(d), Nrm(bq), Nrm(c), Nrm(d), ROOF);
  }
  // Walls: the true footprint outline, rising to the roof height at each point
  const sx = X[1] - X[0], sz = Z[nx] - Z[0];
  const roofAt = (x: number, z: number) => {
    const fi = Math.min(nx - 1.001, Math.max(0, (x - X[0]) / sx)), fj = Math.min(ny - 1.001, Math.max(0, (z - Z[0]) / sz));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * nx + i;
    return G.base + (R[k] * (1 - u) + R[k + 1] * u) * (1 - v) + (R[k + nx] * (1 - u) + R[k + nx + 1] * u) * v;
  };
  const lo = G.base - SINK;
  for (let e = 0; e < p.length; e++) {
    const a = p[e], c = p[(e + 1) % p.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const parts = Math.max(1, Math.ceil(len / G.step));
    for (let s = 0; s < parts; s++) {
      const x1 = a[0] + ((c[0] - a[0]) * s) / parts, z1 = a[1] + ((c[1] - a[1]) * s) / parts;
      const x2 = a[0] + ((c[0] - a[0]) * (s + 1)) / parts, z2 = a[1] + ((c[1] - a[1]) * (s + 1)) / parts;
      B.quad([x1, lo, z1], [x2, lo, z2], [x2, roofAt(x2, z2), z2], [x1, roofAt(x1, z1), z1], wall);
    }
  }
}

export function buildBuildings(list: Building[], shared: SharedUniforms): THREE.Mesh {
  const B = new Builder();
  for (const b of list) {
    const kind = b.tags.building;
    if (kind === 'ruins' || kind === 'storage_tank') continue;
    const p: number[][] = [];
    for (let i = 0; i < b.p.length - 2; i += 2) { const l = toLocal(b.p[i + 1], b.p[i]); p.push([l.x, l.z]); }
    if (p.length < 3) continue;
    const wall = WALLS[b.id % WALLS.length];
    if (b.grid) addFromLidar(B, b, p, wall);
    else if (b.g !== null) addSimple(B, b, p, wall);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { ...shared }, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
