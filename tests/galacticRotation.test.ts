import { describe, it, expect } from 'vitest';
import { GalacticPotential } from '@/physics/galacticPotential';
import { SOLAR_PECULIAR_KMS } from '@/data/galaxy';
import { GalaxyVisual, spiralArmAngle, SPIRAL_ARMS, SPIRAL_B } from '@/render/galaxyVisual';

const MYR = 1 / 977.79222; // kpc/Myr per km/s

/** Oort constants from the rotation curve shear (Sofue review §2.1, Table 1). */
function oortAB(pot: GalacticPotential, r0: number): { A: number; B: number } {
  const h = 0.05;
  const dV = (pot.circularSpeedKms(r0 + h) - pot.circularSpeedKms(r0 - h)) / (2 * h);
  const over = pot.circularSpeedKms(r0) / r0;
  return { A: 0.5 * (over - dV), B: -0.5 * (over + dV) };
}

describe('rotation curve drives both Sun and stars', () => {
  it('circularSpeedKms(R0) reproduces the fitted LSR speed', () => {
    for (const v of [220, 236, 240]) {
      const pot = new GalacticPotential(v, 8.2);
      expect(pot.circularSpeedKms(8.2)).toBeCloseTo(v, 6);
    }
  });

  it('the integrated Sun co-rotates with the local circular rate (sign + rate)', () => {
    const pot = new GalacticPotential(220, 8.2);
    const rate = (s0: { x: number; y: number; vx: number; vy: number }) => {
      const s = { tMyr: 0, z: 0, vz: 0, ...s0 };
      const phi0 = Math.atan2(s.y, s.x);
      for (let i = 0; i < 400; i++) pot.step(s, 0.05); // 20 Myr
      let dphi = Math.atan2(s.y, s.x) - phi0;
      while (dphi > Math.PI) dphi -= 2 * Math.PI;
      while (dphi < -Math.PI) dphi += 2 * Math.PI;
      return dphi / 20;
    };
    const expected = pot.angularRateRadPerMyr(8.2);
    expect(expected).toBeLessThan(0); // clockwise from +z
    // Exactly circular control matches the formula to 1%.
    expect(rate({ x: -8.2, y: 0, vx: 0, vy: 220 }) / expected).toBeGreaterThan(0.99);
    expect(rate({ x: -8.2, y: 0, vx: 0, vy: 220 }) / expected).toBeLessThan(1.01);
    // The real Sun carries +12.24 km/s peculiar velocity, so it runs ~7% fast
    // with an epicyclic wobble — same direction, same neighborhood.
    const sun = pot.getInitialSunState();
    const sunRate = rate(sun);
    expect(sunRate).toBeLessThan(0);
    expect(sunRate / expected).toBeGreaterThan(0.9);
    expect(sunRate / expected).toBeLessThan(1.15);
  });
});

describe('GalaxyVisual differential rotation', () => {
  const flat220 = () => 220;
  const vis = () =>
    new GalaxyVisual({ numStars: 2000, diskRadiusKpc: 18, numHaloStars: 200, numGlobularClusters: 10 });
  const priv = (v: GalaxyVisual) =>
    v as unknown as {
      starR: Float32Array;
      starTheta0: Float32Array;
      starOm: Float32Array;
      starsU: { uT: { value: number } };
      bulgeR: Float32Array;
      bulgeTheta0: Float32Array;
      bulgeOm: Float32Array;
      bulgeU: { uT: { value: number } };
      haloPositions: Float32Array;
    };

  it('GPU inputs encode exact differential motion (attributes + time uniform)', () => {
    const v = vis();
    v.setRotationCurve(flat220);
    const p = priv(v);
    // Per-star rate matches -Vc(R)/R with the clockwise sign; birth coords intact.
    let inner = 0,
      innerN = 0,
      outer = 0,
      outerN = 0;
    for (let i = 0; i < p.starR.length; i++) {
      const r = p.starR[i]!;
      const want = (-220 * MYR) / r;
      // Relative check: om lives in a float32 attribute (~1e-7 exactness).
      expect(Math.abs(p.starOm[i]! - want) / Math.abs(want)).toBeLessThan(1e-6);
      expect(p.starOm[i]).toBeLessThan(0);
      const moved = Math.abs(p.starOm[i]! * 50);
      if (r < 6) {
        inner += moved;
        innerN++;
      } else if (r > 12) {
        outer += moved;
        outerN++;
      }
    }
    expect(inner / innerN).toBeGreaterThan((outer / outerN) * 2); // shear: inner laps outer
    // Time flows purely through the uniform: zero CPU work, zero uploads.
    v.update({ tMyr: 0, x: -8.2, y: 0, z: 0.0208, vx: 0, vy: 220, vz: 0 });
    expect(p.starsU.uT.value).toBe(0);
    v.update({ tMyr: 50, x: -8.2, y: 0, z: 0.0208, vx: 0, vy: 220, vz: 0 });
    expect(p.starsU.uT.value).toBe(50);
  });
  it('halo stars do not rotate (pressure-supported, ~zero net spin)', () => {
    const v = vis();
    v.setRotationCurve(flat220);
    const before = priv(v).haloPositions.slice();
    v.update({ tMyr: 0, x: -8.2, y: 0, z: 0.0208, vx: 0, vy: 220, vz: 0 });
    v.update({ tMyr: 200, x: -8.2, y: 0, z: 0.0208, vx: 0, vy: 220, vz: 0 });
    expect(priv(v).haloPositions).toEqual(before);
  });
});

