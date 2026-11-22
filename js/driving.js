// Вождение: сесть в машину (E), рулить, газ/тормоз, ручник с заносом, выйти (E).
// Водитель угнанной машины выскакивает и убегает.

const DRIVE = {
  maxSpeed: 60 / 3.6,      // м/с — по дороге
  reverseMax: 18 / 3.6,    // м/с — задним ходом
  accel: 6,                // м/с² — разгон
  brake: 12,               // м/с² — тормоз
  drag: 1.5,               // м/с² — сама замедляется без газа
  steer: 2.4,              // рад/с — как быстро поворачивает
  grip: 8,                 // сцепление: насколько быстро гасится занос
  handbrakeGrip: 1.2,      // сцепление с ручником — машину заносит
};
// Во сколько раз медленнее вне дороги (земля под машиной — terrainAt из js/player.js).
const DRIVE_TERRAIN = { road: 1, grass: 0.55, forest: 0.25 };
const ENTER_DISTANCE = 1.5;   // м — насколько близко к машине, чтобы сесть
const EXIT_MAX_SPEED = 2;     // м/с — выйти можно только почти на месте
const CAR_CORNER_R = 0.95;    // м — машина для столкновений = два круга (перед и зад)
const CAR_CORNER_OFF = 1.25;  // м — центры кругов от середины машины

const runners = []; // водители угнанных машин, которые убегают

// Ближайшая машина, в которую можно сесть.
function carToEnter() {
  let best = null, bestD = ENTER_DISTANCE;
  for (const c of cars) {
    if (c.driver === 'player') continue;
    const d = distToCar(c, player.x, player.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || e.repeat || game.state !== 'play') return;
  if (player.inCar) exitCar();
  else enterCar();
});

function enterCar() {
  const c = carToEnter();
  if (!c) return;
  // Водитель (если машина не брошенная) выскакивает с другой стороны и убегает от тебя.
  if (!c.parked) {
    const away = Math.atan2(c.y - player.y, c.x - player.x);
    runners.push({ x: c.x, y: c.y, angle: away, time: 5, step: 0 });
  }
  c.driver = 'player';
  c.parked = false;
  c.speed = 0;
  c.vx = 0;
  c.vy = 0;
  c.braking = false;
  player.inCar = c;
  player.x = c.x;
  player.y = c.y;
  pickupMessage.text = '🚗 Ты за рулём!';
  pickupMessage.time = 1.5;
}

function exitCar() {
  const c = player.inCar;
  if (Math.hypot(c.vx, c.vy) > EXIT_MAX_SPEED) {
    pickupMessage.text = 'Сначала остановись';
    pickupMessage.time = 1.2;
    return;
  }
  // Выходим слева от машины (дверь водителя). Слева по ходу на экране (y вниз) — (sin, −cos).
  const side = CAR_WIDTH / 2 + PLAYER_RADIUS + 0.2;
  player.x = c.x + Math.sin(c.angle) * side;
  player.y = c.y - Math.cos(c.angle) * side;
  pushOutOfWalls(player);
  c.driver = null;
  c.parked = true; // брошенная машина стоит на месте
  c.speed = 0;
  c.braking = false;
  player.inCar = null;
}

// Сдвинуть машину так, чтобы её перед и зад не залезали в стены. Возвращает сдвиг.
function pushCarOutOfWalls(c) {
  let sx = 0, sy = 0;
  for (const s of [CAR_CORNER_OFF, -CAR_CORNER_OFF]) {
    const p = { x: c.x + Math.cos(c.angle) * s, y: c.y + Math.sin(c.angle) * s };
    const ox = p.x, oy = p.y;
    pushOutOfWalls(p, CAR_CORNER_R);
    c.x += p.x - ox;
    c.y += p.y - oy;
    sx += p.x - ox;
    sy += p.y - oy;
  }
  return [sx, sy];
}

function updateDriving(dt) {
  updateRunners(dt);
  const c = player.inCar;
  if (!c) return;

  const gas = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const handbrake = keys.has('Space');

  // Скорость раскладываем на «вперёд» (вдоль кузова) и «вбок» (занос).
  const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
  const rx = -fy, ry = fx; // вправо от кузова
  let vf = c.vx * fx + c.vy * fy;
  let vl = c.vx * rx + c.vy * ry;

  const terrain = terrainAt(c.x, c.y);
  const top = DRIVE.maxSpeed * DRIVE_TERRAIN[terrain];

  if (gas) {
    vf += (vf < -0.5 ? DRIVE.brake : DRIVE.accel) * dt;        // ехал назад — сначала тормоз
  } else if (back) {
    vf -= (vf > 0.5 ? DRIVE.brake : DRIVE.accel * 0.6) * dt;   // ехал вперёд — тормоз, иначе задний ход
  } else {
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), DRIVE.drag * dt); // накатом замедляется
  }
  if (handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 4 * dt);
  // Выше предела для этой земли — плавно сбрасываем (съехал с дороги на газон).
  if (vf > top) vf = Math.max(top, vf - DRIVE.brake * dt);
  vf = Math.max(-DRIVE.reverseMax, vf);

  // Занос гасится сцеплением; с ручником сцепление слабое — машину несёт боком.
  vl *= Math.exp(-(handbrake ? DRIVE.handbrakeGrip : DRIVE.grip) * dt);

  // Руль: на месте не поворачивает, задним ходом — в обратную сторону.
  const turn = steer * DRIVE.steer * Math.min(1, Math.abs(vf) / 6) * Math.sign(vf) * (handbrake ? 1.4 : 1);

  // Скорость в мире — по старому направлению кузова; кузов поворачивается.
  // Из-за этого после резкого поворота часть скорости оказывается «вбок» — это и есть занос.
  c.vx = fx * vf + rx * vl;
  c.vy = fy * vf + ry * vl;
  c.angle += turn * dt;

  // Двигаемся маленькими шагами и выталкиваемся из стен.
  const dist = Math.hypot(c.vx, c.vy) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  for (let i = 0; i < steps; i++) {
    c.x += (c.vx * dt) / steps;
    c.y += (c.vy * dt) / steps;
    const [sx, sy] = pushCarOutOfWalls(c);
    const push = Math.hypot(sx, sy);
    if (push > 1e-4) {
      // Удар: гасим скорость в сторону стены (и чуть больше — небольшой отскок).
      const nx = sx / push, ny = sy / push;
      const into = c.vx * nx + c.vy * ny;
      if (into < 0) {
        c.vx -= nx * into * 1.3;
        c.vy -= ny * into * 1.3;
      }
    }
  }

  bumpCars(c);
  bumpCops(c);

  c.speed = Math.abs(c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle));
  c.braking = (back && vf > 0.5) || handbrake;
  player.x = c.x;
  player.y = c.y;
  player.angle = c.angle;
}

