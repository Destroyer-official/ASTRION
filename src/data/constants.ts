/** Julian day in SI seconds. */
export const DAY_S = 86_400;

/** Exact by IAU 2012 definition. */
export const AU_KM = 149_597_870.7;

/** Exact by SI definition. */
export const C_LIGHT_KMS = 299_792.458;

/** Sun GM from JPL DE440, km^3/s^2 */
export const GM_SUN_KM3_S2 = 132_712_440_041.279419;

/** Convert GM from km^3/s^2 to AU^3/day^2 (the engine's internal unit). */
export function gmToInternal(gmKm3S2: number): number {
  return (gmKm3S2 * DAY_S * DAY_S) / AU_KM ** 3;
}

export const kmToAu = (km: number) => km / AU_KM;
export const kmsToAuDay = (kms: number) => (kms * DAY_S) / AU_KM;
export const auDayToKms = (v: number) => (v * AU_KM) / DAY_S;

/** 1,000 m/km, exact by SI prefix definition. */
export const METERS_PER_KM = 1_000;

/** Julian year: exactly 365.25 SI days, or 31,557,600 s. */
export const SECONDS_PER_JULIAN_YEAR = 31_557_600;

/** Speed of light in AU/day */
export const C_LIGHT_AU_DAY = (C_LIGHT_KMS * DAY_S) / AU_KM;

/**
 * One parsec expressed in AU: the distance at which 1 AU subtends 1 arcsecond,
 * so pc = 1 AU / (1 arcsec in radians). One turn = 360 deg = 1_296_000 arcsec,
 * hence arcsec per radian = 1_296_000 / (2 pi) = 648_000 / pi, giving
 * 648_000 / pi = 206_264.806... AU. This is a derivable identity, not a
 * measurement. IAU 2015 Resolution B2 fixes the same value; that page was not
 * fetched during this pass, see docs/RESEARCH.md section 6.
 */
export const AU_PER_PARSEC = 648_000 / Math.PI;

/** Light-year in km: c multiplied by one Julian year. */
export const KM_PER_LIGHT_YEAR = C_LIGHT_KMS * SECONDS_PER_JULIAN_YEAR;

/** Light-year in AU, derived from the exact AU and SI-defined c. */
export const AU_PER_LIGHT_YEAR = KM_PER_LIGHT_YEAR / AU_KM;

/** Parsec in km, derived from AU_PER_PARSEC and AU_KM. */
export const KM_PER_PARSEC = AU_PER_PARSEC * AU_KM;

/** Light-years per parsec, derived from the two definitions above. */
export const LIGHT_YEARS_PER_PARSEC = AU_PER_PARSEC / AU_PER_LIGHT_YEAR;

/** Metric SI prefixes, exact by definition. */
export const PARSECS_PER_KPC = 1_000;
export const KPC_PER_MPC = 1_000;

/** Kiloparsec and megaparsec in km. */
export const KM_PER_KPC = KM_PER_PARSEC * PARSECS_PER_KPC;
export const KM_PER_MPC = KM_PER_KPC * KPC_PER_MPC;

/** Julian date of J2000.0 epoch */
export const JD_J2000 = 2451545.0;

/** Julian date of 1970-01-01T00:00:00Z */
export const JD_UNIX_EPOCH = 2440587.5;

/** Solar J2 quadrupole coefficient (Park et al. 2021 DE440) */
export const SUN_J2 = 2.2e-7;

/** Solar equatorial radius in km */
export const SUN_RADIUS_KM = 695_700;

/**
 * Sagittarius A* mass adopted by GRAVITY Collaboration (Abd El Dayem et al.
 * 2024, arXiv:2409.12261): 4.2996e6 solar masses. Accessed 2026-11-05.
 */
export const SGRA_MASS_SOLAR = 4.2996e6;

/**
 * NASA JPL Planetary and Lunar Ephemerides DE440 / DE441 validity boundaries
 * (Park et al. 2021, The Astronomical Journal, 161:105, DOI: 10.3847/1538-3881/abd414).
 * DE440 includes lunar core-mantle damping and is accurate across 1550 to 2650 CE.
 * DE441 omits the damping term to prevent secular divergence over deep millennia.
 */
export const DE440_START_YEAR = 1550;
export const DE440_END_YEAR = 2650;
export const DE440_START_JD = 2287184.5; // 1549-Dec-21 00:00:00 TDB
export const DE440_END_JD = 2688976.5; // 2650-Jan-22 00:00:00 TDB

export const DE441_START_YEAR = -13200;
export const DE441_END_YEAR = 17191;
export const DE441_START_JD = -2608495.5; // -13200-Aug-15 00:00:00 TDB
export const DE441_END_JD = 8003664.5; // 17191-Mar-15 00:00:00 TDB

