// Usage: node scripts/sync-rotation.mjs [--write]
// Syncs src/data/physical/*.json rotation fields FROM the NAIF PCK snapshot
// (pck00011.tpc, Dec 2022: IAU WGCCRE including MESSENGER Mercury pole and the
// Konopliv MRO Mars solution), fixing transcription errors and filling missing
// precession rates. Also extracts periodic nutation terms (NUT_PREC_RA/DEC/PM
// paired element-wise with the parent system's NUT_PREC_ANGLES phase
// polynomials; RA/W pair with sin, Dec with cos per the PCK's own worked
// example) and the prime-meridian quadratic term into rotation.nutation /
// rotation.wAccelDegPerDay2, and writes the system phase tables to
// src/data/nutation.ts. Values newer than any PCK data area are pinned via
// OVERRIDES (with citations). Without --write, prints the diff table only.
//
// Parsing rule: LAST array assignment wins. The PCK's documentation comments
// contain example assignments (e.g. the 2006 Jupiter/Io model); the current
// data area always comes later. Lowercase tags are previous values, used only
// as fallback when no current (uppercase) assignment exists.
import { readFile, writeFile, readdir } from 'node:fs/promises';

const WRITE = process.argv.includes('--write');
const PCK = 'src/data/spice/pck00011.tpc';
const NAIF_CENTER = {
  mercury: 199, venus: 299, earth: 399, mars: 499, jupiter: 599, saturn: 699,
  uranus: 799, neptune: 899, sun: 10, moon: 301,
  phobos: 401, deimos: 402, io: 501, europa: 502, ganymede: 503, callisto: 504,
  mimas: 601, enceladus: 602, tethys: 603, dione: 604, rhea: 605, titan: 606,
  iapetus: 608, ariel: 701, umbriel: 702, titania: 703, oberon: 704,
  miranda: 705, triton: 801,
};
// Nutation phase system per body: the parent planet's phase set (NAIF system
// ids 3..8 for Earth..Neptune). Only bodies with NUT_PREC arrays get a block.
const NUT_SYSTEM = {
  moon: 3,
  mars: 4, phobos: 4, deimos: 4,
  jupiter: 5, io: 5, europa: 5, ganymede: 5, callisto: 5,
  saturn: 6, mimas: 6, enceladus: 6, tethys: 6, dione: 6, rhea: 6, titan: 6, iapetus: 6,
  uranus: 7, ariel: 7, umbriel: 7, titania: 7, oberon: 7, miranda: 7,
  neptune: 8, triton: 8,
};
// Values newer than any PCK data area: Jupiter's System-III spin rate from
// the IAU 2015 report (Archinal et al. 2018). pck00011.tpc's own worked
// example is explicitly labeled "2015 IAU Model" with W = 284.95+870.5366420 d
// while its data area retains the older linear rate — we follow the report.
// Display-only either way (rotation never enters the gravity computation).
const OVERRIDES = {
  jupiter: { wRateDegPerDay: 870.536642 },
};

const num = (s) => Number(s.replace(/D/gi, 'E'));
const text = await readFile(PCK, 'utf8');

/** All assignments of TAG = ( ... ) in file order (values may span lines). */
function allBlocks(tag) {
  const out = [];
  const re = new RegExp(`${tag}\\s*=\\s*\\(\\s*([^()]+)\\)`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[1].trim().split(/\s+/).map(num);
    if (v.length >= 1 && v.every(Number.isFinite)) out.push(v);
  }
  return out;
}

/** Current (uppercase) assignment, last wins; else previous (lowercase). */
function block(naif, key) {
  const up = allBlocks(`BODY${naif}_${key}`);
  if (up.length > 0) return { v: up[up.length - 1], fallback: false, count: up.length };
  const lo = allBlocks(`body${naif}_${key.toLowerCase()}`);
  if (lo.length > 0) return { v: lo[lo.length - 1], fallback: true, count: lo.length };
  return null;
}

// ---- System phase tables (written to src/data/nutation.ts when --write) ----
const PHASE_SYSTEMS = [3, 4, 5, 6, 7, 8];
const phases = {};
for (const sys of PHASE_SYSTEMS) {
  const degMatch = text.match(new RegExp(`BODY${sys}_MAX_PHASE_DEGREE\\s*=\\s*(\\d+)`));
  const degree = degMatch ? Number(degMatch[1]) : 1;
  const blk = block(sys, 'NUT_PREC_ANGLES');
  if (!blk) {
    console.log(`system ${sys}: NO phase angles found`);
    continue;
  }
  const per = degree + 1;
  if (blk.v.length % per !== 0) {
    console.log(`system ${sys}: angle count ${blk.v.length} not divisible by ${per} — SKIP`);
    continue;
  }
  const table = [];
  for (let i = 0; i < blk.v.length; i += per) {
    table.push([blk.v[i], blk.v[i + 1], per > 2 ? blk.v[i + 2] : 0]);
  }
  phases[sys] = { degree, table, multi: blk.count };
  console.log(`system ${sys}: degree ${degree}, ${table.length} phase angles (${blk.count} assignment(s)${blk.fallback ? ', previous-values' : ''})`);
}

const FIELDS = [
  ['poleRaDeg', 'POLE_RA', 0],
  ['poleRaRateDegPerCy', 'POLE_RA', 1],
  ['poleDecDeg', 'POLE_DEC', 0],
  ['poleDecRateDegPerCy', 'POLE_DEC', 1],
  ['w0Deg', 'PM', 0],
  ['wRateDegPerDay', 'PM', 1],
];

