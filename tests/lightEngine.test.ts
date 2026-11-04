/**
 * Relativistic Light & Radiation Engine Verification Tests
 *
 * Verifies against canonical NASA/JPL astrometric standards, Einstein deflection,
 * and Planck cosmological measurements.
 */

import { describe, it, expect } from 'vitest';
import {
  solveLightTime,
  applyStellarAberration,
  removeStellarAberration,
  computeGravitationalLightDeflection,
  computeEinsteinRing,
  computeKinematicDoppler,
  computeGravitationalRedshift,
  computeCosmologicalRedshift,
  computeCompositeRedshift,
  computePhotometry,
  SPEED_OF_LIGHT_AU_DAY,
  SOLAR_CONSTANT_EARTH_W_M2,
  SOLAR_ABSOLUTE_MAGNITUDE_V,
} from '@/physics/light';
import { GM_SUN_KM3_S2, AU_KM, DAY_S, C_LIGHT_KMS as SPEED_OF_LIGHT_KMS } from '@/data/constants';

const GM_SUN_INTERNAL = (GM_SUN_KM3_S2 * (DAY_S * DAY_S)) / (AU_KM * AU_KM * AU_KM);

describe('Relativistic Light Engine (Phase 8)', () => {
  describe('Light-Time Retardation (JPL SPICE LT Standard)', () => {
    it('computes 1 AU light travel time to ~499.005 seconds (8.3167 minutes)', () => {
      const observer = { x: 0, y: 0, z: 0 };
      const targetState = {
        pos: { x: 1.0, y: 0, z: 0 }, // 1 AU away
        vel: { x: 0, y: 0, z: 0 },
      };

      const result = solveLightTime(observer, targetState);
      // 1 AU / c in seconds: 149597870.7 km / 299792.458 km/s = 499.00478 seconds
      expect(result.tauSeconds).toBeCloseTo(499.005, 2);
      expect(result.roundTripSeconds).toBeCloseTo(998.01, 2);
      expect(result.iterations).toBeLessThanOrEqual(2);
    });

    it('converges iteratively for moving targets with high line-of-sight velocity', () => {
      const observer = { x: 0, y: 0, z: 0 };
      // Target at 5 AU moving radially away at 0.01 c ~ 1.73 AU/day
      const targetState = {
        pos: { x: 5.0, y: 0, z: 0 },
        vel: { x: 0.01 * SPEED_OF_LIGHT_AU_DAY, y: 0, z: 0 },
      };

      const result = solveLightTime(observer, targetState);
      // Retarded distance is smaller than current 5.0 AU distance because it was emitted earlier
      expect(result.apparentDistanceAu).toBeLessThan(5.0);
      expect(result.apparentVector.x).toBeCloseTo(result.retardedPos.x, 6);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
      expect(result.iterations).toBeLessThanOrEqual(5);
    });
  });

  describe('Relativistic Stellar Aberration (IAU / SPICE LT+S Standard)', () => {
    it('produces canonical ~20.496 arcseconds aberration for Earth orbital speed (~29.78 km/s)', () => {
      // Light coming from perpendicular direction (e.g. ecliptic pole)
      const starDirection = { x: 0, y: 0, z: 1 };
      // Earth velocity vector: ~29.78 km/s in x direction
      // Convert km/s to AU/day: v_auday = v_kms * 86400 / 149597870.7
      const vEarthAuday = (29.78469 * 86400) / AU_KM;
      const observerVel = { x: vEarthAuday, y: 0, z: 0 };

      const result = applyStellarAberration(starDirection, observerVel);
      // Canonical Earth aberration constant kappa = 20.49552 arcseconds
      expect(result.displacementArcsec).toBeCloseTo(20.496, 1);
      expect(result.aberratedDirection.x).toBeGreaterThan(0); // Tilted into direction of motion
    });

    it('inverts aberration to recover original source direction to machine precision', () => {
      const raw = { x: 0.3, y: -0.5, z: 0.8124 };
      const len = Math.hypot(raw.x, raw.y, raw.z);
      const starDir = { x: raw.x / len, y: raw.y / len, z: raw.z / len };
      const obsVel = { x: 0.005, y: -0.012, z: 0.003 };

      const forward = applyStellarAberration(starDir, obsVel);
      const inverted = removeStellarAberration(forward.aberratedDirection, obsVel);

      expect(inverted.aberratedDirection.x).toBeCloseTo(starDir.x, 10);
      expect(inverted.aberratedDirection.y).toBeCloseTo(starDir.y, 10);
      expect(inverted.aberratedDirection.z).toBeCloseTo(starDir.z, 10);
    });
  });

  describe('General Relativistic Gravitational Lensing', () => {
    it('computes exact Einstein solar limb light deflection of ~1.751 arcseconds', () => {
      // Light passing at Sun's radius (solar limb: R_sun = 696,340 km)
      const rSunAu = 696340 / AU_KM;
      const rayOrigin = { x: -10, y: rSunAu, z: 0 };
      const rayTarget = { x: 10, y: rSunAu, z: 0 };
      const sunPos = { x: 0, y: 0, z: 0 };

      const result = computeGravitationalLightDeflection(rayOrigin, rayTarget, sunPos, GM_SUN_INTERNAL);

      // Einstein deflection formula: theta = 4 G M / (c^2 * R_sun) = 1.751 arcseconds
      expect(result.deflectionAngleArcsec).toBeCloseTo(1.751, 2);
      expect(result.isCaptured).toBe(false);
    });

    it('detects photon capture when ray passes inside the critical photon sphere (b <= b_crit)', () => {
      // Photon sphere radius r_ph = 3 GM / c^2
      // b_crit = sqrt(27)/2 * r_s ~ 2.598 r_s
      const rs = (2 * GM_SUN_INTERNAL) / (SPEED_OF_LIGHT_AU_DAY * SPEED_OF_LIGHT_AU_DAY);
      const bInside = 1.5 * rs; // Inside photon capture radius

      const rayOrigin = { x: -1, y: bInside, z: 0 };
      const rayTarget = { x: 1, y: bInside, z: 0 };
      const blackHolePos = { x: 0, y: 0, z: 0 };

      const result = computeGravitationalLightDeflection(rayOrigin, rayTarget, blackHolePos, GM_SUN_INTERNAL);
      expect(result.isCaptured).toBe(true);
    });

    it('computes Einstein ring radius for an aligned gravitational lens', () => {
      const dLens = 1000; // AU
      const dSource = 2000; // AU
      const result = computeEinsteinRing(GM_SUN_INTERNAL, dLens, dSource);

      expect(result.thetaEArcsec).toBeGreaterThan(0);
      expect(result.physicalRadiusAu).toBeCloseTo(result.thetaERad * dLens, 8);
    });
  });

  describe('Multi-Component Relativistic Redshift', () => {
    it('computes kinematic Doppler shift matching special relativity', () => {
      const los = { x: 1, y: 0, z: 0 };
      // Target receding at 0.1 c
      const relVel = { x: 0.1 * SPEED_OF_LIGHT_AU_DAY, y: 0, z: 0 };

      const kin = computeKinematicDoppler(relVel, los);
      // Exact relativistic formula: 1 + z = sqrt((1 + beta) / (1 - beta))
      // For beta = 0.1: sqrt(1.1 / 0.9) ~ 1.1055416 -> z ~ 0.1055416
      expect(kin.zKin).toBeCloseTo(0.10554, 4);
      expect(kin.vRadialKms).toBeCloseTo(0.1 * SPEED_OF_LIGHT_KMS, 1);
    });

    it('computes solar surface gravitational redshift (~2.11e-6, ~633 m/s observed at 1 AU)', () => {
      const rSunAu = 696340 / AU_KM;
      const rEarthAu = 1.0;
      const zGrav = computeGravitationalRedshift(GM_SUN_INTERNAL, rSunAu, rEarthAu);

      // Theoretical net: GM / (c^2 * R_sun) - GM / (c^2 * 1 AU) ~ 2.1107e-6
      expect(zGrav).toBeCloseTo(2.11e-6, 7);
      // Equivalent Doppler speed = z * c ~ 2.1107e-6 * 299792.458 km/s ~ 0.6328 km/s = 632.8 m/s
      const vEquivMPerS = zGrav * SPEED_OF_LIGHT_KMS * 1000;
      expect(vEquivMPerS).toBeCloseTo(632.8, 0);
    });

    it('computes cosmological expansion redshift matching Hubble-Lemaître law', () => {
      // At 100 Mpc, v_H = 67.4 km/s/Mpc * 100 Mpc = 6740 km/s
      // z ~ v_H / c ~ 6740 / 299792.458 ~ 0.02248
      const zCosmo = computeCosmologicalRedshift(100);
      expect(zCosmo).toBeCloseTo(0.0225, 3);
    });

    it('multiplicatively composites all redshift components', () => {
      const res = computeCompositeRedshift({
        relativeVelAUPerDay: { x: 0.01 * SPEED_OF_LIGHT_AU_DAY, y: 0, z: 0 },
        lineOfSightUnit: { x: 1, y: 0, z: 0 },
        gmInternal: GM_SUN_INTERNAL,
        rEmitAu: 696340 / AU_KM,
        rObsAu: 1.0,
        distanceMpc: 10,
      });

      // 1 + z_total = (1 + z_kin) * (1 + z_grav) * (1 + z_cosmo)
      const expected = (1 + res.zKinematic) * (1 + res.zGravitational) * (1 + res.zCosmological) - 1;
      expect(res.zTotal).toBeCloseTo(expected, 8);
    });
  });

  describe('Universal Radiometric Photometry & Flux', () => {
    it('computes Earth solar constant ~1361 W/m^2 and apparent magnitude ~ -26.74 at 1 AU', () => {
      const phot = computePhotometry({
        distanceAu: 1.0,
        luminositySolar: 1.0,
        absoluteMagnitude: SOLAR_ABSOLUTE_MAGNITUDE_V,
      });

      expect(phot.fluxWattsPerM2).toBeCloseTo(SOLAR_CONSTANT_EARTH_W_M2, -1);
      expect(phot.relativeFluxSunEarth).toBeCloseTo(1.0, 1);
      expect(phot.apparentMagnitude).toBeCloseTo(-26.74, 1);
    });

    it('confirms that at standard 10 parsecs, apparent magnitude equals absolute magnitude (m = M)', () => {
      const tenParsecsAu = 10 * 206264.806;
      const phot = computePhotometry({
        distanceAu: tenParsecsAu,
        absoluteMagnitude: 4.83,
      });

      // By definition of absolute magnitude, at d = 10 pc: m = M
      expect(phot.apparentMagnitude).toBeCloseTo(4.83, 2);
      expect(phot.distanceModulus).toBeCloseTo(0, 2);
    });
  });
});
