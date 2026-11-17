"""Build a detailed building model from lidar roof planes + the real footprint.

usage: build_landmark.py <lidar.json> <spec.json> <out_dir>
Everything stays in real coordinates: x = meters east and y = meters south of the patch origin,
z = elevation in meters. The app converts x,y back to longitude/latitude.
"""
import json, sys, math, os
import numpy as np
from shapely.geometry import Polygon, box
from shapely.prepared import prep
from shapely.ops import triangulate
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roofplanes as rp

def median3(h):
    p = np.pad(h, 1, mode='edge'); s = np.stack([p[j:j + h.shape[0], i:i + h.shape[1]] for j in range(3) for i in range(3)])
    return np.median(s, 0)

def clusters(m):
    seen = np.zeros_like(m); out = []; ny, nx = m.shape
    for j, i in np.argwhere(m):
        if seen[j, i]: continue
        st = [(j, i)]; seen[j, i] = True; cells = []
        while st:
            cj, ci = st.pop(); cells.append((cj, ci))
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nj, ni = cj + dj, ci + di
                if 0 <= nj < ny and 0 <= ni < nx and m[nj, ni] and not seen[nj, ni]: seen[nj, ni] = True; st.append((nj, ni))
        out.append(np.array(cells))
    return out

class Mesh:
    def __init__(self): self.v = {}; self.pos = []; self.uv = []; self.idx = []
    def vert(self, x, y, z, u=0.0, w=0.0):
        k = (round(x, 3), round(y, 3), round(z, 3), round(u, 2), round(w, 2))
        i = self.v.get(k)
        if i is None: i = self.v[k] = len(self.pos) // 3; self.pos += [x, y, z]; self.uv += [u, w]
        return i
    def tri(self, a, b, c): self.idx += [a, b, c]
    def quad(self, a, b, c, d): self.idx += [a, b, c, a, c, d]
    def dump(self, uv=True):
        o = {'pos': [round(float(q), 2) for q in self.pos], 'idx': self.idx}
        if uv: o['uv'] = [round(float(q), 2) for q in self.uv]
        return o

