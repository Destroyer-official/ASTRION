import type { Vec3 } from './types';

export interface Elements {
  a: number;
  e: number;
  inc: number;
  node: number;
  argPeri: number;
  meanAnom: number;
  period: number;
}

export type KeplerElements = Elements;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/**
 * Converts Cartesian state (position r, velocity v) to Keplerian orbital elements.
 * Fully supports elliptic (e < 1), parabolic (e ≈ 1), and hyperbolic (e > 1) orbits.
 */
export function stateToElements(mu: number, r: Vec3, v: Vec3): Elements {
  const rl = len(r);
  const h = cross(r, v);
  const hl = len(h);
  const hh: Vec3 = [h[0] / hl, h[1] / hl, h[2] / hl];
  const vxh = cross(v, h);
  const ev: Vec3 = [vxh[0] / mu - r[0] / rl, vxh[1] / mu - r[1] / rl, vxh[2] / mu - r[2] / rl];
  const e = len(ev);
  const energy = dot(v, v) / 2 - mu / rl;
  const a = Math.abs(energy) > 1e-15 ? -mu / (2 * energy) : Infinity;

  const inc = Math.acos(Math.max(-1, Math.min(1, hh[2])));
  const nl = Math.hypot(h[0], h[1]); // |k x h|
  const N: Vec3 = nl > 1e-12 * hl ? [-h[1] / nl, h[0] / nl, 0] : [1, 0, 0]; // ascending node direction
  const node = Math.atan2(N[1], N[0]);
  const P: Vec3 = e > 1e-12 ? [ev[0] / e, ev[1] / e, ev[2] / e] : [r[0] / rl, r[1] / rl, r[2] / rl];
  const argPeri = Math.atan2(dot(P, cross(hh, N)), dot(P, N));
  const Q = cross(hh, P);
  const nu = Math.atan2(dot(r, Q), dot(r, P));

  let meanAnom = 0;
  let period = Infinity;

  if (e < 1 - 1e-7) {
    // Elliptic
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    meanAnom = E - e * Math.sin(E);
    if (meanAnom < 0) meanAnom += 2 * Math.PI;
    period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
  } else if (e > 1 + 1e-7) {
    // Hyperbolic
    const denom = 1 + e * Math.cos(nu);
    if (Math.abs(denom) > 1e-12) {
      const sinhH = (Math.sqrt(e * e - 1) * Math.sin(nu)) / denom;
      const H = Math.asinh(sinhH);
      meanAnom = e * Math.sinh(H) - H;
    }
    period = Infinity;
  } else {
    // Parabolic (Barker's equation)
    const B = Math.tan(nu / 2);
    meanAnom = B + (B * B * B) / 3;
    period = Infinity;
  }

  return { a, e, inc, node, argPeri, meanAnom, period };
}

/**
 * Solves Kepler's equation M = E - e*sin(E) for elliptic orbits (e < 1).
 */
export function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 50; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/**
 * Solves Hyperbolic Kepler's equation M_h = e*sinh(H) - H for hyperbolic orbits (e > 1).
 * Uses Halley's cubically convergent method.
 */
export function solveKeplerHyperbolic(M: number, e: number): number {
  let H = Math.abs(M) > 2 ? Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8) : M / (e - 1);
  for (let i = 0; i < 50; i++) {
    const sinhH = Math.sinh(H);
    const coshH = Math.cosh(H);
    const f = e * sinhH - H - M;
    const f1 = e * coshH - 1;
    const f2 = e * sinhH;
    const d = (2 * f * f1) / (2 * f1 * f1 - f * f2);
    H -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return H;
}

/**
 * Solves Barker's equation M_p = B + B^3/3 for parabolic orbits (e = 1).
 */
export function solveBarker(Mp: number): number {
  const w = (3 * Mp) / 2;
  const sqrtTerm = Math.sqrt(w * w + 1);
  return Math.cbrt(w + sqrtTerm) - Math.cbrt(sqrtTerm - w);
}

/**
 * Converts Keplerian orbital elements to Cartesian state (position r, velocity v).
 * Handles elliptic (e < 1), hyperbolic (e > 1), and parabolic (e ≈ 1) trajectories.
 */
export function elementsToState(
  mu: number,
  a: number,
  e: number,
  inc: number,
  node: number,
  w: number,
  M: number,
): { pos: Vec3; vel: Vec3 } {
  const cO = Math.cos(node),
    sO = Math.sin(node),
    cw = Math.cos(w),
    sw = Math.sin(w),
    ci = Math.cos(inc),
    si = Math.sin(inc);
  const P: Vec3 = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Q: Vec3 = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];

  if (e < 1 - 1e-7) {
    // Elliptic
    const E = solveKepler(M, e),
      cE = Math.cos(E),
      sE = Math.sin(E),
      q = Math.sqrt(Math.max(0, 1 - e * e));
    const r = a * (1 - e * cE),
      k = Math.sqrt(mu * a) / r;
    const pos: Vec3 = [
      a * (cE - e) * P[0]! + a * q * sE * Q[0]!,
      a * (cE - e) * P[1]! + a * q * sE * Q[1]!,
      a * (cE - e) * P[2]! + a * q * sE * Q[2]!,
    ];
    const vel: Vec3 = [
      k * (-sE * P[0]! + q * cE * Q[0]!),
      k * (-sE * P[1]! + q * cE * Q[1]!),
      k * (-sE * P[2]! + q * cE * Q[2]!),
    ];
    return { pos, vel };
  } else if (e > 1 + 1e-7) {
    // Hyperbolic
    const absA = Math.abs(a);
    const H = solveKeplerHyperbolic(M, e);
    const coshH = Math.cosh(H);
    const sinhH = Math.sinh(H);
    const q = Math.sqrt(e * e - 1);
    const r = absA * (e * coshH - 1);
    const k = Math.sqrt(mu * absA) / r;
    const rP = absA * (e - coshH);
    const rQ = absA * q * sinhH;
    const vP = -k * sinhH;
    const vQ = k * q * coshH;
    const pos: Vec3 = [
      rP * P[0]! + rQ * Q[0]!,
      rP * P[1]! + rQ * Q[1]!,
      rP * P[2]! + rQ * Q[2]!,
    ];
    const vel: Vec3 = [
      vP * P[0]! + vQ * Q[0]!,
      vP * P[1]! + vQ * Q[1]!,
      vP * P[2]! + vQ * Q[2]!,
    ];
    return { pos, vel };
  } else {
    // Parabolic
    const B = solveBarker(M);
    const nu = 2 * Math.atan(B);
    const p = Math.abs(a) < 1e12 && Math.abs(a) > 0 ? 2 * Math.abs(a) : 1.0;
    const r = p / (1 + Math.cos(nu));
    const k = Math.sqrt(mu / p);
    const pos: Vec3 = [
      r * Math.cos(nu) * P[0]! + r * Math.sin(nu) * Q[0]!,
      r * Math.cos(nu) * P[1]! + r * Math.sin(nu) * Q[1]!,
      r * Math.cos(nu) * P[2]! + r * Math.sin(nu) * Q[2]!,
    ];
    const vel: Vec3 = [
      k * (-Math.sin(nu) * P[0]! + (1 + Math.cos(nu)) * Q[0]!),
      k * (-Math.sin(nu) * P[1]! + (1 + Math.cos(nu)) * Q[1]!),
      k * (-Math.sin(nu) * P[2]! + (1 + Math.cos(nu)) * Q[2]!),
    ];
    return { pos, vel };
  }
}
