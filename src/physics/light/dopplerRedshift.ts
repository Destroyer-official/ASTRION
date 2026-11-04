/**
 * Universal Multi-Component Doppler & Relativistic Redshift Engine
 *
 * Implements:
 * 1. Special relativistic kinematic Doppler shift & beaming factor.
 * 2. General relativistic gravitational redshift (Schwarzschild metric).
 * 3. Cosmological FLRW expansion redshift (Hubble-Lemaître law & Planck 2018 parameters).
 * 4. Composite redshift: (1 + z_total) = (1 + z_kin) * (1 + z_grav) * (1 + z_cosmo).
 *
 * References:
 * - Rybicki, G. B. & Lightman, A. P. (1979), "Radiative Processes in Astrophysics", Wiley.
 * - Weinberg, S. (2008), "Cosmology", Oxford University Press.
 * - Planck Collaboration (2020), "Planck 2018 results. VI. Cosmological parameters", A&A 641:A6.
 */

import { SPEED_OF_LIGHT_AU_DAY, SPEED_OF_LIGHT_KM_S, type Vector3D } from './lightTime';
import { getSchwarzschildRadiusAu } from './gravitationalLensing';

// Planck 2018 cosmological parameters
export const HUBBLE_CONSTANT_KM_S_MPC = 67.4; // km/s / Mpc
export const OMEGA_MATTER = 0.315;
export const OMEGA_LAMBDA = 0.685;
export const DECELERATION_PARAMETER_Q0 = 0.5 * OMEGA_MATTER - OMEGA_LAMBDA; // ~ -0.5275 (accelerating)

export interface RedshiftBreakdown {
  /** Kinematic redshift z_kin from relative motion */
  zKinematic: number;
  /** Gravitational redshift z_grav from potential difference */
  zGravitational: number;
  /** Cosmological expansion redshift z_cosmo */
  zCosmological: number;
  /** Total combined redshift: (1 + z_total) = (1 + z_kin) * (1 + z_grav) * (1 + z_cosmo) - 1 */
  zTotal: number;
  /** Relativistic Doppler beaming factor delta = 1 / [gamma * (1 - beta · n)] */
  beamingFactor: number;
  /** Observed frequency ratio nu_obs / nu_emit = 1 / (1 + z_total) */
  frequencyRatio: number;
  /** Radial line-of-sight velocity in km/s (positive = receding, negative = approaching) */
  radialVelocityKms: number;
}

/**
 * Computes exact special relativistic kinematic Doppler redshift.
 *
 * @param relativeVelAUPerDay Velocity of target relative to observer (v_target - v_obs) in AU/day
 * @param lineOfSightUnit Unit vector from observer pointing toward the target
 */
export function computeKinematicDoppler(
  relativeVelAUPerDay: Vector3D,
  lineOfSightUnit: Vector3D,
): { zKin: number; beamingFactor: number; vRadialKms: number; beta: number } {
  const betaX = relativeVelAUPerDay.x / SPEED_OF_LIGHT_AU_DAY;
  const betaY = relativeVelAUPerDay.y / SPEED_OF_LIGHT_AU_DAY;
  const betaZ = relativeVelAUPerDay.z / SPEED_OF_LIGHT_AU_DAY;
  const betaSq = Math.min(0.999999999999, betaX * betaX + betaY * betaY + betaZ * betaZ);
  const beta = Math.sqrt(betaSq);
  const gamma = 1 / Math.sqrt(1 - betaSq);

  // Line-of-sight component: beta_r = beta · lineOfSightUnit
  // If target moves away, relative velocity is in lineOfSight direction -> beta_r > 0
  const betaR = betaX * lineOfSightUnit.x + betaY * lineOfSightUnit.y + betaZ * lineOfSightUnit.z;

  // 1 + z_kin = gamma * (1 + beta_r)
  // For target receding (beta_r > 0), wavelength increases -> redshift
  // Frequency ratio: nu_obs / nu_emit = 1 / (gamma * (1 + beta_r))
  const onePlusZ = gamma * (1 + betaR);
  const zKin = Math.max(-0.999999, onePlusZ - 1);

  // Relativistic Doppler beaming factor (boost in target reference frame):
  // delta = 1 / [gamma * (1 - beta · n)] where n points from target to observer (n = -lineOfSightUnit)
  // 1 - beta · (-lineOfSightUnit) = 1 + betaR
  const beamingFactor = 1 / Math.max(1e-12, gamma * (1 + betaR));

  const vRadialKms = betaR * SPEED_OF_LIGHT_KM_S;

  return {
    zKin,
    beamingFactor,
    vRadialKms,
    beta,
  };
}

