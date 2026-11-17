import * as THREE from 'three';
import { toLocal } from '../geo';
import type { SharedUniforms } from '../terrain/material';
import { Parts } from './geom';
import { makeLiftMaterials, type LiftMaterials, type MatKey } from './materials';
import { pomaQuadChair } from './pomaChair';
import { pomaTower } from './pomaTower';

interface Prop<T> { value: T; status: 'verified' | 'estimated' | 'unknown' }
interface Station { bullwheelS: number; portalS: number; ground: number; ropeAboveGround: number }
export interface LiftRecord {
  id: string;
  name: string;
  props: {
    operatingSpeedMps: Prop<number>;
    stationSpeedMps: Prop<number>;
    chairSpacingM: Prop<number>;
    lineGaugeM: Prop<number>;
    ropeDiameterMm: Prop<number>;
    towerHeadAboveRopeM: Prop<number>;
    [k: string]: Prop<unknown>;
  };
  line: { path: number[]; bottom: Station; top: Station };
  towers: { n: number; s: number; ground: number; top: number }[];
}

/** Rope tension divided by rope weight per meter; sets how much the rope sags between towers. Assumed. */
const CATENARY_M = 1800;
const STATION_ACCEL = 0.8; // m/s2, assumed

class PolyCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private pts: THREE.Vector3[], private cum: number[]) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const d = t * this.cum[this.cum.length - 1];
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    const f = (d - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1);
    return target.lerpVectors(this.pts[lo], this.pts[hi], f);
  }
}