def build(D, spec):
    R = rp.run(D, spec['patch']); p = R['p']; st = p['step']; h = R['h']; ny, nx = h.shape
    hs = median3(h); lab = R['lab'].copy(); planes = [tuple(map(float, q)) for q in R['planes']]
    I, J = np.meshgrid(np.arange(nx), np.arange(ny))
    P = np.array(planes); pl = np.where(lab >= 0, P[np.clip(lab, 0, None), 0] * I * st + P[np.clip(lab, 0, None), 1] * J * st + P[np.clip(lab, 0, None), 2], hs)
    core = rp.erode(R['mask'], 1); diff = h - pl
    chimneys = []; dormers = []
    for c in clusters((diff > 0.8) & core & (lab >= 0)):
        area = len(c) * st * st; rise = float(diff[c[:, 0], c[:, 1]].max())
        if area >= 9: lab[c[:, 0], c[:, 1]] = -1; continue
        cx, cy = float(c[:, 1].mean() * st), float(c[:, 0].mean() * st); top = float(h[c[:, 0], c[:, 1]].max())
        w, d = (np.ptp(c[:, 1]) + 1) * st, (np.ptp(c[:, 0]) + 1) * st
        k = int(np.bincount(lab[c[:, 0], c[:, 1]]).argmax())
        if rise >= 2.3 and area < 7: chimneys.append(dict(x=cx, y=cy, w=float(np.clip(w, 1.0, 2.2)), d=float(np.clip(d, 1.0, 2.2)), top=top, plane=k))
        elif 0.9 <= rise < 2.3 and area >= 1.4: dormers.append(dict(x=cx, y=cy, w=float(np.clip(max(w, d), 1.5, 2.6)), top=top))
    for c in clusters((diff < -1.2) & R['mask'] & (lab >= 0)): 
        if len(c) * st * st >= 4: lab[c[:, 0], c[:, 1]] = -1
    cent = {k: (float(I[lab == k].mean() * st), float(J[lab == k].mean() * st)) for k in range(len(planes)) if (lab == k).any()}
    pz = lambda k, x, y: planes[k][0] * x + planes[k][1] * y + planes[k][2]
    conv = {}
    def raw(x, y):
        i = min(max(x / st, 0), nx - 1.001); j = min(max(y / st, 0), ny - 1.001); i0 = int(i); j0 = int(j); u = i - i0; v = j - j0
        return hs[j0, i0] * (1 - u) * (1 - v) + hs[j0, i0 + 1] * u * (1 - v) + hs[j0 + 1, i0] * (1 - u) * v + hs[j0 + 1, i0 + 1] * u * v
    def near_core(j, i):
        best = None
        for dj in range(-4, 5):
            for di in range(-4, 5):
                nj, ni = j + dj, i + di
                if 0 <= nj < ny and 0 <= ni < nx and core[nj, ni]:
                    dd = dj * dj + di * di
                    if best is None or dd < best[0]: best = (dd, nj, ni)
        return best
    def HL(x, y):
        """Roof height from lidar alone: the fitted plane where it agrees with the lidar, the lidar itself where it does not."""
        i = int(min(max(round(x / st), 0), nx - 1)); j = int(min(max(round(y / st), 0), ny - 1))
        if not core[j, i]:
            # at the eaves the lidar mixes roof and ground, so continue the roof outward from just inside
            b = near_core(j, i)
            if b is None: return float(raw(x, y))
            _, cj, ci = b; l = int(lab[cj, ci])
            if l >= 0 and abs(hs[cj, ci] - pz(l, ci * st, cj * st)) < 0.6: return float(pz(l, x, y))
            return float(hs[cj, ci])
        l = int(lab[j, i]); r = float(raw(x, y))
        if l < 0: return r
        a = pz(l, x, y); d = abs(a - r); w = min(1.0, max(0.0, (d - 0.3) / 0.4)); w = w * w * (3 - 2 * w)
        return float(a * (1 - w) + r * w)

    # ---- optional hand-fitted main roof shapes (ridge lines, heights and pitches read off the lidar)
    prims = spec.get('roof', [])
    def Hprim(x, y):
        best = None
        for q in prims:
            if q['type'] == 'gable':
                ax, ay = q['a']; bx, by = q['b']; L = math.hypot(bx - ax, by - ay); dx, dy = (bx - ax) / L, (by - ay) / L
                t = (x - ax) * dx + (y - ay) * dy; o = -(x - ax) * dy + (y - ay) * dx - q.get('offset', 0.0)
                if t < -0.7 or t > L + 0.7 or abs(o) > q['half'] + 0.9: continue
                z = q['ridge'] - q['slope'] * abs(o)
                if 'hipA' in q: z = min(z, q['ridge'] - q['hipA'] * max(0.0, q.get('hipLen', 4.0) - t))
                if 'hipB' in q: z = min(z, q['ridge'] - q['hipB'] * max(0.0, t - (L - q.get('hipLen', 4.0))))
            else:  # hexagonal pyramid
                cx, cy = q['c']; dist = max((x - cx) * math.cos(math.radians(q.get('rot', 90) + 60 * k)) + (y - cy) * math.sin(math.radians(q.get('rot', 90) + 60 * k)) for k in range(6))
                if dist > q['apothem']: continue
                z = q['apex'] - q['slope'] * dist
            if best is None or z > best: best = z
        return best
    suppress = np.zeros((ny, nx), bool)
    if prims:
        Pg = np.full((ny, nx), np.nan)
        for j in range(ny):
            for i in range(nx):
                if core[j, i]:
                    v = Hprim(i * st, j * st)
                    if v is not None: Pg[j, i] = v
        dP = np.where(np.isnan(Pg), 0.0, hs - Pg); chimneys = []; dormers = []
        for c in clusters(dP > 0.8):
            area = len(c) * st * st; rise = float(dP[c[:, 0], c[:, 1]].max()); cx, cy = float(c[:, 1].mean() * st), float(c[:, 0].mean() * st); top = float(h[c[:, 0], c[:, 1]].max())
            w, d = (np.ptp(c[:, 1]) + 1) * st, (np.ptp(c[:, 0]) + 1) * st
            if any(math.hypot(cx - e['x'], cy - e['y']) < e.get('radius', 0) + 1.5 for e in spec.get('extras', [])): continue
            if rise >= 2.3 and area < 8:
                chimneys.append(dict(x=cx, y=cy, w=float(np.clip(w, 1.0, 2.2)), d=float(np.clip(d, 1.0, 2.2)), top=top)); suppress[c[:, 0], c[:, 1]] = True
            elif 0.9 <= rise < 2.6 and 1.4 <= area < 10:
                dormers.append(dict(x=cx, y=cy, w=float(np.clip(max(w, d) * 0.8, 1.5, 2.6)), top=top)); suppress[c[:, 0], c[:, 1]] = True
        k3 = suppress.copy(); k3[1:] |= suppress[:-1]; k3[:-1] |= suppress[1:]; k3[:, 1:] |= suppress[:, :-1]; k3[:, :-1] |= suppress[:, 1:]; suppress = k3
    def H(x, y):
        """Final roof height: the clean fitted shape, giving way to the lidar wherever the real roof departs from it."""
        P = Hprim(x, y) if prims else None
        if P is None: return HL(x, y)
        i = int(min(max(round(x / st), 0), nx - 1)); j = int(min(max(round(y / st), 0), ny - 1))
        if suppress[j, i] or not core[j, i]: return float(P)
        Lz = float(raw(x, y)); d = abs(Lz - P); w = min(1.0, max(0.0, (d - 0.7) / 0.6)); w = w * w * (3 - 2 * w)
        return float(P * (1 - w) + Lz * w)
    def roof_under(x, y):
        P = Hprim(x, y) if prims else None
        return float(P) if P is not None else HL(x, y)
    def grad(x, y):
        e = 0.6; return ((roof_under(x + e, y) - roof_under(x - e, y)) / (2 * e), (roof_under(x, y + e) - roof_under(x, y - e)) / (2 * e))

    poly = Polygon(R['poly'])
    if not poly.is_valid: poly = poly.buffer(0)
    if poly.exterior.is_ccw is False: poly = Polygon(list(poly.exterior.coords)[::-1])
    eave = poly.buffer(spec.get('overhang', 0.45), join_style=2)

    # ---- roof
    roof = Mesh(); g = spec.get('roofGrid', 0.6); pe = prep(eave); minx, miny, maxx, maxy = eave.bounds
    def rv(x, y): return roof.vert(x, y, H(x, y), x, y)
    x = math.floor(minx / g) * g
    while x < maxx:
        y = math.floor(miny / g) * g
        while y < maxy:
            b = box(x, y, x + g, y + g)
            if pe.contains(b):
                a, b2, c, d = rv(x, y), rv(x + g, y), rv(x + g, y + g), rv(x, y + g); roof.quad(a, d, c, b2)
            elif pe.intersects(b):
                piece = eave.intersection(b)
                for part in getattr(piece, 'geoms', [piece]):
                    if part.geom_type != 'Polygon' or part.area < 1e-4: continue
                    for t in triangulate(part):
                        if not part.contains(t.representative_point()): continue
                        c = list(t.exterior.coords)[:3]
                        if Polygon(c).exterior.is_ccw: c = c[::-1]
                        roof.tri(*[rv(q[0], q[1]) for q in c])
            y += g
        x += g

    # ---- walls
    base, siding = Mesh(), Mesh(); windows = []; ring = list(poly.exterior.coords)[:-1]; n = len(ring)
    stone_top = spec.get('baseTop'); floor_h = spec.get('floorHeight', 2.9); wp = spec.get('windows', {})
    def ground_at(x, y, ox, oy):
        return min(float(raw(x + ox * d, y + oy * d)) for d in (1.5, 2.7, 3.9))
    samples = []; u0 = 0.0
    for e in range(n):
        a = np.array(ring[e]); b = np.array(ring[(e + 1) % n]); L = float(np.linalg.norm(b - a))
        if L < 0.05: continue
        d = (b - a) / L; out = np.array([d[1], -d[0]])  # outward for a counter-clockwise ring in x-east, y-south
        if not poly.contains(Polygon([a, b, (a + b) / 2 - out * 0.3]).representative_point()): out = -out
        m = max(1, int(math.ceil(L / 0.6))); pts = []
        for k in range(m + 1):
            q = a + d * L * k / m; qi = q - out * 0.15
            pts.append(dict(x=float(q[0]), y=float(q[1]), top=H(qi[0], qi[1]), g=ground_at(q[0], q[1], out[0], out[1]), u=u0 + L * k / m))
        samples.append(dict(pts=pts, L=L, d=d, out=out, a=a)); u0 += L
    allg = np.array([q['g'] for s in samples for q in s['pts']]); k5 = np.ones(7) / 7
    sm = np.minimum(allg, np.convolve(np.r_[allg[-3:], allg, allg[:3]], k5, 'valid')); it = iter(sm.tolist())
    for s in samples:
        for q in s['pts']: q['g'] = next(it)
    if stone_top is None: stone_top = float(np.median(sm)) + spec.get('baseHeight', 0.7)
    for s in samples:
        pts = s['pts']
        for k in range(len(pts) - 1):
            p0, p1 = pts[k], pts[k + 1]
            def strip(mesh, lo0, hi0, lo1, hi1):
                if hi0 - lo0 < 0.02 and hi1 - lo1 < 0.02: return
                a = mesh.vert(p0['x'], p0['y'], lo0, p0['u'], lo0); b = mesh.vert(p1['x'], p1['y'], lo1, p1['u'], lo1)
                c = mesh.vert(p1['x'], p1['y'], hi1, p1['u'], hi1); d2 = mesh.vert(p0['x'], p0['y'], hi0, p0['u'], hi0); mesh.quad(a, b, c, d2)
            b0, b1 = p0['g'] - 1.5, p1['g'] - 1.5
            strip(base, b0, min(stone_top, p0['top']), b1, min(stone_top, p1['top']))
            strip(siding, min(stone_top, p0['top']), p0['top'], min(stone_top, p1['top']), p1['top'])
        # windows: a regular rhythm along each wall face (estimated layout, see record)
        L = s['L']; pitch = wp.get('pitch', 2.6); ww = wp.get('w', 1.15); wh = wp.get('h', 1.55)
        if L >= 3.2:
            cnt = max(1, int((L - 1.0) // pitch)); start = (L - (cnt - 1) * pitch) / 2
            for c in range(cnt):
                t = start + c * pitch; q = s['a'] + s['d'] * t; qi = q - s['out'] * 0.15; top = H(qi[0], qi[1]); gz = ground_at(q[0], q[1], s['out'][0], s['out'][1])
                f = 0
                while True:
                    sill = stone_top + wp.get('sill', 0.85) + f * floor_h
                    if sill + wh > top - 0.45: break
                    if sill > gz + 0.5: windows.append([round(float(q[0]), 2), round(float(q[1]), 2), round(sill, 2), ww, wh, round(float(s['out'][0]), 3), round(float(s['out'][1]), 3)])
                    f += 1
                if stone_top - gz > 2.7 and c % 2 == 0 and spec.get('baseWindows', True):
                    windows.append([round(float(q[0]), 2), round(float(q[1]), 2), round(gz + 1.05, 2), 0.95, 1.15, round(float(s['out'][0]), 3), round(float(s['out'][1]), 3)])

    # ---- dormers (positions and heights from lidar; shape is a standard gabled dormer)
    for dm in dormers:
        ga, gb = grad(dm['x'], dm['y']); gmag = math.hypot(ga, gb)
        if gmag < 0.45: continue
        f = np.array([-ga, -gb]) / gmag; sdir = np.array([-f[1], f[0]]); c = np.array([dm['x'], dm['y']]); top = dm['top']; w = dm['w']
        zc = roof_under(*c); eave_z = top - 0.6; front = c + f * 0.7; zf = roof_under(*front)
        if eave_z - zf < 0.8: continue
        t_r = (top - zc) / gmag; t_e = (eave_z - zc) / gmag; hw = w / 2
        fl, fr = front - sdir * hw, front + sdir * hw
        v = lambda m, q, z, u, w_: m.vert(float(q[0]), float(q[1]), float(z), u, w_)
        # front wall + gable
        siding.quad(v(siding, fl, zf - 0.3, 0, zf - 0.3), v(siding, fr, zf - 0.3, w, zf - 0.3), v(siding, fr, eave_z, w, eave_z), v(siding, fl, eave_z, 0, eave_z))
        siding.tri(v(siding, fl, eave_z, 0, eave_z), v(siding, fr, eave_z, w, eave_z), v(siding, front, top, hw, top))
        for sgn, corner in ((-1, fl), (1, fr)):
            back = c - f * t_e + sdir * hw * sgn
            siding.tri(v(siding, corner, zf - 0.3, 0, zf - 0.3), v(siding, corner, eave_z, 0, eave_z), v(siding, back, eave_z, 1.2, eave_z))
            r0 = front + f * 0.3; r1 = c - f * t_r; e0 = front + f * 0.3 + sdir * (hw + 0.2) * sgn; e1 = c - f * (t_e - 0.1) + sdir * (hw + 0.2) * sgn
            roof.quad(roof.vert(float(r0[0]), float(r0[1]), top, r0[0], r0[1]), roof.vert(float(r1[0]), float(r1[1]), top, r1[0], r1[1]), roof.vert(float(e1[0]), float(e1[1]), eave_z - 0.12, e1[0], e1[1]), roof.vert(float(e0[0]), float(e0[1]), eave_z - 0.12, e0[0], e0[1]))
        wh2 = min(1.1, eave_z - zf - 0.25)
        if wh2 > 0.5: windows.append([round(float(front[0]), 2), round(float(front[1]), 2), round(float(eave_z - wh2 - 0.08), 2), round(min(w - 0.5, 1.2), 2), round(wh2, 2), round(float(f[0]), 3), round(float(f[1]), 3)])

    chim = [dict(x=round(c['x'], 2), y=round(c['y'], 2), w=round(c['w'], 2), d=round(c['d'], 2), top=round(c['top'], 2), bottom=round(roof_under(c['x'], c['y']) - 1.5, 2)) for c in chimneys]
    return dict(
        id=spec['id'], name=spec['name'], osmId=p['osmId'],
        frame=dict(x0=p['x0'], y1=p['y1'], mlon=p['mlon'], mlat=p['mlat']),
        baseTop=round(stone_top, 2), materials=spec.get('materials', {}),
        roof=roof.dump(), base=base.dump(), siding=siding.dump(), windows=windows, chimneys=chim,
        extras=spec.get('extras', []),
        stats=dict(roofPlanes=len(planes), roofTris=len(roof.idx) // 3, windows=len(windows), dormers=len(dormers), chimneys=len(chim)))

if __name__ == '__main__':
    D = json.load(open(sys.argv[1])); specs = json.load(open(sys.argv[2])); out = sys.argv[3]; os.makedirs(out, exist_ok=True)
    only = sys.argv[4:] 
    index = []
    for spec in specs['landmarks']:
        if spec['patch'] not in D['patches']: continue
        if only and spec['id'] not in only:
            if os.path.exists(f"{out}/{spec['id']}.json"): index.append(dict(id=spec['id'], osmId=D['patches'][spec['patch']]['osmId']))
            continue
        m = build(D, spec); json.dump(m, open(f"{out}/{spec['id']}.json", 'w'), separators=(',', ':'))
        index.append(dict(id=spec['id'], osmId=m['osmId'])); print(spec['id'], m['stats'], 'baseTop', m['baseTop'], '%.0f KB' % (os.path.getsize(f"{out}/{spec['id']}.json") / 1024))
    json.dump(dict(landmarks=index), open(f"{out}/index.json", 'w'))
