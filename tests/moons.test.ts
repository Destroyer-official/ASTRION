import { describe, it, expect } from 'vitest';
import { ALL_BODIES, buildModel, buildSolver, PHYSICAL_MAP } from '@/sim/registry';
import { Engine } from '@/sim/engine';
import { DEFAULT_CONFIG } from '@/sim/config';
import { stateToElements } from '@/physics/kepler';
import { buildFrames } from '@/frames/registry';
import { AU_KM } from '@/data/constants';
import type { Vec3 } from '@/physics/types';

const KNOWN_PERIODS: Record<string, { parent: string; periodDays: number }> = {
  moon: { parent: 'earth', periodDays: 27.3217 },
  deimos: { parent: 'mars', periodDays: 1.2624 },
  io: { parent: 'jupiter', periodDays: 1.7691 },
  europa: { parent: 'jupiter', periodDays: 3.5512 },
  ganymede: { parent: 'jupiter', periodDays: 7.1546 },
  callisto: { parent: 'jupiter', periodDays: 16.689 },
  mimas: { parent: 'saturn', periodDays: 0.9424 },
  dione: { parent: 'saturn', periodDays: 2.7369 },
  rhea: { parent: 'saturn', periodDays: 4.5175 },
  titan: { parent: 'saturn', periodDays: 15.9454 },
  iapetus: { parent: 'saturn', periodDays: 79.3215 },
  miranda: { parent: 'uranus', periodDays: 1.4135 },
  ariel: { parent: 'uranus', periodDays: 2.5204 },
  titania: { parent: 'uranus', periodDays: 8.7059 },
  oberon: { parent: 'uranus', periodDays: 13.4632 },
  triton: { parent: 'neptune', periodDays: 5.8769 },
};

