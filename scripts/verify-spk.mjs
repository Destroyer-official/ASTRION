// Manual binary SPK verification helper. Not part of `npm test`.
//
//   npm run verify:spk              # validates against de440.bsp (114 MB)
//   SPK_KERNEL=de440s.bsp npm run verify:spk
//
// Kernels are cached under tests/validation/.cache/, which .gitignore excludes:
// redistribution terms for the binary kernels are unresolved (OPEN-005), so they
// must never enter source control. The MD5 digests below were read from
// https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/aa_checksums.txt
// (fetched 2026-11-05) and are compared after every download, so a cached file is
// proven byte-identical to NAIF's copy rather than merely the same length.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const BASE_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/';

const KERNELS = {
  'de440.bsp': { bytes: 119_799_808, md5: 'c9d581bfd84209dbeee8b1583939b148' },
  'de440s.bsp': { bytes: 32_726_016, md5: '3917ee56769db332790c751e2168843d' },
  'de442.bsp': { bytes: 119_771_136, md5: '446656322267e7b819a26cb08a0d8718' },
};

const name = process.env.SPK_KERNEL ?? 'de440.bsp';
const expected = KERNELS[name];
if (!expected) {
  throw new Error(`unknown kernel ${JSON.stringify(name)}; options: ${Object.keys(KERNELS).join(', ')}`);
}
const destination = `tests/validation/.cache/${name}`;

function digest(file, algorithm) {
  const hash = createHash(algorithm);
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function size(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

await mkdir('tests/validation/.cache', { recursive: true });
if ((await size(destination)) !== expected.bytes) {
  console.log(`downloading ${name} (${expected.bytes} bytes; never committed)`);
  const response = await fetch(BASE_URL + name);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== expected.bytes) throw new Error(`downloaded ${body.length} bytes, expected ${expected.bytes}`);
  const temporary = `${destination}.part`;
  await writeFile(temporary, body);
  await rename(temporary, destination);
}

const md5 = await digest(destination, 'md5');
if (md5 !== expected.md5) {
  throw new Error(`MD5 mismatch: ${md5} != NAIF's ${expected.md5} for ${destination}`);
}
console.log(`${destination}: ${expected.bytes} bytes, MD5 ${md5} (matches NAIF aa_checksums.txt)`);
console.log(`SHA-256 ${await digest(destination, 'sha256')} (local integrity record)`);

const test = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/validation'],
  { stdio: 'inherit', env: { ...process.env, SPK_KERNEL: name } },
);
process.exit(test.status ?? 1);
