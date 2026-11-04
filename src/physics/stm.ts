/**
 * State Transition Matrix (STM) & Variational Equations
 * ======================================================
 *
 * Implements the 6×6 State Transition Matrix Φ(t, t₀) for mapping
 * perturbations in spacecraft state from epoch t₀ to time t. The STM
 * is the foundation for orbit determination (OD), covariance propagation,
 * trajectory correction maneuver (TCM) design, and statistical navigation.
 *
 * The variational equations Φ̇ = A(t)Φ are integrated simultaneously
 * with the equations of motion using RK4, where A(t) is the Jacobian
 * (gravity gradient tensor) of the force field.
 *
 * References:
 * - Tapley, Schutz & Born (2004): "Statistical Orbit Determination",
 *   Academic Press, Ch. 4-6
 * - Montenbruck & Gill (2000): "Satellite Orbits", Springer, Ch. 7
 * - Battin (1999): "An Introduction to the Mathematics and Methods
 *   of Astrodynamics", Ch. 9-10
 *
 * All units: AU (distances), AU/day (velocities), AU³/day² (GM).
 * Pure physics — no DOM, no Three.js, no Date.now().
 */

import type { Vec3 } from './types';

/* ── vec3 helpers ─────────────────────────────────────────────────── */
const vmag = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/* ── 6×6 Matrix type (flat row-major Float64Array) ───────────────── */

/** A 6×6 matrix stored as a flat 36-element Float64Array (row-major). */
export type Mat6 = Float64Array;

/** Creates a 6×6 identity matrix. */
export function mat6Identity(): Mat6 {
  const m = new Float64Array(36);
  for (let i = 0; i < 6; i++) m[i * 6 + i] = 1;
  return m;
}

/** Creates a 6×6 zero matrix. */
export function mat6Zero(): Mat6 {
  return new Float64Array(36);
}

/** Gets element at (row, col) from a 6×6 matrix. */
export function mat6Get(m: Mat6, row: number, col: number): number {
  return m[row * 6 + col]!;
}

/** Sets element at (row, col) in a 6×6 matrix. */
export function mat6Set(m: Mat6, row: number, col: number, val: number): void {
  m[row * 6 + col] = val;
}

/** Matrix multiply: C = A × B for 6×6 matrices. */
export function mat6Mul(A: Mat6, B: Mat6): Mat6 {
  const C = mat6Zero();
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) {
        s += A[i * 6 + k]! * B[k * 6 + j]!;
      }
      C[i * 6 + j] = s;
    }
  }
  return C;
}

/** Matrix transpose for 6×6. */
export function mat6Transpose(A: Mat6): Mat6 {
  const AT = mat6Zero();
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      AT[j * 6 + i] = A[i * 6 + j]!;
    }
  }
  return AT;
}

/** Matrix addition: C = A + B for 6×6. */
export function mat6Add(A: Mat6, B: Mat6): Mat6 {
  const C = new Float64Array(36);
  for (let i = 0; i < 36; i++) C[i] = A[i]! + B[i]!;
  return C;
}

/** Scalar multiply: C = k × A for 6×6. */
export function mat6Scale(k: number, A: Mat6): Mat6 {
  const C = new Float64Array(36);
  for (let i = 0; i < 36; i++) C[i] = k * A[i]!;
  return C;
}

/** Matrix-vector multiply: y = A × x (6×6 × 6×1 → 6×1). */
export function mat6Vec(A: Mat6, x: Float64Array): Float64Array {
  const y = new Float64Array(6);
  for (let i = 0; i < 6; i++) {
    let s = 0;
    for (let j = 0; j < 6; j++) {
      s += A[i * 6 + j]! * x[j]!;
    }
    y[i] = s;
  }
  return y;
}

/* ── Gravity Gradient Tensor ─────────────────────────────────────── */

/**
 * Computes the 3×3 gravity gradient tensor G = ∂a/∂r for a point-mass
 * gravitational field:
 *
 *   G_ij = -μ/r³ * (δ_ij - 3 r_i r_j / r²)
 *
 * This is the Jacobian of the gravitational acceleration with respect
 * to position, which forms the lower-left 3×3 block of the 6×6
 * Jacobian matrix A(t).
 *
 * @param mu  Gravitational parameter (AU³/day²)
 * @param r   Position vector relative to attracting body (AU)
 * @returns   3×3 gravity gradient as [G00,G01,G02, G10,G11,G12, G20,G21,G22]
 */
