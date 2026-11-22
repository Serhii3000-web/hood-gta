// Рисование карты на canvas. Все координаты на входе — в метрах.

// Летняя палитра
const COLORS = {
  ground: '#5a7a3e',   // всё, что не попало в зоны (трава у дорог)
  yard: '#5f8443',     // дворы и участки
  grass: '#6a9a45',    // луга, газоны, спортплощадки
  forest: '#2c4f24',   // земля под лесом (между кронами)
  water: '#3b6f8f',
  parking: '#6e6e6b',
  road: '#6b6b68',
  roadEdge: '#4f4f4c',
  hedge: '#2f5f27',
  fence: '#b0a58c',
  wall: '#a29a90',
  building: '#8a7f73',
  buildingEdge: '#3f3a34',
};

// Поля летом разные: пшеница, рапс после цветения, кукуруза, свежая пахота.
const FIELD_COLORS = ['#8fa848', '#b9ad5c', '#c9b86a', '#7f9e3f', '#a39a55', '#6f9440', '#9c8a5a'];

// Оттенки крон, чтобы лес не был одноцветным.
const TREE_SHADES = [
  ['#2b5424', '#3d7332'],
  ['#2f5c26', '#447d36'],
  ['#264b20', '#36682c'],
  ['#355f2a', '#4a843b'],
];

// Солнце светит с запада-северо-запада, тени падают на восток-юго-восток.
const SUN = { x: -0.94, y: -0.34 };   // направление на солнце
const SHADOW = { x: 0.7, y: 0.25 };   // метров тени на метр высоты
const TREE_HEIGHT = 5;                // высота кроны, м

// «Случайное» число 0..1 по номеру — одно и то же при каждом запуске.
const hash01 = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Обвести многоугольник/линию по списку точек [[x,y], ...]
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

// ================= Подготовка (один раз) =================

// Наименьший прямоугольник, в который помещается дом. Перебираем направления стен:
// у почти прямоугольного дома одно из них даёт плотную «коробку».
// Возвращает центр, ось длинной стороны (u), поперечную ось (v) и полуразмеры.
function orientedBox(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.5) continue;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of pts) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  let { ux, uy, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let hl = (u1 - u0) / 2, hw = (v1 - v0) / 2;
  // Центр обратно в обычные координаты.
  const cx = cu * ux - cv * uy, cy = cu * uy + cv * ux;
  let vx = -uy, vy = ux;
  // Ось u должна идти вдоль ДЛИННОЙ стороны — по ней идёт конёк.
  if (hw > hl) { [hl, hw] = [hw, hl]; [ux, uy, vx, vy] = [vx, vy, ux, uy]; }
  return { cx, cy, ux, uy, vx, vy, hl, hw, area: best.area };
}

// Двускатная крыша по «коробке» дома: 4 угла на высоте карниза и 2 конца конька.
//   c[0..3] — углы: (+u+v), (+u−v), (−u−v), (−u+v);  r[0] — конёк на +u, r[1] — на −u.
function gableGeometry(b) {
  const g = b.gable;
  const L = [g.ux * g.hl, g.uy * g.hl], W = [g.vx * g.hw, g.vy * g.hw];
  return {
    c: [
      [g.cx + L[0] + W[0], g.cy + L[1] + W[1]],
      [g.cx + L[0] - W[0], g.cy + L[1] - W[1]],
      [g.cx - L[0] - W[0], g.cy - L[1] - W[1]],
      [g.cx - L[0] + W[0], g.cy - L[1] + W[1]],
    ],
    r: [[g.cx + L[0], g.cy + L[1]], [g.cx - L[0], g.cy - L[1]]],
  };
}

// '#rrggbb' → [оттенок, насыщенность %, яркость %]
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

