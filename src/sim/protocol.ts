import type { BodyJson, PhysicalJson } from '@/data/schema';
import type { PhysicsConfig, IntegratorName } from './config';

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
