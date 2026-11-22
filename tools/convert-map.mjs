// Превращает сырые данные OpenStreetMap в простой файл для игры.
// Запуск: node tools/convert-map.mjs
// Вход:  data/osm-raw.json   Выход: js/map-data.js
import fs from 'fs';
import { LAT0, LON0, SOUTH, WEST, NORTH, EAST } from './map-area.mjs';
import { loadLod2 } from './lod2.mjs';

const raw = JSON.parse(fs.readFileSync('data/osm-raw.json', 'utf8'));

// Всё считаем в метрах от центра (LAT0, LON0).
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

// x — вправо (восток), y — вниз (юг), как на экране.
const toXY = (p) => [
  Math.round((p.lon - LON0) * M_PER_DEG_LON * 10) / 10,
  Math.round(-(p.lat - LAT0) * M_PER_DEG_LAT * 10) / 10,
];

// Границы карты в метрах: [запад, север, восток, юг] → [x0, y0, x1, y1].
const [MAP_X0, MAP_Y0] = toXY({ lat: NORTH, lon: WEST });
const [MAP_X1, MAP_Y1] = toXY({ lat: SOUTH, lon: EAST });

// Составной объект (relation) приходит кусками-линиями. Склеиваем их в замкнутые кольца:
// берём кусок и ищем следующий, который начинается (или кончается) там, где кончился текущий.
function stitchRings(ways) {
  const key = (p) => p[0] + ',' + p[1];
  const left = ways.map((w) => w.slice());
  const rings = [];
  while (left.length) {
    let ring = left.shift();
    let grown = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grown) {
      grown = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < left.length; i++) {
        const w = left[i];
        if (key(w[0]) === end) ring = ring.concat(w.slice(1));
        else if (key(w[w.length - 1]) === end) ring = ring.concat(w.slice().reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// Ширина дороги в метрах по её типу.
const ROAD_WIDTH = {
  motorway: 14, trunk: 11, motorway_link: 6, trunk_link: 6,
  primary_link: 6, secondary_link: 6, tertiary_link: 6, living_street: 5,
  primary: 10, secondary: 9, tertiary: 8, unclassified: 6, residential: 6,
  service: 4, track: 3, footway: 2, path: 1.5, cycleway: 2, pedestrian: 4,
};

// Какие зоны рисуем и каким видом.
function areaKind(t) {
  if (t.natural === 'water' || t.leisure === 'swimming_pool') return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.landuse === 'farmland' || t.landuse === 'plant_nursery' ||
      t.landuse === 'greenhouse_horticulture') return 'farm';
  if (t.landuse === 'meadow' || t.landuse === 'grass' || t.leisure === 'pitch' ||
      t.leisure === 'park') return 'grass';
  if (t.landuse === 'residential' || t.landuse === 'farmyard') return 'yard';
  if (t.amenity === 'parking') return 'parking';
  return null;
}

// Ряд деревьев приходит линией — расставляем вдоль неё деревья каждые STEP метров.
function treesAlong(pts, step) {
  const trees = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let d = 0; d < len; d += step) {
      const k = d / len;
      trees.push([Math.round((x1 + (x2 - x1) * k) * 10) / 10, Math.round((y1 + (y2 - y1) * k) * 10) / 10]);
    }
  }
  return trees;
}

const BARRIERS = ['hedge', 'fence', 'wall'];

// Площадь многоугольника в м² (формула шнурования).
function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

// Высота дома в метрах (до крыши). Это деревня: дома в 1–1,5 этажа,
// амбары и конюшни широкие, но невысокие.
// Если в OSM указана высота или этажи — берём их, иначе — по типу и площади.
const SMALL = ['garage', 'garages', 'shed', 'carport', 'hut', 'cabin', 'greenhouse'];
const FARM = ['barn', 'stable', 'farm_auxiliary', 'riding_hall', 'warehouse', 'industrial'];
const HOUSE = ['house', 'detached', 'semidetached_house'];

