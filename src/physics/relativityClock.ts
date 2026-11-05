import { C_LIGHT_AU_DAY, DAY_S } from '@/data/constants';
import type { Vec3 } from './types';

/** Public compatibility alias; the value is defined in src/data/constants.ts. */
export { C_LIGHT_AU_DAY };
export const C2_AU_DAY = C_LIGHT_AU_DAY * C_LIGHT_AU_DAY;

export interface ClockDriftRate {
  /** Total dtau/dt - 1 (dimensionless fractional frequency offset) */
  totalRate: number;
  /** Gravitational potential component -U/c^2 (dimensionless) */
  gravitationalRate: number;
  /** Kinematic velocity component -v^2 / (2*c^2) (dimensionless) */
  kinematicRate: number;
  /** Total drift rate expressed in microseconds per day (us/day) */
  driftMicrosPerDay: number;
  /** Gravitational drift in us/day */
  gravitationalMicrosPerDay: number;
  /** Kinematic drift in us/day */
  kinematicMicrosPerDay: number;
}

/**
 * Computes instantaneous relativistic clock drift rate dtau/dt - 1 for a clock
 * located at position pos and velocity vel in the N-body gravitational field.
 *
 * References:
 * - Ashby (2003), "Relativity in the Global Positioning System", Living Rev. Relativity 6:1
 * - Soffel et al. (2003), AJ 126:2687 (IAU 2000 relativistic time framework)
 * - Misner, Thorne & Wheeler (1973), "Gravitation"
 */
export function computeClockDriftRate(
  pos: Vec3,
  vel: Vec3,
  bodyGms: ReadonlyArray<number>,
  bodyPositions: ReadonlyArray<Vec3>,
): ClockDriftRate {
  // Sum Newtonian gravitational potential U(r) = sum_j (GM_j / |r - r_j|)
  let U = 0;
  for (let j = 0; j < bodyGms.length; j++) {
    const gm = bodyGms[j]!;
    if (gm <= 0) continue;
    const bPos = bodyPositions[j]!;
    const dx = pos[0] - bPos[0];
    const dy = pos[1] - bPos[1];
    const dz = pos[2] - bPos[2];
    const r = Math.hypot(dx, dy, dz);
    if (r > 1e-12) {
      U += gm / r;
    }
  }

  // Velocity v^2
  const v2 = vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2];

  // Fractional frequency shifts
  const gravitationalRate = -U / C2_AU_DAY;
  const kinematicRate = -v2 / (2 * C2_AU_DAY);
  const totalRate = gravitationalRate + kinematicRate;

  // Convert to microseconds per day: rate * 86,400 s/day * 1,000,000 us/s
  const MICROSECONDS_PER_DAY = 86_400 * 1_000_000;
  const driftMicrosPerDay = totalRate * MICROSECONDS_PER_DAY;
  const gravitationalMicrosPerDay = gravitationalRate * MICROSECONDS_PER_DAY;
  const kinematicMicrosPerDay = kinematicRate * MICROSECONDS_PER_DAY;

  return {
    totalRate,
    gravitationalRate,
    kinematicRate,
    driftMicrosPerDay,
    gravitationalMicrosPerDay,
    kinematicMicrosPerDay,
  };
}

/**
 * Integrates cumulative proper time dilation Delta_tau = tau - t over an orbit arc
 * using trapezoidal quadrature.
 */
export function integrateProperTime(
  rates: ReadonlyArray<number>,
  timeStepsDays: ReadonlyArray<number>,
): number {
  let cumulativeDays = 0;
  for (let i = 0; i < timeStepsDays.length; i++) {
    const dt = timeStepsDays[i]!;
    const rate = rates[i]!;
    cumulativeDays += rate * dt;
  }
  return cumulativeDays * DAY_S; // Cumulative seconds
}
