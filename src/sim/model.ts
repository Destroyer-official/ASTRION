import type { BodyJson, PhysicalJson } from '@/data/schema';
import { JD_J2000, gmToInternal, AU_KM } from '@/data/constants';
import { newtonianGravity } from '@/physics/forces/gravity';
import { oblateness } from '@/physics/forces/oblateness';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { yoshida4, yoshida6, yoshida8 } from '@/physics/integrators/yoshida';
import {
  HierarchicalIAS15,
  HierarchicalLeapfrog,
  TidalForce,
  compose,
  type LocalSystem,
  type Slot,
} from '@/physics/hierarchy';
import { stateToElements } from '@/physics/kepler';
import { bodyToEcliptic } from '@/physics/orientation';
import type { ForceModel, Integrator, SystemState, Vec3 } from '@/physics/types';
import type { PhysicsConfig } from './config';
import { buildForces } from './forces';

export interface LocalSystemData {
  hostId: string;
  hostLevel0Index: number;
  planetGm: number;
  systemGm: number;
  bodyIds: string[];
  initialState: SystemState;
  minPeriod: number;
  j2?: number;
  equatorialRadiusAu?: number;
}

export interface ModelData {
  ids: string[];
  names: string[];
  radiusKm: number[];
  colors: string[];
  parentIds: (string | undefined)[];
  epochJd: number;
  level0State: SystemState;
  level0Ids: string[];
  localSystems: LocalSystemData[];
  slots: Slot[];
  global: SystemState;
}

export interface SolverData {
  level0: SystemState;
  systems: LocalSystem[];
  forces: ForceModel[];
  integrator: Integrator;
  slots: Slot[];
}

/**
 * Inverse of compose(): splits global SSB vectors into level-0 system
 * barycenters plus barycentric local states, so an exact external state
 * (e.g. JPL Horizons vectors at an arbitrary date) can be loaded into a live
 * hierarchical solver. Masses come from model.global.gm (per-body values).
 * compose(level0, slots, global) afterwards reproduces the input bit for bit.
 */
export function decomposeGlobal(
  model: ModelData,
  solver: SolverData,
  t: number,
  pos: Float64Array,
  vel: Float64Array,
): void {
  const gid = new Map(model.ids.map((id, i) => [id, i]));
  const covered = new Array<boolean>(model.level0Ids.length).fill(false);

  for (const ls of solver.systems) {
    let M = 0;
    const B = [0, 0, 0],
      Vb = [0, 0, 0];
    const members = ls.bodyIds.map((id) => {
      const gi = gid.get(id);
      if (gi === undefined) throw new Error(`decomposeGlobal: unknown body "${id}"`);
      return gi;
    });
    for (const gi of members) {
      const m = model.global.gm[gi]!;
      M += m;
      for (let d = 0; d < 3; d++) {
        B[d]! += m * pos[3 * gi + d]!;
        Vb[d]! += m * vel[3 * gi + d]!;
      }
    }
    if (!(M > 0)) throw new Error(`decomposeGlobal: non-positive mass for "${ls.hostId}"`);
    for (let d = 0; d < 3; d++) {
      B[d]! /= M;
      Vb[d]! /= M;
    }

    const k = ls.host;
    solver.level0.t = t;
    for (let d = 0; d < 3; d++) {
      solver.level0.pos[3 * k + d] = B[d]!;
      solver.level0.vel[3 * k + d] = Vb[d]!;
    }
    covered[k] = true;

    ls.state.t = t;
    members.forEach((gi, j) => {
      for (let d = 0; d < 3; d++) {
        ls.state.pos[3 * j + d] = pos[3 * gi + d]! - B[d]!;
        ls.state.vel[3 * j + d] = vel[3 * gi + d]! - Vb[d]!;
      }
    });
  }

  // Hostless level-0 bodies (Sun, Mercury, Venus, ...): copy straight across.
  model.level0Ids.forEach((id, k) => {
    if (covered[k]) return;
    const gi = gid.get(id);
    if (gi === undefined) throw new Error(`decomposeGlobal: unknown level-0 body "${id}"`);
    for (let d = 0; d < 3; d++) {
      solver.level0.pos[3 * k + d] = pos[3 * gi + d]!;
      solver.level0.vel[3 * k + d] = vel[3 * gi + d]!;
    }
  });
  solver.level0.t = t;
}