describe('Moons Dynamics (Phase 5)', () => {
  it('Earth-Moon barycenter offset is between 4,300 and 4,950 km', () => {
    const sub = ALL_BODIES.filter((b) => ['earth', 'moon'].includes(b.id));
    const model = buildModel(sub, PHYSICAL_MAP);
    const earthSys = model.localSystems.find((s) => s.hostId === 'earth')!;

    // In local system, Earth is at index 0, offset from barycenter by -c
    const pos = earthSys.initialState.pos;
    const offsetAu = Math.hypot(pos[0]!, pos[1]!, pos[2]!);
    const offsetKm = offsetAu * AU_KM;

    console.log(`Earth distance from Earth-Moon barycenter: ${offsetKm.toFixed(1)} km`);
    expect(offsetKm).toBeGreaterThan(4300);
    expect(offsetKm).toBeLessThan(4950);
  });

  it('lunar distance range over 5 years matches known perigee and apogee', () => {
    const sub = ALL_BODIES.filter((b) => ['sun', 'earth', 'moon'].includes(b.id));
    const model = buildModel(sub, PHYSICAL_MAP);
    const cfg = {
      ...DEFAULT_CONFIG,
      dt: 0.5,
      gr: false,
      sunJ2: false,
      planetJ2: false,
    };
    const solver = buildSolver(model, cfg, PHYSICAL_MAP);
    const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.5, 100_000);

    const eLocal = 0;
    const mLocal = 1;
    const earthSys = solver.systems.find((s) => s.hostId === 'earth')!;

    let minKm = Infinity;
    let maxKm = 0;

    const totalDays = 5 * 365.25;
    const dt = 0.5;
    const steps = Math.round(totalDays / dt);

    for (let i = 0; i < steps; i++) {
      eng.advanceFixed(dt, dt);
      const ls = earthSys.state;
      const dx = ls.pos[3 * mLocal]! - ls.pos[3 * eLocal]!;
      const dy = ls.pos[3 * mLocal + 1]! - ls.pos[3 * eLocal + 1]!;
      const dz = ls.pos[3 * mLocal + 2]! - ls.pos[3 * eLocal + 2]!;
      const dKm = Math.hypot(dx, dy, dz) * AU_KM;
      if (dKm < minKm) minKm = dKm;
      if (dKm > maxKm) maxKm = dKm;
    }

    console.log(`Lunar distance range: min=${minKm.toFixed(0)} km, max=${maxKm.toFixed(0)} km`);
    expect(minKm).toBeGreaterThan(350_000);
    expect(minKm).toBeLessThan(365_000);
    expect(maxKm).toBeGreaterThan(404_000);
    expect(maxKm).toBeLessThan(410_000);
  });

  it('Phobos period from osculating elements matches known 0.3189 days', () => {    const sub = ALL_BODIES.filter((b) => ['mars', 'phobos'].includes(b.id));
    const model = buildModel(sub, PHYSICAL_MAP);
    const marsSys = model.localSystems.find((s) => s.hostId === 'mars')!;
    const ls = marsSys.initialState;
    const r: Vec3 = [ls.pos[3]! - ls.pos[0]!, ls.pos[4]! - ls.pos[1]!, ls.pos[5]! - ls.pos[2]!];
    const v: Vec3 = [ls.vel[3]! - ls.vel[0]!, ls.vel[4]! - ls.vel[1]!, ls.vel[5]! - ls.vel[2]!];
    const mu = ls.gm[0]! + ls.gm[1]!;
    const el = stateToElements(mu, r, v);

    console.log(`Phobos osculating period: ${el.period.toFixed(4)} days`);
    expect(Math.abs(el.period - 0.3189) / 0.3189).toBeLessThan(0.003); // Within 0.3%
  });

  it('osculating semi-major axes match JPL mean elements within 1%', () => {
    // JPL Solar System Dynamics satellite mean semi-major axes (km).
    const KNOWN_A_KM: Record<string, { parent: string; aKm: number }> = {
      moon: { parent: 'earth', aKm: 384400 },
      phobos: { parent: 'mars', aKm: 9376 },
      deimos: { parent: 'mars', aKm: 23463 },
      io: { parent: 'jupiter', aKm: 421700 },
      europa: { parent: 'jupiter', aKm: 671034 },
      ganymede: { parent: 'jupiter', aKm: 1070412 },
      callisto: { parent: 'jupiter', aKm: 1882709 },
      mimas: { parent: 'saturn', aKm: 185539 },
      enceladus: { parent: 'saturn', aKm: 237948 },
      tethys: { parent: 'saturn', aKm: 294619 },
      dione: { parent: 'saturn', aKm: 377396 },
      rhea: { parent: 'saturn', aKm: 527108 },
      titan: { parent: 'saturn', aKm: 1221870 },
      iapetus: { parent: 'saturn', aKm: 3560820 },
      miranda: { parent: 'uranus', aKm: 129900 },
      ariel: { parent: 'uranus', aKm: 191020 },
      umbriel: { parent: 'uranus', aKm: 266000 },
      titania: { parent: 'uranus', aKm: 436300 },
      oberon: { parent: 'uranus', aKm: 583520 },
      triton: { parent: 'neptune', aKm: 354759 },
    };
    // Group by parent so each system is built once.
    const byParent = new Map<string, string[]>();
    for (const [moonId, { parent }] of Object.entries(KNOWN_A_KM)) {
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(moonId);
    }
    for (const [parent, moonIds] of byParent) {
      const sub = ALL_BODIES.filter((b) => b.id === parent || moonIds.includes(b.id));
      const model = buildModel(sub, PHYSICAL_MAP);
      const sys = model.localSystems.find((s) => s.hostId === parent)!;
      const ls = sys.initialState;
      moonIds.forEach((moonId) => {
        const j = sys.bodyIds.indexOf(moonId);
        const r: Vec3 = [
          ls.pos[3 * j]! - ls.pos[0]!,
          ls.pos[3 * j + 1]! - ls.pos[1]!,
          ls.pos[3 * j + 2]! - ls.pos[2]!,
        ];
        const v: Vec3 = [
          ls.vel[3 * j]! - ls.vel[0]!,
          ls.vel[3 * j + 1]! - ls.vel[1]!,
          ls.vel[3 * j + 2]! - ls.vel[2]!,
        ];
        const mu = ls.gm[0]! + ls.gm[j]!;
        const aKm = stateToElements(mu, r, v).a * AU_KM;
        const want = KNOWN_A_KM[moonId]!.aKm;
        expect(Math.abs(aKm - want) / want, `${moonId} semi-major axis`).toBeLessThan(0.01);
      });
    }
  });

  it.each(Object.entries(KNOWN_PERIODS))(
    '%s: fitted orbital period matches known within 0.3%',
    (moonId, { parent, periodDays }) => {
      const sub = ALL_BODIES.filter((b) => ['sun', parent, moonId].includes(b.id));
      const model = buildModel(sub, PHYSICAL_MAP);
      const cfg = {
        ...DEFAULT_CONFIG,
        dt: 0.5,
        gr: false,
        sunJ2: false,
        planetJ2: true,
      };
      const solver = buildSolver(model, cfg, PHYSICAL_MAP);
      const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.5, 100_000);

      const sys = solver.systems.find((s) => s.hostId === parent)!;
      const mIdx = sys.state.n - 1;

      // Initial orbital normal and basis vectors
      const r0: Vec3 = [
        sys.state.pos[3 * mIdx]! - sys.state.pos[0]!,
        sys.state.pos[3 * mIdx + 1]! - sys.state.pos[1]!,
        sys.state.pos[3 * mIdx + 2]! - sys.state.pos[2]!,
      ];
      const v0: Vec3 = [
        sys.state.vel[3 * mIdx]! - sys.state.vel[0]!,
        sys.state.vel[3 * mIdx + 1]! - sys.state.vel[1]!,
        sys.state.vel[3 * mIdx + 2]! - sys.state.vel[2]!,
      ];
      const h0: Vec3 = [
        r0[1] * v0[2] - r0[2] * v0[1],
        r0[2] * v0[0] - r0[0] * v0[2],
        r0[0] * v0[1] - r0[1] * v0[0],
      ];
      const hl = Math.hypot(...h0);
      const n0: Vec3 = [h0[0] / hl, h0[1] / hl, h0[2] / hl];

      const r0Len = Math.hypot(...r0);
      const u0: Vec3 = [r0[0] / r0Len, r0[1] / r0Len, r0[2] / r0Len];
      const vUnit: Vec3 = [
        n0[1] * u0[2] - n0[2] * u0[1],
        n0[2] * u0[0] - n0[0] * u0[2],
        n0[0] * u0[1] - n0[1] * u0[0],
      ];

      // Sample over enough orbits for precise linear regression
      const spanDays = periodDays > 20 ? 3652.5 : periodDays > 5 ? 500 : 200;
      const dt = 0.2;
      const N = Math.round(spanDays / dt);

      let prevTheta = 0;
      let cumTheta = 0;

      const tArr: number[] = [];
      const thetaArr: number[] = [];

      for (let step = 0; step < N; step++) {
        eng.advanceFixed(dt, dt);
        const curT = (step + 1) * dt;

        const rx = sys.state.pos[3 * mIdx]! - sys.state.pos[0]!;
        const ry = sys.state.pos[3 * mIdx + 1]! - sys.state.pos[1]!;
        const rz = sys.state.pos[3 * mIdx + 2]! - sys.state.pos[2]!;

        const xi = rx * u0[0] + ry * u0[1] + rz * u0[2];
        const eta = rx * vUnit[0] + ry * vUnit[1] + rz * vUnit[2];
        const rawTheta = Math.atan2(eta, xi);

        if (step === 0) {
          prevTheta = rawTheta;
          cumTheta = rawTheta;
        } else {
          let diff = rawTheta - prevTheta;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          cumTheta += diff;
          prevTheta = rawTheta;
        }

        tArr.push(curT);
        thetaArr.push(cumTheta);
      }

      // Linear regression: theta = w * t + theta_0
      const meanT = tArr.reduce((a, b) => a + b, 0) / N;
      const meanTheta = thetaArr.reduce((a, b) => a + b, 0) / N;
      let num = 0,
        den = 0;
      for (let k = 0; k < N; k++) {
        const dtK = tArr[k]! - meanT;
        num += dtK * (thetaArr[k]! - meanTheta);
        den += dtK * dtK;
      }
      const omega = num / den;
      const measuredPeriod = (2 * Math.PI) / Math.abs(omega);

      const relErr = Math.abs(measuredPeriod - periodDays) / periodDays;
      console.log(
        `${moonId}: measured ${measuredPeriod.toFixed(4)} d vs known ${periodDays} d (diff: ${(relErr * 100).toFixed(3)}%)`,
      );
      expect(relErr).toBeLessThan(0.003); // Within 0.3% tolerance
    },
    60_000,
  );

  it('Laplace resonance of Io, Europa, and Ganymede holds with Jupiter J2', () => {
    const sub = ALL_BODIES.filter((b) =>
      ['sun', 'jupiter', 'io', 'europa', 'ganymede'].includes(b.id),
    );
    const model = buildModel(sub, PHYSICAL_MAP);

    function runResonance(withJ2: boolean) {
      const cfg = {
        ...DEFAULT_CONFIG,
        dt: 0.5,
        gr: false,
        sunJ2: false,
        planetJ2: withJ2,
      };
      const solver = buildSolver(model, cfg, PHYSICAL_MAP);
      const eng = new Engine(solver.level0, solver.forces, solver.integrator, 0.5, 100_000);
      const jupSys = solver.systems.find((s) => s.hostId === 'jupiter')!;

      const ioIdx = jupSys.bodyIds.indexOf('io');
      const euIdx = jupSys.bodyIds.indexOf('europa');
      const ganIdx = jupSys.bodyIds.indexOf('ganymede');

      let maxDevDeg = 0;
      const totalDays = 20 * 365.25; // 20 years
      const dt = 0.5;
      const steps = Math.round(totalDays / dt);

      for (let i = 0; i < steps; i++) {
        eng.advanceFixed(dt, dt);
        if (i % 20 === 0) {
          const ls = jupSys.state;
          const getLambda = (idx: number) => {
            const r: Vec3 = [
              ls.pos[3 * idx]! - ls.pos[0]!,
              ls.pos[3 * idx + 1]! - ls.pos[1]!,
              ls.pos[3 * idx + 2]! - ls.pos[2]!,
            ];
            const v: Vec3 = [
              ls.vel[3 * idx]! - ls.vel[0]!,
              ls.vel[3 * idx + 1]! - ls.vel[1]!,
              ls.vel[3 * idx + 2]! - ls.vel[2]!,
            ];
            const el = stateToElements(ls.gm[0]! + ls.gm[idx]!, r, v);
            return el.node + el.argPeri + el.meanAnom;
          };

          const l1 = getLambda(ioIdx);
          const l2 = getLambda(euIdx);
          const l3 = getLambda(ganIdx);
          const phi = l1 - 3 * l2 + 2 * l3;
          let dev = phi - Math.PI;
          while (dev > Math.PI) dev -= 2 * Math.PI;
          while (dev < -Math.PI) dev += 2 * Math.PI;
          const devDeg = Math.abs((dev * 180) / Math.PI);
          if (i === 0) {
            console.log(`t=0: l1=${(l1*180/Math.PI).toFixed(2)}°, l2=${(l2*180/Math.PI).toFixed(2)}°, l3=${(l3*180/Math.PI).toFixed(2)}°, phi=${(phi*180/Math.PI).toFixed(2)}°, devDeg=${devDeg.toFixed(2)}°`);
          }
          if (devDeg > maxDevDeg) maxDevDeg = devDeg;
        }
      }
      return maxDevDeg;
    }

    const devWithJ2 = runResonance(true);
    const devWithoutJ2 = runResonance(false);
    console.log(`Laplace angle max deviation with J2: ${devWithJ2.toFixed(3)}°, without J2: ${devWithoutJ2.toFixed(3)}°`);
    expect(devWithJ2).toBeLessThan(2.0); // Remains locked near 180°
    expect(devWithoutJ2).toBeGreaterThan(devWithJ2); // Confirms sensitivity to J2
  }, 300_000);

  it('registry and frames: every moon has a body:<id> frame and system GMs sum correctly', () => {
    const model = buildModel(ALL_BODIES, PHYSICAL_MAP);
    const frames = buildFrames(model.ids, model.names);
    const frameIds = new Set(frames.map((f) => f.id));

    // Every moon has a body:<id> frame
    for (const b of ALL_BODIES) {
      expect(frameIds.has(`body:${b.id}`)).toBe(true);
    }

    // System GMs sum back to original DE440 system GMs
    for (const lsd of model.localSystems) {
      const parent = ALL_BODIES.find((b) => b.id === lsd.hostId)!;
      const expectedSystemGm = parent.gmKm3S2;
      const totalGm = lsd.planetGm + lsd.initialState.gm.slice(1).reduce((a, b) => a + b, 0);
      const totalGmKm3 = totalGm * (AU_KM ** 3) / (86400 ** 2);
      expect(Math.abs(totalGmKm3 - expectedSystemGm) / expectedSystemGm).toBeLessThan(1e-6);
    }
  });
});
