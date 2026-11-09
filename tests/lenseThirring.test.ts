import { describe, it, expect } from 'vitest';
import { LenseThirring } from '@/physics/forces/lenseThirring';
import { GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import { createState, recenterToBarycenter } from '@/physics/system';
import type { BodyDef } from '@/physics/types';
import { buildForces } from '@/sim/forces';
import { DEFAULT_CONFIG } from '@/sim/config';
import { SimCore } from '@/sim/simCore';

describe('1.5-Post-Newtonian Lense-Thirring Gravitomagnetic Frame-Dragging', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  it('conserves total system linear momentum to machine precision', () => {
    const bodies: BodyDef[] = [
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 696340, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'mercury', name: 'Mercury', gm: muSun * 1.66e-7, radiusKm: 2439.7, position: [0.387, 0, 0], velocity: [0, 0.0276, 0.003] },
      { id: 'earth', name: 'Earth', gm: muSun * 3.0e-6, radiusKm: 6378.1, position: [1.0, 0, 0], velocity: [0, 0.0172, 0] },
    ];

    const state = createState(bodies);
    const acc = new Float64Array(3 * state.n);
    const lt = new LenseThirring({ centralIndex: 0 });

    lt.apply(state, acc);

    // Sum of m_i * a_i must be 0
    let totalFx = 0;
    let totalFy = 0;
    let totalFz = 0;

    for (let i = 0; i < state.n; i++) {
      const m = state.gm[i]!;
      totalFx += m * acc[3 * i]!;
      totalFy += m * acc[3 * i + 1]!;
      totalFz += m * acc[3 * i + 2]!;
    }

    expect(totalFx).toBeCloseTo(0, 14);
    expect(totalFy).toBeCloseTo(0, 14);
    expect(totalFz).toBeCloseTo(0, 14);
  });

  it('evaluates non-zero frame-dragging acceleration for inclined orbits', () => {
    const bodies: BodyDef[] = [
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 696340, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'test', name: 'Test', gm: 1e-12, radiusKm: 1000, position: [0.1, 0, 0], velocity: [0, 0.05, 0.02] },
    ];

    const state = createState(bodies);
    const acc = new Float64Array(3 * state.n);
    const lt = new LenseThirring({ centralIndex: 0 });

    lt.apply(state, acc);

    const aX = acc[3]!;
    const aY = acc[4]!;
    const aZ = acc[5]!;
    const aMag = Math.hypot(aX, aY, aZ);

    // Acceleration should be non-zero and physically tiny (1.5PN order)
    expect(aMag).toBeGreaterThan(0);
    expect(aMag).toBeLessThan(1e-8);
  });

  it('reproduces aligned spin gravitomagnetic field symmetry', () => {
    // Pure Z-aligned spin
    const lt = new LenseThirring({
      centralIndex: 0,
      spinPerUnitMass: [0, 0, 1e-6],
    });

    const bodies: BodyDef[] = [
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 696340, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'orbiter', name: 'Orbiter', gm: 1e-12, radiusKm: 1000, position: [1.0, 0, 0], velocity: [0, 0.0172, 0] },
    ];

    const state = createState(bodies);
    const acc = new Float64Array(3 * state.n);
    lt.apply(state, acc);

    // In equatorial orbit (r in XY, v in XY, S along Z):
    // r x v is along Z, parallel to S.
    // The force in Z should be zero by symmetry
    expect(acc[5]).toBeCloseTo(0, 15);
  });

  it('buildForces and SimCore properly activate 1.5PN Lense-Thirring when enabled', () => {
    const ids = ['sun', 'earth', 'mercury'];
    const forcesWithout = buildForces(ids, { ...DEFAULT_CONFIG, lenseThirring: false });
    expect(forcesWithout.some((f) => f.name === 'lense-thirring-1.5pn')).toBe(false);

    const forcesWith = buildForces(ids, { ...DEFAULT_CONFIG, lenseThirring: true });
    expect(forcesWith.some((f) => f.name === 'lense-thirring-1.5pn')).toBe(true);

    // Verify SimCore setPhysics handles lenseThirring
    const core = new SimCore();
    const bodies: BodyDef[] = [
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 696340, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'jupiter', name: 'Jupiter', gm: muSun * 9.54e-4, radiusKm: 69911, position: [5.2, 0, 0], velocity: [0, 0.0075, 0] },
    ];
    const s = createState(bodies);
    recenterToBarycenter(s);
    const first = core.handle({
      type: 'init',
      t: s.t,
      gm: s.gm,
      pos: s.pos,
      vel: s.vel,
      historyIntervalDays: 1,
    });
    expect(first).not.toBeNull();

    const fSet = core.handle({
      type: 'setPhysics',
      lenseThirring: true,
    });
    expect(fSet).not.toBeNull();

    const fAdv = core.handle({
      type: 'advance',
      gen: 0,
      days: 10,
    });
    expect(fAdv).not.toBeNull();
    expect(fAdv!.invariantOk).toBe(true);
    expect(Number.isFinite(fAdv!.pos[3])).toBe(true);
  });
});