export function buildModel(
  bodies: readonly BodyJson[],
  physicalMap: Record<string, PhysicalJson>,
): ModelData {
  const byId = new Map<string, BodyJson>();
  for (const b of bodies) byId.set(b.id, b);

  // Group moons by parent
  const moonsByParent = new Map<string, BodyJson[]>();
  for (const b of bodies) {
    if (b.parent && byId.has(b.parent)) {
      const list = moonsByParent.get(b.parent) ?? [];
      list.push(b);
      moonsByParent.set(b.parent, list);
    }
  }

  // Level 0 bodies: root bodies and planets (represented as system barycenters)
  const level0Bodies = bodies.filter((b) => !b.parent);
  const n0 = level0Bodies.length;
  const level0Ids = level0Bodies.map((b) => b.id);
  const level0Gm = new Float64Array(n0);
  const level0Pos = new Float64Array(3 * n0);
  const level0Vel = new Float64Array(3 * n0);

  const localSystemsData: LocalSystemData[] = [];
  const vecBody = bodies.find((b) => b.initial.type === 'vectors');
  const epochJd = vecBody && vecBody.initial.type === 'vectors' ? vecBody.initial.epochJd : JD_J2000;

  for (let k = 0; k < n0; k++) {
    const parent = level0Bodies[k]!;
    const moons = moonsByParent.get(parent.id) ?? [];

    const parentGmInternal = gmToInternal(parent.gmKm3S2);
    const moonGms = moons.map((m) => gmToInternal(m.gmKm3S2));
    const totalMoonGm = moonGms.reduce((a, b) => a + b, 0);

    let systemGm: number;
    let planetGm: number;

    if (parent.gmIsSystem) {
      systemGm = parentGmInternal;
      planetGm = Math.max(0, systemGm - totalMoonGm);
    } else {
      planetGm = parentGmInternal;
      systemGm = planetGm + totalMoonGm;
    }

    level0Gm[k] = systemGm;
    if (parent.initial.type === 'vectors') {
      for (let d = 0; d < 3; d++) {
        level0Pos[3 * k + d] = parent.initial.position[d]!;
        level0Vel[3 * k + d] = parent.initial.velocity[d]!;
      }
    }

    if (moons.length > 0) {
      // Local system: planet at index 0, moons at 1..K
      const nLocal = 1 + moons.length;
      const localGm = new Float64Array(nLocal);
      const localPos = new Float64Array(3 * nLocal);
      const localVel = new Float64Array(3 * nLocal);
      localGm[0] = planetGm;

      // Compute barycenter offset c = sum(m_i * x_i) / M
      const cx: [number, number, number] = [0, 0, 0],
        cv: [number, number, number] = [0, 0, 0];
      for (let mIdx = 0; mIdx < moons.length; mIdx++) {
        const m = moons[mIdx]!;
        const mgm = moonGms[mIdx]!;
        localGm[1 + mIdx] = mgm;
        if (m.initial.type === 'vectors') {
          for (let d = 0; d < 3; d++) {
            (cx as number[])[d]! += (mgm / systemGm) * m.initial.position[d]!;
            (cv as number[])[d]! += (mgm / systemGm) * m.initial.velocity[d]!;
          }
        }
      }

      // Planet local position = -c
      for (let d = 0; d < 3; d++) {
        localPos[d] = -cx[d]!;
        localVel[d] = -cv[d]!;
      }

      // Moons local position = x_i - c
      let minPeriod = Infinity;
      for (let mIdx = 0; mIdx < moons.length; mIdx++) {
        const m = moons[mIdx]!;
        if (m.initial.type === 'vectors') {
          for (let d = 0; d < 3; d++) {
            localPos[3 * (1 + mIdx) + d] = m.initial.position[d]! - cx[d]!;
            localVel[3 * (1 + mIdx) + d] = m.initial.velocity[d]! - cv[d]!;
          }
          const rVec: Vec3 = m.initial.position;
          const vVec: Vec3 = m.initial.velocity;
          const mu = planetGm + localGm[1 + mIdx]!;
          const el = stateToElements(mu, rVec, vVec);
          if (el.period > 0 && el.period < minPeriod) minPeriod = el.period;
        }
      }

      const phys = physicalMap[parent.id];

      localSystemsData.push({
        hostId: parent.id,
        hostLevel0Index: k,
        planetGm,
        systemGm,
        bodyIds: [parent.id, ...moons.map((m) => m.id)],
        initialState: {
          t: 0,
          n: nLocal,
          gm: localGm,
          pos: localPos,
          vel: localVel,
        },
        minPeriod: minPeriod < Infinity ? minPeriod : 1.0,
        j2: phys?.j2,
        equatorialRadiusAu: parent.radiusKm / AU_KM,
      });
    }
  }

  // Global body ordering
  const globalBodies = bodies.slice();
  const nGlobal = globalBodies.length;
  const globalPos = new Float64Array(3 * nGlobal);
  const globalVel = new Float64Array(3 * nGlobal);
  const globalGm = new Float64Array(nGlobal);
  const localSysByHostId = new Map<string, LocalSystemData>();
  for (const lsd of localSystemsData) localSysByHostId.set(lsd.hostId, lsd);

  for (let g = 0; g < nGlobal; g++) {
    const b = globalBodies[g]!;
    const lsd = localSysByHostId.get(b.id);
    if (lsd) {
      globalGm[g] = lsd.planetGm;
    } else {
      globalGm[g] = gmToInternal(b.gmKm3S2);
    }
  }

  const level0State: SystemState = {
    t: 0,
    n: n0,
    gm: level0Gm,
    pos: level0Pos,
    vel: level0Vel,
  };

  const globalState: SystemState = {
    t: 0,
    n: nGlobal,
    gm: globalGm,
    pos: globalPos,
    vel: globalVel,
  };

  // Build slot mapping
  const slots: Slot[] = [];

  for (let g = 0; g < nGlobal; g++) {
    const b = globalBodies[g]!;
    if (!b.parent) {
      const k = level0Ids.indexOf(b.id);
      const lsd = localSysByHostId.get(b.id);
      if (lsd) {
        slots.push({ k, sys: { state: lsd.initialState } as unknown as LocalSystem, i: 0 });
      } else {
        slots.push({ k, sys: null, i: 0 });
      }
    } else {
      const parentId = b.parent;
      const k = level0Ids.indexOf(parentId);
      const lsd = localSysByHostId.get(parentId)!;
      const localIdx = lsd.bodyIds.indexOf(b.id);
      slots.push({
        k,
        sys: { state: lsd.initialState } as unknown as LocalSystem,
        i: localIdx,
      });
    }
  }

  compose(level0State, slots, globalState);

  return {
    ids: globalBodies.map((b) => b.id),
    names: globalBodies.map((b) => b.name),
    radiusKm: globalBodies.map((b) => b.radiusKm),
    colors: globalBodies.map((b) => b.color),
    parentIds: globalBodies.map((b) => b.parent),
    epochJd,
    level0State,
    level0Ids,
    localSystems: localSystemsData,
    slots,
    global: globalState,
  };
}

