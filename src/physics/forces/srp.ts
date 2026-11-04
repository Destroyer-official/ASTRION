import type { ForceModel, SystemState, Vec3 } from '../types';
import { AU_KM, SUN_RADIUS_KM } from '@/data/constants';

/**
 * Solar radiation constant at 1 AU:
 * Total solar irradiance Phi_0 = 1361.0 W/m^2.
 * Radiation pressure P_0 = Phi_0 / c = 4.5398e-6 N/m^2 (Pa).
 *
 * In internal units (AU, day, m^2/kg):
 * P_AU = P_0 * (86400^2 s^2/day^2) / (1.495978707e11 m/AU)
 *      ≈ 2.26543e-7 (AU/day^2) / (m^2/kg)
 */
export const P_SRP_AU = 2.26543e-7;

export interface SpacecraftSrpParams {
  /** Cross-sectional area exposed to the Sun in m^2 */
  areaM2: number;
  /** Spacecraft total mass in kg */
  massKg: number;
  /** Radiation pressure coefficient (1.0 for black body, ~1.2-1.5 for spacecraft, 2.0 for pure mirror) */
  cr?: number;
}

export interface OccultingBody {
  index: number;
  radiusKm: number;
}

/**
 * Computes conical shadow occultation factor nu in [0, 1] using Montenbruck & Gill (2000)
 * analytical overlapping circle area formulation.
 * 1.0 = full sunlight, 0.0 = total umbra, (0, 1) = penumbra.
 */
export function computeShadowFactor(
  scPos: Vec3,
  sunPos: Vec3,
  occPos: Vec3,
  occRadiusKm: number,
  sunRadiusKm = SUN_RADIUS_KM,
): number {
  const sunKm = sunRadiusKm;
  const occKm = occRadiusKm;

  // Vector sc -> Sun
  const sx = (sunPos[0] - scPos[0]) * AU_KM;
  const sy = (sunPos[1] - scPos[1]) * AU_KM;
  const sz = (sunPos[2] - scPos[2]) * AU_KM;
  const dSun = Math.hypot(sx, sy, sz);

  // Vector sc -> Occulter
  const ox = (occPos[0] - scPos[0]) * AU_KM;
  const oy = (occPos[1] - scPos[1]) * AU_KM;
  const oz = (occPos[2] - scPos[2]) * AU_KM;
  const dOcc = Math.hypot(ox, oy, oz);

  // If occulter is behind spacecraft or farther than the Sun
  const dotOccSun = ox * sx + oy * sy + oz * sz;
  if (dotOccSun <= 0 || dOcc >= dSun) return 1.0;

  // Apparent angular radii
  const alphaS = Math.asin(Math.min(1.0, sunKm / dSun));
  const alphaO = Math.asin(Math.min(1.0, occKm / dOcc));

  // Angular separation between Sun and Occulter centers
  const cosTheta = Math.max(-1.0, Math.min(1.0, (sx * ox + sy * oy + sz * oz) / (dSun * dOcc)));
  const theta = Math.acos(cosTheta);

  // No eclipse
  if (theta >= alphaS + alphaO) return 1.0;

  // Total eclipse (occulter completely covers Sun)
  if (theta <= alphaO - alphaS) return 0.0;

  // Annular eclipse (Sun encompasses occulter)
  if (theta <= alphaS - alphaO) {
    return Math.max(0.0, 1.0 - (alphaO * alphaO) / (alphaS * alphaS));
  }

  // Partial eclipse: overlapping circles area
  const r1 = alphaS;
  const r2 = alphaO;
  const d = theta;

  const r1Sq = r1 * r1;
  const r2Sq = r2 * r2;
  const dSq = d * d;

  const phi1 = Math.acos(Math.max(-1.0, Math.min(1.0, (dSq + r1Sq - r2Sq) / (2 * d * r1))));
  const phi2 = Math.acos(Math.max(-1.0, Math.min(1.0, (dSq + r2Sq - r1Sq) / (2 * d * r2))));

  const aOverlap =
    r1Sq * phi1 +
    r2Sq * phi2 -
    0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));

  const aSun = Math.PI * r1Sq;
  return Math.max(0.0, Math.min(1.0, 1.0 - aOverlap / aSun));
}

/**
 * Solar Radiation Pressure (SRP) Force Model.
 * Calculates direct photon pressure acceleration on spacecraft with conical shadow occultation.
 */
export class SolarRadiationPressure implements ForceModel {
  readonly name = 'solar-radiation-pressure';
  private readonly sunIndex: number;
  private readonly targets: Map<number, SpacecraftSrpParams>;
  private readonly occulters: OccultingBody[];

  constructor(
    sunIndex = 0,
    targets?: Map<number, SpacecraftSrpParams>,
    occulters: OccultingBody[] = [],
  ) {
    this.sunIndex = sunIndex;
    this.targets = targets ?? new Map();
    this.occulters = occulters;
  }

  setTarget(index: number, params: SpacecraftSrpParams): void {
    this.targets.set(index, params);
  }

  removeTarget(index: number): void {
    this.targets.delete(index);
  }

  addOcculter(index: number, radiusKm: number): void {
    this.occulters.push({ index, radiusKm });
  }

  apply(s: SystemState, acc: Float64Array): void {
    const si = this.sunIndex;
    if (si >= s.n) return;

    const sx = s.pos[3 * si]!;
    const sy = s.pos[3 * si + 1]!;
    const sz = s.pos[3 * si + 2]!;
    const sunPos: Vec3 = [sx, sy, sz];

    for (const [targetIdx, params] of this.targets.entries()) {
      if (targetIdx >= s.n || targetIdx === si) continue;

      const tx = s.pos[3 * targetIdx]!;
      const ty = s.pos[3 * targetIdx + 1]!;
      const tz = s.pos[3 * targetIdx + 2]!;
      const scPos: Vec3 = [tx, ty, tz];

      const dx = tx - sx;
      const dy = ty - sy;
      const dz = tz - sz;
      const r2 = dx * dx + dy * dy + dz * dz;
      const r = Math.sqrt(r2);
      if (r < 1e-6) continue;

      // Shadow occultation calculation
      let nu = 1.0;
      for (const occ of this.occulters) {
        if (occ.index >= s.n || occ.index === si || occ.index === targetIdx) continue;
        const ox = s.pos[3 * occ.index]!;
        const oy = s.pos[3 * occ.index + 1]!;
        const oz = s.pos[3 * occ.index + 2]!;
        const occPos: Vec3 = [ox, oy, oz];

        const f = computeShadowFactor(scPos, sunPos, occPos, occ.radiusKm);
        nu = Math.min(nu, f);
        if (nu <= 1e-4) {
          nu = 0;
          break;
        }
      }

      if (nu <= 0) continue;

      const cr = params.cr ?? 1.2;
      const areaOverMass = params.areaM2 / params.massKg;
      // a_srp = nu * P_AU * Cr * (A/m) / r^2
      const aMag = (nu * P_SRP_AU * cr * areaOverMass) / r2;

      const ux = dx / r;
      const uy = dy / r;
      const uz = dz / r;

      acc[3 * targetIdx] = acc[3 * targetIdx]! + aMag * ux;
      acc[3 * targetIdx + 1] = acc[3 * targetIdx + 1]! + aMag * uy;
      acc[3 * targetIdx + 2] = acc[3 * targetIdx + 2]! + aMag * uz;
    }
  }
}