// Крыша LoD2: разбираем скаты, считаем освещённость каждого,
// находим края крыши (по ним строятся стены) и рёбра между скатами (конёк, вальмы).
function prepareLod2Roof(b) {
  const key = (x, y) => Math.round(x * 5) + ',' + Math.round(y * 5); // точность 20 см
  const edges = new Map(); // ребро → сколько скатов его используют
  b.faces = b.f.map((flat) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
    // Нормаль ската (метод Ньюэлла) — куда он «смотрит».
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
      cx += p[0]; cy += p[1]; cz += p[2];
    }
    // Нормаль должна смотреть вверх (z > 0); тогда её x, y — в сторону, куда скат опускается.
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const len = Math.hypot(nx, ny, nz) || 1;
    // Освещённость: насколько скат повёрнут к солнцу (плоский — 0).
    const light = Math.max(-1, Math.min(1, ((nx * SUN.x + ny * SUN.y) / len) * 1.8));
    const face = { pts, light, cx: cx / pts.length, cy: cy / pts.length, z: cz / pts.length };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const k = [key(p[0], p[1]), key(q[0], q[1])].sort().join('|');
      const e = edges.get(k) || { n: 0, p, q, face };
      e.n++;
      edges.set(k, e);
    }
    return face;
  });
  // Нижние скаты рисуем первыми, верхние — поверх.
  b.faces.sort((f1, f2) => f1.z - f2.z);

  b.walls = [];   // края крыши (ребро у одного ската) — от них вниз идёт стена
  b.ridges = [];  // рёбра между двумя скатами — конёк и вальмы
  for (const e of edges.values()) {
    if (e.n === 1) {
      // Нормаль стены наружу: от центра ската через это ребро.
      const dx = e.q[0] - e.p[0], dy = e.q[1] - e.p[1];
      const l = Math.hypot(dx, dy) || 1;
      let nx = dy / l, ny = -dx / l;
      const mx = (e.p[0] + e.q[0]) / 2, my = (e.p[1] + e.q[1]) / 2;
      if (nx * (mx - e.face.cx) + ny * (my - e.face.cy) < 0) { nx = -nx; ny = -ny; }
      b.walls.push({ p: e.p, q: e.q, n: [nx, ny] });
    } else {
      b.ridges.push([e.p, e.q]);
    }
  }
}

function prepareMap(map) {
  if (map.prepared) return;

  // Поля — каждому свой цвет.
  map.areas.forEach((a, i) => {
    a.color = a.kind === 'farm' ? FIELD_COLORS[Math.floor(hash01(i) * FIELD_COLORS.length)] : COLORS[a.kind];
  });

  // Дом, который целиком накрыт крышей соседа (см. tools/convert-map.mjs), не рисуем.
  map.buildings = map.buildings.filter((b) => !b.covered);

  // Дома: центр, «обход» многоугольника, площадь, цвет крыши.
  map.buildings.forEach((b, i) => {
    let s = 0, cx = 0, cy = 0;
    for (let j = 0; j < b.pts.length; j++) {
      const [x1, y1] = b.pts[j];
      const [x2, y2] = b.pts[(j + 1) % b.pts.length];
      s += x1 * y2 - x2 * y1;
      cx += x1; cy += y1;
    }
    b.sign = s > 0 ? 1 : -1;
    b.cx = cx / b.pts.length;
    b.cy = cy / b.pts.length;
    const area = Math.abs(s / 2);
    const r = hash01(i);

    // Как на космоснимке: половина крыш тёмно-серые, остальные красно-коричневые;
    // у амбаров и манежей — светлые; у сараев — серая жесть.
    // Храним цвет как [оттенок, насыщенность, яркость], чтобы делать скаты светлее/темнее.
    if (b.k === 'small') b.roofHSL = [30, 4, 40 + r * 12];
    else if (b.k === 'farm' || area > 500) b.roofHSL = [40, 6, 68 + r * 14];
    else if (r < 0.5) b.roofHSL = [215, 8, 24 + r * 16];           // антрацит
    else if (r < 0.85) b.roofHSL = [8 + r * 10, 45, 32 + r * 8];   // черепица
    else b.roofHSL = [25, 30, 28 + r * 6];                         // коричневая
    // Настоящий цвет крыши с аэрофото (если есть) вместо угаданного.
    if (b.c) b.roofHSL = hexToHsl(b.c);
    b.roof = roofShade(b, 0);

    // Настоящая крыша из LoD2: готовые скаты.
    if (b.f) {
      prepareLod2Roof(b);
      return;
    }

    // Дома нет в LoD2 — двускатная крыша «по умолчанию» по форме контура.
    // Высота b.h из данных — это высота до конька; карниз ниже.
    const box = orientedBox(b.pts);
    if (b.k !== 'small' && area / box.area > 0.85 && area < 3000) {
      b.gable = box;
      const rise = Math.min(5, Math.max(1.5, box.hw * 0.9)); // скат ~40°
      b.eave = Math.max(2.5, b.h * 0.65);
      b.ridge = b.eave + rise;
    } else {
      b.eave = b.h; // плоская крыша
    }
  });

  // Деревья: размер и оттенок кроны.
  map.treeInfo = map.trees.map((t, i) => {
    const r = hash01(i + 0.5);
    return { r: 2.2 + r * 1.8, shade: TREE_SHADES[Math.floor(hash01(i + 7.1) * TREE_SHADES.length)] };
  });

  map.prepared = true;
}

