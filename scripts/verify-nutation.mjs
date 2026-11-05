// Usage: node scripts/verify-nutation.mjs
// End-to-end reality check for the PCK nutation implementation: compares our
// Moon subsolar point (with vs without the nutation series) against JPL
// Horizons OBSERVER quantity 15 (SunSub-LON/LAT). Horizons uses a
// higher-precision lunar rotation model — independent of the truncated PCK
// series we implement — so agreement validates against reality, not ourselves.
//
// Known systematics absorbed by the 0.2° tolerance (documented, not corrected):
//   - Horizons quantity 15 is APPARENT (light-time Sun->Moon->observer): the
//     Moon spins 13.176°/day during ~500 s of light time => ~0.08° longitude.
//   - Horizons latitude is PLANETODETIC (ellipsoid normal); ours is
//     planetocentric: <= ~0.04° for the Moon (f = 0.0012).
// Pass criteria: WITH nutation agrees < 0.2° on all epochs AND WITHOUT
// nutation disagrees > 0.5° on at least one epoch (proves the check has teeth:
// the ~1.5-4° series is load-bearing, not decoration).
import { readFile } from 'node:fs/promises';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const RAD = Math.PI / 180;
const EPOCH_JD = 2461319.5;
const EPOCHS = [EPOCH_JD - 60, EPOCH_JD, EPOCH_JD + 60];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function horizons(params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}?${new URLSearchParams(params)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { result } = await res.json();
      if (!result || result.includes('No ephemeris')) throw new Error(result?.slice(0, 200));
      return result;
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

async function vectors(cmd, jd) {
  const result = await horizons({
    format: 'json', COMMAND: `'${cmd}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS', CENTER: "'500@0'", REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF', OUT_UNITS: 'AU-D', VEC_TABLE: '2', CSV_FORMAT: 'YES',
    TLIST: `'${jd.toFixed(6)}'`, TLIST_TYPE: 'JD',
  });
  const block = result.match(/\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/);
  return block[1].split('\n')[0].split(',').map((x) => x.trim()).slice(2, 5).map(Number);
}

// --- Our orientation model, straight from the shipped data files ---
const moon = JSON.parse(await readFile('src/data/physical/moon.json', 'utf8')).rotation;
const nutTs = await readFile('src/data/nutation.ts', 'utf8');
const sys3 = nutTs.match(/3: \[([\s\S]*?)\n  \],/)[1];
const phases = [...sys3.matchAll(/\[([0-9.eE+-]+),\s*([0-9.eE+-]+),\s*([0-9.eE+-]+)\]/g)]
  .map((m) => m.slice(1, 4).map(Number));
const galaxyTs = await readFile('src/data/galaxy.ts', 'utf8');
const obliquityArcsec = Number(galaxyTs.match(/OBLIQUITY_J2000_RAD = \(\(([\d.]+) \/ 3600\)/)[1]);
const OBL = ((obliquityArcsec / 3600) * Math.PI) / 180;

function moonSubsolar(sunEcl, moonEcl, jd, useNutation) {
  const days = jd - 2451545.0;
  const T = days / 36525;
  let ra = (moon.poleRaDeg + moon.poleRaRateDegPerCy * T) * RAD;
  let dec = (moon.poleDecDeg + moon.poleDecRateDegPerCy * T) * RAD;
  let w = (moon.w0Deg + moon.wRateDegPerDay * days + (moon.wAccelDegPerDay2 ?? 0) * days * days) * RAD;
  if (useNutation) {
    const n = moon.nutation;
    const series = (amps, trig) => {
      let s = 0;
      for (let k = 0; k < Math.min(amps.length, phases.length); k++) {
        if (amps[k] === 0) continue;
        const c = phases[k];
        s += amps[k] * trig((c[0] + c[1] * T) * RAD);
      }
      return s;
    };
    ra += series(n.raAmpDeg, Math.sin) * RAD;
    dec += series(n.decAmpDeg, Math.cos) * RAD;
    w += series(n.wAmpDeg, Math.sin) * RAD;
  }
  // body-fixed <- ecliptic matrix (same construction as bodyToEcliptic)
  const Rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const Rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const mul = (a, b) => { const o = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[3 * i + j] += a[3 * i + k] * b[3 * k + j]; return o; };
  const M = mul(Rx(-OBL), mul(mul(Rz(ra + Math.PI / 2), Rx(Math.PI / 2 - dec)), Rz(w)));
  // Moon -> Sun unit vector (geometric), into body frame via M^T
  const dx = sunEcl[0] - moonEcl[0], dy = sunEcl[1] - moonEcl[1], dz = sunEcl[2] - moonEcl[2];
  const l = Math.hypot(dx, dy, dz);
  const ux = dx / l, uy = dy / l, uz = dz / l;
  const bx = M[0] * ux + M[3] * uy + M[6] * uz;
  const by = M[1] * ux + M[4] * uy + M[7] * uz;
  const bz = M[2] * ux + M[5] * uy + M[8] * uz;
  return { lon: (Math.atan2(by, bx) / RAD + 360) % 360, lat: Math.asin(Math.max(-1, Math.min(1, bz))) / RAD };
}

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
let worstWith = 0;
let worstWithout = 0;
for (const jd of EPOCHS) {
  const truth = await horizons({
    format: 'json', COMMAND: "'301'", OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER', CENTER: "'500@399'", QUANTITIES: "'15'",
    TLIST: `'${jd.toFixed(6)}'`, TLIST_TYPE: 'JD', CSV_FORMAT: 'YES',
  }).then((result) => {
    const block = result.match(/\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/);
    // CSV pads empty columns (", , ,"); filter them before indexing.
    // Trailer confirms "Target pole/equ: MOON_ME {East-longitude positive}".
    const f = block[1].split('\n')[0].split(',').map((x) => x.trim()).filter((x) => x !== '');
    return { lon: Number(f[1]), lat: Number(f[2]) };
  });
  await sleep(1100);
  const sun = await vectors('10', jd);
  await sleep(1100);
  const mon = await vectors('301', jd);
  await sleep(1100);
  const withN = moonSubsolar(sun, mon, jd, true);
  const withoutN = moonSubsolar(sun, mon, jd, false);
  const eWith = Math.max(angDiff(withN.lon, truth.lon), Math.abs(withN.lat - truth.lat));
  const eWithout = Math.max(angDiff(withoutN.lon, truth.lon), Math.abs(withoutN.lat - truth.lat));
  worstWith = Math.max(worstWith, eWith);
  worstWithout = Math.max(worstWithout, eWithout);
  console.log(
    `jd ${jd.toFixed(1)} truth lon=${truth.lon.toFixed(3)} lat=${truth.lat.toFixed(3)}` +
    ` | with-nutation err=${eWith.toFixed(3)}° (lon ${withN.lon.toFixed(3)} lat ${withN.lat.toFixed(3)})` +
    ` | without err=${eWithout.toFixed(3)}°`,
  );
}
console.log(`\nworst WITH nutation: ${worstWith.toFixed(3)}° (require < 0.20°)`);
console.log(`worst WITHOUT nutation: ${worstWithout.toFixed(3)}° (require > 0.50° somewhere)`);
if (worstWith < 0.2 && worstWithout > 0.5) {
  console.log('PASS: nutation series validated against Horizons lunar rotation');
} else {
  console.log('FAIL: nutation validation did not meet criteria');
  process.exit(1);
}
