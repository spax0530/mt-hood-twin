import { QUALITY, SUMMIT, type QualityName } from '../config';
import { M_TO_FT } from '../geo';
import type { Place } from '../camera/controls';
import type { GroundSample } from '../terrain/terrain';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (m: number) => `${Math.round(m * M_TO_FT).toLocaleString()} ft (${Math.round(m).toLocaleString()} m)`;

export interface HudHandlers {
  onJump(p: Place): void;
  onQuality(q: QualityName): void;
  onHour(h: number): void;
  onNorth(): void;
}

export class Hud {
  constructor(places: Place[], quality: QualityName, hour: number, h: HudHandlers) {
    const jump = $<HTMLSelectElement>('jump');
    for (const p of places) jump.add(new Option(p.name, p.id));
    jump.onchange = () => { h.onJump(places.find((p) => p.id === jump.value)!); jump.blur(); };

    const q = $<HTMLSelectElement>('quality');
    for (const name of Object.keys(QUALITY)) q.add(new Option(name[0].toUpperCase() + name.slice(1), name));
    q.value = quality;
    q.onchange = () => { h.onQuality(q.value as QualityName); q.blur(); };

    const t = $<HTMLInputElement>('hour');
    const label = () => {
      const v = Number(t.value), hh = Math.floor(v), mm = Math.round((v - hh) * 60);
      $('hourLabel').textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
    };
    t.value = String(hour); label();
    t.oninput = () => { h.onHour(Number(t.value)); label(); };
    $('compass').onclick = () => h.onNorth();
  }

  setHeading(deg: number) {
    $('rose').style.transform = `rotate(${-deg}deg)`;
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $('bearing').textContent = `${names[Math.round(deg / 45) % 8]} ${Math.round(deg) % 360}\u00b0`;
  }

  /** Says plainly how detailed the ground under the camera is and where it came from. */
  setDetail(g: GroundSample | null, lidarDown: boolean) {
    if (!g) return;
    const r = g.res < 2 ? g.res.toFixed(1) : String(Math.round(g.res));
    $('detail').textContent = g.lidar
      ? `${r} m grid, USGS 3DEP lidar service`
      : `${r} m grid from 10 m source data${lidarDown ? ' (lidar service not responding)' : ''}`;
  }

  setReadout(camElev: number, ground: number | null) {
    $('camElev').textContent = fmt(camElev);
    $('agl').textContent = ground === null ? '...' : `${Math.round((camElev - ground) * M_TO_FT).toLocaleString()} ft above ground`;
  }

  setSummit(s: GroundSample | null) {
    if (!s) return;
    const diff = s.h - SUMMIT.elevM;
    $('summit').textContent = `${fmt(s.h)}, ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} m vs surveyed, data zoom ${s.zoom}`;
  }

  setStatus(text: string) { $('status').textContent = text; }
}
