import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSystem } from '@/sim/registry';
import { cloneState } from '@/physics/system';
import { Leapfrog } from '@/physics/integrators/leapfrog';
import { yoshida6 } from '@/physics/integrators/yoshida';
import { newtonianGravity } from '@/physics/forces/gravity';
import { Engine } from '@/sim/engine';
import { PHASE1_BODIES } from './fixtures/phase1';
import { createPrng } from '@/render/prng';
import { createStarfield } from '@/render/starfield';
import { OortCloudVisual } from '@/render/oortCloud';
import { GalaxyVisual } from '@/render/galaxyVisual';

const forces = [newtonianGravity];
const model = loadSystem(PHASE1_BODIES);

describe('Determinism and Fixed-Step Stepping', () => {
  it('fixed-step results do not depend on how time is chunked', () => {
    const mk = () => new Engine(cloneState(model.state), forces, yoshida6(new Leapfrog()), 1, 4000);
    const a = mk(),
      b = mk();
    a.advanceFixed(100.5, 1);
    for (let i = 0; i < 335; i++) b.advanceFixed(0.3, 1); // 100.5 days in tiny chunks
    expect(b.state.pos).toEqual(a.state.pos); // bit-identical
    expect(b.carry).toBeCloseTo(0.5, 12);
  });

  describe('Render-Layer Visual Determinism (AUDIT-35)', () => {
    it('Mulberry32 PRNG produces identical pseudo-random sequences for identical seeds', () => {
      const prngA = createPrng(0xabcdef);
      const prngB = createPrng(0xabcdef);
      for (let i = 0; i < 1000; i++) {
        expect(prngA()).toBe(prngB());
      }
    });

    it('createStarfield produces bit-identical geometry with fixed seed', () => {
      const field1 = createStarfield(45000, 0x12345);
      const field2 = createStarfield(45000, 0x12345);

      const points1 = field1.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];
      const points2 = field2.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];

      expect(points1.length).toBe(points2.length);
      for (let k = 0; k < points1.length; k++) {
        const p1 = points1[k]!.geometry.attributes['position'] as THREE.BufferAttribute;
        const p2 = points2[k]!.geometry.attributes['position'] as THREE.BufferAttribute;
        expect(p1.array).toEqual(p2.array);

        const c1 = points1[k]!.geometry.attributes['color'] as THREE.BufferAttribute;
        const c2 = points2[k]!.geometry.attributes['color'] as THREE.BufferAttribute;
        expect(c1.array).toEqual(c2.array);
      }
    });

    it('OortCloudVisual generates bit-identical particles across runs with fixed seed', () => {
      const oort1 = new OortCloudVisual({ seed: 0x54321 });
      const oort2 = new OortCloudVisual({ seed: 0x54321 });

      const pts1 = oort1.group.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];
      const pts2 = oort2.group.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];

      expect(pts1.length).toBe(pts2.length);
      for (let k = 0; k < pts1.length; k++) {
        const a1 = pts1[k]!.geometry.attributes['position'] as THREE.BufferAttribute;
        const a2 = pts2[k]!.geometry.attributes['position'] as THREE.BufferAttribute;
        expect(a1.array).toEqual(a2.array);
      }
    });

    it('GalaxyVisual generates bit-identical star discs and bulge distributions with fixed seed', () => {
      const gv1 = new GalaxyVisual({ numStars: 1000, numHaloStars: 200, numGlobularClusters: 10, seed: 0x9988 });
      const gv2 = new GalaxyVisual({ numStars: 1000, numHaloStars: 200, numGlobularClusters: 10, seed: 0x9988 });

      const pts1 = gv1.group.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];
      const pts2 = gv2.group.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];

      expect(pts1.length).toBe(pts2.length);
      for (let k = 0; k < pts1.length; k++) {
        const a1 = pts1[k]!.geometry.attributes['position'] as THREE.BufferAttribute;
        const a2 = pts2[k]!.geometry.attributes['position'] as THREE.BufferAttribute;
        expect(a1.array).toEqual(a2.array);
      }
    });
  });
});
