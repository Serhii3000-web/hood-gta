// Полиция: патруль, конус обзора, тревога и погоня.
// Дома, заборы и изгороди закрывают обзор. Под кроной дерева игрока не видно.

const POLICE_COUNT = 250;
const PATROL_SPEED = 1.4;              // м/с — спокойный патруль
const CHASE_SPEED = 4.0;               // м/с — бег за игроком (игрок бегает 4,5)
const SEARCH_SPEED = 2.8;              // м/с — прочёсывание улиц
const VIEW_RANGE = 25;                 // м — дальность обзора
const VIEW_HALF_ANGLE = (35 * Math.PI) / 180; // половина угла конуса (весь конус 70°)
const VIEW_RAYS = 30;                  // сколько лучей для рисования конуса
const CATCH_DISTANCE = 1.0;            // м — ближе этого: поймали

// Уровни тревоги: радиус погони, через сколько секунд отбой, сколько полицейских гонится.
const ALERT_LEVELS = [
  null,
  { radius: 60, timeout: 15, chasers: 2 },
  { radius: 100, timeout: 30, chasers: 4 },
  { radius: 150, timeout: 45, chasers: POLICE_COUNT },
];
const CALM_DOWN_TIME = 30; // с спокойствия после погони — тревога снижается на 1

// ---------- Сеть улиц для патруля и поиска ----------
// Узлы — точки улиц, рёбра — участки между ними. Улицы OSM сходятся
// в общих точках, поэтому одинаковые координаты = перекрёсток.
const roadGraph = new Map(); // ключ "x,y" → { x, y, next: [ключи соседей], width: {сосед: ширина улицы} }
{
  const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  for (const r of window.MAP_DATA.roads) {
    if (r.w < 4 || r.w > 10) continue; // улицы, без тропинок и автобана
    for (let i = 0; i < r.pts.length; i++) {
      const k = key(r.pts[i]);
      if (!roadGraph.has(k)) roadGraph.set(k, { x: r.pts[i][0], y: r.pts[i][1], next: [], width: {} });
      if (i > 0) {
        const prev = key(r.pts[i - 1]);
        roadGraph.get(k).next.push(prev);
        roadGraph.get(prev).next.push(k);
        roadGraph.get(k).width[prev] = r.w;
        roadGraph.get(prev).width[k] = r.w;
      }
    }
  }
}

// Точка на правом тротуаре участка from → to (у конца участка или в доле k от начала).
// Тротуар (js/render.js) — полоса SIDEWALK_WIDTH за краем улицы; идём по её середине.
// Где тротуара нет (узкий проезд) — у правого края проезда.
function sidewalkPoint(fromKey, toKey, k = 1) {
  const A = roadGraph.get(fromKey), B = roadGraph.get(toKey);
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const w = A.width[toKey] || 6;
  const off = w / 2 + (hasSidewalk(w) ? SIDEWALK_WIDTH / 2 : 0.6);
  // Справа по ходу движения: на экране (y вниз) это (-dy, dx).
  const nx = -dy / len, ny = dx / len;
  return { x: A.x + dx * k + nx * off, y: A.y + dy * k + ny * off };
}

function nearestNode(x, y) {
  let best = null, bestD = Infinity;
  for (const [k, n] of roadGraph) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

// Кратчайший путь по улицам (поиск в ширину): список ключей узлов от from до to.
function roadPath(from, to) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const k = queue.shift();
    if (k === to) break;
    for (const n of roadGraph.get(k).next) {
      if (!prev.has(n)) { prev.set(n, k); queue.push(n); }
    }
  }
  if (!prev.has(to)) return [];
  const path = [];
  for (let k = to; k !== null; k = prev.get(k)) path.unshift(k);
  return path;
}

