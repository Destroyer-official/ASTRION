import { AU_KM } from '@/data/constants';
import { jdToDate } from '@/physics/time';
import referenceData from '@/data/horizons-reference.json';
import denseData from '@/data/dense-reference.json';
import { cloneState } from '@/physics/system';
import { Yoshida4 } from '@/physics/integrators/yoshida4';
import { newtonianGravity } from '@/physics/forces/gravity';
import { GeneralRelativity } from '@/physics/forces/relativity';
import { SolarQuadrupole } from '@/physics/forces/quadrupole';
import type { SystemState } from '@/physics/types';
import type { SystemModel } from './registry';
import { horizonsClient } from './horizonsClient';

export interface EphemerisWindow {
  min: number;
  max: number;
}

export interface ValidationRow {
  offsetYears: number;
  offsetDays: number;
  id: string;
  name: string;
  errAu: number;
  errKm: number;
}

interface AnchorSample {
  offsetDays: number;
  bodies: Record<string, number[]>;
  /** Optional endpoint velocities in AU/day (dense anchors): enables cubic Hermite. */
  vels?: Record<string, number[]>;
  /** True for the dense table and the epoch anchor, which sample every 1.5/9 d. */
  fine?: boolean;
  /** True only for multi-sample dense/live vectors, excluding the one epoch anchor. */
  dense?: boolean;
}

/** One body's own anchor series. The shipped tables mix densities (inner planets
 *  every 1.5 d, the Sun and outer planets every 9 d), so each body needs its own
 *  node list to be bracketed correctly. */
interface BodyTrack {
  readonly t: Float64Array;
  readonly p: Float64Array;
  readonly v: Float64Array;
  readonly hasV: Uint8Array;
}

