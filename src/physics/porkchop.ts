import { GM_SUN_KM3_S2, gmToInternal, auDayToKms } from '@/data/constants';
import type { Vec3 } from './types';
import { solveLambert, type LambertSolution } from './lambert';
import { elementsToState, type KeplerElements } from './kepler';

export interface PorkchopPoint {
  /** Departure date (Julian Date) */
  depJd: number;
  /** Arrival date (Julian Date) */
  arrJd: number;
  /** Time of flight (days) */
  tofDays: number;
  /** Departure characteristic energy C3 = v_inf_1^2 (km^2/s^2) */
  c3: number;
  /** Departure excess velocity v_inf_1 (km/s) */
  vInfDepKms: number;
  /** Arrival excess velocity v_inf_2 (km/s) */
  vInfArrKms: number;
  /** Total mission Delta-v = v_inf_1 + v_inf_2 (km/s) */
  dvTotalKms: number;
  /** Semi-major axis of transfer orbit (AU) */
  a: number;
  /** Eccentricity of transfer orbit */
  e: number;
  /** Tsiolkovsky propellant mass fraction (0 to 1) for given Isp */
  propellantFraction: number;
  /** Lambert solution details */
  solution?: LambertSolution;
}

export interface PorkchopGrid {
  depDates: number[];
  arrDates: number[];
  c3Grid: number[][];       // [arrIdx][depIdx]
  vInfArrGrid: number[][];  // [arrIdx][depIdx]
  dvTotalGrid: number[][];  // [arrIdx][depIdx]
  best: PorkchopPoint;
}

export interface StateProvider {
  (jd: number): { pos: Vec3; vel: Vec3 };
}

/**
 * Creates a StateProvider from fixed Keplerian orbital elements.
 */
export function keplerStateProvider(mu: number, elem: KeplerElements, epochJd: number): StateProvider {
  const n = Math.sqrt(mu / (elem.a * elem.a * elem.a));
  return (jd: number) => {
    const dt = jd - epochJd;
    const M = elem.meanAnom + n * dt;
    return elementsToState(mu, elem.a, elem.e, elem.inc, elem.node, elem.argPeri, M);
  };
}

/**
 * Computes single interplanetary transfer point between two positions and velocities.
 */
export function computePorkchopPoint(
  mu: number,
  r1: Vec3,
  v1: Vec3,
  r2: Vec3,
  v2: Vec3,
  depJd: number,
  arrJd: number,
  ispS = 380,
): PorkchopPoint | null {
  const tofDays = arrJd - depJd;
  if (tofDays <= 0) return null;

  try {
    const sol = solveLambert(mu, r1, r2, tofDays, true);

    const v1Rel: Vec3 = [sol.v1[0] - v1[0], sol.v1[1] - v1[1], sol.v1[2] - v1[2]];
    const v2Rel: Vec3 = [sol.v2[0] - v2[0], sol.v2[1] - v2[1], sol.v2[2] - v2[2]];

    const vInfDepKms = auDayToKms(Math.hypot(v1Rel[0], v1Rel[1], v1Rel[2]));
    const vInfArrKms = auDayToKms(Math.hypot(v2Rel[0], v2Rel[1], v2Rel[2]));
    const c3 = vInfDepKms * vInfDepKms;
    const dvTotalKms = vInfDepKms + vInfArrKms;

    const g0 = 0.00980665; // km/s^2
    const ve = ispS * g0;  // km/s
    const propellantFraction = 1 - Math.exp(-dvTotalKms / ve);

    return {
      depJd,
      arrJd,
      tofDays,
      c3,
      vInfDepKms,
      vInfArrKms,
      dvTotalKms,
      a: sol.a,
      e: sol.e,
      propellantFraction,
      solution: sol,
    };
  } catch {
    return null;
  }
}

export interface PorkchopSearchOptions {
  mu?: number;
  originState: StateProvider;
  targetState: StateProvider;
  depStartJd: number;
  depEndJd: number;
  depSteps?: number;
  arrStartJd: number;
  arrEndJd: number;
  arrSteps?: number;
  minTofDays?: number;
  maxTofDays?: number;
  ispS?: number;
}

/**
 * Generates a 2D Porkchop contour grid across departure and arrival dates,
 * identifying the global optimal transfer opportunity.
 */
export function generatePorkchopGrid(opts: PorkchopSearchOptions): PorkchopGrid {
  const mu = opts.mu ?? gmToInternal(GM_SUN_KM3_S2);
  const depSteps = Math.max(2, opts.depSteps ?? 20);
  const arrSteps = Math.max(2, opts.arrSteps ?? 20);
  const minTof = opts.minTofDays ?? 30;
  const maxTof = opts.maxTofDays ?? 1200;
  const isp = opts.ispS ?? 380;

  const depStepDays = (opts.depEndJd - opts.depStartJd) / (depSteps - 1);
  const arrStepDays = (opts.arrEndJd - opts.arrStartJd) / (arrSteps - 1);

  const depDates: number[] = [];
  for (let i = 0; i < depSteps; i++) depDates.push(opts.depStartJd + i * depStepDays);

  const arrDates: number[] = [];
  for (let j = 0; j < arrSteps; j++) arrDates.push(opts.arrStartJd + j * arrStepDays);

  const c3Grid: number[][] = [];
  const vInfArrGrid: number[][] = [];
  const dvTotalGrid: number[][] = [];

  let bestPoint: PorkchopPoint | null = null;
  let minDv = Infinity;

  // Pre-sample origin and target states
  const oStates = depDates.map((jd) => opts.originState(jd));
  const tStates = arrDates.map((jd) => opts.targetState(jd));

  for (let j = 0; j < arrSteps; j++) {
    const rowC3: number[] = [];
    const rowVInf: number[] = [];
    const rowDv: number[] = [];

    const arrJd = arrDates[j]!;
    const tState = tStates[j]!;

    for (let i = 0; i < depSteps; i++) {
      const depJd = depDates[i]!;
      const oState = oStates[i]!;
      const tof = arrJd - depJd;

      if (tof < minTof || tof > maxTof) {
        rowC3.push(NaN);
        rowVInf.push(NaN);
        rowDv.push(NaN);
        continue;
      }

      const pt = computePorkchopPoint(mu, oState.pos, oState.vel, tState.pos, tState.vel, depJd, arrJd, isp);
      if (pt && Number.isFinite(pt.dvTotalKms)) {
        rowC3.push(pt.c3);
        rowVInf.push(pt.vInfArrKms);
        rowDv.push(pt.dvTotalKms);

        if (pt.dvTotalKms < minDv) {
          minDv = pt.dvTotalKms;
          bestPoint = pt;
        }
      } else {
        rowC3.push(NaN);
        rowVInf.push(NaN);
        rowDv.push(NaN);
      }
    }

    c3Grid.push(rowC3);
    vInfArrGrid.push(rowVInf);
    dvTotalGrid.push(rowDv);
  }

  if (!bestPoint) {
    // Fallback point if search parameters were too restrictive
    bestPoint = {
      depJd: opts.depStartJd,
      arrJd: opts.arrEndJd,
      tofDays: opts.arrEndJd - opts.depStartJd,
      c3: 999,
      vInfDepKms: 99,
      vInfArrKms: 99,
      dvTotalKms: 198,
      a: 1.5,
      e: 0.2,
      propellantFraction: 0.99,
    };
  }

  return {
    depDates,
    arrDates,
    c3Grid,
    vInfArrGrid,
    dvTotalGrid,
    best: bestPoint,
  };
}
