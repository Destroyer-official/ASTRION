import { GALACTIC_AXES_IN_SIM } from '@/frames/galactic';
import type { SystemState } from '@/physics/types';
import type { History } from '@/sim/history';

import { kmsToAuDay } from '@/data/constants';

const GX = GALACTIC_AXES_IN_SIM;

export interface GalactoParams {
  /** Sun's galactic position (kpc) at the live moment = trail head anchor. */
  sunGalKpc: readonly [number, number, number];
  /** Sun's galactic velocity (km/s) at the live moment (drift direction). */
  velGalKms: readonly [number, number, number];
  /** Scene units per kpc applied by the galaxy group's scale. */
  unitsPerKpc: number;
  /**
   * Scene units per AU of heliocentric offset. True value (~3e-7) would render
   * every orbit subpixel; 1-3 keeps the system visible as a labeled cluster.
   */
  helioExag: number;
  /**
   * Along-track stretch. 1.0 gives true physical proportion between solar travel and planetary orbits.
   */
  stretch: number;
  /** Column-major 4x4 world matrix placing galaxy-local kpc coords in the scene. */
  matWorld: ArrayLike<number>;
}

/** Ecliptic (sim) vector into galactic axes. */
export function toGalactic(x: number, y: number, z: number, out: number[]): void {
  out[0] = GX[0]![0]! * x + GX[0]![1]! * y + GX[0]![2]! * z;
  out[1] = GX[1]![0]! * x + GX[1]![1]! * y + GX[1]![2]! * z;
  out[2] = GX[2]![0]! * x + GX[2]![1]! * y + GX[2]![2]! * z;
}

export function applyMat(m: ArrayLike<number>, x: number, y: number, z: number, out: Float32Array, off: number): void {
  out[off] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[off + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[off + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
}

/**
 * One composed vertex in scene units: exact contemporaneous heliocentric
 * offset of body i from the Sun (scaled by helioExag), orbiting along the
 * true curved circular/rosette galactic orbit around Sagittarius A*.
 */
export function galactoVertex(
  p: GalactoParams,
  sun: number,
  liveT: number,
  t: number,
  pos: Float64Array,
  base: number,
  i: number,
  out: Float32Array,
  off: number,
): void {
  const g = [0, 0, 0];
  toGalactic(
    pos[base + 3 * i]! - pos[base + 3 * sun]!,
    pos[base + 3 * i + 1]! - pos[base + 3 * sun + 1]!,
    pos[base + 3 * i + 2]! - pos[base + 3 * sun + 2]!,
    g,
  );
  const k = p.helioExag / p.unitsPerKpc; // scene-AU-exag expressed in kpc
  const dt = t - liveT;

  const x0 = p.sunGalKpc[0]!;
  const y0 = p.sunGalKpc[1]!;
  const z0 = p.sunGalKpc[2]!;
  const rGal = Math.hypot(x0, y0);

  if (rGal < 0.1) {
    const driftX = kmsToAuDay(p.velGalKms[0]!) * dt * p.stretch;
    const driftY = kmsToAuDay(p.velGalKms[1]!) * dt * p.stretch;
    const driftZ = kmsToAuDay(p.velGalKms[2]!) * dt * p.stretch;
    applyMat(p.matWorld, x0 + (g[0]! + driftX) * k, y0 + (g[1]! + driftY) * k, z0 + (g[2]! + driftZ) * k, out, off);
    return;
  }

  // Current galactic azimuth angle from Sgr A*
  const phi0 = Math.atan2(y0, x0);

  // Radial and tangential velocity components in the galactic midplane
  const vx = p.velGalKms[0]!;
  const vy = p.velGalKms[1]!;
  const vz = p.velGalKms[2]!;

  const cosP0 = Math.cos(phi0);
  const sinP0 = Math.sin(phi0);

  const vRad = vx * cosP0 + vy * sinP0;
  const vTan = -vx * sinP0 + vy * cosP0;

  // Radial displacement (AU equivalent converted to kpc)
  const dR = kmsToAuDay(vRad) * dt * p.stretch * k;
  const rCurved = Math.max(0.1, rGal + dR);

  // Tangential displacement along circular arc around Sgr A*
  const dS = kmsToAuDay(vTan) * dt * p.stretch * k;
  const dPhi = dS / rGal;
  const phi = phi0 + dPhi;

  // Sun's center position along curved galactic orbit
  const sunX = rCurved * Math.cos(phi);
  const sunY = rCurved * Math.sin(phi);
  const sunZ = z0 + kmsToAuDay(vz) * dt * p.stretch * k;

  // Heliocentric offset g is in galactic axes, matching orbitPathVisual and visuals.
  // Add directly to sunX, sunY, sunZ without invalid inversions or sign flips.
  applyMat(
    p.matWorld,
    sunX + g[0]! * k,
    sunY + g[1]! * k,
    sunZ + g[2]! * k,
    out,
    off,
  );
}

/**
 * Voyage helix trail window cap (days). The Sun travels ~0.133 AU/day, so an
 * uncapped multi-year window draws 100+ AU helices per body: from cosmic zoom
 * they collapse into screen-spanning streaks (28 bodies x hundreds of AU).
 * 800 d ~= 106 AU of travel ~= 2.2 Earth turns: the corkscrew stays readable
 * instead of turning into spaghetti. Applied at the viewer call site.
 */
export const VOYAGE_TRAIL_DAYS_MAX = 800;

/**
 * Voyage trail visibility (unit-tested): planets always; moon helices only up
 * close (they ride their parent's helix within sub-pixels at cosmic zoom and
 * read as stray streaks, never as structure).
 */
export function voyageTrailVisible(isMoon: boolean, camDistToSun: number): boolean {
  return !isMoon || camDistToSun < 150;
}

/**
 * Rebuild every body's trail as a true voyage helix. Same window/gap contract
 * as buildTracks: no segment may ever span a date jump or discontinuity.
 * outs[i] must hold at least 3*(history.cap+1) floats. Returns vertex count.
 */
export function buildGalactoTracks(
  h: History,
  live: SystemState,
  p: GalactoParams,
  sun: number,
  windowDays: number,
  outs: Float32Array[],
): number {
  let start = h.count;
  // Same discontinuity guard as buildTracks: a time gap restarts the trail.
  const gapTol = Math.max(4 * h.intervalDays, 1e-9);
  for (let k = h.count - 1; k >= 0; k--) {
    if (Math.abs(live.t - h.timeAt(k)) > windowDays) break;
    if (k < h.count - 1 && Math.abs(h.timeAt(k + 1) - h.timeAt(k)) > gapTol) break;
    start = k;
  }
  // Same tail guard: a stale newest sample never connects to the live point.
  if (start < h.count && Math.abs(live.t - h.timeAt(h.count - 1)) > gapTol) {
    start = h.count;
  }

  let v = 0;
  for (let k = start; k < h.count; k++) {
    for (let i = 0; i < live.n; i++) {
      galactoVertex(p, sun, live.t, h.timeAt(k), h.positions, h.baseAt(k), i, outs[i]!, 3 * v);
    }
    v++;
  }
  for (let i = 0; i < live.n; i++) {
    galactoVertex(p, sun, live.t, live.t, live.pos, 0, i, outs[i]!, 3 * v);
  }
  v++;
  return v;
}
