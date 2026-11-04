// Usage: npm run fetch:textures
// Downloads real planetary surface maps (2K equirectangular) into public/textures/
// and writes a hash-guarded manifest with attribution.
//
// Sources: Solar System Scope free texture set (solarsystemscope.com, used with
// attribution — see manifest + README). The Sun is hotlink-protected there, so
// it keeps our procedural granulation/sunspot texture, which is already the
// most detailed procedural map in the app.
// Fallback: if a file is missing at runtime, BodyVisual falls back to the
// seeded procedural texture for that body — the app never breaks offline.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://www.solarsystemscope.com/textures/download';
// [local file, remote file, body ids using it]
const FILES = [
  ['mercury.jpg', '2k_mercury.jpg', ['mercury']],
  ['venus.jpg', '2k_venus_atmosphere.jpg', ['venus']],
  ['earth.jpg', '2k_earth_daymap.jpg', ['earth']],
  ['moon.jpg', '2k_moon.jpg', ['moon']],
  ['mars.jpg', '2k_mars.jpg', ['mars']],
  ['jupiter.jpg', '2k_jupiter.jpg', ['jupiter']],
  ['saturn.jpg', '2k_saturn.jpg', ['saturn']],
  ['uranus.jpg', '2k_uranus.jpg', ['uranus']],
  ['neptune.jpg', '2k_neptune.jpg', ['neptune']],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, dest) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 50_000) throw new Error(`suspiciously small (${buf.length} bytes)`);
      // Sanity: JPEG magic bytes
      if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
      await writeFile(dest, buf);
      return buf;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

await mkdir('public/textures', { recursive: true });

const manifest = {
  fetchedAtUtc: new Date().toISOString(),
  attribution:
    'Planetary maps (c) Solar System Scope (solarsystemscope.com) free texture set, ' +
    'used with attribution. The Sun and all moons keep in-app procedural textures. ' +
    'Runtime fallback: BodyVisual uses the seeded procedural map if a file is absent.',
  files: [],
};

for (const [local, remote, bodies] of FILES) {
  console.log('downloading', local, '...');
  const buf = await download(`${BASE}/${remote}`, `public/textures/${local}`);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  manifest.files.push({ file: local, source: `${BASE}/${remote}`, bodies, bytes: buf.length, sha256 });
  console.log(`  saved public/textures/${local} (${(buf.length / 1024).toFixed(0)} KB)`);
  await sleep(800);
}

await writeFile('public/textures/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('\nwrote public/textures/manifest.json');
console.log('done — planet maps ready');
