/**
 * Cosmic Catalog Engine — Contract Test Suite
 *
 * Verifies the flight-grade invariants of the catalog backbone:
 *   • Full schema validation with precise, field-level diagnostics
 *   • Transactional batch registration (validate-all → analyze → commit)
 *   • Duplicate-id and parent-cycle rejection, state left byte-identical
 *   • Deep immutable catalog nodes (mutation-proof)
 *   • Defensive-copy query surfaces (sort results without corrupting indexes)
 *   • Streaming orphan registration + auto-adoption of late parents
 *   • Boot-time integrity gate for the shipped dataset
 *   • Memoized search contract (empty/oversized/invalid queries)
 */
import { describe, it, expect } from 'vitest';
import {
  COSMIC_REGISTRY,
  CosmicCatalogError,
  CosmicCatalogManager,
  cosmicCatalog,
  getCosmicNode,
  validateCosmicNode,
} from '@/universe/cosmicRegistry';
import type { CosmicNode } from '@/universe/cosmicHierarchy';

function validNode(overrides: Partial<CosmicNode> = {}, id = 'test_galaxy'): CosmicNode {
  return {
    id,
    name: 'Test Galaxy',
    tier: 'galaxy',
    parentId: 'virgo_supercluster',
    category: 'galaxy',
    description: 'A synthetic member-galaxy for contract verification.',
    astrometry: { distanceLy: 1_000, raDeg: 10, decDeg: -10 },
    facts: { radiusKm: 1e18, massSolar: 1e11, distanceFromSunLy: 1_000 },
    cameraPreset: {
      focusId: 'sgra',
      frameId: 'galactic-aligned',
      distance: 5_000,
      direction: [0, 0.5, 0.5],
    },
    ...overrides,
  };
}

describe('Schema validation (pure function)', () => {
  it('accepts every node of the shipped 66-object dataset', () => {
    for (const node of COSMIC_REGISTRY) {
      const result = validateCosmicNode(node, node.id);
      expect(result.errors, node.id).toEqual([]);
      expect(result.valid, node.id).toBe(true);
    }
  });

  it('rejects non-objects and empty identifiers', () => {
    expect(validateCosmicNode(null).valid).toBe(false);
    expect(validateCosmicNode(undefined).valid).toBe(false);
    expect(validateCosmicNode('mars').valid).toBe(false);
    expect(validateCosmicNode({ id: '' }).errors.some((e) => e.includes('.id'))).toBe(true);
    const upper = validateCosmicNode(validNode({}, 'Bad_Id'));
    expect(upper.valid).toBe(false);
    expect(upper.errors.some((e) => e.includes('snake_case'))).toBe(true);
  });

  it('rejects tier/category mismatches with cross-field diagnostics', () => {
    const probe = validateCosmicNode(validNode({ category: 'belt' }));
    expect(probe.valid).toBe(false);
    expect(probe.errors.some((e) => e.includes("not valid for tier 'galaxy'"))).toBe(true);
  });

  it('rejects impossible physics with the exact offending field named', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ facts: { radiusKm: -5 } }, '.facts.radiusKm'],
      [{ facts: { radiusKm: Number.NaN } }, '.facts.radiusKm'],
      [{ facts: { discoveredYear: 1400 } }, '.facts.discoveredYear'],
      [{ facts: { eccentricity: 1.5 } }, '.facts.eccentricity'],
      [{ facts: { massKg: -1e30 } }, '.facts.massKg'],
    ];
    for (const [override, field] of cases) {
      const node = { ...validNode(), ...override } as unknown as CosmicNode;
      const result = validateCosmicNode(node);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(field)), field).toBe(true);
    }
  });

  it('rejects bad astrometry ranges', () => {
    expect(
      validateCosmicNode(validNode({ astrometry: { raDeg: 370, decDeg: 0, distanceLy: 10 } })).errors.some((e) =>
        e.includes('raDeg'),
      ),
    ).toBe(true);
    expect(
      validateCosmicNode(validNode({ astrometry: { decDeg: 95, distanceLy: 10 } })).errors.some((e) =>
        e.includes('decDeg'),
      ),
    ).toBe(true);
    expect(
      validateCosmicNode(validNode({ astrometry: { distanceLy: -3 } })).errors.some((e) =>
        e.includes('distanceLy'),
      ),
    ).toBe(true);
    expect(validateCosmicNode(validNode({ astrometry: undefined })).valid).toBe(true);
  });

  it('rejects unusable camera presets', () => {
    const zero = validateCosmicNode(
      validNode({ cameraPreset: { focusId: 's', frameId: 'f', distance: 1, direction: [0, 0, 0] } }),
    );
    expect(zero.errors.some((e) => e.includes('direction'))).toBe(true);
    const nanDistance = validateCosmicNode(
      validNode({ cameraPreset: { focusId: 's', frameId: 'f', distance: Number.NaN, direction: [1, 0, 0] } }),
    );
    expect(nanDistance.errors.some((e) => e.includes('distance'))).toBe(true);
    const missing = validateCosmicNode({ ...validNode(), cameraPreset: undefined } as unknown as CosmicNode);
    expect(missing.errors.some((e) => e.includes('cameraPreset'))).toBe(true);
  });
});

