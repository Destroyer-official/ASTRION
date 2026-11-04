import { AU_KM, C_LIGHT_KMS } from '@/data/constants';
import type { Vec3 } from './types';

export const BOLTZMANN_K = 1.380649e-23; // J/K
export const C_LIGHT_M_S = C_LIGHT_KMS * 1000; // 299,792,458 m/s

/** Standard DSN Downlink Frequencies */
export const DSN_FREQUENCIES_HZ = {
  S_BAND: 2.295e9,  // 2.295 GHz
  X_BAND: 8.425e9,  // 8.425 GHz (Standard deep-space science downlink)
  KA_BAND: 32.05e9, // 32.05 GHz (High-data-rate deep space)
} as const;

export interface DsnStation {
  name: string;
  diameterM: number;
  efficiency: number;
  systemTempK: number;
}

export const DSN_STATIONS = {
  DSN_34M: {
    name: '34-meter Beam Waveguide (BWG)',
    diameterM: 34.0,
    efficiency: 0.65,
    systemTempK: 25.0, // Cryogenic LNA
  },
  DSN_70M: {
    name: '70-meter Deep Space Dish',
    diameterM: 70.0,
    efficiency: 0.68,
    systemTempK: 18.0,
  },
} as const satisfies Record<string, DsnStation>;

export interface SpacecraftComms {
  txPowerWatts: number; // e.g. 20W to 100W
  antennaDiameterM: number; // e.g. 2.4m - 3.7m HGA
  antennaEfficiency: number; // ~0.60
}

export interface LinkBudgetResult {
  /** Distance in AU */
  distanceAu: number;
  /** Distance in kilometers */
  distanceKm: number;
  /** One-Way Light Time in seconds */
  owltSeconds: number;
  /** Round-Trip Light Time in seconds */
  rtltSeconds: number;
  /** Free-Space Path Loss in dB */
  fsplDb: number;
  /** Spacecraft transmitter antenna gain in dBi */
  txGainDbi: number;
  /** Spacecraft Effective Isotropic Radiated Power (EIRP) in dBW */
  eirpDbw: number;
  /** Ground station receiving antenna gain in dBi */
  rxGainDbi: number;
  /** Received power P_r in dBW and Watts */
  receivedPowerDbw: number;
  receivedPowerWatts: number;
  /** Received power spectral density Pr/N0 in dB-Hz */
  prN0DbHz: number;
  /** Achievable downlink telemetry data rate at Eb/N0 = 3 dB (bps) */
  achievableBitrateBps: number;
  /** Sun-Earth-Probe angle in degrees */
  sepAngleDeg: number;
  /** Solar conjunction degradation flag */
  isSolarConjunction: boolean;
}

/**
 * Computes parabolic reflector dish antenna gain in dBi.
 * G = eta * (pi * D / lambda)^2
 */
export function parabolicAntennaGain(diameterM: number, frequencyHz: number, efficiency = 0.65): number {
  const lambda = C_LIGHT_M_S / frequencyHz;
  const gainLinear = efficiency * Math.pow((Math.PI * diameterM) / lambda, 2);
  return 10 * Math.log10(gainLinear);
}

/**
 * Computes Free-Space Path Loss (FSPL) in dB:
 * FSPL_dB = 20*log10(4 * pi * d / lambda)
 */
export function freeSpacePathLossDb(distanceM: number, frequencyHz: number): number {
  if (distanceM <= 0) return 0;
  const lambda = C_LIGHT_M_S / frequencyHz;
  return 20 * Math.log10((4 * Math.PI * distanceM) / lambda);
}

/**
 * Computes complete deep space telecommunications link budget between a spacecraft
 * and a NASA Deep Space Network ground terminal.
 *
 * References:
 * - Yuen (1983), "Deep Space Telecommunications Systems Engineering", JPL DESCANSO
 * - Asmar et al. (2005), "Radio Science with NASA's Deep Space Network"
 */
