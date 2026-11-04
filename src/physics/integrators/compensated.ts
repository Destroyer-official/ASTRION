/**
 * Kahan Compensated Symplectic Integrator (Velocity Verlet / Leapfrog)
 * ====================================================================
 *
 * Implements compensated summation (Kahan 1965) for symplectic orbital
 * integration, as utilized in high-precision astrodynamics engines (REBOUND,
 * ASSIST; Rein & Tamayo 2015, Holman et al. 2023).
 *
 * In standard double-precision (IEEE 754 float64) integration, small step
 * increments (dt * v or h * a) added to large absolute coordinates (~1 AU)
 * suffer truncation of the lowest 10-15 bits. Over millions of steps, this
 * secular truncation error dominates orbital drift.
 *
 * Compensated summation maintains separate error accumulator buffers:
 *   y = increment - c
 *   t = accumulator + y
 *   c = (t - accumulator) - y
 *   accumulator = t
 *
 * This captures truncated bits and re-injects them on subsequent steps,
 * achieving effective double-double (~106-bit) numerical precision and
 * eliminating secular numerical dissipation.
 *
 * References:
 * - Kahan (1965): "Pracniques: Further remarks on reducing truncation errors",
 *   CACM 8(1):40
 * - Rein & Tamayo (2015): "WHFast: A fast and unbiased implementation of a
 *   symplectic Wisdom-Holman integrator for long term mapping", MNRAS 452:376
 * - Holman et al. (2023): "ASSIST: An Ephemeris-quality Symplectic Integrator
 *   for the Solar System", PSJ 4:69
 *
 * All units: AU (distances), AU/day (velocities), AU³/day² (GM).
 * Pure physics — no DOM, no Three.js, no Date.now().
 */

import type { ForceModel, Integrator, SystemState } from '../types';

export class CompensatedLeapfrog implements Integrator {
  readonly name = 'compensated-leapfrog-kdk';
  private acc = new Float64Array(0);
  private cPos = new Float64Array(0);
  private cVel = new Float64Array(0);

  private accel(s: SystemState, forces: ForceModel[]): void {
    this.acc.fill(0);
    for (const f of forces) f.apply(s, this.acc);
  }

  /**
   * Resets the compensation buffers (e.g. when state is reseeded from ephemeris).
   */
  resetCompensation(): void {
    this.cPos.fill(0);
    this.cVel.fill(0);
  }

  step(s: SystemState, forces: ForceModel[], dt: number): void {
    const m = 3 * s.n;
    if (this.acc.length !== m) {
      this.acc = new Float64Array(m);
      this.cPos = new Float64Array(m);
      this.cVel = new Float64Array(m);
    }

    const h = 0.5 * dt;

    // First velocity half-kick: v(t + h) = v(t) + h * a(t)
    this.accel(s, forces);
    for (let k = 0; k < m; k++) {
      const inc = h * this.acc[k]!;
      const y = inc - this.cVel[k]!;
      const t = s.vel[k]! + y;
      this.cVel[k] = (t - s.vel[k]!) - y;
      s.vel[k] = t;
    }

    // Full position drift: r(t + dt) = r(t) + dt * v(t + h)
    for (let k = 0; k < m; k++) {
      const inc = dt * s.vel[k]!;
      const y = inc - this.cPos[k]!;
      const t = s.pos[k]! + y;
      this.cPos[k] = (t - s.pos[k]!) - y;
      s.pos[k] = t;
    }

    s.t += dt;

    // Second velocity half-kick: v(t + dt) = v(t + h) + h * a(t + dt)
    this.accel(s, forces);
    for (let k = 0; k < m; k++) {
      const inc = h * this.acc[k]!;
      const y = inc - this.cVel[k]!;
      const t = s.vel[k]! + y;
      this.cVel[k] = (t - s.vel[k]!) - y;
      s.vel[k] = t;
    }
  }
}
