import { DAY_S, JD_J2000, JD_UNIX_EPOCH } from '@/data/constants';

/**
 * Standard IERS leap second step table (TAI - UTC in seconds).
 * Dates given as Julian Date of the step epoch (00:00:00 UTC).
 *
 * Source: IERS Bulletin C & IAU SOFA time standards.
 */
export const LEAP_SECONDS_TABLE: ReadonlyArray<{ jdUtc: number; deltaAt: number }> = [
  { jdUtc: 2441317.5, deltaAt: 10 }, // 1972-01-01
  { jdUtc: 2441499.5, deltaAt: 11 }, // 1972-07-01
  { jdUtc: 2441683.5, deltaAt: 12 }, // 1973-01-01
  { jdUtc: 2442048.5, deltaAt: 13 }, // 1974-01-01
  { jdUtc: 2442413.5, deltaAt: 14 }, // 1975-01-01
  { jdUtc: 2442778.5, deltaAt: 15 }, // 1976-01-01
  { jdUtc: 2443144.5, deltaAt: 16 }, // 1977-01-01
  { jdUtc: 2443509.5, deltaAt: 17 }, // 1978-01-01
  { jdUtc: 2443874.5, deltaAt: 18 }, // 1979-01-01
  { jdUtc: 2444239.5, deltaAt: 19 }, // 1980-01-01
  { jdUtc: 2444786.5, deltaAt: 20 }, // 1981-07-01
  { jdUtc: 2445151.5, deltaAt: 21 }, // 1982-07-01
  { jdUtc: 2445516.5, deltaAt: 22 }, // 1983-07-01
  { jdUtc: 2446247.5, deltaAt: 23 }, // 1985-07-01
  { jdUtc: 2447161.5, deltaAt: 24 }, // 1988-01-01
  { jdUtc: 2447892.5, deltaAt: 25 }, // 1990-01-01
  { jdUtc: 2448257.5, deltaAt: 26 }, // 1991-01-01
  { jdUtc: 2448804.5, deltaAt: 27 }, // 1992-07-01
  { jdUtc: 2449169.5, deltaAt: 28 }, // 1993-07-01
  { jdUtc: 2449534.5, deltaAt: 29 }, // 1994-07-01
  { jdUtc: 2450083.5, deltaAt: 30 }, // 1996-01-01
  { jdUtc: 2450630.5, deltaAt: 31 }, // 1997-07-01
  { jdUtc: 2451179.5, deltaAt: 32 }, // 1999-01-01
  { jdUtc: 2453736.5, deltaAt: 33 }, // 2006-01-01
  { jdUtc: 2454832.5, deltaAt: 34 }, // 2009-01-01
  { jdUtc: 2456109.5, deltaAt: 35 }, // 2012-07-01
  { jdUtc: 2457204.5, deltaAt: 36 }, // 2015-07-01
  { jdUtc: 2457754.5, deltaAt: 37 }, // 2017-01-01
];

/** TT minus TAI constant offset in seconds (exact by IAU definition) */
export const TT_MINUS_TAI_S = 32.184;

/** Rate ratio L_B for TCB - TDB (IAU 2006 Resolution 3) */
export const L_B = 1.550519768e-8;

/** Rate ratio L_G for TCG - TT (IAU 2000 Resolution B1.9) */
export const L_G = 6.969290134e-10;

/** Two-part Julian Date [integerDay, fractionalDay] preserving picosecond precision */
export type JdPair = readonly [number, number];

/** Normalizes a two-part Julian date so that -0.5 <= frac < 0.5 */
export function normalizeJdPair(day: number, frac: number): JdPair {
  const rounded = Math.round(frac);
  return [day + rounded, frac - rounded];
}

/** Splits a single scalar JD into a two-part Julian Date */
export function jdToPair(jd: number): JdPair {
  const day = Math.floor(jd + 0.5);
  return [day, jd - day];
}

/** Combines a two-part Julian date into a scalar JD */
export function pairToJd(pair: JdPair): number {
  return pair[0] + pair[1];
}

/**
 * Returns the exact leap second difference Delta_AT = TAI - UTC in seconds for any JD(UTC).
 * For dates prior to 1972, smoothly extrapolates back to 0.
 */
export function getLeapSeconds(jdUtc: number): number {
  if (jdUtc < LEAP_SECONDS_TABLE[0]!.jdUtc) {
    const t = (jdUtc - LEAP_SECONDS_TABLE[0]!.jdUtc) / 365.25;
    return Math.max(0, 10 + t * 0.8);
  }
  for (let i = LEAP_SECONDS_TABLE.length - 1; i >= 0; i--) {
    const entry = LEAP_SECONDS_TABLE[i]!;
    if (jdUtc >= entry.jdUtc) {
      return entry.deltaAt;
    }
  }
  return 37;
}

