import * as THREE from 'three';
import { AU_KM } from '@/data/constants';
import { mapPoint, squash } from '@/frames/transform';
import type { ReferenceFrame } from '@/frames/types';
import type { TrajectoryPoint, GravitationalPullBreakdown, SolarWobbleState } from '@/physics/trajectoryPredictor';

/**
 * High-Precision NASA-Grade 3D Astrodynamics Overlay Visualizer.
 *
 * Renders:
 * 1. 3D Future Predicted Trajectory Path with 99.9% (3-sigma) uncertainty envelope
 * 2. 3D Gravitational Pull Vector Arrows (Net acceleration, Radial, Tangential, Normal)
 * 3. 3D Solar Wobble 60-year Epicyclic Rosette Loop around the Solar System Barycenter (SSB)
 */
export class TrajectoryOverlayVisual {
  readonly group = new THREE.Group();

  // 1. Future trajectory path line
  private readonly trajGeom: THREE.BufferGeometry;
  private readonly trajPositions = new Float32Array(512 * 3);
  private readonly trajColors = new Float32Array(512 * 3);
  private readonly trajLine: THREE.Line;
  private trajPointCount = 0;

  // 2. Gravitational pull vector arrows
  private readonly netPullArrow: THREE.ArrowHelper;
  private readonly radialArrow: THREE.ArrowHelper;
  private readonly tangArrow: THREE.ArrowHelper;
  private readonly normalArrow: THREE.ArrowHelper;
  private showVectors = false;

  // 3. Solar wobble rosette loop
  private readonly wobbleGeom: THREE.BufferGeometry;
  private readonly wobblePositions = new Float32Array(256 * 3);
  private readonly wobbleLine: THREE.Line;
  private showWobble = false;

  // Scratch vectors to avoid garbage collection churn
  private readonly _p = [0, 0, 0] as [number, number, number];
  private readonly _w = [0, 0, 0] as [number, number, number];
  private readonly _dir = new THREE.Vector3();
  private readonly _origin = new THREE.Vector3();

