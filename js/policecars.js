// Полицейские машины: в обычное время ездят в общем потоке (js/traffic.js),
// при тревоге ★★ и ★★★ едут в погоню — с мигалками, кратчайшим путём по улицам.

const POLICE_CAR_COUNT = 20;
const PURSUIT_CARS = [0, 0, 2, 4];     // сколько машин в погоне на уровне тревоги 0..3
const PURSUIT_SPEED = 70 / 3.6;        // м/с — максимум в погоне
const PURSUIT_CORNER_SPEED = 25 / 3.6; // м/с — в крутом повороте
const PURSUIT_ACCEL = 7;               // м/с²
const PURSUIT_BRAKE = 12;              // м/с²
const PURSUIT_TURN = 2.6;              // рад/с — как быстро поворачивает
const PURSUIT_SIGHT = 40;              // м — видят игрока во все стороны (двое в машине)
const PURSUIT_DIRECT = 40;             // м — ближе этого и видят — едут прямо на игрока

// Делаем полицейскими 4 машины, разбросанные по списку (а значит — по карте).
const policeCars = [];
for (let i = 0; i < POLICE_CAR_COUNT && cars.length; i++) {
  const c = cars[Math.floor((i + 0.5) * cars.length / POLICE_CAR_COUNT)];
  c.police = true;
  c.color = '#d9dde2'; // серебристый кузов (синяя полоса и мигалка — в drawCar)
  c.pursuit = false;
  c.path = [];
  c.pathTimer = 0;
  policeCars.push(c);
}

// Видит ли полицейская машина игрока (только в погоне: на 40 м вокруг, если нет стены).
function policeCarSees(c) {
  const dx = player.x - c.x, dy = player.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d > PURSUIT_SIGHT) return false;
  if (rayLength(c.x, c.y, Math.atan2(dy, dx), d) < d - 0.5) return false;
  if (!player.inCar && underTree(player.x, player.y)) return false;
  return true;
}

// Какая полицейская машина сейчас видит игрока (для тревоги в js/police.js).
function policeCarSpotter() {
  if (!policeAlert.chasing) return null;
  return policeCars.find((c) => c.pursuit && policeCarSees(c)) || null;
}

// Повернуть машину к точке и подстроить скорость; движение со столкновениями о стены.
function driveToward(c, tx, ty, targetSpeed, dt) {
  const want = Math.atan2(ty - c.y, tx - c.x);
  let diff = want - c.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const maxTurn = PURSUIT_TURN * Math.min(1, c.speed / 5 + 0.3) * dt;
  c.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
  // Сильно не туда смотрит — сбавляет, чтобы развернуться.
  if (Math.abs(diff) > 1.2) targetSpeed = Math.min(targetSpeed, PURSUIT_CORNER_SPEED * 0.6);
  if (c.speed < targetSpeed) c.speed = Math.min(targetSpeed, c.speed + PURSUIT_ACCEL * dt);
  else c.speed = Math.max(targetSpeed, c.speed - PURSUIT_BRAKE * dt);
  c.braking = c.speed > targetSpeed + 0.5;

  const dist = c.speed * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  for (let i = 0; i < steps; i++) {
    c.x += (Math.cos(c.angle) * dist) / steps;
    c.y += (Math.sin(c.angle) * dist) / steps;
    const [sx, sy] = pushCarOutOfWalls(c);
    if (Math.hypot(sx, sy) > 0.05) c.speed *= 0.8; // задел стену — теряет скорость
  }
}