describe('literature cross-checks (Sofue review + NASA StarChild)', () => {  it('Oort constants match Sofue Table 1 envelopes', () => {
    // IAU 1982: A = 14.4 ± 1.2, B = -12.0 ± 2.8; independent authors span
    // A ∈ [11, 16], B ∈ [-17, -11.5]. Our curve shear must land inside.
    const { A, B } = oortAB(new GalacticPotential(220, 8.2), 8.2);
    expect(A).toBeGreaterThan(10);
    expect(A).toBeLessThan(18);
    expect(B).toBeGreaterThan(-19);
    expect(B).toBeLessThan(-9);
    expect(A - B).toBeCloseTo(220 / 8.2, 0); // A-B = Vc/R by definition
    // Sofue/VERA model: A = 14.9, B = -14.9 (details), A-B = 29.8 ≈ 238/8.
    const vera = oortAB(new GalacticPotential(238, 8.0), 8.0);
    expect(vera.A - vera.B).toBeCloseTo(238 / 8.0, 0);
    expect(vera.A).toBeGreaterThan(10);
    expect(vera.B).toBeLessThan(-9);
  });

  it('total solar speed matches StarChild 828,000 km/hr (230 km/s)', () => {
    const [u, v, w] = SOLAR_PECULIAR_KMS;
    const total = Math.hypot(u, 220 + v, w); // IAU 1985 LSR + peculiar
    expect(total).toBeGreaterThan(228);
    expect(total).toBeLessThan(236);
  });
});

describe('galactic bar (barred spiral per StarChild + Sofue §2)', () => {  const vis = () =>
    new GalaxyVisual({ numStars: 500, diskRadiusKpc: 18, numHaloStars: 50, numGlobularClusters: 5 });
  const bpriv = (v: GalaxyVisual) =>
    v as unknown as {
      bulgeR: Float32Array;
      bulgeTheta0: Float32Array;
      bulgePositions: Float32Array;
      bulgeOm: Float32Array;
      bulgeU: { uT: { value: number } };
    };

  it('bar is elongated ~1.5:1 at a 27° position angle', () => {
    const p = bpriv(vis());
    const pa = (27 * Math.PI) / 180;
    let maxA = 0,
      maxB = 0;
    for (let i = 0; i < p.bulgeR.length; i++) {
      const x = p.bulgePositions[3 * i]!,
        y = p.bulgePositions[3 * i + 1]!;
      // Un-rotate into the bar frame: major axis should dominate.
      const a = Math.abs(x * Math.cos(pa) + y * Math.sin(pa));
      const b = Math.abs(-x * Math.sin(pa) + y * Math.cos(pa));
      maxA = Math.max(maxA, a);
      maxB = Math.max(maxB, b);
    }
    expect(maxA / maxB).toBeGreaterThan(1.3);
    expect(maxA / maxB).toBeLessThan(1.7);
  });

  it('bar rotates rigidly at the pattern speed, clockwise', () => {
    const v = vis();
    v.setRotationCurve(() => 220);
    const p = bpriv(v);
    // Every bar star shares one angular rate (rigid density pattern).
    for (let i = 0; i < p.bulgeR.length; i++) {
      const want = -(39 / 977.79222);
      expect(Math.abs(p.bulgeOm[i]! - want) / Math.abs(want)).toBeLessThan(1e-6);
    }
    v.update({ tMyr: 0, x: -8.2, y: 0, z: 0.0208, vx: 0, vy: 220, vz: 0 });
    expect(p.bulgeU.uT.value).toBe(0);
    v.update({ tMyr: 50, x: -8.2, y: 0, z: 0.0208, vx: 0, vy: 220, vz: 0 });
    expect(p.bulgeU.uT.value).toBe(50);
  });
});

describe('spiral arm layout (R. Hurt / NASA face-on map)', () => {
  it('Sun sits mid-gap between arms (Orion spur), not on an arm', () => {
    const sunAngle = Math.PI; // sun at (-8.2, 0)
    let nearest = Infinity;
    for (let k = 0; k < SPIRAL_ARMS; k++) {
      let d = Math.abs(spiralArmAngle(8.2, k) - sunAngle) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      nearest = Math.min(nearest, d);
    }
    // Inter-arm gap is PI/2 wide; mid-gap clearance must exceed ~0.6 rad.
    expect(nearest).toBeGreaterThan(0.6);
    expect(nearest).toBeLessThan(Math.PI / 2);
  });

  it('arm centerlines are logarithmic spirals with the documented pitch', () => {
    // d(theta)/d(ln r) = 1/b along any arm.
    for (let k = 0; k < SPIRAL_ARMS; k++) {
      const dTheta = spiralArmAngle(12, k) - spiralArmAngle(6, k);
      expect(dTheta).toBeCloseTo(Math.log(12 / 6) / SPIRAL_B, 12);
    }
  });
});
