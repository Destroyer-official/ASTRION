import { describe, it, expect } from 'vitest';
import {
  getLeapSeconds,
  utcToTai,
  taiToUtc,
  taiToTt,
  taiToTtPair,
  ttToTai,
  utcToTt,
  ttToUtc,
  ttToTdb,
  ttToTdbOffsetS,
  tdbToTt,
  utcToTdb,
  tdbToUtc,
  tdbToTcb,
  tcbToTdb,
  dateToJdUtc,
  jdUtcToDate,
  dateToJd,
  jdToDate,
  TT_MINUS_TAI_S,
  pairToJd,
  jdToPair,
} from '@/physics/time';
import { DAY_S, JD_J2000 } from '@/data/constants';

describe('SOFA / IERS High-Precision Time Standards', () => {
  it('correctly maps historical leap seconds across different eras', () => {
    // 1972-01-01
    const jd1972 = 2441317.5;
    expect(getLeapSeconds(jd1972)).toBe(10);

    // J2000 epoch (2000-01-01)
    expect(getLeapSeconds(JD_J2000)).toBe(32);

    // 2012-07-01
    const jd2012 = 2456109.5;
    expect(getLeapSeconds(jd2012)).toBe(35);

    // Current era (2026)
    const jd2026 = 2461319.5;
    expect(getLeapSeconds(jd2026)).toBe(37);

    // Verify UTC <-> TAI roundtrip
    const tai2026 = utcToTai(jd2026);
    expect(taiToUtc(tai2026)).toBeCloseTo(jd2026, 9);

    // Verify JdPair <-> scalar JD conversion
    const pair = jdToPair(jd2026);
    expect(pairToJd(pair)).toBeCloseTo(jd2026, 12);
  });

  it('verifies TT - TAI is exactly 32.184 seconds using two-part JdPair', () => {
    const taiPair = jdToPair(2451545.0);
    const ttPair = taiToTtPair(taiPair);
    // Two-part difference preserves exact fraction
    const fracDiff = (ttPair[1] - taiPair[1]) * DAY_S;
    expect(fracDiff).toBeCloseTo(TT_MINUS_TAI_S, 10);
  });

  it('verifies TT - TAI on scalar Float64 within float64 precision limit (~30 microseconds)', () => {
    const jdTai = 2451545.0;
    const jdTt = taiToTt(jdTai);
    const diffSeconds = (jdTt - jdTai) * DAY_S;
    expect(diffSeconds).toBeCloseTo(TT_MINUS_TAI_S, 3);
    expect(ttToTai(jdTt)).toBeCloseTo(jdTai, 9);
  });

  it('verifies TT - UTC is approximately 69.184 seconds at 2026 epoch', () => {
    const jd2026Utc = 2461319.5;
    const jdTt = utcToTt(jd2026Utc);
    const diffSeconds = (jdTt - jd2026Utc) * DAY_S;
    // 37 s leap + 32.184 s = 69.184 s
    expect(diffSeconds).toBeCloseTo(69.184, 3);
    expect(ttToUtc(jdTt)).toBeCloseTo(jd2026Utc, 9);
  });

  it('verifies TDB - TT relativistic periodic terms oscillate within ±1.7 milliseconds', () => {
    const baseJdTt = JD_J2000;
    const deltasMs: number[] = [];
    for (let day = 0; day < 365.25; day += 15) {
      const jdTt = baseJdTt + day;
      const jdTdb = ttToTdb(jdTt);
      const diffMs = (jdTdb - jdTt) * DAY_S * 1000;
      deltasMs.push(diffMs);
      expect(Math.abs(diffMs)).toBeLessThan(1.75); // Within Fairhead-Bretagnon bounds
      // Round trip back
      expect(tdbToTt(jdTdb)).toBeCloseTo(jdTt, 8);
    }

    const minMs = Math.min(...deltasMs);
    const maxMs = Math.max(...deltasMs);
    // Amplitude should be approximately 1.657 ms
    expect(maxMs).toBeGreaterThan(1.2);
    expect(minMs).toBeLessThan(-1.2);
  });

  it('inverts the complete TDB - TT periodic series within scalar-JD precision', () => {
    for (let day = 0; day < 365.25; day += 7) {
      const originalTt = JD_J2000 + day;
      const tdb = ttToTdb(originalTt);
      const recoveredTt = tdbToTt(tdb);
      const offsetS = (tdb - originalTt) * DAY_S;
      const expectedOffsetS = ttToTdbOffsetS(originalTt);
      expect(offsetS).toBeCloseTo(expectedOffsetS, 3);
      expect(Math.abs((recoveredTt - originalTt) * DAY_S)).toBeLessThan(0.1);
    }
  });

  it('preserves exact round-trip conversion between UTC and TDB', () => {
    const testJdUtc = 2461319.5;
    const jdTdb = utcToTdb(testJdUtc);
    const backJdUtc = tdbToUtc(jdTdb);
    expect(backJdUtc).toBeCloseTo(testJdUtc, 9);
  });

  it('verifies TCB - TDB rate scaling (L_B factor)', () => {
    const jdTdb = JD_J2000 + 10000;
    const jdTcb = tdbToTcb(jdTdb);
    const diffDays = jdTcb - jdTdb;
    expect(diffDays).toBeCloseTo(10000 * 1.550519768e-8, 7);
    expect(tcbToTdb(jdTcb)).toBeCloseTo(jdTdb, 7);
  });

  it('converts JavaScript Date to JD(UTC) and back faithfully', () => {
    const d = new Date('2026-10-06T12:00:00.000Z');
    const jd = dateToJdUtc(d);
    const dBack = jdUtcToDate(jd);
    expect(dBack.toISOString()).toBe(d.toISOString());
  });

  it('converts JavaScript Date (UTC) to JD(TDB) and back without day-level drift', () => {
    const d = new Date('2026-08-12T17:46:00.000Z');
    const jdTdb = dateToJd(d);
    const jdUtc = dateToJdUtc(d);
    expect(Math.abs((jdTdb - jdUtc) * DAY_S - 69.184)).toBeLessThan(0.002);
    expect(jdToDate(jdTdb).getTime()).toBe(d.getTime());
  });
});
