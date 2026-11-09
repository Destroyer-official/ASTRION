import type { ForceModel, Integrator, SystemState } from '../types';

const CBRT_2 = Math.cbrt(2);
const W1 = 1 / (2 - CBRT_2);
const W0 = 1 - 2 * W1;

/**
 * 4th-order symplectic, time-reversible integrator (Haruo Yoshida 1990).
 * Composes three 2nd-order symmetric stages with weights [w1, w0, w1].
 * Conserves Poincaré invariants and energy with global truncation error O(dt^4).
 */
export class Yoshida4 implements Integrator {
  readonly name = 'yoshida-4';
  private acc = new Float64Array(0);

  private accel(s: SystemState, forces: ForceModel[]): void {
    this.acc.fill(0);
    for (const f of forces) f.apply(s, this.acc);
  }

  private subStep(s: SystemState, forces: ForceModel[], dt: number): void {
    const m = 3 * s.n;
    const h = 0.5 * dt;

    this.accel(s, forces);
    for (let k = 0; k < m; k++) s.vel[k] = s.vel[k]! + h * this.acc[k]!;
    for (let k = 0; k < m; k++) s.pos[k] = s.pos[k]! + dt * s.vel[k]!;
    this.accel(s, forces);
    for (let k = 0; k < m; k++) s.vel[k] = s.vel[k]! + h * this.acc[k]!;
  }

  step(s: SystemState, forces: ForceModel[], dt: number): void {
    if (!Number.isFinite(dt) || dt === 0) return;
    const m = 3 * s.n;
    if (this.acc.length !== m) this.acc = new Float64Array(m);

    this.subStep(s, forces, W1 * dt);
    if (!Number.isFinite(s.pos[0]!)) return;
    this.subStep(s, forces, W0 * dt);
    if (!Number.isFinite(s.pos[0]!)) return;
    this.subStep(s, forces, W1 * dt);

    s.t += dt;
  }
}
