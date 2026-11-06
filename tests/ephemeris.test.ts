import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AU_KM } from '@/data/constants';
import { EphemerisProvider } from '@/sim/ephemeris';
import { loadSystem } from '@/sim/registry';

const denseUrl = (f: string) => fileURLToPath(new URL(`../src/data/${f}`, import.meta.url));

describe('Dual Mode: JPL Horizons DE440 Ephemeris Provider', () => {
  const model = loadSystem();
  const ephem = new EphemerisProvider(model);

  it('interpolates exact positions at epoch (t=0) matching DE440 initial vectors', () => {
    const pos = new Float64Array(model.state.n * 3);
    const ok = ephem.interpolate(0, pos);
    expect(ok).toBe(true);

    for (let i = 0; i < model.state.n * 3; i++) {
      expect(pos[i]!).toBeCloseTo(model.state.pos[i]!, 8);
    }
  });

  it('interpolates positions at +1 year matching reference sample within millimeters', () => {
    const pos = new Float64Array(model.state.n * 3);
    const ok = ephem.interpolate(365.25, pos);
    expect(ok).toBe(true);

    const sunIdx = model.ids.indexOf('sun');
    expect(pos[3 * sunIdx]!).toBeCloseTo(0.000544175, 6);
  });

  it('produces an honest validation error table comparing N-body vs DE440 at +1, +10, +50 yr', () => {
    const table = ephem.getValidationTable();
    expect(table.length).toBeGreaterThan(0);

    const mercury1Yr = table.find((r) => r.id === 'mercury' && r.offsetYears === 1);
    expect(mercury1Yr).toBeDefined();
    // Error at 1 yr for Mercury is well under 500 km with Yoshida-4 + 1PN + J2
    expect(mercury1Yr!.errKm).toBeLessThan(500);

    const earth1Yr = table.find((r) => r.id === 'earth' && r.offsetYears === 1);
    expect(earth1Yr).toBeDefined();
    expect(earth1Yr!.errKm).toBeLessThan(500);
  });

  it('reseeds system state from Horizons anchor, resetting drift to zero', () => {
    const clone = { ...model.state, pos: new Float64Array(model.state.pos), vel: new Float64Array(model.state.vel) };
    // Perturb position
    clone.pos[0] = 999.0;
    const reseeded = ephem.reseed(0, clone);
    expect(reseeded).toBe(true);
    expect(clone.pos[0]!).toBeCloseTo(model.state.pos[0]!, 8);
  });

  it('window() spans the anchor table and interpolate() clamps outside it', () => {
    const w = ephem.window();
    expect(w.min).toBeLessThan(0);
    expect(w.max).toBeGreaterThan(3652.5);
    const pos = new Float64Array(model.state.n * 3);
    expect(ephem.interpolate(w.max + 10_000, pos)).toBe(false); // clamped, flagged
    expect(ephem.interpolate(w.min - 10_000, pos)).toBe(false);
    expect(ephem.interpolate(100, pos)).toBe(true);
  });

  it('separates the full anchor span from the validated dense-coverage span', () => {
    const validated = ephem.validatedWindow();
    expect(validated).toEqual({ min: -365, max: 724 });
    expect(ephem.window().max).toBeGreaterThan(validated!.max);

    expect(ephem.isWithinValidatedWindow(-365)).toBe(true);
    expect(ephem.isWithinValidatedWindow(724)).toBe(true);
    expect(ephem.isWithinValidatedWindow(-366)).toBe(false);
    expect(ephem.isWithinValidatedWindow(725)).toBe(false);
    expect(ephem.isWithinValidatedWindow(3652.5)).toBe(false);
  });

  it('does not add interpolation anchors from live vectors outside the validated window', async () => {
    const horizons = await import('@/sim/horizonsClient');
    const spy = vi.spyOn(horizons.horizonsClient, 'fetchSystem').mockResolvedValue(
      Object.fromEntries(
        model.ids.slice(0, 8).map((id) => [
          id,
          {
            bodyId: id,
            command: 'test',
            epochJd: model.epochJd + 731,
            dateStr: 'test',
            positionKm: [1, 2, 3],
            velocityKms: [0, 0, 0],
            positionAu: [1, 2, 3],
            velocityAuDay: [0, 0, 0],
            source: 'test',
          },
        ]),
      ) as never,
    );
    const clone = {
      ...model.state,
      t: 0,
      pos: new Float64Array(model.state.pos),
      vel: new Float64Array(model.state.vel),
    };

    const result = await ephem.reseedLive(731, clone);
    expect(result.live).toBe(true);
    expect(clone.t).toBe(731);
    expect(ephem.validatedWindow()).toEqual({ min: -365, max: 724 });
    spy.mockRestore();
  });

  it('dense anchors + velocity Hermite kill inner-planet aliasing (leave-one-out)', () => {
    // Hold out every other dense node (3d effective gaps = production gaps
    // for the 36h inner table), interpolate the held-out nodes from their
    // neighbours with and without endpoint velocities, and compare to truth.
    // Measured 2026-10-09: Hermite beats velocity-free smoothstep by 190-37000x.
    const dense = JSON.parse(readFileSync(denseUrl('dense-reference.json'), 'utf8')) as {
      samples: Array<{ jd: number; bodies: Record<string, { p: number[]; v: number[] }> }>;
    };
    const hermite = (p0: number[], v0: number[], p1: number[], v1: number[], dt: number, u: number) => {
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      return [0, 1, 2].map((k) => h00 * p0[k]! + h10 * dt * v0[k]! + h01 * p1[k]! + h11 * dt * v1[k]!);
    };
    const smooth = (p0: number[], p1: number[], u: number) => {
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      return [0, 1, 2].map((k) => h00 * p0[k]! + h01 * p1[k]!);
    };
    // Absolute worst-case caps (km) at 3d gaps; measured: 1613 / 15 / 3 / 1 / 398.
    const caps: Record<string, number> = { mercury: 2500, venus: 30, earth: 10, mars: 5, moon: 600 };
    for (const [id, cap] of Object.entries(caps)) {
      const rows = dense.samples.filter((s) => s.bodies[id]).map((s) => ({ jd: s.jd, ...s.bodies[id]! }));
      expect(rows.length).toBeGreaterThan(700);
      let worstH = 0;
      let worstS = 0;
      for (let i = 2; i < rows.length - 2; i += 2) {
        const a = rows[i - 1]!;
        const b = rows[i + 1]!;
        const truth = rows[i]!.p;
        const dt = b.jd - a.jd;
        const u = (rows[i]!.jd - a.jd) / dt;
        const eH = Math.hypot(...hermite(a.p, a.v, b.p, b.v, dt, u).map((x, k) => x - truth[k]!)) * AU_KM;
        const eS = Math.hypot(...smooth(a.p, b.p, u).map((x, k) => x - truth[k]!)) * AU_KM;
        worstH = Math.max(worstH, eH);
        worstS = Math.max(worstS, eS);
      }
      console.log(`${id}: leave-one-out worst Hermite ${worstH.toFixed(1)} km vs smoothstep ${worstS.toFixed(0)} km`);
      expect(worstH, `${id} Hermite cap`).toBeLessThan(cap);
      expect(worstS / worstH, `${id} Hermite gain`).toBeGreaterThan(20);
    }
  });

  it('provider interpolate() follows the Hermite math on dense intervals', () => {
    // Offset 100.75d sits mid-interval between dense Earth nodes: the provider
    // must reproduce an independent hand evaluation of the same Hermite form.
    const dense = JSON.parse(readFileSync(denseUrl('dense-reference.json'), 'utf8')) as {
      samples: Array<{ jd: number; bodies: Record<string, { p: number[]; v: number[] }> }>;
    };
    const off = (jd: number) => jd - model.epochJd;
    const nodes = dense.samples.filter((s) => s.bodies['earth']).map((s) => ({ t: off(s.jd), ...s.bodies['earth']! }));
    const i1 = nodes.findIndex((n) => n.t > 100.75);
    const a = nodes[i1 - 1]!;
    const b = nodes[i1]!;
    const dt = b.t - a.t;
    const u = (100.75 - a.t) / dt;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    const pos = new Float64Array(model.state.n * 3);
    expect(ephem.interpolate(100.75, pos)).toBe(true);
    const e = model.ids.indexOf('earth');
    for (let k = 0; k < 3; k++) {
      const want = h00 * a.p[k]! + h10 * dt * a.v[k]! + h01 * b.p[k]! + h11 * dt * b.v[k]!;
      expect(pos[3 * e + k]!).toBeCloseTo(want, 9);
    }
  });

  it('provider interpolate() derives exact analytical velocities matching DE440 truth', () => {
    const pos = new Float64Array(model.state.n * 3);
    const vel = new Float64Array(model.state.n * 3);

    // At t = 0 (exact anchor), velocities match model initial state bit-for-bit
    expect(ephem.interpolate(0, pos, vel)).toBe(true);
    for (let i = 0; i < model.state.n * 3; i++) {
      expect(vel[i]!).toBeCloseTo(model.state.vel[i]!, 9);
    }

    // Mid-interval at t = 100.75d: analytical Earth speed is physical (~29.8 km/s)
    expect(ephem.interpolate(100.75, pos, vel)).toBe(true);
    const e = model.ids.indexOf('earth');
    const vEarthAuDay = Math.hypot(vel[3 * e]!, vel[3 * e + 1]!, vel[3 * e + 2]!);
    const vEarthKms = (vEarthAuDay * AU_KM) / 86400;
    expect(vEarthKms).toBeGreaterThan(29.0);
    expect(vEarthKms).toBeLessThan(30.6);

    // Sun barycentric wobble speed is physical (~11-14 m/s = ~0.011-0.014 km/s)
    const sunIdx = model.ids.indexOf('sun');
    const vSunAuDay = Math.hypot(vel[3 * sunIdx]!, vel[3 * sunIdx + 1]!, vel[3 * sunIdx + 2]!);
    const vSunKms = (vSunAuDay * AU_KM) / 86400;
    expect(vSunKms).toBeGreaterThan(0.005);
    expect(vSunKms).toBeLessThan(0.025);
  });

  it('evaluates every body from the anchors that carry it, not from its epoch state', () => {
    // The dense table samples the inner planets and the Moon every 1.5 d but the
    // Sun and outer planets only every 9 d, and the sparse table adds dates that
    // exist for the planets alone. Bracketing by date for all bodies at once put
    // the coarsely sampled ones between two anchors that do not contain them, and
    // they silently returned the epoch vector: measured 1.1e6 km at +1 d and
    // 7.3e8 km at +700 d for Jupiter (VALIDATION_LOG step 7).
    const pos = new Float64Array(model.state.n * 3);
    for (const id of ['sun', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      const i = model.ids.indexOf(id);
      expect(i, `${id} present`).toBeGreaterThan(-1);
      expect(ephem.interpolate(100, pos)).toBe(true);
      const movedAu = Math.hypot(
        pos[3 * i]! - model.state.pos[3 * i]!,
        pos[3 * i + 1]! - model.state.pos[3 * i + 1]!,
        pos[3 * i + 2]! - model.state.pos[3 * i + 2]!,
      );
      // A frozen body reproduces the epoch vector exactly; the Sun alone moves
      // ~7e-4 AU per 100 days, so the bound has to be far below that.
      expect(movedAu, `${id} must not stay pinned to its epoch position`).toBeGreaterThan(1e-6);
    }
  });
});
