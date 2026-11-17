import { Parts } from './geom';

/**
 * Poma detachable quad chair as fitted to the Magic Mile (1992).
 * Proportions scaled from reference photo rm-46 assuming a 2.2 m seat; all dimensions are estimates.
 *
 * Local frame: origin where the grip holds the rope, +Y up, +Z direction of travel, +X to the
 * rider's left. The chair hangs plumb below the grip.
 */
export function pomaQuadChair(): Parts {
  const P = new Parts();
  const cx = -0.22; // chair centre sits slightly to one side of the hanger, as in the photo
  const yBar = -1.4; // top crossbar
  const ySeat = -2.98; // top of the seat cushion
  const halfTop = 0.85, halfSeat = 1.1;

  // Grip (Poma TB): jaw block on the rope, spring pack and two guide wheels
  P.box('darkSteel', [0.14, 0.13, 0.44], [0, 0.0, 0]);
  P.box('darkSteel', [0.12, 0.3, 0.16], [0, -0.2, 0]);
  P.cyl('darkSteel', 0.07, 0.05, [0.1, 0.02, 0.15], 'x', 12);
  P.cyl('darkSteel', 0.07, 0.05, [0.1, 0.02, -0.15], 'x', 12);

  // Hanger arm: straight down from the grip, then bent along the top of the crossbar
  P.tube('galvanized', [[0, -0.3, 0], [0, yBar + 0.09, 0], [cx - 0.75, yBar + 0.09, 0]], 0.038, 0.17);

  // Top crossbar and number plate
  P.box('galvanized', [halfTop * 2, 0.07, 0.1], [cx, yBar, 0]);
  P.box('plate', [0.17, 0.13, 0.012], [cx, yBar + 0.04, 0.058]);
  P.box('plate', [0.17, 0.13, 0.012], [cx, yBar + 0.04, -0.058]);

  // Bail: side tubes curving down from the crossbar and splaying out to the seat width
  for (const s of [-1, 1]) {
    P.tube(
      'galvanized',
      [
        [cx + s * (halfTop - 0.25), yBar, 0],
        [cx + s * halfTop, yBar, 0],
        [cx + s * halfSeat, ySeat - 0.12, 0.02],
        [cx + s * halfSeat, ySeat - 0.12, 0.3],
      ],
      0.026,
      0.2,
    );
    // back support upright
    P.tube('galvanized', [[cx + s * halfSeat, ySeat - 0.12, 0.02], [cx + s * halfSeat, ySeat - 0.12, -0.2], [cx + s * halfSeat, ySeat + 0.5, -0.3]], 0.022, 0.1);
  }
  // Seat frame rails under the cushion
  P.bar('galvanized', [cx - halfSeat, ySeat - 0.12, 0.3], [cx + halfSeat, ySeat - 0.12, 0.3], 0.024);
  P.bar('galvanized', [cx - halfSeat, ySeat - 0.12, -0.14], [cx + halfSeat, ySeat - 0.12, -0.14], 0.024);

  // Seat and backrest cushions (black)
  P.box('cushion', [halfSeat * 2 - 0.04, 0.09, 0.47], [cx, ySeat - 0.045, 0.08]);
  P.box('cushion', [halfSeat * 2 - 0.04, 0.4, 0.08], [cx, ySeat + 0.27, -0.25], [-0.17, 0, 0]);

  // Lap bar, hung from the crossbar on two rods (no footrests)
  P.tube(
    'galvanized',
    [
      [cx - 0.52, yBar - 0.03, 0.02],
      [cx - 0.52, yBar - 0.68, 0.34],
      [cx - 0.78, yBar - 0.72, 0.38],
      [cx - 0.78, yBar - 0.8, 0.4],
      [cx + 0.78, yBar - 0.8, 0.4],
      [cx + 0.78, yBar - 0.72, 0.38],
      [cx + 0.52, yBar - 0.68, 0.34],
      [cx + 0.52, yBar - 0.03, 0.02],
    ],
    0.016,
    0.08,
    6,
  );
  return P;
}
