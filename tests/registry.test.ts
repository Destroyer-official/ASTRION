import { it, expect } from 'vitest';
import { loadSystem, ALL_BODIES, ASTEROID_BODIES } from '@/sim/registry';
import { centerOfMass } from '@/physics/diagnostics';
import { PHASE1_BODIES } from './fixtures/phase1';

it('loaded system is barycentric: COM at origin and at rest', () => {
  const { state } = loadSystem(PHASE1_BODIES);
  const c = centerOfMass(state);
  for (const v of [...c.pos, ...c.vel]) expect(Math.abs(v)).toBeLessThan(1e-12);
});

it('Sun is first (heaviest) and is NOT at the origin', () => {
  const m = loadSystem(PHASE1_BODIES);
  expect(m.ids[0]).toBe('sun');
  expect(Math.hypot(m.state.pos[0]!, m.state.pos[1]!, m.state.pos[2]!)).toBeGreaterThan(1e-3);
});

it('loads ALL_BODIES including dwarf planets, all moons and the 16 asteroid perturbers', () => {
  const m = loadSystem(ALL_BODIES);
  expect(m.ids.length).toBe(48);
  expect(m.ids).toContain('moon');
  expect(m.ids).toContain('io');
  expect(m.ids).toContain('europa');
  expect(m.ids).toContain('asteroid-52');
  expect(m.ids).toContain('ceres');
  expect(m.ids).toContain('pallas');
  expect(m.ids).toContain('vesta');
  expect(m.ids).toContain('hygiea');
  expect(ASTEROID_BODIES.length).toBe(16);
  expect(new Set(m.ids).size).toBe(48);
  expect(m.ids).toContain('titan');
  expect(m.ids).toContain('phobos');
  expect(m.ids).toContain('pluto');
});
