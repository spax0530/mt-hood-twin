import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MatKey } from './materials';

type V = [number, number, number];

/** Collects simple shapes per material and merges them into one geometry each. */
export class Parts {
  private by = new Map<MatKey, THREE.BufferGeometry[]>();

  add(mat: MatKey, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const n = g.index ? g.toNonIndexed() : g;
    if (m) n.applyMatrix4(m);
    n.deleteAttribute('uv');
    let list = this.by.get(mat);
    if (!list) this.by.set(mat, (list = []));
    list.push(n);
  }

  box(mat: MatKey, size: V, at: V, rot?: V) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    this.add(mat, g, compose(at, rot));
  }

  /** Cylinder whose axis runs along `axis`. */
  cyl(mat: MatKey, r: number, len: number, at: V, axis: 'x' | 'y' | 'z' = 'y', seg = 16, rot?: V) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    this.add(mat, g, compose(at, rot));
  }

  /** Straight round bar between two points. */
  bar(mat: MatKey, a: V, b: V, r: number, seg = 8) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    this.add(mat, g, new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }

  /** Bent tube through the given points, with rounded corners. */
  tube(mat: MatKey, pts: V[], r: number, bend = 0.15, seg = 8) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const v = pts.map((p) => new THREE.Vector3(...p));
    let from = v[0];
    for (let i = 1; i < v.length - 1; i++) {
      const inDir = v[i].clone().sub(v[i - 1]), outDir = v[i + 1].clone().sub(v[i]);
      const d = Math.min(bend, inDir.length() * 0.45, outDir.length() * 0.45);
      const a = v[i].clone().addScaledVector(inDir.normalize(), -d);
      const b = v[i].clone().addScaledVector(outDir.normalize(), d);
      path.add(new THREE.LineCurve3(from, a));
      path.add(new THREE.QuadraticBezierCurve3(a, v[i], b));
      from = b;
    }
    path.add(new THREE.LineCurve3(from, v[v.length - 1]));
    const steps = Math.max(8, Math.round(path.getLength() / 0.06));
    this.add(mat, new THREE.TubeGeometry(path, steps, r, seg, false));
  }

  build(m?: THREE.Matrix4): Map<MatKey, THREE.BufferGeometry> {
    const out = new Map<MatKey, THREE.BufferGeometry>();
    for (const [k, list] of this.by) {
      const g = mergeGeometries(list, false)!;
      if (m) g.applyMatrix4(m);
      out.set(k, g);
    }
    return out;
  }

  /** Move everything collected so far (used to place one tower in the world). */
  drainInto(target: Parts, m: THREE.Matrix4) {
    for (const [k, list] of this.by) for (const g of list) target.add(k, g, m);
    this.by.clear();
  }
}

function compose(at: V, rot?: V): THREE.Matrix4 {
  const q = new THREE.Quaternion();
  if (rot) q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  return new THREE.Matrix4().compose(new THREE.Vector3(...at), q, new THREE.Vector3(1, 1, 1));
}
