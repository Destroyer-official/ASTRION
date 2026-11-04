# Universal Cosmic Catalog — API Contract

The backbone of every non-Solar-System object in the simulator: superclusters,
galaxies, star systems, exoplanets, spacecraft and the navigation layer built
on top of them. This document is the authoritative contract for consumers
(`ui/panel.ts`, scripts, external tools).

## Module layout

```
src/universe/
├── cosmicHierarchy.ts       # Type system: CosmicNode, CosmicTier, CosmicCategory
├── cosmicData.ts            # Pure data: shipped dataset (frozen at module boundary)
├── cosmicCatalogEngine.ts   # Hardened engine: validation, transaction, indexes, search
└── cosmicRegistry.ts        # Public API facade — THE ONLY sanctioned import surface
└── (boot-time integrity gate lives at the bottom of the facade)
```

External code imports from `@/universe/cosmicRegistry` exclusively. The facade
re-exports everything needed and runs `assertIntegrity()` at import time — a
corrupted dataset fails the load with a precise `CosmicCatalogError` instead of
rendering subtly-wrong facts in the UI.

## Engine invariants (enforced on every write)

| # | Invariant | Enforcement |
|---|---|---|
| 1 | Full schema validation | `validateCosmicNode`: types, ranges, cross-field tier/category matrix |
| 2 | Unique catalog ids | duplicate in batch or against index → reject whole call |
| 3 | Acyclic parent graph | DFS cycle detection over the combined index + batch graph → reject |
| 4 | Immutability | registered nodes deep-frozen; `facts`/`preset`/`alternateNames` unmodifiable |
| 5 | Defensive query copies | tier/children/search results never alias internal indexes |
| 6 | Transactional writes | validate-all → analyze → commit; failure leaves state byte-identical |

Registration order is forgiving (streaming): a child may be registered before
its parent arrives — breadcrumbs simply truncate at the resolvable prefix until
the parent appears. A fully-assembled dataset must additionally pass
`assertIntegrity()`: no unresolved parents, exactly one root, no cycles.

## Error contract

```ts
class CosmicCatalogError extends Error {
  code: 'INVALID_NODE' | 'DUPLICATE_ID' | 'CYCLE_DETECTED' | 'UNRESOLVED_PARENT';
  details: readonly string[];   // field-level diagnostics, one per problem
}
```

Malformed input never silently degrades state: `registerNode` /
`registerBatch` throw (never `return`s a half-commit, never `undefined`).

## Core API

```ts
// Reads (all defensive copies)
cosmicCatalog.getNode(id): CosmicNode | undefined
cosmicCatalog.getChildren(parentId): CosmicNode[]
cosmicCatalog.getNodesByTier(tier): CosmicNode[]
cosmicCatalog.getAllNodes(): CosmicNode[]
cosmicCatalog.roots(): CosmicNode[]
cosmicCatalog.getPathToRoot(id): CosmicNode[]
cosmicCatalog.getStats(): CosmicCatalogStats
cosmicCatalog.getVersion(): number          // monotonic write counter
cosmicCatalog.assertIntegrity(mR?): string[]

// Writes (transactional, frozen on commit)
cosmicCatalog.registerNode(node): readonly CosmicNode[]
cosmicCatalog.registerBatch(nodes): readonly CosmicNode[]

// Search (memoized LRU-64, invalidated on writes; ranking documented inline)
cosmicCatalog.search(query, maxResults = 12): CosmicNode[]
```

Convenience handles in the facade: `getCosmicNode`, `getCosmicChildren`,
`getCosmicNodesByTier`, `searchCosmicNodes`, `getCosmicBreadcrumbs`,
`COSMIC_REGISTRY` (frozen shipped dataset), `cosmicCatalog` (gated singleton),
`validateCosmicNode` (pure schema validator for external ingest tools), and
`getCosmicRegistryVersion()`.

## Search ranking model

1. **Primary designation** — strongest single signal (non-cumulative):
   exact id match (`+150`), exact name (`+120`), id-prefix
   (`+90 − 5·suffix length` so `trappist_1` outranks `trappist_1_e`),
   name-prefix (`+60`), substring (`+25`).
2. **Alternate designations** — fallback only (they cannot stack onto a
   primary match): exact alternate `+90`, substring `+20`.
3. **Attribute chips** — category `+10`, spectral type `+15`.
4. **Multi-token AND** — "Proxima b" must satisfy each token somewhere
   in name/id/alternates/description: `+35`.
5. Ties resolve to the most canonical designation (shortest id).
Queries are trimmed, lowercased, and hard-capped at 80 characters.

## Adding a new object (the "backbone" path)

1. Append a `CosmicNode` literal to `COSMIC_REGISTRY` in `cosmicData.ts`
   (tier, category via the matrix, complete `facts`, `astrometry`, and a
   `cameraPreset` navigable by `NODE_TO_PRESET` in `ui/panel.ts`).
2. Run `npm run verify` — the boot gate validates the whole dataset at import;
   the contract suite (`tests/catalogEngine.test.ts`) pins every invariant.
3. For habitable-zone/exoplanet entries, also extend
   `tests/catalogAccuracy.test.ts` with the source-verified values so a bad
   edit re-verts the test, not the science.

## Testing

- `tests/catalogEngine.test.ts` — 22 contract tests (validation matrix,
  transaction atomicity, cycles, freezing, copies, streaming, gates, search).
- `tests/catalogAccuracy.test.ts` — research-pinned truth values (GRAVITY 2024a,
  Watkins 2024, Sawala 2025, IAU MPC 2026 moon counts, NASA Exoplanet Archive).
- `tests/cosmicHierarchy.test.ts` / `tests/cosmicEngine.test.ts` —
  hierarchy/search regression coverage from the original engine.
