// Читает 3D-модели зданий LoD2 (CityGML) из data/lgln/*.gml.
// Для каждой части здания: тип крыши, высоты, контур на земле и скаты крыши в 3D.
import fs from 'fs';
import { utmToLatLon } from './utm.mjs';

// Коды типов крыш (стандарт AdV) → короткие имена для игры.
export const ROOF_TYPES = {
  1000: 'flat',      // Flachdach — плоская
  2100: 'shed',      // Pultdach — односкатная
  2200: 'shed2',     // Versetztes Pultdach — две односкатные со сдвигом
  3100: 'gable',     // Satteldach — двускатная
  3200: 'hip',       // Walmdach — вальмовая (4 ската)
  3300: 'halfhip',   // Krüppelwalmdach — полувальмовая
  3400: 'mansard',   // Mansardendach — мансардная
  3500: 'pyramid',   // Zeltdach — шатровая
  3600: 'cone',      // Kegeldach — коническая
  3700: 'dome',      // Kuppeldach — купол
  3800: 'saw',       // Sheddach — пилообразная
  3900: 'arch',      // Bogendach — арочная
  4000: 'tower',     // Turmdach — башенная
  5000: 'mixed',     // Mischform — смешанная
  9999: 'other',     // Sonstiges — другая
};

const attr = (text, name) => {
  const m = text.match(new RegExp(`name="${name}">\\s*<gen:value>([^<]*)<`));
  return m ? parseFloat(m[1]) : null;
};

// «x y z x y z ...» → [[E, N, Z], ...]
const parsePosList = (s) => {
  const v = s.trim().split(/\s+/).map(Number);
  const out = [];
  for (let i = 0; i + 2 < v.length; i += 3) out.push([v[i], v[i + 1], v[i + 2]]);
  return out;
};

const polygonsIn = (text) =>
  [...text.matchAll(/<gml:posList[^>]*>([^<]*)<\/gml:posList>/g)].map((m) => parsePosList(m[1]));

// Разбирает одну часть здания (или здание без частей).
function parsePart(text, toXY) {
  const code = text.match(/<bldg:roofType>(\d+)<\/bldg:roofType>/);
  if (!code) return null;
  const ground = attr(text, 'AbsoluteHoehe');
  const ridgeAbs = attr(text, 'Firsthoehe');
  const eaveAbs = attr(text, 'MittlereTraufHoehe');
  if (ground === null) return null;

  // Перевод точки UTM в метры игры; высота — над землёй.
  const conv = ([E, N, Z]) => {
    const [x, y] = toXY(utmToLatLon(E, N));
    return [x, y, Math.round((Z - ground) * 10) / 10];
  };

  const roofs = [...text.matchAll(/<bldg:RoofSurface[\s\S]*?<\/bldg:RoofSurface>/g)]
    .flatMap((m) => polygonsIn(m[0]))
    .map((poly) => poly.slice(0, -1).map(conv)); // последняя точка повторяет первую
  const groundSurf = text.match(/<bldg:GroundSurface[\s\S]*?<\/bldg:GroundSurface>/);
  const footprint = groundSurf ? polygonsIn(groundSurf[0])[0].slice(0, -1).map((p) => conv(p).slice(0, 2)) : null;
  if (!footprint || !roofs.length) return null;

  return {
    type: ROOF_TYPES[code[1]] || 'other',
    eave: eaveAbs !== null ? Math.round((eaveAbs - ground) * 10) / 10 : null,
    ridge: ridgeAbs !== null ? Math.round((ridgeAbs - ground) * 10) / 10 : null,
    pitch: attr(text, 'Dachneigung'),
    footprint,
    roofs,
  };
}

// Все части всех зданий из всех плиток. Одно и то же здание может лежать
// на границе двух плиток — берём его один раз (по gml:id).
export function loadLod2(dir, toXY) {
  const parts = [];
  const seen = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.gml'))) {
    const xml = fs.readFileSync(`${dir}/${file}`, 'utf8');
    for (const m of xml.matchAll(/<core:cityObjectMember>([\s\S]*?)<\/core:cityObjectMember>/g)) {
      const member = m[1];
      const id = (member.match(/<bldg:Building gml:id="([^"]+)"/) || [])[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // Части здания (BuildingPart) разбираем отдельно, остальное — само здание.
      const partTexts = [...member.matchAll(/<bldg:BuildingPart[\s\S]*?<\/bldg:BuildingPart>/g)].map((p) => p[0]);
      const own = member.replace(/<bldg:BuildingPart[\s\S]*?<\/bldg:BuildingPart>/g, '');
      for (const t of [own, ...partTexts]) {
        const p = parsePart(t, toXY);
        if (p) parts.push({ building: id, ...p });
      }
    }
  }
  return parts;
}
