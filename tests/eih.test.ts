import { describe, it, expect } from 'vitest';
import { EinsteinInfeldHoffmann } from '@/physics/forces/eih';
import { createState } from '@/physics/system';
import { perihelionState } from '@/physics/orbit';
import { newtonianGravity } from '@/physics/forces/gravity';
import { Yoshida4 } from '@/physics/integrators/yoshida4';
import { GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import type { BodyDef } from '@/physics/types';

describe('Einstein-Infeld-Hoffmann (EIH) N-Body General Relativity', () => {
  const gmSun = gmToInternal(GM_SUN_KM3_S2);
  const aAu = 0.38709893;
  const e = 0.20563069;
  const periodDays = 2 * Math.PI * Math.sqrt(aAu ** 3 / gmSun); // ~87.969 days

  function getPerihelionAngle(pos: Float64Array, vel: Float64Array): number {
    const rx = pos[3]! - pos[0]!, ry = pos[4]! - pos[1]!;
    const vx = vel[3]! - vel[0]!, vy = vel[4]! - vel[1]!;
    const hz = rx * vy - ry * vx;
    const r = Math.hypot(rx, ry);
    const ex = (vy * hz) / gmSun - rx / r;
    const ey = (-vx * hz) / gmSun - ry / r;
    return Math.atan2(ey, ex);
  }

  it('reproduces Mercury anomalous perihelion precession of ~43 arcsec/century', () => {
    const orbit = perihelionState(gmSun, aAu, e, 0);
    const bodies: BodyDef[] = [
      { id: 'sun', name: 'Sun', gm: gmSun, radiusKm: 695700, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'mercury', name: 'Mercury', gm: gmToInternal(22031.86), radiusKm: 2439.7, position: orbit.pos, velocity: orbit.vel },
    ];

    const s = createState(bodies);
    const y4 = new Yoshida4();
    const eih = new EinsteinInfeldHoffmann();
    const phi0 = getPerihelionAngle(s.pos, s.vel);

    // Integrate 40 Mercury orbits (~9.6 years)
    const numOrbits = 40;
    const totalDays = numOrbits * periodDays;
    const dt = 0.05;
    const steps = Math.round(totalDays / dt);
    for (let i = 0; i < steps; i++) {
      y4.step(s, [newtonianGravity, eih], dt);
    }

    const phiEnd = getPerihelionAngle(s.pos, s.vel);
    let deltaRad = phiEnd - phi0;
    while (deltaRad < 0) deltaRad += 2 * Math.PI;

    const radToArcsec = (180 * 3600) / Math.PI;
    const arcsecPerCentury = (deltaRad * radToArcsec * 36525) / totalDays;

    // Matches Einstein's 1915 derivation ~42.98" / century
    expect(arcsecPerCentury).toBeGreaterThan(41.5);
    expect(arcsecPerCentury).toBeLessThan(44.5);
  });

  it('evaluates mutual relativistic perturbations between multiple massive bodies', () => {
    const bodies: BodyDef[] = [
      { id: 'sun', name: 'Sun', gm: gmSun, radiusKm: 695700, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'jupiter', name: 'Jupiter', gm: gmToInternal(126686534.9), radiusKm: 71492, position: [5.2, 0, 0], velocity: [0, 0.007, 0] },
      { id: 'saturn', name: 'Saturn', gm: gmToInternal(37931207.8), radiusKm: 60268, position: [0, 9.5, 0], velocity: [-0.005, 0, 0] },
    ];

    const s = createState(bodies);
    const eih = new EinsteinInfeldHoffmann();
    const acc = new Float64Array(9);
    eih.apply(s, acc);

    // All three massive bodies receive non-zero relativistic accelerations
    for (let i = 0; i < 3; i++) {
      const aMag = Math.hypot(acc[3 * i]!, acc[3 * i + 1]!, acc[3 * i + 2]!);
      expect(aMag).toBeGreaterThan(0);
    }
  });
});
