import * as THREE from 'three';
import { BOUNDS, ROOT_Z, type Quality } from '../config';
import { latToTileY, lonToTileX, tileLat, tileLon, toGeo, toLocal } from '../geo';
import { makeTerrainMaterial, type SharedUniforms } from './material';
import { loadDem, loadImagery, sampleHeights, TILE_PX } from './tiles';

type State = 'new' | 'loading' | 'ready' | 'failed';

class Node {
  children: Node[] | null = null;
  state: State = 'new';
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  heights: Float32Array | null = null;
  box = new THREE.Box3();
  size: number;
  dist = Infinity;
  dead = false;
  noSplit = false;

  constructor(public z: number, public x: number, public y: number) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = toLocal(tileLat(y + dy, z), tileLon(x + dx, z));
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.box.set(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 3500, maxZ));
    this.size = maxX - minX;
  }
}

/**
 * Streams real elevation tiles into a quadtree of meshes: coarse tiles far away,
 * finer tiles near the camera. Also answers "how high is the ground here?".
 */
export class Terrain {
  readonly group = new THREE.Group();
  private roots: Node[] = [];
  private queue: Node[] = [];
  private active = 0;
  imageryOk: boolean | null = null;
  demError: string | null = null;

  constructor(private shared: SharedUniforms, private q: Quality, private maxAniso: number) {
    const x0 = Math.floor(lonToTileX(BOUNDS.west, ROOT_Z)), x1 = Math.floor(lonToTileX(BOUNDS.east, ROOT_Z));
    const y0 = Math.floor(latToTileY(BOUNDS.north, ROOT_Z)), y1 = Math.floor(latToTileY(BOUNDS.south, ROOT_Z));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.roots.push(new Node(ROOT_Z, x, y));
  }

  setQuality(q: Quality) {
    this.q = q;
    for (const r of this.roots) this.dispose(r);
    this.roots = this.roots.map((r) => new Node(r.z, r.x, r.y));
    this.queue = [];
  }

  get pending() { return this.queue.length + this.active; }

  update(camPos: THREE.Vector3) {
    for (const r of this.roots) this.visit(r, camPos);
    this.pump();
  }

  private visit(n: Node, cam: THREE.Vector3) {
    n.dist = n.box.distanceToPoint(cam);
    if (n.state === 'new') this.request(n);
    if (n.state !== 'ready') return;
    const want = n.z < this.q.maxZ && !n.noSplit && n.dist < n.size * this.q.split;
    if (!want) {
      if (n.children) { n.children.forEach((c) => this.dispose(c)); n.children = null; }
      n.mesh!.visible = true;
      return;
    }
    if (!n.children) {
      n.children = [];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        n.children.push(new Node(n.z + 1, n.x * 2 + dx, n.y * 2 + dy));
    }
    let all = true;
    for (const c of n.children) {
      c.dist = c.box.distanceToPoint(cam);
      if (c.state === 'new') this.request(c);
      if (c.state === 'failed') n.noSplit = true;
      if (c.state !== 'ready') all = false;
    }
    if (all) {
      n.mesh!.visible = false;
      for (const c of n.children) this.visit(c, cam);
    } else {
      n.children.forEach((c) => this.hide(c));
      n.mesh!.visible = true;
    }
  }

  private hide(n: Node) {
    if (n.mesh) n.mesh.visible = false;
    n.children?.forEach((c) => this.hide(c));
  }

