import { describe, it, expect } from 'vitest';
import {
  computeLinkBudget,
  parabolicAntennaGain,
  freeSpacePathLossDb,
  DSN_STATIONS,
  DSN_FREQUENCIES_HZ,
  type SpacecraftComms,
} from '@/physics/linkBudget';
import { AU_KM } from '@/data/constants';

describe('NASA DSN Deep Space Link Budget & Light-Time Telecommunications', () => {
  it('evaluates DSN 34m and 70m parabolic antenna gains accurately', () => {
    // 34m dish at 8.425 GHz with 65% efficiency
    const g34 = parabolicAntennaGain(34.0, DSN_FREQUENCIES_HZ.X_BAND, 0.65);
    // Typical published DSN 34m X-band gain: ~67.5 dBi
    expect(g34).toBeGreaterThan(67.0);
    expect(g34).toBeLessThan(68.5);

    // 70m dish at 8.425 GHz with 68% efficiency
    const g70 = parabolicAntennaGain(70.0, DSN_FREQUENCIES_HZ.X_BAND, 0.68);
    // 70m is ~2.06x larger diameter -> gain is +6.27 dB higher (~73.8 dBi)
    expect(g70).toBeGreaterThan(73.0);
    expect(g70).toBeLessThan(74.5);
  });

  it('computes Free-Space Path Loss at 1 AU accurately', () => {
    const d1AuM = AU_KM * 1000;
    const fspl = freeSpacePathLossDb(d1AuM, DSN_FREQUENCIES_HZ.X_BAND);
    // Canonical X-band (8.425 GHz) FSPL at 1 AU: ~274.5 dB
    expect(fspl).toBeGreaterThan(273.5);
    expect(fspl).toBeLessThan(275.5);
  });

  it('evaluates Mars Reconnaissance Orbiter (MRO) high-rate science downlink to DSN', () => {
    // MRO telecom package: 100W TWTA (+20 dBW) + 3.0m High Gain Antenna (HGA)
    const mroComms: SpacecraftComms = {
      txPowerWatts: 100,
      antennaDiameterM: 3.0,
      antennaEfficiency: 0.60,
    };

    // Mars at 1.5 AU from Earth
    const probePos: [number, number, number] = [1.5, 0, 0];
    const earthPos: [number, number, number] = [0, 0, 0];
    const sunPos: [number, number, number] = [0, 1.0, 0]; // 90 deg off-axis

    const result = computeLinkBudget(probePos, earthPos, sunPos, mroComms, DSN_STATIONS.DSN_34M);

    // Range & Light times
    expect(result.distanceAu).toBeCloseTo(1.5, 3);
    // 1.5 AU / c ≈ 748.5 seconds (~12.47 minutes)
    expect(result.owltSeconds).toBeGreaterThan(740);
    expect(result.owltSeconds).toBeLessThan(760);
    expect(result.rtltSeconds).toBeCloseTo(2 * result.owltSeconds, 3);

    // Received power should be tiny (-140 to -160 dBW), standard for deep space
    expect(result.receivedPowerDbw).toBeGreaterThan(-160);
    expect(result.receivedPowerDbw).toBeLessThan(-130);

    // MRO achieves multi-megabit/s telemetry downlink at 1.5 AU to DSN 34m
    expect(result.achievableBitrateBps).toBeGreaterThan(500_000); // > 500 kbps
    expect(result.isSolarConjunction).toBe(false);
  });

  it('identifies solar conjunction blackout when SEP angle drops below 3 degrees', () => {
    const mroComms: SpacecraftComms = {
      txPowerWatts: 20,
      antennaDiameterM: 1.5,
      antennaEfficiency: 0.60,
    };

    // Probe directly behind the Sun as seen from Earth
    // Earth at [-1, 0, 0], Sun at [0, 0, 0], Probe at [1.5, 0.01, 0] (very small vertical offset)
    const earthPos: [number, number, number] = [-1.0, 0, 0];
    const sunPos: [number, number, number] = [0, 0, 0];
    const probePos: [number, number, number] = [1.5, 0.02, 0];

    const result = computeLinkBudget(probePos, earthPos, sunPos, mroComms);

    expect(result.sepAngleDeg).toBeLessThan(3.0);
    expect(result.isSolarConjunction).toBe(true);
  });
});
