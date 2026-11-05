/**
 * Batch Least Squares Orbit Determination (OD)
 * =============================================
 *
 * Implements the classical weighted batch least squares differential
 * correction algorithm for spacecraft state estimation from tracking
 * observations (range, range-rate, angles).
 *
 * The algorithm iteratively refines an initial state estimate by
 * processing a batch of observations, computing residuals, mapping
 * observation sensitivities through the State Transition Matrix (STM),
 * and solving the normal equations for the optimal state correction.
 *
 * References:
 * - Tapley, Schutz & Born (2004): "Statistical Orbit Determination",
 *   Academic Press, Ch. 4
 * - Montenbruck & Gill (2000): "Satellite Orbits", Springer, Ch. 8
 * - Vallado (2013): "Fundamentals of Astrodynamics and Applications",
 *   4th Ed., Ch. 10
 *
 * All units: AU (distances), AU/day (velocities), AU³/day² (GM).
 * Pure physics — no DOM, no Three.js, no Date.now().
 */

import type { Vec3 } from './types';
import {
  type Mat6,
  mat6Zero,
  propagateWithSTM,
  type AccelerationFn,
  type GradientFn,
} from './stm';

/* ── vec3 helpers ─────────────────────────────────────────────────── */
const vmag = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ── Observation Types ───────────────────────────────────────────── */

/** Observation measurement types supported by the OD filter. */
export const ObservationType = {
  /** One-way range measurement (distance from station to spacecraft) in AU */
  RANGE: 'range',
  /** Range-rate (Doppler) measurement in AU/day */
  RANGE_RATE: 'range_rate',
  /** Right Ascension angle measurement in radians */
  RIGHT_ASCENSION: 'right_ascension',
  /** Declination angle measurement in radians */
  DECLINATION: 'declination',
} as const;

export type ObservationType = (typeof ObservationType)[keyof typeof ObservationType];

/**
 * A single tracking observation.
 */
export interface Observation {
  /** Time of observation (days since epoch) */
  t: number;
  /** Observation type */
  type: ObservationType;
  /** Measured value */
  value: number;
  /** 1-sigma measurement noise standard deviation */
  sigma: number;
  /** Observer (ground station) position at observation time (AU) */
  stationPos: Vec3;
  /** Observer (ground station) velocity at observation time (AU/day) */
  stationVel: Vec3;
}

/* ── Observation Models (Measurement Functions) ──────────────────── */

/**
 * Computes the predicted range measurement and its partial derivatives.
 *
 * ρ = |r_sc - r_stn|
 * ∂ρ/∂r = (r_sc - r_stn) / ρ  (unit vector)
 * ∂ρ/∂v = [0, 0, 0]
 */
function rangeModel(
  rSc: Vec3,
  _vSc: Vec3,
  rStn: Vec3,
  _vStn: Vec3,
): { predicted: number; partials: Float64Array } {
  const dr = vsub(rSc, rStn);
  const rho = vmag(dr);
  const partials = new Float64Array(6);
  if (rho > 0) {
    partials[0] = dr[0] / rho;
    partials[1] = dr[1] / rho;
    partials[2] = dr[2] / rho;
  }
  // ∂ρ/∂v = 0
  return { predicted: rho, partials };
}

/**
 * Computes the predicted range-rate (Doppler) measurement and partials.
 *
 * ρ̇ = (r_sc - r_stn)·(v_sc - v_stn) / ρ
 * ∂ρ̇/∂r = (v_sc - v_stn)/ρ - ρ̇(r_sc - r_stn)/ρ²
 * ∂ρ̇/∂v = (r_sc - r_stn)/ρ
 */
function rangeRateModel(
  rSc: Vec3,
  vSc: Vec3,
  rStn: Vec3,
  vStn: Vec3,
): { predicted: number; partials: Float64Array } {
  const dr = vsub(rSc, rStn);
  const dv = vsub(vSc, vStn);
  const rho = vmag(dr);
  const rhoDot = vdot(dr, dv) / rho;

  const partials = new Float64Array(6);
  if (rho > 0) {
    // ∂ρ̇/∂r
    for (let i = 0; i < 3; i++) {
      partials[i] = dv[i]! / rho - rhoDot * dr[i]! / (rho * rho);
    }
    // ∂ρ̇/∂v
    for (let i = 0; i < 3; i++) {
      partials[i + 3] = dr[i]! / rho;
    }
  }
  return { predicted: rhoDot, partials };
}

