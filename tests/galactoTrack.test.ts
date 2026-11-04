import { describe, it, expect } from 'vitest';
import { History } from '@/sim/history';
import { buildGalactoTracks, VOYAGE_TRAIL_DAYS_MAX, voyageTrailVisible, type GalactoParams } from '@/render/galactoTrack';
import type { SystemState } from '@/physics/types';

import { kmsToAuDay } from '@/data/constants';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const baseParams = (): GalactoParams => ({
  sunGalKpc: [10, 0, 0],
  velGalKms: [0, 0, 0],
  unitsPerKpc: 60,
  helioExag: 2,
  stretch: 1,
  matWorld: IDENTITY,
});

/** Two bodies: sun fixed at origin, planet on a 1 AU circular ecliptic orbit. */
function circularHistory(t0: number, t1: number, w = 0.0172): { h: History; live: SystemState } {
  const h = new History(2, 4000, 1);
  const pos = new Float64Array(6);
  for (let t = t0; t <= t1; t++) {
    pos[0] = 0;
    pos[1] = 0;
    pos[2] = 0;
    pos[3] = Math.cos(w * t);
    pos[4] = Math.sin(w * t);
    pos[5] = 0;
    h.pushRaw(t, pos, 0);
  }
  const live: SystemState = {
    t: t1,
    n: 2,
    gm: new Float64Array([1, 0.001]),
    pos: Float64Array.from(pos),
    vel: new Float64Array(6),
  };
  return { h, live };
}

const mkOuts = () => [new Float32Array(3 * 4001), new Float32Array(3 * 4001)];

describe('voyage helix composition', () => {
  it('sun head pinned to the galactic marker; planet loop at exaggerated radius', () => {
    const { h, live } = circularHistory(0, 10);
    const outs = mkOuts();
    const count = buildGalactoTracks(h, live, baseParams(), 0, 1e9, outs);
    expect(count).toBe(12); // 11 samples + live
    for (let v = 0; v < count; v++) {
      // Sun vertex == sun galactic position on every vertex (identity matrix:
      // the x60 group scale is applied by the real world matrix, not here).
      expect(outs[0]![3 * v]).toBeCloseTo(10, 9);
      expect(outs[0]![3 * v + 1]).toBeCloseTo(0, 9);
      // Planet stays exactly helioExag/unitsPerKpc kpc from the sun (rotation preserves length).
      const d = Math.hypot(
        outs[1]![3 * v]! - outs[0]![3 * v]!,
        outs[1]![3 * v + 1]! - outs[0]![3 * v + 1]!,
        outs[1]![3 * v + 2]! - outs[0]![3 * v + 2]!,
      );
      expect(d).toBeCloseTo(2 / 60, 6); // float32 buffer: 1e-6 precision
    }
  });

  it('voyage drift grows linearly back in time (stretched wake)', () => {
    const { h, live } = circularHistory(0, 10);
    const p = baseParams();
    p.velGalKms = [100, 0, 0];
    p.stretch = 2;
    const outs = mkOuts();
    const count = buildGalactoTracks(h, live, p, 0, 1e9, outs);
    // Sun vertex at sample t must sit behind the live head along +x by
    // V*dt*stretch*(helioExag/unitsPerKpc).
    const per = kmsToAuDay(100) * 2 * (p.helioExag / p.unitsPerKpc);
    for (let v = 0; v < count - 1; v++) {
      const t = v; // samples pushed at t = 0..10 in order
      const want = 10 + per * (t - 10);
      expect(outs[0]![3 * v]).toBeCloseTo(want, 6); // float32 buffer
    }
  });

  it('a time gap restarts the wake (no streak across jumps)', () => {
    const h = new History(2, 4000, 1);
    const pos = new Float64Array(6);
    for (let t = 0; t <= 5; t++) {
      pos[3] = t;
      h.pushRaw(t, pos, 0);
    }
    for (let t = 100; t <= 105; t++) {
      pos[3] = t;
      h.pushRaw(t, pos, 0);
    }
    const live: SystemState = { t: 105, n: 2, gm: new Float64Array(2), pos: Float64Array.from(pos), vel: new Float64Array(6) };
    const outs = mkOuts();
    expect(buildGalactoTracks(h, live, baseParams(), 0, 1e9, outs)).toBe(7); // 6 + live
  });

  it('window limits the wake length', () => {
    const { h, live } = circularHistory(0, 10);
    const outs = mkOuts();
    expect(buildGalactoTracks(h, live, baseParams(), 0, 3, outs)).toBe(5); // t=7..10 + live
  });

  it('voyage window cap keeps multi-year helices from becoming streaks', () => {
    // Sun travels ~0.133 AU/day: the cap holds the wake to ~106 AU (~2.2
    // Earth turns) instead of hundreds of AU of spaghetti at cosmic zoom.
    expect(VOYAGE_TRAIL_DAYS_MAX).toBe(800);
    expect(VOYAGE_TRAIL_DAYS_MAX * 0.133).toBeLessThan(120);
  });

  it('voyage shows planet helices; moon helices only up close', () => {
    expect(voyageTrailVisible(false, 5000)).toBe(true);
    expect(voyageTrailVisible(true, 5000)).toBe(false);
    expect(voyageTrailVisible(true, 100)).toBe(true);
  });

  it('tangential galactic rotation curves round Sagittarius A* without shooting outside galaxy', () => {
    const { h, live } = circularHistory(0, 100);
    const p = baseParams();
    p.sunGalKpc = [-8.2, 0, 0.0208]; // Sun in Orion Arm at 8.2 kpc
    p.velGalKms = [0, 232, 7]; // Solar orbital velocity in galaxy
    p.stretch = 1;
    const outs = mkOuts();
    const count = buildGalactoTracks(h, live, p, 0, 1e9, outs);

    // Every sun vertex in the wake must stay at exactly 8.2 kpc from Sgr A* in the midplane
    for (let v = 0; v < count; v++) {
      const sx = outs[0]![3 * v]!;
      const sy = outs[0]![3 * v + 1]!;
      const r = Math.hypot(sx, sy);
      expect(r).toBeCloseTo(8.2, 3); // Preserves exact 8.2 kpc galactocentric circle!
    }

    // Earliest sample (v = 0) has rotated along the circular arc (sy is negative, sx curves towards 0)
    expect(outs[0]![1]).not.toBe(0); // Rotated azimuthally around Sgr A*
  });
});
