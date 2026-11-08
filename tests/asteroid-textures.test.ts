import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCeresTexture,
  createVestaTexture,
  createPsycheTexture,
  createAsteroidTexture,
  PLANET_TEXTURE_GETTERS,
  REAL_TEXTURE_FILES,
} from '@/render/textures';
import { BodyVisual } from '@/render/bodyVisual';

describe('Asteroid Photorealistic Textures & 3D Geometry', () => {
  it('generates procedural textures for Ceres, Vesta, and Psyche with equirectangular wrapping', () => {
    const ceresTex = createCeresTexture();
    expect(ceresTex).toBeInstanceOf(THREE.CanvasTexture);
    expect(ceresTex.wrapS).toBe(THREE.RepeatWrapping);

    const vestaTex = createVestaTexture();
    expect(vestaTex).toBeInstanceOf(THREE.CanvasTexture);
    expect(vestaTex.wrapS).toBe(THREE.RepeatWrapping);

    const psycheTex = createPsycheTexture();
    expect(psycheTex).toBeInstanceOf(THREE.CanvasTexture);
    expect(psycheTex.wrapS).toBe(THREE.RepeatWrapping);

    const genericTex = createAsteroidTexture(12345, '#555555', '#222222', 100);
    expect(genericTex).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('registers all 16 massive JPL SB441-N16 perturber asteroids in PLANET_TEXTURE_GETTERS', () => {
    const perturbers = [
      'ceres', 'vesta', 'psyche', 'pallas', 'hygiea', 'iris', 'juno',
      'eunomia', 'euphrosyne', 'interamnia', 'davida', 'sylvia', 'cybele',
      'camilla', 'thisbe', 'asteroid-52',
    ];
    for (const id of perturbers) {
      expect(PLANET_TEXTURE_GETTERS[id], `missing texture getter for ${id}`).toBeDefined();
      const tex = PLANET_TEXTURE_GETTERS[id]!();
      expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    }
  });

  it('supports real photo files for Ceres and Vesta if present in public/textures/', () => {
    expect(REAL_TEXTURE_FILES.ceres).toBe('ceres.jpg');
    expect(REAL_TEXTURE_FILES.vesta).toBe('vesta.jpg');
  });

  it('assigns realistic non-spherical triaxial geometry to irregular asteroids', () => {
    const vestaVis = new BodyVisual({ id: 'vesta', name: '4 Vesta', radiusKm: 286.3, color: '#d6d3d1' });
    expect(vestaVis.triaxialScale[0]).toBe(1.0);
    expect(vestaVis.triaxialScale[1]).toBeCloseTo(0.973, 3);
    expect(vestaVis.triaxialScale[2]).toBe(1.0);

    const psycheVis = new BodyVisual({ id: 'psyche', name: '16 Psyche', radiusKm: 111, color: '#a1a1aa' });
    expect(psycheVis.triaxialScale[0]).toBe(1.0);
    expect(psycheVis.triaxialScale[1]).toBeCloseTo(0.856, 3);
    expect(psycheVis.triaxialScale[2]).toBeCloseTo(0.615, 3);

    const earthVis = new BodyVisual({ id: 'earth', name: 'Earth', radiusKm: 6371, color: '#2563eb' });
    expect(earthVis.triaxialScale).toEqual([1, 1, 1]);
  });

  it('assigns metallic PBR material characteristics to M-type asteroid Psyche', () => {
    const psycheVis = new BodyVisual({ id: 'psyche', name: '16 Psyche', radiusKm: 111, color: '#a1a1aa' });
    const mat = psycheVis.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.metalness).toBeGreaterThanOrEqual(0.8);
    expect(mat.roughness).toBeLessThan(0.5);

    const ceresVis = new BodyVisual({ id: 'ceres', name: 'Ceres', radiusKm: 482.6, color: '#9aa0a6' });
    const ceresMat = ceresVis.mesh.material as THREE.MeshStandardMaterial;
    expect(ceresMat.metalness).toBeLessThan(0.1);
    expect(ceresMat.roughness).toBeGreaterThanOrEqual(0.8);
  });
});

