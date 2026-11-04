import { describe, it, expect } from 'vitest';
import {
  sphereOfInfluence,
  PLANET_SOI_AU,
  analyzeFlyby,
  maxTurnAngle,
  analyzeVInfinity,
  evaluateSequence,
  tisserandParameter,
} from '@/physics/flyby';
import { AU_KM } from '@/data/constants';
import type { Vec3 } from '@/physics/types';

describe('Patched Conic Gravity Assist & SOI Framework', () => {
  // GM values in AU³/day²
  const GM_SUN = 0.2959122082855911e-3;
  const GM_EARTH = 3.986004418e5 * (86400 * 86400) / (AU_KM * AU_KM * AU_KM);
  const GM_JUPITER = 1.26686534e8 * (86400 * 86400) / (AU_KM * AU_KM * AU_KM);

  // Earth radius in AU
  const R_EARTH_KM = 6378.137;
  const R_EARTH_AU = R_EARTH_KM / AU_KM;

  // Jupiter radius in AU
  const R_JUPITER_KM = 71492;
  const R_JUPITER_AU = R_JUPITER_KM / AU_KM;

  describe('Sphere of Influence (SOI)', () => {
    it('computes Laplace SOI for Earth matching standard reference (~925,000 km)', () => {
      const aEarth = 1.0; // 1 AU
      const rSoiAu = sphereOfInfluence(aEarth, GM_EARTH, GM_SUN);
      const rSoiKm = rSoiAu * AU_KM;

      // Earth SOI is ~924,000 to 925,000 km
      expect(rSoiKm).toBeGreaterThan(900_000);
      expect(rSoiKm).toBeLessThan(950_000);
      expect(rSoiAu).toBeCloseTo(PLANET_SOI_AU.earth!, 3);
    });

    it('computes Laplace SOI for Jupiter matching standard reference (~48 million km)', () => {
      const aJupiter = 5.2044; // AU
      const rSoiAu = sphereOfInfluence(aJupiter, GM_JUPITER, GM_SUN);
      const rSoiKm = rSoiAu * AU_KM;

      // Jupiter SOI is ~48.2 million km (0.32 AU)
      expect(rSoiKm).toBeGreaterThan(45_000_000);
      expect(rSoiKm).toBeLessThan(52_000_000);
      expect(rSoiAu).toBeCloseTo(PLANET_SOI_AU.jupiter!, 2);
    });

    it('precomputed PLANET_SOI_AU dictionary covers all 8 major planets', () => {
      const planets = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
      for (const p of planets) {
        expect(PLANET_SOI_AU[p]).toBeDefined();
        expect(PLANET_SOI_AU[p]!).toBeGreaterThan(0);
      }
    });
  });

  describe('Patched-conic flyby analysis', () => {
    it('accurately resolves hyperbolic flyby kinematics and energy conservation', () => {
      // Planet moving at 30 km/s along +y (approx Earth orbit)
      const vKms = 29.78;
      const vScale = 86400 / AU_KM;
      const vPlanet: Vec3 = [0, vKms * vScale, 0];

      // Incoming spacecraft: v_inf = 5 km/s along +x relative to planet
      const vInfKms = 5.0;
      const vHelioIn: Vec3 = [vInfKms * vScale, vPlanet[1], 0];

      // Outgoing spacecraft deflected by 60° in the x-y plane
      const theta = (60 * Math.PI) / 180;
      const vHelioOut: Vec3 = [
        vInfKms * Math.cos(theta) * vScale,
        vPlanet[1] + vInfKms * Math.sin(theta) * vScale,
        0,
      ];

      const result = analyzeFlyby(vHelioIn, vHelioOut, vPlanet, GM_EARTH, R_EARTH_AU);

      // Turn angle should be 60° (π/3 rad)
      expect(result.turnAngle).toBeCloseTo(Math.PI / 3, 5);

      // v_∞ magnitude should match input (5 km/s)
      const vInfResultKms = result.vInfMag / vScale;
      expect(vInfResultKms).toBeCloseTo(5.0, 5);

      // Eccentricity: e = 1 / sin(δ/2) = 1 / sin(30°) = 2.0
      expect(result.eccentricity).toBeCloseTo(2.0, 5);

      // Periapsis speed: v_p = sqrt(v_∞² + 2μ/rp)
      const expectedVp = Math.sqrt(
        result.vInfMag * result.vInfMag + (2 * GM_EARTH) / result.periapsisRadius,
      );
      expect(result.periapsisSpeed).toBeCloseTo(expectedVp, 8);

      // Periapsis altitude = rp - R_Earth
      expect(result.periapsisAltitude).toBeCloseTo(result.periapsisRadius - R_EARTH_AU, 10);
    });

    it('identifies gravity assist velocity gain (Δv)', () => {
      const vScale = 86400 / AU_KM;
      const vPlanet: Vec3 = [0, 13.06 * vScale, 0]; // Jupiter approx orbital velocity

      // Spacecraft incoming at 10 km/s relative to Jupiter
      const vHelioIn: Vec3 = [10.0 * vScale, (13.06 - 5.0) * vScale, 0];
      // Deflected forward in Jupiter orbital direction (adds heliocentric energy)
      const vHelioOut: Vec3 = [0, (13.06 + 10.0) * vScale, 0];

      const result = analyzeFlyby(vHelioIn, vHelioOut, vPlanet, GM_JUPITER, R_JUPITER_AU);

      // Spacecraft gained speed in heliocentric frame
      const vInMag = Math.hypot(vHelioIn[0], vHelioIn[1], vHelioIn[2]);
      const vOutMag = Math.hypot(vHelioOut[0], vHelioOut[1], vHelioOut[2]);
      expect(vOutMag).toBeGreaterThan(vInMag);
      expect(result.deltaVMag).toBeGreaterThan(0);
    });
  });

  describe('Maximum turn angle & V-infinity characteristics', () => {
    it('computes maximum achievable turn angle given minimum safe periapsis', () => {
      const vScale = 86400 / AU_KM;
      const vInf = 10.0 * vScale; // 10 km/s
      const minAltAu = 500 / AU_KM; // 500 km safe altitude above Earth

      const deltaMax = maxTurnAngle(GM_EARTH, vInf, minAltAu, R_EARTH_AU);
      const deltaMaxDeg = (deltaMax * 180) / Math.PI;

      // For Earth at 10 km/s and 500 km altitude, e ≈ 2.726, δ ≈ 43.05°
      expect(deltaMaxDeg).toBeGreaterThan(30);
      expect(deltaMaxDeg).toBeLessThan(55);
      expect(deltaMaxDeg).toBeCloseTo(43.05, 1);
    });

    it('v-infinity analysis calculates C3 and speeds in both AU/day and km/s', () => {
      const vScale = 86400 / AU_KM;
      const vPlanet: Vec3 = [0, 30.0 * vScale, 0];
      const vSc: Vec3 = [0, 35.0 * vScale, 0]; // 5 km/s excess

      const minAltAu = 300 / AU_KM;
      const analysis = analyzeVInfinity(vSc, vPlanet, GM_EARTH, R_EARTH_AU, minAltAu);

      // v_inf is 5 km/s
      expect(analysis.vInfKms).toBeCloseTo(5.0, 4);

      // C3 = v_inf² = 25 km²/s²
      expect(analysis.C3kms).toBeCloseTo(25.0, 4);

      // Periapsis speed exceeds parabolic escape speed
      const vEscape = Math.sqrt((2 * GM_EARTH) / (R_EARTH_AU + minAltAu));
      expect(analysis.vPeriapsis).toBeGreaterThan(vEscape);
    });
  });

  describe('Tisserand Parameter & Sequence Evaluation', () => {
    it('computes Tisserand parameter correctly for circular orbit', () => {
      // Spacecraft in circular orbit identical to planet: a = a_p, e = 0, i = 0
      // T = a_p/a_p + 2 * cos(0) * sqrt(1 * 1) = 1 + 2 = 3.0
      const T = tisserandParameter(1.0, 1.0, 0, 0);
      expect(T).toBeCloseTo(3.0, 10);
    });

    it('Tisserand parameter matches Jupiter-family comet criteria (2 < T_J < 3)', () => {
      // Typical Jupiter family comet: a = 3.5 AU, e = 0.55, i = 15°
      const aJupiter = 5.2044;
      const iRad = (15 * Math.PI) / 180;
      const T = tisserandParameter(aJupiter, 3.5, 0.55, iRad);

      expect(T).toBeGreaterThan(2.0);
      expect(T).toBeLessThan(3.0);
    });

    it('returns NaN for parabolic/hyperbolic orbits (e >= 1)', () => {
      expect(Number.isNaN(tisserandParameter(1.0, 1.0, 1.0, 0))).toBe(true);
      expect(Number.isNaN(tisserandParameter(1.0, 1.0, 1.2, 0))).toBe(true);
    });

    it('evaluates multi-leg flyby sequence summing departure v_∞', () => {
      const legs = [
        { from: 'Earth', to: 'Venus', tof: 145, vInfDepart: 0.002, vInfArrive: 0.003, C3Depart: 15 },
        { from: 'Venus', to: 'Earth', tof: 220, vInfDepart: 0.003, vInfArrive: 0.004, C3Depart: 25 },
        { from: 'Earth', to: 'Jupiter', tof: 700, vInfDepart: 0.004, vInfArrive: 0.006, C3Depart: 40 },
      ];

      const seq = evaluateSequence(legs);
      expect(seq.totalDeltaV).toBeCloseTo(0.002 + 0.003 + 0.004, 10);
      expect(seq.legs.length).toBe(3);
    });
  });
});