let heightFromOsm = 0;
function buildingInfo(t, pts, id) {
  const jitter = (id % 7) / 7; // одинаковая «случайность» при каждом запуске
  const area = polygonArea(pts);
  // Тип: small — гараж/сарай, farm — амбар/манеж, house — жилой дом.
  let kind;
  if (SMALL.includes(t.building)) kind = 'small';
  else if (FARM.includes(t.building)) kind = 'farm';
  else if (HOUSE.includes(t.building)) kind = 'house';
  else kind = area < 40 ? 'small' : area < 250 ? 'house' : 'farm'; // building=yes — по площади

  let h;
  if (t.height) { heightFromOsm++; h = parseFloat(t.height); }
  else if (t['building:levels']) { heightFromOsm++; h = parseFloat(t['building:levels']) * 2.8 + 1.5; }
  else h = { small: 2.6 + jitter * 0.6, house: 4.5 + jitter * 1.5, farm: 5.5 + jitter * 1.5 }[kind];
  return [Math.round(h * 10) / 10, kind];
}

// ================= Настоящие крыши (LGLN) =================
// Контуры домов берём из OSM (они свежие, 2026) — они главные.
// К каждому дому OSM ищем здания LoD2, которые с ним пересекаются, и берём от них
// тип крыши, высоты и сами скаты. Цвет — из data/roof-colors.json (аэрофото).
// Дом, которого нет в LoD2 (построен после 2018), получает двускатную крышу «по умолчанию».

// Направление конька в градусах (0 = восток, 90 = юг): самое длинное ребро
// между двумя верхними точками крыши.
function ridgeDirection(roofs, ridge) {
  let best = null, bestLen = 0;
  for (const face of roofs) {
    for (let i = 0; i < face.length; i++) {
      const p = face[i], q = face[(i + 1) % face.length];
      if (p[2] < ridge - 0.3 || q[2] < ridge - 0.3) continue;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len > bestLen) { bestLen = len; best = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI; }
    }
  }
  if (best === null || bestLen < 1) return null;
  return Math.round(((best % 180) + 180) % 180);
}

const roofStats = { lod2: 0, covered: 0, guessed: 0, types: {} };

function attachRoofs(out) {
  const colors = fs.existsSync('data/roof-colors.json') ? JSON.parse(fs.readFileSync('data/roof-colors.json', 'utf8')) : {};
  const parts = fs.existsSync('data/lgln') ? loadLod2('data/lgln', toXY) : [];
  if (!parts.length) console.log('Нет LoD2 в data/lgln — крыши будут «по умолчанию». Скачать: node tools/fetch-lgln.mjs');

  // Сетка 20×20 м: какие части LoD2 лежат в каждой клетке.
  const CELL = 20;
  const grid = new Map();
  for (const p of parts) {
    p.area = polygonArea(p.footprint);
    const [x0, y0, x1, y1] = bboxOf(p.footprint);
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
        const k = i + ',' + j;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
  }

  // 1. Пересечение контуров: точки через каждый метр внутри дома OSM —
  //    сколько из них попало в каждую часть LoD2 (≈ площадь пересечения в м²).
  const overlaps = out.buildings.map((b) => {
    const counts = new Map();
    let total = 0;
    const [x0, y0, x1, y1] = bboxOf(b.pts);
    for (let x = Math.floor(x0) + 0.5; x < x1; x += 1) {
      for (let y = Math.floor(y0) + 0.5; y < y1; y += 1) {
        if (!pointInPoly(x, y, b.pts)) continue;
        total++;
        for (const p of grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL)) || []) {
          if (pointInPoly(x, y, p.footprint)) counts.set(p, (counts.get(p) || 0) + 1);
        }
      }
    }
    return { counts, total };
  });

  // 2. Каждую часть LoD2 отдаём тому дому OSM, с которым она пересекается больше всего.
  const owner = new Map();
  out.buildings.forEach((b, i) => {
    for (const [p, n] of overlaps[i].counts) {
      if (n < 0.3 * p.area) continue; // задета краем — не считается
      if (!owner.has(p) || owner.get(p).n < n) owner.set(p, { i, n });
    }
  });
  const partsOf = out.buildings.map(() => []);
  for (const [p, { i, n }] of owner) partsOf[i].push({ p, n });

  // 3. Записываем крышу в каждый дом.
  out.buildings.forEach((b, i) => {
    b.c = colors[b.id] || null;
    const mine = partsOf[i];
    if (mine.length) {
      const main = mine.reduce((a, c) => (c.n > a.n ? c : a)).p;
      const ridge = Math.max(...mine.map(({ p }) => p.ridge ?? 0));
      b.roof = { t: main.type, e: main.eave, r: ridge, d: ridgeDirection(main.roofs, main.ridge) };
      // Скаты: каждый — плоский список [x, y, z, x, y, z, ...] в метрах.
      b.f = mine.flatMap(({ p }) => p.roofs.map((face) => face.flat()));
      b.h = ridge;
      roofStats.lod2++;
      roofStats.types[main.type] = (roofStats.types[main.type] || 0) + 1;
    } else {
      // Дом OSM целиком накрыт частями LoD2, которые достались соседнему дому OSM
      // (например, OSM разделил дом на две половины, а LoD2 — нет). Его крышу рисует сосед.
      let covered = 0;
      for (const [p, n] of overlaps[i].counts) if (owner.has(p)) covered += n;
      if (overlaps[i].total && covered >= 0.6 * overlaps[i].total) {
        b.covered = true;
        roofStats.covered++;
      } else {
        b.roof = { t: 'gable', e: null, r: null, d: null }; // по умолчанию
        roofStats.guessed++;
      }
    }
    delete b.id;
  });
}

