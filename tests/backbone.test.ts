/**
 * Extensible Cosmic Backbone Tests
 *
 * Proves the registry is a genuine scalable backbone: new galaxies, star
 * systems, planets and exoplanets can be hot-registered at runtime and become
 * fully first-class (indexing, hierarchy, breadcrumbs, search) immediately.
 */
import { describe, it, expect } from 'vitest';
import { CosmicCatalogManager, CosmicCatalogError, getCosmicNode } from '@/universe/cosmicRegistry';
import type { CosmicNode } from '@/universe/cosmicHierarchy';

function galaxyNode(): CosmicNode {
  return {
    id: 'whirlpool_galaxy',
    name: 'Whirlpool Galaxy (M51a)',
    tier: 'local_group',
    parentId: 'laniakea',
    category: 'galaxy',
    description: 'Grand-design test galaxy for runtime backbone registration.',
    astrometry: { raDeg: 202.47, decDeg: 47.195, distanceLy: 31_000_000 },
    facts: { massSolar: 1.6e11, radiusKm: 3.8e18, distanceFromSunLy: 31_000_000 },
    cameraPreset: { focusId: 'sgra', frameId: 'galactic-aligned', distance: 10_000, direction: [0.5, -0.4, 0.75] },
  };
}

function starNode(): CosmicNode {
  return {
    id: 'alpha_crusis',
    name: 'Alpha Crucis System (Acrux)',
    tier: 'star_system',
    parentId: 'milky_way',
    category: 'star',
    description: 'Bright B0.5IV southern star for runtime backbone registration.',
    astrometry: { raDeg: 186.65, decDeg: -63.1, distanceLy: 320 },
    facts: { spectralType: 'B0.5IV', massSolar: 17.9, radiusKm: 5_100_000, distanceFromSunLy: 320 },
    cameraPreset: { focusId: 'sun', frameId: 'body:sun', distance: 400, direction: [0.6, 0.5, -0.6] },
  };
}

function planetNode(): CosmicNode {
  return {
    id: 'crux_b',
    name: 'Acrux b (test planet)',
    tier: 'planetary_system',
    parentId: 'alpha_crusis',
    category: 'exoplanet',
    description: 'Runtime-registered exoplanet orbiting the runtime-registered star.',
    astrometry: { distanceLy: 320 },
    facts: { radiusKm: 7_000, semiMajorAxisAu: 0.04, orbitalPeriodDays: 3.5 },
    cameraPreset: { focusId: 'sun', frameId: 'body:sun', distance: 420, direction: [0.6, 0.5, -0.6] },
  };
}

describe('Runtime cosmic backbone extension', () => {
  it('accepts a fresh galaxy + star + its planet chain in one batch', () => {
    const manager = new CosmicCatalogManager([]);
    manager.registerBatch([galaxyNode(), starNode(), planetNode()]);

    expect(manager.getAllNodes().length).toBe(3);
    expect(manager.getNode('whirlpool_galaxy')).toBeDefined();
    expect(manager.getNode('alpha_crusis')).toBeDefined();
    expect(manager.getNode('crux_b')).toBeDefined();
  });

  it('maintains parent child links and tier indexes for hot-registered nodes', () => {
    const manager = new CosmicCatalogManager([starNode(), planetNode()]);
    expect(manager.getChildren('alpha_crusis').map((c) => c.id)).toContain('crux_b');
    expect(manager.getNodesByTier('local_group').length).toBe(0);
    expect(manager.getNodesByTier('planetary_system').map((n) => n.id)).toContain('crux_b');
  });

  it('finds new objects through multi-token fuzzy search', () => {
    const manager = new CosmicCatalogManager([starNode(), planetNode()]);
    const hits = manager.search('Acrux b');
    expect(hits[0]!.id).toBe('crux_b');
  });

  it('resolves full breadcrumb chains across runtime-registered hierarchies', () => {
    const manager = new CosmicCatalogManager([getCosmicNode('milky_way')!, starNode(), planetNode()]);
    const crumbs = manager.getPathToRoot('crux_b').map((c) => c.id);
    expect(crumbs).toEqual(['milky_way', 'alpha_crusis', 'crux_b']);
  });

  it('rejects malformed nodes instead of corrupting indexes', () => {
    const manager = new CosmicCatalogManager([]);
    expect(() => manager.registerNode(null as unknown as CosmicNode)).toThrow(CosmicCatalogError);
    expect(() => manager.registerNode({ id: '' } as unknown as CosmicNode)).toThrow(CosmicCatalogError);
    expect(manager.getAllNodes().length).toBe(0);
  });
});
