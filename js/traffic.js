// Машины: ездят по правой полосе улиц, сворачивают на перекрёстках,
// тормозят перед машиной впереди и перед людьми. Если всё же сбила — отбрасывает.
// Улицы — та же сеть, что у полиции (roadGraph из js/police.js).

const CAR_COUNT = 40;
const CAR_LENGTH = 4.4;               // м
const CAR_WIDTH = 1.9;                // м
const CAR_MIN_SPEED = 30 / 3.6;       // м/с (30 км/ч)
const CAR_MAX_SPEED = 50 / 3.6;       // м/с (50 км/ч)
const CAR_ACCEL = 3;                  // м/с² — разгон
const CAR_BRAKE = 8;                  // м/с² — торможение
const CAR_LOOK_AHEAD = 16;            // м — на сколько вперёд смотрит водитель
const CAR_MIN_ROAD = 5;               // м — по более узким (проезды во дворы) не ездят
const CAR_COLORS = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#2980b9', '#27ae60', '#f1c40f', '#8e44ad', '#d35400', '#1a1a1a'];

// Перекрёстки: главная дорога (K 52 — единственная «secondary», ширина 9 м) едет без остановки;
// с остальных уступают главной, а между собой — по правилу правой руки.
const MAIN_ROAD_WIDTH = 9;      // м — улицы такой ширины и шире считаются главной дорогой
const YIELD_LOOK = 20;          // м — за сколько до перекрёстка смотреть, кому уступить
const STOP_BEFORE = 6;          // м — где встать, уступая (до центра перекрёстка)
const MAX_WAIT = 3;             // с — дольше не ждём: едем (иначе вечная пробка)

// Можно ли машине ехать по участку from → to.
const drivable = (from, to) => (roadGraph.get(from).width[to] || 0) >= CAR_MIN_ROAD;

// Точка на правой полосе участка from → to (в доле k от начала).
function lanePoint(fromKey, toKey, k = 1) {
  const A = roadGraph.get(fromKey), B = roadGraph.get(toKey);
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = (A.width[toKey] || 6) / 4; // середина правой половины дороги
  return { x: A.x + dx * k - (dy / len) * off, y: A.y + dy * k + (dx / len) * off };
}

