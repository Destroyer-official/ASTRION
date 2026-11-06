import { describe, expect, it } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { PHASE1_BODIES } from './fixtures/phase1';
import {
  createSimSnapshot,
  hashSimSnapshot,
  parseSimSnapshot,
  serializeSimSnapshot,
  snapshotToState,
  validateSimSnapshot,
} from '@/sim/snapshot';

const model = loadSystem(PHASE1_BODIES);
const snapshot = createSimSnapshot(model, {
  t: 12.5,
  n: model.state.n,
  gm: model.state.gm,
  pos: model.state.pos,
  vel: model.state.vel,
});

describe('deterministic simulation snapshots', () => {
  it('round-trips state through a stable textual form', () => {
    const restored = snapshotToState(parseSimSnapshot(serializeSimSnapshot(snapshot)));

    expect(restored.t).toBe(snapshot.t);
    expect(restored.pos).toEqual(snapshot.pos);
    expect(restored.vel).toEqual(snapshot.vel);
    expect(restored.gm).toEqual(snapshot.gm);
    expect(restored.n).toBe(snapshot.n);
  });

  it('hashes identical state identically and changed state differently', async () => {
    const before = await hashSimSnapshot(snapshot);
    const changed = createSimSnapshot(model, {
      ...snapshotToState(snapshot),
      pos: snapshot.pos.slice(),
      gm: snapshot.gm.slice(),
      vel: snapshot.vel.slice(),
    });
    changed.pos[0] = (changed.pos[0] ?? 0) + 1;

    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSimSnapshot(changed)).not.toBe(before);
  });

  it('rejects shape and finite-value defects instead of producing NaN physics', () => {
    expect(() => validateSimSnapshot({ ...snapshot, version: 999 })).toThrowError(/version/i);
    expect(() => validateSimSnapshot({ ...snapshot, pos: new Float64Array(3 * snapshot.n + 1) })).toThrowError(/length/i);
    const bad = { ...snapshot, t: Number.NaN };
    expect(() => validateSimSnapshot(bad)).toThrowError(/finite/i);
  });
});
