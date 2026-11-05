export interface SimulationMetrics {
  readonly energyDrift: number;
  readonly angMomDrift: number;
  readonly comDriftAu: number;
}

export interface InvariantThresholds {
  readonly maxEnergyDrift: number;
  readonly maxAngMomDrift: number;
  readonly maxComDriftAu: number;
}

export type InvariantName = 'non_finite' | 'energy' | 'angular_momentum' | 'center_of_mass';

export interface InvariantViolation {
  readonly name: InvariantName;
  readonly value: number;
  readonly threshold: number;
}

export interface InvariantResult {
  readonly ok: boolean;
  readonly violations: readonly InvariantViolation[];
}

/**
 * UNVERIFIED operational thresholds: engineering acceptance limits, not measured
 * physical constants. See docs/OPEN_QUESTIONS.md.
 */
export const DEFAULT_INVARIANT_THRESHOLDS: InvariantThresholds = {
  maxEnergyDrift: 1e-6,
  maxAngMomDrift: 1e-6,
  maxComDriftAu: 1e-6,
};

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

export function evaluateSimulationMetrics(
  metrics: SimulationMetrics,
  thresholds: InvariantThresholds = DEFAULT_INVARIANT_THRESHOLDS,
): InvariantResult {
  const values: ReadonlyArray<readonly [number, number, InvariantName, 'non_finite']> = [
    [metrics.energyDrift, thresholds.maxEnergyDrift, 'energy', 'non_finite'],
    [metrics.angMomDrift, thresholds.maxAngMomDrift, 'angular_momentum', 'non_finite'],
    [metrics.comDriftAu, thresholds.maxComDriftAu, 'center_of_mass', 'non_finite'],
  ];

  const violations: InvariantViolation[] = [];
  for (const [value, threshold, finiteName, nonFiniteName] of values) {
    if (!isFiniteNumber(value)) {
      violations.push({ name: nonFiniteName, value: Number.NaN, threshold: 0 });
    } else if (Math.abs(value) > threshold) {
      violations.push({ name: finiteName, value: Math.abs(value), threshold });
    }
  }

  return { ok: violations.length === 0, violations };
}
