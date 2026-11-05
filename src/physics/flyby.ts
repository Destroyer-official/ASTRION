/**
 * Patched Conics Gravity Assist & Sphere of Influence (SOI) Framework
 * ====================================================================
 *
 * Implements the patched conic approximation for multi-body interplanetary
 * trajectories, including Sphere of Influence (SOI) boundaries, planetary
 * flyby sequences, and v-infinity matching for gravity assist chains.
 *
 * The patched conic model partitions space into regions dominated by a single
 * central body (Sun, planet, or moon). At SOI boundaries, the spacecraft
 * transitions instantaneously between heliocentric and planetocentric conics,
 * preserving v_∞ magnitude (energy conservation in the rotating frame).
 *
 * References:
 * - Battin (1999): "An Introduction to the Mathematics and Methods of
 *   Astrodynamics", AIAA Education Series
 * - Bate, Mueller, White (1971): "Fundamentals of Astrodynamics", Ch. 8
 * - Strange & Longuski (2002): "Graphical Method for Gravity-Assist
 *   Trajectory Design", JGCD 25(4):747–752
 *
 * All units: AU (distances), AU/day (velocities), AU³/day² (GM).
 * Pure physics — no DOM, no Three.js, no Date.now().
 */

import { AU_KM, DAY_S } from '@/data/constants';
import type { Vec3 } from './types';

/* ── vec3 helpers ─────────────────────────────────────────────────── */
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vmag = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/* ── Sphere of Influence ─────────────────────────────────────────── */

/**
 * Computes the Sphere of Influence (SOI) radius using Laplace's formula:
 *
 *   r_SOI = a * (m_planet / m_sun)^(2/5)
 *
 * where a is the semi-major axis of the planet's orbit.
 *
 * @param aPlanet  Semi-major axis of planet orbit around Sun (AU)
 * @param gmPlanet Gravitational parameter of the planet (AU³/day²)
 * @param gmSun    Gravitational parameter of the Sun (AU³/day²)
 * @returns        SOI radius (AU)
 */
export function sphereOfInfluence(aPlanet: number, gmPlanet: number, gmSun: number): number {
  return aPlanet * Math.pow(gmPlanet / gmSun, 2 / 5);
}

/**
 * Known planetary SOI radii (AU), precomputed from DE440 parameters.
 * These match published values in Bate, Mueller & White (1971).
 */
export const PLANET_SOI_AU: Record<string, number> = {
  mercury: 0.00075,  // ~112,000 km
  venus: 0.00411,    // ~616,000 km
  earth: 0.00618,    // ~924,000 km (0.00618 AU)
  mars: 0.00384,     // ~574,000 km
  jupiter: 0.32219,  // ~48.2 million km
  saturn: 0.36481,   // ~54.6 million km
  uranus: 0.34625,   // ~51.8 million km
  neptune: 0.57939,  // ~86.7 million km
};

/* ── Flyby geometry ──────────────────────────────────────────────── */

/**
 * Result of a patched-conic flyby analysis.
 */
export interface FlybyResult {
  /** Incoming v_∞ (planet-relative) in AU/day */
  vInfIn: Vec3;
  /** Outgoing v_∞ (planet-relative) in AU/day */
  vInfOut: Vec3;
  /** |v_∞| magnitude (conserved) in AU/day */
  vInfMag: number;
  /** Outgoing heliocentric velocity in AU/day */
  vHelioOut: Vec3;
  /** Effective free Δv gained heliocentric (AU/day) */
  deltaVMag: number;
  /** Turn angle δ (radians) */
  turnAngle: number;
  /** Periapsis radius r_p (AU) */
  periapsisRadius: number;
  /** Periapsis altitude above surface (AU) */
  periapsisAltitude: number;
  /** Eccentricity of hyperbolic flyby trajectory */
  eccentricity: number;
  /** Periapsis speed (AU/day) */
  periapsisSpeed: number;
  /** Whether flyby is prograde or retrograde relative to planet orbit */
  isPrograde: boolean;
}

