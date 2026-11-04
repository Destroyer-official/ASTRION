export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]; // row-major
export type Writable = { [i: number]: number };

/**
 * A frame maps simulation coordinates to display coordinates:   x_f = R (x_sim - origin)
 * Column-vector convention (SPICE-compatible): R left-multiplies the offset vector.
 * `base` is an offset into the pos/vel array, so history snapshots need no copying.
 * Frames are read-only views: they never mutate their inputs, only write `out`.
 */
export interface ReferenceFrame {
  readonly id: string;
  readonly label: string;
  readonly axes: Mat3 | null; // null = keep simulation axes
  /** Unit vector, in this frame's output axes, along which the whole system travels (galactic frames only). */
  readonly travelDir?: readonly [number, number, number];
  /** Optional angular velocity vector [wx, wy, wz] of the frame in rad/day (for rotating frames) */
  angularVelocity?(t: number): readonly [number, number, number];
  origin(t: number, gm: Float64Array, pos: Float64Array, base: number, out: Writable): void;
  originVelocity(t: number, gm: Float64Array, vel: Float64Array, base: number, out: Writable): void;
}
