// Бой: удар кулаком (F), пистолет (левая кнопка мыши, в сторону курсора),
// полицейские стреляют в ответ, убитые роняют пистолеты.

const PUNCH_DAMAGE = 5;        // HP за удар кулаком
const PUNCH_RANGE = 1.3;       // м — достать рукой
const PUNCH_COOLDOWN = 0.5;    // с — не чаще двух ударов в секунду
const PISTOL_DAMAGE = 10;      // HP за попадание из пистолета (игрока)
const PISTOL_RANGE = 40;       // м — дальность выстрела
const PISTOL_COOLDOWN = 0.3;   // с — между выстрелами
const PISTOL_AMMO = 12;        // патронов в подобранном пистолете
const COP_HP = 20;             // здоровье полицейского
const RUNNER_HP = 10;          // здоровье водителя, убегающего из угнанной машины
const COP_SHOOT_RANGE = 15;    // м — полицейский стреляет, если ты ближе
const COP_SHOOT_COOLDOWN = 1.5;// с — между его выстрелами
const COP_SHOOT_ACCURACY = 0.5;// попадает через раз
const COP_SHOT_DAMAGE = 5;     // HP за попадание полицейского
const CORPSE_TIME = 10;        // с — сколько лежит убитый

const combat = {
  punchCooldown: 0,
  shootCooldown: 0,
  ammo: 0,          // патронов у игрока (0 — пистолета нет, бьёт кулаками)
  punch: 0,         // анимация удара: сколько ещё секунд рука вытянута
};
const droppedPistols = []; // { x, y, ammo }
const corpses = [];        // { x, y, angle, time, uniform }
const tracers = [];        // следы выстрелов: { x1, y1, x2, y2, time, color }

for (const c of cops) c.hp = COP_HP;

// ---------- Управление ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && !e.repeat) punch();
});
// Левая кнопка мыши — в сторону курсора: с пистолетом выстрел, без — удар кулаком.
document.getElementById('game').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const canvas = e.target;
  const r = canvas.getBoundingClientRect();
  // Курсор (пиксели экрана) → точка на карте (метры). Камера — из js/main.js.
  const wx = camera.x + (e.clientX - r.left - canvas.width / 2) / camera.zoom;
  const wy = camera.y + (e.clientY - r.top - canvas.height / 2) / camera.zoom;
  const angle = Math.atan2(wy - player.y, wx - player.x);
  if (combat.ammo > 0) {
    shoot(angle);
  } else if (canAct()) {
    player.angle = angle; // развернулся к курсору
    punch();
  }
});

const canAct = () => game.state === 'play' && !player.inCar;

// ---------- Урон NPC ----------
// Все, кого можно ударить или подстрелить: полицейские и убегающие водители.
const targets = () => cops.concat(runners);

function hurtNpc(n, amount, fromX, fromY) {
  if (n.hp === undefined) n.hp = RUNNER_HP;
  n.hp -= amount;
  // Небольшой толчок от удара/попадания.
  const ax = n.x - fromX, ay = n.y - fromY, al = Math.hypot(ax, ay) || 1;
  n.x += (ax / al) * 0.4;
  n.y += (ay / al) * 0.4;
  pushOutOfWalls(n);

  const isCop = cops.includes(n);
  if (isCop) {
    // Напал на полицейского — тревога, он и его коллеги гонятся.
    policeAlert.lastSeen = { x: player.x, y: player.y };
    raiseAlert(n);
    policeAlert.unseen = 0;
    if (n.hp > 0) n.mode = 'chase';
  }
  if (n.hp > 0) return;

  // Убит: лежит на земле, полицейский роняет пистолет.
  corpses.push({ x: n.x, y: n.y, angle: n.angle || 0, time: CORPSE_TIME, uniform: isCop });
  if (isCop) {
    cops.splice(cops.indexOf(n), 1);
    droppedPistols.push({ x: n.x + 0.8, y: n.y + 0.3, ammo: PISTOL_AMMO });
  } else {
    runners.splice(runners.indexOf(n), 1);
  }
}

// ---------- Удар кулаком ----------
function punch() {
  if (!canAct() || combat.punchCooldown > 0) return;
  combat.punchCooldown = PUNCH_COOLDOWN;
  combat.punch = 0.15;
  // Цель — ближайший перед тобой (в пределах ±60° от взгляда).
  let best = null, bestD = PUNCH_RANGE;
  for (const n of targets()) {
    const dx = n.x - player.x, dy = n.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > bestD) continue;
    let diff = Math.atan2(dy, dx) - player.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > Math.PI / 3) continue;
    best = n;
    bestD = d;
  }
  if (best) hurtNpc(best, PUNCH_DAMAGE, player.x, player.y);
}

// ---------- Пистолет ----------
// Пуля летит мгновенно по прямой: попадает в первого NPC на линии, если до него нет стены.
function fireRay(x, y, angle, range) {
  const wall = rayLength(x, y, angle, range);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let hit = null, hitT = wall;
  for (const n of targets()) {
    const t = (n.x - x) * dx + (n.y - y) * dy;           // как далеко по линии
    if (t <= 0 || t >= hitT) continue;
    const side = Math.abs(-(n.x - x) * dy + (n.y - y) * dx); // как далеко сбоку
    if (side < 0.5) { hit = n; hitT = t; }
  }
  return { hit, t: hitT };
}

