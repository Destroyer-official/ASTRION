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
});