// ================= Посадка деревьев =================
// В OSM деревья во дворах почти не отмечены, а лес — просто контур.
// Поэтому сажаем деревья сами: сеткой со случайным сдвигом, не на дорогах и не в домах.
// Места не настоящие, но похожие на космоснимок.

// Генератор «случайных» чисел с зерном — каждый запуск даёт одинаковый лес.
let seed = 20261122;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// Внутри ли точка многоугольника (метод луча).
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Расстояние от точки до отрезка.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

function plantTrees(out) {
  // Сетка препятствий 20×20 м, чтобы не проверять каждое дерево против всех дорог.
  const CELL = 20;
  const grid = new Map();
  const add = (bb, item) => {
    for (let i = Math.floor(bb[0] / CELL); i <= Math.floor(bb[2] / CELL); i++)
      for (let j = Math.floor(bb[1] / CELL); j <= Math.floor(bb[3] / CELL); j++) {
        const key = i + ',' + j;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(item);
      }
  };
  for (const r of out.roads) {
    const gap = r.w / 2 + 2; // не ближе 2 м к краю дороги
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
      add([Math.min(ax, bx) - gap, Math.min(ay, by) - gap, Math.max(ax, bx) + gap, Math.max(ay, by) + gap],
        { seg: [ax, ay, bx, by], gap });
    }
  }
  for (const b of out.buildings) {
    const bb = bboxOf(b.pts);
    add([bb[0] - 3, bb[1] - 3, bb[2] + 3, bb[3] + 3], { poly: b.pts });
  }

  const blocked = (x, y) => {
    const list = grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL)) || [];
    for (const o of list) {
      if (o.seg && distToSegment(x, y, ...o.seg) < o.gap) return true;
      if (o.poly) {
        if (pointInPoly(x, y, o.poly)) return true;
        for (let i = 0; i < o.poly.length; i++) {
          const [ax, ay] = o.poly[i], [bx, by] = o.poly[(i + 1) % o.poly.length];
          if (distToSegment(x, y, ax, ay, bx, by) < 2.5) return true; // крона не на стене
        }
      }
    }
    return false;
  };

  // Лес — густо, дворы и парки — реже.
  const DENSITY = { forest: { step: 6.5, chance: 0.9 }, yard: { step: 9, chance: 0.4 } };
  let planted = 0;
  for (const a of out.areas) {
    const d = DENSITY[a.kind];
    if (!d) continue;
    // Сажаем только внутри карты: большой лес тянется далеко за её край.
    let [x0, y0, x1, y1] = bboxOf(a.pts);
    x0 = Math.max(x0, MAP_X0); y0 = Math.max(y0, MAP_Y0);
    x1 = Math.min(x1, MAP_X1); y1 = Math.min(y1, MAP_Y1);
    for (let gx = x0; gx < x1; gx += d.step) {
      for (let gy = y0; gy < y1; gy += d.step) {
        if (rand() > d.chance) continue;
        const x = gx + rand() * d.step * 0.9;
        const y = gy + rand() * d.step * 0.9;
        if (!pointInPoly(x, y, a.pts) || blocked(x, y)) continue;
        // Не на полянах внутри леса.
        if (a.holes && a.holes.some((h) => pointInPoly(x, y, h))) continue;
        out.trees.push([Math.round(x), Math.round(y)]); // до метра — точнее не нужно
        planted++;
      }
    }
  }
  console.log(`Посажено деревьев: ${planted}`);
}

