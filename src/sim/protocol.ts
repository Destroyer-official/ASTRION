import type { BodyJson, PhysicalJson } from '@/data/schema';
import type { PhysicsConfig, IntegratorName } from './config';

export const PROTOCOL_VERSION = 1;

export type ToWorker =
  | {
      type: 'init';
      bodies?: BodyJson[];
      ids?: string[];
      physical?: Record<string, PhysicalJson>;
      config?: PhysicsConfig;
      t?: number;
      gm?: Float64Array;
      pos?: Float64Array;
      vel?: Float64Array;
      maxDt?: number;
      maxSteps?: number;
      historyIntervalDays: number;
      integrator?: IntegratorName;
      relativity?: boolean;
      eihRelativity?: boolean;
      quadrupole?: boolean;
      harmonics?: boolean;
      srp?: boolean;
      lenseThirring?: boolean;
      fixedDt?: number;
    }
  | {
      type: 'setPhysics';
      config?: PhysicsConfig;
      integrator?: IntegratorName;
      relativity?: boolean;
      eihRelativity?: boolean;
      quadrupole?: boolean;
      harmonics?: boolean;
      srp?: boolean;
      lenseThirring?: boolean;
      fixedDt?: number;
    }
  | { type: 'advance'; gen: number; days: number }
  | { type: 'seek'; gen: number; t: number } // jump to absolute sim time (days from epoch)
  | { type: 'reset'; gen: number }
  | {
      type: 'load';
      gen: number;
      t: number;
      pos: Float64Array;
      vel: Float64Array;
    }; // replace state with exact external vectors (global SSB order)

export interface Frame {
  type: 'frame';
  gen: number;
  t: number;
  t0: number;
  advanced: number;
  carry: number;
  pos: Float64Array;
  vel: Float64Array;
  pos0: Float64Array;
  vel0: Float64Array;
  samples: Float64Array; // k records of [t, x0,y0,z0, x1,...], record length = stride
  stride: number;
  energyDrift: number;
  angMomDrift: number;
  comDrift: number;
  invariantOk: boolean;
  invariantViolations: readonly string[];
  baryDist: Float64Array; // each body's distance to the system center of mass, AU
}

export function validateToWorker(msg: unknown): { valid: true; data: ToWorker } | { valid: false; error: string } {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message must be a non-null object' };
  }
  const m = msg as Record<string, unknown>;
  if (typeof m['type'] !== 'string') {
    return { valid: false, error: 'Message missing required string property "type"' };
  }

  switch (m['type']) {
    case 'init':
      if (m['historyIntervalDays'] !== undefined && typeof m['historyIntervalDays'] !== 'number') {
        return { valid: false, error: 'init: historyIntervalDays must be a number' };
      }
      return { valid: true, data: msg as ToWorker };
    case 'setPhysics':
      return { valid: true, data: msg as ToWorker };
    case 'advance':
      if (typeof m['gen'] !== 'number' || typeof m['days'] !== 'number') {
        return { valid: false, error: 'advance: gen and days must be numbers' };
      }
      return { valid: true, data: msg as ToWorker };
    case 'seek':
      if (typeof m['gen'] !== 'number' || typeof m['t'] !== 'number') {
        return { valid: false, error: 'seek: gen and t must be numbers' };
      }
      return { valid: true, data: msg as ToWorker };
    case 'reset':
      if (typeof m['gen'] !== 'number') {
        return { valid: false, error: 'reset: gen must be a number' };
      }
      return { valid: true, data: msg as ToWorker };
    case 'load':
      if (
        typeof m['gen'] !== 'number' ||
        typeof m['t'] !== 'number' ||
        !(m['pos'] instanceof Float64Array) ||
        !(m['vel'] instanceof Float64Array)
      ) {
        return { valid: false, error: 'load: requires numeric gen, t and Float64Array pos, vel' };
      }
      return { valid: true, data: msg as ToWorker };
    default:
      return { valid: false, error: `Unknown message type: "${String(m['type'])}"` };
  }
}
