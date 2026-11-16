import type { Run } from '../data';
import { latToTileY, lonToTileX } from '../geo';

const STYLE: Record<string, { color: string; dash?: boolean }> = {
  novice: { color: '#2e9e4f' },
  easy: { color: '#2e9e4f' },
  intermediate: { color: '#2563eb' },
  advanced: { color: '#15171a' },
  expert: { color: '#15171a', dash: true },
  extreme: { color: '#15171a', dash: true },
  freeride: { color: '#15171a', dash: true },
};

interface Prepared {
  run: Run;
  m: Float64Array; // Web Mercator position of each point as a fraction of the world (0..1)
  box: [number, number, number, number];
  widthM: number;
}

/**
 * Paints ski runs into a per-tile image that the terrain shader lays over the snow,
 * so runs follow the ground exactly at every level of detail.
 */
export class RunPainter {
  private items: Prepared[] = [];

  constructor(runs: Run[]) {
    for (const run of runs) {
      if (run.t !== 'downhill' && run.t !== 'nordic' && run.t !== 'snow_park') continue;
      const n = run.p.length / 2;
      const m = new Float64Array(n * 2);
      const box: [number, number, number, number] = [1, 1, 0, 0];
      for (let i = 0; i < n; i++) {
        const x = lonToTileX(run.p[i * 2], 0), y = latToTileY(run.p[i * 2 + 1], 0);
        m[i * 2] = x; m[i * 2 + 1] = y;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      }
      this.items.push({ run, m, box, widthM: run.t === 'downhill' ? 9 : 4 });
    }
  }

  paint(z: number, x: number, y: number): HTMLCanvasElement | null {
    const s = 2 ** z;
    const pad = 0.02;
    const hits = this.items.filter(
      (it) => it.box[2] * s > x - pad && it.box[0] * s < x + 1 + pad && it.box[3] * s > y - pad && it.box[1] * s < y + 1 + pad,
    );
    if (!hits.length) return null;
    const size = z >= 15 ? 256 : 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.lineJoin = ctx.lineCap = 'round';
    // ground meters per pixel at this latitude (Mt Hood is near 45.35 N)
    const mpp = (40075016.7 * Math.cos((45.35 * Math.PI) / 180)) / s / size;
    // areas first, lines on top
    for (const pass of [1, 0]) {
      for (const it of hits) {
        if (it.run.a !== pass) continue;
        const st = it.run.t === 'nordic' ? { color: '#0e7c86', dash: true }
          : it.run.t === 'snow_park' ? { color: '#e07b00' }
          : STYLE[it.run.d ?? ''] ?? { color: '#6b7280' };
        ctx.beginPath();
        for (let i = 0; i < it.m.length; i += 2) {
          const px = (it.m[i] * s - x) * size, py = (it.m[i + 1] * s - y) * size;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        if (pass) {
          ctx.closePath();
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = st.color;
          ctx.fill();
        } else {
          const w = Math.max(1.6, it.widthM / mpp);
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = st.color;
          ctx.lineWidth = w;
          ctx.setLineDash(st.dash ? [w * 2.2, w * 1.8] : []);
          ctx.stroke();
        }
      }
    }
    return c;
  }
}
