// Скачивает с портала LGLN (Niedersachsen) для области карты:
//   - 3D-модели зданий LoD2 (CityGML) — форма и высота крыш;
//   - аэрофото DOP20 (GeoTIFF, 20 см/пиксель) — самый свежий снимок каждой плитки.
// Запуск: node tools/fetch-lgln.mjs
// Результат: data/lgln/*.gml и data/lgln/*.tif (большие файлы, в git не попадают).
import fs from 'fs';
import { SOUTH, WEST, NORTH, EAST } from './map-area.mjs';

const H = { 'User-Agent': 'osm-game-prototype/0.1' };
const BBOX = `${WEST},${SOUTH},${EAST},${NORTH}`;
const OUT = 'data/lgln';
fs.mkdirSync(OUT, { recursive: true });

// Поиск плиток в каталоге STAC (каталог с прямыми ссылками на файлы).
async function search(base, collection) {
  const r = await fetch(`${base}/search?collections=${collection}&bbox=${BBOX}&limit=200`, { headers: H });
  if (!r.ok) throw new Error(`${base}: ${r.status}`);
  return (await r.json()).features;
}

async function download(url, file) {
  const path = `${OUT}/${file}`;
  if (fs.existsSync(path)) { console.log('  уже есть', file); return; }
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  console.log('  скачано', file, (fs.statSync(path).size / 1e6).toFixed(1), 'МБ');
}

// 1. LoD2 — одна версия на плитку.
const lod2 = await search('https://lod.stac.lgln.niedersachsen.de', 'lod2');
console.log(`LoD2: ${lod2.length} плиток`);
for (const f of lod2) await download(f.assets['lod2-gml'].href, f.id + '.gml');

// 2. DOP20 — у плитки бывает несколько съёмок разных лет. Берём самую свежую.
const dop = await search('https://dop.stac.lgln.niedersachsen.de', 'DOP');
const newest = new Map(); // «32_559_5917» → самая свежая съёмка
for (const f of dop) {
  const tile = f.id.match(/_(32_\d+_\d+)_/)[1];
  if (!newest.has(tile) || f.properties.datetime > newest.get(tile).properties.datetime) newest.set(tile, f);
}
console.log(`DOP20: ${newest.size} плиток (из ${dop.length} съёмок)`);
for (const [tile, f] of newest) {
  console.log(`  ${tile}: снимок от ${f.properties.datetime.slice(0, 10)}`);
  await download(f.assets.dop20_rgb.href, `dop20_${tile}.tif`);
}
