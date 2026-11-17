"""Turn a lidar surface patch over a building into clean roof planes.

Input: a patch from the landmark lidar file (grid of highest-hit elevations, meters) and the
building footprint. Output: plane equations, a label grid saying which plane each cell belongs
to, and things that stick up out of the roof (chimneys, dormers), all still in real coordinates.
"""
import json, sys, math
import numpy as np

def inside_mask(poly, nx, ny, step):
    xs = (np.arange(nx)) * step; ys = (np.arange(ny)) * step
    X, Y = np.meshgrid(xs, ys); m = np.zeros((ny, nx), bool)
    px, py = poly[:, 0], poly[:, 1]; n = len(px)
    for i in range(n):
        j = (i - 1) % n
        c = ((py[i] > Y) != (py[j] > Y)) & (X < (px[j] - px[i]) * (Y - py[i]) / (py[j] - py[i] + 1e-12) + px[i])
        m ^= c
    return m

def erode(m, k=1):
    for _ in range(k):
        e = m.copy(); e[1:] &= m[:-1]; e[:-1] &= m[1:]; e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]; m = e
    return m

def local_planes(h, step):
    ny, nx = h.shape; gx = np.zeros_like(h); gy = np.zeros_like(h); res = np.full_like(h, 9.0)
    for j in range(1, ny - 1):
        for i in range(1, nx - 1):
            w = h[j - 1:j + 2, i - 1:i + 2]
            a = (w[:, 2].sum() - w[:, 0].sum()) / (6 * step); b = (w[2].sum() - w[0].sum()) / (6 * step); c = w.mean()
            fit = c + a * step * np.array([[-1, 0, 1]] * 3) + b * step * np.array([[-1] * 3, [0] * 3, [1] * 3])
            gx[j, i] = a; gy[j, i] = b; res[j, i] = np.sqrt(((w - fit) ** 2).mean())
    return gx, gy, res

def fit_plane(pts):
    A = np.c_[pts[:, 0], pts[:, 1], np.ones(len(pts))]
    p, *_ = np.linalg.lstsq(A, pts[:, 2], rcond=None)
    r = pts[:, 2] - A @ p
    keep = np.abs(r) < max(0.15, 2 * np.median(np.abs(r)))
    if keep.sum() >= 6: p, *_ = np.linalg.lstsq(A[keep], pts[keep, 2], rcond=None)
    return p

def segment(h, mask, step, min_cells=28, tol=0.3, gtol=0.4):
    ny, nx = h.shape; gx, gy, res = local_planes(h, step)
    label = np.full((ny, nx), -1, int); planes = []
    order = np.argsort(np.where(mask, res, 99).ravel())
    for idx in order:
        j, i = divmod(int(idx), nx)
        if not mask[j, i] or label[j, i] >= 0 or res[j, i] > 0.2: continue
        p = np.array([gx[j, i], gy[j, i], h[j, i] - gx[j, i] * i * step - gy[j, i] * j * step])
        cells = [(j, i)]; label[j, i] = len(planes); stack = [(j, i)]; since = 0
        while stack:
            cj, ci = stack.pop()
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nj, ni = cj + dj, ci + di
                if not (0 <= nj < ny and 0 <= ni < nx) or not mask[nj, ni] or label[nj, ni] >= 0: continue
                pred = p[0] * ni * step + p[1] * nj * step + p[2]
                if abs(h[nj, ni] - pred) < tol and math.hypot(gx[nj, ni] - p[0], gy[nj, ni] - p[1]) < gtol + (0.4 if res[nj, ni] > 0.25 else 0):
                    label[nj, ni] = len(planes); cells.append((nj, ni)); stack.append((nj, ni)); since += 1
                    if since >= 25 and len(cells) < 400 or since >= 200:
                        since = 0
                        P = np.array([(c[1] * step, c[0] * step, h[c]) for c in cells]); p = fit_plane(P)
        if len(cells) < min_cells:
            for c in cells: label[c] = -1
            # leave for later
            for c in cells: label[c] = -2
            continue
        P = np.array([(c[1] * step, c[0] * step, h[c]) for c in cells]); planes.append(fit_plane(P))
    label[label == -2] = -1
    return label, planes

def merge(label, planes, step, h):
    """Merge neighbouring regions that lie on the same plane."""
    changed = True
    while changed:
        changed = False
        ny, nx = label.shape; adj = set()
        a = label[:, :-1]; b = label[:, 1:]; m = (a >= 0) & (b >= 0) & (a != b); adj |= set(zip(a[m].tolist(), b[m].tolist()))
        a = label[:-1]; b = label[1:]; m = (a >= 0) & (b >= 0) & (a != b); adj |= set(zip(a[m].tolist(), b[m].tolist()))
        for u, v in adj:
            pu, pv = planes[u], planes[v]
            if math.hypot(pu[0] - pv[0], pu[1] - pv[1]) < 0.12:
                js, is_ = np.nonzero(label == v)
                if len(js) == 0: continue
                d = np.abs(pu[0] * is_ * step + pu[1] * js * step + pu[2] - (pv[0] * is_ * step + pv[1] * js * step + pv[2])).mean()
                if d < 0.2:
                    label[label == v] = u
                    jj, ii = np.nonzero(label == u); planes[u] = fit_plane(np.c_[ii * step, jj * step, h[jj, ii]]); changed = True; break
    return label

