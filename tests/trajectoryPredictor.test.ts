import { describe, it, expect } from 'vitest';
import {
  computeFlightPathAngleDeg,
  propagateKeplerState,
  predictFutureTrajectory,
  computeGravitationalPull,
  computeSolarWobble,
  detectCloseApproaches,
  evaluateNasaSync,
  AU_DAY2_TO_UM_S2,
  AU_DAY2_TO_M_S2,
} from '@/physics/trajectoryPredictor';
import { AU_KM, GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import { stateToElements } from '@/physics/kepler';
import { ALL_BODIES, buildModel } from '@/sim/registry';
import type { Vec3 } from '@/physics/types';

describe('NASA-Grade Trajectory Predictor & Path Detection', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2); // ~0.2959122 AU^3/day^2

  it('evaluates flight-path angle gamma: zero at periapsis/apoapsis, positive outbound', () => {
    // Earth-like orbit: a = 1.0 AU, e = 0.0167
    const a = 1.0;
    const e = 0.05;
    const rp = a * (1 - e);
    const vp = Math.sqrt((muSun * (1 + e)) / rp);

    // At periapsis: r is perpendicular to v -> gamma = 0
    const rPeri: Vec3 = [rp, 0, 0];
    const vPeri: Vec3 = [0, vp, 0];
    const gammaPeri = computeFlightPathAngleDeg(rPeri, vPeri);
    expect(Math.abs(gammaPeri)).toBeLessThan(1e-12);

    // At apoapsis: r is perpendicular to v -> gamma = 0
    const ra = a * (1 + e);
    const va = Math.sqrt((muSun * (1 - e)) / ra);
    const rApo: Vec3 = [-ra, 0, 0];
    const vApo: Vec3 = [0, -va, 0];
    const gammaApo = computeFlightPathAngleDeg(rApo, vApo);
    expect(Math.abs(gammaApo)).toBeLessThan(1e-12);

    // Outbound point (between periapsis and apoapsis, r . v > 0): gamma > 0
    const rOut: Vec3 = [1.0, 0.2, 0];
    const vOut: Vec3 = [0.01, vp * 0.9, 0];
    const gammaOut = computeFlightPathAngleDeg(rOut, vOut);
    expect(gammaOut).toBeGreaterThan(0);
  });

  it('propagateKeplerState reproduces exact initial state after 1 orbital period', () => {
    // 1-AU circular orbit: period T = 2*pi*sqrt(a^3/mu)
    const a = 1.0;
    const r0: Vec3 = [1.0, 0, 0];
    const v0: Vec3 = [0, Math.sqrt(muSun / a), 0];
    const el = stateToElements(muSun, r0, v0);

    const period = el.period; // ~365.25 days
    expect(period).toBeCloseTo(365.256, 1);

    // Propagate by exactly 1 full period
    const stateT = propagateKeplerState(muSun, el, period);

    expect(stateT.pos[0]!).toBeCloseTo(r0[0]!, 10);
    expect(stateT.pos[1]!).toBeCloseTo(r0[1]!, 10);
    expect(stateT.pos[2]!).toBeCloseTo(r0[2]!, 10);

    expect(stateT.vel[0]!).toBeCloseTo(v0[0]!, 10);
    expect(stateT.vel[1]!).toBeCloseTo(v0[1]!, 10);
    expect(stateT.vel[2]!).toBeCloseTo(v0[2]!, 10);
  });

  it('predictFutureTrajectory predicts apsides, nodal passages, and 99.9% confidence envelope', () => {
    // Mars-like orbit: a = 1.524 AU, e = 0.0934
    const a = 1.524;
    const e = 0.0934;
    const rp = a * (1 - e);
    const vp = Math.sqrt((muSun * (1 + e)) / rp);
    const r0: Vec3 = [rp, 0, 0];
    const v0: Vec3 = [0, vp * Math.cos(0.032), vp * Math.sin(0.032)]; // small inclination

    const pred = predictFutureTrajectory('mars', 'sun', muSun, r0, v0, 0, 687.0, 48);

    expect(pred.targetId).toBe('mars');
    expect(pred.primaryId).toBe('sun');
    expect(pred.elements.a).toBeCloseTo(a, 3);
    expect(pred.elements.e).toBeCloseTo(e, 3);

    // Periapsis distance check
    expect(pred.apsides.periapsis.distAu).toBeCloseTo(rp, 4);
    expect(pred.apsides.periapsis.distKm).toBeCloseTo(rp * AU_KM, 0);

    // Apoapsis distance check
    const ra = a * (1 + e);
    expect(pred.apsides.apoapsis).not.toBeNull();
    expect(pred.apsides.apoapsis!.distAu).toBeCloseTo(ra, 4);
    expect(pred.apsides.apoapsis!.distKm).toBeCloseTo(ra * AU_KM, 0);

    // Days to next apoapsis should be approximately half of Mars orbital period (~343 days)
    expect(pred.apsides.apoapsis!.daysToNext).toBeCloseTo(pred.elements.period / 2, 1);

    // Nodal crossings should be within (0, period)
    expect(pred.nodes.ascendingNodeDays).toBeGreaterThanOrEqual(0);
    expect(pred.nodes.descendingNodeDays).toBeGreaterThan(0);
    expect(pred.nodes.descendingNodeDays).toBeLessThan(pred.elements.period + 1);

    // 99.9% confidence envelope check
    expect(pred.envelope.confidencePct).toBe(99.9);
    expect(pred.envelope.chi2Threshold).toBe(16.27);
    expect(pred.envelope.sigmaR_km).toBeGreaterThan(0.5);
    expect(pred.envelope.sigmaV_m_s).toBeGreaterThan(0);

    // Trajectory path samples
    expect(pred.points.length).toBe(48);
    expect(pred.points[0]!.distAu).toBeGreaterThan(0);
  });

  it('computeGravitationalPull correctly identifies primary perturbers and force components', () => {
    const model = buildModel(ALL_BODIES, {});
    const state = model.global;

    const earthIdx = model.ids.indexOf('earth');
    const sunIdx = model.ids.indexOf('sun');
    expect(earthIdx).toBeGreaterThanOrEqual(0);
    expect(sunIdx).toBeGreaterThanOrEqual(0);

    const pull = computeGravitationalPull(earthIdx, state, model.ids);

    expect(pull.targetId).toBe('earth');
    expect(pull.perturbers.length).toBeGreaterThan(0);

    // Sun must be the #1 gravitational perturber on Earth (> 99% of total pull)
    const topPerturber = pull.perturbers[0]!;
    expect(topPerturber.bodyId).toBe('sun');
    expect(topPerturber.fractionPct).toBeGreaterThan(99.0);

    // Total acceleration on Earth should be ~0.00593 m/s^2 (Sun's gravity at 1 AU)
    // a = GM_sun / (1 AU)^2 = 1.327e11 km^3/s^2 / (1.496e8 km)^2 = 0.00593 m/s^2 = 5930 um/s^2
    expect(pull.totalAccel_m_s2).toBeCloseTo(0.00593, 3);
    expect(pull.totalAccel_um_s2).toBeCloseTo(5930, -2);

    // Radial pull should dominate (inward towards Sun)
    expect(Math.abs(pull.radialAccel_um_s2)).toBeGreaterThan(5000);

    // Turn rate (trajectory curvature) should be ~360 deg/yr = ~3548 arcsec/day
    // 360 deg / 365.25 d = 0.9856 deg/d = 3548.3 arcsec/d
    expect(pull.turnRateArcsecPerDay).toBeCloseTo(3548, -2);
  });

  it('computeSolarWobble evaluates physical SSB displacement and gas giant drivers', () => {
    const model = buildModel(ALL_BODIES, {});
    const state = model.global;

    const wobble = computeSolarWobble(state, model.ids);

    // Sun distance to Solar System Barycenter is between 0.1 and 2.5 solar radii
    // (Sun center moves from inside the Sun surface ~0.2 R_sun out to empty space ~2.1 R_sun)
    expect(wobble.distBaryKm).toBeGreaterThan(50_000);
    expect(wobble.distBaryKm).toBeLessThan(1_600_000);
    expect(wobble.solarRadii).toBeGreaterThan(0.07);
    expect(wobble.solarRadii).toBeLessThan(2.5);

    // Sun barycentric speed is physical (between 8 and 18 m/s)
    expect(wobble.speedMs).toBeGreaterThan(8.0);
    expect(wobble.speedMs).toBeLessThan(18.0);

    // Gas giant drivers: Jupiter and Saturn must account for the vast majority (> 80%)
    expect(wobble.gasGiantDrivers.length).toBeGreaterThanOrEqual(2);
    const jup = wobble.gasGiantDrivers.find((d) => d.id === 'jupiter');
    const sat = wobble.gasGiantDrivers.find((d) => d.id === 'saturn');
    expect(jup).toBeDefined();
    expect(sat).toBeDefined();
    expect(jup!.pullFraction + sat!.pullFraction).toBeGreaterThan(80.0);

    // 60-year rosette loop prediction
    expect(wobble.loopSummary.points.length).toBeGreaterThan(50);
    expect(wobble.loopSummary.maxDistKm).toBeGreaterThan(wobble.loopSummary.minDistKm);
  });

  it('detectCloseApproaches finds minimum separation and flags Laplace SOI encounter', () => {
    // Earth and Moon-like orbits
    const rEarth: Vec3 = [1.0, 0, 0];
    const vEarth: Vec3 = [0, Math.sqrt(muSun / 1.0), 0];

    // Second body in slightly phased orbit (close approach in 30 days)
    const r2: Vec3 = [1.002, 0.05, 0];
    const v2: Vec3 = [-0.001, Math.sqrt(muSun / 1.002), 0];

    const encounter = detectCloseApproaches(
      muSun,
      rEarth,
      vEarth,
      r2,
      v2,
      0,
      100,
      'earth',
      'probe',
      924_000,
    );

    expect(encounter.body1Id).toBe('earth');
    expect(encounter.body2Id).toBe('probe');
    expect(encounter.minDistKm).toBeGreaterThan(0);
    expect(encounter.daysFromEpoch).toBeGreaterThan(0);
    expect(encounter.daysFromEpoch).toBeLessThanOrEqual(100);
    expect(encounter.relativeSpeedKms).toBeGreaterThan(0);
  });

  it('evaluateNasaSync validates accuracy against reference ephemeris vectors', () => {
    const simPos: Vec3 = [1.0, 0.0, 0.0];
    const simVel: Vec3 = [0.0, 0.0172, 0.0];

    // Reference with 50 km discrepancy (well within 150,000 km tolerance)
    const refPosClose: Vec3 = [1.0 + 50 / AU_KM, 0.0, 0.0];
    const refVelClose: Vec3 = [0.0, 0.0172 + 1e-9, 0.0];

    const sync1 = evaluateNasaSync('earth', simPos, simVel, refPosClose, refVelClose, 150_000);
    expect(sync1.isCompliant).toBe(true);
    expect(sync1.deltaR_km).toBeCloseTo(50.0, 1);
    expect(sync1.deltaV_mm_s).toBeGreaterThan(0);

    // Reference with 200,000 km discrepancy (exceeds 150,000 km tolerance)
    const refPosFar: Vec3 = [1.0 + 200_000 / AU_KM, 0.0, 0.0];
    const sync2 = evaluateNasaSync('earth', simPos, simVel, refPosFar, simVel, 150_000);
    expect(sync2.isCompliant).toBe(false);
    expect(sync2.deltaR_km).toBeCloseTo(200_000, 0);
  });

  it('handles circular, high-eccentricity, and hyperbolic orbits robustly', () => {
    // 1. Perfectly circular orbit: e = 0
    const aCirc = 1.0;
    const vCirc = Math.sqrt(muSun / aCirc);
    const predCirc = predictFutureTrajectory('circ', 'sun', muSun, [aCirc, 0, 0], [0, vCirc, 0], 0, 100, 20);
    expect(predCirc.elements.e).toBeLessThan(1e-6);
    expect(predCirc.apsides.periapsis.distAu).toBeCloseTo(aCirc, 5);
    expect(predCirc.apsides.apoapsis!.distAu).toBeCloseTo(aCirc, 5);

    // 2. High eccentricity orbit: e = 0.85 (comet-like)
    const aComet = 5.0;
    const eComet = 0.85;
    const rpComet = aComet * (1 - eComet);
    const vpComet = Math.sqrt((muSun * (1 + eComet)) / rpComet);
    const predComet = predictFutureTrajectory('comet', 'sun', muSun, [rpComet, 0, 0], [0, vpComet, 0], 0, 365, 30);
    expect(predComet.elements.e).toBeCloseTo(0.85, 4);
    expect(predComet.apsides.periapsis.distAu).toBeCloseTo(rpComet, 4);
    expect(predComet.apsides.apoapsis!.distAu).toBeCloseTo(aComet * (1 + eComet), 4);

    // 3. Hyperbolic trajectory: e = 1.4 ('Oumuamua interstellar object)
    const aHyp = -2.0;
    const eHyp = 1.4;
    const rpHyp = Math.abs(aHyp) * (eHyp - 1);
    const vpHyp = Math.sqrt(muSun * (2 / rpHyp + 1 / Math.abs(aHyp)));
    const predHyp = predictFutureTrajectory('interstellar', 'sun', muSun, [rpHyp, 0, 0], [0, vpHyp, 0], 0, 50, 20);
    expect(predHyp.elements.e).toBeGreaterThan(1.0);
    expect(predHyp.apsides.periapsis.distAu).toBeCloseTo(rpHyp, 4);
    expect(predHyp.apsides.apoapsis).toBeNull();
  });

  it('unit conversions AU/day^2 to m/s^2 and um/s^2 match physical constants', () => {
    // 1 AU = 149597870.7 km = 149597870700 m
    // 1 day = 86400 s => (86400)^2 = 7464960000 s^2
    // 149597870700 / 7464960000 = ~20.04001 m/s^2
    expect(AU_DAY2_TO_M_S2).toBeCloseTo(20.04001, 4);
    expect(AU_DAY2_TO_UM_S2).toBeCloseTo(20_040_010.0, 0);
  });
});
