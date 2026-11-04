/** Exact by IAU 2012 definition */
export const AU_KM = 149_597_870.7;
export const DAY_S = 86_400;

/** Sun GM from JPL DE440, km^3/s^2 */
export const GM_SUN_KM3_S2 = 132_712_440_041.279419;

/** Convert GM from km^3/s^2 to AU^3/day^2 (the engine's internal unit). */
export function gmToInternal(gmKm3S2: number): number {
  return (gmKm3S2 * DAY_S * DAY_S) / AU_KM ** 3;
}

export const kmToAu = (km: number) => km / AU_KM;
export const kmsToAuDay = (kms: number) => (kms * DAY_S) / AU_KM;
export const auDayToKms = (v: number) => (v * AU_KM) / DAY_S;

/** Julian date of J2000.0 epoch */
export const JD_J2000 = 2451545.0;

/** Julian date of 1970-01-01T00:00:00Z */
export const JD_UNIX_EPOCH = 2440587.5;

/** Speed of light in km/s (exact by SI definition) */
export const C_LIGHT_KMS = 299_792.458;

/** Speed of light in AU/day */
export const C_LIGHT_AU_DAY = (C_LIGHT_KMS * DAY_S) / AU_KM;

/** Solar J2 quadrupole coefficient (Park et al. 2021 DE440) */
export const SUN_J2 = 2.2e-7;

/** Solar equatorial radius in km */
export const SUN_RADIUS_KM = 695_700;

/** TDB minus UTC in seconds. No leap seconds since 2016, so TT-UTC = 69.184 s
 * exactly; TDB-TT oscillates +/-0.0016 s (sub-meter, ignored). Revisit only
 * if the IERS announces a new leap second. */
export const TDB_MINUS_UTC_S = 69.184;

/** JD(TDB) -> Date(UTC): removes the offset so readouts show true UTC. */
export const jdToDate = (jd: number): Date =>
  new Date((jd - TDB_MINUS_UTC_S / DAY_S - JD_UNIX_EPOCH) * DAY_S * 1000);
/** Date(UTC) -> JD(TDB): adds the offset so Horizons queries use true TDB. */
export const dateToJd = (d: Date): number =>
  d.getTime() / (DAY_S * 1000) + JD_UNIX_EPOCH + TDB_MINUS_UTC_S / DAY_S;
