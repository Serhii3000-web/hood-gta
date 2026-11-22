// Игрок: клавиатура, движение, случайный старт, рисование человечка.

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

const WALK_SPEED = 1.6; // м/с — обычный шаг
const RUN_SPEED = 4.5;  // м/с — бег (Shift)

// ---------- Случайный старт ----------
// Выбираем случайную точку на улице (не на тропинке и не в доме).
// Длинные улицы выпадают чаще — шанс пропорционален длине участка.
function randomStart(map) {
  const segments = [];
  let total = 0;
  for (const r of map.roads) {
    if (r.w < 4 || r.w > 10) continue; // без тропинок и без автобана
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x1, y1] = r.pts[i], [x2, y2] = r.pts[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      total += len;
      segments.push({ x1, y1, x2, y2, end: total });
    }
  }
  // Центры домов — чтобы старт был в посёлке, а не на дороге в поле или за краем карты.
  const houses = map.buildings.map((b) => [
    b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length,
    b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length,
  ]);
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

// ---------- Игрок ----------
const start = randomStart(window.MAP_DATA);
const player = {
  x: start.x,
  y: start.y,
  angle: 0,      // куда смотрит, радианы (0 — на восток)
  moving: false,
  running: false,
  step: 0,       // фаза шага — для качания рук
};

function updatePlayer(dt) {
  // Направление по клавишам: вверх по экрану — это север (y меньше).
  let dx = 0, dy = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;

  player.moving = dx !== 0 || dy !== 0;
  player.running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (!player.moving) return;

  // По диагонали не быстрее, чем прямо: делим на длину вектора.
  const len = Math.hypot(dx, dy);
  const speed = player.running ? RUN_SPEED : WALK_SPEED;
  player.x += (dx / len) * speed * dt;
  player.y += (dy / len) * speed * dt;
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

  // Плечи (куртка) — эллипс поперёк направления.
  ctx.fillStyle = '#c0392b';
  ctx.strokeStyle = '#4a1510';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.14, 0.25, 0, 0, Math.PI * 2);
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

// Связь с главным циклом (js/main.js) и видом (js/view-3d.js).
window.GAME = {
  zoom: 16, // пикселей на метр: на экране ~80×50 м вокруг игрока
  update: updatePlayer,
  target: () => [player.x, player.y],
  draw(ctx, project) {
    drawPlayerShadow(ctx);
    drawPlayer(ctx, project);
  },
};
