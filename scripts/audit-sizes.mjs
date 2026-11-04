import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pck10Path = path.join(root, 'src', 'data', 'spice', 'pck00010.tpc');
const pck11Path = path.join(root, 'src', 'data', 'spice', 'pck00011.tpc');
const pck10 = fs.readFileSync(pck10Path, 'utf8');
const pck11 = fs.readFileSync(pck11Path, 'utf8');

const num = (s) => Number(s.replace(/D/gi, 'E'));

function extractRadii(pckText, naifId) {
  const re = new RegExp(`BODY${naifId}_RADII\\b\\s*=\\s*\\(\\s*([^()]+)\\)`, 'i');
  const m = pckText.match(re);
  if (!m) return null;
  return m[1].trim().split(/\s+/).map(num);
}

// Map body id to NAIF center ID
const NAIF_MAP = {
  sun: 10,
  mercury: 199,
  venus: 299,
  earth: 399,
  moon: 301,
  mars: 499,
  phobos: 401,
  deimos: 402,
  jupiter: 599,
  io: 501,
  europa: 502,
  ganymede: 503,
  callisto: 504,
  saturn: 699,
  mimas: 601,
  enceladus: 602,
  tethys: 603,
  dione: 604,
  rhea: 605,
  titan: 606,
  hyperion: 607,
  iapetus: 608,
  uranus: 799,
  ariel: 701,
  umbriel: 702,
  titania: 703,
  oberon: 704,
  miranda: 705,
  neptune: 899,
  triton: 801,
  pluto: 999,
  charon: 901,
  ceres: 2000001,
  pallas: 2000002,
  vesta: 2000004,
  hygiea: 2000010,
};

const dirs = [
  path.join(root, 'src', 'data', 'bodies'),
  path.join(root, 'src', 'data', 'dwarf-planets'),
  path.join(root, 'src', 'data', 'moons'),
  path.join(root, 'src', 'data', 'asteroids'),
];

console.log('=== NASA SPICE PCK RADII & FLATTENING AUDIT ===\n');
console.log('ID'.padEnd(12) + 'JSON R (km)'.padEnd(14) + 'PCK [a, b, c] (km)'.padEnd(30) + 'PCK Req'.padEnd(12) + 'Diff (km)'.padEnd(12) + 'Flattening (f)');
console.log('-'.repeat(95));

for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    const id = json.id;
    const jsonR = json.radiusKm;
    const naif = NAIF_MAP[id];
    let radii = naif ? (extractRadii(pck11, naif) || extractRadii(pck10, naif)) : null;

    let pckReq = 'N/A';
    let diff = 'N/A';
    let flattening = 'N/A';

    if (radii) {
      const [a, b, c] = radii;
      const req = (a + b) / 2;
      pckReq = req.toFixed(1);
      diff = (jsonR - req).toFixed(1);
      if (a > 0 && c > 0) {
        flattening = ((a - c) / a).toFixed(5);
      }
      console.log(
        id.padEnd(12) +
        String(jsonR).padEnd(14) +
        `[${a}, ${b}, ${c}]`.padEnd(30) +
        pckReq.padEnd(12) +
        diff.padEnd(12) +
        flattening
      );
    } else {
      console.log(id.padEnd(12) + String(jsonR).padEnd(14) + 'NOT IN PCK'.padEnd(30));
    }
  }
}
