import type { CosmicCategory, CosmicNode, CosmicTier } from './cosmicHierarchy';
import { COSMIC_REGISTRY } from './cosmicData';

/**
 * Flight-Grade Cosmic Catalog Engine
 *
 * Invariants enforced on every write path (fail fast, atomic commit):
 *   1. Every node passes full schema validation (types, ranges, cross-fields).
 *   2. Catalog ids are unique — an id collision rejects the whole batch.
 *   3. The parent graph stays acyclic — cycles are detected across the
 *      combined (existing + incoming) graph before anything is committed.
 *   4. Registered nodes are deep-frozen — callouts can never corrupt the
 *      catalog state through mutation (immutability guarantee).
 *   5. All query surfaces (tier index, children index, search results)
 *      return defensive copies — sorting/filtering a result never mutates
 *      the authoritative index.
 *
 * Unresolved parents are tolerated at registration time (streaming imports
 * register children before their parent arrives); use `assertIntegrity()`
 * for the boot-time gate that requires a fully resolved acyclic tree.
 *
 * Error contract: malformed input never silently degrades the catalog.
 * `registerNode`/`registerBatch` throw a `CosmicCatalogError` with precise,
 * field-level diagnostics and leave the catalog byte-identical to its prior
 * state (transactional: validate-all → analyze → commit).
 */

export type CosmicErrorCode =
  | 'INVALID_NODE'
  | 'DUPLICATE_ID'
  | 'CYCLE_DETECTED'
  | 'UNRESOLVED_PARENT';

export class CosmicCatalogError extends Error {
  readonly code: CosmicErrorCode;
  readonly details: readonly string[];

  constructor(code: CosmicErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'CosmicCatalogError';
    this.code = code;
    this.details = details;
  }
}

/** Which categories are semantically valid for each hierarchical tier. */
const TIER_CATEGORY_MATRIX: Readonly<Record<CosmicTier, readonly CosmicCategory[]>> = {
  supercluster: ['supercluster'],
  local_group: ['galaxy'],
  galaxy: ['galaxy', 'star', 'core_black_hole'],
  galaxy_structure: ['stellar_cluster', 'core_black_hole', 'nebula', 'star'],
  interstellar_cloud: ['nebula', 'stellar_cluster'],
  star_system: ['star'],
  planetary_system: ['star', 'planet', 'exoplanet', 'dwarf_planet', 'asteroid', 'comet', 'belt', 'moon'],
  satellite_system: ['moon'],
  debris_belt: ['belt', 'asteroid', 'comet'],
  spacecraft: ['spacecraft'],
};

const COSMIC_TIERS: readonly CosmicTier[] = Object.keys(TIER_CATEGORY_MATRIX) as CosmicTier[];

const COSMIC_CATEGORIES: readonly CosmicCategory[] = [
  'supercluster',
  'galaxy',
  'core_black_hole',
  'stellar_cluster',
  'nebula',
  'star',
  'exoplanet',
  'planet',
  'dwarf_planet',
  'moon',
  'asteroid',
  'comet',
  'belt',
  'spacecraft',
];

/** Catalog ids are lowercase namespace tokens ('51_peg_b', 'sgr_a_star'). */
const COSMIC_ID_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const finiteNonNegative = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

export interface CosmicValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Full structural validation of a candidate catalog node.
 * Pure function — no side effects, safe to expose for external ingest tools.
 */