/**
 * Computes general relativistic gravitational redshift in Schwarzschild spacetime.
 *
 * @param gmInternal Gravitational parameter of dominant central body (AU^3/day^2)
 * @param rEmitAu Distance of emitter from gravitating center (AU)
 * @param rObsAu Distance of observer from gravitating center (AU)
 */
export function computeGravitationalRedshift(
  gmInternal: number,
  rEmitAu: number,
  rObsAu: number,
): number {
  if (gmInternal <= 0 || rEmitAu <= 0 || rObsAu <= 0) return 0;

  const rs = getSchwarzschildRadiusAu(gmInternal);

  // Ensure radii are outside the event horizon
  const safeREmit = Math.max(1.0001 * rs, rEmitAu);
  const safeRObs = Math.max(1.0001 * rs, rObsAu);

  const factorEmit = Math.sqrt(Math.max(1e-12, 1 - rs / safeREmit));
  const factorObs = Math.sqrt(Math.max(1e-12, 1 - rs / safeRObs));

  // 1 + z_grav = factorObs / factorEmit = sqrt(1 - rs/r_obs) / sqrt(1 - rs/r_emit)
  // When photon climbs out of a potential well (r_emit < r_obs), factorEmit < factorObs -> 1 + z_grav > 1 (redshift)
  const onePlusZ = factorObs / factorEmit;
  return onePlusZ - 1;
}

/**
 * Computes cosmological expansion redshift using the FLRW metric (Hubble-Lemaître expansion).
 *
 * @param distanceMpc Comoving distance in Megaparsecs (1 Mpc = 3.26 million light-years)
 */
export function computeCosmologicalRedshift(distanceMpc: number): number {
  if (distanceMpc <= 0) return 0;

  // First-order Hubble-Lemaître velocity: v_H = H_0 * d
  const vH = HUBBLE_CONSTANT_KM_S_MPC * distanceMpc;
  const x = vH / SPEED_OF_LIGHT_KM_S;

  // Second-order cosmological expansion series:
  // z_cosmo = x + 0.5 * (1 + q_0) * x^2
  // where q_0 = 0.5 * Omega_m - Omega_Lambda ~ -0.528
  const zCosmo = x + 0.5 * (1 + DECELERATION_PARAMETER_Q0) * x * x;
  return Math.max(0, zCosmo);
}

/**
 * Computes the unified composite redshift combining kinematic, gravitational, and cosmological effects.
 */
export function computeCompositeRedshift(opts: {
  relativeVelAUPerDay: Vector3D;
  lineOfSightUnit: Vector3D;
  gmInternal?: number;
  rEmitAu?: number;
  rObsAu?: number;
  distanceMpc?: number;
}): RedshiftBreakdown {
  const kin = computeKinematicDoppler(opts.relativeVelAUPerDay, opts.lineOfSightUnit);

  let zGrav = 0;
  if (opts.gmInternal && opts.rEmitAu && opts.rObsAu) {
    zGrav = computeGravitationalRedshift(opts.gmInternal, opts.rEmitAu, opts.rObsAu);
  }

  let zCosmo = 0;
  if (opts.distanceMpc && opts.distanceMpc > 0) {
    zCosmo = computeCosmologicalRedshift(opts.distanceMpc);
  }

  // Exact multiplicative combination of relativistic redshift scale factors:
  // (1 + z_total) = (1 + z_kin) * (1 + z_grav) * (1 + z_cosmo)
  const onePlusZTotal = (1 + kin.zKin) * (1 + zGrav) * (1 + zCosmo);
  const zTotal = onePlusZTotal - 1;
  const frequencyRatio = 1 / onePlusZTotal;

  return {
    zKinematic: kin.zKin,
    zGravitational: zGrav,
    zCosmological: zCosmo,
    zTotal,
    beamingFactor: kin.beamingFactor,
    frequencyRatio,
    radialVelocityKms: kin.vRadialKms,
  };
}
