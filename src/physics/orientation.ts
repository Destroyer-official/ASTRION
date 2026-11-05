import { OBLIQUITY_J2000_RAD } from '@/data/galaxy';
import { SYSTEM_PHASES } from '@/data/nutation';
import type { RotationJson } from '@/data/schema';
import type { Vec3 } from './types';

const RAD = Math.PI / 180;

/** ICRS (RA, Dec of a pole) -> unit vector in J2000 ecliptic axes (the simulation frame). */
export function poleEcliptic(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * RAD,
    d = decDeg * RAD;
  const x = Math.cos(a) * Math.cos(d),
    y = Math.sin(a) * Math.cos(d),
    z = Math.sin(d);
  const ce = Math.cos(OBLIQUITY_J2000_RAD),
    se = Math.sin(OBLIQUITY_J2000_RAD);
  return [x, ce * y + se * z, -se * y + ce * z];
}

/** Row-major 3×3 rotation matrix, body-fixed axes → J2000 ecliptic axes. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

type M3 = Matrix3;

const mul = (a: M3, b: M3): M3 => {
  const o: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += a[3 * i + k]! * b[3 * k + j]!;
      }
      o[3 * i + j] = sum;
    }
  }
  return o;
};

const Rz = (a: number): M3 => [
  Math.cos(a),
  -Math.sin(a),
  0,
  Math.sin(a),
  Math.cos(a),
  0,
  0,
  0,
  1,
];

const Rx = (a: number): M3 => [
  1,
  0,
  0,
  0,
  Math.cos(a),
  -Math.sin(a),
  0,
  Math.sin(a),
  Math.cos(a),
];

/** Body-fixed -> J2000 ecliptic (simulation axes). Body +z = north pole, +x = prime meridian, +y = 90 deg east. */
export function bodyToEcliptic(r: RotationJson, daysSinceJ2000: number): M3 {
  const T = daysSinceJ2000 / 36525;
  let ra = (r.poleRaDeg + (r.poleRaRateDegPerCy ?? 0) * T) * RAD;
  let dec = (r.poleDecDeg + (r.poleDecRateDegPerCy ?? 0) * T) * RAD;
  let w = (r.w0Deg + r.wRateDegPerDay * daysSinceJ2000 + (r.wAccelDegPerDay2 ?? 0) * daysSinceJ2000 * daysSinceJ2000) * RAD;
  const n = r.nutation;
  if (n) {
    // Periodic IAU nutation-precession series (NAIF PCK): amplitude element k
    // pairs with system phase k; RA/W terms are sines, Dec terms cosines.
    // Missing phase table degrades to the linear model (never crash render).
    const phases = SYSTEM_PHASES[n.systemId];
    if (phases) {
      const series = (
        amps: readonly number[],
        trig: (x: number) => number,
      ): number => {
        let s = 0;
        const len = Math.min(amps.length, phases.length);
        for (let k = 0; k < len; k++) {
          const a = amps[k]!;
          if (a === 0) continue;
          const c = phases[k]!;
          const phase = (c[0] + (c[1] + c[2] * T) * T) * RAD;
          s += a * trig(phase);
        }
        return s;
      };
      ra += series(n.raAmpDeg, Math.sin) * RAD;
      dec += series(n.decAmpDeg, Math.cos) * RAD;
      w += series(n.wAmpDeg, Math.sin) * RAD;
    }
  }
  const icrf = mul(mul(Rz(ra + Math.PI / 2), Rx(Math.PI / 2 - dec)), Rz(w));
  return mul(Rx(-OBLIQUITY_J2000_RAD), icrf);
}

export const poleOf = (m: M3): Vec3 => [m[2], m[5], m[8]];
