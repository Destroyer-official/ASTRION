import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHYSICAL_MAP } from '@/sim/registry';
import { SYSTEM_PHASES } from '@/data/nutation';

// Rotation models (pole + prime meridian) verified against the independent
// NASA NAIF PCK snapshot pck00011.tpc (Dec 2022: IAU WGCCRE incl. MESSENGER
// Mercury pole and Konopliv MRO Mars solution), not just self-consistency.
// NAIF ids are planet/moon CENTER ids (199, 299, ..., 301, 501, ...).
const spiceUrl = (f: string) => fileURLToPath(new URL(`../src/data/spice/${f}`, import.meta.url));
const pck = readFileSync(spiceUrl('pck00011.tpc'), 'utf8');

const num = (s: string) => Number(s.replace(/D/gi, 'E'));

function triple(key: string): [number, number, number] {
  // Last match wins: the PCK's documentation comments contain example
  // assignments (e.g. the 2006 Jupiter/Io model) while the current data area
  // always comes later. [^()]+ cannot cross parens so multi-line arrays are
  // safe. Uppercase = current; lowercase fallback = previous values kept
  // in-file (used only where no update exists).
  const v = block(key);
  if (v.length < 2 || !v.every(Number.isFinite)) throw new Error(`${key} not found in PCK snapshot`);
  return [v[0]!, v[1]!, v[2] ?? 0];
}

/** Full current-values array for a PCK kernel variable (last assignment). */
function block(key: string): number[] {
  for (const tag of [`BODY${key}`, `body${key.toLowerCase()}`]) {
    const re = new RegExp(`${tag}\\s*=\\s*\\(\\s*([^()]+)\\)`, 'g');
    let m: RegExpExecArray | null = null;
    let last: RegExpExecArray | null = null;
    while ((m = re.exec(pck)) !== null) last = m;
    if (!last) continue;
    const v = last[1]!.trim().split(/\s+/).map(num);
    if (v.length >= 1 && v.every(Number.isFinite)) return v;
  }
  throw new Error(`${key} not found in PCK snapshot`);
}

const NAIF_CENTER: Record<string, number> = {
  mercury: 199,
  venus: 299,
  earth: 399,
  mars: 499,
  jupiter: 599,
  saturn: 699,
  uranus: 799,
  neptune: 899,
  moon: 301,
  phobos: 401,
  deimos: 402,
  io: 501,
  europa: 502,
  ganymede: 503,
  callisto: 504,
  mimas: 601,
  enceladus: 602,
  tethys: 603,
  dione: 604,
  rhea: 605,
  titan: 606,
  iapetus: 608,
  ariel: 701,
  umbriel: 702,
  titania: 703,
  oberon: 704,
  miranda: 705,
  triton: 801,
  sun: 10,
};

// Values newer than any PCK data area (mirrors scripts/sync-rotation.mjs):
// Jupiter System-III spin from IAU 2015 (Archinal et al. 2018); pck00011's
// own worked example is labeled "2015 IAU Model" with W = 284.95+870.5366420 d
// while its data area retains the older linear rate. Display-only either way.
const OVERRIDES: Record<string, Record<string, number>> = {
  jupiter: { wRateDegPerDay: 870.536642 },
};

describe('rotation models vs NAIF PCK (IAU WGCCRE)', () => {
  const rows: Array<[string, number]> = Object.entries(NAIF_CENTER).filter(([id]) => PHYSICAL_MAP[id]?.rotation);
  it.each(rows)('%s pole + spin matches PCK', (id, naif) => {
    const rot = PHYSICAL_MAP[id]!.rotation!;
    const ra = triple(`${naif}_POLE_RA`);
    const dec = triple(`${naif}_POLE_DEC`);
    const pm = triple(`${naif}_PM`);
    const ov = OVERRIDES[id] ?? {};
    const want = {
      poleRaDeg: ra[0],
      poleRaRateDegPerCy: ra[1],
      poleDecDeg: dec[0],
      poleDecRateDegPerCy: dec[1],
      w0Deg: pm[0],
      wRateDegPerDay: pm[1],
      ...ov,
    } as Record<string, number>;
    for (const [field, expected] of Object.entries(want)) {
      const got = (rot as unknown as Record<string, number | undefined>)[field];
      expect(got, `${id} ${field}`).toBeCloseTo(expected!, 6);
    }
    // Prime-meridian quadratic term (scaled 1/36525^2 in-file, x days^2).
    // Stored only when nonzero (Phobos, Moon); otherwise absent.
    const quad = pm[2] ?? 0;
    if (quad !== 0) {
      expect(rot.wAccelDegPerDay2, `${id} wAccelDegPerDay2`).toBeCloseTo(quad, 12);
    } else {
      expect(rot.wAccelDegPerDay2, `${id} wAccelDegPerDay2 absent`).toBeUndefined();
    }
  });

  it.each(rows)('%s nutation series matches PCK', (id, naif) => {
    const rot = PHYSICAL_MAP[id]!.rotation!;
    let hasTerms = false;
    let systemId = 0;
    try {
      const raA = block(`${naif}_NUT_PREC_RA`);
      const decA = block(`${naif}_NUT_PREC_DEC`);
      const wA = block(`${naif}_NUT_PREC_PM`);
      hasTerms = [...raA, ...decA, ...wA].some((x) => x !== 0);
      // Parent planet's phase system: Earth/Moon=3, Mars system=4, ... (mirrors sync script).
      const parent: Record<string, number> = {
        moon: 3, mars: 4, phobos: 4, deimos: 4,
        jupiter: 5, io: 5, europa: 5, ganymede: 5, callisto: 5,
        saturn: 6, mimas: 6, enceladus: 6, tethys: 6, dione: 6, rhea: 6, titan: 6, iapetus: 6,
        uranus: 7, ariel: 7, umbriel: 7, titania: 7, oberon: 7, miranda: 7,
        neptune: 8, triton: 8,
      };
      systemId = parent[id] ?? 0;
      if (hasTerms && systemId) {
        const n = rot.nutation;
        expect(n, `${id} nutation block present`).toBeDefined();
        expect(n!.systemId, `${id} systemId`).toBe(systemId);
        expect(n!.raAmpDeg, `${id} raAmpDeg`).toEqual(raA);
        expect(n!.decAmpDeg, `${id} decAmpDeg`).toEqual(decA);
        expect(n!.wAmpDeg, `${id} wAmpDeg`).toEqual(wA);
        const phases = SYSTEM_PHASES[systemId]!;
        expect(phases, `phase table ${systemId}`).toBeDefined();
        for (const amps of [n!.raAmpDeg, n!.decAmpDeg, n!.wAmpDeg]) {
          expect(amps.length, `${id} amps fit phases`).toBeLessThanOrEqual(phases.length);
        }
      } else {
        expect(rot.nutation, `${id} no nutation block`).toBeUndefined();
      }
    } catch {
      // No NUT_PREC arrays in PCK: no block expected.
      expect(rot.nutation, `${id} no nutation block`).toBeUndefined();
    }
  });
});
