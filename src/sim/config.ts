export type IntegratorName =
  | 'leapfrog'
  | 'yoshida4'
  | 'yoshida6'
  | 'yoshida8'
  | 'truth8'
  | 'ias15';

export interface PhysicsConfig {
  integrator: IntegratorName;
  dt: number; // fixed level-0 step, days
  maxSteps: number; // per message
  gr: boolean;
  eihRelativity?: boolean;
  sunJ2: boolean;
  planetJ2: boolean; // used from Phase 5
  harmonics?: boolean;
  srp?: boolean;
  stepsPerPeriod: number; // moon sub-stepping, Phase 5
}

export const DEFAULT_CONFIG: PhysicsConfig = {
  integrator: 'yoshida6',
  dt: 1,
  maxSteps: 4000,
  gr: true,
  eihRelativity: false,
  sunJ2: true,
  planetJ2: true,
  harmonics: false,
  srp: false,
  stepsPerPeriod: 100,
};
