import { describe, it, expect } from 'vitest';
import {
  AU_KM,
  SPEED_OF_LIGHT_KM_S,
  AU_PER_LIGHT_YEAR,
  LIGHT_YEARS_PER_PARSEC,
  PARSECS_PER_KPC,
  auToKm,
  kmToAu,
  lyToAu,
  auToLy,
  pcToLy,
  lyToPc,
  kpcToLy,
  mpcToLy,
  equatorialToCartesianLy,
  cartesianToEquatorial,
  formatCosmicDistance,
} from '@/universe/cosmicCoordinates';
import {
  cosmicCatalog,
  getCosmicNode,
  getCosmicBreadcrumbs,
  searchCosmicNodes,
  getCosmicNodesByTier,
  getCosmicChildren,
  CosmicCatalogManager,
} from '@/universe/cosmicRegistry';
import type { CosmicNode } from '@/universe/cosmicHierarchy';

describe('Cosmic Coordinates & IAU Constants', () => {
  it('adheres to exact IAU 2012 / IAU 2015 constants', () => {
    expect(AU_KM).toBe(149597870.7);
    expect(SPEED_OF_LIGHT_KM_S).toBe(299792.458);
    expect(LIGHT_YEARS_PER_PARSEC).toBeCloseTo(3.26156, 3);
    expect(PARSECS_PER_KPC).toBe(1000);
  });

  it('performs lossless bidirectional conversions between km and AU', () => {
    const testAu = 5.2044; // Jupiter semi-major axis
    const km = auToKm(testAu);
    expect(km).toBeCloseTo(testAu * 149597870.7, 1);
    expect(kmToAu(km)).toBeCloseTo(testAu, 8);
  });

  it('performs accurate conversions between AU and light-years', () => {
    const oneLyInAu = lyToAu(1);
    expect(oneLyInAu).toBeCloseTo(AU_PER_LIGHT_YEAR, 2);
    expect(auToLy(oneLyInAu)).toBeCloseTo(1, 8);
  });

  it('converts parsecs, kpc, and Mpc to light-years correctly', () => {
    expect(pcToLy(1)).toBeCloseTo(LIGHT_YEARS_PER_PARSEC, 4);
    expect(lyToPc(pcToLy(1))).toBeCloseTo(1, 8);
    expect(kpcToLy(8.2)).toBeCloseTo(8.2 * 1000 * LIGHT_YEARS_PER_PARSEC, 1);
    expect(mpcToLy(2.54)).toBeCloseTo(2.54 * 1e6 * LIGHT_YEARS_PER_PARSEC, 0);
  });

  it('performs spherical equatorial (RA, Dec, dist) to Cartesian (X, Y, Z) and back', () => {
    // Test star: Sirius (RA ~ 101.287°, Dec ~ -16.716°, distance ~ 8.611 ly)
    const ra = 101.287;
    const dec = -16.716;
    const dist = 8.611;

    const cart = equatorialToCartesianLy(ra, dec, dist);
    expect(cart.distLy).toBeCloseTo(dist, 4);
    expect(Math.hypot(cart.x, cart.y, cart.z)).toBeCloseTo(dist, 4);

    const roundtrip = cartesianToEquatorial(cart.x, cart.y, cart.z);
    expect(roundtrip.raDeg).toBeCloseTo(ra, 4);
    expect(roundtrip.decDeg).toBeCloseTo(dec, 4);
    expect(roundtrip.distanceLy).toBeCloseTo(dist, 4);
  });

  it('formats cosmic distances across multiple orders of magnitude', () => {
    expect(formatCosmicDistance(0)).toContain('0 AU');
    // Earth distance in ly: 1 AU / AU_PER_LIGHT_YEAR
    const earthDistLy = 1 / AU_PER_LIGHT_YEAR;
    expect(formatCosmicDistance(earthDistLy)).toContain('1.00 AU');

    // Nearby star Alpha Centauri ~ 4.2465 ly
    const alphaCentauriStr = formatCosmicDistance(4.2465);
    expect(alphaCentauriStr).toContain('light-years');
    expect(alphaCentauriStr).toContain('pc');

    // Galactic distance (Milky Way center ~ 26,700 ly / 8.2 kpc)
    const mwCenterStr = formatCosmicDistance(26700);
    expect(mwCenterStr).toContain('thousand ly');
    expect(mwCenterStr).toContain('kpc');

    // Extragalactic distance (Andromeda ~ 2.54 million ly)
    const andromedaStr = formatCosmicDistance(2_540_000);
    expect(andromedaStr).toContain('million ly');
    expect(andromedaStr).toContain('Mpc');
  });
});

