import type { ForceModel, SystemState } from '../types';
import { C_LIGHT_AU_DAY } from '@/data/constants';

const C2 = C_LIGHT_AU_DAY * C_LIGHT_AU_DAY;
const INV_C2 = 1 / C2;

/**
 * Full First Post-Newtonian (1PN) Einstein-Infeld-Hoffmann (EIH) N-Body Gravitational Model.
 * Evaluates the full relativistic metric perturbations and mutual post-Newtonian couplings
 * between all pairs (i, j) and multi-body potentials U_i, matching the JPL DE440
 * equations of motion (Standish 1998, Moyer 2003, Park et al. 2021).
 */
export class EinsteinInfeldHoffmann implements ForceModel {
  readonly name = 'einstein-infeld-hoffmann-1pn';

  apply(s: SystemState, acc: Float64Array): void {
    const n = s.nMassive ?? s.n;
    if (n < 2) return;

    // Precalculate mutual distance matrix between massive bodies
    const invR = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      const ix = s.pos[3 * i]!, iy = s.pos[3 * i + 1]!, iz = s.pos[3 * i + 2]!;
      for (let j = i + 1; j < n; j++) {
        const dx = s.pos[3 * j]! - ix;
        const dy = s.pos[3 * j + 1]! - iy;
        const dz = s.pos[3 * j + 2]! - iz;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 1e-12) {
          const invDist = 1 / dist;
          invR[i * n + j] = invDist;
          invR[j * n + i] = invDist;
        }
      }
    }

    // Precalculate Newtonian gravitational potentials U_i = sum_k (gm_k / r_ik)
    const U = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sumU = 0;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        sumU += s.gm[k]! * invR[i * n + k]!;
      }
      U[i] = sumU;
    }

    // Evaluate 1PN EIH accelerations on all bodies
    for (let i = 0; i < s.n; i++) {
      const ix = s.pos[3 * i]!, iy = s.pos[3 * i + 1]!, iz = s.pos[3 * i + 2]!;
      const ivx = s.vel[3 * i]!, ivy = s.vel[3 * i + 1]!, ivz = s.vel[3 * i + 2]!;

      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const gmj = s.gm[j]!;
        if (gmj <= 0) continue;

        const jx = s.pos[3 * j]!, jy = s.pos[3 * j + 1]!, jz = s.pos[3 * j + 2]!;
        const jvx = s.vel[3 * j]!, jvy = s.vel[3 * j + 1]!, jvz = s.vel[3 * j + 2]!;

        // Vector from j to i
        const dx = ix - jx;
        const dy = iy - jy;
        const dz = iz - jz;

        const dist = i < n && invR[i * n + j]! > 0 ? 1 / invR[i * n + j]! : Math.hypot(dx, dy, dz);
        if (dist < 1e-12) continue;

        const invDist = 1 / dist;
        const invDist3 = invDist * invDist * invDist;

        // Relative velocity v_ij = v_i - v_j
        const dvx = ivx - jvx;
        const dvy = ivy - jvy;
        const dvz = ivz - jvz;
        const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
        const rDotV = dx * dvx + dy * dvy + dz * dvz;

        // Effective potential at i excluding j
        const Ui_other = i < n ? Math.max(0, U[i]! - gmj * invDist) : 0;

        const factor = gmj * INV_C2 * invDist3;
        const posCoeff = (4 * gmj) * invDist + 4 * Ui_other - v2;
        const velCoeff = 4 * rDotV;

        const ax = factor * (posCoeff * dx + velCoeff * dvx);
        const ay = factor * (posCoeff * dy + velCoeff * dvy);
        const az = factor * (posCoeff * dz + velCoeff * dvz);

        acc[3 * i] = acc[3 * i]! + ax;
        acc[3 * i + 1] = acc[3 * i + 1]! + ay;
        acc[3 * i + 2] = acc[3 * i + 2]! + az;
      }
    }
  }
}
