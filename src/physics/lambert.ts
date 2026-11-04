import type { Vec3 } from './types';
import { stateToElements } from './kepler';

export interface LambertSolution {
  /** Initial velocity at r1 (departure velocity) in AU/day */
  v1: Vec3;
  /** Final velocity at r2 (arrival velocity) in AU/day */
  v2: Vec3;
  /** Semi-major axis of transfer orbit in AU */
  a: number;
  /** Eccentricity of transfer orbit */
  e: number;
  /** Semi-major axis alias */
  semiMajorAxis?: number;
  /** Eccentricity alias */
  eccentricity?: number;
  /** Time of flight in days */
  dt: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export function stumpffC(z: number): number {
  if (z > 1e-5) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-5) return (Math.cosh(Math.sqrt(-z)) - 1) / (-z);
  return 0.5 - z / 24 + (z * z) / 720;
}

export function stumpffS(z: number): number {
  if (z > 1e-5) {
    const sz = Math.sqrt(z);
    return (sz - Math.sin(sz)) / (sz * sz * sz);
  }
  if (z < -1e-5) {
    const sz = Math.sqrt(-z);
    return (Math.sinh(sz) - sz) / (sz * sz * sz);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * Solves Lambert's orbital boundary-value problem using universal variables.
 * Given initial position r1, final position r2, time of flight dt, and gravitational parameter mu,
 * returns the departure velocity v1 and arrival velocity v2.
 *
 * References:
 * - Bate, Mueller, White (1971) "Fundamentals of Astrodynamics"
 * - Vallado (2013) "Fundamentals of Astrodynamics and Applications", Algorithm 58
 */
export function solveLambert(
  mu: number,
  r1: Vec3,
  r2: Vec3,
  dtDays: number,
  prograde = true,
): LambertSolution {
  if (dtDays <= 0) throw new Error('Time of flight dt must be positive');

  const r1Len = len(r1);
  const r2Len = len(r2);
  const cosDeltaNu = Math.max(-1, Math.min(1, dot(r1, r2) / (r1Len * r2Len)));
  const c12 = cross(r1, r2);

  let deltaNu = Math.acos(cosDeltaNu);
  if (prograde) {
    if (c12[2] < 0) deltaNu = 2 * Math.PI - deltaNu;
  } else {
    if (c12[2] >= 0) deltaNu = 2 * Math.PI - deltaNu;
  }

  const sinDeltaNu = Math.sin(deltaNu);
  const A = sinDeltaNu * Math.sqrt((r1Len * r2Len) / (1 - cosDeltaNu));
  if (Math.abs(A) < 1e-12) {
    throw new Error('Lambert transfer angle is 180 degrees (collinear singularity)');
  }

  const tof = (z: number): { t: number; y: number } => {
    const c = stumpffC(z);
    const s = stumpffS(z);
    const y = r1Len + r2Len + A * ((z * s - 1) / Math.sqrt(c));
    if (y < 0) return { t: NaN, y };
    const chi = Math.sqrt(y / c);
    const t = (chi * chi * chi * s + A * Math.sqrt(y)) / Math.sqrt(mu);
    return { t, y };
  };

  // Find z such that tof(z).t == dtDays
  // t(z) is monotonically increasing with z
  let zLow = -4 * Math.PI * Math.PI;
  let zHigh = 4 * Math.PI * Math.PI;

  // Refine bounds where y > 0
  while (tof(zLow).y < 0 && zLow < zHigh) {
    zLow = 0.5 * (zLow + zHigh);
  }

  let z = 0;
  for (let iter = 0; iter < 100; iter++) {
    const { t } = tof(z);
    if (isNaN(t)) {
      z = 0.5 * (zLow + zHigh);
      continue;
    }
    const err = t - dtDays;
    if (Math.abs(err) < 1e-10 * dtDays) break;

    // Because t(z) increases with z:
    // If t > dtDays (err > 0), z is too large, so move zHigh down.
    // If t < dtDays (err < 0), z is too small, so move zLow up.
    if (err > 0) {
      zHigh = z;
    } else {
      zLow = z;
    }
    z = 0.5 * (zLow + zHigh);
  }

  const { y } = tof(z);
  const f = 1 - y / r1Len;
  const g = A * Math.sqrt(y / mu);
  const gDot = 1 - y / r2Len;

  const v1: Vec3 = [
    (r2[0] - f * r1[0]) / g,
    (r2[1] - f * r1[1]) / g,
    (r2[2] - f * r1[2]) / g,
  ];

  const v2: Vec3 = [
    (gDot * r2[0] - r1[0]) / g,
    (gDot * r2[1] - r1[1]) / g,
    (gDot * r2[2] - r1[2]) / g,
  ];

  const elems = stateToElements(mu, r1, v1);

  return {
    v1,
    v2,
    a: elems.a,
    e: elems.e,
    semiMajorAxis: elems.a,
    eccentricity: elems.e,
    dt: dtDays,
  };
}
