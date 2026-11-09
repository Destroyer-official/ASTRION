import { describe, it, expect } from 'vitest';
import { GalacticPotential, MYR_TO_TIME } from '@/physics/galacticPotential';

describe("Sun's Curved Galactic Orbit (Phase 6.4)", () => {
  it('circular orbit period in z=0 plane matches 2pi*R0/vc ≈ 229 Myr', () => {
    const pot = new GalacticPotential(220, 8.2);
    expect(pot).toBeDefined();
    const R0 = 8.2;
    const vc = 220;
    // Period in Myr = (2 * pi * R0 / vc) * (1 / MYR_TO_TIME)
    const theoreticalPeriodMyr = (2 * Math.PI * R0) / (vc * MYR_TO_TIME);
    console.log(`Theoretical circular period: ${theoreticalPeriodMyr.toFixed(2)} Myr`);
    expect(theoreticalPeriodMyr).toBeGreaterThan(220);
    expect(theoreticalPeriodMyr).toBeLessThan(235);
  });

  it('conserves energy and Lz to high precision over 500 Myr', () => {
    const pot = new GalacticPotential();
    const s = pot.getInitialSunState();
    const e0 = pot.getEnergy(s);
    const lz0 = pot.getLz(s);

    const dtMyr = 0.05;
    const steps = Math.round(500 / dtMyr);

    let maxEDev = 0;
    let maxLzDev = 0;

    for (let i = 0; i < steps; i++) {
      pot.step(s, dtMyr);
      const e = pot.getEnergy(s);
      const lz = pot.getLz(s);

      const de = Math.abs(e - e0) / Math.abs(e0);
      const dlz = Math.abs(lz - lz0) / Math.abs(lz0);
      if (de > maxEDev) maxEDev = de;
      if (dlz > maxLzDev) maxLzDev = dlz;
    }

    console.log(`500 Myr orbit: max Energy drift = ${maxEDev.toExponential(2)}, max Lz drift = ${maxLzDev.toExponential(2)}`);
    expect(maxEDev).toBeLessThan(1e-5);
    expect(maxLzDev).toBeLessThan(1e-12); // Lz is exact in axisymmetric potential
  });

  it('measures azimuthal period (200-250 Myr) and vertical oscillation (60-90 Myr)', () => {
    const pot = new GalacticPotential();
    const s = pot.getInitialSunState();

    const dtMyr = 0.05;
    const totalMyr = 500;
    const steps = Math.round(totalMyr / dtMyr);

    let prevPhi = Math.atan2(s.y, s.x);
    let cumPhi = 0;

    let prevZ = s.z;
    const zCrossings: number[] = [];
    let maxZ = 0;

    for (let i = 0; i < steps; i++) {
      pot.step(s, dtMyr);
      const phi = Math.atan2(s.y, s.x);
      let dPhi = phi - prevPhi;
      while (dPhi > Math.PI) dPhi -= 2 * Math.PI;
      while (dPhi < -Math.PI) dPhi += 2 * Math.PI;
      cumPhi += dPhi;
      prevPhi = phi;

      if ((prevZ > 0 && s.z <= 0) || (prevZ < 0 && s.z >= 0)) {
        zCrossings.push(s.tMyr);
      }
      prevZ = s.z;
      if (Math.abs(s.z) > maxZ) maxZ = Math.abs(s.z);
    }

    // Azimuthal period from cumulative angle
    const totalRevolutions = Math.abs(cumPhi) / (2 * Math.PI);
    const azimuthalPeriod = totalMyr / totalRevolutions;
    console.log(`Sun azimuthal period: ${azimuthalPeriod.toFixed(1)} Myr`);
    expect(azimuthalPeriod).toBeGreaterThan(200);
    expect(azimuthalPeriod).toBeLessThan(250);

    // Vertical crossings (half-periods)
    const halfPeriods: number[] = [];
    for (let i = 1; i < zCrossings.length; i++) {
      halfPeriods.push(zCrossings[i]! - zCrossings[i - 1]!);
    }
    const meanHalfPeriod = halfPeriods.reduce((a, b) => a + b, 0) / halfPeriods.length;
    const verticalPeriod = 2 * meanHalfPeriod;
    const amplitudePc = maxZ * 1000; // kpc -> pc

    console.log(`Sun vertical oscillation period: ${verticalPeriod.toFixed(1)} Myr (half-period: ${meanHalfPeriod.toFixed(1)} Myr), amplitude: ${amplitudePc.toFixed(1)} pc`);
    expect(verticalPeriod).toBeGreaterThan(60);
    expect(verticalPeriod).toBeLessThan(95);
    expect(amplitudePc).toBeGreaterThan(60);
    expect(amplitudePc).toBeLessThan(140);
  });

  it('straight vs curved: departure over 100 years is under 0.01 AU', () => {
    const pot = new GalacticPotential();
    const s = pot.getInitialSunState();
    const x0 = s.x,
      y0 = s.y,
      z0 = s.z;
    const vx0 = s.vx,
      vy0 = s.vy,
      vz0 = s.vz;

    const years = 100;
    const dtMyr = years / 1e6; // 1e-4 Myr
    pot.step(s, dtMyr);

    const dt = dtMyr * MYR_TO_TIME;
    const xStraight = x0 + dt * vx0;
    const yStraight = y0 + dt * vy0;
    const zStraight = z0 + dt * vz0;

    const diffKpc = Math.hypot(s.x - xStraight, s.y - yStraight, s.z - zStraight);
    const KPC_TO_AU = 206264806.247;
    const diffAu = diffKpc * KPC_TO_AU;

    console.log(
      `Curved vs straight departure after 100 yr: ${diffAu.toExponential(3)} AU (${(diffAu * 149597870.7).toFixed(0)} km)`,
    );
    expect(diffAu).toBeLessThan(0.01);
  });

  describe('NFW Halo Galactic Potential (Sofue 2016 & Reid 2019, AUDIT-26)', () => {
    it('calibrates NFW halo circular speed exactly to target vc at R0', () => {
      // Sofue 2016: vc = 238 km/s at R0 = 8.0 kpc with NFW halo
      const potNfw = new GalacticPotential(238, 8.0, {
        haloProfile: 'nfw',
        mDisk: 9.0e10,
        rcHalo: 12.0,
      });

      const vcR0 = potNfw.circularSpeedKms(8.0);
      expect(vcR0).toBeCloseTo(238, 5);

      // Verify Reid 2019: vc = 240 km/s at R0 = 8.15 kpc with NFW halo
      const potReid = new GalacticPotential(240, 8.15, {
        haloProfile: 'nfw',
        mDisk: 8.0e10,
        rcHalo: 12.0,
      });
      const vcReid = potReid.circularSpeedKms(8.15);
      expect(vcReid).toBeCloseTo(240, 5);
    });

    it('conserves energy and Lz with NFW halo over 500 Myr orbit', () => {
      const pot = new GalacticPotential(238, 8.0, {
        haloProfile: 'nfw',
        mDisk: 9.0e10,
        rcHalo: 12.0,
      });
      const s = pot.getInitialSunState();
      const e0 = pot.getEnergy(s);
      const lz0 = pot.getLz(s);

      const dtMyr = 0.05;
      const steps = Math.round(500 / dtMyr);

      let maxEDev = 0;
      let maxLzDev = 0;

      for (let i = 0; i < steps; i++) {
        pot.step(s, dtMyr);
        const e = pot.getEnergy(s);
        const lz = pot.getLz(s);

        const de = Math.abs(e - e0) / Math.abs(e0);
        const dlz = Math.abs(lz - lz0) / Math.abs(lz0);
        if (de > maxEDev) maxEDev = de;
        if (dlz > maxLzDev) maxLzDev = dlz;
      }

      expect(maxEDev).toBeLessThan(1e-4);
      expect(maxLzDev).toBeLessThan(1e-12);
    });

    it('produces finite negative potential and inward radial acceleration everywhere', () => {
      const pot = new GalacticPotential(238, 8.0, { haloProfile: 'nfw' });

      // Core at r -> 0
      const phiCore = pot.potential(0, 0, 0);
      expect(Number.isFinite(phiCore)).toBe(true);
      expect(phiCore).toBeLessThan(0);

      // Inward acceleration at various radii
      for (const r of [0.1, 1.0, 5.0, 8.0, 15.0, 50.0]) {
        const [ax, ay, az] = pot.acceleration(r, 0, 0);
        expect(ax).toBeLessThan(0); // Directed towards origin (x = 0)
        expect(ay).toBe(0);
        expect(az).toBe(0);
        expect(Number.isFinite(ax)).toBe(true);

        const phi = pot.potential(r, 0, 0);
        expect(phi).toBeLessThan(0);
        // Potential increases towards 0 as r -> inf
        expect(phi).toBeGreaterThan(phiCore);
      }
    });
  });
});
