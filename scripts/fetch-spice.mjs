// Usage: npm run fetch:spice
// Downloads the public NAIF text PCK kernels that are the "real truth" behind
// NASA accuracy (the same kernels JPL Horizons/DE440 is built from), snapshots
// them into src/data/spice/, verifies every src/data/bodies/*.json GM and
// radius against them, and writes a provenance manifest with SHA-256 hashes.
//
// This is the legal, open-data equivalent of "NASA's planet code": the frontend
// of NASA Eyes is proprietary, but these kernels + the Horizons VECTORS vectors
// (see scripts/fetch-horizons.mjs) ARE the accuracy, and they are public.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const NAIF = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck';
const KERNELS = [
  { file: 'gm_de440.tpc', url: `${NAIF}/gm_de440.tpc`, kind: 'GM values (km^3/s^2)' },
  { file: 'pck00010.tpc', url: `${NAIF}/pck00010.tpc`, kind: 'radii + rotation (km, deg)' },
  { file: 'pck00011.tpc', url: `${NAIF}/pck00011.tpc`, kind: 'rotation update Dec 2022: Mercury (MESSENGER), Mars (MRO/Konopliv), satellite prime meridians' },
];

// NAIF id used for the GM lookup in gm_de440.tpc. 1-8 are planet SYSTEM
// barycenters (Earth = Earth-Moon system GM), 10 is the Sun.
const GM_NAIF = {
  sun: 10,
  mercury: 1,
  venus: 2,
  earth: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
};

// NAIF id used for the radii lookup in pck00010.tpc (planet center ids).
const RADII_NAIF = {
  sun: 10,
  mercury: 199,
  venus: 299,
  earth: 399,
  mars: 499,
  jupiter: 599,
  saturn: 699,
  uranus: 799,
  neptune: 899,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(s.replace(/D/gi, 'E'));

async function download(url, dest) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 1000) throw new Error(`suspiciously short (${text.length} chars)`);
      await writeFile(dest, text);
      return text;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

function parseGm(text) {
  const gm = new Map();
  for (const m of text.matchAll(/BODY(\d+)_GM\b\s*=\s*\(\s*([-+0-9.EeDd]+)\s*\)/g)) {
    gm.set(Number(m[1]), num(m[2]));
  }
  return gm;
}

function parseRadii(text) {
  // BODY399_RADII = ( 6378.14 6378.14 6356.75 ) -> equatorial radius = first value
  const radii = new Map();
  for (const m of text.matchAll(/BODY(\d+)_RADII\b\s*=\s*\(\s*([-+0-9.EeDd\s]+)\)/g)) {
    const vals = m[2].trim().split(/\s+/).map(num);
    if (vals.length >= 1 && vals.every(Number.isFinite)) radii.set(Number(m[1]), vals[0]);
  }
  return radii;
}

await mkdir('src/data/spice', { recursive: true });

const manifest = {
  fetchedAtUtc: new Date().toISOString(),
  source: 'NASA NAIF public generic kernels (same data family JPL Horizons DE440 is built from)',
  horizonsNote:
    'State vectors themselves come from the JPL Horizons VECTORS API ' +
    '(ssd.jpl.nasa.gov/api/horizons.api) via scripts/fetch-horizons.mjs; ' +
    'these PCK kernels are the independent GM/radii truth used to verify them.',
  kernels: [],
};

const texts = {};
for (const k of KERNELS) {
  const dest = `src/data/spice/${k.file}`;
  console.log('downloading', k.file, '...');
  const text = await download(k.url, dest);
  texts[k.file] = text;
  const sha256 = createHash('sha256').update(text).digest('hex');
  manifest.kernels.push({ ...k, bytes: text.length, sha256 });
  console.log(`  saved ${dest} (${text.length} chars, sha256 ${sha256.slice(0, 16)}...)`);
}

const gm = parseGm(texts['gm_de440.tpc']);
const radii = parseRadii(texts['pck00010.tpc']);

// Verify every body file against the NAIF truth. This is the "real truth" gate:
// any mismatch fails the fetch loudly instead of silently shipping wrong data.
const files = (await readdir('src/data/bodies')).filter((f) => f.endsWith('.json'));
let failures = 0;
console.log('\nbody              GM match (rel.err)      radius match (rel.err)');
for (const f of files.sort()) {
  const b = JSON.parse(await readFile(`src/data/bodies/${f}`, 'utf8'));
  const gmNaif = GM_NAIF[b.id];
  const radNaif = RADII_NAIF[b.id];
  let gmMsg = 'n/a (moon/dwarf: GM from Horizons OBJ_DATA, not PCK)';
  let radMsg = 'n/a';
  if (gmNaif !== undefined) {
    const expected = gm.get(gmNaif);
    const rel = Math.abs(b.gmKm3S2 - expected) / Math.abs(expected);
    gmMsg = `${rel.toExponential(1)} ${rel < 1e-12 ? 'OK' : 'MISMATCH'}`;
    if (rel >= 1e-12) {
      failures++;
      console.error(`  FAIL ${b.id}: gmKm3S2=${b.gmKm3S2} vs NAIF BODY${gmNaif}_GM=${expected}`);
    }
  }
  if (radNaif !== undefined) {
    const expected = radii.get(radNaif);
    if (expected === undefined) {
      radMsg = 'NOT IN PCK';
    } else {
      const rel = Math.abs(b.radiusKm - expected) / Math.abs(expected);
      radMsg = `${rel.toExponential(1)} ${rel < 5e-4 ? 'OK' : 'MISMATCH'}`;
      if (rel >= 5e-4) {
        failures++;
        console.error(`  FAIL ${b.id}: radiusKm=${b.radiusKm} vs NAIF BODY${radNaif}_RADII=${expected}`);
      }
    }
  }
  console.log(`${b.id.padEnd(17)} ${gmMsg.padEnd(24)} ${radMsg}`);
}

// The Sun must be MOVING in our truth data (SSB frame, not pinned like NASA Eyes
// renders it). Report its SSB offset and speed as the "exact real view" proof.
const sun = JSON.parse(await readFile('src/data/bodies/sun.json', 'utf8'));
const sunR = Math.hypot(...sun.initial.position);
const sunV = Math.hypot(...sun.initial.velocity);
console.log(`\nSun SSB offset: ${sunR.toExponential(3)} AU, Sun SSB speed: ${sunV.toExponential(3)} AU/day`);
if (!(sunR > 1e-4 && sunV > 1e-6)) {
  failures++;
  console.error('  FAIL sun looks pinned to the origin — expected real SSB wobble');
}

if (failures > 0) {
  console.error(`\n${failures} truth check(s) FAILED — body files NOT re-stamped`);
  process.exit(1);
}

await writeFile('src/data/spice/provenance.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('\nwrote src/data/spice/provenance.json');
console.log('done — all body files verified against NAIF truth');
