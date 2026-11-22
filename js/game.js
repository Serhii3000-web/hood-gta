// Игра: связывает игрока и плюшки с главным циклом (js/main.js) и видом (js/view-3d.js),
// рисует интерфейс поверх карты (шкала выносливости, эффекты, сообщения).

function drawHud(ctx, canvas) {
  const W = 260, H = 16;
  const x = (canvas.width - W) / 2;
  const y = canvas.height - 44;

  // Шкала выносливости: зелёная → жёлтая → красная.
  const k = player.stamina / STAMINA_MAX;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x - 4, y - 22, W + 8, H + 28);
  ctx.fillStyle = '#333';
  ctx.fillRect(x, y, W, H);
  ctx.fillStyle = player.tired ? '#c0392b' : `hsl(${k * 110}, 70%, 45%)`;
  ctx.fillRect(x, y, W * k, H);
  // Отметка 30%: с одышки бежать можно только отсюда.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fillRect(x + W * (STAMINA_RECOVER / STAMINA_MAX), y, 1, H);

  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#eee';
  ctx.fillText(player.tired ? 'Одышка! Отдышись…' : 'Выносливость', x, y - 6);

  // Действующие эффекты с оставшимися секундами — справа над шкалой.
  const active = Object.entries(player.effects).map(([n, s]) => `${PICKUP_TYPES[n].icon} ${Math.ceil(s)} с`);
  ctx.textAlign = 'right';
  ctx.fillText(active.join('   '), x + W, y - 6);

  // «Подобрал …» — по центру экрана, плавно исчезает.
  if (pickupMessage.time > 0) {
    ctx.globalAlpha = Math.min(1, pickupMessage.time);
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 4;
    ctx.strokeText(pickupMessage.text, canvas.width / 2, canvas.height / 2 - 60);
    ctx.fillText(pickupMessage.text, canvas.width / 2, canvas.height / 2 - 60);
    ctx.globalAlpha = 1;
  }
}

// Мини-карта в правом верхнем углу: круг ~150 м вокруг игрока.
// Север всегда сверху, игрок — стрелка в центре, плюшки — цветные точки.
const MINIMAP_SIZE = 180;   // пикселей
const MINIMAP_RANGE = 150;  // метров от центра до края

