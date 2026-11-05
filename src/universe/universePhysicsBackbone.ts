/**
 * Flight-Grade Universe Physics & Astrodynamics Master Backbone
 *
 * Unifies:
 * 1. Multi-scale Gravity Calculations (Planetary 1PN -> Galactic NFW -> Local Group -> FLRW Dark Energy)
 * 2. Relativistic Light & Radiation Engine (Light-time retardation, Aberration, Lensing, Redshift, Photometry)
 * 3. Scale-Hierarchical Dual Coordinates (Sub-millimeter local precision -> 93 Gly cosmic horizon)
 * 4. Extensible Future Physics Plugin System (Dynamic registration for GR waves, MOND, dark energy EOS, etc.)
 *
 * References:
 * - NASA SPICE Toolkit & JPL Navigation standards (MONTE/DE440).
 * - IAU Commission A2 (Rotation and Ephemerides of the Solar System).
 * - Planck Collaboration 2018/2020 Cosmological Standards.
 */

import { AU_KM, DAY_S, JD_J2000, KM_PER_KPC } from '@/data/constants';
import type { Vector3D } from '@/physics/light/lightTime';
import {
  solveLightTime,
  applyStellarAberration,
  computeGravitationalLightDeflection,
  computeCompositeRedshift,
  computePhotometry,
  type LightTimeResult,
  type AberrationResult,
  type LightDeflectionResult,
  type RedshiftBreakdown,
  type PhotometryResult,
} from '@/physics/light';
import {
  computeUniversalGravity,
  type CosmicAccelerationResult,
} from '@/physics/cosmicGravity';
import {
  computeCosmicSeparation,
  type UniversalCosmicCoordinate,
} from './cosmicScaleEngine';
import type { CosmicTier } from './cosmicHierarchy';

/**
 * Interface for dynamic runtime physics plugins (future extension architecture).
 */
export interface UniversePhysicsPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Evaluate custom physical perturbation or effect */
  evaluate(context: {
    coord: UniversalCosmicCoordinate;
    epochJd: number;
    velocityKms?: Vector3D;
  }): Record<string, unknown>;
}

export interface UniversalPhysicsState {
  coordinate: UniversalCosmicCoordinate;
  gravity: CosmicAccelerationResult;
  lightTime?: LightTimeResult;
  aberration?: AberrationResult;
  lensing?: LightDeflectionResult;
  redshift?: RedshiftBreakdown;
  photometry?: PhotometryResult;
  pluginResults: Record<string, Record<string, unknown>>;
}

export class UniversePhysicsBackbone {
  private static instance: UniversePhysicsBackbone | null = null;
  private readonly plugins = new Map<string, UniversePhysicsPlugin>();

  private constructor() {
    // Default core engine
  }

  public static getInstance(): UniversePhysicsBackbone {
    if (!UniversePhysicsBackbone.instance) {
      UniversePhysicsBackbone.instance = new UniversePhysicsBackbone();
    }
    return UniversePhysicsBackbone.instance;
  }

