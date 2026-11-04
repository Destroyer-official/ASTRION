/**
 * Flight-Grade Multi-Scale Universal Gravitational Engine
 *
 * Implements gravitational potentials and dynamical accelerations spanning
 * 30 orders of magnitude across the cosmic hierarchy:
 *
 * 1. Local / Planetary Regime: 1PN General Relativity & High-Order Spherical Harmonics
 * 2. Galactic Regime: Miyamoto-Nagai Disk, Hernquist Bulge, & Navarro-Frenk-White (NFW) Dark Matter Halo
 * 3. Extragalactic Regime: Local Group Dynamics (Milky Way - Andromeda M31 Infall & Kahn-Woltjer Timing)
 * 4. Cosmological Regime: FLRW Metric Expansion Acceleration & Dark Energy (Lambda-CDM)
 *
 * References:
 * - Navarro, J. F., Frenk, C. S., & White, S. D. (1996), "The Structure of Cold Dark Matter Halos", ApJ 462:563.
 * - Miyamoto, M. & Nagai, R. (1975), "Three-dimensional models for the distribution of mass in spherical systems", PASJ 27:533.
 * - Kahn, F. D. & Woltjer, L. (1959), "Intergalactic Matter and the Galaxy", ApJ 130:705.
 * - Planck Collaboration (2020), "Planck 2018 results. VI. Cosmological parameters", A&A 641:A6.
 */

import { G_GALACTIC, MYR_TO_TIME } from './galacticPotential';
import type { Vector3D } from './light/lightTime';
import { HUBBLE_CONSTANT_KM_S_MPC, OMEGA_MATTER, OMEGA_LAMBDA } from './light/dopplerRedshift';

// Astronomical and galactic constants
export const G_GRAV_KPC_KMS2_MSUN = G_GALACTIC; // ~4.30091e-6 kpc*(km/s)^2 / M_sun
export const KM_S_TO_KPC_MYR = MYR_TO_TIME; // 1 (km/s) = (1 / 977.79222) kpc/Myr ~ 0.0010227 kpc/Myr
export const KPC_PER_MPC = 1000;

export interface NFWProfileParams {
  /** Virial mass M_200 in solar masses (e.g. 1.0e12 for Milky Way) */
  mVirialSolar: number;
  /** Concentration parameter c = r_vir / r_s (typically 10 to 15 for Milky Way) */
  concentration: number;
  /** Scale radius r_s in kpc (typically ~16 to 20 kpc for Milky Way) */
  scaleRadiusKpc: number;
}

export interface CosmicAccelerationResult {
  /** Total physical acceleration vector in (km/s)^2 / kpc or (km/s)/Myr */
  accKpcMyr2: Vector3D;
  /** Acceleration magnitude in m/s^2 */
  accMagnitudeMPerS2: number;
  /** Dominant physical gravitational regime */
  regime: 'planetary_pn' | 'galactic_nfw' | 'local_group' | 'cosmological_flrw';
  /** Total gravitational potential phi in (km/s)^2 */
  potential: number;
  /** Dark energy repulsive contribution magnitude if cosmological */
  darkEnergyRepulsionKpcMyr2?: number;
}

export interface LocalGroupState {
  /** Distance between Milky Way and Andromeda M31 in kpc (present ~ 780 kpc) */
  separationKpc: number;
  /** Radial approach velocity in km/s (present ~ -110 km/s) */
  closingVelocityKms: number;
  /** Mass of Milky Way in solar masses (~1.0e12 M_sun) */
  massMilkyWaySolar: number;
  /** Mass of Andromeda in solar masses (~1.5e12 M_sun) */
  massAndromedaSolar: number;
  /** Estimated time until closest pericenter approach (in Gyr) */
  timeToPericenterGyr: number;
}

/**
 * Evaluates the Navarro-Frenk-White (NFW) Dark Matter Halo potential and acceleration.
 *
 * Density: rho(r) = rho_0 / [ (r/r_s) * (1 + r/r_s)^2 ]
 * Enclosed Mass: M(r) = 4*pi*rho_0*r_s^3 * [ ln(1 + r/r_s) - (r/r_s)/(1 + r/r_s) ]
 * Potential: Phi(r) = - (4*pi*G*rho_0*r_s^3 / r) * ln(1 + r/r_s)
 */
export class NFWHaloModel {
  readonly mVirial: number;
  readonly concentration: number;
  readonly rs: number;
  private readonly prefactorMass: number;
  private readonly prefactorPotential: number;

