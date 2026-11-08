import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrajectoryOverlayVisual } from '@/render/trajectoryOverlayVisual';
import { barycentricFrame } from '@/frames/basic';
import type { TrajectoryPoint, GravitationalPullBreakdown, SolarWobbleState } from '@/physics/trajectoryPredictor';

describe('TrajectoryOverlayVisual (3D Astrodynamics Overlay)', () => {
  it('initializes overlay groups, lines, and vector arrow helpers', () => {
    const visual = new TrajectoryOverlayVisual();
    expect(visual.group).toBeDefined();
    expect(visual.group.name).toBe('TrajectoryOverlayVisual');

    // Contains line for trajectory, line for wobble, and 4 arrow helpers
    expect(visual.group.children.length).toBe(6);
  });

  it('updates 3D future predicted trajectory path in display space with confidence gradient', () => {
    const visual = new TrajectoryOverlayVisual();

    const mockPoints: TrajectoryPoint[] = [
      {
        tDays: 0,
        pos: [1.0, 0, 0],
        vel: [0, 0.0172, 0],
        distAu: 1.0,
        distKm: 149597870.7,
        speedKms: 29.78,
        flightPathAngleDeg: 0,
        trueAnomalyDeg: 0,
        meanAnomalyDeg: 0,
      },
      {
        tDays: 30,
        pos: [0.866, 0.5, 0],
        vel: [-0.0086, 0.0149, 0],
        distAu: 1.0,
        distKm: 149597870.7,
        speedKms: 29.78,
        flightPathAngleDeg: 0,
        trueAnomalyDeg: 30,
        meanAnomalyDeg: 29.5,
      },
    ];

    visual.setTrajectoryPath(mockPoints);

    visual.update(
      barycentricFrame,
      [0, 0, 0],
      [0, 0, 0],
      1,
      1.5,
      mockPoints,
      null,
      [1.0, 0, 0],
      null,
      [0, 0, 0],
    );

    const trajLine = visual.group.children.find(
      (c) => c instanceof THREE.Line && c.geometry.attributes['color'],
    ) as THREE.Line | undefined;

    expect(trajLine).toBeDefined();
    expect(trajLine!.visible).toBe(true);

    const posAttr = trajLine!.geometry.attributes['position'] as THREE.BufferAttribute;
    expect(posAttr.getX(0)).toBeCloseTo(1.0, 2);
    expect(posAttr.getY(0)).toBeCloseTo(0, 2);
    expect(posAttr.getX(1)).toBeCloseTo(0.866, 2);
    expect(posAttr.getY(1)).toBeCloseTo(0.5, 2);
  });

  it('renders and dynamically scales gravitational pull vector arrows', () => {
    const visual = new TrajectoryOverlayVisual();

    const mockPull: GravitationalPullBreakdown = {
      targetId: 'earth',
      totalAccelVec: [-5.93e-3, 0, 0],
      totalAccel_um_s2: 5930.0,
      totalAccel_m_s2: 5.93e-3,
      radialAccel_um_s2: -5930.0,
      tangentialAccel_um_s2: 0.01,
      normalAccel_um_s2: 0.0,
      turnRateArcsecPerDay: 3548.0,
      perturbers: [],
    };

    visual.setGravityPull(mockPull);

    visual.update(
      barycentricFrame,
      [0, 0, 0],
      [0, 0, 0],
      1,
      2.0, // camera distance 2.0 AU
      null,
      mockPull,
      [1.0, 0, 0],
      null,
      [0, 0, 0],
    );

    const arrows = visual.group.children.filter((c) => c instanceof THREE.ArrowHelper) as THREE.ArrowHelper[];
    expect(arrows.length).toBe(4);

    // Net pull arrow should be positioned at Earth's position
    const netArrow = arrows[0]!;
    expect(netArrow.position.x).toBeCloseTo(1.0, 2);
    expect(netArrow.position.y).toBeCloseTo(0, 2);
    expect(netArrow.visible).toBe(true);
  });

  it('renders 60-year solar wobble rosette loop around Solar System Barycenter', () => {
    const visual = new TrajectoryOverlayVisual();

    const mockWobble: SolarWobbleState = {
      distBaryKm: 850000,
      distBaryAu: 0.00568,
      solarRadii: 1.22,
      isOutsideSurface: true,
      velocityKms: [0.012, 0, 0],
      speedMs: 12.0,
      speedKms: 0.012,
      accel_um_s2: 0.002,
      gasGiantDrivers: [
        { id: 'jupiter', name: 'Jupiter', pullFraction: 61.2 },
        { id: 'saturn', name: 'Saturn', pullFraction: 27.4 },
      ],
      loopSummary: {
        minDistKm: 150000,
        maxDistKm: 1550000,
        minSolarRadii: 0.22,
        maxSolarRadii: 2.23,
        points: [
          { tYears: 0, xKm: 800000, yKm: 0, zKm: 0, rKm: 800000 },
          { tYears: 1, xKm: 750000, yKm: 250000, zKm: 0, rKm: 790569 },
          { tYears: 2, xKm: 600000, yKm: 500000, zKm: 0, rKm: 781024 },
        ],
      },
    };

    visual.setSolarWobble(mockWobble);

    visual.update(
      barycentricFrame,
      [0, 0, 0],
      [0, 0, 0],
      1,
      0.05,
      null,
      null,
      null,
      mockWobble,
      [0.005, 0, 0],
    );

    const wobbleLine = visual.group.children.find(
      (c) => c instanceof THREE.Line && !(c.geometry.attributes['color']),
    ) as THREE.Line | undefined;

    expect(wobbleLine).toBeDefined();
    expect(wobbleLine!.visible).toBe(true);

    // Clear turns off all overlays
    visual.clear();
    expect(wobbleLine!.visible).toBe(false);
  });
});