// ---------- Деревья рядом (для «спрятался под кроной») ----------
const TREE_CELL = 10;
const treeGrid = new Map();
window.MAP_DATA.trees.forEach(([x, y], i) => {
  const k = Math.floor(x / TREE_CELL) + ',' + Math.floor(y / TREE_CELL);
  if (!treeGrid.has(k)) treeGrid.set(k, []);
  treeGrid.get(k).push(i);
});

// Стоит ли точка под кроной (не у самого края — там листва редкая).
function underTree(x, y) {
  const map = window.MAP_DATA;
  const ci = Math.floor(x / TREE_CELL), cj = Math.floor(y / TREE_CELL);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (const t of treeGrid.get(i + ',' + j) || []) {
        const [tx, ty] = map.trees[t];
        if (Math.hypot(tx - x, ty - y) < map.treeInfo[t].r * 0.8) return true;
      }
    }
  }
  return false;
}

// ---------- Прямая видимость ----------
// Луч из (x, y) в направлении angle: на каком расстоянии он упрётся в стену
// (стены — из js/player.js, та же сетка, что для столкновений).
function rayLength(x, y, angle, maxLen) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = maxLen;
  const seen = new Set();
  // Идём вдоль луча шагами по 2 м и проверяем стены в клетках сетки по пути.
  for (let t = 0; t <= maxLen + 2; t += 2) {
    const k = Math.floor((x + dx * t) / WALL_CELL) + ',' + Math.floor((y + dy * t) / WALL_CELL);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const s of wallGrid.get(k) || []) {
      // Пересечение луча с отрезком стены.
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue; // параллельны
      const ux = s.ax - x, uy = s.ay - y;
      const tRay = (ux * ey - uy * ex) / den;
      const tSeg = (ux * dy - uy * dx) / den;
      if (tRay > 0 && tRay < best && tSeg >= 0 && tSeg <= 1) best = tRay;
    }
    if (best < t) break; // ближе стены уже не будет
  }
  return best;
}

// Видит ли полицейский игрока.
function copSeesPlayer(c) {
  const dx = player.x - c.x, dy = player.y - c.y;
  const dist = Math.hypot(dx, dy);
  if (dist > VIEW_RANGE) return false;
  // Угол между взглядом и направлением на игрока.
  let diff = Math.atan2(dy, dx) - c.look;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // в пределах -π..π
  if (Math.abs(diff) > VIEW_HALF_ANGLE) return false;
  if (rayLength(c.x, c.y, Math.atan2(dy, dx), dist) < dist - 0.3) return false; // стена между
  if (underTree(player.x, player.y)) return false; // спрятался в листве
  return true;
}

// ---------- Тревога ----------
const policeAlert = {
  level: 0,         // 0 — спокойно, 1..3 — звёздочки
  chasing: false,   // идёт погоня
  escapeTimer: 0,   // сколько секунд игрок вне радиуса и не виден
  calm: 0,          // сколько секунд спокойствия после погони
  unseen: 99,       // сколько секунд игрока никто не видит
  lastSeen: null,   // где игрока видели последний раз
};
let playerSpotted = false;   // видит ли игрока хоть один полицейский

// ---------- Полицейские ----------
// Режимы: patrol — гуляет по улицам; chase — видит игрока и бежит к нему;
// search — ищет: бежит к месту, где видел, потом прочёсывает улицы рядом;
// return — погоня кончилась, возвращается на улицу.
const cops = [];

