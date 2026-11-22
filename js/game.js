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
  ctx.restore();

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

window.GAME = {
  zoom: 16, // пикселей на метр: на экране ~80×50 м вокруг игрока
  update(dt) {
    updatePlayer(dt);
    updatePickups(dt);
  },
  target: () => [player.x, player.y],
  // Рисуется в координатах карты, поверх домов и деревьев.
  draw(ctx, project) {
    drawPickups(ctx);
    drawPlayerShadow(ctx);
    drawPlayer(ctx, project);
  },
  // Рисуется в пикселях экрана, поверх всего.
  drawHud(ctx, canvas) {
    drawHud(ctx, canvas);
    drawMinimap(ctx, canvas);
  },
};