function bracketIndex(t: Float64Array, time: number): number {
  let lo = 0;
  let hi = t.length - 1;
  if (time <= t[0]!) return 0;
  if (time >= t[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}

export class EphemerisProvider {
  private readonly model: SystemModel;
  private readonly anchors: AnchorSample[];
  private tracks: Map<string, BodyTrack>;
  private fineSpans = new Map<string, { min: number; max: number }>();
  private validationCache: ValidationRow[] | null = null;

  constructor(model: SystemModel) {
    this.model = model;

    // Anchor at t = 0 from initial model state (positions AND velocities: exact)
    const t0Bodies: Record<string, number[]> = {};
    const t0Vels: Record<string, number[]> = {};
    for (let i = 0; i < model.ids.length; i++) {
      const id = model.ids[i]!;
      t0Bodies[id] = [
        model.state.pos[3 * i]!,
        model.state.pos[3 * i + 1]!,
        model.state.pos[3 * i + 2]!,
      ];
      t0Vels[id] = [
        model.state.vel[3 * i]!,
        model.state.vel[3 * i + 1]!,
        model.state.vel[3 * i + 2]!,
      ];
    }

    const rawSamples = referenceData.samples as AnchorSample[];
    // Dense near-epoch anchors (3d inner / 9d outer, with Horizons velocities).
    const denseSamples: AnchorSample[] = (
      denseData as {
        samples: Array<{ jd: number; bodies: Record<string, { p: number[]; v: number[] }> }>;
      }
    ).samples.map((s) => {
      const bodies: Record<string, number[]> = {};
      const vels: Record<string, number[]> = {};
      for (const [id, pv] of Object.entries(s.bodies)) {
        bodies[id] = pv.p;
        vels[id] = pv.v;
      }
      return { offsetDays: s.jd - model.epochJd, bodies, vels, fine: true, dense: true };
    });
    this.anchors = [
      ...rawSamples,
      ...denseSamples,
      { offsetDays: 0, bodies: t0Bodies, vels: t0Vels, fine: true },
    ].sort((a, b) => a.offsetDays - b.offsetDays);
    this.tracks = this.buildTracks();
  }

  /** Collects, for each body id, only the anchors that actually carry it.
   *  Where the fine (dense) table covers a body's date range, coarse anchors
   *  inside that range are dropped: they carry no velocity, so a lone coarse
   *  node sitting between two fine nodes would replace a Hermite step with a
   *  blended one (measured 3.1e5 km at +365 d against 2.6e-1 km without it). */
  private buildTracks(): Map<string, BodyTrack> {
    type Node = { t: number; p: readonly number[]; v: readonly number[]; hasV: boolean };
    const collected = new Map<string, Node[]>();
    const fineSpan = new Map<string, { min: number; max: number }>();
    this.fineSpans = fineSpan;

    const add = (id: string, node: Node) => {
      const nodes = collected.get(id);
      if (nodes) nodes.push(node);
      else collected.set(id, [node]);
    };

    for (const anchor of this.anchors) {
      if (!anchor.fine) continue;
      for (const [id, position] of Object.entries(anchor.bodies)) {
        const velocity = anchor.vels?.[id];
        add(id, { t: anchor.offsetDays, p: position, v: velocity ?? [0, 0, 0], hasV: Boolean(velocity) });
        if (!anchor.dense) continue;
        const span = fineSpan.get(id);
        if (!span) fineSpan.set(id, { min: anchor.offsetDays, max: anchor.offsetDays });
        else {
          span.min = Math.min(span.min, anchor.offsetDays);
          span.max = Math.max(span.max, anchor.offsetDays);
        }
      }
    }

    for (const anchor of this.anchors) {
      if (anchor.fine) continue;
      for (const [id, position] of Object.entries(anchor.bodies)) {
        const covered = fineSpan.get(id);
        if (covered && anchor.offsetDays > covered.min && anchor.offsetDays < covered.max) continue;
        const velocity = anchor.vels?.[id];
        add(id, { t: anchor.offsetDays, p: position, v: velocity ?? [0, 0, 0], hasV: Boolean(velocity) });
      }
    }

    const built = new Map<string, BodyTrack>();
    for (const [id, nodes] of collected) {
      nodes.sort((a, b) => a.t - b.t);
      const p = new Float64Array(nodes.length * 3);
      const v = new Float64Array(nodes.length * 3);
      const t = new Float64Array(nodes.length);
      const hasV = new Uint8Array(nodes.length);
      nodes.forEach((node, i) => {
        t[i] = node.t;
        p.set(node.p, 3 * i);
        v.set(node.v, 3 * i);
        hasV[i] = node.hasV ? 1 : 0;
      });
      built.set(id, { t, p, v, hasV });
    }
    return built;
  }

  /**
   * Supported time window [minDays, maxDays] relative to the epoch.
   * Outside it, interpolate() clamps to the edge anchor.
   */
  window(): EphemerisWindow {
    return {
      min: this.anchors[0]!.offsetDays,
      max: this.anchors[this.anchors.length - 1]!.offsetDays,
    };
  }

  /**
   * The date range common to every body with dense anchors. Outside it, the
   * shipped table relies on sparse corner anchors separated by years, which was
   * measured to 0.8–18.6 AU of interpolation error against DE440 (VALIDATION_LOG
   * step 7b).
   */
  validatedWindow(): EphemerisWindow | null {
    if (this.fineSpans.size === 0) return null;
    let min = -Infinity;
    let max = Infinity;
    for (const span of this.fineSpans.values()) {
      min = Math.max(min, span.min);
      max = Math.min(max, span.max);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
    return { min, max };
  }

  isWithinValidatedWindow(offsetDays: number): boolean {
    const w = this.validatedWindow();
    return Boolean(w && offsetDays >= w.min && offsetDays <= w.max);
  }

  /**
   * Evaluates the cached Horizons anchors: cubic Hermite (C1) where both bracket
   * nodes carry Horizons velocities, smooth blended linear where they do not.
   * Each body is bracketed by the nearest two anchors that actually contain it —
   * the shipped tables mix densities (inner planets and the Moon every 1.5 d, the
   * Sun and outer planets every 9 d), so one shared date bracket would drop the
   * sparsely sampled bodies back to their epoch state.
   * Returns true when `offsetDays` lies inside the covered window.
   */
  interpolate(offsetDays: number, outPos: Float64Array, outVel?: Float64Array): boolean {
    const minT = this.anchors[0]!.offsetDays;
    const maxT = this.anchors[this.anchors.length - 1]!.offsetDays;
    const clampedT = Math.max(minT, Math.min(maxT, offsetDays));

    for (let i = 0; i < this.model.ids.length; i++) {
      const base = 3 * i;
      const track = this.tracks.get(this.model.ids[i]!);
      if (!track) {
        for (let k = 0; k < 3; k++) {
          outPos[base + k] = this.model.state.pos[base + k]!;
          if (outVel) outVel[base + k] = this.model.state.vel[base + k]!;
        }
        continue;
      }

      // Clamp per body as well: a sparsely sampled body's own last anchor can
      // precede the global window edge, and extrapolating there is worse than
      // holding the edge state.
      const bodyT = Math.max(track.t[0]!, Math.min(track.t[track.t.length - 1]!, clampedT));
      const idx = bracketIndex(track.t, bodyT);
      if (idx === track.t.length - 1 || Math.abs(bodyT - track.t[idx]!) < 1e-6) {
        this.copyNode(track, idx, base, outPos, outVel);
        continue;
      }

      const t0 = track.t[idx]!;
      const t1 = track.t[idx + 1]!;
      const dt = t1 - t0;
      const invDt = 1 / dt;
      const u = (bodyT - t0) * invDt;

      const h00 = 2 * u * u * u - 3 * u * u + 1;
      const h10 = u * u * u - 2 * u * u + u;
      const h01 = -2 * u * u * u + 3 * u * u;
      const h11 = u * u * u - u * u;
      const dh00_dt = (6 * u * u - 6 * u) * invDt;
      const dh01_dt = (-6 * u * u + 6 * u) * invDt;
      const dh10_scaled = 3 * u * u - 4 * u + 1;
      const dh11_scaled = 3 * u * u - 2 * u;
      const hermite = track.hasV[idx] === 1 && track.hasV[idx + 1] === 1;
      const j = 3 * (idx + 1);

      for (let k = 0; k < 3; k++) {
        const p0 = track.p[3 * idx + k]!;
        const p1 = track.p[j + k]!;
        const v0 = track.v[3 * idx + k]!;
        const v1 = track.v[j + k]!;
        outPos[base + k] = hermite ? h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1 : h00 * p0 + h01 * p1;
        if (outVel) {
          outVel[base + k] = hermite
            ? dh00_dt * p0 + dh01_dt * p1 + dh10_scaled * v0 + dh11_scaled * v1
            : dh00_dt * p0 + dh01_dt * p1;
        }
      }
    }

    return offsetDays >= minT && offsetDays <= maxT;
  }

  private copyNode(
    track: BodyTrack,
    index: number,
    base: number,
    outPos: Float64Array,
    outVel?: Float64Array,
  ): void {
    for (let k = 0; k < 3; k++) {
      outPos[base + k] = track.p[3 * index + k]!;
      if (outVel) {
        outVel[base + k] = track.hasV[index] === 1
          ? track.v[3 * index + k]!
          : this.model.state.vel[base + k]!;
      }
    }
  }

  /**
   * Reseeds simulation state from the closest Horizons DE440 anchor, resetting numerical drift to 0.
   */
  reseed(targetDays: number, state: SystemState): boolean {
    let bestAnchor = this.anchors[0]!;
    let minDiff = Math.abs(targetDays - bestAnchor.offsetDays);

    for (const a of this.anchors) {
      const diff = Math.abs(targetDays - a.offsetDays);
      if (diff < minDiff) {
        minDiff = diff;
        bestAnchor = a;
      }
    }

    for (let i = 0; i < this.model.ids.length; i++) {
      const id = this.model.ids[i]!;
      const p = bestAnchor.bodies[id];
      if (p) {
        state.pos[3 * i] = p[0]!;
        state.pos[3 * i + 1] = p[1]!;
        state.pos[3 * i + 2] = p[2]!;
      }
      // Dense anchors carry exact Horizons velocities: reseed those too so
      // the sim continues with the right tangent, not a stale velocity.
      const v = bestAnchor.vels?.[id];
      if (v) {
        state.vel[3 * i] = v[0]!;
        state.vel[3 * i + 1] = v[1]!;
        state.vel[3 * i + 2] = v[2]!;
      }
    }

    state.t = bestAnchor.offsetDays;
    return true;
  }

  /**
   * Reseeds simulation state from live NASA JPL Horizons API vectors if online,
   * falling back to local DE440 anchors. Live vectors outside the dense measured
   * window may initialize the N-body state, but are not added as interpolation
   * anchors because a single point would create year-wide Hermite chords.
   */
  async reseedLive(targetDays: number, state: SystemState): Promise<{ live: boolean; source: string }> {
    const targetJd = this.model.epochJd + targetDays;
    const targetDate = jdToDate(targetJd);
    const supportedForAnchors = this.isWithinValidatedWindow(targetDays);

    try {
      const liveVectors = await horizonsClient.fetchSystem(this.model.ids, targetDate);
      const keys = Object.keys(liveVectors);
      if (keys.length >= 8) {
        const newBodies: Record<string, number[]> = {};
        const newVels: Record<string, number[]> = {};
        for (let i = 0; i < this.model.ids.length; i++) {
          const id = this.model.ids[i]!;
          const vec = liveVectors[id];
          if (vec) {
            state.pos[3 * i] = vec.positionAu[0];
            state.pos[3 * i + 1] = vec.positionAu[1];
            state.pos[3 * i + 2] = vec.positionAu[2];

            state.vel[3 * i] = vec.velocityAuDay[0];
            state.vel[3 * i + 1] = vec.velocityAuDay[1];
            state.vel[3 * i + 2] = vec.velocityAuDay[2];

            newBodies[id] = [...vec.positionAu];
            newVels[id] = [...vec.velocityAuDay];
          }
        }
        state.t = targetDays;

        if (supportedForAnchors) {
          this.anchors.push({ offsetDays: targetDays, bodies: newBodies, vels: newVels, fine: true, dense: true });
          this.anchors.sort((a, b) => a.offsetDays - b.offsetDays);
          // The per-body tracks are built once in the constructor; fresh live anchors
          // must extend them or interpolation keeps using only the shipped tables.
          this.tracks = this.buildTracks();
        }

        return { live: true, source: liveVectors['sun']?.source ?? 'JPL Horizons (ephemeris not reported)' };
      }
    } catch {
      // Offline fallback
    }

    this.reseed(targetDays, state);
    return { live: false, source: 'DE440 (Local)' };
  }

  /**
   * Computes the honest validation table comparing N-body vs JPL Horizons at +1, +10, and +50 years.
   */
  getValidationTable(): ValidationRow[] {
    if (this.validationCache) return this.validationCache;

    const targets = [
      { years: 1, days: 365.25 },
      { years: 10, days: 3652.5 },
      { years: 50, days: 18262.5 },
    ];

    const s = cloneState(this.model.state);
    const y4 = new Yoshida4();
    const forces = [newtonianGravity, new GeneralRelativity(0), new SolarQuadrupole(0)];
    const dt = 0.2;

    const rows: ValidationRow[] = [];

    for (const target of targets) {
      const steps = Math.ceil(Math.abs(target.days - s.t) / dt);
      const h = (target.days - s.t) / steps;
      for (let step = 0; step < steps; step++) {
        y4.step(s, forces, h);
      }

      const anchor = this.anchors.find((a) => Math.abs(a.offsetDays - target.days) < 1e-3);
      if (!anchor) continue;

      for (let i = 0; i < this.model.ids.length; i++) {
        const id = this.model.ids[i]!;
        const pRef = anchor.bodies[id];
        if (!pRef) continue;

        const errAu = Math.hypot(
          s.pos[3 * i]! - pRef[0]!,
          s.pos[3 * i + 1]! - pRef[1]!,
          s.pos[3 * i + 2]! - pRef[2]!,
        );
        const errKm = Math.round(errAu * AU_KM);

        rows.push({
          offsetYears: target.years,
          offsetDays: target.days,
          id,
          name: this.model.names[i]!,
          errAu,
          errKm,
        });
      }
    }

    this.validationCache = rows;
    return rows;
  }
}
