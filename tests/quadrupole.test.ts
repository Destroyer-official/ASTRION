import { describe, it, expect } from 'vitest';
import { SolarQuadrupole } from '@/physics/forces/quadrupole';
import { PHYSICAL_MAP } from '@/sim/registry';
import type { SystemState } from '@/physics/types';

describe('SolarQuadrupole (J2)', () => {
  it('conserves total system momentum (Newton third law reaction on Sun)', () => {
    const s: SystemState = {
      t: 0,
      n: 2,
      gm: new Float64Array([1000, 1]),
      pos: new Float64Array([0, 0, 0, 1, 0.5, 0.2]),
      vel: new Float64Array(6),
    };
    const acc = new Float64Array(6);
    const j2 = new SolarQuadrupole(0);
    j2.apply(s, acc);

    // Sum of m * a should be zero
    const pX = s.gm[0]! * acc[0]! + s.gm[1]! * acc[3]!;
    const pY = s.gm[0]! * acc[1]! + s.gm[1]! * acc[4]!;
    const pZ = s.gm[0]! * acc[2]! + s.gm[1]! * acc[5]!;
    expect(Math.hypot(pX, pY, pZ)).toBeCloseTo(0, 14);
  });

  it('equatorial acceleration is inward toward Sun, polar perturbation is outward', () => {
    const j2 = new SolarQuadrupole(0, 2.2e-7, 695700, [0, 0, 1]);

    // Body on equatorial plane (+x axis)
    const sEq: SystemState = {
      t: 0,
      n: 2,
      gm: new Float64Array([1000, 1]),
      pos: new Float64Array([0, 0, 0, 1, 0, 0]),
      vel: new Float64Array(6),
    };
    const accEq = new Float64Array(6);
    j2.apply(sEq, accEq);
    expect(accEq[3]).toBeLessThan(0); // extra mass at equator pulls inward (-x)

    // Body on polar axis (+z axis)
    const sPole: SystemState = {
      t: 0,
      n: 2,
      gm: new Float64Array([1000, 1]),
      pos: new Float64Array([0, 0, 0, 0, 0, 1]),
      vel: new Float64Array(6),
    };
    const accPole = new Float64Array(6);
    j2.apply(sPole, accPole);
    expect(accPole[5]).toBeGreaterThan(0); // polar perturbation opposes Newtonian pull (+z)
  });
});

describe('J2 coefficients vs published ephemeris values', () => {
  // Sun: Park et al. 2021 (DE440). Giants: per-mission gravity solutions
  // (JUP365/SAT441/URA111/NEP097 via IAU). Earth/Mars: GRACE/MRO standard.
  const KNOWN_J2: Record<string, number> = {
    sun: 2.2e-7,
    earth: 1.08263e-3,
    mars: 0.00196,
    jupiter: 1.4736e-2,
    saturn: 1.6298e-2,
    uranus: 0.003343,
    neptune: 0.003411,
  };
  it.each(Object.entries(KNOWN_J2))('%s J2 matches published value', (id, j2) => {
    const got = PHYSICAL_MAP[id]!.j2;
    expect(got, `${id} J2`).toBeDefined();
    expect(Math.abs(got! - j2) / j2).toBeLessThan(1e-3);
  });
});
