import { describe, it, expect } from 'vitest';
import { GalaxyVisual, nearestPathIndex, sunWakeVertices } from '@/render/galaxyVisual';

const SUN0 = { tMyr: 0, x: -8.2, y: 0, z: 0.0208, vx: 11.1, vy: 232.24, vz: 7.25 };

describe('orbit path recent-journey highlight', () => {
  it('nearestPathIndex finds the closest vertex and distance', () => {
    // Straight path along +x: points (0,0,0)..(4,0,0).
    const path = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
    expect(nearestPathIndex(path, 2.4, 0.3)).toEqual({ index: 2, distKpc: expect.any(Number) });
    const r = nearestPathIndex(path, 2.4, 0.3);
    expect(r.index).toBe(2);
    expect(r.distKpc).toBeCloseTo(Math.hypot(0.4, 0.3), 12);
  });

  it('highlight peaks at the sun vertex and fades with distance', () => {
    const v = new GalaxyVisual({ numStars: 100, diskRadiusKpc: 18, numHaloStars: 20, numGlobularClusters: 2 });
    // Synthetic 61-point path along +x from the origin (long enough to fade out).
    const N = 61;
    const path = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) path[3 * i] = i;
    v.setOrbitPath(path);
    // Sun sits exactly on vertex 30.
    v.update({ ...SUN0, x: 30, y: 0 });
    const colors = (v as unknown as { orbitGeom: import('three').BufferGeometry }).orbitGeom.attributes[
      'color'
    ] as import('three').BufferAttribute;
    expect(colors.getX(30)).toBeCloseTo(1.0, 6);
    expect(colors.getX(0)).toBeLessThan(0.35);
    expect(colors.getX(N - 1)).toBeLessThan(0.35);
    // Monotonic falloff on both sides of the peak.
    for (let d = 1; d <= 10; d++) {
      expect(colors.getX(30 - d)).toBeGreaterThanOrEqual(colors.getX(30 - d - 1));
      expect(colors.getX(30 + d)).toBeGreaterThanOrEqual(colors.getX(30 + d + 1));
    }
  });

  it('no highlight when the sun is off the charted path', () => {
    const v = new GalaxyVisual({ numStars: 100, diskRadiusKpc: 18, numHaloStars: 20, numGlobularClusters: 2 });
    const path = new Float32Array(11 * 3);
    for (let i = 0; i < 11; i++) path[3 * i] = i;
    v.setOrbitPath(path);
    v.update({ ...SUN0, x: 100, y: 100 });
    const colors = (v as unknown as { orbitGeom: import('three').BufferGeometry }).orbitGeom.attributes[
      'color'
    ] as import('three').BufferAttribute;
    for (let i = 0; i < 11; i++) {
      expect(colors.getX(i)).toBeCloseTo(0.3, 6); // uniform dim base
    }
  });
});

describe('sun curved voyage wake', () => {
  // 61-point path along +x; sun at vertex 40.
  const path = new Float32Array(61 * 3);
  for (let i = 0; i < 61; i++) path[3 * i] = i * 0.5;

  it('wake trails the sun along the path in order', () => {
    const out = new Float32Array(3 * 160);
    const n = sunWakeVertices(path, 20, 0, out, 160);
    expect(n).toBe(41); // vertices 0..40 ending at the sun
    for (let j = 0; j < n; j++) {
      expect(out[3 * j]).toBeCloseTo((j + 0) * 0.5, 9);
      expect(out[3 * j + 1]).toBeCloseTo(0, 9);
    }
    // Head lands exactly on the sun.
    expect(out[3 * (n - 1)]).toBeCloseTo(20, 9);
  });

  it('wake is capped and gated like the highlight', () => {
    const out = new Float32Array(3 * 160);
    expect(sunWakeVertices(path, 20, 0, out, 10)).toBe(10);
    expect(sunWakeVertices(path, 10_000, 0, out, 160)).toBe(0); // off-path gate
  });

  it('writeSunWake maps the arc through the world matrix', () => {
    const v = new GalaxyVisual({ numStars: 100, diskRadiusKpc: 18, numHaloStars: 20, numGlobularClusters: 2 });
    v.setOrbitPath(path);
    v.update({ ...SUN0, x: 20, y: 0 });
    const out = new Float32Array(3 * 160);
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const n = v.writeSunWake(I, out, 160);
    expect(n).toBe(41);
    // Identity matrix: local kpc coords pass through; head on the sun.
    expect(out[3 * (n - 1)]).toBeCloseTo(20, 6);
    expect(out[3 * (n - 1) + 1]).toBeCloseTo(0, 6);
  });
});