// ================= Плоские слои =================

// Земля: зоны, дороги, изгороди. Общая для всех видов.
function drawGround(ctx, map) {
  prepareMap(map);

  // 1. Зоны: поля, лес, вода. У составных зон есть дыры (поляны в лесу):
  //    правило 'evenodd' оставляет их незакрашенными.
  for (const a of map.areas) {
    tracePath(ctx, a.pts);
    if (a.holes) {
      for (const h of a.holes) {
        ctx.moveTo(h[0][0], h[0][1]);
        for (let i = 1; i < h.length; i++) ctx.lineTo(h[i][0], h[i][1]);
      }
    }
    ctx.fillStyle = a.color;
    ctx.fill('evenodd');
  }

  // 2. Дороги: сначала тёмная кайма чуть шире, потом сама дорога
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of map.roads) {
    tracePath(ctx, r.pts);
    ctx.strokeStyle = COLORS.roadEdge;
    ctx.lineWidth = r.w + 1;
    ctx.stroke();
  }
  for (const r of map.roads) {
    tracePath(ctx, r.pts);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = r.w;
    ctx.stroke();
  }

  // 3. Изгороди (толстые зелёные), заборы и стены (тонкие)
  for (const b of map.barriers) {
    tracePath(ctx, b.pts);
    ctx.strokeStyle = COLORS[b.kind];
    ctx.lineWidth = b.kind === 'hedge' ? 1.4 : 0.4;
    ctx.stroke();
  }
}

