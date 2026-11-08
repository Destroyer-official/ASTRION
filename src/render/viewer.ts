import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { JD_J2000 } from '@/data/constants';
import type { ReferenceFrame } from '@/frames/types';
import { mapPoint, squash } from '@/frames/transform';
import { GALACTIC_AXES_IN_SIM } from '@/frames/galactic';
import type { SystemState } from '@/physics/types';
import type { History } from '@/sim/history';
import type { SystemModel } from '@/sim/registry';
import { buildTracks } from '@/sim/track';
import { buildGalactoTracks, galactoVertex, VOYAGE_TRAIL_DAYS_MAX, voyageTrailVisible, type GalactoParams } from './galactoTrack';
import { BodyVisual, type ScaleMode } from './bodyVisual';
import { createStarfield } from './starfield';
import { Trail } from './trail';
import { GalaxyVisual } from './galaxyVisual';
import { OortCloudVisual } from './oortCloud';
import { BarycenterVisual } from './barycenterVisual';
import { OrbitPathVisual } from './orbitPathVisual';
import { TrajectoryOverlayVisual } from './trajectoryOverlayVisual';
import type { TrajectoryPoint, GravitationalPullBreakdown, SolarWobbleState } from '@/physics/trajectoryPredictor';
import type { GalacticOrbitState } from '@/physics/galacticPotential';
import { stateToElements, elementsToState } from '@/physics/kepler';

const MIN_PIXEL_RADIUS = 4;
/** Scene units per kpc for the galaxy group. Must match the voyage composer. */
export const GALAXY_UNITS_PER_KPC = 60;

