/**
 * Universe Physics Master Backbone & Scale Engine Tests
 *
 * Verifies unified master backbone evaluation, scale-hierarchical dual-anchor
 * coordinate precision across 30 orders of magnitude, and dynamic plugin extensibility.
 */

import { describe, it, expect } from 'vitest';
import {
  universeBackbone,
  type UniversePhysicsPlugin,
} from '@/universe/universePhysicsBackbone';
import {
  createUniversalCoordinate,
  computeCosmicSeparation,
  transformToAnchorFrame,
  METERS_PER_AU,
} from '@/universe/cosmicScaleEngine';
import { GM_SUN_KM3_S2, AU_KM, DAY_S } from '@/data/constants';

const GM_SUN_INTERNAL = (GM_SUN_KM3_S2 * (DAY_S * DAY_S)) / (AU_KM * AU_KM * AU_KM);

describe('Universe Physics Master Backbone (Phase 8)', () => {
  describe('Scale-Hierarchical Dual-Anchor Coordinates (Float64 Precision Guard)', () => {
    it('preserves sub-millimeter precision between two local objects even at cosmological distances', () => {
      // Anchor placed at 50 million light-years away (Virgo Supercluster scale)
      const distantAnchorGlobalLy = { x: 50_000_000, y: 0, z: 0 };

      // Spacecraft A: at anchor origin (0 meters offset)
      const spacecraftA = createUniversalCoordinate(
        'm87_core',
        'supercluster',
        distantAnchorGlobalLy,
        { x: 0, y: 0, z: 0 },
      );

      // Spacecraft B: 1.5 meters away along X axis (docking maneuver)
      const spacecraftB = createUniversalCoordinate(
        'm87_core',
        'supercluster',
        distantAnchorGlobalLy,
        { x: 1.5, y: 0, z: 0 },
      );

      // Compute separation
      const sep = computeCosmicSeparation(spacecraftA, spacecraftB);

      // In a flat float64 system at 50 Mly, a 1.5-meter difference is completely wiped out by float precision.
      // In our dual-anchor architecture, local precision is exact to 1.5 meters!
      expect(sep.separationMeters).toBeCloseTo(1.5, 4);
      expect(sep.unitDirectionAtoB.x).toBeCloseTo(1.0, 10);
    });

    it('transforms coordinates into arbitrary target anchor frames accurately', () => {
      const sunGlobalLy = { x: 0, y: 0, z: 0 };
      const earthGlobalLy = { x: 1 / 63241.077, y: 0, z: 0 }; // ~1 AU in light-years

      // Moon placed 384,400 km from Earth
      const moonCoord = createUniversalCoordinate(
        'earth',
        'satellite_system',
        earthGlobalLy,
        { x: 384_400_000, y: 0, z: 0 },
      );

      // Transform to Earth anchor frame (same anchor -> direct meter recovery)
      const relEarth = transformToAnchorFrame(moonCoord, 'earth', earthGlobalLy);
      expect(relEarth.x).toBeCloseTo(384_400_000, 2);

      // Transform to Sun anchor frame (inter-anchor transformation)
      const relSun = transformToAnchorFrame(moonCoord, 'sun', sunGlobalLy);
      // Expected: Earth distance from Sun (~1 AU = 1.496e11 m) + 384,400,000 m
      expect(relSun.x).toBeGreaterThan(1.49e11);
    });

    it('evaluates cosmological metric distance measures (comoving, luminosity, angular diameter)', () => {
      const originLy = { x: 0, y: 0, z: 0 };
      const quasarLy = { x: 3_261_563.8 * 100, y: 0, z: 0 }; // 100 Mpc away

      const coordA = createUniversalCoordinate('milky_way', 'galaxy', originLy);
      const coordB = createUniversalCoordinate('quasar_3c273', 'supercluster', quasarLy);

      const z = 0.158; // Redshift of 3C 273
      const sep = computeCosmicSeparation(coordA, coordB, z);

      expect(sep.separationMpc).toBeCloseTo(100, 0);
      expect(sep.comovingDistanceMpc).toBeCloseTo(100, 0);
      // D_L = (1 + z) * D_C
      expect(sep.luminosityDistanceMpc).toBeCloseTo((1 + z) * 100, 1);
      // D_A = D_C / (1 + z)
      expect(sep.angularDiameterDistanceMpc).toBeCloseTo(100 / (1 + z), 1);
    });
  });

  describe('Master Backbone Unified Physics Evaluation', () => {
    it('evaluates comprehensive target physics (gravity, light-time, aberration, redshift, photometry) simultaneously', () => {
      const observer = createUniversalCoordinate('sun', 'planetary_system', { x: 0, y: 0, z: 0 });
      // Mars at 1.5 AU along X axis
      const marsMeters = 1.5 * METERS_PER_AU;
      const target = createUniversalCoordinate(
        'sun',
        'planetary_system',
        { x: 0, y: 0, z: 0 },
        { x: marsMeters, y: 0, z: 0 },
      );

      const targetVel = { x: 0, y: 0.014, z: 0 }; // ~24 km/s in AU/day
      const observerVel = { x: 0, y: 0.017, z: 0 }; // ~30 km/s in AU/day

      const physics = universeBackbone.evaluateTargetPhysics(
        target,
        observer,
        targetVel,
        observerVel,
        {
          targetLuminositySolar: 1.0,
          targetGmInternal: GM_SUN_INTERNAL,
        },
      );

      // Verify all subsystems computed
      expect(physics.lightTime).toBeDefined();
      expect(physics.lightTime!.tauSeconds).toBeCloseTo(1.5 * 499.005, 0); // 1.5 AU light time ~ 748 s
      expect(physics.aberration).toBeDefined();
      expect(physics.aberration!.displacementArcsec).toBeGreaterThan(0);
      expect(physics.redshift).toBeDefined();
      expect(physics.photometry).toBeDefined();
      expect(physics.gravity).toBeDefined();
    });
  });

  describe('Dynamic Runtime Physics Extension Plugins', () => {
    it('supports registering, executing, and unregistering custom physical effect plugins', () => {
      const customPlugin: UniversePhysicsPlugin = {
        id: 'gravitational_wave_strain',
        name: 'LIGO Gravitational Wave Strain Calculator',
        version: '1.0.0',
        evaluate(ctx) {
          // Mock strain h ~ (4 G / c^4) * (d^2 Q / dt^2) / r
          const rLy = Math.hypot(ctx.coord.globalLightYears.x, ctx.coord.globalLightYears.y, ctx.coord.globalLightYears.z);
          return {
            strainH: 1e-21 / Math.max(1, rLy),
            detected: true,
          };
        },
      };

      universeBackbone.registerPlugin(customPlugin);
      expect(universeBackbone.getRegisteredPlugins().map((p) => p.id)).toContain('gravitational_wave_strain');

      const target = createUniversalCoordinate('earth', 'planetary_system', { x: 10, y: 0, z: 0 });
      const obs = createUniversalCoordinate('sun', 'planetary_system', { x: 0, y: 0, z: 0 });

      const result = universeBackbone.evaluateTargetPhysics(target, obs);
      expect(result.pluginResults['gravitational_wave_strain']).toBeDefined();
      expect(result.pluginResults['gravitational_wave_strain']!['detected']).toBe(true);

      // Clean up
      universeBackbone.unregisterPlugin('gravitational_wave_strain');
      expect(universeBackbone.getRegisteredPlugins().map((p) => p.id)).not.toContain('gravitational_wave_strain');
    });
  });
});
