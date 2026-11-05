import { describe, it, expect } from 'vitest';
import { loadSystem } from '@/sim/registry';
import { cloneState } from '@/physics/system';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { newtonianGravity } from '@/physics/forces/gravity';
import { buildFrames } from '@/frames/registry';
import { transformState } from '@/frames/transform';
import { GALACTIC_AXES_IN_SIM, sunVelocitySim } from '@/frames/galactic';
import { OBLIQUITY_J2000_RAD } from '@/data/galaxy';
import { auDayToKms } from '@/data/constants';
import type { SystemState } from '@/physics/types';
import { PHASE1_BODIES } from './fixtures/phase1';

const model = loadSystem(PHASE1_BODIES);
const S = model.ids.indexOf('sun'),
  J = model.ids.indexOf('jupiter');
const frames = buildFrames(model.ids, model.names);
const F = (id: string) => frames.find((f) => f.id === id)!;
const A = 5.202887,
  E = 0.04838624;

function evolve(days: number): SystemState {
  const s = cloneState(model.state),
    lf = new Leapfrog();
  for (let i = 0; i < days; i++) lf.step(s, [newtonianGravity], 1);
  return s;
}
function inFrame(id: string, s: SystemState) {
  const P = new Float64Array(3 * s.n),
    V = new Float64Array(3 * s.n);
  transformState(F(id), s, P, V);
  return { P, V };
}
const sep = (a: Float64Array, i: number, j: number) =>
  Math.hypot(a[3 * i]! - a[3 * j]!, a[3 * i + 1]! - a[3 * j + 1]!, a[3 * i + 2]! - a[3 * j + 2]!);
const kms = (V: Float64Array, i: number) =>
  auDayToKms(Math.hypot(V[3 * i]!, V[3 * i + 1]!, V[3 * i + 2]!));

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('galactic geometry', () => {
  const [ex, ey, ez] = GALACTIC_AXES_IN_SIM;
  it('axes are orthonormal and right-handed', () => {
    for (const v of [ex, ey, ez]) expect(dot(v, v)).toBeCloseTo(1, 12);
    expect(dot(ex, ey)).toBeCloseTo(0, 12);
    expect(dot(ex, ez)).toBeCloseTo(0, 12);
    expect(dot(ey, ez)).toBeCloseTo(0, 12);
    const c = [
      ex[1]! * ey[2]! - ex[2]! * ey[1]!,
      ex[2]! * ey[0]! - ex[0]! * ey[2]!,
      ex[0]! * ey[1]! - ex[1]! * ey[0]!,
    ];
    for (let k = 0; k < 3; k++) expect(c[k]!).toBeCloseTo(ez[k as 0 | 1 | 2]!, 12);
  });
  it('ecliptic is tilted ~60.19 deg from the galactic plane', () => {
    const deg = (Math.acos(ez[2]!) * 180) / Math.PI; // angle between ecliptic pole (0,0,1) and galactic pole
    expect(deg).toBeGreaterThan(60.17);
    expect(deg).toBeLessThan(60.21);
  });
  it("Sun moves ~232.6 km/s = ~49 AU/yr", () => {
    const v = sunVelocitySim();
    const speedKms = auDayToKms(Math.hypot(...v));
    expect(speedKms).toBeGreaterThan(232);
    expect(speedKms).toBeLessThan(233.2);
    const auPerYear = Math.hypot(...v) * 365.25;
    expect(auPerYear).toBeGreaterThan(48.9);
    expect(auPerYear).toBeLessThan(49.2);
  });
});

