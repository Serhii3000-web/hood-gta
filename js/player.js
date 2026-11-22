// Игрок: клавиатура, движение, выносливость, рисование человечка.

// ---------- Клавиатура ----------
// Храним, какие клавиши сейчас нажаты. e.code — физическая клавиша,
// поэтому WASD работают и при русской раскладке.
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault(); // чтобы страница не прокручивалась
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear()); // переключился на другое окно — отпускаем всё

// ---------- Скорости и выносливость ----------
const WALK_SPEED = 1.6;      // м/с — обычный шаг
const RUN_SPEED = 4.5;       // м/с — бег (Shift)
const TIRED_SPEED = 1.2;     // м/с — шаг при одышке

const STAMINA_MAX = 100;
const STAMINA_RUN = 4;       // тратится в секунду бега (полной шкалы хватает на ~25 с)
const STAMINA_WALK = 8;      // восстанавливается в секунду шага
const STAMINA_REST = 15;     // восстанавливается в секунду, если стоишь
const STAMINA_RECOVER = 30;  // после одышки бежать можно, когда шкала дойдёт до 30

// ---------- Случайная точка на улице ----------
// Улица (не тропинка и не автобан) не дальше 60 м от дома — то есть в посёлке.
// Длинные улицы выпадают чаще: шанс пропорционален длине участка.
let streetCache = null;
function randomStreetPoint(map) {
  if (!streetCache) {
    const segments = [];
    let total = 0;
    for (const r of map.roads) {
      if (r.w < 4 || r.w > 10) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, y1] = r.pts[i], [x2, y2] = r.pts[i + 1];
        total += Math.hypot(x2 - x1, y2 - y1);
        segments.push({ x1, y1, x2, y2, end: total });
      }
    }
    const houses = map.buildings.map((b) => [
      b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length,
      b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length,
    ]);
    streetCache = { segments, total, houses };
  }
  const { segments, total, houses } = streetCache;
  const nearHouse = (x, y) => houses.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < 60);

  // Пробуем случайные точки, пока не попадём в посёлок.
  for (let attempt = 0; attempt < 500; attempt++) {
    const pick = Math.random() * total;
    const s = segments.find((seg) => seg.end >= pick);
    const k = Math.random();
    const x = s.x1 + (s.x2 - s.x1) * k, y = s.y1 + (s.y2 - s.y1) * k;
    if (nearHouse(x, y)) return { x, y };
  }
  return { x: 0, y: 0 }; // запасной вариант — центр карты
}

// ---------- Столкновения ----------
// Препятствия — отрезки: стены домов, заборы, стены, живые изгороди.
// Раскладываем их по сетке 10×10 м, чтобы проверять только ближайшие.
const PLAYER_RADIUS = 0.4;   // м — «толщина» человечка для столкновений
const MAX_SUBSTEP = 0.15;    // м — движение за кадр режем на такие кусочки
const WALL_CELL = 10;
const BARRIER_HALF = { hedge: 0.7, fence: 0.1, wall: 0.15 }; // полутолщина, м

const wallGrid = new Map();
function addWall(ax, ay, bx, by, half) {
  const seg = { ax, ay, bx, by, half };
  const pad = half + PLAYER_RADIUS;
  for (let i = Math.floor((Math.min(ax, bx) - pad) / WALL_CELL); i <= Math.floor((Math.max(ax, bx) + pad) / WALL_CELL); i++) {
    for (let j = Math.floor((Math.min(ay, by) - pad) / WALL_CELL); j <= Math.floor((Math.max(ay, by) + pad) / WALL_CELL); j++) {
      const k = i + ',' + j;
      if (!wallGrid.has(k)) wallGrid.set(k, []);
      wallGrid.get(k).push(seg);
    }
  }
}
// Дом с моделью LoD2 рисуется по ней — значит, и упираться надо в её стены
// (низ нарисованных стен). Дом без LoD2 — по контуру из OpenStreetMap.
prepareMap(window.MAP_DATA); // из render.js: готовит стены LoD2 (b.walls)
for (const b of window.MAP_DATA.buildings) {
  if (b.walls) {
    for (const w of b.walls) addWall(w.p[0], w.p[1], w.q[0], w.q[1], 0);
    continue;
  }
  for (let i = 0; i < b.pts.length; i++) {
    const [ax, ay] = b.pts[i], [bx, by] = b.pts[(i + 1) % b.pts.length];
    addWall(ax, ay, bx, by, 0);
  }
}
for (const br of window.MAP_DATA.barriers) {
  for (let i = 0; i < br.pts.length - 1; i++) {
    const [ax, ay] = br.pts[i], [bx, by] = br.pts[i + 1];
    addWall(ax, ay, bx, by, BARRIER_HALF[br.kind] || 0.1);
  }
}

