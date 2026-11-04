import { LSR_SPEED_KMS, SOLAR_PECULIAR_KMS } from '@/data/galaxy';

export const G_GALACTIC = 4.30091e-6; // kpc (km/s)^2 / M_sun
export const MYR_TO_TIME = 1 / 977.79222; // 1 kpc / (km/s) = 977.79222 Myr

export interface GalacticOrbitState {
  tMyr: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export class GalacticPotential {
  readonly mBulge: number; // M_sun
  readonly aBulge: number; // kpc
  readonly bBulge: number; // kpc

  readonly mDisk: number; // M_sun
  readonly aDisk: number; // kpc
  readonly bDisk: number; // kpc

  readonly rcHalo: number; // kpc
  readonly qHalo: number;
  readonly v0Halo2: number;
  readonly vTargetKms: number;
  readonly r0Kpc: number;

  constructor(
    vTargetKms = LSR_SPEED_KMS,
    r0Kpc = 8.2,
    opts?: {
      mBulge?: number;
      aBulge?: number;
      bBulge?: number;
      mDisk?: number;
      aDisk?: number;
      bDisk?: number;
      rcHalo?: number;
      qHalo?: number;
    },
  ) {
    this.vTargetKms = vTargetKms;
    this.r0Kpc = r0Kpc;

    this.mBulge = opts?.mBulge ?? 1e10;
    this.aBulge = opts?.aBulge ?? 0.0;
    this.bBulge = opts?.bBulge ?? 0.3;

    this.mDisk = opts?.mDisk ?? 7e10;
    this.aDisk = opts?.aDisk ?? 3.0;
    this.bDisk = opts?.bDisk ?? 0.28;

    this.rcHalo = opts?.rcHalo ?? 12.0;
    this.qHalo = opts?.qHalo ?? 1.0;

    const vcBulge2 = this.circSpeed2MN(this.mBulge, this.aBulge, this.bBulge, r0Kpc);
    const vcDisk2 = this.circSpeed2MN(this.mDisk, this.aDisk, this.bDisk, r0Kpc);
    const vcHalo2 = Math.max(0, vTargetKms * vTargetKms - vcBulge2 - vcDisk2);
    this.v0Halo2 = (vcHalo2 * (r0Kpc * r0Kpc + this.rcHalo * this.rcHalo)) / (r0Kpc * r0Kpc);
  }

  private circSpeed2MN(M: number, a: number, b: number, R: number): number {
    const ab = a + b;
    const denom = (R * R + ab * ab) ** 1.5;
    return (G_GALACTIC * M * R * R) / denom;
  }

  /**
   * Circular rotation speed (km/s) of a test particle at cylindrical radius R
   * (kpc) in the midplane. Same components the Sun's integrated orbit feels,
   * so the rendered star field and the Sun co-move by construction.
   */
  circularSpeedKms(R: number): number {
    const r = Math.max(R, 1e-3);
    const disk2 = this.circSpeed2MN(this.mDisk, this.aDisk, this.bDisk, r);
    const bulge2 = this.circSpeed2MN(this.mBulge, this.aBulge, this.bBulge, r);
    const halo2 = (this.v0Halo2 * r * r) / (r * r + this.rcHalo * this.rcHalo);
    return Math.sqrt(Math.max(0, disk2 + bulge2 + halo2));
  }

  /**
   * Signed angular rate (rad/Myr) at radius R. Negative: the Milky Way rotates
   * clockwise seen from the north galactic pole, matching getInitialSunState
   * (x=-r0, vy>0 gives dphi/dt<0). Renderers must use this sign.
   */
  angularRateRadPerMyr(R: number): number {
    const r = Math.max(R, 1e-3);
    return (-this.circularSpeedKms(r) * MYR_TO_TIME) / r;
  }

  potential(x: number, y: number, z: number): number {
    const R2 = x * x + y * y;
    // Bulge MN
    const zetaB = Math.sqrt(z * z + this.bBulge * this.bBulge);
    const deltaB = Math.sqrt(R2 + (this.aBulge + zetaB) ** 2);
    const phiB = -(G_GALACTIC * this.mBulge) / deltaB;

    // Disk MN
    const zetaD = Math.sqrt(z * z + this.bDisk * this.bDisk);
    const deltaD = Math.sqrt(R2 + (this.aDisk + zetaD) ** 2);
    const phiD = -(G_GALACTIC * this.mDisk) / deltaD;

    // Halo
    const phiH =
      0.5 *
      this.v0Halo2 *
      Math.log(R2 + (z * z) / (this.qHalo * this.qHalo) + this.rcHalo * this.rcHalo);

    return phiB + phiD + phiH;
  }

  acceleration(x: number, y: number, z: number): [number, number, number] {
    const R2 = x * x + y * y;
    let ax = 0,
      ay = 0,
      az = 0;

    // Bulge
    const zetaB = Math.sqrt(z * z + this.bBulge * this.bBulge);
    const AB = this.aBulge + zetaB;
    const deltaB3 = (R2 + AB * AB) ** 1.5;
    const kB = (G_GALACTIC * this.mBulge) / deltaB3;
    ax -= kB * x;
    ay -= kB * y;
    az -= kB * z * (AB / zetaB);

    // Disk
    const zetaD = Math.sqrt(z * z + this.bDisk * this.bDisk);
    const AD = this.aDisk + zetaD;
    const deltaD3 = (R2 + AD * AD) ** 1.5;
    const kD = (G_GALACTIC * this.mDisk) / deltaD3;
    ax -= kD * x;
    ay -= kD * y;
    az -= kD * z * (AD / zetaD);

    // Halo
    const denomH = R2 + (z * z) / (this.qHalo * this.qHalo) + this.rcHalo * this.rcHalo;
    const kH = this.v0Halo2 / denomH;
    ax -= kH * x;
    ay -= kH * y;
    az -= (kH * z) / (this.qHalo * this.qHalo);

    return [ax, ay, az];
  }

  /** Leapfrog step: dt in Myr */
  step(s: GalacticOrbitState, dtMyr: number): void {
    const dt = dtMyr * MYR_TO_TIME;
    const [ax1, ay1, az1] = this.acceleration(s.x, s.y, s.z);

    // Kick 1/2
    s.vx += 0.5 * dt * ax1;
    s.vy += 0.5 * dt * ay1;
    s.vz += 0.5 * dt * az1;

    // Drift
    s.x += dt * s.vx;
    s.y += dt * s.vy;
    s.z += dt * s.vz;

    // Kick 2/2
    const [ax2, ay2, az2] = this.acceleration(s.x, s.y, s.z);
    s.vx += 0.5 * dt * ax2;
    s.vy += 0.5 * dt * ay2;
    s.vz += 0.5 * dt * az2;

    s.tMyr += dtMyr;
  }

  getEnergy(s: GalacticOrbitState): number {
    const v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
    return 0.5 * v2 + this.potential(s.x, s.y, s.z);
  }

  getLz(s: GalacticOrbitState): number {
    return s.x * s.vy - s.y * s.vx;
  }

  /** Initial Sun state at r0 kpc and z0 = +20.8 pc */
  getInitialSunState(r0 = this.r0Kpc, z0 = 0.0208): GalacticOrbitState {
    const [u, v, w] = SOLAR_PECULIAR_KMS;
    return {
      tMyr: 0,
      x: -r0,
      y: 0,
      z: z0,
      vx: u,
      vy: v + this.vTargetKms,
      vz: w,
    };
  }
}
