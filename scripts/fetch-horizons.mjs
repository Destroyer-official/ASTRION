// Usage: npm run fetch:horizons [-- epochJD]      default 2461319.5 = 2026-10-06 00:00 TDB
// Offline GM: GM_FILE=path/to/gm_de440.tpc npm run fetch:horizons
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const EPOCH_JD = Number(process.argv[2] ?? 2461319.5);
const REF_OFFSETS_DAYS = [365.25, 3652.5, 18262.5, -3652.5]; // +1 yr, +10 yr, +50 yr, -10 yr
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const GM_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc';

// cmd = Horizons COMMAND. 1-8 are planetary SYSTEM barycenters, 10 is the Sun.
// naif = index in gm_de440.tpc (BODY<n>_GM): same numbering.
// dir = output subdirectory under src/data (planets vs asteroids).
const BODIES = [
  { id: 'sun', name: 'Sun', cmd: '10', naif: 10, radiusKm: 695700, color: '#ffcc33' },
  { id: 'mercury', name: 'Mercury', cmd: '1', naif: 1, radiusKm: 2440.53, color: '#a8a29e' },
  { id: 'venus', name: 'Venus', cmd: '2', naif: 2, radiusKm: 6051.8, color: '#e6c88a' },
  {
    id: 'earth', name: 'Earth', cmd: '3', naif: 3, radiusKm: 6378.137, color: '#4f8ff7',
    note: 'Earth-Moon system barycenter and combined GM. Split in Phase 5.',
  },
  {
    id: 'mars', name: 'Mars', cmd: '4', naif: 4, radiusKm: 3396.2, color: '#d1603d',
    note: 'Mars system barycenter (with Phobos and Deimos).',
  },
  {
    id: 'jupiter', name: 'Jupiter', cmd: '5', naif: 5, radiusKm: 71492, color: '#d9a066',
    note: 'Jupiter system barycenter (with moons).',
  },
  {
    id: 'saturn', name: 'Saturn', cmd: '6', naif: 6, radiusKm: 60268, color: '#e3cf9a',
    note: 'Saturn system barycenter (with moons).',
  },
  {
    id: 'uranus', name: 'Uranus', cmd: '7', naif: 7, radiusKm: 25559, color: '#9bd7e0',
    note: 'Uranus system barycenter (with moons).',
  },
  {
    id: 'neptune', name: 'Neptune', cmd: '8', naif: 8, radiusKm: 24764, color: '#4b70dd',
    note: 'Neptune system barycenter (with moons).',
  },
];

