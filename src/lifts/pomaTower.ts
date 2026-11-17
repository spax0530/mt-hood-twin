import * as THREE from 'three';
import { Parts } from './geom';

export interface TowerSpec {
  /** Height of the rope above the ground at the tower (m). */
  ropeH: number;
  /** Height of the top of the lifting frame above the rope (m). */
  headAboveRope: number;
  /** Distance between the two ropes (m). */
  gauge: number;
  /** Rope slope at the tower, rise over run. */
  slope: number;
  /** Sheaves per side. */
  sheaves: number;
  /** true when the rope runs under the sheaves (hold-down tower). */
  holdDown: boolean;
}

/**
 * Poma tubular tower as on the Magic Mile: round painted mast, box crossarm, rectangular lifting
 * frame above it, and a sheave train under each end of the crossarm. Shapes from reference photos
 * rm-25, rm-4 and lb-7249; dimensions are estimates except the overall height, which is lidar.
 *
 * Local frame: origin on the ground at the mast centre, +Y up, +Z uphill along the line.
 */
export function pomaTower(t: TowerSpec): Parts {
  const P = new Parts();
  const armY = t.ropeH + (t.holdDown ? -0.55 : 0.55); // crossarm centre
  const topY = t.ropeH + t.headAboveRope;
  const half = t.gauge / 2;

  // Mast, sunk a little so sloping ground never shows a gap, and its yellow impact pad
  P.cyl('towerPaint', 0.38, armY + 1.2, [0, (armY - 1.2) / 2, 0], 'y', 24);
  P.cyl('pad', 0.62, 1.9, [0, 0.95, 0], 'y', 20);

  // Crossarm
  P.box('towerPaint', [t.gauge + 1.0, 0.42, 0.36], [0, armY, 0]);

  // Lifting frame: two long top beams joined at the ends, on four splayed posts
  const fw = half + 0.75;
  for (const z of [-0.55, 0.55]) P.box('towerPaint', [fw * 2, 0.12, 0.12], [0, topY - 0.06, z]);
  for (const x of [-fw, fw]) P.box('towerPaint', [0.12, 0.12, 1.22], [x, topY - 0.06, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P.bar('towerPaint', [sx * (half - 0.15), armY + 0.2, sz * 0.16], [sx * (fw - 0.05), topY - 0.1, sz * 0.55], 0.055, 6);
  }
  // mid rails of the frame
  const midY = (armY + topY) / 2 + 0.25;
  for (const z of [-0.5, 0.5]) P.box('towerPaint', [fw * 1.7, 0.06, 0.06], [0, midY, z]);

  // Sheave trains
  const pitch = 0.58, r = 0.23;
  const len = t.sheaves * pitch;
  const ang = -Math.atan(t.slope);
  const side = t.holdDown ? 1 : -1; // sheaves above the rope on a hold-down tower, below otherwise
  for (const sx of [-1, 1]) {
    const x = sx * half;
    const beam = new Parts();
    beam.box('darkSteel', [0.1, 0.16, len], [0, side * (r + 0.2), 0]);
    beam.box('darkSteel', [0.1, 0.16, len], [0.16 * sx, side * (r + 0.2), 0]);
    for (let i = 0; i < t.sheaves; i++) {
      const z = (i - (t.sheaves - 1) / 2) * pitch;
      beam.cyl('rubber', r, 0.075, [0.08 * sx, side * r, z], 'x', 18);
      beam.cyl('galvanized', r * 0.55, 0.09, [0.08 * sx, side * r, z], 'x', 12);
    }
    beam.drainInto(P, rotX(ang, [x, t.ropeH, 0]));
    // hanger between the crossarm end and the sheave train
    P.box('towerPaint', [0.2, Math.abs(armY - (t.ropeH + side * (r + 0.2))) + 0.1, 0.24], [x + 0.08 * sx, (armY + t.ropeH + side * (r + 0.2)) / 2, 0]);
  }

  // Ladder up the downhill face of the mast
  const lz = -0.44;
  for (const x of [-0.19, 0.19]) P.box('galvanized', [0.03, armY - 1.9, 0.03], [x, 1.9 + (armY - 1.9) / 2, lz]);
  for (let y = 2.2; y < armY - 0.1; y += 0.3) P.box('galvanized', [0.38, 0.022, 0.022], [0, y, lz]);
  return P;
}

function rotX(a: number, at: [number, number, number]): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(at[0], at[1], at[2]).multiply(new THREE.Matrix4().makeRotationX(a));
}
