import type { ForceModel, SystemState, Vec3 } from './types';
import { AU_KM, DAY_S } from '@/data/constants';

export const G0_MS2 = 9.80665; // Standard Earth gravitational acceleration (m/s^2)

/** Factor to convert acceleration from m/s^2 to AU/day^2 */
export const MS2_TO_AU_DAY2 = (DAY_S * DAY_S) / (AU_KM * 1000);

export type ThrustDirection =
  | 'prograde'
  | 'retrograde'
  | 'normal'
  | 'anti-normal'
  | 'radial-out'
  | 'radial-in'
  | { inertial: Vec3 };

export interface ImpulsiveManeuver {
  type: 'impulsive';
  epochDays: number;
  /** Delta-V vector in km/s */
  deltaVKms: Vec3;
}

export interface FiniteBurnManeuver {
  type: 'finite';
  startEpochDays: number;
  durationDays: number;
  direction: ThrustDirection;
  /** Optional custom thrust override in Newtons */
  thrustNewtons?: number;
}

export type Maneuver = ImpulsiveManeuver | FiniteBurnManeuver;

export interface SpacecraftConfig {
  id: string;
  name: string;
  stateIndex: number;
  centralBodyIndex?: number;
  dryMassKg: number;
  propellantMassKg: number;
  ispSeconds: number;
  thrustNewtons: number;
  areaM2?: number;
  cr?: number;
}

const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * High-Precision Spacecraft Flight Dynamics & Maneuver Engine.
 * Models mass depletion via Tsiolkovsky equation, scheduled impulsive maneuvers,
 * and continuous low-thrust finite burns in orbital frames (prograde/retrograde/normal).
 */
export class SpacecraftEngine implements ForceModel {
  readonly name = 'spacecraft-engine';
  readonly config: SpacecraftConfig;
  private currentPropellantKg: number;
  private maneuvers: Maneuver[] = [];
  private executedImpulses = new Set<ImpulsiveManeuver>();

  constructor(config: SpacecraftConfig) {
    this.config = config;
    this.currentPropellantKg = Math.max(0, config.propellantMassKg);
  }

  get wetMassKg(): number {
    return this.config.dryMassKg + this.currentPropellantKg;
  }

  get propellantMassKg(): number {
    return this.currentPropellantKg;
  }

  addManeuver(m: Maneuver): void {
    this.maneuvers.push(m);
    this.maneuvers.sort((a, b) => {
      const ta = a.type === 'impulsive' ? a.epochDays : a.startEpochDays;
      const tb = b.type === 'impulsive' ? b.epochDays : b.startEpochDays;
      return ta - tb;
    });
  }

  /**
   * Applies any impulsive maneuvers due at simulation time s.t.
   * Directly modifies velocity in state and burns propellant via Tsiolkovsky rocket equation.
   */
  processImpulses(s: SystemState): boolean {
    const idx = this.config.stateIndex;
    if (idx >= s.n) return false;

    let applied = false;
    for (const m of this.maneuvers) {
      if (m.type !== 'impulsive') continue;
      if (this.executedImpulses.has(m)) continue;

      if (Math.abs(s.t - m.epochDays) < 1e-5 || s.t >= m.epochDays) {
        // Delta V magnitude in m/s
        const dvKms = m.deltaVKms;
        const dvMagKms = Math.hypot(dvKms[0], dvKms[1], dvKms[2]);
        const dvMagMs = dvMagKms * 1000;

        // Tsiolkovsky equation: Delta m = m0 * (1 - exp(-dv / (Isp * g0)))
        const ve = this.config.ispSeconds * G0_MS2;
        const m0 = this.wetMassKg;
        const mf = m0 * Math.exp(-dvMagMs / ve);
        const propNeeded = m0 - mf;

        if (this.currentPropellantKg < propNeeded) {
          // Out of propellant: scale achievable delta-V
          const achievableDvMs = ve * Math.log(m0 / this.config.dryMassKg);
          const ratio = achievableDvMs / dvMagMs;
          this.currentPropellantKg = 0;

          // Convert km/s to AU/day: 1 km/s = (86400 / AU_KM) AU/day
          const scale = (ratio * 86400) / AU_KM;
          s.vel[3 * idx] = s.vel[3 * idx]! + dvKms[0] * scale;
          s.vel[3 * idx + 1] = s.vel[3 * idx + 1]! + dvKms[1] * scale;
          s.vel[3 * idx + 2] = s.vel[3 * idx + 2]! + dvKms[2] * scale;
        } else {
          this.currentPropellantKg -= propNeeded;
          const scale = 86400 / AU_KM;
          s.vel[3 * idx] = s.vel[3 * idx]! + dvKms[0] * scale;
          s.vel[3 * idx + 1] = s.vel[3 * idx + 1]! + dvKms[1] * scale;
          s.vel[3 * idx + 2] = s.vel[3 * idx + 2]! + dvKms[2] * scale;
        }

        this.executedImpulses.add(m);
        applied = true;
      }
    }
    return applied;
  }