const out = { roads: [], buildings: [], areas: [], barriers: [], trees: [] };

for (const w of raw.elements) {
  const t = w.tags || {};

  // Отдельное дерево — это точка (node), а не линия.
  if (w.type === 'node') {
    if (t.natural === 'tree') out.trees.push(toXY(w));
    continue;
  }
  // Составная зона (например, лес с полянами): внешние кольца + дыры внутри.
  if (w.type === 'relation') {
    const kind = areaKind(t);
    if (!kind) continue;
    const part = (role) => stitchRings(
      w.members.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry.map(toXY)));
    const outers = part('outer');
    const inners = part('inner');
    for (const ring of outers) {
      // Дыры берём только те, что лежат внутри этого кольца.
      const holes = inners.filter((h) => pointInPoly(h[0][0], h[0][1], ring));
      out.areas.push(holes.length ? { kind, pts: ring, holes } : { kind, pts: ring });
    }
    continue;
  }

  if (w.type !== 'way' || !w.geometry) continue;
  const pts = w.geometry.map(toXY);

  if (t.natural === 'tree_row') {
    out.trees.push(...treesAlong(pts, 7));
  } else if (BARRIERS.includes(t.barrier)) {
    out.barriers.push({ kind: t.barrier, pts });
  } else if (t.building) {
    // Последняя точка повторяет первую — для объёма она лишняя.
    const poly = pts.slice(0, -1);
    const [h, kind] = buildingInfo(t, poly, w.id);
    out.buildings.push({ id: w.id, h, k: kind, pts: poly });
  } else if (t.highway && ROAD_WIDTH[t.highway]) {
    out.roads.push({ w: ROAD_WIDTH[t.highway], name: t.name || '', pts });
  } else {
    const kind = areaKind(t);
    if (kind) out.areas.push({ kind, pts });
  }
}

// Порядок рисования зон: лес — снизу, вода и парковки — сверху.
const AREA_ORDER = ['forest', 'farm', 'grass', 'yard', 'parking', 'water'];
out.areas.sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind));

attachRoofs(out);
plantTrees(out);

// Широкие дороги рисуем последними, чтобы они были поверх тропинок.
out.roads.sort((a, b) => a.w - b.w);

const js =
  '// Сгенерировано tools/convert-map.mjs из OpenStreetMap (© участники OSM, ODbL).\n' +
  '// Координаты в метрах от точки 53.40699, 9.89064. Не редактировать вручную.\n' +
  'window.MAP_DATA = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync('js/map-data.js', js);

console.log(`Дорог: ${out.roads.length}, домов: ${out.buildings.length}, зон: ${out.areas.length}, ` +
  `изгородей/заборов: ${out.barriers.length}, деревьев: ${out.trees.length}`);
console.log(`Крыши: из LoD2 — ${roofStats.lod2}, накрыты соседом — ${roofStats.covered}, по умолчанию — ${roofStats.guessed}`);
console.log("Типы крыш LoD2:", JSON.stringify(roofStats.types));
console.log(`Размер файла: ${(js.length / 1024).toFixed(0)} КБ`);