describe('Transactional registration', () => {
  it('commits a clean batch and bumps the mutation version', () => {
    const manager = new CosmicCatalogManager([]);
    const v0 = manager.getVersion();
    const committed = manager.registerBatch([validNode(), validNode({ id: 'second_galaxy' })]);
    expect(committed.length).toBe(2);
    expect(manager.getAllNodes().length).toBe(2);
    expect(manager.getVersion()).toBe(v0 + 1);
  });

  it('rejects a batch with any invalid node — nothing is committed', () => {
    const manager = new CosmicCatalogManager([]);
    expect(() =>
      manager.registerBatch([validNode(), validNode({ facts: { radiusKm: 0 }, id: 'bad' } as Partial<CosmicNode> as CosmicNode)]),
    ).toThrow(CosmicCatalogError);
    expect(manager.getAllNodes().length).toBe(0);
  });

  it('rejects duplicate ids against the existing index, state unchanged', () => {
    const manager = new CosmicCatalogManager([]);
    manager.registerBatch([validNode()]);
    const before = manager.getAllNodes().length;
    let err: CosmicCatalogError | null = null;
    try {
      manager.registerBatch([validNode()]);
    } catch (e) {
      err = e as CosmicCatalogError;
    }
    expect(err, 'should reject a duplicate id').toBeInstanceOf(CosmicCatalogError);
    expect(err!.details.join('\n')).toContain("duplicate id 'test_galaxy' is already registered");
    expect(manager.getAllNodes().length).toBe(before);
  });

  it('rejects a full-batch replacement attempt through registerNode', () => {
    const manager = new CosmicCatalogManager([]);
    manager.registerBatch([validNode()]);
    expect(() => manager.registerNode(validNode({ name: 'Reloaded' }))).toThrow(CosmicCatalogError);
  });

  it('rejects an empty id object comprehensively', () => {
    const manager = new CosmicCatalogManager([]);
    const garbage = { id: '', name: '', tier: 'nope', category: 'nope', description: '' } as unknown as CosmicNode;
    let thrown: unknown = null;
    try {
      manager.registerBatch([garbage]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CosmicCatalogError);
    const err = thrown as CosmicCatalogError;
    expect(err.code).toBe('INVALID_NODE');
    expect(err.details.length).toBeGreaterThan(3); // id, name, tier, category, description
  });
});

describe('Acyclic parent-graph guarantee', () => {
  it('detects a two-node cycle across the combined graph', () => {
    const manager = new CosmicCatalogManager([]);
    let code: string | null = null;
    try {
      manager.registerBatch([
        validNode({ parentId: 'cycle_b' }, 'cycle_a'),
        validNode({ parentId: 'cycle_a' }, 'cycle_b'),
      ]);
    } catch (e) {
      expect(e).toBeInstanceOf(CosmicCatalogError);
      code = (e as CosmicCatalogError).code;
    }
    expect(code).toBe('CYCLE_DETECTED');
    expect(manager.getAllNodes().length).toBe(0);
  });

  it('detects a self-parent early in validation', () => {
    const manager = new CosmicCatalogManager([]);
    try {
      manager.registerBatch([validNode({ parentId: 'loop' }, 'loop')]);
      expect.unreachable();
    } catch (e) {
      expect((e as CosmicCatalogError).details.join('\n')).toContain('cannot be its own parent');
    }
  });

  it('keeps the shipped dataset acyclic (assertIntegrity passes)', () => {
    expect(cosmicCatalog.assertIntegrity()).toEqual([]);
  });
});

describe('Immutability guarantees', () => {
  it('deep-freezes registered nodes', () => {
    const manager = new CosmicCatalogManager([]);
    const [node] = manager.registerBatch([validNode()]);
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node!.facts)).toBe(true);
    expect(Object.isFrozen(node!.cameraPreset)).toBe(true);
    expect(() => {
      (node as { name: string }).name = 'hacked';
    }).toThrow(TypeError);
    expect(() => {
      (node!.facts as { radiusKm: number }).radiusKm = -1;
    }).toThrow(TypeError);
  });

  it('deep-freezes the shipped singleton nodes and dataset array', () => {
    const jupiter = getCosmicNode('jupiter')!;
    expect(() => {
      (jupiter.facts as { massKg: number }).massKg = 0;
    }).toThrow(TypeError);
    expect(() => {
      (COSMIC_REGISTRY as unknown as CosmicNode[]).push(validNode());
    }).toThrow(TypeError);
  });

  it('returns defensive copies on tier and children queries', () => {
    const a = cosmicCatalog.getNodesByTier('local_group');
    const b = cosmicCatalog.getNodesByTier('local_group');
    expect(a).not.toBe(b);
    expect(a.map((n) => n.id)).toEqual(b.map((n) => n.id));
    a.sort((x, y) => x.name.localeCompare(y.name)); // no index corruption
    expect(b.map((n) => n.id)).toEqual(cosmicCatalog.getNodesByTier('local_group').map((n) => n.id));

    const c1 = cosmicCatalog.getChildren('milky_way');
    const c2 = cosmicCatalog.getChildren('milky_way');
    expect(c1).not.toBe(c2);
    expect(c1.map((n) => n.id)).toEqual(c2.map((n) => n.id));
    c1.reverse();
    expect(c1.map((n) => n.id)).toEqual(c2.map((n) => n.id).slice().reverse());
  });
});