function pursuitStep(c, dt) {
  const d = Math.hypot(player.x - c.x, player.y - c.y);

  // Близко и видят — прямо на игрока, у самого игрока — тормозят (чтобы встать рядом).
  if (d < PURSUIT_DIRECT && policeCarSees(c)) {
    const target = Math.max(0, Math.min(PURSUIT_SPEED, (d - 3) * 1.2));
    driveToward(c, player.x, player.y, target, dt);
    c.path = [];
    return;
  }

  // Иначе — по улицам кратчайшим путём; путь пересчитываем раз в секунду.
  c.pathTimer -= dt;
  if (!c.path.length || c.pathTimer <= 0) {
    c.path = roadPath(nearestNode(c.x, c.y), nearestNode(player.x, player.y));
    c.pathTimer = 1;
  }
  if (!c.path.length) { driveToward(c, player.x, player.y, PURSUIT_CORNER_SPEED, dt); return; }
  let n = roadGraph.get(c.path[0]);
  if (Math.hypot(n.x - c.x, n.y - c.y) < 6 && c.path.length > 1) {
    c.path.shift();
    n = roadGraph.get(c.path[0]);
  }
  // Перед крутым поворотом на следующем узле — притормаживаем.
  let target = PURSUIT_SPEED;
  if (c.path.length > 1) {
    const m = roadGraph.get(c.path[1]);
    const a1 = Math.atan2(n.y - c.y, n.x - c.x), a2 = Math.atan2(m.y - n.y, m.x - n.x);
    const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
    if (turn > 0.7 && Math.hypot(n.x - c.x, n.y - c.y) < 25) target = PURSUIT_CORNER_SPEED;
  }
  driveToward(c, n.x, n.y, target, dt);
}

// Погоня кончилась — машина возвращается в общий поток: едет к ближайшей улице.
function leavePursuit(c) {
  c.pursuit = false;
  c.path = [];
  const k = nearestNode(c.x, c.y);
  const node = roadGraph.get(k);
  const next = node.next.find((m) => drivable(k, m)) || node.next[0];
  c.from = next;
  c.to = k;
  c.speed = Math.min(c.speed, c.cruise);
}

function updatePoliceCars(dt) {
  // Сколько машин должно быть в погоне сейчас — добавляем ближайших к игроку.
  const need = policeAlert.chasing ? PURSUIT_CARS[policeAlert.level] : 0;
  let active = policeCars.filter((c) => c.pursuit).length;
  if (active < need) {
    const free = policeCars.filter((c) => !c.pursuit)
      .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
    for (const c of free) {
      if (active >= need) break;
      c.pursuit = true;
      c.path = [];
      c.pathTimer = 0;
      active++;
    }
  }
  if (need === 0) for (const c of policeCars) if (c.pursuit) leavePursuit(c);

  for (const c of policeCars) {
    if (!c.pursuit) continue;
    pursuitStep(c, dt);
    ramPlayer(c, dt);
    if (game.state !== 'play') return;
  }
}

// Таран и урон: полицейская машина бьёт на POLICE_CAR_DAMAGE, не чаще раза в 1,5 с.
const POLICE_CAR_DAMAGE = 15;
function ramPlayer(c, dt) {
  c.hitCooldown = Math.max(0, (c.hitCooldown || 0) - dt);
  const car = player.inCar;
  if (!car) {
    // Пешком: наехала — отбрасывает на 2 м.
    if (distToCar(c, player.x, player.y) < 1.2 && c.hitCooldown <= 0) {
      const ax = player.x - c.x, ay = player.y - c.y, al = Math.hypot(ax, ay) || 1;
      player.x += (ax / al) * 2;
      player.y += (ay / al) * 2;
      pushOutOfWalls(player);
      c.hitCooldown = 1.5;
      damagePlayer(POLICE_CAR_DAMAGE);
    }
    return;
  }
  const dx = car.x - c.x, dy = car.y - c.y;
  const d = Math.hypot(dx, dy);
  const rammed = d < 3.2;
  if (rammed) {
    // Таран: твою машину толкает, она теряет скорость.
    const push = (3.2 - d) / (d || 1);
    car.x += dx * push * 0.5;
    car.y += dy * push * 0.5;
    car.vx *= 0.5;
    car.vy *= 0.5;
    c.speed *= 0.5;
  }
  // Зажали: ты почти стоишь, а полицейская машина рядом и тоже почти стоит.
  const pinned = d < 6 && Math.hypot(car.vx, car.vy) < 1.5 && c.speed < 3;
  if ((rammed || pinned) && c.hitCooldown <= 0) {
    c.hitCooldown = 1.5;
    damagePlayer(POLICE_CAR_DAMAGE);
  }
}
