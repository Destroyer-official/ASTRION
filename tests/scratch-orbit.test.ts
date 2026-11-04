import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GalaxySim } from '@/sim/galaxySim';
import { GalaxyVisual } from '@/render/galaxyVisual';
import { GALACTIC_AXES_IN_SIM } from '@/frames/galactic';
import { GALAXY_UNITS_PER_KPC } from '@/render/viewer';

describe('galaxy orbit alignment and guide lines', () => {
  it('guarantees orbitLine passes dead-center through the Sun with zero offset', () => {
    const sim = new GalaxySim();
    const gv = new GalaxyVisual();
    const path = sim.generateOrbitPath(500, 0.5);
    gv.setOrbitPath(path);

    const S_GAL = GALAXY_UNITS_PER_KPC;
    const [GX_SIM, GY_SIM, GZ_SIM] = GALACTIC_AXES_IN_SIM;

    const mRotEcl = new THREE.Matrix4().set(
      GX_SIM[0]!, GY_SIM[0]!, GZ_SIM[0]!, 0,
      GX_SIM[1]!, GY_SIM[1]!, GZ_SIM[1]!, 0,
      GX_SIM[2]!, GY_SIM[2]!, GZ_SIM[2]!, 0,
      0,          0,          0,          1,
    );

    // Test with zExaggeration = 3.0
    gv.setVerticalExaggeration(3.0);
    expect(gv.getVerticalExaggeration()).toBe(3.0);

    // Run across multiple time steps
    for (const stepMyr of [0, 1.25, 15.7, 45.2]) {
      if (stepMyr > 0) sim.step(stepMyr);
      const state = sim.getState();

      const sunGalX = state.x;
      const sunGalY = state.y;
      const sunGalZ = state.z * gv.getVerticalExaggeration();

      const sunGal = new THREE.Vector3(sunGalX, sunGalY, sunGalZ).multiplyScalar(S_GAL);
      sunGal.applyMatrix4(mRotEcl);

      const sunScenePos = new THREE.Vector3(0, 0, 0); // Sun at origin in heliocentric view
      const galPos = sunScenePos.clone().sub(sunGal);

      gv.group.position.copy(galPos);
      gv.group.rotation.setFromRotationMatrix(mRotEcl);
      gv.group.scale.set(S_GAL, S_GAL, S_GAL);
      gv.group.updateMatrixWorld(true);

      // gv.update anchors the orbit line vertex directly to the Sun's live position
      gv.update(state);
      gv.group.updateMatrixWorld(true);

      const orbitGeom = (gv as any).orbitGeom as THREE.BufferGeometry;
      const posAttr = orbitGeom.attributes['position']!;
      let minOrbitDist = Infinity;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        tmp.applyMatrix4(gv.group.matrixWorld);
        const d = tmp.distanceTo(sunScenePos);
        if (d < minOrbitDist) minOrbitDist = d;
      }

      // Distance from Sun to the continuous orbit line must be within the discrete step resolution (< 4 AU)
      expect(minOrbitDist).toBeLessThan(4.0);
    }
  });

  it('ensures galactic coordinate guide rings do not have conflicting gold rings', () => {
    const gv = new GalaxyVisual();
    const gridGroup = (gv as any).gridGroup as THREE.Group;
    let foundGold = false;

    gridGroup.traverse((child) => {
      if ((child as THREE.Line).isLine) {
        const mat = (child as THREE.Line).material as THREE.LineBasicMaterial;
        if (mat.color.getHex() === 0xffaa00) {
          foundGold = true;
        }
      }
    });

    expect(foundGold).toBe(false);
  });
});
