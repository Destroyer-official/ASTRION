import { describe, it, expect } from 'vitest';
import { generatePorkchopGrid, keplerStateProvider, computePorkchopPoint } from '@/physics/porkchop';
import { GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import type { KeplerElements } from '@/physics/kepler';

describe('Interplanetary Porkchop Plot & Optimal Window Search', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  // Coplanar circular approximation of Earth and Mars
  const earthOrbit: KeplerElements = {
    a: 1.0,
    e: 0.0,
    inc: 0.0,
    node: 0.0,
    argPeri: 0.0,
    meanAnom: 0.0, // at epoch
    period: 365.256,
  };

  // Mars at departure: ~44.3 degrees ahead for Hohmann rendezvous ~259 days later
  const marsOrbit: KeplerElements = {
    a: 1.524,
    e: 0.0,
    inc: 0.0,
    node: 0.0,
    argPeri: 0.0,
    meanAnom: (44.3 * Math.PI) / 180,
    period: 686.98,
  };

  const epoch = 2451545.0; // J2000
  const originProvider = keplerStateProvider(muSun, earthOrbit, epoch);
  const targetProvider = keplerStateProvider(muSun, marsOrbit, epoch);

  it('computes single porkchop point accurately', () => {
    const oState = originProvider(epoch);
    // 259 days later Mars has moved to Hohmann rendezvous point
    const tState = targetProvider(epoch + 259);

    const pt = computePorkchopPoint(muSun, oState.pos, oState.vel, tState.pos, tState.vel, epoch, epoch + 259);
    expect(pt).not.toBeNull();
    if (pt) {
      expect(pt.tofDays).toBe(259);
      expect(pt.vInfDepKms).toBeGreaterThan(2.0);
      expect(pt.vInfDepKms).toBeLessThan(10.0);
      expect(pt.c3).toBeCloseTo(pt.vInfDepKms * pt.vInfDepKms, 4);
      expect(pt.a).toBeGreaterThan(1.2);
      expect(pt.a).toBeLessThan(1.3);
      expect(pt.propellantFraction).toBeGreaterThan(0.5);
      expect(pt.propellantFraction).toBeLessThan(0.95);
    }
  });

  it('generates 2D porkchop grid and finds optimal departure window', () => {
    const grid = generatePorkchopGrid({
      mu: muSun,
      originState: originProvider,
      targetState: targetProvider,
      depStartJd: epoch,
      depEndJd: epoch + 60,
      depSteps: 7,
      arrStartJd: epoch + 200,
      arrEndJd: epoch + 320,
      arrSteps: 7,
      minTofDays: 150,
      maxTofDays: 350,
      ispS: 380,
    });

    expect(grid.depDates.length).toBe(7);
    expect(grid.arrDates.length).toBe(7);
    expect(grid.c3Grid.length).toBe(7);
    expect(grid.c3Grid[0]!.length).toBe(7);

    // Best point must exist and have reasonable energy
    expect(grid.best).toBeDefined();
    expect(grid.best.dvTotalKms).toBeGreaterThan(3.0);
    expect(grid.best.dvTotalKms).toBeLessThan(20.0);
    expect(grid.best.c3).toBeGreaterThan(0.0);
    expect(grid.best.c3).toBeLessThan(60.0);
  });
});
