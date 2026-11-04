import type { ForceModel, SystemState, Vec3 } from '../types';
import { kmToAu } from '@/data/constants';

export interface SphericalHarmonicsParams {
  hostIndex: number;
  radiusKm: number;
  j2?: number;
  j3?: number;
  j4?: number;
  c22?: number;
  s22?: number;
  /** Returns the unit spin pole vector (z-axis in body frame) at time t */
  pole: (t: number) => Vec3;
  /** Returns the prime-meridian unit vector (x-axis in body frame) at time t */
  primeMeridian?: (t: number) => Vec3;
}

export class SphericalHarmonics implements ForceModel {
  readonly name = 'spherical-harmonics';
  private readonly params: SphericalHarmonicsParams;
  private readonly radiusAu: number;

  constructor(params: SphericalHarmonicsParams) {
    this.params = params;
    this.radiusAu = kmToAu(params.radiusKm);
  }

  apply(s: SystemState, acc: Float64Array): void {
    const h = this.params.hostIndex;
    if (h >= s.n) return;

    const hx = s.pos[3 * h]!;
    const hy = s.pos[3 * h + 1]!;
    const hz = s.pos[3 * h + 2]!;
    const gmHost = s.gm[h]!;
    const R = this.radiusAu;
    const R2 = R * R;
    const R3 = R2 * R;
    const R4 = R2 * R2;

    const p = this.params.pole(s.t);
    const px = p[0], py = p[1], pz = p[2];

    const j2 = this.params.j2 ?? 0;
    const j3 = this.params.j3 ?? 0;
    const j4 = this.params.j4 ?? 0;
    const c22 = this.params.c22 ?? 0;
    const s22 = this.params.s22 ?? 0;

    // Body frame x-axis (prime meridian) and y-axis (90 deg east)
    let pmx = 1, pmy = 0, pmz = 0;
    let ymx = 0, ymy = 1, ymz = 0;
    if (this.params.primeMeridian && (c22 !== 0 || s22 !== 0)) {
      const pm = this.params.primeMeridian(s.t);
      pmx = pm[0]; pmy = pm[1]; pmz = pm[2];
      // y-axis = p x pm
      ymx = py * pmz - pz * pmy;
      ymy = pz * pmx - px * pmz;
      ymz = px * pmy - py * pmx;
    }

    for (let i = 0; i < s.n; i++) {
      if (i === h) continue;

      const rx = s.pos[3 * i]! - hx;
      const ry = s.pos[3 * i + 1]! - hy;
      const rz = s.pos[3 * i + 2]! - hz;
      const r2 = rx * rx + ry * ry + rz * rz;
      const r = Math.sqrt(r2);
      if (r < 1e-7) continue;

      const invR = 1 / r;
      const invR2 = 1 / r2;
      const ux = rx * invR;
      const uy = ry * invR;
      const uz = rz * invR;

      // sin(latitude) = (r . p) / r
      const sLat = (rx * px + ry * py + rz * pz) * invR;
      const s2 = sLat * sLat;
      const s4 = s2 * s2;

      let ax = 0, ay = 0, az = 0;

      // --- Zonal J2: oblateness ---
      if (j2 !== 0) {
        const factor2 = (-1.5 * gmHost * j2 * R2) / (r2 * r2);
        const uCoeff2 = 1 - 5 * s2;
        const pCoeff2 = 2 * sLat;
        ax += factor2 * (uCoeff2 * ux + pCoeff2 * px);
        ay += factor2 * (uCoeff2 * uy + pCoeff2 * py);
        az += factor2 * (uCoeff2 * uz + pCoeff2 * pz);
      }

      // --- Zonal J3: pear-shape asymmetry ---
      if (j3 !== 0) {
        const factor3 = (-0.5 * gmHost * j3 * R3) / (r2 * r2 * r);
        const uCoeff3 = sLat * (10 * s2 - 6);
        const pCoeff3 = 3 * (5 * s2 - 1);
        ax += factor3 * (uCoeff3 * ux + pCoeff3 * px);
        ay += factor3 * (uCoeff3 * uy + pCoeff3 * py);
        az += factor3 * (uCoeff3 * uz + pCoeff3 * pz);
      }

      // --- Zonal J4: higher-order flattening ---
      if (j4 !== 0) {
        const factor4 = (-0.125 * gmHost * j4 * R4) / (r2 * r2 * r2);
        const uCoeff4 = 35 * s4 - 90 * s2 + 15;
        const pCoeff4 = 20 * sLat * (7 * s2 - 3);
        ax += factor4 * (uCoeff4 * ux + pCoeff4 * px);
        ay += factor4 * (uCoeff4 * uy + pCoeff4 * py);
        az += factor4 * (uCoeff4 * uz + pCoeff4 * pz);
      }

      // --- Sectoral C22 / S22: equatorial ellipticity ---
      if (c22 !== 0 || s22 !== 0) {
        const xb = rx * pmx + ry * pmy + rz * pmz;
        const yb = rx * ymx + ry * ymy + rz * ymz;
        const factor22 = (-3 * gmHost * R2) / (r2 * r2 * r);
        const t = c22 * (xb * xb - yb * yb) + 2 * s22 * xb * yb;

        const dVdxb = 2 * c22 * xb + 2 * s22 * yb - (5 * t * xb) * invR2;
        const dVdyb = -2 * c22 * yb + 2 * s22 * xb - (5 * t * yb) * invR2;
        const dVdzb = -(5 * t * sLat * r) * invR2;

        ax += factor22 * (dVdxb * pmx + dVdyb * ymx + dVdzb * px);
        ay += factor22 * (dVdxb * pmy + dVdyb * ymy + dVdzb * py);
        az += factor22 * (dVdxb * pmz + dVdyb * ymz + dVdzb * pz);
      }

      acc[3 * i] = acc[3 * i]! + ax;
      acc[3 * i + 1] = acc[3 * i + 1]! + ay;
      acc[3 * i + 2] = acc[3 * i + 2]! + az;

      // Equal and opposite reaction onto host
      const massRatio = s.gm[i]! / gmHost;
      acc[3 * h] = acc[3 * h]! - massRatio * ax;
      acc[3 * h + 1] = acc[3 * h + 1]! - massRatio * ay;
      acc[3 * h + 2] = acc[3 * h + 2]! - massRatio * az;
    }
  }
}
