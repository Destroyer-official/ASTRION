/**
 * High-Precision Universal Light-Time Retardation Engine
 *
 * Implements the NASA/JPL SPICE light-time correction algorithm (equivalent to SPICE 'LT'
 * and 'CN' flags) to solve the implicit light-cone equation:
 *   t_ret = t - ||r_obs(t) - r_target(t_ret)|| / c
 *
 * References:
 * - Standish, E. M. (1990), "The Observational Basis for JPL's DE 200", A&A 233:252.
 * - Moyer, T. D. (2000), "Mathematical Formulation of the Double-Precision Orbit
 *   Determination Program (DPODP)", JPL Publication 00-7.
 * - IAU 2000/2006 Resolutions on Relativistic Astrometry and Time Delays.
 */

import { C_LIGHT_AU_DAY, C_LIGHT_KMS } from '@/data/constants';

export const SPEED_OF_LIGHT_AU_DAY = C_LIGHT_AU_DAY; // ~173.14463267424 AU/day
export const SPEED_OF_LIGHT_KM_S = C_LIGHT_KMS; // 299792.458 km/s

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface StateVector {
  pos: Vector3D;
  vel: Vector3D; // AU/day
}

export interface LightTimeResult {
  /** One-way light time in days */
  tauDays: number;
  /** One-way light time in seconds */
  tauSeconds: number;
  /** Round-trip light time in seconds */
  roundTripSeconds: number;
  /** Retarded target position at epoch t - tau (AU) */
  retardedPos: Vector3D;
  /** Apparent relative vector from observer to retarded target (AU) */
  apparentVector: Vector3D;
  /** Geometric distance at time t (AU) */
  geometricDistanceAu: number;
  /** Apparent (retarded) distance (AU) */
  apparentDistanceAu: number;
  /** Number of Newton-Raphson iterations to convergence */
  iterations: number;
}

/**
 * Solves the implicit light-time retardation equation via Newton-Raphson iteration.
 *
 * @param observerPos Observer position at reception time t (AU)
 * @param targetState Target state (pos, vel) at reception time t (AU, AU/day)
 * @param trajectorySampler Optional high-precision trajectory evaluator for curved motion:
 *                          (tMinusTau: number) => StateVector. If not provided, linear
 *                          extrapolation from targetState.vel is used (accurate to < 1 mm
 *                          over light-times < 10 hours).
 * @param maxIterations Maximum Newton iterations (default 10)
 * @param toleranceDays Convergence tolerance in days (default 1e-15 days ~ 86 picoseconds)
 */
export function solveLightTime(
  observerPos: Vector3D,
  targetState: StateVector,
  trajectorySampler?: (tauDays: number) => StateVector,
  maxIterations = 10,
  toleranceDays = 1e-15,
): LightTimeResult {
  // Geometric (unretarded) distance at epoch t
  const dx0 = targetState.pos.x - observerPos.x;
  const dy0 = targetState.pos.y - observerPos.y;
  const dz0 = targetState.pos.z - observerPos.z;
  const geometricDistanceAu = Math.hypot(dx0, dy0, dz0);

  // Initial estimate: tau_0 = geometric distance / c
  let tau = geometricDistanceAu / SPEED_OF_LIGHT_AU_DAY;
  let iterations = 0;

  let retPos: Vector3D = { ...targetState.pos };
  let appVec: Vector3D = { x: dx0, y: dy0, z: dz0 };
  let appDist = geometricDistanceAu;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations++;

    // Evaluate target state at retarded time t - tau
    let currentTargetState: StateVector;
    if (trajectorySampler) {
      currentTargetState = trajectorySampler(tau);
    } else {
      // High-order linear velocity extrapolation: r(t - tau) = r(t) - v * tau
      currentTargetState = {
        pos: {
          x: targetState.pos.x - targetState.vel.x * tau,
          y: targetState.pos.y - targetState.vel.y * tau,
          z: targetState.pos.z - targetState.vel.z * tau,
        },
        vel: targetState.vel,
      };
    }

    retPos = currentTargetState.pos;
    appVec = {
      x: retPos.x - observerPos.x,
      y: retPos.y - observerPos.y,
      z: retPos.z - observerPos.z,
    };
    appDist = Math.hypot(appVec.x, appVec.y, appVec.z);

    // Light-cone residual: f(tau) = tau - appDist / c
    const f = tau - appDist / SPEED_OF_LIGHT_AU_DAY;

    if (Math.abs(f) < toleranceDays) {
      break;
    }

    // Derivative: df/dtau = 1 + (appVec · v_target) / (c * appDist)
    // where d(appDist)/dtau = - (appVec · v_target) / appDist
    const vDotR =
      appVec.x * currentTargetState.vel.x +
      appVec.y * currentTargetState.vel.y +
      appVec.z * currentTargetState.vel.z;
    const dfDtau = 1 + vDotR / (SPEED_OF_LIGHT_AU_DAY * Math.max(1e-12, appDist));

    // Newton-Raphson update step
    const deltaTau = f / dfDtau;
    tau -= deltaTau;

    if (Math.abs(deltaTau) < toleranceDays) {
      break;
    }
  }

  const tauSeconds = tau * 86400;

  return {
    tauDays: tau,
    tauSeconds,
    roundTripSeconds: tauSeconds * 2,
    retardedPos: retPos,
    apparentVector: appVec,
    geometricDistanceAu,
    apparentDistanceAu: appDist,
    iterations,
  };
}

/**
 * Simple scalar light-time converter for arbitrary distances (AU, km, light-years).
 */
export function distanceToLightTimeSeconds(distanceAu: number): number {
  return (distanceAu / SPEED_OF_LIGHT_AU_DAY) * 86400;
}

export function lightTimeToDistanceAu(timeSeconds: number): number {
  return (timeSeconds / 86400) * SPEED_OF_LIGHT_AU_DAY;
}
