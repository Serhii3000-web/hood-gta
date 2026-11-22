// Плюшки на карте: подобрал — получил эффект.
// Подобранная плюшка через минуту появляется в другом случайном месте.

const PICKUP_TYPES = {
  energy: { icon: '🥤', name: 'Энергетик', color: '#3fa9f5', duration: 15 }, // бег почти не тратит выносливость
  choco: { icon: '🍫', name: 'Шоколадка', color: '#c8843c', duration: 0 },   // шкала сразу полная
  shoes: { icon: '👟', name: 'Кроссовки', color: '#f5d33f', duration: 20 },  // бег быстрее на 30%
};
const PICKUP_COUNT = 120;  // ~одна на 90 м улицы
const PICKUP_RADIUS = 1.5;  // м — насколько близко подойти, чтобы подобрать
const RESPAWN_TIME = 60;    // с — через сколько подобранная появится снова

const pickups = [];
const typeNames = Object.keys(PICKUP_TYPES);
for (let i = 0; i < PICKUP_COUNT; i++) {
  const p = randomStreetPoint(window.MAP_DATA);
  pickups.push({ type: typeNames[i % typeNames.length], x: p.x, y: p.y, respawn: 0 });
}

// Последнее сообщение «подобрал …» — показываем пару секунд.
const pickupMessage = { text: '', time: 0 };

function updatePickups(dt) {
  pickupMessage.time = Math.max(0, pickupMessage.time - dt);
  for (const p of pickups) {
    // Подобранная — ждёт и появляется в новом месте.
    if (p.respawn > 0) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        const pos = randomStreetPoint(window.MAP_DATA);
        p.x = pos.x;
        p.y = pos.y;
        p.respawn = 0;
      }
      continue;
    }
    if (Math.hypot(p.x - player.x, p.y - player.y) > PICKUP_RADIUS) continue;

    // Подобрал!
    const t = PICKUP_TYPES[p.type];
    if (p.type === 'choco') {
      player.stamina = STAMINA_MAX;
      player.tired = false;
    } else {
      player.effects[p.type] = t.duration; // повторный подбор — время начинается заново
    }
    pickupMessage.text = `${t.icon} ${t.name}`;
    pickupMessage.time = 2;
    p.respawn = RESPAWN_TIME;
  }
}

// Плюшка на земле: пульсирующее свечение и значок.
function drawPickups(ctx) {
  const pulse = 0.5 + Math.sin(performance.now() / 250) * 0.5; // 0..1
  for (const p of pickups) {
    if (p.respawn > 0) continue;
    const t = PICKUP_TYPES[p.type];
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 2.2 + pulse * 0.6);
    glow.addColorStop(0, t.color);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.55 + pulse * 0.3;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '1.6px "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.icon, p.x, p.y);
  }
}