const isZeroish = (a) => a.every((x) => x === 0);
let changed = 0;
for (const f of (await readdir('src/data/physical')).filter((x) => x.endsWith('.json')).sort()) {
  const id = f.replace(/\.json$/, '');
  const naif = NAIF_CENTER[id];
  const p = JSON.parse(await readFile(`src/data/physical/${f}`, 'utf8'));
  if (!p.rotation || naif === undefined) {
    console.log(`${id.padEnd(12)} SKIP (no rotation or no NAIF id)`);
    continue;
  }
  const ra = block(naif, 'POLE_RA'), dec = block(naif, 'POLE_DEC'), pm = block(naif, 'PM');
  if (!ra || !dec || !pm) {
    console.log(`${id.padEnd(12)} SKIP (missing PCK entry)`);
    continue;
  }
  const src = { POLE_RA: ra.v, POLE_DEC: dec.v, PM: pm.v };
  const fb = [ra, dec, pm].some((t) => t.fallback) ? ' (previous-values fallback)' : '';
  const ov = OVERRIDES[id] ?? {};
  let line = `${id.padEnd(12)}`;
  let dirty = false;
  const set = (field, want) => {
    const had = p.rotation[field];
    if (had !== want) {
      dirty = true;
      line += `\n                 ${field}: ${had === undefined ? '(missing)' : JSON.stringify(had)} -> ${JSON.stringify(want)}`;
      if (want === undefined) delete p.rotation[field];
      else p.rotation[field] = want;
    }
  };
  for (const [field, key, idx] of FIELDS) set(field, ov[field] ?? src[key][idx]);
  // Prime-meridian quadratic term (scaled 1/36525^2 in-file, multiplies d^2).
  set('wAccelDegPerDay2', pm.v[2] === 0 || pm.v[2] === undefined ? undefined : pm.v[2]);

  // Periodic nutation terms.
  const sys = NUT_SYSTEM[id];
  const nra = sys ? block(naif, 'NUT_PREC_RA') : null;
  const ndec = sys ? block(naif, 'NUT_PREC_DEC') : null;
  const npm = sys ? block(naif, 'NUT_PREC_PM') : null;
  if (sys && nra && ndec && npm && !(isZeroish(nra.v) && isZeroish(ndec.v) && isZeroish(npm.v))) {
    const want = { systemId: sys, raAmpDeg: nra.v, decAmpDeg: ndec.v, wAmpDeg: npm.v };
    const hadJson = JSON.stringify(p.rotation.nutation ?? null);
    if (hadJson !== JSON.stringify(want)) {
      dirty = true;
      const sig = (a) => a.filter((x) => x !== 0).length;
      line += `\n                 nutation: ${hadJson === 'null' ? '(missing)' : '(differs)'} -> sys${sys} ra${nra.v.length}/${sig(nra.v)} dec${ndec.v.length}/${sig(ndec.v)} w${npm.v.length}/${sig(npm.v)} max|.|=${Math.max(...nra.v.map(Math.abs), ...ndec.v.map(Math.abs), ...npm.v.map(Math.abs)).toFixed(4)}`;
      p.rotation.nutation = want;
    }
  } else if (p.rotation.nutation) {
    dirty = true;
    line += `\n                 nutation: (removed, no PCK terms)`;
    delete p.rotation.nutation;
  } else {
    line += '';
  }

  if (dirty) {
    changed++;
    console.log(line + fb);
    if (WRITE) await writeFile(`src/data/physical/${f}`, JSON.stringify(p, null, 2) + '\n');
  } else {
    console.log(`${id.padEnd(12)} ok${fb}`);
  }
}

if (WRITE) {
  const sysLines = Object.entries(phases)
    .map(([sys, { degree, table }]) => {
      const rows = table.map(([c0, c1, c2]) => `    [${c0}, ${c1}, ${c2}],`).join('\n');
      return `  ${sys}: [\n${rows}\n  ], // ${table.length} angles, polynomial degree ${degree}`;
    })
    .join('\n');
  const ts = `// DO NOT EDIT — generated by scripts/sync-rotation.mjs --write from
// src/data/spice/pck00011.tpc (NAIF IAU WGCCRE, Dec 2022).
// Nutation-precession phase polynomials per planet system (NAIF system ids
// 3..8). phase[i] = c0 + (c1 + c2*T) * T degrees, T = centuries past J2000
// (TDB). Body NUT_PREC amplitude element k pairs with phase k of the body's
// system (first min(len) pairs); RA/W amplitudes multiply sin(phase),
// Dec amplitudes multiply cos(phase) — see the PCK's worked example.
// Quadratic phases (degree 2) exist only for the Mars system (BODY4).
export const SYSTEM_PHASE_DEGREE: Record<number, number> = {\n${Object.entries(phases).map(([s, { degree }]) => `  ${s}: ${degree},`).join('\n')}\n};\n\nexport const SYSTEM_PHASES: Record<number, Array<readonly [number, number, number]>> = {\n${sysLines}\n};\n`;
  await writeFile('src/data/nutation.ts', ts);
  console.log('\nwrote src/data/nutation.ts');
}
console.log(changed === 0 ? '\nall rotation models already match' : `\n${changed} file(s) ${WRITE ? 'updated' : 'would change (rerun with --write)'}`);
