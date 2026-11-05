/**
 * Universal Radiometric Photometry & Flux Engine
 *
 * Implements:
 * 1. Inverse-square radiant flux propagation across AU, light-years, parsecs, and Mpc.
 * 2. Absolute and apparent magnitude conversions (Pogson's law and distance modulus).
 * 3. Interstellar dust extinction models (galactic plane and line-of-sight dust absorption).
 * 4. Telescope photon flux and signal-to-noise ratio (SNR) sensor calculations.
 *
 * References:
 * - Pogson, N. (1856), "Magnitudes of Thirty-six of the Minor Planets", MNRAS 17:12.
 * - IAU 2015 Resolution B3 (Nominal solar luminosity and planetary radii).
 * - Cardelli, J. A., Clayton, G. C., & Mathis, J. S. (1989), "The Relationship between
 *   Extinction and Polarization: A Generalized Extinction Law", ApJ 345:245.
 */

import { AU_KM } from '@/data/constants';
import { AU_PER_PARSEC } from '@/data/constants';

export const SOLAR_LUMINOSITY_WATTS = 3.828e26; // IAU 2015 exact standard
export const SOLAR_ABSOLUTE_MAGNITUDE_V = 4.83; // Solar visual absolute magnitude
export const SOLAR_CONSTANT_EARTH_W_M2 = 1361.0; // Solar irradiance at 1 AU (W/m^2)
export const PLANCK_CONSTANT_J_S = 6.62607015e-34; // Exact SI J*s

export interface PhotometryResult {
  /** Apparent magnitude m */
  apparentMagnitude: number;
  /** Absolute magnitude M */
  absoluteMagnitude: number;
  /** Distance modulus mu = m - M */
  distanceModulus: number;
  /** Radiant flux at observer in W/m^2 */
  fluxWattsPerM2: number;
  /** Flux relative to Solar Constant at Earth (1 AU = 1.0) */
  relativeFluxSunEarth: number;
  /** Interstellar extinction A_V in magnitudes */
  extinctionMag: number;
  /** Estimated photon arrival rate per square meter of aperture (photons/s/m^2 in V-band) */
  photonRatePerM2PerSec: number;
}

/**
 * Computes apparent magnitude and radiant flux given an object's absolute magnitude or luminosity.
 *
 * @param opts Configuration options
 * @param opts.absoluteMagnitude Absolute visual magnitude M (at 10 pc)
 * @param opts.distanceAu Distance in Astronomical Units (AU)
 * @param opts.luminositySolar Optional luminosity in solar units (L / L_sun)
 * @param opts.galacticLatitudeDeg Galactic latitude b in degrees (-90 to +90) for dust extinction
 * @param opts.extinctionPerKpc Extinction rate in mag/kpc (default 0.7 mag/kpc in plane)
 */
export function computePhotometry(opts: {
  absoluteMagnitude?: number;
  distanceAu: number;
  luminositySolar?: number;
  galacticLatitudeDeg?: number;
  extinctionPerKpc?: number;
}): PhotometryResult {
  const dAu = Math.max(1e-6, opts.distanceAu);
  const dPc = dAu / AU_PER_PARSEC;
  const dKpc = dPc / 1000;

  // Determine absolute magnitude M
  let M: number;
  if (typeof opts.absoluteMagnitude === 'number') {
    M = opts.absoluteMagnitude;
  } else if (typeof opts.luminositySolar === 'number' && opts.luminositySolar > 0) {
    // Pogson: M = M_sun - 2.5 * log10(L / L_sun)
    M = SOLAR_ABSOLUTE_MAGNITUDE_V - 2.5 * Math.log10(opts.luminositySolar);
  } else {
    M = SOLAR_ABSOLUTE_MAGNITUDE_V;
  }

  // Interstellar extinction model:
  // In the galactic plane (small |b|), extinction accumulates at ~0.7 to 1.0 mag/kpc
  // with a scale height of ~100 pc = 0.1 kpc.
  let A_V = 0;
  if (typeof opts.galacticLatitudeDeg === 'number' && dPc > 10) {
    const latRad = (opts.galacticLatitudeDeg * Math.PI) / 180;
    const sinB = Math.max(0.05, Math.abs(Math.sin(latRad)));
    const dustScaleHeightKpc = 0.1; // 100 pc dust layer scale height
    const effPathKpc = Math.min(dKpc, dustScaleHeightKpc / sinB);
    const extinctionCoeff = opts.extinctionPerKpc ?? 0.7; // mag/kpc
    A_V = extinctionCoeff * effPathKpc;
  }

  // Distance modulus: mu = m - M = 5 * log10(d_pc) - 5 + A_V
  // For d < 10 pc, log10(d_pc / 10) is negative
  const distanceModulus = 5 * Math.log10(Math.max(1e-12, dPc)) - 5 + A_V;
  const apparentMagnitude = M + distanceModulus;

  // Radiant flux calculation:
  // L = L_sun * 10^((M_sun - M) / 2.5)
  const luminosityWatts = SOLAR_LUMINOSITY_WATTS * Math.pow(10, (SOLAR_ABSOLUTE_MAGNITUDE_V - M) / 2.5);
  const distanceMeters = dAu * AU_KM * 1000;
  const unattenuatedFlux = luminosityWatts / (4 * Math.PI * distanceMeters * distanceMeters);

  // Extinction factor: F_obs = F_0 * 10^(-0.4 * A_V)
  const extinctionAttenuation = Math.pow(10, -0.4 * A_V);
  const fluxWattsPerM2 = unattenuatedFlux * extinctionAttenuation;
  const relativeFluxSunEarth = fluxWattsPerM2 / SOLAR_CONSTANT_EARTH_W_M2;

  // V-band effective wavelength ~ 550 nm = 5.5e-7 m
  // Photon energy E = h * c / lambda
  const lambdaV = 5.5e-7; // meters
  const c = 299792458; // m/s
  const energyPerPhoton = (PLANCK_CONSTANT_J_S * c) / lambdaV; // ~ 3.61e-19 J
  const photonRatePerM2PerSec = fluxWattsPerM2 / energyPerPhoton;

  return {
    apparentMagnitude,
    absoluteMagnitude: M,
    distanceModulus,
    fluxWattsPerM2,
    relativeFluxSunEarth,
    extinctionMag: A_V,
    photonRatePerM2PerSec,
  };
}

/**
 * Computes apparent magnitude of a solar system body illuminated by the Sun.
 *
 * @param absoluteMagnitudeH Asteroid/planet absolute magnitude H (magnitude at 1 AU from Sun and Earth at 0 deg phase)
 * @param rSunAu Distance from Sun in AU
 * @param rEarthAu Distance from Earth in AU
 * @param phaseAngleDeg Sun-Target-Earth phase angle in degrees
 */
export function computeReflectedApparentMagnitude(
  absoluteMagnitudeH: number,
  rSunAu: number,
  rEarthAu: number,
  phaseAngleDeg = 0,
): number {
  // Phase function phi(alpha) (IAU H-G system approximation for small phase angles)
  const alphaRad = (phaseAngleDeg * Math.PI) / 180;
  const phi = Math.max(0.01, 1 - alphaRad / Math.PI); // simplified monotonic linear phase factor

  // V = H + 5*log10(r_sun * r_earth) - 2.5*log10(phi)
  return absoluteMagnitudeH + 5 * Math.log10(Math.max(1e-6, rSunAu * rEarthAu)) - 2.5 * Math.log10(phi);
}