// Врезался в другую машину — расталкиваемся, обе теряют скорость.
function bumpCars(c) {
  for (const o of cars) {
    if (o === c || Math.abs(o.x - c.x) > 6 || Math.abs(o.y - c.y) > 6) continue;
    for (const s of [CAR_CORNER_OFF, -CAR_CORNER_OFF]) {
      const px = c.x + Math.cos(c.angle) * s, py = c.y + Math.sin(c.angle) * s;
      const d = distToCar(o, px, py);
      if (d >= CAR_CORNER_R) continue;
      // Выталкиваем свою машину от центра чужой.
      const ax = px - o.x, ay = py - o.y, al = Math.hypot(ax, ay) || 1;
      c.x += (ax / al) * (CAR_CORNER_R - d);
      c.y += (ay / al) * (CAR_CORNER_R - d);
      c.vx *= 0.6;
      c.vy *= 0.6;
      o.speed = 0;
    }
  }
}

// Сбил полицейского: он отлетает и 3 секунды приходит в себя. Тревога поднимается.
function bumpCops(c) {
  const v = Math.hypot(c.vx, c.vy);
  for (const p of cops) {
    if (p.stun > 0 || Math.abs(p.x - c.x) > 5 || Math.abs(p.y - c.y) > 5) continue;
    if (distToCar(c, p.x, p.y) > PLAYER_RADIUS) continue;
    if (v < 3) {
      // Медленно — просто отодвигаем с дороги.
      const ax = p.x - c.x, ay = p.y - c.y, al = Math.hypot(ax, ay) || 1;
      p.x += (ax / al) * 0.3;
      p.y += (ay / al) * 0.3;
      continue;
    }
    const ax = p.x - c.x, ay = p.y - c.y, al = Math.hypot(ax, ay) || 1;
    p.x += (ax / al) * 3;
    p.y += (ay / al) * 3;
    pushOutOfWalls(p);
    p.stun = 3;
    c.vx *= 0.7;
    c.vy *= 0.7;
    policeAlert.lastSeen = { x: player.x, y: player.y };
    raiseAlert(p);
  }
}

// Убегающие водители: бегут прочь 5 секунд и исчезают.
function updateRunners(dt) {
  for (const r of runners) {
    r.time -= dt;
    r.x += Math.cos(r.angle) * 4.5 * dt;
    r.y += Math.sin(r.angle) * 4.5 * dt;
    pushOutOfWalls(r);
    r.step += dt * 14;
  }
  for (let i = runners.length - 1; i >= 0; i--) if (runners[i].time <= 0) runners.splice(i, 1);
}

function drawRunners(ctx, project) {
  for (const r of runners) {
    const [x, y] = project(r.x, r.y, 1.6);
    ctx.save();
    ctx.globalAlpha = Math.min(1, r.time); // в последнюю секунду тает
    ctx.translate(x, y);
    ctx.rotate(r.angle);
    ctx.scale(2, 2);
    const swing = Math.sin(r.step) * 0.25;
    ctx.fillStyle = '#e0b48c';
    for (const [side, phase] of [[-1, 1], [1, -1]]) {
      ctx.beginPath();
      ctx.arc(swing * phase, side * 0.27, 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#3a8f4a'; // зелёная рубашка
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.14, 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9a06a'; // светлые волосы
    ctx.beginPath();
    ctx.arc(0.02, 0, 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Подсказки: «E — сесть» рядом с машиной; в машине — скорость и управление.
function drawDrivingHud(ctx, canvas) {
  const w = canvas.width, h = canvas.height;
  ctx.textAlign = 'center';
  if (player.inCar) {
    const kmh = Math.round(Math.hypot(player.inCar.vx, player.inCar.vy) * 3.6);
    outlinedText(ctx, `🚗 ${kmh} км/ч`, w / 2, h - 90, 'bold 22px sans-serif', '#fff');
    outlinedText(ctx, 'W/S — газ/тормоз · A/D — руль · Пробел — ручник · E — выйти', w / 2, h - 66, '13px sans-serif', '#ddd');
  } else if (carToEnter()) {
    outlinedText(ctx, 'E — сесть в машину', w / 2, h / 2 - 40, 'bold 18px sans-serif', '#fff');
  }
}
