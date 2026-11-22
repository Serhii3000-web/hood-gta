// Скачивает улицы, дома и зоны из OpenStreetMap для прямоугольника карты.
// Запуск: node tools/fetch-map.mjs
// Результат: data/osm-raw.json
import fs from 'fs';
import { SOUTH, WEST, NORTH, EAST } from './map-area.mjs';

// Формат Overpass: (юг, запад, север, восток) в градусах.
const box = `(${SOUTH},${WEST},${NORTH},${EAST})`;

// way — простой объект (линия или контур).
// relation — составной: например, лес из нескольких кусков с полянами внутри.
const query = `[out:json][timeout:120];(
  way["highway"]${box};
  way["building"]${box};
  way["landuse"]${box};
  way["natural"]${box};
  way["leisure"]${box};
  way["barrier"]${box};
  way["amenity"="parking"]${box};
  node["natural"="tree"]${box};
  relation["type"="multipolygon"]["landuse"]${box};
  relation["type"="multipolygon"]["natural"]${box};
  relation["type"="multipolygon"]["leisure"]${box};
);out geom;`;

// Сервера Overpass бывают перегружены — пробуем по очереди.
const servers = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

for (const url of servers) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'osm-game-prototype/0.1',
      },
      body: 'data=' + encodeURIComponent(query),
    });
    const text = await res.text();
    console.log(url, res.status);
    if (res.ok && text.startsWith('{')) {
      fs.writeFileSync('data/osm-raw.json', text);
      console.log('Сохранено в data/osm-raw.json');
      process.exit(0);
    }
  } catch (e) {
    console.log(url, 'ошибка:', e.message);
  }
}
console.log('Ни один сервер не ответил. Попробуй позже.');
process.exit(1);