describe('Streaming orphan registration', () => {
  it('indexes a child before its parent exists and adopts it on arrival', () => {
    const manager = new CosmicCatalogManager([]);
    const child = validNode({ parentId: 'late_parent' }, 'orphan_child');
    manager.registerBatch([child]);
    expect(manager.getNode('orphan_child')).toBeDefined();
    // Waiting children surface under the parent-id key even before arrival.
    expect(manager.getChildren('late_parent').map((n) => n.id)).toContain('orphan_child');
    // Breadcrumbs stop at the resolvable prefix.
    expect(manager.getPathToRoot('orphan_child').map((n) => n.id)).toEqual(['orphan_child']);

    const parent = validNode({ tier: 'local_group', parentId: undefined }, 'late_parent');
    manager.registerBatch([parent]);
    expect(manager.getPathToRoot('orphan_child').map((n) => n.id)).toEqual(['late_parent', 'orphan_child']);
  });

  it('reports unresolved parents and root cardinality through assertIntegrity', () => {
    const empty = new CosmicCatalogManager([]);
    expect(empty.assertIntegrity().join('\n')).toContain('NO_ROOT');

    const stranded = new CosmicCatalogManager([]);
    stranded.registerBatch([validNode({ parentId: 'missing_place' }, 'stranded')]);
    const report = stranded.assertIntegrity();
    expect(report.join('\n')).toContain("stranded' points to missing parent 'missing_place'");

    const clean = new CosmicCatalogManager([]);
    clean.registerBatch([validNode({ parentId: undefined }, 'root_galaxy')]);
    expect(clean.assertIntegrity()).toEqual([]);
  });
});

describe('Search contract', () => {
  it('handles empty, whitespace, oversized, and non-string queries safely', () => {
    expect(cosmicCatalog.search('')).toEqual([]);
    expect(cosmicCatalog.search('   ')).toEqual([]);
    expect(cosmicCatalog.search('z'.repeat(500)).length).toBeLessThanOrEqual(12);
    expect((cosmicCatalog.search as unknown as (q: unknown) => CosmicNode[])(42)).toEqual([]);
  });

  it('respects maxResults and yields stable, memoized rankings', () => {
    const first = cosmicCatalog.search('e', 5);
    const second = cosmicCatalog.search('e', 5);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(first.map((n) => n.id)).toEqual(second.map((n) => n.id));
    const more = cosmicCatalog.search('andromeda gal', 50);
    expect(more.length).toBeGreaterThan(0);
    expect(more[0]!.id).toBe('andromeda');
  });
});

describe('Catalog statistics', () => {
  it('reports internally consistent counts', () => {
    const stats = cosmicCatalog.getStats();
    expect(stats.total).toBe(COSMIC_REGISTRY.length);
    const tierSum = Object.values(stats.byTier).reduce((sum, n) => sum + n, 0);
    expect(tierSum).toBe(stats.total);
    const categorySum = Object.values(stats.byCategory).reduce((sum, n) => sum + n, 0);
    expect(categorySum).toBe(stats.total);
    expect(stats.roots).toBe(1);
    expect(Object.keys(stats.byTier)).toContain('galaxy');
    expect(Object.keys(stats.byTier)).toContain('spacecraft');
  });
});
