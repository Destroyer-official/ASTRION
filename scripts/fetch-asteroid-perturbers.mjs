#!/usr/bin/env node
/**
 * Regenerate the 12 SB441-N16 massive-asteroid perturber files that this script
 * introduced (the original four are curated and stay untouched).
 *
 * GM comes from the checksummed local `src/data/spice/gm_de440.tpc`; state vectors
 * and mean radius come from JPL Horizons barycentric (CENTER=500@0) ecliptic/ICRF
 * output, read from the $$SOE…$$EOE vector table — never from the heliocentric
 * initial-element block in the response header. Every file records the center
 * solution and perturber set Horizons reports.
 *
 * Usage: node scripts/fetch-asteroid-perturbers.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const EPOCH_JD = 2461319.5;
const GM_FILE = 'src/data/spice/gm_de440.tpc';
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const NEW_PERTURBERS = [
  ['juno', 'Juno', 2000003, '#b0a696'],
  ['iris', 'Iris', 2000007, '#d6c8ad'],
  ['eunomia', 'Eunomia', 2000015, '#b8a98f'],
  ['psyche', 'Psyche', 2000016, '#a18f7b'],
  ['euphrosyne', 'Euphrosyne', 2000031, '#93a5ae'],
  ['asteroid-52', 'Europa (asteroid)', 2000052, '#9aa0a6'],
  ['cybele', 'Cybele', 2000065, '#8b7f71'],
  ['sylvia', 'Sylvia', 2000087, '#867a6f'],
  ['thisbe', 'Thisbe', 2000088, '#c0a882'],
  ['camilla', 'Camilla', 2000107, '#777069'],
  ['davida', 'Davida', 2000511, '#7f8d96'],
  ['interamnia', 'Interamnia', 2000704, '#8d99a6'],
];

const gmText = await readFile(GM_FILE, 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [id, name, naifId, color] of NEW_PERTURBERS) {
  const gmMatch = gmText.match(new RegExp(`BODY${naifId}_GM\\s*=\\s*\\(\\s*([-+0-9.EeDd]+)\\s*\\)`));
  if (!gmMatch) throw new Error(`GM missing for ${name}`);
  const gm = Number(String(gmMatch[1]).replace(/D/gi, 'E'));

  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'DES=${naifId};'`,
    OBJ_DATA: 'YES',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@0'",
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '3',
    TLIST: `'${EPOCH_JD.toFixed(9)}'`,
    TLIST_TYPE: 'JD',
  });

  const response = await fetch(`${API}?${params}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const result = await response.text();

  const blockStart = result.indexOf('$$SOE');
  const blockEnd = result.indexOf('$$EOE');
  if (blockStart < 0 || blockEnd <= blockStart) throw new Error(`${name}: no SOE/EOE vector block`);
  const block = result.slice(blockStart, blockEnd);
  const row = block.match(
    /X\s*=\s*([-+0-9.Ee]+)\s+Y\s*=\s*([-+0-9.Ee]+)\s+Z\s*=\s*([-+0-9.Ee]+)[\s\S]*?VX\s*=\s*([-+0-9.Ee]+)\s+VY\s*=\s*([-+0-9.Ee]+)\s+VZ\s*=\s*([-+0-9.Ee]+)/,
  );
  if (!row) throw new Error(`${name}: no vector block`);
  const radius = result.match(/RAD\s*=\s*([-+0-9.]+)/);
  if (!radius) throw new Error(`${name}: no mean radius`);

  const sourceMatch = result.match(/Center body name:.*\{source:\s*([^}]+)\}/i);
  const perturberMatch = result.match(/Small perturbers:\s*Yes\s*\{source:\s*([^}]+)\}/i);
  const json = {
    id,
    name,
    gmKm3S2: gm,
    radiusKm: Number(radius[1]),
    color,
    note: 'ASSIST/JPL n16 massive-asteroid perturber set.',
    source:
      `JPL Horizons DES=${naifId};, CENTER=500@0, ecliptic/ICRF, JD ${EPOCH_JD} TDB; ` +
      `mean radius: Horizons RAD; GM: gm_de440.tpc; ` +
      `center source: ${sourceMatch?.[1]?.trim() ?? 'unreported'}; ` +
      `perturber file: ${perturberMatch?.[1]?.trim() ?? 'unreported'}`,
    initial: {
      type: 'vectors',
      epochJd: EPOCH_JD,
      position: row.slice(1, 4).map(Number),
      velocity: row.slice(4, 7).map(Number),
    },
  };

  await writeFile(`src/data/asteroids/${id}.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`${name}: radius ${json.radiusKm} km, GM ${json.gmKm3S2} km^3/s^2`);
  await sleep(1200);
}