export function gravityGradient(mu: number, r: Vec3): Float64Array {
  const rr = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  const rMag = Math.sqrt(rr);
  const r3v = rMag * rMag * rMag;
  const r5v = r3v * rr;

  const G = new Float64Array(9);
  const coeff1 = -mu / r3v;
  const coeff2 = 3 * mu / r5v;

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const idx = i * 3 + j;
      let val = coeff2 * r[i]! * r[j]!;
      if (i === j) val += coeff1;
      G[idx] = val;
    }
  }

  return G;
}

/**
 * Computes the 3×3 gravity gradient tensor for multiple attracting bodies.
 *
 * G_total = Σ_j G_j(r - r_j)
 *
 * @param gm   Array of GM values (AU³/day²)
 * @param pos  Flat position array [x0,y0,z0, x1,y1,z1, ...]
 * @param n    Number of attracting bodies
 * @param rSc  Spacecraft position (AU)
 * @returns    Combined 3×3 gravity gradient
 */
export function multiBodyGravityGradient(
  gm: Float64Array,
  pos: Float64Array,
  n: number,
  rSc: Vec3,
): Float64Array {
  const Gtotal = new Float64Array(9);

  for (let j = 0; j < n; j++) {
    const rj: Vec3 = [
      rSc[0] - pos[3 * j]!,
      rSc[1] - pos[3 * j + 1]!,
      rSc[2] - pos[3 * j + 2]!,
    ];
    const Gj = gravityGradient(gm[j]!, rj);
    for (let k = 0; k < 9; k++) {
      Gtotal[k] = (Gtotal[k] ?? 0) + Gj[k]!;
    }
  }

  return Gtotal;
}

/* ── Jacobian Matrix A(t) ────────────────────────────────────────── */

/**
 * Constructs the 6×6 Jacobian (plant) matrix A(t) from the gravity gradient:
 *
 *   A = | 0₃   I₃ |
 *       | G₃   0₃ |
 *
 * where G₃ is the 3×3 gravity gradient tensor.
 */
export function jacobianMatrix(G: Float64Array): Mat6 {
  const A = mat6Zero();

  // Upper-right block: I₃ (position derivatives w.r.t. velocity)
  A[0 * 6 + 3] = 1;
  A[1 * 6 + 4] = 1;
  A[2 * 6 + 5] = 1;

  // Lower-left block: G₃ (acceleration derivatives w.r.t. position)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      A[(i + 3) * 6 + j] = G[i * 3 + j]!;
    }
  }

  return A;
}

/* ── STM Propagation (RK4) ───────────────────────────────────────── */

/**
 * Augmented state vector: [x, y, z, vx, vy, vz, Φ₁₁, Φ₁₂, ..., Φ₆₆]
 * Total dimension: 6 (state) + 36 (STM) = 42 elements.
 */

/**
 * Acceleration function type for STM propagation.
 * Returns the gravitational acceleration at position r.
 */
export type AccelerationFn = (r: Vec3, t: number) => Vec3;

/**
 * Gravity gradient function type for STM propagation.
 * Returns the 3×3 gravity gradient tensor at position r.
 */
export type GradientFn = (r: Vec3, t: number) => Float64Array;

/**
 * Result of an STM propagation step.
 */
export interface StmPropagationResult {
  /** Final position (AU) */
  pos: Vec3;
  /** Final velocity (AU/day) */
  vel: Vec3;
  /** 6×6 State Transition Matrix Φ(t, t₀) */
  stm: Mat6;
  /** Final time (days) */
  t: number;
}

/**
 * Propagates the spacecraft state and STM simultaneously using RK4.
 *
 * The augmented 42-element state [r, v, Φ] is integrated with:
 *   ṙ = v
 *   v̇ = a(r, t)
 *   Φ̇ = A(t)Φ
 *
 * @param r0     Initial position (AU)
 * @param v0     Initial velocity (AU/day)
 * @param t0     Initial time (days)
 * @param tf     Final time (days)
 * @param dt     Integration step size (days)
 * @param accel  Acceleration function a(r, t) → Vec3
 * @param grad   Gravity gradient function G(r, t) → Float64Array(9)
 * @returns      Propagation result with final state and STM
 */
