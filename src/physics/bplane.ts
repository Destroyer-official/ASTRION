/**
 * B-Plane Targeting & Hyperbolic Encounter Geometry
 * =================================================
 *
 * Implements the JPL/CNES standard B-plane (body-plane) targeting coordinate
 * system for interplanetary flyby design and Trajectory Correction Maneuver
 * (TCM) planning.
 *
 * The B-plane is the plane perpendicular to the incoming hyperbolic excess
 * velocity vector v_∞, passing through the target body's center of mass.
 * The B-vector is the offset from the body center to where the unperturbed
 * incoming asymptote pierces this plane.
 *
 * References:
 * - Kizner (1961): "A Method of Describing Miss Distances for Lunar and
 *   Interplanetary Trajectories", JPL External Publication 674
 * - Battin (1999): "An Introduction to the Mathematics and Methods of
 *   Astrodynamics", AIAA Education Series, Ch. 8
 * - Vallado (2013): "Fundamentals of Astrodynamics and Applications", 4th Ed.
 *
 * All units: AU (distances), AU/day (velocities), AU³/day² (GM).
 * Pure physics — no DOM, no Three.js, no Date.now().
 */

import type { Vec3 } from './types';

/* ── tiny vec3 helpers (no external deps) ─────────────────────────── */
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mag = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (k: number, a: Vec3): Vec3 => [k * a[0], k * a[1], k * a[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: Vec3): Vec3 => {
  const m = mag(a);
  return m > 0 ? [a[0] / m, a[1] / m, a[2] / m] : [0, 0, 0];
};

/* ── B-plane coordinate frame (S, T, R) ──────────────────────────── */

/**
 * B-plane coordinate frame: S (asymptote), T (in-plane), R (out-of-plane).
 * S = v_∞ / |v_∞| (incoming asymptote direction)
 * T = (k × S) / |k × S| (transverse, reference: ecliptic north pole k = [0,0,1])
 * R = S × T (completes right-handed triad)
 */
export interface BPlaneFrame {
  /** Unit vector along incoming asymptote (v_∞ direction) */
  S: Vec3;
  /** Transverse unit vector in B-plane (ecliptic-referenced) */
  T: Vec3;
  /** Normal unit vector in B-plane (S × T) */
  R: Vec3;
}

/**
 * Complete B-plane targeting result for a hyperbolic encounter.
 */
export interface BPlaneResult {
  /** B-plane coordinate frame */
  frame: BPlaneFrame;
  /** B-vector (offset from body center to asymptote piercing point) in AU */
  B: Vec3;
  /** B-vector magnitude (impact parameter) in AU */
  Bmag: number;
  /** B·T projection (in-plane component) in AU */
  BdotT: number;
  /** B·R projection (out-of-plane component) in AU */
  BdotR: number;
  /** B-plane angle θ = atan2(B·R, B·T) in radians */
  theta: number;
  /** Hyperbolic excess velocity magnitude |v_∞| in AU/day */
  vInfMag: number;
  /** Hyperbolic eccentricity (e > 1) */
  eccentricity: number;
  /** Semi-major axis of hyperbola (negative for bound orbits) in AU */
  semiMajorAxis: number;
  /** Periapsis radius (closest approach distance from body center) in AU */
  periapsisRadius: number;
  /** Hyperbolic turn angle δ (total bending) in radians */
  turnAngle: number;
  /** Periapsis velocity in AU/day */
  periapsisVelocity: number;
}

/**
 * Constructs the B-plane coordinate frame from the incoming v_∞ vector.
 *
 * The reference vector k defaults to ecliptic north pole [0, 0, 1].
 * If v_∞ is nearly parallel to k (polar approaches), the function
 * automatically switches to the x-axis as reference.
 */
export function computeBPlaneFrame(
  vInf: Vec3,
  kRef: Vec3 = [0, 0, 1],
): BPlaneFrame {
  const S = unit(vInf);

  // Guard against v_∞ parallel to reference vector
  let kxS = cross(kRef, S);
  if (mag(kxS) < 1e-10) {
    kxS = cross([1, 0, 0], S);
  }
  const T = unit(kxS);
  const R = cross(S, T);

  return { S, T, R };
}

/**
 * Computes the full B-plane targeting parameters from a spacecraft state
 * relative to the target body.
 *
 * @param mu  Gravitational parameter of the target body (AU³/day²)
 * @param r   Position of spacecraft relative to target body (AU)
 * @param v   Velocity of spacecraft relative to target body (AU/day)
 * @returns   Complete B-plane targeting result
 * @throws    If the orbit is not hyperbolic (energy ≤ 0)
 */
export function computeBPlane(mu: number, r: Vec3, v: Vec3): BPlaneResult {
  const rMag = mag(r);
  const vMag = mag(v);

  // Specific orbital energy: ε = v²/2 - μ/r
  const energy = (vMag * vMag) / 2 - mu / rMag;
  if (energy <= 0) {
    throw new Error('B-plane is only defined for hyperbolic orbits (energy > 0)');
  }

  // Hyperbolic excess velocity
  const vInfMag = Math.sqrt(2 * energy);

  // Specific angular momentum h = r × v
  const h = cross(r, v);

  // Eccentricity vector: e = (v × h)/μ - r/|r|
  const vxh = cross(v, h);
  const eVec: Vec3 = [vxh[0] / mu - r[0] / rMag, vxh[1] / mu - r[1] / rMag, vxh[2] / mu - r[2] / rMag];
  const e = mag(eVec);

  // Semi-major axis (negative for hyperbola)
  const a = -mu / (2 * energy);

  // Periapsis radius
  const rp = a * (1 - e);

  // B-plane frame
  // Incoming asymptote direction: v_∞ = v - (μ/h)(h × e_hat / |e|)
  // For the asymptote, use the v_∞ vector:
  // v_∞_in = v_inf * S where S is along the incoming asymptote
  // The incoming asymptote direction can be found from the orbit plane
  // and the asymptotic half-angle β = acos(1/e)
  const beta = Math.acos(1 / e); // asymptotic half-angle

  // e_hat (periapsis direction) and h_hat (angular momentum direction)
  const eHat = unit(eVec);
  const hHat = unit(h);

  // Perpendicular to e in the orbit plane: p_hat = h_hat × e_hat
  const pHat = cross(hHat, eHat);

  // Incoming asymptote direction (approaching from infinity):
  // S_in = -cos(β) * e_hat + sin(β) * p_hat  (incoming, before periapsis)
  const sinBeta = Math.sin(beta);
  const cosBeta = Math.cos(beta);
  const vInfDir: Vec3 = [
    -cosBeta * eHat[0] + sinBeta * pHat[0],
    -cosBeta * eHat[1] + sinBeta * pHat[1],
    -cosBeta * eHat[2] + sinBeta * pHat[2],
  ];

  const frame = computeBPlaneFrame(vInfDir);

  // B-vector: B = (h/v_∞) * (S × h_hat × S) simplified to
  // B = b * b_hat where b = h/v_∞ = |a|*sqrt(e²-1)
  // and b_hat is perpendicular to S in the orbit plane
  const bMag = Math.abs(a) * Math.sqrt(e * e - 1);

  // B-vector direction: perpendicular to S, in the plane containing S and h
  // B = (h × S) / v_∞  — this gives the correct B-vector
  const hCrossVinf = cross(h, vInfDir);
  const bHat = unit(hCrossVinf);
  const B: Vec3 = scale(bMag, bHat);

  // Project onto T and R
  const BdotT = dot(B, frame.T);
  const BdotR = dot(B, frame.R);
  const theta = Math.atan2(BdotR, BdotT);

  // Hyperbolic turn angle: δ = 2 * arcsin(1/e)
  const turnAngle = 2 * Math.asin(1 / e);

  // Periapsis velocity: v_p = sqrt(v_∞² + 2μ/r_p)
  const vPeri = Math.sqrt(vInfMag * vInfMag + 2 * mu / rp);

  return {
    frame,
    B,
    Bmag: bMag,
    BdotT,
    BdotR,
    theta,
    vInfMag,
    eccentricity: e,
    semiMajorAxis: a,
    periapsisRadius: rp,
    turnAngle,
    periapsisVelocity: vPeri,
  };
}

/**
 * Converts a desired periapsis radius to the required B-plane magnitude.
 *
 * B = r_p * sqrt(1 + 2μ/(r_p * v_∞²))
 *
 * @param mu    Gravitational parameter (AU³/day²)
 * @param rp    Desired periapsis radius (AU)
 * @param vInf  Hyperbolic excess velocity magnitude (AU/day)
 * @returns     Required B-plane magnitude (AU)
 */
export function periapsisToBMag(mu: number, rp: number, vInf: number): number {
  return rp * Math.sqrt(1 + (2 * mu) / (rp * vInf * vInf));
}

/**
 * Converts a B-plane magnitude to the resulting periapsis radius.
 *
 * r_p = (μ/v_∞²) * (sqrt(1 + (B²v_∞⁴)/μ²) - 1)
 *
 * @param mu    Gravitational parameter (AU³/day²)
 * @param B     B-plane magnitude (AU)
 * @param vInf  Hyperbolic excess velocity magnitude (AU/day)
 * @returns     Periapsis radius (AU)
 */
export function bMagToPeriapsis(mu: number, B: number, vInf: number): number {
  const ratio = (B * vInf * vInf) / mu;
  return (mu / (vInf * vInf)) * (Math.sqrt(1 + ratio * ratio) - 1);
}

/**
 * Computes the hyperbolic turn angle (total velocity bending) for a flyby.
 *
 * δ = 2 * arcsin(1/e)
 * where e = 1 + r_p * v_∞² / μ
 *
 * @param mu    Gravitational parameter of flyby body (AU³/day²)
 * @param rp    Periapsis radius (AU)
 * @param vInf  Hyperbolic excess velocity magnitude (AU/day)
 * @returns     Turn angle in radians
 */
export function hyperbolicTurnAngle(mu: number, rp: number, vInf: number): number {
  const e = 1 + (rp * vInf * vInf) / mu;
  return 2 * Math.asin(1 / e);
}

/**
 * Computes the heliocentric velocity gain (or loss) from a gravity assist flyby.
 *
 * Given the incoming heliocentric velocity, planet velocity, periapsis radius,
 * and flyby plane normal, computes the outgoing heliocentric velocity after
 * v_∞ rotation by the turn angle δ.
 *
 * @param vScIn    Incoming heliocentric spacecraft velocity (AU/day)
 * @param vPlanet  Heliocentric planet velocity (AU/day)
 * @param mu       Planet gravitational parameter (AU³/day²)
 * @param rp       Periapsis radius (AU)
 * @param flybyPlaneNormal  Normal to the flyby plane (determines prograde/retrograde)
 * @returns        Outgoing heliocentric spacecraft velocity (AU/day)
 */
export function gravityAssistFlyby(
  vScIn: Vec3,
  vPlanet: Vec3,
  mu: number,
  rp: number,
  flybyPlaneNormal: Vec3,
): { vScOut: Vec3; deltaV: Vec3; turnAngleDeg: number; vInfMag: number } {
  // v_∞ incoming (planet-relative)
  const vInfIn = sub(vScIn, vPlanet);
  const vInfMag = mag(vInfIn);

  // Turn angle
  const delta = hyperbolicTurnAngle(mu, rp, vInfMag);

  // Rotate v_∞ by turn angle δ about the flyby plane normal
  // Using Rodrigues' rotation formula:
  // v_rot = v*cos(δ) + (n × v)*sin(δ) + n*(n·v)*(1 - cos(δ))
  const n = unit(flybyPlaneNormal);
  const cosD = Math.cos(delta);
  const sinD = Math.sin(delta);
  const nxV = cross(n, vInfIn);
  const ndV = dot(n, vInfIn);

  const vInfOut: Vec3 = [
    vInfIn[0] * cosD + nxV[0] * sinD + n[0] * ndV * (1 - cosD),
    vInfIn[1] * cosD + nxV[1] * sinD + n[1] * ndV * (1 - cosD),
    vInfIn[2] * cosD + nxV[2] * sinD + n[2] * ndV * (1 - cosD),
  ];

  // Verify v_∞ magnitude conservation (energy conservation in planet frame)
  // |v_∞_out| should equal |v_∞_in|

  // Convert back to heliocentric frame
  const vScOut = add(vInfOut, vPlanet);
  const deltaV = sub(vScOut, vScIn);

  return {
    vScOut,
    deltaV,
    turnAngleDeg: (delta * 180) / Math.PI,
    vInfMag,
  };
}
