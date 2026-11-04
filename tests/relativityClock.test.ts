import { describe, it, expect } from 'vitest';
import { computeClockDriftRate, integrateProperTime } from '@/physics/relativityClock';
import { gmToInternal, kmToAu, kmsToAuDay } from '@/data/constants';

describe('General Relativistic Clock Drift & Proper Time Dilation', () => {
  // Physical parameters
  const GM_EARTH_KM3_S2 = 398600.4418;
  const R_EARTH_KM = 6378.137;
  const GM_EARTH = gmToInternal(GM_EARTH_KM3_S2);

  it('accurately reproduces the canonical GPS clock drift benchmark (+38.6 us/day)', () => {
    // GPS orbit: circular orbit at h = 20,200 km -> r = 26,578 km
    const rGpsKm = 26578.137;
    const vGpsKms = Math.sqrt(GM_EARTH_KM3_S2 / rGpsKm); // ~3.874 km/s

    const posGps: [number, number, number] = [kmToAu(rGpsKm), 0, 0];
    const velGps: [number, number, number] = [0, kmsToAuDay(vGpsKms), 0];

    // Earth surface ground station clock
    const posGround: [number, number, number] = [kmToAu(R_EARTH_KM), 0, 0];
    // Rotational speed at equator: 2*pi*R / 86164s ≈ 0.465 km/s
    const vGroundKms = (2 * Math.PI * R_EARTH_KM) / 86164.1;
    const velGround: [number, number, number] = [0, kmsToAuDay(vGroundKms), 0];

    const bodyGms = [GM_EARTH];
    const bodyPositions: [number, number, number][] = [[0, 0, 0]]; // Earth at origin

    const gpsDrift = computeClockDriftRate(posGps, velGps, bodyGms, bodyPositions);
    const groundDrift = computeClockDriftRate(posGround, velGround, bodyGms, bodyPositions);

    // Difference between satellite clock and ground clock (Ashby 2003 canonical standard: ~ +38.6 us/day)
    const relativeDriftUsDay = gpsDrift.driftMicrosPerDay - groundDrift.driftMicrosPerDay;

    // Standard expected value in literature is +38.6 us/day (+45.8 us/day gravitational - 7.2 us/day kinematic)
    expect(relativeDriftUsDay).toBeGreaterThan(38.0);
    expect(relativeDriftUsDay).toBeLessThan(39.2);

    // Gravitational component alone must be blueshifted (+45 to +46 us/day)
    const relGravUsDay = gpsDrift.gravitationalMicrosPerDay - groundDrift.gravitationalMicrosPerDay;
    expect(relGravUsDay).toBeGreaterThan(45.0);
    expect(relGravUsDay).toBeLessThan(46.5);

    // Kinematic component alone must be redshifted (-7.0 to -7.3 us/day)
    const relKinUsDay = gpsDrift.kinematicMicrosPerDay - groundDrift.kinematicMicrosPerDay;
    expect(relKinUsDay).toBeLessThan(-6.5);
    expect(relKinUsDay).toBeGreaterThan(-7.5);
  });

  it('integrates cumulative proper time dilation over mission duration', () => {
    // 365.25 days of GPS clock running at +38.6 us/day
    const dailyRate = 38.6e-6 / 86400; // dimensionless fraction
    const rates = new Array(365).fill(dailyRate);
    const dtDays = new Array(365).fill(1.0);

    const cumulativeDeltaSeconds = integrateProperTime(rates, dtDays);

    // 365 * 38.6 us ≈ 14.089 milliseconds
    expect(cumulativeDeltaSeconds).toBeCloseTo(0.014089, 4);
  });
});
