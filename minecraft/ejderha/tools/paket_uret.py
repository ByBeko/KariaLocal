#!/usr/bin/env python3
"""
KariaEjderha kaynak paketi üreteci (v2).

- Ejderha modeli: 4 parça (gövde, baş, sol/sağ kanat), aynı model uzayında. İleri yön +Z, model merkezi (8,8,8).
- Doku: her eleman yüzü atlas üzerinde KENDİ boyutunda bir alan alır (1 model birimi = 1 piksel), böylece desen
  esnemez. Alanlar malzemeye göre (pul, sırt, karın, zar, diken, boynuz, göz, ağız) piksel piksel boyanır.
- Simgeler (yumurta, pul, Viking eşyaları) ve Viking zırh dokusu da burada çizilir.

Kullanım: python paket_uret.py <turler.json> <cikti_klasoru>
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw

ATLAS = 128  # piksel; model UV'si 0..16 uzayında -> ölçek ATLAS/16


# ================================================================ renk yardımcıları

def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def shade(c, f):
    return tuple(max(0, min(255, int(round(v * f)))) for v in c)


def hue_shift(c, warm):
    """Gölgeleri biraz soğuk/sıcak yap (düz karartmadan daha canlı durur)."""
    r, g, b = c
    if warm > 0:
        return (min(255, int(r + warm * 18)), g, max(0, int(b - warm * 10)))
    return (max(0, int(r + warm * 12)), g, min(255, int(b - warm * 22)))


def ramp(base, t):
    """t: -1 (en koyu) .. +1 (en açık). Gölgeler hafif soğuk, ışıklar hafif sıcak."""
    if t >= 0:
        return hue_shift(shade(base, 1 + 0.35 * t), 0.5 * t)
    return hue_shift(shade(base, 1 + 0.45 * t), 0.6 * t)


# ================================================================ geometri

def box(frm, to, side='ana', up=None, down=None, front=None, back=None, east=None, west=None):
    """Eleman: yüz başına malzeme. Varsayılan: yanlar 'ana', üst 'sirt', alt 'karin'."""
    mats = {'north': back or side, 'south': front or side, 'east': east or side, 'west': west or side,
            'up': up or ('sirt' if side == 'ana' else side), 'down': down or ('karin' if side == 'ana' else side)}
    return {'from': list(frm), 'to': list(to), 'mats': mats}


def mirror_x(e):
    f, t = e['from'], e['to']
    m = dict(e['mats'])
    m['east'], m['west'] = e['mats']['west'], e['mats']['east']
    return {'from': [16 - t[0], f[1], f[2]], 'to': [16 - f[0], t[1], t[2]], 'mats': m}


def body_elements():
    e = []
    # gövde: kalça - karın - göğüs (öne doğru kalınlaşır)
    e.append(box([4.5, 6.5, -1], [11.5, 12, 3]))                 # kalça
    e.append(box([4, 6, 2], [12, 12.5, 10]))                     # karın
    e.append(box([3.5, 6.5, 8.5], [12.5, 13.5, 14.5]))           # göğüs
    e.append(box([5, 5.5, 3], [11, 6, 10], side='karin'))        # karın altı plakası
    # bacaklar (sol taraf; sağ taraf aynalanır)
    leg = [
        box([2.6, 6, 9], [5.6, 11.5, 13.5]),                     # omuz
        box([3, 2, 10], [5.4, 7, 12.6]),                         # ön kol
        box([2.8, 0, 10], [5.6, 2, 13.4], up='ana', down='koyu'),  # ön ayak
        box([2.6, 4.5, -0.5], [6, 11.5, 5]),                     # kalça kası (uyluk)
        box([3, 1.5, 0], [5.4, 5.5, 3]),                         # incik
        box([2.8, 0, 0.2], [5.6, 1.5, 4.2], up='ana', down='koyu'),  # arka ayak
    ]
    for x in (3.0, 4.5):                                         # pençeler
        leg.append(box([x - 0.3, 0, 13.4], [x + 0.3, 0.7, 14.4], side='boynuz'))
        leg.append(box([x - 0.3, 0, 4.2], [x + 0.3, 0.6, 5.0], side='boynuz'))
    for l in leg:
        e.append(l)
        e.append(mirror_x(l))
    # kuyruk (incelen dört parça)
    e.append(box([5.5, 7.5, -6], [10.5, 11.5, -1]))
    e.append(box([6.3, 8, -10.5], [9.7, 11, -6]))
    e.append(box([7, 8.6, -14], [9, 10.4, -10.5]))
    e.append(box([4.8, 9.2, -16], [11.2, 9.8, -13], side='zar'))   # kuyruk yüzgeci
    # sırt dikenleri (kuyruğa doğru küçülür)
    for z, h in ((12, 15.6), (9, 15.9), (6, 15.5), (3, 14.8), (0, 14.0)):
        e.append(box([7.5, 12.4, z], [8.5, h, z + 1.6], side='diken'))
    for z, y0, h in ((-4.5, 11.4, 13.0), (-9, 10.9, 12.2), (-13, 10.3, 11.3)):
        e.append(box([7.6, y0, z], [8.4, h, z + 1.4], side='diken'))
    return e


def head_elements():
    e = []
    e.append(box([6, 10, 13], [10, 14, 17]))                     # boyun 1
    e.append(box([6.5, 12, 16], [9.5, 16, 19.5]))                # boyun 2
    e.append(box([6.8, 14, 18.5], [9.2, 17.5, 21]))              # boyun 3
    e.append(box([5.5, 15, 20], [10.5, 19.5, 25.5]))             # kafatası
    e.append(box([6.3, 15.4, 25], [9.7, 18.3, 29.5], front='burun'))  # burun
    e.append(box([6.6, 14, 21.5], [9.4, 15.4, 29], up='agiz'))   # alt çene
    e.append(box([5.2, 18.4, 22.8], [10.8, 19.3, 24.6], side='diken'))  # kaş çıkıntısı
    # gözler (yanlarda, parlak)
    e.append(box([5.35, 16.4, 22.6], [5.55, 18.0, 24.6], side='goz'))
    e.append(box([10.45, 16.4, 22.6], [10.65, 18.0, 24.6], side='goz'))
    # boynuzlar: geriye kıvrık
    for horn in ([box([5.8, 18.6, 19.5], [7.0, 19.8, 22], side='boynuz'),
                  box([6.0, 19.2, 17.4], [6.8, 20.2, 19.6], side='boynuz'),
                  box([6.1, 19.9, 16.0], [6.6, 20.8, 17.5], side='boynuz')]):
        e.append(horn)
        e.append(mirror_x(horn))
    # ense dikenleri
    for z, y0, h in ((19, 17.5, 19.6), (16.5, 15.8, 17.6), (14, 13.8, 15.6)):
        e.append(box([7.6, y0, z], [8.4, h, z + 1.2], side='diken'))
    return e


def wing_elements(left):
    e = [
        box([12, 13, 9], [18, 14.4, 11], up='ana', down='karin'),          # kol kemiği
        box([17.5, 13.2, 8.5], [25, 14.2, 10.2], up='ana', down='karin'),  # ön kol
        box([24.5, 13.0, 9.6], [26.8, 14.2, 11.4], side='boynuz'),         # bilek pençesi
        # parmak kemikleri (zarın üstünde, geriye uzanır)
        box([24.2, 13.6, 0.5], [25.2, 14.1, 9], side='kemik'),
        box([20.6, 13.6, -1.5], [21.6, 14.1, 9], side='kemik'),
        box([16.8, 13.6, -3.0], [17.8, 14.1, 9], side='kemik'),
        # kademeli zar
        box([12, 13.35, 0.5], [26, 13.65, 9], side='zar'),
        box([12, 13.35, -1.5], [21.6, 13.65, 0.5], side='zar'),
        box([12, 13.35, -3.0], [17.8, 13.65, -1.5], side='zar'),
        box([12, 13.35, -4.0], [14.5, 13.65, -3.0], side='zar'),
    ]
    return e if left else [mirror_x(x) for x in e]


PARTS = {
    'govde': body_elements,
    'bas': head_elements,
    'kanat_sol': lambda: wing_elements(True),
    'kanat_sag': lambda: wing_elements(False),
}


# ================================================================ UV atlası

def face_size(fn, f, t):
    if fn in ('north', 'south'):
        return t[0] - f[0], t[1] - f[1]
    if fn in ('east', 'west'):
        return t[2] - f[2], t[1] - f[1]
    return t[0] - f[0], t[2] - f[2]


def build_atlas():
    """Tüm parçaların elemanlarını üretir ve her yüze atlas alanı atar. Dönüş: (parts, rects)"""
    parts = {name: fn() for name, fn in PARTS.items()}
    reqs = {}
    for name, els in parts.items():
        for e in els:
            e['faces'] = {}
            for fn, mat in e['mats'].items():
                w, h = face_size(fn, e['from'], e['to'])
                tw, th = max(1, int(round(w))), max(1, int(round(h)))
                key = (mat, fn in ('up', 'down'), tw, th)
                reqs.setdefault(key, []).append((e, fn))
    # raf yerleşimi (yüksekten alçağa)
    rects = {}
    x = y = shelf = 0
    for key in sorted(reqs, key=lambda k: (-k[3], -k[2])):
        tw, th = key[2], key[3]
        if x + tw > ATLAS:
            x, y, shelf = 0, y + shelf, 0
        if y + th > ATLAS:
            raise SystemExit('Atlas doldu; ATLAS değerini büyüt')
        rects[key] = (x, y, tw, th)
        x += tw
        shelf = max(shelf, th)
    k = 16.0 / ATLAS
    for key, uses in reqs.items():
        rx, ry, tw, th = rects[key]
        for e, fn in uses:
            e['faces'][fn] = {'uv': [round(rx * k, 4), round(ry * k, 4), round((rx + tw) * k, 4), round((ry + th) * k, 4)],
                              'texture': '#skin', 'mat': key[0]}
    return parts, rects


# ================================================================ boyama

def paint_rect(px, rect, mat, top, col, rnd, desen='duz'):
    rx, ry, w, h = rect
    ana, karin, koyu, zar = hx(col['ana']), hx(col['karin']), hx(col['koyu']), hx(col['zar'])
    goz, boynuz = hx(col['goz']), hx(col['boynuz'])
    aksan = hx(col.get('aksan', col['koyu']))
    sirt = mix(ana, koyu, 0.3)
    spots = set()
    if desen == 'benek' and mat in ('ana', 'sirt'):
        for _ in range(w * h // 22):
            spots.add((rnd.randrange(w), rnd.randrange(h)))

    def put(x, y, c):
        px[rx + x, ry + y] = tuple(c) + (255,)

    for y in range(h):
        for x in range(w):
            n = rnd.uniform(-0.04, 0.04)
            g = (0.25 - 0.5 * y / max(1, h - 1)) if not top else 0.1   # yanlarda üst açık, alt koyu
            if mat in ('ana', 'sirt'):
                base = ana if mat == 'ana' else sirt
                row = y // 2
                cx = (x + (1 if row % 2 else 0)) % 3
                t = g + n
                if y % 2 == 1 and cx != 1:
                    t -= 0.35                                   # pul alt kenarı
                elif y % 2 == 0 and cx == 1:
                    t += 0.25                                   # pul parlaması
                if mat == 'sirt' and w >= 3 and x == w // 2:
                    t -= 0.15                                   # sırt çizgisi
                c = base
                if desen == 'serit' and ((not top and x % 4 == 0 and y < h * 0.4) or (top and y % 4 == 0 and w > 2)):
                    c = mix(base, aksan, 0.45)                  # sırttan inen ince şeritler
                if (x, y) in spots:
                    c = mix(base, aksan, 0.5)
                put(x, y, ramp(c, t))
            elif mat == 'karin':
                t = 0.12 + n - (0.16 if y % 2 == 1 else 0) - (0.08 if x % 4 == 0 else 0)
                put(x, y, ramp(karin, t))
            elif mat == 'diken':
                t = -0.2 + 0.7 * (1 - y / max(1, h - 1)) + n if not top else 0.3
                put(x, y, ramp(mix(koyu, boynuz, 0.15), t))
            elif mat == 'kemik':
                put(x, y, ramp(mix(ana, koyu, 0.45), 0.1 + n))
            elif mat == 'zar':
                t = 0.08 + n + (-0.14 if (x % 4 == 0) else 0) + (-0.2 if (x == 0 or x == w - 1 or y == 0 or y == h - 1) and min(w, h) > 2 else 0)
                put(x, y, ramp(zar, t))
            elif mat == 'boynuz':
                t = 0.35 - 0.6 * (y / max(1, h - 1)) + n if not top else 0.4
                put(x, y, ramp(boynuz, t))
            elif mat == 'goz':
                if w >= 2 and x == w // 2:
                    put(x, y, (18, 12, 10))
                else:
                    put(x, y, ramp(goz, 0.4 - 0.4 * y / max(1, h - 1)))
            elif mat == 'agiz':
                if y == 0 and x % 2 == 0:
                    put(x, y, (242, 236, 214))                  # dişler
                else:
                    put(x, y, (96, 26, 24) if y > 0 else (70, 18, 18))
            elif mat == 'burun':
                if h >= 2 and y == 0 and (x == 0 or x == w - 1):
                    put(x, y, shade(koyu, 0.6))                 # burun delikleri
                else:
                    put(x, y, ramp(ana, g + n))
            else:
                put(x, y, ramp(ana, n))


def make_skin(col, rects, seed, desen='duz'):
    rnd = random.Random(seed)
    img = Image.new('RGBA', (ATLAS, ATLAS), (0, 0, 0, 0))
    px = img.load()
    for (mat, top, tw, th), rect in rects.items():
        paint_rect(px, rect, mat, top, col, rnd, desen)
    return img


# ================================================================ 16x16 simgeler

OUT = (28, 20, 16, 255)


def outline(img):
    w, h = img.size
    src = img.copy()
    p, s = img.load(), src.load()
    for y in range(h):
        for x in range(w):
            if s[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and s[nx, ny][3] > 0 and s[nx, ny] != OUT:
                        p[x, y] = OUT
                        break
    return img


def canvas():
    return Image.new('RGBA', (16, 16), (0, 0, 0, 0))


def rgba(c): return tuple(c) + (255,)


WOOD, WOOD_L, WOOD_D = (112, 74, 40), (156, 108, 60), (78, 50, 28)
IRON, IRON_D, IRON_L = (196, 202, 210), (118, 126, 138), (240, 244, 248)
LEATHER, LEATHER_L, LEATHER_D = (124, 76, 40), (164, 108, 62), (86, 52, 28)
FUR, FUR_D = (222, 210, 186), (168, 150, 122)
GOLD, GOLD_D = (232, 186, 70), (170, 120, 40)
BONE, BONE_D = (234, 222, 196), (182, 166, 134)
CYAN, CYAN_D, CYAN_L = (120, 214, 245), (52, 140, 180), (214, 248, 255)


def icon_axe():
    im = canvas(); d = ImageDraw.Draw(im)
    for i in range(10):                                      # sap (çapraz)
        d.point((2 + i, 13 - i), fill=rgba(WOOD_L if i % 3 else WOOD))
        d.point((3 + i, 13 - i), fill=rgba(WOOD_D))
    d.point((2, 14), fill=rgba(IRON_D)); d.point((3, 14), fill=rgba(IRON_D))
    d.polygon([(8, 2), (11, 0), (15, 2), (15, 7), (12, 8), (10, 6)], fill=rgba(IRON))
    d.line([(14, 1), (15, 6)], fill=rgba(IRON_L))
    d.line([(10, 3), (11, 6)], fill=rgba(IRON_D))
    d.point((12, 4), fill=rgba(IRON_D))
    return outline(im)


def icon_hammer():
    im = canvas(); d = ImageDraw.Draw(im)
    for i in range(8):
        d.point((2 + i, 13 - i), fill=rgba(WOOD_L if i % 3 else WOOD))
        d.point((3 + i, 13 - i), fill=rgba(WOOD_D))
    d.polygon([(6, 4), (10, 0), (15, 5), (11, 9)], fill=rgba(IRON_D))
    d.polygon([(7, 4), (10, 1), (14, 5), (11, 8)], fill=rgba(IRON))
    d.line([(10, 1), (14, 5)], fill=rgba(IRON_L))
    d.line([(8, 5), (11, 2)], fill=rgba(GOLD))                 # bant
    return outline(im)


def icon_sword():
    im = canvas(); d = ImageDraw.Draw(im)
    for i in range(9):                                      # bıçak
        d.point((5 + i, 10 - i), fill=rgba(CYAN))
        d.point((6 + i, 10 - i), fill=rgba(CYAN_D))
        d.point((5 + i, 9 - i), fill=rgba(CYAN_L))
    d.point((14, 1), fill=rgba(CYAN_L))
    d.line([(2, 8), (7, 13)], fill=rgba(GOLD))               # balçak
    d.point((4, 10), fill=rgba(GOLD_D))
    d.line([(2, 13), (4, 11)], fill=rgba(LEATHER), width=2)  # kabza
    d.point((1, 14), fill=rgba(GOLD))
    return outline(im)


def icon_saddle():
    im = canvas(); d = ImageDraw.Draw(im)
    d.ellipse([1, 4, 14, 11], fill=rgba(LEATHER))
    d.ellipse([3, 4, 12, 8], fill=rgba(LEATHER_L))
    d.line([(4, 5), (11, 5)], fill=rgba((196, 140, 84)))
    d.line([(2, 9), (13, 9)], fill=rgba(LEATHER_D))
    d.line([(4, 10), (4, 13)], fill=rgba(LEATHER_D)); d.line([(11, 10), (11, 13)], fill=rgba(LEATHER_D))
    d.rectangle([3, 13, 5, 14], fill=rgba(IRON)); d.rectangle([10, 13, 12, 14], fill=rgba(IRON))
    d.point((7, 6), fill=rgba(GOLD)); d.point((8, 6), fill=rgba(GOLD))
    return outline(im)


def icon_whistle():
    im = canvas(); d = ImageDraw.Draw(im)
    pts = [(3, 12), (5, 10), (7, 8), (9, 6), (11, 4), (12, 3)]
    for i, (x, y) in enumerate(pts):
        r = 0.6 + i * 0.35
        d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(BONE))
    for i, (x, y) in enumerate(pts[:-1]):
        d.point((x + 1, y + 1), fill=rgba(BONE_D))
    d.ellipse([10.5, 1.5, 14, 5], fill=rgba(BONE_D))
    d.ellipse([11.5, 2.5, 13, 4], fill=rgba((90, 70, 50)))
    d.point((2, 13), fill=rgba(WOOD))
    d.line([(6, 9), (7, 10)], fill=rgba(GOLD))
    return outline(im)


def icon_wheel():
    im = canvas(); d = ImageDraw.Draw(im)
    for a in range(8):
        t = a * math.pi / 4
        d.line([(7.5, 7.5), (7.5 + math.cos(t) * 7.4, 7.5 + math.sin(t) * 7.4)], fill=rgba(WOOD_L), width=1)
    d.ellipse([2, 2, 13, 13], outline=rgba(WOOD), width=2)
    d.arc([2, 2, 13, 13], 200, 290, fill=rgba(WOOD_L))
    d.ellipse([6, 6, 9, 9], fill=rgba(IRON_D))
    d.point((7, 7), fill=rgba(IRON_L))
    return outline(im)


def icon_helmet():
    im = canvas(); d = ImageDraw.Draw(im)
    d.pieslice([3, 3, 12, 15], 180, 360, fill=rgba(IRON))
    d.rectangle([3, 9, 12, 11], fill=rgba(IRON_D))
    d.rectangle([7, 9, 8, 13], fill=rgba(IRON))
    d.line([(5, 5), (7, 4)], fill=rgba(IRON_L))
    for x in (4, 6, 9, 11):
        d.point((x, 10), fill=rgba(IRON_L))
    for side in (0, 1):                                     # boynuzlar
        xs = [2, 1, 1, 2] if side == 0 else [13, 14, 14, 13]
        for i, y in enumerate((8, 6, 4, 2)):
            d.point((xs[i], y), fill=rgba(BONE))
            d.point((xs[i] + (1 if side == 0 else -1), y + 1), fill=rgba(BONE_D))
    return outline(im)


def icon_chest():
    im = canvas(); d = ImageDraw.Draw(im)
    d.polygon([(2, 2), (6, 2), (8, 4), (10, 2), (14, 2), (14, 6), (12, 6), (12, 14), (4, 14), (4, 6), (2, 6)], fill=rgba(LEATHER))
    for y in range(7, 13):
        for x in range(5, 12):
            if (x + y) % 2 == 0:
                d.point((x, y), fill=rgba(IRON_D))
            else:
                d.point((x, y), fill=rgba(IRON))
    d.line([(2, 2), (14, 2)], fill=rgba(FUR)); d.line([(2, 3), (6, 3)], fill=rgba(FUR_D)); d.line([(10, 3), (14, 3)], fill=rgba(FUR_D))
    d.line([(4, 13), (12, 13)], fill=rgba(LEATHER_D))
    d.point((8, 13), fill=rgba(GOLD))
    return outline(im)


def icon_legs():
    im = canvas(); d = ImageDraw.Draw(im)
    d.polygon([(3, 2), (13, 2), (13, 14), (9, 14), (8, 6), (7, 14), (3, 14)], fill=rgba(LEATHER))
    d.rectangle([3, 2, 13, 3], fill=rgba(LEATHER_D))
    d.point((8, 2), fill=rgba(GOLD))
    for y in (7, 10):
        d.line([(4, y), (6, y)], fill=rgba(IRON)); d.line([(10, y), (12, y)], fill=rgba(IRON))
    d.line([(4, 13), (6, 13)], fill=rgba(FUR)); d.line([(10, 13), (12, 13)], fill=rgba(FUR))
    return outline(im)


def icon_boots():
    im = canvas(); d = ImageDraw.Draw(im)
    for x0 in (2, 9):
        d.rectangle([x0, 6, x0 + 4, 12], fill=rgba(LEATHER))
        d.rectangle([x0 - (0 if x0 == 9 else 0), 12, x0 + 5 if x0 == 2 else x0 + 4, 14], fill=rgba(LEATHER_D))
        d.rectangle([x0, 4, x0 + 4, 6], fill=rgba(FUR))
        d.line([(x0, 6), (x0 + 4, 6)], fill=rgba(FUR_D))
        d.line([(x0, 9), (x0 + 4, 9)], fill=rgba(IRON))
    return outline(im)


def icon_egg(col, seed):
    rnd = random.Random(seed)
    ana, karin, koyu = hx(col['ana']), hx(col['karin']), hx(col['koyu'])
    im = canvas(); p = im.load()
    for y in range(16):
        for x in range(16):
            dx, dy = (x - 7.5) / 4.7, (y - 8.2) / (6.6 if y > 8 else 7.4)
            r = dx * dx + dy * dy
            if r <= 1:
                light = 0.35 - 0.55 * ((x - 5) / 10 + (y - 3) / 12)       # ışık sol üstten
                c = ramp(ana, max(-0.8, min(0.6, light)))
                if r > 0.75:
                    c = ramp(ana, light - 0.35)
                p[x, y] = rgba(c)
    for _ in range(9):                                       # benekler
        x, y = rnd.randint(4, 11), rnd.randint(3, 13)
        if p[x, y][3]:
            p[x, y] = rgba(mix(koyu, ana, 0.2))
    for x, y in ((5, 4), (5, 5), (6, 4)):
        p[x, y] = rgba(mix(karin, (255, 255, 255), 0.5))
    return outline(im)


def icon_scale(col):
    ana, karin = hx(col['ana']), hx(col['karin'])
    im = canvas(); p = im.load()
    for y in range(1, 15):
        if y <= 7:                                           # yuvarlak üst
            half = 5.5 * math.sqrt(max(0.0, 1 - ((7 - y) / 6.2) ** 2))
        else:                                                # sivri alt
            half = 5.5 * (14.6 - y) / 7.6
        for x in range(16):
            if abs(x - 7.5) <= half:
                t = 0.3 - (y / 15) * 0.6 - (x - 7.5) / 20
                if abs(x - 7.5) > half - 1:
                    t -= 0.35
                p[x, y] = rgba(ramp(ana, t))
    for y in range(3, 11):
        p[7, y] = rgba(ramp(mix(ana, karin, 0.4), 0.2))
    p[5, 3] = p[5, 4] = rgba((255, 255, 255))
    return outline(im)


# ================================================================ Viking zırh dokusu (64x32 insansı katman)

def armor_layer(leggings):
    rnd = random.Random(11 if leggings else 5)
    im = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    p = im.load()

    def fill(x0, y0, x1, y1, fn):
        for y in range(y0, y1):
            for x in range(x0, x1):
                c = fn(x - x0, y - y0, x1 - x0, y1 - y0)
                if c is not None:
                    p[x, y] = rgba(c)

    def iron(x, y, w, h):
        t = 0.15 - 0.4 * y / max(1, h - 1) + rnd.uniform(-0.05, 0.05)
        return ramp(IRON, t)

    def mail(x, y, w, h):                                   # zincir örgü
        return ramp(IRON_D, 0.25 if (x + y) % 2 == 0 else -0.15)

    def leather(x, y, w, h):
        return ramp(LEATHER, rnd.uniform(-0.08, 0.08) - (0.25 if y % 5 == 4 else 0))

    def fur(x, y, w, h):
        return ramp(FUR if (x * 3 + y) % 4 else FUR_D, rnd.uniform(-0.1, 0.1))

    if not leggings:
        # --- miğfer (kafa: 0..32 x 0..16)
        fill(8, 0, 16, 8, lambda x, y, w, h: ramp(IRON, 0.3 - 0.05 * abs(x - 3.5) + (-.3 if x in (3, 4) else 0)))  # tepe, orta sırt
        fill(16, 0, 24, 8, lambda x, y, w, h: ramp(IRON_D, -0.2))
        for x0 in (0, 8, 16, 24):                              # yan yüzler
            fill(x0, 8, x0 + 8, 16, lambda x, y, w, h: iron(x, y, w, h) if y < 5 else (ramp(GOLD, -0.1) if y == 5 else None))
        fill(8, 13, 16, 16, lambda x, y, w, h: None)
        for y in range(8, 15):                                  # burun koruması
            p[11, y] = rgba(ramp(IRON, 0.1)); p[12, y] = rgba(ramp(IRON_D, 0))
        for x in (9, 14):                                       # göz siperi kenarları
            p[x, 13] = rgba(IRON_D)
        for x0 in (0, 16, 24):                                  # perçinler
            for x in range(x0 + 1, x0 + 8, 3):
                p[x, 10] = rgba(IRON_L)
        # --- gövde (16..40 x 16..32)
        fill(16, 16, 40, 32, mail)
        fill(20, 16, 28, 20, fur); fill(28, 16, 36, 20, fur)   # üst / omuz kürkü
        fill(20, 20, 28, 23, fur); fill(32, 20, 40, 22, fur)
        fill(16, 20, 20, 22, fur); fill(28, 20, 32, 22, fur)
        fill(20, 28, 28, 30, lambda x, y, w, h: ramp(LEATHER_D, 0))  # kemer
        p[23, 28] = p[24, 28] = rgba(GOLD)
        fill(32, 28, 40, 30, lambda x, y, w, h: ramp(LEATHER_D, 0))
        fill(16, 28, 20, 30, lambda x, y, w, h: ramp(LEATHER_D, 0)); fill(28, 28, 32, 30, lambda x, y, w, h: ramp(LEATHER_D, 0))
        # --- kollar (40..56 x 16..32)
        fill(40, 16, 56, 32, leather)
        fill(40, 16, 56, 22, fur)
        fill(40, 28, 56, 30, lambda x, y, w, h: ramp(IRON, 0.1 if x % 2 else -0.1))  # bilek bandı
        # --- çizme (bacak alt kısmı 0..16 x 16..32)
        fill(0, 25, 16, 32, leather)
        fill(0, 25, 16, 27, fur)
        fill(0, 31, 16, 32, lambda x, y, w, h: ramp(LEATHER_D, -0.2))
    else:
        fill(0, 16, 16, 32, leather)                          # bacaklar
        fill(0, 16, 16, 18, lambda x, y, w, h: ramp(LEATHER_D, 0))
        fill(0, 21, 16, 22, lambda x, y, w, h: ramp(IRON, 0))
        fill(0, 26, 16, 27, lambda x, y, w, h: ramp(IRON, 0))
        fill(16, 26, 40, 32, leather)                          # bel
        fill(16, 26, 40, 28, lambda x, y, w, h: ramp(LEATHER_D, 0))
        p[23, 26] = p[24, 26] = rgba(GOLD)
    return im


# ================================================================ yazma

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def save_png(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def item_def(out, item_path, model):
    write_json(os.path.join(out, 'assets/karia/items', item_path + '.json'),
               {'model': {'type': 'minecraft:model', 'model': 'karia:' + model}})


def java_elements(els):
    out = []
    for e in els:
        faces = {fn: {'uv': f['uv'], 'texture': '#skin'} for fn, f in e['faces'].items()}
        out.append({'from': e['from'], 'to': e['to'], 'faces': faces})
    return out


def main():
    turler_path, out = sys.argv[1], sys.argv[2]
    with open(turler_path, encoding='utf-8') as f:
        turler = json.load(f)['turler']
    A = os.path.join(out, 'assets/karia')
    parts, rects = build_atlas()

    for part, els in parts.items():
        write_json(os.path.join(A, 'models/ejder', part + '.json'), {
            'ambientocclusion': False,
            'textures': {'skin': 'karia:ejder/varsayilan', 'particle': '#skin'},
            'elements': java_elements(els),
        })

    for i, t in enumerate(turler):
        tid, col = t['id'], t['renkler']
        save_png(os.path.join(A, 'textures/ejder', tid + '.png'), make_skin(col, rects, 1000 + i, t.get('desen', 'duz')))
        save_png(os.path.join(A, 'textures/ejder', tid + '_yumurta.png'), icon_egg(col, 2000 + i))
        save_png(os.path.join(A, 'textures/ejder', tid + '_pul.png'), icon_scale(col))
        for part in PARTS:
            write_json(os.path.join(A, 'models/ejder', tid, part + '.json'),
                       {'parent': 'karia:ejder/' + part, 'textures': {'skin': 'karia:ejder/' + tid, 'particle': 'karia:ejder/' + tid}})
            item_def(out, 'ejder/' + tid + '/' + part, 'ejder/' + tid + '/' + part)
        for kind in ('yumurta', 'pul'):
            write_json(os.path.join(A, 'models/ejder', tid, kind + '.json'),
                       {'parent': 'minecraft:item/generated', 'textures': {'layer0': 'karia:ejder/' + tid + '_' + kind}})
            item_def(out, 'ejder/' + tid + '/' + kind, 'ejder/' + tid + '/' + kind)
        item_def(out, 'ejder/' + tid + '/bedrock', 'ejder/' + tid + '/yumurta')

    save_png(os.path.join(A, 'textures/ejder/varsayilan.png'), make_skin(turler[0]['renkler'], rects, 1))

    icons = {
        'viking_baltasi': (icon_axe(), 'minecraft:item/handheld'),
        'savas_cekici': (icon_hammer(), 'minecraft:item/handheld'),
        'pul_kilic': (icon_sword(), 'minecraft:item/handheld'),
        'eyer': (icon_saddle(), 'minecraft:item/generated'),
        'duduk': (icon_whistle(), 'minecraft:item/generated'),
        'dumen': (icon_wheel(), 'minecraft:item/generated'),
        'viking_migferi': (icon_helmet(), 'minecraft:item/generated'),
        'viking_zirhi': (icon_chest(), 'minecraft:item/generated'),
        'viking_tozlugu': (icon_legs(), 'minecraft:item/generated'),
        'viking_cizmesi': (icon_boots(), 'minecraft:item/generated'),
    }
    for name, (img, parent) in icons.items():
        save_png(os.path.join(A, 'textures/ejder', name + '.png'), img)
        write_json(os.path.join(A, 'models/ejder', name + '.json'), {'parent': parent, 'textures': {'layer0': 'karia:ejder/' + name}})
        item_def(out, 'ejder/' + name, 'ejder/' + name)

    save_png(os.path.join(A, 'textures/entity/equipment/humanoid/viking.png'), armor_layer(False))
    save_png(os.path.join(A, 'textures/entity/equipment/humanoid_leggings/viking.png'), armor_layer(True))
    write_json(os.path.join(A, 'equipment/viking.json'), {'layers': {
        'humanoid': [{'texture': 'karia:viking'}],
        'humanoid_leggings': [{'texture': 'karia:viking'}],
    }})
    used = sum(r[2] * r[3] for r in rects.values())
    print('Paket üretildi:', len(turler), 'tür; atlas doluluğu %', round(100 * used / ATLAS / ATLAS), '->', out)


if __name__ == '__main__':
    main()
