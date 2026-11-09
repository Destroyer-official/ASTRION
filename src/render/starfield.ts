import * as THREE from 'three';
import { GALACTIC_AXES_IN_SIM } from '@/frames/galactic';
import { createPrng } from './prng';

const STAR_COLORS = [
  0x9bb0ff, // O/B blue
  0xcad7ff, // A white
  0xf8f9ff, // F yellow-white
  0xfff4e8, // G yellow (solar)
  0xffd2a1, // K orange
  0xff8866, // M red dwarf
];

/**
 * Creates an astronomical celestial sphere starfield featuring:
 * 1. Isotropic distant background stars (spectral classes O-M).
 * 2. Milky Way Galactic Plane Star Clouds: 45,000 crisp stars exponentially concentrated along
 *    the Galactic Equator (b = 0) and peaked towards Sagittarius A* (l = 0), with Great Rift dark dust lanes.
 * Tilted at 60.19° to the ecliptic plane, matching true astronomical IAU coordinates.
 * All stars use sizeAttenuation: false for pin-sharp, photorealistic starlight without fuzzy blob artifacts.
 */
export function createStarfield(radius = 45000, seed = 0x57a8f1e1): THREE.Group {
  const group = new THREE.Group();
  const rand = createPrng(seed);

  const [GX, GY, GZ] = GALACTIC_AXES_IN_SIM;

  // Helper to convert Galactic spherical (l, b, r) to simulation ecliptic (x, y, z)
  const galToSim = (l: number, b: number, r: number): [number, number, number] => {
    const cb = Math.cos(b);
    const xg = cb * Math.cos(l);
    const yg = cb * Math.sin(l);
    const zg = Math.sin(b);

    const x = r * (xg * GX[0]! + yg * GY[0]! + zg * GZ[0]!);
    const y = r * (xg * GX[1]! + yg * GY[1]! + zg * GZ[1]!);
    const z = r * (xg * GX[2]! + yg * GY[2]! + zg * GZ[2]!);
    return [x, y, z];
  };

  // 1. Isotropic Field Stars (8,000 stars across the entire sky)
  const numField = 8000;
  const fieldPos = new Float32Array(numField * 3);
  const fieldCol = new Float32Array(numField * 3);
  const col = new THREE.Color();

  for (let i = 0; i < numField; i++) {
    const u = rand();
    const v = rand();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = radius * (0.92 + 0.16 * rand());

    fieldPos[3 * i] = r * Math.sin(phi) * Math.cos(theta);
    fieldPos[3 * i + 1] = r * Math.sin(phi) * Math.sin(theta);
    fieldPos[3 * i + 2] = r * Math.cos(phi);

    const hex = STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)]!;
    col.setHex(hex);
    const mag = rand() < 0.05 ? 1.0 : rand() * 0.55 + 0.2;
    fieldCol[3 * i] = col.r * mag;
    fieldCol[3 * i + 1] = col.g * mag;
    fieldCol[3 * i + 2] = col.b * mag;
  }

  const fieldGeom = new THREE.BufferGeometry();
  fieldGeom.setAttribute('position', new THREE.BufferAttribute(fieldPos, 3));
  fieldGeom.setAttribute('color', new THREE.BufferAttribute(fieldCol, 3));
  const fieldMat = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
  });
  const fieldPoints = new THREE.Points(fieldGeom, fieldMat);
  fieldPoints.frustumCulled = false;
  group.add(fieldPoints);

  // 2. Milky Way Galactic Plane Star Clouds (45,000 crisp stars concentrated along b = 0)
  const numGal = 45000;
  const galPos = new Float32Array(numGal * 3);
  const galCol = new Float32Array(numGal * 3);

  for (let i = 0; i < numGal; i++) {
    // Galactic latitude: exponential scale height ~ 0.10 rad (~5.7°)
    const sign = rand() < 0.5 ? 1 : -1;
    const b = sign * -Math.log(1 - rand() * 0.98) * 0.095;

    // Galactic longitude: concentrated towards Galactic Center (Sagittarius bulge)
    let l = rand() < 0.58
      // Inner galaxy bulge & arms (-50° to +50°)
      ? (rand() - 0.5) * (Math.PI * 0.55)
      // Full circle around the galactic disc
      : rand() * 2 * Math.PI;
    if (l < 0) l += 2 * Math.PI;

    // Great Rift dust lane absorption: Cygnus to Sagittarius (l: 345° to 35°, b: -3° to +3°)
    const lDeg = (l * 180) / Math.PI;
    const bDeg = (b * 180) / Math.PI;
    const isRift =
      (lDeg > 342 || lDeg < 38) &&
      bDeg > -2.2 &&
      bDeg < 2.0 &&
      rand() < 0.7;

    const r = radius * (0.95 + 0.1 * rand());
    const [x, y, z] = galToSim(l, b, r);

    galPos[3 * i] = x;
    galPos[3 * i + 1] = y;
    galPos[3 * i + 2] = z;

    // Color: warm golden towards Sgr A* bulge; silver/blue in arms
    const distToCenter = Math.min(Math.abs(lDeg), Math.abs(360 - lDeg));
    if (distToCenter < 35 && Math.abs(bDeg) < 5) {
      // Bulge: warm golden / amber K/M giants
      col.setHSL(0.11 + rand() * 0.05, 0.7, 0.75 + rand() * 0.25);
    } else {
      // Arm stars: white / icy cyan O/B/A stars
      col.setHSL(0.58 + rand() * 0.08, 0.45, 0.8 + rand() * 0.2);
    }

    const intensity = isRift ? 0.05 : (rand() * 0.65 + 0.35);
    galCol[3 * i] = col.r * intensity;
    galCol[3 * i + 1] = col.g * intensity;
    galCol[3 * i + 2] = col.b * intensity;
  }

  const galGeom = new THREE.BufferGeometry();
  galGeom.setAttribute('position', new THREE.BufferAttribute(galPos, 3));
  galGeom.setAttribute('color', new THREE.BufferAttribute(galCol, 3));
  const galMat = new THREE.PointsMaterial({
    size: 1.8,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
  });
  const galPoints = new THREE.Points(galGeom, galMat);
  galPoints.frustumCulled = false;
  group.add(galPoints);

  return group;
}
