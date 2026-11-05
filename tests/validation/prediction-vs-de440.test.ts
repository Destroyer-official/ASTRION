import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AU_KM, DAY_S, JD_J2000 } from '@/data/constants';
import { ALL_BODIES, loadSystem } from '@/sim/registry';
import { cloneState } from '@/physics/system';
import { yoshida6 } from '@/physics/integrators/yoshida';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { buildForces } from '@/sim/forces';
import { DEFAULT_CONFIG } from '@/sim/config';
import { SpkFile } from '@/sim/spk';

const kernelName = process.env.SPK_KERNEL ?? 'de440.bsp';
const cachePath = fileURLToPath(new URL(`./.cache/${kernelName}`, import.meta.url));
const hasKernel = existsSync(cachePath);

const TARGETS: Record<string, number> = {
  sun: 10,
  mercury: 1,
  venus: 2,
  earth: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
};

/** Horizon in days -> the position error the shipped defaults are allowed to reach.
 *  Every number here was measured on 2026-11-05 against `de440.bsp` with
 *  DEFAULT_CONFIG (yoshida6, dt = 1 d, Newton + Sun 1PN + Sun J2, no asteroid
 *  perturbers), each horizon starting from the epoch state:
 *    +1 yr   mercury 9.286e+2, earth 1.174e+2, venus 3.63e+1, mars 1.0, sun 0.2,
 *            jupiter 0.3, neptune 0.1, saturn and uranus 0.0 km
 *    +10 yr  mercury 9.668e+4, venus 3.801e+3, earth 1.965e+3, mars 1.307e+2,
 *            neptune 6.7, jupiter 27.6, saturn 4.6, uranus 1.5, sun 2.1 km
 *    +50 yr  mercury 2.184e+6, venus 9.498e+4, earth 2.743e+4, mars 3.778e+3,
 *            neptune 1.961e+2, jupiter 1.450e+2, saturn 6.26e+1, uranus 2.83e+1, sun 2.17e+1 km
 *    -10 yr  mercury 1.006e+5, venus 3.752e+3, earth 1.959e+3, mars 1.676e+2,
 *            jupiter 2.41e+1, neptune 6.3, saturn 5.0, uranus 1.8, sun 4.5 km
 *  They bound the N-body predictor, not the ephemeris tables, and they are a
 *  regression gate rather than an accuracy claim: the physics error budget that
 *  would justify tighter numbers needs the 16 ASSIST asteroid perturbers and a
 *  per-planet step size (OPEN-001). */
const LIMITS_KM: Array<{ days: number; label: string; limitKm: number }> = [
  { days: 365.25, label: '+1 yr', limitKm: 2_000 },
  { days: 3_652.5, label: '+10 yr', limitKm: 200_000 },
  { days: 18_262.5, label: '+50 yr', limitKm: 5_000_000 },
  { days: -3_652.5, label: '-10 yr', limitKm: 200_000 },
];

describe.skipIf(!hasKernel)(`N-body prediction against ${kernelName}`, () => {
  let spk: SpkFile;
  let ids: string[];
  let base: ReturnType<typeof cloneState>;
  let epochJd: number;

  beforeAll(() => {
    const bytes = readFileSync(cachePath);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    spk = SpkFile.fromBuffer(buffer);

    const full = loadSystem(ALL_BODIES);
    epochJd = full.epochJd;
    // Barycentric planets and the Sun only: the engine integrates moons inside
    // their own local systems, so a flat global step would under-resolve them.
    const kept = full.ids.map((id, index) => ({ id, index })).filter(({ id }) => TARGETS[id] !== undefined);
    ids = kept.map(({ id }) => id);
    base = {
      t: 0,
      n: ids.length,
      gm: new Float64Array(ids.length),
      pos: new Float64Array(ids.length * 3),
      vel: new Float64Array(ids.length * 3),
    };
    kept.forEach(({ index }, i) => {
      base.gm[i] = full.state.gm[index]!;
      for (let k = 0; k < 3; k++) {
        base.pos[3 * i + k] = full.state.pos[3 * index + k]!;
        base.vel[3 * i + k] = full.state.vel[3 * index + k]!;
      }
    });
  });

  for (const horizon of LIMITS_KM) {
    it(`${horizon.label} keeps every planet inside the measured error budget`, () => {
      const state = cloneState(base);
      const forces = buildForces(ids, DEFAULT_CONFIG);
      const integrator = yoshida6(new Leapfrog());
      const steps = Math.ceil(Math.abs(horizon.days - state.t) / DEFAULT_CONFIG.dt);
      const h = (horizon.days - state.t) / steps;
      for (let step = 0; step < steps; step++) integrator.step(state, forces, h);

      const rows: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const kernel = spk.evaluateEcliptic(TARGETS[id]!, 0, (epochJd + horizon.days - JD_J2000) * DAY_S);
        const errorKm = Math.hypot(
          (state.pos[3 * i]! - kernel.pos[0]! / AU_KM) * AU_KM,
          (state.pos[3 * i + 1]! - kernel.pos[1]! / AU_KM) * AU_KM,
          (state.pos[3 * i + 2]! - kernel.pos[2]! / AU_KM) * AU_KM,
        );
        rows.push(`${id} ${errorKm.toFixed(1)} km`);
        expect(errorKm, `${id} at ${horizon.label}`).toBeLessThan(horizon.limitKm);
      }
      console.log(`${horizon.label} (${steps} steps of ${h.toFixed(4)} d): ${rows.join(', ')}`);
    });
  }
});
