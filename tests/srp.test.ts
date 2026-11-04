import { describe, it, expect } from 'vitest';
import { SolarRadiationPressure, computeShadowFactor, P_SRP_AU } from '@/physics/forces/srp';
import { createState } from '@/physics/system';
import { AU_KM, SUN_RADIUS_KM } from '@/data/constants';
import type { Vec3 } from '@/physics/types';

describe('Solar Radiation Pressure (SRP) & Conical Shadow Model', () => {
  it('computes exact SRP acceleration magnitude at 1 AU', () => {
    // 1000 kg spacecraft, 10 m^2 solar array, Cr = 1.2
    const massKg = 1000;
    const areaM2 = 10;
    const cr = 1.2;

    const srp = new SolarRadiationPressure(0);
    srp.setTarget(1, { areaM2, massKg, cr });

    // Sun at origin, craft at 1 AU on X axis
    const s = createState([
      { id: 'sun', name: 'Sun', gm: 1.0, radiusKm: SUN_RADIUS_KM, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'sc', name: 'Spacecraft', gm: 0, radiusKm: 1, position: [1.0, 0, 0], velocity: [0, 0, 0] },
    ]);

    const acc = new Float64Array(6);
    srp.apply(s, acc);

    // Expected acc = P_SRP_AU * Cr * (A/m) / 1.0^2
    const expectedAcc = P_SRP_AU * cr * (areaM2 / massKg);
    expect(acc[3]).toBeCloseTo(expectedAcc, 12);
    expect(acc[4]).toBe(0);
    expect(acc[5]).toBe(0);
  });

  it('correctly predicts total shadow (umbra) behind an occulting planet', () => {
    const sunPos: Vec3 = [0, 0, 0];
    const earthRadiusKm = 6378.137;
    // Earth at 1.0 AU along X
    const earthPos: Vec3 = [1.0, 0, 0];
    // Spacecraft at 400 km altitude on the night side (1.0 AU + (6778 km in AU))
    const leoOffsetAu = 6778.137 / AU_KM;
    const scNight: Vec3 = [1.0 + leoOffsetAu, 0, 0];

    const shadowNight = computeShadowFactor(scNight, sunPos, earthPos, earthRadiusKm);
    expect(shadowNight).toBe(0.0); // Total umbra

    // Spacecraft on the daylight side (1.0 AU - 6778 km in AU)
    const scDay: Vec3 = [1.0 - leoOffsetAu, 0, 0];
    const shadowDay = computeShadowFactor(scDay, sunPos, earthPos, earthRadiusKm);
    expect(shadowDay).toBe(1.0); // Full sunlight
  });

  it('correctly models partial shadow (penumbra) on the limb', () => {
    const sunPos: Vec3 = [0, 0, 0];
    const earthRadiusKm = 6378.137;
    const earthPos: Vec3 = [1.0, 0, 0];

    // Position spacecraft behind Earth, aligned right on Earth's apparent limb
    const dNight = 20000 / AU_KM; // 20,000 km behind Earth
    const yShift = earthRadiusKm / AU_KM;
    const scLimb: Vec3 = [1.0 + dNight, yShift, 0];

    const shadowLimb = computeShadowFactor(scLimb, sunPos, earthPos, earthRadiusKm);
    expect(shadowLimb).toBeGreaterThan(0.0);
    expect(shadowLimb).toBeLessThan(1.0);
  });
});
