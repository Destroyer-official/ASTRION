import { writeFile } from 'node:fs/promises';

const EPOCH_JD = 2461319.5;
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const MOONS = [
  // Earth
  { id: 'moon', name: 'Moon', cmd: '301', center: '500@399', parent: 'earth', radiusKm: 1737.4, color: '#c0c0c0', knownGm: 4902.800118 },
  // Mars
  { id: 'phobos', name: 'Phobos', cmd: '401', center: '500@499', parent: 'mars', radiusKm: 11.27, color: '#9e9185', knownGm: 0.0007087 },
  { id: 'deimos', name: 'Deimos', cmd: '402', center: '500@499', parent: 'mars', radiusKm: 6.2, color: '#a89f91', knownGm: 0.0000962 },
  // Jupiter (Galilean)
  { id: 'io', name: 'Io', cmd: '501', center: '500@599', parent: 'jupiter', radiusKm: 1821.6, color: '#f8d030', knownGm: 5959.916 },
  { id: 'europa', name: 'Europa', cmd: '502', center: '500@599', parent: 'jupiter', radiusKm: 1560.8, color: '#b8a080', knownGm: 3202.739 },
  { id: 'ganymede', name: 'Ganymede', cmd: '503', center: '500@599', parent: 'jupiter', radiusKm: 2634.1, color: '#8d8276', knownGm: 9887.834 },
  { id: 'callisto', name: 'Callisto', cmd: '504', center: '500@599', parent: 'jupiter', radiusKm: 2410.3, color: '#685e54', knownGm: 7179.289 },
  // Saturn
  { id: 'mimas', name: 'Mimas', cmd: '601', center: '500@699', parent: 'saturn', radiusKm: 198.2, color: '#b0b0b0', knownGm: 2.5026 },
  { id: 'enceladus', name: 'Enceladus', cmd: '602', center: '500@699', parent: 'saturn', radiusKm: 252.1, color: '#ffffff', knownGm: 7.2104 },
  { id: 'tethys', name: 'Tethys', cmd: '603', center: '500@699', parent: 'saturn', radiusKm: 531.1, color: '#cccccc', knownGm: 41.2067 },
  { id: 'dione', name: 'Dione', cmd: '604', center: '500@699', parent: 'saturn', radiusKm: 561.4, color: '#c4c4c4', knownGm: 73.1146 },
  { id: 'rhea', name: 'Rhea', cmd: '605', center: '500@699', parent: 'saturn', radiusKm: 763.8, color: '#c8c8c8', knownGm: 153.942 },
  { id: 'titan', name: 'Titan', cmd: '606', center: '500@699', parent: 'saturn', radiusKm: 2574.7, color: '#e0a040', knownGm: 8978.1382 },
  { id: 'hyperion', name: 'Hyperion', cmd: '607', center: '500@699', parent: 'saturn', radiusKm: 135.0, color: '#908070', knownGm: 0.3727 },
  { id: 'iapetus', name: 'Iapetus', cmd: '608', center: '500@699', parent: 'saturn', radiusKm: 734.5, color: '#605040', knownGm: 120.5038 },
  // Uranus
  { id: 'ariel', name: 'Ariel', cmd: '701', center: '500@799', parent: 'uranus', radiusKm: 578.9, color: '#c8c8c8', knownGm: 83.5 },
  { id: 'umbriel', name: 'Umbriel', cmd: '702', center: '500@799', parent: 'uranus', radiusKm: 584.7, color: '#707070', knownGm: 85.1 },
  { id: 'titania', name: 'Titania', cmd: '703', center: '500@799', parent: 'uranus', radiusKm: 788.4, color: '#c0b8b0', knownGm: 228.2 },
  { id: 'oberon', name: 'Oberon', cmd: '704', center: '500@799', parent: 'uranus', radiusKm: 761.4, color: '#b0a098', knownGm: 192.6 },
  { id: 'miranda', name: 'Miranda', cmd: '705', center: '500@799', parent: 'uranus', radiusKm: 235.8, color: '#d0d0d0', knownGm: 4.3 },
  // Neptune
  { id: 'triton', name: 'Triton', cmd: '801', center: '500@899', parent: 'neptune', radiusKm: 1353.4, color: '#e0d8d0', knownGm: 1427.6 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getVectors(cmd, center, jd) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${cmd}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`,
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
      if (!block) throw new Error(`no data block:\n${result.slice(0, 600)}`);
      const f = block[1].split('\n')[0].split(',').map((x) => x.trim());
      const v = f.slice(2, 8).map(Number);
      if (v.length !== 6 || v.some(Number.isNaN)) throw new Error(`unparseable row: ${f.join(',')}`);
      return { position: v.slice(0, 3), velocity: v.slice(3, 6) };
    } catch (err) {
      if (attempt >= 4) throw new Error(`Horizons ${cmd}: ${err.message}`);
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

async function getGm(cmd) {
  try {
    const params = new URLSearchParams({
      format: 'json',
      COMMAND: `'${cmd}'`,
      OBJ_DATA: 'YES',
      MAKE_EPHEM: 'NO',
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) return null;
    const { result } = await res.json();
    const m = result.match(/GM\s*(?:,\s*km\^3\/s\^2)?\s*=\s*([0-9.]+)/i);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

console.log('Fetching moons...');
for (const m of MOONS) {
  const { position, velocity } = await getVectors(m.cmd, m.center, EPOCH_JD);
  const fetchedGm = await getGm(m.cmd);
  const gmKm3S2 = fetchedGm ?? m.knownGm;

  const json = {
    id: m.id,
    name: m.name,
    parent: m.parent,
    gmKm3S2,
    radiusKm: m.radiusKm,
    color: m.color,
    initial: {
      type: 'vectors',
      about: 'parent',
      epochJd: EPOCH_JD,
      position,
      velocity,
    },
  };

  await writeFile(`src/data/bodies/${m.id}.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`Wrote ${m.name} (${m.id}) GM=${gmKm3S2}`);
  await sleep(1100);
}

console.log('Done fetching moons!');