// Если круг игрока залез в стену — выталкиваем его наружу по кратчайшему пути.
// Так при движении под углом к стене человечек скользит вдоль неё.
function pushOutOfWalls(p) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const list = wallGrid.get(Math.floor(p.x / WALL_CELL) + ',' + Math.floor(p.y / WALL_CELL)) || [];
    for (const s of list) {
      // Ближайшая к игроку точка отрезка.
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / len2));
      const cx = s.ax + dx * t, cy = s.ay + dy * t;
      const ox = p.x - cx, oy = p.y - cy;
      const dist = Math.hypot(ox, oy);
      const minDist = PLAYER_RADIUS + s.half;
      if (dist >= minDist) continue;
      if (dist < 1e-6) continue; // ровно на линии — не знаем, куда толкать; пропускаем
      const push = minDist - dist;
      p.x += (ox / dist) * push;
      p.y += (oy / dist) * push;
      moved = true;
    }
    if (!moved) break;
  }
}

// ---------- Что под ногами ----------
// Бег по газону и полю утомляет сильнее, по лесу — намного сильнее.
const TERRAIN = {
  road: { icon: '🛣️', name: 'дорога', drain: 1 },
  grass: { icon: '🌱', name: 'газон', drain: (STAMINA_MAX / 15) / STAMINA_RUN }, // полная шкала за 15 с
  forest: { icon: '🌲', name: 'лес', drain: (STAMINA_MAX / 3) / STAMINA_RUN }, // полная шкала за 3 с
};

// Дороги (любые, с тротуарами и тропинками) — по сетке 20×20 м, с полушириной.
const ROAD_CELL = 20;
const roadGrid = new Map();
for (const r of window.MAP_DATA.roads) {
  const half = r.w / 2 + (hasSidewalk(r.w) ? SIDEWALK_WIDTH : 0);
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
    const seg = { ax, ay, bx, by, half };
    for (let gi = Math.floor((Math.min(ax, bx) - half) / ROAD_CELL); gi <= Math.floor((Math.max(ax, bx) + half) / ROAD_CELL); gi++) {
      for (let gj = Math.floor((Math.min(ay, by) - half) / ROAD_CELL); gj <= Math.floor((Math.max(ay, by) + half) / ROAD_CELL); gj++) {
        const k = gi + ',' + gj;
        if (!roadGrid.has(k)) roadGrid.set(k, []);
        roadGrid.get(k).push(seg);
      }
    }
  }
}

// Рамки участков — чтобы быстро отбрасывать далёкие.
for (const a of window.MAP_DATA.areas) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of a.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  a.box = [x0, y0, x1, y1];
}

function insidePoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function terrainAt(x, y) {
  // 1. Дорога, тротуар или тропинка.
  for (const s of roadGrid.get(Math.floor(x / ROAD_CELL) + ',' + Math.floor(y / ROAD_CELL)) || []) {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t)) <= s.half) return 'road';
  }
  // 2. Участки: что нарисовано сверху, то и под ногами. Лес рисуется самым нижним,
  //    поэтому, если точка ещё и в поле/дворе/лугу, — это не лес.
  let forest = false;
  for (const a of window.MAP_DATA.areas) {
    const [x0, y0, x1, y1] = a.box;
    if (x < x0 || x > x1 || y < y0 || y > y1 || !insidePoly(x, y, a.pts)) continue;
    if (a.holes && a.holes.some((h) => insidePoly(x, y, h))) continue; // поляна внутри леса
    if (a.kind !== 'forest') return 'grass';
    forest = true;
  }
  return forest ? 'forest' : 'grass';
}