  /**
   * ForceModel apply: evaluates continuous thrust acceleration for active finite burns.
   */
  apply(s: SystemState, acc: Float64Array): void {
    const idx = this.config.stateIndex;
    if (idx >= s.n) return;
    if (this.currentPropellantKg <= 0) return;

    for (const m of this.maneuvers) {
      if (m.type !== 'finite') continue;
      if (s.t < m.startEpochDays || s.t > m.startEpochDays + m.durationDays) continue;

      const thrustN = m.thrustNewtons ?? this.config.thrustNewtons;
      if (thrustN <= 0) continue;

      // Unit thrust vector in ICRF
      let uDir: Vec3 = [0, 0, 0];

      if (typeof m.direction === 'object' && 'inertial' in m.direction) {
        const iv = m.direction.inertial;
        const l = len(iv);
        uDir = l > 1e-12 ? [iv[0] / l, iv[1] / l, iv[2] / l] : [1, 0, 0];
      } else {
        // Orbit-relative frame
        const cb = this.config.centralBodyIndex ?? 0;
        const rx = s.pos[3 * idx]! - s.pos[3 * cb]!;
        const ry = s.pos[3 * idx + 1]! - s.pos[3 * cb + 1]!;
        const rz = s.pos[3 * idx + 2]! - s.pos[3 * cb + 2]!;
        const r: Vec3 = [rx, ry, rz];
        const rLen = len(r);

        const vx = s.vel[3 * idx]! - s.vel[3 * cb]!;
        const vy = s.vel[3 * idx + 1]! - s.vel[3 * cb + 1]!;
        const vz = s.vel[3 * idx + 2]! - s.vel[3 * cb + 2]!;
        const v: Vec3 = [vx, vy, vz];
        const vLen = len(v);

        const vHat: Vec3 = vLen > 1e-12 ? [vx / vLen, vy / vLen, vz / vLen] : [1, 0, 0];
        const rHat: Vec3 = rLen > 1e-12 ? [rx / rLen, ry / rLen, rz / rLen] : [1, 0, 0];
        const h = cross(r, v);
        const hLen = len(h);
        const hHat: Vec3 = hLen > 1e-12 ? [h[0] / hLen, h[1] / hLen, h[2] / hLen] : [0, 0, 1];

        switch (m.direction) {
          case 'prograde':
            uDir = vHat;
            break;
          case 'retrograde':
            uDir = [-vHat[0], -vHat[1], -vHat[2]];
            break;
          case 'normal':
            uDir = hHat;
            break;
          case 'anti-normal':
            uDir = [-hHat[0], -hHat[1], -hHat[2]];
            break;
          case 'radial-out':
            uDir = rHat;
            break;
          case 'radial-in':
            uDir = [-rHat[0], -rHat[1], -rHat[2]];
            break;
        }
      }

      // Acceleration magnitude: a = T / m (m/s^2) -> AU/day^2
      const aMs2 = thrustN / this.wetMassKg;
      const aAuDay2 = aMs2 * MS2_TO_AU_DAY2;

      acc[3 * idx] = acc[3 * idx]! + aAuDay2 * uDir[0];
      acc[3 * idx + 1] = acc[3 * idx + 1]! + aAuDay2 * uDir[1];
      acc[3 * idx + 2] = acc[3 * idx + 2]! + aAuDay2 * uDir[2];
    }
  }

  /**
   * Sub-step integrator helper: depletes propellant mass for active finite burns.
   * Call after each integrator step of length dtDays.
   */
  stepMass(tDays: number, dtDays: number): void {
    if (this.currentPropellantKg <= 0) return;
    for (const m of this.maneuvers) {
      if (m.type !== 'finite') continue;
      if (tDays < m.startEpochDays || tDays > m.startEpochDays + m.durationDays) continue;

      const thrustN = m.thrustNewtons ?? this.config.thrustNewtons;
      const mDot = thrustN / (this.config.ispSeconds * G0_MS2); // kg/s
      const dtSeconds = Math.abs(dtDays) * DAY_S;
      const consumedKg = mDot * dtSeconds;
      this.currentPropellantKg = Math.max(0, this.currentPropellantKg - consumedKg);
    }
  }
}
