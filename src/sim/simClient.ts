import { cloneState } from '@/physics/system';
import type { SystemState } from '@/physics/types';
import { History } from './history';
import type { Frame, ToWorker } from './protocol';
import type { SystemModel } from './registry';
import { DEFAULT_CONFIG, type IntegratorName, type PhysicsConfig } from './config';
import {
  createSimSnapshot,
  hashSimSnapshot,
  validateSimSnapshot,
  type SimSnapshot,
} from './snapshot';
import { hermite } from './hermite';
import { HealthRegistry, Logger, NOOP_LOG_SINK } from '@/observability';

export interface ClientOptions {
  maxDt: number;
  maxSteps: number;
  historyCap: number;
  historyIntervalDays: number;
  config?: PhysicsConfig;
  integrator?: IntegratorName;
  relativity?: boolean;
  eihRelativity?: boolean;
  quadrupole?: boolean;
  harmonics?: boolean;
  srp?: boolean;
  fixedDt?: number;
  /**
   * Max simulated days per worker message. A hierarchical GR step costs
   * milliseconds, so an uncapped message (e.g. 2000 days = 10k steps) freezes
   * the worker for minutes and the UI shows BUSY forever. Small bites stream.
   */
  chunkDays?: number;
  /** Max queued demand; excess is dropped so a fast slider slows the sim instead of freezing it. */
  maxBacklogDays?: number;
  logger?: Logger;
  health?: HealthRegistry;
}

export class SimClient {
  readonly state: SystemState; // mirror of the worker's latest state
  readonly display: SystemState; // Hermite interpolated display state
  readonly history: History;
  readonly baryDist: Float64Array;
  energyDrift = 0;
  angMomDrift = 0;
  comDrift = 0;
  invariantOk = true;
  invariantViolations: readonly string[] = [];
  ready = false;

  config: PhysicsConfig;
  t0 = 0;
  p0: Float64Array;
  v0: Float64Array;
  t1 = 0;
  p1: Float64Array;
  v1: Float64Array;
  carry = 0;
  inFlightDays = 0;
  dir = 1;

  private worker: Worker;
  private readonly model: SystemModel;
  private readonly opts: ClientOptions;
  private readonly chunkDays: number;
  private readonly maxBacklogDays: number;
  private gen = 0;
  private outstanding = 0; // messages sent minus replies received
  private pending = 0; // requested days not yet sent
  private seeking = false;
  private seekTarget: number | null = null; // chained seeks: worker hops per message
  private fetching = false; // remote truth fetch in flight (travel)
  private failures = 0; // consecutive worker faults (reset by real work, not init)
  private healthIgnore = 0; // admin replies outstanding after a respawn: not proof of health
  private lastPhysics: {
    config?: PhysicsConfig;
    integrator?: IntegratorName;
    relativity?: boolean;
    eihRelativity?: boolean;
    quadrupole?: boolean;
    harmonics?: boolean;
    srp?: boolean;
    fixedDt?: number;
  } | null = null;
  private readonly logger: Logger;
  private readonly health: HealthRegistry;
  private lastInvariantViolations = '';
  /** True after repeated worker crashes: the sim is parked, reload to recover. */
  workerDead = false;

  constructor(model: SystemModel, o: ClientOptions) {
    this.model = model;
    this.opts = o;
    this.logger = o.logger ?? new Logger('sim', NOOP_LOG_SINK);
    this.health = o.health ?? new HealthRegistry();
    this.health.register('physics-worker');
    this.health.register('simulation-state');
    this.state = cloneState(model.state);
    this.display = cloneState(model.state);
    this.baryDist = new Float64Array(this.state.n);
    this.history = new History(this.state.n, o.historyCap, o.historyIntervalDays);
    this.chunkDays = Math.max(1e-9, o.chunkDays ?? 12);
    this.maxBacklogDays = Math.max(this.chunkDays, o.maxBacklogDays ?? 120);

    this.config = o.config ?? {
      ...DEFAULT_CONFIG,
      integrator: o.integrator ?? DEFAULT_CONFIG.integrator,
      dt: o.fixedDt ?? DEFAULT_CONFIG.dt,
      gr: o.relativity ?? DEFAULT_CONFIG.gr,
      sunJ2: o.quadrupole ?? DEFAULT_CONFIG.sunJ2,
    };

    this.t0 = this.state.t;
    this.t1 = this.state.t;
    this.p0 = new Float64Array(this.state.pos);
    this.v0 = new Float64Array(this.state.vel);
    this.p1 = new Float64Array(this.state.pos);
    this.v1 = new Float64Array(this.state.vel);

    this.worker = this.spawnWorker();
    this.sendInit(this.state.t, this.state.pos, this.state.vel);
  }

