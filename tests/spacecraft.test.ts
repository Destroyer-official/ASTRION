import { describe, it, expect } from 'vitest';
import { SpacecraftEngine, G0_MS2 } from '@/physics/spacecraft';
import { createState } from '@/physics/system';
import { AU_KM, GM_SUN_KM3_S2, gmToInternal } from '@/data/constants';
import { Yoshida4 } from '@/physics/integrators/yoshida4';
import { newtonianGravity } from '@/physics/forces/gravity';

describe('Spacecraft Flight Dynamics & Maneuver Engine', () => {
  const muSun = gmToInternal(GM_SUN_KM3_S2);

  it('correctly executes impulsive Delta-V and calculates Tsiolkovsky propellant depletion', () => {
    const dryMassKg = 500;
    const propellantMassKg = 500;
    const ispSeconds = 300;
    const thrustNewtons = 400;

    const craft = new SpacecraftEngine({
      id: 'probe',
      name: 'Interplanetary Probe',
      stateIndex: 1,
      dryMassKg,
      propellantMassKg,
      ispSeconds,
      thrustNewtons,
    });

    // Schedule 1.0 km/s prograde impulse at t = 10 days
    craft.addManeuver({
      type: 'impulsive',
      epochDays: 10,
      deltaVKms: [1.0, 0, 0],
    });

    const s = createState([
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 695700, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'probe', name: 'Probe', gm: 0, radiusKm: 1, position: [1.0, 0, 0], velocity: [0, 0.0172, 0] },
    ]);
    s.t = 10; // Arrive at maneuver epoch

    const initialVx = s.vel[3]!;
    craft.processImpulses(s);

    // Velocity should be updated by 1.0 km/s in AU/day (1 km/s = 86400 / AU_KM AU/day)
    const expectedDeltaVAuDay = 86400 / AU_KM;
    expect(s.vel[3]! - initialVx).toBeCloseTo(expectedDeltaVAuDay, 10);

    // Tsiolkovsky equation: mf = m0 * exp(-dv / (Isp * g0))
    const m0 = 1000;
    const dvMs = 1000;
    const mfExpected = m0 * Math.exp(-dvMs / (ispSeconds * G0_MS2));
    const consumedExpected = m0 - mfExpected;

    expect(craft.propellantMassKg).toBeCloseTo(propellantMassKg - consumedExpected, 5);
    expect(craft.wetMassKg).toBeCloseTo(mfExpected, 5);
  });

  it('executes continuous prograde finite burn and raises orbital energy', () => {
    const dryMassKg = 300;
    const propellantMassKg = 200;
    const ispSeconds = 3000; // Electric ion propulsion
    const thrustNewtons = 0.5; // 500 mN ion thruster

    const craft = new SpacecraftEngine({
      id: 'ion-probe',
      name: 'Ion Engine Probe',
      stateIndex: 1,
      centralBodyIndex: 0,
      dryMassKg,
      propellantMassKg,
      ispSeconds,
      thrustNewtons,
    });

    // Finite burn for 20 days starting at t = 0
    craft.addManeuver({
      type: 'finite',
      startEpochDays: 0,
      durationDays: 20,
      direction: 'prograde',
    });

    // Circular orbit at 1 AU: v = sqrt(mu / r)
    const vCirc = Math.sqrt(muSun / 1.0);
    const s = createState([
      { id: 'sun', name: 'Sun', gm: muSun, radiusKm: 695700, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'craft', name: 'Craft', gm: 0, radiusKm: 1, position: [1.0, 0, 0], velocity: [0, vCirc, 0] },
    ]);

    const initialEnergy = (vCirc * vCirc) / 2 - muSun / 1.0;

    const y4 = new Yoshida4();
    const dt = 0.5;
    for (let step = 0; step < 40; step++) {
      y4.step(s, [newtonianGravity, craft], dt);
      craft.stepMass(s.t, dt);
    }

    const vx = s.vel[3]!, vy = s.vel[4]!, vz = s.vel[5]!;
    const vFinal = Math.hypot(vx, vy, vz);
    const rFinal = Math.hypot(s.pos[3]!, s.pos[4]!, s.pos[5]!);
    const finalEnergy = (vFinal * vFinal) / 2 - muSun / rFinal;

    // Prograde thrust must add energy to the orbit
    expect(finalEnergy).toBeGreaterThan(initialEnergy);

    // Propellant must be depleted consistently with mDot * dt
    const mDot = thrustNewtons / (ispSeconds * G0_MS2);
    const expectedConsumed = mDot * 20 * 86400;
    expect(craft.propellantMassKg).toBeCloseTo(propellantMassKg - expectedConsumed, 3);
  });
});
