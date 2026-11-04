import type { SystemState } from '@/physics/types';
import type { Mat3, ReferenceFrame, Writable } from './types';

/** out[off..off+2] = R (p - o). No allocation, safe in hot loops. */
export function mapPoint(
  axes: Mat3 | null,
  o: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: Writable,
  off = 0,
): void {
  const dx = x - o[0]!,
    dy = y - o[1]!,
    dz = z - o[2]!;
  if (axes) {
    out[off] = axes[0]! * dx + axes[1]! * dy + axes[2]! * dz;
    out[off + 1] = axes[3]! * dx + axes[4]! * dy + axes[5]! * dz;
    out[off + 2] = axes[6]! * dx + axes[7]! * dy + axes[8]! * dz;
  } else {
    out[off] = dx;
    out[off + 1] = dy;
    out[off + 2] = dz;
  }
}

/**
 * Whole live state into a frame (positions and velocities).
 * For rotating frames, correctly accounts for apparent velocity (subtracts omega x r).
 */
export function transformState(
  frame: ReferenceFrame,
  s: SystemState,
  outPos: Float64Array,
  outVel: Float64Array,
): void {
  const o = [0, 0, 0],
    ov = [0, 0, 0];
  frame.origin(s.t, s.gm, s.pos, 0, o);
  frame.originVelocity(s.t, s.gm, s.vel, 0, ov);
  const omega = frame.angularVelocity ? frame.angularVelocity(s.t) : null;

  for (let i = 0; i < s.n; i++) {
    const px = s.pos[3 * i]!, py = s.pos[3 * i + 1]!, pz = s.pos[3 * i + 2]!;
    mapPoint(frame.axes, o, px, py, pz, outPos, 3 * i);

    if (omega) {
      // Relative vector from origin
      const dx = px - o[0]!, dy = py - o[1]!, dz = pz - o[2]!;
      // Cross product omega x (p - o)
      const wx = omega[1]! * dz - omega[2]! * dy;
      const wy = omega[2]! * dx - omega[0]! * dz;
      const wz = omega[0]! * dy - omega[1]! * dx;
      const relVx = s.vel[3 * i]! - ov[0]! - wx;
      const relVy = s.vel[3 * i + 1]! - ov[1]! - wy;
      const relVz = s.vel[3 * i + 2]! - ov[2]! - wz;
      mapPoint(frame.axes, [0, 0, 0], relVx, relVy, relVz, outVel, 3 * i);
    } else {
      mapPoint(frame.axes, ov, s.vel[3 * i]!, s.vel[3 * i + 1]!, s.vel[3 * i + 2]!, outVel, 3 * i);
    }
  }
}

/** Compress the component of (x,y,z) along unit axis u by factor s. Writes to out[off..]. View-only. */
export function squash(
  u: readonly number[] | undefined,
  s: number,
  x: number,
  y: number,
  z: number,
  out: { [i: number]: number },
  off = 0,
): void {
  if (!u || s === 1) {
    out[off] = x;
    out[off + 1] = y;
    out[off + 2] = z;
    return;
  }
  const k = (s - 1) * (x * u[0]! + y * u[1]! + z * u[2]!);
  out[off] = x + k * u[0]!;
  out[off + 1] = y + k * u[1]!;
  out[off + 2] = z + k * u[2]!;
}