def fill(label, planes, mask_all, step, h):
    """Give every cell a plane: unlabelled cells take the neighbouring plane that explains them best."""
    lab = label.copy(); ny, nx = lab.shape
    for _ in range(80):
        todo = np.argwhere((lab < 0) & mask_all)
        if len(todo) == 0: break
        new = lab.copy(); any_ = False
        for j, i in todo:
            best = None
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    nj, ni = j + dj, i + di
                    if 0 <= nj < ny and 0 <= ni < nx and lab[nj, ni] >= 0:
                        p = planes[lab[nj, ni]]; e = abs(p[0] * i * step + p[1] * j * step + p[2] - h[j, i])
                        if best is None or e < best[0]: best = (e, lab[nj, ni])
            if best: new[j, i] = best[1]; any_ = True
        lab = new
        if not any_: break
    return lab

def protrusions(h, lab, planes, mask, step):
    ny, nx = h.shape; I, J = np.meshgrid(np.arange(nx), np.arange(ny))
    P = np.array(planes); roof = np.where(lab >= 0, P[np.clip(lab, 0, None), 0] * I * step + P[np.clip(lab, 0, None), 1] * J * step + P[np.clip(lab, 0, None), 2], h)
    up = (h - roof > 0.7) & mask; seen = np.zeros_like(up); out = []
    for j, i in np.argwhere(up):
        if seen[j, i]: continue
        st = [(j, i)]; seen[j, i] = True; cells = []
        while st:
            cj, ci = st.pop(); cells.append((cj, ci))
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nj, ni = cj + dj, ci + di
                if 0 <= nj < ny and 0 <= ni < nx and up[nj, ni] and not seen[nj, ni]: seen[nj, ni] = True; st.append((nj, ni))
        c = np.array(cells); rise = (h - roof)[c[:, 0], c[:, 1]]
        if len(c) < 3: continue
        out.append(dict(x=round(float(c[:, 1].mean() * step), 2), y=round(float(c[:, 0].mean() * step), 2), w=round(float((np.ptp(c[:, 1]) + 1) * step), 1), d=round(float((np.ptp(c[:, 0]) + 1) * step), 1),
                        area=round(len(c) * step * step, 1), rise=round(float(rise.max()), 1), top=round(float(h[c[:, 0], c[:, 1]].max()), 2)))
    return out, roof

def run(D, name, pad_ok=True):
    p = D['patches'][name]; nx, ny, st = p['nx'], p['ny'], p['step']
    h = np.array(p['dsm'], float).reshape(ny, nx)
    fp = np.array(p['footprint'], float).reshape(-1, 2)
    poly = np.c_[(fp[:, 0] - p['x0']) * p['mlon'], (p['y1'] - fp[:, 1]) * p['mlat']]
    mask = inside_mask(poly, nx, ny, st); core = erode(mask, 2)
    label, planes = segment(h, core, st)
    label = merge(label, planes, st, h)
    used = sorted(set(label[label >= 0].tolist())); remap = {u: k for k, u in enumerate(used)}
    planes = [planes[u] for u in used]; label = np.vectorize(lambda v: remap.get(v, -1))(label)
    # grow mask by 3 cells so eaves and overhangs have a plane too
    big = mask.copy()
    for _ in range(3):
        g = big.copy(); g[1:] |= big[:-1]; g[:-1] |= big[1:]; g[:, 1:] |= big[:, :-1]; g[:, :-1] |= big[:, 1:]; big = g
    lab = fill(label, planes, big, st, h)
    prot, roof = protrusions(h, lab, planes, core, st)
    ground = float(np.percentile(h[~big], 8))
    return dict(p=p, h=h, poly=poly, mask=mask, lab=lab, planes=planes, prot=prot, roof=roof, ground=ground, seg=label)

if __name__ == '__main__':
    D = json.load(open(sys.argv[1])); name = sys.argv[2]
    R = run(D, name); lab = R['lab']; st = R['p']['step']
    print(name, 'planes', len(R['planes']), 'labelled core %.0f%%' % (100 * (R['seg'] >= 0).sum() / max(1, erode(R['mask'], 2).sum())), 'ground', round(R['ground'], 1))
    for k, pl in enumerate(R['planes']):
        n = int((lab == k).sum()); 
        if n * st * st > 15: print('  plane %2d area %5.0f m2 pitch %4.1f deg facing %3.0f' % (k, n * st * st, math.degrees(math.atan(math.hypot(pl[0], pl[1]))), (math.degrees(math.atan2(-pl[0], pl[1])) + 360) % 360))
    for q in sorted(R['prot'], key=lambda q: -q['rise'])[:40]: print('  up', q)
    if len(sys.argv) > 3:
        from PIL import Image, ImageDraw
        K = 6; rng = np.random.default_rng(3); cols = rng.integers(60, 255, (len(R['planes']) + 1, 3)); cols[-1] = (20, 20, 20)
        gy, gx = np.gradient(R['roof'], st); shade = np.clip(0.75 - 0.25 * gx + 0.25 * gy, 0.3, 1.2)
        img = (cols[lab] * shade[..., None]).clip(0, 255).astype(np.uint8); img[~(lab >= 0)] = (25, 30, 45)
        im = Image.fromarray(img).resize((R['h'].shape[1] * K, R['h'].shape[0] * K), Image.NEAREST); d = ImageDraw.Draw(im)
        d.line([tuple(q / st * K) for q in R['poly']] + [tuple(R['poly'][0] / st * K)], fill=(255, 255, 255))
        for q in R['prot']:
            c = (255, 0, 0) if q['rise'] > 2.2 else (255, 255, 0); d.ellipse([q['x'] / st * K - 4, q['y'] / st * K - 4, q['x'] / st * K + 4, q['y'] / st * K + 4], outline=c)
        im.save(sys.argv[3])
