import { fromArrayBuffer } from 'geotiff';
import { IMG_MAX_Z, SOURCES } from '../config';

export const TILE_PX = 256;

const url = (tpl: string, z: number, x: number, y: number) =>
  tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

async function fetchBitmap(u: string): Promise<ImageBitmap> {
  const res = await fetch(u, { mode: 'cors' });
  if (!res.ok) throw new Error(`${res.status} ${u}`);
  return createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
}

/** Elevation tile decoded to meters above sea level, 256 x 256, row 0 = north. */
export async function loadDem(z: number, x: number, y: number): Promise<Float32Array> {
  const bmp = await fetchBitmap(url(SOURCES.dem, z, x, y));
  const c = document.createElement('canvas');
  c.width = c.height = TILE_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, TILE_PX, TILE_PX);
  bmp.close();
  const px = ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
  const out = new Float32Array(TILE_PX * TILE_PX);
  for (let i = 0; i < out.length; i++) {
    // terrarium encoding
    out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  return out;
}

const HALF = Math.PI * 6378137; // half the Web Mercator world width (m)

/**
 * Elevation for a tile from the USGS 3DEP dynamic service, which serves the best data
 * available at each spot (1 m lidar where it has been flown). Throws if the answer is not
 * a clean 256 x 256 grid of plausible heights, so the caller can fall back.
 */
export async function loadLidar(z: number, x: number, y: number): Promise<Float32Array> {
  const span = (2 * HALF) / 2 ** z;
  const minx = -HALF + x * span, maxy = HALF - y * span;
  const q = new URLSearchParams({
    bbox: [minx, maxy - span, minx + span, maxy].join(','),
    bboxSR: '3857', imageSR: '3857', size: `${TILE_PX},${TILE_PX}`,
    format: 'tiff', pixelType: 'F32', interpolation: 'RSP_BilinearInterpolation', f: 'image',
  });
  const res = await fetch(`${SOURCES.lidar}?${q}`, { mode: 'cors' });
  if (!res.ok) throw new Error(`lidar ${res.status}`);
  const img = await (await fromArrayBuffer(await res.arrayBuffer())).getImage();
  if (img.getWidth() !== TILE_PX || img.getHeight() !== TILE_PX) throw new Error('lidar: unexpected size');
  const out = Float32Array.from((await img.readRasters({ interleave: true })) as unknown as ArrayLike<number>);
  if (out.length !== TILE_PX * TILE_PX) throw new Error('lidar: unexpected bands');
  for (let i = 0; i < out.length; i++) if (!(out[i] > -100 && out[i] < 4000)) throw new Error('lidar: no data');
  return out;
}

const bitmaps = new Map<string, Promise<ImageBitmap>>();
function cachedBitmap(u: string): Promise<ImageBitmap> {
  let p = bitmaps.get(u);
  if (!p) {
    p = fetchBitmap(u);
    bitmaps.set(u, p);
    p.catch(() => bitmaps.delete(u));
    if (bitmaps.size > 48) bitmaps.delete(bitmaps.keys().next().value!);
  }
  return p;
}

/** Aerial imagery for a tile: stitched from sharper tiles, or cropped from a coarser one past the imagery's deepest zoom. */
export async function loadImagery(z: number, x: number, y: number, zoomOffset: number): Promise<HTMLCanvasElement> {
  const imgZ = Math.min(z + zoomOffset, IMG_MAX_Z);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  if (imgZ < z) {
    const d = z - imgZ, n = 2 ** d;
    const b = await cachedBitmap(url(SOURCES.img, imgZ, x >> d, y >> d));
    c.width = c.height = TILE_PX;
    const s = TILE_PX / n;
    ctx.drawImage(b, (x - ((x >> d) << d)) * s, (y - ((y >> d) << d)) * s, s, s, 0, 0, TILE_PX, TILE_PX);
    return c;
  }
  const n = 2 ** (imgZ - z);
  c.width = c.height = TILE_PX * n;
  const jobs: Promise<void>[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      jobs.push(
        fetchBitmap(url(SOURCES.img, imgZ, x * n + i, y * n + j)).then((b) => {
          ctx.drawImage(b, i * TILE_PX, j * TILE_PX, TILE_PX, TILE_PX);
          b.close();
        }),
      );
  await Promise.all(jobs);
  return c;
}

/** Bilinear height sample; px/py in pixel-center coordinates, clamped to the tile. */
export function sampleHeights(h: Float32Array, px: number, py: number): number {
  const m = TILE_PX - 1;
  px = Math.min(m, Math.max(0, px));
  py = Math.min(m, Math.max(0, py));
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(m, x0 + 1), y1 = Math.min(m, y0 + 1);
  const fx = px - x0, fy = py - y0;
  const a = h[y0 * TILE_PX + x0], b = h[y0 * TILE_PX + x1];
  const c = h[y1 * TILE_PX + x0], d = h[y1 * TILE_PX + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
