/**
 * General Relativistic Gravitational Lensing & Light Deflection Engine
 *
 * Implements Einstein's light deflection, vector impact parameter analysis,
 * Schwarzschild photon spheres, and Einstein ring radius calculations.
 *
 * References:
 * - Einstein, A. (1915), "Erklärung der Perihelbewegung des Merkur aus der allgemeinen
 *   Relativitätstheorie", Sitzungsberichte der Preussischen Akademie der Wissenschaften.
 * - Schneider, P., Ehlers, J., & Falco, E. E. (1992), "Gravitational Lenses", Springer-Verlag.
 * - Narayan, R. & Bartelmann, M. (1996), "Lectures on Gravitational Lensing", arXiv:astro-ph/9606001.
 */

import { SPEED_OF_LIGHT_AU_DAY, type Vector3D } from './lightTime';
import { AU_KM } from '@/data/constants';

export interface LightDeflectionResult {
  /** Angular deflection in radians */
  deflectionAngleRad: number;
  /** Angular deflection in arcseconds (") */
  deflectionAngleArcsec: number;
  /** Impact parameter magnitude in AU */
  impactParameterAu: number;
  /** Impact parameter magnitude in kilometers */
  impactParameterKm: number;
  /** 3D vector impact parameter from lens to ray closest approach (AU) */
  impactVector: Vector3D;
  /** Deflected ray unit direction vector */
  deflectedDirection: Vector3D;
  /** Schwarzschild radius of the lens in AU */
  schwarzschildRadiusAu: number;
  /** Photon sphere radius in AU (3 GM / c^2) */
  photonSphereRadiusAu: number;
  /** True if ray passes inside the photon sphere and is gravitationally captured */
  isCaptured: boolean;
}

export interface EinsteinRingResult {
  /** Angular radius of the Einstein ring in radians */
  thetaERad: number;
  /** Angular radius of the Einstein ring in arcseconds */
  thetaEArcsec: number;
  /** Physical radius of the Einstein ring at lens plane in AU */
  physicalRadiusAu: number;
}

