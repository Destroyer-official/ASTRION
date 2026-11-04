import { describe, it, expect } from 'vitest';
import { easeInOutCubic, flightPose } from '@/render/viewer';

describe('camera flight math', () => {
  it('easeInOutCubic is clamped, monotonic, endpoint-exact', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('flightPose starts at the current pose and ends at target + dir * dist', () => {
    const fromPos: [number, number, number] = [10, 0, 0];
    const fromTgt: [number, number, number] = [0, 0, 0];
    const toTgt: [number, number, number] = [5, 5, 0];
    const dir: [number, number, number] = [0, 0, 1];
    const start = flightPose(fromPos, fromTgt, toTgt, dir, 3, 0);
    expect(start.pos).toEqual([10, 0, 0]);
    expect(start.tgt).toEqual([0, 0, 0]);
    const end = flightPose(fromPos, fromTgt, toTgt, dir, 3, 1);
    expect(end.pos).toEqual([5, 5, 3]);
    expect(end.tgt).toEqual([5, 5, 0]);
    const mid = flightPose(fromPos, fromTgt, toTgt, dir, 3, 0.5);
    expect(mid.pos[0]).toBeGreaterThan(5);
    expect(mid.pos[0]).toBeLessThan(10);
  });

  it('zero direction falls back instead of producing NaNs', () => {
    const p = flightPose([0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], 2, 1);
    for (const v of [...p.pos, ...p.tgt]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
