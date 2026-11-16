import * as THREE from 'three';
import type { Terrain } from '../terrain/terrain';

export type LabelKind = 'resort' | 'place' | 'lift' | 'run';
export interface LabelItem { text: string; x: number; z: number; kind: LabelKind; sub?: string }

const RULES: Record<LabelKind, { max: number; min: number; rank: number; lift: number }> = {
  resort: { max: 60000, min: 2500, rank: 0, lift: 60 },
  place: { max: 3500, min: 0, rank: 1, lift: 22 },
  lift: { max: 6000, min: 0, rank: 2, lift: 14 },
  run: { max: 2600, min: 0, rank: 3, lift: 4 },
};

/** Text labels pinned to places on the mountain, hidden when far away, overlapping or behind terrain. */
export class Labels {
  private pool: HTMLDivElement[] = [];
  private v = new THREE.Vector3();
  enabled = true;

  constructor(private root: HTMLElement, private items: LabelItem[], private terrain: Terrain) {}

  private visibleFrom(cam: THREE.Vector3, x: number, y: number, z: number): boolean {
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const g = this.terrain.heightAt(cam.x + (x - cam.x) * t, cam.z + (z - cam.z) * t);
      if (g && g.h > cam.y + (y - cam.y) * t + 2) return false;
    }
    return true;
  }

  update(camera: THREE.PerspectiveCamera, w: number, h: number) {
    let used = 0;
    if (this.enabled) {
      const cam = camera.position;
      const cands: { it: LabelItem; d: number; sx: number; sy: number }[] = [];
      for (const it of this.items) {
        const r = RULES[it.kind];
        const d = Math.hypot(it.x - cam.x, it.z - cam.z);
        if (d > r.max || d < r.min) continue;
        const g = this.terrain.heightAt(it.x, it.z);
        if (!g) continue;
        const y = g.h + r.lift;
        this.v.set(it.x, y, it.z).project(camera);
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
        if (!this.visibleFrom(cam, it.x, y, it.z)) continue;
        cands.push({ it, d, sx: (this.v.x * 0.5 + 0.5) * w, sy: (-this.v.y * 0.5 + 0.5) * h });
      }
      cands.sort((a, b) => RULES[a.it.kind].rank - RULES[b.it.kind].rank || a.d - b.d);
      const boxes: number[][] = [];
      for (const c of cands) {
        if (used >= 70) break;
        const bw = c.it.text.length * 6.6 + 14, bh = 18;
        const box = [c.sx - bw / 2, c.sy - bh, c.sx + bw / 2, c.sy];
        if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        let el = this.pool[used];
        if (!el) { el = document.createElement('div'); this.root.appendChild(el); this.pool.push(el); }
        if (el.textContent !== c.it.text) el.textContent = c.it.text;
        el.className = `lbl ${c.it.kind} ${c.it.sub ?? ''}`;
        el.style.transform = `translate(${Math.round(c.sx)}px, ${Math.round(c.sy)}px) translate(-50%, -100%)`;
        el.style.display = '';
        used++;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }
}