  /**
   * Registers a future physical effect plugin into the universe backbone.
   */
  public registerPlugin(plugin: UniversePhysicsPlugin): void {
    if (!plugin.id || typeof plugin.id !== 'string') {
      throw new Error(`Invalid plugin registration: missing plugin ID.`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Retrieves all registered plugins.
   */
  public getRegisteredPlugins(): readonly UniversePhysicsPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Removes a registered plugin.
   */
  public unregisterPlugin(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  /**
   * Evaluates comprehensive universal physics for any target in the cosmos.
   *
   * @param targetCoord Universal coordinate of the celestial object
   * @param observerCoord Universal coordinate of the observer
   * @param targetVelAUPerDay Target velocity vector in AU/day
   * @param observerVelAUPerDay Observer velocity vector in AU/day
   * @param options Additional physical parameters (lens, GM, luminosity)
   */
  public evaluateTargetPhysics(
    targetCoord: UniversalCosmicCoordinate,
    observerCoord: UniversalCosmicCoordinate,
    targetVelAUPerDay: Vector3D = { x: 0, y: 0, z: 0 },
    observerVelAUPerDay: Vector3D = { x: 0, y: 0, z: 0 },
    options?: {
      epochJd?: number;
      targetGmInternal?: number;
      targetLuminositySolar?: number;
      lensPosAu?: Vector3D;
      lensGmInternal?: number;
    },
  ): UniversalPhysicsState {
    const epochJd = options?.epochJd ?? JD_J2000;

    // 1. Separation and Metric Distances
    const separation = computeCosmicSeparation(observerCoord, targetCoord);

    // 2. Multi-Scale Gravity
    // Position vector relative to local scale center in kpc
    const posFromCenterKpc: Vector3D = {
      x: (targetCoord.localOffsetAu.x * AU_KM) / KM_PER_KPC,
      y: (targetCoord.localOffsetAu.y * AU_KM) / KM_PER_KPC,
      z: (targetCoord.localOffsetAu.z * AU_KM) / KM_PER_KPC,
    };
    const scaleTierMap: Record<CosmicTier, 'planetary' | 'galactic' | 'local_group' | 'supercluster'> = {
      satellite_system: 'planetary',
      planetary_system: 'planetary',
      debris_belt: 'planetary',
      spacecraft: 'planetary',
      star_system: 'galactic',
      interstellar_cloud: 'galactic',
      galaxy_structure: 'galactic',
      galaxy: 'galactic',
      local_group: 'local_group',
      supercluster: 'supercluster',
    };
    const mappedTier = scaleTierMap[targetCoord.tier] ?? 'planetary';
    const gravity = computeUniversalGravity(posFromCenterKpc, mappedTier);

    // 3. Relativistic Light Propagation (Light-Time Retardation)
    const relPosAu: Vector3D = {
      x: separation.separationAu * separation.unitDirectionAtoB.x,
      y: separation.separationAu * separation.unitDirectionAtoB.y,
      z: separation.separationAu * separation.unitDirectionAtoB.z,
    };
    const obsPosAu: Vector3D = { x: 0, y: 0, z: 0 };
    const targetState = {
      pos: relPosAu,
      vel: targetVelAUPerDay,
    };
    const lightTime = solveLightTime(obsPosAu, targetState);

    // 4. Relativistic Stellar Aberration
    const aberration = applyStellarAberration(separation.unitDirectionAtoB, observerVelAUPerDay);

    // 5. Gravitational Light Deflection (if lens specified)
    let lensing: LightDeflectionResult | undefined;
    if (options?.lensPosAu && options.lensGmInternal) {
      lensing = computeGravitationalLightDeflection(
        obsPosAu,
        lightTime.apparentVector,
        options.lensPosAu,
        options.lensGmInternal,
      );
    }

    // 6. Multi-Component Redshift (Kinematic + Gravitational + Cosmological)
    const relVelAUPerDay: Vector3D = {
      x: targetVelAUPerDay.x - observerVelAUPerDay.x,
      y: targetVelAUPerDay.y - observerVelAUPerDay.y,
      z: targetVelAUPerDay.z - observerVelAUPerDay.z,
    };
    const redshift = computeCompositeRedshift({
      relativeVelAUPerDay: relVelAUPerDay,
      lineOfSightUnit: separation.unitDirectionAtoB,
      gmInternal: options?.targetGmInternal,
      distanceMpc: separation.separationMpc,
    });

    // 7. Radiometric Photometry & Flux
    const photometry = computePhotometry({
      distanceAu: separation.separationAu,
      luminositySolar: options?.targetLuminositySolar ?? 1.0,
    });

    // 8. Execute Registered Future Plugins
    const pluginResults: Record<string, Record<string, unknown>> = {};
    for (const [id, plugin] of this.plugins.entries()) {
      try {
        pluginResults[id] = plugin.evaluate({
          coord: targetCoord,
          epochJd,
          velocityKms: {
            x: (targetVelAUPerDay.x * AU_KM) / DAY_S,
            y: (targetVelAUPerDay.y * AU_KM) / DAY_S,
            z: (targetVelAUPerDay.z * AU_KM) / DAY_S,
          },
        });
      } catch (err) {
        pluginResults[id] = { error: String(err) };
      }
    }

    return {
      coordinate: targetCoord,
      gravity,
      lightTime,
      aberration,
      lensing,
      redshift,
      photometry,
      pluginResults,
    };
  }
}

/** Global singleton universe physics backbone */
export const universeBackbone = UniversePhysicsBackbone.getInstance();
