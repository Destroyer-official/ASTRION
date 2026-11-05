import { describe, it, expect } from 'vitest';
import { ALL_BODIES, buildModel, buildSolver, PHYSICAL_MAP } from '@/sim/registry';
import { Engine } from '@/sim/engine';
import { DEFAULT_CONFIG } from '@/sim/config';
import { cloneState } from '@/physics/system';
import { compose } from '@/physics/hierarchy';
import { dateToJd, jdToDate } from '@/physics/time';
import { hermite } from '@/sim/hermite';
import { findMinSeparation } from '@/sim/eclipses';
import type { SystemState } from '@/physics/types';

describe('Eclipses Prediction & Hermite Interpolation (Phase 6.5)', () => {
  it('predicts the 2026-08-12 total solar eclipse timing and minimum separation', () => {
    // Bodies needed: Sun, Earth, Moon
    const sub = ALL_BODIES.filter((b) => ['sun', 'earth', 'moon'].includes(b.id));
    const model = buildModel(sub, PHYSICAL_MAP);
    const cfg = {
      ...DEFAULT_CONFIG,
      dt: 0.25, // fine step for precise backward integration
      gr: true,
      sunJ2: true,
      planetJ2: true,
    };
    const solver = buildSolver(model, cfg, PHYSICAL_MAP);
    const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.25, 100_000);

    const cataloguedDate = new Date('2026-08-12T17:46:00Z');
    const cataloguedJd = dateToJd(cataloguedDate);
    const targetTDays = cataloguedJd - model.epochJd; // negative (in the past)

    console.log(`Epoch JD: ${model.epochJd}, Eclipse JD: ${cataloguedJd}, Target T: ${targetTDays.toFixed(4)} days`);

    // Step backward to slightly past targetTDays
    const dt = -0.25;
    const targetSteps = Math.ceil(Math.abs(targetTDays) / Math.abs(dt)) + 5;

    // Buffer states around the eclipse
    interface StateRecord {
      t: number;
      pos: Float64Array;
      vel: Float64Array;
    }
    const history: StateRecord[] = [];

    const composedCur = cloneState(model.global);
    compose(solver.level0, solver.slots, composedCur);
    history.push({
      t: composedCur.t,
      pos: composedCur.pos.slice(),
      vel: composedCur.vel.slice(),
    });

    for (let step = 0; step < targetSteps; step++) {
      eng.advanceFixed(dt, dt);
      const s = cloneState(model.global);
      compose(solver.level0, solver.slots, s);
      history.push({
        t: s.t,
        pos: s.pos.slice(),
        vel: s.vel.slice(),
      });
      if (s.t < targetTDays - 2) break; // Reached past target window
    }

    // Sort history by ascending time
    history.sort((a, b) => a.t - b.t);

    const stateBuffer = cloneState(model.global);

    // Continuous Hermite state interpolator
    const getStateAtTime = (t: number): SystemState => {
      // Find bounding interval
      let idx = history.findIndex((h) => h.t >= t);
      if (idx <= 0) idx = 1;
      if (idx >= history.length) idx = history.length - 1;

      const h0 = history[idx - 1]!;
      const h1 = history[idx]!;

      hermite(h0.t, h0.pos, h0.vel, h1.t, h1.pos, h1.vel, t, stateBuffer.pos);
      stateBuffer.t = t;
      return stateBuffer;
    };

    const sunIdx = model.ids.indexOf('sun');
    const earthIdx = model.ids.indexOf('earth');
    const moonIdx = model.ids.indexOf('moon');

    const result = findMinSeparation(
      getStateAtTime,
      targetTDays,
      12, // 12-hour window
      1, // 1-minute initial grid
      sunIdx,
      earthIdx,
      moonIdx,
    );

    const predictedDate = jdToDate(model.epochJd + result.tMin);
    const timeDiffMinutes = (result.tMin - targetTDays) * 1440;

    console.log(
      `Catalogued greatest eclipse: ${cataloguedDate.toISOString()}\n` +
        `Simulated minimum separation: ${predictedDate.toISOString()}\n` +
        `Timing error: ${timeDiffMinutes.toFixed(2)} minutes\n` +
        `Geocentric minimum separation: ${result.minSepDeg.toFixed(3)}° (expected ~0.85° ± 0.15°)`,
    );

    // Verify separation is near 0.85° ± 0.15° (0.70° to 1.00°)
    expect(result.minSepDeg).toBeGreaterThan(0.70);
    expect(result.minSepDeg).toBeLessThan(1.00);

    // Verify timing is within about 20 minutes
    expect(Math.abs(timeDiffMinutes)).toBeLessThan(20);
  });
});
