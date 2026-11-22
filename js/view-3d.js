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

    ctx.lineJoin = 'round';
    const treeScale = camH / (camH - TREE_HEIGHT);
    for (const it of items) {
      if (it.tree !== undefined) {
        const [tx, ty] = map.trees[it.tree];
        const info = map.treeInfo[it.tree];
        const [x, y] = project(tx, ty, TREE_HEIGHT);
        // Ствол от земли до кроны — без него крона «висит в воздухе».
        ctx.strokeStyle = '#4a3a2a';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
        drawCrown(ctx, x, y, info.r * treeScale, info.shade);
        continue;
      }
      const b = it.b;
      const n = b.pts.length;
      const roof = b.pts.map(([x, y]) => project(x, y, b.h));

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

      // Крыша
      tracePath(ctx, roof);
      ctx.closePath();
      ctx.fillStyle = b.roof;
      ctx.fill();
      ctx.lineWidth = 0.25;
      ctx.stroke();
    }
  },
};
