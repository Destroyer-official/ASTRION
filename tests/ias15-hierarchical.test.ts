import { describe, it, expect } from 'vitest';
import { ALL_BODIES, buildModel, buildSolver } from '@/sim/registry';
import { Engine } from '@/sim/engine';
import { DEFAULT_CONFIG, type IntegratorName } from '@/sim/config';
import { SimCore } from '@/sim/simCore';
import { cloneState } from '@/physics/system';
import { compose, HierarchicalIAS15 } from '@/physics/hierarchy';
import { IAS15 } from '@/physics/integrators/ias15';
import { yoshida6 } from '@/physics/integrators/yoshida';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { newtonianGravity } from '@/physics/forces/gravity';
import type { ForceModel, Integrator, SystemState } from '@/physics/types';
import { AU_KM } from '@/data/constants';

const SUB = ALL_BODIES.filter((b) => ['sun', 'earth', 'moon', 'jupiter'].includes(b.id));

function solverFor(name: IntegratorName, dt: number) {
  const model = buildModel(SUB, {});
  const cfg = {
    ...DEFAULT_CONFIG,
    integrator: name,
    dt,
    gr: false,
    sunJ2: false,
    planetJ2: false,
  } as const;
  const solver = buildSolver(model, cfg, {});
  return { model, solver };
}

describe('Hierarchical IAS15 (runtime-selectable, AUDIT-17 closure)', () => {
  it(
    'matches a flat brute-force N-body Earth-Moon relative state after 2 yr',
    () => {
      const { model, solver } = solverFor('ias15', 0.5);
      const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.5, 100_000);
      eng.advanceFixed(730.5, 0.5); // 2 years, the same horizon as tests/hierarchy.test.ts
      const hier = cloneState(model.global);
      compose(solver.level0, solver.slots, hier);

      // Reference: flat N-body at 0.01 d with an independent 6th-order method
      const flat = cloneState(model.global);
      const lf = yoshida6(new Leapfrog());
      const flatDt = 0.01;
      const flatSteps = Math.round(730.5 / flatDt);
      for (let i = 0; i < flatSteps; i++) lf.step(flat, [newtonianGravity], flatDt);

      const e = model.ids.indexOf('earth');
      const m = model.ids.indexOf('moon');
      const rel = (s: SystemState) => [0, 1, 2].map((k) => s.pos[3 * m + k]! - s.pos[3 * e + k]!);
      const dAu = Math.hypot(...rel(hier).map((x, k) => x - rel(flat)[k]!));
      const dKm = dAu * AU_KM;

      console.log(
        `IAS15 hierarchical vs flat Earth-Moon relative discrepancy after 2 yr: ${dAu.toExponential(2)} AU (${dKm.toFixed(2)} km)`,
      );
      // Same acceptance class as tests/hierarchy.test.ts (yoshida4 measures 4.6e-6);
      // IAS15 measured 4.9e-6 on the reference machine.
      expect(dAu).toBeLessThan(1e-5);
    },
    120_000,
  );

  it('advances the moons every composed frame (they do not freeze)', () => {
    const { model, solver } = solverFor('ias15', 0.5);
    const before = cloneState(model.global);
    compose(solver.level0, solver.slots, before);

    const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.5, 100_000);
    eng.advanceFixed(30, 0.5);
    const after = cloneState(model.global);
    compose(solver.level0, solver.slots, after);

    const m = model.ids.indexOf('moon');
    expect(after.t).toBe(30);
    const moved = Math.hypot(
      after.pos[3 * m]! - before.pos[3 * m]!,
      after.pos[3 * m + 1]! - before.pos[3 * m + 1]!,
      after.pos[3 * m + 2]! - before.pos[3 * m + 2]!,
    );
    expect(moved).toBeGreaterThan(0.05); // moon visibly moved in 30 days
    // Moon stays gravitationally bound to Earth (within 5 lunar distances)
    const e = model.ids.indexOf('earth');
    const r = Math.hypot(
      after.pos[3 * m]! - after.pos[3 * e]!,
      after.pos[3 * m + 1]! - after.pos[3 * e + 1]!,
      after.pos[3 * m + 2]! - after.pos[3 * e + 2]!,
    );
    expect(r).toBeGreaterThan(1e-3); // moon moved relative to Earth, not collapsed
    expect(r).toBeLessThan(1e-2); // ~1.5e6 km max: still orbiting Earth
  });

  it('is deterministic: two identical runs produce bit-identical states', () => {
    const run = () => {
      const { model, solver } = solverFor('ias15', 0.5);
      const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.5, 100_000);
      eng.advanceFixed(20, 0.5);
      const out = cloneState(model.global);
      compose(solver.level0, solver.slots, out);
      return out;
    };
    const a = run();
    const b = run();
    expect(a.t).toBe(b.t);
    expect([...a.pos]).toEqual([...b.pos]);
    expect([...a.vel]).toEqual([...b.vel]);
  });

  it('SimCore selects IAS15 in flat mode and conserves energy tightly', () => {
    const core = new SimCore();
    const first = core.handle({
      type: 'init',
      config: { ...DEFAULT_CONFIG, integrator: 'ias15', dt: 1 },
      maxSteps: 5000,
      historyIntervalDays: 5,
    });
    expect(first).not.toBeNull();
    const f = core.handle({ type: 'advance', gen: 0, days: 200 })!;
    expect(f.advanced).toBe(200);
    // Measured |dE/E| after 200 d with the default 10-body registry: well below 1e-9
    expect(Math.abs(f.energyDrift)).toBeLessThan(1e-9);
    expect(f.invariantOk).toBe(true);
  });

  it('client protocol unions accept ias15 end to end', () => {
    const core = new SimCore();
    const first = core.handle({
      type: 'init',
      integrator: 'ias15',
      maxSteps: 1000,
      historyIntervalDays: 5,
    })!;
    expect(first).not.toBeNull();
    const f = core.handle({ type: 'setPhysics', integrator: 'ias15' })!;
    expect(f).not.toBeNull();
  });
});