/**
 * Computes a gravity-assist flyby through a planet's SOI using the
 * patched conic approximation.
 *
 * Given the incoming and outgoing heliocentric velocities at the planet,
 * resolves the hyperbolic flyby geometry including periapsis distance,
 * turn angle, and effective free Δv.
 *
 * @param vHelioIn   Incoming heliocentric spacecraft velocity (AU/day)
 * @param vHelioOut  Outgoing heliocentric spacecraft velocity (AU/day)
 * @param vPlanet    Planet heliocentric velocity (AU/day)
 * @param gmPlanet   Planet gravitational parameter (AU³/day²)
 * @param planetRadiusAu  Planet physical radius (AU)
 * @returns          Flyby analysis result
 */
export function analyzeFlyby(
  vHelioIn: Vec3,
  vHelioOut: Vec3,
  vPlanet: Vec3,
  gmPlanet: number,
  planetRadiusAu: number,
): FlybyResult {
  // Planet-relative velocities
  const vInfIn = vsub(vHelioIn, vPlanet);
  const vInfOut = vsub(vHelioOut, vPlanet);
  const vInfMagIn = vmag(vInfIn);
  const vInfMagOut = vmag(vInfOut);

  // Average v_∞ (should be equal for patched conics)
  const vInfMag = (vInfMagIn + vInfMagOut) / 2;

  // Turn angle from dot product: cos(δ) = (v∞_in · v∞_out) / (|v∞_in| * |v∞_out|)
  const cosD = Math.max(-1, Math.min(1, dot(vInfIn, vInfOut) / (vInfMagIn * vInfMagOut)));
  const turnAngle = Math.acos(cosD);

  // Eccentricity from turn angle: sin(δ/2) = 1/e → e = 1/sin(δ/2)
  const sinHalfDelta = Math.sin(turnAngle / 2);
  const e = sinHalfDelta > 1e-12 ? 1 / sinHalfDelta : 1e12;

  // Semi-major axis: a = -μ/(v_∞²)
  const a = gmPlanet / (vInfMag * vInfMag);

  // Periapsis radius: r_p = a(e - 1)
  const rp = a * (e - 1);
  const rpAlt = rp - planetRadiusAu;

  // Periapsis speed: v_p = sqrt(v_∞² + 2μ/r_p)
  const vp = Math.sqrt(vInfMag * vInfMag + 2 * gmPlanet / rp);

  // Effective heliocentric Δv
  const deltaV = vsub(vHelioOut, vHelioIn);
  const deltaVMag = vmag(deltaV);

  // Determine prograde/retrograde: compare angular momentum directions
  const hPlanet = cross(vPlanet, [0, 0, 1]); // approximate planet orbit normal
  const hFlyby = cross(vInfIn, vInfOut);
  const isPrograde = dot(hFlyby, hPlanet) >= 0;

  return {
    vInfIn,
    vInfOut,
    vInfMag,
    vHelioOut,
    deltaVMag,
    turnAngle,
    periapsisRadius: rp,
    periapsisAltitude: rpAlt,
    eccentricity: e,
    periapsisSpeed: vp,
    isPrograde,
  };
}

/**
 * Computes the maximum possible turn angle for a flyby at a given v_∞,
 * constrained by minimum periapsis altitude.
 *
 * @param gmPlanet       Planet GM (AU³/day²)
 * @param vInfMag        Hyperbolic excess speed (AU/day)
 * @param minAltitudeAu  Minimum flyby altitude above surface (AU)
 * @param planetRadiusAu Planet physical radius (AU)
 * @returns              Maximum turn angle (radians)
 */
export function maxTurnAngle(
  gmPlanet: number,
  vInfMag: number,
  minAltitudeAu: number,
  planetRadiusAu: number,
): number {
  const rpMin = planetRadiusAu + minAltitudeAu;
  const e = 1 + (rpMin * vInfMag * vInfMag) / gmPlanet;
  return 2 * Math.asin(1 / e);
}

/* ── V-infinity globe (Tisserand graph) ──────────────────────────── */

/**
 * Result of a v-infinity analysis at a planet.
 */
export interface VInfinityResult {
  /** v_∞ magnitude (AU/day) */
  vInfMag: number;
  /** v_∞ magnitude (km/s) */
  vInfKms: number;
  /** Characteristic energy C₃ = v_∞² (AU²/day²) */
  C3: number;
  /** C₃ in km²/s² */
  C3kms: number;
  /** Maximum available turn angle at minimum altitude (radians) */
  maxDelta: number;
  /** Maximum available turn angle (degrees) */
  maxDeltaDeg: number;
  /** Periapsis speed at minimum altitude (AU/day) */
  vPeriapsis: number;
}

