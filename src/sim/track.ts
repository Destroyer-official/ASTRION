import type { ReferenceFrame } from '@/frames/types';
import { mapPoint, squash } from '@/frames/transform';
import type { SystemState } from '@/physics/types';
import type { History } from './history';

/**
 * Rebuild every body's trail in `frame`, relative to the focus's CURRENT position (floating origin).
 * float64 math, float32 only at the end. focus = body index, or -1 for the barycenter.
 * outs[i] must hold at least 3*(history.cap+1) floats. Returns the vertex count (same for every body).
 */
export function buildTracks(
  h: History,
  live: SystemState,
  frame: ReferenceFrame,
  focus: number,
  windowDays: number,
  outs: Float32Array[],
  compress = 1,
): number {
  const ax = frame.axes,
    n = live.n;
  const o = [0, 0, 0],
    p = [0, 0, 0],
    f = [0, 0, 0];

  frame.origin(live.t, live.gm, live.pos, 0, o);
  if (focus >= 0)
    mapPoint(ax, o, live.pos[3 * focus]!, live.pos[3 * focus + 1]!, live.pos[3 * focus + 2]!, f);
  else mapPoint(ax, o, 0, 0, 0, f); // the simulation is barycentric, so the barycenter is the sim origin

  let start = h.count;
  // Walk back from the newest sample while it is inside the window AND
  // continuous with its successor. A time gap means a date jump / reseed /
  // mode switch happened: everything before the gap belongs to a different
  // arc and must never be connected to the live point (no cross-screen streaks).
  const gapTol = Math.max(4 * h.intervalDays, 1e-9);
  for (let k = h.count - 1; k >= 0; k--) {
    if (Math.abs(live.t - h.timeAt(k)) > windowDays) break;
    if (k < h.count - 1 && Math.abs(h.timeAt(k + 1) - h.timeAt(k)) > gapTol) break;
    start = k;
  }

  // Same guard for the tail: a stale newest sample never connects to the live point.
  if (start < h.count && Math.abs(live.t - h.timeAt(h.count - 1)) > gapTol) {
    start = h.count;
  }

  let v = 0;
  const emit = (t: number, pos: Float64Array, base: number) => {
    frame.origin(t, live.gm, pos, base, o); // where the frame's origin was AT THAT TIME
    for (let i = 0; i < n; i++) {
      mapPoint(ax, o, pos[base + 3 * i]!, pos[base + 3 * i + 1]!, pos[base + 3 * i + 2]!, p);
      const out = outs[i]!;
      squash(frame.travelDir, compress, p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!, out, 3 * v);
    }
    v++;
  };
  for (let k = start; k < h.count; k++) emit(h.timeAt(k), h.positions, h.baseAt(k));
  emit(live.t, live.pos, 0);
  return v;
}
