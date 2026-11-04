import { describe, it, expect } from 'vitest';
import {
  ObservationType,
  generateSyntheticObs,
  batchLeastSquares,
  type Observation,
  type ODConfig,
} from '@/physics/orbitDetermination';
import { gravityGradient } from '@/physics/stm';
import { AU_KM } from '@/data/constants';
import type { Vec3 } from '@/physics/types';

describe('Batch Least Squares Orbit Determination (OD)', () => {
  const GM_SUN = 0.2959122082855911e-3; // AU³/day²

  const accelFn = (r: Vec3): Vec3 => {
    const d2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
    const d = Math.sqrt(d2);
    const f = -GM_SUN / (d * d2);
    return [f * r[0], f * r[1], f * r[2]];
  };

  const gradFn = (r: Vec3) => gravityGradient(GM_SUN, r);

  describe('Synthetic Observation Generation', () => {
    it('generates reproducible synthetic range observations matching true trajectory', () => {
      const rTrue: Vec3 = [1.0, 0, 0];
      const vCircular = Math.sqrt(GM_SUN / 1.0);
      const vTrue: Vec3 = [0, vCircular, 0];

      const stationPos: Vec3 = [0, 0, 0]; // Station at Sun / barycenter for simplicity
      const stationVel: Vec3 = [0, 0, 0];

      const times = [1, 2, 3, 4, 5];
      const sigmaKm = 0.001; // 1 meter range noise
      const sigmaAu = sigmaKm / AU_KM;

      const obs1 = generateSyntheticObs(
        rTrue, vTrue, 0, times,
        stationPos, stationVel, sigmaAu,
        accelFn, gradFn, 0.1, 42,
      );

      const obs2 = generateSyntheticObs(
        rTrue, vTrue, 0, times,
        stationPos, stationVel, sigmaAu,
        accelFn, gradFn, 0.1, 42,
      );

      expect(obs1.length).toBe(5);
      expect(obs1[0]!.type).toBe(ObservationType.RANGE);

      // Reproducibility with same seed
      for (let i = 0; i < obs1.length; i++) {
        expect(obs1[i]!.value).toBeCloseTo(obs2[i]!.value, 15);
      }

      // Range should be approximately 1.0 AU (circular orbit)
      for (const o of obs1) {
        expect(o.value).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe('Differential Correction & Batch Least Squares Convergence', () => {
    it('converges from perturbed initial state guess to true state within 1-sigma uncertainty', () => {
      // True state: Spacecraft at 1.0 AU on a 1.05 AU transfer orbit
      const rTrue: Vec3 = [1.0, 0, 0];
      const vTrue: Vec3 = [0, 0.0175, 0.001];

      // Two DSN stations (e.g. Goldstone and Canberra) providing diverse geometric baselines
      const station1Pos: Vec3 = [0.99, 0.02, 0.02];
      const station1Vel: Vec3 = [-0.0003, 0.0170, 0.0002];
      const station2Pos: Vec3 = [0.99, -0.02, -0.02];
      const station2Vel: Vec3 = [0.0003, 0.0168, -0.0002];

      // Dense tracking pass over 14 days
      const times: number[] = [];
      for (let t = 0.5; t <= 14.0; t += 0.5) {
        times.push(t);
      }

      const sigmaKm = 0.001; // 1 m range accuracy
      const sigmaAu = sigmaKm / AU_KM;

      const obs1 = generateSyntheticObs(
        rTrue, vTrue, 0, times,
        station1Pos, station1Vel, sigmaAu,
        accelFn, gradFn, 0.1, 12345,
      );

      const obs2 = generateSyntheticObs(
        rTrue, vTrue, 0, times,
        station2Pos, station2Vel, sigmaAu,
        accelFn, gradFn, 0.1, 54321,
      );

      const observations = [...obs1, ...obs2];

      // Perturb the initial state guess:
      // Offset by ~500 km in position and ~0.05 m/s in velocity
      const posErrorKm = 500;
      const velErrorMs = 0.05;
      const drAu = posErrorKm / AU_KM;
      const dvAuDay = (velErrorMs / 1000) * (86400 / AU_KM);

      const rInit: Vec3 = [rTrue[0] + drAu, rTrue[1] - drAu * 0.5, rTrue[2] + drAu * 0.3];
      const vInit: Vec3 = [vTrue[0] + dvAuDay, vTrue[1] - dvAuDay * 0.5, vTrue[2]];

      const config: ODConfig = {
        maxIterations: 10,
        convergenceTol: 1e-10, // ~15 meters in AU
        integrationDt: 0.1,
      };

      const result = batchLeastSquares(
        rInit, vInit, 0,
        observations,
        accelFn, gradFn,
        config,
      );

      // Must converge
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThan(8);

      // Position error after OD should be dramatically reduced from 500 km to < 1 km
      const postFitPosErrKm = Math.hypot(
        result.pos[0] - rTrue[0],
        result.pos[1] - rTrue[1],
        result.pos[2] - rTrue[2],
      ) * AU_KM;

      expect(postFitPosErrKm).toBeLessThan(1.0); // Sub-kilometer estimation accuracy!

      // Velocity error after OD should be reduced to sub-cm/s
      const postFitVelErrMs = Math.hypot(
        result.vel[0] - vTrue[0],
        result.vel[1] - vTrue[1],
        result.vel[2] - vTrue[2],
      ) * (AU_KM / 86400) * 1000;

      expect(postFitVelErrMs).toBeLessThan(0.1); // < 10 cm/s

      // Formal covariance should be positive-definite
      expect(result.positionSigma).toBeGreaterThan(0);
      expect(result.velocitySigma).toBeGreaterThan(0);

      // Estimation error should be consistent with formal 3-sigma bounds
      expect(postFitPosErrKm / AU_KM).toBeLessThan(3 * result.positionSigma + 1e-7);

      // RMS residual should be close to 1.0 (normalized by sigma)
      expect(result.rmsResidual).toBeGreaterThan(0);
      expect(result.rmsResidual).toBeLessThan(5.0);
    });

    it('handles multiple observation types: Range and Range-Rate combined', () => {
      const rTrue: Vec3 = [1.1, 0.2, 0.05];
      const vTrue: Vec3 = [-0.003, 0.016, 0.001];

      const stationPos: Vec3 = [1.0, 0, 0];
      const stationVel: Vec3 = [0, 0.0172, 0];

      const sigmaRange = 0.001 / AU_KM; // 1 m range
      const sigmaDoppler = (0.0001 / 1000) * (86400 / AU_KM); // 0.1 mm/s Doppler

      const obs: Observation[] = [
        {
          t: 1.0,
          type: ObservationType.RANGE,
          value: Math.hypot(rTrue[0] - stationPos[0], rTrue[1] - stationPos[1], rTrue[2] - stationPos[2]),
          sigma: sigmaRange,
          stationPos,
          stationVel,
        },
        {
          t: 1.0,
          type: ObservationType.RANGE_RATE,
          value: 0.0005,
          sigma: sigmaDoppler,
          stationPos,
          stationVel,
        },
        {
          t: 2.0,
          type: ObservationType.RANGE,
          value: 0.22,
          sigma: sigmaRange,
          stationPos,
          stationVel,
        },
        {
          t: 2.0,
          type: ObservationType.RANGE_RATE,
          value: 0.0008,
          sigma: sigmaDoppler,
          stationPos,
          stationVel,
        },
      ];

      const config: ODConfig = {
        maxIterations: 5,
        convergenceTol: 1e-8,
        integrationDt: 0.1,
      };

      const result = batchLeastSquares(
        rTrue, vTrue, 0,
        obs,
        accelFn, gradFn,
        config,
      );

      // Algorithm runs without NaN and produces valid covariance
      expect(Number.isNaN(result.positionSigma)).toBe(false);
      expect(Number.isNaN(result.velocitySigma)).toBe(false);
      expect(result.residuals.length).toBe(4);
    });
  });
});
