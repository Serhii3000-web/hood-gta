// Вид сверху с перспективой.
// Чем выше точка, тем сильнее она «отъезжает» от центра экрана — так видны стены.

// Высота камеры над землёй. Она растёт, когда отдаляешь карту: иначе дома
// у краёв экрана вытягиваются в «небоскрёбы». Чем меньше число, тем сильнее объём.
const CAMERA_HEIGHT_MIN = 50;  // метров — при сильном приближении
const CAMERA_HEIGHT_K = 1.0;   // высота = половина видимой высоты экрана (в метрах) × K

window.VIEW = {
  zoom: 8,
  dragToWorld: (dx, dy) => [dx, dy],

  draw(ctx, camera, canvas) {
    const map = window.MAP_DATA;
    prepareMap(map);

    const setTransform = (c) => {
      c.translate(canvas.width / 2, canvas.height / 2);
      c.scale(camera.zoom, camera.zoom);
      c.translate(-camera.x, -camera.y);
    };
    setTransform(ctx);

    // Что за краем экрана (с запасом 40 м) — не рисуем.
    const halfW = canvas.width / 2 / camera.zoom + 40;
    const halfH = canvas.height / 2 / camera.zoom + 40;
    const visible = (x, y) => Math.abs(x - camera.x) < halfW && Math.abs(y - camera.y) < halfH;

    drawGround(ctx, map);
    drawShadowLayer(ctx, canvas, setTransform, map, visible);

    const camH = Math.max(CAMERA_HEIGHT_MIN, (canvas.height / 2 / camera.zoom) * CAMERA_HEIGHT_K);

    // Точка на высоте h → где она видна на земле.
    const project = (x, y, h) => {
      const k = camH / (camH - h);
      return [camera.x + (x - camera.x) * k, camera.y + (y - camera.y) * k];
    };
    const dist2 = (x, y) => (x - camera.x) ** 2 + (y - camera.y) ** 2;

    // Рисуем от дальних к ближним, чтобы ближние перекрывали дальние.
    const items = [];
    for (const b of map.buildings) if (visible(b.cx, b.cy)) items.push({ b, d: dist2(b.cx, b.cy) });
    map.trees.forEach(([x, y], i) => { if (visible(x, y)) items.push({ tree: i, d: dist2(x, y) }); });
    items.sort((p, q) => q.d - p.d);

    // Персонажи и плюшки (игра) — ДО домов и деревьев: кроны выше человека
    // и закрывают его сверху. Дома его не закроют: камера висит прямо над игроком,
    // а стены в перспективе наклоняются от него.
    let focus = null;
    if (window.GAME) {
      window.GAME.draw(ctx, project);
      const [fx, fy] = window.GAME.target();
      focus = project(fx, fy, 1.6); // где игрок на экране
    }

    ctx.lineJoin = 'round';
    const treeScale = camH / (camH - TREE_HEIGHT);
    for (const it of items) {
      if (it.tree !== undefined) {
        const [tx, ty] = map.trees[it.tree];
        const info = map.treeInfo[it.tree];
        const [x, y] = project(tx, ty, TREE_HEIGHT);
        const r = info.r * treeScale;
        // Крона над игроком — полупрозрачная: видно себя сквозь листву.
        const overPlayer = focus && Math.hypot(x - focus[0], y - focus[1]) < r + 0.6;
        if (overPlayer) ctx.globalAlpha = 0.45;
        // Ствол от земли до кроны — без него крона «висит в воздухе».
        ctx.strokeStyle = '#4a3a2a';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
        drawCrown(ctx, x, y, r, info.shade);
        ctx.globalAlpha = 1;
        continue;
      }
      const b = it.b;
      if (b.faces) { drawLod2Building(ctx, b, camera, project); continue; }
      const n = b.pts.length;
      const roof = b.pts.map(([x, y]) => project(x, y, b.eave)); // верх стен (карниз)

      // Стены: рисуем только те, что повёрнуты к камере.
      ctx.lineWidth = 0.15;
      ctx.strokeStyle = COLORS.buildingEdge;
      for (let i = 0; i < n; i++) {
        const a = b.pts[i], c = b.pts[(i + 1) % n];
        const nrm = wallNormal(b, a, c);
        const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
        if (nrm[0] * (camera.x - mx) + nrm[1] * (camera.y - my) <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(roof[(i + 1) % n][0], roof[(i + 1) % n][1]);
        ctx.lineTo(roof[i][0], roof[i][1]);
        ctx.closePath();
        ctx.fillStyle = wallColor(nrm);
        ctx.fill();
        ctx.stroke();
      }

      if (b.gable) drawGableRoof(ctx, b, camera, project);
      else {
        // Плоская крыша
        tracePath(ctx, roof);
        ctx.closePath();
        ctx.fillStyle = b.roofColor;
        ctx.fill();
        ctx.lineWidth = 0.25;
        ctx.stroke();
      }
    }
  },
};

// Двускатная крыша: фронтоны (треугольники на торцах) и два ската.
function drawGableRoof(ctx, b, camera, project) {
  const g = b.gable;
  const { c, r } = gableGeometry(b);
  const E = c.map(([x, y]) => project(x, y, b.eave));   // углы на карнизе
  const R = r.map(([x, y]) => project(x, y, b.ridge));  // концы конька
  const facing = (nx, ny, px, py) => nx * (camera.x - px) + ny * (camera.y - py) > 0;

  const poly = (pts, fill) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  ctx.strokeStyle = COLORS.buildingEdge;
  ctx.lineWidth = 0.2;

  // Фронтоны: торец +u (углы 0,1 и конёк 0) и торец −u (углы 2,3 и конёк 1).
  if (facing(g.ux, g.uy, r[0][0], r[0][1])) poly([E[0], E[1], R[0]], wallColor([g.ux, g.uy]));
  if (facing(-g.ux, -g.uy, r[1][0], r[1][1])) poly([E[2], E[3], R[1]], wallColor([-g.ux, -g.uy]));

  // Скаты: сторона +v (углы 0,3) и −v (углы 1,2). Дальний от камеры — первым.
  const slopes = [
    { pts: [E[0], E[3], R[1], R[0]], n: [g.vx, g.vy] },
    { pts: [E[1], E[2], R[1], R[0]], n: [-g.vx, -g.vy] },
  ];
  if (facing(slopes[0].n[0], slopes[0].n[1], g.cx, g.cy)) slopes.reverse();
  for (const s of slopes) {
    const light = s.n[0] * SUN.x + s.n[1] * SUN.y;
    poly(s.pts, roofShade(b, light));
  }

  // Конёк — тонкая тёмная линия.
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.moveTo(R[0][0], R[0][1]);
  ctx.lineTo(R[1][0], R[1][1]);
  ctx.stroke();
}

// Дом с настоящей крышей из LoD2.
// Стены — от каждого края крыши вертикально вниз до земли (так получаются
// и прямоугольные стены, и треугольные фронтоны). Потом — скаты, снизу вверх.
function drawLod2Building(ctx, b, camera, project) {
  ctx.strokeStyle = COLORS.buildingEdge;
  ctx.lineWidth = 0.15;
  for (const w of b.walls) {
    const mx = (w.p[0] + w.q[0]) / 2, my = (w.p[1] + w.q[1]) / 2;
    if (w.n[0] * (camera.x - mx) + w.n[1] * (camera.y - my) <= 0) continue; // стена от нас
    const p0 = project(w.p[0], w.p[1], 0), q0 = project(w.q[0], w.q[1], 0);
    const p1 = project(w.p[0], w.p[1], w.p[2]), q1 = project(w.q[0], w.q[1], w.q[2]);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(q0[0], q0[1]);
    ctx.lineTo(q1[0], q1[1]); ctx.lineTo(p1[0], p1[1]);
    ctx.closePath();
    ctx.fillStyle = wallColor(w.n);
    ctx.fill();
    ctx.stroke();
  }

  for (const f of b.faces) {
    const pts = f.pts.map(([x, y, z]) => project(x, y, z));
    tracePath(ctx, pts);
    ctx.closePath();
    ctx.fillStyle = roofShade(b, f.light);
    ctx.fill();
    ctx.stroke();
  }

  // Конёк и вальмы — тёмные линии.
  ctx.lineWidth = 0.3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  for (const [p, q] of b.ridges) {
    const a = project(p[0], p[1], p[2]), c = project(q[0], q[1], q[2]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  }
}
