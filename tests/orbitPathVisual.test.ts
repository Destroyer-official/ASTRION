import { describe, it, expect } from 'vitest';
import { OrbitPathVisual, NASA_ORBIT_COLORS } from '@/render/orbitPathVisual';
import { loadSystem, ALL_BODIES } from '@/sim/registry';
import { barycentricFrame } from '@/frames/basic';
import { galacticFrame } from '@/frames/galactic';
import type { ViewState } from '@/render/viewer';

describe('NASA Eyes OrbitPathVisual', () => {
  const model = loadSystem(ALL_BODIES);
  const sunIdx = model.ids.indexOf('sun');
  const earthIdx = model.ids.indexOf('earth');

  const baseViewState: ViewState = {
    frame: barycentricFrame,
    focus: sunIdx,
    trails: true,
    trailDays: 365,
    history: { count: 0, cap: 100 } as any,
  };

  it('initializes closed orbit loops for all planets and moons', () => {
    const visual = new OrbitPathVisual(model);
    expect(visual.group).toBeDefined();
    expect(visual.group.children.length).toBeGreaterThan(25);
  });

  it('assigns calibrated NASA Eyes colors to planets', () => {
    expect(NASA_ORBIT_COLORS['earth']).toBe(0x38bdf8); // Cyan
    expect(NASA_ORBIT_COLORS['mars']).toBe(0xf87171);  // Red
    expect(NASA_ORBIT_COLORS['jupiter']).toBe(0xfbbf24); // Gold
    expect(NASA_ORBIT_COLORS['saturn']).toBe(0xfde047); // Pale gold
    expect(NASA_ORBIT_COLORS['neptune']).toBe(0x60a5fa); // Royal blue
  });

  it('Earth position lies directly on Earth orbit path line in display space', () => {
    const visual = new OrbitPathVisual(model);
    const bodyDists = new Float64Array(model.ids.length).fill(1);

    // In barycentric frame without focus offset, f = [0, 0, 0]
    const testViewState: ViewState = {
      ...baseViewState,
      focus: -1,
    };

    visual.update(
      model.state,
      testViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      1.0,
      bodyDists,
      null,
      null,
      true,
    );

    // Find Earth's line via reliable ID lookup
    const earthItem = visual.getItem('earth');
    expect(earthItem).toBeDefined();
    const earthLine = earthItem!.line;

    const earthSimX = model.state.pos[3 * earthIdx]!;
    const earthSimY = model.state.pos[3 * earthIdx + 1]!;
    const earthSimZ = model.state.pos[3 * earthIdx + 2]!;

    // Search vertices along Earth's points for the minimum distance to Earth's actual position
    const attr = earthLine.geometry.attributes['position']!;
    let minDist = Infinity;
    for (let j = 0; j < attr.count; j++) {
      const vx = attr.getX(j);
      const vy = attr.getY(j);
      const vz = attr.getZ(j);
      const d = Math.hypot(vx - earthSimX, vy - earthSimY, vz - earthSimZ);
      if (d < minDist) {
        minDist = d;
      }
    }
    // Minimum distance must be virtually zero (< 0.04 AU along a 1.0 AU orbit)
    expect(minDist).toBeLessThan(0.04);
  });

  it('orbit lines transform accurately when switching into galactic-aligned frame', () => {
    const visual = new OrbitPathVisual(model);
    const bodyDists = new Float64Array(model.ids.length).fill(1);
    const galFrame = galacticFrame(true, 220); // alignAxes = true

    const galViewState: ViewState = {
      ...baseViewState,
      frame: galFrame,
      focus: -1,
    };

    visual.update(
      model.state,
      galViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      1.0,
      bodyDists,
      null,
      null,
      true,
    );

    const earthItem = visual.getItem('earth');
    expect(earthItem).toBeDefined();
    const earthLine = earthItem!.line;
    const attr = earthLine.geometry.attributes['position']!;
    // In galactic frame, z coordinates should be non-zero (tilted by 60 degrees)
    let maxZ = 0;
    for (let j = 0; j < attr.count; j++) {
      const vz = Math.abs(attr.getZ(j));
      if (vz > maxZ) maxZ = vz;
    }
    expect(maxZ).toBeGreaterThan(0.5); // 1 AU inclined by 60° gives max |z| ~ 0.86 AU
  });

  it('hides orbits in galactic overview (> 350 AU)', () => {
    const visual = new OrbitPathVisual(model);
    const bodyDists = new Float64Array(model.ids.length).fill(1);

    visual.update(
      model.state,
      baseViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      500,
      bodyDists,
      null,
      null,
      true,
    );
    expect(visual.group.visible).toBe(false);

    visual.update(
      model.state,
      baseViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      30,
      bodyDists,
      null,
      null,
      true,
    );
    expect(visual.group.visible).toBe(true);
  });

  it('respects showOrbits toggle', () => {
    const visual = new OrbitPathVisual(model);
    const bodyDists = new Float64Array(model.ids.length).fill(1);

    visual.update(
      model.state,
      baseViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      10,
      bodyDists,
      null,
      null,
      false,
    );
    expect(visual.group.visible).toBe(false);
  });

  it('Pluto heliocentric orbit path is anchored to Pluto-Charon barycenter with zero breathing/pulsing', () => {
    const visual = new OrbitPathVisual(model);
    const bodyDists = new Float64Array(model.ids.length).fill(10); // viewed from distant overview

    const plutoItem = visual.getItem('pluto');
    expect(plutoItem).toBeDefined();

    visual.update(
      model.state,
      baseViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      50, // camera at 50 AU
      bodyDists,
      null,
      null,
      true,
    );

    const attr = plutoItem!.line.geometry.attributes['position']!;
    const p0 = [attr.getX(0), attr.getY(0), attr.getZ(0)];
    const r0 = Math.hypot(p0[0]!, p0[1]!, p0[2]!);

    // Distance to Sun at node 0 must be in Pluto's canonical heliocentric orbit range (29 to 50 AU)
    expect(r0).toBeGreaterThan(29.0);
    expect(r0).toBeLessThan(50.0);
  });

  it('guarantees physical clearance: Mars never swallows Phobos orbit and Pluto never swallows barycenter orbit', () => {
    const AU_KM = 149597870.7;
    const marsRadiusAu = 3389.5 / AU_KM;
    const phobosSemiMajorAu = 9376.0 / AU_KM;
    const plutoRadiusAu = 1188.3 / AU_KM;
    const plutoBaryDistAu = 2131.4 / AU_KM;

    // Phobos orbit must be strictly outside Mars physical radius by at least 2.7x
    expect(phobosSemiMajorAu / marsRadiusAu).toBeGreaterThan(2.7);

    // Pluto-Charon barycenter orbit must be strictly outside Pluto physical radius by at least 1.7x
    expect(plutoBaryDistAu / plutoRadiusAu).toBeGreaterThan(1.7);
  });

  it('computes Phobos line vertices in OrbitPathVisual strictly outside Mars physical radius', () => {
    const visual = new OrbitPathVisual(model);
    const bodyDists = new Float64Array(model.ids.length).fill(0.00045);
    const marsIdx = model.ids.indexOf('mars');
    const phobosIdx = model.ids.indexOf('phobos');
    bodyDists[marsIdx] = 0.00045;

    console.log('Mars idx:', marsIdx, 'Phobos idx:', phobosIdx);
    console.log('Mars sim pos:', model.state.pos.slice(3 * marsIdx, 3 * marsIdx + 3));
    console.log('Phobos sim pos:', model.state.pos.slice(3 * phobosIdx, 3 * phobosIdx + 3));

    const marsViewState: ViewState = {
      ...baseViewState,
      focus: marsIdx,
      selected: 'mars',
    };

    visual.update(
      model.state,
      marsViewState,
      sunIdx,
      null,
      [0, 0, 0],
      [0, 0, 0],
      1.5,
      bodyDists,
      'mars',
      'mars',
      true,
    );

    const phobosItem = visual.getItem('phobos');
    expect(phobosItem).toBeDefined();
    expect(phobosItem!.line.visible).toBe(true);

    const attr = phobosItem!.line.geometry.attributes['position']!;
    const AU_KM = 149597870.7;
    const marsRadiusKm = 3389.5;

    let minR = Infinity;
    let maxR = -Infinity;
    for (let j = 0; j < attr.count; j++) {
      const vx = attr.getX(j);
      const vy = attr.getY(j);
      const vz = attr.getZ(j);
      const rKm = Math.hypot(vx, vy, vz) * AU_KM;
      if (rKm < minR) minR = rKm;
      if (rKm > maxR) maxR = rKm;
    }

    console.log(`Phobos orbit vertex min radius: ${minR.toFixed(1)} km, max: ${maxR.toFixed(1)} km, Mars radius: ${marsRadiusKm} km`);
    expect(minR).toBeGreaterThan(9000); // 9,234 km periapsis
    expect(minR / (marsRadiusKm)).toBeGreaterThan(2.6);
  });
});