/**
 * Computes predicted right ascension and declination and their partials.
 *
 * α = atan2(y, x)
 * δ = asin(z / ρ)
 */
function anglesModel(
  rSc: Vec3,
  _vSc: Vec3,
  rStn: Vec3,
  _vStn: Vec3,
): { ra: number; dec: number; raPartials: Float64Array; decPartials: Float64Array } {
  const dr = vsub(rSc, rStn);
  const rho = vmag(dr);
  const ra = Math.atan2(dr[1], dr[0]);
  const dec = Math.asin(Math.max(-1, Math.min(1, dr[2] / rho)));

  const raPartials = new Float64Array(6);
  const decPartials = new Float64Array(6);

  if (rho > 1e-20) {
    const rhoXY2 = dr[0] * dr[0] + dr[1] * dr[1];
    const rhoXY = Math.sqrt(rhoXY2);

    if (rhoXY > 1e-20) {
      // ∂α/∂x = -y/(x²+y²), ∂α/∂y = x/(x²+y²), ∂α/∂z = 0
      raPartials[0] = -dr[1] / rhoXY2;
      raPartials[1] = dr[0] / rhoXY2;
      raPartials[2] = 0;

      // ∂δ/∂r
      const cosDec = Math.cos(dec);
      if (Math.abs(cosDec) > 1e-15) {
        decPartials[0] = -(dr[0] * dr[2]) / (rho * rho * rhoXY);
        decPartials[1] = -(dr[1] * dr[2]) / (rho * rho * rhoXY);
        decPartials[2] = rhoXY / (rho * rho);
      }
    }
  }

  return { ra, dec, raPartials, decPartials };
}

/* ── Observation Evaluation ──────────────────────────────────────── */

/**
 * Evaluates a single observation against the propagated spacecraft state.
 *
 * Returns the predicted measurement value and the observation partial
 * derivative vector ∂g/∂x (6×1) at the observation epoch.
 */
function evaluateObservation(
  obs: Observation,
  rSc: Vec3,
  vSc: Vec3,
): { predicted: number; partials: Float64Array } {
  switch (obs.type) {
    case ObservationType.RANGE:
      return rangeModel(rSc, vSc, obs.stationPos, obs.stationVel);
    case ObservationType.RANGE_RATE:
      return rangeRateModel(rSc, vSc, obs.stationPos, obs.stationVel);
    case ObservationType.RIGHT_ASCENSION: {
      const ang = anglesModel(rSc, vSc, obs.stationPos, obs.stationVel);
      return { predicted: ang.ra, partials: ang.raPartials };
    }
    case ObservationType.DECLINATION: {
      const ang = anglesModel(rSc, vSc, obs.stationPos, obs.stationVel);
      return { predicted: ang.dec, partials: ang.decPartials };
    }
  }
}

/* ── 6×6 Gaussian Elimination with Partial Pivoting ─────────────────── */

/**
 * Solves the 6×6 linear system Ax = b using Gaussian elimination
 * with partial pivoting.
 *
 * Highly robust against ill-conditioned normal equations in OD,
 * avoiding the zero-pivot issues of raw Cholesky.
 */