/** One lift: towers and rope placed from measured data, chairs moving at the real speed. */
export class Lift {
  readonly group = new THREE.Group();
  readonly carriers: number;
  readonly loopLength: number;
  readonly rideSeconds: number;
  private pts: THREE.Vector3[] = [];
  private cum: number[] = [];
  private time: number[] = []; // seconds to reach each loop point from the start
  private chairs: THREE.InstancedMesh[] = [];
  private clock = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly rec: LiftRecord, mats: LiftMaterials) {
    const gauge = rec.props.lineGaugeM.value;
    const head = rec.props.towerHeadAboveRopeM.value;
    const { bottom, top } = rec.line;

    // Centre line in local meters, with horizontal distance s measured from its first point
    const P: { x: number; z: number }[] = [];
    for (let i = 0; i < rec.line.path.length; i += 2) P.push(toLocal(rec.line.path[i + 1], rec.line.path[i]));
    const cs = [0];
    for (let i = 1; i < P.length; i++) cs.push(cs[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const frame = (s: number) => {
      let i = 1;
      while (i < P.length - 1 && cs[i] < s) i++;
      const a = P[i - 1], b = P[i], len = cs[i] - cs[i - 1];
      const fx = (b.x - a.x) / len, fz = (b.z - a.z) / len;
      const d = s - cs[i - 1];
      return { x: a.x + fx * d, z: a.z + fz * d, fx, fz, rx: -fz, rz: fx }; // r = to the right of travel uphill
    };

    // Rope supports: station ends and every tower
    const yB = bottom.ground + bottom.ropeAboveGround, yT = top.ground + top.ropeAboveGround;
    const sup: { s: number; y: number }[] = [{ s: bottom.bullwheelS, y: yB }, { s: bottom.portalS, y: yB }];
    for (const t of rec.towers) sup.push({ s: t.s, y: t.ground + t.top - head });
    sup.push({ s: top.portalS, y: yT }, { s: top.bullwheelS, y: yT });
    const ropeY = (s: number) => {
      let i = 1;
      while (i < sup.length - 1 && sup[i].s < s) i++;
      const a = sup[i - 1], b = sup[i], L = b.s - a.s, t = Math.min(1, Math.max(0, (s - a.s) / L));
      const flat = a.y === b.y; // inside a station
      const sag = flat ? 0 : (L * L) / (8 * CATENARY_M);
      return a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t);
    };

    // Towers
    const world = new Parts();
    for (let i = 0; i < rec.towers.length; i++) {
      const t = rec.towers[i], k = i + 2; // index into sup
      const inSlope = (sup[k].y - sup[k - 1].y) / (sup[k].s - sup[k - 1].s);
      const outSlope = (sup[k + 1].y - sup[k].y) / (sup[k + 1].s - sup[k].s);
      const bendDeg = THREE.MathUtils.radToDeg(Math.atan(outSlope) - Math.atan(inSlope));
      const f = frame(t.s);
      const tower = pomaTower({
        ropeH: t.top - head,
        headAboveRope: head,
        gauge,
        slope: (inSlope + outSlope) / 2,
        sheaves: Math.min(12, 4 + 2 * Math.round(Math.abs(bendDeg) / 2.5)),
        holdDown: bendDeg > 0.3,
      });
      const mat = new THREE.Matrix4().makeTranslation(f.x, t.ground, f.z).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(f.fx, f.fz)));
      tower.drainInto(world, mat);
    }
    this.addMeshes(world.build(), mats);

    // Chair path: up the right-hand side, around the top bullwheel, down the left, around the bottom
    const r = gauge / 2;
    const push = (x: number, y: number, z: number) => this.pts.push(new THREE.Vector3(x, y, z));
    const stops = new Set<number>();
    for (let s = bottom.bullwheelS; s < top.bullwheelS; s += 2) stops.add(s);
    for (const u of sup) stops.add(u.s);
    const ss = [...stops].sort((a, b) => a - b);
    for (const s of ss) { const f = frame(s); push(f.x + f.rx * r, ropeY(s), f.z + f.rz * r); }
    const turn = (s: number, y: number, dir: 1 | -1) => {
      const f = frame(s);
      for (let i = 1; i < 12; i++) {
        const a = (i / 12) * Math.PI;
        push(f.x + dir * r * (Math.cos(a) * f.rx + Math.sin(a) * f.fx), y, f.z + dir * r * (Math.cos(a) * f.rz + Math.sin(a) * f.fz));
      }
    };
    const upCount = this.pts.length;
    turn(top.bullwheelS, yT, 1);
    const topTurnEnd = this.pts.length;
    for (let i = ss.length - 1; i >= 0; i--) { const f = frame(ss[i]); push(f.x - f.rx * r, ropeY(ss[i]), f.z - f.rz * r); }
    const downEnd = this.pts.length;
    turn(bottom.bullwheelS, yB, -1);
    this.pts.push(this.pts[0].clone());

    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.loopLength = this.cum[this.cum.length - 1];

    // Speed along the loop: slow around each bullwheel, accelerating to line speed inside the station
    const vLine = rec.props.operatingSpeedMps.value, vSta = rec.props.stationSpeedMps.value;
    const slow: [number, number][] = [
      [this.cum[upCount - 1] - 6, this.cum[topTurnEnd] + 6],
      [this.cum[downEnd - 1] - 6, this.loopLength + 6],
      [-6, 6],
    ];
    const speedAt = (d: number) => {
      let gap = Infinity;
      for (const [a, b] of slow) gap = Math.min(gap, d < a ? a - d : d > b ? d - b : 0);
      return Math.min(vLine, Math.sqrt(vSta * vSta + 2 * STATION_ACCEL * gap));
    };
    this.time = [0];
    for (let i = 1; i < this.cum.length; i++) {
      const v = (speedAt(this.cum[i - 1]) + speedAt(this.cum[i])) / 2;
      this.time.push(this.time[i - 1] + (this.cum[i] - this.cum[i - 1]) / v);
    }
    const lap = this.time[this.time.length - 1];
    this.carriers = Math.round(lap / (rec.props.chairSpacingM.value / vLine));
    this.rideSeconds = this.time[upCount - 1];

    // Haul rope
    const rope = new THREE.TubeGeometry(new PolyCurve(this.pts, this.cum), this.pts.length * 2, rec.props.ropeDiameterMm.value / 2000, 6, true);
    const ropeMesh = new THREE.Mesh(rope, mats.rope);
    ropeMesh.frustumCulled = false;
    this.group.add(ropeMesh);
    // A one-pixel line keeps the rope visible from far away, where the tube is thinner than a pixel
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.pts), new THREE.LineBasicMaterial({ color: 0x3a3d40, transparent: true, opacity: 0.55 }));
    line.frustumCulled = false;
    this.group.add(line);

    // Chairs: one shared model drawn once per carrier
    for (const [key, geo] of pomaQuadChair().build()) {
      const mesh = new THREE.InstancedMesh(geo, mats[key], this.carriers);
      mesh.frustumCulled = false;
      this.chairs.push(mesh);
      this.group.add(mesh);
    }
    this.update(0);
  }

  private addMeshes(geos: Map<MatKey, THREE.BufferGeometry>, mats: LiftMaterials) {
    for (const [key, geo] of geos) {
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  /** Position and heading of a point `seconds` into a lap. */
  private at(seconds: number, pos: THREE.Vector3): number {
    const T = this.time;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= seconds) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi];
    pos.lerpVectors(a, b, (seconds - T[lo]) / (T[hi] - T[lo] || 1));
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  update(dt: number) {
    const lap = this.time[this.time.length - 1];
    this.clock = (this.clock + dt) % lap;
    for (let i = 0; i < this.carriers; i++) {
      const yaw = this.at((this.clock + (i * lap) / this.carriers) % lap, this.p);
      this.q.setFromAxisAngle(this.up, yaw);
      this.m.compose(this.p, this.q, this.one);
      for (const mesh of this.chairs) mesh.setMatrixAt(i, this.m);
    }
    for (const mesh of this.chairs) mesh.instanceMatrix.needsUpdate = true;
  }

  /** World position of carrier `i`, for the camera to follow. */
  carrierPosition(i: number, out: THREE.Vector3): number {
    const lap = this.time[this.time.length - 1];
    return this.at((this.clock + (i * lap) / this.carriers) % lap, out);
  }
}

export class LiftSystem {
  readonly group = new THREE.Group();
  readonly lifts: Lift[] = [];

  constructor(records: LiftRecord[], shared: SharedUniforms) {
    const mats = makeLiftMaterials(shared);
    for (const rec of records) {
      const lift = new Lift(rec, mats);
      this.lifts.push(lift);
      this.group.add(lift.group);
    }
  }

  update(dt: number) {
    for (const l of this.lifts) l.update(dt);
  }
}