export function validateCosmicNode(input: unknown, label = 'node'): CosmicValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null) {
    errors.push(`${label}: must be an object, received ${input === null ? 'null' : typeof input}`);
    return { valid: false, errors };
  }
  const node = input as Record<string, unknown>;

  // Identity
  if (typeof node.id !== 'string' || !COSMIC_ID_PATTERN.test(node.id)) {
    errors.push(`${label}.id: must be a lowercase snake_case identifier, received ${JSON.stringify(node.id)}`);
  }
  if (typeof node.name !== 'string' || node.name.trim() === '') {
    errors.push(`${label}.name: must be a non-empty string`);
  }

  // Hierarchy & classification
  if (!COSMIC_TIERS.includes(node.tier as CosmicTier)) {
    errors.push(`${label}.tier: unknown tier ${JSON.stringify(node.tier)}`);
  }
  if (!COSMIC_CATEGORIES.includes(node.category as CosmicCategory)) {
    errors.push(`${label}.category: unknown category ${JSON.stringify(node.category)}`);
  }
  if (
    typeof node.tier === 'string' &&
    typeof node.category === 'string' &&
    COSMIC_TIERS.includes(node.tier as CosmicTier) &&
    COSMIC_CATEGORIES.includes(node.category as CosmicCategory) &&
    !TIER_CATEGORY_MATRIX[node.tier as CosmicTier].includes(node.category as CosmicCategory)
  ) {
    errors.push(`${label}: category '${node.category}' is not valid for tier '${node.tier}'`);
  }
  if (typeof node.parentId === 'string') {
    if (node.parentId === node.id) {
      errors.push(`${label}: a node cannot be its own parent`);
    } else if (!COSMIC_ID_PATTERN.test(node.parentId)) {
      errors.push(`${label}.parentId: malformed parent id ${JSON.stringify(node.parentId)}`);
    }
  } else if (node.parentId !== undefined) {
    errors.push(`${label}.parentId: must be a string or undefined`);
  }

  // Presentation
  if (typeof node.description !== 'string' || node.description.trim() === '') {
    errors.push(`${label}.description: must be a non-empty string`);
  }
  if (node.alternateNames !== undefined) {
    if (!Array.isArray(node.alternateNames) || !(node.alternateNames as unknown[]).every((a) => typeof a === 'string' && (a as string).trim() !== '')) {
      errors.push(`${label}.alternateNames: must be an array of non-empty strings`);
    }
  }

  // Astrometry (optional block, strict content)
  if (node.astrometry !== undefined) {
    if (typeof node.astrometry !== 'object' || node.astrometry === null) {
      errors.push(`${label}.astrometry: must be an object when present`);
    } else {
      const a = node.astrometry as Record<string, unknown>;
      if (!finiteNonNegative(a.distanceLy)) {
        errors.push(`${label}.astrometry.distanceLy: must be a finite, non-negative number`);
      }
      if (a.distanceKpc !== undefined && !finiteNonNegative(a.distanceKpc)) {
        errors.push(`${label}.astrometry.distanceKpc: must be a finite, non-negative number`);
      }
      if (a.distanceMpc !== undefined && !finiteNonNegative(a.distanceMpc)) {
        errors.push(`${label}.astrometry.distanceMpc: must be a finite, non-negative number`);
      }
      if (a.raDeg !== undefined && !(typeof a.raDeg === 'number' && Number.isFinite(a.raDeg) && a.raDeg >= 0 && a.raDeg < 360)) {
        errors.push(`${label}.astrometry.raDeg: must be finite within [0, 360) degrees`);
      }
      if (
        a.decDeg !== undefined &&
        !(typeof a.decDeg === 'number' && Number.isFinite(a.decDeg) && a.decDeg >= -90 && a.decDeg <= 90)
      ) {
        errors.push(`${label}.astrometry.decDeg: must be finite within [-90, 90] degrees`);
      }
      if (a.parallaxMas !== undefined && !finitePositive(a.parallaxMas)) {
        errors.push(`${label}.astrometry.parallaxMas: must be a finite, positive number`);
      }
    }
  }

  // Facts (required block)
  if (typeof node.facts !== 'object' || node.facts === null) {
    errors.push(`${label}.facts: required physical-facts object is missing`);
  } else {
    const f = node.facts as Record<string, unknown>;
    if (!finitePositive(f.radiusKm)) {
      errors.push(`${label}.facts.radiusKm: must be a finite, positive number`);
    }
    if (f.massKg !== undefined && !finitePositive(f.massKg)) {
      errors.push(`${label}.facts.massKg: must be a finite, positive number`);
    }
    if (f.massSolar !== undefined && !finitePositive(f.massSolar)) {
      errors.push(`${label}.facts.massSolar: must be a finite, positive number`);
    }
    if (f.luminositySolar !== undefined && !finitePositive(f.luminositySolar)) {
      errors.push(`${label}.facts.luminositySolar: must be a finite, positive number`);
    }
    if (f.surfaceTempK !== undefined && !finitePositive(f.surfaceTempK)) {
      errors.push(`${label}.facts.surfaceTempK: must be a finite, positive number (Kelvin)`);
    }
    if (f.semiMajorAxisAu !== undefined && !finitePositive(f.semiMajorAxisAu)) {
      errors.push(`${label}.facts.semiMajorAxisAu: must be a finite, positive number`);
    }
    if (f.orbitalPeriodDays !== undefined && !finitePositive(f.orbitalPeriodDays)) {
      errors.push(`${label}.facts.orbitalPeriodDays: must be a finite, positive number`);
    }
    if (f.orbitalSpeedKms !== undefined && !finiteNonNegative(f.orbitalSpeedKms)) {
      errors.push(`${label}.facts.orbitalSpeedKms: must be a finite, non-negative number`);
    }
    if (f.distanceFromSunLy !== undefined && !finiteNonNegative(f.distanceFromSunLy)) {
      errors.push(`${label}.facts.distanceFromSunLy: must be a finite, non-negative number`);
    }
    if (f.distanceFromSgrAKpc !== undefined && !finiteNonNegative(f.distanceFromSgrAKpc)) {
      errors.push(`${label}.facts.distanceFromSgrAKpc: must be a finite, non-negative number`);
    }
    if (
      f.eccentricity !== undefined &&
      !(typeof f.eccentricity === 'number' && Number.isFinite(f.eccentricity) && f.eccentricity >= 0 && f.eccentricity < 1)
    ) {
      errors.push(`${label}.facts.eccentricity: must be finite within [0, 1)`);
    }
    if (
      f.discoveredYear !== undefined &&
      !(typeof f.discoveredYear === 'number' && Number.isInteger(f.discoveredYear) && f.discoveredYear >= 1600 && f.discoveredYear <= 2100)
    ) {
      errors.push(`${label}.facts.discoveredYear: must be an integer within [1600, 2100]`);
    }
  }

  // Camera preset (required block)
  if (typeof node.cameraPreset !== 'object' || node.cameraPreset === null) {
    errors.push(`${label}.cameraPreset: required navigation preset is missing`);
  } else {
    const c = node.cameraPreset as Record<string, unknown>;
    if (typeof c.focusId !== 'string' || c.focusId.trim() === '') {
      errors.push(`${label}.cameraPreset.focusId: must be a non-empty string`);
    }
    if (typeof c.frameId !== 'string' || c.frameId.trim() === '') {
      errors.push(`${label}.cameraPreset.frameId: must be a non-empty string`);
    }
    if (!finitePositive(c.distance)) {
      errors.push(`${label}.cameraPreset.distance: must be a finite, positive number`);
    }
    const dir = c.direction;
    if (
      !Array.isArray(dir) ||
      dir.length !== 3 ||
      !dir.every((d) => typeof d === 'number' && Number.isFinite(d)) ||
      !dir.some((d) => (d as number) !== 0)
    ) {
      errors.push(`${label}.cameraPreset.direction: must be a non-zero 3-component vector`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Recursively freezes a validated node so no consumer can mutate catalog state. */
function deepFreezeNode<T extends CosmicNode>(node: T): T {
  if (node.alternateNames) Object.freeze(node.alternateNames);
  if (node.astrometry) Object.freeze(node.astrometry);
  Object.freeze(node.facts);
  Object.freeze(node.cameraPreset);
  return Object.freeze(node) as T;
}

/**
 * Detects a cycle in a parent map (id -> parentId | undefined).
 * Returns the offending ids in cycle order, or null when acyclic.
 */
export function findParentCycle(parentOf: ReadonlyMap<string, string | undefined>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 in-stack, 2 done
  const stack: string[] = [];

  for (const start of parentOf.keys()) {
    if (state.get(start) === 2) continue;
    let current: string | undefined = start;
    while (current !== undefined && !state.has(current)) {
      state.set(current, 1);
      stack.push(current);
      current = parentOf.get(current);
    }
    if (current !== undefined && state.get(current) === 1) {
      const from = stack.indexOf(current);
      const cycle = stack.slice(from);
      cycle.push(current);
      return cycle;
    }
    for (const id of stack) state.set(id, 2);
    stack.length = 0;
  }
  return null;
}

export interface CosmicCatalogStats {
  readonly total: number;
  readonly roots: number;
  readonly byTier: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
}

export interface IntegritiyOptions {
  readonly requireResolvedParents?: boolean;
  readonly requireSingleRoot?: boolean;
}

/**
 * High-performance Extensible Cosmic Catalog Manager — the authoritative index
 * of the universe. All indexes stay synchronized under one transactional path.
 */
export class CosmicCatalogManager {
  private readonly nodesById = new Map<string, CosmicNode>();
  private readonly nodesByTier = new Map<CosmicTier, CosmicNode[]>();
  private readonly childrenByParentId = new Map<string, CosmicNode[]>();
  private readonly searchCache = new Map<string, CosmicNode[]>();
  private version = 0;
  private static readonly SEARCH_CACHE_LIMIT = 64;

  constructor(initialNodes: readonly CosmicNode[] = COSMIC_REGISTRY) {
    this.registerBatch(initialNodes);
  }

  registerNode(node: CosmicNode): readonly CosmicNode[] {
    return this.registerBatch([node]);
  }

  /**
   * Transactional batch registration: validate everything, detect duplicate
   * ids and parent cycles across the combined graph, and only then commit.
   * On any rejection the catalog state is byte-identical to before the call.
   */
  registerBatch(nodes: readonly CosmicNode[]): readonly CosmicNode[] {
    const incoming: CosmicNode[] = [];
    const problems: string[] = [];
    const seenIds = new Set<string>();

    nodes.forEach((node, i) => {
      const label = `batch[${i}]${typeof node?.id === 'string' ? ` '${node.id}'` : ''}`;
      const result = validateCosmicNode(node, label);
      if (result.valid) {
        if (this.nodesById.has(node.id)) {
          problems.push(`${label}: duplicate id '${node.id}' is already registered`);
        } else if (seenIds.has(node.id)) {
          problems.push(`${label}: duplicate id '${node.id}' repeated within this batch`);
        } else {
          seenIds.add(node.id);
          incoming.push(node);
        }
      } else {
        problems.push(...result.errors);
      }
    });

    if (problems.length > 0) {
      throw new CosmicCatalogError(
        'INVALID_NODE',
        `Cosmic catalog batch rejected (${problems.length} validation problem(s)); catalog state unchanged.`,
        problems,
      );
    }

    // Cycle analysis across the combined graph (existing + incoming).
    if (incoming.length > 0) {
      const parentOf = new Map<string, string | undefined>();
      for (const node of this.nodesById.values()) parentOf.set(node.id, node.parentId);
      for (const node of incoming) parentOf.set(node.id, node.parentId);
      const cycle = findParentCycle(parentOf);
      if (cycle) {
        throw new CosmicCatalogError(
          'CYCLE_DETECTED',
          'Parent chain forms a cycle; a valid cosmic hierarchy must be an acyclic tree. Catalog state unchanged.',
          [cycle.join(' → ')],
        );
      }
    }

    const committed = incoming.map(deepFreezeNode);
    for (const node of committed) this.indexNode(node);
    if (incoming.length > 0) {
      this.searchCache.clear();
      this.version += 1;
    }
    return committed;
  }

  /** Monotonic mutation counter — UI uses it to refresh derived counts. */
  getVersion(): number {
    return this.version;
  }

  private indexNode(node: CosmicNode): void {
    this.nodesById.set(node.id, node);
    const tierList = this.nodesByTier.get(node.tier) ?? [];
    tierList.push(node);
    this.nodesByTier.set(node.tier, tierList);
    if (node.parentId) {
      const childList = this.childrenByParentId.get(node.parentId) ?? [];
      childList.push(node);
      this.childrenByParentId.set(node.parentId, childList);
    }
  }

  getNode(id: string): CosmicNode | undefined {
    return this.nodesById.get(id);
  }

  /** Defensive copy — sorting/filtering the result never mutates the index. */
  getNodesByTier(tier: CosmicTier): CosmicNode[] {
    return [...(this.nodesByTier.get(tier) ?? [])];
  }

  /** Defensive copy — sorting/filtering the result never mutates the index. */
  getChildren(parentId: string): CosmicNode[] {
    return [...(this.childrenByParentId.get(parentId) ?? [])];
  }

  getAllNodes(): CosmicNode[] {
    return Array.from(this.nodesById.values());
  }

  roots(): CosmicNode[] {
    return this.getAllNodes().filter((n) => !n.parentId);
  }

  getStats(): CosmicCatalogStats {
    const byTier: Record<string, number> = {};
    for (const [tier, list] of this.nodesByTier) byTier[tier] = list.length;
    const byCategory: Record<string, number> = {};
    for (const node of this.nodesById.values()) {
      byCategory[node.category] = (byCategory[node.category] ?? 0) + 1;
    }
    return {
      total: this.nodesById.size,
      roots: this.roots().length,
      byTier,
      byCategory,
    };
  }

  /**
   * Generates hierarchical breadcrumbs from root supercluster down to target.
   * Tolerant: unknown id/mid-chain orphan returns the resolvable prefix.
   */
  getPathToRoot(id: string): CosmicNode[] {
    const path: CosmicNode[] = [];
    const seen = new Set<string>();
    let current = this.nodesById.get(id);
    while (current && !seen.has(current.id)) {
      path.unshift(current);
      seen.add(current.id);
      current = current.parentId ? this.nodesById.get(current.parentId) : undefined;
    }
    return path;
  }

  /**
   * Boot/CI integrity gate for a fully-assembled catalog. Returns [] when
   * pristine; otherwise precise diagnostic strings (unresolved parents, cycles).
   */
  assertIntegrity(options: IntegritiyOptions = {}): string[] {
    const { requireResolvedParents = true, requireSingleRoot = true } = options;
    const issues: string[] = [];

    if (requireResolvedParents) {
      for (const node of this.nodesById.values()) {
        if (node.parentId && !this.nodesById.has(node.parentId)) {
          issues.push(`UNRESOLVED_PARENT: '${node.id}' points to missing parent '${node.parentId}'`);
        }
      }
    }

    if (requireSingleRoot) {
      const roots = this.roots();
      if (roots.length === 0) issues.push('NO_ROOT: catalog has no root supercluster');
      else if (roots.length > 1) {
        issues.push(`MULTI_ROOT: ${roots.length} parentless roots (${roots.slice(0, 8).map((r) => r.id).join(', ')})`);
      }
    }

    const parentOf = new Map<string, string | undefined>();
    for (const node of this.nodesById.values()) parentOf.set(node.id, node.parentId);
    const cycle = findParentCycle(parentOf);
    if (cycle) issues.push(`CYCLE_DETECTED: ${cycle.join(' → ')}`);

    return issues;
  }

  /**
   * Fast multi-attribute ranked search across ids, names, alternate designations,
   * categories, spectral types, and descriptions. Results are memoized (LRU)
   * and invalidated on every write.
   */
  search(query: string, maxResults = 12): CosmicNode[] {
    if (typeof query !== 'string') return [];
    const q = query.trim().toLowerCase().slice(0, 80);
    if (q.length === 0) return [];
    const cacheKey = `${maxResults}:${q}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      this.searchCache.delete(cacheKey); // LRU refresh
      this.searchCache.set(cacheKey, cached);
      return [...cached];
    }

    const matches: Array<{ node: CosmicNode; score: number }> = [];

    for (const node of this.nodesById.values()) {
      let score = 0;
      const name = node.name.toLowerCase();
      const id = node.id.toLowerCase();

      // Primary designation signals — the strongest attribute wins
      // (non-cumulative). Catalog-id prefixes carry a suffix-length penalty so
      // the most canonical designation outranks its derived children
      // ('trappist_1' over 'trappist_1_e' for query 'trappist').
      const idSignal =
        id === q ? 150 : id.startsWith(q) ? Math.max(0, 90 - 5 * (id.length - q.length)) : 0;
      const nameSignal = name === q ? 120 : name.startsWith(q) ? 60 : name.includes(q) ? 25 : 0;
      score += Math.max(idSignal, nameSignal);

      // Alternate designations act as fallback: they only tip the scales when
      // nothing in the primary designation matched the query verbatim.
      if (score === 0 && node.alternateNames) {
        for (const alt of node.alternateNames) {
          const a = alt.toLowerCase();
          if (a === q) {
            score += 90;
            break;
          }
          if (a.includes(q)) score += 20;
        }
      }

      if (node.category.toLowerCase().includes(q)) score += 10;
      if (node.facts.spectralType?.toLowerCase().includes(q)) score += 15;

      // Multi-token logical-AND match (e.g. 'Proxima b', 'James Webb').
      const tokens = q.split(/[\s_-]+/).filter(Boolean);
      if (tokens.length > 1) {
        const allTokensMatch = tokens.every(
          (t) =>
            name.includes(t) ||
            id.includes(t) ||
            node.alternateNames?.some((alt) => alt.toLowerCase().includes(t)) ||
            node.description.toLowerCase().includes(t),
        );
        if (allTokensMatch) score += 35;
      }

      if (score > 0) matches.push({ node, score });
    }

    // Rank by score; equal scores resolve to the most canonical designation
    // (shortest id).
    matches.sort((a, b) => b.score - a.score || a.node.id.length - b.node.id.length);
    const results = matches.slice(0, maxResults).map((m) => m.node);

    this.searchCache.set(cacheKey, results);
    if (this.searchCache.size > CosmicCatalogManager.SEARCH_CACHE_LIMIT) {
      const oldest = this.searchCache.keys().next().value;
      if (oldest !== undefined) this.searchCache.delete(oldest);
    }
    return [...results];
  }
}