// Расстановка равномерно по всем улицам карты: выстраиваем все участки улиц
// в одну длинную линию и ставим полицейских через равные промежутки вдоль неё.
{
  // Границы карты — по домам с запасом 150 м (дороги в данных тянутся дальше карты).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of window.MAP_DATA.buildings) {
    for (const [x, y] of b.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  x0 -= 150; y0 -= 150; x1 += 150; y1 += 150;

  // Все участки улиц (каждый по одному разу), середина которых внутри карты.
  const edges = [];
  let total = 0;
  for (const [k, n] of roadGraph) {
    for (const k2 of n.next) {
      if (k2 <= k) continue; // участок A–B и B–A — один и тот же
      const m = roadGraph.get(k2);
      const mx = (n.x + m.x) / 2, my = (n.y + m.y) / 2;
      if (mx < x0 || mx > x1 || my < y0 || my > y1) continue;
      const len = Math.hypot(m.x - n.x, m.y - n.y);
      if (len < 0.01) continue;
      edges.push({ a: k, b: k2, len, start: total });
      total += len;
    }
  }

  const spacing = total / POLICE_COUNT;
  let e = 0;
  for (let i = 0; i < POLICE_COUNT; i++) {
    // Точка на «линии»: равный шаг + небольшой случайный сдвиг, чтобы не строем.
    const at = (i + 0.5 + (Math.random() - 0.5) * 0.6) * spacing;
    while (e < edges.length - 1 && edges[e].start + edges[e].len < at) e++;
    const edge = edges[e];
    const k = Math.min(1, Math.max(0, (at - edge.start) / edge.len));
    // Случайно — в какую сторону по улице пойдёт.
    const [from, to] = Math.random() < 0.5 ? [edge.a, edge.b] : [edge.b, edge.a];
    const A = roadGraph.get(from), B = roadGraph.get(to);
    const { x, y } = sidewalkPoint(from, to, k); // сразу на тротуаре
    if (Math.hypot(x - player.x, y - player.y) < 60) continue; // не у старта игрока
    cops.push({
      x, y,
      mode: 'patrol',
      from, to,               // патруль: идёт к узлу «to», пришёл из «from»
      path: [], target: null, // поиск: путь по улицам или точка
      angle: Math.atan2(B.y - A.y, B.x - A.x), look: 0, // куда идёт и куда смотрит
      phase: Math.random() * 10,
      step: 0,
      sees: false,
      pathTimer: 0,
    });
  }
  console.log(`Полиция: ${cops.length} человек, примерно каждые ${spacing.toFixed(0)} м улицы (всего улиц ${(total / 1000).toFixed(1)} км)`);
}

// Шаг к точке. Вне улиц (погоня, поиск) — со столкновениями, как у игрока.
// Возвращает true, если дошёл.
function moveToward(c, tx, ty, speed, dt, collide) {
  const dx = tx - c.x, dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return true;
  const dist = Math.min(d, speed * dt);
  c.angle = Math.atan2(dy, dx);
  const steps = collide ? Math.max(1, Math.ceil(dist / MAX_SUBSTEP)) : 1;
  for (let i = 0; i < steps; i++) {
    c.x += ((dx / d) * dist) / steps;
    c.y += ((dy / d) * dist) / steps;
    if (collide) pushOutOfWalls(c);
  }
  c.step += dt * speed * 3.2;
  return dist >= d - 0.05;
}

function patrolStep(c, dt) {
  let move = PATROL_SPEED * dt;
  // Идём по правому тротуару к концу участка; дошли — выбираем, куда дальше.
  // На перекрёстке путь срезает угол к тротуару следующей улицы.
  for (let guard = 0; move > 0 && guard < 10; guard++) {
    const node = roadGraph.get(c.to);
    // После возвращения из погони «откуда» не известно — идём прямо в точку улицы.
    const target = c.from ? sidewalkPoint(c.from, c.to) : node;
    const dx = target.x - c.x, dy = target.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > move) {
      c.x += (dx / d) * move;
      c.y += (dy / d) * move;
      c.angle = Math.atan2(dy, dx);
      move = 0;
    } else {
      c.x = target.x;
      c.y = target.y;
      move -= d;
      // На перекрёстке — любой путь, кроме обратного (если есть выбор).
      // В тупике разворот — и он сам перейдёт на тротуар другой стороны.
      const options = node.next.filter((k) => k !== c.from);
      const choices = options.length ? options : node.next;
      c.from = c.to;
      c.to = choices[Math.floor(Math.random() * choices.length)];
    }
  }
  c.step += dt * PATROL_SPEED * 3.2;
}

