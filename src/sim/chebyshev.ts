import type { Vec3 } from '@/physics/types';

export interface ChebyshevRecord {
  /** Start time of validity in days or JD */
  tStart: number;
  /** End time of validity in days or JD */
  tEnd: number;
  /** Chebyshev coefficients for X, Y, Z components [deg+1 coefficients each] */
  cx: readonly number[];
  cy: readonly number[];
  cz: readonly number[];
}

/**
 * Evaluates a 1D Chebyshev polynomial series using Clenshaw's recurrence algorithm.
 * Stable to machine precision for high-degree polynomials (degree 10-16).
 *
 * @param tau Normalized time in [-1, 1]
 * @param c Chebyshev coefficients [c0, c1, ..., c_N]
 */
export function clenshaw(tau: number, c: readonly number[]): number {
  const n = c.length;
  if (n === 0) return 0;
  if (n === 1) return c[0]!;

  let b1 = 0;
  let b2 = 0;
  const twoTau = 2 * tau;

  for (let k = n - 1; k >= 1; k--) {
    const b0 = twoTau * b1 - b2 + c[k]!;
    b2 = b1;
    b1 = b0;
  }

  return tau * b1 - b2 + c[0]!;
}

/**
 * Evaluates both the position and the analytical derivative (velocity) of a 1D Chebyshev series.
 *
 * @param tau Normalized time in [-1, 1]
 * @param dt Total interval span (tEnd - tStart)
 * @param c Chebyshev coefficients [c0, c1, ..., c_N]
 */
export function clenshawWithDerivative(
  tau: number,
  dt: number,
  c: readonly number[],
): { pos: number; vel: number } {
  const n = c.length;
  if (n === 0) return { pos: 0, vel: 0 };
  if (n === 1) return { pos: c[0]!, vel: 0 };

  let b1 = 0, b2 = 0;
  let d1 = 0, d2 = 0;
  const twoTau = 2 * tau;

  for (let k = n - 1; k >= 1; k--) {
    // Recurrence for derivative
    const d0 = twoTau * d1 - d2 + 2 * b1;
    d2 = d1;
    d1 = d0;

    // Recurrence for value
    const b0 = twoTau * b1 - b2 + c[k]!;
    b2 = b1;
    b1 = b0;
  }

  const pos = tau * b1 - b2 + c[0]!;
  const dPosDtau = tau * d1 - d2 + b1;
  const vel = (2 / dt) * dPosDtau;

  return { pos, vel };
}

/**
 * Evaluates 3D position and velocity state vector from a Chebyshev record (NAIF SPK Type 2/3 style).
 */
export function evaluateChebyshevRecord(
  rec: ChebyshevRecord,
  t: number,
): { pos: Vec3; vel: Vec3 } {
  const dt = rec.tEnd - rec.tStart;
  const tau = Math.max(-1.0, Math.min(1.0, (2 * (t - rec.tStart)) / dt - 1.0));

  const xRes = clenshawWithDerivative(tau, dt, rec.cx);
  const yRes = clenshawWithDerivative(tau, dt, rec.cy);
  const zRes = clenshawWithDerivative(tau, dt, rec.cz);

  return {
    pos: [xRes.pos, yRes.pos, zRes.pos],
    vel: [xRes.vel, yRes.vel, zRes.vel],
  };
}

/**
 * Evaluates Chebyshev ephemeris across an array of time intervals (binary SPK segment).
 */
export class ChebyshevEphemerisSegment {
  private readonly records: readonly ChebyshevRecord[];

  constructor(records: readonly ChebyshevRecord[]) {
    this.records = [...records].sort((a, b) => a.tStart - b.tStart);
  }

  evaluate(t: number): { pos: Vec3; vel: Vec3 } {
    if (this.records.length === 0) {
      return { pos: [0, 0, 0], vel: [0, 0, 0] };
    }

    // Binary search for matching record
    let low = 0;
    let high = this.records.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const r = this.records[mid]!;
      if (t >= r.tStart && t <= r.tEnd) {
        return evaluateChebyshevRecord(r, t);
      }
      if (t < r.tStart) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Clamped fallback to boundary
    const boundary = t < this.records[0]!.tStart ? this.records[0]! : this.records[this.records.length - 1]!;
    return evaluateChebyshevRecord(boundary, t);
  }
}
