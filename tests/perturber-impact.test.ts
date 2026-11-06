import { describe, expect, it } from 'vitest';
import { ALL_BODIES, ASTEROID_BODIES, PLANET_BODIES, loadSystem } from '@/sim/registry';
import type { BodyJson } from '@/data/schema';
import type { Vec3 } from '@/physics/types';
import { Engine } from '@/sim/engine';
import { newtonianGravity } from '@/physics/forces/gravity';
import { GeneralRelativity } from '@/physics/forces/relativity';
import { SolarQuadrupole } from '@/physics/forces/quadrupole';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { yoshida4 } from '@/physics/integrators/yoshida';
import { AU_KM } from '@/data/constants';

// What the 12 added perturbers are actually worth. Moons are excluded because their
// pull on the planets is negligible here and hierarchical sub-stepping would only
// slow the measurement down: this is a flat Sun + 8 planets + asteroids system, same
// integrator and force model as production, run twice from an identical state.
const PERTURBER_NOTE = 'ASSIST/JPL n16 massive-asteroid perturber set.';
const LEGACY_ASTEROIDS = ASTEROID_BODIES.filter((b) => b.note !== PERTURBER_NOTE);
const FULL_ASTEROIDS: BodyJson[] = ASTEROID_BODIES;

const YEARS = 20;
const SPAN_DAYS = YEARS * 365.25;
const DT = 1; // days, divides the span closely enough for a difference measurement

function run(list: BodyJson[], dt: number) {
  const model = loadSystem(list);
  const engine = new Engine(
    model.state,
    [newtonianGravity, new GeneralRelativity(0), new SolarQuadrupole(0)],
    yoshida4(new Leapfrog()),
    2,
    1_000_000,
  );
  engine.advanceFixed(SPAN_DAYS, dt);
  return { model, engine };
}

function positionOf(runner: ReturnType<typeof run>, id: string): Vec3 {
  const i = runner.model.ids.indexOf(id);
  const s = runner.engine.state;
  return [s.pos[3 * i]!, s.pos[3 * i + 1]!, s.pos[3 * i + 2]!];
}

/** Distance the two systems drift apart for one planet, in km. */
function shiftKm(legacy: ReturnType<typeof run>, full: ReturnType<typeof run>, id: string) {
  const [ax, ay, az] = positionOf(legacy, id);
  const [bx, by, bz] = positionOf(full, id);
  return Math.hypot(ax! - bx!, ay! - by!, az! - bz!) * AU_KM;
}

// Measured 2026-11-06 with dt = 1 d over 20 yr (yoshida4, gravity + 1PN + solar J2).
const BASELINE_KM: Record<string, number> = {
  earth: 1.051,
  mars: 2.111,
  jupiter: 5.682,
  saturn: 1.827,
};

describe('massive-asteroid perturber impact on the planets', () => {
  const legacy = run([...PLANET_BODIES, ...LEGACY_ASTEROIDS], DT);
  const full = run([...PLANET_BODIES, ...FULL_ASTEROIDS], DT);

  it('both systems integrate the requested span', () => {
    expect(legacy.engine.state.t).toBeCloseTo(SPAN_DAYS, 6);
    expect(full.engine.state.t).toBeCloseTo(SPAN_DAYS, 6);
  });

  it('the 12 extra perturbers move the planets by a measurable, bounded amount', () => {
    for (const [id, expected] of Object.entries(BASELINE_KM)) {
      const km = shiftKm(legacy, full, id);
      console.log(`${id}: ${km.toFixed(3)} km after ${YEARS} yr (baseline ${expected} km)`);
      // The shift must be real (kilometres, not rounding) and must stay a
      // perturbation, not a restructuring of the planetary orbits. The last
      // assertion holds each value within ~5 % of the recorded baseline, so a
      // changed perturber mass or vector shows up here instead of silently.
      expect(km, `${id} is perturbed`).toBeGreaterThan(0.1);
      expect(km, `${id} perturbation stays small`).toBeLessThan(20_000);
      expect(km / expected, `${id} matches the measured baseline`).toBeCloseTo(1, 1);
    }
  });

  it('the measured shift is physics, not a step-size artifact', () => {
    const coarseLegacy = run([...PLANET_BODIES, ...LEGACY_ASTEROIDS], 2 * DT);
    const coarseFull = run([...PLANET_BODIES, ...FULL_ASTEROIDS], 2 * DT);
    for (const id of Object.keys(BASELINE_KM)) {
      const fine = shiftKm(legacy, full, id);
      const coarse = shiftKm(coarseLegacy, coarseFull, id);
      expect(Math.abs(coarse - fine) / fine, `${id} converges with dt`).toBeLessThan(0.1);
    }
  });


  it('the full set loads 16 asteroid perturbers and 48 bodies in total', () => {
    expect(FULL_ASTEROIDS.length).toBe(16);
    expect(ALL_BODIES.length).toBe(48);
    expect(LEGACY_ASTEROIDS.length).toBe(4);
  });
});