describe('Master Cosmic Catalog Registry Engine', () => {
  it('initializes with comprehensive NASA tiers from supercluster to spacecraft', () => {
    const all = cosmicCatalog.getAllNodes();
    expect(all.length).toBeGreaterThanOrEqual(30);

    const superclusters = getCosmicNodesByTier('supercluster');
    expect(superclusters.map((n) => n.id)).toContain('laniakea');
    expect(superclusters.map((n) => n.id)).toContain('virgo_supercluster');

    const galaxies = getCosmicNodesByTier('galaxy');
    expect(galaxies.map((n) => n.id)).toContain('milky_way');

    const starSystems = getCosmicNodesByTier('star_system');
    expect(starSystems.map((n) => n.id)).toContain('trappist_1');
    expect(starSystems.map((n) => n.id)).toContain('alpha_centauri');
    expect(starSystems.map((n) => n.id)).toContain('sirius');

    const spacecraft = getCosmicNodesByTier('spacecraft');
    expect(spacecraft.map((n) => n.id)).toContain('voyager_1');
    expect(spacecraft.map((n) => n.id)).toContain('jwst');
  });

  it('builds full breadcrumb path from spacecraft/moon to root supercluster', () => {
    // Moon -> Earth -> Solar System -> Orion Spur -> Milky Way -> Virgo -> Laniakea
    const moonCrumbs = getCosmicBreadcrumbs('moon');
    const crumbIds = moonCrumbs.map((c) => c.id);

    expect(crumbIds).toEqual([
      'laniakea',
      'virgo_supercluster',
      'milky_way',
      'solar_system',
      'earth',
      'moon',
    ]);
  });

  it('builds full breadcrumb path from exoplanet system to root', () => {
    const trappistCrumbs = getCosmicBreadcrumbs('trappist_1');
    const crumbIds = trappistCrumbs.map((c) => c.id);

    expect(crumbIds).toEqual([
      'laniakea',
      'virgo_supercluster',
      'milky_way',
      'trappist_1',
    ]);
  });

  it('supports children traversal down the cosmic tree', () => {
    const solarChildren = getCosmicChildren('solar_system');
    const childIds = solarChildren.map((c) => c.id);
    expect(childIds).toContain('sun');
    expect(childIds).toContain('earth');
    expect(childIds).toContain('jupiter');
    expect(childIds).toContain('asteroid_belt');
    expect(childIds).toContain('oort_cloud');

    const earthChildren = getCosmicChildren('earth');
    const earthChildIds = earthChildren.map((c) => c.id);
    expect(earthChildIds).toContain('moon');
    expect(earthChildIds).toContain('jwst');
  });

  it('performs intelligent fuzzy-ranked search across names, alternate designations, and descriptors', () => {
    // Search by name
    const andromedaResults = searchCosmicNodes('Andromeda');
    expect(andromedaResults.length).toBeGreaterThan(0);
    expect(andromedaResults[0]!.id).toBe('andromeda');

    // Search by alternate name / designation
    const m31Results = searchCosmicNodes('Messier 31');
    expect(m31Results[0]!.id).toBe('andromeda');

    const jwstResults = searchCosmicNodes('Webb');
    expect(jwstResults[0]!.id).toBe('jwst');

    // Search exoplanet host
    const trappistResults = searchCosmicNodes('trappist');
    expect(trappistResults[0]!.id).toBe('trappist_1');

    // Search red supergiant
    const betelgeuseResults = searchCosmicNodes('Betelgeuse');
    expect(betelgeuseResults[0]!.id).toBe('betelgeuse');
  });

  it('allows dynamic registration of new galaxies, stars, and exoplanets for future upgrades', () => {
    const customManager = new CosmicCatalogManager([
      getCosmicNode('milky_way')!,
      getCosmicNode('orion_spur')!,
    ]);

    const proximaB: CosmicNode = {
      id: 'proxima_centauri_b',
      name: 'Proxima Centauri b',
      tier: 'planetary_system',
      parentId: 'orion_spur',
      category: 'exoplanet',
      description: 'Potentially habitable exoplanet orbiting the red dwarf Proxima Centauri at 4.244 light-years.',
      astrometry: {
        distanceLy: 4.244,
      },
      facts: {
        radiusKm: 6800,
        massKg: 7.16e24,
        semiMajorAxisAu: 0.0485,
        orbitalPeriodDays: 11.186,
      },
      cameraPreset: {
        focusId: 'sun',
        frameId: 'body:sun',
        distance: 200,
        direction: [-0.4, -0.85, 0.35],
      },
    };

    customManager.registerNode(proximaB);

    expect(customManager.getNode('proxima_centauri_b')).toBeDefined();
    expect(customManager.getChildren('orion_spur').map((c) => c.id)).toContain('proxima_centauri_b');

    const searchMatch = customManager.search('Proxima b');
    expect(searchMatch.length).toBe(1);
    expect(searchMatch[0]!.id).toBe('proxima_centauri_b');

    const crumbs = customManager.getPathToRoot('proxima_centauri_b');
    expect(crumbs.map((c) => c.id)).toEqual(['milky_way', 'orion_spur', 'proxima_centauri_b']);
  });
});
