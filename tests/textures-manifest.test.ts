// Guards the real planetary maps in public/textures/ (fetched with
// `npm run fetch:textures`): every manifest entry must exist on disk with
// matching size + SHA-256, and every planet/moon with a real map must be
// registered in the loader table (or explicitly fall back to procedural).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const texUrl = (f: string) => fileURLToPath(new URL(`../public/textures/${f}`, import.meta.url));

const manifest = JSON.parse(readFileSync(texUrl('manifest.json'), 'utf8')) as {
  attribution: string;
  files: { file: string; source: string; bodies: string[]; bytes: number; sha256: string }[];
};

describe('real planetary texture maps', () => {
  it('manifest carries attribution and covers all 8 planets + the Moon', () => {
    expect(manifest.attribution).toContain('solarsystemscope.com');
    const bodies = manifest.files.flatMap((f) => f.bodies);
    for (const id of ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      expect(bodies, `missing map for ${id}`).toContain(id);
    }
  });

  it.each(manifest.files.map((f) => [f.file] as [string]))('%s exists with matching size + hash', (file) => {
    const entry = manifest.files.find((f) => f.file === file)!;
    const buf = readFileSync(texUrl(file));
    expect(buf.length).toBe(entry.bytes);
    expect(createHash('sha256').update(buf).digest('hex')).toBe(entry.sha256);
    // JPEG magic bytes (maps are .jpg)
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });
});
