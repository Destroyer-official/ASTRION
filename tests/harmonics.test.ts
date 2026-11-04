import { describe, it, expect } from 'vitest';
import { SphericalHarmonics } from '@/physics/forces/harmonics';
import { createState } from '@/physics/system';
import { kmToAu } from '@/data/constants';
import type { Vec3 } from '@/physics/types';

describe('High-Order Spherical Gravitational Harmonics (J2, J3, J4, C22, S22)', () => {
  const hostRadiusKm = 6378.137; // Earth
  const gmHost = 1.0;
  const pole = (_t: number): Vec3 => [0, 0, 1];
  const primeMeridian = (_t: number): Vec3 => [1, 0, 0];

  it('matches J2 quadrupole formula with high fidelity', () => {
    const j2 = 1.08263e-3;
    const model = new SphericalHarmonics({
      hostIndex: 0,
      radiusKm: hostRadiusKm,
      j2,
      pole,
    });

    // Body at equator (r = 7000 km along X)
    const rAu = kmToAu(7000);
    const s = createState([
      { id: 'earth', name: 'Earth', gm: gmHost, radiusKm: hostRadiusKm, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'sat', name: 'Satellite', gm: 1e-12, radiusKm: 1, position: [rAu, 0, 0], velocity: [0, 0, 0] },
    ]);

    const acc = new Float64Array(6);
    model.apply(s, acc);

    // At equator (s = 0): ax = -1.5 * gm * J2 * R^2 / r^4
    const R = kmToAu(hostRadiusKm);
    const expectedAx = (-1.5 * gmHost * j2 * (R * R)) / (rAu * rAu * rAu * rAu);
    expect(acc[3]).toBeCloseTo(expectedAx, 12);
  });

  it('verifies J3 pear-shaped asymmetry between northern and southern hemispheres', () => {
    const j3 = -2.532e-6; // Earth pear harmonic
    const model = new SphericalHarmonics({
      hostIndex: 0,
      radiusKm: hostRadiusKm,
      j3,
      pole,
    });

    const rAu = kmToAu(7000);
    const zAu = kmToAu(4000);
    // Northern satellite (z > 0)
    const sNorth = createState([
      { id: 'earth', name: 'Earth', gm: gmHost, radiusKm: hostRadiusKm, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'sat', name: 'Satellite', gm: 1e-12, radiusKm: 1, position: [rAu, 0, zAu], velocity: [0, 0, 0] },
    ]);
    const accNorth = new Float64Array(6);
    model.apply(sNorth, accNorth);

    // Southern satellite (z < 0)
    const sSouth = createState([
      { id: 'earth', name: 'Earth', gm: gmHost, radiusKm: hostRadiusKm, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'sat', name: 'Satellite', gm: 1e-12, radiusKm: 1, position: [rAu, 0, -zAu], velocity: [0, 0, 0] },
    ]);
    const accSouth = new Float64Array(6);
    model.apply(sSouth, accSouth);

    // Because J3 is an odd harmonic (sin^3 phi), az is asymmetric!
    expect(accNorth[5]).not.toBeCloseTo(-accSouth[5]!, 10);
    expect(Math.abs(accNorth[5]!)).toBeGreaterThan(0);
    expect(Math.abs(accSouth[5]!)).toBeGreaterThan(0);
  });

  it('verifies C22 equatorial triaxiality creates longitudinal accelerations', () => {
    const c22 = 1.57e-6;
    const model = new SphericalHarmonics({
      hostIndex: 0,
      radiusKm: hostRadiusKm,
      c22,
      pole,
      primeMeridian,
    });

    // Satellite at 45 degree longitude (x = y = r / sqrt(2))
    const rAu = kmToAu(42164); // Geostationary altitude
    const xy = rAu / Math.SQRT2;
    const s = createState([
      { id: 'earth', name: 'Earth', gm: gmHost, radiusKm: hostRadiusKm, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'geo', name: 'GeoSat', gm: 1e-12, radiusKm: 1, position: [xy, xy, 0], velocity: [0, 0, 0] },
    ]);

    const acc = new Float64Array(6);
    model.apply(s, acc);

    // C22 creates a tangential force pulling satellite toward the minor equatorial axis
    expect(Math.abs(acc[3]!)).toBeGreaterThan(0);
    expect(Math.abs(acc[4]!)).toBeGreaterThan(0);
  });

  it('conserves total system momentum via host reaction', () => {
    const model = new SphericalHarmonics({
      hostIndex: 0,
      radiusKm: hostRadiusKm,
      j2: 1e-3,
      j3: 1e-5,
      j4: 1e-5,
      pole,
    });

    const s = createState([
      { id: 'earth', name: 'Earth', gm: 1.0, radiusKm: hostRadiusKm, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'sat', name: 'Sat', gm: 0.1, radiusKm: 1, position: [kmToAu(8000), kmToAu(2000), kmToAu(3000)], velocity: [0, 0, 0] },
    ]);

    const acc = new Float64Array(6);
    model.apply(s, acc);

    // Total force sum = m1*a1 + m2*a2 = 0
    for (let k = 0; k < 3; k++) {
      const totalForceK = s.gm[0]! * acc[k]! + s.gm[1]! * acc[3 + k]!;
      expect(Math.abs(totalForceK)).toBeLessThan(1e-15);
    }
  });
});
