import { describe, it, expect } from 'vitest';
import { elementsToState, stateToElements, solveKeplerHyperbolic } from '@/physics/kepler';
import { GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import type { Vec3 } from '@/physics/types';

describe('Universal Kepler & Hyperbolic Conics', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  it('Halley solver for hyperbolic Kepler equation converges accurately', () => {
    const e = 1.5;
    const M = 2.0;
    const H = solveKeplerHyperbolic(M, e);
    const residual = e * Math.sinh(H) - H - M;
    expect(Math.abs(residual)).toBeLessThan(1e-12);
  });

  it('handles hyperbolic flybys (e = 1.4) without NaNs', () => {
    const a = -2.0; // Hyperbolic semi-major axis (conventionally negative)
    const e = 1.4;
    const inc = (15 * Math.PI) / 180;
    const node = (45 * Math.PI) / 180;
    const w = (30 * Math.PI) / 180;
    const M = 0.5;

    const { pos, vel } = elementsToState(muSun, a, e, inc, node, w, M);

    expect(Number.isFinite(pos[0])).toBe(true);
    expect(Number.isFinite(pos[1])).toBe(true);
    expect(Number.isFinite(pos[2])).toBe(true);
    expect(Number.isFinite(vel[0])).toBe(true);
    expect(Number.isFinite(vel[1])).toBe(true);
    expect(Number.isFinite(vel[2])).toBe(true);

    // Round trip back to elements
    const elems = stateToElements(muSun, pos, vel);
    expect(elems.e).toBeCloseTo(e, 5);
    expect(elems.a).toBeCloseTo(a, 3);
    expect(elems.inc).toBeCloseTo(inc, 5);
    expect(elems.period).toBe(Infinity);
  });

  it('handles extreme interstellar hyperbolic trajectories (e = 3.2, like 1I/`Oumuamua)', () => {
    const r: Vec3 = [1.2, 0.5, -0.3];
    // High velocity exceeding solar escape speed (v_esc = sqrt(2*mu/r) ≈ 0.024 AU/day)
    const v: Vec3 = [0.035, 0.012, 0.018];

    const elems = stateToElements(muSun, r, v);
    expect(elems.e).toBeGreaterThan(1.5);
    expect(elems.a).toBeLessThan(0); // Hyperbolic
    expect(elems.period).toBe(Infinity);

    // Round-trip conversion preserves position and velocity
    const { pos: rBack, vel: vBack } = elementsToState(
      muSun,
      elems.a,
      elems.e,
      elems.inc,
      elems.node,
      elems.argPeri,
      elems.meanAnom,
    );

    for (let k = 0; k < 3; k++) {
      expect(rBack[k]).toBeCloseTo(r[k]!, 4);
      expect(vBack[k]).toBeCloseTo(v[k]!, 5);
    }
  });

  it('handles parabolic threshold (e = 1.0)', () => {
    const a = 1.0;
    const e = 1.0;
    const { pos, vel } = elementsToState(muSun, a, e, 0, 0, 0, 0.2);

    expect(Number.isNaN(pos[0])).toBe(false);
    expect(Number.isNaN(vel[0])).toBe(false);

    const elems = stateToElements(muSun, pos, vel);
    expect(elems.e).toBeCloseTo(1.0, 3);
  });
});
