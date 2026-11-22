// Перевод координат UTM (зона 32, ETRS89) ↔ широта/долгота.
// Данные LGLN приходят в UTM: «восток» и «север» в метрах.
// Формулы Крюгера (точность — миллиметры), эллипсоид GRS80.

const a = 6378137;
const f = 1 / 298.257222101;
const k0 = 0.9996;
const E0 = 500000;
const LON0 = (9 * Math.PI) / 180; // центральный меридиан зоны 32

const n = f / (2 - f);
const A = (a / (1 + n)) * (1 + (n * n) / 4 + (n ** 4) / 64);
const alpha = [n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16, (13 * n * n) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
const beta = [n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96, (n * n) / 48 + (n ** 3) / 15, (17 * n ** 3) / 480];
const delta = [2 * n - (2 * n * n) / 3 - 2 * n ** 3, (7 * n * n) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15];
const e2n = (2 * Math.sqrt(n)) / (1 + n);

// UTM → { lat, lon } в градусах
export function utmToLatLon(E, N) {
  const xi = N / (k0 * A);
  const eta = (E - E0) / (k0 * A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lam = LON0 + Math.atan(Math.sinh(eta1) / Math.cos(xi1));
  return { lat: (phi * 180) / Math.PI, lon: (lam * 180) / Math.PI };
}

// { lat, lon } → [E, N]
export function latLonToUtm(lat, lon) {
  const phi = (lat * Math.PI) / 180;
  const dl = (lon * Math.PI) / 180 - LON0;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e2n * Math.atanh(e2n * Math.sin(phi)));
  const xi1 = Math.atan(t / Math.cos(dl));
  const eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let E = eta1, N = xi1;
  for (let j = 1; j <= 3; j++) {
    E += alpha[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
    N += alpha[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
  }
  return [E0 + k0 * A * E, k0 * A * N];
}
