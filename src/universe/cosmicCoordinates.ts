/**
 * NASA-Standard Astronomical Constants & Multiscale Coordinate Conversion Engine
 *
 * Implements high-precision conversions across 30 orders of magnitude:
 * meters <-> km <-> AU <-> light-years <-> parsecs <-> kiloparsecs <-> Megaparsecs.
 *
 * References:
 * - IAU 2012 Resolution B2 (Exact astronomical unit definition)
 * - IAU 2015 Resolution B3 (Nominal solar and planetary values)
 * - Hipparcos & Gaia DR3 Astrometric Coordinate Standards
 */

import * as cosmicConstants from '@/data/constants';

// Public aliases. Every underlying value is defined once in src/data/constants.ts.
export const AU_KM = cosmicConstants.AU_KM;
export const AU_PER_LIGHT_YEAR = cosmicConstants.AU_PER_LIGHT_YEAR;
export const AU_PER_PARSEC = cosmicConstants.AU_PER_PARSEC;
export const KM_PER_AU = cosmicConstants.AU_KM;
export const KM_PER_KPC = cosmicConstants.KM_PER_KPC;
export const KM_PER_LIGHT_YEAR = cosmicConstants.KM_PER_LIGHT_YEAR;
export const KM_PER_MPC = cosmicConstants.KM_PER_MPC;
export const KM_PER_PARSEC = cosmicConstants.KM_PER_PARSEC;
export const KPC_PER_MPC = cosmicConstants.KPC_PER_MPC;
export const LIGHT_YEARS_PER_PARSEC = cosmicConstants.LIGHT_YEARS_PER_PARSEC;
export const METERS_PER_KM = cosmicConstants.METERS_PER_KM;
export const PARSECS_PER_KPC = cosmicConstants.PARSECS_PER_KPC;
export const SECONDS_PER_JULIAN_YEAR = cosmicConstants.SECONDS_PER_JULIAN_YEAR;
export const SPEED_OF_LIGHT_KMS = cosmicConstants.C_LIGHT_KMS;
export const SPEED_OF_LIGHT_KM_S = cosmicConstants.C_LIGHT_KMS;

// Astronomical conversions
export const auToKm = (au: number): number => au * AU_KM;
export const kmToAu = (km: number): number => km / AU_KM;
export const lyToAu = (ly: number): number => ly * AU_PER_LIGHT_YEAR;
export const auToLy = (au: number): number => au / AU_PER_LIGHT_YEAR;
export const pcToLy = (pc: number): number => pc * LIGHT_YEARS_PER_PARSEC;
export const lyToPc = (ly: number): number => ly / LIGHT_YEARS_PER_PARSEC;
export const kpcToLy = (kpc: number): number => kpc * PARSECS_PER_KPC * LIGHT_YEARS_PER_PARSEC;
export const lyToKpc = (ly: number): number => ly / (PARSECS_PER_KPC * LIGHT_YEARS_PER_PARSEC);
export const mpcToLy = (mpc: number): number => mpc * 1_000_000 * LIGHT_YEARS_PER_PARSEC;
export const lyToMpc = (ly: number): number => ly / (1_000_000 * LIGHT_YEARS_PER_PARSEC);

export interface EquatorialCoordinates {
  /** Right Ascension in degrees (0 to 360) or decimal hours * 15 */
  raDeg: number;
  /** Declination in degrees (-90 to +90) */
  decDeg: number;
  /** Distance in light-years */
  distanceLy: number;
}

export interface Cartesian3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Converts ICRS / J2000 spherical equatorial coordinates (RA, Dec, Distance)
 * into 3D Cartesian coordinates in the equatorial frame.
 */
export function equatorialToCartesian(eq: EquatorialCoordinates): Cartesian3D {
  const raRad = (eq.raDeg * Math.PI) / 180;
  const decRad = (eq.decDeg * Math.PI) / 180;
  const cosDec = Math.cos(decRad);

  return {
    x: eq.distanceLy * cosDec * Math.cos(raRad),
    y: eq.distanceLy * cosDec * Math.sin(raRad),
    z: eq.distanceLy * Math.sin(decRad),
  };
}

/**
 * Converts 3D Cartesian coordinates into ICRS spherical equatorial coordinates.
 */
export function cartesianToEquatorial(
  cOrX: Cartesian3D | number,
  maybeY?: number,
  maybeZ?: number,
): EquatorialCoordinates {
  const x = typeof cOrX === 'number' ? cOrX : cOrX.x;
  const y = typeof cOrX === 'number' ? (maybeY ?? 0) : cOrX.y;
  const z = typeof cOrX === 'number' ? (maybeZ ?? 0) : cOrX.z;
  const distanceLy = Math.hypot(x, y, z);
  if (distanceLy < 1e-12) {
    return { raDeg: 0, decDeg: 0, distanceLy: 0 };
  }

  const decDeg = (Math.asin(Math.max(-1, Math.min(1, z / distanceLy))) * 180) / Math.PI;
  let raDeg = (Math.atan2(y, x) * 180) / Math.PI;
  if (raDeg < 0) raDeg += 360;

  return { raDeg, decDeg, distanceLy };
}

export function equatorialToCartesianLy(raDeg: number, decDeg: number, distanceLy: number): Cartesian3D & { distLy: number } {
  const cart = equatorialToCartesian({ raDeg, decDeg, distanceLy });
  return { ...cart, distLy: distanceLy };
}

/**
 * Formats a celestial distance into the most natural, human-readable NASA unit.
 */
export function formatCosmicDistance(distanceLy: number): string {
  if (distanceLy <= 0) return '0 AU (Local)';
  const au = distanceLy * AU_PER_LIGHT_YEAR;

  if (au < 0.01) {
    return `${(au * KM_PER_AU).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  }
  if (au < 1_000) {
    return `${au.toFixed(2)} AU`;
  }
  if (distanceLy < 0.1) {
    return `${au.toLocaleString(undefined, { maximumFractionDigits: 0 })} AU (${(distanceLy * 12).toFixed(1)} light-months)`;
  }
  if (distanceLy < 10_000) {
    return `${distanceLy.toLocaleString(undefined, { maximumFractionDigits: 1 })} light-years (${(distanceLy / LIGHT_YEARS_PER_PARSEC).toFixed(1)} pc)`;
  }
  if (distanceLy < 1_000_000) {
    const kpc = distanceLy / (PARSECS_PER_KPC * LIGHT_YEARS_PER_PARSEC);
    return `${(distanceLy / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} thousand ly (${kpc.toFixed(1)} kpc)`;
  }
  const mpc = distanceLy / (1_000_000 * LIGHT_YEARS_PER_PARSEC);
  return `${(distanceLy / 1_000_000).toFixed(2)} million ly (${mpc.toFixed(2)} Mpc)`;
}

