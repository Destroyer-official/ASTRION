import { describe, it, expect } from 'vitest';
import { hermite } from '@/sim/hermite';

describe('Cubic Hermite interpolation', () => {
  it('interpolates circular orbit (r=1, w=1, h=0.5) with error < 2e-4', () => {
    const t0 = 0;
    const t1 = 0.5;
    const p0 = new Float64Array([Math.cos(t0), Math.sin(t0), 0]);
    const v0 = new Float64Array([-Math.sin(t0), Math.cos(t0), 0]);
    const p1 = new Float64Array([Math.cos(t1), Math.sin(t1), 0]);
    const v1 = new Float64Array([-Math.sin(t1), Math.cos(t1), 0]);

    const out = new Float64Array(3);
    for (let t = t0; t <= t1; t += 0.05) {
      hermite(t0, p0, v0, t1, p1, v1, t, out);
      const trueX = Math.cos(t);
      const trueY = Math.sin(t);
      const err = Math.hypot(out[0]! - trueX, out[1]! - trueY, out[2]!);
      expect(err).toBeLessThan(2e-4);
    }
  });

  it('reproduces endpoints exactly', () => {
    const t0 = 10;
    const t1 = 15;
    const p0 = new Float64Array([1, 2, 3]);
    const v0 = new Float64Array([0.1, 0.2, 0.3]);
    const p1 = new Float64Array([4, 5, 6]);
    const v1 = new Float64Array([0.4, 0.5, 0.6]);

    const out0 = new Float64Array(3);
    hermite(t0, p0, v0, t1, p1, v1, t0, out0);
    expect(out0[0]).toBeCloseTo(p0[0]!, 14);
    expect(out0[1]).toBeCloseTo(p0[1]!, 14);
    expect(out0[2]).toBeCloseTo(p0[2]!, 14);

    const out1 = new Float64Array(3);
    hermite(t0, p0, v0, t1, p1, v1, t1, out1);
    expect(out1[0]).toBeCloseTo(p1[0]!, 14);
    expect(out1[1]).toBeCloseTo(p1[1]!, 14);
    expect(out1[2]).toBeCloseTo(p1[2]!, 14);
  });

  it('works when t1 < t0 (backward time)', () => {
    const t0 = 0.5;
    const t1 = 0;
    const p0 = new Float64Array([Math.cos(t0), Math.sin(t0), 0]);
    const v0 = new Float64Array([-Math.sin(t0), Math.cos(t0), 0]);
    const p1 = new Float64Array([Math.cos(t1), Math.sin(t1), 0]);
    const v1 = new Float64Array([-Math.sin(t1), Math.cos(t1), 0]);

    const out = new Float64Array(3);
    const t = 0.25;
    hermite(t0, p0, v0, t1, p1, v1, t, out);
    const trueX = Math.cos(t);
    const trueY = Math.sin(t);
    const err = Math.hypot(out[0]! - trueX, out[1]! - trueY, out[2]!);
    expect(err).toBeLessThan(2e-4);
  });

  it('interpolates velocities matching analytical circular orbit velocity within 2e-3', () => {
    const t0 = 0;
    const t1 = 0.5;
    const p0 = new Float64Array([Math.cos(t0), Math.sin(t0), 0]);
    const v0 = new Float64Array([-Math.sin(t0), Math.cos(t0), 0]);
    const p1 = new Float64Array([Math.cos(t1), Math.sin(t1), 0]);
    const v1 = new Float64Array([-Math.sin(t1), Math.cos(t1), 0]);

    const outPos = new Float64Array(3);
    const outVel = new Float64Array(3);
    for (let t = t0; t <= t1; t += 0.05) {
      hermite(t0, p0, v0, t1, p1, v1, t, outPos, outVel);
      const trueVx = -Math.sin(t);
      const trueVy = Math.cos(t);
      const vErr = Math.hypot(outVel[0]! - trueVx, outVel[1]! - trueVy, outVel[2]!);
      expect(vErr).toBeLessThan(2e-3);
    }
  });
});