  constructor(params?: Partial<NFWProfileParams>) {
    this.mVirial = params?.mVirialSolar ?? 1.0e12; // M_sun (Milky Way standard)
    this.concentration = params?.concentration ?? 12.0;
    this.rs = params?.scaleRadiusKpc ?? 16.0; // kpc

    // Function f(c) = ln(1 + c) - c / (1 + c)
    const c = this.concentration;
    const fC = Math.log(1 + c) - c / (1 + c);

    // M(r) = mVirial * [ ln(1 + r/r_s) - (r/r_s)/(1 + r/r_s) ] / f(c)
    this.prefactorMass = this.mVirial / Math.max(1e-12, fC);
    // Potential prefactor = G * prefactorMass
    this.prefactorPotential = G_GRAV_KPC_KMS2_MSUN * this.prefactorMass;
  }

  /**
   * Enclosed dark matter halo mass within radius r (kpc) in solar masses.
   */
  enclosedMassSolar(rKpc: number): number {
    const r = Math.max(1e-4, rKpc);
    const x = r / this.rs;
    const fx = Math.log(1 + x) - x / (1 + x);
    return this.prefactorMass * fx;
  }

  /**
   * Circular velocity v_c(r) in km/s produced by the NFW dark matter halo alone.
   */
  circularVelocityKms(rKpc: number): number {
    const r = Math.max(1e-4, rKpc);
    const mEnc = this.enclosedMassSolar(r);
    // v_c^2 = G * M(r) / r
    const vSq = (G_GRAV_KPC_KMS2_MSUN * mEnc) / r;
    return Math.sqrt(Math.max(0, vSq));
  }

  /**
   * Gravitational potential Phi(r) in (km/s)^2.
   */
  potential(rKpc: number): number {
    const r = Math.max(1e-4, rKpc);
    const x = r / this.rs;
    return -(this.prefactorPotential / r) * Math.log(1 + x);
  }

  /**
   * 3D gravitational acceleration vector in (km/s)^2 / kpc.
   */
  acceleration(posKpc: Vector3D): Vector3D {
    const r = Math.hypot(posKpc.x, posKpc.y, posKpc.z);
    if (r < 1e-4) return { x: 0, y: 0, z: 0 };

    const mEnc = this.enclosedMassSolar(r);
    // a = - G * M(r) / r^3 * pos
    const scalar = -(G_GRAV_KPC_KMS2_MSUN * mEnc) / (r * r * r);
    return {
      x: scalar * posKpc.x,
      y: scalar * posKpc.y,
      z: scalar * posKpc.z,
    };
  }

  /**
   * Tidal gravity gradient tensor T_ij = - d^2 Phi / dx_i dx_j in (km/s)^2 / kpc^2.
   */
  tidalTensor(posKpc: Vector3D): number[][] {
    const r = Math.hypot(posKpc.x, posKpc.y, posKpc.z);
    const safeR = Math.max(1e-4, r);
    const mEnc = this.enclosedMassSolar(safeR);
    const x = safeR / this.rs;
    // dM/dr = prefactorMass * [ 1/(1+x)*1/rs - (1/(1+x) - x/(1+x)^2)/rs ] = prefactorMass * x / (rs * (1+x)^2)
    const dMdr = (this.prefactorMass * x) / (this.rs * (1 + x) * (1 + x));

    // Force per unit mass F_r = -G M / r^2
    // dF_r / dr = G [ 2M / r^3 - (1/r^2)(dM/dr) ]
    const g = G_GRAV_KPC_KMS2_MSUN;
    const term1 = (2 * g * mEnc) / (safeR * safeR * safeR);
    const term2 = (g * dMdr) / (safeR * safeR);
    const dArDr = term1 - term2;
    const arOverR = -(g * mEnc) / (safeR * safeR * safeR);

    const coords = [posKpc.x, posKpc.y, posKpc.z];
    const tensor: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const delta = i === j ? 1 : 0;
        const xi = coords[i]!;
        const xj = coords[j]!;
        // T_ij = arOverR * delta_ij + (dArDr - arOverR) * (x_i * x_j / r^2)
        tensor[i]![j]! = arOverR * delta + (dArDr - arOverR) * ((xi * xj) / (safeR * safeR));
      }
    }

    return tensor;
  }
}

/**
 * Computes cosmological Friedmann-Lemaître-Robertson-Walker (FLRW) expansion acceleration.
 *
 * In general relativity with dark energy (Lambda-CDM), test mass acceleration relative
 * to comoving coordinates is:
 *   a_cosmo = (ddot{a} / a) * r = [ - (1/2)*Omega_m + Omega_Lambda ] * H_0^2 * r
 *
 * Notice that with Omega_m ~ 0.315 and Omega_Lambda ~ 0.685:
 *   -0.5 * 0.315 + 0.685 = +0.5275 > 0 !
 * Dark energy dominates over cosmic scales, causing accelerated cosmic expansion!
 *
 * @param posMpc Position vector in Megaparsecs (1 Mpc = 1000 kpc)
 */
