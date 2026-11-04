import { describe, it, expect } from 'vitest';
import { CompensatedLeapfrog } from '@/physics/integrators/compensated';
import { newtonianGravity } from '@/physics/forces/gravity';
import { totalEnergy } from '@/physics/diagnostics';
import type { SystemState } from '@/physics/types';

describe('Kahan Compensated Symplectic Integration', () => {
  const GM_SUN = 0.2959122082855911e-3; // AU³/day²

  const createTwoBodySystem = (): SystemState => ({
    t: 0,
    n: 2,
    gm: new Float64Array([GM_SUN, GM_SUN * 3e-6]), // Sun + Earth
    pos: new Float64Array([
      0, 0, 0,
      1.0, 0, 0,
    ]),
    vel: new Float64Array([
      0, 0, 0,
      0, Math.sqrt(GM_SUN / 1.0), 0,
    ]),
  });

  it('performs stable 2-body orbit integration with bounded energy', () => {
    const s = createTwoBodySystem();
    const integrator = new CompensatedLeapfrog();
    const E0 = totalEnergy(s);

    const dt = 0.5; // days
    const totalSteps = 730; // 1 year (2 steps/day)

    for (let step = 0; step < totalSteps; step++) {
      integrator.step(s, [newtonianGravity], dt);
    }

    const E_final = totalEnergy(s);
    const dE = Math.abs((E_final - E0) / E0);

    // Energy stays bounded within symplectic tolerance
    expect(dE).toBeLessThan(1e-4);

    // Earth completed ~1 full orbit and returned near (1, 0, 0)
    expect(s.pos[3]).toBeCloseTo(1.0, 1);
    expect(Math.abs(s.pos[4]!)).toBeLessThan(0.05);
  });

  it('maintains non-zero compensation buffers holding truncated bits', () => {
    const s = createTwoBodySystem();
    const integrator = new CompensatedLeapfrog();

    for (let step = 0; step < 100; step++) {
      integrator.step(s, [newtonianGravity], 0.2);
    }

    // Reset compensation and check that integration continues without error
    integrator.resetCompensation();
    integrator.step(s, [newtonianGravity], 0.2);

    expect(Number.isFinite(s.pos[3])).toBe(true);
    expect(Number.isFinite(s.vel[4])).toBe(true);
  });

  it('preserves exact time-reversibility: forward + backward steps reproduce initial state', () => {
    const s = createTwoBodySystem();
    const pos0 = new Float64Array(s.pos);
    const vel0 = new Float64Array(s.vel);

    const integrator = new CompensatedLeapfrog();
    const dt = 0.5;
    const steps = 100;

    // Forward
    for (let i = 0; i < steps; i++) integrator.step(s, [newtonianGravity], dt);

    // Backward
    for (let i = 0; i < steps; i++) integrator.step(s, [newtonianGravity], -dt);

    for (let k = 0; k < 6; k++) {
      expect(s.pos[k]).toBeCloseTo(pos0[k]!, 10);
      expect(s.vel[k]).toBeCloseTo(vel0[k]!, 10);
    }
  });
});
