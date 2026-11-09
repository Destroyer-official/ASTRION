import * as THREE from 'three';
import { AU_KM } from '@/data/constants';
import type { PhysicalJson } from '@/data/schema';
import { bodyToEcliptic } from '@/physics/orientation';
import { PLANET_TEXTURE_GETTERS, hasRealTexture, loadRealTexture } from './textures';
import { createPlanetaryRing } from './rings';

/** Must equal 2 / log2(camera.far + 1); camera.far is 5e6 in viewer.ts. */
const LOG_DEPTH_BUF_FC = 2 / Math.log2(5e6 + 1);

/**
 * Sun surface material: photosphere map with view-dependent limb darkening
 * I(mu)/I(0) = 1 - u*(1-mu), u = 0.6 (visible-light standard). Baked gradients
 * cannot do this (limb angle depends on the camera), which is why flat-shaded
 * suns look wrong up close. Includes tone mapping + manual log depth.
 */
function createSunMaterial(tex: THREE.Texture | undefined): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex ?? null },
      uHasMap: { value: tex ? 1 : 0 },
      uLogDepthBufFC: { value: LOG_DEPTH_BUF_FC },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPosition;
      varying float vLogDepth;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        vLogDepth = 1.0 + gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform int uHasMap;
      uniform float uLogDepthBufFC;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPosition;
      varying float vLogDepth;
      void main() {
        gl_FragDepth = log2(vLogDepth) * uLogDepthBufFC * 0.5;
        vec3 base = uHasMap == 1 ? texture2D(map, vUv).rgb : vec3(1.0, 0.8, 0.2);
        float mu = max(dot(normalize(vNormalV), normalize(vViewPosition)), 0.0);
        float limb = 1.0 - 0.6 * (1.0 - mu);
        gl_FragColor = vec4(base * limb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export type ScaleMode = 'true' | 'pixels' | 'exaggerated';

export interface BodyVisualOptions {
  id: string;
  name: string;
  radiusKm: number;
  color: string;
  physical?: PhysicalJson;
  isMoon?: boolean;
  parentId?: string;
  /** Renderer max anisotropy (crisp close-ups); capped at 8. */
  anisotropy?: number;
}

// Shared scratch (single-threaded render loop): avoids per-body-per-frame allocation.
const _orientMat4 = new THREE.Matrix4();
const _orientRes = new Array<number>(9).fill(0);

/**
 * Measured 3D non-spherical triaxial ratios (a, b, c normalized to a)
 * from NASA (Dawn, NEAR), ESO (SPHERE adaptive optics), and radar observations.
 * Small minor planets (<900 km) lack sufficient gravity to reach hydrostatic equilibrium.
 */
const TRIAXIAL_SCALE: Record<string, readonly [number, number, number]> = {
  vesta: [1.0, 0.973, 1.0],      // 286.3 x 278.6 x 223.2 km (flattening 0.2204 scales z to 0.7796)
  psyche: [1.0, 0.856, 0.615],    // 278 x 238 x 171 km M-type metallic ellipsoid
  pallas: [1.0, 0.945, 0.919],    // 272 x 257 x 250 km B-type asteroid
  juno: [1.0, 0.897, 0.759],      // 145 x 130 x 110 km
  eunomia: [1.0, 0.799, 0.696],   // 184 x 147 x 128 km
  hygiea: [1.0, 0.956, 0.933],    // 225 x 215 x 210 km
  davida: [1.0, 0.923, 0.785],
  interamnia: [1.0, 0.954, 0.892],
  sylvia: [1.0, 0.695, 0.667],    // Very elongated 385 x 264 x 230 km
  thisbe: [1.0, 0.918, 0.824],
};

function createTextSprite(text: string, color: string, isMoon: boolean): THREE.Sprite {
  if (typeof document === 'undefined') {
    return new THREE.Sprite(new THREE.SpriteMaterial());
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite(new THREE.SpriteMaterial());

  const fontSize = isMoon ? 19 : 23;
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;

  const padX = isMoon ? 12 : 14;
  const pillHeight = isMoon ? 28 : 32;
  const pillWidth = Math.min(240, Math.max(50, textWidth + padX * 2 + 14));
  const pillX = (canvas.width - pillWidth) / 2;
  const pillY = (canvas.height - pillHeight) / 2;
  const radius = pillHeight / 2;

  // Background rounded rectangle
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, radius);
  } else {
    ctx.rect(pillX, pillY, pillWidth, pillHeight);
  }
  ctx.fillStyle = isMoon ? 'rgba(15, 23, 42, 0.85)' : 'rgba(8, 12, 24, 0.9)';
  ctx.fill();

  // Subtle accent border
  ctx.strokeStyle = color;
  ctx.lineWidth = isMoon ? 1.5 : 2;
  ctx.stroke();

  // Tiny color indicator circle before text
  const dotR = isMoon ? 3 : 3.5;
  const dotX = pillX + padX;
  const dotY = canvas.height / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, dotX + dotR + 6, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return new THREE.Sprite(mat);
}

export class BodyVisual {
  readonly id: string;
  readonly name: string;
  readonly radiusKm: number;
  readonly radiusAu: number;
  readonly flattening: number;
  readonly physical?: PhysicalJson;
  readonly isMoon: boolean;
  readonly parentId?: string;
  readonly triaxialScale: readonly [number, number, number];

  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly ringMesh?: THREE.Mesh;
  readonly labelSprite: THREE.Sprite;

  constructor(opts: BodyVisualOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.radiusKm = opts.radiusKm;
    this.radiusAu = opts.radiusKm / AU_KM;
    this.physical = opts.physical;
    this.flattening = opts.physical?.flattening ?? 0;
    this.isMoon = !!opts.isMoon;
    this.parentId = opts.parentId;
    this.triaxialScale = TRIAXIAL_SCALE[opts.id] ?? [1, 1, 1];

    this.group = new THREE.Group();

    // Geometry: poles along +z, prime meridian along +x (Sun 128x64 to avoid faceting when zoomed)
    const segW = opts.id === 'sun' ? 128 : 64;
    const segH = opts.id === 'sun' ? 64 : 32;
    const geom = new THREE.SphereGeometry(1, segW, segH).rotateX(Math.PI / 2);

    let mat: THREE.Material;
    const texGetter = typeof document !== 'undefined' ? PLANET_TEXTURE_GETTERS[opts.id] : undefined;
    const tex = texGetter ? texGetter() : undefined;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    const maxAniso = Math.max(1, Math.min(8, Math.round(opts.anisotropy ?? 4)));
    if (tex) tex.anisotropy = maxAniso;

    if (opts.id === 'sun') {
      mat = createSunMaterial(tex);
    } else {
      const isMetallic = opts.id === 'psyche';
      const isAsteroid = [
        'ceres', 'vesta', 'pallas', 'hygiea', 'psyche', 'iris', 'juno',
        'eunomia', 'euphrosyne', 'interamnia', 'davida', 'sylvia', 'cybele',
        'camilla', 'thisbe', 'asteroid-52',
      ].includes(opts.id);
      const stdOpts: THREE.MeshStandardMaterialParameters = {
        color: tex ? 0xffffff : opts.color,
        roughness: isMetallic ? 0.38 : isAsteroid ? 0.82 : 0.7,
        metalness: isMetallic ? 0.80 : 0.04,
      };
      if (tex) stdOpts.map = tex;
      mat = new THREE.MeshStandardMaterial(stdOpts);
    }

    this.mesh = new THREE.Mesh(geom, mat);
    // Upgrade to the real surface map once it arrives (procedural stays as fallback).
    if (hasRealTexture(opts.id)) {
      const target = mat as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      loadRealTexture(opts.id, maxAniso).then((real) => {
        if (real && 'map' in target) {
          const old = target.map;
          target.map = real;
          target.needsUpdate = true;
          old?.dispose();
        }
      });
    }
    // Oblateness along the pole (+z) and non-spherical triaxial geometry
    this.mesh.scale.set(
      this.triaxialScale[0],
      this.triaxialScale[1],
      (1 - this.flattening) * this.triaxialScale[2],
    );
    this.group.add(this.mesh);

    // Coronal glow shells (SDO/AIA look: bright inner corona + faint extended halo).
    // Childed to the mesh so they scale strictly with the Sun's disc.
    if (opts.id === 'sun') {
      const inner = new THREE.Mesh(
        new THREE.SphereGeometry(1.18, 32, 16),
        new THREE.MeshBasicMaterial({
          color: 0xffb833,
          transparent: true,
          opacity: 0.28,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      const outer = new THREE.Mesh(
        new THREE.SphereGeometry(1.5, 32, 16),
        new THREE.MeshBasicMaterial({
          color: 0xff8c1a,
          transparent: true,
          opacity: 0.1,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      this.mesh.add(inner, outer);
    }

    // Floating text label sprite
    this.labelSprite = createTextSprite(this.name, opts.color, this.isMoon);
    this.group.add(this.labelSprite);

    // Planetary ring (Saturn, etc.)
    if (opts.physical?.ring) {
      const ringData = opts.physical.ring as { innerKm?: number; outerKm?: number; innerRadiusKm?: number; outerRadiusKm?: number };
      const innerKm = ringData.innerKm ?? ringData.innerRadiusKm ?? 74500;
      const outerKm = ringData.outerKm ?? ringData.outerRadiusKm ?? 140220;
      const rKm = (opts.radiusKm && opts.radiusKm > 0) ? opts.radiusKm : (opts.id === 'saturn' ? 60268 : opts.id === 'uranus' ? 25559 : 24764);
      const innerNorm = innerKm / rKm;
      const outerNorm = outerKm / rKm;
      const g = new THREE.RingGeometry(innerNorm, outerNorm, 192);
      const posAttr = g.attributes.position!;
      const uvAttr = g.attributes.uv!;
      const v = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr as THREE.BufferAttribute, i);
        uvAttr.setXY(
          i,
          (v.length() - innerKm / rKm) / ((outerKm - innerKm) / rKm),
          0.5,
        );
      }
      uvAttr.needsUpdate = true;
      const ringColor = opts.id === 'uranus' ? 0x98c5ce : opts.id === 'neptune' ? 0x658ed1 : 0xd4c49c;
      const ringOpacity = opts.id === 'uranus' ? 0.45 : opts.id === 'neptune' ? 0.35 : 0.85;
      const ringMat = new THREE.MeshStandardMaterial({
        color: ringColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: ringOpacity,
        roughness: 0.8,
      });
      this.ringMesh = new THREE.Mesh(g, ringMat);
      this.group.add(this.ringMesh);
    } else if (opts.id === 'saturn' || opts.id === 'uranus' || opts.id === 'neptune') {
      // Fallback to existing procedural ring
      const ringDef = {
        saturn: { innerRadiusKm: 74500, outerRadiusKm: 140220, color: '#d4c49c', opacity: 0.85 },
        uranus: { innerRadiusKm: 38000, outerRadiusKm: 51149, color: '#98c5ce', opacity: 0.35 },
        neptune: { innerRadiusKm: 41900, outerRadiusKm: 62933, color: '#658ed1', opacity: 0.25 },
      }[opts.id];
      if (ringDef) {
        this.ringMesh = createPlanetaryRing(ringDef, opts.id, opts.radiusKm);
        this.group.add(this.ringMesh);
      }
    }

    // Tag for Raycaster picking
    this.group.userData = { bodyId: opts.id };
    this.mesh.userData = { bodyId: opts.id };
    this.labelSprite.userData = { bodyId: opts.id };
    if (this.ringMesh) this.ringMesh.userData = { bodyId: opts.id };
  }

  /**
   * Update orientation and apparent visual scale.
   * Orientation is computed on the main thread per frame from display.t.
   */
  updateOrientation(
    daysSinceJ2000: number,
    frameAxes?: readonly [number, number, number, number, number, number, number, number, number],
  ): void {
    const rot = this.physical?.rotation;
    if (!rot) return;

    const m = bodyToEcliptic(rot, daysSinceJ2000);

    // If active reference frame has an orientation matrix, compose: axes * M
    if (frameAxes) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let sum = 0;
          for (let k = 0; k < 3; k++) sum += frameAxes[3 * i + k]! * m[3 * k + j]!;
          _orientRes[3 * i + j] = sum;
        }
      }
      _orientMat4.set(
        _orientRes[0]!,
        _orientRes[1]!,
        _orientRes[2]!,
        0,
        _orientRes[3]!,
        _orientRes[4]!,
        _orientRes[5]!,
        0,
        _orientRes[6]!,
        _orientRes[7]!,
        _orientRes[8]!,
        0,
        0,
        0,
        0,
        1,
      );
    } else {
      _orientMat4.set(
        m[0]!,
        m[1]!,
        m[2]!,
        0,
        m[3]!,
        m[4]!,
        m[5]!,
        0,
        m[6]!,
        m[7]!,
        m[8]!,
        0,
        0,
        0,
        0,
        1,
      );
    }
    this.group.quaternion.setFromRotationMatrix(_orientMat4);
  }

  computeScale(
    scaleMode: ScaleMode,
    cameraDistAu: number,
    pixelFactor: number,
    exaggerationFactor = 20,
  ): number {
    if (scaleMode === 'true') {
      return this.radiusAu;
    }
    if (scaleMode === 'exaggerated') {
      return this.radiusAu * Math.max(1, exaggerationFactor);
    }

    // 'pixels' mode: Physically proportional minimum visibility threshold.
    // Instead of forcing every body (Sun, Jupiter, Mercury, Phobos) to the identical flat pixel size,
    // preserve true physical hierarchy using Earth's equatorial radius (6,378.137 km) as the 1.0 baseline.
    const R_EARTH_KM = 6378.137;
    const rRatio = Math.max(0.0001, this.radiusKm / R_EARTH_KM);
    // Smooth power-law scaling preserves clear visual distinction:
    // Sun (~7.15x Earth min pixels, ~28.6px), Jupiter (~2.76x, ~11.0px), Saturn (~2.53x, ~10.1px),
    // Uranus/Neptune (~1.8x, ~7.1px), Earth/Venus (1x, ~4.0px), Mars (~0.77x, ~3.1px),
    // Mercury (~0.67x, ~2.7px), Pluto/Moon (~0.49x, ~1.9px), Phobos/Deimos (~0.08x, ~0.3px).
    const propFactor = Math.pow(rRatio, 0.42);
    const minRadiusAu = cameraDistAu * pixelFactor * propFactor;

    return Math.max(this.radiusAu, minRadiusAu);
  }

  /**
   * Update the 3D floating billboard label.
   * Keeps the label at a fixed, crisp screen pixel height and offsets it above the sphere disc.
   */
  updateLabel(
    cameraDistAu: number,
    visible: boolean,
    visualRadiusAu: number,
    fovDeg: number,
    viewportHeightPx: number,
  ): void {
    if (!this.labelSprite) return;
    if (!visible) {
      this.labelSprite.visible = false;
      return;
    }

    this.labelSprite.visible = true;

    // Height of frustum in AU at this camera distance
    const frustumHeightAu = 2 * cameraDistAu * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
    const auPerPixel = frustumHeightAu / Math.max(1, viewportHeightPx);

    // Target label height in screen pixels
    const targetHeightPx = this.isMoon ? 18 : 22;
    const spriteHeightAu = targetHeightPx * auPerPixel;
    // Canvas is 256x64 (aspect ratio 4:1)
    const spriteWidthAu = spriteHeightAu * 4;

    this.labelSprite.scale.set(spriteWidthAu, spriteHeightAu, 1);

    // Planet/moon apparent screen radius in pixels
    const radiusPx = visualRadiusAu / auPerPixel;

    // Offset in screen pixels: radiusPx + margin (8px) + half sprite height
    const offsetPx = radiusPx + 8 + targetHeightPx / 2;
    // Center Y anchor: normalized relative to sprite height:
    // When center.y is negative, sprite shifts UP in camera view space
    this.labelSprite.center.set(0.5, 0.5 - offsetPx / targetHeightPx);
  }
}


