import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { bodyToEcliptic, type Matrix3 } from '@/physics/orientation';
import { PHYSICAL_MAP } from '@/sim/registry';

const ROTATED_IDS = Object.keys(PHYSICAL_MAP).filter((id) => PHYSICAL_MAP[id]?.rotation);
const FIFTY_YEARS_DAYS = 50 * 365.25;

type Row3 = readonly [number, number, number];

const rowsOf = (m: Matrix3): readonly [Row3, Row3, Row3] => [
  [m[0]!, m[1]!, m[2]!],
  [m[3]!, m[4]!, m[5]!],
  [m[6]!, m[7]!, m[8]!],
];

const dot = (a: Row3, b: Row3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Row3, b: Row3): Row3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** v_body = M^T v_ecliptic for a row-major body-to-ecliptic matrix. */
const toBody = (m: Matrix3, v: Row3): Row3 => [
  dot([m[0]!, m[3]!, m[6]!], v),
  dot([m[1]!, m[4]!, m[7]!], v),
  dot([m[2]!, m[5]!, m[8]!], v),
];

/** v_ecliptic = M v_body. */
const toEcliptic = (m: Matrix3, v: Row3): Row3 => [
  dot([m[0]!, m[1]!, m[2]!], v),
  dot([m[3]!, m[4]!, m[5]!], v),
  dot([m[6]!, m[7]!, m[8]!], v),
];

describe('WGCCRE rotational-frame properties', () => {
  it('keeps every catalogued rotation matrix right-handed, orthonormal and invertible', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROTATED_IDS),
        fc.double({ min: -FIFTY_YEARS_DAYS, max: FIFTY_YEARS_DAYS, noNaN: true, noDefaultInfinity: true }),
        (id, daysSinceJ2000) => {
          const m = bodyToEcliptic(PHYSICAL_MAP[id]!.rotation!, daysSinceJ2000);
          const [r0, r1, r2] = rowsOf(m);

          expect(Math.hypot(...r0)).toBeCloseTo(1, 12);
          expect(Math.hypot(...r1)).toBeCloseTo(1, 12);
          expect(Math.hypot(...r2)).toBeCloseTo(1, 12);
          expect(dot(r0, r1)).toBeCloseTo(0, 12);
          expect(dot(r0, r2)).toBeCloseTo(0, 12);
          expect(dot(r1, r2)).toBeCloseTo(0, 12);
          r0.forEach((_, k) => expect(r2[k]).toBeCloseTo(cross(r0, r1)[k]!, 12));
        },
      ),
      { numRuns: 1_000, seed: 20261105 },
    );
  });

  it('returns a body-fixed vector to ecliptic axes without changing its length', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROTATED_IDS),
        fc.double({ min: -FIFTY_YEARS_DAYS, max: FIFTY_YEARS_DAYS, noNaN: true, noDefaultInfinity: true }),
        fc.tuple(
          fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
        ),
        (id, daysSinceJ2000, input) => {
          const m = bodyToEcliptic(PHYSICAL_MAP[id]!.rotation!, daysSinceJ2000);
          const roundTrip = toEcliptic(m, toBody(m, input));
          input.forEach((component, k) => expect(roundTrip[k]).toBeCloseTo(component, 12));
        },
      ),
      { numRuns: 1_000, seed: 20261105 },
    );
  });
});