  private dispose(n: Node) {
    n.dead = true;
    n.children?.forEach((c) => this.dispose(c));
    n.children = null;
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      const u = n.mesh.material.uniforms;
      u.uNormal.value.dispose();
      if (u.uHasImg.value > 0.5) u.uImg.value.dispose();
      n.mesh.material.dispose();
      n.mesh = null;
    }
    n.heights = null;
  }

  private request(n: Node) {
    n.state = 'loading';
    this.queue.push(n);
  }

  private pump() {
    while (this.active < 8 && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].dist < this.queue[best].dist) best = i;
      const n = this.queue.splice(best, 1)[0];
      if (n.dead) continue;
      this.active++;
      this.load(n).finally(() => { this.active--; });
    }
  }

  private async load(n: Node) {
    try {
      n.heights = await loadDem(n.z, n.x, n.y);
    } catch (e) {
      n.state = 'failed';
      if (n.z === ROOT_Z) this.demError = String(e);
      return;
    }
    if (n.dead) return;
    this.build(n);
    n.state = 'ready';
    loadImagery(n.z, n.x, n.y, this.q.imgZoomOffset).then(
      (canvas) => {
        this.imageryOk = true;
        if (n.dead || !n.mesh) return;
        const t = new THREE.CanvasTexture(canvas);
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.maxAniso;
        n.mesh.material.uniforms.uImg.value = t;
        n.mesh.material.uniforms.uHasImg.value = 1;
      },
      () => { if (this.imageryOk === null) this.imageryOk = false; },
    );
  }

  private build(n: Node) {
    const h = n.heights!;
    const g = this.q.grid;
    const side = g + 3; // one extra ring on each side forms a "skirt" that hides cracks between tiles
    const pos = new Float32Array(side * side * 3);
    const uv = new Float32Array(side * side * 2);
    const skirt = n.size * 0.04;
    let minH = Infinity, maxH = -Infinity, k = 0;
    for (let j = -1; j <= g + 1; j++) {
      for (let i = -1; i <= g + 1; i++, k++) {
        const u = Math.min(1, Math.max(0, i / g)), v = Math.min(1, Math.max(0, j / g));
        const p = toLocal(tileLat(n.y + v, n.z), tileLon(n.x + u, n.z));
        let y = sampleHeights(h, u * TILE_PX - 0.5, v * TILE_PX - 0.5);
        minH = Math.min(minH, y); maxH = Math.max(maxH, y);
        if (i < 0 || j < 0 || i > g || j > g) y -= skirt;
        pos[k * 3] = p.x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = p.z;
        uv[k * 2] = u; uv[k * 2 + 1] = v;
      }
    }
    const idx = new Uint32Array((side - 1) * (side - 1) * 6);
    let t = 0;
    for (let j = 0; j < side - 1; j++) {
      for (let i = 0; i < side - 1; i++) {
        const a = j * side + i, b = a + side, c = a + 1, d = b + 1;
        idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = c; idx[t++] = b; idx[t++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    n.box.min.y = minH - skirt; n.box.max.y = maxH;

    // Per-pixel surface normals from the full-resolution heights, for crisp lighting
    const res = n.size / TILE_PX; // ground meters per pixel
    const nm = new Uint8Array(TILE_PX * TILE_PX * 4);
    const m = TILE_PX - 1;
    for (let j = 0; j < TILE_PX; j++) {
      for (let i = 0; i < TILE_PX; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(m, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(m, j + 1);
        const dx = (h[j * TILE_PX + i1] - h[j * TILE_PX + i0]) / ((i1 - i0) * res);
        const dz = (h[j1 * TILE_PX + i] - h[j0 * TILE_PX + i]) / ((j1 - j0) * res);
        const l = 1 / Math.hypot(dx, 1, dz);
        const o = (j * TILE_PX + i) * 4;
        nm[o] = (-dx * l * 0.5 + 0.5) * 255; nm[o + 1] = (l * 0.5 + 0.5) * 255; nm[o + 2] = (-dz * l * 0.5 + 0.5) * 255; nm[o + 3] = 255;
      }
    }
    const nt = new THREE.DataTexture(nm, TILE_PX, TILE_PX);
    nt.magFilter = nt.minFilter = THREE.LinearFilter;
    nt.needsUpdate = true;

    n.mesh = new THREE.Mesh(geo, makeTerrainMaterial(this.shared, nt));
    n.mesh.visible = false;
    this.group.add(n.mesh);
  }

  /** Ground elevation (m) at a local position, from the most detailed tile loaded there. */
  heightAt(x: number, z: number): { h: number; zoom: number } | null {
    const { lat, lon } = toGeo(x, z);
    let list: Node[] | null = this.roots, best: Node | null = null;
    while (list) {
      let hit: Node | null = null;
      for (const n of list) {
        const tx = lonToTileX(lon, n.z), ty = latToTileY(lat, n.z);
        if (tx >= n.x && tx < n.x + 1 && ty >= n.y && ty < n.y + 1) { hit = n; break; }
      }
      if (!hit || hit.state !== 'ready' || !hit.heights) break;
      best = hit;
      list = hit.children;
    }
    if (!best) return null;
    const fx = lonToTileX(lon, best.z) - best.x, fy = latToTileY(lat, best.z) - best.y;
    return { h: sampleHeights(best.heights!, fx * TILE_PX - 0.5, fy * TILE_PX - 0.5), zoom: best.z };
  }

  /** Highest ground within `radius` meters of a geographic point (used to verify scale). */
  maxHeightNear(lat: number, lon: number, radius: number): { h: number; zoom: number } | null {
    const c = toLocal(lat, lon);
    let out: { h: number; zoom: number } | null = null;
    for (let dz = -radius; dz <= radius; dz += radius / 25)
      for (let dx = -radius; dx <= radius; dx += radius / 25) {
        const s = this.heightAt(c.x + dx, c.z + dz);
        if (s && (!out || s.h > out.h)) out = s;
      }
    return out;
  }
}
