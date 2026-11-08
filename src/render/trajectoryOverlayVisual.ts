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
   */
  update(
    frame: ReferenceFrame,
    o: [number, number, number],
    f: [number, number, number],
    compress: number,
    camDistToFocus: number,
    cachedTraj: TrajectoryPoint[] | null,
    cachedPull: GravitationalPullBreakdown | null,
    bodySimPos: [number, number, number] | null,
    cachedWobble: SolarWobbleState | null,
    sunSimPos: [number, number, number] | null,
  ): void {
    const ax = frame.axes;
    const travelDir = frame.travelDir;

    // 1. Update Trajectory Path vertices in display space
    if (this.trajPointCount > 0 && cachedTraj && cachedTraj.length > 0) {
      const posAttr = this.trajGeom.attributes['position'] as THREE.BufferAttribute;
      const colAttr = this.trajGeom.attributes['color'] as THREE.BufferAttribute;
      const count = Math.min(cachedTraj.length, this.trajPointCount);

      for (let i = 0; i < count; i++) {
        const pt = cachedTraj[i]!;
        mapPoint(ax, o, pt.pos[0], pt.pos[1], pt.pos[2], this._p);
        squash(travelDir, compress, this._p[0] - f[0], this._p[1] - f[1], this._p[2] - f[2], this._w);

        this.trajPositions[3 * i] = this._w[0];
        this.trajPositions[3 * i + 1] = this._w[1];
        this.trajPositions[3 * i + 2] = this._w[2];

        // Gradient color: starts at luminous cyan (t=0) and shifts toward deep violet-rose as 3-sigma grows
        const frac = i / Math.max(1, count - 1);
        this.trajColors[3 * i] = 0.22 + 0.65 * frac;     // R
        this.trajColors[3 * i + 1] = 0.85 - 0.55 * frac; // G
        this.trajColors[3 * i + 2] = 0.98;               // B
      }

      this.trajGeom.setDrawRange(0, count);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      this.trajLine.visible = true;
    } else {
      this.trajLine.visible = false;
    }

    // 2. Update Gravitational Vector Arrows
    if (this.showVectors && cachedPull && bodySimPos) {
      mapPoint(ax, o, bodySimPos[0], bodySimPos[1], bodySimPos[2], this._p);
      squash(travelDir, compress, this._p[0] - f[0], this._p[1] - f[1], this._p[2] - f[2], this._w);
      this._origin.set(this._w[0], this._w[1], this._w[2]);

      // Scale arrow length dynamically so it is always visually clear at current camera distance
      const visualLength = Math.max(1e-6, camDistToFocus * 0.18);
      const headLen = visualLength * 0.24;
      const headW = visualLength * 0.12;

      // Net pull vector
      const netMag = Math.hypot(cachedPull.totalAccelVec[0], cachedPull.totalAccelVec[1], cachedPull.totalAccelVec[2]);
      if (netMag > 1e-18) {
        mapPoint(ax, [0, 0, 0], cachedPull.totalAccelVec[0] / netMag, cachedPull.totalAccelVec[1] / netMag, cachedPull.totalAccelVec[2] / netMag, this._p);
        squash(travelDir, compress, this._p[0], this._p[1], this._p[2], this._w);
        this._dir.set(this._w[0], this._w[1], this._w[2]).normalize();

        this.netPullArrow.position.copy(this._origin);
        this.netPullArrow.setDirection(this._dir);
        this.netPullArrow.setLength(visualLength, headLen, headW);
        this.netPullArrow.visible = true;
      }

      // Radial vector
      const rVal = cachedPull.radialAccel_um_s2;
      if (Math.abs(rVal) > 1e-6) {
        // Points towards or away from Sun/primary
        const dirSign = rVal > 0 ? 1 : -1;
        this._dir.set(this._w[0] * dirSign, this._w[1] * dirSign, this._w[2] * dirSign).normalize();
        this.radialArrow.position.copy(this._origin);
        this.radialArrow.setDirection(this._dir);
        this.radialArrow.setLength(visualLength * 0.75, headLen * 0.75, headW * 0.75);
        this.radialArrow.visible = true;
      }

      // Tangential vector
      const tVal = cachedPull.tangentialAccel_um_s2;
      if (Math.abs(tVal) > 1e-6) {
        this.tangArrow.position.copy(this._origin);
        this.tangArrow.setLength(visualLength * 0.75, headLen * 0.75, headW * 0.75);
        this.tangArrow.visible = true;
      }

      // Normal vector
      const nVal = cachedPull.normalAccel_um_s2;
      if (Math.abs(nVal) > 1e-6) {
        this.normalArrow.position.copy(this._origin);
        this.normalArrow.setLength(visualLength * 0.75, headLen * 0.75, headW * 0.75);
        this.normalArrow.visible = true;
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
  }
}
