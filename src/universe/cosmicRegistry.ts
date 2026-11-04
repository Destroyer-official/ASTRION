import type { CosmicNode, CosmicTier } from './cosmicHierarchy';
import { CosmicCatalogError, CosmicCatalogManager } from './cosmicCatalogEngine';
import { COSMIC_REGISTRY } from './cosmicData';

/**
 * Universal Cosmic Registry — Public API Facade
 *
 * Re-exports the shipped dataset, the hardened catalog engine, and the global
 * singleton with a boot-time integrity gate: import fails fast (at module load)
 * if the shipped dataset violates any backbone invariant — invalid node,
 * unresolved parent, or cycle. The only sanctioned surface is this barrel;
 * external code must not import cosmicData/cosmicCatalogEngine directly.
 */

export type { CosmicCategory, CosmicNode, CosmicTier } from './cosmicHierarchy';
export { COSMIC_REGISTRY } from './cosmicData';
export {
  CosmicCatalogManager,
  CosmicCatalogError,
  validateCosmicNode,
} from './cosmicCatalogEngine';
export type {
  CosmicErrorCode,
  CosmicValidationResult,
  IntegritiyOptions,
  CosmicCatalogStats,
} from './cosmicCatalogEngine';

// Global singleton index of the universe (validated + frozen + integrity-gated).
export const cosmicCatalog = new CosmicCatalogManager(COSMIC_REGISTRY);

const BOOT_INTEGRITY: readonly string[] = cosmicCatalog.assertIntegrity();
if (BOOT_INTEGRITY.length > 0) {
  // Fail fast at import time — a corrupted catalog must never reach the UI.
  throw new CosmicCatalogError(
    'UNRESOLVED_PARENT',
    'Shipped cosmic registry failed boot-time integrity assertions. Refusing to start.',
    BOOT_INTEGRITY,
  );
}

/** Monotonic registry mutation counter — UI refreshes derived counts on change. */
export function getCosmicRegistryVersion(): number {
  return cosmicCatalog.getVersion();
}

// Backward-compatible query exports.
export function getCosmicNode(id: string): CosmicNode | undefined {
  return cosmicCatalog.getNode(id);
}

export function getCosmicNodesByTier(tier: CosmicTier): CosmicNode[] {
  return cosmicCatalog.getNodesByTier(tier);
}

export function getCosmicChildren(parentId: string): CosmicNode[] {
  return cosmicCatalog.getChildren(parentId);
}

export function searchCosmicNodes(query: string): CosmicNode[] {
  return cosmicCatalog.search(query);
}

export function getCosmicBreadcrumbs(id: string): CosmicNode[] {
  return cosmicCatalog.getPathToRoot(id);
}
