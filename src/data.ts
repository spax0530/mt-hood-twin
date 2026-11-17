// Map data baked from OpenStreetMap plus lidar-derived heights (see DATA_SOURCES.md).
// Coordinates are flat [lon, lat, lon, lat, ...] arrays in degrees.

export interface Run {
  n: string | null; // name
  d: string | null; // difficulty: novice, easy, intermediate, advanced, expert, extreme, freeride
  t: string; // downhill, nordic, snow_park, skitour, hike
  g: string | null; // grooming
  ref: string | null;
  a: 0 | 1; // drawn as an area rather than a line
  p: number[];
}
export interface Lift {
  id: number;
  tags: Record<string, string>;
  p: number[];
  e: (number | null)[]; // ground elevation (m) at each point
  pyl: number[]; // indices of points that are towers
  sta: number[]; // indices of points that are stations
}
export interface RoofGrid {
  x0: number; y1: number; // lon of west edge, lat of north edge
  dx: number; dy: number; // degrees per step
  nx: number; ny: number;
  step: number; // meters per step
  base: number; // elevation (m) that heights are measured from
  h: number[]; // surface height above base, in decimeters, row 0 = north
}
export interface Building {
  id: number;
  tags: Record<string, string>;
  p: number[];
  c: [number, number]; // centroid lon, lat
  g: number | null; // ground elevation at centroid (m)
  h?: [number, number, number, number]; // lidar height above ground: 25th, 50th, 80th percentile, max (m)
  grid?: RoofGrid; // lidar surface over the building, for large or complex ones
}
export interface NamedArea { n: string | null; p: number[] }
export interface MapData {
  fetched: string;
  areas: NamedArea[];
  runs: Run[];
  lifts: Lift[];
  stations: { n: string | null; lon: number; lat: number }[];
  buildings: Building[];
  parking: NamedArea[];
}

export async function loadMapData(): Promise<MapData | null> {
  try {
    const res = await fetch(`./data/osm.json?v=${__BUILD__}`);
    if (res.ok) return (await res.json()) as MapData;
  } catch { /* fall through */ }
  // Preview copy left in this browser by tools/fetch-data.html, used until the file is in the repo
  try {
    const local = localStorage.getItem('mt-hood-osm');
    return local ? (JSON.parse(local) as MapData) : null;
  } catch {
    return null;
  }
}
