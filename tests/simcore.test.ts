import { describe, it, expect } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { SimCore } from '@/sim/simCore';
import { Engine } from '@/sim/engine';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { newtonianGravity } from '@/physics/forces/gravity';
import { cloneState } from '@/physics/system';
import { PHASE1_BODIES } from './fixtures/phase1';

const model = loadSystem(PHASE1_BODIES);

function start() {
  const core = new SimCore();
  const s = cloneState(model.state);
  const first = core.handle({
    type: 'init',
    t: s.t,
    gm: s.gm,
    pos: s.pos,
    vel: s.vel,
    maxDt: 1,
    maxSteps: 5000,
    historyIntervalDays: 5,
  });
  return { core, first };
}

describe('SimCore', () => {
  it('init replies with the starting state and one seed sample', () => {
    const { first } = start();
    expect(first!.t).toBe(0);
    expect(first!.samples.length / first!.stride).toBe(1);
  });

  it('advance matches a directly driven Engine bit for bit', () => {
    const { core } = start();
    const f = core.handle({ type: 'advance', gen: 0, days: 100 })!;
    const ref = new Engine(cloneState(model.state), [newtonianGravity], new Leapfrog(), 1, 5000);
    ref.advance(100);
    expect(f.advanced).toBe(100);
    expect(f.pos).toEqual(ref.state.pos);
    expect(f.vel).toEqual(ref.state.vel);
  });

  it('records one sample per interval (t = 5, 10, ..., 100)', () => {
    const { core } = start();
    const f = core.handle({ type: 'advance', gen: 0, days: 100 })!;
    expect(f.samples.length / f.stride).toBe(20);
    expect(f.samples[0]).toBe(5);
  });

  it('respects the per-message step cap', () => {
    const { core } = start();
    expect(core.handle({ type: 'advance', gen: 0, days: 1e9 })!.advanced).toBe(5000);
  });

  it('seek lands on the target time and does not flood history', () => {
    // Seeks arrive in bounded hops; the client chains messages until arrival.
    const { core } = start();
    let f = core.handle({ type: 'seek', gen: 1, t: 12_000 })!;
    for (let i = 0; i < 50 && Math.abs(f.t - 12_000) >= 1e-6; i++) {
      f = core.handle({ type: 'seek', gen: 1, t: 12_000 })!;
    }
    expect(f.t).toBeCloseTo(12_000, 6);
    expect(f.samples.length / f.stride).toBe(1);
  });

  it('one seek message advances at most maxSteps*dt days (bounded hop)', () => {
    const { core } = start();
    const f = core.handle({ type: 'seek', gen: 1, t: 12_000 })!;
    expect(f.t).toBeGreaterThan(0);
    expect(f.t).toBeLessThanOrEqual(5000 * 1 + 1); // maxSteps * dt
  });

  it('a new generation restarts recording from the current state', () => {
    const { core } = start();
    core.handle({ type: 'advance', gen: 0, days: 40 });
    const f = core.handle({ type: 'advance', gen: 1, days: 1 })!;
    expect(f.gen).toBe(1);
    expect(f.samples[0]).toBe(40); // seed = state at the moment of the switch
  });

  it('reset returns to t = 0', () => {
    const { core } = start();
    core.handle({ type: 'advance', gen: 0, days: 300 });
    const f = core.handle({ type: 'reset', gen: 1 })!;
    expect(f.t).toBe(0);
    expect(f.pos).toEqual(model.state.pos);
  });

  it('reply arrays are copies (transferring them cannot corrupt the core)', () => {
    const { core } = start();
    const a = core.handle({ type: 'advance', gen: 0, days: 0 })!;
    a.pos[0] = 12345;
    expect(core.handle({ type: 'advance', gen: 0, days: 0 })!.pos[0]).not.toBe(12345);
  });

  it('setPhysics configures integrator and forces dynamically', () => {
    const { core } = start();
    const f = core.handle({
      type: 'setPhysics',
      integrator: 'yoshida4',
      relativity: true,
      quadrupole: true,
      fixedDt: 0.25,
    })!;
    expect(f.type).toBe('frame');
    const fAdv = core.handle({ type: 'advance', gen: 0, days: 1 })!;
    expect(fAdv.advanced).toBeCloseTo(1, 6);
  });
});
