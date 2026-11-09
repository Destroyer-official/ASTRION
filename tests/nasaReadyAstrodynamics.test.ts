import { describe, it, expect } from 'vitest';
import {
  predictFutureTrajectory,
  computeGravitationalPull,
  computeSolarWobble,
} from '@/physics/trajectoryPredictor';
import { AU_KM, GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import { ALL_BODIES, buildModel } from '@/sim/registry';
import { universeBackbone } from '@/universe/universePhysicsBackbone';
import { createUniversalCoordinate, METERS_PER_AU } from '@/universe/cosmicScaleEngine';
import type { Vec3 } from '@/physics/types';

describe('NASA-Ready Astrodynamics, 99.9% Trajectory & Universe Backbone Verification', () => {
  const model = buildModel(ALL_BODIES, {});
  const state = model.global;
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  const sunIdx = model.ids.indexOf('sun');
  const earthIdx = model.ids.indexOf('earth');
  const moonIdx = model.ids.indexOf('moon');

  it('computes pure heliocentric Keplerian orbit for Earth relative to Sun (not SSB offset)', () => {
    const sunPos: Vec3 = [state.pos[3 * sunIdx]!, state.pos[3 * sunIdx + 1]!, state.pos[3 * sunIdx + 2]!];
    const sunVel: Vec3 = [state.vel[3 * sunIdx]!, state.vel[3 * sunIdx + 1]!, state.vel[3 * sunIdx + 2]!];

    const earthPos: Vec3 = [state.pos[3 * earthIdx]!, state.pos[3 * earthIdx + 1]!, state.pos[3 * earthIdx + 2]!];
    const earthVel: Vec3 = [state.vel[3 * earthIdx]!, state.vel[3 * earthIdx + 1]!, state.vel[3 * earthIdx + 2]!];

    // Heliocentric relative vectors
    const rHelio: Vec3 = [earthPos[0] - sunPos[0], earthPos[1] - sunPos[1], earthPos[2] - sunPos[2]];
    const vHelio: Vec3 = [earthVel[0] - sunVel[0], earthVel[1] - sunVel[1], earthVel[2] - sunVel[2]];

    const predHelio = predictFutureTrajectory('earth', 'sun', muSun, rHelio, vHelio, 0, 365.25, 120);

    // Semi-major axis should be Earth-standard ~1.000 AU ± 0.005 AU
    expect(predHelio.elements.a).toBeCloseTo(1.0, 2);
    // Eccentricity should be low (~0.0167)
    expect(predHelio.elements.e).toBeLessThan(0.04);
    // Period should be 365.25 days ± 2 days
    expect(predHelio.elements.period).toBeCloseTo(365.25, 0);

    // 99.9% (3-sigma) confidence position envelope is tight
    expect(predHelio.envelope.confidencePct).toBe(99.9);
    expect(predHelio.envelope.chi2Threshold).toBe(16.27);
    expect(predHelio.envelope.sigmaR_km).toBeLessThan(10.0);
  });

  it('computes Moon geocentric orbit centered on Earth with accurate 27.3-day period', () => {
    const earthPos: Vec3 = [state.pos[3 * earthIdx]!, state.pos[3 * earthIdx + 1]!, state.pos[3 * earthIdx + 2]!];
    const earthVel: Vec3 = [state.vel[3 * earthIdx]!, state.vel[3 * earthIdx + 1]!, state.vel[3 * earthIdx + 2]!];

    const moonPos: Vec3 = [state.pos[3 * moonIdx]!, state.pos[3 * moonIdx + 1]!, state.pos[3 * moonIdx + 2]!];
    const moonVel: Vec3 = [state.vel[3 * moonIdx]!, state.vel[3 * moonIdx + 1]!, state.vel[3 * moonIdx + 2]!];

    const rGeo: Vec3 = [moonPos[0] - earthPos[0], moonPos[1] - earthPos[1], moonPos[2] - earthPos[2]];
    const vGeo: Vec3 = [moonVel[0] - earthVel[0], moonVel[1] - earthVel[1], moonVel[2] - earthVel[2]];

    const muEarth = state.gm[earthIdx]!;
    const predMoon = predictFutureTrajectory('moon', 'earth', muEarth, rGeo, vGeo, 0, 28.0, 60);

    // Semi-major axis ~384,400 km in AU (~0.00257 AU)
    const aKm = predMoon.elements.a * AU_KM;
    expect(aKm).toBeCloseTo(384_400, -4); // within 10,000 km of mean lunar orbit
    // Lunar orbital period ~27.32 days
    expect(predMoon.elements.period).toBeCloseTo(27.32, 0);
  });

  it('evaluates Sun wobble kinematics and confirms Jupiter & Saturn as dominant drivers', () => {
    const wobble = computeSolarWobble(state, model.ids);

    // Sun distance from SSB is between 0.1 and 2.5 solar radii
    expect(wobble.distBaryKm).toBeGreaterThan(100_000);
    expect(wobble.distBaryKm).toBeLessThan(1_600_000);
    expect(wobble.solarRadii).toBeGreaterThan(0.1);
    expect(wobble.solarRadii).toBeLessThan(2.5);

    // Surface condition must be a valid boolean
    expect(typeof wobble.isOutsideSurface).toBe('boolean');

    // Gas giant drivers must rank Jupiter and Saturn as #1 and #2
    expect(wobble.gasGiantDrivers[0]!.id).toBe('jupiter');
    expect(wobble.gasGiantDrivers[1]!.id).toBe('saturn');
    expect(wobble.gasGiantDrivers[0]!.pullFraction).toBeGreaterThan(50.0);

    // 60-year loop summary points span 60 years
    expect(wobble.loopSummary.points.length).toBeGreaterThanOrEqual(120);
    expect(wobble.loopSummary.maxDistKm).toBeGreaterThan(wobble.loopSummary.minDistKm);
  });

  it('evaluates gravitational pull breakdown with turn rate and radial/tangential decomposition', () => {
    const pull = computeGravitationalPull(earthIdx, state, model.ids, model.names);

    expect(pull.targetId).toBe('earth');
    // Top perturber on Earth is Sun
    expect(pull.perturbers[0]!.bodyId).toBe('sun');
    expect(pull.perturbers[0]!.fractionPct).toBeGreaterThan(99.0);

    // Earth's path turn rate is approximately 360 deg / 365.25 d = 0.9856 deg/d = ~3548 arcsec/d
    expect(pull.turnRateArcsecPerDay).toBeCloseTo(3548, -2);
    expect(pull.totalAccel_um_s2).toBeGreaterThan(5000);
    expect(pull.totalAccel_um_s2).toBeLessThan(7000);
  });

  it('evaluates Universe Master Backbone unified physics across multiple tiers', () => {
    const obsCoord = createUniversalCoordinate('sun', 'planetary_system', { x: 0, y: 0, z: 0 });
    const marsCoord = createUniversalCoordinate('sun', 'planetary_system', { x: 0, y: 0, z: 0 }, { x: 1.524 * METERS_PER_AU, y: 0, z: 0 });

    const obsVel = { x: 0, y: (29.78 * 86400) / AU_KM, z: 0 };
    const marsVel = { x: 0, y: (24.1 * 86400) / AU_KM, z: 0 };

    const physics = universeBackbone.evaluateTargetPhysics(
      marsCoord,
      obsCoord,
      marsVel,
      obsVel,
      {
        targetGmInternal: state.gm[model.ids.indexOf('mars')]!,
        targetLuminositySolar: 1e-9,
      },
    );

    expect(physics.lightTime).toBeDefined();
    expect(physics.lightTime!.tauSeconds).toBeGreaterThan(500); // > 8 minutes light travel time
    expect(physics.aberration).toBeDefined();
    expect(physics.aberration!.displacementArcsec).toBeGreaterThan(0);
    expect(physics.redshift).toBeDefined();
    expect(physics.photometry).toBeDefined();
    expect(physics.gravity).toBeDefined();
  });
});