// The four most massive main-belt asteroids (~60% of belt mass after Ceres'
// ~1/3 share): their pull moves Mars by ~10 km/decade and Jupiter by ~20 km.
// Same SSB ecliptic/ICRF vectors as planets; no reference-sample anchors
// (like moons, they freeze at epoch in ephemeris display mode).
// Small bodies need DES=<id>; lookup syntax (bare SPK ids only resolve for
// Ceres-class major entries).
const ASTEROIDS = [
  { id: 'ceres', name: 'Ceres', cmd: 'DES=2000001;', naif: 2000001, radiusKm: 469.7, color: '#9aa0a6' },
  { id: 'pallas', name: 'Pallas', cmd: 'DES=2000002;', naif: 2000002, radiusKm: 273, color: '#a89e97' },
  { id: 'vesta', name: 'Vesta', cmd: 'DES=2000004;', naif: 2000004, radiusKm: 262.7, color: '#b0a696' },
  { id: 'hygiea', name: 'Hygiea', cmd: 'DES=2000010;', naif: 2000010, radiusKm: 217, color: '#8d8578' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getVectors(cmd, jd) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${cmd}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@0'",
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    CSV_FORMAT: 'YES',
    TLIST: `'${jd.toFixed(9)}'`,
    TLIST_TYPE: 'JD',
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { result } = await res.json();
      const block = result.match(/\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/);
      if (!block) throw new Error(`no data block:\n${result.slice(0, 800)}`);
      const f = block[1].split('\n')[0].split(',').map((x) => x.trim());
      // CSV row: JDTDB, calendar, X, Y, Z, VX, VY, VZ
      if (Math.abs(Number(f[0]) - jd) > 1e-6) throw new Error(`epoch mismatch: asked ${jd}, got ${f[0]}`);
      const v = f.slice(2, 8).map(Number);
      if (v.length !== 6 || v.some(Number.isNaN)) throw new Error(`unparseable row: ${f.join(',')}`);
      return { position: v.slice(0, 3), velocity: v.slice(3, 6) };
    } catch (err) {
      if (attempt >= 4) throw new Error(`Horizons ${cmd} @ ${jd}: ${err.message}`);
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

async function loadGm() {
  const text = process.env.GM_FILE
    ? await readFile(process.env.GM_FILE, 'utf8')
    : await (await fetch(GM_URL)).text();
  const gm = new Map();
  for (const m of text.matchAll(/BODY(\d+)_GM\b\s*=\s*\(\s*([-+0-9.EeDd]+)\s*\)/g)) {
    gm.set(Number(m[1]), Number(m[2].replace(/D/gi, 'E')));
  }
  for (const b of [...BODIES, ...ASTEROIDS]) if (!gm.has(b.naif)) throw new Error(`GM for NAIF ${b.naif} (${b.id}) not found`);
  return gm;
}

const gm = await loadGm();
await mkdir('src/data/bodies', { recursive: true });
await mkdir('src/data/asteroids', { recursive: true });
await mkdir('tests/fixtures', { recursive: true });

const ONLY = process.env.ONLY; // e.g. ONLY=asteroids npm run fetch:horizons
const doPlanets = !ONLY || ONLY === 'planets';
const doAsteroids = !ONLY || ONLY === 'asteroids';

for (const b of [...BODIES.map((x) => ({ ...x, dir: 'bodies' })), ...ASTEROIDS.map((x) => ({ ...x, dir: 'asteroids' }))]) {
  if (b.dir === 'bodies' && !doPlanets) continue;
  if (b.dir === 'asteroids' && !doAsteroids) continue;
  const { position, velocity } = await getVectors(b.cmd, EPOCH_JD);
  const json = {
    id: b.id,
    name: b.name,
    gmKm3S2: gm.get(b.naif),
    radiusKm: b.radiusKm,
    color: b.color,
    ...(b.note ? { note: b.note } : {}),
    source: `JPL Horizons COMMAND=${b.cmd}, CENTER=500@0, ecliptic/ICRF, JD ${EPOCH_JD} TDB; GM: gm_de440.tpc`,
    initial: { type: 'vectors', epochJd: EPOCH_JD, position, velocity },
  };
  // NOTE: planet files carry hand-added fields (notes, gmIsSystem) that a full
  // re-fetch would strip; asteroid files are fully generated (no extras).
  // Prefer ONLY=asteroids for routine asteroid refreshes.
  const dest = `src/data/${b.dir}/${b.id}.json`;
  await writeFile(dest, JSON.stringify(json, null, 2) + '\n');
  console.log('wrote', b.id);
  await sleep(1200);
}

if (!doPlanets) {
  console.log('done (asteroids only; reference samples untouched)');
  process.exit(0);
}

const samples = [];
for (const offsetDays of REF_OFFSETS_DAYS) {
  const bodies = {};
  for (const b of BODIES) {
    bodies[b.id] = (await getVectors(b.cmd, EPOCH_JD + offsetDays)).position;
    await sleep(1200);
  }
  samples.push({ offsetDays, bodies });
  console.log('reference', offsetDays, 'd');
}
await writeFile(
  'tests/fixtures/horizons-reference.json',
  JSON.stringify({ epochJd: EPOCH_JD, samples }, null, 2) + '\n',
);
console.log('done');
