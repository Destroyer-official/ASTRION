import { describe, it, expect } from 'vitest';
import { galacticDetail, pickBodyAt, focusFramingDist, wheelFlightFactor } from '@/render/viewer';

describe('galaxy zoom continuum (marker <-> system handoff)', () => {
  it('far out: marker on, system hidden', () => {
    expect(galacticDetail(2800)).toEqual({ showMarker: true, showSystem: false });
    expect(galacticDetail(300)).toEqual({ showMarker: true, showSystem: false });
  });

  it('mid range: marker still on, system resolving', () => {
    expect(galacticDetail(299)).toEqual({ showMarker: true, showSystem: true });
    expect(galacticDetail(25)).toEqual({ showMarker: true, showSystem: true });
  });

  it('up close: marker yields to the real sun mesh', () => {
    expect(galacticDetail(24.9)).toEqual({ showMarker: false, showSystem: true });
    expect(galacticDetail(0.01)).toEqual({ showMarker: false, showSystem: true });
  });
});

describe('screen-space click picking (planets, sun, moons)', () => {
  const bodies = [
    { id: 'sun', x: 400, y: 300, dist: 35, visible: true },
    { id: 'earth', x: 500, y: 300, dist: 34, visible: true },
    { id: 'moon', x: 508, y: 304, dist: 34, visible: true },
    { id: 'phobos', x: 100, y: 100, dist: 2, visible: true },
    { id: 'hidden', x: 400, y: 300, dist: 1, visible: false },
  ];
  it('picks the nearest body within 24 px, nothing outside', () => {
    expect(pickBodyAt(502, 302, bodies)).toBe('earth');
    expect(pickBodyAt(508, 304, bodies)).toBe('moon');
    expect(pickBodyAt(700, 500, bodies)).toBeNull();
  });
  it('sub-pixel moons are clickable by proximity (no raycast needed)', () => {
    expect(pickBodyAt(112, 108, bodies)).toBe('phobos');
  });
  it('invisible bodies never win, even dead-center', () => {
    expect(pickBodyAt(400, 300, bodies)).toBe('sun');
    const onlyHidden = [{ id: 'hidden', x: 400, y: 300, dist: 1, visible: false }];
    expect(pickBodyAt(400, 300, onlyHidden)).toBeNull();
  });
  it('near-tie (<= 2 px) goes to the nearer body: moon over planet disc', () => {
    const pair = [
      { id: 'jupiter', x: 400, y: 300, dist: 5, visible: true },
      { id: 'io', x: 401, y: 301, dist: 4.9, visible: true },
    ];
    expect(pickBodyAt(400, 300, pair)).toBe('io');
  });
  it('large planet disc is clickable across its entire surface (not just tiny 24px center)', () => {
    const largePlanet = [
      { id: 'jupiter', x: 400, y: 300, dist: 5, visible: true, radiusPx: 80 },
    ];
    // 60 px from center: was missed by old 24 px threshold, now hits the disc
    expect(pickBodyAt(460, 300, largePlanet)).toBe('jupiter');
    expect(pickBodyAt(400, 375, largePlanet)).toBe('jupiter');
    // Way outside disc: returns null
    expect(pickBodyAt(550, 300, largePlanet)).toBeNull();
  });
  it('floating name label is directly clickable', () => {
    const labeledBody = [
      {
        id: 'earth',
        x: 500,
        y: 300,
        dist: 1,
        visible: true,
        radiusPx: 25,
        labelVisible: true,
        labelY: 255, // offset 45 px above body
        labelHalfW: 44,
        labelHalfH: 12,
      },
    ];
    // Click directly on the label text pill at (500, 255)
    expect(pickBodyAt(500, 255, labeledBody)).toBe('earth');
    expect(pickBodyAt(520, 252, labeledBody)).toBe('earth');
  });
});

describe('click-focus framing distance', () => {
  it('6x true radius fills ~1/3 of the field of view', () => {
    // Jupiter: 69911 km = 4.673e-4 AU -> 2.8e-3 AU (was 30x = 0.014 AU, <8% of screen).
    expect(focusFramingDist(4.673e-4)).toBeCloseTo(2.804e-3, 6);
    // Phobos: 11 km -> 66 km, never the old meaningless 1e-5 AU floor.
    expect(focusFramingDist(11 / 149597870.7)).toBeCloseTo(4.4118e-7, 10);
    expect(focusFramingDist(0)).toBe(0.01);
    expect(focusFramingDist(NaN)).toBe(0.01);
  });
});

describe('mid-flight wheel retargeting', () => {
  it('one notch steps arrival ~1.13x, lines scale 33x, sign zooms the right way', () => {
    expect(wheelFlightFactor(-100, 0)).toBeCloseTo(1 / 0.8869, 3);
    expect(wheelFlightFactor(100, 0)).toBeCloseTo(0.8869, 3);
    expect(wheelFlightFactor(-3, 1)).toBeCloseTo(Math.exp(0.12), 6);
    expect(wheelFlightFactor(0, 0)).toBe(1);
  });
});
