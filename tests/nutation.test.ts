import { describe, it, expect } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { bodyToEcliptic, poleOf } from '@/physics/orientation';
import { SYSTEM_PHASES, SYSTEM_PHASE_DEGREE } from '@/data/nutation';
import { OBLIQUITY_J2000_RAD } from '@/data/galaxy';
import type { RotationJson } from '@/data/schema';

const model = loadSystem();
const dEpoch = model.epochJd - 2451545.0; // days since J2000 at sim epoch
const RAD = Math.PI / 180;

const withNutation = Object.entries(model.physicalMap)
  .filter(([, p]) => p.rotation?.nutation)
  .map(([id, p]) => [id, p.rotation!] as [string, RotationJson]);

describe('PCK nutation-precession series', () => {
  it('every nutated body has phase data: 19 bodies across systems 3-8', () => {
    expect(withNutation.length).toBeGreaterThanOrEqual(15);
    for (const [id, rot] of withNutation) {
      expect(SYSTEM_PHASES[rot.nutation!.systemId], `${id} phase table`).toBeDefined();
    }
  });

  it('zero amplitudes reproduce the linear model bitwise (superset check)', () => {
    for (const [id, rot] of withNutation) {
      const nulled: RotationJson = {
        ...rot,
        wAccelDegPerDay2: undefined,
        nutation: {
          systemId: rot.nutation!.systemId,
          raAmpDeg: rot.nutation!.raAmpDeg.map(() => 0),
          decAmpDeg: rot.nutation!.decAmpDeg.map(() => 0),
          wAmpDeg: rot.nutation!.wAmpDeg.map(() => 0),
        },
      };
      const linear: RotationJson = { ...rot, wAccelDegPerDay2: undefined, nutation: undefined };
      for (const d of [0, dEpoch, dEpoch + 1000]) {
        const a = bodyToEcliptic(nulled, d);
        const b = bodyToEcliptic(linear, d);
        for (let k = 0; k < 9; k++) expect(a[k], `${id}[${k}]`).toBe(b[k]!);
      }
    }
  });

  it('Io pairing follows the PCK worked example: 0.094 sin(J3) + 0.024 sin(J4)', () => {
    // The PCK's own documentation derives Io's model as
    //   alpha = 268.05 - 0.009 T + 0.094 sin(J3) + 0.024 sin(J4)
    // with J3 = 283.90 + 4850.7 T. The live data area must preserve that
    // angle ordering or every element-wise pairing in the file is suspect.
    const j3 = SYSTEM_PHASES[5]![2]!;
    expect(j3[0]).toBeCloseTo(283.9, 0);
    expect(j3[1]).toBeCloseTo(4850.7, 0);
    const j4 = SYSTEM_PHASES[5]![3]!;
    // Independent hand evaluation straight from the documented formula.
    const T = dEpoch / 36525;
    const J3 = (j3[0] + j3[1] * T) * RAD;
    const J4 = (j4[0] + j4[1] * T) * RAD;
    const handRa = 268.05 - 0.009 * T + 0.094 * Math.sin(J3) + 0.024 * Math.sin(J4);
    const io = model.physicalMap['io']!.rotation!;
    expect(io.poleRaDeg).toBeCloseTo(268.05, 6);
    // Reconstruct RA from the implementation's matrix: poleOf gives the spin
    // axis; recover (ra, dec) of the pole in ICRF equatorial coordinates.
    const M = bodyToEcliptic(io, dEpoch);
    const poleEcl = poleOf(M);
    // Ecliptic -> equatorial (rotate about x by +obliquity; same constant as impl).
    const ce = Math.cos(OBLIQUITY_J2000_RAD);
    const se = Math.sin(OBLIQUITY_J2000_RAD);
    const [x, y, z] = poleEcl;
    const yEq = ce * y! - se * z!;
    const zEq = se * y! + ce * z!;
    const gotRa = ((Math.atan2(yEq, x!) / RAD) + 360) % 360;
    const wantRa = ((handRa % 360) + 360) % 360;
    expect(gotRa).toBeCloseTo(wantRa, 6);
    // Same check for declination locks the cos (not sin) convention for Dec.
    const ioDec = model.physicalMap['io']!.rotation!;
    const phases5 = SYSTEM_PHASES[5]!;
    const decAmp = ioDec.nutation!.decAmpDeg;
    let handDec = ioDec.poleDecDeg + ioDec.poleDecRateDegPerCy! * T;
    for (let k = 0; k < decAmp.length; k++) {
      if (decAmp[k] === 0) continue;
      const c = phases5[k]!;
      handDec += decAmp[k]! * Math.cos((c[0] + c[1] * T) * RAD);
    }
    const gotDec = Math.asin(Math.max(-1, Math.min(1, zEq))) / RAD;
    expect(gotDec).toBeCloseTo(handDec, 6);
  });

  it('Moon pole correction is degrees, not arcseconds or radians (magnitude guard)', () => {
    const moon = model.physicalMap['moon']!.rotation!;
    const full = poleOf(bodyToEcliptic(moon, dEpoch));
    const linear = poleOf(bodyToEcliptic({ ...moon, nutation: undefined }, dEpoch));
    const dot = full[0]! * linear[0]! + full[1]! * linear[1]! + full[2]! * linear[2]!;
    const sepDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    console.log(`Moon nutation pole offset at epoch: ${sepDeg.toFixed(3)}°`);
    expect(sepDeg).toBeGreaterThan(0.5);
    expect(sepDeg).toBeLessThan(5);
  });

  it('Mars system uses quadratic phases (angle 5 carries a T^2 term)', () => {
    expect(SYSTEM_PHASE_DEGREE[4]).toBe(2);
    const a5 = SYSTEM_PHASES[4]![4]!;
    expect(a5[2]).not.toBe(0);
    for (const sys of [3, 5, 6, 7, 8]) {
      expect(SYSTEM_PHASE_DEGREE[sys]).toBe(1);
      for (const c of SYSTEM_PHASES[sys]!) expect(c[2]).toBe(0);
    }
  });

  it('Phobos prime-meridian quadratic contributes ~0.9° at epoch (kept, not dropped)', () => {
    const ph = model.physicalMap['phobos']!.rotation!;
    expect(ph.wAccelDegPerDay2).toBeCloseTo(9.536137031212154e-9, 20);
    const quad = ph.wAccelDegPerDay2! * dEpoch * dEpoch;
    console.log(`Phobos PM quadratic at epoch: ${quad.toFixed(3)}°`);
    expect(Math.abs(quad)).toBeGreaterThan(0.5);
    expect(Math.abs(quad)).toBeLessThan(2);
  });

  it('unknown phase system degrades to the linear model (never crashes)', () => {
    const moon = model.physicalMap['moon']!.rotation!;
    const bogus: RotationJson = {
      ...moon,
      nutation: { ...moon.nutation!, systemId: 999 },
    };
    const a = bodyToEcliptic(bogus, dEpoch);
    const b = bodyToEcliptic({ ...moon, nutation: undefined }, dEpoch);
    for (let k = 0; k < 9; k++) expect(a[k]).toBe(b[k]!);
  });
});
