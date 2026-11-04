import * as THREE from 'three';
import type { GalacticOrbitState } from '@/physics/galacticPotential';

/** 1 km/s = 1/977.79222 kpc/Myr (same time unit the galactic orbit uses). */
const KMS_TO_KPC_PER_MYR = 1 / 977.79222;
/**
 * Galactic bar (StarChild: the Milky Way is a BARRED spiral; Sofue review §2:
 * axisymmetric bulge + non-axisymmetric bar). A bar is a rigid density pattern,
 * so unlike disk stars it rotates at one pattern speed, not differentially.
 */
const BAR_STRETCH = 1.5; // major/minor axis ratio of the bar
const BAR_ANGLE_DEG = 27; // bar major axis vs Sun–GC line (Wegg & Gerhard 2013)
const BAR_PATTERN_KMS_KPC = 39; // pattern speed (Portail et al. 2017)
const BAR_PATTERN_RAD_PER_MYR = -(BAR_PATTERN_KMS_KPC / 977.79222); // clockwise, like the disk

/** Orbit-path recent-journey highlight: gold ramp, gaussian arc, proximity gate. */
const ORBIT_GOLD: readonly [number, number, number] = [1.0, 0.84, 0.2];
const ORBIT_SIGMA = 8; // path vertices (0.5 Myr each): ±10 Myr glowing wake
const ORBIT_PROX_KPC = 1.5; // sun farther than this from the charted path: no highlight

/**
 * Index of the charted orbit-path vertex nearest the Sun (galactic XY, kpc).
 * Pure function (unit-tested).
 */
