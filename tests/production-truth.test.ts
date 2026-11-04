import { describe, it, expect } from 'vitest';
import { loadSystem, ALL_BODIES, PHYSICAL_MAP } from '@/sim/registry';
import { SimCore } from '@/sim/simCore';
import { AU_KM } from '@/data/constants';
import reference from './fixtures/horizons-reference.json';

// Guards the PRODUCTION configuration end to end: all 32 bodies, hierarchical
// moons, Yoshida-4 + GR + solar J2, dt = 0.2 d — exactly how main.ts drives the
// worker. Advances one year and compares SYSTEM BARYCENTERS against the frozen
// JPL Horizons fixture (no network). Lesson encoded here: Horizons commands
// 3-8 are system barycenters, so moons must be folded back in with global GMs
// before comparing — comparing bare centers invents kilometer-scale "errors".
const MOONS: Record<string, string[]> = {
  earth: ['moon'],
  mars: ['phobos', 'deimos'],
  jupiter: ['io', 'europa', 'ganymede', 'callisto'],
  saturn: ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus'],
  uranus: ['miranda', 'ariel', 'umbriel', 'titania', 'oberon'],
  neptune: ['triton'],
};
// Must match the SimClient options in main.ts, EXCEPT fixedDt: fixed steps can
// only land on multiples of dt, and 365.25/0.2 = 1826.25 leaves a 0.05-day
// carry (72 min = ~200,000 km of Mercury motion, dwarfing the real error).
// dt = 0.25 divides the year exactly (1461 steps); same 4th order, same forces.
const PROD = {
  maxDt: 0.5,
  maxSteps: 2000,
  historyIntervalDays: 2,
  integrator: 'yoshida4',
  relativity: true,
  quadrupole: true,
  fixedDt: 0.25,
} as const;

type Ref = { offsetDays: number; bodies: Record<string, number[]> };

describe('production truth: hierarchical N-body vs JPL Horizons at +1 year', () => {
  it('every system barycenter lands within 150,000 km of DE440 truth', () => {
    const model = loadSystem(ALL_BODIES);
    const core = new SimCore();
    core.handle({
      type: 'init',
      bodies: model.bodies ? [...model.bodies] : undefined,
      physical: PHYSICAL_MAP,
      ids: model.ids,
      t: model.state.t,
      gm: model.state.gm.slice(),
      pos: model.state.pos.slice(),
      vel: model.state.vel.slice(),
      maxDt: PROD.maxDt,
      maxSteps: PROD.maxSteps,
      historyIntervalDays: PROD.historyIntervalDays,
      integrator: PROD.integrator,
      relativity: PROD.relativity,
      quadrupole: PROD.quadrupole,
      fixedDt: PROD.fixedDt,
    });
    let f = core.handle({ type: 'advance', gen: 0, days: 200 })!;
    f = core.handle({ type: 'advance', gen: 0, days: 165.25 })!;
    expect(f.t).toBeCloseTo(365.25, 9); // exact landing: no carry artifact

    const sample = (reference.samples as unknown as Ref[]).find((r) => r.offsetDays === 365.25)!;
    const gid = (id: string) => model.ids.indexOf(id);
    const bary = (host: string): number[] => {
      const members = [host, ...(MOONS[host] ?? [])];
      let M = 0;
      const B = [0, 0, 0];
      for (const id of members) {
        const gi = gid(id);
        const m = model.state.gm[gi]!;
        M += m;
        for (let d = 0; d < 3; d++) B[d]! += m * f.pos[3 * gi + d]!;
      }
      return [B[0]! / M, B[1]! / M, B[2]! / M];
    };

    for (const id of ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      const p = MOONS[id] ? bary(id) : [f.pos[3 * gid(id)]!, f.pos[3 * gid(id) + 1]!, f.pos[3 * gid(id) + 2]!];
      const t = sample.bodies[id]!;
      const errAu = Math.hypot(p[0]! - t[0]!, p[1]! - t[1]!, p[2]! - t[2]!);
      console.log(`${id.padEnd(12)} err ${(errAu * AU_KM).toFixed(0).padStart(8)} km`);
      expect(errAu, `${id} vs Horizons @+1yr`).toBeLessThan(1e-3); // 150,000 km; measured ~200 km
    }
  }, 120_000);
});
