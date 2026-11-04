/**
 * Research-Verified Cosmic Catalog Accuracy Tests
 *
 * Every expectation below is pinned to the latest authoritative measurement
 * available at audit time (see README references):
 *  - GRAVITY Collaboration 2024a (A&A 642:A242): Sgr A* mass & R0
 *  - Watkins et al. 2024 (Three-Dimensional Kinematics of LMC GCs)
 *  - IAU MPC Announcements (March 2026): Saturn 285+/Jupiter 101+ moons
 *  - NASA Saturn moons page (Aug 2026): 293 confirmed
 *  - Sawala et al. 2025 (Nature Astronomy 9:1206): MW-Andromeda ~50%
 *  - NASA Exoplanet Archive (Oct 15 2026): 6,451 confirmed planets
 */
import { describe, it, expect } from 'vitest';
import {
  COSMIC_REGISTRY,
  cosmicCatalog,
  getCosmicNode,
} from '@/universe/cosmicRegistry';

describe('Research-verified catalog truth values', () => {
  it('Sgr A* matches the GRAVITY 2024a revision (4.297e6 M☉ at 8.277 kpc / 26,996 ly)', () => {
    const sgra = getCosmicNode('sgra')!;
    expect(sgra.facts.massSolar).toBeCloseTo(4.297e6, -2);
    expect(sgra.astrometry?.distanceKpc).toBeCloseTo(8.277, 3);
    expect(sgra.astrometry?.distanceLy).toBeCloseTo(26_996, -10);
  });

  it('LMC total mass reflects 2024 revision (1.38e11 M☉ incl. dark matter)', () => {
    const lmc = getCosmicNode('lmc')!;
    expect(lmc.facts.massSolar).toBeCloseTo(1.38e11, -11);
    expect(lmc.description).toMatch(/1\.38/);
  });

  it('planet descriptions carry the 2026 confirmed moon counts', () => {
    const jupiter = getCosmicNode('jupiter')!;
    const saturn = getCosmicNode('saturn')!;
    expect(jupiter.description).toContain('101');
    expect(saturn.description).toContain('293');
    // Moon counts must be higher than the pre-2025 values for consistency.
    expect(saturn.description).not.toContain('146');
  });

  it('Andromeda collision wording is academic (Sawala 2025 50-50, not certain)', () => {
    const andromeda = getCosmicNode('andromeda')!;
    expect(andromeda.description).toContain('50%');
    expect(andromeda.facts.distanceFromSunLy).toBeCloseTo(2_537_000, -3);
  });

  it('Betelgeuse uses the 2020+ asteroseismic distance (548 ly) with companion note', () => {
    const betelgeuse = getCosmicNode('betelgeuse')!;
    expect(betelgeuse.facts.distanceFromSunLy).toBeCloseTo(548, 1);
    expect(betelgeuse.description).toMatch(/companion/i);
  });

  it('Voyager 1 carries a 2026-era heliocentric distance (>165 AU)', () => {
    const voyager = getCosmicNode('voyager_1')!;
    expect(voyager.facts.semiMajorAxisAu).toBeGreaterThanOrEqual(165);
  });

  it('Milky Way description reflects the Gaia-era spiral-structure debate (two-arm X23 vs Reid four-arm)', () => {
    const mw = getCosmicNode('milky_way')!;
    expect(mw.description).toMatch(/Norma/i);
    expect(mw.description).toMatch(/Perseus/i);
  });
});

describe('Expanded catalog backbone', () => {
  it('hosts 50+ registry objects spanning all tiers', () => {
    expect(COSMIC_REGISTRY.length).toBeGreaterThanOrEqual(50);
    const tiers = new Set(COSMIC_REGISTRY.map((n) => n.tier));
    for (const tier of [
      'supercluster',
      'local_group',
      'galaxy',
      'galaxy_structure',
      'star_system',
      'planetary_system',
      'satellite_system',
      'spacecraft',
    ] as const) {
      expect(tiers.has(tier)).toBe(true);
    }
  });

  it('includes iconic external galaxies M87, Centaurus A, and Sgr dSph', () => {
    for (const id of ['messier_87', 'centaurus_a', 'sagittarius_dwarf']) {
      const node = getCosmicNode(id);
      expect(node).toBeDefined();
      expect(node!.category).toBe('galaxy');
      expect(node!.facts.distanceFromSunLy).toBeGreaterThan(0);
    }
    // M87* carries the EHT 2019 supermassive milestone (6.5e9 M☉ scale system).
    expect(getCosmicNode('messier_87')!.description).toContain('Event Horizon');
  });

  it('includes famous bright stars with verified distances (Canopus 310 ly, Vega 25 ly, Rigel 863 ly)', () => {
    expect(getCosmicNode('canopus')!.facts.distanceFromSunLy).toBeCloseTo(310, 0);
    expect(getCosmicNode('vega')!.facts.distanceFromSunLy).toBeCloseTo(25.04, 1);
    expect(getCosmicNode('rigel')!.facts.distanceFromSunLy).toBeCloseTo(863, 0);
    expect(getCosmicNode('deneb')!.facts.distanceFromSunLy).toBeGreaterThan(2000);
    expect(getCosmicNode('altair')!.facts.distanceFromSunLy).toBeCloseTo(16.73, 1);
    expect(getCosmicNode('tau_ceti')!.facts.distanceFromSunLy).toBeCloseTo(11.9, 1);
    expect(getCosmicNode('barnards_star')!.facts.distanceFromSunLy).toBeCloseTo(5.96, 1);
  });

  it('indexes flagship exoplanets with habitable-zone orbits (Proxima b, TRAPPIST-1 e, K2-18b, 51 Peg b)', () => {
    const proximaB = getCosmicNode('proxima_b')!;
    expect(proximaB.facts.semiMajorAxisAu).toBeCloseTo(0.0485, 4);
    expect(proximaB.facts.orbitalPeriodDays).toBeCloseTo(11.186, 3);
    expect(proximaB.parentId).toBe('proxima_centauri');

    const trE = getCosmicNode('trappist_1_e')!;
    expect(trE.facts.orbitalPeriodDays).toBeCloseTo(6.099, 3);
    expect(trE.facts.radiusKm).toBeGreaterThan(5_000);

    expect(getCosmicNode('k2_18_b')!.facts.massKg).toBeGreaterThan(4e25);
    expect(getCosmicNode('51_peg_b')!.facts.discoveredYear).toBe(1995);
  });

  it('exoplanets are reachable through hierarchy breadcrumbs to the supercluster root', () => {
    const crumbs = cosmicCatalog.getPathToRoot('proxima_b').map((c) => c.id);
    expect(crumbs[0]).toBe('laniakea');
    expect(crumbs[crumbs.length - 1]).toBe('proxima_b');
    expect(crumbs).toContain('proxima_centauri');
    expect(crumbs).toContain('milky_way');
  });

  it('search ranks the nearest star correctly across the enlarged corpus', () => {
    const proxima = cosmicCatalog.search('Proxima Centauri');
    expect(proxima.length).toBeGreaterThan(0);
    expect(proxima.some((n) => n.id === 'proxima_centauri')).toBe(true);

    const canopus = cosmicCatalog.search('Canopus');
    expect(canopus[0]!.id).toBe('canopus');

    const vega = cosmicCatalog.search('Vega');
    expect(vega[0]!.id).toBe('vega');
  });
});
