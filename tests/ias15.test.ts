import { describe, it, expect } from 'vitest';
import { IAS15 } from '@/physics/integrators/ias15';
import { newtonianGravity } from '@/physics/forces/gravity';
import { totalEnergy } from '@/physics/diagnostics';
import type { SystemState } from '@/physics/types';

describe('IAS15 15th-Order Gauss-Radau Integrator (Rein & Spiegel 2015)', () => {
  const GM_SUN = 0.2959122082855911e-3; // AU³/day²

  const createTwoBodySystem = (e = 0): SystemState => {
    const a = 1.0;
    const r0 = a * (1 - e);
    const v0 = Math.sqrt(GM_SUN * (2 / r0 - 1 / a));

    return {
      t: 0,
      n: 2,
      gm: new Float64Array([GM_SUN, GM_SUN * 3e-6]), // Sun + Earth
      pos: new Float64Array([
        0, 0, 0,
        r0, 0, 0,
      ]),
      vel: new Float64Array([
        0, 0, 0,
        0, v0, 0,
      ]),
    };
  };

  it('integrates circular orbit with exceptional 15th-order energy conservation', () => {
    const s = createTwoBodySystem(0);
    const ias15 = new IAS15({ epsilon: 1e-12 });
    const E0 = totalEnergy(s);

    const yearDays = 365.25;
    // Step forward 1 full year
    ias15.step(s, [newtonianGravity], yearDays);

    const E_final = totalEnergy(s);
    const dE = Math.abs((E_final - E0) / E0);

    // 15th-order Gauss-Radau energy precision
    expect(dE).toBeLessThan(1e-8);

    // Earth completes 1 complete circular orbit back to (1, 0, 0)
    expect(s.pos[3]).toBeCloseTo(1.0, 3);
    expect(Math.abs(s.pos[4]!)).toBeLessThan(1e-3);
  });

  it('adapts step-size dynamically through eccentric periapsis passage (e = 0.8)', () => {
    const s = createTwoBodySystem(0.8);
    const ias15 = new IAS15({ epsilon: 1e-12, minDt: 1e-5, maxDt: 5.0 });

    const E0 = totalEnergy(s);

    // Integrate past periapsis
    ias15.step(s, [newtonianGravity], 50.0);

    const E_final = totalEnergy(s);
    const dE = Math.abs((E_final - E0) / E0);

    // High eccentricity handled gracefully by Radau polynomial adaptation
    expect(dE).toBeLessThan(1e-7);
    expect(ias15.currentDt).toBeGreaterThan(0);
  });

  it('exhibits precise time-reversibility: forward + backward steps', () => {
    const s = createTwoBodySystem(0.2);
    const pos0 = new Float64Array(s.pos);
    const vel0 = new Float64Array(s.vel);

    const ias15 = new IAS15({ epsilon: 1e-12 });

    // Forward 30 days
    ias15.step(s, [newtonianGravity], 30.0);

    // Backward 30 days
    ias15.step(s, [newtonianGravity], -30.0);

    for (let k = 0; k < 6; k++) {
      expect(s.pos[k]).toBeCloseTo(pos0[k]!, 7);
      expect(s.vel[k]).toBeCloseTo(vel0[k]!, 7);
    }
  });
});