export function easeInOutCubic(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Pure camera-flight pose math (unit-tested): eased interpolation from the
 * start pose toward (target + dir * dist). Zero direction falls back to a
 * default view angle instead of producing NaNs.
 */
export function flightPose(
  fromPos: readonly [number, number, number],
  fromTgt: readonly [number, number, number],
  toTgt: readonly [number, number, number],
  dir: readonly [number, number, number],
  dist: number,
  k: number,
): { pos: [number, number, number]; tgt: [number, number, number] } {
  const e = easeInOutCubic(k);
  const dl = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
  const d: readonly [number, number, number] =
    dl < 1e-12 ? [0, -0.75, 0.65] : [dir[0]! / dl, dir[1]! / dl, dir[2]! / dl];
  const px = toTgt[0]! + d[0]! * dist,
    py = toTgt[1]! + d[1]! * dist,
    pz = toTgt[2]! + d[2]! * dist;
  const L = (a: number, b: number) => a + (b - a) * e;
  return {
    pos: [L(fromPos[0]!, px), L(fromPos[1]!, py), L(fromPos[2]!, pz)],
    tgt: [L(fromTgt[0]!, toTgt[0]!), L(fromTgt[1]!, toTgt[1]!), L(fromTgt[2]!, toTgt[2]!)],
  };
}

/**
 * Projected body data for screen-space hit testing.
 * Supports body discs (including large planets and stars), floating labels, and sub-pixel moons.
 */
export interface ProjectedBodyPick {
  id: string;
  x: number;
  y: number;
  dist: number;
  visible: boolean;
  radiusPx?: number;
  labelVisible?: boolean;
  labelY?: number;
  labelHalfW?: number;
  labelHalfH?: number;
  isMoon?: boolean;
}

/**
 * Screen-space body picking (unit-tested).
 * Supports clicking the body disc (anywhere on large planets or the Sun),
 * clicking floating name labels, or proximity clicking for tiny sub-pixel moons.
 * Prioritizes foreground bodies and direct hits.
 */
export function pickBodyAt(
  px: number,
  py: number,
  projected: ReadonlyArray<ProjectedBodyPick>,
  thresholdPx = 24,
): string | null {
  let best: string | null = null;
  let bestPx = thresholdPx;
  let bestDist = Infinity;
  let bestIsDirectHit = false;

  for (const c of projected) {
    if (!c.visible) continue;

    const rPx = Math.max(0, c.radiusPx ?? 0);
    const dPx = Math.hypot(c.x - px, c.y - py);
    const hitDisc = dPx <= Math.max(thresholdPx, rPx + 8);

    let hitLabel = false;
    let dLabel = Infinity;
    if (c.labelVisible && c.labelY !== undefined) {
      const hw = (c.labelHalfW ?? 44) + 6;
      const hh = (c.labelHalfH ?? 12) + 6;
      const dx = Math.abs(px - c.x);
      const dy = Math.abs(py - c.labelY);
      if (dx <= hw && dy <= hh) {
        hitLabel = true;
        dLabel = Math.hypot(dx, dy);
      }
    }

    if (!hitDisc && !hitLabel) continue;

    const directHit = (rPx > 0 && dPx <= rPx) || hitLabel;
    const effectivePx = hitLabel ? Math.min(dPx, dLabel) : dPx;

    if (best === null) {
      best = c.id;
      bestPx = effectivePx;
      bestDist = c.dist;
      bestIsDirectHit = directHit;
    } else {
      const cIsNearer = c.dist < bestDist - 1e-4;
      const cIsSameDepth = Math.abs(c.dist - bestDist) <= 1e-4;
      const cIsFurther = c.dist > bestDist + 1e-4;

      if (c.isMoon && directHit && !bestIsDirectHit) {
        best = c.id;
        bestPx = effectivePx;
        bestDist = c.dist;
        bestIsDirectHit = directHit;
      } else if (cIsNearer && (effectivePx <= bestPx + 10 || directHit)) {
        best = c.id;
        bestPx = effectivePx;
        bestDist = c.dist;
        bestIsDirectHit = directHit;
      } else if (cIsSameDepth && (effectivePx < bestPx - 2 || (Math.abs(effectivePx - bestPx) <= 2 && c.dist < bestDist))) {
        best = c.id;
        bestPx = effectivePx;
        bestDist = c.dist;
        bestIsDirectHit = directHit;
      } else if (!cIsFurther && directHit && !bestIsDirectHit) {
        best = c.id;
        bestPx = effectivePx;
        bestDist = c.dist;
        bestIsDirectHit = directHit;
      }
    }
  }
  return best;
}

/**
 * Post-click framing distance (unit-tested): 6x the true radius fills ~1/3 of
 * a 50-degree field of view in every scale mode (at 6R the pixel-minimum
 * never triggers, so visual == true radius). The old 30x left every planet
 * under 8% of screen height and clamped Phobos to an arbitrary 1500 km.
 */
export function focusFramingDist(radiusAu: number): number {
  if (!Number.isFinite(radiusAu) || radiusAu <= 0) return 0.01;
  return Math.max(radiusAu * 6, 1e-7);
}

/** Multiplicative arrival-distance adjust per wheel notch (unit-tested). */
export function wheelFlightFactor(deltaY: number, deltaMode: number): number {
  return Math.exp(-deltaY * (deltaMode === 1 ? 0.04 : 0.0012));
}
/**
 * Zoom continuum for galaxy views. The kpc-scale sun marker (glow ~14 units)
 * and the true AU-scale solar system hand off to each other by camera
 * distance, so zooming into the Sun always arrives somewhere instead of
 * vanishing inside the marker while planets stay hidden by preset rules.
 */
export function galacticDetail(camDistToSun: number): {
  /** kpc marker yields to the real sun mesh up close */
  showMarker: boolean;
  /** planets, moons, rings, trails and labels resolve */
  showSystem: boolean;
} {
  return {
    showMarker: camDistToSun >= 25,
    showSystem: camDistToSun < 300,
  };
}

export interface ViewState {
  mode?: 'solar' | 'galaxy';
  preset?: string | null;
  presetCategory?: 'galaxy' | 'stars' | 'solar' | 'asteroids' | 'moons' | 'planets' | 'visits' | 'moonVisits';
  showMilkyWay?: boolean;
  showOortCloud?: boolean;
  showGalacticHalo?: boolean;
  showLabels?: boolean;
  showOrbitPaths?: boolean;
  galaxyState?: GalacticOrbitState;
  galaxyCamera?: string;
  galaxyZExag?: number;
  frame: ReferenceFrame;
  focus: number; // body index, -1 = barycenter
  trails: boolean;
  trailDays: number;
  history: History;
  compress?: number;
  scaleMode?: ScaleMode;
  scaleExaggeration?: number;
  selected?: string | null;
  /**
   * Unified voyage mode: solar-system bodies are composed at the Sun's true
   * galactic position (planets/moons exaggerated around it) with the camera
   * locked to Sgr A*, so the whole system visibly voyages together.
   */
  galactocentric?: boolean;
  /** Scene units per AU of heliocentric offset in voyage mode (default 2). */
  helioExag?: number;
}

export interface ViewerOptions {
  onSelect?(id: string | null, isZoom?: boolean): void;
  onZoomTargetReached?(id: string): void;
}

export function createViewer(
  container: HTMLElement,
  model: SystemModel,
  trailCapacity: number,
  options?: ViewerOptions,
) {
  const getWidth = () => container.clientWidth || window.innerWidth || 800;
  const getHeight = () => container.clientHeight || window.innerHeight || 600;

  // Production robustness: no WebGL (or a lost GPU context) must never yield
  // a blank page. Fail loud and legible instead.
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  } catch {
    container.innerHTML =
      '<div style="color:#fff;padding:24px;font-family:sans-serif">' +
      'WebGL is unavailable in this browser, so the 3D simulator cannot start. ' +
      'Enable hardware acceleration or try a recent Chrome, Edge, Firefox or Safari.' +
      '</div>';
    throw new Error('WebGL unavailable');
  }
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const note = document.createElement('div');
    note.style.cssText =
      'position:absolute;top:12px;left:50%;transform:translateX(-50%);' +
      'background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:8px;' +
      'font:13px sans-serif;z-index:10;';
    note.textContent = 'GPU context lost — reload the page to resume the simulation.';
    container.appendChild(note);
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(getWidth(), getHeight());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Near 1e-7 AU (~15 m) to Far 5e6 AU for seamless zooming down to small moons and out to 100,000 AU Oort cloud
  const camera = new THREE.PerspectiveCamera(50, getWidth() / getHeight(), 1e-7, 5e6);
  camera.up.set(0, 0, 1);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1e-7;
  controls.maxDistance = 500_000;

  function onResize() {
    const w = getWidth();
    const h = getHeight();
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  }
  window.addEventListener('resize', onResize);

  // 1. Photorealistic celestial sphere starfield & Milky Way band
  const starfieldGroup = createStarfield(45000);
  scene.add(starfieldGroup);
  const _starRotMat = new THREE.Matrix4();

  // 1b. NASA Eyes-style closed orbital paths for all planets and moons
  const orbitPaths = new OrbitPathVisual(model);
  scene.add(orbitPaths.group);

  // 2. Lighting: sun pointlight + small ambient (0.02) for realistic dark night sides
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.02);
  scene.add(ambientLight);

  const sunLight = new THREE.PointLight(0xffffff, 3.0, 0, 0); // decay 0
  scene.add(sunLight);

  // 3. Body visuals
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const visualById = new Map<string, BodyVisual>();
  const visuals: BodyVisual[] = model.ids.map((id, i) => {
    const bodyDef = model.bodies?.find((b) => b.id === id);
    const parentId = (bodyDef as { parent?: string } | undefined)?.parent;
    const vis = new BodyVisual({
      id,
      name: model.names[i]!,
      radiusKm: model.radiusKm[i]!,
      color: model.colors[i]!,
      physical: model.physicalMap[id],
      isMoon: !!parentId,
      parentId,
      anisotropy: maxAnisotropy,
    });
    scene.add(vis.group);
    visualById.set(id, vis);
    return vis;
  });

  // Smooth camera flights: every view change glides instead of snapping. A
  // flight re-reads its target provider each frame (so it can follow an
  // orbiting body), and any user grab cancels it silently.
  interface Flight {
    targetId?: string;
    t0: number;
    dur: number;
    getTarget: () => THREE.Vector3 | null;
    dist: number;
    dir: THREE.Vector3;
    fromPos: THREE.Vector3;
    fromTgt: THREE.Vector3;
    /** Pin the tracked point on arrival (rigid camera translate, no visual pop). */
    pinTargetOnDone: boolean;
    onDone: ((finalTarget: THREE.Vector3 | null) => void) | null;
    lastTgt: THREE.Vector3 | null;
  }
  let flight: Flight | null = null;
  /**
   * Held Sgr A* anchor for voyage mode. While set, the galaxy group is NOT
   * re-anchored to the heliocentric sun, so the Sun genuinely travels through
   * a fixed galaxy instead of the galaxy wheeling around a pinned sun.
   */
  let galactoAnchor: THREE.Vector3 | null = null;

  function flyTo(
    getTarget: () => THREE.Vector3 | null,
    dist: number,
    opts?: {
      targetId?: string;
      dir?: readonly [number, number, number];
      duration?: number;
      pinTargetOnDone?: boolean;
      onDone?: ((finalTarget: THREE.Vector3 | null) => void) | null;
    },
  ): void {
    const rawDir = opts?.dir
      ? new THREE.Vector3(opts.dir[0], opts.dir[1], opts.dir[2])
      : camera.position.clone().sub(controls.target);
    if (rawDir.lengthSq() < 1e-12) rawDir.set(0, -0.75, 0.65);
    rawDir.normalize();
    flight = {
      targetId: opts?.targetId,
      t0: performance.now(),
      dur: (opts?.duration ?? 1.4) * 1000,
      getTarget,
      dist,
      dir: rawDir,
      fromPos: camera.position.clone(),
      fromTgt: controls.target.clone(),
      pinTargetOnDone: opts?.pinTargetOnDone ?? false,
      onDone: opts?.onDone ?? null,
      lastTgt: null,
    };
  }

  /** Fly the camera to a body (tracking it); onDone runs at arrival. */
  function flyToFocus(
    id: string,
    dist: number,
    opts?: {
      dir?: readonly [number, number, number];
      duration?: number;
      pinTargetOnDone?: boolean;
      onDone?: ((finalTarget: THREE.Vector3 | null) => void) | null;
    },
  ): void {
    const vis = visualById.get(id);
    if (!vis) {
      opts?.onDone?.(null);
      return;
    }
    flyTo(() => vis.group.position.clone(), dist, {
      ...opts,
      targetId: id,
    });
  }

  /** Drop any in-progress flight without running its completion (or optionally execute completion). */
  function cancelFlight(runCompletion = false): void {
    if (flight) {
      const cb = flight.onDone;
      const f = flight;
      flight = null;
      if (runCompletion && cb) cb(f.lastTgt);
    }
  }

  /** Current Sgr A* world position (galaxy group origin). */
  function sgrAWorldPosition(): THREE.Vector3 {
    return galaxyVisual.group.position.clone();
  }

  const _pickV = new THREE.Vector3();
  const _pickRaycaster = new THREE.Raycaster();
  const _pickMouse = new THREE.Vector2();
  let latestPickTargets: ProjectedBodyPick[] = [];

  function pickAt(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const w = rect.width || 1;
    const h = rect.height || 1;

    // 1. Raycast direct hits on 3D meshes (Sun, planets, moons, rings)
    _pickMouse.x = (px / w) * 2 - 1;
    _pickMouse.y = -(py / h) * 2 + 1;
    _pickRaycaster.setFromCamera(_pickMouse, camera);
    const hits = _pickRaycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && obj !== scene) {
        if (obj.userData && obj.userData.bodyId) {
          return obj.userData.bodyId;
        }
        obj = obj.parent;
      }
    }

    // 2. Check against latest rendered positions (exact screen coordinates of discs & labels) with generous 40px threshold
    if (latestPickTargets.length > 0) {
      const picked = pickBodyAt(px, py, latestPickTargets, 40);
      if (picked) return picked;
    }

    // 3. Fallback on-demand projection
    camera.updateMatrixWorld();
    const fallbackTargets: ProjectedBodyPick[] = [];
    for (const vis of visuals) {
      if (!vis.group.visible) continue;
      _pickV.copy(vis.group.position);
      const dist = camera.position.distanceTo(vis.group.position);
      _pickV.applyMatrix4(camera.matrixWorldInverse);
      if (_pickV.z > -1e-9) continue;
      _pickV.copy(vis.group.position).project(camera);
      fallbackTargets.push({
        id: vis.id,
        x: ((_pickV.x + 1) / 2) * w,
        y: ((-_pickV.y + 1) / 2) * h,
        dist,
        visible: true,
        radiusPx: 35,
        isMoon: vis.isMoon,
      });
    }

    // Include galactic markers if in deep space / galaxy overview
    if (galaxyVisual.group.visible) {
      galaxyVisual.getSunPosition(_pickV);
      galaxyVisual.group.localToWorld(_pickV);
      const distSun = camera.position.distanceTo(_pickV);
      _pickV.applyMatrix4(camera.matrixWorldInverse);
      if (_pickV.z <= -1e-9) {
        galaxyVisual.getSunPosition(_pickV);
        galaxyVisual.group.localToWorld(_pickV);
        _pickV.project(camera);
        fallbackTargets.push({
          id: 'sun',
          x: ((_pickV.x + 1) / 2) * w,
          y: ((-_pickV.y + 1) / 2) * h,
          dist: distSun,
          visible: true,
          radiusPx: 45,
        });
      }

      galaxyVisual.getSgrAPosition(_pickV);
      const distSgr = camera.position.distanceTo(_pickV);
      _pickV.applyMatrix4(camera.matrixWorldInverse);
      if (_pickV.z <= -1e-9) {
        galaxyVisual.getSgrAPosition(_pickV);
        _pickV.project(camera);
        fallbackTargets.push({
          id: 'sgra',
          x: ((_pickV.x + 1) / 2) * w,
          y: ((-_pickV.y + 1) / 2) * h,
          dist: distSgr,
          visible: true,
          radiusPx: 50,
        });
      }
    }

    return pickBodyAt(px, py, fallbackTargets, 40);
  }

  let downPos: { x: number; y: number; button: number } | null = null;
  let downDragged = false;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY, button: e.button };
    downDragged = false;
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (downPos) {
      // 14px threshold allows minor finger/mouse jitter without canceling click-to-select
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 14) {
        if (!downDragged) {
          downDragged = true;
          flight = null; // genuine drag takes the camera; a silent cancel, no focus swap
        }
      }
    } else {
      // Hover feedback: change cursor to pointer when over any celestial body
      const hoveredId = pickAt(e.clientX, e.clientY);
      renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'default';
    }
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    const wasClick = downPos !== null && downPos.button === 0 && e.button === 0 && !downDragged;
    downPos = null;
    if (!wasClick) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) options?.onSelect?.(id);
  });

  renderer.domElement.addEventListener('dblclick', (e) => {
    const id = pickAt(e.clientX, e.clientY);
    if (id) options?.onSelect?.(id);
  });

  renderer.domElement.addEventListener('pointercancel', () => {
    downPos = null;
  });

  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      // 1. If currently in a camera flight heading to a target body:
      if (flight) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const factor = wheelFlightFactor(e.deltaY, e.deltaMode);
        flight.dist = Math.max(1e-7, Math.min(1e7, flight.dist * factor));
        flight.dur = Math.max(flight.dur, 350);
        return;
      }
    },
    { capture: true, passive: false },
  );

  const trails = model.ids.map((_, i) => {
    const t = new Trail(trailCapacity + 1, model.colors[i]!);
    scene.add(t.line);
    return t;
  });
  const trailData = trails.map((t) => t.data);

  // Solar System Barycenter (SSB) - the "empty point" around which the Sun wobbles
  const baryVisual = new BarycenterVisual();
  scene.add(baryVisual.group);

  // Galaxy visual
  const galaxyVisual = new GalaxyVisual();
  scene.add(galaxyVisual.group);

  // Oort cloud visual
  const oortVisual = new OortCloudVisual();
  scene.add(oortVisual.group);

  // NASA Trajectory, Pull Vectors & Solar Wobble Loop 3D Overlay
  const trajOverlayVisual = new TrajectoryOverlayVisual();
  scene.add(trajOverlayVisual.group);

  let cachedTrajPoints: TrajectoryPoint[] | null = null;
  let cachedGravityPull: GravitationalPullBreakdown | null = null;
  let cachedSolarWobble: SolarWobbleState | null = null;

  function setView(dir: readonly [number, number, number], distanceAu: number, target?: THREE.Vector3): void {
    if (target) {
      controls.target.copy(target);
      camera.position.set(
        target.x + dir[0] * distanceAu,
        target.y + dir[1] * distanceAu,
        target.z + dir[2] * distanceAu,
      );
    } else {
      camera.position.set(dir[0], dir[1], dir[2]).setLength(distanceAu);
      controls.target.set(0, 0, 0);
    }
    controls.update();
  }
  setView([0, -0.8, 0.6], 35);

  function getCameraDistance(): number {
    return camera.position.distanceTo(controls.target);
  }

  function setCameraDistance(distanceAu: number): void {
    const target = controls.target;
    const offset = new THREE.Vector3().subVectors(camera.position, target);
    if (offset.lengthSq() < 1e-18) {
      offset.set(0, -0.8, 0.6);
    }
    const safeDist = Math.max(1e-7, Math.min(500000, distanceAu));
    offset.setLength(safeDist);
    camera.position.addVectors(target, offset);
    const origDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = origDamping;
  }

  /**
   * Adaptive quality level 0..2 (0 = full). Drops pixel ratio and galaxy star
   * counts when the frame rate sags, so weak machines stay smooth.
   */
  function setQuality(level: number): void {
    const q = Math.max(0, Math.min(2, Math.round(level)));
    renderer.setPixelRatio(q === 0 ? Math.min(devicePixelRatio, 2) : q === 1 ? Math.min(devicePixelRatio, 1.5) : 1);
    onResize();
    galaxyVisual.setStarFraction(q === 0 ? 1 : q === 1 ? 0.6 : 0.3);
  }

  function setGalaxyOrbitPath(path: Float32Array): void {
    galaxyVisual.setOrbitPath(path);
  }

  /** Install the live Vc(R) curve so disk stars co-rotate with the integrated Sun. */
  function setGalaxyRotationCurve(vcKms: (rKpc: number) => number): void {
    galaxyVisual.setRotationCurve(vcKms);
  }

  function updateGalaxyTransform(frame: ReferenceFrame, state?: GalacticOrbitState): THREE.Vector3 {
    const S_GAL = GALAXY_UNITS_PER_KPC;
    const [GX_SIM, GY_SIM, GZ_SIM] = GALACTIC_AXES_IN_SIM;

    const mRotEcl = new THREE.Matrix4().set(
      GX_SIM[0]!, GY_SIM[0]!, GZ_SIM[0]!, 0,
      GX_SIM[1]!, GY_SIM[1]!, GZ_SIM[1]!, 0,
      GX_SIM[2]!, GY_SIM[2]!, GZ_SIM[2]!, 0,
      0,          0,          0,          1,
    );

    let mRotScene = mRotEcl;
    if (frame.axes) {
      const frameAxes = frame.axes;
      const mFrame = new THREE.Matrix4().set(
        frameAxes[0]!, frameAxes[1]!, frameAxes[2]!, 0,
        frameAxes[3]!, frameAxes[4]!, frameAxes[5]!, 0,
        frameAxes[6]!, frameAxes[7]!, frameAxes[8]!, 0,
        0,             0,             0,             1,
      );
      mRotScene = mFrame.clone().multiply(mRotEcl);
    }

    const zExag = galaxyVisual.getVerticalExaggeration();
    const sunGalX = state?.x ?? -8.2;
    const sunGalY = state?.y ?? 0;
    const sunGalZ = (state?.z ?? 0.0208) * zExag;

    const sunGal = new THREE.Vector3(sunGalX, sunGalY, sunGalZ).multiplyScalar(S_GAL);
    sunGal.applyMatrix4(mRotScene);

    const sunScenePos = visuals[0] ? visuals[0].group.position : new THREE.Vector3();
    const galPos = sunScenePos.clone().sub(sunGal);

    galaxyVisual.group.position.copy(galPos);
    galaxyVisual.group.rotation.setFromRotationMatrix(mRotScene);
    galaxyVisual.group.scale.set(S_GAL, S_GAL, S_GAL);

    if (state) {
      galaxyVisual.update(state);
    }

    return galPos;
  }

  function setGalaxyView(
    viewType: string,
    frame?: ReferenceFrame,
    state?: GalacticOrbitState,
    _zExag = 1,
  ): void {
    // Determine target Sagittarius A* position strictly in the given frame
    let sgrPos: THREE.Vector3;
    if (frame) {
      sgrPos = updateGalaxyTransform(frame, state);
    } else if (galaxyVisual.group.position.lengthSq() > 10) {
      sgrPos = galaxyVisual.group.position.clone();
    } else {
      // Default fallback: galactic-aligned frame where Sgr A* is at (+492, 0, 0)
      sgrPos = new THREE.Vector3(492.0, 0, 0);
    }

    if (viewType === 'face-on') {
      // Overhead perspective with 20° tilt away from vertical to avoid gimbal singularity with camera.up = (0, 0, 1)
      camera.position.set(sgrPos.x, sgrPos.y - 800, sgrPos.z + 2500);
      controls.target.copy(sgrPos);
    } else if (viewType === 'edge-on') {
      camera.position.set(sgrPos.x, sgrPos.y - 2600, sgrPos.z + 50);
      controls.target.copy(sgrPos);
    } else if (viewType === 'follow-sun') {
      const sunPos = visuals[0] ? visuals[0].group.position : new THREE.Vector3();
      controls.target.copy(sunPos);
      camera.position.set(sunPos.x + 20, sunPos.y - 45, sunPos.z + 25);
    } else if (viewType === 'sun-orion') {
      const sunPos = visuals[0] ? visuals[0].group.position : new THREE.Vector3();
      controls.target.copy(sunPos);
      // Perspective looking from outer galaxy past the Sun toward Sagittarius A*
      camera.position.set(sunPos.x - 140, sunPos.y - 280, sunPos.z + 180);
    } else if (viewType === 'sgra') {
      controls.target.copy(sgrPos);
      camera.position.set(sgrPos.x, sgrPos.y - 350, sgrPos.z + 120);
    } else {
      // Perspective overview: full 18 kpc rotating spiral disk and golden nucleus
      camera.position.set(sgrPos.x - 1200, sgrPos.y - 1600, sgrPos.z + 1800);
      controls.target.copy(sgrPos);
    }
    controls.update();
  }

  /**
   * Voyage camera: locked to Sgr A* (the galaxy group origin) while the Sun
   * travels. Unlike follow-sun presets, the Sun visibly moves here.
   */
  function setGalactoView(dir: readonly [number, number, number], distanceAu: number): void {
    const sgra = galaxyVisual.group.position.clone();
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    controls.target.copy(sgra);
    camera.position.set(sgra.x + d.x * distanceAu, sgra.y + d.y * distanceAu, sgra.z + d.z * distanceAu);
    controls.update();
  }

  const p: [number, number, number] = [0, 0, 0];
  const o: [number, number, number] = [0, 0, 0];
  const f: [number, number, number] = [0, 0, 0];
  const w: [number, number, number] = [0, 0, 0];

  function render(s: SystemState, v: ViewState): void {
    const camDistToSun = visuals[0] ? camera.position.distanceTo(visuals[0]!.group.position) : camera.position.length();
    const isGalFrame = v.frame.id === 'galactic-aligned' || v.frame.id === 'galactic' || v.presetCategory === 'galaxy';
    const isGalactoMode = v.galactocentric || isGalFrame;
    const isGalacticOverview = (v.presetCategory === 'galaxy' && v.frame.id !== 'galactic') || (camDistToSun > 400 && v.frame.id !== 'galactic');
    const detail = galacticDetail(camDistToSun);

    // Accurate Solar System Continuum:
    // The true physical solar system (real Sun, planets, Keplerian orbit paths, and trails)
    // remains continuously visible whenever viewing the solar system (within 2,500 AU or in galactocentric/voyage mode),
    // eliminating unphysical oversized yellow ball placeholders.
    const showAccurateSystem = detail.showSystem || isGalactoMode || camDistToSun < 2500;

    const showLocalSun = showAccurateSystem || !isGalacticOverview;
    visuals[0]!.group.visible = showLocalSun;
    sunLight.visible = true;

    const ax = v.frame.axes;
    v.frame.origin(s.t, s.gm, s.pos, 0, o);

    if (v.focus >= 0) {
      mapPoint(ax, o, s.pos[3 * v.focus]!, s.pos[3 * v.focus + 1]!, s.pos[3 * v.focus + 2]!, f);
    } else {
      mapPoint(ax, o, 0, 0, 0, f);
    }

    // Voyage composition: anchor the galaxy group first so composed bodies and
    // trails coincide exactly with the galaxy sun-marker (same transform).
    const sunIdx = model.ids.indexOf('sun');
    const isGalacto = v.galactocentric || v.presetCategory === 'galaxy' || v.frame.id === 'galactic-aligned' || v.frame.id === 'galactic';
    const gal = isGalacto ? v.galaxyState : undefined;
    let galacto: {
      params: GalactoParams;
    } | null = null;
    if (isGalacto && gal) {
      if (!galactoAnchor) {
        updateGalaxyTransform(v.frame, gal);
        galactoAnchor = galaxyVisual.group.position.clone();
      } else {
        galaxyVisual.update(gal);
      }
      galaxyVisual.group.updateWorldMatrix(true, false);
      const zEx = v.galaxyZExag ?? 1;
      galacto = {
        params: {
          sunGalKpc: [gal.x, gal.y, gal.z * zEx],
          velGalKms: [gal.vx, gal.vy, gal.vz],
          unitsPerKpc: GALAXY_UNITS_PER_KPC,
          helioExag: v.helioExag ?? 2,
          stretch: 1 / Math.max(v.compress ?? 1, 1e-6),
          matWorld: Float64Array.from(galaxyVisual.group.matrixWorld.elements),
        },
      };
    } else {
      // Leaving voyage mode: release the held Sgr A* anchor so normal views
      // resume re-anchoring the galaxy to the heliocentric sun.
      galactoAnchor = null;
    }
    const scratch = new Float32Array(3);

    const height = renderer.domElement.clientHeight || renderer.domElement.height || 600;
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * MIN_PIXEL_RADIUS) / height;
    const kMoon = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2) / height;
    const daysSinceJ2000 = model.epochJd - JD_J2000 + s.t;
    const scaleMode = v.scaleMode ?? 'pixels';
    const scaleExag = v.scaleExaggeration ?? 20;

    const focusId = v.focus >= 0 ? model.ids[v.focus] : undefined;
    const focusParent = focusId
      ? (model.bodies?.find((b) => b.id === focusId) as { parent?: string } | undefined)?.parent ?? focusId
      : undefined;

    const width = renderer.domElement.clientWidth || renderer.domElement.width || 800;
    const bodyDists = new Float64Array(s.n);
    const bodyVisualRadii = new Float64Array(s.n);
    const candidateLabels = new Array<boolean>(s.n).fill(false);

    for (let i = 0; i < s.n; i++) {
      mapPoint(ax, o, s.pos[3 * i]!, s.pos[3 * i + 1]!, s.pos[3 * i + 2]!, p);
      const vis = visuals[i]!;

      // In galactic overview scale, individual planets (Mercury..Neptune) and the local Sun are sub-microscopic dots.
      // Hide their individual 3D meshes and labels only at deep galactic scales (> 2,500 AU).
      if (isGalacticOverview && !showAccurateSystem) {
        vis.group.visible = false;
        vis.updateLabel(1000, false, 0, camera.fov, height);
        continue;
      }
      vis.group.visible = true;

      if (galacto) {
        // Voyage mode: exact contemporaneous heliocentric offset (scaled)
        // around the true galactic Sun. Drift is zero at the live moment.
        galactoVertex(galacto.params, sunIdx, s.t, s.t, s.pos, 0, i, scratch, 0);
        vis.group.position.set(scratch[0]!, scratch[1]!, scratch[2]!);
      } else {
        squash(v.frame.travelDir, v.compress ?? 1, p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!, w);
        vis.group.position.set(w[0]!, w[1]!, w[2]!);
      }

      if (i === 0) {
        sunLight.position.copy(vis.group.position);
      }

      // Orientation computed analytically on main thread each frame from s.t
      vis.updateOrientation(daysSinceJ2000, ax ?? undefined);

      // Apparent visual radius calculation
      const dist = camera.position.distanceTo(vis.group.position);
      let visualRadius = vis.computeScale(scaleMode, dist, vis.isMoon ? kMoon : k, scaleExag);

      // NASA Flight-Grade Adaptive Proximity Blending & Anti-Engulfment Capping:
      // Even in visible enhancement or exaggerated scale mode, strictly prevent unphysical swelling that would engulf orbits
      // (e.g. Sun swallowing Mercury, Jupiter swallowing rings/moons, Saturn swallowing rings/Mimas,
      //  Mars swallowing Phobos, Pluto swallowing its mutual barycentric orbit).
      const MAX_PHYSICAL_CLEARANCE_AU: Record<string, number> = {
        sun: 0.015,         // 0.015 AU (~2.2M km) -> Mercury perihelion (0.3075 AU) is >20x outside
        jupiter: 0.000478,  // Strict true scale (71,492 km): rings (92,000 km) & Metis (128,000 km) 100% clear
        saturn: 0.000403,   // Strict true scale (60,268 km): rings (74,500 km) & Mimas (185,500 km) 100% clear
        uranus: 0.000171,   // Strict true scale (25,559 km): rings (26,840 km) & Cordelia (49,750 km) 100% clear
        neptune: 0.000165,  // Strict true scale (24,764 km): rings (41,900 km) & Naiad (48,227 km) 100% clear
        earth: 0.00025,     // ~37,000 km -> Moon (363,300 km) is >9.7x outside
        venus: 0.00025,     // ~37,000 km
        mars: 0.00002266,   // Strict true scale (3,389.5 km): Phobos (9,376 km) is ALWAYS 2.76x outside!
        mercury: 0.00015,   // ~22,000 km
        pluto: 0.00000794,  // Strict true scale (1,188.3 km): Pluto-Charon barycenter orbit (2,131.4 km) is ALWAYS 1.79x outside!
        ceres: 0.00002,
        vesta: 0.000015,
        pallas: 0.000015,
        hygiea: 0.000015,
      };

      const maxCap = vis.isMoon
        ? Math.max(vis.radiusAu, 0.000008)
        : (MAX_PHYSICAL_CLEARANCE_AU[vis.id] ?? 0.00025);

      // 1. Never exceed physical clearance threshold under ANY scale mode (pixels or exaggerated)
      visualRadius = Math.max(vis.radiusAu, Math.min(visualRadius, maxCap));

      // 2. NASA Eyes Standard: Smoothly blend to 100% true physical scale (1:1) when approaching or inspecting a planet or moon
      if (scaleMode !== 'true') {
        const isGiant = ['jupiter', 'saturn', 'uranus', 'neptune'].includes(vis.id);
        const isTarget = vis.id === v.selected || vis.id === focusId || (vis.parentId && (vis.parentId === v.selected || vis.parentId === focusId));
        const dOuter = vis.isMoon ? 0.005 : isGiant ? 0.20 : 0.04;
        const dInner = vis.isMoon ? 0.0002 : isGiant ? 0.02 : 0.004;
        const blendRange = isTarget ? dOuter * 3 : dOuter;
        if (dist < blendRange) {
          const alpha = Math.min(1.0, Math.max(0.0, (dist - dInner) / Math.max(1e-12, blendRange - dInner)));
          visualRadius = (1 - alpha) * vis.radiusAu + alpha * visualRadius;
        }
      }

      bodyDists[i] = dist;
      bodyVisualRadii[i] = visualRadius;

      // Apply scale: radius along x and y, oblate radius along z
      vis.mesh.scale.set(visualRadius, visualRadius, visualRadius * (1 - vis.flattening));
      if (vis.ringMesh) {
        vis.ringMesh.scale.set(visualRadius, visualRadius, visualRadius);
      }

      // Candidate label filtering
      if (v.showLabels !== false) {
        if (!v.galactocentric && ((v.presetCategory === 'galaxy' && camDistToSun > 300) || camDistToSun > 400)) {
          if (i === 0 || vis.id === v.selected || vis.id === focusId) candidateLabels[i] = true;
        } else if (v.galactocentric) {
          // In voyage view (corkscrew), only label major bodies (omit moons to avoid clumping)
          if (!vis.isMoon || vis.id === v.selected || vis.id === focusId) candidateLabels[i] = true;
        } else if (vis.isMoon && vis.parentId) {
          const parentVis = visualById.get(vis.parentId);
          if (parentVis) {
            const camDistToParent = camera.position.distanceTo(parentVis.group.position);
            const camDistToMoon = camera.position.distanceTo(vis.group.position);
            // Show moon label when the system is approached (0.35 AU of the
            // parent) or the camera is right at the moon (0.05 AU), so a
            // close-up moon visit always names its target; focused/selected
            // moons always show regardless of distance.
            if (camDistToParent <= 0.35 || camDistToMoon <= 0.05 || vis.id === v.selected || vis.id === focusId) {
              candidateLabels[i] = true;
            }
          }
        } else {
          candidateLabels[i] = true;
        }
      }
    }

    // Screen-space label collision avoidance and decluttering
    const placedBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    const labelPriority = (idx: number): number => {
      const vis = visuals[idx]!;
      if (v.selected && vis.id === v.selected) return 1000;
      if (focusId && vis.id === focusId) return 600;
      if (idx === 0) return 400; // Sun
      if (!vis.isMoon) {
        const order = ['jupiter', 'saturn', 'earth', 'mars', 'venus', 'mercury', 'uranus', 'neptune', 'pluto'];
        const oIdx = order.indexOf(vis.id);
        return oIdx >= 0 ? 300 - oIdx * 10 : 150;
      }
      return 50; // Moons
    };

    const labelOrder = Array.from({ length: s.n }, (_, i) => i).sort(
      (a, b) => labelPriority(b) - labelPriority(a),
    );

    const _vProj = new THREE.Vector3();
    const finalLabelVisible = new Array<boolean>(s.n).fill(false);

    // Track the screen position and visual radius of the Sun for occlusion checks
    let sunSx = -9999;
    let sunSy = -9999;
    let sunRadPx = 0;
    if (visuals[0]) {
      _vProj.copy(visuals[0]!.group.position).project(camera);
      if (_vProj.z >= -1.0 && _vProj.z <= 1.0) {
        sunSx = ((_vProj.x + 1) / 2) * width;
        sunSy = ((-_vProj.y + 1) / 2) * height;
        const frustumH = 2 * bodyDists[0]! * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const auPerPx = frustumH / Math.max(1, height);
        sunRadPx = bodyVisualRadii[0]! / Math.max(1e-12, auPerPx);
      }
    }

    for (const idx of labelOrder) {
      if (!candidateLabels[idx]) continue;
      const vis = visuals[idx]!;
      _vProj.copy(vis.group.position).project(camera);

      // Frustum check: reject if behind camera
      if (_vProj.z > 1.0 || _vProj.z < -1.0) continue;

      const sx = ((_vProj.x + 1) / 2) * width;
      const sy = ((-_vProj.y + 1) / 2) * height;

      if (sx < -60 || sx > width + 60 || sy < -30 || sy > height + 30) continue;

      // Compute actual screen position of the billboard label (which is offset above the body)
      const frustumHeightAu = 2 * bodyDists[idx]! * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const auPerPixel = frustumHeightAu / Math.max(1, height);
      const targetHeightPx = vis.isMoon ? 18 : 22;
      const radiusPx = bodyVisualRadii[idx]! / Math.max(1e-12, auPerPixel);
      const offsetPx = radiusPx + 8 + targetHeightPx / 2;
      const labelSy = sy - offsetPx;

      // Occlusion check: if a planet's label lands inside the Sun's disc or right on the Sun,
      // and this planet is NOT the focused/selected target, hide it so it doesn't stamp over the Sun
      if (idx !== 0 && vis.id !== v.selected && vis.id !== focusId) {
        const distToSunCenter = Math.hypot(sx - sunSx, labelSy - sunSy);
        const distBodyToSunCenter = Math.hypot(sx - sunSx, sy - sunSy);
        if (distToSunCenter < sunRadPx + 14 || distBodyToSunCenter < sunRadPx + 10) {
          continue; // occluded by Sun
        }
      }

      const boxW = vis.isMoon ? 68 : 88;
      const boxH = 24;

      let collides = false;
      for (const b of placedBoxes) {
        if (Math.abs(sx - b.x) < (boxW + b.w) * 0.52 && Math.abs(labelSy - b.y) < (boxH + b.h) * 0.52) {
          collides = true;
          break;
        }
      }

      if (!collides || labelPriority(idx) >= 600) {
        finalLabelVisible[idx] = true;
        placedBoxes.push({ x: sx, y: labelSy, w: boxW, h: boxH });
      }
    }

    for (let i = 0; i < s.n; i++) {
      const vis = visuals[i]!;
      vis.updateLabel(
        bodyDists[i]!,
        finalLabelVisible[i]!,
        bodyVisualRadii[i]!,
        camera.fov,
        height,
      );
    }

    // Cache latest projected screen positions and labels for instantaneous, pixel-accurate picking
    const currentTargets: ProjectedBodyPick[] = [];
    for (let i = 0; i < s.n; i++) {
      const vis = visuals[i]!;
      if (!vis.group.visible) continue;
      _vProj.copy(vis.group.position).project(camera);
      if (_vProj.z > 1.0 || _vProj.z < -1.0) continue;

      const sx = ((_vProj.x + 1) / 2) * width;
      const sy = ((-_vProj.y + 1) / 2) * height;
      const frustumHeightAu = 2 * bodyDists[i]! * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const auPerPixel = frustumHeightAu / Math.max(1, height);
      const targetHeightPx = vis.isMoon ? 18 : 22;
      const radiusPx = bodyVisualRadii[i]! / Math.max(1e-12, auPerPixel);
      const offsetPx = radiusPx + 8 + targetHeightPx / 2;

      currentTargets.push({
        id: vis.id,
        x: sx,
        y: sy,
        dist: bodyDists[i]!,
        visible: true,
        radiusPx,
        labelVisible: finalLabelVisible[i]!,
        labelY: sy - offsetPx,
        labelHalfW: vis.isMoon ? 34 : 44,
        labelHalfH: 12,
        isMoon: vis.isMoon,
      });
    }

    // Include galactic Sun marker and Sgr A* when in galactic overview or deep space
    if (isGalacticOverview || camDistToSun > 250) {
      galaxyVisual.getSunPosition(_vProj);
      galaxyVisual.group.localToWorld(_vProj);
      const dSun = camera.position.distanceTo(_vProj);
      _vProj.project(camera);
      if (_vProj.z >= -1.0 && _vProj.z <= 1.0) {
        const sx = ((_vProj.x + 1) / 2) * width;
        const sy = ((-_vProj.y + 1) / 2) * height;
        currentTargets.push({
          id: 'sun',
          x: sx,
          y: sy,
          dist: dSun,
          visible: true,
          radiusPx: 24,
          labelVisible: true,
          labelY: sy - 24,
          labelHalfW: 80,
          labelHalfH: 14,
        });
      }

      galaxyVisual.getSgrAPosition(_vProj);
      const dSgr = camera.position.distanceTo(_vProj);
      _vProj.project(camera);
      if (_vProj.z >= -1.0 && _vProj.z <= 1.0) {
        const sx = ((_vProj.x + 1) / 2) * width;
        const sy = ((-_vProj.y + 1) / 2) * height;
        currentTargets.push({
          id: 'sgra',
          x: sx,
          y: sy,
          dist: dSgr,
          visible: true,
          radiusPx: 28,
          labelVisible: true,
          labelY: sy - 24,
          labelHalfW: 65,
          labelHalfH: 14,
        });
      }
    }
    latestPickTargets = currentTargets;

    // Photorealistic celestial sphere starfield: keeps centered on observer at infinity
    starfieldGroup.position.copy(camera.position);
    if (v.frame.axes) {
      const m = v.frame.axes;
      _starRotMat.set(
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        0, 0, 0, 1,
      );
      starfieldGroup.quaternion.setFromRotationMatrix(_starRotMat);
    } else {
      starfieldGroup.quaternion.identity();
    }

    // Planetary and lunar orbital path loops (NASA Eyes style):
    // Every orbital point transforms through the exact same mapping pipeline (frame axes,
    // origin, squash, galacto voyage) so planets remain 100% on their orbit lines.
    orbitPaths.update(
      s,
      v,
      sunIdx,
      galacto,
      o,
      f,
      camDistToSun,
      bodyDists,
      v.selected ?? null,
      focusId ?? null,
      v.showOrbitPaths !== false,
    );

    // Asteroid belt, Kuiper belt, and Oort cloud visuals in unified cosmos:
    // Rendered around the Sun when viewing solar or Orion Arm scales
    const showBelts = (!isGalacticOverview || camDistToSun < 400) && visuals[0] != null;
    if (showBelts) {
      oortVisual.update(camDistToSun, v.showOortCloud === true || v.preset === 'oort');
      oortVisual.group.position.copy(visuals[0]!.group.position);
    } else {
      oortVisual.setVisible(false);
    }

    // Milky Way Galaxy in unified cosmos: active across cosmological scales
    if (v.showMilkyWay !== false) {
      galaxyVisual.setVisible(true);
      const isLocalPlanetaryFrame = v.frame.id.startsWith('body:') && v.frame.id !== 'body:sun';
      const showGalacticTail = !isLocalPlanetaryFrame && (v.showOrbitPaths !== false || v.trails !== false);

      galaxyVisual.setUnifiedMode(camDistToSun, v.showGalacticHalo !== false, showGalacticTail);
      galaxyVisual.setOrbitLineVisible(showGalacticTail);
      if (v.galaxyZExag !== undefined) {
        galaxyVisual.setVerticalExaggeration(v.galaxyZExag);
      }
      // Voyage mode already anchored + updated the group above; don't redo it.
      if (!galacto) updateGalaxyTransform(v.frame, v.galaxyState);
    } else {
      galaxyVisual.setVisible(false);
    }

    // Galaxy markers & guides handoff:
    // Only in deep galactic overview (focus on Sgr A*, full Milky Way preset, or camera > 2,500 AU away from the Sun)
    // does the Sun galactic locator badge appear.
    // The real accurate solar system (Keplerian orbits, real planets, Sun) is ALWAYS rendered when viewing the solar system.
    const showGalacticMarker = (
      focusId === 'sgra' ||
      v.preset === 'milkyWay' ||
      (!showAccurateSystem && camDistToSun >= 2500)
    ) && (camDistToSun >= 800);
    galaxyVisual.setSunMarkerVisible(showGalacticMarker);
    if (v.galactocentric || camDistToSun < 1500) {
      galaxyVisual.setGuidesVisible(false);
    } else {
      galaxyVisual.setGuidesVisible(true);
    }

    mapPoint(ax, o, 0, 0, 0, p);
    squash(v.frame.travelDir, v.compress ?? 1, p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!, w);
    const baryPos = new THREE.Vector3(w[0]!, w[1]!, w[2]!);
    const sunPos = visuals[0]!.group.position;

    // Show the "empty point" Solar System Barycenter when labels are enabled and screen separation is legible,
    // or when in wobble/barycentric focus mode, but NOT in distant overview where it overlaps the Sun
    const sepSunBaryAu = baryPos.distanceTo(sunPos);
    const frustumH = 2 * camDistToSun * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const auPerPx = frustumH / Math.max(1, height);
    const sepSunBaryPx = sepSunBaryAu / Math.max(1e-12, auPerPx);

    const isWobbleFocus = v.focus === -1 || v.preset === 'wobble' || v.preset === 'sunUnified';
    const showBary =
      !v.galactocentric &&
      !isGalacticOverview &&
      (isWobbleFocus || (v.showLabels !== false && sepSunBaryPx >= 30 && camDistToSun < 5));
    baryVisual.update(baryPos, sunPos, camera, height, showBary);

    // Update NASA 3D Trajectory, Gravity Pull Vectors & Solar Wobble Loop Overlays
    const focusTargetIdx = v.focus >= 0 ? v.focus : sunIdx;
    const bodySimPos: [number, number, number] | null = focusTargetIdx >= 0
      ? [s.pos[3 * focusTargetIdx]!, s.pos[3 * focusTargetIdx + 1]!, s.pos[3 * focusTargetIdx + 2]!]
      : null;
    const sunSimPos: [number, number, number] | null = sunIdx >= 0
      ? [s.pos[3 * sunIdx]!, s.pos[3 * sunIdx + 1]!, s.pos[3 * sunIdx + 2]!]
      : null;

    trajOverlayVisual.update(
      v.frame,
      o,
      f,
      v.compress ?? 1,
      camDistToSun,
      cachedTrajPoints,
      cachedGravityPull,
      bodySimPos,
      cachedSolarWobble,
      sunSimPos,
    );

    for (let i = 0; i < trails.length; i++) {
      const t = trails[i]!;
      const id = model.ids[i]!;
      if (!v.trails) {
        t.line.visible = false;
        continue;
      }

      if (v.galactocentric) {
        // Voyage mode draws planet helices; moon helices only up close.
        // In deep galaxy overview (focus on Sgr A* or camera > 1500 AU), the Sun's curved galactic
        // orbit line represents the Solar System's path around Sgr A*; individual planetary trails
        // are hidden so they never streak across the galaxy.
        const vis = visuals[i]!;
        const isDeepGalaxyView = isGalacticOverview && (focusId === 'sgra' || camDistToSun > 1500);
        t.line.visible = !isDeepGalaxyView && voyageTrailVisible(vis.isMoon, camDistToSun);
        (t.line.material as THREE.LineBasicMaterial).opacity = 1;
        continue;
      }

      (t.line.material as THREE.LineBasicMaterial).opacity = 0.6;
      // Hide ALL heliocentric trails when the camera is at galactic distances
      // (> 250 AU) in any galactic-category frame, or in a deep overview.
      // Without this, 30-AU planetary orbit trails streak across the entire galaxy.
      const isGalFrame = v.frame.id === 'galactic-aligned' || v.frame.id === 'galactic' || v.presetCategory === 'galaxy';
      if ((isGalacticOverview || (isGalFrame && camDistToSun > 250)) && !showAccurateSystem) {
        t.line.visible = false;
        continue;
      }

      if (focusId && focusId !== 'sun') {
        // Focused on a planetary or moon system
        const myParent = (model.bodies?.find((b) => b.id === id) as { parent?: string } | undefined)?.parent;
        const inSystem = id === focusParent || myParent === focusParent;
        const focusIdx = model.ids.indexOf(focusId);
        const camDistToFocus = focusIdx >= 0 ? (bodyDists[focusIdx] ?? Infinity) : Infinity;

        // When NASA orbit paths are active, OrbitPathVisual renders the high-precision 256-segment
        // host-anchored ellipse. Suppress duplicate moon trail so they never conflict or overlap.
        const showMoonTrail = !myParent || v.showOrbitPaths === false;

        // When zoomed out (camDistToFocus > 1.5 AU or camDistToSun > 2.5 AU), keep major planet trails visible
        // so looking across the solar system while tracking a body never empties the sky!
        if (camDistToFocus > 1.5 || camDistToSun > 2.5) {
          t.line.visible = (!myParent || inSystem) && showMoonTrail;
        } else {
          // Up close: show moon orbital trails around the host; hide the host's own heliocentric trail
          // so it doesn't slice through the host planet's face while inspecting its moons
          const isHost = id === focusId || id === focusParent;
          t.line.visible = inSystem && showMoonTrail && !isHost;
        }
      } else {
        // Focused on Sun or Barycenter: show planets and dwarf planets (omit moons to avoid trail clutter)
        if (id === 'sun') {
          t.line.visible = galacto != null || v.focus === -1 || v.preset === 'wobble' || v.preset === 'sunUnified';
        } else {
          const myParent = (model.bodies?.find((b) => b.id === id) as { parent?: string } | undefined)?.parent;
          t.line.visible = !myParent;
        }
      }
    }

    if (v.trails) {
      if (galacto != null) {
        const count = buildGalactoTracks(v.history, s, galacto.params, sunIdx, Math.min(v.trailDays, VOYAGE_TRAIL_DAYS_MAX), trailData);
        trails.forEach((t) => t.commit(count));
      } else {
        const count = buildTracks(
          v.history,
          s,
          v.frame,
          v.focus,
          v.trailDays,
          trailData,
          v.compress ?? 1,
        );

        if (v.showOrbitPaths === false) {
          // When closed NASA orbit paths are toggled off by user, synthesize fallback loops on trail lines:
          const MOON_SEGS = 64;
          const plutoIdx = model.ids.indexOf('pluto');
          const charonIdx = model.ids.indexOf('charon');
          const handledIndices = new Set<number>();

          // 1. Pluto-Charon binary pair: loops orbiting mutual center of mass
          if (plutoIdx >= 0 && charonIdx >= 0) {
            const gmP = s.gm[plutoIdx] ?? 0;
            const gmC = s.gm[charonIdx] ?? 0;
            const totalGm = Math.max(1e-18, gmP + gmC);
            const px = s.pos[3 * plutoIdx]!,
              py = s.pos[3 * plutoIdx + 1]!,
              pz = s.pos[3 * plutoIdx + 2]!;
            const cx = s.pos[3 * charonIdx]!,
              cy = s.pos[3 * charonIdx + 1]!,
              cz = s.pos[3 * charonIdx + 2]!;

            const baryX = (gmP * px + gmC * cx) / totalGm;
            const baryY = (gmP * py + gmC * cy) / totalGm;
            const baryZ = (gmP * pz + gmC * cz) / totalGm;

            const rx = cx - px,
              ry = cy - py,
              rz = cz - pz;
            const vx = s.vel[3 * charonIdx]! - s.vel[3 * plutoIdx]!;
            const vy = s.vel[3 * charonIdx + 1]! - s.vel[3 * plutoIdx + 1]!;
            const vz = s.vel[3 * charonIdx + 2]! - s.vel[3 * plutoIdx + 2]!;

            let el = stateToElements(totalGm, [rx, ry, rz], [vx, vy, vz]);
            if (!Number.isFinite(el.a) || el.a <= 0 || el.e >= 0.99) {
              const rNorm = Math.hypot(rx, ry, rz);
              el = {
                a: rNorm,
                e: 0.001,
                inc: el.inc || 0,
                node: el.node || 0,
                argPeri: el.argPeri || 0,
                meanAnom: 0,
                period: 2 * Math.PI * Math.sqrt((rNorm * rNorm * rNorm) / totalGm),
              };
            }

            const q = Math.sqrt(Math.max(0, 1 - el.e * el.e));
            const cO = Math.cos(el.node),
              sO = Math.sin(el.node);
            const cw = Math.cos(el.argPeri),
              sw = Math.sin(el.argPeri);
            const ci = Math.cos(el.inc),
              si = Math.sin(el.inc);

            const Px = cO * cw - sO * sw * ci;
            const Py = sO * cw + cO * sw * ci;
            const Pz = sw * si;

            const Qx = -cO * sw - sO * cw * ci;
            const Qy = -sO * sw + cO * cw * ci;
            const Qz = cw * si;

            const fracP = gmC / totalGm;
            const fracC = gmP / totalGm;

            const outPluto = trailData[plutoIdx]!;
            const outCharon = trailData[charonIdx]!;

            for (let k = 0; k <= MOON_SEGS; k++) {
              const E = (k / MOON_SEGS) * 2 * Math.PI;
              const cE = Math.cos(E);
              const sE = Math.sin(E);

              const relDx = el.a * (cE - el.e) * Px + el.a * q * sE * Qx;
              const relDy = el.a * (cE - el.e) * Py + el.a * q * sE * Qy;
              const relDz = el.a * (cE - el.e) * Pz + el.a * q * sE * Qz;

              // Pluto
              const simPx = baryX - fracP * relDx;
              const simPy = baryY - fracP * relDy;
              const simPz = baryZ - fracP * relDz;
              mapPoint(ax, o, simPx, simPy, simPz, p);
              squash(v.frame.travelDir, v.compress ?? 1, p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!, outPluto, 3 * k);

              // Charon
              const simCx = baryX + fracC * relDx;
              const simCy = baryY + fracC * relDy;
              const simCz = baryZ + fracC * relDz;
              mapPoint(ax, o, simCx, simCy, simCz, p);
              squash(v.frame.travelDir, v.compress ?? 1, p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!, outCharon, 3 * k);
            }

            trails[plutoIdx]!.commit(0);
            trails[charonIdx]!.commit(MOON_SEGS + 1);
            handledIndices.add(plutoIdx);
            handledIndices.add(charonIdx);
          }

          // 2. All other moons orbiting a parent host
          for (let i = 0; i < s.n; i++) {
            if (handledIndices.has(i)) continue;
            const vis = visuals[i]!;
            if (vis.isMoon && vis.parentId) {
              const pIdx = model.ids.indexOf(vis.parentId);
              if (pIdx >= 0) {
                const mu = s.gm[pIdx]! + s.gm[i]!;
                const rRel: [number, number, number] = [
                  s.pos[3 * i]! - s.pos[3 * pIdx]!,
                  s.pos[3 * i + 1]! - s.pos[3 * pIdx + 1]!,
                  s.pos[3 * i + 2]! - s.pos[3 * pIdx + 2]!,
                ];
                const vRel: [number, number, number] = [
                  s.vel[3 * i]! - s.vel[3 * pIdx]!,
                  s.vel[3 * i + 1]! - s.vel[3 * pIdx + 1]!,
                  s.vel[3 * i + 2]! - s.vel[3 * pIdx + 2]!,
                ];
                let el = stateToElements(mu, rRel, vRel);
                if (!Number.isFinite(el.a) || el.a <= 0 || el.e >= 0.99) {
                  const rNorm = Math.hypot(rRel[0], rRel[1], rRel[2]);
                  el = {
                    a: rNorm,
                    e: 0.001,
                    inc: el.inc || 0,
                    node: el.node || 0,
                    argPeri: el.argPeri || 0,
                    meanAnom: 0,
                    period: 2 * Math.PI * Math.sqrt((rNorm * rNorm * rNorm) / Math.max(1e-18, mu)),
                  };
                }
                const outArr = trailData[i]!;
                for (let k = 0; k <= MOON_SEGS; k++) {
                  const M = (k / MOON_SEGS) * 2 * Math.PI;
                  const st = elementsToState(mu, el.a, el.e, el.inc, el.node, el.argPeri, M);
                  const simX = s.pos[3 * pIdx]! + st.pos[0]!;
                  const simY = s.pos[3 * pIdx + 1]! + st.pos[1]!;
                  const simZ = s.pos[3 * pIdx + 2]! + st.pos[2]!;
                  mapPoint(ax, o, simX, simY, simZ, p);
                  squash(v.frame.travelDir, v.compress ?? 1, p[0]! - f[0]!, p[1]! - f[1]!, p[2]! - f[2]!, outArr, 3 * k);
                }
                trails[i]!.commit(MOON_SEGS + 1);
                continue;
              }
            }
            trails[i]!.commit(count);
          }
        } else {
          // NASA OrbitPathVisual handles all planetary & lunar closed orbits: commit standard tracks directly
          trails.forEach((t) => t.commit(count));
        }
      }
    }

    if (flight) {
      const k = (performance.now() - flight.t0) / flight.dur;
      const tgt = flight.getTarget();
      if (!tgt) {
        const cb = flight.onDone;
        flight = null;
        cb?.(null);
      } else {
        flight.lastTgt = tgt.clone();
        const pose = flightPose(
          [flight.fromPos.x, flight.fromPos.y, flight.fromPos.z],
          [flight.fromTgt.x, flight.fromTgt.y, flight.fromTgt.z],
          [tgt.x, tgt.y, tgt.z],
          [flight.dir.x, flight.dir.y, flight.dir.z],
          flight.dist,
          k,
        );
        camera.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        controls.target.set(pose.tgt[0], pose.tgt[1], pose.tgt[2]);
        if (k >= 1) {
          const cb = flight.onDone;
          const pin = flight.pinTargetOnDone ? flight.lastTgt : null;
          flight = null;
          // Rigid pin: translate camera AND target by -tracked so the tracked
          // body stays pixel-stable across the focus swap in onDone below.
          if (pin) {
            camera.position.sub(pin);
            controls.target.set(0, 0, 0);
          }
          cb?.(pin);
        }
      }
    } else if (isGalacto && v.focus >= 0 && visuals[v.focus]) {
      // In galactocentric / voyage mode, camera and controls.target stay locked
      // in formation with the traveling Sun/planet as it orbits around the galaxy
      const currentTarget = visuals[v.focus]!.group.position;
      const delta = new THREE.Vector3().subVectors(currentTarget, controls.target);
      if (delta.lengthSq() > 1e-12) {
        controls.target.copy(currentTarget);
        camera.position.add(delta);
      }
    }

    controls.update();
    renderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    galaxyVisual,
    visuals,
    orbitPaths,
    render,
    setView,
    setGalaxyView,
    setGalaxyOrbitPath,
    setGalaxyRotationCurve,
    setGalactoView,
    setQuality,
    flyTo,
    flyToFocus,
    cancelFlight,
    sgrAWorldPosition,
    getCameraDistance,
    setCameraDistance,
    setTrajectoryOverlay: (points: TrajectoryPoint[] | null) => {
      cachedTrajPoints = points;
      trajOverlayVisual.setTrajectoryPath(points);
    },
    setGravityPullOverlay: (pull: GravitationalPullBreakdown | null) => {
      cachedGravityPull = pull;
      trajOverlayVisual.setGravityPull(pull);
    },
    setSolarWobbleOverlay: (wobble: SolarWobbleState | null) => {
      cachedSolarWobble = wobble;
      trajOverlayVisual.setSolarWobble(wobble);
    },
    clearTrajectoryOverlays: () => {
      cachedTrajPoints = null;
      cachedGravityPull = null;
      cachedSolarWobble = null;
      trajOverlayVisual.clear();
    },
  };
}
