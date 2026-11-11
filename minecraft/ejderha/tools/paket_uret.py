#!/usr/bin/env python3
"""
KariaEjderha kaynak paketi üreteci.
turler.json'daki her tür için 3B parça modelleri, doku, yumurta/pul simgeleri; ayrıca Viking eşya simgeleri ve
zırh dokusu üretir. Çıktı: <cikti>/assets/karia/... (mevcut karia paketine birleştirilecek şekilde).

Kullanım: python paket_uret.py <turler.json> <cikti_klasoru>
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw

# ---------------------------------------------------------------- renk yardımcıları

def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def shade(c, f):
    return tuple(max(0, min(255, int(round(v * f)))) for v in c)


# ---------------------------------------------------------------- doku atlası (64x64, 4x4 bölge, her bölge 16x16 px)
# Model UV'leri 0..16 uzayında: bölge (col,row) -> [col*4, row*4, col*4+4, row*4+4]
REG = {
    'ana': (0, 0), 'karin': (1, 0), 'koyu': (2, 0), 'zar': (3, 0),
    'goz': (0, 1), 'boynuz': (1, 1), 'agiz': (2, 1), 'sirt': (3, 1),
}


def region_uv(name):
    c, r = REG[name]
    return [c * 4, r * 4, c * 4 + 4, r * 4 + 4]


def make_skin(col, seed):
    rnd = random.Random(seed)
    ana, karin, koyu, zar = hx(col['ana']), hx(col['karin']), hx(col['koyu']), hx(col['zar'])
    goz, boynuz = hx(col['goz']), hx(col['boynuz'])
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    px = img.load()

    def fill(region, fn):
        c, r = REG[region]
        for y in range(16):
            for x in range(16):
                px[c * 16 + x, r * 16 + y] = fn(x, y) + (255,)

    # ana: yarım kaydırmalı pul deseni
    def scales(base):
        def f(x, y):
            row = y // 4
            ox = (x + (2 if row % 2 else 0)) % 4
            oy = y % 4
            n = rnd.uniform(-0.05, 0.05)
            if oy == 3 or (oy == 2 and ox in (0, 3)):
                return shade(base, 0.72 + n)
            if oy == 0 and ox in (1, 2):
                return shade(base, 1.18 + n)
            return shade(base, 1.0 + n)
        return f

    fill('ana', scales(ana))
    fill('sirt', scales(mix(ana, koyu, 0.35)))

    def belly(x, y):
        n = rnd.uniform(-0.04, 0.04)
        if y % 4 == 3:
            return shade(karin, 0.8 + n)
        return shade(karin, 1.0 + n)
    fill('karin', belly)
    fill('koyu', lambda x, y: shade(koyu, 1.0 + rnd.uniform(-0.08, 0.08)))

    def membrane(x, y):
        n = rnd.uniform(-0.03, 0.03)
        if x % 5 == 0 or (x + y) % 9 == 0:
            return shade(zar, 0.7 + n)
        return shade(zar, 1.0 + n)
    fill('zar', membrane)

    def eye(x, y):
        if 6 <= x <= 9:
            return (20, 14, 10)
        d = abs(x - 7.5) / 8
        return shade(goz, 1.15 - d * 0.4)
    fill('goz', eye)
    fill('boynuz', lambda x, y: shade(boynuz, 1.1 - y / 16 * 0.45))

    def mouth(x, y):
        if y < 4 and x % 3 == 1:
            return (240, 236, 220)
        return (90, 22, 20) if y > 3 else (60, 14, 14)
    fill('agiz', mouth)
    return img


# ---------------------------------------------------------------- model geometrisi (ileri = +Z, model merkezi 8,8,8)

def box(frm, to, up='sirt', down='karin', side='ana', front=None, back=None, east=None, west=None):
    faces = {}
    spec = {'up': up, 'down': down, 'north': back or side, 'south': front or side, 'east': east or side, 'west': west or side}
    for f, reg in spec.items():
        faces[f] = {'uv': region_uv(reg), 'texture': '#skin'}
    return {'from': frm, 'to': to, 'faces': faces}


def body_elements():
    e = []
    e.append(box([4, 6, 0], [12, 13, 14]))                        # gövde
    e.append(box([3.5, 6.5, 9], [12.5, 13.5, 15]))                # göğüs
    for x0 in (3, 10):                                            # bacaklar
        e.append(box([x0, 1, 10], [x0 + 3, 8, 13], up='ana', down='koyu'))
        e.append(box([x0, 1, 1], [x0 + 3, 8, 4.5], up='ana', down='koyu'))
        e.append(box([x0 - 0.2, 0, 10.5], [x0 + 3.2, 1, 14], side='koyu', up='koyu', down='koyu'))   # ön pençe
        e.append(box([x0 - 0.2, 0, 1.5], [x0 + 3.2, 1, 5], side='koyu', up='koyu', down='koyu'))     # arka pençe
        e.append(box([x0 + 0.2, 0, 14], [x0 + 0.8, 0.8, 15], side='boynuz', up='boynuz', down='boynuz'))
        e.append(box([x0 + 2.2, 0, 14], [x0 + 2.8, 0.8, 15], side='boynuz', up='boynuz', down='boynuz'))
    # kuyruk
    e.append(box([5.5, 8, -6], [10.5, 12, 0]))
    e.append(box([6.5, 8.5, -11], [9.5, 11, -6]))
    e.append(box([7.2, 9, -15], [8.8, 10.5, -11]))
    e.append(box([5, 9.4, -16], [11, 10.1, -13], side='zar', up='zar', down='zar'))                 # kuyruk yüzgeci
    # sırt dikenleri
    for z, h in ((1, 14.6), (4.5, 15.4), (8, 15.6), (11.5, 15)):
        e.append(box([7.5, 13, z], [8.5, h, z + 2], side='koyu', up='koyu', down='koyu'))
    e.append(box([7.6, 12, -4], [8.4, 13.4, -2], side='koyu', up='koyu', down='koyu'))
    e.append(box([7.7, 11, -9], [8.3, 12, -7.5], side='koyu', up='koyu', down='koyu'))
    return e


def head_elements():
    e = []
    e.append(box([6.5, 10, 13], [9.5, 14, 19]))                  # boyun
    e.append(box([6.5, 12, 18], [9.5, 16, 21]))
    e.append(box([5.5, 13, 20], [10.5, 17.5, 26]))               # kafa
    e.append(box([6.5, 13.5, 25.5], [9.5, 16.2, 30], front='koyu'))   # burun
    e.append(box([6.8, 12, 22], [9.2, 13.5, 29.5], up='agiz', front='koyu'))  # çene
    e.append(box([7, 13.4, 25.6], [9, 13.6, 29.6], side='agiz', up='agiz', down='agiz'))  # dişler/ağız
    for x0 in (5.5, 9.5):                                         # boynuzlar
        e.append(box([x0, 17, 20.5], [x0 + 1, 19, 22], side='boynuz', up='boynuz', down='boynuz'))
        e.append(box([x0 + (0 if x0 < 8 else 0), 18.5, 18.5], [x0 + 1, 19.5, 21], side='boynuz', up='boynuz', down='boynuz'))
    e.append(box([5.35, 15.2, 23.6], [5.6, 16.6, 25.3], side='goz', up='goz', down='goz'))   # gözler
    e.append(box([10.4, 15.2, 23.6], [10.65, 16.6, 25.3], side='goz', up='goz', down='goz'))
    e.append(box([7.6, 17.5, 21], [8.4, 18.6, 24], side='koyu', up='koyu', down='koyu'))     # baş dikeni
    return e


def wing_elements(left):
    e = []
    if left:
        e.append(box([12, 13, 9], [24, 14.2, 11], up='ana', down='karin'))        # kol kemiği
        e.append(box([23.5, 12.8, 2], [25, 14, 11], up='ana', down='karin'))
        e.append(box([12, 13.35, 0], [26, 13.65, 10], up='zar', down='zar', side='zar'))   # zar
        e.append(box([16, 13.35, -3], [24, 13.65, 0], up='zar', down='zar', side='zar'))
        e.append(box([25, 13.2, 9.8], [27, 14, 11.5], side='boynuz', up='boynuz', down='boynuz'))  # pençe ucu
    else:
        e.append(box([-8, 13, 9], [4, 14.2, 11], up='ana', down='karin'))
        e.append(box([-9, 12.8, 2], [-7.5, 14, 11], up='ana', down='karin'))
        e.append(box([-10, 13.35, 0], [4, 13.65, 10], up='zar', down='zar', side='zar'))
        e.append(box([-8, 13.35, -3], [0, 13.65, 0], up='zar', down='zar', side='zar'))
        e.append(box([-11, 13.2, 9.8], [-9, 14, 11.5], side='boynuz', up='boynuz', down='boynuz'))
    return e


PARTS = {
    'govde': body_elements,
    'bas': head_elements,
    'kanat_sol': lambda: wing_elements(True),
    'kanat_sag': lambda: wing_elements(False),
}

# ---------------------------------------------------------------- 16x16 simgeler

OUT = (34, 24, 18, 255)


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


WOOD, WOOD_L = (120, 78, 38, 255), (160, 110, 58, 255)
IRON, IRON_D, IRON_L = (198, 204, 212, 255), (122, 130, 142, 255), (240, 244, 248, 255)
LEATHER, LEATHER_L = (118, 72, 36, 255), (160, 102, 56, 255)
FUR, FUR_D = (220, 206, 178, 255), (170, 152, 124, 255)
GOLD = (224, 176, 64, 255)
BONE, BONE_D = (232, 220, 192, 255), (184, 168, 136, 255)
CYAN, CYAN_D = (158, 231, 255, 255), (79, 168, 200, 255)


def icon_axe():
    im = canvas(); d = ImageDraw.Draw(im)
    d.line([(2, 13), (11, 4)], fill=WOOD, width=1)
    d.line([(3, 13), (11, 5)], fill=WOOD_L, width=1)
    d.polygon([(9, 2), (12, 1), (14, 3), (14, 8), (11, 7)], fill=IRON)
    d.line([(13, 2), (14, 7)], fill=IRON_L)
    d.line([(10, 3), (11, 6)], fill=IRON_D)
    return outline(im)


def icon_hammer():
    im = canvas(); d = ImageDraw.Draw(im)
    d.line([(2, 13), (9, 6)], fill=WOOD, width=1)
    d.line([(3, 13), (9, 7)], fill=WOOD_L, width=1)
    d.polygon([(7, 4), (10, 1), (14, 5), (11, 8)], fill=IRON_D)
    d.polygon([(8, 4), (10, 2), (13, 5), (11, 7)], fill=IRON)
    d.line([(10, 2), (13, 5)], fill=IRON_L)
    return outline(im)


def icon_sword():
    im = canvas(); d = ImageDraw.Draw(im)
    d.line([(5, 10), (13, 2)], fill=CYAN, width=2)
    d.line([(6, 10), (13, 3)], fill=CYAN_D, width=1)
    d.line([(13, 2), (14, 1)], fill=IRON_L)
    d.line([(2, 8), (7, 13)], fill=GOLD, width=1)
    d.line([(2, 13), (4, 11)], fill=LEATHER, width=2)
    d.point((1, 14), fill=GOLD)
    return outline(im)


def icon_saddle():
    im = canvas(); d = ImageDraw.Draw(im)
    d.ellipse([2, 4, 13, 10], fill=LEATHER)
    d.ellipse([4, 4, 11, 7], fill=LEATHER_L)
    d.line([(4, 9), (4, 13)], fill=LEATHER)
    d.line([(11, 9), (11, 13)], fill=LEATHER)
    d.rectangle([3, 13, 5, 14], fill=IRON)
    d.rectangle([10, 13, 12, 14], fill=IRON)
    d.point((8, 5), fill=GOLD)
    return outline(im)


def icon_whistle():
    im = canvas(); d = ImageDraw.Draw(im)
    pts = [(3, 12), (5, 10), (7, 8), (9, 6), (11, 4), (12, 3)]
    for i, (x, y) in enumerate(pts):
        r = 0.6 + i * 0.35
        d.ellipse([x - r, y - r, x + r, y + r], fill=BONE)
    d.ellipse([10.5, 1.5, 14, 5], fill=BONE_D)
    d.point((2, 13), fill=WOOD)
    d.line([(6, 9), (7, 10)], fill=GOLD)
    return outline(im)


def icon_helmet():
    im = canvas(); d = ImageDraw.Draw(im)
    d.pieslice([3, 3, 12, 14], 180, 360, fill=IRON)
    d.rectangle([3, 8, 12, 11], fill=IRON_D)
    d.rectangle([7, 8, 8, 13], fill=IRON)
    d.line([(4, 6), (6, 4)], fill=IRON_L)
    d.line([(1, 2), (3, 7)], fill=BONE, width=2)
    d.line([(14, 2), (12, 7)], fill=BONE, width=2)
    d.point((1, 1), fill=BONE_D); d.point((14, 1), fill=BONE_D)
    return outline(im)


def icon_chest():
    im = canvas(); d = ImageDraw.Draw(im)
    d.polygon([(2, 2), (6, 2), (8, 4), (10, 2), (14, 2), (14, 6), (12, 6), (12, 14), (4, 14), (4, 6), (2, 6)], fill=LEATHER)
    d.rectangle([5, 7, 11, 12], fill=IRON_D)
    d.rectangle([6, 8, 10, 11], fill=IRON)
    d.line([(2, 2), (14, 2)], fill=FUR, width=2)
    d.line([(4, 13), (12, 13)], fill=LEATHER_L)
    return outline(im)


def icon_legs():
    im = canvas(); d = ImageDraw.Draw(im)
    d.polygon([(3, 2), (13, 2), (13, 14), (9, 14), (8, 6), (7, 14), (3, 14)], fill=LEATHER)
    d.rectangle([3, 2, 13, 4], fill=IRON_D)
    d.line([(4, 8), (6, 8)], fill=FUR); d.line([(10, 8), (12, 8)], fill=FUR)
    d.line([(4, 11), (6, 11)], fill=LEATHER_L); d.line([(10, 11), (12, 11)], fill=LEATHER_L)
    return outline(im)


def icon_boots():
    im = canvas(); d = ImageDraw.Draw(im)
    d.rectangle([2, 6, 6, 13], fill=LEATHER)
    d.rectangle([2, 12, 7, 14], fill=LEATHER_L)
    d.rectangle([9, 6, 13, 13], fill=LEATHER)
    d.rectangle([8, 12, 13, 14], fill=LEATHER_L)
    d.rectangle([2, 4, 6, 6], fill=FUR); d.rectangle([9, 4, 13, 6], fill=FUR)
    d.line([(2, 9), (6, 9)], fill=IRON); d.line([(9, 9), (13, 9)], fill=IRON)
    return outline(im)


def icon_egg(col, seed):
    rnd = random.Random(seed)
    ana, karin, koyu = hx(col['ana']), hx(col['karin']), hx(col['koyu'])
    im = canvas(); d = ImageDraw.Draw(im)
    d.ellipse([3, 1, 12, 14], fill=ana + (255,))
    d.ellipse([4, 2, 9, 8], fill=mix(ana, karin, 0.45) + (255,))
    for _ in range(6):
        x, y = rnd.randint(4, 11), rnd.randint(3, 13)
        d.point((x, y), fill=koyu + (255,))
        d.point((x + 1, y), fill=koyu + (255,))
    d.point((5, 3), fill=(255, 255, 255, 255))
    return outline(im)


def icon_scale(col):
    ana, karin = hx(col['ana']), hx(col['karin'])
    im = canvas(); d = ImageDraw.Draw(im)
    d.polygon([(8, 1), (13, 5), (12, 11), (8, 15), (4, 11), (3, 5)], fill=ana + (255,))
    d.polygon([(8, 3), (11, 6), (10, 10), (8, 12)], fill=mix(ana, karin, 0.5) + (255,))
    d.line([(6, 4), (5, 8)], fill=(255, 255, 255, 200))
    return outline(im)


# ---------------------------------------------------------------- Viking zırh dokusu (64x32 insansı katman)

def armor_layer(leggings):
    rnd = random.Random(7 if leggings else 3)
    im = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    p = im.load()

    def put(x0, y0, x1, y1, fn):
        for y in range(y0, y1):
            for x in range(x0, x1):
                p[x, y] = fn(x - x0, y - y0)

    def leather(x, y):
        c = LEATHER if (x + y * 3) % 7 else LEATHER_L
        return shade(c[:3], 1 + rnd.uniform(-0.06, 0.06)) + (255,)

    def iron(x, y):
        return shade(IRON[:3], 1 + rnd.uniform(-0.05, 0.05) - (0.25 if y % 4 == 3 else 0)) + (255,)

    def fur(x, y):
        return shade(FUR[:3] if (x + y) % 3 else FUR_D[:3], 1 + rnd.uniform(-0.05, 0.05)) + (255,)

    if not leggings:
        put(0, 0, 32, 16, iron)                                    # kafa (miğfer)
        put(8, 12, 16, 16, lambda x, y: (0, 0, 0, 0) if 2 <= x <= 5 and y < 3 else iron(x, y))  # yüz açıklığı
        for x in range(11, 13):
            for y in range(8, 16): p[x, y] = IRON_D            # burun koruması
        put(16, 16, 40, 32, leather)                               # gövde
        put(20, 16, 28, 20, fur)                                   # kürk yaka (üst)
        put(20, 20, 28, 22, fur)
        put(21, 24, 27, 30, iron)                                  # göğüs plakası
        put(40, 16, 56, 32, leather)                               # kollar
        put(40, 16, 56, 20, fur)                                   # omuz kürkü
        put(0, 16, 16, 32, lambda x, y: (0, 0, 0, 0) if y < 9 else leather(x, y))  # çizme (bacak alt kısmı)
        put(0, 25, 16, 27, fur)
    else:
        put(0, 16, 16, 32, leather)                                # bacaklar
        put(0, 22, 16, 23, lambda x, y: IRON_D)
        put(16, 16, 40, 32, lambda x, y: (0, 0, 0, 0) if y < 10 else leather(x, y))  # bel
        put(16, 26, 40, 28, lambda x, y: IRON_D)
    return im


# ---------------------------------------------------------------- yazma

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


def main():
    turler_path, out = sys.argv[1], sys.argv[2]
    with open(turler_path, encoding='utf-8') as f:
        turler = json.load(f)['turler']
    A = os.path.join(out, 'assets/karia')

    # ortak parça modelleri
    for part, fn in PARTS.items():
        write_json(os.path.join(A, 'models/ejder', part + '.json'), {
            'ambientocclusion': False,
            'textures': {'skin': 'karia:ejder/varsayilan', 'particle': '#skin'},
            'elements': fn(),
        })

    for i, t in enumerate(turler):
        tid, col = t['id'], t['renkler']
        save_png(os.path.join(A, 'textures/ejder', tid + '.png'), make_skin(col, 1000 + i))
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
        # Java'da görünmez; Bedrock askısının eşyası (Geyser eşlemesi bunu Bedrock modeline çevirir)
        item_def(out, 'ejder/' + tid + '/bedrock', 'ejder/' + tid + '/yumurta')

    # varsayılan doku (ortak modeller için)
    save_png(os.path.join(A, 'textures/ejder/varsayilan.png'), make_skin(turler[0]['renkler'], 1) if turler else Image.new('RGBA', (64, 64)))

    icons = {
        'viking_baltasi': (icon_axe(), 'minecraft:item/handheld'),
        'savas_cekici': (icon_hammer(), 'minecraft:item/handheld'),
        'pul_kilic': (icon_sword(), 'minecraft:item/handheld'),
        'eyer': (icon_saddle(), 'minecraft:item/generated'),
        'duduk': (icon_whistle(), 'minecraft:item/generated'),
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
    print('Paket üretildi:', len(turler), 'tür ->', out)


if __name__ == '__main__':
    main()