export function computeLinkBudget(
  probePos: Vec3,
  earthPos: Vec3,
  sunPos: Vec3,
  comms: SpacecraftComms,
  station: DsnStation = DSN_STATIONS.DSN_34M,
  frequencyHz = DSN_FREQUENCIES_HZ.X_BAND,
): LinkBudgetResult {
  const dx = probePos[0] - earthPos[0];
  const dy = probePos[1] - earthPos[1];
  const dz = probePos[2] - earthPos[2];
  const distanceAu = Math.hypot(dx, dy, dz);
  const distanceKm = distanceAu * AU_KM;
  const distanceM = distanceKm * 1000;

  // Light time
  const owltSeconds = distanceKm / C_LIGHT_KMS;
  const rtltSeconds = 2 * owltSeconds;

  // Antenna Gains
  const txGainDbi = parabolicAntennaGain(comms.antennaDiameterM, frequencyHz, comms.antennaEfficiency);
  const rxGainDbi = parabolicAntennaGain(station.diameterM, frequencyHz, station.efficiency);

  // Spacecraft EIRP (dBW) = 10*log10(P_tx) + G_tx
  const txPowerDbw = 10 * Math.log10(Math.max(1e-6, comms.txPowerWatts));
  const eirpDbw = txPowerDbw + txGainDbi;

  // Path loss
  const fsplDb = freeSpacePathLossDb(distanceM, frequencyHz);

  // Received power Pr (dBW) = EIRP - FSPL + G_rx
  const receivedPowerDbw = eirpDbw - fsplDb + rxGainDbi;
  const receivedPowerWatts = Math.pow(10, receivedPowerDbw / 10);

  // Noise spectral density N0 = k_B * T_sys (W/Hz)
  const n0WattsPerHz = BOLTZMANN_K * station.systemTempK;
  const n0DbwHz = 10 * Math.log10(n0WattsPerHz);

  // Pr / N0 (dB-Hz) = Pr(dBW) - N0(dBW/Hz)
  const prN0DbHz = receivedPowerDbw - n0DbwHz;

  // Achievable data rate at required Eb/N0 = 3 dB with LDPC / Turbo codes + 3 dB link margin:
  // Required (Pr / N0)_req = R_b * (Eb/N0) -> log10(R_b) = (Pr/N0 - EbN0_req - Margin) / 10
  const reqEbN0WithMarginDb = 6.0;
  const rateDb = prN0DbHz - reqEbN0WithMarginDb;
  const achievableBitrateBps = rateDb > 0 ? Math.pow(10, rateDb / 10) : 0;

  // Sun-Earth-Probe (SEP) angle
  // Vector Earth -> Probe
  const rEP: Vec3 = [dx, dy, dz];
  const rEPLen = Math.hypot(rEP[0], rEP[1], rEP[2]);

  // Vector Earth -> Sun
  const rES: Vec3 = [sunPos[0] - earthPos[0], sunPos[1] - earthPos[1], sunPos[2] - earthPos[2]];
  const rESLen = Math.hypot(rES[0], rES[1], rES[2]);

  const dotEP_ES = rEP[0] * rES[0] + rEP[1] * rES[1] + rEP[2] * rES[2];
  const cosSep = Math.max(-1, Math.min(1, dotEP_ES / (rEPLen * rESLen)));
  const sepAngleDeg = (Math.acos(cosSep) * 180) / Math.PI;

  // Conjunction occurs when SEP angle is less than 3 degrees
  const isSolarConjunction = sepAngleDeg < 3.0;

  return {
    distanceAu,
    distanceKm,
    owltSeconds,
    rtltSeconds,
    fsplDb,
    txGainDbi,
    eirpDbw,
    rxGainDbi,
    receivedPowerDbw,
    receivedPowerWatts,
    prN0DbHz,
    achievableBitrateBps,
    sepAngleDeg,
    isSolarConjunction,
  };
}