// ---------- Расстановка: равномерно по улицам, где ездят машины ----------
const cars = [];
{
  // Границы карты — по домам с запасом 150 м (дороги в данных тянутся дальше карты).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of window.MAP_DATA.buildings) {
    for (const [x, y] of b.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  x0 -= 150; y0 -= 150; x1 += 150; y1 += 150;

  const edges = [];
  let total = 0;
  for (const [k, n] of roadGraph) {
    for (const k2 of n.next) {
      if (k2 <= k || !drivable(k, k2)) continue;
      const m = roadGraph.get(k2);
      const mx = (n.x + m.x) / 2, my = (n.y + m.y) / 2;
      if (mx < x0 || mx > x1 || my < y0 || my > y1) continue;
      const len = Math.hypot(m.x - n.x, m.y - n.y);
      if (len < 1) continue;
      edges.push({ a: k, b: k2, len, start: total });
      total += len;
    }
  }
  const spacing = total / CAR_COUNT;
  let e = 0;
  for (let i = 0; i < CAR_COUNT; i++) {
    const at = (i + 0.5 + (Math.random() - 0.5) * 0.6) * spacing;
    while (e < edges.length - 1 && edges[e].start + edges[e].len < at) e++;
    const edge = edges[e];
    const k = Math.min(1, Math.max(0, (at - edge.start) / edge.len));
    const [from, to] = Math.random() < 0.5 ? [edge.a, edge.b] : [edge.b, edge.a];
    const p = lanePoint(from, to, k);
    if (Math.hypot(p.x - player.x, p.y - player.y) < 30) continue; // не на старте игрока
    const A = roadGraph.get(from), B = roadGraph.get(to);
    const cruise = CAR_MIN_SPEED + Math.random() * (CAR_MAX_SPEED - CAR_MIN_SPEED);
    cars.push({
      x: p.x, y: p.y, from, to,
      angle: Math.atan2(B.y - A.y, B.x - A.x),
      speed: cruise, cruise,
      color: CAR_COLORS[i % CAR_COLORS.length],
      braking: false,
      wait: 0, // сколько секунд стоит, уступая на перекрёстке
    });
  }
}

// Кто стоит на пути машины: расстояние вперёд до ближайшего препятствия (или Infinity).
// Препятствие — точка не дальше 1,6 м вбок от оси машины и впереди неё.
function obstacleAhead(c) {
  const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
  let best = Infinity;
  const check = (x, y, sideGap) => {
    const dx = x - c.x, dy = y - c.y;
    const ahead = dx * fx + dy * fy;              // вперёд по ходу
    if (ahead <= 0 || ahead > CAR_LOOK_AHEAD + CAR_LENGTH) return;
    const side = Math.abs(-dx * fy + dy * fx);    // вбок от оси
    if (side < sideGap) best = Math.min(best, ahead);
  };
  // Машины — только попутные (иначе на перекрёстке двое могут ждать друг друга вечно).
  // Твою машину не считаем здесь — она проверяется ниже как «игрок».
  // Брошенные машины тоже пропускаем: иначе за ними выстроится вечная очередь.
  for (const o of cars) {
    if (o === c || o.driver === 'player' || o.parked) continue;
    if (Math.cos(o.angle - c.angle) > 0.3) check(o.x, o.y, 1.6);
  }
  check(player.x, player.y, 2.0);
  for (const p of cops) {
    if (Math.abs(p.x - c.x) < 25 && Math.abs(p.y - c.y) < 25) check(p.x, p.y, 2.0);
  }
  return best;
}

// Сколько машине осталось до центра перекрёстка (конца участка).
function distToNode(c) {
  const n = roadGraph.get(c.to);
  return Math.hypot(n.x - c.x, n.y - c.y);
}

// Должна ли машина уступить на ближайшем перекрёстке.
function mustYield(c) {
  const node = roadGraph.get(c.to);
  if (node.next.length < 3) return false;           // не перекрёсток
  const d = distToNode(c);
  if (d > YIELD_LOOK || d < STOP_BEFORE) return false; // далеко или уже въехала
  if (c.wait > MAX_WAIT) return false;             // ждала долго — едет
  const myMain = (roadGraph.get(c.from).width[c.to] || 0) >= MAIN_ROAD_WIDTH;
  if (myMain) return false;                        // на главной — едет
  for (const o of cars) {
    if (o === c || o.to !== c.to) continue;        // подъезжает к другому перекрёстку
    if (distToNode(o) > YIELD_LOOK) continue;
    const otherMain = (roadGraph.get(o.from).width[o.to] || 0) >= MAIN_ROAD_WIDTH;
    if (otherMain) return true;                    // уступаем главной
    // Справа ли она: её курс повёрнут на ~90° «влево» от моего (на экране y вниз,
    // поэтому машина справа едет с разницей курса около −90°).
    if (Math.sin(o.angle - c.angle) < -0.5) return true;
  }
  return false;
}

function updateTraffic(dt) {
  for (const c of cars) {
    // Твоя машина (ведёшь ты — js/driving.js) и брошенные сами не ездят.
    if (c.driver === 'player' || c.parked) continue;
    // Уступаем на перекрёстке — «препятствие» в точке остановки перед ним.
    let gap = obstacleAhead(c) - CAR_LENGTH;
    if (mustYield(c)) {
      gap = Math.min(gap, distToNode(c) - STOP_BEFORE);
      if (c.speed < 0.5) c.wait += dt;              // стоит и ждёт
    }
    // Тормоз, если впереди кто-то ближе, чем нужно для остановки (+ запас).
    const stopDist = (c.speed * c.speed) / (2 * CAR_BRAKE) + 3;
    c.braking = gap < stopDist;
    if (c.braking) c.speed = Math.max(0, c.speed - CAR_BRAKE * dt);
    else c.speed = Math.min(c.cruise, c.speed + CAR_ACCEL * dt);

    // Едем к концу участка по правой полосе; доехали — выбираем, куда дальше.
    let move = c.speed * dt;
    for (let guard = 0; move > 0 && guard < 10; guard++) {
      const t = lanePoint(c.from, c.to);
      const dx = t.x - c.x, dy = t.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > move) {
        c.x += (dx / d) * move;
        c.y += (dy / d) * move;
        // Поворот кузова плавный — машина не «щёлкает» на углах.
        let diff = Math.atan2(dy, dx) - c.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.angle += diff * Math.min(1, dt * 6);
        move = 0;
      } else {
        c.x = t.x;
        c.y = t.y;
        move -= d;
        const node = roadGraph.get(c.to);
        const options = node.next.filter((k) => k !== c.from && drivable(c.to, k));
        const choices = options.length ? options : [c.from]; // тупик — разворот
        c.from = c.to;
        c.to = choices[Math.floor(Math.random() * choices.length)];
        c.wait = 0; // проехали перекрёсток — ожидание сбрасывается
      }
    }

    hitPlayer(c);
  }
  pushPlayerOutOfCars();
}

