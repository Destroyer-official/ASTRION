import { describe, it, beforeAll } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { cloneState } from '@/physics/system';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { newtonianGravity } from '@/physics/forces/gravity';
import { gmToInternal, AU_KM } from '@/data/constants';
import type { SystemState } from '@/physics/types';

/**
 * Live-JPL audit: requires outbound network access to ssd.jpl.nasa.gov.
 * Sandboxed/offline environments report a clean skip instead of a false
 * failure — pre-flight reachability probe with a bounded abort timeout.
 */
let jplReachable = false;

beforeAll(async () => {
  try {
    const res = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%27CERES%27', {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    jplReachable = res.ok;
  } catch {
    jplReachable = false;
  }
  if (!jplReachable) {
    // eslint-disable-next-line no-console -- intentional, official skip notice
    console.info(
      'Skipping live JPL asteroid audit: ssd.jpl.nasa.gov unreachable from this environment (offline/sandbox).',
    );
  }
}, 15_000);

async function ceresState(epochJd: number): Promise<{ pos: number[]; vel: number[] }> {
  const params = new URLSearchParams({
    format: 'json', COMMAND: "'2000001'", OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS', CENTER: "'500@0'", REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF', OUT_UNITS: 'AU-D', VEC_TABLE: '2', CSV_FORMAT: 'YES',
    TLIST: `'${epochJd.toFixed(9)}'`, TLIST_TYPE: 'JD',
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  const { result } = (await res.json()) as { result: string };
  const block = result.match(/\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/)!;
  const f = block[1]!.split('\n')[0]!.split(',').map((x) => x.trim());
  const v = f.slice(2, 8).map(Number);
  return { pos: v.slice(0, 3), vel: v.slice(3, 6) };
}

describe('asteroid effect size (temporary experiment)', () => {
  it('measures Ceres pull on the planets over 10 years', async (ctx) => {
    if (!jplReachable) ctx.skip();
    const model = loadSystem();
    const epoch = model.epochJd;
    const ceres = await ceresState(epoch);
    console.log('Ceres epoch state fetched:', ceres.pos.map((x) => x.toFixed(4)).join(','));

    const mk = (withCeres: boolean): SystemState => {
      const s = cloneState(model.state);
      if (!withCeres) return s;
      const n = s.n + 1;
      const gm = new Float64Array(n);
      const pos = new Float64Array(3 * n);
      const vel = new Float64Array(3 * n);
      gm.set(s.gm);
      pos.set(s.pos);
      vel.set(s.vel);
      gm[n - 1] = gmToInternal(62.62888864440993);
      pos.set(ceres.pos, 3 * (n - 1));
      vel.set(ceres.vel, 3 * (n - 1));
      return { t: s.t, n, gm, pos, vel };
    };

    const a = mk(false);
    const b = mk(true);
    const lf = new Leapfrog();
    const forces = [newtonianGravity];
    const names = [...model.ids, 'ceres'];
    const worst = new Map<string, number>();
    const steps = Math.round(3652.5 / 0.5);
    for (let i = 0; i < steps; i++) {
      lf.step(a, forces, 0.5);
      lf.step(b, forces, 0.5);
      if (i % 200 === 0) {
        model.ids.forEach((id, k) => {
          const d = Math.hypot(
            a.pos[3 * k]! - b.pos[3 * k]!,
            a.pos[3 * k + 1]! - b.pos[3 * k + 1]!,
            a.pos[3 * k + 2]! - b.pos[3 * k + 2]!,
          );
          worst.set(id, Math.max(worst.get(id) ?? 0, d));
        });
      }
    }
    console.log('body        max Ceres displacement over 10 yr (km)');
    for (const [id, dAu] of worst) {
      console.log(`${id.padEnd(12)}${Math.round(dAu * AU_KM)}`);
    }
    void names;
  }, 300_000);
});