function solve6x6(A: Mat6, b: Float64Array): Float64Array {
  const n = 6;
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      M[i * (n + 1) + j] = A[i * n + j]!;
    }
    M[i * (n + 1) + n] = b[i]!;
  }

  // Gaussian elimination with row pivoting
  for (let p = 0; p < n; p++) {
    let maxRow = p;
    let maxVal = Math.abs(M[p * (n + 1) + p]!);
    for (let r = p + 1; r < n; r++) {
      const val = Math.abs(M[r * (n + 1) + p]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }

    if (maxVal < 1e-30) {
      // Near-singular pivot: add slight Tikhonov regularization
      M[p * (n + 1) + p] = (M[p * (n + 1) + p] ?? 0) + 1e-15;
    }

    if (maxRow !== p) {
      for (let c = p; c <= n; c++) {
        const tmp = M[p * (n + 1) + c]!;
        M[p * (n + 1) + c] = M[maxRow * (n + 1) + c]!;
        M[maxRow * (n + 1) + c] = tmp;
      }
    }

    const pivot = M[p * (n + 1) + p]!;
    if (Math.abs(pivot) > 1e-35) {
      for (let r = p + 1; r < n; r++) {
        const factor = M[r * (n + 1) + p]! / pivot;
        for (let c = p; c <= n; c++) {
          M[r * (n + 1) + c] = (M[r * (n + 1) + c] ?? 0) - factor * M[p * (n + 1) + c]!;
        }
      }
    }
  }

  // Back-substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i * (n + 1) + n]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i * (n + 1) + j]! * x[j]!;
    }
    const diag = M[i * (n + 1) + i]!;
    x[i] = Math.abs(diag) > 1e-35 ? sum / diag : 0;
  }

  return x;
}

/**
 * Inverts a 6×6 matrix using Gauss-Jordan elimination with partial pivoting.
 * Used to extract the formal covariance matrix from the normal matrix: P = Λ⁻¹.
 */
function invert6x6(A: Mat6): Mat6 {
  const n = 6;
  const M = new Float64Array(n * 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      M[i * 2 * n + j] = A[i * n + j]!;
    }
    M[i * 2 * n + n + i] = 1;
  }

  for (let p = 0; p < n; p++) {
    let maxRow = p;
    let maxVal = Math.abs(M[p * 2 * n + p]!);
    for (let r = p + 1; r < n; r++) {
      const val = Math.abs(M[r * 2 * n + p]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }

    if (maxVal < 1e-30) {
      M[p * 2 * n + p] = (M[p * 2 * n + p] ?? 0) + 1e-15;
    }

    if (maxRow !== p) {
      for (let c = 0; c < 2 * n; c++) {
        const tmp = M[p * 2 * n + c]!;
        M[p * 2 * n + c] = M[maxRow * 2 * n + c]!;
        M[maxRow * 2 * n + c] = tmp;
      }
    }

    const pivot = M[p * 2 * n + p]!;
    if (Math.abs(pivot) > 1e-35) {
      const invPivot = 1 / pivot;
      for (let c = 0; c < 2 * n; c++) {
        M[p * 2 * n + c] = (M[p * 2 * n + c] ?? 0) * invPivot;
      }

      for (let r = 0; r < n; r++) {
        if (r !== p) {
          const factor = M[r * 2 * n + p]!;
          for (let c = 0; c < 2 * n; c++) {
            M[r * 2 * n + c] = (M[r * 2 * n + c] ?? 0) - factor * M[p * 2 * n + c]!;
          }
        }
      }
    }
  }

  const inv = mat6Zero();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      inv[i * n + j] = M[i * 2 * n + n + j]!;
    }
  }

  return inv;
}

/* ── Batch Least Squares OD ──────────────────────────────────────── */

/**
 * Configuration for the batch least squares orbit determination.
 */
export interface ODConfig {
  /** Maximum number of differential correction iterations */
  maxIterations: number;
  /** Convergence tolerance for state correction norm (AU) */
  convergenceTol: number;
  /** Integration step size for STM propagation (days) */
  integrationDt: number;
  /** A priori state covariance (6×6), if available. Null for unweighted. */
  aPrioriCovariance?: Mat6;
  /** A priori state estimate weight (inverse of a priori covariance) */
  aPrioriWeight?: Mat6;
}

/**
 * Result of the batch least squares orbit determination.
 */
export interface ODResult {
  /** Estimated state at epoch: position (AU) */
  pos: Vec3;
  /** Estimated state at epoch: velocity (AU/day) */
  vel: Vec3;
  /** Formal 6×6 state covariance matrix at epoch (P = Λ⁻¹) */
  covariance: Mat6;
  /** 1-sigma position uncertainty (AU) */
  positionSigma: number;
  /** 1-sigma velocity uncertainty (AU/day) */
  velocitySigma: number;
  /** Number of iterations to convergence */
  iterations: number;
  /** Whether the solution converged */
  converged: boolean;
  /** Final RMS of weighted residuals */
  rmsResidual: number;
  /** Post-fit residuals for each observation */
  residuals: number[];
}