function drawMinimap(ctx, canvas) {
  const map = window.MAP_DATA;
  const R = MINIMAP_SIZE / 2;
  const cx = canvas.width - R - 14, cy = R + 14;
  const k = R / MINIMAP_RANGE; // пикселей на метр
  const near = (x, y) => Math.abs(x - player.x) < MINIMAP_RANGE + 50 && Math.abs(y - player.y) < MINIMAP_RANGE + 50;

  ctx.save();
  // Круглая рамка и фон; всё дальше рисуем только внутри круга.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 60, 35, 0.85)';
  ctx.fill();
  ctx.clip();

  // Из метров карты — в пиксели мини-карты: игрок в центре.
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.translate(-player.x, -player.y);

  // Улицы
  ctx.strokeStyle = '#9a9a92';
  ctx.lineCap = 'round';
  for (const r of map.roads) {
    if (r.w < 3 || !r.pts.some(([x, y]) => near(x, y))) continue;
    tracePath(ctx, r.pts);
    ctx.lineWidth = Math.max(r.w, 3 / k);
    ctx.stroke();
  }
  // Дома
  ctx.fillStyle = '#5b544c';
  for (const b of map.buildings) {
    if (!near(b.cx, b.cy)) continue;
    tracePath(ctx, b.pts);
    ctx.fill();
  }
  // Плюшки — яркие точки с тёмной обводкой.
  ctx.lineWidth = 1.5 / k;
  ctx.strokeStyle = '#000';
  for (const p of pickups) {
    if (p.respawn > 0 || !near(p.x, p.y)) continue;
    ctx.fillStyle = PICKUP_TYPES[p.type].color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Машины — маленькие белые точки.
  ctx.fillStyle = '#f4f4f4';
  for (const c of cars) {
    if (!near(c.x, c.y)) continue;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.5 / k, 0, Math.PI * 2);
    ctx.fill();
  }

  // Полиция — синие точки (красные, если сейчас видит тебя).
  for (const c of cops) {
    if (!near(c.x, c.y)) continue;
    ctx.fillStyle = c.sees ? '#ff3b30' : c.mode === 'search' ? '#ff9f1a' : '#2f6bff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4.5 / k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Цель — зелёный флажок. Если она дальше края мини-карты — прижат к краю в её сторону.
  {
    const gx = (goal.x - player.x) * k, gy = (goal.y - player.y) * k;
    const d = Math.hypot(gx, gy);
    const s = d > R - 10 ? (R - 10) / d : 1;
    ctx.fillStyle = '#2ecc40';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + gx * s, cy + gy * s, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('⚑', cx + gx * s, cy + gy * s + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // Игрок — белая стрелка по направлению взгляда.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(player.angle);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, 5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, -5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Рамка и буква «С» (север) сверху.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('С', cx, cy - R + 14);
}

// Текст с тёмной обводкой — читается на любом фоне.
function outlinedText(ctx, text, x, y, font, color) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillStyle = color;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

// Тревога: звёздочки, «ЗАМЕТИЛИ!», состояние погони, «ПОЙМАН!».
function drawSpotted(ctx, canvas) {
  const w = canvas.width, h = canvas.height;

  // Тебя видят — красная пульсирующая рамка по краям экрана.
  if (playerSpotted) {
    const pulse = 0.5 + Math.sin(performance.now() / 120) * 0.5;
    const edge = 70;
    for (const [x0, y0, x1, y1] of [[0, 0, 0, edge], [0, h, 0, h - edge], [0, 0, edge, 0], [w, 0, w - edge, 0]]) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(255, 30, 20, ${0.35 + pulse * 0.3})`);
      g.addColorStop(1, 'rgba(255, 30, 20, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Звёздочки тревоги: горящие — жёлтые, остальные — серые. Во время погони мигают.
  if (policeAlert.level > 0) {
    const blink = policeAlert.chasing && Math.floor(performance.now() / 400) % 2 === 0;
    for (let i = 0; i < 3; i++) {
      const on = i < policeAlert.level;
      outlinedText(ctx, '★', w / 2 + (i - 1) * 34, 40, 'bold 32px sans-serif',
        on ? (blink ? '#fff6a0' : '#ffcc00') : 'rgba(160, 160, 160, 0.6)');
    }
  }

  if (playerSpotted) {
    outlinedText(ctx, 'ЗАМЕТИЛИ!', w / 2, 80, 'bold 28px sans-serif', '#ff4433');
  } else if (policeAlert.chasing) {
    const L = ALERT_LEVELS[policeAlert.level];
    const text = policeAlert.escapeTimer > 0
      ? `Оторвался… отбой через ${Math.ceil(L.timeout - policeAlert.escapeTimer)} с`
      : `Погоня! Уйди дальше ${L.radius} м от полиции`;
    outlinedText(ctx, text, w / 2, 76, 'bold 18px sans-serif', '#ffd0c0');
  }
}

// ================= Цель, победа и проигрыш =================

const GOAL_MIN_DISTANCE = 500; // м — цель не ближе этого от старта
const GOAL_RADIUS = 3;         // м — подойти ближе, и ты на месте
const RECORD_KEY = 'hood-best-time';

// Цель — случайная точка на улице подальше от старта.
const goal = (() => {
  let best = null;
  for (let i = 0; i < 300; i++) {
    const p = randomStreetPoint(window.MAP_DATA);
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d >= GOAL_MIN_DISTANCE) return p;
    if (!best || d > best.d) best = { ...p, d }; // запасной вариант — самая дальняя из найденных
  }
  return best;
})();

const game = {
  state: 'play',  // 'play' — играем, 'won' — победа, 'caught' — поймали
  time: 0,        // секунд с начала
  maxLevel: 0,    // самый высокий уровень тревоги за игру
};

const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Рекорд хранится в браузере. Чтение/запись могут не работать (приватный режим) — тогда без рекорда.
function readRecord() {
  try { return Number(localStorage.getItem(RECORD_KEY)) || null; } catch { return null; }
}
function saveRecord(t) {
  try { localStorage.setItem(RECORD_KEY, String(t)); } catch { /* без рекорда */ }
}

// Конец игры: окно поверх экрана с итогами и кнопкой «Ещё раз».
function gameOver(result) {
  if (game.state !== 'play') return;
  game.state = result;
  keys.clear();

  const stars = '★'.repeat(game.maxLevel) + '☆'.repeat(3 - game.maxLevel);
  let html;
  if (result === 'won') {
    const record = readRecord();
    const isRecord = !record || game.time < record;
    if (isRecord) saveRecord(game.time);
    html = `<h1 style="color:#2ecc40">ПОБЕДА!</h1>
      <p>Время: <b>${formatTime(game.time)}</b>${isRecord ? ' — <b style="color:#ffcc00">новый рекорд!</b>' : ''}</p>
      ${!isRecord ? `<p>Рекорд: ${formatTime(record)}</p>` : ''}
      <p>Тревога (максимум): <span style="color:#ffcc00">${stars}</span></p>`;
  } else {
    html = `<h1 style="color:#ff3322">ПОЙМАН!</h1>
      <p>Продержался: <b>${formatTime(game.time)}</b></p>
      <p>До цели оставалось: <b>${Math.round(Math.hypot(goal.x - player.x, goal.y - player.y))} м</b></p>
      <p>Тревога (максимум): <span style="color:#ffcc00">${stars}</span></p>`;
  }

  const box = document.createElement('div');
  box.style.cssText = `position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    background:rgba(15,18,14,.92); color:#eee; font:18px sans-serif; text-align:center;
    padding:24px 40px; border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.6); max-width:calc(100vw - 32px);`;
  box.innerHTML = html + `<button id="again" style="margin-top:12px; font:bold 18px sans-serif; padding:10px 28px;
    border:0; border-radius:8px; background:#2ecc40; color:#fff; cursor:pointer">Ещё раз (Enter)</button>`;
  document.body.appendChild(box);
  // Новая игра — просто перезагрузка страницы: новый старт, новая цель, новая полиция.
  document.getElementById('again').onclick = () => location.reload();
  window.addEventListener('keydown', (e) => { if (e.code === 'Enter') location.reload(); });
}

// Цель на земле: пульсирующий зелёный круг и флажок на шесте.
function drawGoal(ctx, project) {
  const pulse = 0.5 + Math.sin(performance.now() / 300) * 0.5;
  ctx.fillStyle = `rgba(46, 204, 64, ${0.25 + pulse * 0.2})`;
  ctx.strokeStyle = '#2ecc40';
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.arc(goal.x, goal.y, GOAL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Шест от земли до 4 м (с перспективой) и флажок наверху.
  const [tx, ty] = project(goal.x, goal.y, 4);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.moveTo(goal.x, goal.y);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = '#2ecc40';
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx + 1.6, ty + 0.5);
  ctx.lineTo(tx, ty + 1);
  ctx.closePath();
  ctx.fill();
}

// Время сверху слева и стрелка на цель у края экрана, если цель не видна.
function drawGoalPointer(ctx, canvas) {
  const w = canvas.width, h = canvas.height;
  outlinedText(ctx, `⏱ ${formatTime(game.time)}`, 60, 34, 'bold 20px sans-serif', '#fff');

  const dist = Math.hypot(goal.x - player.x, goal.y - player.y);
  // Где цель на экране (камера — из js/main.js).
  const sx = w / 2 + (goal.x - camera.x) * camera.zoom;
  const sy = h / 2 + (goal.y - camera.y) * camera.zoom;
  const margin = 40;
  if (sx > margin && sx < w - margin && sy > margin && sy < h - margin) return; // цель на экране

  // Точка на краю экрана в сторону цели.
  const dx = sx - w / 2, dy = sy - h / 2;
  const s = Math.min((w / 2 - margin) / Math.abs(dx || 1e-9), (h / 2 - margin) / Math.abs(dy || 1e-9));
  const ax = w / 2 + dx * s, ay = h / 2 + dy * s;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = '#2ecc40';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, 11);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-10, -11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Расстояние — чуть ближе к центру от стрелки.
  const tx = w / 2 + dx * s * 0.9, ty = h / 2 + dy * s * 0.9 + 6;
  outlinedText(ctx, `${Math.round(dist)} м`, tx, ty, 'bold 16px sans-serif', '#b8ffb8');
}

window.GAME = {
  zoom: 16, // пикселей на метр: на экране ~80×50 м вокруг игрока
  update(dt) {
    if (game.state !== 'play') return; // игра окончена — всё замирает
    game.time += dt;
    updatePlayer(dt);
    updateTraffic(dt);
    updatePickups(dt);
    updatePolice(dt);
    game.maxLevel = Math.max(game.maxLevel, policeAlert.level);
    if (Math.hypot(goal.x - player.x, goal.y - player.y) < GOAL_RADIUS) gameOver('won');
  },
  target: () => [player.x, player.y],
  // Рисуется в координатах карты, поверх домов и деревьев.
  draw(ctx, project) {
    drawViewCones(ctx); // конусы — на земле, под всеми
    drawGoal(ctx, project);
    drawPickups(ctx);
    drawCars(ctx, project);
    drawPlayerShadow(ctx);
    drawPlayer(ctx, project);
    drawPolice(ctx, project);
  },
  // Рисуется в пикселях экрана, поверх всего.
  drawHud(ctx, canvas) {
    drawSpotted(ctx, canvas);
    drawHud(ctx, canvas);
    drawMinimap(ctx, canvas);
    drawGoalPointer(ctx, canvas);
  },
};
