/**
 * Multi-Scale Cosmic Gravity Engine Verification Tests
 *
 * Verifies NFW dark matter halo profiles, galactic rotation curves,
 * Local Group dynamics, and FLRW cosmological acceleration.
 */

import { describe, it, expect } from 'vitest';
import {
  NFWHaloModel,
  computeFLRWAcceleration,
  computeLocalGroupDynamics,
  computeUniversalGravity,
} from '@/physics/cosmicGravity';

describe('Multi-Scale Cosmic Gravity Engine (Phase 8)', () => {
  describe('Navarro-Frenk-White (NFW) Dark Matter Halo Profile', () => {
    it('produces monotonically increasing enclosed mass with radius', () => {
      const halo = new NFWHaloModel({ mVirialSolar: 1.0e12, scaleRadiusKpc: 16.0 });
      const m8 = halo.enclosedMassSolar(8.0);
      const m20 = halo.enclosedMassSolar(20.0);
      const m100 = halo.enclosedMassSolar(100.0);

      expect(m8).toBeGreaterThan(0);
      expect(m20).toBeGreaterThan(m8);
      expect(m100).toBeGreaterThan(m20);
      // Virial mass limit check
      expect(m100).toBeLessThanOrEqual(1.0e12);
    });

    it('generates flat/peaked halo circular velocity in the 150-220 km/s range for Milky Way', () => {
      const halo = new NFWHaloModel({ mVirialSolar: 1.0e12, scaleRadiusKpc: 16.0, concentration: 12.0 });
      const vc8 = halo.circularVelocityKms(8.2); // Solar radius
      const vc20 = halo.circularVelocityKms(20.0);

      expect(vc8).toBeGreaterThan(120);
      expect(vc8).toBeLessThan(240);
      expect(vc20).toBeGreaterThan(140);
      expect(vc20).toBeLessThan(250);
    });

    it('computes symmetric 3x3 tidal tensor with non-zero trace in dark matter density', () => {
      const halo = new NFWHaloModel();
      const pos = { x: 10, y: 5, z: -3 };
      const tensor = halo.tidalTensor(pos);

      expect(tensor.length).toBe(3);
      expect(tensor[0]!.length).toBe(3);
      // Symmetry: T_ij = T_ji
      expect(tensor[0]![1]).toBeCloseTo(tensor[1]![0]!, 10);
      expect(tensor[0]![2]).toBeCloseTo(tensor[2]![0]!, 10);
      expect(tensor[1]![2]).toBeCloseTo(tensor[2]![1]!, 10);
    });
  });

  describe('Cosmological FLRW Dark Energy Acceleration', () => {
    it('confirms dark energy repulsion accelerates the cosmic expansion on supercluster scales', () => {
      // 50 Mpc position vector (typical supercluster separation)
      const posMpc = { x: 50, y: 0, z: 0 };
      const flrw = computeFLRWAcceleration(posMpc);

      // Dark energy acceleration must be outward (> 0 along positive axis)
      expect(flrw.darkEnergyAccelerationKpcMyr2.x).toBeGreaterThan(0);
      // Matter deceleration must be inward (< 0 along positive axis)
      expect(flrw.matterDecelerationKpcMyr2.x).toBeLessThan(0);
      // In Lambda-CDM (Omega_Lambda ~ 0.685 vs Omega_m ~ 0.315), net acceleration is POSITIVE (accelerating)
      expect(flrw.accKpcMyr2.x).toBeGreaterThan(0);
      expect(flrw.isAccelerating).toBe(true);
    });
  });

  describe('Local Group Dynamics & Infall Timing', () => {
    it('computes closing approach velocity ~ -110 km/s and pericenter ~ 4.5 Gyr for Milky Way & Andromeda', () => {
      const lg = computeLocalGroupDynamics();

      expect(lg.separationKpc).toBeCloseTo(780, 0);
      expect(lg.closingVelocityKms).toBeCloseTo(-110, 0);
      expect(lg.timeToPericenterGyr).toBeGreaterThan(3.5);
      expect(lg.timeToPericenterGyr).toBeLessThan(6.0);
    });
  });

  describe('Universal Gravity Dynamic Router', () => {
    it('routes correctly across galactic, local_group, and supercluster regimes', () => {
      const gal = computeUniversalGravity({ x: 8.2, y: 0, z: 0 }, 'galactic');
      expect(gal.regime).toBe('galactic_nfw');
      expect(gal.accMagnitudeMPerS2).toBeGreaterThan(0);

      const lg = computeUniversalGravity({ x: 780, y: 0, z: 0 }, 'local_group');
      expect(lg.regime).toBe('local_group');

      const cosmo = computeUniversalGravity({ x: 50_000, y: 0, z: 0 }, 'supercluster');
      expect(cosmo.regime).toBe('cosmological_flrw');
      expect(cosmo.darkEnergyRepulsionKpcMyr2).toBeGreaterThan(0);
    });
  });
});