/** Converts JD(UTC) to JD(TAI) */
export function utcToTai(jdUtc: number): number {
  const deltaAt = getLeapSeconds(jdUtc);
  return jdUtc + deltaAt / DAY_S;
}

/** Converts JD(TAI) to JD(UTC) */
export function taiToUtc(jdTai: number): number {
  let jdUtc = jdTai - 37 / DAY_S;
  for (let i = 0; i < 3; i++) {
    const deltaAt = getLeapSeconds(jdUtc);
    jdUtc = jdTai - deltaAt / DAY_S;
  }
  return jdUtc;
}

/** Converts JD(TAI) to JD(TT) */
export function taiToTt(jdTai: number): number {
  return jdTai + TT_MINUS_TAI_S / DAY_S;
}

/** Two-part conversion for exact picosecond preservation: TAI -> TT */
export function taiToTtPair(tai: JdPair): JdPair {
  return normalizeJdPair(tai[0], tai[1] + TT_MINUS_TAI_S / DAY_S);
}

/** Converts JD(TT) to JD(TAI) */
export function ttToTai(jdTt: number): number {
  return jdTt - TT_MINUS_TAI_S / DAY_S;
}

/** Converts JD(UTC) to JD(TT) */
export function utcToTt(jdUtc: number): number {
  return taiToTt(utcToTai(jdUtc));
}

/** Converts JD(TT) to JD(UTC) */
export function ttToUtc(jdTt: number): number {
  return taiToUtc(ttToTai(jdTt));
}

/**
 * Fairhead & Bretagnon (1990) TDB − TT terms, in seconds.
 * UNVERIFIED primary-source transcription: see docs/OPEN_QUESTIONS.md OPEN-003.
 * The amplitude is approximately 1.7 ms, matching the bound asserted by
 * tests/time.test.ts.
 */
export function ttToTdbOffsetS(jdTt: number): number {
  const T = (jdTt - JD_J2000) / 36525;
  const g = (357.52772 + 35999.05034 * T) * (Math.PI / 180);
  return (
    0.001657 * Math.sin(g + 0.01671 * Math.sin(g)) +
    0.000022 * Math.sin(2 * g) +
    0.000014 * Math.sin((40.0 + 32964.0 * T) * (Math.PI / 180))
  );
}

/** Converts JD(TT) to JD(TDB) using the Fairhead & Bretagnon (1990) relativistic series. */
export function ttToTdb(jdTt: number): number {
  return jdTt + ttToTdbOffsetS(jdTt) / DAY_S;
}

/** Converts JD(TDB) to JD(TT) by fixed-point inversion of the periodic TT → TDB offset. */
export function tdbToTt(jdTdb: number): number {
  let jdTt = jdTdb;
  for (let i = 0; i < 3; i++) {
    jdTt = jdTdb - ttToTdbOffsetS(jdTt) / DAY_S;
  }
  return jdTt;
}

/** Converts JD(UTC) to JD(TDB) */
export function utcToTdb(jdUtc: number): number {
  return ttToTdb(utcToTt(jdUtc));
}

/** Converts JD(TDB) to JD(UTC) */
export function tdbToUtc(jdTdb: number): number {
  return ttToUtc(tdbToTt(jdTdb));
}

/** Converts JD(TDB) to JD(TCB) (Barycentric Coordinate Time) */
export function tdbToTcb(jdTdb: number): number {
  return jdTdb + (L_B * (jdTdb - JD_J2000));
}

/** Converts JD(TCB) to JD(TDB) */
export function tcbToTdb(jdTcb: number): number {
  return (jdTcb + L_B * JD_J2000) / (1 + L_B);
}

/** Converts JD(TT) to JD(TCG) (Geocentric Coordinate Time) */
export function ttToTcg(jdTt: number): number {
  return jdTt + (L_G * (jdTt - JD_J2000));
}

/** Converts JD(TCG) to JD(TT) */
export function tcgToTt(jdTcg: number): number {
  return (jdTcg + L_G * JD_J2000) / (1 + L_G);
}

/** Converts a standard JavaScript Date (UTC) to high-precision JD(UTC) */
export function dateToJdUtc(date: Date): number {
  return date.getTime() / (DAY_S * 1000) + JD_UNIX_EPOCH;
}

/** Converts JD(UTC) to a standard JavaScript Date (UTC) */
export function jdUtcToDate(jdUtc: number): Date {
  return new Date(Math.round((jdUtc - JD_UNIX_EPOCH) * DAY_S * 1000));
}

/** Converts JD(TDB) to a JavaScript Date (UTC). */
export function jdToDate(jdTdb: number): Date {
  return jdUtcToDate(tdbToUtc(jdTdb));
}

/** Converts a JavaScript Date (UTC) to JD(TDB). */
export function dateToJd(date: Date): number {
  return utcToTdb(dateToJdUtc(date));
}
