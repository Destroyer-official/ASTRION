import { describe, it, expect } from 'vitest';
import {
  AtmosphericDrag,
  getAtmosphericDensity,
  EARTH_ATMOSPHERE_LAYERS,
  MS2_TO_AU_DAY2,
} from '@/physics/forces/drag';
import { createState } from '@/physics/system';
import { AU_KM } from '@/data/constants';

describe('Planetary Atmospheric Drag Force Model', () => {
  it('evaluates US Standard Atmosphere 1976 densities accurately', () => {
    // Sea level: 1.225 kg/m^3
    expect(getAtmosphericDensity(0, EARTH_ATMOSPHERE_LAYERS)).toBeCloseTo(1.225, 3);

    // 100 km (Kármán line): ~5.3e-7 kg/m^3
    const rho100 = getAtmosphericDensity(100, EARTH_ATMOSPHERE_LAYERS);
    expect(rho100).toBeGreaterThan(1e-7);
    expect(rho100).toBeLessThan(1e-6);

    // 400 km (ISS altitude): ~2.8e-12 kg/m^3
    const rho400 = getAtmosphericDensity(400, EARTH_ATMOSPHERE_LAYERS);
    expect(rho400).toBeGreaterThan(1e-12);
    expect(rho400).toBeLessThan(5e-12);
  });

  it('correctly decelerates a LEO satellite at 300 km altitude', () => {
    const earthRadiusKm = 6378.137;
    const altKm = 300;
    const rAu = (earthRadiusKm + altKm) / AU_KM;

    // Orbital speed at 300 km: v = sqrt(GM / r) ≈ 7.73 km/s
    const vKms = 7.726;
    const vAuDay = (vKms * 86400) / AU_KM;

    const drag = new AtmosphericDrag({
      name: 'Earth',
      hostIndex: 0,
      radiusKm: earthRadiusKm,
      layers: EARTH_ATMOSPHERE_LAYERS,
      omegaRadPerDay: 2 * Math.PI,
      pole: () => [0, 0, 1],
    });

    // Spacecraft: 1000 kg, 10 m^2, Cd = 2.2
    const massKg = 1000;
    const areaM2 = 10;
    const cd = 2.2;
    drag.setTarget(1, { areaM2, massKg, cd });

    const s = createState([
      { id: 'earth', name: 'Earth', gm: 1.0, radiusKm: earthRadiusKm, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'sat', name: 'Satellite', gm: 0, radiusKm: 1, position: [rAu, 0, 0], velocity: [0, vAuDay, 0] },
    ]);

    const acc = new Float64Array(6);
    drag.apply(s, acc);

    // Deceleration must oppose velocity (negative along Y)
    expect(acc[4]).toBeLessThan(0);
    // Radial deceleration should be 0 (tangential drag)
    expect(acc[3]).toBeCloseTo(0, 10);
    expect(acc[5]).toBeCloseTo(0, 10);

    // Verify magnitude against theoretical formula
    // v_atm at equator: w * r = 2*pi * (6678 km) / 86400 s ≈ 0.485 km/s
    const vAtmM = (2 * Math.PI * (earthRadiusKm + altKm) * 1000) / 86400;
    const vRelM = vKms * 1000 - vAtmM;
    const rho = getAtmosphericDensity(altKm, EARTH_ATMOSPHERE_LAYERS);
    const expectedDragMs2 = 0.5 * cd * (areaM2 / massKg) * rho * vRelM * vRelM;
    const expectedDragAuDay2 = expectedDragMs2 * MS2_TO_AU_DAY2;

    expect(Math.abs(acc[4]!)).toBeCloseTo(expectedDragAuDay2, 10);
  });
});
