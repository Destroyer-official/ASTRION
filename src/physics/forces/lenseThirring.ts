/**
 * 1.5-Post-Newtonian (1.5PN) Lense-Thirring Gravitomagnetic Frame-Dragging.
 *
 * Implements the relativistic frame-dragging acceleration induced by the spin
 * angular momentum J of the central rotating body (default: Sun, index 0):
 *
 *   a_LT = (GM / (c^2 * r^3)) * [ (3/r^2)*(r . S)*(v x r) + S x v - (3/r^2)*((r x v) . S)*r ]
 *
 * where:
 *   S = J / M is the spin angular momentum per unit mass (AU^2 / day),
 *   c is the speed of light in AU / day.
 *
 * References:
 * - Soffel et al. (2003): "The IAU 2000 Resolutions for Astrometry, Celestial Mechanics,
 *   and Metrology in the Relativistic Framework", AJ 126:2687.
 * - Ciufolini & Pavlis (2004): "A confirmation of the general relativistic prediction
 *   of the Lense-Thirring effect", Nature 431:958-960.
 * - Barker & O'Connell (1975): "Gravitational two-body problem with arbitrary masses,
 *   spins, and quadrupole moments", PRD 12:329.
 */

import type { ForceModel, SystemState } from '../types';
import { C_LIGHT_AU_DAY, SUN_RADIUS_KM, AU_KM } from '@/data/constants';

const C2 = C_LIGHT_AU_DAY * C_LIGHT_AU_DAY;

export interface LenseThirringOptions {
  centralIndex?: number;
  /** Spin angular momentum per unit mass vector [Sx, Sy, Sz] in AU^2 / day */
  spinPerUnitMass?: readonly [number, number, number];
}

export class LenseThirring implements ForceModel {
  readonly name = 'lense-thirring-1.5pn';
  private readonly centralIndex: number;
  private readonly S: readonly [number, number, number];

  constructor(opts?: LenseThirringOptions) {
    this.centralIndex = opts?.centralIndex ?? 0;

    if (opts?.spinPerUnitMass) {
      this.S = opts.spinPerUnitMass;
    } else {
      // Default: Solar spin parameters
      // Sun sidereal Carrington period ~25.38 days => omega = 2*pi / 25.38 rad/day
      // Sun equatorial radius R_sun = 696340 km / AU_KM
      // Solar moment of inertia factor k_S = I / (M * R^2) ~ 0.070 (Paternò et al.)
      const rSunAu = SUN_RADIUS_KM / AU_KM;
      const omegaSun = (2 * Math.PI) / 25.38;
      const sMag = 0.070 * rSunAu * rSunAu * omegaSun; // ~3.757e-7 AU^2/day

      // Solar rotation pole in J2000 ecliptic coordinates:
      // RA = 286.13 deg, Dec = 63.87 deg (IAU WGCCRE)
      // Ecliptic tilt ~7.25 deg => pole unit vector approx [0.0333, 0.1264, 0.9914]
      const poleX = 0.03334;
      const poleY = 0.12642;
      const poleZ = 0.99142;
      const poleLen = Math.hypot(poleX, poleY, poleZ);

      this.S = [
        (sMag * poleX) / poleLen,
        (sMag * poleY) / poleLen,
        (sMag * poleZ) / poleLen,
      ];
    }
  }

  getSpinVector(): readonly [number, number, number] {
    return this.S;
  }

  apply(s: SystemState, acc: Float64Array): void {
    const ci = this.centralIndex;
    if (ci >= s.n) return;

    const gmCentral = s.gm[ci]!;
    if (gmCentral <= 0) return;

    const [Sx, Sy, Sz] = this.S;
    const sMagSq = Sx * Sx + Sy * Sy + Sz * Sz;
    if (sMagSq < 1e-30) return;

    const cx = s.pos[3 * ci]!,
      cy = s.pos[3 * ci + 1]!,
      cz = s.pos[3 * ci + 2]!;
    const cvx = s.vel[3 * ci]!,
      cvy = s.vel[3 * ci + 1]!,
      cvz = s.vel[3 * ci + 2]!;

    const nMassive = s.nMassive ?? s.n;

    for (let i = 0; i < nMassive; i++) {
      if (i === ci) continue;

      const rx = s.pos[3 * i]! - cx;
      const ry = s.pos[3 * i + 1]! - cy;
      const rz = s.pos[3 * i + 2]! - cz;
      const r2 = rx * rx + ry * ry + rz * rz;
      if (r2 < 1e-16) continue;

      const r = Math.sqrt(r2);
      const r3 = r2 * r;
      const invR2 = 1 / r2;

      const vx = s.vel[3 * i]! - cvx;
      const vy = s.vel[3 * i + 1]! - cvy;
      const vz = s.vel[3 * i + 2]! - cvz;

      // Cross products
      // v x r
      const vxr_x = vy * rz - vz * ry;
      const vxr_y = vz * rx - vx * rz;
      const vxr_z = vx * ry - vy * rx;

      // r x v = -(v x r)
      const rxv_x = -vxr_x;
      const rxv_y = -vxr_y;
      const rxv_z = -vxr_z;

      // S x v
      const sxv_x = Sy * vz - Sz * vy;
      const sxv_y = Sz * vx - Sx * vz;
      const sxv_z = Sx * vy - Sy * vx;

      // Dot products
      const rDotS = rx * Sx + ry * Sy + rz * Sz;
      const hDotS = rxv_x * Sx + rxv_y * Sy + rxv_z * Sz; // (r x v) . S

      // Acceleration bracket:
      // [ 3/r^2 * (r . S) * (v x r) + (S x v) - 3/r^2 * ((r x v) . S) * r ]
      const coeff1 = 3 * invR2 * rDotS;
      const coeff3 = -3 * invR2 * hDotS;

      const bracketX = coeff1 * vxr_x + sxv_x + coeff3 * rx;
      const bracketY = coeff1 * vxr_y + sxv_y + coeff3 * ry;
      const bracketZ = coeff1 * vxr_z + sxv_z + coeff3 * rz;

      const factor = gmCentral / (C2 * r3);
      const ax = factor * bracketX;
      const ay = factor * bracketY;
      const az = factor * bracketZ;

      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) {
        continue;
      }

      acc[3 * i] = acc[3 * i]! + ax;
      acc[3 * i + 1] = acc[3 * i + 1]! + ay;
      acc[3 * i + 2] = acc[3 * i + 2]! + az;

      // Equal and opposite reaction onto the central body
      const massRatio = s.gm[i]! / gmCentral;
      acc[3 * ci] = acc[3 * ci]! - massRatio * ax;
      acc[3 * ci + 1] = acc[3 * ci + 1]! - massRatio * ay;
      acc[3 * ci + 2] = acc[3 * ci + 2]! - massRatio * az;
    }
  }
}
