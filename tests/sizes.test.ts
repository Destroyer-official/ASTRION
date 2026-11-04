import { describe, it, expect } from 'vitest';
import { loadSystem, ALL_BODIES, ASTEROID_BODIES } from '@/sim/registry';
import { computeBodyFacts } from '@/sim/facts';
import { BodyVisual } from '@/render/bodyVisual';

describe('Celestial Bodies Size & Radii Accuracy (NASA NAIF PCK & IAU WGCCRE)', () => {
  const model = loadSystem(ALL_BODIES);

  it('all 36 bodies have positive, finite radii in kilometers', () => {
    expect(ALL_BODIES.length).toBe(36);
    for (const b of ALL_BODIES) {
      expect(b.radiusKm, `${b.id} radius`).toBeGreaterThan(0);
      expect(Number.isFinite(b.radiusKm)).toBe(true);
    }
  });

  it('all 36 bodies have registered physical properties and facts in physicalMap', () => {
    for (const b of ALL_BODIES) {
      const phys = model.physicalMap[b.id];
      expect(phys, `${b.id} has physical data`).toBeDefined();
      expect(phys?.facts, `${b.id} has facts`).toBeDefined();
      expect(phys?.rotation, `${b.id} has rotation`).toBeDefined();
    }
  });

  it('all 8 major planets + Sun match official NASA / IAU equatorial radii', () => {
    const expectedRadii: Record<string, number> = {
      sun: 695700, // IAU 2015 Resolution B3 standard nominal solar radius
      mercury: 2440.53, // NASA MESSENGER topographic / global radius (pck00011.tpc)
      venus: 6051.8, // NASA Magellan / IAU (pck00010.tpc / pck00011.tpc)
      earth: 6378.137, // IUGG / WGS84 / IAU 2015 (pck00010.tpc)
      mars: 3396.2, // NASA MRO / IAU (pck00010.tpc)
      jupiter: 71492, // NASA Juno / IAU (pck00010.tpc)
      saturn: 60268, // NASA Cassini / IAU (pck00010.tpc)
      uranus: 25559, // NASA Voyager 2 / IAU (pck00010.tpc)
      neptune: 24764, // NASA Voyager 2 / IAU (pck00010.tpc)
    };

    for (const [id, expectedR] of Object.entries(expectedRadii)) {
      const b = ALL_BODIES.find((x) => x.id === id);
      expect(b, `body ${id} found`).toBeDefined();
      expect(b!.radiusKm, `${id} equatorial radius`).toBeCloseTo(expectedR, 1);
    }
  });

  it('Pluto, Charon, and all 22 moons match NASA NAIF SPICE measurements', () => {
    const targets: Record<string, number> = {
      pluto: 1188.3, // NASA New Horizons (Stern et al. 2015)
      charon: 606.0, // NASA New Horizons (pck00011.tpc)
      moon: 1737.4, // NASA LRO / pck00011.tpc
      phobos: 11.27, // NASA Mars Express / MOLA
      deimos: 6.2, // NASA Mars Express
      io: 1821.6, // NASA Galileo
      europa: 1560.8, // NASA Galileo
      ganymede: 2634.1, // NASA Galileo (largest moon in Solar System)
      callisto: 2410.3, // NASA Galileo
      mimas: 198.2, // NASA Cassini
      enceladus: 252.1, // NASA Cassini
      tethys: 531.1, // NASA Cassini
      dione: 561.4, // NASA Cassini
      rhea: 763.8, // NASA Cassini
      titan: 2574.7, // NASA Cassini
      hyperion: 135.0, // NASA Cassini
      iapetus: 734.5, // NASA Cassini
      miranda: 235.8, // NASA Voyager 2
      ariel: 578.9, // NASA Voyager 2
      umbriel: 584.7, // NASA Voyager 2
      titania: 788.4, // NASA Voyager 2
      oberon: 761.4, // NASA Voyager 2
      triton: 1353.4, // NASA Voyager 2
    };

    for (const [id, expectedR] of Object.entries(targets)) {
      const b = ALL_BODIES.find((x) => x.id === id);
      expect(b, `body ${id} found`).toBeDefined();
      expect(b!.radiusKm, `${id} radius`).toBeCloseTo(expectedR, 1);
    }
  });

  it('main-belt asteroids match NASA Dawn mission and VLT SPHERE measurements', () => {
    const asteroids: Record<string, { a: number; f: number; vol: number }> = {
      ceres: { a: 482.6, f: 0.07667, vol: 469.7 }, // NASA Dawn (Park et al. 2016)
      vesta: { a: 286.3, f: 0.2204, vol: 262.7 }, // NASA Dawn (Russell et al. 2012)
      pallas: { a: 275.0, f: 0.1345, vol: 262.0 }, // VLT SPHERE (Marsset et al. 2020)
      hygiea: { a: 225.0, f: 0.0578, vol: 220.6 }, // VLT SPHERE (Vernazza et al. 2019)
    };

    for (const [id, spec] of Object.entries(asteroids)) {
      const b = ASTEROID_BODIES.find((x) => x.id === id);
      expect(b, `asteroid ${id} found`).toBeDefined();
      expect(b!.radiusKm, `${id} equatorial radius`).toBeCloseTo(spec.a, 1);

      const phys = model.physicalMap[id];
      expect(phys, `${id} physical data exists`).toBeDefined();
      expect(phys!.flattening, `${id} flattening`).toBeCloseTo(spec.f, 3);

      const facts = computeBodyFacts(id, model.state, model);
      expect(facts, `${id} facts computed`).not.toBeNull();
      expect(Math.abs(facts!.volumetricRadiusKm - spec.vol), `${id} volumetric radius within 1.5 km`).toBeLessThan(1.5);
    }
  });

  it('rotational oblateness and flattening match NASA PCK for oblate bodies', () => {
    const expectedFlattening: Record<string, number> = {
      saturn: 0.09796, // Most oblate planet (~10% flattening)
      jupiter: 0.06487, // ~6.5% flattening
      uranus: 0.02293, // ~2.3% flattening
      neptune: 0.01708, // ~1.7% flattening
      earth: 0.00335, // 1/298.257 (~0.335% flattening)
      mars: 0.00589, // ~0.59% flattening
      ceres: 0.07667, // NASA Dawn oblate dwarf planet
      vesta: 0.2204, // NASA Dawn highly oblate asteroid
    };

    for (const [id, expectedF] of Object.entries(expectedFlattening)) {
      const phys = model.physicalMap[id];
      expect(phys, `${id} physical data exists`).toBeDefined();
      expect(phys!.flattening, `${id} flattening`).toBeCloseTo(expectedF, 4);

      // Verify BodyVisual scales mesh polar axis z by 1 - f
      const b = ALL_BODIES.find((x) => x.id === id)!;
      const vis = new BodyVisual({
        id,
        name: b.name,
        radiusKm: b.radiusKm,
        color: b.color,
        physical: phys,
      });
      expect(vis.mesh.scale.z, `${id} visual polar scale (1 - f)`).toBeCloseTo(1 - expectedF, 4);
    }
  });

  it('Saturn ring dimensions match official observational bounds', () => {
    const saturnPhys = model.physicalMap['saturn'];
    expect(saturnPhys?.ring).toBeDefined();
    expect(saturnPhys!.ring!.innerKm).toBe(74500); // Inner edge of C/D rings
    expect(saturnPhys!.ring!.outerKm).toBe(140220); // Outer edge of A ring

    // Planetary radii for ratio check
    const saturnR = ALL_BODIES.find((b) => b.id === 'saturn')!.radiusKm;
    expect(saturnPhys!.ring!.outerKm / saturnR).toBeCloseTo(2.327, 2);
  });

  it('computeBodyFacts correctly reports Equatorial, Polar, and Volumetric Radii', () => {
    const jupiterFacts = computeBodyFacts('jupiter', model.state, model);
    expect(jupiterFacts).not.toBeNull();
    expect(jupiterFacts!.radiusKm).toBe(71492);
    // Polar radius: a * (1 - f) = 71492 * (1 - 0.06487) ≈ 66854 km
    expect(jupiterFacts!.polarRadiusKm).toBeCloseTo(66854, -1);
    // Volumetric radius: (a^2 * c)^(1/3) ≈ 69911 km
    expect(jupiterFacts!.volumetricRadiusKm).toBeCloseTo(69911, -1);
    expect(jupiterFacts!.flattening).toBeCloseTo(0.06487, 4);

    const earthFacts = computeBodyFacts('earth', model.state, model);
    expect(earthFacts).not.toBeNull();
    expect(earthFacts!.radiusKm).toBeCloseTo(6378.137, 2);
    expect(earthFacts!.polarRadiusKm).toBeCloseTo(6356.75, 0);
    expect(earthFacts!.volumetricRadiusKm).toBeCloseTo(6371.0, 0);
  });
});