/**
 * Performs batch least squares orbit determination.
 *
 * Given an initial state estimate and a set of tracking observations,
 * iteratively refines the state by:
 * 1. Propagating the trajectory and STM from epoch to each observation
 * 2. Computing observation residuals (observed - computed)
 * 3. Mapping observation partials to epoch via the STM
 * 4. Solving the normal equations for the state correction
 * 5. Updating the state estimate and repeating until convergence
 *
 * @param r0Init   Initial position estimate at epoch (AU)
 * @param v0Init   Initial velocity estimate at epoch (AU/day)
 * @param t0       Epoch time (days)
 * @param obs      Array of tracking observations
 * @param accel    Acceleration function a(r, t) → Vec3
 * @param grad     Gravity gradient function G(r, t) → Float64Array(9)
 * @param config   OD configuration parameters
 * @returns        Orbit determination result
 */
export function batchLeastSquares(
  r0Init: Vec3,
  v0Init: Vec3,
  t0: number,
  obs: Observation[],
  accel: AccelerationFn,
  grad: GradientFn,
  config: ODConfig,
): ODResult {
  // Sort observations by time
  const sorted = [...obs].sort((a, b) => a.t - b.t);

  let r0: Vec3 = [...r0Init];
  let v0: Vec3 = [...v0Init];
  let converged = false;
  let finalResiduals: number[] = [];
  let rmsResidual = Infinity;
  let iter: number;

  for (iter = 0; iter < config.maxIterations; iter++) {
    // Initialize normal equations: Λ δx = N
    const Lambda = mat6Zero(); // 6×6 normal matrix
    const N = new Float64Array(6); // right-hand side vector
    finalResiduals = [];
    let sumWeightedResidSq = 0;

    // Add a priori constraint if available
    if (config.aPrioriWeight) {
      for (let i = 0; i < 36; i++) {
        Lambda[i] = (Lambda[i] ?? 0) + config.aPrioriWeight[i]!;
      }
      // A priori residual is zero (current estimate is the a priori)
    }

    // Process each observation
    for (const obsItem of sorted) {
      // Propagate state + STM from epoch to observation time
      const prop = propagateWithSTM(
        r0, v0, t0, obsItem.t,
        config.integrationDt,
        accel, grad,
      );

      // Evaluate observation: predicted value and local partials ∂g/∂x_local
      const { predicted, partials: localPartials } = evaluateObservation(
        obsItem, prop.pos, prop.vel,
      );

      // Residual: Δy = observed - predicted
      const residual = obsItem.value - predicted;
      finalResiduals.push(residual);

      // Map local partials to epoch via STM:
      // H_epoch = (∂g/∂x_local) × Φ(t_obs, t_0)
      // This is a 1×6 row vector: H_epoch[j] = Σ_k localPartials[k] * Φ[k,j]
      const H = new Float64Array(6);
      for (let j = 0; j < 6; j++) {
        let s = 0;
        for (let k = 0; k < 6; k++) {
          s += localPartials[k]! * prop.stm[k * 6 + j]!;
        }
        H[j] = s;
      }

      // Observation weight: w = 1/σ²
      const w = 1 / (obsItem.sigma * obsItem.sigma);

      // Accumulate normal equations:
      // Λ += H^T * w * H  (outer product)
      // N += H^T * w * Δy
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          Lambda[i * 6 + j] = (Lambda[i * 6 + j] ?? 0) + H[i]! * w * H[j]!;
        }
        N[i] = (N[i] ?? 0) + H[i]! * w * residual;
      }

      sumWeightedResidSq += w * residual * residual;
    }

    // Solve normal equations: δx = Λ⁻¹ N
    const dx = solve6x6(Lambda, N);

    // Update state estimate
    r0 = [r0[0] + dx[0]!, r0[1] + dx[1]!, r0[2] + dx[2]!];
    v0 = [v0[0] + dx[3]!, v0[1] + dx[4]!, v0[2] + dx[5]!];

    // Check convergence
    const posCorrection = Math.sqrt(dx[0]! * dx[0]! + dx[1]! * dx[1]! + dx[2]! * dx[2]!);
    rmsResidual = sorted.length > 0
      ? Math.sqrt(sumWeightedResidSq / sorted.length)
      : 0;

    if (posCorrection < config.convergenceTol) {
      converged = true;
      iter++;
      break;
    }
  }

  // Extract formal covariance from final normal matrix
  // Re-compute Lambda on final iteration for covariance extraction
  const LambdaFinal = mat6Zero();
  if (config.aPrioriWeight) {
    for (let i = 0; i < 36; i++) {
      LambdaFinal[i] = (LambdaFinal[i] ?? 0) + config.aPrioriWeight[i]!;
    }
  }

  for (const obsItem of sorted) {
    const prop = propagateWithSTM(r0, v0, t0, obsItem.t, config.integrationDt, accel, grad);
    const { partials: localPartials } = evaluateObservation(obsItem, prop.pos, prop.vel);
    const H = new Float64Array(6);
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += localPartials[k]! * prop.stm[k * 6 + j]!;
      H[j] = s;
    }
    const w = 1 / (obsItem.sigma * obsItem.sigma);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        LambdaFinal[i * 6 + j] = (LambdaFinal[i * 6 + j] ?? 0) + H[i]! * w * H[j]!;
      }
    }
  }

  const covariance = invert6x6(LambdaFinal);
  const posSigma = Math.sqrt(
    Math.max(0, covariance[0]!) + Math.max(0, covariance[7]!) + Math.max(0, covariance[14]!),
  );
  const velSigma = Math.sqrt(
    Math.max(0, covariance[21]!) + Math.max(0, covariance[28]!) + Math.max(0, covariance[35]!),
  );

  return {
    pos: r0,
    vel: v0,
    covariance,
    positionSigma: posSigma,
    velocitySigma: velSigma,
    iterations: iter,
    converged,
    rmsResidual,
    residuals: finalResiduals,
  };
}

