# Hood — прототип браузерной игры

Игра с видом сверху на реальной карте деревень **Зиферзен (Sieversen)** и **Леферзен (Leversen)**,
община Розенгартен, Нижняя Саксония. Игрок убегает от полиции и пробирается к цели.

Сейчас готова карта: улицы, дома с настоящими крышами, деревья, поля, лес.

## Как открыть

Двойной клик по файлу:

- `index.html` — карта строго сверху;
- `demo-3d.html` — карта с объёмом (перспектива сверху).

Мышь: тащи — двигать карту, колесо — масштаб.
В адресе можно задать место: `demo-3d.html?zoom=4&x=-620&y=180` (x, y — метры от центра карты).

## Как пересобрать карту

Нужны Node.js и Python (с Pillow и numpy).

```
node tools/fetch-map.mjs        # улицы, дома, зоны из OpenStreetMap → data/osm-raw.json
node tools/fetch-lgln.mjs       # 3D-модели LoD2 и аэрофото DOP20 → data/lgln/ (~180 МБ, не в git)
python tools/roof-colors.py     # цвет крыши каждого дома по аэрофото → data/roof-colors.json
node tools/convert-map.mjs      # всё вместе → js/map-data.js
```

Границы карты — в `tools/map-area.mjs`.

### Откуда берутся крыши

- **Контуры домов** — из OpenStreetMap (свежие), они главные.
- **Форма крыши, высоты карниза и конька, скаты** — из 3D-моделей LoD2 (LGLN).
  Дом OSM сопоставляется с моделью LoD2 по пересечению контуров.
- **Цвет крыши** — средний цвет внутри контура на аэрофото DOP20 (без теней и зелени).
- Дому, которого нет в LoD2 (построен позже), ставится двускатная крыша, цвет — по аэрофото.

## Источники данных

- Карта: © участники OpenStreetMap, лицензия [ODbL 1.0](https://www.openstreetmap.org/copyright).
- 3D-модели зданий LoD2 и аэрофото DOP20: © LGLN — Landesamt für Geoinformation und
  Landesvermessung Niedersachsen, [opengeodata.lgln.niedersachsen.de](https://opengeodata.lgln.niedersachsen.de),
  лицензия [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0).
  В метаданных самих наборов (каталог STAC и файлы CityGML) указана лицензия
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); обе требуют указывать источник.
