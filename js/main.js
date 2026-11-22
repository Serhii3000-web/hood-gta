// Главный файл: окно, камера, управление мышью, цикл кадров.
// Что именно рисовать, решает «вид» (view). Его можно задать заранее:
//   window.VIEW = { zoom, draw(ctx, camera, canvas), dragToWorld(dx, dy) }
// Если вид не задан — рисуем плоскую карту.
// Если задана игра (window.GAME = { update(dt), target() }), камера следует за ней,
// а перетаскивание мышью отключено.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const flatView = {
  zoom: 2,
  draw(ctx, camera, canvas) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    drawMap(ctx, window.MAP_DATA);

    // Метка центра карты. Делим на zoom, чтобы на экране она была ~5 пикселей.
    ctx.fillStyle = '#e33';
    ctx.beginPath();
    ctx.arc(0, 0, 5 / camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  },
  // Сдвиг мыши на экране (пиксели) → сдвиг камеры по карте (метры)
  dragToWorld: (dx, dy) => [dx, dy],
};

const view = window.VIEW || flatView;

// Камера: какая точка карты (в метрах) в центре экрана и сколько пикселей в метре.
// Можно задать в адресе для проверки: demo-3d.html?zoom=1&x=-500&y=0
const params = new URLSearchParams(location.search);
const camera = {
  x: Number(params.get('x')) || 0,
  y: Number(params.get('y')) || 0,
  zoom: Number(params.get('zoom')) || (window.GAME && window.GAME.zoom) || view.zoom,
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- Мышь: перетаскивание и масштаб ---
let dragging = false;
let lastMouse = null;

canvas.addEventListener('mousedown', (e) => {
  if (window.GAME) return; // в игре камеру ведёт игрок
  dragging = true;
  lastMouse = [e.clientX, e.clientY];
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const [dx, dy] = view.dragToWorld(
    (e.clientX - lastMouse[0]) / camera.zoom,
    (e.clientY - lastMouse[1]) / camera.zoom,
  );
  camera.x -= dx;
  camera.y -= dy;
  lastMouse = [e.clientX, e.clientY];
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  camera.zoom = Math.min(30, Math.max(0.5, camera.zoom * factor));
}, { passive: false });

// --- Каждый кадр: обновить игру, подвинуть камеру, нарисовать ---
if (window.GAME) {
  const [x, y] = window.GAME.target();
  camera.x = x;
  camera.y = y;
}
let lastTime = performance.now();

function frame(now) {
  // dt — сколько секунд прошло с прошлого кадра (не больше 0,1, если вкладка «спала»).
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (window.GAME) {
    window.GAME.update(dt);
    // Камера плавно догоняет игрока: каждую секунду сокращает отставание в ~e⁸ раз.
    const [x, y] = window.GAME.target();
    const k = 1 - Math.exp(-8 * dt);
    camera.x += (x - camera.x) * k;
    camera.y += (y - camera.y) * k;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  view.draw(ctx, camera, canvas);
  ctx.restore();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
