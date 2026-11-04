import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GALACTIC_AXES_IN_SIM, galacticFrame } from '@/frames/galactic';
import { GalaxyVisual } from '@/render/galaxyVisual';

describe('Galaxy Visual and Transform Validation', () => {
  it('correctly transforms Sagittarius A* position in galactic-aligned vs ecliptic frames', () => {
    const [GX, GY, GZ] = GALACTIC_AXES_IN_SIM;

    const mRotEcl = new THREE.Matrix4().set(
      GX[0]!, GY[0]!, GZ[0]!, 0,
      GX[1]!, GY[1]!, GZ[1]!, 0,
      GX[2]!, GY[2]!, GZ[2]!, 0,
      0,      0,      0,      1
    );

    const frame = galacticFrame(true);
    const fa = frame.axes!;
    const mFrame = new THREE.Matrix4().set(
      fa[0]!, fa[1]!, fa[2]!, 0,
      fa[3]!, fa[4]!, fa[5]!, 0,
      fa[6]!, fa[7]!, fa[8]!, 0,
      0,      0,      0,      1
    );

    const mRotScene = mFrame.clone().multiply(mRotEcl);
    const S_GAL = 60.0;
    const sunGal = new THREE.Vector3(-8.2, 0, 0.0208).multiplyScalar(S_GAL);
    sunGal.applyMatrix4(mRotScene);

    // In galactic-aligned frame, Sun is along -X at -492 AU, so Sgr A* is at +492 AU
    expect(sunGal.x).toBeCloseTo(-492.0, 1);
    expect(sunGal.y).toBeCloseTo(0.0, 1);

    const galPos = new THREE.Vector3(0, 0, 0).sub(sunGal);
    expect(galPos.x).toBeCloseTo(492.0, 1);
    expect(galPos.y).toBeCloseTo(0.0, 1);
  });

  it('initializes GalaxyVisual with visible stars, bulge, and un-culled points', () => {
    const gv = new GalaxyVisual();
    expect(gv.group.visible).toBe(true);

    // Verify children points are visible and frustumCulled is false
    const pointsChildren = gv.group.children.filter((c) => c instanceof THREE.Points) as THREE.Points[];
    expect(pointsChildren.length).toBeGreaterThanOrEqual(2);

    for (const points of pointsChildren) {
      expect(points.visible).toBe(true);
      expect(points.frustumCulled).toBe(false);
      const mat = points.material as THREE.ShaderMaterial & {
        uniforms: { uSize: { value: number }; uOpacity: { value: number } };
      };
      expect(mat.uniforms.uSize.value).toBeGreaterThanOrEqual(3.0);
      expect(mat.uniforms.uOpacity.value).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('keeps stars and bulge points visible across solar and cosmological scales in setUnifiedMode', () => {
    const gv = new GalaxyVisual();

    // Solar scale (< 250 AU)
    gv.setUnifiedMode(55, true);
    const points = gv.group.children.filter((c) => c instanceof THREE.Points);
    for (const p of points) {
      expect(p.visible).toBe(true);
    }
    // Galactic orbit path line remains visible on zoom
    expect(gv.orbitLine.visible).toBe(true);

    // Cosmological scale (> 1000 AU)
    gv.setUnifiedMode(2800, true);
    for (const p of points) {
      expect(p.visible).toBe(true);
    }
    expect(gv.orbitLine.visible).toBe(true);

    // Gated by showOrbit
    gv.setUnifiedMode(55, true, false);
    expect(gv.orbitLine.visible).toBe(false);
  });
});