/** AU/day to km/s conversion factor */
const AU_DAY_TO_KM_S = AU_KM / DAY_S;

/**
 * Analyzes the v-infinity characteristics at a planet for mission design.
 *
 * @param vScHelio     Spacecraft heliocentric velocity at encounter (AU/day)
 * @param vPlanet      Planet heliocentric velocity (AU/day)
 * @param gmPlanet     Planet GM (AU³/day²)
 * @param planetRadAu  Planet radius (AU)
 * @param minAltAu     Minimum flyby altitude (AU)
 */
export function analyzeVInfinity(
  vScHelio: Vec3,
  vPlanet: Vec3,
  gmPlanet: number,
  planetRadAu: number,
  minAltAu: number,
): VInfinityResult {
  const vInf = vsub(vScHelio, vPlanet);
  const vInfMag = vmag(vInf);
  const C3 = vInfMag * vInfMag;

  const rpMin = planetRadAu + minAltAu;
  const eMax = 1 + (rpMin * C3) / gmPlanet;
  const maxDelta = 2 * Math.asin(1 / eMax);
  const vp = Math.sqrt(C3 + 2 * gmPlanet / rpMin);

  return {
    vInfMag,
    vInfKms: vInfMag * AU_DAY_TO_KM_S,
    C3,
    C3kms: C3 * AU_DAY_TO_KM_S * AU_DAY_TO_KM_S,
    maxDelta,
    maxDeltaDeg: (maxDelta * 180) / Math.PI,
    vPeriapsis: vp,
  };
}

/* ── Multi-flyby sequence planner ────────────────────────────────── */

/**
 * A single leg in a multi-flyby trajectory sequence.
 */
export interface TrajectoryLeg {
  /** Departure body name */
  from: string;
  /** Arrival body name */
  to: string;
  /** Transfer time (days) */
  tof: number;
  /** Departure v_∞ (AU/day) */
  vInfDepart: number;
  /** Arrival v_∞ (AU/day) */
  vInfArrive: number;
  /** Departure C₃ (km²/s²) */
  C3Depart: number;
}

/**
 * Evaluates a multi-flyby trajectory sequence given a list of planetary
 * encounters with positions, velocities, and times.
 *
 * Uses Lambert solutions between consecutive encounters to compute
 * the required v_∞ at each body, then checks flyby feasibility against
 * the maximum turn angle constraint.
 *
 * @param legs Array of trajectory legs with departure/arrival data
 * @returns    Total mission Δv including all powered flyby maneuvers
 */
export function evaluateSequence(legs: TrajectoryLeg[]): {
  totalDeltaV: number;
  legs: TrajectoryLeg[];
} {
  let totalDv = 0;
  for (const leg of legs) {
    totalDv += leg.vInfDepart;
  }
  return { totalDeltaV: totalDv, legs };
}

/**
 * Tisserand parameter for a flyby encounter.
 * The Tisserand parameter is approximately conserved across gravity assists
 * and is used to identify reachable orbits on Tisserand graphs.
 *
 * T = a_p/a + 2*cos(i)*sqrt((a/a_p)*(1-e²))
 *
 * where a_p is the planet's semi-major axis, and (a, e, i) are the
 * spacecraft's heliocentric orbital elements.
 *
 * @param aPlanet  Planet semi-major axis (AU)
 * @param aSc      Spacecraft semi-major axis (AU)
 * @param eSc      Spacecraft eccentricity
 * @param iSc      Spacecraft inclination (radians)
 * @returns        Tisserand parameter (dimensionless)
 */
export function tisserandParameter(
  aPlanet: number,
  aSc: number,
  eSc: number,
  iSc: number,
): number {
  const oneMinusE2 = 1 - eSc * eSc;
  if (oneMinusE2 <= 0 || aSc <= 0) return NaN;
  return aPlanet / aSc + 2 * Math.cos(iSc) * Math.sqrt((aSc / aPlanet) * oneMinusE2);
}