export function propagateWithSTM(
  r0: Vec3,
  v0: Vec3,
  t0: number,
  tf: number,
  dt: number,
  accel: AccelerationFn,
  grad: GradientFn,
): StmPropagationResult {
  // Augmented state: [x, y, z, vx, vy, vz, Φ_00, Φ_01, ..., Φ_55]
  const y = new Float64Array(42);
  y[0] = r0[0]; y[1] = r0[1]; y[2] = r0[2];
  y[3] = v0[0]; y[4] = v0[1]; y[5] = v0[2];

  // Initialize STM to identity
  for (let i = 0; i < 6; i++) y[6 + i * 6 + i] = 1;

  let t = t0;
  const direction = tf > t0 ? 1 : -1;
  const h = direction * Math.abs(dt);

  const dydt = (state: Float64Array, time: number): Float64Array => {
    const r: Vec3 = [state[0]!, state[1]!, state[2]!];
    const v: Vec3 = [state[3]!, state[4]!, state[5]!];
    const a = accel(r, time);
    const G = grad(r, time);
    const A = jacobianMatrix(G);

    const deriv = new Float64Array(42);
    // ṙ = v
    deriv[0] = v[0]; deriv[1] = v[1]; deriv[2] = v[2];
    // v̇ = a
    deriv[3] = a[0]; deriv[4] = a[1]; deriv[5] = a[2];

    // Φ̇ = A × Φ  (36 elements)
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        let s = 0;
        for (let k = 0; k < 6; k++) {
          s += A[i * 6 + k]! * state[6 + k * 6 + j]!;
        }
        deriv[6 + i * 6 + j] = s;
      }
    }

    return deriv;
  };

  // RK4 integration loop
  while (direction * (tf - t) > 1e-12 * Math.abs(tf)) {
    const step = direction * Math.min(Math.abs(h), direction * (tf - t));

    const k1 = dydt(y, t);
    const y2 = new Float64Array(42);
    for (let i = 0; i < 42; i++) y2[i] = y[i]! + 0.5 * step * k1[i]!;

    const k2 = dydt(y2, t + 0.5 * step);
    const y3 = new Float64Array(42);
    for (let i = 0; i < 42; i++) y3[i] = y[i]! + 0.5 * step * k2[i]!;

    const k3 = dydt(y3, t + 0.5 * step);
    const y4 = new Float64Array(42);
    for (let i = 0; i < 42; i++) y4[i] = y[i]! + step * k3[i]!;

    const k4 = dydt(y4, t + step);

    for (let i = 0; i < 42; i++) {
      y[i] = (y[i] ?? 0) + (step / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }
    t += step;
  }

  // Extract final state and STM
  const posF: Vec3 = [y[0]!, y[1]!, y[2]!];
  const velF: Vec3 = [y[3]!, y[4]!, y[5]!];
  const stm = new Float64Array(36);
  for (let i = 0; i < 36; i++) stm[i] = y[6 + i]!;

  return { pos: posF, vel: velF, stm, t };
}

/* ── Covariance Propagation ──────────────────────────────────────── */

/**
 * Propagates a 6×6 state covariance matrix using the STM:
 *
 *   P(t) = Φ(t, t₀) P(t₀) Φ(t, t₀)ᵀ
 *
 * @param stm  State Transition Matrix Φ(t, t₀) (6×6)
 * @param P0   Initial covariance matrix (6×6)
 * @returns    Propagated covariance matrix P(t) (6×6)
 */
export function propagateCovariance(stm: Mat6, P0: Mat6): Mat6 {
  const PhiP = mat6Mul(stm, P0);
  const PhiT = mat6Transpose(stm);
  return mat6Mul(PhiP, PhiT);
}

/**
 * Extracts position uncertainty (1-sigma) from a 6×6 covariance matrix.
 * Returns sqrt(P_xx + P_yy + P_zz) — the RSS position uncertainty.
 *
 * @param P  6×6 covariance matrix
 * @returns  1-sigma position uncertainty (same units as P)
 */
export function positionUncertainty(P: Mat6): number {
  return Math.sqrt(P[0]! + P[7]! + P[14]!); // diag elements P[0,0], P[1,1], P[2,2]
}

/**
 * Extracts velocity uncertainty (1-sigma) from a 6×6 covariance matrix.
 * Returns sqrt(P_vxvx + P_vyvy + P_vzvz).
 *
 * @param P  6×6 covariance matrix
 * @returns  1-sigma velocity uncertainty (same units as P)
 */
export function velocityUncertainty(P: Mat6): number {
  return Math.sqrt(P[21]! + P[28]! + P[35]!); // diag elements P[3,3], P[4,4], P[5,5]
}

/* ── Two-Body Analytical STM (Keplerian) ─────────────────────────── */