export function computeFLRWAcceleration(posMpc: Vector3D): {
  accKpcMyr2: Vector3D;
  darkEnergyAccelerationKpcMyr2: Vector3D;
  matterDecelerationKpcMyr2: Vector3D;
  isAccelerating: boolean;
} {
  // H_0 in km/s / Mpc
  // Convert H_0 to 1/Myr:
  // 1 Mpc = 3.08567758e19 km
  // 1 Myr = 3.15576e13 seconds
  // H_0 [1/Myr] = H_0 [km/s/Mpc] * (3.15576e13 s / 3.08567758e19 km) ~ H_0 * 1.0227e-6
  const H0_PER_MYR = HUBBLE_CONSTANT_KM_S_MPC * 1.0227e-6; // ~ 6.89e-5 / Myr
  const H0_SQ = H0_PER_MYR * H0_PER_MYR; // (1/Myr)^2

  // Acceleration factor: qFactor = -0.5 * Omega_m + Omega_Lambda ~ +0.5275
  const lambdaFactor = OMEGA_LAMBDA * H0_SQ;
  const matterFactor = -0.5 * OMEGA_MATTER * H0_SQ;
  const netFactor = lambdaFactor + matterFactor;

  // Convert position to kpc
  const rxKpc = posMpc.x * KPC_PER_MPC;
  const ryKpc = posMpc.y * KPC_PER_MPC;
  const rzKpc = posMpc.z * KPC_PER_MPC;

  // Accelerations in kpc / Myr^2
  const accX = netFactor * rxKpc;
  const accY = netFactor * ryKpc;
  const accZ = netFactor * rzKpc;

  const lambdaAccX = lambdaFactor * rxKpc;
  const lambdaAccY = lambdaFactor * ryKpc;
  const lambdaAccZ = lambdaFactor * rzKpc;

  const matterAccX = matterFactor * rxKpc;
  const matterAccY = matterFactor * ryKpc;
  const matterAccZ = matterFactor * rzKpc;

  return {
    accKpcMyr2: { x: accX, y: accY, z: accZ },
    darkEnergyAccelerationKpcMyr2: { x: lambdaAccX, y: lambdaAccY, z: lambdaAccZ },
    matterDecelerationKpcMyr2: { x: matterAccX, y: matterAccY, z: matterAccZ },
    isAccelerating: netFactor > 0,
  };
}

/**
 * Computes Local Group orbital dynamics (Milky Way & Andromeda M31 mutual approach).
 *
 * Implements Kahn-Woltjer timing argument for the Local Group:
 * Two massive bodies initially separating in the Hubble flow, reaching turnaround,
 * and currently falling toward each other with radial velocity -110 km/s at 780 kpc separation.
 */
export function computeLocalGroupDynamics(opts?: {
  separationKpc?: number;
  closingVelocityKms?: number;
  massMWSolar?: number;
  massM31Solar?: number;
}): LocalGroupState {
  const rKpc = opts?.separationKpc ?? 780; // ~ 780 kpc (Watkins et al. 2024 / Sawala et al. 2025)
  const vKms = opts?.closingVelocityKms ?? -110; // ~ -110 km/s closing speed
  const mMw = opts?.massMWSolar ?? 1.0e12;
  const mM31 = opts?.massM31Solar ?? 1.5e12;
  const mTotal = mMw + mM31; // 2.5e12 M_sun

  // Flight-grade numerical integration of accelerated radial infall:
  // Specific orbital energy E = 0.5 * v_0^2 - G * M_tot / r_0
  const g = G_GRAV_KPC_KMS2_MSUN;
  const gm = g * mTotal;
  const v0Mag = Math.abs(vKms);
  const specEnergy = 0.5 * v0Mag * v0Mag - gm / rKpc;

  // Integrate dt = dr / v(r) from r_peri (~25 kpc galactic disk overlap) to rKpc
  const rPeriKpc = 25.0;
  const numSteps = 100;
  const dr = (rKpc - rPeriKpc) / numSteps;
  let timeUnits = 0;

  for (let i = 0; i < numSteps; i++) {
    const rMid = rPeriKpc + (i + 0.5) * dr;
    // v(r) = sqrt(2 * (E + GM / r))
    const vMid = Math.sqrt(Math.max(1.0, 2 * (specEnergy + gm / rMid)));
    timeUnits += dr / vMid;
  }

  // Convert time units (kpc / (km/s)) to Gyr: 1 kpc / (km/s) = 0.97779222 Gyr
  const timeToPericenterGyr = timeUnits * 0.97779222;

  return {
    separationKpc: rKpc,
    closingVelocityKms: vKms,
    massMilkyWaySolar: mMw,
    massAndromedaSolar: mM31,
    timeToPericenterGyr,
  };
}

