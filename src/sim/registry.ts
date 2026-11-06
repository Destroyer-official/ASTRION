import type { BodyJson, PhysicalJson } from '@/data/schema';
import { JD_J2000, gmToInternal } from '@/data/constants';
import type { BodyDef, SystemState, Vec3 } from '@/physics/types';
import { perihelionState } from '@/physics/orbit';
import { createState, recenterToBarycenter } from '@/physics/system';
export { buildModel, buildSolver, decomposeGlobal, type ModelData, type SolverData } from './model';

const bodyFiles = import.meta.glob<BodyJson>('/src/data/bodies/*.json', {
  eager: true,
  import: 'default',
});

const moonFiles = import.meta.glob<BodyJson>('/src/data/moons/*.json', {
  eager: true,
  import: 'default',
});

const dwarfFiles = import.meta.glob<BodyJson>('/src/data/dwarf-planets/*.json', {
  eager: true,
  import: 'default',
});

const asteroidFiles = import.meta.glob<BodyJson>('/src/data/asteroids/*.json', {
  eager: true,
  import: 'default',
});

export const PLANET_BODIES: BodyJson[] = Object.values(bodyFiles);
export const MOON_BODIES: BodyJson[] = Object.values(moonFiles);
export const DWARF_BODIES: BodyJson[] = Object.values(dwarfFiles);
export const ASTEROID_BODIES: BodyJson[] = Object.values(asteroidFiles);
// All 16 JPL SB441-N16 / ASSIST massive-asteroid perturbers ride along in production
// N-body. Measured effects live in docs/VALIDATION_LOG.md, not in this comment.
export const ALL_BODIES: BodyJson[] = [...PLANET_BODIES, ...DWARF_BODIES, ...MOON_BODIES, ...ASTEROID_BODIES];

const physicalFiles = import.meta.glob<PhysicalJson>('/src/data/physical/*.json', {
  eager: true,
  import: 'default',
});

const physicalById = new Map<string, PhysicalJson>();
for (const [path, data] of Object.entries(physicalFiles)) {
  const match = path.match(/\/([^/]+)\.json$/);
  if (match) physicalById.set(match[1]!, data);
}

export const PHYSICAL_MAP: Record<string, PhysicalJson> = Object.fromEntries(physicalById);

export interface SystemModel {
  ids: string[];
  names: string[];
  radiusKm: number[];
  colors: string[];
  epochJd: number; // JD (TDB) at which state.t = 0
  state: SystemState; // internal units, barycentric
  physical: PhysicalJson[];
  physicalMap: Record<string, PhysicalJson>;
  bodies?: readonly BodyJson[];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];

export function buildDefs(list: readonly BodyJson[]): BodyDef[] {
  const byId = new Map<string, BodyJson>();
  for (const b of list) {
    if (byId.has(b.id)) throw new Error(`Duplicate body id "${b.id}"`);
    byId.set(b.id, b);
  }
  const done = new Map<string, BodyDef>();

  const build = (b: BodyJson, stack: string[]): BodyDef => {
    const cached = done.get(b.id);
    if (cached) return cached;
    if (stack.includes(b.id)) throw new Error(`Parent cycle: ${[...stack, b.id].join(' > ')}`);

    const gm = gmToInternal(b.gmKm3S2);
    const base = { id: b.id, name: b.name, gm, radiusKm: b.radiusKm };
    let def: BodyDef;
    switch (b.initial.type) {
      case 'root':
        def = { ...base, position: [0, 0, 0], velocity: [0, 0, 0] };
        break;
      case 'vectors': {
        const init = b.initial;
        if (init.about === 'parent' && b.parent) {
          const parentDef = build(byId.get(b.parent)!, [...stack, b.id]);
          def = {
            ...base,
            parent: b.parent,
            position: add(parentDef.position, init.position),
            velocity: add(parentDef.velocity, init.velocity),
          };
        } else {
          def = { ...base, position: init.position, velocity: init.velocity };
        }
        break;
      }
      case 'elements': {
        const init = b.initial;
        const pj = byId.get(init.parent);
        if (!pj) throw new Error(`${b.id}: unknown parent "${init.parent}"`);
        const parent = build(pj, [...stack, b.id]);
        const rel = perihelionState(
          parent.gm + gm,
          init.aAu,
          init.e,
          (init.incDeg * Math.PI) / 180,
        );
        def = {
          ...base,
          parent: init.parent,
          position: add(parent.position, rel.pos),
          velocity: add(parent.velocity, rel.vel),
        };
        break;
      }
    }
    done.set(b.id, def);
    return def;
  };

  return list.map((b) => build(b, [])).sort((a, b) => b.gm - a.gm); // heaviest (Sun) first
}

export function loadSystem(list: readonly BodyJson[] = PLANET_BODIES): SystemModel {
  const epochs = new Set<number>();
  for (const b of list) if (b.initial.type === 'vectors') epochs.add(b.initial.epochJd);
  if (epochs.size > 1) throw new Error(`Bodies have different epochs: ${[...epochs].join(', ')}`);

  const defs = buildDefs(list);
  const meta = new Map(list.map((b) => [b.id, b]));
  const state = createState(defs);
  // Real Horizons vectors are already in the true SSB frame (which includes Pluto and
  // asteroids missing from this system, ~3e-7 AU ≈ 45 km of offset): do not shift them.
  if (epochs.size === 0) recenterToBarycenter(state);

  return {
    ids: defs.map((d) => d.id),
    names: defs.map((d) => d.name),
    radiusKm: defs.map((d) => d.radiusKm),
    colors: defs.map((d) => meta.get(d.id)!.color),
    epochJd: epochs.size ? [...epochs][0]! : JD_J2000,
    state,
    physical: defs.map((d) => physicalById.get(d.id) ?? {}),
    physicalMap: Object.fromEntries(physicalById),
    bodies: defs.map((d) => meta.get(d.id)!),
  };
}
