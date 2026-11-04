import { describe, it, expect } from 'vitest';
import {
  clenshaw,
  clenshawWithDerivative,
  evaluateChebyshevRecord,
  ChebyshevEphemerisSegment,
  type ChebyshevRecord,
} from '@/sim/chebyshev';

describe('Chebyshev Polynomial Ephemeris & Clenshaw Algorithm', () => {
  it('evaluates Chebyshev polynomial and its analytical derivative to machine precision', () => {
    // f(tau) = c0*T0 + c1*T1 + c2*T2
    // T0 = 1, T1 = tau, T2 = 2*tau^2 - 1
    // Choose c = [3, 2, -4]
    // f(tau) = 3*1 + 2*tau - 4*(2*tau^2 - 1) = 7 + 2*tau - 8*tau^2
    // f'(tau) = 2 - 16*tau
    const c = [3, 2, -4];
    const dt = 10.0; // 10 day interval

    for (let tau = -1.0; tau <= 1.0; tau += 0.2) {
      const val = clenshaw(tau, c);
      const expectedVal = 7 + 2 * tau - 8 * tau * tau;
      expect(val).toBeCloseTo(expectedVal, 12);

      const res = clenshawWithDerivative(tau, dt, c);
      expect(res.pos).toBeCloseTo(expectedVal, 12);

      // d/dt = (2 / dt) * d/dtau
      const expectedVel = (2 / dt) * (2 - 16 * tau);
      expect(res.vel).toBeCloseTo(expectedVel, 12);
    }
  });

  it('evaluates 3D Chebyshev segment with continuity across interval boundaries', () => {
    const rec1: ChebyshevRecord = {
      tStart: 0,
      tEnd: 10,
      cx: [1.0, 0.5, 0.1],
      cy: [0.0, 1.0, -0.2],
      cz: [0.0, 0.0, 0.05],
    };

    // Value of rec1 at t=10 (tau = +1)
    const x10 = clenshaw(1.0, rec1.cx);
    const y10 = clenshaw(1.0, rec1.cy);
    const z10 = clenshaw(1.0, rec1.cz);

    // For rec2 at t=10 (tau = -1), clenshaw(-1, [c0, c1, c2]) = c0 - c1 + c2
    // Choose c1 = 0.4, c2 = 0.05 => c0 = target + c1 - c2
    const rec2: ChebyshevRecord = {
      tStart: 10,
      tEnd: 20,
      cx: [x10 + 0.4 - 0.05, 0.4, 0.05],
      cy: [y10 + 0.8 - (-0.1), 0.8, -0.1],
      cz: [z10 + 0.02 - 0.01, 0.02, 0.01],
    };

    const segment = new ChebyshevEphemerisSegment([rec1, rec2]);

    const stateAt5 = segment.evaluate(5);
    expect(Number.isFinite(stateAt5.pos[0])).toBe(true);
    expect(Number.isFinite(stateAt5.vel[0])).toBe(true);

    // Boundary at t = 10
    const stateAt10_left = evaluateChebyshevRecord(rec1, 10);
    const stateAt10_right = evaluateChebyshevRecord(rec2, 10);
    expect(stateAt10_left.pos[0]).toBeCloseTo(stateAt10_right.pos[0], 10);
    expect(stateAt10_left.pos[1]).toBeCloseTo(stateAt10_right.pos[1], 10);
    expect(stateAt10_left.pos[2]).toBeCloseTo(stateAt10_right.pos[2], 10);
  });
});
