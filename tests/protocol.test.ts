import { describe, it, expect } from 'vitest';
import { validateToWorker, PROTOCOL_VERSION } from '@/sim/protocol';

describe('Worker Protocol Runtime Validation (AUDIT-12)', () => {
  it('exposes a positive integer protocol version', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('validates well-formed worker messages', () => {
    expect(validateToWorker({ type: 'init', historyIntervalDays: 5 }).valid).toBe(true);
    expect(validateToWorker({ type: 'setPhysics', relativity: true }).valid).toBe(true);
    expect(validateToWorker({ type: 'advance', gen: 0, days: 10 }).valid).toBe(true);
    expect(validateToWorker({ type: 'seek', gen: 1, t: 100 }).valid).toBe(true);
    expect(validateToWorker({ type: 'reset', gen: 2 }).valid).toBe(true);

    const pos = new Float64Array(3);
    const vel = new Float64Array(3);
    expect(validateToWorker({ type: 'load', gen: 3, t: 0, pos, vel }).valid).toBe(true);
  });

  it('rejects malformed messages with descriptive errors', () => {
    expect(validateToWorker(null).valid).toBe(false);
    expect(validateToWorker(undefined).valid).toBe(false);
    expect(validateToWorker(42).valid).toBe(false);
    expect(validateToWorker({}).valid).toBe(false);
    expect(validateToWorker({ type: 'unknownAction' }).valid).toBe(false);

    // Bad parameters
    expect(validateToWorker({ type: 'advance', gen: '0', days: 10 }).valid).toBe(false);
    expect(validateToWorker({ type: 'seek', gen: 0, t: '100' }).valid).toBe(false);
    expect(validateToWorker({ type: 'reset', gen: 'notANumber' }).valid).toBe(false);
    expect(validateToWorker({ type: 'load', gen: 0, t: 0, pos: [0, 0, 0], vel: [0, 0, 0] }).valid).toBe(false);
  });
});
