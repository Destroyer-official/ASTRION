import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AU_KM, DAY_S, JD_J2000 } from '@/data/constants';
import kernelProvenance from '@/data/spice/de-kernel-provenance.json';
import { SpkFile } from '@/sim/spk';

const kernelName = process.env.SPK_KERNEL ?? 'de440.bsp';
const cachePath = fileURLToPath(new URL(`./.cache/${kernelName}`, import.meta.url));
const hasKernel = existsSync(cachePath);

const TARGETS: Array<{ name: string; path: string; target: number; center: number }> = [
  { name: 'sun', path: 'bodies/sun.json', target: 10, center: 0 },
  { name: 'mercury', path: 'bodies/mercury.json', target: 1, center: 0 },
  { name: 'venus', path: 'bodies/venus.json', target: 2, center: 0 },
  { name: 'earth', path: 'bodies/earth.json', target: 3, center: 0 },
  { name: 'mars', path: 'bodies/mars.json', target: 4, center: 0 },
  { name: 'jupiter', path: 'bodies/jupiter.json', target: 5, center: 0 },
  { name: 'saturn', path: 'bodies/saturn.json', target: 6, center: 0 },
  { name: 'uranus', path: 'bodies/uranus.json', target: 7, center: 0 },
  { name: 'neptune', path: 'bodies/neptune.json', target: 8, center: 0 },
];

interface HorizonsComparisonPolicy {
  basis: string;
  maxPositionM: number | Record<string, number>;
  maxVelocityMmS: number;
}

type KernelProvenance = {
  kernels: Record<string, { horizonsComparison: HorizonsComparisonPolicy }>;
};

const dataPath = (path: string) => fileURLToPath(new URL(`../../src/data/${path}`, import.meta.url));

describe.skipIf(!hasKernel)(`SPK reader against cached Horizons states (${kernelName})`, () => {
  let spk: SpkFile;
  let context: string;

  beforeAll(async () => {
    const bytes = readFileSync(cachePath);
    const kernel = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(kernel).set(bytes);
    spk = SpkFile.fromBuffer(kernel);
    context = `${kernelName} ${bytes.length} bytes, ${spk.segments.length} segments`;
  });

  const policy = (kernelProvenance as KernelProvenance).kernels[kernelName]?.horizonsComparison;
  if (!policy) throw new Error(`no provenance policy for ${kernelName}`);
  const maxVelocityMmSLimit = policy.maxVelocityMmS as number;

  it.each(TARGETS)(
    '$name barycentric state is inside its kernel-source acceptance envelope',
    async ({ name, path, target, center }) => {
      const reference = JSON.parse(readFileSync(dataPath(path), 'utf8')) as {
        initial: { type: 'vectors'; epochJd: number; position: number[]; velocity: number[] };
      };
      expect(reference.initial.type).toBe('vectors');

      const et = (reference.initial.epochJd - JD_J2000) * DAY_S;
      const state = spk.evaluateEcliptic(target, center, et);
      const positionKm = reference.initial.position.map((au) => au * AU_KM);
      const velocityKmS = reference.initial.velocity.map((au) => (au * AU_KM) / DAY_S);

      const positionErrorsM = state.pos.map((km, axis) => (km - positionKm[axis]!) * 1_000);
      const velocityErrorsMmS = state.vel.map((kmS, axis) => (kmS - velocityKmS[axis]!) * 1_000_000);
      const maxPositionM = Math.max(...positionErrorsM.map(Math.abs));
      const maxVelocityMmS = Math.max(...velocityErrorsMmS.map(Math.abs));
      const maxPositionLimit = typeof policy.maxPositionM === 'number'
        ? policy.maxPositionM
        : policy.maxPositionM[name];
      if (typeof maxPositionLimit !== 'number') {
        throw new Error(`no provenance position limit for ${name} in ${kernelName}`);
      }

      console.log(
        `${context}\n` +
          `${path.padEnd(22)} pos ${positionErrorsM.map((m) => fmt(m, 1)).join(' ')} m  max ${maxPositionM.toExponential(3)} m` +
          `  |  vel ${velocityErrorsMmS.map((s) => fmt(s, 4)).join(' ')} mm/s  max ` +
          `${maxVelocityMmS.toExponential(3)} mm/s`,
      );

      expect(maxPositionM).toBeLessThan(maxPositionLimit);
      expect(maxVelocityMmS).toBeLessThan(maxVelocityMmSLimit);
    },
  );
});

function fmt(value: number, digits: number): string {
  return value.toFixed(digits).padStart(digits + 9);
}
