import { describe, it, expect } from 'vitest';
import {
  gmToInternal,
  GM_SUN_KM3_S2,
  kmsToAuDay,
  auDayToKms,
  jdToDate,
  dateToJd,
  TDB_MINUS_UTC_S,
  JD_UNIX_EPOCH,
  DAY_S,
} from '@/data/constants';

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
  it('UTC<->TDB round-trips exactly with the 69.184 s offset', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(TDB_MINUS_UTC_S).toBe(69.184);
    expect(jdToDate(dateToJd(d)).getTime()).toBe(d.getTime());
    const jdUnix = d.getTime() / (DAY_S * 1000) + JD_UNIX_EPOCH;
    expect(dateToJd(d) - jdUnix).toBeCloseTo(69.184 / DAY_S, 9); // ms precision limit
  });
});
