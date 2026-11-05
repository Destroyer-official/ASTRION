import { it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

const forbid = (dir: string, patterns: RegExp[]) => {
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    for (const p of patterns) expect(src, `${file} breaks layer rule ${p}`).not.toMatch(p);
  }
};

it('physics/ and frames/ never import three, DOM, or higher layers', () => {
  const bad = [
    /from ['"]three['"]/,
    /from ['"]@\/(render|ui|sim|frames|universe)/,
    /\bdocument\./,
    /\bwindow\./,
  ];
  forbid('src/physics', bad);
  forbid('src/frames', bad);
});

it('render/ never imports physics internals', () => {
  forbid('src/render', [/from ['"]@\/physics\/(integrators|forces)/]);
});

it('sim/ never imports render, ui or universe', () => {
  forbid('src/sim', [/from ['"]@\/(render|ui|universe)/, /from ['"]three['"]/]);
});

it('data/ imports nothing from other layers', () => {
  forbid('src/data', [/from ['"]@\/(physics|sim|render|ui|frames|universe)/]);
});

it('universe/ never imports sim, render or ui', () => {
  forbid('src/universe', [/from ['"]@\/(render|ui|sim)/, /from ['"]three['"]/]);
});

it('physics/ never imports frames', () => {
  forbid('src/physics', [/from ['"]@\/frames/]);
});

it('sim/track and sim/history stay free of three', () => {
  forbid('src/sim', [/from ['"]three['"]/]);
});

it('observability/ is infrastructure with no app, browser, clock, or randomness dependencies', () => {
  forbid('src/observability', [
    /from ['"]three['"]/,
    /from ['"]@\//,
    /\bdocument\./,
    /\bwindow\./,
    /\bDate\.now\(/,
    /new Date\(/,
    /Math\.random\(/,
  ]);
});