// ---------- Игрок ----------
const start = randomStreetPoint(window.MAP_DATA);
const player = {
  x: start.x,
  y: start.y,
  angle: 0,          // куда смотрит, радианы (0 — на восток)
  moving: false,
  running: false,
  step: 0,           // фаза шага — для качания рук
  stamina: STAMINA_MAX,
  terrain: 'road',   // что под ногами: road, grass, forest
  tired: false,      // одышка: бежать нельзя, пока шкала не дойдёт до 30
  effects: {},       // действующие плюшки: { energy: секунд осталось, shoes: ... }
};

function updatePlayer(dt) {
  // Эффекты плюшек тикают и заканчиваются.
  for (const name of Object.keys(player.effects)) {
    player.effects[name] -= dt;
    if (player.effects[name] <= 0) delete player.effects[name];
  }

  // Направление по клавишам: вверх по экрану — это север (y меньше).
  let dx = 0, dy = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;

  player.moving = dx !== 0 || dy !== 0;
  const wantsRun = keys.has('ShiftLeft') || keys.has('ShiftRight');
  player.running = player.moving && wantsRun && !player.tired;

  player.terrain = terrainAt(player.x, player.y);

  // Выносливость: бег тратит (на газоне и в лесу — больше), шаг и отдых восстанавливают.
  if (player.running) {
    let drain = STAMINA_RUN * TERRAIN[player.terrain].drain;
    if (player.effects.energy) drain *= 0.1; // энергетик
    player.stamina = Math.max(0, player.stamina - drain * dt);
    if (player.stamina === 0) player.tired = true;
  } else {
    const regen = player.moving ? STAMINA_WALK : STAMINA_REST;
    player.stamina = Math.min(STAMINA_MAX, player.stamina + regen * dt);
    if (player.tired && player.stamina >= STAMINA_RECOVER) player.tired = false;
  }

  if (!player.moving) return;

  let speed = player.running ? RUN_SPEED : player.tired ? TIRED_SPEED : WALK_SPEED;
  if (player.running && player.effects.shoes) speed *= 1.3; // кроссовки

  // По диагонали не быстрее, чем прямо: делим на длину вектора.
  const len = Math.hypot(dx, dy);
  const dist = speed * dt;
  // Двигаемся маленькими шагами и после каждого выталкиваемся из стен —
  // иначе на бегу можно «проскочить» тонкий забор за один кадр.
  const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  for (let i = 0; i < steps; i++) {
    player.x += ((dx / len) * dist) / steps;
    player.y += ((dy / len) * dist) / steps;
    pushOutOfWalls(player);
  }
  player.angle = Math.atan2(dy, dx);
  player.step += dt * speed * 3.2; // чем быстрее идёшь, тем чаще шаги
}

// Человечек сверху. Крупнее настоящего (×2), иначе на экране он с ноготь.
function drawPlayer(ctx, project) {
  const S = 2;
  const [x, y] = project(player.x, player.y, 1.6); // рисуем на уровне плеч
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(player.angle);
  ctx.scale(S, S);

  // Руки качаются при ходьбе: вперёд-назад вдоль направления движения.
  const swing = player.moving ? Math.sin(player.step) * 0.22 : 0;
  ctx.fillStyle = '#e0b48c'; // кисти
  for (const [side, phase] of [[-1, 1], [1, -1]]) {
    ctx.beginPath();
    ctx.arc(swing * phase + 0.02, side * 0.27, 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  // Плечи (куртка) — эллипс поперёк направления. При одышке плечи «ходят».
  const breath = player.tired ? 1 + Math.sin(performance.now() / 120) * 0.08 : 1;
  ctx.fillStyle = '#c0392b';
  ctx.strokeStyle = '#4a1510';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.14 * breath, 0.25 * breath, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Голова.
  ctx.fillStyle = '#3b2a1e';
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Тень под ногами — на земле, без перспективы.
function drawPlayerShadow(ctx) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(player.x + 0.4, player.y + 0.15, 0.55, 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}
