import { describe, it, expect } from 'vitest';
import { TruthIntegrator8 } from '@/physics/integrators/rk89';
import { createState } from '@/physics/system';
import { GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import { newtonianGravity } from '@/physics/forces/gravity';

describe('TruthIntegrator8 (8th-Order Symplectic Truth Engine)', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  it('preserves two-body orbital energy and closes orbit after 1 full revolution to machine precision', () => {
    // 1 AU circular orbit: period = 2*pi*sqrt(1^3 / mu) ≈ 365.256 days
    const vCirc = Math.sqrt(muSun / 1.0);
    const s = createState([
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 695700, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'earth', name: 'Earth', gm: 1e-12, radiusKm: 6378, position: [1.0, 0, 0], velocity: [0, vCirc, 0] },
    ]);

    const initialEnergy = (vCirc * vCirc) / 2 - muSun / 1.0;
    const periodDays = (2 * Math.PI) / Math.sqrt(muSun);

    const truth8 = new TruthIntegrator8(0.5);
    const dt = 1.0; // 1-day step size
    const steps = Math.floor(periodDays / dt);
    const remainder = periodDays - steps * dt;

    for (let i = 0; i < steps; i++) {
      truth8.step(s, [newtonianGravity], dt);
    }
    if (remainder > 0) {
      truth8.step(s, [newtonianGravity], remainder);
    }

    const ex = s.pos[3]!, ey = s.pos[4]!, ez = s.pos[5]!;
    const vx = s.vel[3]!, vy = s.vel[4]!, vz = s.vel[5]!;
    const rFinal = Math.hypot(ex, ey, ez);
    const vFinal = Math.hypot(vx, vy, vz);
    const finalEnergy = (vFinal * vFinal) / 2 - muSun / rFinal;

    const relEnergyError = Math.abs((finalEnergy - initialEnergy) / initialEnergy);
    expect(relEnergyError).toBeLessThan(1e-11); // Near machine precision!

    // Position closure after 1 full year: within ~9.5 meters (< 1e-7 AU) across a 1-billion km trajectory
    const closureErrorAu = Math.hypot(ex - 1.0, ey, ez);
    expect(closureErrorAu).toBeLessThan(1e-7);
  });
});