export function buildSolver(
  model: ModelData,
  cfg: PhysicsConfig,
  physicalMap: Record<string, PhysicalJson>,
): SolverData {
  const systems: LocalSystem[] = [];
  const dEpoch = model.epochJd - JD_J2000;

  for (const lsd of model.localSystems) {
    const tide = new TidalForce();
    const forces: ForceModel[] = [newtonianGravity, tide];

    if (cfg.planetJ2 && lsd.j2 && lsd.equatorialRadiusAu) {
      const rot = physicalMap[lsd.hostId]?.rotation;
      const poleFn = (t: number): Vec3 => {
        if (!rot) return [0, 0, 1];
        const m = bodyToEcliptic(rot, dEpoch + t);
        return [m[2]!, m[5]!, m[8]!];
      };
      forces.push(oblateness(0, lsd.j2, lsd.equatorialRadiusAu, poleFn));
    }

    const dtMax = Math.min(cfg.dt, lsd.minPeriod / (cfg.stepsPerPeriod ?? 100));
    const localSys: LocalSystem = {
      host: lsd.hostLevel0Index,
      hostId: lsd.hostId,
      bodyIds: lsd.bodyIds,
      state: {
        t: lsd.initialState.t,
        n: lsd.initialState.n,
        gm: lsd.initialState.gm.slice(),
        pos: lsd.initialState.pos.slice(),
        vel: lsd.initialState.vel.slice(),
      },
      forces,
      tide,
      integrator: yoshida4(new Leapfrog()),
      dtMax: Math.max(1e-4, dtMax),
    };
    systems.push(localSys);
  }

  // Update slots to point to the live local systems
  const sysByHost = new Map<string, LocalSystem>();
  for (const s of systems) sysByHost.set(s.hostId, s);

  const liveSlots: Slot[] = model.slots.map((sl, g) => {
    const bId = model.ids[g]!;
    const parentId = model.parentIds[g];
    const hostId = parentId ?? bId;
    const sys = sysByHost.get(hostId) ?? null;
    return {
      k: sl.k,
      sys,
      i: sl.i,
    };
  });

  const level0Forces = buildForces(model.level0Ids, cfg);
  const hierarchicalBase = new HierarchicalLeapfrog(systems);
  const integrator =
    cfg.integrator === 'ias15'
      ? new HierarchicalIAS15(systems, { epsilon: 1e-12 })
      : cfg.integrator === 'yoshida8' || cfg.integrator === 'truth8'
        ? yoshida8(hierarchicalBase)
        : cfg.integrator === 'yoshida6'
          ? yoshida6(hierarchicalBase)
          : cfg.integrator === 'yoshida4'
            ? yoshida4(hierarchicalBase)
            : hierarchicalBase;

  return {
    level0: {
      t: model.level0State.t,
      n: model.level0State.n,
      gm: model.level0State.gm.slice(),
      pos: model.level0State.pos.slice(),
      vel: model.level0State.vel.slice(),
    },
    systems,
    forces: level0Forces,
    integrator,
    slots: liveSlots,
  };
}
