import type { ForceModel, Integrator, SystemState } from '../types';

/** Kick-drift-kick leapfrog (velocity Verlet). 2nd order, symplectic, time-reversible. */
export class Leapfrog implements Integrator {
  readonly name = 'leapfrog-kdk';
  private acc = new Float64Array(0);

  private accel(s: SystemState, forces: ForceModel[]): void {
    this.acc.fill(0);
    for (const f of forces) f.apply(s, this.acc);
  }

  step(s: SystemState, forces: ForceModel[], dt: number): void {
    if (!Number.isFinite(dt) || dt === 0) return;
    const m = 3 * s.n;
    if (this.acc.length !== m) this.acc = new Float64Array(m);
    const h = 0.5 * dt;

    this.accel(s, forces);
    for (let k = 0; k < m; k++) s.vel[k] = s.vel[k]! + h * this.acc[k]!;
    for (let k = 0; k < m; k++) s.pos[k] = s.pos[k]! + dt * s.vel[k]!;
    s.t += dt;
    if (!Number.isFinite(s.pos[0]!)) return;
    this.accel(s, forces);
    for (let k = 0; k < m; k++) s.vel[k] = s.vel[k]! + h * this.acc[k]!;
  }
}
