"""Цвет крыши каждого дома OpenStreetMap по аэрофото LGLN DOP20.

Запуск:  python tools/roof-colors.py
Вход:    data/osm-raw.json, data/lgln/dop20_*.tif  (скачать: node tools/fetch-lgln.mjs)
Выход:   data/roof-colors.json  — { id дома в OSM: "#rrggbb" }

Как считаем цвет «без теней»:
  1. Берём пиксели внутри контура дома, отступив 0,6 м от края (там стены, водостоки, соседи).
  2. Выкидываем зелень (ветки деревьев над крышей) и очень тёмные пиксели (тени).
  3. Из оставшихся отбрасываем 10% самых тёмных и 10% самых светлых (блики) и усредняем.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.stdout.reconfigure(encoding='utf-8')  # консоль Windows по умолчанию в cp1251
Image.MAX_IMAGE_PIXELS = None  # плитки 10000×10000 — это нормально
DIR = 'data/lgln'
PIXEL = 0.2  # метров на пиксель

# ---------- широта/долгота → UTM зона 32 (формулы Крюгера, как в tools/utm.mjs) ----------
a, f, k0, E0, LON0 = 6378137, 1 / 298.257222101, 0.9996, 500000, math.radians(9)
n = f / (2 - f)
A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64)
alpha = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
e2n = 2 * math.sqrt(n) / (1 + n)


def to_utm(lat, lon):
    phi, dl = math.radians(lat), math.radians(lon) - LON0
    t = math.sinh(math.atanh(math.sin(phi)) - e2n * math.atanh(e2n * math.sin(phi)))
    xi1, eta1 = math.atan(t / math.cos(dl)), math.atanh(math.sin(dl) / math.sqrt(1 + t * t))
    E, N = eta1, xi1
    for j in range(1, 4):
        E += alpha[j - 1] * math.cos(2 * j * xi1) * math.sinh(2 * j * eta1)
        N += alpha[j - 1] * math.sin(2 * j * xi1) * math.cosh(2 * j * eta1)
    return E0 + k0 * A * E, k0 * A * N


# ---------- плитки аэрофото ----------
def read_tiles():
    tiles = []
    for name in sorted(os.listdir(DIR)):
        if not (name.startswith('dop20_') and name.endswith('.tif')):
            continue
        im = Image.open(f'{DIR}/{name}')
        e0, n1 = im.tag_v2[33922][3], im.tag_v2[33922][4]  # левый верхний угол (ModelTiepoint)
        w, h = im.size
        tiles.append({'name': name, 'e0': e0, 'n1': n1, 'e1': e0 + w * PIXEL, 'n0': n1 - h * PIXEL, 'w': w})
    # Свежие плитки (2026) — по 1 км (5000 px); старые (2024) — по 2 км. Сначала свежие.
    tiles.sort(key=lambda t: t['w'])
    return tiles


def tile_for(tiles, e, n):
    for t in tiles:
        if t['e0'] <= e < t['e1'] and t['n0'] < n <= t['n1']:
            return t
    return None


def roof_color(pixels):
    """pixels: N×3 → '#rrggbb' или None."""
    if len(pixels) < 10:
        return None
    r, g, b = pixels[:, 0].astype(int), pixels[:, 1].astype(int), pixels[:, 2].astype(int)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    keep = ~((g > r + 8) & (g > b + 8)) & (lum > 35)  # не зелень и не глубокая тень
    if keep.sum() >= 10:
        pixels, lum = pixels[keep], lum[keep]
    lo, hi = np.percentile(lum, 10), np.percentile(lum, 90)
    mid = pixels[(lum >= lo) & (lum <= hi)]
    if len(mid) < 5:
        mid = pixels
    c = mid.mean(axis=0)
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in c)


def main():
    osm = json.load(open('data/osm-raw.json', encoding='utf8'))
    houses = [w for w in osm['elements'] if w['type'] == 'way' and 'building' in w.get('tags', {}) and w.get('geometry')]
    tiles = read_tiles()
    if not tiles:
        sys.exit('Нет аэрофото в data/lgln — сначала запусти: node tools/fetch-lgln.mjs')

    # Группируем дома по плитке, чтобы держать в памяти одну картинку за раз.
    by_tile = {}
    for w in houses:
        utm = [to_utm(p['lat'], p['lon']) for p in w['geometry']]
        ce = sum(p[0] for p in utm) / len(utm)
        cn = sum(p[1] for p in utm) / len(utm)
        t = tile_for(tiles, ce, cn)
        if t:
            by_tile.setdefault(t['name'], (t, []))[1].append((w['id'], utm))

    colors = {}
    for name, (t, items) in by_tile.items():
        img = Image.open(f'{DIR}/{name}').convert('RGB')
        print(f'{name}: {len(items)} домов')
        for wid, utm in items:
            # UTM → пиксели плитки
            px = [((e - t['e0']) / PIXEL, (t['n1'] - n) / PIXEL) for e, n in utm]
            x0 = max(0, int(min(p[0] for p in px)) - 2)
            y0 = max(0, int(min(p[1] for p in px)) - 2)
            x1 = min(img.width, int(max(p[0] for p in px)) + 3)
            y1 = min(img.height, int(max(p[1] for p in px)) + 3)
            if x1 - x0 < 3 or y1 - y0 < 3:
                continue
            crop = np.asarray(img.crop((x0, y0, x1, y1)))
            mask = Image.new('L', (x1 - x0, y1 - y0), 0)
            ImageDraw.Draw(mask).polygon([(x - x0, y - y0) for x, y in px], fill=255)
            inner = mask.filter(ImageFilter.MinFilter(7))  # отступ ~0,6 м от края
            m = np.asarray(inner) > 0
            if m.sum() < 10:
                m = np.asarray(mask) > 0
            c = roof_color(crop[m])
            if c:
                colors[str(wid)] = c

    json.dump(colors, open('data/roof-colors.json', 'w'), indent=0)
    print(f'Цвет крыши найден у {len(colors)} из {len(houses)} домов → data/roof-colors.json')


if __name__ == '__main__':
    main()
