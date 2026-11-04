import type { ForceModel, SystemState, Vec3 } from '../types';
import { AU_KM, DAY_S } from '@/data/constants';

export const MS2_TO_AU_DAY2 = (DAY_S * DAY_S) / (AU_KM * 1000);
export const AU_DAY_TO_MS = (AU_KM * 1000) / DAY_S;

export interface AtmosphericLayer {
  /** Base altitude in km */
  h0Km: number;
  /** Base density in kg/m^3 */
  rho0: number;
  /** Scale height in km */
  scaleHeightKm: number;
}

export interface PlanetaryAtmosphere {
  name: string;
  hostIndex: number;
  radiusKm: number;
  layers: AtmosphericLayer[];
  /** Rotation rate in rad/day (e.g. 2*pi for Earth) */
  omegaRadPerDay: number;
  pole: (t: number) => Vec3;
}

export interface SpacecraftDragParams {
  areaM2: number;
  massKg: number;
  cd?: number; // default 2.2
}

/** Standard Earth multi-layer exponential density profile (US Standard Atmosphere 1976 / Jacchia) */
export const EARTH_ATMOSPHERE_LAYERS: AtmosphericLayer[] = [
  { h0Km: 0, rho0: 1.225, scaleHeightKm: 7.249 },
  { h0Km: 25, rho0: 3.899e-2, scaleHeightKm: 6.349 },
  { h0Km: 50, rho0: 1.027e-3, scaleHeightKm: 7.922 },
  { h0Km: 100, rho0: 5.297e-7, scaleHeightKm: 5.877 },
  { h0Km: 150, rho0: 2.076e-9, scaleHeightKm: 26.83 },
  { h0Km: 200, rho0: 2.541e-10, scaleHeightKm: 37.105 },
  { h0Km: 300, rho0: 1.916e-11, scaleHeightKm: 53.628 },
  { h0Km: 400, rho0: 2.803e-12, scaleHeightKm: 58.515 },
  { h0Km: 500, rho0: 5.215e-13, scaleHeightKm: 60.828 },
  { h0Km: 600, rho0: 1.137e-13, scaleHeightKm: 63.822 },
  { h0Km: 700, rho0: 3.070e-14, scaleHeightKm: 71.835 },
  { h0Km: 800, rho0: 1.136e-14, scaleHeightKm: 88.097 },
];

/** Standard Mars atmosphere layers (Mars-GRAM / NASA SP-8010) */
export const MARS_ATMOSPHERE_LAYERS: AtmosphericLayer[] = [
  { h0Km: 0, rho0: 0.020, scaleHeightKm: 11.1 },
  { h0Km: 50, rho0: 2.19e-4, scaleHeightKm: 9.8 },
  { h0Km: 100, rho0: 1.34e-6, scaleHeightKm: 8.5 },
];

/**
 * Computes atmospheric mass density in kg/m^3 for a given altitude in km.
 */
export function getAtmosphericDensity(altitudeKm: number, layers: AtmosphericLayer[]): number {
  if (altitudeKm < 0) altitudeKm = 0;
  // Find appropriate layer
  let active = layers[0]!;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (altitudeKm >= layers[i]!.h0Km) {
      active = layers[i]!;
      break;
    }
  }
  const dh = altitudeKm - active.h0Km;
  return active.rho0 * Math.exp(-dh / active.scaleHeightKm);
}

/**
 * Planetary Atmospheric Drag Force Model.
 * Computes aerodynamic deceleration on spacecraft accounting for atmospheric scale height,
 * planetary rotation (coriolis/wind), and area-to-mass ratio.
 */
export class AtmosphericDrag implements ForceModel {
  readonly name = 'atmospheric-drag';
  private readonly atmosphere: PlanetaryAtmosphere;
  private readonly targets = new Map<number, SpacecraftDragParams>();

  constructor(atmosphere: PlanetaryAtmosphere, targets?: Map<number, SpacecraftDragParams>) {
    this.atmosphere = atmosphere;
    if (targets) this.targets = targets;
  }

  setTarget(index: number, params: SpacecraftDragParams): void {
    this.targets.set(index, params);
  }

  removeTarget(index: number): void {
    this.targets.delete(index);
  }

  apply(s: SystemState, acc: Float64Array): void {
    const h = this.atmosphere.hostIndex;
    if (h >= s.n) return;

    const hx = s.pos[3 * h]!, hy = s.pos[3 * h + 1]!, hz = s.pos[3 * h + 2]!;
    const hvx = s.vel[3 * h]!, hvy = s.vel[3 * h + 1]!, hvz = s.vel[3 * h + 2]!;

    const p = this.atmosphere.pole(s.t);
    const omega = this.atmosphere.omegaRadPerDay;
    // Angular velocity vector: w = omega * pole
    const wx = omega * p[0], wy = omega * p[1], wz = omega * p[2];

    for (const [scIdx, params] of this.targets.entries()) {
      if (scIdx >= s.n || scIdx === h) continue;

      const px = s.pos[3 * scIdx]!, py = s.pos[3 * scIdx + 1]!, pz = s.pos[3 * scIdx + 2]!;
      const vx = s.vel[3 * scIdx]!, vy = s.vel[3 * scIdx + 1]!, vz = s.vel[3 * scIdx + 2]!;

      // Relative position from host center
      const rxAu = px - hx, ryAu = py - hy, rzAu = pz - hz;
      const rAu = Math.hypot(rxAu, ryAu, rzAu);
      const rKm = rAu * AU_KM;
      const altKm = rKm - this.atmosphere.radiusKm;

      // Skip if beyond atmosphere (e.g. > 1000 km)
      if (altKm > 1000 || altKm < -50) continue;

      const rho = getAtmosphericDensity(altKm, this.atmosphere.layers);
      if (rho < 1e-18) continue;

      // Atmosphere tangential velocity due to planetary rotation: v_atm = w x r
      const vAtmx = wy * rzAu - wz * ryAu;
      const vAtmy = wz * rxAu - wx * rzAu;
      const vAtmz = wx * ryAu - wy * rxAu;

      // Relative velocity of spacecraft with respect to rotating atmosphere:
      // v_rel = v_sc - v_host - v_atm
      const relVxAuDay = vx - hvx - vAtmx;
      const relVyAuDay = vy - hvy - vAtmy;
      const relVzAuDay = vz - hvz - vAtmz;

      const relVLenAuDay = Math.hypot(relVxAuDay, relVyAuDay, relVzAuDay);
      if (relVLenAuDay < 1e-12) continue;

      // Convert to m/s
      const relVMs = relVLenAuDay * AU_DAY_TO_MS;

      const cd = params.cd ?? 2.2;
      const areaOverMass = params.areaM2 / params.massKg;

      // Deceleration magnitude in m/s^2:
      // a_drag = 0.5 * cd * (A/m) * rho * v_rel^2
      const aDragMs2 = 0.5 * cd * areaOverMass * rho * relVMs * relVMs;

      // Convert deceleration to AU/day^2
      const aDragAuDay2 = aDragMs2 * MS2_TO_AU_DAY2;

      // Opposes relative velocity: u_rel = v_rel / |v_rel|
      const ux = relVxAuDay / relVLenAuDay;
      const uy = relVyAuDay / relVLenAuDay;
      const uz = relVzAuDay / relVLenAuDay;

      acc[3 * scIdx] = acc[3 * scIdx]! - aDragAuDay2 * ux;
      acc[3 * scIdx + 1] = acc[3 * scIdx + 1]! - aDragAuDay2 * uy;
      acc[3 * scIdx + 2] = acc[3 * scIdx + 2]! - aDragAuDay2 * uz;
    }
  }
}
