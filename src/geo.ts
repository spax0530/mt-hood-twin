// Geographic helpers. World frame: X = east, Y = up, Z = south, in real meters,
// with the origin at the Mt Hood summit. 1 unit = 1 meter, so distances, heights
// and speeds are true to scale.

export const ORIGIN = { lat: 45.373611, lon: -121.695833 };

const A = 6378137; // WGS84 semi-major axis (m)
const E2 = 0.00669437999014;
const D = Math.PI / 180;

function radii(lat: number) {
  const s = Math.sin(lat * D);
  const w = Math.sqrt(1 - E2 * s * s);
  return { N: A / w, M: (A * (1 - E2)) / (w * w * w) };
}
const M0 = radii(ORIGIN.lat).M;

/** lat/lon (degrees) to local meters. Accurate to about 1 part in 100,000 over the mountain. */
export function toLocal(lat: number, lon: number): { x: number; z: number } {
  const { N } = radii(lat);
  return {
    x: N * Math.cos(lat * D) * (lon - ORIGIN.lon) * D,
    z: -M0 * (lat - ORIGIN.lat) * D,
  };
}

export function toGeo(x: number, z: number): { lat: number; lon: number } {
  const lat = ORIGIN.lat + -z / M0 / D;
  const { N } = radii(lat);
  return { lat, lon: ORIGIN.lon + x / (N * Math.cos(lat * D)) / D };
}

// Web Mercator tile math (fractional tile coordinates allowed)
export const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const tileLat = (y: number, z: number) =>
  Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / D;
export const lonToTileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const latToTileY = (lat: number, z: number) => {
  const r = lat * D;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export const M_TO_FT = 3.280839895;
