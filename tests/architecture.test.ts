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

it('only console log sink writes directly to console', () => {
  for (const file of walk('src')) {
    if (file.endsWith(join('observability', 'logger.ts'))) continue;
    const src = readFileSync(file, 'utf8');
    expect(src, `${file} bypasses the central log sink`).not.toMatch(/\bconsole\./);
  }
});

it('all primary architectural modules expose public index.ts entry points', () => {
  const modules = ['physics', 'frames', 'universe', 'data', 'sim', 'observability', 'physics/light'];
  for (const mod of modules) {
    const indexPath = join('src', mod, 'index.ts');
    expect(statSync(indexPath).isFile(), `${mod}/index.ts must exist as public API barrel`).toBe(true);
  }
});

it('physical constants have one data-layer definition', () => {
  const literal = /149_?597_?870\.7|299_?792\.458|132_?712_?440_?041\.279419|63_?241(?:\.077)?/;
  for (const file of walk('src')) {
    if (file.endsWith(join('data', 'constants.ts'))) continue;
    const code = readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(code, `${file} duplicates a physical constant`).not.toMatch(literal);
  }
});
