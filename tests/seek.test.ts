import { describe, it, expect } from 'vitest';
import { ALL_BODIES, PHYSICAL_MAP, loadSystem } from '@/sim/registry';
import { SimCore } from '@/sim/simCore';
import type { Frame } from '@/sim/protocol';

// Production-path seeks: hierarchical moons + Yoshida-4 + GR + J2, exactly as
// main.ts configures the worker. Far travel goes through worker `load`
// (instant exact vectors); chained `seek` remains for offline integration.
function startCore(maxSteps: number): { core: SimCore; model: ReturnType<typeof loadSystem> } {
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
    maxSteps,
    historyIntervalDays: 2,
    integrator: 'yoshida4',
    relativity: true,
    quadrupole: true,
    fixedDt: 0.2,
  });
  expect(init!.type).toBe('frame');
  return { core, model };
}

function chainSeek(core: SimCore, target: number, maxHops = 60): Frame {
  let f = core.handle({ type: 'seek', gen: 1, t: target })!;
  for (let i = 1; i < maxHops && Math.abs(f.t - target) >= 1e-6; i++) {
    f = core.handle({ type: 'seek', gen: 1, t: target })!;
  }
  return f;
}

describe('production-path chained seeks (offline fallback)', () => {
  it('one message makes bounded progress (never a multi-minute freeze)', () => {
    const { core } = startCore(250);
    const t0 = performance.now();
    const f = core.handle({ type: 'seek', gen: 1, t: 120 })!;
    const ms = performance.now() - t0;
    console.log(`single bounded hop took ${ms.toFixed(0)} ms, reached t=${f.t.toFixed(1)}`);
    expect(f.t).toBeGreaterThan(0);
    expect(f.t).toBeLessThanOrEqual(250 * 0.2 + 1); // maxSteps * dt
  }, 30_000);

  it('chained seeks land exactly on target across multiple hops', () => {
    const { core } = startCore(250);
    const f = chainSeek(core, 120);
    expect(f.t).toBeCloseTo(120, 6);
    // History holds only the seed sample, not the travelled path.
    expect(f.samples.length / f.stride).toBe(1);
  }, 60_000);
});
