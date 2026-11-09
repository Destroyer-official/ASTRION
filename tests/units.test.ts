import { describe, it, expect } from 'vitest';
import {
  gmToInternal,
  GM_SUN_KM3_S2,
  kmsToAuDay,
  auDayToKms,
  JD_UNIX_EPOCH,
  DAY_S,
} from '@/data/constants';
import { dateToJd, jdToDate } from '@/physics/time';
import {
  asAu,
  asKm,
  asKmPerSec,
  asAuPerDay,
  asDegree,
  asDay,
  kmToAuTyped,
  auToKmTyped,
  kmsToAuDayTyped,
  auDayToKmsTyped,
  degToRadTyped,
  radToDegTyped,
  daysToSecondsTyped,
  secondsToDaysTyped,
} from '@/physics/units';

describe('units', () => {
  it('Sun GM matches the Gaussian constant k^2 to ~1e-8 relative', () => {
    const k2 = 0.01720209895 ** 2;
    expect(Math.abs(gmToInternal(GM_SUN_KM3_S2) - k2) / k2).toBeLessThan(1e-8);
  });
  it('Earth orbital speed ~29.78 km/s is ~0.0172 AU/day', () => {
    expect(kmsToAuDay(29.78)).toBeCloseTo(0.0172, 4);
  });
  it('velocity conversion round-trips', () => {
    expect(auDayToKms(kmsToAuDay(12.3456))).toBeCloseTo(12.3456, 12);
  });
  it('UTC<->TDB round-trips through the full TAI/TT/TDB model', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const jd = dateToJd(d);
    const jdUnix = d.getTime() / (DAY_S * 1000) + JD_UNIX_EPOCH;
    const offsetMs = (jd - jdUnix) * DAY_S * 1000;

    expect(offsetMs).toBeGreaterThan(69_182.5);
    expect(offsetMs).toBeLessThan(69_185.5);
    expect(Math.abs(jdToDate(jd).getTime() - d.getTime())).toBeLessThan(1);
  });

  describe('Branded Dimensional Units (AUDIT-15, §2.10)', () => {
    it('accurately converts between branded Au and Km', () => {
      const oneAu = asAu(1.0);
      const inKm = auToKmTyped(oneAu);
      expect(inKm).toBe(149_597_870.7);

      const oneKm = asKm(149_597_870.7);
      const roundTripAu = kmToAuTyped(oneKm);
      expect(roundTripAu).toBe(1.0);
    });

    it('accurately converts between branded KmPerSec and AuPerDay', () => {
      const speedKms = asKmPerSec(29.78);
      const speedAuDay = kmsToAuDayTyped(speedKms);
      expect(speedAuDay).toBeCloseTo(0.0172, 4);

      const typedSpeedAuDay = asAuPerDay(speedAuDay);
      const backKms = auDayToKmsTyped(typedSpeedAuDay);
      expect(backKms).toBeCloseTo(29.78, 12);
    });

    it('accurately converts between branded Degree and Radian', () => {
      const deg180 = asDegree(180);
      const rad = degToRadTyped(deg180);
      expect(rad).toBe(Math.PI);

      const backDeg = radToDegTyped(rad);
      expect(backDeg).toBe(180);
    });

    it('accurately converts between branded Day and Second', () => {
      const oneDay = asDay(1.0);
      const sec = daysToSecondsTyped(oneDay);
      expect(sec).toBe(86400);

      const backDay = secondsToDaysTyped(sec);
      expect(backDay).toBe(1.0);
    });
  });
});
