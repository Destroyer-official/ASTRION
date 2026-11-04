// Usage: node scripts/fetch-dense.mjs
// Dense near-epoch anchor table for EXACT ephemeris display: inner bodies +
// Moon at 36h cadence (fast movers need it: Mercury 88d, Moon 27d), outer
// bodies + Sun at 9-day cadence over [epoch-365d, epoch+730d]. Uses one
// Horizons VECTORS series request per body (START_TIME/STOP_TIME/STEP_SIZE),
// so the whole table costs ~10 API calls, not thousands.
// Output: src/data/dense-reference.json (runtime, git-tracked).
import { writeFile } from 'node:fs/promises';

const EPOCH_JD = 2461319.5;
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const INNER = [
  { id: 'mercury', cmd: '1' },
  { id: 'venus', cmd: '2' },
  { id: 'earth', cmd: '3' },
  { id: 'mars', cmd: '4' },
  { id: 'moon', cmd: '301' },
];
const OUTER = [
  { id: 'sun', cmd: '10' },
  { id: 'jupiter', cmd: '5' },
  { id: 'saturn', cmd: '6' },
  { id: 'uranus', cmd: '7' },
  { id: 'neptune', cmd: '8' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSeries(cmd, fromJd, toJd, stepDays, label) {
  const params = new URLSearchParams({
    format: 'json', COMMAND: `'${cmd}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS', CENTER: "'500@0'", REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF', OUT_UNITS: 'AU-D', VEC_TABLE: '2', CSV_FORMAT: 'YES',
    START_TIME: `'JD${fromJd.toFixed(1)}'`, STOP_TIME: `'JD${toJd.toFixed(1)}'`,
    STEP_SIZE: stepDays === 1.5 ? "'36h'" : `'${stepDays}d'`,
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { result } = await res.json();
      const block = result.match(/\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/);
      if (!block) throw new Error(`no data block:\n${String(result).slice(0, 300)}`);
      const rows = block[1].split('\n').map((l) => l.trim()).filter(Boolean);
      // Round for bundle size (644KB -> ~400KB): 9 decimals of AU = 150 m on
      // positions (far below display/seed need), 12 on velocities. Re-running
      // this script reproduces the committed file bit-for-bit.
      const r9 = (x) => Math.round(x * 1e9) / 1e9;
      const r12 = (x) => Math.round(x * 1e12) / 1e12;
      return rows.map((row) => {
        const f = row.split(',').map((x) => x.trim());
        const jd = Number(f[0]);
        const v = f.slice(2, 8).map(Number);
        if (!Number.isFinite(jd) || v.length !== 6 || v.some(Number.isNaN)) {
          throw new Error(`unparseable row: ${row.slice(0, 120)}`);
        }
        return { jd, p: v.slice(0, 3).map(r9), v: v.slice(3, 6).map(r12) };
      });
    } catch (err) {
      if (attempt >= 4) throw new Error(`[${label}] Horizons series ${cmd}: ${err.message}`);
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

const from = EPOCH_JD - 365;
const to = EPOCH_JD + 730;
const byBody = {};
for (const b of INNER) {
  console.log(`fetching ${b.id} (36h cadence)...`);
  byBody[b.id] = await getSeries(b.cmd, from, to, 1.5, b.id);
  console.log(`  ${byBody[b.id].length} epochs`);
  await sleep(1500);
}
for (const b of OUTER) {
  console.log(`fetching ${b.id} (9d cadence)...`);
  byBody[b.id] = await getSeries(b.cmd, from, to, 9, b.id);
  console.log(`  ${byBody[b.id].length} epochs`);
  await sleep(1500);
}

// Union of all epoch times; each sample carries the bodies sampled at that jd.
const jdSet = new Set();
for (const rows of Object.values(byBody)) for (const r of rows) jdSet.add(r.jd);
const samples = [...jdSet].sort((a, b) => a - b).map((jd) => {
  const bodies = {};
  for (const [id, rows] of Object.entries(byBody)) {
    const hit = rows.find((r) => r.jd === jd);
    if (hit) bodies[id] = { p: hit.p, v: hit.v };
  }
  return { jd, bodies };
});

await writeFile(
  'src/data/dense-reference.json',
  JSON.stringify({ epochJd: EPOCH_JD, samples }) + '\n',
);
console.log(`done: src/data/dense-reference.json (${samples.length} epochs)`);