describe('frames', () => {
  it('barycentric: center of mass sits at the origin', () => {
    const { P } = inFrame('barycentric', evolve(2000));
    const m = model.state.gm;
    let x = 0,
      y = 0,
      z = 0,
      tot = 0;
    for (let i = 0; i < m.length; i++) {
      x += m[i]! * P[3 * i]!;
      y += m[i]! * P[3 * i + 1]!;
      z += m[i]! * P[3 * i + 2]!;
      tot += m[i]!;
    }
    expect(Math.hypot(x, y, z) / tot).toBeLessThan(1e-12);
  });

  it('heliocentric: Sun at the origin, Jupiter stays between a(1-e) and a(1+e)', () => {
    let worstMin = Infinity,
      worstMax = 0;
    const s = cloneState(model.state),
      lf = new Leapfrog();
    for (let i = 0; i < 4400; i++) {
      lf.step(s, [newtonianGravity], 1);
      const { P } = inFrame('body:sun', s);
      expect(Math.hypot(P[3 * S]!, P[3 * S + 1]!, P[3 * S + 2]!)).toBe(0);
      const r = Math.hypot(P[3 * J]!, P[3 * J + 1]!, P[3 * J + 2]!);
      worstMin = Math.min(worstMin, r);
      worstMax = Math.max(worstMax, r);
    }
    expect(Math.abs(worstMin - A * (1 - E)) / worstMin).toBeLessThan(1e-4);
    expect(Math.abs(worstMax - A * (1 + E)) / worstMax).toBeLessThan(1e-4);
  });

  it('Galilean invariance: separations and relative speeds are identical in every frame', () => {
    const s = evolve(3000);
    const ref = inFrame('barycentric', s);
    const dRef = sep(ref.P, S, J),
      vRef = sep(ref.V, S, J);
    for (const f of frames) {
      const { P, V } = inFrame(f.id, s);
      expect(Math.abs(sep(P, S, J) - dRef)).toBeLessThan(1e-9);
      expect(Math.abs(sep(V, S, J) - vRef)).toBeLessThan(1e-12);
    }
  });

  it("galactic: the Sun moves at the solar galactic speed (plus a 12 m/s wobble)", () => {
    const { V } = inFrame('galactic', evolve(1500));
    const expected = auDayToKms(Math.hypot(...sunVelocitySim()));
    expect(Math.abs(kms(V, S) - expected)).toBeLessThan(0.02);
  });

  it('galactic-aligned: velocity is (U, V+Theta, W) = (11.1, 232.24, 7.25) km/s', () => {
    const { V } = inFrame('galactic-aligned', evolve(1500));
    const c = [0, 1, 2].map((k) => auDayToKms(V[3 * S + k]!));
    expect(Math.abs(c[0]! - 11.1)).toBeLessThan(0.05);
    expect(Math.abs(c[1]! - 232.24)).toBeLessThan(0.05);
    expect(Math.abs(c[2]! - 7.25)).toBeLessThan(0.05);
  });

  it('galactic: the Sun travels ~49 AU in one year', () => {
    const a = inFrame('galactic', cloneState(model.state));
    const b = inFrame('galactic', evolve(365)); // t = 365 d
    const moved = Math.hypot(
      b.P[3 * S]! - a.P[3 * S]!,
      b.P[3 * S + 1]! - a.P[3 * S + 1]!,
      b.P[3 * S + 2]! - a.P[3 * S + 2]!,
    );
    expect(moved).toBeGreaterThan(48.7);
    expect(moved).toBeLessThan(49.2);
  });

  it('cmb: the Sun moves at ~370 km/s relative to the cosmic microwave background', () => {
    const { V } = inFrame('cmb', evolve(1500));
    expect(Math.abs(kms(V, S) - 369.82)).toBeLessThan(0.05);
  });

  it('cmb-aligned: Sun speed matches Planck dipole ~369.82 km/s', () => {
    const { V } = inFrame('cmb-aligned', evolve(1500));
    expect(Math.abs(kms(V, S) - 369.82)).toBeLessThan(0.05);
  });
});

describe('simulation ecliptic frame', () => {
  it('uses the obliquity JPL Horizons applies to its J2000 ECLIPTIC plane', () => {
    // Horizons documents REF_PLANE='ECLIPTIC' at J2000 as "the IAU76/80 obliquity of
    // 84381.448 arcsec at J2000.0 relative to the ICRF reference frame"
    // (https://ssd-api.jpl.nasa.gov/doc/horizons.html, fetched 2026-11-05), and every
    // vector in src/data/bodies was produced there. The DE440 comparison recorded in
    // docs/VALIDATION_LOG.md measured the previous IAU 2006 value leaving the whole
    // dataset rotated 0.042 arcsec — 526 km at Uranus.
    expect((OBLIQUITY_J2000_RAD * 180 * 3600) / Math.PI).toBeCloseTo(84381.448, 6);
  });
});

describe('named galaxy models (speed honesty)', () => {
  it.each([
    { id: 'iau1985', lsrKms: 220, expectedTotal: 232.61 },
    { id: 'reid2019', lsrKms: 236, expectedTotal: 248.60 },
    { id: 'gravity2021', lsrKms: 240, expectedTotal: 252.59 },
  ])('model $id computes speed within 0.1 km/s of formula', ({ lsrKms, expectedTotal }) => {
    const v = sunVelocitySim(lsrKms);
    const speedKms = auDayToKms(Math.hypot(...v));
    expect(speedKms).toBeCloseTo(expectedTotal, 1);
  });
});
