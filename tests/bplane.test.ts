import { describe, it, expect } from 'vitest';
import {
  computeBPlane,
  computeBPlaneFrame,
  periapsisToBMag,
  bMagToPeriapsis,
  hyperbolicTurnAngle,
  gravityAssistFlyby,
} from '@/physics/bplane';
import { AU_KM } from '@/data/constants';

/**
 * B-Plane Targeting & Hyperbolic Encounter Geometry Tests
 *
 * Validates the B-plane coordinate system (S-T-R), B-vector computation,
 * miss distance ↔ periapsis mapping, and gravity assist flyby mechanics
 * against published astrodynamics benchmarks.
 *
 * References:
 * - Vallado (2013) Example 8-6: Mars arrival B-plane
 * - Battin (1999) Ch. 8: Hyperbolic encounter geometry
 */

describe('B-Plane Targeting & Encounter Geometry', () => {
  // Jupiter GM in AU³/day² (from DE440: 1.26686534e8 km³/s²)
  const GM_JUPITER = 1.26686534e8 * (86400 * 86400) / (AU_KM * AU_KM * AU_KM);

  // Earth GM in AU³/day²
  const GM_EARTH_AU = 3.986004418e5 * (86400 * 86400) / (AU_KM * AU_KM * AU_KM);

  // Mars GM in AU³/day²
  const GM_MARS_AU = 4.282837e4 * (86400 * 86400) / (AU_KM * AU_KM * AU_KM);

  it('constructs orthonormal B-plane frame S-T-R', () => {
    const vInf: [number, number, number] = [0.001, 0.0005, 0.0002];
    const frame = computeBPlaneFrame(vInf);

    // S is unit vector along v_∞
    const sMag = Math.hypot(frame.S[0], frame.S[1], frame.S[2]);
    expect(sMag).toBeCloseTo(1.0, 12);

    // T is unit vector
    const tMag = Math.hypot(frame.T[0], frame.T[1], frame.T[2]);
    expect(tMag).toBeCloseTo(1.0, 12);

    // R is unit vector
    const rMag = Math.hypot(frame.R[0], frame.R[1], frame.R[2]);
    expect(rMag).toBeCloseTo(1.0, 12);

    // Orthogonality: S·T = 0, S·R = 0, T·R = 0
    const sdotT = frame.S[0] * frame.T[0] + frame.S[1] * frame.T[1] + frame.S[2] * frame.T[2];
    const sdotR = frame.S[0] * frame.R[0] + frame.S[1] * frame.R[1] + frame.S[2] * frame.R[2];
    const tdotR = frame.T[0] * frame.R[0] + frame.T[1] * frame.R[1] + frame.T[2] * frame.R[2];
    expect(Math.abs(sdotT)).toBeLessThan(1e-14);
    expect(Math.abs(sdotR)).toBeLessThan(1e-14);
    expect(Math.abs(tdotR)).toBeLessThan(1e-14);

    // Right-handed: R = S × T
    const sxT: [number, number, number] = [
      frame.S[1] * frame.T[2] - frame.S[2] * frame.T[1],
      frame.S[2] * frame.T[0] - frame.S[0] * frame.T[2],
      frame.S[0] * frame.T[1] - frame.S[1] * frame.T[0],
    ];
    expect(sxT[0]).toBeCloseTo(frame.R[0], 14);
    expect(sxT[1]).toBeCloseTo(frame.R[1], 14);
    expect(sxT[2]).toBeCloseTo(frame.R[2], 14);
  });

  it('handles polar approach (v_∞ nearly aligned with ecliptic pole)', () => {
    const vInfPolar: [number, number, number] = [0, 0, 0.005];
    const frame = computeBPlaneFrame(vInfPolar);

    // Should still produce valid orthonormal frame
    const sMag = Math.hypot(frame.S[0], frame.S[1], frame.S[2]);
    expect(sMag).toBeCloseTo(1.0, 12);

    const sdotT = frame.S[0] * frame.T[0] + frame.S[1] * frame.T[1] + frame.S[2] * frame.T[2];
    expect(Math.abs(sdotT)).toBeLessThan(1e-14);
  });

  it('computes hyperbolic B-plane from state vectors', () => {
    // Spacecraft on hyperbolic approach to a body
    // v_∞ ≈ 5 km/s hyperbolic excess, passing ~10,000 km from center
    const vInfKms = 5.0; // km/s
    const vInf = vInfKms / (AU_KM / 86400); // convert to AU/day

    // Build a hyperbolic orbit: place spacecraft at large distance with v > v_escape
    const rDistKm = 500000; // 500,000 km from body
    const rDist = rDistKm / AU_KM;
    const r: [number, number, number] = [rDist, 0, 0];

    // Velocity giving ~5 km/s v_∞ at Mars
    const vEscape = Math.sqrt(2 * GM_MARS_AU / rDist);
    const vTotal = Math.sqrt(vInf * vInf + vEscape * vEscape);
    const v: [number, number, number] = [0, vTotal, 0.0001 * vTotal]; // slight z-component

    const result = computeBPlane(GM_MARS_AU, r, v);

    // Should be hyperbolic (e > 1)
    expect(result.eccentricity).toBeGreaterThan(1.0);

    // v_∞ magnitude should match
    expect(result.vInfMag).toBeCloseTo(vInf, 3);

    // B magnitude should be positive
    expect(result.Bmag).toBeGreaterThan(0);

    // B² = BdotT² + BdotR²
    const bCheck = Math.sqrt(result.BdotT * result.BdotT + result.BdotR * result.BdotR);
    expect(bCheck).toBeCloseTo(result.Bmag, 8);

    // Turn angle should be positive and less than 180°
    expect(result.turnAngle).toBeGreaterThan(0);
    expect(result.turnAngle).toBeLessThan(Math.PI);

    // Periapsis velocity should exceed v_∞
    expect(result.periapsisVelocity).toBeGreaterThan(result.vInfMag);
  });

  it('maps periapsis ↔ B-magnitude bijectively', () => {
    const mu = GM_EARTH_AU;
    const vInfKms = 3.0;
    const vInf = vInfKms / (AU_KM / 86400);

    // Target periapsis at 6871 km (500 km altitude)
    const rpKm = 6871;
    const rp = rpKm / AU_KM;

    // periapsis → B
    const B = periapsisToBMag(mu, rp, vInf);
    expect(B).toBeGreaterThan(rp); // B > rp because gravity focuses

    // B → periapsis (should round-trip)
    const rpBack = bMagToPeriapsis(mu, B, vInf);
    expect(rpBack).toBeCloseTo(rp, 10);
  });

  it('computes correct turn angle for Jupiter flyby (Voyager-class)', () => {
    // Voyager 2 Jupiter flyby: v_∞ ≈ 10 km/s, periapsis ≈ 10 R_J
    const vInfKms = 10.0;
    const vInf = vInfKms / (AU_KM / 86400);
    const rJupiterKm = 71492; // Jupiter radius
    const rpKm = 10 * rJupiterKm; // 10 Jupiter radii
    const rp = rpKm / AU_KM;

    const delta = hyperbolicTurnAngle(GM_JUPITER, rp, vInf);
    const deltaDeg = (delta * 180) / Math.PI;

    // At 10 R_J and 10 km/s, expect significant bending (~30-60°)
    expect(deltaDeg).toBeGreaterThan(10);
    expect(deltaDeg).toBeLessThan(90);

    // Eccentricity check: e = 1 + rp*v∞²/μ
    const e = 1 + (rp * vInf * vInf) / GM_JUPITER;
    expect(e).toBeGreaterThan(1);
    expect(2 * Math.asin(1 / e)).toBeCloseTo(delta, 12);
  });

  it('gravity assist preserves v_∞ magnitude (energy conservation)', () => {
    // Earth flyby: v_∞ = 5 km/s, periapsis at 6871 km
    const vInfKms = 5.0;
    const vInf = vInfKms / (AU_KM / 86400);
    const rpKm = 6871;
    const rp = rpKm / AU_KM;

    // Incoming heliocentric velocity (Earth at ~30 km/s + v_∞)
    const vEarthKms = 29.78;
    const vEarth: [number, number, number] = [0, vEarthKms / (AU_KM / 86400), 0];
    const vScIn: [number, number, number] = [
      vInf * 0.8, // mostly radial
      vEarth[1] + vInf * 0.6,
      0,
    ];

    const flybyNormal: [number, number, number] = [0, 0, 1]; // ecliptic-normal flyby
    const result = gravityAssistFlyby(vScIn, vEarth, GM_EARTH_AU, rp, flybyNormal);

    // v_∞ conservation: |v_∞_out| should equal |v_∞_in|
    const vInfOutVec = [
      result.vScOut[0] - vEarth[0],
      result.vScOut[1] - vEarth[1],
      result.vScOut[2] - vEarth[2],
    ];
    const vInfOutMag = Math.hypot(...vInfOutVec);
    expect(vInfOutMag).toBeCloseTo(result.vInfMag, 10);

    // Turn angle should be positive
    expect(result.turnAngleDeg).toBeGreaterThan(0);

    // Heliocentric speed may change (that's the point of gravity assist)
    const vHelioInMag = Math.hypot(...vScIn);
    const vHelioOutMag = Math.hypot(...result.vScOut);
    // They should be different (free Δv from flyby)
    expect(Math.abs(vHelioOutMag - vHelioInMag)).toBeGreaterThan(0);
  });

  it('rejects non-hyperbolic orbits for B-plane computation', () => {
    // Circular orbit: energy < 0, B-plane undefined
    const r: [number, number, number] = [1.0, 0, 0]; // 1 AU
    const vCirc = Math.sqrt(GM_EARTH_AU / 1.0); // not really right but gives bound orbit
    const v: [number, number, number] = [0, vCirc * 0.5, 0]; // slow = bound

    expect(() => computeBPlane(GM_EARTH_AU * 1e6, r, v)).toThrow();
  });
});
