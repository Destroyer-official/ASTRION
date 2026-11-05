import { C_LIGHT_AU_DAY } from '@/data/constants';
import type { ForceModel } from '../types';
import { add } from '../vec3';

export const C_AU_DAY = C_LIGHT_AU_DAY;

/**
 * a = GM/(c^2 r^3) [ (4GM/r - v^2) r + 4 (r.v) v ],  r, v relative to the Sun.
 * Standard single-source 1PN (beta = gamma = 1). Gives 6 pi GM / (c^2 a (1-e^2)) per orbit.
 * Not the full EIH equations (no planet-planet terms): those change positions ~1e-9 AU/yr.
 */
export function sunGR(sun: number): ForceModel {
  const c2 = C_AU_DAY * C_AU_DAY;
  return {
    name: 'gr-1pn-sun',
    apply(s, acc) {
      const gs = s.gm[sun]!;
      for (let i = 0; i < s.n; i++) {
        if (i === sun) continue;
        const rx = s.pos[3 * i]! - s.pos[3 * sun]!,
          ry = s.pos[3 * i + 1]! - s.pos[3 * sun + 1]!,
          rz = s.pos[3 * i + 2]! - s.pos[3 * sun + 2]!;
        const vx = s.vel[3 * i]! - s.vel[3 * sun]!,
          vy = s.vel[3 * i + 1]! - s.vel[3 * sun + 1]!,
          vz = s.vel[3 * i + 2]! - s.vel[3 * sun + 2]!;
        const r2 = rx * rx + ry * ry + rz * rz,
          r = Math.sqrt(r2);
        const A = (4 * gs) / r - (vx * vx + vy * vy + vz * vz);
        const B = 4 * (rx * vx + ry * vy + rz * vz);
        const k = gs / (c2 * r2 * r);
        const ax = k * (A * rx + B * vx),
          ay = k * (A * ry + B * vy),
          az = k * (A * rz + B * vz);
        add(acc, i, ax, ay, az);
        const f = s.gm[i]! / gs;
        add(acc, sun, -f * ax, -f * ay, -f * az);
      }
    },
  };
}
