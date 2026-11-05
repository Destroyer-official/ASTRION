import { AU_KM, C_LIGHT_KMS, auDayToKms } from '@/data/constants';
import { bodyToEcliptic, poleOf } from '@/physics/orientation';
import { stateToElements, type Elements } from '@/physics/kepler';
import type { SystemState, Vec3 } from '@/physics/types';
import type { SystemModel } from './registry';

export interface ComputedFacts {
  id: string;
  name: string;
  radiusKm: number;
  polarRadiusKm: number;
  volumetricRadiusKm: number;
  flattening: number;
  distSunAu: number;
  lightMinutes: number;
  speedKms: number;
  elements: Elements;
  axialTiltDeg: number;
  siderealDayDays: number;
  subsolarLatDeg: number;
  subsolarLonDeg: number;
  facts: Record<string, string>;
  isMoon?: boolean;
  parentId?: string;
  parentName?: string;
  distParentAu?: number;
  distParentKm?: number;
  speedRelParentKms?: number;
}

export function computeBodyFacts(
  id: string,
  state: SystemState,
  model: SystemModel,
): ComputedFacts | null {
  const i = model.ids.indexOf(id);
  const sun = model.ids.indexOf('sun');
  if (i < 0 || sun < 0) return null;

  const physical = model.physicalMap[id];
  const rot = physical?.rotation;
  const daysSinceJ2000 = model.epochJd - 2451545.0 + state.t;

  if (id === 'sun') {
    // Sun's motion relative to Solar System Barycenter (the simulation origin [0,0,0])
    const sx = state.pos[3 * sun]!;
    const sy = state.pos[3 * sun + 1]!;
    const sz = state.pos[3 * sun + 2]!;
    const distBaryAu = Math.hypot(sx, sy, sz);
    const distBaryKm = distBaryAu * AU_KM;
    const sunRadiusKm = model.radiusKm[sun] || 695700;
    const rSolar = distBaryKm / sunRadiusKm;

    const svx = state.vel[3 * sun]!;
    const svy = state.vel[3 * sun + 1]!;
    const svz = state.vel[3 * sun + 2]!;
    const speedKms = auDayToKms(Math.hypot(svx, svy, svz));
    const speedMs = speedKms * 1000;

    const rotRate = rot?.wRateDegPerDay ?? 14.1844;
    const rotAngleDeg = (((rot?.w0Deg ?? 84.176) + rotRate * daysSinceJ2000) % 360 + 360) % 360;
    const carringtonNo = Math.floor(1958 + daysSinceJ2000 / 27.2753);

    return {
      id: 'sun',
      name: 'Sun (Sol) - 3 Unified Motions',
      radiusKm: sunRadiusKm,
      polarRadiusKm: sunRadiusKm,
      volumetricRadiusKm: sunRadiusKm,
      flattening: 0,
      distSunAu: distBaryAu, // Shows distance to Solar System Barycenter
      lightMinutes: distBaryAu * (AU_KM / C_LIGHT_KMS / 60),
      speedKms,
      elements: {
        a: distBaryAu,
        e: 0.1,
        inc: 7.25 * (Math.PI / 180),
        node: 75.76 * (Math.PI / 180),
        argPeri: 0,
        meanAnom: rotAngleDeg * (Math.PI / 180),
        period: 7254, // ~19.86 yr Jupiter-Saturn synodic cycle
      },
      axialTiltDeg: 7.25,
      siderealDayDays: 360 / rotRate,
      subsolarLatDeg: 0,
      subsolarLonDeg: rotAngleDeg,
      facts: {
        '☀️ Motion 1: Self-Rotation': `${rotRate.toFixed(4)}°/day (${(360 / rotRate).toFixed(2)} d sidereal, 7.25° tilt to ecliptic)`,
        'Carrington Cycle': `CR ${carringtonNo} (Prime Meridian W = ${rotAngleDeg.toFixed(1)}°)`,
        'Differential Rotation': 'Equator: 24.47 d (14.71°/d) | Poles: 34.15 d (10.54°/d)',
        '⚖️ Motion 2: SSB Wobble': `${distBaryKm.toLocaleString('en-US', { maximumFractionDigits: 0 })} km (${rSolar.toFixed(2)} R☉) ${rSolar > 1.0 ? 'OUTSIDE Surface (in empty space)' : 'INSIDE Physical Sun'}`,
        'Wobble Speed': `${speedMs.toFixed(1)} m/s (${speedKms.toFixed(3)} km/s around Barycenter)`,
        'Gravitational Drivers': 'Jupiter (~61%), Saturn (~27%), Neptune (~7%), Uranus (~5%)',
        'Harmonic Cycles': '19.86 yr (J-S beat), 60 yr (trefoil loop), 178.7 yr (Charvátová)',
        '🌌 Motion 3: Galactic Orbit': 'R₀ ≈ 8.18 kpc (26,700 ly) from Sgr A*, V₀ ≈ 230 km/s',
        'Vertical Oscillation': 'z ≈ +20.8 pc (+67.8 ly), P_z ≈ 75 Myr (harmonic bobbing)',
        'Galactic Cosmic Year': '~230 Million Years per Milky Way revolution',
      },
    };
  }

  // Check if body is a moon with a parent planet
  const bodyMeta = model.bodies?.find((b) => b.id === id);
  const parentId = (bodyMeta as { parent?: string } | undefined)?.parent;
  const parentIdx = parentId ? model.ids.indexOf(parentId) : -1;
  const isMoon = parentIdx >= 0;

  // Body relative to Sun
  const rx = state.pos[3 * i]! - state.pos[3 * sun]!;
  const ry = state.pos[3 * i + 1]! - state.pos[3 * sun + 1]!;
  const rz = state.pos[3 * i + 2]! - state.pos[3 * sun + 2]!;

  const vx = state.vel[3 * i]! - state.vel[3 * sun]!;
  const vy = state.vel[3 * i + 1]! - state.vel[3 * sun + 1]!;
  const vz = state.vel[3 * i + 2]! - state.vel[3 * sun + 2]!;

  const distSunAu = Math.hypot(rx, ry, rz);
  const lightMinutes = distSunAu * (AU_KM / C_LIGHT_KMS / 60);
  const speedKms = auDayToKms(Math.hypot(vx, vy, vz));

  let elements: Elements;
  let distParentAu: number | undefined;
  let distParentKm: number | undefined;
  let speedRelParentKms: number | undefined;

  let hx: number, hy: number, hz: number;

  if (isMoon) {
    // Relative to parent planet
    const rpx = state.pos[3 * i]! - state.pos[3 * parentIdx]!;
    const rpy = state.pos[3 * i + 1]! - state.pos[3 * parentIdx + 1]!;
    const rpz = state.pos[3 * i + 2]! - state.pos[3 * parentIdx + 2]!;

    const vpx = state.vel[3 * i]! - state.vel[3 * parentIdx]!;
    const vpy = state.vel[3 * i + 1]! - state.vel[3 * parentIdx + 1]!;
    const vpz = state.vel[3 * i + 2]! - state.vel[3 * parentIdx + 2]!;

    distParentAu = Math.hypot(rpx, rpy, rpz);
    distParentKm = distParentAu * AU_KM;
    speedRelParentKms = auDayToKms(Math.hypot(vpx, vpy, vpz));

    const parentBody = model.bodies?.find((b) => b.id === parentId);
    const muParent = parentBody?.gmIsSystem ? state.gm[parentIdx]! : state.gm[parentIdx]! + state.gm[i]!;
    const rVecParent: Vec3 = [rpx, rpy, rpz];
    const vVecParent: Vec3 = [vpx, vpy, vpz];
    elements = stateToElements(muParent, rVecParent, vVecParent);

    hx = rpy * vpz - rpz * vpy;
    hy = rpz * vpx - rpx * vpz;
    hz = rpx * vpy - rpy * vpx;
  } else {
    // Relative to Sun
    const mu = state.gm[sun]! + state.gm[i]!;
    const rVec: Vec3 = [rx, ry, rz];
    const vVec: Vec3 = [vx, vy, vz];
    elements = stateToElements(mu, rVec, vVec);

    hx = ry * vz - rz * vy;
    hy = rz * vx - rx * vz;
    hz = rx * vy - ry * vx;
  }

  let axialTiltDeg = 0;
  let siderealDayDays = 0;
  let subsolarLatDeg = 0;
  let subsolarLonDeg = 0;

  if (rot) {
    const M = bodyToEcliptic(rot, daysSinceJ2000);
    const pole = poleOf(M);

    // Orbit normal
    const hl = Math.hypot(hx, hy, hz) || 1e-12;
    const n = [hx / hl, hy / hl, hz / hl];

    const spinPole = rot.wRateDegPerDay < 0 ? [-pole[0]!, -pole[1]!, -pole[2]!] : pole;
    const dot = spinPole[0]! * n[0]! + spinPole[1]! * n[1]! + spinPole[2]! * n[2]!;
    axialTiltDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;

    siderealDayDays = 360 / Math.abs(rot.wRateDegPerDay);

    // Subsolar point (vector from body to Sun is -rVec)
    const toSunX = -rx / distSunAu;
    const toSunY = -ry / distSunAu;
    const toSunZ = -rz / distSunAu;

    // Rotate into body-fixed frame using transpose(M)
    const bx = M[0]! * toSunX + M[3]! * toSunY + M[6]! * toSunZ;
    const by = M[1]! * toSunX + M[4]! * toSunY + M[7]! * toSunZ;
    const bz = M[2]! * toSunX + M[5]! * toSunY + M[8]! * toSunZ;

    subsolarLatDeg = (Math.asin(Math.max(-1, Math.min(1, bz))) * 180) / Math.PI;
    subsolarLonDeg = (Math.atan2(by, bx) * 180) / Math.PI;
  }

  const radiusKm = model.radiusKm[i]!;
  const flattening = physical?.flattening ?? 0;
  const polarRadiusKm = radiusKm * (1 - flattening);
  const volumetricRadiusKm = Math.cbrt(radiusKm * radiusKm * polarRadiusKm);

  return {
    id,
    name: model.names[i]!,
    radiusKm,
    polarRadiusKm,
    volumetricRadiusKm,
    flattening,
    distSunAu,
    lightMinutes,
    speedKms,
    elements,
    axialTiltDeg,
    siderealDayDays,
    subsolarLatDeg,
    subsolarLonDeg,
    facts: physical?.facts ?? {},
    isMoon,
    parentId,
    parentName: isMoon ? model.names[parentIdx]! : undefined,
    distParentAu,
    distParentKm,
    speedRelParentKms,
  };
}
