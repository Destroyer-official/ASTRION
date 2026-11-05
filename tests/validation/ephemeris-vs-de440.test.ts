import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AU_KM, DAY_S, JD_J2000 } from '@/data/constants';
import { ALL_BODIES, loadSystem } from '@/sim/registry';
import { EphemerisProvider } from '@/sim/ephemeris';
import { SpkFile } from '@/sim/spk';

const kernelName = process.env.SPK_KERNEL ?? 'de440.bsp';
const cachePath = fileURLToPath(new URL(`./.cache/${kernelName}`, import.meta.url));
const hasKernel = existsSync(cachePath);

/** Barycentric Horizons/Sim ids. The Moon is excluded deliberately: the model
 *  stores it parent-relative, so its slot is not comparable with a barycentric
 *  kernel state (that offset alone is 4,541 km at the epoch). */
const TARGETS: Array<{ id: string; target: number }> = [
  { id: 'sun', target: 10 },
  { id: 'mercury', target: 1 },
  { id: 'venus', target: 2 },
  { id: 'earth', target: 3 },
  { id: 'mars', target: 4 },
  { id: 'jupiter', target: 5 },
  { id: 'saturn', target: 6 },
  { id: 'uranus', target: 7 },
  { id: 'neptune', target: 8 },
];

// Measured 2026-11-05 over -364..+724 days at 0.5-day steps: the worst body was
// Mercury is the worst at 8.011e+1 km, every other planet and the Sun stay under
// 1 km. That span is where the dense table actually covers every body (the outer
// planets' nodes stop at +724 d); past it the error is OPEN-008's coverage problem,
// not this test's.
const MAX_ERROR_KM = 200;
const WINDOW_FROM = -364;
const WINDOW_TO = 724;
const STEP_DAYS = 0.5;

describe.skipIf(!hasKernel)(`runtime ephemeris against ${kernelName}`, () => {
  const model = loadSystem(ALL_BODIES);
  const provider = new EphemerisProvider(model);
  const pos = new Float64Array(3 * model.ids.length);
  const vel = new Float64Array(3 * model.ids.length);
  let spk: SpkFile;

  beforeAll(() => {
    const bytes = readFileSync(cachePath);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    spk = SpkFile.fromBuffer(buffer);
  });

  it.each(TARGETS)('$id stays within ' + MAX_ERROR_KM + ' km inside the dense anchor window', ({ id, target }) => {
    const index = model.ids.indexOf(id);
    expect(index).toBeGreaterThanOrEqual(0);

    let worstPosition = 0;
    let worstVelocity = 0;
    let worstDay = 0;
    for (let day = WINDOW_FROM; day <= WINDOW_TO; day += STEP_DAYS) {
      provider.interpolate(day, pos, vel);
      const state = spk.evaluateEcliptic(target, 0, (model.epochJd + day - JD_J2000) * DAY_S);
      const positionErrorKm = Math.hypot(
        ...[0, 1, 2].map((k) => (pos[3 * index + k]! - state.pos[k]! / AU_KM) * AU_KM),
      );
      const velocityErrorKmS = Math.hypot(
        ...[0, 1, 2].map((k) => (vel[3 * index + k]! - (state.vel[k]! * DAY_S) / AU_KM) * (AU_KM / DAY_S)),
      );
      if (positionErrorKm > worstPosition) {
        worstPosition = positionErrorKm;
        worstDay = day;
      }
      worstVelocity = Math.max(worstVelocity, velocityErrorKmS);
    }

    console.log(
      `${id.padEnd(8)} worst ${worstPosition.toExponential(3)} km at day ${worstDay}` +
        `  |  worst velocity ${worstVelocity.toExponential(3)} km/s`,
    );
    expect(worstPosition).toBeLessThan(MAX_ERROR_KM);
  });
});
