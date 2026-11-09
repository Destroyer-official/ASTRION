/**
 * Flight-grade runtime self-test suite (AUDIT-36, Mission §2.9).
 * Verifies core mathematical and computational integrity across all modules.
 */

import { AU_KM, C_LIGHT_KMS, GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import { dateToJd, jdToDate } from '@/physics/time';
import { GalacticPotential } from '@/physics/galacticPotential';
import { newtonianGravity } from '@/physics/forces/gravity';
import { createState } from '@/physics/system';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { Engine } from '@/sim/engine';
import type { HealthRegistry, ModuleHealthStatus } from '@/observability/health';

export interface SelfTestModuleResult {
  status: ModuleHealthStatus;
  durationMs: number;
  detail?: string;
  error?: string;
}

export interface SelfTestResult {
  passed: boolean;
  timestamp: string;
  totalDurationMs: number;
  modules: Record<string, SelfTestModuleResult>;
}

export function runSelfTest(registry?: HealthRegistry): SelfTestResult {
  const startAll = performance.now();
  const modules: Record<string, SelfTestModuleResult> = {};
  let overallPassed = true;

  const testModule = (name: string, fn: () => void) => {
    const t0 = performance.now();
    try {
      fn();
      const durationMs = Math.round((performance.now() - t0) * 100) / 100;
      modules[name] = { status: 'ok', durationMs, detail: 'all checks passed' };
      registry?.update(name, 'ok', 'self-test passed');
    } catch (err) {
      overallPassed = false;
      const durationMs = Math.round((performance.now() - t0) * 100) / 100;
      const errorMsg = err instanceof Error ? err.message : String(err);
      modules[name] = { status: 'failed', durationMs, error: errorMsg };
      registry?.update(name, 'failed', `self-test failed: ${errorMsg}`);
    }
  };

  // 1. Time conversion (UTC <-> TAI <-> TT <-> TDB roundtrip)
  testModule('time-conversion', () => {
    const epoch = new Date('2026-01-01T12:00:00Z');
    const jd = dateToJd(epoch);
    if (!Number.isFinite(jd) || jd < 2400000) throw new Error(`Invalid JD: ${jd}`);
    const back = jdToDate(jd);
    if (Math.abs(back.getTime() - epoch.getTime()) > 5) throw new Error('Time round-trip error > 5ms');
  });

  // 2. Constants & Unit consistency
  testModule('physical-constants', () => {
    if (!(AU_KM > 1.49e8 && AU_KM < 1.50e8)) throw new Error(`AU_KM out of bounds: ${AU_KM}`);
    if (!(C_LIGHT_KMS > 2.99e5 && C_LIGHT_KMS < 3.00e5)) throw new Error(`C_LIGHT_KMS out of bounds: ${C_LIGHT_KMS}`);
    const muSun = gmToInternal(GM_SUN_KM3_S2);
    if (!(muSun > 0.00029 && muSun < 0.00030)) throw new Error(`Sun GM out of Gaussian bounds: ${muSun}`);
  });

  // 3. Symplectic Gravitational Stepper
  testModule('symplectic-stepper', () => {
    const muSun = gmToInternal(GM_SUN_KM3_S2);
    const s = createState([
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 696340, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'earth', name: 'Earth', gm: muSun * 3.0e-6, radiusKm: 6378.1, position: [1.0, 0, 0], velocity: [0, 0.0172, 0] },
    ]);
    const engine = new Engine(s, [newtonianGravity], new Leapfrog(), 1, 100);
    const adv = engine.advance(10);
    if (adv !== 10) throw new Error(`Expected 10 days advanced, got ${adv}`);
    if (!Number.isFinite(engine.state.pos[3])) throw new Error('Non-finite state after advance');
  });

  // 4. Galactic Potential & Dark Matter Halo
  testModule('galactic-potential', () => {
    const pot = new GalacticPotential(220, 8.2);
    const vc = pot.circularSpeedKms(8.2);
    if (Math.abs(vc - 220) > 1e-4) throw new Error(`LSR circular speed mismatch: ${vc}`);
    const [ax] = pot.acceleration(8.2, 0, 0);
    if (!(ax < 0 && Number.isFinite(ax))) throw new Error(`Galactic radial acceleration not inward: ax=${ax}`);
  });

  return {
    passed: overallPassed,
    timestamp: new Date().toISOString(),
    totalDurationMs: Math.round((performance.now() - startAll) * 100) / 100,
    modules,
  };
}
