import { describe, it, expect } from 'vitest';
import { solveLambert, stumpffC, stumpffS } from '@/physics/lambert';
import { GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import type { Vec3 } from '@/physics/types';
import { Yoshida4 } from '@/physics/integrators/yoshida4';
import { newtonianGravity } from '@/physics/forces/gravity';
import { createState } from '@/physics/system';

describe('Lambert Orbital Boundary Value Solver', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  it('Stumpff functions evaluate correctly for positive, zero, and negative arguments', () => {
    expect(stumpffC(0)).toBeCloseTo(0.5, 9);
    expect(stumpffS(0)).toBeCloseTo(1 / 6, 9);

    const zPos = 1.0;
    expect(stumpffC(zPos)).toBeCloseTo((1 - Math.cos(1)) / 1, 9);
    expect(stumpffS(zPos)).toBeCloseTo((1 - Math.sin(1)) / 1, 9);

    const zNeg = -1.0;
    expect(stumpffC(zNeg)).toBeCloseTo((Math.cosh(1) - 1) / 1, 9);
    expect(stumpffS(zNeg)).toBeCloseTo((Math.sinh(1) - 1) / 1, 9);
  });

  it('solves Earth-to-Mars Hohmann-like transfer trajectory', () => {
    // Earth at 1.0 AU along X axis
    const r1: Vec3 = [1.0, 0, 0];
    // Mars at 1.524 AU at ~180 deg (e.g. 175 deg to avoid exact collinear singularity)
    const angle = (175 * Math.PI) / 180;
    const r2: Vec3 = [1.524 * Math.cos(angle), 1.524 * Math.sin(angle), 0];

    // Transfer time for half Hohmann orbit: ~259 days
    const dtDays = 258.9;

    const sol = solveLambert(muSun, r1, r2, dtDays, true);

    // Theoretical semi-major axis: a ≈ (1.0 + 1.524) / 2 = 1.262 AU
    expect(sol.a).toBeGreaterThan(1.2);
    expect(sol.a).toBeLessThan(1.35);

    // Theoretical eccentricity: e ≈ (1.524 - 1.0) / (1.524 + 1.0) ≈ 0.207
    expect(sol.e).toBeGreaterThan(0.18);
    expect(sol.e).toBeLessThan(0.25);

    // Verify by numerically integrating from r1 with sol.v1 using Yoshida4
    const s = createState([
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 695700, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'craft', name: 'Spacecraft', gm: 0, radiusKm: 1, position: r1, velocity: sol.v1 },
    ]);

    const y4 = new Yoshida4();
    const dt = 0.1;
    const steps = Math.round(dtDays / dt);
    const actualDt = dtDays / steps;

    for (let i = 0; i < steps; i++) {
      y4.step(s, [newtonianGravity], actualDt);
    }

    // After dtDays, spacecraft must arrive at r2
    const scX = s.pos[3]!;
    const scY = s.pos[4]!;
    const scZ = s.pos[5]!;

    const distToTargetAu = Math.hypot(scX - r2[0], scY - r2[1], scZ - r2[2]);
    // Within numerical integration tolerance (< 0.001 AU = ~150,000 km across a 259-day interplanetary flight)
    expect(distToTargetAu).toBeLessThan(0.001);
  });
});