function shoot(angle) {
  if (!canAct() || combat.ammo <= 0 || combat.shootCooldown > 0) return;
  combat.ammo--;
  combat.shootCooldown = PISTOL_COOLDOWN;
  player.angle = angle; // развернулся в сторону выстрела
  const { hit, t } = fireRay(player.x, player.y, angle, PISTOL_RANGE);
  tracers.push({ x1: player.x, y1: player.y, x2: player.x + Math.cos(angle) * t, y2: player.y + Math.sin(angle) * t, time: 0.12, color: '255, 230, 120' });
  if (hit) hurtNpc(hit, PISTOL_DAMAGE, player.x, player.y);
  // Выстрел слышно: ближайшие полицейские прибегают.
  if (cops.length) {
    policeAlert.lastSeen = { x: player.x, y: player.y };
    const nearest = cops.reduce((a, c) => (Math.hypot(c.x - player.x, c.y - player.y) < Math.hypot(a.x - player.x, a.y - player.y) ? c : a));
    if (Math.hypot(nearest.x - player.x, nearest.y - player.y) < 80) raiseAlert(nearest);
  }
}

// ---------- Полицейские стреляют ----------
function copsShoot(dt) {
  if (!policeAlert.chasing) return;
  for (const c of cops) {
    c.shootCooldown = Math.max(0, (c.shootCooldown || 0) - dt);
    if (!c.sees || c.stun > 0 || c.shootCooldown > 0) continue;
    const d = Math.hypot(player.x - c.x, player.y - c.y);
    if (d > COP_SHOOT_RANGE || d < CATCH_DISTANCE) continue; // далеко — не стреляет; вплотную — бьёт рукой
    c.shootCooldown = COP_SHOOT_COOLDOWN;
    const hitIt = Math.random() < COP_SHOOT_ACCURACY;
    // Промах — пуля уходит чуть в сторону.
    const a = Math.atan2(player.y - c.y, player.x - c.x) + (hitIt ? 0 : (Math.random() < 0.5 ? -1 : 1) * 0.12);
    tracers.push({ x1: c.x, y1: c.y, x2: c.x + Math.cos(a) * (d + 3), y2: c.y + Math.sin(a) * (d + 3), time: 0.12, color: '255, 120, 90' });
    if (hitIt) damagePlayer(COP_SHOT_DAMAGE);
    if (game.state !== 'play') return;
  }
}

function updateCombat(dt) {
  combat.punchCooldown = Math.max(0, combat.punchCooldown - dt);
  combat.shootCooldown = Math.max(0, combat.shootCooldown - dt);
  combat.punch = Math.max(0, combat.punch - dt);

  // Подобрать пистолет — пройти по нему.
  if (!player.inCar) {
    for (let i = droppedPistols.length - 1; i >= 0; i--) {
      const p = droppedPistols[i];
      if (Math.hypot(p.x - player.x, p.y - player.y) > 1.2) continue;
      combat.ammo += p.ammo;
      droppedPistols.splice(i, 1);
      pickupMessage.text = `🔫 Пистолет +${p.ammo} патронов`;
      pickupMessage.time = 2;
    }
  }

  for (const c of corpses) c.time -= dt;
  for (let i = corpses.length - 1; i >= 0; i--) if (corpses[i].time <= 0) corpses.splice(i, 1);
  for (const t of tracers) t.time -= dt;
  for (let i = tracers.length - 1; i >= 0; i--) if (tracers[i].time <= 0) tracers.splice(i, 1);

  copsShoot(dt);

  // С пистолетом курсор — прицел.
  document.getElementById('game').style.cursor = combat.ammo > 0 && !player.inCar ? 'crosshair' : 'default';
}

// ---------- Рисование ----------
// Убитые лежат на земле (плашмя, без перспективы) и в последнюю секунду тают.
function drawCorpses(ctx) {
  for (const c of corpses) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, c.time);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(120, 0, 0, 0.35)'; // пятно
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.9, 0.6, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.uniform ? '#1f3f8a' : '#3a8f4a'; // тело: форма или рубашка
    ctx.fillRect(-0.3, -0.9, 0.6, 1.3);
    ctx.fillStyle = c.uniform ? '#16264f' : '#c9a06a';  // голова
    ctx.beginPath();
    ctx.arc(0, -1.1, 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Пистолеты на земле: тёмный силуэт с золотистым свечением, чтобы заметить.
function drawDroppedPistols(ctx) {
  const pulse = 0.5 + Math.sin(performance.now() / 250) * 0.5;
  for (const p of droppedPistols) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 1.4);
    g.addColorStop(0, `rgba(255, 210, 80, ${0.35 + pulse * 0.3})`);
    g.addColorStop(1, 'rgba(255, 210, 80, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(p.x - 0.35, p.y - 0.1, 0.7, 0.2);  // ствол
    ctx.fillRect(p.x - 0.35, p.y - 0.1, 0.2, 0.45); // рукоять
  }
}

function drawTracers(ctx) {
  for (const t of tracers) {
    ctx.strokeStyle = `rgba(${t.color}, ${Math.min(1, t.time * 8)})`;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(t.x1, t.y1);
    ctx.lineTo(t.x2, t.y2);
    ctx.stroke();
  }
}
