import type { BodyDef, SystemState } from './types';
import { centerOfMass } from './diagnostics';

export function createState(defs: readonly BodyDef[], t = 0): SystemState {
  const n = defs.length;
  const s: SystemState = {
    t,
    n,
    gm: new Float64Array(n),
    pos: new Float64Array(3 * n),
    vel: new Float64Array(3 * n),
  };
  defs.forEach((d, i) => {
    s.gm[i] = d.gm;
    s.pos.set(d.position, 3 * i);
    s.vel.set(d.velocity, 3 * i);
  });
  return s;
}

export function cloneState(s: SystemState): SystemState {
  return { t: s.t, n: s.n, gm: s.gm.slice(), pos: s.pos.slice(), vel: s.vel.slice() };
}

/** True when every transported state component (including time) is finite. */
export function isFiniteState(s: SystemState): boolean {
  if (!Number.isFinite(s.t)) return false;
  for (let i = 0; i < s.pos.length; i++) {
    if (!Number.isFinite(s.pos[i]!)) return false;
  }
  for (let i = 0; i < s.vel.length; i++) {
    if (!Number.isFinite(s.vel[i]!)) return false;
  }
  return true;
}

/** Shift so the center of mass is at the origin and at rest. This is what makes the frame "barycentric". */
export function recenterToBarycenter(s: SystemState): void {
  const c = centerOfMass(s);
  for (let i = 0; i < s.n; i++) {
    for (let k = 0; k < 3; k++) {
      s.pos[3 * i + k] = s.pos[3 * i + k]! - c.pos[k]!;
      s.vel[3 * i + k] = s.vel[3 * i + k]! - c.vel[k]!;
    }
  }
}