  private spawnWorker(): Worker {
    const w = new Worker(new URL('../workers/physics.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent<Frame>) => this.onFrame(e.data);
    w.onerror = (e) => this.handleWorkerError(e);
    return w;
  }

  private sendInit(t: number, pos: Float64Array, vel: Float64Array): void {
    const o = this.opts;
    const s = this.model.state;
    this.send({
      type: 'init',
      bodies: this.model.bodies ? [...this.model.bodies] : undefined,
      physical: this.model.physicalMap,
      ids: this.model.ids,
      t,
      gm: s.gm.slice(),
      pos: pos.slice(),
      vel: vel.slice(),
      maxDt: o.maxDt,
      maxSteps: o.maxSteps,
      historyIntervalDays: o.historyIntervalDays,
      config: this.config,
      integrator: this.config.integrator,
      relativity: this.config.gr,
      quadrupole: this.config.sunJ2,
      fixedDt: o.fixedDt,
    });
  }

  /**
   * Self-healing: a crashed worker is terminated and rebuilt, then reseeded
   * from the last good mirror state (never older than one message). An
   * in-flight seek resumes automatically. After 3 consecutive crashes the
   * worker is parked (workerDead) instead of respawn-looping.
   */
  private handleWorkerError(e: unknown): void {
    const willPark = this.failures >= 3;
    this.logger.log('error', 'physics worker fault', this.logger.errorDetails(e, {
      consecutiveFailures: this.failures + 1,
      parked: willPark,
    }));
    if (willPark) {
      this.workerDead = true;
      this.seeking = false;
      this.seekTarget = null;
      this.health.update('physics-worker', 'failed', 'worker parked after 3 faults');
      this.health.update('simulation-state', 'failed', 'integration stopped');
      return;
    }
    this.failures++;
    this.health.update('physics-worker', 'degraded', `restarting worker after fault ${this.failures}`);
    const resumeSeek = this.seekTarget;
    try {
      this.worker.terminate();
    } catch {
      // Already dead; carry on with the rebuild.
    }
    this.bump();
    this.gen = 0; // fresh worker starts its generation count over
    this.ready = false;
    this.worker = this.spawnWorker();
    // Rebuild the solver, then reload the last good mirror state: a fresh
    // init restores EPOCH bodies, which would silently rewind the sim.
    this.sendInit(this.state.t, this.state.pos, this.state.vel);
    this.send({
      type: 'load',
      gen: this.gen,
      t: this.state.t,
      pos: this.state.pos.slice(),
      vel: this.state.vel.slice(),
    });
    if (this.lastPhysics) this.send({ type: 'setPhysics', ...this.lastPhysics });
    // The replies to these admin messages don't prove worker health.
    this.healthIgnore = 2 + (this.lastPhysics ? 1 : 0);
    if (resumeSeek !== null) {
      this.seeking = true;
      this.seekTarget = resumeSeek;
      this.send({ type: 'seek', gen: this.gen, t: resumeSeek });
    }
  }

  get busy(): boolean {
    return this.seeking || this.fetching;
  }

  /** Update display buffer using cubic Hermite interpolation */
  updateDisplay(): void {
    const target = this.t1 + this.carry + this.inFlightDays + this.pending;
    const lag = this.dir * this.config.dt; // dir = +1 forward, -1 backward
    const lo = Math.min(this.t0, this.t1);
    const hi = Math.max(this.t0, this.t1);
    const td = lo === hi ? lo : Math.max(lo, Math.min(hi, target - lag)); // clamp: stalls if physics falls behind
    hermite(this.t0, this.p0, this.v0, this.t1, this.p1, this.v1, td, this.display.pos, this.display.vel);
    this.display.t = td;
    // Velocity is analytically evaluated at td by hermite() above
  }

  /** Ask for `days` more simulated time (negative = backward). Call every animation frame. */
  request(days: number): void {
    if (!this.ready || this.seeking) return;
    this.dir = days >= 0 ? 1 : -1;
    this.pending = Math.max(-this.maxBacklogDays, Math.min(this.maxBacklogDays, this.pending + days));
    if (this.outstanding > 0 || this.pending === 0) return;
    // One bounded bite per message: the worker stays responsive and frames stream.
    const chunk = Math.max(-this.chunkDays, Math.min(this.chunkDays, this.pending));
    this.pending -= chunk;
    this.inFlightDays = chunk;
    this.send({ type: 'advance', gen: this.gen, days: chunk });
  }

  /** Time direction flipped: history is only valid one-way. */
  newDirection(): void {
    this.bump();
  }

  reset(): void {
    this.bump();
    this.send({ type: 'reset', gen: this.gen });
  }

  /** Jump to absolute simulation time (days from epoch). Chained: each worker
   * reply advances one bounded hop toward the target, so even century-scale
   * jumps show live progress and stay cancellable instead of hanging. */
  seek(t: number): void {
    this.bump();
    this.seeking = true;
    this.seekTarget = t;
    this.send({ type: 'seek', gen: this.gen, t });
  }

  /**
   * Instant exact travel: load external truth vectors straight into the worker
   * (no step-by-step integration). Falls back to chained seek when fetch fails.
   * `fetch` returns global SSB pos/vel arrays in model order, or null.
   */
  load(t: number, pos: Float64Array, vel: Float64Array): void {
    this.bump();
    this.seeking = true;
    this.seekTarget = t;
    // Copies: the transfer neuters the sent buffers, never the caller's.
    this.send({ type: 'load', gen: this.gen, t, pos: pos.slice(), vel: vel.slice() });
  }

  /** Snap the Hermite display endpoints to an exact state (post-travel). */
  snapDisplay(t: number, pos: Float64Array, vel: Float64Array): void {
    this.display.t = t;
    this.display.pos.set(pos);
    this.display.vel.set(vel);
    this.t0 = this.t1 = t;
    this.p0.set(pos);
    this.p1.set(pos);
    this.v0.set(vel);
    this.v1.set(vel);
    this.carry = 0;
    this.inFlightDays = 0;
  }

  /** Travel with remote truth when available, chained integration otherwise. */
  async travelTo(
    t: number,
    fetch: (t: number) => Promise<{ pos: Float64Array; vel: Float64Array } | null>,
  ): Promise<boolean> {
    this.fetching = true;
    try {
      const got = await fetch(t);
      if (!got) return false;
      this.load(t, got.pos, got.vel);
      this.snapDisplay(t, got.pos, got.vel);
      return true;
    } finally {
      this.fetching = false;
    }
  }

  /** Capture all state the solver needs for a later deterministic replay. */
  snapshot(): SimSnapshot {
    return createSimSnapshot(this.model, this.state, this.config);
  }

  /** Stable SHA-256 of the snapshot's canonical byte form. */
  hashSnapshot(snapshot: SimSnapshot = this.snapshot()): Promise<string> {
    validateSimSnapshot(snapshot);
    return hashSimSnapshot(snapshot);
  }

  /**
   * Load a validated snapshot. The body order and masses must belong to this
   * model; position and velocity are loaded as one exact state, and physics
   * configuration is reapplied rather than assumed from the live client.
   */
  restoreSnapshot(snapshot: SimSnapshot): void {
    validateSimSnapshot(snapshot);
    if (snapshot.ids.length !== this.model.ids.length ||
      snapshot.ids.some((id, index) => id !== this.model.ids[index])) {
      throw new Error('snapshot body order does not match this model');
    }
    if (snapshot.epochJd !== this.model.epochJd) {
      throw new Error(`snapshot epoch ${snapshot.epochJd} does not match model epoch ${this.model.epochJd}`);
    }
    for (let i = 0; i < snapshot.n; i++) {
      if (snapshot.gm[i] !== this.model.state.gm[i]) {
        throw new Error(`snapshot mass for "${snapshot.ids[i]}" does not match this model`);
      }
    }

    this.state.t = snapshot.t;
    this.state.gm.set(snapshot.gm);
    this.state.pos.set(snapshot.pos);
    this.state.vel.set(snapshot.vel);
    this.load(snapshot.t, snapshot.pos.slice(), snapshot.vel.slice());
    this.snapDisplay(snapshot.t, snapshot.pos, snapshot.vel);
    this.setPhysics({ config: snapshot.config });
  }

  /** Dynamically configure physics models and integrators in the worker. */
  setPhysics(opts: {
    config?: PhysicsConfig;
    integrator?: IntegratorName;
    relativity?: boolean;
    eihRelativity?: boolean;
    quadrupole?: boolean;
    harmonics?: boolean;
    srp?: boolean;
    fixedDt?: number;
  }): void {
    if (opts.config) this.config = { ...opts.config };
    if (opts.integrator) this.config.integrator = opts.integrator;
    if (opts.relativity !== undefined) this.config.gr = opts.relativity;
    if (opts.eihRelativity !== undefined) this.config.eihRelativity = opts.eihRelativity;
    if (opts.quadrupole !== undefined) this.config.sunJ2 = opts.quadrupole;
    if (opts.harmonics !== undefined) this.config.harmonics = opts.harmonics;
    if (opts.srp !== undefined) this.config.srp = opts.srp;
    if (opts.fixedDt !== undefined) this.config.dt = opts.fixedDt;
    this.lastPhysics = { ...opts };
    this.send({ type: 'setPhysics', ...opts });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private bump(): void {
    this.gen++;
    this.outstanding = 0;
    this.inFlightDays = 0;
    this.pending = 0;
    this.seekTarget = null;
    this.history.clear();
  }

  private send(m: ToWorker): void {
    if (this.workerDead) return;
    this.outstanding++;
    this.worker.postMessage(m);
  }

  private onFrame(f: Frame): void {
    if (f.gen !== this.gen) return; // reply from before a reverse/reset/seek: discard
    this.outstanding = 0;
    this.inFlightDays = 0;
    this.ready = true;
    // Only real work proves health: admin replies after a respawn don't.
    const adminReply = this.healthIgnore > 0;
    if (adminReply) this.healthIgnore--;
    else this.failures = 0;

    this.state.t = f.t;
    this.state.pos.set(f.pos);
    this.state.vel.set(f.vel);

    this.t0 = f.t0;
    this.p0.set(f.pos0);
    this.v0.set(f.vel0);
    this.t1 = f.t;
    this.p1.set(f.pos);
    this.v1.set(f.vel);
    this.carry = f.carry;

    this.baryDist.set(f.baryDist);
    this.energyDrift = f.energyDrift;
    this.angMomDrift = f.angMomDrift;
    this.comDrift = f.comDrift;
    this.invariantOk = f.invariantOk;
    this.invariantViolations = f.invariantViolations;
    if (!adminReply) this.recordSimulationHealth(f);
    for (let o = 0; o + f.stride <= f.samples.length; o += f.stride) {
      this.history.pushRaw(f.samples[o]!, f.samples, o + 1);
    }

    if (this.seeking) {
      // Chain the next hop toward the target (same generation, no bump).
      if (this.seekTarget !== null && Math.abs(f.t - this.seekTarget) >= 1e-6) {
        this.send({ type: 'seek', gen: this.gen, t: this.seekTarget });
      } else {
        this.seeking = false;
        this.seekTarget = null;
      }
    }
  }

  private recordSimulationHealth(f: Frame): void {
    this.health.update('physics-worker', 'ok', 'frame received');

    const violations = f.invariantViolations.join(',');
    if (violations !== this.lastInvariantViolations) {
      if (violations) {
        this.logger.log('warn', 'simulation invariant violated', {
          violations,
          energyDrift: f.energyDrift,
          angMomDrift: f.angMomDrift,
          comDriftAu: f.comDrift,
        });
      } else {
        this.logger.info('simulation invariants restored');
      }
      this.lastInvariantViolations = violations;
    }

    this.health.update(
      'simulation-state',
      f.invariantOk ? 'ok' : 'degraded',
      violations || 'metrics within thresholds',
    );
  }
}