// Расстояние от точки до кузова машины (0 — внутри).
function distToCar(c, x, y) {
  const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
  const dx = x - c.x, dy = y - c.y;
  const along = Math.max(0, Math.abs(dx * fx + dy * fy) - CAR_LENGTH / 2);
  const side = Math.max(0, Math.abs(-dx * fy + dy * fx) - CAR_WIDTH / 2);
  return Math.hypot(along, side);
}

// Сбила: если едет быстрее 3 м/с и задела игрока — отбрасывает в сторону, выносливость в ноль.
function hitPlayer(c) {
  if (player.inCar) return; // в машине — не сбить
  if (c.speed < 3 || distToCar(c, player.x, player.y) > PLAYER_RADIUS) return;
  const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
  const dx = player.x - c.x, dy = player.y - c.y;
  const side = -dx * fy + dy * fx >= 0 ? 1 : -1; // в какую сторону от машины игрок
  player.x += (-fy * side) * 3 + fx * 1.5;
  player.y += (fx * side) * 3 + fy * 1.5;
  pushOutOfWalls(player);
  player.stamina = 0;
  player.tired = true;
  c.speed = 0;
  pickupMessage.text = '💥 Сбила машина!';
  pickupMessage.time = 2;
}

// Сквозь машину не пройти: выталкиваем игрока из кузова.
function pushPlayerOutOfCars() {
  if (player.inCar) return;
  for (const c of cars) {
    if (Math.abs(c.x - player.x) > 5 || Math.abs(c.y - player.y) > 5) continue;
    const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
    const dx = player.x - c.x, dy = player.y - c.y;
    const along = dx * fx + dy * fy, side = -dx * fy + dy * fx;
    const ha = CAR_LENGTH / 2 + PLAYER_RADIUS, hs = CAR_WIDTH / 2 + PLAYER_RADIUS;
    if (Math.abs(along) >= ha || Math.abs(side) >= hs) continue;
    // Выталкиваем в ту сторону, куда ближе выйти.
    if (ha - Math.abs(along) < hs - Math.abs(side)) {
      const push = (ha - Math.abs(along)) * Math.sign(along || 1);
      player.x += fx * push; player.y += fy * push;
    } else {
      const push = (hs - Math.abs(side)) * Math.sign(side || 1);
      player.x += -fy * push; player.y += fx * push;
    }
  }
}

// Машина сверху: кузов, крыша, стёкла, фары. Стоп-сигналы ярче при торможении.
function drawCar(ctx, project, c) {
  const [x, y] = project(c.x, c.y, 1.0);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(c.angle);
  const L = CAR_LENGTH / 2, W = CAR_WIDTH / 2;
  // Кузов со скруглёнными углами.
  ctx.fillStyle = c.color;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.roundRect(-L, -W, L * 2, W * 2, 0.45);
  ctx.fill();
  ctx.stroke();
  // Лобовое и заднее стекло, крыша между ними.
  ctx.fillStyle = '#1d2a33';
  ctx.beginPath(); ctx.roundRect(0.35, -W + 0.18, 0.75, W * 2 - 0.36, 0.15); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-1.35, -W + 0.22, 0.5, W * 2 - 0.44, 0.12); ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath(); ctx.roundRect(-0.85, -W + 0.2, 1.2, W * 2 - 0.4, 0.15); ctx.fill();
  // Фары и стоп-сигналы.
  ctx.fillStyle = '#fff6c0';
  ctx.fillRect(L - 0.12, -W + 0.15, 0.12, 0.4);
  ctx.fillRect(L - 0.12, W - 0.55, 0.12, 0.4);
  ctx.fillStyle = c.braking ? '#ff2a1a' : '#8a1a12';
  ctx.fillRect(-L, -W + 0.15, 0.12, 0.4);
  ctx.fillRect(-L, W - 0.55, 0.12, 0.4);
  ctx.restore();
}

function drawCars(ctx, project) {
  for (const c of cars) {
    if (Math.abs(c.x - player.x) > 120 || Math.abs(c.y - player.y) > 120) continue;
    // Тень — на земле, чуть сдвинута по солнцу.
    ctx.save();
    ctx.translate(c.x + 0.6, c.y + 0.25);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.roundRect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 0.45);
    ctx.fill();
    ctx.restore();
    drawCar(ctx, project, c);
  }
}
