import { describe, it, expect } from 'vitest';
import { formatSimSpeed } from '@/ui/panel';

describe('formatSimSpeed (NASA-Grade Real-Time Simulation Speed)', () => {
  it('formats true 1:1 real-time (1 second / 1 second)', () => {
    // 1 second / 1 second is 1/86400 days/sec
    const realTimeDps = 1 / 86400;
    expect(formatSimSpeed(realTimeDps)).toBe('1.0× Real-Time (1 s/s)');
  });

  it('formats speeds in seconds per second (< 60 s/s)', () => {
    expect(formatSimSpeed(10 / 86400)).toBe('10.0 s/s (10.0×)');
    expect(formatSimSpeed(30 / 86400)).toBe('30.0 s/s (30.0×)');
  });

  it('formats speeds in minutes per second (60 s/s to 3,600 s/s)', () => {
    expect(formatSimSpeed(60 / 86400)).toBe('1.0 min/s (60×)');
    expect(formatSimSpeed(600 / 86400)).toBe('10.0 min/s (600×)');
  });

  it('formats speeds in hours per second (3,600 s/s to 86,400 s/s)', () => {
    expect(formatSimSpeed(3600 / 86400)).toBe('1.0 hr/s (3,600×)');
    // User example: 0.1 day/sec = 2.4 hours/sec = 8,640 seconds in one sec
    expect(formatSimSpeed(0.1)).toBe('2.4 hr/s (8,640×)');
    expect(formatSimSpeed(0.5)).toBe('12.0 hr/s (43,200×)');
  });

  it('formats speeds in days per second (1 d/s to 365.25 d/s)', () => {
    expect(formatSimSpeed(1.0)).toBe('1.0 d/s');
    expect(formatSimSpeed(15.0)).toBe('15.0 d/s');
    expect(formatSimSpeed(100.0)).toBe('100.0 d/s');
  });

  it('formats speeds in years per second (>= 365.25 d/s)', () => {
    expect(formatSimSpeed(365.25)).toBe('1.00 yr/s');
    expect(formatSimSpeed(3652.5)).toBe('10.00 yr/s');
  });
});
