import { AU_KM, jdToDate } from '@/data/constants';
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
}

export class EphemerisProvider {
  private readonly model: SystemModel;
  private readonly anchors: AnchorSample[];
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
      return { offsetDays: s.jd - model.epochJd, bodies, vels };
    });
    this.anchors = [
      ...rawSamples,
      ...denseSamples,
      { offsetDays: 0, bodies: t0Bodies, vels: t0Vels },
    ].sort((a, b) => a.offsetDays - b.offsetDays);
  }

  /**
   * Supported time window [minDays, maxDays] relative to the epoch.
   * Outside it, interpolate() clamps to the edge anchor.
   */
  window(): { min: number; max: number } {
    return {
      min: this.anchors[0]!.offsetDays,
      max: this.anchors[this.anchors.length - 1]!.offsetDays,
    };
  }

  /**
   * Evaluates DE440 ephemeris positions (and analytical velocities) using smooth
   * piecewise cubic Hermite interpolation.
   * Returns true if within the supported DE440 window [-10 yr, +50 yr], false otherwise.
   */
  interpolate(offsetDays: number, outPos: Float64Array, outVel?: Float64Array): boolean {
    const minT = this.anchors[0]!.offsetDays;
    const maxT = this.anchors[this.anchors.length - 1]!.offsetDays;
    const clampedT = Math.max(minT, Math.min(maxT, offsetDays));
    const inRange = offsetDays >= minT && offsetDays <= maxT;

    // Find interval [i0, i1]
    let idx = 0;
    while (idx < this.anchors.length - 1 && this.anchors[idx + 1]!.offsetDays <= clampedT) {
      idx++;
    }

    const a0 = this.anchors[idx]!;
    if (Math.abs(clampedT - a0.offsetDays) < 1e-6) {
      // Exact anchor match
      for (let i = 0; i < this.model.ids.length; i++) {
        const id = this.model.ids[i]!;
        const p = a0.bodies[id];
        if (p) {
          outPos[3 * i] = p[0]!;
          outPos[3 * i + 1] = p[1]!;
          outPos[3 * i + 2] = p[2]!;
        } else {
          outPos[3 * i] = this.model.state.pos[3 * i]!;
          outPos[3 * i + 1] = this.model.state.pos[3 * i + 1]!;
          outPos[3 * i + 2] = this.model.state.pos[3 * i + 2]!;
        }
        if (outVel) {
          const v = a0.vels?.[id];
          if (v) {
            outVel[3 * i] = v[0]!;
            outVel[3 * i + 1] = v[1]!;
            outVel[3 * i + 2] = v[2]!;
          } else {
            outVel[3 * i] = this.model.state.vel[3 * i]!;
            outVel[3 * i + 1] = this.model.state.vel[3 * i + 1]!;
            outVel[3 * i + 2] = this.model.state.vel[3 * i + 2]!;
          }
        }
      }
      return inRange;
    }

    const a1 = this.anchors[idx + 1]!;
    const t0 = a0.offsetDays;
    const t1 = a1.offsetDays;
    const dt = t1 - t0;
    const invDt = 1 / dt;
    const u = (clampedT - t0) * invDt;

    // Cubic Hermite when both endpoints carry Horizons velocities (dense
    // anchors + t0): exact positions AND tangents at nodes, C1 continuous.
    // Otherwise the legacy smoothstep between sparse position-only anchors.
    const h00 = 2 * u * u * u - 3 * u * u + 1;
    const h10 = u * u * u - 2 * u * u + u;
    const h01 = -2 * u * u * u + 3 * u * u;
    const h11 = u * u * u - u * u;

    // Time derivatives of Hermite basis functions:
    // dh00/dt = (6u^2 - 6u) / dt
    // dh10/dt * dt = 3u^2 - 4u + 1
    // dh01/dt = (-6u^2 + 6u) / dt
    // dh11/dt * dt = 3u^2 - 2u
    const dh00_dt = (6 * u * u - 6 * u) * invDt;
    const dh01_dt = (-6 * u * u + 6 * u) * invDt;
    const dh10_scaled = 3 * u * u - 4 * u + 1;
    const dh11_scaled = 3 * u * u - 2 * u;

    for (let i = 0; i < this.model.ids.length; i++) {
      const id = this.model.ids[i]!;
      const p0 = a0.bodies[id];
      const p1 = a1.bodies[id];
      const v0 = a0.vels?.[id];
      const v1 = a1.vels?.[id];

      if (p0 && p1 && v0 && v1) {
        for (let k = 0; k < 3; k++) {
          outPos[3 * i + k] = h00 * p0[k]! + h10 * dt * v0[k]! + h01 * p1[k]! + h11 * dt * v1[k]!;
          if (outVel) {
            outVel[3 * i + k] = dh00_dt * p0[k]! + dh01_dt * p1[k]! + dh10_scaled * v0[k]! + dh11_scaled * v1[k]!;
          }
        }
      } else if (p0 && p1) {
        outPos[3 * i] = h00 * p0[0]! + h01 * p1[0]!;
        outPos[3 * i + 1] = h00 * p0[1]! + h01 * p1[1]!;
        outPos[3 * i + 2] = h00 * p0[2]! + h01 * p1[2]!;
        if (outVel) {
          outVel[3 * i] = dh00_dt * p0[0]! + dh01_dt * p1[0]!;
          outVel[3 * i + 1] = dh00_dt * p0[1]! + dh01_dt * p1[1]!;
          outVel[3 * i + 2] = dh00_dt * p0[2]! + dh01_dt * p1[2]!;
        }
      } else {
        outPos[3 * i] = this.model.state.pos[3 * i]!;
        outPos[3 * i + 1] = this.model.state.pos[3 * i + 1]!;
        outPos[3 * i + 2] = this.model.state.pos[3 * i + 2]!;
        if (outVel) {
          outVel[3 * i] = this.model.state.vel[3 * i]!;
          outVel[3 * i + 1] = this.model.state.vel[3 * i + 1]!;
          outVel[3 * i + 2] = this.model.state.vel[3 * i + 2]!;
        }
      }
    }
    return inRange;
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
   * falling back to local DE440 anchor tables.
   */
  async reseedLive(targetDays: number, state: SystemState): Promise<{ live: boolean; source: string }> {
    const targetJd = this.model.epochJd + targetDays;
    const targetDate = jdToDate(targetJd);

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

        this.anchors.push({ offsetDays: targetDays, bodies: newBodies, vels: newVels });
        this.anchors.sort((a, b) => a.offsetDays - b.offsetDays);

        return { live: true, source: liveVectors['sun']?.source ?? 'DE441' };
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