function norm(v: Vector3D): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vector3D): Vector3D {
  const n = norm(v);
  if (n < 1e-16) return { x: 0, y: 0, z: 1 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/**
 * Computes the Schwarzschild radius r_s = 2 G M / c^2 for a given GM in AU^3/day^2.
 */
export function getSchwarzschildRadiusAu(gmInternal: number): number {
  return (2 * gmInternal) / (SPEED_OF_LIGHT_AU_DAY * SPEED_OF_LIGHT_AU_DAY);
}

/**
 * Computes the photon sphere radius r_ph = 3 G M / c^2 = 1.5 * r_s.
 */
export function getPhotonSphereRadiusAu(gmInternal: number): number {
  return (3 * gmInternal) / (SPEED_OF_LIGHT_AU_DAY * SPEED_OF_LIGHT_AU_DAY);
}

/**
 * Computes gravitational light deflection for a photon traveling from rayOrigin to rayTarget
 * passing near a lens located at lensPos with gravitational parameter gmInternal (AU^3/day^2).
 *
 * @param rayOrigin Observer or origin position (AU)
 * @param rayTarget Target or source position (AU)
 * @param lensPos Position of the gravitating lens (AU)
 * @param gmInternal Gravitational parameter of lens (AU^3/day^2)
 */
export function computeGravitationalLightDeflection(
  rayOrigin: Vector3D,
  rayTarget: Vector3D,
  lensPos: Vector3D,
  gmInternal: number,
): LightDeflectionResult {
  const rayDir = normalize({
    x: rayTarget.x - rayOrigin.x,
    y: rayTarget.y - rayOrigin.y,
    z: rayTarget.z - rayOrigin.z,
  });

  // Vector from rayOrigin to lens: d_L = lensPos - rayOrigin
  const dLx = lensPos.x - rayOrigin.x;
  const dLy = lensPos.y - rayOrigin.y;
  const dLz = lensPos.z - rayOrigin.z;

  // Projection of lens onto unperturbed ray: t_closest = d_L · rayDir
  const tClosest = dLx * rayDir.x + dLy * rayDir.y + dLz * rayDir.z;

  // Closest approach point on ray: p_closest = rayOrigin + t_closest * rayDir
  const pClosest: Vector3D = {
    x: rayOrigin.x + tClosest * rayDir.x,
    y: rayOrigin.y + tClosest * rayDir.y,
    z: rayOrigin.z + tClosest * rayDir.z,
  };

  // Vector impact parameter b: vector from lens to closest approach point
  const bx = pClosest.x - lensPos.x;
  const by = pClosest.y - lensPos.y;
  const bz = pClosest.z - lensPos.z;
  const bMag = Math.hypot(bx, by, bz);

  const rs = getSchwarzschildRadiusAu(gmInternal);
  const rph = getPhotonSphereRadiusAu(gmInternal);

  // Critical impact parameter for capture: b_crit = sqrt(27) * GM / c^2 = sqrt(27)/2 * r_s ~ 2.598 r_s
  const bCrit = (Math.sqrt(27) / 2) * rs;
  const isCaptured = bMag <= bCrit;

  if (bMag < 1e-12 || isCaptured) {
    return {
      deflectionAngleRad: Math.PI,
      deflectionAngleArcsec: (Math.PI * 180 * 3600) / Math.PI,
      impactParameterAu: bMag,
      impactParameterKm: bMag * AU_KM,
      impactVector: { x: bx, y: by, z: bz },
      deflectedDirection: { x: -rayDir.x, y: -rayDir.y, z: -rayDir.z },
      schwarzschildRadiusAu: rs,
      photonSphereRadiusAu: rph,
      isCaptured: true,
    };
  }

  // Einstein deflection angle in weak field: theta = 4 G M / (c^2 * b)
  // [AU^3/day^2] / ([AU/day]^2 * [AU]) = dimensionless radians
  const cSq = SPEED_OF_LIGHT_AU_DAY * SPEED_OF_LIGHT_AU_DAY;
  const deflectionAngleRad = (4 * gmInternal) / (cSq * bMag);
  const deflectionAngleArcsec = (deflectionAngleRad * 180 * 3600) / Math.PI;

  // Deflection vector points towards the lens: unit vector is -b / ||b||
  const unitB: Vector3D = { x: bx / bMag, y: by / bMag, z: bz / bMag };

  // Deflected direction: rayDir rotated towards lens by deflectionAngleRad
  // deltaRay = -sin(theta) * unitB + (cos(theta) - 1) * rayDir
  const sinTh = Math.sin(deflectionAngleRad);
  const cosTh = Math.cos(deflectionAngleRad);

  const defX = rayDir.x * cosTh - unitB.x * sinTh;
  const defY = rayDir.y * cosTh - unitB.y * sinTh;
  const defZ = rayDir.z * cosTh - unitB.z * sinTh;

  return {
    deflectionAngleRad,
    deflectionAngleArcsec,
    impactParameterAu: bMag,
    impactParameterKm: bMag * AU_KM,
    impactVector: { x: bx, y: by, z: bz },
    deflectedDirection: normalize({ x: defX, y: defY, z: defZ }),
    schwarzschildRadiusAu: rs,
    photonSphereRadiusAu: rph,
    isCaptured: false,
  };
}

/**
 * Computes the Einstein ring angular and physical radius for an aligned lens and source.
 *
 * @param gmInternal Gravitational parameter of the lens (AU^3/day^2)
 * @param dLens Distance from observer to lens (AU)
 * @param dSource Distance from observer to source (AU)
 */
export function computeEinsteinRing(
  gmInternal: number,
  dLens: number,
  dSource: number,
): EinsteinRingResult {
  if (dSource <= dLens || dLens <= 0) {
    return { thetaERad: 0, thetaEArcsec: 0, physicalRadiusAu: 0 };
  }

  const dLensSource = dSource - dLens;
  const cSq = SPEED_OF_LIGHT_AU_DAY * SPEED_OF_LIGHT_AU_DAY;

  // theta_E = sqrt(4 G M / c^2 * D_LS / (D_L * D_S))
  const thetaESq = ((4 * gmInternal) / cSq) * (dLensSource / (dLens * dSource));
  const thetaERad = Math.sqrt(Math.max(0, thetaESq));
  const thetaEArcsec = (thetaERad * 180 * 3600) / Math.PI;
  const physicalRadiusAu = thetaERad * dLens;

  return {
    thetaERad,
    thetaEArcsec,
    physicalRadiusAu,
  };
}
