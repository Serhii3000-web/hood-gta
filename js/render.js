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

function prepareMap(map) {
  if (map.prepared) return;

  // Поля — каждому свой цвет.
  map.areas.forEach((a, i) => {
    a.color = a.kind === 'farm' ? FIELD_COLORS[Math.floor(hash01(i) * FIELD_COLORS.length)] : COLORS[a.kind];
  });

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
    if (b.k === 'small') b.roof = `hsl(30, 4%, ${40 + r * 12}%)`;
    else if (b.k === 'farm' || area > 500) b.roof = `hsl(40, 6%, ${68 + r * 14}%)`;
    else if (r < 0.5) b.roof = `hsl(215, 8%, ${24 + r * 16}%)`;           // антрацит
    else if (r < 0.85) b.roof = `hsl(${8 + r * 10}, 45%, ${32 + r * 8}%)`; // черепица
    else b.roof = `hsl(25, 30%, ${28 + r * 6}%)`;                          // коричневая
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

  ctx.lineWidth = 0.4;
  ctx.strokeStyle = COLORS.buildingEdge;
  for (const b of map.buildings) {
    tracePath(ctx, b.pts);
    ctx.closePath();
    ctx.fillStyle = b.roof;
    ctx.fill();
    ctx.stroke();
  }
  map.trees.forEach(([x, y], i) => drawCrown(ctx, x, y, map.treeInfo[i].r, map.treeInfo[i].shade));
}

// ================= Объём: общее для 3D и изометрии =================

// Нормаль стены наружу (единичный вектор) для ребра a→c дома b.
function wallNormal(b, a, c) {
  const dx = c[0] - a[0], dy = c[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [(dy / len) * b.sign, (-dx / len) * b.sign];
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