// Поиск: сначала к месту, где видели, потом по улицам туда, где игрок «примерно» есть
// (полиция знает район, но не точку: цель — со случайным сдвигом до 25 м, обновляется раз в 6 с).
function searchStep(c, dt) {
  if (c.target) {
    if (moveToward(c, c.target.x, c.target.y, SEARCH_SPEED, dt, true)) c.target = null;
    return;
  }
  c.pathTimer -= dt;
  if (!c.path.length || c.pathTimer <= 0) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 25;
    c.path = roadPath(nearestNode(c.x, c.y), nearestNode(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r));
    c.pathTimer = 6;
    if (!c.path.length) return;
  }
  const n = roadGraph.get(c.path[0]);
  if (moveToward(c, n.x, n.y, SEARCH_SPEED, dt, true)) c.path.shift();
}

// Погоня кончилась — к ближайшей точке улицы, дальше обычный патруль.
function returnStep(c, dt) {
  if (!c.target) {
    const k = nearestNode(c.x, c.y);
    c.target = { x: roadGraph.get(k).x, y: roadGraph.get(k).y, node: k };
  }
  if (moveToward(c, c.target.x, c.target.y, PATROL_SPEED, dt, true)) {
    c.mode = 'patrol';
    c.to = c.target.node;
    c.from = null;
    c.target = null;
  }
}

// Тревога: кто-то заметил игрока.
function raiseAlert(spotter) {
  const isNewSighting = policeAlert.unseen > 2; // игрока не видели больше 2 с — это «новое заметили»
  if (!policeAlert.chasing) {
    policeAlert.chasing = true;
    policeAlert.level = Math.max(1, policeAlert.level);
  } else if (isNewSighting) {
    policeAlert.level = Math.min(3, policeAlert.level + 1);
  }
  policeAlert.calm = 0;
  // В погоню идёт заметивший и ближайшие к нему — сколько положено по уровню.
  const L = ALERT_LEVELS[policeAlert.level];
  const sorted = cops.slice().sort((a, b) =>
    Math.hypot(a.x - spotter.x, a.y - spotter.y) - Math.hypot(b.x - spotter.x, b.y - spotter.y));
  let busy = cops.filter((c) => c.mode === 'chase' || c.mode === 'search').length;
  for (const c of sorted) {
    if (busy >= L.chasers) break;
    if (c.mode === 'patrol' || c.mode === 'return') {
      c.mode = 'search';
      c.target = { x: policeAlert.lastSeen.x, y: policeAlert.lastSeen.y };
      c.path = [];
      busy++;
    }
  }
}

function endChase() {
  policeAlert.chasing = false;
  policeAlert.escapeTimer = 0;
  for (const c of cops) {
    if (c.mode !== 'patrol') { c.mode = 'return'; c.target = null; c.path = []; }
  }
}