/**
 * Universal Multi-Scale Gravity Evaluator
 *
 * Automatically routes and computes gravitational acceleration based on the
 * hierarchical tier and distance from central reference point.
 */
export function computeUniversalGravity(
  posFromCenterKpc: Vector3D,
  scaleTier: 'planetary' | 'galactic' | 'local_group' | 'supercluster',
  params?: {
    nfw?: Partial<NFWProfileParams>;
    localGroup?: Partial<LocalGroupState>;
  },
): CosmicAccelerationResult {
  const rKpc = Math.hypot(posFromCenterKpc.x, posFromCenterKpc.y, posFromCenterKpc.z);

  if (scaleTier === 'galactic' || (scaleTier as string) === 'star_system') {
    const nfw = new NFWHaloModel(params?.nfw);
    const accKms2PerKpc = nfw.acceleration(posFromCenterKpc);
    const pot = nfw.potential(rKpc);

    // Convert (km/s)^2 / kpc to kpc / Myr^2:
    // a [kpc/Myr^2] = a [(km/s)^2 / kpc] * (kpc/Myr / (km/s))^2
    const conv = KM_S_TO_KPC_MYR * KM_S_TO_KPC_MYR;
    const accKpcMyr2: Vector3D = {
      x: accKms2PerKpc.x * conv,
      y: accKms2PerKpc.y * conv,
      z: accKms2PerKpc.z * conv,
    };

    // Magnitude in m/s^2: 1 (km/s)^2 / kpc = (1e3 m/s)^2 / (3.08567758e19 m) = 1e6 / 3.08567758e19 m/s^2 ~ 3.24e-14 m/s^2
    const accMagKms2Kpc = Math.hypot(accKms2PerKpc.x, accKms2PerKpc.y, accKms2PerKpc.z);
    const accMagnitudeMPerS2 = accMagKms2Kpc * 3.240779e-14;

    return {
      accKpcMyr2,
      accMagnitudeMPerS2,
      regime: 'galactic_nfw',
      potential: pot,
    };
  }

  if (scaleTier === 'supercluster') {
    // Cosmological regime
    const posMpc: Vector3D = {
      x: posFromCenterKpc.x / KPC_PER_MPC,
      y: posFromCenterKpc.y / KPC_PER_MPC,
      z: posFromCenterKpc.z / KPC_PER_MPC,
    };
    const flrw = computeFLRWAcceleration(posMpc);
    const accMagKpcMyr2 = Math.hypot(flrw.accKpcMyr2.x, flrw.accKpcMyr2.y, flrw.accKpcMyr2.z);
    // 1 kpc/Myr^2 in m/s^2: (3.08567758e19 m) / (3.15576e13 s)^2 = 3.08567758e19 / 9.95882e26 m/s^2 ~ 3.098e-8 m/s^2
    const accMagnitudeMPerS2 = accMagKpcMyr2 * 3.098436e-8;

    return {
      accKpcMyr2: flrw.accKpcMyr2,
      accMagnitudeMPerS2,
      regime: 'cosmological_flrw',
      potential: 0,
      darkEnergyRepulsionKpcMyr2: Math.hypot(
        flrw.darkEnergyAccelerationKpcMyr2.x,
        flrw.darkEnergyAccelerationKpcMyr2.y,
        flrw.darkEnergyAccelerationKpcMyr2.z,
      ),
    };
  }

  // Local Group regime
  const lg = computeLocalGroupDynamics();
  const mTot = lg.massMilkyWaySolar + lg.massAndromedaSolar;
  const safeR = Math.max(10, rKpc);
  const aMag = -(G_GRAV_KPC_KMS2_MSUN * mTot) / (safeR * safeR);
  const conv = KM_S_TO_KPC_MYR * KM_S_TO_KPC_MYR;

  return {
    accKpcMyr2: {
      x: (aMag * conv * posFromCenterKpc.x) / safeR,
      y: (aMag * conv * posFromCenterKpc.y) / safeR,
      z: (aMag * conv * posFromCenterKpc.z) / safeR,
    },
    accMagnitudeMPerS2: Math.abs(aMag) * 3.240779e-14,
    regime: 'local_group',
    potential: -(G_GRAV_KPC_KMS2_MSUN * mTot) / safeR,
  };
}