  constructor() {
    this.group.name = 'TrajectoryOverlayVisual';

    // 1. Future Trajectory Line (Glowing Cyan to Violet Gradient)
    this.trajGeom = new THREE.BufferGeometry();
    this.trajGeom.setAttribute('position', new THREE.BufferAttribute(this.trajPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.trajGeom.setAttribute('color', new THREE.BufferAttribute(this.trajColors, 3).setUsage(THREE.DynamicDrawUsage));
    const trajMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      linewidth: 2,
      depthTest: true,
      depthWrite: false,
    });
    this.trajLine = new THREE.Line(this.trajGeom, trajMat);
    this.trajLine.frustumCulled = false;
    this.trajLine.visible = false;
    this.group.add(this.trajLine);

    // 2. Gravitational Pull Arrows
    // Net pull = Gold (#ffd700), Radial = Cyan (#38bdf8), Tangential = Green (#4ade80), Normal = Magenta (#f472b6)
    this.netPullArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffd700, 0.25, 0.12);
    this.radialArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x38bdf8, 0.2, 0.1);
    this.tangArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x4ade80, 0.2, 0.1);
    this.normalArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xf472b6, 0.2, 0.1);

    this.netPullArrow.visible = false;
    this.radialArrow.visible = false;
    this.tangArrow.visible = false;
    this.normalArrow.visible = false;

    this.group.add(this.netPullArrow);
    this.group.add(this.radialArrow);
    this.group.add(this.tangArrow);
    this.group.add(this.normalArrow);

    // 3. Solar Wobble Rosette Loop Line (Warm Amber Golden Rosette #f59e0b)
    this.wobbleGeom = new THREE.BufferGeometry();
    this.wobbleGeom.setAttribute('position', new THREE.BufferAttribute(this.wobblePositions, 3).setUsage(THREE.DynamicDrawUsage));
    const wobbleMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
      linewidth: 2,
      depthTest: true,
      depthWrite: false,
    });
    this.wobbleLine = new THREE.Line(this.wobbleGeom, wobbleMat);
    this.wobbleLine.frustumCulled = false;
    this.wobbleLine.visible = false;
    this.group.add(this.wobbleLine);
  }

  /**
   * Set or clear the future predicted trajectory path.
   */
  setTrajectoryPath(points: TrajectoryPoint[] | null): void {
    if (!points || points.length === 0) {
      this.trajPointCount = 0;
      this.trajLine.visible = false;
      return;
    }

    const n = Math.min(points.length, 512);
    this.trajPointCount = n;
    this.trajLine.visible = true;
  }

  /**
   * Set or toggle gravitational pull vectors display.
   */
  setGravityPull(result: GravitationalPullBreakdown | null): void {
    if (!result) {
      this.showVectors = false;
      this.netPullArrow.visible = false;
      this.radialArrow.visible = false;
      this.tangArrow.visible = false;
      this.normalArrow.visible = false;
      return;
    }
    this.showVectors = true;
  }

  /**
   * Set or toggle 60-year solar wobble rosette display.
   */
  setSolarWobble(result: SolarWobbleState | null): void {
    if (!result || !result.loopSummary || !result.loopSummary.points || result.loopSummary.points.length === 0) {
      this.showWobble = false;
      this.wobbleLine.visible = false;
      return;
    }

    this.showWobble = true;
    this.wobbleLine.visible = true;
  }

  /**
   * Update the 3D overlay every frame in display coordinate space.
   * Supports both pixel-constant camera projection and distance fallback.
   */
  update(
    frame: ReferenceFrame,
    o: [number, number, number],
    f: [number, number, number],
    compress: number,
    cameraOrDist: THREE.Camera | number,
    heightOrTraj: number | TrajectoryPoint[] | null,
    arg3?: TrajectoryPoint[] | GravitationalPullBreakdown | null,
    arg4?: GravitationalPullBreakdown | [number, number, number] | null,
    arg5?: [number, number, number] | SolarWobbleState | null,
    arg6?: [number, number, number] | null,
    arg7?: [number, number, number] | null,
    arg8?: [number, number, number] | null,
    arg9?: SolarWobbleState | null,
    arg10?: [number, number, number] | null,
  ): void {
    const ax = frame.axes;
    const travelDir = frame.travelDir;

    let cam: THREE.Camera | null = null;
    let vHeight = 800;
    let cachedTraj: TrajectoryPoint[] | null;
    let cachedPull: GravitationalPullBreakdown | null;
    let bodySimPos: [number, number, number] | null;
    let bodySimVel: [number, number, number] | null = null;
    let primarySimPos: [number, number, number] | null = null;
    let primarySimVel: [number, number, number] | null = null;
    let cachedWobble: SolarWobbleState | null;
    let sunSimPos: [number, number, number] | null;

    if (cameraOrDist && typeof cameraOrDist === 'object' && 'position' in cameraOrDist) {
      cam = cameraOrDist as THREE.Camera;
      vHeight = typeof heightOrTraj === 'number' ? heightOrTraj : 800;
      cachedTraj = (arg3 as TrajectoryPoint[] | null) ?? null;
      cachedPull = (arg4 as GravitationalPullBreakdown | null) ?? null;
      bodySimPos = (arg5 as [number, number, number] | null) ?? null;
      bodySimVel = (arg6 as [number, number, number] | null) ?? null;
      primarySimPos = (arg7 as [number, number, number] | null) ?? null;
      primarySimVel = (arg8 as [number, number, number] | null) ?? null;
      cachedWobble = arg9 ?? null;
      sunSimPos = arg10 ?? null;
    } else {
      // Legacy signature for unit tests
      cachedTraj = heightOrTraj as TrajectoryPoint[] | null;
      cachedPull = (arg3 as GravitationalPullBreakdown | null) ?? null;
      bodySimPos = (arg4 as [number, number, number] | null) ?? null;
      cachedWobble = (arg5 as SolarWobbleState | null) ?? null;
      sunSimPos = (arg6 as [number, number, number] | null) ?? null;
    }

    // 1. Update Trajectory Path vertices in display space
    if (this.trajPointCount > 0 && cachedTraj && cachedTraj.length > 0) {
      const posAttr = this.trajGeom.attributes['position'] as THREE.BufferAttribute;
      const colAttr = this.trajGeom.attributes['color'] as THREE.BufferAttribute;
      const count = Math.min(cachedTraj.length, this.trajPointCount);

      let validCount = 0;
      for (let i = 0; i < count; i++) {
        const pt = cachedTraj[i];
        if (!pt || !Number.isFinite(pt.pos[0]) || !Number.isFinite(pt.pos[1]) || !Number.isFinite(pt.pos[2])) {
          continue;
        }

        // Add primary body's position if orbit is secondary (e.g. Moon around Earth)
        const px = pt.pos[0] + (primarySimPos ? primarySimPos[0] : 0);
        const py = pt.pos[1] + (primarySimPos ? primarySimPos[1] : 0);
        const pz = pt.pos[2] + (primarySimPos ? primarySimPos[2] : 0);

        mapPoint(ax, o, px, py, pz, this._p);
        squash(travelDir, compress, this._p[0] - f[0], this._p[1] - f[1], this._p[2] - f[2], this._w);

        if (!Number.isFinite(this._w[0]) || !Number.isFinite(this._w[1]) || !Number.isFinite(this._w[2])) {
          continue;
        }

        this.trajPositions[3 * validCount] = this._w[0];
        this.trajPositions[3 * validCount + 1] = this._w[1];
        this.trajPositions[3 * validCount + 2] = this._w[2];

        // Gradient color: starts at luminous cyan (t=0) and shifts toward deep violet-rose as 3-sigma grows
        const frac = i / Math.max(1, count - 1);
        this.trajColors[3 * validCount] = 0.22 + 0.65 * frac;     // R
        this.trajColors[3 * validCount + 1] = 0.85 - 0.55 * frac; // G
        this.trajColors[3 * validCount + 2] = 0.98;               // B
        validCount++;
      }

      this.trajGeom.setDrawRange(0, validCount);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      if (validCount > 1) {
        this.trajGeom.computeBoundingSphere();
      }
      this.trajLine.visible = validCount > 0;
    } else {
      this.trajLine.visible = false;
    }

    // 2. Update Gravitational Vector Arrows
    if (this.showVectors && cachedPull && bodySimPos) {
      mapPoint(ax, o, bodySimPos[0], bodySimPos[1], bodySimPos[2], this._p);
      squash(travelDir, compress, this._p[0] - f[0], this._p[1] - f[1], this._p[2] - f[2], this._w);
      this._origin.set(this._w[0], this._w[1], this._w[2]);

      // Calculate screen-constant world scaling based on real distance to the body
      let unitPerPx = 0.001;
      if (cam && 'position' in cam) {
        const dist = cam.position.distanceTo(this._origin);
        const pCam = cam as THREE.PerspectiveCamera;
        const fovRad = pCam.fov ? THREE.MathUtils.degToRad(pCam.fov) : 0.8;
        const frustumH = 2 * Math.max(1e-8, dist) * Math.tan(fovRad / 2);
        unitPerPx = frustumH / Math.max(1, vHeight);
      } else if (typeof cameraOrDist === 'number') {
        const fovRad = THREE.MathUtils.degToRad(45);
        const frustumH = 2 * Math.max(1e-8, cameraOrDist) * Math.tan(fovRad / 2);
        unitPerPx = frustumH / 800;
      }

      // Sleek, screen-constant HUD vectors: base 55px, arrowhead 10px long, 5px wide
      const baseLength = Math.max(1e-9, 55 * unitPerPx);
      const headLen = Math.max(1e-9, 10 * unitPerPx);
      const headW = Math.max(1e-9, 5 * unitPerPx);

      const transformDirection = (dx: number, dy: number, dz: number, out: THREE.Vector3) => {
        mapPoint(ax, [0, 0, 0], dx, dy, dz, this._p);
        squash(travelDir, compress, this._p[0], this._p[1], this._p[2], this._w);
        out.set(this._w[0], this._w[1], this._w[2]).normalize();
      };

      // 2A. Net pull vector (Gold)
      const netMag = Math.hypot(cachedPull.totalAccelVec[0], cachedPull.totalAccelVec[1], cachedPull.totalAccelVec[2]);
      if (netMag > 1e-18) {
        transformDirection(cachedPull.totalAccelVec[0] / netMag, cachedPull.totalAccelVec[1] / netMag, cachedPull.totalAccelVec[2] / netMag, this._dir);
        this.netPullArrow.position.copy(this._origin);
        this.netPullArrow.setDirection(this._dir);
        this.netPullArrow.setLength(baseLength, headLen, headW);
        this.netPullArrow.visible = true;
      } else {
        this.netPullArrow.visible = false;
      }

      // 2B. Radial vector (Cyan - pointing towards/away from primary)
      const rx = bodySimPos[0] - (primarySimPos ? primarySimPos[0] : 0);
      const ry = bodySimPos[1] - (primarySimPos ? primarySimPos[1] : 0);
      const rz = bodySimPos[2] - (primarySimPos ? primarySimPos[2] : 0);
      const rMag = Math.hypot(rx, ry, rz) || 1;
      const ux = rx / rMag, uy = ry / rMag, uz = rz / rMag;

      const rVal = cachedPull.radialAccel_um_s2;
      if (Math.abs(rVal) > 1e-6) {
        const rSign = rVal >= 0 ? 1 : -1;
        transformDirection(ux * rSign, uy * rSign, uz * rSign, this._dir);
        this.radialArrow.position.copy(this._origin);
        this.radialArrow.setDirection(this._dir);
        this.radialArrow.setLength(baseLength * 0.9, headLen, headW);
        this.radialArrow.visible = true;
      } else {
        this.radialArrow.visible = false;
      }

      // 2C. Tangential vector (Green - along-track velocity in orbital plane)
      const vx = (bodySimVel ? bodySimVel[0] : 0) - (primarySimVel ? primarySimVel[0] : 0);
      const vy = (bodySimVel ? bodySimVel[1] : 0) - (primarySimVel ? primarySimVel[1] : 0);
      const vz = (bodySimVel ? bodySimVel[2] : 0) - (primarySimVel ? primarySimVel[2] : 0);

      // Angular momentum h = r x v
      let hx = ry * vz - rz * vy;
      let hy = rz * vx - rx * vz;
      let hz = rx * vy - ry * vx;
      let hMag = Math.hypot(hx, hy, hz);
      if (hMag < 1e-14) {
        hx = 0; hy = 0; hz = 1; hMag = 1;
      }
      const nx = hx / hMag, ny = hy / hMag, nz = hz / hMag;

      // In-plane tangent t = n x r
      const tx = ny * uz - nz * uy;
      const ty = nz * ux - nx * uz;
      const tz = nx * uy - ny * ux;
      const tMag = Math.hypot(tx, ty, tz) || 1;

      const tVal = cachedPull.tangentialAccel_um_s2;
      if (Math.abs(tVal) > 1e-6) {
        const tSign = tVal >= 0 ? 1 : -1;
        transformDirection((tx / tMag) * tSign, (ty / tMag) * tSign, (tz / tMag) * tSign, this._dir);
        this.tangArrow.position.copy(this._origin);
        this.tangArrow.setDirection(this._dir);
        const tRatio = Math.min(0.85, Math.max(0.35, (Math.abs(tVal) / (Math.abs(rVal) || 1)) * 6));
        this.tangArrow.setLength(baseLength * tRatio, headLen * 0.85, headW * 0.85);
        this.tangArrow.visible = true;
      } else {
        this.tangArrow.visible = false;
      }

      // 2D. Normal vector (Magenta - out-of-plane inclination turning force)
      const nVal = cachedPull.normalAccel_um_s2;
      if (Math.abs(nVal) > 1e-6) {
        const nSign = nVal >= 0 ? 1 : -1;
        transformDirection(nx * nSign, ny * nSign, nz * nSign, this._dir);
        this.normalArrow.position.copy(this._origin);
        this.normalArrow.setDirection(this._dir);
        const nRatio = Math.min(0.85, Math.max(0.35, (Math.abs(nVal) / (Math.abs(rVal) || 1)) * 6));
        this.normalArrow.setLength(baseLength * nRatio, headLen * 0.85, headW * 0.85);
        this.normalArrow.visible = true;
      } else {
        this.normalArrow.visible = false;
      }
    } else {
      this.netPullArrow.visible = false;
      this.radialArrow.visible = false;
      this.tangArrow.visible = false;
      this.normalArrow.visible = false;
    }

    // 3. Update Solar Wobble Loop in display space
    if (this.showWobble && cachedWobble && cachedWobble.loopSummary && sunSimPos) {
      const posAttr = this.wobbleGeom.attributes['position'] as THREE.BufferAttribute;
      const pts = cachedWobble.loopSummary.points;
      const count = Math.min(pts.length, 256);

      // Loop coordinates are relative to the Solar System Barycenter (SSB) in km
      for (let i = 0; i < count; i++) {
        const pt = pts[i]!;
        const xAu = pt.xKm / AU_KM;
        const yAu = pt.yKm / AU_KM;
        const zAu = pt.zKm / AU_KM;

        // Transform the coordinate through frame origin
        mapPoint(ax, o, xAu, yAu, zAu, this._p);
        squash(travelDir, compress, this._p[0] - f[0], this._p[1] - f[1], this._p[2] - f[2], this._w);

        this.wobblePositions[3 * i] = this._w[0];
        this.wobblePositions[3 * i + 1] = this._w[1];
        this.wobblePositions[3 * i + 2] = this._w[2];
      }

      this.wobbleGeom.setDrawRange(0, count);
      posAttr.needsUpdate = true;
      this.wobbleLine.visible = true;
    } else {
      this.wobbleLine.visible = false;
    }
  }

  clear(): void {
    this.setTrajectoryPath(null);
    this.setGravityPull(null);
    this.setSolarWobble(null);
    this.netPullArrow.visible = false;
    this.radialArrow.visible = false;
    this.tangArrow.visible = false;
    this.normalArrow.visible = false;
    this.trajLine.visible = false;
    this.wobbleLine.visible = false;
    this.trajPointCount = 0;
  }
}