export function nearestPathIndex(
  path: Float32Array,
  x: number,
  y: number,
): { index: number; distKpc: number } {
  let best = 0,
    bd = Infinity;
  const n = Math.floor(path.length / 3);
  for (let i = 0; i < n; i++) {
    const dx = path[3 * i]! - x,
      dy = path[3 * i + 1]! - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { index: best, distKpc: Math.sqrt(bd) };
}

/**
 * Curved voyage wake for the Sun: the charted orbit-path arc trailing behind
 * the live marker (galaxy-local kpc). Unlike the linear drift used for planet
 * wakes (exact over days), this follows the true integrated rosette over
 * millions of years — the visible "rounding the galaxy". Returns vertex
 * count, 0 when the sun is off the charted path (same gate as the highlight).
 */
export const SUN_WAKE_VERTICES = 160;

export function sunWakeVertices(
  path: Float32Array,
  sunX: number,
  sunY: number,
  out: Float32Array,
  maxVertices: number,
): number {
  const { index, distKpc } = nearestPathIndex(path, sunX, sunY);
  if (distKpc >= ORBIT_PROX_KPC) return 0;
  const n = Math.min(SUN_WAKE_VERTICES, maxVertices, index + 1);
  const start = index - n + 1;
  for (let j = 0; j < n; j++) {
    out[3 * j] = path[3 * (start + j)]!;
    out[3 * j + 1] = path[3 * (start + j) + 1]!;
    out[3 * j + 2] = path[3 * (start + j) + 2]!;
  }
  return n;
}

/** Four logarithmic major arms (NASA/JPL-Caltech R. Hurt face-on map). */
export const SPIRAL_ARMS = 4;
export const SPIRAL_B = 0.22; // pitch parameter for r = a * exp(b * theta)
/**
 * Pattern phase: puts the Sun (angle PI at 8.2 kpc) mid-gap between arms, in
 * the Orion spur gap — not on top of an arm. Verified by spiralArmAngle test.
 */
export const SPIRAL_PHASE = 0.65;

/** Centerline angle of arm k at radius r (kpc). Pure function (unit-tested). */
export function spiralArmAngle(rKpc: number, armIdx: number): number {
  return Math.log(Math.max(rKpc, 1e-3)) / SPIRAL_B + armIdx * ((2 * Math.PI) / SPIRAL_ARMS) + SPIRAL_PHASE;
}

export interface SwirlUniforms {
  uT: { value: number };
  uSize: { value: number };
  uOpacity: { value: number };
  uLogDepthBufFC: { value: number };
}

/** Must equal 2 / log2(camera.far + 1); camera.far is 5e6 in viewer.ts. */
const LOG_DEPTH_BUF_FC = 2 / Math.log2(5e6 + 1);

/**
 * GPU differential-rotation point material. Each star carries birth angle
 * (aTheta), radius (aR) and signed angular rate (aOm); the vertex shader
 * evaluates theta(t) = theta0 + om*t, so rotation costs zero CPU and zero
 * buffer uploads per frame. Matches the old PointsMaterial look (soft sprite,
 * vertex colors, additive) including tone mapping.
 *
 * NOTE: three.js does not enable its logarithmic-depth chunks for custom
 * ShaderMaterial, and with near=1e-6/far=5e6 plain depth saturates to 1.0 and
 * culls every distant point. So this shader writes log depth manually.
 */
export function createSwirlMaterial(
  starTex: THREE.Texture,
  uniforms: SwirlUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uT: uniforms.uT,
      uSize: uniforms.uSize,
      uOpacity: uniforms.uOpacity,
      uLogDepthBufFC: uniforms.uLogDepthBufFC,
      map: { value: starTex },
    },
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aTheta;
      attribute float aR;
      attribute float aOm;
      uniform float uT;
      uniform float uSize;
      varying vec3 vColor;
      varying float vLogDepth;
      void main() {
        float th = aTheta + aOm * uT;
        vec3 p = vec3(aR * cos(th), aR * sin(th), position.z);
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize;
        vLogDepth = 1.0 + gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uOpacity;
      uniform float uLogDepthBufFC;
      varying vec3 vColor;
      varying float vLogDepth;
      void main() {
        gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor * uOpacity, 1.0) * tex;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export interface GalaxyVisualConfig {
  numStars?: number;
  diskRadiusKpc?: number;
  numHaloStars?: number;
  numGlobularClusters?: number;
}

export class GalaxyVisual {
  readonly group = new THREE.Group();
  private readonly starsPoints: THREE.Points;
  private readonly bulgePoints: THREE.Points;

  // Spherical non-flat components of the Milky Way
  private readonly haloGroup = new THREE.Group();
  private readonly haloPoints: THREE.Points;
  private readonly globularPoints: THREE.Points;
  private readonly dmBoundary: THREE.Group;

  readonly orbitLine: THREE.Line;
  private readonly orbitGeom: THREE.BufferGeometry;
  private orbitPath: Float32Array | null = null;
  private rawOrbitPath: Float32Array | null = null;
  private readonly wakeTmp = new Float32Array(3 * SUN_WAKE_VERTICES);


  private readonly sunMarker: THREE.Group;
  private readonly sgrAMarker: THREE.Group;
  private readonly gridGroup: THREE.Group;
  private readonly eclipticPlane: THREE.Mesh;
  private readonly velArrow: THREE.ArrowHelper;

  private zExaggeration = 1.0;
  private readonly starPositions: Float32Array;
  private readonly baseStarZ: Float32Array;
  // Cylindrical birth coordinates + signed angular rate (rad/Myr) per star.
  // Negative = clockwise from +z, matching the integrated solar orbit.
  private readonly starR: Float32Array;
  private readonly starTheta0: Float32Array;
  private readonly starOm: Float32Array;
  private readonly bulgePositions: Float32Array;
  private readonly baseBulgeZ: Float32Array;
  private readonly bulgeR: Float32Array;
  private readonly bulgeTheta0: Float32Array;
  private readonly bulgeOm: Float32Array;
  private readonly haloPositions: Float32Array;
  private readonly baseHaloZ: Float32Array;
  private readonly globularPositions: Float32Array;
  private readonly baseGlobularZ: Float32Array;
  private rotationCurve: (rKpc: number) => number = () => 220;
  /** Shared uniform objects (mutated in place by setUnifiedMode/update). */
  private readonly starsU = {
    uT: { value: 0 },
    uSize: { value: 3.5 },
    uOpacity: { value: 0.95 },
    uLogDepthBufFC: { value: LOG_DEPTH_BUF_FC },
  };
  private readonly bulgeU = {
    uT: { value: 0 },
    uSize: { value: 6.0 },
    uOpacity: { value: 0.95 },
    uLogDepthBufFC: { value: LOG_DEPTH_BUF_FC },
  };

  constructor(config: GalaxyVisualConfig = {}) {
    const numStars = config.numStars ?? 60_000;
    const diskRadius = config.diskRadiusKpc ?? 18;
    const numHaloStars = config.numHaloStars ?? 8_000;
    const numGlobular = config.numGlobularClusters ?? 158;

    const starTex = this.createStarTexture();

    // 1. Milky Way Spiral Arms Star Distribution (Flat Thin Disc, ~1:100 aspect ratio)
    const starGeom = new THREE.BufferGeometry();
    this.starPositions = new Float32Array(numStars * 3);
    this.baseStarZ = new Float32Array(numStars);
    this.starR = new Float32Array(numStars);
    this.starTheta0 = new Float32Array(numStars);
    this.starOm = new Float32Array(numStars);
    const starColors = new Float32Array(numStars * 3);

    const arms = SPIRAL_ARMS;
    const sunR0 = 8.2; // Sun galactocentric radius in kpc

    for (let i = 0; i < numStars; i++) {
      const idx = i * 3;
      let x = 0, y = 0, z = 0, r = 0, theta = 0;
      let isArm = false;

      // Resample if candidate falls within the Local Bubble (0.75 kpc = 45 AU in scene units)
      // to guarantee zero 3D galactic star points ever clip through planetary orbits
      for (let attempt = 0; attempt < 12; attempt++) {
        const u = Math.random();
        r = 1.0 + Math.sqrt(u) * (diskRadius - 1.0);

        // Choose arm (or inter-arm)
        const armIdx = Math.floor(Math.random() * arms);
        isArm = Math.random() < 0.75;
        theta = spiralArmAngle(r, armIdx);

        if (isArm) {
          // Arm dispersion
          const spread = 0.25 + 0.15 * (r / diskRadius);
          theta += (Math.random() - 0.5) * spread * 2;
        } else {
          // Inter-arm diffuse stars
          theta = Math.random() * 2 * Math.PI;
        }

        // Vertical exponential scale height (~0.3 kpc)
        const zScale = 0.3 * (1 + 0.5 * (r / diskRadius));
        const zSign = Math.random() < 0.5 ? 1 : -1;
        z = zSign * -Math.log(1 - Math.random() * 0.99) * zScale * 0.5;

        x = r * Math.cos(theta);
        y = r * Math.sin(theta);

        // Distance in kpc from Sun's coordinates (-8.2, 0, 0.0208)
        const dSunKpc = Math.hypot(x - (-sunR0), y, z - 0.0208);
        if (dSunKpc >= 0.75 || attempt === 11) {
          break;
        }
      }

      this.starPositions[idx] = x;
      this.starPositions[idx + 1] = y;
      this.starPositions[idx + 2] = z;
      this.baseStarZ[i] = z;
      this.starR[i] = r;
      this.starTheta0[i] = Math.atan2(y, x);

      // Color based on location and type
      const color = new THREE.Color();
      if (isArm && Math.random() < 0.25) {
        color.setHSL(0.58 + Math.random() * 0.08, 0.85, 0.75 + Math.random() * 0.2);
      } else if (isArm && Math.random() < 0.08) {
        color.setHSL(0.92 + Math.random() * 0.06, 0.9, 0.7);
      } else {
        const warmth = Math.min(1, 2.5 / (r + 0.5));
        color.setHSL(0.12 - 0.05 * warmth, 0.4 + 0.5 * warmth, 0.65 + Math.random() * 0.3);
      }

      starColors[idx] = color.r;
      starColors[idx + 1] = color.g;
      starColors[idx + 2] = color.b;
    }

    starGeom.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starGeom.setAttribute('aTheta', new THREE.BufferAttribute(this.starTheta0, 1));
    starGeom.setAttribute('aR', new THREE.BufferAttribute(this.starR, 1));
    starGeom.setAttribute('aOm', new THREE.BufferAttribute(this.starOm, 1));

    const starMat = createSwirlMaterial(starTex, this.starsU);
    this.starsPoints = new THREE.Points(starGeom, starMat);
    this.starsPoints.frustumCulled = false;
    this.group.add(this.starsPoints);

    // 2. Central Galactic Bulge (Thicker spheroidal core)
    const numBulge = 15_000;
    const bulgeGeom = new THREE.BufferGeometry();
    this.bulgePositions = new Float32Array(numBulge * 3);
    this.baseBulgeZ = new Float32Array(numBulge);
    this.bulgeR = new Float32Array(numBulge);
    this.bulgeTheta0 = new Float32Array(numBulge);
    this.bulgeOm = new Float32Array(numBulge);
    const bulgeColors = new Float32Array(numBulge * 3);

    for (let i = 0; i < numBulge; i++) {
      const idx = i * 3;
      const r = Math.pow(Math.random(), 2.5) * 2.5;
      const phi = Math.random() * 2 * Math.PI;
      const costheta = 2 * Math.random() - 1;
      const sintheta = Math.sqrt(Math.max(0, 1 - costheta * costheta));

      // Elongate into the bar, then fix its position angle vs the Sun–GC line.
      const pa = (BAR_ANGLE_DEG * Math.PI) / 180;
      const bx = r * sintheta * Math.cos(phi) * BAR_STRETCH;
      const by = r * sintheta * Math.sin(phi);
      const x = bx * Math.cos(pa) - by * Math.sin(pa);
      const y = bx * Math.sin(pa) + by * Math.cos(pa);
      const z = r * costheta * 0.6; // slightly flattened

      this.bulgePositions[idx] = x;
      this.bulgePositions[idx + 1] = y;
      this.bulgePositions[idx + 2] = z;
      this.baseBulgeZ[i] = z;
      this.bulgeR[i] = Math.hypot(x, y);
      this.bulgeTheta0[i] = Math.atan2(y, x);

      const color = new THREE.Color();
      color.setHSL(0.1 + Math.random() * 0.05, 0.8, 0.75 + Math.random() * 0.25);
      bulgeColors[idx] = color.r;
      bulgeColors[idx + 1] = color.g;
      bulgeColors[idx + 2] = color.b;
    }

    bulgeGeom.setAttribute('position', new THREE.BufferAttribute(this.bulgePositions, 3));
    bulgeGeom.setAttribute('color', new THREE.BufferAttribute(bulgeColors, 3));
    bulgeGeom.setAttribute('aTheta', new THREE.BufferAttribute(this.bulgeTheta0, 1));
    bulgeGeom.setAttribute('aR', new THREE.BufferAttribute(this.bulgeR, 1));
    bulgeGeom.setAttribute('aOm', new THREE.BufferAttribute(this.bulgeOm, 1));

    const bulgeMat = createSwirlMaterial(starTex, this.bulgeU);
    this.bulgePoints = new THREE.Points(bulgeGeom, bulgeMat);
    this.bulgePoints.frustumCulled = false;
    this.group.add(this.bulgePoints);

    // 3. Spherical Stellar Halo (Population II ancient stars, r ~ 2 to 35 kpc)
    const haloGeom = new THREE.BufferGeometry();
    this.haloPositions = new Float32Array(numHaloStars * 3);
    this.baseHaloZ = new Float32Array(numHaloStars);
    const haloColors = new Float32Array(numHaloStars * 3);

    for (let i = 0; i < numHaloStars; i++) {
      const idx = i * 3;
      // Power law density n(r) ~ r^-3.5
      const u = Math.random();
      const r = 2.0 + Math.pow(u, 0.5) * 32.0; // 2 to 34 kpc
      const phi = Math.random() * 2 * Math.PI;
      const costheta = 2 * Math.random() - 1;
      const sintheta = Math.sqrt(Math.max(0, 1 - costheta * costheta));

      // Mild flattening in inner halo (c/a ~ 0.8)
      const q = 0.8;
      const x = r * sintheta * Math.cos(phi);
      const y = r * sintheta * Math.sin(phi);
      const z = r * costheta * q;

      this.haloPositions[idx] = x;
      this.haloPositions[idx + 1] = y;
      this.haloPositions[idx + 2] = z;
      this.baseHaloZ[i] = z;

      // Faint antique gold / pale blue-white
      const color = new THREE.Color();
      if (Math.random() < 0.6) {
        color.setHSL(0.12, 0.4, 0.55 + Math.random() * 0.2);
      } else {
        color.setHSL(0.55, 0.3, 0.7 + Math.random() * 0.2);
      }
      haloColors[idx] = color.r;
      haloColors[idx + 1] = color.g;
      haloColors[idx + 2] = color.b;
    }

    haloGeom.setAttribute('position', new THREE.BufferAttribute(this.haloPositions, 3));
    haloGeom.setAttribute('color', new THREE.BufferAttribute(haloColors, 3));

    const haloMat = new THREE.PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      vertexColors: true,
      map: starTex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.haloPoints = new THREE.Points(haloGeom, haloMat);
    this.haloPoints.frustumCulled = false;
    this.haloGroup.add(this.haloPoints);

    // 4. Globular Clusters (158 known Harris catalog clusters, spherical distribution)
    const globGeom = new THREE.BufferGeometry();
    this.globularPositions = new Float32Array(numGlobular * 3);
    this.baseGlobularZ = new Float32Array(numGlobular);
    const globColors = new Float32Array(numGlobular * 3);

    for (let i = 0; i < numGlobular; i++) {
      const idx = i * 3;
      // Isotropic spherical distribution with core concentration
      const u = Math.random();
      const r = 1.0 + Math.pow(u, 0.6) * 33.0; // 1 to 34 kpc
      const phi = Math.random() * 2 * Math.PI;
      const costheta = 2 * Math.random() - 1;
      const sintheta = Math.sqrt(Math.max(0, 1 - costheta * costheta));

      const x = r * sintheta * Math.cos(phi);
      const y = r * sintheta * Math.sin(phi);
      const z = r * costheta;
      this.globularPositions[idx] = x;
      this.globularPositions[idx + 1] = y;
      this.globularPositions[idx + 2] = z;
      this.baseGlobularZ[i] = z;

      // Bright incandescent gold
      globColors[idx] = 1.0;
      globColors[idx + 1] = 0.88;
      globColors[idx + 2] = 0.55;
    }

    globGeom.setAttribute('position', new THREE.BufferAttribute(this.globularPositions, 3));
    globGeom.setAttribute('color', new THREE.BufferAttribute(globColors, 3));

    const globMat = new THREE.PointsMaterial({
      size: 6.0,
      sizeAttenuation: false,
      vertexColors: true,
      map: starTex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.globularPoints = new THREE.Points(globGeom, globMat);
    this.globularPoints.frustumCulled = false;
    this.haloGroup.add(this.globularPoints);

    // 5. Dark Matter Halo Virial Boundary Shells (25 kpc & 40 kpc spherical guides)
    this.dmBoundary = this.createDarkMatterGuides();
    this.haloGroup.add(this.dmBoundary);

    this.group.add(this.haloGroup);

    // 6. Central Black Hole: Sagittarius A*
    this.sgrAMarker = new THREE.Group();
    const bhCoreGeom = new THREE.SphereGeometry(0.08, 32, 16);
    const bhCoreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const bhCore = new THREE.Mesh(bhCoreGeom, bhCoreMat);
    this.sgrAMarker.add(bhCore);

    // Accretion disk glow around Sgr A*
    const accGeom = new THREE.RingGeometry(0.09, 0.35, 64);
    const accMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const accRing = new THREE.Mesh(accGeom, accMat);
    accRing.rotation.x = Math.PI * 0.15;
    this.sgrAMarker.add(accRing);

    // Sgr A* 3D Billboard Label
    const sgrALabel = this.createGalacticLabelSprite('🕳️ Sagittarius A*', '#ffaa33', 'Galactic Center · 4.15×10⁶ M☉');
    sgrALabel.position.set(0, 0.45, 0.3);
    this.sgrAMarker.add(sgrALabel);

    this.group.add(this.sgrAMarker);

    // 7. Sun's Orbit Path (Rosette + Bobbing Trajectory)
    this.orbitGeom = new THREE.BufferGeometry();
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
    });
    this.orbitLine = new THREE.Line(this.orbitGeom, orbitMat);
    this.orbitLine.frustumCulled = false;
    this.group.add(this.orbitLine);


    // 8. Sun / Solar System Marker
    this.sunMarker = new THREE.Group();

    const sunGeom = new THREE.SphereGeometry(0.12, 32, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    this.sunMarker.add(sunMesh);

    const glowGeom = new THREE.SphereGeometry(0.24, 32, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    this.sunMarker.add(new THREE.Mesh(glowGeom, glowMat));

    // Solar System Ecliptic Disc tilted at 60.2° to Galactic Midplane
    const eclipticGeom = new THREE.RingGeometry(0.18, 0.45, 48);
    const eclipticMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    this.eclipticPlane = new THREE.Mesh(eclipticGeom, eclipticMat);
    this.eclipticPlane.rotation.x = THREE.MathUtils.degToRad(60.2);
    this.sunMarker.add(this.eclipticPlane);

    this.velArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      0.8,
      0x00ff88,
      0.2,
      0.1,
    );
    this.sunMarker.add(this.velArrow);

    // Sun / Solar System 3D Billboard Label
    const sunLabel = this.createGalacticLabelSprite('☀️ Solar System (Our Sun)', '#ffd700', 'R: 8.2 kpc · Orion Spur (230 km/s)');
    sunLabel.position.set(0, 0.42, 0.28);
    this.sunMarker.add(sunLabel);

    this.group.add(this.sunMarker);

    // 9. Galactic Reference Guides
    this.gridGroup = this.createGalacticGuides();
    this.group.add(this.gridGroup);

    this.group.visible = true;
    this.refreshOmegas();
  }

  private createGalacticLabelSprite(text: string, color: string, subtext?: string): THREE.Sprite {
    if (typeof document === 'undefined') return new THREE.Sprite(new THREE.SpriteMaterial());
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = subtext ? 128 : 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Sprite(new THREE.SpriteMaterial());

    const pillH = subtext ? 84 : 48;
    const pillW = 460;
    const px = (canvas.width - pillW) / 2;
    const py = (canvas.height - pillH) / 2;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(px, py, pillW, pillH, 16);
    } else {
      ctx.rect(px, py, pillW, pillH);
    }
    ctx.fillStyle = 'rgba(7, 11, 22, 0.88)';
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = subtext ? 'top' : 'middle';
    ctx.fillText(text, canvas.width / 2, subtext ? py + 12 : canvas.height / 2);

    if (subtext) {
      ctx.fillStyle = color;
      ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(subtext, canvas.width / 2, py + 48);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(subtext ? 1.5 : 1.1, subtext ? 0.38 : 0.20, 1);
    return sprite;
  }

  private createStarTexture(): THREE.Texture {
    if (typeof document === 'undefined') return new THREE.Texture();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.45, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.75, 'rgba(235, 245, 255, 0.85)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private createDarkMatterGuides(): THREE.Group {
    const group = new THREE.Group();
    const radii = [25.0, 40.0]; // kpc
    const segs = 128;
    const mat = new THREE.LineBasicMaterial({
      color: 0x554477,
      transparent: true,
      opacity: 0.25,
    });

    for (const r of radii) {
      // Equator
      const eqPts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * 2 * Math.PI;
        eqPts.push(new THREE.Vector3(r * Math.cos(th), r * Math.sin(th), 0));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(eqPts), mat));

      // Meridian XZ
      const m1Pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * 2 * Math.PI;
        m1Pts.push(new THREE.Vector3(r * Math.cos(th), 0, r * Math.sin(th)));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(m1Pts), mat));

      // Meridian YZ
      const m2Pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * 2 * Math.PI;
        m2Pts.push(new THREE.Vector3(0, r * Math.cos(th), r * Math.sin(th)));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(m2Pts), mat));
    }

    return group;
  }

  private createGalacticGuides(): THREE.Group {
    const group = new THREE.Group();
    const ringRadii = [4.0, 8.0, 12.0, 16.0]; // kpc concentric galactic distance guides

    for (const r of ringRadii) {
      const segs = 128;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * 2 * Math.PI;
        pts.push(new THREE.Vector3(r * Math.cos(theta), r * Math.sin(theta), 0));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      // Uniform subtle galactic grid material (no competing gold rings)
      const mat = new THREE.LineBasicMaterial({
        color: 0x334466,
        transparent: true,
        opacity: 0.18,
      });
      group.add(new THREE.Line(geom, mat));
    }

    // Galactic axis crosshair lines
    const axisGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-18, 0, 0),
      new THREE.Vector3(18, 0, 0),
      new THREE.Vector3(0, -18, 0),
      new THREE.Vector3(0, 18, 0),
    ]);
    const axisMat = new THREE.LineBasicMaterial({
      color: 0x223355,
      transparent: true,
      opacity: 0.2,
    });
    group.add(new THREE.LineSegments(axisGeom, axisMat));

    // Major spiral arm guides & orientation markers
    const armsMeta = [
      { name: 'Perseus Arm', r: 10.5, th: 1.8, color: '#60a5fa' },
      { name: 'Local (Orion) Spur', r: 8.2, th: 2.2, color: '#facc15' },
      { name: 'Sagittarius Arm', r: 6.5, th: 1.0, color: '#f472b6' },
      { name: 'Scutum-Centaurus Arm', r: 4.8, th: 4.2, color: '#34d399' },
    ];
    for (const a of armsMeta) {
      const armSprite = this.createGalacticLabelSprite(a.name, a.color);
      armSprite.position.set(a.r * Math.cos(a.th), a.r * Math.sin(a.th), 0.2);
      group.add(armSprite);
    }

    return group;
  }

  getVerticalExaggeration(): number {
    return this.zExaggeration;
  }

  setVerticalExaggeration(factor: number): void {
    if (this.zExaggeration === factor) return;
    this.zExaggeration = factor;

    // Update stars
    const pos = this.starPositions;
    for (let i = 0; i < this.baseStarZ.length; i++) {
      pos[i * 3 + 2] = this.baseStarZ[i]! * factor;
    }
    this.starsPoints.geometry.attributes['position']!.needsUpdate = true;

    // Update bulge
    const bPos = this.bulgePositions;
    for (let i = 0; i < this.baseBulgeZ.length; i++) {
      bPos[i * 3 + 2] = this.baseBulgeZ[i]! * factor;
    }
    this.bulgePoints.geometry.attributes['position']!.needsUpdate = true;

    // Update stellar halo
    const hPos = this.haloPositions;
    for (let i = 0; i < this.baseHaloZ.length; i++) {
      hPos[i * 3 + 2] = this.baseHaloZ[i]! * factor;
    }
    this.haloPoints.geometry.attributes['position']!.needsUpdate = true;

    // Update globular clusters
    const gPos = this.globularPositions;
    for (let i = 0; i < this.baseGlobularZ.length; i++) {
      gPos[i * 3 + 2] = this.baseGlobularZ[i]! * factor;
    }
    this.globularPoints.geometry.attributes['position']!.needsUpdate = true;

    // Synchronize orbit line geometry with vertical factor
    if (this.rawOrbitPath) {
      const raw = this.rawOrbitPath;
      const exaggerated = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 3) {
        exaggerated[i] = raw[i]!;
        exaggerated[i + 1] = raw[i + 1]!;
        exaggerated[i + 2] = raw[i + 2]! * factor;
      }
      this.orbitGeom.setAttribute('position', new THREE.BufferAttribute(exaggerated, 3));
      this.orbitGeom.attributes['position']!.needsUpdate = true;
      this.orbitPath = exaggerated;
    }
  }

  setOrbitPath(pathPoints: Float32Array): void {
    this.rawOrbitPath = pathPoints;
    const exaggerated = new Float32Array(pathPoints.length);
    for (let i = 0; i < pathPoints.length; i += 3) {
      exaggerated[i] = pathPoints[i]!;
      exaggerated[i + 1] = pathPoints[i + 1]!;
      exaggerated[i + 2] = pathPoints[i + 2]! * this.zExaggeration;
    }
    this.orbitGeom.setAttribute('position', new THREE.BufferAttribute(exaggerated, 3));
    this.orbitGeom.attributes['position']!.needsUpdate = true;
    // Per-vertex gold ramp (dim base); highlightOrbit() brightens the live arc.
    const n = Math.floor(exaggerated.length / 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[3 * i] = ORBIT_GOLD[0]! * 0.3;
      colors[3 * i + 1] = ORBIT_GOLD[1]! * 0.3;
      colors[3 * i + 2] = ORBIT_GOLD[2]! * 0.3;
    }
    this.orbitGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.orbitGeom.attributes['color']!.needsUpdate = true;
    this.orbitPath = exaggerated;
  }

  /**
   * Write the Sun's curved wake (charted path arc behind the live marker)
   * through the world matrix into a trail buffer. Returns the vertex count,
   * 0 when gated (then the caller keeps the linear wake instead).
   */
  writeSunWake(matWorld: ArrayLike<number>, out: Float32Array, maxVertices: number): number {
    const path = this.orbitPath;
    if (!path) return 0;
    const n = sunWakeVertices(
      path,
      this.sunMarker.position.x,
      this.sunMarker.position.y,
      this.wakeTmp,
      Math.min(maxVertices, SUN_WAKE_VERTICES),
    );
    for (let j = 0; j < n; j++) {
      const x = this.wakeTmp[3 * j]!,
        y = this.wakeTmp[3 * j + 1]!,
        z = this.wakeTmp[3 * j + 2]!;
      out[3 * j] = matWorld[0]! * x + matWorld[4]! * y + matWorld[8]! * z + matWorld[12]!;
      out[3 * j + 1] = matWorld[1]! * x + matWorld[5]! * y + matWorld[9]! * z + matWorld[13]!;
      out[3 * j + 2] = matWorld[2]! * x + matWorld[6]! * y + matWorld[10]! * z + matWorld[14]!;
    }
    return n;
  }

  /**
   * Brighten the orbit-path arc around the Sun's current position (a glowing
   * recent-journey wake ON the curved path). Falls back to uniform dim gold
   * when the Sun is off the charted path (e.g. long reversed runs).
   */
  /**
   * Brighten the orbit-path arc around the Sun's current position (a glowing
   * recent-journey wake/tail ON the curved path). Falls back to uniform dim gold
   * when the Sun is off the charted path (e.g. long reversed runs).
   */
  highlightOrbit(sunX: number, sunY: number, _sunZ?: number): void {
    const path = this.orbitPath;
    if (!path) return;
    const colorAttr = this.orbitGeom.attributes['color'];
    if (!colorAttr) return;
    const { index, distKpc } = nearestPathIndex(path, sunX, sunY);

    const n = Math.floor(path.length / 3);
    const arr = (colorAttr as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < n; i++) {
      let glow = 0;
      if (distKpc < ORBIT_PROX_KPC) {
        const d = Math.abs(i - index);
        glow = Math.exp(-((d * d) / (2 * ORBIT_SIGMA * ORBIT_SIGMA)));
      }
      const b = 0.3 + 0.7 * glow;
      arr[3 * i] = ORBIT_GOLD[0]! * b;
      arr[3 * i + 1] = ORBIT_GOLD[1]! * b;
      arr[3 * i + 2] = ORBIT_GOLD[2]! * b;
    }
    colorAttr.needsUpdate = true;
  }

  update(state: GalacticOrbitState): void {
    const sunZ = state.z * this.zExaggeration;
    this.sunMarker.position.set(state.x, state.y, sunZ);

    const vLen = Math.hypot(state.vx, state.vy, state.vz) || 1;
    const dir = new THREE.Vector3(state.vx / vLen, state.vy / vLen, (state.vz * this.zExaggeration) / vLen);
    this.velArrow.setDirection(dir.normalize());

    // Differential rotation runs on the GPU (uT): zero CPU work and zero
    // buffer uploads per frame no matter how fast galaxy time flows.
    this.starsU.uT.value = state.tMyr;
    this.bulgeU.uT.value = state.tMyr;
    // Recent-journey glow rides the curved path with the sun marker and anchors the vertex.
    this.highlightOrbit(state.x, state.y, sunZ);
  }


  /**
   * Install the live rotation curve Vc(R) in km/s. Signed angular rates are
   * derived here (clockwise from +z, matching the integrated solar orbit).
   */
  setRotationCurve(vcKms: (rKpc: number) => number): void {
    this.rotationCurve = vcKms;
    this.refreshOmegas();
  }

  private refreshOmegas(): void {
    for (let i = 0; i < this.starR.length; i++) {
      const r = Math.max(this.starR[i]!, 1e-3);
      this.starOm[i] = (-this.rotationCurve(r) * KMS_TO_KPC_PER_MYR) / r;
    }
    // Bar = rigid pattern: every bar star shares one angular rate.
    for (let i = 0; i < this.bulgeOm.length; i++) {
      this.bulgeOm[i] = BAR_PATTERN_RAD_PER_MYR;
    }
    // No upload needed: the GPU reads these arrays through the live attributes.
  }

  getSunPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.sunMarker.position);
  }

  getSgrAPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.group.position);
  }

  setUnifiedMode(cameraDistAu: number, showHalo = true, showOrbit = true): void {
    // The 3D Milky Way disc, spiral arms, bulge, and halo remain visible across all scales
    // so the galaxy is clearly rendered whether zoomed out to deep space or viewing the solar system.
    this.starsPoints.visible = true;
    this.bulgePoints.visible = true;
    this.haloGroup.visible = showHalo;

    // Deep space helper markers: Sun marker billboard yields when zoomed in close (< 80 AU)
    // so real 3D planet & Sun meshes take over without being swallowed by the marker billboard.
    // The Sun's 500-Myr Rosette galactic orbit path and glowing tail remain visible across zoom!
    this.sunMarker.visible = cameraDistAu >= 80;
    this.orbitLine.visible = showOrbit;
    this.sgrAMarker.visible = true;
    this.gridGroup.visible = cameraDistAu >= 1500;

    // Far (galactic overview): 60k additive points would saturate to a white blob.
    // Shrink + dim them with distance so spiral arms and dust lanes stay visible.
    const far = cameraDistAu > 300;
    const near = cameraDistAu < 80;
    this.starsU.uSize.value = far ? 1.8 : near ? 1.8 : 2.5;
    this.bulgeU.uSize.value = far ? 2.5 : near ? 2.2 : 4.0;
    this.starsU.uOpacity.value = far ? 0.85 : near ? 0.45 : 0.65;
    this.bulgeU.uOpacity.value = far ? 0.9 : near ? 0.5 : 0.75;
  }

  setOrbitLineVisible(visible: boolean): void {
    this.orbitLine.visible = visible;
  }

  setSolarMode(isSolar: boolean): void {
    this.setUnifiedMode(isSolar ? 50 : 2000, true);
  }

  setHaloVisible(visible: boolean): void {
    this.haloGroup.visible = visible;
  }

  /** Zoom handoff: hide the kpc-scale sun marker/glow/ecliptic so the real
   * sun mesh takes over up close (it would otherwise swallow the camera). */
  setSunMarkerVisible(visible: boolean): void {
    this.sunMarker.visible = visible;
  }

  setGuidesVisible(visible: boolean): void {
    this.gridGroup.visible = visible;
  }

  /** Adaptive quality: render only the first fraction of disk/bulge stars. */
  setStarFraction(f: number): void {
    const frac = Math.max(0.05, Math.min(1, f));
    this.starsPoints.geometry.setDrawRange(0, Math.floor(this.starR.length * frac));
    this.bulgePoints.geometry.setDrawRange(0, Math.floor(this.bulgeR.length * frac));
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}
