import * as THREE from 'three';
import { createSaturnRingTexture } from './textures';

/** Ring geometry in kilometers from the planet's center, plus its visual parameters. */
export interface RingDef {
  innerRadiusKm: number;
  outerRadiusKm: number;
  color: string;
  opacity: number;
}

/**
 * Creates a planetary ring mesh (Saturn, Uranus, Neptune).
 * Geometry is normalized such that r = 1.0 corresponds exactly to 1.0 planet physical radius,
 * matching Three.js SphereGeometry(1.0).
 * This ensures the ring scales in 1:1 physical proportion with the planet's visual sphere at all times.
 */
export function createPlanetaryRing(ring: RingDef, planetId: string, planetRadiusKm: number): THREE.Mesh {
  const innerR = ring.innerRadiusKm / planetRadiusKm;
  const outerR = ring.outerRadiusKm / planetRadiusKm;

  const geom = new THREE.RingGeometry(innerR, outerR, 192);

  // Remap UVs radially: u = (r - inner) / (outer - inner), v = 0.5
  const pos = geom.attributes.position!;
  const uvs = geom.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    const u = Math.min(1, Math.max(0, (r - innerR) / (outerR - innerR)));
    uvs.setXY(i, u, 0.5);
  }
  uvs.needsUpdate = true;

  let mat: THREE.Material;
  if (planetId === 'saturn') {
    const tex = createSaturnRingTexture();
    mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity: ring.opacity,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: ring.color,
      transparent: true,
      opacity: ring.opacity,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
  }

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}
