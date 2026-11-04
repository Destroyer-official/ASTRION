import { describe, it, expect } from 'vitest';
import { ALL_BODIES, PHYSICAL_MAP, loadSystem } from '@/sim/registry';
import { buildModel, buildSolver, decomposeGlobal } from '@/sim/model';
import { compose } from '@/physics/hierarchy';
import { DEFAULT_CONFIG } from '@/sim/config';
import { SimCore } from '@/sim/simCore';
import { cloneState } from '@/physics/system';
import type { SystemState } from '@/physics/types';
import { PHASE1_BODIES } from './fixtures/phase1';

const PROD_CONFIG = { ...DEFAULT_CONFIG, integrator: 'yoshida4', gr: true, sunJ2: true, dt: 0.2 } as const;

/** Barycenter algebra divides and re-adds, so round-trips agree to ~1e-13, not bitwise. */
function expectArraysClose(a: Float64Array, b: Float64Array, relTol = 1e-12): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const scale = Math.max(1e-30, Math.abs(a[i]!));
    expect(Math.abs(a[i]! - b[i]!) / scale).toBeLessThan(relTol);
  }
}

function prodInit() {
  const model = loadSystem(ALL_BODIES);
  const core = new SimCore();
  const init = core.handle({
    type: 'init',
    bodies: [...ALL_BODIES],
    physical: PHYSICAL_MAP,
    ids: model.ids,
    t: model.state.t,
    gm: model.state.gm.slice(),
    pos: model.state.pos.slice(),
    vel: model.state.vel.slice(),
    maxDt: 0.5,
    maxSteps: 1000,
    historyIntervalDays: 2,
    integrator: 'yoshida4',
    relativity: true,
    quadrupole: true,
    fixedDt: 0.2,
  });
  expect(init!.type).toBe('frame');
  return { core, model };
}

describe('exact state loading (instant travel)', () => {
  it('decompose inverts compose on live hierarchical state', () => {
    const model = buildModel([...ALL_BODIES], PHYSICAL_MAP);
    const solver = buildSolver(model, { ...PROD_CONFIG }, PHYSICAL_MAP);
    for (let i = 0; i < 50; i++) solver.integrator.step(solver.level0, solver.forces, 0.2);

    const global: SystemState = {
      t: 0,
      n: model.ids.length,
      gm: new Float64Array(model.ids.length),
      pos: new Float64Array(3 * model.ids.length),
      vel: new Float64Array(3 * model.ids.length),
    };
    compose(solver.level0, solver.slots, global);
    const wantPos = global.pos.slice(),
      wantVel = global.vel.slice();

    // Clobber everything, then rebuild from the global vectors.
    solver.level0.pos.fill(999);
    for (const ls of solver.systems) ls.state.pos.fill(999);
    decomposeGlobal(model, solver, 10, global.pos, global.vel);

    const back: SystemState = {
      t: 0,
      n: model.ids.length,
      gm: new Float64Array(model.ids.length),
      pos: new Float64Array(3 * model.ids.length),
      vel: new Float64Array(3 * model.ids.length),
    };
    compose(solver.level0, solver.slots, back);
    expect(back.t).toBe(10);
    expectArraysClose(back.pos, wantPos);
    expectArraysClose(back.vel, wantVel);
    expect(solver.level0.t).toBe(10);
  });

  it('worker load reproduces an exact external state and rebases energy', () => {
    const { core: a } = prodInit();
    for (let i = 0; i < 5; i++) a.handle({ type: 'advance', gen: 0, days: 12 });
    const snap = a.handle({ type: 'advance', gen: 0, days: 12 })!;
    const t = snap.t,
      pos = snap.pos.slice(),
      vel = snap.vel.slice();

    const { core: b } = prodInit();
    const loaded = b.handle({ type: 'load', gen: 1, t, pos: pos.slice(), vel: vel.slice() })!;
    expect(loaded.t).toBe(t);
    expectArraysClose(loaded.pos, pos);
    expect(loaded.energyDrift).toBe(0); // rebased: fresh truth, zero inherited drift

    // Both cores now integrate identically (moon subsystems included).
    const fa = a.handle({ type: 'advance', gen: 0, days: 12 })!;
    const fb = b.handle({ type: 'advance', gen: 1, days: 12 })!;
    expectArraysClose(fb.pos, fa.pos, 1e-9);
    expectArraysClose(fb.vel, fa.vel, 1e-9);
  }, 180_000);

  it('worker load also works on the flat (non-hierarchical) path', () => {
    const model = loadSystem(PHASE1_BODIES);
    const mk = () => {
      const core = new SimCore();
      const s = cloneState(model.state);
      core.handle({
        type: 'init',
        t: s.t,
        gm: s.gm,
        pos: s.pos,
        vel: s.vel,
        maxDt: 1,
        maxSteps: 5000,
        historyIntervalDays: 5,
      });
      return core;
    };
    const a = mk();
    a.handle({ type: 'advance', gen: 0, days: 100 });
    const snap = a.handle({ type: 'advance', gen: 0, days: 100 })!;
    const b = mk();
    const loaded = b.handle({ type: 'load', gen: 1, t: snap.t, pos: snap.pos, vel: snap.vel })!;
    expectArraysClose(loaded.pos, snap.pos);
    expect(loaded.energyDrift).toBe(0);
  });
});
