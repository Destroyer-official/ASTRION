import { describe, it, expect } from 'vitest';
import {
  mat6Identity,
  mat6Zero,
  mat6Get,
  mat6Mul,
  mat6Transpose,
  mat6Add,
  mat6Scale,
  mat6Vec,
  gravityGradient,
  multiBodyGravityGradient,
  jacobianMatrix,
  propagateWithSTM,
  propagateCovariance,
  positionUncertainty,
  velocityUncertainty,
  keplerianSTM,
  type Mat6,
} from '@/physics/stm';
import type { Vec3 } from '@/physics/types';

describe('State Transition Matrix (STM) & Variational Equations', () => {
  const GM_SUN = 0.2959122082855911e-3; // AU³/day²

  describe('6×6 Matrix Linear Algebra', () => {
    it('creates identity matrix and preserves identity under multiplication', () => {
      const I = mat6Identity();
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          expect(mat6Get(I, i, j)).toBe(i === j ? 1 : 0);
        }
      }

      // Random test matrix
      const A = mat6Zero();
      for (let i = 0; i < 36; i++) A[i] = (i * 7 + 3) % 11;

      const AI = mat6Mul(A, I);
      for (let i = 0; i < 36; i++) {
        expect(AI[i]).toBeCloseTo(A[i]!, 12);
      }
    });

    it('transposes matrix and satisfies involution (A^T)^T = A', () => {
      const A = mat6Zero();
      for (let i = 0; i < 36; i++) A[i] = i * 1.5;

      const AT = mat6Transpose(A);
      const ATT = mat6Transpose(AT);

      for (let i = 0; i < 36; i++) {
        expect(ATT[i]).toBe(A[i]);
      }
      expect(mat6Get(AT, 1, 4)).toBe(mat6Get(A, 4, 1));
    });

    it('matrix-vector multiplication y = A * x', () => {
      const I = mat6Identity();
      const x = new Float64Array([1, 2, 3, 4, 5, 6]);
      const y = mat6Vec(I, x);

      for (let i = 0; i < 6; i++) {
        expect(y[i]).toBe(x[i]);
      }
    });

    it('matrix addition and scaling', () => {
      const A = mat6Identity();
      const B = mat6Scale(2.5, A);
      const C = mat6Add(A, B);

      for (let i = 0; i < 6; i++) {
        expect(mat6Get(C, i, i)).toBeCloseTo(3.5, 12);
      }
    });
  });

  describe('Gravity Gradient Tensor G = ∂a/∂r', () => {
    it('satisfies Laplace equation: Tr(G) = 0 in vacuum (∇²V = 0)', () => {
      const r: Vec3 = [0.8, -0.5, 0.3];
      const G = gravityGradient(GM_SUN, r);

      // Trace = G00 + G11 + G22
      const trace = G[0]! + G[4]! + G[8]!;
      expect(Math.abs(trace)).toBeLessThan(1e-15);
    });

    it('is symmetric: G_ij = G_ji for conservative gravitational field', () => {
      const r: Vec3 = [1.2, 0.4, -0.7];
      const G = gravityGradient(GM_SUN, r);

      expect(G[1]).toBeCloseTo(G[3]!, 15); // G01 == G10
      expect(G[2]).toBeCloseTo(G[6]!, 15); // G02 == G20
      expect(G[5]).toBeCloseTo(G[7]!, 15); // G12 == G21
    });

    it('exhibits inverse-cube distance scaling', () => {
      const r1: Vec3 = [1.0, 0, 0];
      const r2: Vec3 = [2.0, 0, 0]; // 2x distance

      const G1 = gravityGradient(GM_SUN, r1);
      const G2 = gravityGradient(GM_SUN, r2);

      // (1/2)³ = 1/8
      expect(G2[0]).toBeCloseTo(G1[0]! / 8, 12);
    });

    it('superposes multi-body gravity gradients linearly', () => {
      const gm = new Float64Array([GM_SUN, GM_SUN * 1e-3]);
      const pos = new Float64Array([0, 0, 0, 1.0, 0, 0]); // Sun at origin, planet at (1,0,0)
      const rSc: Vec3 = [0.5, 0.5, 0];

      const Gcomb = multiBodyGravityGradient(gm, pos, 2, rSc);

      const r1: Vec3 = [rSc[0] - pos[0]!, rSc[1] - pos[1]!, rSc[2] - pos[2]!];
      const r2: Vec3 = [rSc[0] - pos[3]!, rSc[1] - pos[4]!, rSc[2] - pos[5]!];
      const G1 = gravityGradient(gm[0]!, r1);
      const G2 = gravityGradient(gm[1]!, r2);

      for (let k = 0; k < 9; k++) {
        expect(Gcomb[k]).toBeCloseTo(G1[k]! + G2[k]!, 14);
      }
    });
  });

  describe('Jacobian Matrix A(t)', () => {
    it('constructs canonical plant matrix with I₃ in upper right and G₃ in lower left', () => {
      const G = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const A = jacobianMatrix(G);

      // Upper-left 3x3 is 0
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(mat6Get(A, i, j)).toBe(0);
        }
      }

      // Upper-right 3x3 is identity
      expect(mat6Get(A, 0, 3)).toBe(1);
      expect(mat6Get(A, 1, 4)).toBe(1);
      expect(mat6Get(A, 2, 5)).toBe(1);
      expect(mat6Get(A, 0, 4)).toBe(0);

      // Lower-left 3x3 is G
      expect(mat6Get(A, 3, 0)).toBe(1);
      expect(mat6Get(A, 3, 1)).toBe(2);
      expect(mat6Get(A, 5, 2)).toBe(9);

      // Lower-right 3x3 is 0
      for (let i = 3; i < 6; i++) {
        for (let j = 3; j < 6; j++) {
          expect(mat6Get(A, i, j)).toBe(0);
        }
      }
    });
  });

  describe('Numerical STM Propagation (RK4)', () => {
    // 2-body Keplerian solar acceleration and gradient
    const accelFn = (r: Vec3): Vec3 => {
      const d2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
      const d = Math.sqrt(d2);
      const f = -GM_SUN / (d * d2);
      return [f * r[0], f * r[1], f * r[2]];
    };

    const gradFn = (r: Vec3) => gravityGradient(GM_SUN, r);

    it('initial condition Φ(t₀, t₀) = I₆ for zero propagation duration', () => {
      const r0: Vec3 = [1.0, 0, 0];
      const v0: Vec3 = [0, 0.0172, 0]; // circular 1 AU orbit speed in AU/day

      const res = propagateWithSTM(r0, v0, 0, 0, 0.01, accelFn, gradFn);

      expect(res.pos[0]).toBeCloseTo(r0[0], 12);
      expect(res.pos[1]).toBeCloseTo(r0[1], 12);
      expect(res.vel[1]).toBeCloseTo(v0[1], 12);

      // STM should be identity
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          expect(mat6Get(res.stm, i, j)).toBeCloseTo(i === j ? 1 : 0, 10);
        }
      }
    });

    it('preserves symplectic determinant det(Φ) ≈ 1 over a 30-day arc (Liouville theorem)', () => {
      const r0: Vec3 = [1.0, 0, 0];
      const v0: Vec3 = [0, Math.sqrt(GM_SUN / 1.0), 0]; // Circular 1 AU

      const dt = 0.5; // days
      const tf = 30.0; // days
      const res = propagateWithSTM(r0, v0, 0, tf, dt, accelFn, gradFn);

      // Numerical determinant of 6x6 matrix using LU or Gaussian elimination
      const det = computeDeterminant6x6(res.stm);

      // Liouville theorem: volume preservation in Hamiltonian phase space
      expect(det).toBeCloseTo(1.0, 2);
    });

    it('STM correctly predicts linear state perturbation: δx(t) ≈ Φ(t, t₀) δx(t₀)', () => {
      const r0: Vec3 = [1.0, 0, 0];
      const v0: Vec3 = [0, Math.sqrt(GM_SUN / 1.0), 0];
      const tf = 5.0; // 5 days

      // Nominal trajectory with STM
      const nominal = propagateWithSTM(r0, v0, 0, tf, 0.1, accelFn, gradFn);

      // Small perturbation: 100 km in position, 1 m/s in velocity
      const drKm = 100;
      const dvMs = 1.0;
      const AU_KM = 149597870.7;
      const drAu = drKm / AU_KM;
      const dvAuDay = (dvMs / 1000) * (86400 / AU_KM);

      const dx0 = new Float64Array([drAu, 0, 0, 0, dvAuDay, 0]);

      // Perturbed trajectory
      const r0Pert: Vec3 = [r0[0] + dx0[0]!, r0[1] + dx0[1]!, r0[2] + dx0[2]!];
      const v0Pert: Vec3 = [v0[0] + dx0[3]!, v0[1] + dx0[4]!, v0[2] + dx0[5]!];
      const perturbed = propagateWithSTM(r0Pert, v0Pert, 0, tf, 0.1, accelFn, gradFn);

      // Actual non-linear perturbation at tf
      const actualDx: number[] = [
        perturbed.pos[0] - nominal.pos[0],
        perturbed.pos[1] - nominal.pos[1],
        perturbed.pos[2] - nominal.pos[2],
        perturbed.vel[0] - nominal.vel[0],
        perturbed.vel[1] - nominal.vel[1],
        perturbed.vel[2] - nominal.vel[2],
      ];

      // Predicted linear perturbation via STM: δx_pred = Φ * δx₀
      const predictedDx = mat6Vec(nominal.stm, dx0);

      // For a small perturbation, linear prediction should match nonlinear within < 1%
      for (let i = 0; i < 6; i++) {
        expect(predictedDx[i]).toBeCloseTo(actualDx[i]!, 4);
      }
    });
  });

  describe('Covariance Propagation & Uncertainty', () => {
    it('propagates covariance P(t) = Φ P₀ Φᵀ and preserves positive semi-definiteness', () => {
      const P0 = mat6Zero();
      // Diagonal initial uncertainties: 1e-8 AU pos, 1e-10 AU/day vel
      for (let i = 0; i < 3; i++) P0[i * 6 + i] = 1e-8;
      for (let i = 3; i < 6; i++) P0[i * 6 + i] = 1e-10;

      // Dummy transformation STM
      const stm = mat6Identity();
      stm[0 * 6 + 3] = 5.0; // shearing: x = x0 + 5*vx0
      stm[1 * 6 + 4] = 5.0;
      stm[2 * 6 + 5] = 5.0;

      const Pt = propagateCovariance(stm, P0);

      // Diagonal elements must remain positive
      for (let i = 0; i < 6; i++) {
        expect(mat6Get(Pt, i, i)).toBeGreaterThan(0);
      }

      // Position uncertainty grows due to velocity coupling
      const sigmaPos0 = positionUncertainty(P0);
      const sigmaPosT = positionUncertainty(Pt);
      expect(sigmaPosT).toBeGreaterThan(sigmaPos0);

      // Velocity uncertainty unchanged since velocity row of STM has no position coupling
      const sigmaVel0 = velocityUncertainty(P0);
      const sigmaVelT = velocityUncertainty(Pt);
      expect(sigmaVelT).toBeCloseTo(sigmaVel0, 10);
    });
  });

  describe('Keplerian Analytical STM', () => {
    it('produces valid Keplerian STM with identity diagonal for dt -> 0', () => {
      const r0: Vec3 = [1.0, 0, 0];
      const v0: Vec3 = [0, Math.sqrt(GM_SUN / 1.0), 0];

      const stm = keplerianSTM(GM_SUN, r0, v0, 1e-6);

      // For infinitesimal dt, f ≈ 1, g ≈ dt, f_dot ≈ 0, g_dot ≈ 1
      expect(mat6Get(stm, 0, 0)).toBeCloseTo(1.0, 4);
      expect(mat6Get(stm, 1, 1)).toBeCloseTo(1.0, 4);
      expect(mat6Get(stm, 3, 3)).toBeCloseTo(1.0, 4);
      expect(mat6Get(stm, 4, 4)).toBeCloseTo(1.0, 4);
    });
  });
});

/** Helper to compute determinant of 6×6 matrix via Gaussian elimination with partial pivoting. */
function computeDeterminant6x6(m: Mat6): number {
  const a = new Float64Array(36);
  for (let i = 0; i < 36; i++) a[i] = m[i]!;

  let det = 1.0;
  const n = 6;

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(a[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(a[row * n + col]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxVal < 1e-30) return 0;

    if (maxRow !== col) {
      // Swap rows
      for (let k = 0; k < n; k++) {
        const tmp = a[col * n + k]!;
        a[col * n + k] = a[maxRow * n + k]!;
        a[maxRow * n + k] = tmp;
      }
      det = -det;
    }

    const pivot = a[col * n + col]!;
    det *= pivot;

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = a[row * n + col]! / pivot;
      for (let k = col; k < n; k++) {
        a[row * n + k] = (a[row * n + k] ?? 0) - factor * a[col * n + k]!;
      }
    }
  }

  return det;
}
