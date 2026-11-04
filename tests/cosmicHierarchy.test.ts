import { describe, it, expect } from 'vitest';
import { COSMIC_REGISTRY, getCosmicNode, getCosmicNodesByTier, getCosmicChildren } from '@/universe/cosmicRegistry';

describe('NASA Cosmic Hierarchy & Universal Registry Architecture', () => {
  it('contains entries across all astronomical tiers', () => {
    expect(COSMIC_REGISTRY.length).toBeGreaterThanOrEqual(10);
    const tiers = new Set(COSMIC_REGISTRY.map((n) => n.tier));
    expect(tiers.has('local_group')).toBe(true);
    expect(tiers.has('galaxy')).toBe(true);
    expect(tiers.has('star_system')).toBe(true);
    expect(tiers.has('planetary_system')).toBe(true);
  });

  it('correctly retrieves Milky Way and its structural children', () => {
    const mw = getCosmicNode('milky_way');
    expect(mw).toBeDefined();
    expect(mw?.category).toBe('galaxy');
    expect(mw?.facts.massSolar).toBeGreaterThan(1e11);

    const mwChildren = getCosmicChildren('milky_way');
    expect(mwChildren.length).toBeGreaterThanOrEqual(3);
    const childIds = mwChildren.map((c) => c.id);
    expect(childIds).toContain('sgra');
    expect(childIds).toContain('solar_system');
  });

  it('includes key Local Group galaxies with astronomical distances', () => {
    const localGroup = getCosmicNodesByTier('local_group');
    expect(localGroup.length).toBeGreaterThanOrEqual(4);
    const andromeda = getCosmicNode('andromeda');
    expect(andromeda).toBeDefined();
    expect(andromeda?.facts.distanceFromSunLy).toBeCloseTo(2537000, -3);
    expect(andromeda?.facts.distanceFromSgrAKpc).toBeCloseTo(778, 0);

    const triangulum = getCosmicNode('triangulum');
    expect(triangulum).toBeDefined();
    expect(triangulum?.facts.distanceFromSunLy).toBeCloseTo(2730000, -3);
  });

  it('includes neighboring star systems with verified exoplanets', () => {
    const alphaCen = getCosmicNode('alpha_centauri');
    expect(alphaCen).toBeDefined();
    expect(alphaCen?.facts.distanceFromSunLy).toBeCloseTo(4.24, 2);

    const trappist1 = getCosmicNode('trappist_1');
    expect(trappist1).toBeDefined();
    expect(trappist1?.facts.distanceFromSunLy).toBeCloseTo(39.5, 1);
    expect(trappist1?.description).toContain('7 Earth-sized');

    const kepler186 = getCosmicNode('kepler_186');
    expect(kepler186).toBeDefined();
    expect(kepler186?.facts.distanceFromSunLy).toBeCloseTo(580, 0);
  });

  it('defines valid non-zero camera presets for every cosmic node', () => {
    for (const node of COSMIC_REGISTRY) {
      expect(node.cameraPreset.distance).toBeGreaterThan(0);
      expect(node.cameraPreset.direction.length).toBe(3);
      const dirLen = Math.hypot(...node.cameraPreset.direction);
      expect(dirLen).toBeGreaterThan(0.5);
    }
  });
});
