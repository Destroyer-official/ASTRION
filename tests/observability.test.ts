import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LOG_SINK,
  HealthRegistry,
  Logger,
  NOOP_LOG_SINK,
  evaluateSimulationMetrics,
  type LogRecord,
} from '@/observability';

describe('structured logger', () => {
  it('filters records below the configured level and preserves tags and fields', () => {
    const records: LogRecord[] = [];
    const logger = new Logger('app', { write: (record) => records.push(record) }, 'warn');

    logger.debug('ignored');
    logger.warn('worker recovered', { attempts: 2 });
    logger.child('physics', { integrator: 'yoshida4' }).error('integration fault');

    expect(records).toEqual([
      { level: 'warn', tag: 'app', message: 'worker recovered', fields: { attempts: 2 } },
      { level: 'error', tag: 'app.physics', message: 'integration fault', fields: { integrator: 'yoshida4' } },
    ]);
  });

  it('has no-op and console sinks behind the same record contract', () => {
    expect(() => NOOP_LOG_SINK.write({ level: 'info', tag: 'test', message: 'ignored' })).not.toThrow();
    const originalDebug = console.debug;
    const captured: string[] = [];
    console.debug = (message?: unknown) => captured.push(String(message));
    try {
      CONSOLE_LOG_SINK.write({ level: 'debug', tag: 'test', message: 'visible', fields: { value: 1 } });
    } finally {
      console.debug = originalDebug;
    }
    expect(captured).toEqual(['[test] visible {"value":1}']);
  });
});

describe('module health registry', () => {
  it('reports unknown modules and emits only status changes', () => {
    const changes: string[] = [];
    const health = new HealthRegistry({
      onChange: (previous, next) => changes.push(`${previous}->${next.status}`),
    });

    expect(health.get('physics-worker')).toEqual({ module: 'physics-worker', status: 'unknown' });
    health.register('physics-worker', 'ok');
    health.update('physics-worker', 'ok', 'ready');
    health.update('physics-worker', 'degraded', 'invariant warning');

    expect(changes).toEqual(['unknown->ok', 'ok->degraded']);
    expect(health.snapshot()).toEqual([
      { module: 'physics-worker', status: 'degraded', detail: 'invariant warning' },
    ]);
  });
});

describe('simulation invariant checks', () => {
  it('accepts bounded finite drift and rejects NaN, infinity, and threshold violations', () => {
    expect(
      evaluateSimulationMetrics({ energyDrift: 1e-8, angMomDrift: -1e-7, comDriftAu: 1e-9 }),
    ).toEqual({ ok: true, violations: [] });

    const failed = evaluateSimulationMetrics({
      energyDrift: Number.NaN,
      angMomDrift: Number.POSITIVE_INFINITY,
      comDriftAu: 1,
    });

    expect(failed.ok).toBe(false);
    expect(failed.violations.map((violation) => violation.name)).toEqual([
      'non_finite',
      'non_finite',
      'center_of_mass',
    ]);
  });
});