describe('IAS15 non-finite robustness (nothing-crashes contract)', () => {
  const NaN_STATE = (): SystemState => ({
    t: 0,
    n: 2,
    gm: new Float64Array([1e-3, 1e-3]),
    pos: new Float64Array(6),
    vel: new Float64Array(6),
  });

  it('IAS15.feature returns from a corrupted state without hanging', () => {
    const s = NaN_STATE();
    s.pos.fill(Number.NaN);
    const ias = new IAS15({ epsilon: 1e-12, minDt: 1e-8 });
    expect(() => ias.step(s, [newtonianGravity], 1)).not.toThrow();
    expect(Number.isFinite(s.t)).toBe(true);
  });

  it('HierarchicalIAS15 escapes a non-finite state', () => {
    const s = NaN_STATE();
    s.pos.fill(Infinity);
    const integ = new HierarchicalIAS15([], { epsilon: 1e-12 });
    expect(() => integ.step(s, [newtonianGravity], 1)).not.toThrow();
    expect(Number.isFinite(s.t)).toBe(true);
  });

  it('Engine halts stepping on non-finite state and reports divergence', () => {
    class NaNInjector implements Integrator {
      readonly name = 'nan-injector';
      step(s: SystemState, _forces: ForceModel[], dt: number): void {
        s.t += dt;
        s.vel.fill(Number.NaN);
      }
    }
    const s = NaN_STATE();
    s.pos.set([1, 0, 0, -1, 0, 0]);
    const eng = new Engine(s, [newtonianGravity], new NaNInjector(), 1, 100_000);
    const advanced = eng.advanceFixed(50, 1);
    expect(eng.isDiverged()).toBe(true);
    expect(advanced).toBeLessThanOrEqual(1); // stopped right after the corrupting step
    // The frame metric pipeline classifies the non-finite state via invariants
    const d = eng.diagnostics();
    expect(Number.isFinite(d.energyDrift)).toBe(false);
  });

  it('Engine recovers through reset after divergence', () => {
    class NaNInjector implements Integrator {
      readonly name = 'nan-injector';
      step(s: SystemState, _forces: ForceModel[], _dt: number): void {
        s.vel.fill(Number.NaN);
      }
    }
    const s = NaN_STATE();
    s.pos.set([1, 0, 0, -1, 0, 0]);
    const eng = new Engine(s, [newtonianGravity], new NaNInjector(), 1, 100_000);
    eng.advanceFixed(10, 1);
    expect(eng.isDiverged()).toBe(true);
    eng.reset();
    expect(eng.isDiverged()).toBe(false);
  });
});