/**
 * Generates synthetic range observations for testing OD algorithms.
 *
 * Propagates a true trajectory and computes perfect range measurements
 * at specified times, then adds Gaussian noise.
 *
 * @param rTrue    True initial position (AU)
 * @param vTrue    True initial velocity (AU/day)
 * @param t0       Epoch time (days)
 * @param times    Observation times (days)
 * @param stationPos  Ground station position (AU)
 * @param stationVel  Ground station velocity (AU/day)
 * @param sigma    Range measurement noise 1-sigma (AU)
 * @param accel    Acceleration function
 * @param grad     Gravity gradient function
 * @param dt       Integration step size (days)
 * @param seed     RNG seed for reproducibility
 * @returns        Array of synthetic observations
 */
export function generateSyntheticObs(
  rTrue: Vec3,
  vTrue: Vec3,
  t0: number,
  times: number[],
  stationPos: Vec3,
  stationVel: Vec3,
  sigma: number,
  accel: AccelerationFn,
  grad: GradientFn,
  dt: number,
  seed = 42,
): Observation[] {
  // Simple deterministic PRNG (Mulberry32) for reproducible noise
  let state = seed;
  const nextRand = (): number => {
    state |= 0; state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box-Muller for Gaussian noise
  const gaussNoise = (): number => {
    const u1 = Math.max(1e-10, nextRand());
    const u2 = nextRand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
  };

  const observations: Observation[] = [];

  for (const obsTime of times) {
    // Propagate true state to observation time
    const prop = propagateWithSTM(rTrue, vTrue, t0, obsTime, dt, accel, grad);

    // Compute true range
    const dr = vsub(prop.pos, stationPos);
    const trueRange = vmag(dr);

    // Add measurement noise
    const measuredRange = trueRange + gaussNoise();

    observations.push({
      t: obsTime,
      type: ObservationType.RANGE,
      value: measuredRange,
      sigma,
      stationPos: [...stationPos],
      stationVel: [...stationVel],
    });
  }

  return observations;
}
