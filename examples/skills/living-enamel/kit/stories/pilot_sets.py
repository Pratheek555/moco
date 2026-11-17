"""LIVING ENAMEL pilot sets: places and props for shots s3, s4, s5, s6, s8, s9.

Every public function has the signature ``name(p, t, fmt, **params) -> dict`` and
returns anchor points in stage units.  ``p`` is a gilt Painter, ``t`` is seconds and is
used only for ambient life (flags, waves, flicker, chariots), ``fmt`` is a gilt Format.
All geometry is a pure function of its arguments; nothing is random between calls.
Authoring notes live in SETS.md.
"""
import math
from gilt import path, ellipse, rect

TAU = math.tau
K = .5523                      # cubic circle constant


# ----------------------------------------------------------------- tiny helpers
def clamp(v, a=0., b=1.):
    return a if v < a else b if v > b else v


def lerp(a, b, u):
    return a + (b - a) * u


def smooth(u):
    u = clamp(u)
    return u * u * (3 - 2 * u)


def hsh(*a):
    """Deterministic integer hash (replaces random numbers)."""
    h = 2166136261
    for v in a:
        h = ((h ^ (int(v) & 0xffffffff)) * 16777619) & 0xffffffff
    h ^= h >> 13
    h = (h * 0x5bd1e995) & 0xffffffff
    h ^= h >> 15
    return h


def hf(*a):
    return hsh(*a) / 4294967295.


def vis(fmt, x0, y0, x1, y1, m=0):
    """True when the box touches the visible stage rectangle of this format."""
    r = fmt.rect
    return not (x1 < r[0] - m or x0 > r[2] + m or y1 < r[1] - m or y0 > r[3] + m)


def multi(segs):
    """One path holding many open sub-paths (each a path() point list)."""
    base = None
    for s in segs:
        q = path(s, False)
        if base is None:
            base = q
        else:
            base.addPath(q)
    return base


def wires(p, segs, w=3.):
    if segs:
        p.wire(multi(segs), w)


def arch(x, y, w, h):
    """Round-headed arch; (x, y) is bottom-left, w wide, h tall in total."""
    r = w / 2
    cy = y - h + r
    return path([(x, y), (x, cy), (x, cy - K * r, x + r - K * r, cy - r, x + r, cy - r),
                 (x + r + K * r, cy - r, x + w, cy - K * r, x + w, cy), (x + w, y)])


def dome(cx, y, r, ry=None):
    """Half-ellipse dome standing on the line y."""
    ry = ry or r
    return path([(cx - r, y), (cx - r, y - K * ry, cx - K * r, y - ry, cx, y - ry),
                 (cx + K * r, y - ry, cx + r, y - K * ry, cx + r, y)])


def crenel(x0, x1, ytop, ybase, mw=26, gap=18, mh=22):
    """Wall body whose top edge is a row of merlons (gap level = ytop)."""
    n = max(1, round((x1 - x0 + gap) / (mw + gap)))
    mw = (x1 - x0 - (n - 1) * gap) / n
    pts = [(x0, ybase), (x0, ytop)]
    x = x0
    for i in range(n):
        pts += [(x, ytop - mh), (x + mw, ytop - mh), (x + mw, ytop)]
        x += mw
        if i < n - 1:
            x += gap
            pts.append((x, ytop))
    pts.append((x1, ybase))
    return path(pts)


def _segs(pts, closed=False, k=1.):
    n = len(pts)
    out = []
    for i in range(n if closed else n - 1):
        p0 = pts[(i - 1) % n] if (closed or i > 0) else pts[i]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (closed or i + 2 < n) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6 * k, p1[1] + (p2[1] - p0[1]) / 6 * k)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6 * k, p2[1] - (p3[1] - p1[1]) / 6 * k)
        out.append((p1, c1, c2, p2))
    return out


def spline(pts, closed=False, k=1., close=None):
    """Catmull-Rom curve through pts as a path (closed curve or open)."""
    segs = [tuple(pts[0])] + [(*c1, *c2, *p2) for _, c1, c2, p2 in _segs(pts, closed, k)]
    return path(segs, close=closed if close is None else close)


