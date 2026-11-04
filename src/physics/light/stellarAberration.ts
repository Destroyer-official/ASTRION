/**
 * Relativistic Stellar Aberration Engine
 *
 * Implements full special relativistic Lorentz transformation of photon wavevectors
 * (NASA SPICE 'LT+S' and IAU 2000 standard).
 *
 * References:
 * - Stumpff, P. (1979), "Rigorous Treatment of Stellar Aberration and Relativistic
 *   Corrections", A&A 78:229.
 * - Klioner, S. A. (2003), "A Practical Relativistic Model for Microarcsecond Astrometry
 *   in Space", AJ 125:1580.
 * - Urban, S. E. & Seidelmann, P. K. (2012), "Explanatory Supplement to the Astronomical
 *   Almanac", 3rd Ed., University Science Books.
 */

import { SPEED_OF_LIGHT_AU_DAY, type Vector3D } from './lightTime';

export interface AberrationResult {
  /** Apparent aberrated unit direction vector */
  aberratedDirection: Vector3D;
  /** True un-aberrated unit direction vector */
  trueDirection: Vector3D;
  /** Total angular displacement in radians */
  displacementRad: number;
  /** Total angular displacement in arcseconds (") */
  displacementArcsec: number;
  /** Relativistic Lorentz factor gamma */
  gamma: number;
  /** Normalized observer speed beta = v / c */
  beta: number;
}

/**
 * Normalizes a 3D vector to unit length.
 */
function normalize(v: Vector3D): Vector3D {
  const norm = Math.hypot(v.x, v.y, v.z);
  if (norm < 1e-16) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: v.x / norm, y: v.y / norm, z: v.z / norm };
}

/**
 * Computes exact relativistic stellar aberration on a line-of-sight unit vector.
 *
 * @param trueDirectionUnit Unit vector from observer pointing towards the source
 * @param observerVelAUPerDay Observer velocity vector in AU/day
 */
export function applyStellarAberration(
  trueDirectionUnit: Vector3D,
  observerVelAUPerDay: Vector3D,
): AberrationResult {
  const u = normalize(trueDirectionUnit);

  // Beta vector: beta = v_obs / c
  const bx = observerVelAUPerDay.x / SPEED_OF_LIGHT_AU_DAY;
  const by = observerVelAUPerDay.y / SPEED_OF_LIGHT_AU_DAY;
  const bz = observerVelAUPerDay.z / SPEED_OF_LIGHT_AU_DAY;
  const betaSq = bx * bx + by * by + bz * bz;
  const beta = Math.sqrt(betaSq);

  if (beta < 1e-14) {
    return {
      aberratedDirection: u,
      trueDirection: u,
      displacementRad: 0,
      displacementArcsec: 0,
      gamma: 1,
      beta: 0,
    };
  }

  // Cap beta physically below 1.0 (sub-luminal)
  const safeBetaSq = Math.min(0.999999999999, betaSq);
  const gamma = 1 / Math.sqrt(1 - safeBetaSq);

  // Scalar product: beta · u
  const betaDotU = bx * u.x + by * u.y + bz * u.z;

  // Lorentz transformation for null ray (photon direction u'):
  // u' = [u + beta + (gamma - 1)/beta^2 * (beta · u) * beta] / [gamma * (1 + beta · u)]
  const gammaFactor = (gamma - 1) / (safeBetaSq || 1);
  const commonTerm = gammaFactor * betaDotU;

  const numX = u.x + bx + commonTerm * bx;
  const numY = u.y + by + commonTerm * by;
  const numZ = u.z + bz + commonTerm * bz;
  const denom = gamma * (1 + betaDotU);

  const aberratedDirection = normalize({
    x: numX / denom,
    y: numY / denom,
    z: numZ / denom,
  });

  // Angular displacement: cos(delta) = u · u'
  const dot = Math.max(-1, Math.min(1, u.x * aberratedDirection.x + u.y * aberratedDirection.y + u.z * aberratedDirection.z));
  const displacementRad = Math.acos(dot);
  const displacementArcsec = (displacementRad * 180 * 3600) / Math.PI;

  return {
    aberratedDirection,
    trueDirection: u,
    displacementRad,
    displacementArcsec,
    gamma,
    beta,
  };
}

/**
 * Removes stellar aberration (inverts the Lorentz transformation to recover true astrometric position).
 */
export function removeStellarAberration(
  apparentDirectionUnit: Vector3D,
  observerVelAUPerDay: Vector3D,
): AberrationResult {
  // Inverting aberration is mathematically equivalent to applying aberration with opposite velocity -v
  const invertedVel = {
    x: -observerVelAUPerDay.x,
    y: -observerVelAUPerDay.y,
    z: -observerVelAUPerDay.z,
  };
  return applyStellarAberration(apparentDirectionUnit, invertedVel);
}
