import { SOURCES } from '../config';

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

/** Aerial imagery for a tile, optionally stitched from sharper child tiles. */
export async function loadImagery(z: number, x: number, y: number, zoomOffset: number): Promise<HTMLCanvasElement> {
  const n = 2 ** zoomOffset;
  const c = document.createElement('canvas');
  c.width = c.height = TILE_PX * n;
  const ctx = c.getContext('2d')!;
  const jobs: Promise<void>[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      jobs.push(
        fetchBitmap(url(SOURCES.img, z + zoomOffset, x * n + i, y * n + j)).then((b) => {
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