// Крона дерева: тёмный круг и светлый блик со стороны солнца.
function drawCrown(ctx, x, y, r, shade) {
  ctx.fillStyle = shade[0];
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade[1];
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.25, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

// Плоская карта целиком (вид без объёма): земля + дома + деревья.
function drawMap(ctx, map) {
  drawGround(ctx, map);

  for (const b of map.buildings) drawRoofTop(ctx, b);
  map.trees.forEach(([x, y], i) => drawCrown(ctx, x, y, map.treeInfo[i].r, map.treeInfo[i].shade));
}

// Крыша строго сверху: светлый и тёмный скаты, тёмные линии конька и вальм.
function drawRoofTop(ctx, b) {
  ctx.strokeStyle = COLORS.buildingEdge;
  if (b.faces) {
    ctx.lineWidth = 0.15;
    for (const f of b.faces) {
      tracePath(ctx, f.pts);
      ctx.closePath();
      ctx.fillStyle = roofShade(b, f.light);
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    for (const [p, q] of b.ridges) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
    return;
  }
  if (b.gable) {
    const g = b.gable;
    const { c, r } = gableGeometry(b);
    ctx.lineWidth = 0.15;
    for (const [pts, side] of [[[c[0], c[3], r[1], r[0]], 1], [[c[1], c[2], r[1], r[0]], -1]]) {
      tracePath(ctx, pts);
      ctx.closePath();
      ctx.fillStyle = roofShade(b, Math.max(-1, Math.min(1, side * (g.vx * SUN.x + g.vy * SUN.y) * 1.8)));
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.moveTo(r[0][0], r[0][1]);
    ctx.lineTo(r[1][0], r[1][1]);
    ctx.stroke();
    return;
  }
  ctx.lineWidth = 0.3;
  tracePath(ctx, b.pts);
  ctx.closePath();
  ctx.fillStyle = b.roof;
  ctx.fill();
  ctx.stroke();
}

// ================= Объём: общее для 3D и изометрии =================

// Нормаль стены наружу (единичный вектор) для ребра a→c дома b.
function wallNormal(b, a, c) {
  const dx = c[0] - a[0], dy = c[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [(dy / len) * b.sign, (-dx / len) * b.sign];
}

// Цвет ската крыши: light от -1 (в тени) до 1 (к солнцу).
function roofShade(b, light) {
  const [h, s, l] = b.roofHSL;
  return `hsl(${h}, ${s}%, ${Math.max(5, Math.min(92, l + light * 10))}%)`;
}

// Выпуклая оболочка точек — нужна для тени дома с крышей.
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Цвет стены: чем сильнее она повёрнута к солнцу, тем светлее.
function wallColor(n) {
  const light = n[0] * SUN.x + n[1] * SUN.y; // от -1 до 1
  return `hsl(35, 18%, ${58 + light * 18}%)`;
}

// Тени рисуем на отдельном холсте чёрным, а потом кладём полупрозрачно —
// так перекрывающиеся тени не становятся темнее друг друга.
// visible(x, y) — пропускаем то, что далеко за краем экрана.
let shadowCanvas = null;
function drawShadowLayer(ctx, canvas, setTransform, map, visible) {
  if (!shadowCanvas) shadowCanvas = document.createElement('canvas');
  if (shadowCanvas.width !== canvas.width || shadowCanvas.height !== canvas.height) {
    shadowCanvas.width = canvas.width;
    shadowCanvas.height = canvas.height;
  }
  const s = shadowCanvas.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, canvas.width, canvas.height);
  s.save();
  setTransform(s);
  s.fillStyle = '#000';

  for (const b of map.buildings) {
    if (!visible(b.cx, b.cy)) continue;

    // Крыша LoD2: тень каждого ската = оболочка его точек на земле и сдвинутых по высоте.
    if (b.faces) {
      for (const f of b.faces) {
        const pts = [];
        for (const [x, y, z] of f.pts) pts.push([x, y], [x + SHADOW.x * z, y + SHADOW.y * z]);
        tracePath(s, convexHull(pts));
        s.fill();
      }
      continue;
    }

    // Дом с двускатной крышей: тень = оболочка основания, карниза и конька.
    if (b.gable) {
      const g = gableGeometry(b);
      const shift = (p, h) => [p[0] + SHADOW.x * h, p[1] + SHADOW.y * h];
      const pts = b.pts.concat(g.c.map((p) => shift(p, b.eave)), g.r.map((p) => shift(p, b.ridge)));
      tracePath(s, convexHull(pts));
      s.fill();
      continue;
    }

    const ox = SHADOW.x * b.h, oy = SHADOW.y * b.h;
    const n = b.pts.length;
    // Тень = сам дом + он же, сдвинутый, + «полосы» между ними от каждой стены.
    for (let i = 0; i < n; i++) {
      const [x1, y1] = b.pts[i];
      const [x2, y2] = b.pts[(i + 1) % n];
      s.beginPath();
      s.moveTo(x1, y1); s.lineTo(x2, y2);
      s.lineTo(x2 + ox, y2 + oy); s.lineTo(x1 + ox, y1 + oy);
      s.fill();
    }
    tracePath(s, b.pts.map(([x, y]) => [x + ox, y + oy]));
    s.fill();
  }
  // Тень дерева короче, чем у дома такой же высоты: крона — шар, а не стена.
  const tx = SHADOW.x * TREE_HEIGHT * 0.4, ty = SHADOW.y * TREE_HEIGHT * 0.4;
  map.trees.forEach(([x, y], i) => {
    if (!visible(x, y)) return;
    s.beginPath();
    s.arc(x + tx, y + ty, map.treeInfo[i].r, 0, Math.PI * 2);
    s.fill();
  });
  s.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.32;
  ctx.drawImage(shadowCanvas, 0, 0);
  ctx.restore();
}