def spline_pts(pts, closed=False, k=1., steps=14):
    """The same curve as a dense polyline (for routes, dashes and markers)."""
    out = [tuple(pts[0])]
    for p1, c1, c2, p2 in _segs(pts, closed, k):
        for i in range(1, steps + 1):
            u = i / steps
            a, b, c, d = (1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3
            out.append((a * p1[0] + b * c1[0] + c * c2[0] + d * p2[0],
                        a * p1[1] + b * c1[1] + c * c2[1] + d * p2[1]))
    return out


def stonework(p, region, x0, y0, x1, y1, row=36, col=64, w=2.4, off=0):
    """Running-bond stone courses as interior wire, clipped to region."""
    segs = []
    y = y0 + row
    while y < y1:
        segs.append([(x0, y), (x1, y)])
        y += row
    y = y0
    r = 0
    while y < y1:
        x = x0 + (col / 2 if r % 2 else 0) + off
        while x < x1:
            segs.append([(x, y), (x, min(y + row, y1))])
            x += col
        y += row
        r += 1
    with p.clip(region):
        wires(p, segs, w)


def lattice(p, region, x0, y0, x1, y1, sp=40, w=2.4, dot=None, dot_r=4):
    """Diamond lattice (interior wire) with optional gem dots at the crossings."""
    segs = []
    hgt = y1 - y0
    xx = x0 - hgt
    while xx < x1 + hgt:
        segs.append([(xx, y0), (xx + hgt, y1)])
        segs.append([(xx + hgt, y0), (xx, y1)])
        xx += sp
    with p.clip(region):
        wires(p, segs, w)
        if dot:
            j = 0
            y = y0 + sp / 2
            while y < y1:
                x = x0 + (sp / 2 if j % 2 else 0) + sp / 2
                while x < x1:
                    p.cabochon(x, y, dot_r, dot)
                    x += sp
                y += sp
                j += 1


def scales(p, region, x0, y0, x1, y1, sp=34, w=2.4):
    segs = []
    row = 0
    y = y0
    while y < y1 + sp:
        x = x0 + (sp / 2 if row % 2 else 0) - sp
        while x < x1 + sp:
            segs.append([(x, y), (x + sp / 2, y + sp * .85, x + sp, y)])
            x += sp
        y += sp * .5
        row += 1
    with p.clip(region):
        wires(p, segs, w)


def waves(p, region, x0, y0, x1, y1, t, dx=76, dy=44, amp=3., w=2.4, speed=1.4):
    """Rows of small wave arcs; each arc bobs on its own deterministic phase."""
    segs = []
    row = 0
    y = y0
    while y < y1:
        x = x0 + (dx / 2 if row % 2 else 0)
        while x < x1:
            ph = hf(row, int(x)) * TAU
            yy = y + math.sin(t * speed + ph) * amp
            xx = x + math.sin(t * .55 + ph) * 4
            segs.append([(xx, yy), (xx + dx * .225, yy - 11, xx + dx * .45, yy), (xx + dx * .675, yy + 11, xx + dx * .9, yy)])
            x += dx
        y += dy
        row += 1
    with p.clip(region):
        wires(p, segs, w)


def cloud_path(x, y, w, h, n=4):
    """Scalloped cloud, flat underside at y, left end at x."""
    pts = [(x, y)]
    r = h
    pts.append((x - r * .25, y, x - r * .25, y - r * .5))
    step = w / n
    cx = x
    for i in range(n):
        bump = h * (1.0 if i % 2 == 0 else .72)
        if i == 0:
            pts.append((cx + step * .1, y - r * .5 - bump * .9, cx + step * .55, y - r * .55 - bump * .15))
        else:
            pts.append((cx + step * .02, y - r * .5 - bump * 1.05, cx + step * .5, y - r * .5 - bump * .2))
        cx += step
    pts.append((x + w + r * .3, y - r * .5 - h * .35, x + w + r * .25, y - r * .35))
    pts.append((x + w + r * .22, y, x + w, y))
    return path(pts)


def cloud(p, x, y, w, h, t=0, phase=0., enamel='ivory', n=4):
    dx = math.sin(t * .35 + phase) * 9
    x += dx
    c = cloud_path(x, y, w, h, n)
    p.cell(c, enamel, 5)
    # cloud-scroll curls inside, interior wire
    segs = []
    step = w / n
    for i in range(n):
        cx = x + step * (i + .5)
        rr = h * (.42 if i % 2 == 0 else .3)
        cy = y - h * (.62 if i % 2 == 0 else .44)
        pts = []
        for a in range(0, 27):
            ang = a / 26 * math.pi * 3.1
            rad = rr * (1 - a / 30)
            pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
        segs.append(pts)
    wires(p, segs, 2.8)
    return c


def cypress(p, x, yb, h, w=36, enamel='jade'):
    top = yb - h
    body = path([(x, top), (x + w * .62, top + h * .36, x + w * .5, top + h * .76), (x + w * .42, yb, x, yb),
                 (x - w * .42, yb, x - w * .5, top + h * .76), (x - w * .62, top + h * .36, x, top)])
    p.cell(body, enamel, 4.5)
    segs = [[(x, top + h * .1), (x + w * .2, top + h * .5, x + w * .06, yb - h * .08)],
            [(x, top + h * .1), (x - w * .2, top + h * .5, x - w * .06, yb - h * .08)],
            [(x, top + h * .14), (x, yb - h * .06)]]
    with p.clip(body):
        wires(p, segs, 2.6)
        wires(p, [[(x - w, top + h * f), (x, top + h * f + 10, x + w, top + h * f)] for f in (.3, .48, .66, .84)], 2.2)


def flag(p, x, y, w, h, enamel, t, phase=0., amp=1., pole=44):
    """Pennant on a gold pole; y is the pole's foot, the flag waves with t."""
    p.wire(path([(x, y), (x, y - pole)], False), 3.5)
    p.cabochon(x, y - pole - 3, 4, 'pearl')
    top = y - pole + 2
    a = amp * 6
    s1 = math.sin(t * 3.2 + phase) * a
    s2 = math.sin(t * 3.2 + phase + 1.3) * a
    f = path([(x, top), (x + w * .35, top + s1 * .5 - 2, x + w * .7, top + s2 * .7 + 1),
              (x + w, top + h * .5 + s2),
              (x + w * .66, top + h + s2 * .5, x + w * .34, top + h + s1 * .4 + 2, x, top + h)])
    p.cell(f, enamel, 3)
    p.wire(path([(x + 5, top + h * .5), (x + w * .5, top + h * .5 + s1 * .4, x + w * .8, top + h * .5 + s2 * .5)], False), 2)


def fissure(p, pts, progress=1., w=7., enamel='onyx'):
    """A hairline crack as a thin onyx slit; reveal runs along pts. Pure function of progress."""
    progress = clamp(progress)
    if progress <= 0 or len(pts) < 2:
        return
    seglen = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    total = sum(seglen)
    goal = total * progress
    acc = 0.
    use = [pts[0]]
    for i, s in enumerate(seglen):
        if acc + s <= goal:
            use.append(pts[i + 1])
            acc += s
        else:
            u = (goal - acc) / s
            use.append((lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)))
            break
    if len(use) < 2:
        return
    left, right = [], []
    n = len(use)
    for i, (x, y) in enumerate(use):
        a = use[max(0, i - 1)]
        b = use[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d, dx / d
        taper = min(1, (i + .35) / 2, (n - i) / 1.6 + .15) if n > 2 else .5
        hw = w * .5 * (.35 + .65 * math.sin(clamp(i / (n - 1)) * math.pi * .92 + .1)) * taper + .6
        left.append((x + nx * hw, y + ny * hw))
        right.append((x - nx * hw, y - ny * hw))
    p.cell(path(left + right[::-1]), enamel, 1.1)
    if progress < 1:
        p.glint(use[-1][0], use[-1][1], 12, 1)


# ===================================================================== 1. city
def _houses(p, fmt, x0, x1, yb, hmin, hmax, seed=1):
    x = x0
    i = 0
    while x < x1:
        w = 70 + hsh(i, seed) % 5 * 14
        h = hmin + hf(i, seed, 3) * (hmax - hmin)
        if vis(fmt, x, yb - h - 60, x + w, yb, 20):
            kind = hsh(i, seed, 9) % 5
            body = 'ivory' if kind % 2 else 'sand'
            b = rect(x, yb - h, w, h, 3)
            p.cell(b, body, 4)
            if kind == 0:
                p.cell(path([(x - 8, yb - h), (x + w * .5, yb - h - 46), (x + w + 8, yb - h)]), 'oxblood', 4)
            elif kind == 2:
                p.cell(dome(x + w / 2, yb - h, w * .42, w * .36), 'lapis', 4)
                p.wire(path([(x + w / 2, yb - h - w * .36), (x + w / 2, yb - h - w * .36 - 14)], False), 3)
            else:
                p.cell(rect(x - 6, yb - h - 14, w + 12, 16, 3), 'oxblood', 4)
            for k in range(1 + w // 46):
                wx = x + w * (k + .5) / (1 + w // 46) - 8
                p.cell(arch(wx, yb - h * .32, 16, 30), 'onyx', 2.5)
        x += w + 8
        i += 1


def _chapel(p, x, yb, r, t, fmt):
    if not vis(fmt, x - r - 30, yb - r * 3, x + r + 30, yb, 20):
        return
    w = r * 2.3
    blk = rect(x - w / 2, yb - r * .95, w, r * .95 + 2, 4)
    p.cell(blk, 'sand', 5)
    stonework(p, blk, x - w / 2, yb - r * .95, x + w / 2, yb, row=30, col=50)
    drum = rect(x - r, yb - r * 1.5, r * 2, r * .6, 4)
    p.cell(drum, 'ivory', 5)
    for k in range(5):
        p.cell(arch(x - r + (k + .5) * r * 2 / 5 - 5, yb - r * 1.0, 10, 24), 'onyx', 2.5)
    p.cell(dome(x, yb - r * 1.5, r, r * .92), 'lapis', 5)
    for u in (-.55, 0, .55):
        ry = r * .92
        p.wire(path([(x + u * r, yb - r * 1.5), (x + u * r, yb - r * 1.5 - K * ry, x + K * u * r, yb - r * 1.5 - ry, x, yb - r * 1.5 - ry)], False), 2.6)
    ty = yb - r * 1.5 - r * .92
    p.wire(path([(x, ty), (x, ty - 22)], False), 3.5)
    p.wire(path([(x - 8, ty - 14), (x + 8, ty - 14)], False), 3.5)
    p.cabochon(x, ty - 26, 4, 'pearl')


def city(p, t, fmt, crack=0., flags=1., ground=True):
    """Constantinople, s3 (turquoise `scroll` ground).

    crack  0..1  craquelure crack runs up the palace balcony (progress).
    flags  0..1  ambient flag amplitude (0 = flags hang still).
    ground True  draw the turquoise scroll ground first.
    Anchors: balcony=(x,y feet) balcony_h=300, general=(x,y feet) general_h=200,
    cage_size=(w,h), citizens=[6 x (x,y feet)] citizen_h=170, plaque, crack_top.
    """
    if ground:
        p.ground('scroll', 'turquoise')
    # ---- sun mandorla behind the great dome: gold plate, lapis ring, pearls, wire rays
    sx, sy = 410, 440
    ang0 = t * .045
    for i in range(24):
        a_ = ang0 + i * TAU / 24
        ca, sa = math.cos(a_), math.sin(a_)
        nx_, ny_ = -sa, ca
        r1, r2 = 258, 336
        bl = (sx + r1 * ca + nx_ * 22, sy + r1 * sa + ny_ * 22)
        br = (sx + r1 * ca - nx_ * 22, sy + r1 * sa - ny_ * 22)
        ml = (sx + (r1 + 40) * ca + nx_ * 27, sy + (r1 + 40) * sa + ny_ * 27)
        mr = (sx + (r1 + 40) * ca - nx_ * 27, sy + (r1 + 40) * sa - ny_ * 27)
        tip = (sx + r2 * ca, sy + r2 * sa)
        p.cell(path([bl, (*ml, *tip), (*mr, *br)]), 'ivory' if i % 2 else 'sand', 4)
        p.wire(path([(sx + (r1 + 8) * ca, sy + (r1 + 8) * sa), (sx + (r2 - 14) * ca, sy + (r2 - 14) * sa)], False), 2.4)
    p.gold(ellipse(sx, sy, 268), .38, 'hammered')
    p.wire(ellipse(sx, sy, 268), 5)
    p.cell(ellipse(sx, sy, 246), 'lapis', 4)
    p.beads(ellipse(sx, sy, 232), 24, 4)
    p.gold(ellipse(sx, sy, 214), .3, 'hammered')
    p.wire(ellipse(sx, sy, 214), 4)
    # ---- clouds
    for (cx, cy, w, h, ph) in ((-420, 150, 300, 56, 0), (30, 250, 170, 44, 1.2), (-60, -150, 280, 54, 2.4),
                                (400, -170, 310, 60, 3.1), (880, -90, 280, 56, 4.2), (1180, 190, 300, 58, 5.1),
                                (-250, 470, 250, 50, 1.9), (1280, 520, 220, 46, 3.6), (840, 330, 150, 38, .6),
                                (1110, -230, 270, 52, 2.0), (-380, -250, 280, 56, 4.8)):
        if vis(fmt, cx - 40, cy - h * 3, cx + w + 40, cy, 20):
            cloud(p, cx, cy, w, h, t, ph)
    for (bx, by, bs, bph) in ((100, 300, 1, 0), (190, 232, .9, 1.1), (260, 330, .8, 2.3), (1190, 330, 1, .6), (1270, 260, .9, 1.9), (1350, 350, .8, 3.0),
                              (-90, 330, 1, 2.0), (-210, 250, .9, 4.0), (1110, 70, .9, 1.4), (-300, 380, .8, 5.0), (1420, 200, .8, 2.8)):
        _bird(p, bx + math.sin(t * .4 + bph) * 14, by + math.sin(t * .7 + bph) * 8, bs, t, bph)
    # ---- far skyline: houses, small churches
    _houses(p, fmt, -520, 1600, 735, 80, 170, seed=3)
    # ---- Hagia Sophia in spirit: mass, half-domes, drum, great dome
    yb = 740
    mass = path([(140, yb), (140, 612), (160, 600), (600, 600), (620, 612), (620, yb)])
    p.cell(mass, 'sand', 5)
    stonework(p, mass, 140, 600, 620, yb, row=34, col=66)
    for i in range(7):
        wx = 168 + i * 66
        p.cell(arch(wx - 4, 706, 40, 82), 'ivory', 4)
        p.cell(arch(wx + 3, 702, 26, 60), 'onyx', 2.5)
    for ccx in (262, 498):
        p.cell(dome(ccx, 604, 104, 92), 'lapis', 5)
        for u in (-.62, -.3, 0, .3, .62):
            p.wire(path([(ccx + u * 104, 604), (ccx + u * 104, 604 - K * 92, ccx + K * u * 104, 604 - 92, ccx, 604 - 92)], False), 2.8)
        for k in range(5):
            p.cell(arch(ccx - 62 + k * 26, 604, 12, 30), 'onyx', 2.5)
    for ex in (150, 610):                           # corner buttress towers
        pier = rect(ex - 24, 540, 48, 200, 6)
        p.cell(pier, 'ivory', 5)
        stonework(p, pier, ex - 24, 540, ex + 24, 740, row=34, col=48)
        p.cell(dome(ex, 540, 26, 26), 'oxblood', 4)
        p.wire(path([(ex, 514), (ex, 498)], False), 3.5)
        p.cabochon(ex, 494, 4, 'pearl')
    drum = rect(262, 470, 236, 80, 5)
    p.cell(drum, 'ivory', 5)
    for i in range(9):
        p.cell(arch(272 + i * 25, 540, 14, 52), 'onyx', 2.5)
    p.wire(path([(262, 480), (498, 480)], False), 4)
    p.cell(dome(380, 470, 126, 108), 'lapis', 5.5)
    for u in (-.84, -.64, -.43, -.22, 0, .22, .43, .64, .84):
        p.wire(path([(380 + u * 126, 470), (380 + u * 126, 470 - K * 108, 380 + K * u * 126, 470 - 108, 380, 470 - 108)], False), 3)
    p.wire(path([(256, 470), (504, 470)], False), 6)
    p.beads(path([(266, 462), (494, 462)], False), 22, 3.5)
    p.wire(path([(380, 362), (380, 322)], False), 5)
    p.wire(path([(364, 338), (396, 338)], False), 5)
    p.cabochon(380, 316, 6, 'pearl')
    for sx2 in (-1, 1):
        p.cabochon(380 + sx2 * 16, 338, 4, 'pearl')
    # ---- chapels left and right (the city goes on in both crops)
    for (cx, r) in ((60, 58), (-190, 66), (-345, 48), (1160, 64), (1300, 52), (1430, 46)):
        _chapel(p, cx, 742, r, t, fmt)
    # ---- palace of the emperor: pavilion, lapis alcove, balcony, arcade
    px0, px1 = 618, 972
    roof = path([(px0 - 22, 190), (px0 + 28, 120), (px1 - 28, 120), (px1 + 22, 190)])
    pav = rect(px0, 186, px1 - px0, 560, 6)
    p.cell(pav, 'sand', 5.5)
    stonework(p, pav, px0, 186, px1, 746, row=38, col=70)
    p.cell(roof, 'oxblood', 5.5)
    scales(p, roof, px0 - 22, 120, px1 + 22, 190, sp=30)
    p.cell(dome(795, 120, 50, 44), 'lapis', 5)
    p.wire(path([(795, 76), (795, 56)], False), 4)
    p.wire(path([(783, 66), (807, 66)], False), 4)
    cor = rect(px0 - 6, 186, px1 - px0 + 12, 24, 4)
    p.cell(cor, 'ivory', 5)
    wires(p, [[(x, 188), (x + 12, 208)] for x in range(px0 + 4, px1, 26)], 2.6)
    # alcove (backdrop for the 300-unit emperor)
    p.cell(arch(660, 520, 270, 345), 'ivory', 5)
    alc = arch(678, 520, 234, 322)
    p.cell(alc, 'lapis', 5)
    lattice(p, alc, 678, 200, 912, 520, sp=46, w=2.4, dot='pearl', dot_r=4)
    for sd in (-1, 1):                              # oxblood drapes either side of the alcove
        x0 = 678 if sd < 0 else 912
        dr = path([(x0, 215), (x0 + sd * 40, 300, x0 + sd * 30, 420), (x0 + sd * 34, 520), (x0, 520)])
        p.cell(dr, 'oxblood', 4)
        wires(p, [[(x0 + sd * 10 * k, 230), (x0 + sd * (10 * k + 6), 380, x0 + sd * 10 * k, 520)] for k in (1, 2, 3)], 2.4)
    for wx in (642, 930):                           # side windows
        p.cell(arch(wx - 2, 420, 36, 110), 'ivory', 4)
        p.cell(arch(wx + 5, 414, 22, 84), 'onyx', 2.5)
    # lower palace: arcade
    p.cell(rect(px0 - 8, 548, px1 - px0 + 16, 30, 4), 'ivory', 5)
    for k in range(3):
        ax = 656 + k * 108
        p.cell(arch(ax, 740, 90, 150), 'ivory', 5)
        p.cell(arch(ax + 10, 740, 70, 130), 'onyx', 3)
        wires(p, [[(ax + 10 + j * 14, 740), (ax + 10 + j * 14, 640)] for j in range(1, 5)], 2.6)
    # the balcony: slab, fascia, corbels, end pillars
    bx0, bx1, by = 556, 1034, 505
    p.cell(path([(bx0 + 16, 548), (bx0 + 16, 580, bx0 + 60, 600), (bx1 - 60, 600), (bx1 - 16, 580), (bx1 - 16, 548)]), 'ivory', 4)
    for k in range(7):
        cxk = bx0 + 50 + k * ((bx1 - bx0 - 100) / 6)
        p.cell(path([(cxk - 20, 548), (cxk + 20, 548), (cxk + 8, 598), (cxk - 8, 598)]), 'sand', 3.5)
    p.cell(rect(bx0, by + 12, bx1 - bx0, 40, 6), 'oxblood', 5.5)
    for k in range(12):
        p.cabochon(bx0 + 26 + k * ((bx1 - bx0 - 52) / 11), by + 32, 7, 'pearl' if k % 2 else 'lapis')
    p.cell(rect(bx0 - 10, by, bx1 - bx0 + 20, 16, 7), 'ivory', 5.5)
    for ex in (bx0 + 14, bx1 - 14):
        p.cell(rect(ex - 15, by - 70, 30, 72, 6), 'ivory', 5)
        p.cell(ellipse(ex, by - 82, 20, 16), 'lapis', 4)
        p.cabochon(ex, by - 102, 7, 'pearl')
    # banner hangs from the slab
    p.cell(path([(1000, 552), (1000, 640), (1014, 660, 1028, 640), (1028, 552)]), 'oxblood', 4)
    p.cabochon(1014, 590, 7, 'saffron')
    # flags on the pavilion corners
    flag(p, px0 - 14, 192, 52, 30, 'oxblood', t, 0., flags)
    flag(p, px1 + 14, 192, 52, 30, 'oxblood', t, 1.7, flags)
    # ---- crack running up the balcony
    if crack > 0:
        main = [(768, 750), (784, 712), (766, 676), (790, 640), (772, 604), (800, 572), (784, 545),
                (808, 522), (790, 488), (812, 450), (800, 410)]
        fissure(p, main, clamp(crack), 9)
        br = clamp((crack - .3) / .6)
        fissure(p, [(766, 676), (738, 668), (716, 676), (690, 662)], br, 5)
        br2 = clamp((crack - .5) / .5)
        fissure(p, [(800, 572), (830, 562), (850, 570), (878, 556)], br2, 5)
        fissure(p, [(808, 522), (836, 510), (860, 516)], clamp((crack - .6) / .4), 4.5)
        zone = path([(700, 760), (880, 760), (880, 380), (700, 380)])
        p.crack(7, zone, clamp(crack) * .8)
    # ---- sea wall with towers across the lower third
    wt, wb = 770, 946
    wall = crenel(-520, 1600, wt, wb, 30, 20, 24)
    p.cell(wall, 'sand', 5.5)
    stonework(p, wall, -520, wt - 24, 1600, wb, row=36, col=72)
    p.cell(rect(-520, wt + 6, 2120, 18, 2), 'ivory', 4.5)
    p.cell(rect(-520, wb - 26, 2120, 26, 2), 'ivory', 4.5)
    wires(p, [[(x, wt + 6), (x + 18, wt + 24)] for x in range(-520, 1600, 36)], 2.4)
    # gate with gold doors
    gx = 395
    p.cell(arch(gx - 82, wb, 164, 190), 'ivory', 5.5)
    gate = arch(gx - 62, wb, 124, 160)
    p.cell(gate, 'lapis', 5)
    p.gold(arch(gx - 54, wb, 108, 134), .55, 'hammered')
    p.wire(arch(gx - 54, wb, 108, 134), 4)
    wires(p, [[(gx, wb), (gx, wb - 134)]] + [[(gx - 54, wb - 28 * k), (gx + 54, wb - 28 * k)] for k in (1, 2, 3, 4)], 3)
    for sd in (-1, 1):
        p.cabochon(gx + sd * 16, wb - 56, 6, 'oxblood')
    for i, tx in enumerate((-430, -100, 230, 560, 890, 1220, 1550)):
        if not vis(fmt, tx - 90, 640, tx + 90, wb, 30):
            continue
        tw = 132
        tb = crenel(tx - tw / 2, tx + tw / 2, 700, wb + 4, 28, 16, 26)
        p.cell(tb, 'sand', 5.5)
        stonework(p, tb, tx - tw / 2, 676, tx + tw / 2, wb, row=36, col=44)
        p.cell(rect(tx - tw / 2 - 6, 716, tw + 12, 16, 3), 'ivory', 5)
        p.cell(rect(tx - tw / 2 - 6, wb - 30, tw + 12, 18, 3), 'ivory', 4.5)
        for sl in (-1, 1):
            p.cell(arch(tx + sl * 30 - 8, 880, 16, 64), 'onyx', 3)
        p.cell(arch(tx - 11, 800, 22, 56), 'onyx', 3)
        p.cabochon(tx, 750, 8, 'oxblood')
        flag(p, tx, 678, 50, 28, 'oxblood' if i % 2 else 'lapis', t, i * 1.3, flags, 46)
    # ---- cypress trees stand in front of the wall's far end, between monuments
    for (cx, h) in ((100, 190), (122, 150), (665, 140), (700, 180), (-60, 170), (-280, 160), (1105, 170), (1135, 140), (1380, 180)):
        if vis(fmt, cx - 30, 740 - h, cx + 30, 760, 10):
            cypress(p, cx, 770, h)
    # ---- quay street where the six citizens stand
    street = rect(-520, wb, 2120, 150, 0)
    p.cell(street, 'ivory', 5.5)
    stonework(p, street, -520, wb, 1600, wb + 150, row=34, col=92, w=2.4)
    p.cell(rect(-520, wb, 2120, 14, 0), 'sand', 3.5)
    p.cell(rect(-520, wb + 150, 2120, 24, 6), 'sand', 5.5)
    p.wire(path([(-520, wb + 162), (1600, wb + 162)], False), 3)
    for x in range(-500, 1600, 120):
        p.cabochon(x, wb + 162, 5, 'oxblood')
    # ---- the harbour below (portrait only matters; cheap in landscape)
    sea = rect(-520, wb + 174, 2120, 900, 0)
    p.cell(sea, 'lapis', 5.5)
    p.cell(rect(-520, wb + 174, 2120, 56, 0), 'sand', 4.5)
    _key_band(p, -520, 1600, wb + 182, 40)
    waves(p, sea, -520, wb + 260, 1600, 1620, t, 84, 54, 3.5, 2.6)
    for (dx, dy, ds, dph, drot) in ((520, 1400, 1.0, .4, -24), (980, 1560, .9, 2.0, -14), (60, 1580, .95, 3.4, -30), (1300, 1480, 1., 1.2, -20)):
        if vis(fmt, dx - 80, dy - 70, dx + 80, dy + 50, 20):
            _dolphin(p, dx, dy, ds, t, dph, drot)
    for (sx3, sy3, sc, ph) in ((250, 1300, 1., 0.3), (800, 1420, 1.2, 1.7), (-120, 1480, .9, 2.4), (1210, 1330, 1.05, 3.3)):
        if vis(fmt, sx3 - 90, sy3 - 160, sx3 + 90, sy3 + 40, 20):
            _little_ship(p, sx3, sy3 + math.sin(t * 1.1 + ph) * 3, sc, 1)
    cit = [(540 + (i - 2.5) * 150, 1030) for i in range(6)]
    return dict(balcony=(795, 505), balcony_h=300, general=(655, 505), general_h=200, cage_size=(140, 250),
                citizens=cit, citizen_h=170, plaque=(390, 92), crack_top=(800, 410),
                palace_alcove=(795, 330))


def _bird(p, x, y, s, t, ph):
    f = math.sin(t * 5.5 + ph)
    with p.transform(translate=(x, y), scale=s):
        p.wire(path([(-24, 6 - f * 6), (-12, -8 + f * 6, 0, 0), (12, -8 + f * 6, 24, 6 - f * 6)], False), 4.5)
        p.cabochon(0, 2, 3.2, 'oxblood')


def _dolphin(p, x, y, s, t, ph, rot=-20):
    bob = math.sin(t * 1.3 + ph) * 8
    with p.transform(translate=(x, y + bob), rotate=rot + math.sin(t * 1.3 + ph) * 6, scale=s):
        p.cell(path([(-58, 14), (-60, -6), (-44, 2)]), 'ivory', 3.5)
        p.cell(path([(-58, 14), (-40, 4), (-52, 24)]), 'ivory', 3.5)
        body = path([(-46, 8), (-30, -30, 10, -30), (38, -30, 60, -8), (50, -2), (30, -6, 10, 6), (-18, 20, -46, 8)])
        p.cell(body, 'ivory', 4.5)
        p.cell(path([(-6, -29), (-16, -52), (14, -29)]), 'ivory', 3.5)
        p.wire(path([(-34, 0), (-8, -14, 22, -14)], False), 2.4)
        p.cabochon(38, -12, 3.5, 'onyx')


def _key_band(p, x0, x1, y, h=40):
    segs = []
    x = x0
    while x < x1:
        segs.append([(x, y + h), (x, y), (x + h, y), (x + h, y + h * .72), (x + h * .28, y + h * .72), (x + h * .28, y + h * .36), (x + h * .72, y + h * .36)])
        x += h * 1.25
    p.wire(multi(segs), 3.2)


def _little_ship(p, x, y, s, d=1):
    """Small ship cell with a sail; d=-1 mirrors it. Shared by the city harbour and the map."""
    with p.transform(translate=(x, y), scale=(s * d, s)):
        hull = path([(-46, -14), (46, -14), (34, 16, 16, 20), (-16, 20), (-34, 16, -46, -14)])
        p.cell(hull, 'oxblood', 4.5)
        p.wire(path([(-42, -6), (42, -6)], False), 2.4)
        for k in (-26, -9, 8, 25):
            p.cabochon(k, 5, 3.5, 'saffron')
        p.wire(path([(0, -14), (0, -92)], False), 4)
        sail = path([(4, -88), (46, -62, 40, -26), (4, -20), (4, -88)])
        p.cell(sail, 'ivory', 4)
        wires(p, [[(8, -66), (36, -56)], [(8, -48), (38, -42)]], 2.4)
        p.cell(path([(-4, -80), (-34, -58, -28, -26), (-4, -22)]), 'ivory', 4)
        p.cell(path([(0, -92), (16, -88), (0, -80)]), 'oxblood', 2.5)


# ----------------------------------------------------------------- props: coin & cage
def coin(p, x, y, r, spin=0.):
    """Raised gold coin with an emperor's profile (front) and a cross (back).

    spin is in turns: the coin's width is |cos(2*pi*spin)|, so spin=0 faces front,
    spin=.25 is edge-on, spin=.5 shows the cross; feed it spin=k*t for a flip."""
    c = math.cos(spin * TAU)
    sx = max(.09, abs(c))
    with p.transform(scale=(sx, 1), pivot=(x, y)):
        p.gold(ellipse(x, y, r), .8, 'hammered')
        p.wire(ellipse(x, y, r), max(3., r * .12))
        p.wire(ellipse(x, y, r * .76), 2.2)
        if r >= 14:
            p.beads(ellipse(x, y, r * .88), max(5., r * .36), max(1.2, r * .05))
        if sx > .3:
            if c >= 0:
                p.wire(ellipse(x - r * .02, y - r * .1, r * .24, r * .29), 2.4)
                p.wire(multi([[(x - r * .27, y - r * .33), (x + r * .27, y - r * .33)], [(x - r * .27, y - r * .33), (x - r * .27, y - r * .5)],
                              [(x, y - r * .36), (x, y - r * .56)], [(x + r * .27, y - r * .33), (x + r * .27, y - r * .5)]]), 2.2)
                p.wire(path([(x + r * .21, y - r * .08), (x + r * .34, y + r * .02), (x + r * .2, y + r * .06)], False), 2.2)
                p.wire(path([(x - r * .5, y + r * .52), (x - r * .34, y + r * .22, x, y + r * .19), (x + r * .34, y + r * .22, x + r * .5, y + r * .52)], False), 2.4)
            else:
                p.wire(path([(x, y - r * .5), (x, y + r * .5)], False), 3)
                p.wire(path([(x - r * .3, y - r * .14), (x + r * .3, y - r * .14)], False), 3)
                p.wire(path([(x - r * .18, y + r * .5), (x + r * .18, y + r * .5)], False), 2.4)
    return dict(pos=(x, y), r=r)


def cage(p, x, y, w, h, drop=1.):
    """Gold wire cage with its feet on (x, y). drop 0..1: 0 = hanging above the shot,
    1 = landed over the figure (feed it ctx.pose or tick() for the clank and bounce)."""
    off = -(1 - drop) * (h + 320)
    rx, ry = w / 2, max(8., w * .12)
    ytop = y - h * .76
    apex = y - h
    with p.transform(translate=(0, off)):
        # three rings (full ellipses: the cage is transparent) and the dome bars
        p.wire(ellipse(x, y, rx, ry), 5)
        p.wire(ellipse(x, lerp(y, ytop, .5), rx, ry), 3.5)
        p.wire(ellipse(x, ytop, rx, ry), 4.5)
        angs = [a * math.pi / 180 for a in (-72, -44, -15, 15, 44, 72)]
        bars = []
        dbars = []
        for a in angs:
            bx = x + rx * math.sin(a)
            by0 = y + ry * math.cos(a)
            by1 = ytop + ry * math.cos(a)
            bars.append([(bx, by0), (bx, by1)])
            dbars.append([(bx, by1), (bx - 0 * rx, by1 - (by1 - apex) * .55, lerp(bx, x, .78), by1 - (by1 - apex) * .8, x, apex + 6)])
        # dome bars as quads from top ring to the apex ring
        domebars = [[(x + rx * math.sin(a), ytop + ry * math.cos(a)),
                     (x + rx * math.sin(a) * .88, apex + (ytop - apex) * .45, x + rx * math.sin(a) * .18, apex + 7)] for a in angs]
        wires(p, bars, 4.5)
        wires(p, domebars, 4)
        p.wire(ellipse(x, apex + 6, rx * .2, ry * .35), 3.5)
        p.gold(ellipse(x, apex - 2, rx * .14, rx * .14), .85)
        p.wire(path([(x - rx * .1, apex - 8), (x, apex - 26, x + rx * .1, apex - 8)], False), 4)
        for a in angs:
            p.cabochon(x + rx * math.sin(a), y + ry * math.cos(a), 5.5, 'oxblood')
    return dict(pos=(x, y + off))


# ============================================================ 2. black sea map
def _g(lon, lat):
    """Longitude/latitude -> stage units (stylised: north-south stretched, Constantinople at lower left)."""
    return (575 + (lon - 34.6) * 58, 560 - (lat - 43.8) * 84)


_SOUTH = [(29.10, 41.22), (29.65, 41.15), (30.45, 41.12), (31.4, 41.25), (31.85, 41.45), (32.45, 41.75), (33.15, 42.0),
          (34.1, 42.05), (35.05, 42.1), (35.6, 41.75), (36.0, 41.68), (36.4, 41.3), (37.1, 41.12), (37.9, 41.05),
          (38.9, 40.95), (39.75, 41.02), (40.55, 41.05), (41.3, 41.55), (41.65, 41.7)]
_EAST = [(41.65, 42.2), (41.0, 42.95), (40.2, 43.35), (39.75, 43.6), (39.1, 44.05), (38.2, 44.4), (37.75, 44.7),
         (37.35, 44.9), (37.0, 45.15)]
_AZOV = [(36.8, 45.35), (37.4, 45.5), (37.75, 46.05), (38.4, 46.5), (38.9, 47.05), (38.4, 47.2), (37.6, 47.05),
         (36.9, 46.8), (36.2, 46.55), (35.4, 46.45), (34.6, 46.2), (34.75, 45.95), (35.5, 45.7), (36.15, 45.45), (36.45, 45.3)]
_CRIMEA = [(36.4, 45.1), (35.9, 45.05), (35.4, 44.98), (34.95, 44.85), (34.4, 44.65), (34.1, 44.5), (33.75, 44.4),
           (33.55, 44.5), (33.49, 44.6), (33.45, 44.8), (33.4, 45.05), (33.3, 45.25), (32.8, 45.35), (32.5, 45.37),
           (32.75, 45.6), (33.15, 45.85), (33.6, 46.05), (33.85, 46.12)]
_NORTHW = [(32.7, 46.3), (32.35, 46.55), (31.6, 46.65), (30.95, 46.55), (30.65, 46.4), (30.3, 46.1), (30.0, 45.7),
           (29.8, 45.35), (29.65, 45.15), (29.5, 44.7), (28.9, 44.35), (28.65, 44.1), (28.55, 43.8), (28.45, 43.4),
           (27.95, 43.2), (27.75, 42.7), (27.45, 42.5), (27.65, 42.05), (28.05, 41.9), (28.65, 41.5)]
_CITY = (232, 800)                   # Constantinople marker, on the western shore of the Bosporus
_CHERSON = (526, 486)                # Chersonesos marker, just inland of Crimea's south-west tip
MOSS = '#6e8a2c'                     # sixth map enamel (olive green), a custom hex


def _ribbon(pts, w0, w1=None, steps=10):
    """Closed path around a smoothed centreline; width runs w0 -> w1 along it."""
    w1 = w0 if w1 is None else w1
    c = spline_pts(pts, False, 1., steps)
    n = len(c)
    left, right = [], []
    for i, (x, y) in enumerate(c):
        a, b = c[max(0, i - 1)], c[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        hw = lerp(w0, w1, i / (n - 1)) / 2
        left.append((x - dy / d * hw, y + dx / d * hw))
        right.append((x + dy / d * hw, y - dx / d * hw))
    return path(left + right[::-1])


class _Route:
    """A smooth polyline with arc length: position and tangent at distance s."""

    def __init__(self, pts, k=1., steps=16):
        self.pts = spline_pts(pts, False, k, steps)
        self.cum = [0.]
        for i in range(1, len(self.pts)):
            self.cum.append(self.cum[-1] + math.hypot(self.pts[i][0] - self.pts[i - 1][0], self.pts[i][1] - self.pts[i - 1][1]))
        self.length = self.cum[-1]

    def at(self, s):
        s = clamp(s, 0, self.length)
        lo, hi = 0, len(self.cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        seg = (self.cum[hi] - self.cum[lo]) or 1
        u = (s - self.cum[lo]) / seg
        a, b = self.pts[lo], self.pts[hi]
        return (lerp(a[0], b[0], u), lerp(a[1], b[1], u)), (b[0] - a[0], b[1] - a[1])

    def dashes(self, upto, dash=24, gap=14):
        """Open point lists for the dashes of the first `upto` units of the route."""
        out = []
        s = 0.
        while s < upto:
            e = min(upto, s + dash)
            seg = [self.at(s)[0]]
            for i, c in enumerate(self.cum):
                if s < c < e:
                    seg.append(self.pts[i])
            seg.append(self.at(e)[0])
            if len(seg) > 1:
                out.append(seg)
            s += dash + gap
        return out


def _out_route():
    pts = [_CITY, _g(29.1, 41.2), _g(29.35, 41.45), _g(30.3, 42.35), _g(31.6, 43.3), _g(32.8, 44.0), _g(33.35, 44.5)]
    return _Route(pts)


def _back_route():
    ll = [(33.80, 44.75), (33.95, 45.45), (34.2, 46.3), (33.4, 47.0), (32.0, 47.25), (30.6, 47.05), (29.4, 46.35),
          (28.6, 45.5), (27.75, 44.65), (27.2, 43.85), (26.8, 43.2), (26.5, 42.5), (26.8, 41.85), (27.6, 41.4), (28.4, 41.18)]
    pts = [_CHERSON] + [_g(*q) for q in ll] + [(_CITY[0] + 4, _CITY[1] - 4)]
    return _Route(pts)


def _tower_icon(p, x, y, s=1.):
    """Small town: ivory keep with an oxblood roof and a pearl."""
    with p.transform(translate=(x, y), scale=s):
        p.cell(crenel(-14, 14, -30, 0, 7, 4, 7), 'ivory', 3.5)
        p.cell(arch(-4, 0, 8, 16), 'onyx', 2)
        p.cell(path([(-13, -37), (0, -56), (13, -37)]), 'oxblood', 3.5)
        p.cabochon(0, -58, 3.2, 'pearl')


def _peak(p, x, y, s=1.):
    with p.transform(translate=(x, y), scale=s):
        p.cell(path([(-32, 0), (-8, -34), (4, -52), (36, 0)]), 'ivory', 4)
        wires(p, [[(-12, -26), (-4, -18), (4, -28), (10, -14), (18, -20)], [(14, -6), (24, -16)], [(8, -2), (20, -12)]], 2.4)


def _tuft(p, x, y, s=1.):
    wires(p, [[(x, y), (x - 6 * s, y - 14 * s)], [(x, y), (x, y - 18 * s)], [(x, y), (x + 6 * s, y - 14 * s)]], 2.4)


def _helmet_marker(p, x, y, s=.9):
    """One soldier marker with feet at (x, y): jade helmet, oxblood shield, gold spear."""
    with p.transform(translate=(x, y), scale=s):
        p.wire(path([(17, 4), (17, -66)], False), 3.5)
        p.cell(path([(17, -66), (24, -78), (17, -96), (10, -78)]), 'pearl', 3)
        p.cell(ellipse(0, -18, 16, 18), 'oxblood', 4)
        p.cabochon(0, -18, 5, 'saffron')
        p.cell(dome(0, -37, 14, 15), 'jade', 4)
        p.wire(path([(-14, -37), (14, -37)], False), 4)
        p.wire(path([(0, -52), (0, -37)], False), 2.4)
        p.cabochon(0, -55, 3.5, 'pearl')


def compass(p, x, y, r, t=0.):
    p.cell(ellipse(x, y, r), 'ivory', 5)
    p.cell(ellipse(x, y, r * .8), 'lapis', 4)
    p.wire(ellipse(x, y, r * .66), 2.5)
    wires(p, [[(x + r * .8 * math.cos(i * TAU / 32), y + r * .8 * math.sin(i * TAU / 32)),
               (x + r * (.92 if i % 2 else .98) * math.cos(i * TAU / 32), y + r * (.92 if i % 2 else .98) * math.sin(i * TAU / 32))] for i in range(32)], 2.4)
    for i in range(4):
        a = -math.pi / 2 + i * math.pi / 2
        tip = (x + r * .94 * math.cos(a), y + r * .94 * math.sin(a))
        nl = (x + r * .2 * math.cos(a - math.pi / 4), y + r * .2 * math.sin(a - math.pi / 4))
        nr = (x + r * .2 * math.cos(a + math.pi / 4), y + r * .2 * math.sin(a + math.pi / 4))
        p.cell(path([tip, nl, (x, y)]), 'ivory', 3)
        p.cell(path([tip, (x, y), nr]), 'oxblood', 3)
    for i in range(4):
        a = -math.pi / 4 + i * math.pi / 2
        tip = (x + r * .58 * math.cos(a), y + r * .58 * math.sin(a))
        nl = (x + r * .16 * math.cos(a - math.pi / 4), y + r * .16 * math.sin(a - math.pi / 4))
        nr = (x + r * .16 * math.cos(a + math.pi / 4), y + r * .16 * math.sin(a + math.pi / 4))
        p.cell(path([tip, nl, nr, (x, y)]), 'ivory', 3)
    p.cabochon(x, y, r * .11, 'saffron')
    p.text('N', x, y - r - 12, int(r * .5))


def _crown_icon(p, x, y, s=1., xprog=None):
    with p.transform(translate=(x, y), scale=s):
        p.cell(ellipse(0, 0, 50), 'ivory', 5)
        p.wire(ellipse(0, 0, 41), 2.5)
        c = path([(-27, 16), (-30, -16), (-15, -2), (0, -24), (15, -2), (30, -16), (27, 16)])
        p.cell(c, 'amethyst', 4.5)
        p.cell(rect(-28, 10, 56, 12, 3), 'oxblood', 3.5)
        for k, cx in enumerate((-30, 0, 30)):
            p.cabochon(cx, -17 - (8 if k == 1 else 0), 4.5, 'pearl')
        p.cabochon(0, 16, 4, 'saffron')
    if xprog is not None and xprog > 0:
        u = clamp(xprog)
        sc = s * (1 + 1.5 * (1 - smooth(u / .3)) ** 2)
        with p.transform(translate=(x, y), scale=sc):
            for sgn in (-1, 1):
                p.wire(path([(sgn * -38, -38), (sgn * 38, 38)], False), 9)
            if u < 1:
                p.glint(0, 0, 40, 1 - u)


def _map_border(p, fmt):
    x0, y0, x1, y1 = fmt.rect
    o, i = 52, 92
    for r_ in ((x0 + o, y0 + o, x1 - o, y0 + i), (x0 + o, y1 - i, x1 - o, y1 - o),
               (x0 + o, y0 + o, x0 + i, y1 - o), (x1 - i, y0 + o, x1 - o, y1 - o)):
        p.cell(rect(r_[0], r_[1], r_[2] - r_[0], r_[3] - r_[1], 3), 'ivory', 4)
    step = 50
    xs = x0 + o + 6
    k = 0
    while xs + step < x1 - o:
        if k % 2 == 0:
            p.cell(rect(xs, y0 + o + 8, step, 26, 2), 'oxblood', 2.5)
            p.cell(rect(xs, y1 - o - 34, step, 26, 2), 'oxblood', 2.5)
        xs += step
        k += 1
    ys = y0 + o + 6
    k = 0
    while ys + step < y1 - o:
        if k % 2 == 0:
            p.cell(rect(x0 + o + 8, ys, 26, step, 2), 'oxblood', 2.5)
            p.cell(rect(x1 - o - 34, ys, 26, step, 2), 'oxblood', 2.5)
        ys += step
        k += 1
    for (cx, cy) in ((x0 + o + 20, y0 + o + 20), (x1 - o - 20, y0 + o + 20), (x0 + o + 20, y1 - o - 20), (x1 - o - 20, y1 - o - 20)):
        p.cell(ellipse(cx, cy, 34), 'lapis', 4.5)
        p.cabochon(cx, cy, 15, 'saffron')


def black_sea_map(p, t, fmt, route_out=0., route_back=0., ship=None, ship_route='out', crown_x=None, army=0.):
    """Cloisonne map of the Black Sea for s4/s5 (the lands cover the whole union area; no ground needed).

    route_out   0..1  dashed gold route wire-draws Constantinople -> Cherson across the sea.
    route_back  0..1  route wire-draws Cherson -> north round the west coast (Bulgar lands) -> Constantinople.
    ship        None or 0..1 position along the route named by ship_route ('out' or 'back'); hidden when None.
    crown_x     None: no crown icon.  0: crown icon above the city.  0..1: gold X stamps over it.
    army        0..1 how far the row of 8 spear-and-helmet markers has marched along the return route
                (markers emerge from Cherson one by one; 1 = the column head has reached the city).
    Anchors: city, cherson, bulgar, plaque_cherson, plaque_year, compass, ship_pos, army_head,
    route_out_pts / route_back_pts (polylines), crown.
    """
    x0, y0, x1, y1 = fmt.rect
    vx0, vy0, vx1, vy1 = x0 - 60, y0 - 60, x1 + 60, y1 + 60
    G = _g
    # ---- base land (Byzantine sand) and the other land cells
    base = rect(-700, -500, 2600, 2400)
    p.cell(base, 'sand', 5)
    scales(p, base, vx0, vy0, vx1, vy1, sp=70, w=2.2)
    jade = path([G(14, 54), G(27.4, 54), G(28.4, 49), G(29.4, 46.4), G(30.2, 45.0), G(29.6, 42.0), G(26.5, 41.8), G(14, 41.9)])
    p.cell(jade, 'jade', 5.5)
    scales(p, jade, vx0, vy0, 330, vy1, sp=46, w=2.0)
    moss = path([G(27.4, 54), G(51, 54), G(51, 40.6), G(41.5, 41.55), G(38, 43), G(33, 44.2), G(30.6, 45.2), G(29.4, 46.4), G(28.4, 49)])
    p.cell(moss, MOSS, 5.5)
    with p.clip(moss):
        for j in range(-2, 40):
            for i in range(-6, 30):
                x = 20 + i * 78 + (39 if j % 2 else 0)
                y = -330 + j * 50
                if vx0 < x < vx1 and vy0 < y < vy1 and hf(i, j) > .1:
                    _tuft(p, x, y, .8 + hf(i, j, 5) * .5)
    # Crimea: a separate sand cell hanging from the north coast
    crim = [G(*q) for q in _CRIMEA] + [G(33.9, 46.28), G(34.2, 46.32), G(34.55, 46.28), G(34.6, 46.2), G(34.75, 45.95), G(35.5, 45.7), G(36.15, 45.45), G(36.45, 45.3)]
    crimea = spline(crim, True, .5)
    p.cell(crimea, 'sand', 5.5)
    lattice(p, crimea, 380, 270, 700, 500, sp=44, w=2.2)
    # rivers (lapis ribbons)
    for pts, w0, w1 in (([G(29.7, 45.2), G(28.9, 45.2), G(28.1, 45.4), G(27.4, 44.35), G(25, 43.95), G(22.5, 44.4), G(19.5, 45.2)], 14, 12),
                        ([G(32.3, 46.6), G(32.5, 47.5), G(33.8, 48.6), G(34.6, 50.0), G(32.0, 51.5), G(29.5, 53.0)], 15, 7),
                        ([G(30.3, 46.1), G(29.6, 47.4), G(27.8, 48.8), G(25.0, 50.0), G(22.0, 51.0)], 9, 5),
                        ([G(38.9, 47.1), G(40.4, 48.3), G(40.6, 50.0), G(40.0, 52.0), G(41.0, 54.0)], 11, 7),
                        ([G(35.95, 41.7), G(35.2, 40.6), G(35.6, 39.4), G(36.9, 38.9), G(38.5, 38.7)], 11, 6),
                        ([G(30.55, 41.15), G(30.45, 40.2), G(30.0, 39.4), G(29.3, 38.9)], 9, 5)):
        p.cell(_ribbon(pts, w0, w1), 'lapis', 3)
    for (lon, lat, rw, rh) in ((33.4, 38.7, 50, 22), (30.4, 38.3, 36, 18), (37.0, 38.5, 30, 15)):
        lx, ly = G(lon, lat)
        p.cell(ellipse(lx, ly, rw, rh), 'lapis', 4)
        waves(p, ellipse(lx, ly, rw, rh), lx - rw, ly - rh, lx + rw, ly + rh, t, 30, 14, 1, 2)
    # ---- Marmara, Dardanelles, Aegean/Mediterranean, Caspian
    mar = spline([(86, 859), (150, 830), (232, 826), (300, 838), (312, 862), (252, 882), (160, 888), (98, 880)], True, .9)
    bos = _ribbon([(260, 770), (256, 788), (252, 806), (250, 830)], 17, 20)
    med = spline([G(14, 34.2), G(51, 34.2), G(51, 36.4), G(36.2, 36.5), G(34.6, 36.2), G(32.5, 36.1), G(30.4, 36.4), G(29.0, 36.6),
                  G(27.8, 36.8), G(27.3, 37.6), G(26.6, 38.4), G(26.5, 39.4), G(26.1, 40.0), G(25.2, 40.7), G(24.1, 40.0),
                  G(23.1, 40.3), G(22.6, 39.6), G(23.0, 38.5), G(23.5, 37.9), G(22.8, 36.5), G(21.5, 37.0), G(14, 38.5)], True, .55)
    dard = _ribbon([(112, 866), (92, 894), (60, 918)], 15, 22)
    casp = spline([G(48.3, 39.0), G(49.6, 40.4), G(49.9, 42.6), G(51.5, 45.5), G(50.5, 47.3), G(47.0, 46.2), G(46.6, 44.3), G(48.0, 42.2), G(48.2, 40.8)], True, .8)
    for shape in (med, casp):
        p.cell(shape, 'lapis', 5.5)
        waves(p, shape, vx0, 900, vx1, vy1, t, 78, 46, 3, 2.4)
    p.cell(mar, 'lapis', 5)
    p.cell(dard, 'lapis', 3.5)
    p.cell(bos, 'lapis', 3.5)
    waves(p, mar, 80, 844, 320, 894, t, 70, 24, 2, 2.2)
    # ---- the Black Sea (one cell: sea + Azov + Kerch strait)
    ring = [G(*q) for q in _SOUTH + _EAST + _AZOV + _CRIMEA + _NORTHW]
    sea = spline(ring, True, .8)
    p.cell(sea, 'lapis', 6)
    cx, cy = 575, 560
    for sc in (.955, .91, .865):
        with p.clip(sea):
            with p.transform(scale=sc, pivot=(cx, cy)):
                p.wire(spline(ring, True, .8), 2.2)
    waves(p, sea, 80, 230, 1010, 880, t, 80, 52, 3.5, 2.6)
    # portolan rhumb lines fanning across the sea from two hubs
    rl = []
    for hub in ((560, 620), (760, 520)):
        for i in range(16):
            a = i * TAU / 16 + (.2 if hub[0] > 600 else 0)
            rl.append([hub, (hub[0] + 900 * math.cos(a), hub[1] + 900 * math.sin(a))])
    with p.clip(sea):
        wires(p, rl, 1.5)
    # ---- terrain icons
    for lon, lat in ((31.2, 40.7), (31.9, 40.85), (32.7, 41.25), (33.5, 41.45), (34.4, 41.5), (35.2, 41.5), (36.3, 40.7), (37.2, 40.55),
                     (38.2, 40.45), (39.2, 40.4), (40.2, 40.5), (41.2, 40.9)):
        x, y = G(lon, lat)
        if vis(fmt, x - 40, y - 60, x + 40, y + 6):
            _peak(p, x, y, 1.0 + .25 * (hsh(int(lon * 10)) % 3 - 1) / 2)
    for lon, lat in ((29.5, 39.8), (30.6, 39.2), (31.9, 38.6), (33.2, 37.9), (34.5, 37.5), (35.8, 37.6), (37.0, 37.9), (38.3, 38.1), (39.6, 38.4),
                     (40.8, 39.6), (41.9, 40.6), (31.6, 40.1), (34.0, 40.2), (37.8, 40.1)):
        x, y = G(lon, lat)
        if vis(fmt, x - 40, y - 60, x + 40, y + 6):
            _peak(p, x, y, .85 + .3 * (hsh(int(lon * 10), 5) % 3) / 2)
    for lon, lat in ((40.6, 43.9), (41.4, 43.55), (42.4, 43.25), (43.4, 43.05), (44.4, 42.9), (45.4, 42.7), (46.4, 42.4)):
        x, y = G(lon, lat)
        if vis(fmt, x - 40, y - 60, x + 40, y + 6):
            _peak(p, x, y, 1.15)
    for lon, lat in ((27.2, 43.0), (26.4, 42.85), (25.6, 42.9), (24.8, 42.8), (24.0, 42.7), (23.2, 42.6), (22.4, 42.9)):
        x, y = G(lon, lat)
        if vis(fmt, x - 40, y - 60, x + 40, y + 6):
            _peak(p, x, y, 1.0)
    for lon, lat, sc in ((30.52, 50.4, 1.1), (30.9, 46.95, .85), (27.1, 43.3, 1.0), (39.5, 40.55, .9), (35.0, 41.45, .85),
                         (32.9, 39.9, 1.0), (22.9, 40.6, 1.0), (28.3, 45.5, .8), (29.7, 40.3, .9), (35.3, 38.9, .9), (36.4, 41.0, .8),
                         (41.7, 41.9, .8), (35.6, 48.2, .9), (31.0, 49.0, .8), (27.5, 41.6, .8)):
        x, y = G(lon, lat)
        if vis(fmt, x - 40, y - 70, x + 40, y + 6):
            _tower_icon(p, x, y, sc)
    # ---- routes (dashed gold wire that draws itself), ship, army
    ro, rb = _out_route(), _back_route()
    for seg in ro.dashes(ro.length * clamp(route_out)) + rb.dashes(rb.length * clamp(route_back)):
        if len(seg) > 2:
            p.cell(_ribbon(seg, 11, 11, 1), 'ivory', 3)
        else:
            p.wire(path(seg, False), 8)
    for pr, r_ in ((route_out, ro), (route_back, rb)):
        if 0 < pr < 1:
            tip = r_.at(r_.length * pr)[0]
            p.glint(tip[0], tip[1], 20, 1)
    ship_pos = None
    if ship is not None:
        r_ = ro if ship_route == 'out' else rb
        pos, tan = r_.at(r_.length * clamp(ship))
        ship_pos = (pos[0], pos[1])
        d = 1 if tan[0] >= 0 else -1
        with p.transform(rotate=math.sin(t * 1.7) * 3, pivot=pos):
            _little_ship(p, pos[0], pos[1] - 10 + math.sin(t * 2.1) * 2.5, .8, d)
    army_head = None
    if army > 0:
        head = rb.length * clamp(army)
        for i in range(7, -1, -1):
            s_ = head - i * 40
            if s_ < 0:
                continue
            pos, _ = rb.at(min(s_, rb.length))
            _helmet_marker(p, pos[0], pos[1] + 8, 1.3 * min(1, s_ / 30 + .15))
        army_head = rb.at(head)[0]
    # ---- Constantinople's domes beside the marker, then city and Cherson markers (cabochons), crown icon
    _chapel(p, 178, 826, 17, t, fmt)
    _chapel(p, 140, 820, 12, t, fmt)
    _tower_icon(p, 206, 804, .8)
    for (mx, my, enamel) in ((_CITY[0], _CITY[1], 'pearl'), (_CHERSON[0], _CHERSON[1], 'saffron')):
        p.gold(ellipse(mx, my, 24), .7)
        p.wire(ellipse(mx, my, 24), 4)
        p.cabochon(mx, my, 17, enamel)
        p.glint(mx - 6, my - 6, 9 + 3 * math.sin(t * 2 + mx), .9)
    if crown_x is not None:
        _crown_icon(p, _CITY[0] - 6, _CITY[1] - 92, 1.2, crown_x)
    compass(p, 880, 175, 68, t)
    _map_border(p, fmt)
    return dict(city=_CITY, cherson=_CHERSON, bulgar=G(27.1, 43.3), plaque_cherson=(650, 590), plaque_year=(760, 700),
                compass=(880, 175), ship_pos=ship_pos, army_head=army_head, crown=(_CITY[0] - 6, _CITY[1] - 92),
                route_out_pts=ro.pts, route_back_pts=rb.pts)


# ======================================================== 3. walls (night)
def _flame(p, x, y, t, ph=0., s=1.):
    """Torch flame: saffron teardrop whose lean and height flicker with t."""
    f = 1 + .12 * math.sin(t * 9 + ph) + .06 * math.sin(t * 15.3 + ph * 2)
    lean = math.sin(t * 5.1 + ph) * 3.5
    with p.transform(translate=(x, y), scale=(s, s * f)):
        p.cell(path([(lean, -36), (lean * .5 - 4, -22, -10, -10), (-8, 0, 0, 3), (8, 0, 10, -10), (lean * .5 + 4, -22, lean, -36)]), 'saffron', 3)
        p.cell(path([(0, -18), (-4, -9, 0, -2), (4, -9, 0, -18)]), 'coral', 2)


def _bricks(p, x0, x1, y, h=22, step=30):
    p.cell(rect(x0, y, x1 - x0, h, 0), 'oxblood', 3.5)
    xs = x0 + (step // 2)
    segs = []
    k = 0
    while xs < x1:
        segs.append([(xs, y + (0 if k % 2 else h / 2)), (xs, y + (h / 2 if k % 2 else h))])
        xs += step
        k += 1
    wires(p, segs, 2.2)
    p.wire(path([(x0, y + h / 2), (x1, y + h / 2)], False), 2.2)


def _tier(p, fmt, top, base, tx0, pitch, tw, ttop, enamel, bands, merl, t, flags=False, seed=0, torches=False):
    wall = crenel(-520, 1600, top, base, *merl)
    p.cell(wall, enamel, 6)
    stonework(p, wall, -520, top - merl[2], 1600, base, row=40, col=76)
    for b in bands:
        _bricks(p, -520, 1600, b)
    p.cell(rect(-520, top + 4, 2120, 16, 2), 'ivory' if enamel == 'sand' else 'sand', 4.5)
    n = int((1600 - tx0) // pitch) + 2
    for k in range(-2, n):
        tx = tx0 + k * pitch
        if not vis(fmt, tx - tw, ttop - 60, tx + tw, base, 40):
            continue
        tb = crenel(tx - tw / 2, tx + tw / 2, ttop + merl[2], base + 2, merl[0] - 2, merl[1] - 4, merl[2] + 4)
        p.cell(tb, enamel, 6)
        stonework(p, tb, tx - tw / 2, ttop, tx + tw / 2, base, row=40, col=tw / 3 + 6)
        for b in bands:
            _bricks(p, tx - tw / 2, tx + tw / 2, b)
        p.cell(rect(tx - tw / 2 - 7, ttop + 44, tw + 14, 16, 3), 'ivory' if enamel == 'sand' else 'sand', 4.5)
        wy = ttop + 110
        p.cell(arch(tx - 14, wy + 64, 28, 64), 'ivory', 4)
        p.cell(arch(tx - 8, wy + 60, 16, 52), 'onyx', 2.5)
        for sl in (-1, 1):
            p.cell(arch(tx + sl * tw * .28 - 6, wy + 150, 12, 44), 'onyx', 2.5)
        if flags:
            flag(p, tx, ttop + merl[2] - 4, 52, 30, 'oxblood' if k % 2 else 'lapis', t, k * 1.3 + seed, .9, 54)
        if torches:
            p.wire(path([(tx - tw / 2 - 12, base - 150), (tx - tw / 2 - 26, base - 146)], False), 4)
            _flame(p, tx - tw / 2 - 20, base - 152, t, k * 1.7)


def walls(p, t, fmt, bonk=0., ground=True):
    """The triple land walls of Constantinople at night (s6, first half): fills the frame, moon, gate.

    bonk    0..1  impact starburst and cracks on the outer gate where the figure bounces off.
    ground  True  draw the `night` ground first.
    Anchors: ground_line=(540, 1000) (feet y of the 200-unit figure), impact=(540, 868), sit=(700, 1000),
    moon, gate.
    """
    if ground:
        p.ground('night')
    # ---- moon: pearl cabochon in a gold ring, rays and a bead halo
    mx, my = 700, 128
    rays = []
    for i in range(24):
        a = t * .03 + i * TAU / 24
        r1, r2 = 98, 120 if i % 2 == 0 else 110
        rays.append([(mx + r1 * math.cos(a), my + r1 * math.sin(a)), (mx + r2 * math.cos(a), my + r2 * math.sin(a))])
    wires(p, rays, 3.5)
    p.beads(ellipse(mx, my, 90), 18, 3.2)
    p.gold(ellipse(mx, my, 82), .5, 'hammered')
    p.wire(ellipse(mx, my, 82), 4.5)
    p.cabochon(mx, my, 70, 'pearl')
    for (dx, dy, r_) in ((-26, -18, 17), (24, 14, 12), (-8, 34, 9), (30, -30, 7)):
        p.cell(ellipse(mx + dx, my + dy, r_), 'ivory', 2.5)
    p.glint(mx - 32, my - 34, 22 + 4 * math.sin(t * 1.3), .9)
    for (sx, sy, ph) in ((140, 40, 0), (360, 150, 1.7), (880, 160, 3.1), (1040, 60, 4.4), (-250, 90, 2.2), (1330, 130, .9), (70, -170, 5.1),
                         (620, -210, 2.8), (980, -150, 3.9), (300, -90, 1.1)):
        g = math.sin(t * 1.6 + ph)
        if g > -.2:
            p.glint(sx, sy, 14 + 8 * g, .6 + .4 * g)
    for (cx_, cy_, w_, h_, ph_) in ((-380, 120, 260, 44, 0), (60, 140, 250, 46, 1.4), (330, -90, 290, 50, 2.6), (940, -40, 300, 50, 3.3),
                                    (1250, 160, 260, 46, 4.4), (-120, -230, 290, 52, 5.2), (760, -250, 280, 50, 1.9), (1330, -150, 250, 46, .8)):
        if vis(fmt, cx_ - 40, cy_ - h_ * 3, cx_ + w_ + 40, cy_, 20):
            cloud(p, cx_, cy_, w_, h_, t, ph_, 'lapis')
    # ---- the three walls, far to near
    _tier(p, fmt, 330, 930, 100, 400, 190, 190, 'sand', (440, 560), (30, 20, 24), t, flags=True, seed=0)
    gx = 540
    for (gy, gw, gh) in ((470, 150, 150),):               # inner gate arch peeks over the middle wall
        p.cell(arch(gx - gw / 2 - 12, gy + gh, gw + 24, gh + 20), 'ivory', 5)
        p.cell(arch(gx - gw / 2, gy + gh, gw, gh), 'lapis', 5)
        p.gold(arch(gx - gw / 2 + 12, gy + gh, gw - 24, gh - 14), .55, 'hammered')
    _tier(p, fmt, 560, 940, -130, 330, 150, 440, 'ivory', (800, 840), (28, 18, 22), t, flags=False, torches=False)
    p.cell(arch(gx - 82, 840, 164, 210), 'sand', 5)
    p.cell(arch(gx - 68, 840, 136, 180), 'lapis', 5)
    p.gold(arch(gx - 58, 840, 116, 156), .55, 'hammered')
    wires(p, [[(gx, 840), (gx, 700)]] + [[(gx - 58, 840 - 30 * k), (gx + 58, 840 - 30 * k)] for k in (1, 2, 3, 4)], 3)
    _tier(p, fmt, 744, 1000, -190, 260, 118, 690, 'sand', (920,), (26, 16, 20), t, torches=True, seed=2)
    # outer gate with gold doors
    p.cell(arch(gx - 108, 1000, 216, 262), 'ivory', 5.5)
    p.cell(arch(gx - 90, 1000, 180, 232), 'lapis', 5)
    door = arch(gx - 80, 1000, 160, 212)
    p.gold(door, .6, 'hammered')
    p.wire(door, 4.5)
    wires(p, [[(gx, 1000), (gx, 812)]] + [[(gx - 80, 1000 - 38 * k), (gx + 80, 1000 - 38 * k)] for k in (1, 2, 3, 4)], 3.2)
    for sd in (-1, 1):
        p.cabochon(gx + sd * 24, 912, 8, 'oxblood')
        p.cabochon(gx + sd * 54, 960, 6, 'oxblood')
    # ---- ground strip (jade grass) and the moat with the moon's reflection
    strip = rect(-520, 1000, 2120, 100, 0)
    p.cell(strip, 'jade', 5.5)
    for x in range(-500, 1600, 62):
        for j, yy in enumerate((1034, 1076)):
            xx = x + (31 if j else 0)
            _tuft(p, xx, yy, .9)
    p.cell(rect(-520, 1100, 2120, 20, 0), 'sand', 5)
    moat = rect(-520, 1120, 2120, 900, 0)
    p.cell(moat, 'lapis', 5.5)
    waves(p, moat, -520, 1150, 1600, 1620, t, 90, 52, 3, 2.4)
    refl = []
    for i in range(9):
        yy = 1160 + i * 46
        wd = 120 - i * 9 + 12 * math.sin(t * 1.5 + i)
        xx = 700 + 10 * math.sin(t * .9 + i * .8)
        refl.append([(xx - wd, yy), (xx + wd, yy)])
    with p.clip(moat):
        wires(p, refl, 5)
    # ---- bonk: starburst and fine cracks at the impact point
    if bonk > 0:
        u = smooth(bonk * 2.2)
        cx, cy = 540, 868
        R = 82 * u
        pts = []
        for i in range(20):
            r_ = R if i % 2 == 0 else R * .5
            a = i * TAU / 20 - math.pi / 2
            pts.append((cx + r_ * math.cos(a), cy + r_ * math.sin(a)))
        p.gold(path(pts), .8, 'hammered')
        p.wire(path(pts), 3.5)
        p.cabochon(cx, cy, 16 * u + 2, 'pearl')
        fissure(p, [(cx - 90, cy + 30), (cx - 60, cy + 12), (cx - 78, cy - 14), (cx - 46, cy - 26)], clamp(bonk * 2), 6)
        fissure(p, [(cx + 90, cy + 40), (cx + 58, cy + 18), (cx + 74, cy - 8)], clamp(bonk * 2 - .2), 6)
        if bonk < .5:
            p.glint(cx, cy, 70 * u, 1 - bonk * 1.6)
    return dict(ground_line=(540, 1000), impact=(540, 868), sit=(700, 1000), moon=(mx, my), gate=(540, 1000))


# ===================================================== 4. aqueduct (night)
def _bay_spandrel(xa, xb, ytop, yspring, ybase):
    """Wall above a round arch opening: closed region between the bay's top edge and the arch."""
    r = (xb - xa) / 2
    cx = (xa + xb) / 2
    ytopa = yspring - r
    return path([(xa, ytop), (xb, ytop), (xb, yspring), (xb, yspring - K * r, cx + K * r, ytopa, cx, ytopa),
                 (cx - K * r, ytopa, xa, yspring - K * r, xa, yspring)])


def _arcade(p, fmt, x_first, pitch, pier, ytop, yspring, ybase, enamel, t):
    n = int((1700 - x_first) // pitch) + 3
    for k in range(-3, n):
        xa = x_first + k * pitch + pier
        xb = x_first + (k + 1) * pitch
        if not vis(fmt, xa - pier, ytop, xb + pier, ybase, 40):
            continue
        sp = _bay_spandrel(xa, xb, ytop, yspring, ybase)
        p.cell(sp, enamel, 5.5)
        stonework(p, sp, xa, ytop, xb, yspring, row=38, col=56, w=2.4)
        # voussoir ring: wire arc around the opening
        r = (xb - xa) / 2
        cx = (xa + xb) / 2
        p.wire(path([(xa, ybase), (xa, yspring), (xa, yspring - K * r, cx - K * r, yspring - r, cx, yspring - r),
                     (cx + K * r, yspring - r, xb, yspring - K * r, xb, yspring), (xb, ybase)], False), 5)
        p.wire(path([(xa - 10, yspring), (xa - 10, yspring - (r + 10) * K, cx - K * (r + 10), yspring - r - 10, cx, yspring - r - 10),
                     (cx + K * (r + 10), yspring - r - 10, xb + 10, yspring - (r + 10) * K, xb + 10, yspring)], False), 2.6)
        p.cabochon(cx, yspring - r - 20, 6, 'oxblood')
        # pier between this bay and the next
        pr = rect(xb, ytop, pier, ybase - ytop, 0)
        p.cell(pr, enamel, 5.5)
        stonework(p, pr, xb, ytop, xb + pier, ybase, row=38, col=pier / 2 + 2)


def aqueduct(p, t, fmt, traveller=0., ground=True, draw_traveller=True):
    """Cross-section of an old aqueduct at night (s6, second half).

    traveller  0..1  the gold nose and two eye glints inch left -> right inside the onyx pipe
               (bobbing a little). Only the nose and the glints are lit; the pipe is black.
    ground     True  draw the `night` ground first.
    Anchors: pipe_entry=(70, 480), pipe_exit=(1010, 480), pipe_h=108, nose (current position).
    """
    if ground:
        p.ground('night')
    # ---- sky: moon on the left, the city skyline on the right, hills in the middle distance
    p.beads(ellipse(190, 140, 112), 22, 3.5)
    p.gold(ellipse(190, 140, 100), .5, 'hammered')
    p.wire(ellipse(190, 140, 100), 4.5)
    p.cabochon(190, 140, 86, 'pearl')
    for (dx, dy, r_) in ((-28, -20, 18), (26, 16, 13), (-6, 38, 9)):
        p.cell(ellipse(190 + dx, 140 + dy, r_), 'ivory', 2.5)
    p.glint(160, 106, 24 + 4 * math.sin(t * 1.3), .9)
    for (sx, sy, ph) in ((460, 70, 0), (640, 230, 1.7), (80, 340, 3.1), (860, 60, 4.4), (1230, 40, 2.2), (-250, 220, .9), (330, -150, 5.1), (900, -120, 2.8)):
        g = math.sin(t * 1.6 + ph)
        if g > -.2:
            p.glint(sx, sy, 14 + 8 * g, .6 + .4 * g)
    for (cx, cy, w_, h_, ph) in ((330, 70, 300, 50, 0), (760, -80, 300, 56, 1.7), (-80, -170, 300, 56, 3.0), (1180, 90, 280, 50, 2.2),
                                 (-380, 50, 260, 48, 4.1), (1280, -200, 280, 52, 5.0), (500, -230, 260, 46, 2.6)):
        if vis(fmt, cx - 50, cy - h_ * 3, cx + w_ + 50, cy, 20):
            cloud(p, cx, cy, w_, h_, t, ph, 'lapis')
    # hills on the left, the city on the right, both standing behind the pipe
    hill = spline([(-520, 372), (-520, 300), (-320, 250), (-120, 292), (110, 236), (300, 286), (480, 334), (560, 372)], False, .8, True)
    p.cell(hill, 'lapis', 5.5)
    for (cx, h_) in ((70, 170), (120, 130), (330, 150), (-140, 160), (-320, 140), (-70, 120)):
        cypress(p, cx, 380, h_)
    for k, (cx, w_, h_) in enumerate(((800, 130, 170), (940, 104, 270), (1070, 138, 200), (1210, 110, 300), (1350, 148, 220), (1490, 110, 180))):
        body = rect(cx - w_ / 2, 372 - h_, w_, h_ + 20, 4)
        p.cell(body, 'amethyst', 5)
        lattice(p, body, cx - w_ / 2, 372 - h_, cx + w_ / 2, 392, sp=30, w=2.2)
        p.cell(dome(cx, 372 - h_, w_ * .56, w_ * .5), 'lapis', 5)
        p.wire(path([(cx, 372 - h_ - w_ * .5), (cx, 372 - h_ - w_ * .5 - 26)], False), 3.5)
        p.cabochon(cx, 372 - h_ - w_ * .5 - 30, 5, 'pearl')
        for wy in range(int(372 - h_ + 40), 340, 52):
            for wx in range(int(cx - w_ / 2 + 20), int(cx + w_ / 2 - 12), 28):
                if hsh(k, wx, wy) % 3:
                    p.cell(arch(wx, wy + 30, 13, 30), 'saffron', 2.5)
    # the hillside beyond the arches: lapis ground with village lights and cypresses
    hills = spline([(-520, 790), (-300, 700), (-60, 740), (200, 680), (480, 730), (760, 670), (1040, 720), (1300, 670), (1620, 730),
                    (1620, 1100), (-520, 1100)], False, .8, True)
    p.cell(hills, 'lapis', 5.5)
    for i in range(60):
        px = -480 + hf(i, 31) * 2040
        py = 780 + hf(i, 32) * 220
        p.cabochon(px, py, 4, 'saffron' if i % 4 else 'pearl')
    for (cx, h_) in ((20, 150), (60, 120), (520, 160), (900, 140), (1250, 150), (-200, 150)):
        cypress(p, cx, 1000, h_)
    # ---- the arcade: two tiers of tall arches
    stone = 'sand'
    _arcade(p, fmt, 40, 200, 64, 806, 936, 1040, stone, t)
    p.cell(rect(-520, 790, 2120, 40, 0), 'ivory', 5.5)
    wires(p, [[(x, 792), (x + 20, 828)] for x in range(-520, 1600, 40)], 2.4)
    _arcade(p, fmt, 40, 200, 64, 566, 676, 790, stone, t)
    # ---- the pipe
    p.cell(rect(-520, 534, 2120, 34, 0), 'ivory', 5.5)
    wires(p, [[(x, 536), (x + 18, 566)] for x in range(-520, 1600, 36)], 2.4)
    pipe = rect(-520, 422, 2120, 114, 0)
    p.cell(pipe, 'onyx', 6.5)
    p.wire(path([(-520, 436), (1600, 436)], False), 2)
    p.wire(path([(-520, 522), (1600, 522)], False), 2)
    p.cell(rect(-520, 388, 2120, 36, 0), 'ivory', 5.5)
    p.cell(rect(-520, 366, 2120, 24, 0), 'sand', 5)
    wires(p, [[(x, 368), (x, 388)] for x in range(-520, 1600, 34)], 2.2)
    for cxp in range(-320, 1600, 400):                     # slim gold flanges on the pipe
        p.wire(path([(cxp - 7, 416), (cxp - 7, 542)], False), 5)
        p.wire(path([(cxp + 7, 416), (cxp + 7, 542)], False), 5)
        for yy in (432, 530):
            p.rivet(cxp, yy, 5.5)
    # ---- the traveller: nose and two eye glints, only these are visible in the dark
    ex0, ex1, ey = 70., 1010., 480.
    x = lerp(ex0, ex1, clamp(traveller))
    y = ey + math.sin(t * 3.1) * 3.2
    if draw_traveller:
        with p.transform(translate=(x, y), rotate=math.sin(t * 2.3) * 2.2, pivot=(0, 0), scale=1.9):
            nose = path([(0, -8), (-9, 26), (-2, 36, 9, 30), (11, -2), (6, -12, 0, -8)])
            p.gold(nose, .85)
            p.wire(nose, 3)
            p.wire(path([(-1, -2), (-4, 20)], False), 1.8)
            p.cell(ellipse(-3, 6, 2.4, 6), 'pearl', 1)
            for sd in (-1, 1):
                ex = sd * 44
                p.cabochon(ex, -13, 5.2, 'pearl')
                p.glint(ex - 1, -15, 9 + 2 * math.sin(t * 4 + sd), 1)
            p.glint(1, 6, 13, .7 + .3 * math.sin(t * 2.6))
    # ---- ground and earth below
    p.cell(rect(-520, 1040, 2120, 40, 0), 'jade', 5.5)
    for xx in range(-520, 1600, 58):
        _tuft(p, xx, 1074, .9)
    p.cell(rect(-520, 1080, 2120, 700, 0), 'oxblood', 5.5)
    for i, (yy, enamel) in enumerate(((1150, 'sand'), (1290, 'amethyst'), (1440, 'sand'))):
        band = spline([(-520, yy), (-250, yy + 24), (60, yy - 10), (380, yy + 22), (700, yy - 6), (1020, yy + 20), (1300, yy - 8), (1620, yy + 14),
                       (1620, yy + 60), (-520, yy + 60)], False, .8, True)
        p.cell(band, enamel, 4.5)
    for i in range(70):
        px = -480 + hf(i, 1) * 2020
        py = 1100 + hf(i, 2) * 480
        p.cabochon(px, py, 5 + hf(i, 3) * 6, 'pearl' if i % 3 else 'sand', None)
    return dict(pipe_entry=(ex0, ey), pipe_exit=(ex1, ey), pipe_h=108, nose=(x, y))


# ============================================================ 5. hippodrome
_HC = (540, 395)                 # centre of the racetrack oval
_HR = (430, 215)                 # outer radii of the sand track
_HS = 60                         # tier thickness of the stands


def _horse(p, x, y, t, ph, enamel):
    """Galloping horse, facing +x, feet at y."""
    for i, (lx, sgn) in enumerate(((-14, 1), (-8, -1), (12, 1), (18, -1))):
        d = math.sin(t * 14 + ph + i * 1.6) * 8
        p.wire(path([(x + lx, y - 22), (x + lx + d, y - 10, x + lx + d * 1.2, y)], False), 3.4)
    p.wire(path([(x - 22, y - 30), (x - 38, y - 22, x - 34, y - 8)], False), 3)
    p.cell(ellipse(x, y - 28, 24, 11.5), enamel, 3.2)
    p.cell(path([(x + 14, y - 32), (x + 28, y - 52), (x + 41, y - 50), (x + 45, y - 41), (x + 36, y - 40), (x + 26, y - 24)]), enamel, 3.2)
    p.wire(path([(x + 22, y - 49), (x + 12, y - 40), (x + 18, y - 32)], False), 2.6)
    p.cabochon(x + 38, y - 45, 1.9, 'onyx')


def _chariot(p, x, y, s, flip, t, ph, team):
    with p.transform(translate=(x, y), scale=(s * flip, s)):
        _horse(p, 70, -2, t, ph + 1.3, 'onyx')
        _horse(p, 50, 2, t, ph, 'oxblood')
        p.wire(path([(18, -28), (58, -24)], False), 3.4)
        spin = t * 9 + ph
        p.cell(ellipse(0, -18, 18), 'sand', 1.2)
        p.wire(ellipse(0, -18, 18), 4.2)
        p.wire(multi([[(math.cos(spin + k * math.pi / 3) * 17, -18 + math.sin(spin + k * math.pi / 3) * 17),
                       (-math.cos(spin + k * math.pi / 3) * 17, -18 - math.sin(spin + k * math.pi / 3) * 17)] for k in range(3)]), 2.4)
        p.rivet(0, -18, 5)
        p.cell(path([(-24, -22), (-24, -48), (-10, -53), (28, -48), (28, -22)]), team, 3.6)
        p.wire(path([(-24, -32), (28, -32)], False), 3)
        p.cell(ellipse(2, -58, 9, 12), team, 3)
        p.cabochon(2, -74, 7.5, 'ivory')
        p.cell(dome(2, -77, 8, 6), 'saffron', 2.5)
        p.wire(path([(10, -64), (30, -78, 44, -64)], False), 2.4)


def hippodrome(p, t, fmt, speed=.1, ground=True):
    """Hippodrome seen from the imperial box (s8, first half; oxblood `scroll` ground).

    speed   laps per second of the two chariots (blue and green team); they loop the track as a
            pure function of t and pass behind the imperial niche on the near side.
    ground  True  draw the oxblood scroll ground first.
    Anchors: box_floor=(540, 902), prone=[(395, 880), (685, 880)] (centres of two lying figures about
    170 long), necks=[(470, 862), (610, 862)], emperor_feet=(540, 858) (feet y of the 380-unit figure),
    spina, track_centre.
    """
    if ground:
        p.ground('scroll', 'oxblood')
    cx, cy = _HC
    rx0, ry0 = _HR
    # ---- stands: concentric tiers, outermost first, each a filled ring cell
    for k in range(12, 0, -1):
        rx, ry = rx0 + _HS * k, ry0 + _HS * k
        p.cell(ellipse(cx, cy, rx, ry), 'sand' if k % 2 else 'ivory', 5)
    # radial aisles
    segs = []
    for i in range(24):
        a = i * TAU / 24
        segs.append([(cx + (rx0 + 4) * math.cos(a), cy + (ry0 + 4) * math.sin(a)),
                     (cx + (rx0 + _HS * 12) * math.cos(a), cy + (ry0 + _HS * 12) * math.sin(a))])
    with p.clip(ellipse(cx, cy, rx0 + _HS * 12, ry0 + _HS * 12)):
        wires(p, segs, 3.5)
    # spectators: two rows of cabochon heads per tier, Blues on the left, Greens on the right
    for k in range(1, 13):
        for row, off in ((0, .3), (1, .72)):
            rx = rx0 + _HS * (k - 1) + _HS * off
            ry = ry0 + _HS * (k - 1) + _HS * off
            per = TAU * math.sqrt((rx * rx + ry * ry) / 2)
            n = int(per / 27)
            for i in range(n):
                a = (i + (.5 if row else 0)) * TAU / n
                hx, hy = cx + rx * math.cos(a), cy + ry * math.sin(a)
                if hy > 880 or not vis(fmt, hx - 8, hy - 8, hx + 8, hy + 8):
                    continue
                if 300 < hx < 780 and hy > 460:          # hidden behind the imperial niche
                    continue
                h = hsh(k, row, i)
                faction = 'lapis' if hx < cx else 'jade'
                c = faction if h % 10 < 6 else ('saffron', 'coral', 'amethyst', 'oxblood')[h % 4]
                p.cabochon(hx, hy + math.sin(t * 2.5 + (h % 97)) * .8 * (1 if h % 9 == 0 else 0), 6.4, c)
    # ---- the track: sand oval with lane wires and raking
    track = ellipse(cx, cy, rx0, ry0)
    p.cell(track, 'sand', 6.5)
    waves(p, track, cx - rx0, cy - ry0, cx + rx0, cy + ry0, 0, 56, 30, 0, 2.2)
    p.wire(ellipse(cx, cy, rx0 * .92, ry0 * .9), 2.4)
    p.wire(ellipse(cx, cy, rx0 * .66, ry0 * .62), 2.4)
    # start line
    p.cell(rect(cx - 150, cy + ry0 * .62 - 4, 52, 10, 1), 'ivory', 2.5)
    # ---- the spina island
    isl = rect(cx - 300, cy - 56, 600, 112, 56)
    p.cell(isl, 'ivory', 6)
    p.cell(rect(cx - 262, cy - 10, 524, 20, 10), 'lapis', 4)
    waves(p, rect(cx - 262, cy - 10, 524, 20, 10), cx - 262, cy - 8, cx + 262, cy + 10, t, 44, 14, 1.6, 2.2)
    for xe in (-292, 292):                                 # turning posts (metae)
        mx = cx + xe
        p.cell(path([(mx - 22, cy + 30), (mx - 12, cy - 56), (mx + 12, cy - 56), (mx + 22, cy + 30)]), 'lapis', 4.5)
        wires(p, [[(mx - 18, cy), (mx + 18, cy)], [(mx - 15, cy - 26), (mx + 15, cy - 26)]], 2.6)
        p.cabochon(mx, cy - 64, 12, 'saffron')
    # chariot positions (clockwise; near side moves left)
    cars = []
    for j, team in enumerate(('lapis', 'jade')):
        th = (t * speed + .25 + j * .5) * TAU
        px = cx + 365 * math.cos(th)
        py = cy + 140 * math.sin(th)
        tanx = -math.sin(th)
        s = 1.35 + .55 * (py - (cy - ry0)) / (2 * ry0)
        cars.append((py, px, s, 1 if tanx >= 0 else -1, j, team))
    cars.sort()

    def spina_objects():
        # obelisk, serpent column, statue column, seven eggs on a beam, all standing on the island
        ox = cx - 120
        p.cell(rect(ox - 26, cy - 22, 52, 22, 2), 'sand', 4)
        p.cell(rect(ox - 20, cy - 36, 40, 14, 2), 'ivory', 3.5)
        ob = path([(ox - 14, cy - 36), (ox - 9, cy - 150), (ox, cy - 168), (ox + 9, cy - 150), (ox + 14, cy - 36)])
        p.cell(ob, 'coral', 4.5)
        wires(p, [[(ox - 4, cy - 52 - 22 * k), (ox + 4, cy - 52 - 22 * k)] for k in range(5)] + [[(ox, cy - 60), (ox, cy - 140)]], 2.4)
        p.gold(path([(ox - 9, cy - 150), (ox, cy - 168), (ox + 9, cy - 150)]), .85)
        sx = cx + 10
        p.cell(rect(sx - 20, cy - 20, 40, 20, 2), 'sand', 4)
        col = path([(sx - 8, cy - 20), (sx - 7, cy - 80), (sx - 11, cy - 96), (sx + 11, cy - 96), (sx + 7, cy - 80), (sx + 8, cy - 20)])
        p.gold(col, .8, 'hammered')
        p.wire(col, 3.5)
        wires(p, [[(sx - 8, cy - 28 - 14 * k), (sx + 8, cy - 40 - 14 * k)] for k in range(5)], 2.6)
        for dx in (-9, 0, 9):
            p.cabochon(sx + dx, cy - 104 - (4 if dx == 0 else 0), 5.5, 'saffron')
        ex = cx + 120
        p.cell(rect(ex - 22, cy - 20, 44, 20, 2), 'sand', 4)
        for k in range(4):
            p.cell(rect(ex - 12, cy - 38 - k * 20, 24, 18, 2), 'ivory', 3.5)
        p.gold(ellipse(ex, cy - 128, 12, 18), .8)
        p.cabochon(ex, cy - 152, 8, 'pearl')
        bx = cx + 210
        p.wire(path([(bx - 56, cy - 40), (bx + 56, cy - 40)], False), 4)
        for k in range(7):
            p.cabochon(bx - 48 + k * 16, cy - 49, 6, 'ivory', 8)
        p.wire(path([(bx - 56, cy - 40), (bx - 56, cy - 8)], False), 3.5)
        p.wire(path([(bx + 56, cy - 40), (bx + 56, cy - 8)], False), 3.5)

    far = [c for c in cars if c[0] < cy]
    near = [c for c in cars if c[0] >= cy]
    for (py, px, s, fl, j, team) in far:
        _chariot(p, px, py, s, fl, t, j * 1.9, team)
    with p.transform(scale=1.22, pivot=(cx, cy + 40)):
        spina_objects()
    for (py, px, s, fl, j, team) in near:
        _chariot(p, px, py, s, fl, t, j * 1.9, team)
    # ---- the imperial box in the foreground: niche, columns, platform, facade
    nx0, nx1 = 330, 750
    nich = arch(nx0, 902, nx1 - nx0, 420)
    p.cell(arch(nx0 - 20, 910, nx1 - nx0 + 40, 440), 'ivory', 5.5)
    p.cell(nich, 'lapis', 6)
    lattice(p, nich, nx0, 480, nx1, 902, sp=52, w=2.6, dot='pearl', dot_r=5)
    p.wire(arch(nx0 + 14, 902, nx1 - nx0 - 28, 394), 3.5)
    for sd, x0 in ((-1, nx0 - 52), (1, nx1 + 12)):          # columns with gold capitals
        p.cell(rect(x0, 600, 40, 306, 4), 'ivory', 5)
        wires(p, [[(x0 + 10 * k, 612), (x0 + 10 * k, 896)] for k in (1, 2, 3)], 2.2)
        p.gold(rect(x0 - 8, 580, 56, 28, 5), .85, 'hammered')
        p.wire(rect(x0 - 8, 580, 56, 28, 5), 3.5)
        p.cabochon(x0 + 20, 566, 10, 'saffron')
    val = path([(nx0 - 70, 560), (nx1 + 70, 560), (nx1 + 70, 596)] +
               [((nx1 + 70) - (i + .5) * (nx1 - nx0 + 140) / 10, 628, (nx1 + 70) - (i + 1) * (nx1 - nx0 + 140) / 10, 596) for i in range(10)])
    p.cell(val, 'oxblood', 5)
    for i in range(10):
        p.cabochon((nx1 + 70) - (i + .5) * (nx1 - nx0 + 140) / 10, 604, 5.5, 'saffron')
    p.cell(rect(-520, 902, 2120, 38, 0), 'ivory', 5.5)
    p.cell(rect(nx0 - 20, 902, nx1 - nx0 + 40, 38, 0), 'oxblood', 5)
    wires(p, [[(nx0 + 6, 912), (nx1 - 6, 912)], [(nx0 + 6, 930), (nx1 - 6, 930)]], 2.6)
    p.cell(rect(-520, 940, 2120, 90, 0), 'sand', 5.5)
    for x in range(-500, 1600, 60):
        p.cabochon(x, 985, 9, 'lapis' if (x // 60) % 2 else 'jade')
    p.cell(rect(-520, 1030, 2120, 700, 0), 'ivory', 5.5)
    stonework(p, rect(-520, 1030, 2120, 700, 0), -520, 1030, 1600, 1700, row=40, col=110)
    for k in range(-6, 12):
        ax = -480 + k * 190 + 100
        if not vis(fmt, ax, 1050, ax + 150, 1500, 20):
            continue
        p.cell(arch(ax, 1480, 150, 360), 'oxblood', 5.5)
        p.cell(arch(ax + 18, 1480, 114, 300), 'onyx', 4)
        wires(p, [[(ax + 18 + 19 * j, 1480), (ax + 18 + 19 * j, 1200)] for j in range(1, 6)], 2.8)
        p.cabochon(ax + 75, 1130, 12, 'saffron')
    p.cell(rect(-520, 1040, 2120, 22, 0), 'oxblood', 4.5)
    return dict(box_floor=(540, 902), prone=[(395, 880), (685, 880)], necks=[(470, 862), (610, 862)],
                emperor_feet=(540, 858), spina=(cx, cy), track_centre=(cx, cy))


# =========================================================== 6. names scroll
_GW = (18, 20, 24, 22, 26, 10, 20, 26)


def _glyph(kind, x, y, s):
    """One invented glyph as a list of open point lists; baseline y, pen x, scale s."""
    if kind == 0:
        return [[(x, y), (x + 2 * s, y - 30 * s)], [(x + 2 * s, y - 30 * s), (x + 16 * s, y - 34 * s, x + 14 * s, y - 20 * s)]]
    if kind == 1:
        return [[(x, y), (x + 9 * s, y - 30 * s, x + 18 * s, y)]]
    if kind == 2:
        return [[(x, y), (x + 6 * s, y - 24 * s, x + 11 * s, y), (x + 17 * s, y - 24 * s, x + 22 * s, y)]]
    if kind == 3:
        return [[(x + 2 * s, y), (x - 6 * s, y - 36 * s, x + 20 * s, y - 36 * s, x + 14 * s, y - 4 * s), (x + 20 * s, y)]]
    if kind == 4:
        return [[(x, y - 4 * s), (x + 6 * s, y - 26 * s, x + 12 * s, y - 13 * s), (x + 18 * s, y, x + 24 * s, y - 20 * s)]]
    if kind == 5:
        return [[(x + 4 * s, y), (x + 4 * s, y - 20 * s)], [(x + 4 * s, y - 31 * s), (x + 4.3 * s, y - 31 * s)]]
    if kind == 6:
        return [[(x + 10 * s, y - 22 * s), (x + 10 * s, y + 12 * s)], [(x + 10 * s, y + 12 * s), (x + 4 * s, y + 21 * s, x, y + 11 * s)],
                [(x + 2 * s, y - 14 * s), (x + 18 * s, y - 14 * s)]]
    return [[(x, y), (x + 6 * s, y - 26 * s), (x + 12 * s, y - 4 * s), (x + 18 * s, y - 26 * s), (x + 24 * s, y)]]


def _name_line(idx, x0, y):
    """Deterministic 'written' name: segs list and the x where it ends."""
    segs = []
    x = x0
    nwords = 2 + (hsh(idx, 1) % 2)
    budget = 12
    for w in range(nwords):
        ng = 3 + hsh(idx, w, 2) % 4
        ng = min(ng, budget - 2 * (nwords - w - 1))
        if ng < 2:
            ng = 2
        budget -= ng
        for g in range(ng):
            kind = hsh(idx, w, g, 3) % 8
            s = 1.32 if g == 0 else 1.02 + hf(idx, w, g, 7) * .22
            segs += _glyph(kind, x, y + 8, s)
            x += _GW[kind] * s + 7
        x += 22
    return segs, x


def _lampstand(p, x, yb, h, t, ph=0.):
    """Gold floor lamp with three flames; stands on y=yb (landscape side decoration)."""
    p.gold(ellipse(x, yb - 6, 54, 14), .85, 'hammered')
    p.wire(ellipse(x, yb - 6, 54, 14), 4)
    stem = path([(x - 9, yb - 10), (x - 6, yb - h), (x + 6, yb - h), (x + 9, yb - 10)])
    p.gold(stem, .8, 'hammered')
    p.wire(stem, 3.5)
    for yy in (yb - h * .25, yb - h * .5, yb - h * .75):
        p.cabochon(x, yy, 9, 'lapis')
    for sd in (-1, 0, 1):
        ax = x + sd * 52
        ay = yb - h - (0 if sd == 0 else 20)
        if sd:
            p.wire(path([(x, yb - h + 6), (x + sd * 30, yb - h + 30, ax, ay + 10)], False), 4)
        cup = path([(ax - 18, ay - 4), (ax + 18, ay - 4), (ax + 10, ay + 14), (ax - 10, ay + 14)])
        p.gold(cup, .85)
        p.wire(cup, 3)
        _flame(p, ax, ay - 6, t, ph + sd * 1.3, 1.25)


def names_scroll(p, t, fmt, unroll=0., struck=0., ground=True):
    """Ivory scroll of wire-written names between gold rollers (s8, second half; oxblood scroll ground).

    unroll  scroll travel in LINES (float): the list moves up under the top roller and new names keep
            arriving from below, forever (line index = n is always the same invented name).
    struck  number of lines struck through, counted from line 0 (float: the fractional part is the strike
            currently wire-drawing, so struck=6.4 means six done and a seventh 40 % drawn). With unroll=0
            lines 0..14 are visible, so struck=14 strikes 14 of them.
    ground  True  draw the oxblood scroll ground first.
    Anchors: sheet=(x0, y0, x1, y1), line_h=56, lines=[(index, y, struck_fraction)] for visible lines,
    top_roller_y, bottom_roller_y.
    """
    if ground:
        p.ground('scroll', 'oxblood')
    sx0, sx1, sy0, sy1 = 190, 890, 104, 966
    lh = 56
    for (lx, lph) in ((-170, 0.), (1250, 2.1)):
        if vis(fmt, lx - 90, 300, lx + 90, 1000, 10):
            _lampstand(p, lx, 1000, 620, t, lph)
    # ---- backing panel, cords, hanging seal (extra height matters in portrait)
    panel = rect(70, -300, 940, 1930, 40)
    p.cell(panel, 'lapis', 6)
    lattice(p, panel, 70, -300, 1010, 1630, sp=86, w=2.6, dot='pearl', dot_r=5)
    p.wire(rect(94, -276, 892, 1882, 28), 3.5)
    p.beads(rect(94, -276, 892, 1882, 28), 22, 3.2)
    for sd in (-1, 1):
        xk = 540 + sd * 400
        p.wire(path([(xk, 70), (540 + sd * 70, -180)], False), 4)
        p.wire(path([(xk + sd * 8, 70), (540 + sd * 78, -180)], False), 2)
    p.gold(ellipse(540, -214, 44), .85, 'hammered')
    p.wire(ellipse(540, -214, 44), 4.5)
    p.cabochon(540, -214, 20, 'oxblood')
    p.wire(ellipse(540, -214, 26), 2.4)
    for k in range(10):
        a = k * TAU / 10 + t * .06
        p.wire(path([(540 + 52 * math.cos(a), -214 + 52 * math.sin(a)), (540 + 76 * math.cos(a), -214 + 76 * math.sin(a))], False), 3.5)
    # ---- the sheet
    sheet = rect(sx0, sy0, sx1 - sx0, sy1 - sy0, 6)
    p.cell(sheet, 'ivory', 5.5)
    p.wire(rect(sx0 + 20, sy0 + 26, sx1 - sx0 - 40, sy1 - sy0 - 52, 8), 3.5)
    p.wire(rect(sx0 + 28, sy0 + 34, sx1 - sx0 - 56, sy1 - sy0 - 68, 6), 1.8)
    for yy in (sy0 + 14, sy1 - 14):
        p.beads(path([(sx0 + 14, yy), (sx1 - 14, yy)], False), 20, 2.6)
    inner = rect(sx0 + 34, sy0 + 40, sx1 - sx0 - 68, sy1 - sy0 - 80, 4)
    # ---- the lines, clipped inside the sheet
    out_lines = []
    first = int(math.floor(unroll)) - 1
    strike_jobs = []
    with p.clip(inner):
        for i in range(first, first + 20):
            if i < 0:
                continue
            y = sy0 + 74 + (i - unroll) * lh
            if y < sy0 - 20 or y > sy1 + 20:
                continue
            c = ('oxblood', 'lapis', 'jade', 'saffron')[hsh(i, 99) % 4]
            p.cabochon(sx0 + 62, y - 6, 8, c)
            segs, xe = _name_line(i, sx0 + 96, y)
            wires(p, segs, 3.8)
            for k in range(1 + hsh(i, 5) % 4):
                p.wire(path([(sx1 - 78 + k * 12, y - 20), (sx1 - 78 + k * 12, y + 6)], False), 3)
            fr = clamp(struck - i)
            out_lines.append((i, y, fr))
            if fr > 0:
                strike_jobs.append((i, y, fr, xe))
        for (i, y, fr, xe) in strike_jobs:
            wob = (hf(i, 11) - .5) * 8
            x_a, x_b = sx0 + 44, max(xe + 20, sx0 + 330) if hsh(i, 12) % 3 else sx1 - 60
            sp = path([(x_a, y - 5 + wob), ((x_a + x_b) / 2, y - 12 - wob, x_b, y - 5 - wob * .5)], False)
            p.wire(sp, 8.5, fr)
    # paper curling into the rollers
    for (yy, up) in ((sy0, 1), (sy1 - 20, 0)):
        p.cell(rect(sx0 + 2, yy, sx1 - sx0 - 4, 20, 4), 'sand', 4)
        p.wire(path([(sx0 + 8, yy + (14 if up else 5)), (sx1 - 8, yy + (14 if up else 5))], False), 2)
    # ---- rollers: gold plate cylinders with ratchet lines that turn with the unroll
    for (ry, name) in ((80, 'top'), (990, 'bottom')):
        r = rect(138, ry - 26, 804, 52, 26)
        p.gold(r, .9, 'hammered')
        p.wire(r, 5)
        ph = unroll * 56 * (1 if name == 'top' else -1)
        with p.clip(rect(176, ry - 24, 728, 48, 10)):
            wires(p, [[(x + ((ph * .8) % 40), ry - 24), (x + ((ph * .8) % 40) + 22, ry + 24)] for x in range(150, 920, 40)], 2.6)
        for ex in (118, 962):
            p.gold(ellipse(ex, ry, 30), .9)
            p.wire(ellipse(ex, ry, 30), 4.5)
            p.cabochon(ex, ry, 19, 'oxblood' if name == 'top' else 'lapis')
            p.glint(ex - 6, ry - 7, 10, .8)
        p.cell(rect(176, ry - 31, 10, 62, 4), 'oxblood', 3)
        p.cell(rect(894, ry - 31, 10, 62, 4), 'oxblood', 3)
    # ---- hanging seal and tassels below the lower roller (portrait only shows them)
    for sd in (-1, 1):
        bx = 540 + sd * 140
        p.wire(path([(bx, 1014), (bx, 1160)], False), 3.5)
        p.cell(path([(bx - 22, 1160), (bx + 22, 1160), (bx + 30, 1262), (bx - 30, 1262)]), 'oxblood', 4.5)
        wires(p, [[(bx - 24 + 8 * k, 1170), (bx - 28 + 11 * k, 1262)] for k in range(1, 5)], 2.4)
        p.cabochon(bx, 1160, 12, 'saffron')
    p.wire(path([(540, 1014), (540, 1140)], False), 4)
    p.gold(ellipse(540, 1196, 66), .85, 'hammered')
    p.wire(ellipse(540, 1196, 66), 5)
    p.cabochon(540, 1196, 44, 'oxblood')
    for k in range(12):
        a = k * TAU / 12
        p.cabochon(540 + 56 * math.cos(a), 1196 + 56 * math.sin(a), 4.5, 'pearl')
    p.wire(path([(520, 1196), (560, 1196)], False), 4)
    p.wire(path([(540, 1176), (540, 1216)], False), 4)
    return dict(sheet=(sx0, sy0, sx1, sy1), line_h=lh, lines=out_lines, top_roller_y=80, bottom_roller_y=990)


# ================================================================ 7. spears
def _spear(p, t, i):
    """One spear drawn in its own frame: tip at the origin pointing +x, shaft trailing along -x."""
    blade = path([(0, 0), (-34, -16, -64, -14), (-90, -12, -98, -4), (-98, 4), (-90, 12, -64, 14), (-34, 16, 0, 0)])
    w = math.sin(t * 4.2 + i * 1.3) * 5
    # pennon first (behind the blade)
    pen = path([(-176, -5), (-216, -26 + w, -272, -14 + w * 1.3), (-252, 2 + w), (-278, 18 + w * 1.4), (-216, 24 + w, -176, 5)])
    shaft = rect(-1900, -7, 1760, 14, 6)
    p.cell(shaft, 'lapis', 4.5)
    with p.clip(shaft):
        wires(p, [[(x, -7), (x + 12, 7)] for x in range(-1900, -140, 22)], 2.2)
    for x in (-170, -420, -740, -1060, -1380):
        p.gold(rect(x - 6, -10, 12, 20, 3), .85)
        p.wire(rect(x - 6, -10, 12, 20, 3), 2.4)
    p.cell(pen, 'oxblood', 3.5)
    wires(p, [[(-180, 0), (-220, -2 + w * .7, -262, 4 + w)]], 2.2)
    p.gold(rect(-132, -10, 36, 20, 4), .85)
    p.wire(rect(-132, -10, 36, 20, 4), 3)
    p.cell(blade, 'pearl', 4.5)
    p.wire(path([(-6, 0), (-92, 0)], False), 2.6)
    p.cabochon(-114, 0, 4, 'oxblood')


def spears(p, t, fmt, advance=1., aim=(540, 470), final=330):
    """Spear tips and shafts converge on `aim` from the left, right and top (s9, over the gold-ground bust).

    advance  0..1  0 = every tip just outside the visible frame of this format (nothing shows);
                   1 = tips ring the target at distance `final` (outside the halo). Values a little
                   above 1 overshoot, so feeding it tick() gives a snap.
    aim, final   the point the spears converge on and the stand-off distance of the tips.
    No ground is drawn: call after the bust. Anchors: aim, tips (list of current tip positions).
    """
    x0, y0, x1, y1 = fmt.rect
    ax, ay = aim
    plan = [(150 + 20 * k, 0 if 150 + 20 * k < 210 else 2 if 150 + 20 * k < 330 else 1) for k in range(13)]
    tips = []
    for i, (al, side) in enumerate(plan):
        r = math.radians(al)
        ux, uy = math.cos(r), math.sin(r)               # from aim, toward where the butt end is
        tx = ((x1 - ax) / ux if ux > 1e-6 else (x0 - ax) / ux if ux < -1e-6 else 1e9)
        ty = ((y1 - ay) / uy if uy > 1e-6 else (y0 - ay) / uy if uy < -1e-6 else 1e9)
        d_out = min(tx, ty) + 8
        d_fin = final + 34 * ((i % 3) - 1) + (12 if side == 2 else 0)
        d = lerp(d_out, d_fin, advance)
        lat = ((i * 7) % 5 - 2) * 14
        px, py = -uy * lat, ux * lat
        tip = (ax + ux * d + px, ay + uy * d + py)
        tips.append(tip)
        with p.transform(translate=tip, rotate=al + 180, pivot=(0, 0)):
            _spear(p, t, i)
    return dict(aim=aim, tips=tips)