function updatePolice(dt) {
  playerSpotted = false;
  let spotter = null;

  for (const c of cops) {
    if (c.mode === 'patrol') patrolStep(c, dt);
    else if (c.mode === 'chase') moveToward(c, player.x, player.y, CHASE_SPEED, dt, true);
    else if (c.mode === 'search') searchStep(c, dt);
    else if (c.mode === 'return') returnStep(c, dt);

    c.phase += dt;
    // Смотрит по ходу движения и поводит головой; в погоне — прямо на игрока.
    c.look = c.mode === 'chase' ? c.angle : c.angle + Math.sin(c.phase * (c.mode === 'search' ? 2 : 0.9)) * 0.5;
    c.sees = copSeesPlayer(c);
    if (c.sees) {
      playerSpotted = true;
      spotter = spotter || c;
      if (policeAlert.chasing && c.mode !== 'patrol' && c.mode !== 'return') c.mode = 'chase';
    } else if (c.mode === 'chase') {
      // Потерял из виду — бежит туда, где видел последний раз.
      c.mode = 'search';
      c.target = { x: policeAlert.lastSeen.x, y: policeAlert.lastSeen.y };
    }
  }

  if (playerSpotted) {
    policeAlert.lastSeen = { x: player.x, y: player.y };
    raiseAlert(spotter);
    if (spotter.mode !== 'chase') spotter.mode = 'chase';
    policeAlert.unseen = 0;
  } else {
    policeAlert.unseen += dt;
  }

  if (policeAlert.chasing) {
    // Поймали?
    for (const c of cops) {
      if ((c.mode === 'chase' || c.mode === 'search') && Math.hypot(c.x - player.x, c.y - player.y) < CATCH_DISTANCE) {
        caught();
        return;
      }
    }
    // Оторвался: дальше радиуса от всех преследователей и никто не видит — тикает таймер отбоя.
    const L = ALERT_LEVELS[policeAlert.level];
    const chasers = cops.filter((c) => c.mode === 'chase' || c.mode === 'search');
    const far = chasers.every((c) => Math.hypot(c.x - player.x, c.y - player.y) > L.radius);
    if (!playerSpotted && far) {
      policeAlert.escapeTimer += dt;
      if (policeAlert.escapeTimer >= L.timeout) endChase();
    } else {
      policeAlert.escapeTimer = 0;
    }
  } else if (policeAlert.level > 0) {
    // Спокойствие после погони: каждые 30 с тревога снижается на одну звёздочку.
    policeAlert.calm += dt;
    if (policeAlert.calm >= CALM_DOWN_TIME) { policeAlert.level--; policeAlert.calm = 0; }
  }
}

// Поймали — игра окончена (окно «ПОЙМАН!» — в js/game.js).
function caught() {
  gameOver('caught');
}

// Конус обзора на земле: лучи обрываются на стенах.
// Жёлтый — патруль, оранжевый — ищет, красный — видит тебя.
function drawViewCones(ctx) {
  for (const c of cops) {
    if (Math.hypot(c.x - player.x, c.y - player.y) > 120) continue; // далеко — не рисуем
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    for (let i = 0; i <= VIEW_RAYS; i++) {
      const a = c.look - VIEW_HALF_ANGLE + (2 * VIEW_HALF_ANGLE * i) / VIEW_RAYS;
      const len = rayLength(c.x, c.y, a, VIEW_RANGE);
      ctx.lineTo(c.x + Math.cos(a) * len, c.y + Math.sin(a) * len);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, VIEW_RANGE);
    const col = c.sees ? '255, 60, 40' : c.mode === 'search' ? '255, 160, 40' : '255, 240, 150';
    g.addColorStop(0, `rgba(${col}, 0.45)`);
    g.addColorStop(1, `rgba(${col}, 0.05)`);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// Полицейский сверху — как игрок, но в синей форме и фуражке.
function drawCop(ctx, project, c) {
  const S = 2;
  const [x, y] = project(c.x, c.y, 1.6);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(c.angle);
  ctx.scale(S, S);
  const swing = Math.sin(c.step) * 0.22;
  ctx.fillStyle = '#e0b48c';
  for (const [side, phase] of [[-1, 1], [1, -1]]) {
    ctx.beginPath();
    ctx.arc(swing * phase + 0.02, side * 0.27, 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1f3f8a';
  ctx.strokeStyle = '#0c1a3a';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.14, 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Фуражка: тёмно-синяя с белым кантом.
  ctx.fillStyle = '#16264f';
  ctx.strokeStyle = '#ddd';
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPolice(ctx, project) {
  for (const c of cops) {
    if (Math.hypot(c.x - player.x, c.y - player.y) > 120) continue;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(c.x + 0.4, c.y + 0.15, 0.55, 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    drawCop(ctx, project, c);
  }
}
