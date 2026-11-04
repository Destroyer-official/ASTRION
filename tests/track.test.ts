import { it, expect } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { cloneState } from '@/physics/system';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { newtonianGravity } from '@/physics/forces/gravity';
import { buildFrames } from '@/frames/registry';
import { History } from '@/sim/history';
import { buildTracks } from '@/sim/track';
import { PHASE1_BODIES } from './fixtures/phase1';

const model = loadSystem(PHASE1_BODIES);
const S = model.ids.indexOf('sun'),
  J = model.ids.indexOf('jupiter');
const frames = buildFrames(model.ids, model.names);
const F = (id: string) => frames.find((f) => f.id === id)!;
const A = 5.202887,
  E = 0.04838624;
const mu = model.state.gm[J]! / (model.state.gm[S]! + model.state.gm[J]!);

// ONE simulation run, ONE history, reused for every frame below.
const CAP = 4000;
const s = cloneState(model.state),
  lf = new Leapfrog(),
  hist = new History(s.n, CAP, 5);
hist.sample(s);
for (let i = 0; i < 4400; i++) {
  lf.step(s, [newtonianGravity], 1);
  hist.sample(s);
}
const mkOuts = () => model.ids.map(() => new Float32Array(3 * (CAP + 1)));
const radius = (o: Float32Array, v: number) => Math.hypot(o[3 * v]!, o[3 * v + 1]!, o[3 * v + 2]!);

it('heliocentric trails: Jupiter traces its Kepler ellipse, Sun is a single point', () => {
  const outs = mkOuts();
  const count = buildTracks(hist, s, F('body:sun'), S, 1e9, outs);
  expect(count).toBeGreaterThan(800);
  for (let v = 0; v < count; v++) {
    expect(radius(outs[S]!, v)).toBe(0);
    const r = radius(outs[J]!, v);
    expect(r).toBeGreaterThan(A * (1 - E) * (1 - 1e-4));
    expect(r).toBeLessThan(A * (1 + E) * (1 + 1e-4));
  }
});

it('barycentric trails (same history): the Sun stays within mu*a*(1±e) of the barycenter', () => {
  const outs = mkOuts();
  const count = buildTracks(hist, s, F('barycentric'), -1, 1e9, outs);
  for (let v = 0; v < count; v++) {
    const r = radius(outs[S]!, v);
    expect(r).toBeGreaterThan(mu * A * (1 - E) * (1 - 1e-3));
    expect(r).toBeLessThan(mu * A * (1 + E) * (1 + 1e-3));
  }
});

it('galactic trails: both bodies share the Sun’s ~49 AU/yr streak, Jupiter stays ~a from the Sun', () => {
  const outs = mkOuts();
  const count = buildTracks(hist, s, F('galactic'), S, 1e9, outs);
  const first = 0,
    last = count - 1;
  const streak = Math.hypot(
    outs[S]![3 * first]! - outs[S]![3 * last]!,
    outs[S]![3 * first + 1]! - outs[S]![3 * last + 1]!,
    outs[S]![3 * first + 2]! - outs[S]![3 * last + 2]!,
  );
  expect(streak / (4400 / 365.25)).toBeGreaterThan(48.5); // AU per year
  expect(streak / (4400 / 365.25)).toBeLessThan(49.6);
  // Jupiter relative to the Sun in the galactic frame is still a Kepler orbit:
  for (let v = 0; v < count; v += 50) {
    const d = Math.hypot(
      outs[J]![3 * v]! - outs[S]![3 * v]!,
      outs[J]![3 * v + 1]! - outs[S]![3 * v + 1]!,
      outs[J]![3 * v + 2]! - outs[S]![3 * v + 2]!,
    );
    expect(d).toBeGreaterThan(A * (1 - E) * 0.999);
    expect(d).toBeLessThan(A * (1 + E) * 1.001);
  }
});

it('trail window limits the history used', () => {
  const outs = mkOuts();
  const all = buildTracks(hist, s, F('barycentric'), -1, 1e9, outs);
  const oneYear = buildTracks(hist, s, F('barycentric'), -1, 365.25, outs);
  expect(oneYear).toBeLessThan(all / 5);
  expect(oneYear).toBeGreaterThan(60); // ~73 samples
});

it('a time gap restarts the trail: no segment ever spans a date jump', () => {
  // Continuous run, then a teleported sample (date jump / reseed / mode switch).
  const h = new History(s.n, CAP, 5);
  const c = cloneState(model.state);
  h.sample(c);
  const step = new Leapfrog();
  for (let i = 0; i < 200; i++) {
    step.step(c, [newtonianGravity], 1);
    h.sample(c);
  }
  // Jump: same state shape, +1000 days with nothing in between.
  const jumped = cloneState(c);
  jumped.t += 1000;
  h.pushRaw(jumped.t, jumped.pos, 0);

  const outs = mkOuts();
  const count = buildTracks(h, jumped, F('body:sun'), S, 1e9, outs);
  // Only the post-jump sample + the live point: the 200 pre-jump samples
  // must not connect across the gap (that connection was the cross-screen streak).
  expect(count).toBe(2);
});
