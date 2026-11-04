// Usage: npm run verify:live
// Production data-freshness gate: re-fetches the exact JPL Horizons vectors our
// bundled body files were built from, plus the NAIF GM kernel, and verifies
// they still match. Exit 0 = truth intact, 1 = upstream changed (re-fetch).
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const EPOCH_JD = 2461319.5;
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const GM_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc';
const CMDS = { sun: '10', mercury: '1', venus: '2', earth: '3', mars: '4', jupiter: '5', saturn: '6', uranus: '7', neptune: '8' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getVectors(cmd, jd) {
  const params = new URLSearchParams({
    format: 'json', COMMAND: `'${cmd}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS', CENTER: "'500@0'", REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF', OUT_UNITS: 'AU-D', VEC_TABLE: '2', CSV_FORMAT: 'YES',
    TLIST: `'${jd.toFixed(9)}'`, TLIST_TYPE: 'JD',
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { result } = await res.json();
      const block = result.match(/\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/);
      if (!block) throw new Error(`no data block:\n${result.slice(0, 300)}`);
      const f = block[1].split('\n')[0].split(',').map((x) => x.trim());
      const v = f.slice(2, 8).map(Number);
      if (v.length !== 6 || v.some(Number.isNaN)) throw new Error('unparseable row');
      return { position: v.slice(0, 3), velocity: v.slice(3, 6) };
    } catch (err) {
      if (attempt >= 4) throw new Error(`Horizons ${cmd}: ${err.message}`);
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

let failures = 0;
console.log('body        max rel.err');
for (const f of (await readdir('src/data/bodies')).filter((x) => x.endsWith('.json')).sort()) {
  const b = JSON.parse(await readFile(`src/data/bodies/${f}`, 'utf8'));
  if (b.initial?.type !== 'vectors' || !(b.id in CMDS)) continue;
  const live = await getVectors(CMDS[b.id], EPOCH_JD);
  let worst = 0;
  for (let k = 0; k < 3; k++) {
    for (const [a, c] of [[b.initial.position, live.position], [b.initial.velocity, live.velocity]]) {
      const denom = Math.max(1e-30, Math.abs(c[k]));
      worst = Math.max(worst, Math.abs(a[k] - c[k]) / denom);
    }
  }
  const ok = worst < 1e-9 ? 'OK' : 'MISMATCH';
  if (worst >= 1e-9) failures++;
  console.log(`${b.id.padEnd(12)} ${worst.toExponential(1).padEnd(10)} ${ok}`);
  await sleep(1200);
}

const gmText = await (await fetch(GM_URL)).text();
const sha = createHash('sha256').update(gmText).digest('hex');
const snap = await readFile('src/data/spice/gm_de440.tpc', 'utf8');
const snapSha = createHash('sha256').update(snap).digest('hex');
console.log(`\ngm_de440.tpc live ${sha.slice(0, 16)}... vs snapshot ${snapSha.slice(0, 16)}...`);
if (sha !== snapSha) {
  console.log('GM kernel CHANGED upstream (content differs, not just formatting)');
  failures++;
} else {
  console.log('GM kernel identical');
}

console.log(failures === 0 ? '\nTRUTH INTACT' : `\n${failures} MISMATCH(S) — run npm run fetch:horizons`);
process.exit(failures === 0 ? 0 : 1);
