import type { ForceModel, Integrator, SystemState } from '@/physics/types';
import { angularMomentum, centerOfMass, totalEnergy } from '@/physics/diagnostics';
import { cloneState, isFiniteState } from '@/physics/system';

export interface Diagnostics {
  t: number; // days
  energyDrift: number; // (E - E0) / |E0|
  angMomDrift: number; // |L - L0| / |L0|
  comDriftAu: number; // displacement of the system center of mass from its reference
  baryDistAu: (i: number) => number;
}

export class Engine {
  readonly state: SystemState;
  maxDt: number; // largest allowed step, days
  maxSteps: number; // per advance() call, so a fast slider slows the sim instead of freezing the page
  fixedDt?: number; // fixed step size for exact symplectic energy conservation
  onStep?: (s: SystemState) => void;
  forces: ForceModel[];
  integrator: Integrator;
  private readonly initial: SystemState;
  private e0: number;
  private l0: readonly [number, number, number];
  private l0Magnitude: number;
  private com0: ReturnType<typeof centerOfMass>;
  carry = 0; // target time minus state time; always in (-dt, dt)
  private diverged = false; // set when a step yields a non-finite state; stepping halts so it cannot cascade

  constructor(
    state: SystemState,
    forces: ForceModel[],
    integrator: Integrator,
    maxDt = 1,
    maxSteps = 5000,
  ) {
    this.state = state;
    this.forces = forces;
    this.integrator = integrator;
    this.maxDt = maxDt;
    this.maxSteps = maxSteps;
    this.initial = cloneState(state);
    this.e0 = 0;
    this.l0 = [0, 0, 0];
    this.l0Magnitude = 0;
    this.com0 = { pos: [0, 0, 0], vel: [0, 0, 0] };
    this.rebase();
  }

  /** Advance with fixed step dt. Deterministic, frame-rate independent. */
  advanceFixed(days: number, dt: number): number {
    const total = this.carry + days;
    let n = Math.trunc(total / dt);
    n = Math.max(-this.maxSteps, Math.min(this.maxSteps, n));
    const h = n < 0 ? -dt : dt;
    let executed = 0; // steps actually taken; stepping halts the moment the state goes non-finite
    for (let i = 0; i < Math.abs(n); i++) {
      this.integrator.step(this.state, this.forces, h);
      if (this.onStep) this.onStep(this.state);
      if (!isFiniteState(this.state)) {
        this.diverged = true; // stop advancing: a non-finite state makes every further step meaningless
        executed = i;
        break;
      }
      executed = i + 1;
    }
    this.carry = (total - n * dt) % dt; // JS % keeps the sign; a capped backlog is dropped
    return (n < 0 ? -executed : executed) * dt;
  }

  /** Advance by `days` (negative = backwards). Returns the days actually advanced. */
  advance(days: number): number {
    if (days === 0) return 0;
    const limit = this.maxSteps * this.maxDt;
    const d = Math.max(-limit, Math.min(limit, days));
    const steps = Math.max(1, Math.ceil(Math.abs(d) / this.maxDt));
    const dt = d / steps;
    for (let i = 0; i < steps; i++) {
      this.integrator.step(this.state, this.forces, dt);
      if (this.onStep) this.onStep(this.state);
      if (!isFiniteState(this.state)) {
        this.diverged = true;
        break;
      }
    }
    return d;
  }

  /** True once a step has produced a non-finite state; stepping is then halted until rebase(). */
  isDiverged(): boolean {
    return this.diverged;
  }

  reset(): void {
    this.state.t = this.initial.t;
    this.state.pos.set(this.initial.pos);
    this.state.vel.set(this.initial.vel);
    this.carry = 0;
    this.diverged = false;
    this.rebase();
  }

  /** Re-baseline conservation diagnostics after loading an exact external state. */
  rebase(): void {
    const s = this.state;
    this.diverged = false;
    this.e0 = totalEnergy(s);
    this.l0 = angularMomentum(s);
    this.l0Magnitude = Math.hypot(this.l0[0], this.l0[1], this.l0[2]);
    this.com0 = centerOfMass(s);
  }

  diagnostics(): Diagnostics {
    const s = this.state;
    const e = totalEnergy(s);
    const l = angularMomentum(s);
    const dl = Math.hypot(l[0]! - this.l0[0], l[1]! - this.l0[1], l[2]! - this.l0[2]);
    const com = centerOfMass(s);
    return {
      t: s.t,
      energyDrift: Math.abs(this.e0) > 0 ? (e - this.e0) / Math.abs(this.e0) : 0,
      angMomDrift: this.l0Magnitude > 0 ? dl / this.l0Magnitude : 0,
      comDriftAu: Math.hypot(
        com.pos[0]! - this.com0.pos[0]!,
        com.pos[1]! - this.com0.pos[1]!,
        com.pos[2]! - this.com0.pos[2]!,
      ),
      baryDistAu: (i) =>
        Math.hypot(
          s.pos[3 * i]! - com.pos[0]!,
          s.pos[3 * i + 1]! - com.pos[1]!,
          s.pos[3 * i + 2]! - com.pos[2]!,
        ),
    };
  }
}