/**
 * Computes the exact analytical 6×6 State Transition Matrix for a
 * two-body (Keplerian) orbit using the f and g functions.
 *
 * For short arcs or preliminary analysis, the Keplerian STM provides
 * an efficient closed-form alternative to numerical integration.
 *
 * Φ = | f    g   |   ← position row partials
 *     | f_dot g_dot|   ← velocity row partials
 *
 * where f, g, f_dot, g_dot are the Lagrange coefficients.
 *
 * @param mu  Gravitational parameter (AU³/day²)
 * @param r0  Initial position (AU)
 * @param v0  Initial velocity (AU/day)
 * @param dt  Time interval (days)
 * @returns   6×6 STM for Keplerian two-body motion
 */
export function keplerianSTM(mu: number, r0: Vec3, v0: Vec3, dt: number): Mat6 {
  const r0Mag = vmag(r0);
  const v0Mag = vmag(v0);
  const rdotv = r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2];

  // Specific energy → semi-major axis
  const energy = (v0Mag * v0Mag) / 2 - mu / r0Mag;
  const a = -mu / (2 * energy);

  // Newton-Raphson using universal variables for robustness
  const alpha = 1 / a;
  let chi = Math.sqrt(mu) * dt * Math.abs(alpha);

  // Universal Kepler iteration
  for (let iter = 0; iter < 50; iter++) {
    const chi2 = chi * chi;
    const psi = alpha * chi2;

    let c2: number, c3: number;
    if (Math.abs(psi) > 1e-6) {
      if (psi > 0) {
        const sqrtPsi = Math.sqrt(psi);
        c2 = (1 - Math.cos(sqrtPsi)) / psi;
        c3 = (sqrtPsi - Math.sin(sqrtPsi)) / (psi * sqrtPsi);
      } else {
        const sqrtNeg = Math.sqrt(-psi);
        c2 = (1 - Math.cosh(sqrtNeg)) / psi;
        c3 = (Math.sinh(sqrtNeg) - sqrtNeg) / (-psi * sqrtNeg);
      }
    } else {
      c2 = 1 / 2;
      c3 = 1 / 6;
    }

    const r = chi2 * c2 + (rdotv / Math.sqrt(mu)) * chi * (1 - psi * c3) + r0Mag * (1 - psi * c2);
    const dchi = (Math.sqrt(mu) * dt - chi2 * chi * c3 - (rdotv / Math.sqrt(mu)) * chi2 * c2 - r0Mag * chi * (1 - psi * c3)) / r;
    chi += dchi;
    if (Math.abs(dchi) < 1e-12) break;
  }

  const chi2 = chi * chi;
  const psi = alpha * chi2;

  let c2: number, c3: number;
  if (Math.abs(psi) > 1e-6) {
    if (psi > 0) {
      const sqrtPsi = Math.sqrt(psi);
      c2 = (1 - Math.cos(sqrtPsi)) / psi;
      c3 = (sqrtPsi - Math.sin(sqrtPsi)) / (psi * sqrtPsi);
    } else {
      const sqrtNeg = Math.sqrt(-psi);
      c2 = (1 - Math.cosh(sqrtNeg)) / psi;
      c3 = (Math.sinh(sqrtNeg) - sqrtNeg) / (-psi * sqrtNeg);
    }
  } else {
    c2 = 1 / 2;
    c3 = 1 / 6;
  }

  // Lagrange coefficients
  const rFinal = chi2 * c2 + (rdotv / Math.sqrt(mu)) * chi * (1 - psi * c3) + r0Mag * (1 - psi * c2);

  const f = 1 - (chi2 / r0Mag) * c2;
  const g = dt - (chi2 * chi / Math.sqrt(mu)) * c3;
  const fDot = (Math.sqrt(mu) / (rFinal * r0Mag)) * chi * (psi * c3 - 1);
  const gDot = 1 - (chi2 / rFinal) * c2;

  // Build the STM using f, g partials
  // For a two-body problem, the STM has a special structure:
  // Φ = | f*I₃ + dr_f/dr₀   g*I₃ |
  //     | ḟ*I₃              ġ*I₃ |
  // This is exact for the scalar Lagrange coefficients
  const stm = mat6Zero();

  // Position → position block (3×3)
  stm[0] = f; stm[7] = f; stm[14] = f;

  // Velocity → position block (3×3)
  stm[3] = g; stm[10] = g; stm[17] = g;

  // Position → velocity block (3×3)
  stm[18] = fDot; stm[25] = fDot; stm[32] = fDot;

  // Velocity → velocity block (3×3)
  stm[21] = gDot; stm[28] = gDot; stm[35] = gDot;

  return stm;
}
