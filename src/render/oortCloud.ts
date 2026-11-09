import * as THREE from 'three';
import { createPrng } from './prng';

export interface OortCloudConfig {
  numAsteroids?: number;
  numKuiper?: number;
  numHills?: number;
  numOuter?: number;
  seed?: number;
}

/**
 * Visual representation of the complete non-flat Solar System belts and cometary reservoirs:
 * 1. Main Asteroid Belt: 2.1 - 3.3 AU (between Mars and Jupiter, with Kirkwood resonance gaps)
 * 2. Kuiper Belt & Scattered Disc: 30 - 65 AU (moderately flat disc, i ~ 10°-25°)
 * 3. Inner Oort Cloud (Hills Cloud): 2,000 - 20,000 AU (thick flattened torus)
 * 4. Outer Oort Cloud: 20,000 - 100,000 AU (isotropic spherical shell of icy cometary planetesimals)
 */
export class OortCloudVisual {
  readonly group = new THREE.Group();

  private readonly asteroidPoints: THREE.Points;
  private readonly kuiperPoints: THREE.Points;
  private readonly hillsPoints: THREE.Points;
  private readonly outerPoints: THREE.Points;
  private readonly boundaryShells: THREE.Group;

  constructor(config: OortCloudConfig = {}) {
    const numAsteroids = config.numAsteroids ?? 3500;
    const numKuiper = config.numKuiper ?? 2800;
    const numHills = config.numHills ?? 3500;
    const numOuter = config.numOuter ?? 7000;
    const rand = createPrng(config.seed ?? 0x007c001d);

    const particleTex = this.createParticleTexture();

    // 1. Main Asteroid Belt (2.1 to 3.3 AU, between Mars ~1.5 AU and Jupiter ~5.2 AU)
    const astGeom = new THREE.BufferGeometry();
    const astPos = new Float32Array(numAsteroids * 3);
    const astCol = new Float32Array(numAsteroids * 3);

    for (let i = 0; i < numAsteroids; i++) {
      const idx = i * 3;
      // Main belt semi-major axis distribution between 2.1 and 3.3 AU
      let r = 2.1 + rand() * 1.2;
      // Real Kirkwood resonance gaps: 3:1 (2.50 AU), 5:2 (2.82 AU), 7:3 (2.95 AU), 2:1 (3.27 AU)
      if (
        Math.abs(r - 2.50) < 0.03 ||
        Math.abs(r - 2.82) < 0.025 ||
        Math.abs(r - 2.95) < 0.02 ||
        Math.abs(r - 3.27) < 0.03
      ) {
        r += rand() > 0.5 ? 0.05 : -0.05;
      }
      const phi = rand() * 2 * Math.PI;
      // Typical asteroid inclination sigma ~ 7° to 9°
      const inc = (rand() - 0.5 + (rand() - 0.5)) * 0.16;
      const z = r * Math.sin(inc);
      const rProj = r * Math.cos(inc);

      astPos[idx] = rProj * Math.cos(phi);
      astPos[idx + 1] = rProj * Math.sin(phi);
      astPos[idx + 2] = z;

      // Rocky warm silica / carbonaceous gray tones (C-type, S-type asteroids)
      const tone = 0.65 + rand() * 0.35;
      astCol[idx] = tone * 0.95;
      astCol[idx + 1] = tone * 0.88;
      astCol[idx + 2] = tone * 0.78;
    }
    astGeom.setAttribute('position', new THREE.BufferAttribute(astPos, 3));
    astGeom.setAttribute('color', new THREE.BufferAttribute(astCol, 3));

    const astMat = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      vertexColors: true,
      map: particleTex,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.asteroidPoints = new THREE.Points(astGeom, astMat);

    // 2. Kuiper Belt & Scattered Disc (30 to 65 AU)
    const kuiperGeom = new THREE.BufferGeometry();
    const kuiperPos = new Float32Array(numKuiper * 3);
    const kuiperCol = new Float32Array(numKuiper * 3);

    for (let i = 0; i < numKuiper; i++) {
      const idx = i * 3;
      const r = 30 + rand() * 35; // 30 to 65 AU
      const phi = rand() * 2 * Math.PI;
      // Normal distribution around ecliptic plane (sigma_i ~ 12 degrees)
      const inc = (rand() - 0.5 + (rand() - 0.5)) * 0.25;
      const z = r * Math.sin(inc);
      const rProj = r * Math.cos(inc);

      kuiperPos[idx] = rProj * Math.cos(phi);
      kuiperPos[idx + 1] = rProj * Math.sin(phi);
      kuiperPos[idx + 2] = z;

      // Dusty ice/amber tint
      kuiperCol[idx] = 0.85 + rand() * 0.15;
      kuiperCol[idx + 1] = 0.75 + rand() * 0.15;
      kuiperCol[idx + 2] = 0.65 + rand() * 0.2;
    }
    kuiperGeom.setAttribute('position', new THREE.BufferAttribute(kuiperPos, 3));
    kuiperGeom.setAttribute('color', new THREE.BufferAttribute(kuiperCol, 3));

    const kuiperMat = new THREE.PointsMaterial({
      size: 1.8,
      sizeAttenuation: false,
      vertexColors: true,
      map: particleTex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.kuiperPoints = new THREE.Points(kuiperGeom, kuiperMat);
    this.group.add(this.kuiperPoints);

    // 3. Inner Hills Cloud (2,000 to 20,000 AU)
    const hillsGeom = new THREE.BufferGeometry();
    const hillsPos = new Float32Array(numHills * 3);
    const hillsCol = new Float32Array(numHills * 3);

    for (let i = 0; i < numHills; i++) {
      const idx = i * 3;
      // Power-law density r^-2 from 2,000 to 20,000 AU
      const u = rand();
      const r = 2000 * Math.exp(u * Math.log(20000 / 2000));
      const phi = rand() * 2 * Math.PI;
      const costheta = 2 * rand() - 1;
      const sintheta = Math.sqrt(Math.max(0, 1 - costheta * costheta));

      // Flattened aspect ratio z/r ~ 0.55
      const zScale = 0.55;
      hillsPos[idx] = r * sintheta * Math.cos(phi);
      hillsPos[idx + 1] = r * sintheta * Math.sin(phi);
      hillsPos[idx + 2] = r * costheta * zScale;

      // Pale icy cyan tint
      hillsCol[idx] = 0.65 + rand() * 0.2;
      hillsCol[idx + 1] = 0.82 + rand() * 0.18;
      hillsCol[idx + 2] = 0.95 + rand() * 0.05;
    }
    hillsGeom.setAttribute('position', new THREE.BufferAttribute(hillsPos, 3));
    hillsGeom.setAttribute('color', new THREE.BufferAttribute(hillsCol, 3));

    const hillsMat = new THREE.PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      vertexColors: true,
      map: particleTex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.hillsPoints = new THREE.Points(hillsGeom, hillsMat);
    this.group.add(this.hillsPoints);

    // 4. Outer Spherical Oort Cloud (20,000 to 100,000 AU)
    const outerGeom = new THREE.BufferGeometry();
    const outerPos = new Float32Array(numOuter * 3);
    const outerCol = new Float32Array(numOuter * 3);

    for (let i = 0; i < numOuter; i++) {
      const idx = i * 3;
      // Isotropic spherical distribution
      const u = rand();
      const r = 20000 + Math.pow(u, 0.7) * 80000; // 20k to 100k AU
      const phi = rand() * 2 * Math.PI;
      const costheta = 2 * rand() - 1;
      const sintheta = Math.sqrt(Math.max(0, 1 - costheta * costheta));

      outerPos[idx] = r * sintheta * Math.cos(phi);
      outerPos[idx + 1] = r * sintheta * Math.sin(phi);
      outerPos[idx + 2] = r * costheta;

      // Deep celestial blue/white
      outerCol[idx] = 0.7 + rand() * 0.25;
      outerCol[idx + 1] = 0.85 + rand() * 0.15;
      outerCol[idx + 2] = 1.0;
    }
    outerGeom.setAttribute('position', new THREE.BufferAttribute(outerPos, 3));
    outerGeom.setAttribute('color', new THREE.BufferAttribute(outerCol, 3));

    const outerMat = new THREE.PointsMaterial({
      size: 2.5,
      sizeAttenuation: false,
      vertexColors: true,
      map: particleTex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.outerPoints = new THREE.Points(outerGeom, outerMat);
    this.group.add(this.outerPoints);
    this.group.add(this.asteroidPoints);

    // 5. Boundary Shell Indicators (Kuiper 50 AU, Hills 10,000 AU, Oort 100,000 AU)
    this.boundaryShells = this.createBoundaryShells();
    this.group.add(this.boundaryShells);

    this.group.visible = false;
  }

  private createParticleTexture(): THREE.Texture {
    if (typeof document === 'undefined') return new THREE.Texture();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.25, 'rgba(180, 220, 255, 0.8)');
    grad.addColorStop(0.6, 'rgba(100, 160, 255, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  private createBoundaryShells(): THREE.Group {
    const group = new THREE.Group();

    // 50 AU Kuiper Belt Boundary Circle
    const kbPts: THREE.Vector3[] = [];
    const segs = 96;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * 2 * Math.PI;
      kbPts.push(new THREE.Vector3(50 * Math.cos(th), 50 * Math.sin(th), 0));
    }
    const kbGeom = new THREE.BufferGeometry().setFromPoints(kbPts);
    const kbMat = new THREE.LineBasicMaterial({
      color: 0x4488aa,
      transparent: true,
      opacity: 0.4,
    });
    group.add(new THREE.Line(kbGeom, kbMat));

    // Outer Oort Cloud Boundary Spherical Rings (100,000 AU)
    const oortR = 100000;
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x336699,
      transparent: true,
      opacity: 0.25,
    });

    // Equator ring
    const eqPts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * 2 * Math.PI;
      eqPts.push(new THREE.Vector3(oortR * Math.cos(th), oortR * Math.sin(th), 0));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(eqPts), ringMat));

    // Meridian ring
    const merPts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * 2 * Math.PI;
      merPts.push(new THREE.Vector3(oortR * Math.cos(th), 0, oortR * Math.sin(th)));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(merPts), ringMat));

    return group;
  }

  /**
   * Update visibility of belts and clouds dynamically based on camera distance to Sun.
   */
  update(camDistToSun: number, showOort = true): void {
    if (camDistToSun < 1.0) {
      // Too close to planet surface / Sun: hide all particle clouds
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    // Main Asteroid Belt (2.1 to 3.3 AU): visible when viewing inner/whole solar system
    this.asteroidPoints.visible = camDistToSun >= 1.2 && camDistToSun <= 160;

    // Kuiper Belt (30 to 65 AU): visible when viewing outer planets and dwarf planets
    this.kuiperPoints.visible = camDistToSun >= 12 && camDistToSun <= 600;

    // Inner Hills Cloud & Outer Oort Cloud: visible when zoomed out to cosmic scales
    const showCosmic = showOort && camDistToSun >= 100;
    this.hillsPoints.visible = showCosmic;
    this.outerPoints.visible = showCosmic && camDistToSun >= 350;
    this.boundaryShells.visible = showCosmic && camDistToSun >= 80;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}
